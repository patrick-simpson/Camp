// The big-screen page (current-standings.html + current-standings.js), for both camps.
//
// Since Step 23 the page is a PUBLIC, READ-ONLY subscriber: no account, no Auth SDK, no members
// read, no write of any kind. It reads exactly <root>/revealPublic and .info, and draws what
// reveal-core's tvFrame() says. These tests load its real scripts, in tag order, into a vm context
// behind:
//   - a DOM stub that RECORDS every innerHTML string and every element the page creates, so a hostile
//     string can be shown to have come out inert rather than assumed to;
//   - a fake clock that drives setTimeout / setInterval / Date.now, so "three seconds later", "a quiet
//     08:00" and "hidden for a minute" are exact (nothing here waits on the real clock);
//   - a fake Firebase SDK whose every object throws (and records) on any call the page is not meant to
//     make, so "no write, no path but revealPublic and .info, no firebase.auth" is pinned by behaviour.

const tvVm = nodeRequire('vm');
const MAIN_URL = tvVm.runInThisContext('URL');
const MAIN_URL_PARAMS = tvVm.runInThisContext('URLSearchParams');

const TV_SCRIPTS = ['defaults.js', 'camp-core.js', 'reveal-core.js', 'tv-camp.js', 'camps.js', 'current-standings.js'];
const TV_HTML = readFixture('../current-standings.html');
const TV_JS = readFixture('../current-standings.js');

// What the markup says about an element at load: `hidden` attributes are the page's own.
function markupHidden(id) {
  const m = new RegExp('<[a-z0-9]+\\b[^>]*\\bid="' + id + '"[^>]*>').exec(TV_HTML);
  return !!m && /\shidden(\s|>|=)/.test(m[0]);
}

// ── A fake Firebase: a read-only SDK that refuses everything else ────
function makeSdk() {
  const rec = { refs: [], listeners: {}, calls: [], illegal: [], offlines: 0, onlines: 0, inits: [] };
  const deny = (what) => () => { rec.illegal.push(what); throw new Error('the big screen may not call ' + what); };
  const refFor = (path) => new Proxy({}, {
    get(_, name) {
      if (name === 'on') return (ev, cb, fail) => { rec.listeners[path] = { ev, cb, fail }; rec.calls.push('on:' + path); };
      if (name === 'off') return () => { rec.calls.push('off:' + path); };
      if (typeof name === 'symbol' || name === 'then') return undefined;
      return deny(path + '.' + String(name));
    },
  });
  const db = new Proxy({
    ref(path) { rec.refs.push(path); return refFor(path); },
    goOffline() { rec.offlines++; rec.calls.push('goOffline'); },
    goOnline() { rec.onlines++; rec.calls.push('goOnline'); },
  }, { get: (t, n) => (n in t ? t[n] : (typeof n === 'symbol' ? undefined : deny('database().' + String(n)))) });
  const firebase = new Proxy({
    apps: [],
    initializeApp(cfg) { rec.inits.push(cfg); firebase.apps.push({}); },
    database() { return db; },
  }, {
    get(t, n) {
      if (n in t) return t[n];
      if (typeof n === 'symbol') return undefined;
      rec.illegal.push('firebase.' + String(n)); // firebase.auth lands here
      return undefined;
    },
  });
  rec.firebase = firebase;
  rec.deliver = (path, val) => rec.listeners[path].cb({ val: () => (val === undefined ? null : val) });
  rec.refuse = (path) => rec.listeners[path].fail(new Error('permission_denied'));
  rec.attached = (path) => rec.calls.filter((c) => c === 'on:' + path).length;
  return rec;
}

// ── The page, in a vm ────────────────────────────────────────────────
// Local time is a number the test owns (`clock.t`); the page reads it only through Date.now().
const T0 = Date.UTC(2026, 6, 22, 23, 0, 0); // 7:00 PM Eastern on a July evening

function loadTv(o) {
  o = o || {};
  const log = { html: [], created: [], writes: [] };
  const byId = new Map();
  const bySel = new Map();
  const listeners = {};
  const replaced = [];
  const store = new Map(Object.entries(o.storage || {}));
  const clock = { t: o.clock === undefined ? T0 : o.clock };
  const sched = []; // { id, at, fn, every }
  let nextId = 1;

  function el(tag, track) {
    const cls = new Set();
    let inner = '';
    const e = {
      tagName: String(tag || 'div').toUpperCase(), children: [], style: {}, attrs: {}, listeners: {}, hidden: false,
      textContent: '', isConnected: true, width: 0, height: 0, offsetWidth: 0,
      get className() { return [...cls].join(' '); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
      get innerHTML() { return inner; },
      set innerHTML(v) { inner = String(v); log.html.push(inner); if (inner === '') e.children.length = 0; },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
        contains: (c) => cls.has(c),
      },
      has: (c) => cls.has(c),
      setAttribute(k, v) { e.attrs[k] = String(v); if (k === 'class') e.className = v; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
      appendChild(c) { e.children.push(c); return c; },
      insertAdjacentHTML(pos, h) { log.html.push(String(h)); inner += String(h); },
      addEventListener(type, fn) { (e.listeners[type] = e.listeners[type] || []).push(fn); },
      removeEventListener() {}, remove() {},
      getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
      querySelector(sel) {
        const want = sel.slice(1);
        const find = (n) => {
          for (const c of n.children) {
            if (sel[0] === '.' && c.has && c.has(want)) return c;
            const d = find(c);
            if (d) return d;
          }
          return null;
        };
        return find(e);
      },
    };
    if (track) log.created.push(e);
    return e;
  }
  const byIdFn = (id) => {
    if (!byId.has(id)) { const e = el('div'); e.hidden = markupHidden(id); byId.set(id, e); }
    return byId.get(id);
  };
  byIdFn('wait-status').attrs['data-tone'] = 'connecting';

  const document = {
    title: '', hidden: false, body: el('body'), documentElement: el('html'),
    getElementById: byIdFn,
    querySelector(sel) {
      if (sel.indexOf('tv-build') >= 0) {
        if (!bySel.has(sel)) { const m = el('meta'); m.attrs.content = o.build === undefined ? '2026-test-build' : o.build; bySel.set(sel, m); }
        return bySel.get(sel);
      }
      return el('div');
    },
    createElement: (tag) => el(tag, true),
    createElementNS: (ns, tag) => el(tag, true),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
  };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  const sdk = o.sdk === null ? null : (o.sdk || makeSdk());
  const sandbox = {
    console, document, Date: FakeDate,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { log.writes.push(k); store.set(k, String(v)); },
      removeItem: (k) => { log.writes.push(k); store.delete(k); },
    },
    location: {
      search: o.search || '', href: 'https://camp.example/current-standings.html' + (o.search || ''),
      replace: (u) => replaced.push(String(u)),
    },
    URL: MAIN_URL, URLSearchParams: MAIN_URL_PARAMS, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    performance: { now: () => clock.t },
    matchMedia: () => ({ matches: !!o.reducedMotion }),
    addEventListener() {},
    setTimeout: (fn, ms) => { const id = nextId++; sched.push({ id, at: clock.t + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = sched.findIndex((s) => s.id === id); if (i >= 0) sched.splice(i, 1); },
    setInterval: (fn, ms) => { const id = nextId++; sched.push({ id, at: clock.t + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { const i = sched.findIndex((s) => s.id === id); if (i >= 0) sched.splice(i, 1); },
    requestAnimationFrame() {},
    fetch: o.fetch || (() => new Promise(() => {})),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  if (sdk) { sandbox.firebase = sdk.firebase; sandbox.FIREBASE_CONFIG = { apiKey: 'k', databaseURL: 'https://db.example' }; }
  const ctx = tvVm.createContext(sandbox);
  TV_SCRIPTS.forEach((f) => {
    if (f === 'current-standings.js' && o.beforePage) tvVm.runInContext(o.beforePage, ctx);
    tvVm.runInContext(readFixture('../' + f), ctx, { filename: f });
  });

  const camp = tvVm.runInContext('CAMP.id', ctx);
  const root = tvVm.runInContext('CAMP.dbRoot', ctx);
  const api = {
    ctx, log, listeners, replaced, sdk, clock, camp, root, store,
    run: (code) => tvVm.runInContext(code, ctx),
    byId: byIdFn,
    ids: () => [...byId.keys()],
    // Move the fake clock forward, running every timer that comes due on the way, in order.
    advance(ms) {
      const target = clock.t + ms;
      for (;;) {
        sched.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = sched[0];
        if (!next || next.at > target) break;
        clock.t = Math.max(clock.t, next.at);
        if (next.every) next.at += next.every; else sched.shift();
        next.fn();
      }
      clock.t = target;
    },
    timersPending: () => sched.length,
    // The page's server clock: local time plus the offset the test delivered.
    offset: 0,
    serverNow() { return clock.t + api.offset; },
    // The standard bring-up: the socket is up, the server's clock answered, the feed said "nothing".
    online(offset, value) {
      api.offset = offset || 0;
      sdk.deliver('.info/serverTimeOffset', api.offset);
      sdk.deliver('.info/connected', true);
      sdk.deliver(root + '/revealPublic', value === undefined ? null : value);
    },
    feed(value) { sdk.deliver(root + '/revealPublic', value); },
    status: () => ({ tone: byIdFn('wait-status').getAttribute('data-tone'), text: byIdFn('wait-status-text').textContent }),
    waiting: () => !byIdFn('waiting').hidden && byIdFn('screen').hidden,
    stage: () => byIdFn('screen').hidden === false && byIdFn('waiting').hidden === true,
    practiceTag: () => !byIdFn('tv-practice').hidden,
    chip: () => !byIdFn('tv-reconnect').hidden,
    hero() {
      const wrap = byIdFn('hero-wrap');
      const h = wrap.children[0];
      if (!h) return null;
      const entries = h.children[1].children.map((en) => ({ mark: en.children[0], info: en.children[1].innerHTML }));
      return { el: h, has: (c) => h.has(c), place: h.children[0].innerHTML, entries, count: wrap.children.length };
    },
    // [{place, name, pts, med}] from the board's rows, top first.
    rows() {
      const out = [];
      const re = /<div class="rank">([^<]*)<\/div><div class="who"><span class="em">[^<]*<\/span><span class="nm">([^<]*)<\/span><\/div><div class="score"><span class="pts">(-?\d+)<small>pts<\/small><\/span><span class="med">([^<]*)<\/span>/g;
      let m;
      const html = byIdFn('board').innerHTML;
      while ((m = re.exec(html))) out.push({ place: m[1], name: m[2], pts: Number(m[3]), med: m[4] });
      return out;
    },
    board: () => byIdFn('board'),
    finale: () => byIdFn('finale').has('show'),
    cannonsShown: () => byIdFn('cannon-l').has('show'),
  };
  return api;
}

// Every tag and attribute the page writes must be one the page itself uses; a payload that turned into
// markup shows up here as an unexpected tag or an on*= / src= attribute.
function assertInertHtml(htmls) {
  const allowedTags = ['div', 'span', 'small'];
  htmls.forEach((h) => {
    const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)\/?>/g;
    let m;
    while ((m = re.exec(h))) {
      assert.ok(allowedTags.includes(m[1].toLowerCase()), `unexpected <${m[1]}> in ${h.slice(0, 160)}`);
      assert.ok(/^(\s+(class|style)="[^"<>]*")*\s*$/.test(m[2]), `unexpected attributes on <${m[1]}>: ${m[2]}`);
    }
  });
}

// ── Fixtures: a public node as a director's phone writes it ──────────
const NAMES6 = ['Ferocious Foxes', 'Turkey Dinner', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deersz'];
const NAMES4 = ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'];

function ent(id, nm, p, o) { return Object.assign({ nm, p, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 }, o || {}, { _id: id }); }
// grp(place, ent...) → the public group shape { place, e: { id: {nm,p,g,s,b,v,m,c} } }
function grp(place, ...ents) {
  const e = {};
  ents.forEach((x) => { const { _id, ...rest } = x; e[_id] = rest; });
  return { place, e };
}
// Six teams, one clean place each. Index = group index (lowest place first), as reveal.js writes them.
function six() {
  return [
    grp(6, ent('t5', NAMES6[5], 11, { g: 0, s: 1, b: 1, v: 1 })),
    grp(5, ent('t4', NAMES6[4], 16, { g: 1, s: 0, b: 2, v: 2, m: 1 })),
    grp(4, ent('t3', NAMES6[3], 22, { g: 1, s: 2, b: 1, v: 4, m: 3, c: 2 })),
    grp(3, ent('t2', NAMES6[2], 27, { g: 2, s: 1, b: 1 })),
    grp(2, ent('t1', NAMES6[1], 31, { g: 3, s: 0, b: 1, c: -3 })),
    grp(1, ent('t0', NAMES6[0], 40, { g: 4, s: 1, b: 0, v: 5, m: 5, c: 0 })),
  ];
}
function pubOf(groups, shown) {
  const pub = {};
  groups.slice(0, shown).forEach((g, i) => { pub['g' + i] = g; });
  return pub;
}
// A `real` or `practice` child. at / sa default to the page's server time now.
function nodeOf(tv, groups, o) {
  const now = tv.serverNow();
  const ctl = Object.assign({
    v: 1, id: 'rreal0001-ab12', seq: 1, phase: 'live', cur: 0, shown: 1, teams: groups.length, finale: false,
    at: now, sa: now, startedAt: now - 60000, until: now + 12 * 3600e3,
  }, o || {});
  return { ctl, pub: pubOf(groups, ctl.shown) };
}

// ── Camp selection ───────────────────────────────────────────────────

test('?camp= picks the camp, then the presenter\'s app choice, then junior', () => {
  assert.equal(loadTv({}).camp, 'junior', 'no hint at all');
  assert.equal(loadTv({ search: '?camp=senior' }).camp, 'senior');
  assert.equal(loadTv({ search: '?camp=SENIOR' }).camp, 'senior', 'case does not matter');
  assert.equal(loadTv({ search: '?camp=junior', storage: { campScoreboardActiveCamp: 'senior' } }).camp, 'junior', '?camp= beats the stored choice');
  assert.equal(loadTv({ search: '', storage: { campScoreboardActiveCamp: 'senior' } }).camp, 'senior', 'the same-origin app camp is the fallback');
  assert.equal(loadTv({ search: '?camp=bogus', storage: { campScoreboardActiveCamp: 'senior' } }).camp, 'senior', 'junk is ignored');
  assert.equal(loadTv({ search: '?camp=constructor' }).camp, 'junior', 'an inherited property name is not a camp');
  assert.equal(loadTv({ search: '?camp=' }).camp, 'junior');
  assert.equal(loadTv({ search: '?camp=senior' }).run('document.title'), 'Current Standings — Senior Camp', 'the tab names its camp');
  assert.equal(loadTv({}).run('document.title'), 'Current Standings — Junior Camp');
});

// ── What the page may touch: a public path, a clock, a connection ────

test('it reads exactly <root>/revealPublic and .info, for its own camp, and never writes', () => {
  for (const [camp, root] of [['junior', 'campScoreboard'], ['senior', 'seniorScoreboard']]) {
    const tv = loadTv({ search: '?camp=' + camp });
    assert.equal(tv.camp, camp);
    tv.online(0);
    tv.feed({ real: nodeOf(tv, six(), { cur: 0, shown: 1, seq: 2 }) });
    tv.advance(400000);
    assert.deepEqual([...new Set(tv.sdk.refs)].sort(), ['.info/connected', '.info/serverTimeOffset', root + '/revealPublic'].sort(),
      camp + ': the only paths the page ever asked for');
    assert.deepEqual(tv.sdk.listeners[root + '/revealPublic'].ev, 'value');
    assert.deepEqual(tv.sdk.illegal, [], camp + ': no write, no transaction, no onDisconnect, no auth — nothing but ref/on/off and the connection switch');
    assert.equal(tv.sdk.inits.length, 1, 'the app is initialised once, from firebase-config');
    assert.deepEqual(tv.log.writes, [], 'and nothing is written to device storage either');
  }
});

test('the page has no sign-in anywhere: no Auth SDK, no auth call, no members / state / config path, no write call', () => {
  const html = TV_HTML.replace(/<!--[\s\S]*?-->/g, '');
  const js = TV_JS.replace(/\/\/[^\n]*/g, '');
  assert.notOk(/firebase-auth/.test(html), 'the Auth SDK tag is gone');
  assert.notOk(/auth-overlay|auth-ov-|signInWith|GoogleAuthProvider/.test(html + js), 'no sign-in panel, no sign-in call');
  assert.notOk(/firebase\.auth|onAuthStateChanged|signOut/.test(js), 'the script never reaches for firebase.auth');
  const paths = [...js.matchAll(/dbPath\(\s*['"]([^'"]*)['"]/g)].map((m) => m[1]);
  assert.deepEqual(paths, ['revealPublic'], 'dbPath is asked for one thing');
  assert.deepEqual([...js.matchAll(/\.ref\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1].trim()).sort(),
    ["'.info/connected'", "'.info/serverTimeOffset'", "dbPath('revealPublic')"].sort(), 'and .ref() for three');
  assert.notOk(/\b(onDisconnect|transaction|runTransaction|setWithPriority|setPriority)\b/.test(js), 'no transaction or onDisconnect is even spelled');
  assert.notOk(/\.ref\([^;]*\)\s*\.(set|update|remove|push|once)\s*\(/.test(js.replace(/\n/g, ' ')), 'and nothing is chained onto a ref but on / off');
  assert.notOk(/'(members|state|config|setup|campers|teamPhotos|revealFull|chat)'/.test(js), 'no other node is named');
  // exactly two Firebase SDK tags, with the hashes they have always carried (10.12.0)
  const sdkTags = [...html.matchAll(/<script\s+src="(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+)"\s+integrity="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(sdkTags, [
    ['https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js', 'sha384-sEVIly94UBRLKWdkYoPpSG7GD/e79YHMrxVyZaOk712Ga7+EAw6w1EFi+xBzBdd+'],
    ['https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js', 'sha384-1/m+A1jVWbD3yiK3/vtFvm1+LjK1WLpSoDY+Kaxppwn/yP9BVSgdHTNQVOjrzUO5'],
  ], 'app + database, pinned');
});

test('every element the script looks up exists in the page, and no keyboard or click handler can advance anything', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  tv.feed({ real: nodeOf(tv, G, { phase: 'intro', cur: -1, shown: 0, seq: 1 }) });
  tv.feed({ real: nodeOf(tv, G, { cur: 5, shown: 6, finale: true, seq: 2 }) });
  tv.feed({ real: nodeOf(tv, G, { phase: 'champion', cur: 5, shown: 6, finale: true, seq: 3 }) });
  assert.ok(tv.ids().includes('intro-title') && tv.ids().includes('champ'), 'the lazily looked-up ids were exercised');
  tv.ids().forEach((id) => assert.ok(new RegExp('id="' + id + '"').test(TV_HTML), '#' + id + ' is in current-standings.html'));
  assert.equal(tv.listeners.keydown, undefined, 'no key handler');
  assert.equal(tv.listeners.click, undefined, 'no click handler on the document');
  assert.ok(Object.keys(tv.listeners).every((k) => k === 'visibilitychange'), 'the only document event is the page coming and going: ' + Object.keys(tv.listeners));
});

// ── Waiting ──────────────────────────────────────────────────────────

test('with no reveal it says Waiting for the directors…, shows the camp\'s marks in their fixed order, and says when it is ready', () => {
  assert.ok(/Waiting for the directors…/.test(TV_HTML), 'the headline is in the markup, so a page whose script fails still says it');
  assert.notOk(markupHidden('waiting'), 'and it is not hidden at load');
  for (const camp of ['junior', 'senior']) {
    const tv = loadTv({ search: '?camp=' + camp });
    assert.ok(tv.waiting(), 'Waiting from the first frame');
    assert.deepEqual(tv.status(), { tone: 'connecting', text: 'Connecting…' }, 'nothing has answered yet');
    assert.equal(tv.byId('wait-camp').textContent, (camp === 'senior' ? 'Senior Camp' : 'Junior Camp') + ' · Standings');
    tv.sdk.deliver('.info/connected', true);
    assert.equal(tv.status().tone, 'connecting', 'a socket alone is not "ready": the clock and the feed have not answered');
    tv.sdk.deliver('.info/serverTimeOffset', 0);
    tv.sdk.deliver(tv.root + '/revealPublic', null);
    assert.deepEqual(tv.status(), { tone: 'ok', text: 'Connected · this screen is ready' });
    assert.ok(tv.waiting());
    assert.equal(tv.byId('wait-feed').hidden, true, 'no feed problem to report');
    const marks = tv.byId('wait-shields').children;
    assert.equal(marks.length, camp === 'senior' ? 4 : 6, 'one mark per team');
    if (camp === 'senior') {
      assert.deepEqual(marks.map((m) => m.attrs['data-flag']), ['red', 'blue', 'green', 'gold'], 'senior: flags, in team order');
      assert.deepEqual(marks.map((m) => m.children[0].attrs.href), ['#flag-plain', '#flag-swallow', '#flag-stripe', '#flag-chevron'], 'a different shape per slot, so colour is not the only difference');
      marks.forEach((m) => assert.ok(/\btv-flag\b/.test(m.className) && /\bwait-crest\b/.test(m.className)));
    } else {
      marks.forEach((m, i) => {
        assert.equal(m.tagName, 'IMG', 'junior: shields');
        assert.ok(/^images\/team-shields\/[a-z0-9-]+\.(webp|png)(\?v=\d+)?$/.test(m.src), 'a shipped file: ' + m.src);
        assert.equal(m.src, CAMPS.junior.teamCrest['t' + i], 'in slot order, not standings order');
      });
    }
  }
});

test('a camp\'s marks come from files that ship with the page: a crest address that is not one of them becomes an emoji tile', () => {
  const tv = loadTv({ beforePage: "CAMP.teamCrest = Object.assign({}, CAMP.teamCrest, { t1: 'https://evil.example/x.png', t2: 'data:image/png;base64,AAA\" onerror=\"alert(1)' }); CAMP.teamEmoji = Object.assign({}, CAMP.teamEmoji, { t3: '<img src=x onerror=alert(1)>' });" });
  const marks = tv.byId('wait-shields').children;
  assert.equal(marks[1].tagName, 'DIV');
  assert.ok(/crest-tile/.test(marks[1].className) && marks[1].textContent.length > 0, 'an external address: a tile, never an <img>');
  assert.equal(marks[2].tagName, 'DIV', 'a quote-breakout data URL: a tile');
  assert.ok(!/[<>]/.test(marks[3].textContent), 'a markup emoji falls back to the mascot');
  tv.log.created.forEach((c) => { if (c.tagName === 'IMG') assert.ok(/^images\/team-shields\//.test(c.src), 'every <img> the page made points at a shipped shield'); });
});

test('nothing is painted from the node until the server\'s clock has answered, and the screen then uses the SERVER\'s time, not its own', () => {
  // a TV whose own clock is two days slow: 2 s into a place by the server's clock
  const tv = loadTv({ clock: T0 - 2 * 86400e3 });
  tv.sdk.deliver('.info/connected', true);
  const server = T0;
  const node = { real: { ctl: { v: 1, id: 'rreal0001-ab12', seq: 2, phase: 'live', cur: 0, shown: 1, teams: 6, finale: false, at: server - 2000, sa: server - 2000, startedAt: server - 60000, until: server + 12 * 3600e3 }, pub: pubOf(six(), 1) } };
  tv.sdk.deliver(tv.root + '/revealPublic', node);
  assert.ok(tv.waiting(), 'the feed has answered but the clock has not: fail closed, nothing shown');
  tv.sdk.deliver('.info/serverTimeOffset', 2 * 86400e3);
  assert.ok(tv.stage(), 'with the clock known the reveal appears');
  assert.ok(tv.hero().has('solo'), 'two seconds into the place by the server\'s clock: the name beat');
  tv.advance(1100);
  assert.ok(!tv.hero().has('solo'), 'and it moves on by the server\'s clock (three seconds)');
});

// ── The frames ───────────────────────────────────────────────────────

test('a full reveal: intro, each place through its beats, the board, the final table', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  // Start: the intro, with the camp's marks (never a standing)
  tv.feed({ real: nodeOf(tv, G, { phase: 'intro', cur: -1, shown: 0, seq: 1 }) });
  assert.ok(tv.stage() && !tv.practiceTag(), 'a real reveal is not tagged');
  assert.equal(tv.byId('intro-shields').children.length, 6);
  assert.equal(tv.byId('intro').style.display, '', 'the intro is up');
  assert.ok(/Get ready…/.test(TV_HTML) && !/Starting with/.test(TV_HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the intro names no place: a tie at the bottom would make it wrong');
  assert.equal(tv.hero(), null, 'no place yet');
  // 6th place: the name alone (3 s), then the place and score, then the breakdown (4.5 s)
  tv.feed({ real: nodeOf(tv, G, { phase: 'live', cur: 0, shown: 1, seq: 2 }) });
  let h = tv.hero();
  assert.ok(h.has('solo') && h.has('enter') && !h.has('beat2'), 'beat 1: the name alone, the place arriving');
  assert.ok(tv.byId('intro').has('hide'), 'the intro fades out');
  tv.advance(600);
  assert.equal(tv.byId('intro').style.display, 'none', 'and is gone');
  assert.ok(tv.board().has('dropped'), 'the board drops off the bottom while the spotlight is up');
  assert.ok(/6th/.test(h.place) && !/TIE/.test(h.place));
  assert.ok(/Runaway John Deersz/.test(h.entries[0].info) && /class="num">11</.test(h.entries[0].info));
  tv.advance(2500); // 3.1 s in
  h = tv.hero();
  assert.ok(!h.has('solo') && !h.has('beat2'), 'beat 2: the place and the score are up');
  tv.advance(1500); // 4.6 s
  assert.ok(tv.hero().has('beat2'), 'beat 3: the breakdown slides in');
  // 8 s after the command the place docks into the board
  tv.advance(3500); // 8.1 s
  assert.ok(tv.hero().has('dock') && !tv.board().has('dropped'), 'the spotlight shrinks into the board, which comes back up');
  tv.advance(500);
  assert.equal(tv.hero(), null, 'and the spotlight is gone');
  assert.deepEqual(tv.rows().map((r) => r.name), [NAMES6[5]], 'with the place it just docked');
  // the rest of the places, then the final table
  for (let i = 1; i < 6; i++) {
    tv.feed({ real: nodeOf(tv, G, { phase: 'live', cur: i, shown: i + 1, seq: 2 + i }) });
    assert.ok(tv.hero(), 'place ' + (6 - i));
    tv.advance(8200);
  }
  assert.deepEqual(tv.rows().map((r) => r.place + ' ' + r.name + ' ' + r.pts), [
    '1st Ferocious Foxes 40', '2nd Turkey Dinner 31', '3rd Methodic Mediocre Maples 27',
    '4th Particularly Perilous Pumpkins 22', '5th Patriotic Pilgrims 16', '6th Runaway John Deersz 11',
  ], 'the board reads best place first');
  tv.feed({ real: nodeOf(tv, G, { phase: 'table', cur: 5, shown: 6, seq: 9 }) });
  assert.ok(tv.board().has('final'), 'the final table fills the screen');
  assert.equal(tv.rows().length, 6);
  assert.equal(tv.finale(), false, 'no crowning on a day that is not a finale');
});

test('a place\'s breakdown is in words, never medal discs: "2 gold · 1 silver · 1 bronze", then "verse · cleanup · quick" when there is one', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  tv.feed({ real: nodeOf(tv, G, { cur: 2, shown: 3, seq: 5 }) }); // 4th place: has bonuses
  const info = tv.hero().entries[0].info;
  assert.ok(/<div class="words">1 gold · 2 silver · 1 bronze<\/div>/.test(info), info);
  assert.ok(/<div class="words">verse 4 · cleanup 3 · quick 2<\/div>/.test(info), info);
  assert.notOk(/[🥇🥈🥉]/u.test(info + tv.board().innerHTML), 'no medal disc anywhere');
  tv.feed({ real: nodeOf(tv, G, { cur: 3, shown: 4, seq: 6 }) }); // 3rd: no bonuses → only the medal line
  assert.equal((tv.hero().entries[0].info.match(/class="words"/g) || []).length, 1, 'no empty "verse 0 · cleanup 0 · quick 0" line');
  tv.feed({ real: nodeOf(tv, G, { cur: 4, shown: 5, seq: 7 }) }); // 2nd: a negative quick award
  assert.ok(/quick \u22123/.test(tv.hero().entries[0].info), 'a negative award reads as a minus');
});

test('a tie is one place with two teams side by side; a two-way tie fights in the name beat, a three-way tie does not', () => {
  const tv = loadTv({});
  tv.online(0);
  const tie2 = [grp(2, ent('t3', 'Pumpkins', 30, { g: 2, s: 1, b: 0 }), ent('t1', 'Turkeys', 30, { g: 1, s: 2, b: 0 })), grp(1, ent('t0', 'Foxes', 44))];
  tv.feed({ real: nodeOf(tv, tie2, { cur: 0, shown: 1, teams: 3, seq: 2 }) });
  let h = tv.hero();
  assert.ok(h.has('tied') && h.has('fight') && h.has('solo'), 'two-way tie: side by side, the shields fight');
  assert.ok(/TIE/.test(h.place) && /2nd/.test(h.place));
  assert.equal(h.entries.length, 2);
  assert.ok(/Pumpkins/.test(h.entries[0].info) && /Turkeys/.test(h.entries[1].info), 'inside the tie, reveal-core\'s order (golds first)');
  tv.advance(3100);
  assert.ok(!tv.hero().has('fight'), 'the fight is over when the name beat is');
  const tie3 = [grp(2, ent('t3', 'A', 30), ent('t2', 'B', 30), ent('t1', 'C', 30)), grp(1, ent('t0', 'Foxes', 44))];
  tv.feed({ real: nodeOf(tv, tie3, { cur: 0, shown: 1, teams: 4, seq: 3 }) });
  h = tv.hero();
  assert.ok(h.has('tied') && !h.has('fight'), 'three-way: no clean head-to-head geometry');
  assert.equal(h.entries.length, 3);
});

test('senior: four teams, flags for marks, the same frames', () => {
  const tv = loadTv({ search: '?camp=senior' });
  tv.online(0);
  const G4 = [
    grp(4, ent('t3', NAMES4[3], 9, { g: 0, s: 1, b: 0 })), grp(3, ent('t2', NAMES4[2], 15, { g: 1, s: 0, b: 1 })),
    grp(2, ent('t1', NAMES4[1], 20, { g: 1, s: 1, b: 1 })), grp(1, ent('t0', NAMES4[0], 33, { g: 3, s: 0, b: 0 })),
  ];
  tv.feed({ real: nodeOf(tv, G4, { phase: 'intro', cur: -1, shown: 0, teams: 4 }) });
  assert.equal(tv.byId('intro-shields').children.length, 4, 'four marks in the intro');
  tv.feed({ real: nodeOf(tv, G4, { cur: 0, shown: 1, teams: 4, seq: 2 }) });
  const mark = tv.hero().entries[0].mark;
  assert.equal(mark.attrs['data-flag'], 'gold', 't3 is the gold flag');
  assert.equal(mark.children[0].attrs.href, '#flag-chevron', 'in its own shape');
  assert.ok(/\bhero-shield\b/.test(mark.className) && /\btv-flag\b/.test(mark.className));
  tv.advance(8200);
  tv.feed({ real: nodeOf(tv, G4, { phase: 'table', cur: 3, shown: 4, teams: 4, seq: 9 }) });
  assert.deepEqual(tv.rows().map((r) => r.name), ['Red Team', 'Blue Team', 'Green Team', 'Gold Team']);
});

test('a finale: the champions are crowned (a full-screen celebration), then the final table; Back returns to first place', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  tv.feed({ real: nodeOf(tv, G, { phase: 'live', cur: 5, shown: 6, finale: true, seq: 8 }) });
  assert.ok(tv.hero() && !tv.finale());
  tv.advance(8500);
  tv.feed({ real: nodeOf(tv, G, { phase: 'champion', cur: 5, shown: 6, finale: true, seq: 9 }) });
  assert.ok(tv.finale(), 'the crowning');
  assert.ok(/Camp Champions/.test(tv.byId('champ').innerHTML) && /Ferocious Foxes/.test(tv.byId('champ').innerHTML) && /40 points/.test(tv.byId('champ').innerHTML));
  assert.equal(tv.board().style.display, 'none', 'the board is behind it');
  assert.ok(tv.cannonsShown(), 'confetti, because the crowning is inside its first three seconds');
  tv.feed({ real: nodeOf(tv, G, { phase: 'table', cur: 5, shown: 6, finale: true, seq: 10 }) });
  assert.ok(!tv.finale() && tv.board().has('final'), 'the final table replaces the crowning');
  tv.feed({ real: nodeOf(tv, G, { phase: 'live', cur: 5, shown: 6, finale: true, seq: 11 }) });
  assert.ok(tv.hero() && /1st/.test(tv.hero().place) && !tv.board().has('final'), 'Back: first place again');
  // the crowning of a tie: both champions named
  const tied = [grp(2, ent('t3', 'Low', 10)), grp(1, ent('t0', 'Foxes', 40), ent('t1', 'Turkeys', 40))];
  tv.feed({ real: nodeOf(tv, tied, { phase: 'champion', cur: 1, shown: 2, teams: 3, finale: true, seq: 12 }) });
  assert.ok(/Foxes &amp; Turkeys|Turkeys &amp; Foxes/.test(tv.byId('champ').innerHTML), 'co-champions');
});

test('Back replays a place (a new command, so the moment plays again); a replayed place is a new spotlight', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  tv.feed({ real: nodeOf(tv, G, { cur: 1, shown: 2, seq: 3 }) });
  const first = tv.hero().el;
  tv.advance(9000);
  tv.feed({ real: nodeOf(tv, G, { cur: 0, shown: 2, seq: 4 }) }); // Back: the TV steps back, the node keeps what was shown
  const again = tv.hero();
  assert.ok(again.el !== first, 'a new hero');
  assert.ok(/6th/.test(again.place) && again.has('enter') && again.has('solo'), 'the 6th-place moment plays again');
  assert.deepEqual(tv.rows(), [], 'and the board holds only what is below it');
  // the same snapshot arriving again changes nothing (an echo is not a replay)
  tv.feed({ real: nodeOf(tv, G, { cur: 0, shown: 2, seq: 4 }) });
  assert.equal(tv.hero().el, again.el, 'the same seq: the same spotlight');
});

// ── Late join: a static frame, no replay ─────────────────────────────

test('a screen that joins late shows the frame as it stands: no entry animation, no confetti, no popping rows', () => {
  const G = six();
  // 6 s into a place: the score is up and the breakdown is in
  let tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { cur: 1, shown: 2, seq: 3, at: tv.serverNow() - 6000, sa: tv.serverNow() - 6000 }) });
  let h = tv.hero();
  assert.ok(h && !h.has('enter') && !h.has('solo') && h.has('beat2'), 'the frame as it stands');
  assert.ok(!tv.cannonsShown(), 'no confetti for a place the room saw six seconds ago');
  assert.deepEqual(tv.rows().map((r) => r.name), [NAMES6[5]], 'the places below it are already docked');
  // the same place, but joined inside its first 3 s: the moment is still live
  tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { cur: 1, shown: 2, seq: 3, at: tv.serverNow() - 1000, sa: tv.serverNow() - 1000 }) });
  assert.ok(tv.hero().has('solo') && tv.cannonsShown(), 'inside the first 3 s a late joiner still gets the confetti');
  // joined at the board
  tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { cur: 2, shown: 3, seq: 5, at: tv.serverNow() - 20000, sa: tv.serverNow() - 20000 }) });
  assert.equal(tv.hero(), null);
  assert.equal(tv.rows().length, 3, 'three places on the board');
  assert.ok(tv.board().has('still') && !tv.board().has('dropped'), 'still: no rows popping in');
  assert.ok(!tv.cannonsShown());
  // joined at the crowning, ten minutes on: static, and no barrage
  tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { phase: 'champion', cur: 5, shown: 6, finale: true, seq: 9, at: tv.serverNow() - 600000, sa: tv.serverNow() - 600000 }) });
  assert.ok(tv.finale() && !tv.cannonsShown(), 'the crowning, without a replayed barrage');
  tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { phase: 'table', cur: 5, shown: 6, seq: 9 }) });
  assert.ok(tv.board().has('final') && tv.board().has('still'));
});

// ── Practice, and real beats practice ────────────────────────────────

test('a practice plays on the real big screen tagged "Practice"; a real reveal takes the screen over; a practice comes back when the real one is over', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  const practice = nodeOf(tv, G, { id: 'rprac0001-cd34', cur: 0, shown: 1, seq: 2 });
  tv.feed({ practice });
  assert.ok(tv.stage() && tv.practiceTag(), 'the practice shows, wearing its tag');
  assert.ok(/Runaway John Deersz/.test(tv.hero().entries[0].info));
  // a real Start (intro) while the practice plays: the screen switches to the real reveal at once
  const real = nodeOf(tv, G, { id: 'rreal0001-ab12', phase: 'intro', cur: -1, shown: 0, seq: 1 });
  tv.feed({ practice, real });
  assert.ok(tv.stage() && !tv.practiceTag(), 'real wins: no tag');
  assert.equal(tv.hero(), null, 'the real reveal is at its intro, not the practice\'s place');
  assert.equal(tv.byId('intro').style.display, '');
  // the real reveal ends (before 8 AM it stays in the node, ended): the practice is on screen again
  const ended = nodeOf(tv, G, { id: 'rreal0001-ab12', phase: 'ended', cur: 0, shown: 1, seq: 4, endedAt: tv.serverNow(), endKind: 'early' });
  tv.feed({ practice, real: ended });
  assert.ok(tv.practiceTag() && tv.hero(), 'the practice returns');
  // the practice is deleted at its End: Waiting
  tv.feed({ real: ended });
  assert.ok(tv.waiting() && !tv.practiceTag(), 'nothing live: Waiting, and the tag goes');
});

test('an ended, expired or idled-out reveal is Waiting; so is one from a newer schema; none of it needs a snapshot to say so', () => {
  const G = six();
  const tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, G, { phase: 'ended', cur: 2, shown: 3, endKind: 'early', endedAt: tv.serverNow() }) });
  assert.ok(tv.waiting(), 'ended early: the places stay on phones until 8 AM, but not on the big screen');
  tv.feed({ real: nodeOf(tv, G, { v: 2 }) });
  assert.ok(tv.waiting(), 'a schema this build cannot read is not guessed at');
  // a live reveal whose `until` passes while the screen is up: a quiet 08:00 brings no snapshot
  const t2 = loadTv({});
  t2.online(0);
  t2.feed({ real: nodeOf(t2, G, { phase: 'table', cur: 5, shown: 6, at: t2.serverNow(), until: t2.serverNow() + 600000 }) });
  assert.ok(t2.stage());
  t2.advance(600100);
  assert.ok(t2.waiting(), 'until passed: Waiting by the page\'s own timer');
  // champion / table left idle for 15 minutes counts as ended; intro / live for 60
  const t3 = loadTv({});
  t3.online(0);
  t3.feed({ real: nodeOf(t3, G, { phase: 'table', cur: 5, shown: 6 }) });
  t3.advance(14 * 60 * 1000);
  assert.ok(t3.stage(), 'fourteen minutes: still the table');
  t3.advance(2 * 60 * 1000);
  assert.ok(t3.waiting(), 'sixteen minutes: treated as ended');
  const t4 = loadTv({});
  t4.online(0);
  t4.feed({ real: nodeOf(t4, G, { phase: 'live', cur: 1, shown: 2 }) });
  t4.advance(59 * 60 * 1000);
  assert.ok(t4.stage());
  t4.advance(2 * 60 * 1000);
  assert.ok(t4.waiting(), 'an unended live reveal an hour old: over');
});

test('a hostile or malformed node paints nothing it should not: foreign shapes are dropped, names are plain text', () => {
  const G = six();
  const tv = loadTv({});
  tv.online(0);
  // a name with markup, control characters and a long tail
  const evil = [grp(6, ent('t5', '<img src=x onerror=alert(1)>\u0000 & "quoted"', 11, { g: 0, s: 1, b: 1 }))];
  tv.feed({ real: nodeOf(tv, evil, { cur: 0, shown: 1, teams: 6, seq: 2 }) });
  const info = tv.hero().entries[0].info;
  assert.ok(info.indexOf('<img') < 0 && /&lt;img src=x onerror=alert\(1\)&gt;/.test(info), 'escaped text: ' + info.slice(0, 200));
  const long = [grp(6, ent('t5', 'y'.repeat(60), 11))];
  tv.feed({ real: nodeOf(tv, long, { cur: 0, shown: 1, teams: 6, seq: 3 }) });
  assert.ok(/y{30}/.test(tv.hero().entries[0].info) && !/y{31}/.test(tv.hero().entries[0].info), 'cut to 30 characters on its way in');
  assertInertHtml(tv.log.html);
  tv.log.created.forEach((c) => assert.ok(['DIV', 'IMG', 'svg', 'use', 'SVG', 'USE'].includes(c.tagName), 'an element the page makes: ' + c.tagName));
  // a team id the camp does not have, a group beyond g5, a number out of range, a scalar where a node belongs
  const odd = { g0: { place: 6, e: { t9: { nm: 'Ghost', p: 1, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 } } }, g7: grp(1, ent('t0', 'Late', 5)), g1: grp(5, ent('t4', 'Big', 1e9)) };
  tv.feed({ real: { ctl: nodeOf(tv, G, { cur: 0, shown: 1, seq: 3 }).ctl, pub: odd } });
  assert.ok(tv.waiting(), 'nothing valid at cur: an empty board is not a frame, so the screen fails closed to Waiting');
  tv.feed({ real: 'rubbish', practice: 5 });
  assert.ok(tv.waiting());
  tv.feed({ real: { ctl: { v: 1, id: '../../etc', phase: 'live' }, pub: {} } });
  assert.ok(tv.waiting(), 'a ctl that is not exactly the schema');
  assert.ok(!tv.log.html.join('').includes('Ghost') && !tv.log.html.join('').includes('Late'));
});

// ── The connection ───────────────────────────────────────────────────

test('a refused feed says so, shows nothing, and attaches again by itself (the SDK never re-arms a cancelled read)', () => {
  const tv = loadTv({});
  tv.sdk.deliver('.info/serverTimeOffset', 0);
  tv.sdk.deliver('.info/connected', true);
  tv.sdk.refuse(tv.root + '/revealPublic');
  assert.ok(tv.waiting());
  assert.equal(tv.byId('wait-feed').hidden, false, '"Can\'t reach the standings feed"');
  assert.ok(tv.status().tone !== 'ok', 'and it does not claim to be ready');
  assert.equal(tv.sdk.attached(tv.root + '/revealPublic'), 1);
  tv.advance(31000);
  assert.equal(tv.sdk.attached(tv.root + '/revealPublic'), 2, 'a retry half a minute later');
  assert.deepEqual([...new Set(tv.sdk.refs)].sort(), ['.info/connected', '.info/serverTimeOffset', tv.root + '/revealPublic'].sort(), 'the same one path');
  tv.feed({ real: nodeOf(tv, six(), { cur: 0, shown: 1, seq: 2 }) });
  assert.ok(tv.stage() && tv.byId('wait-feed').hidden === true, 'the rules came back: the screen recovers');
  // a refusal mid-reveal fails closed (a stale frame must not stay up)
  tv.sdk.refuse(tv.root + '/revealPublic');
  assert.ok(tv.waiting(), 'refused mid-reveal: the frame goes');
});

test('no SDK at all (gstatic blocked): Waiting, a plain line, no throw; the update poll reloads only once the network answers, a few times at most', async () => {
  let ok = false;
  const tv = loadTv({
    sdk: null,
    fetch: () => (ok ? Promise.resolve({ ok: true, text: () => Promise.resolve('<meta name="tv-build" content="2026-test-build">') }) : Promise.reject(new Error('offline'))),
  });
  assert.ok(tv.waiting());
  assert.equal(tv.byId('wait-feed').hidden, false);
  assert.equal(tv.status().tone, 'offline');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tv.replaced.length, 0, 'offline: no reload');
  ok = true;
  tv.advance(91000);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tv.replaced.length, 1, 'the network is back: one reload, with a cache-buster');
  assert.ok(/[?&]r=\d+/.test(tv.replaced[0]));
});

test('a connection that drops mid-reveal shows a Reconnecting… chip over the frame, and the frame is current again on return', () => {
  const tv = loadTv({});
  tv.online(0);
  const G = six();
  tv.feed({ real: nodeOf(tv, G, { cur: 0, shown: 1, seq: 2 }) });
  assert.ok(!tv.chip(), 'connected: no chip');
  tv.sdk.deliver('.info/connected', false);
  assert.ok(tv.chip() && tv.stage(), 'dropped: the chip, the frame stays');
  tv.advance(9000);
  tv.sdk.deliver('.info/connected', true);
  tv.feed({ real: nodeOf(tv, G, { cur: 2, shown: 3, seq: 5 }) }); // what happened while it was away
  assert.ok(!tv.chip());
  assert.ok(/4th/.test(tv.hero().place), 'jumps to where the reveal is now');
  // and a TV that is waiting shows the same news in its status line, not as a chip
  const w = loadTv({});
  w.online(0);
  w.sdk.deliver('.info/connected', false);
  assert.ok(!w.chip());
  assert.deepEqual(w.status(), { tone: 'offline', text: 'Reconnecting…' });
  // a page that has never connected says Connecting… first, then (after ten seconds) Reconnecting…
  const n = loadTv({});
  assert.equal(n.status().text, 'Connecting…');
  n.sdk.deliver('.info/connected', false); // the SDK's first answer is "not yet"
  assert.equal(n.status().text, 'Connecting…', 'the first "false" is not an outage');
  n.advance(11000);
  assert.equal(n.status().text, 'Reconnecting…');
});

test('hidden for a minute it lets go of its connection (Spark\'s 100-connection cap); coming back takes it up again', () => {
  const tv = loadTv({});
  tv.online(0);
  const vis = (hidden) => { tv.run('document.hidden = ' + hidden); (tv.listeners.visibilitychange || []).forEach((fn) => fn()); };
  vis(true);
  tv.advance(59000);
  assert.equal(tv.sdk.offlines, 0, 'not yet: a TV that flickers keeps its connection');
  vis(false);
  tv.advance(120000);
  assert.equal(tv.sdk.offlines, 0, 'back inside the minute: the timer is cancelled, nothing happens');
  assert.equal(tv.sdk.onlines, 0);
  vis(true);
  tv.advance(61000);
  assert.equal(tv.sdk.offlines, 1, 'a minute hidden: goOffline');
  vis(true);
  tv.advance(120000);
  assert.equal(tv.sdk.offlines, 1, 'once');
  vis(false);
  assert.equal(tv.sdk.onlines, 1, 'shown again: goOnline, and nothing else (the listeners stay attached)');
  assert.deepEqual(tv.sdk.illegal, []);
});

test('the frame follows the page\'s own timer: nothing needs a snapshot to move a place from its name to the board', () => {
  const tv = loadTv({});
  tv.online(0);
  tv.feed({ real: nodeOf(tv, six(), { cur: 0, shown: 1, seq: 2 }) });
  const seen = [];
  const note = () => { const h = tv.hero(); seen.push(h ? (h.has('solo') ? 'name' : h.has('beat2') ? 'breakdown' : 'score') : 'board'); };
  note();
  for (let i = 0; i < 9; i++) { tv.advance(1000); note(); }
  assert.deepEqual(seen.filter((x, i) => x !== seen[i - 1]), ['name', 'score', 'breakdown', 'board'], seen.join(','));
});

// ── The page itself: CSP, no inline script, build stamp ──────────────

test('the page carries its own CSP: no inline script, and no sign-in host any more', () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(TV_HTML);
  assert.ok(csp, 'a CSP meta tag');
  const policy = csp[1].replace(/\s+/g, ' ');
  const dir = (name) => (new RegExp('(?:^|; |;)\\s*' + name + ' ([^;]+)').exec(policy) || [])[1] || '';
  assert.ok(/script-src 'self' /.test(policy), "script-src starts at 'self'");
  assert.notOk(/'unsafe-inline'|'unsafe-eval'/.test(dir('script-src')), 'no inline or eval script');
  assert.equal(dir('img-src').trim(), "'self' data:", 'images only from here or inline');
  assert.equal(dir('object-src').trim(), "'none'");
  assert.equal(dir('base-uri').trim(), "'self'");
  assert.equal(dir('form-action').trim(), "'none'");
  assert.ok(/default-src 'self'/.test(policy));
  assert.equal(dir('script-src').trim(), "'self' https://www.gstatic.com https://*.firebaseio.com", 'the pinned SDK host and the database\'s own long-polling host, nothing else');
  assert.equal(dir('connect-src').trim(), "'self' https://*.firebaseio.com wss://*.firebaseio.com", 'the database and nothing else (no googleapis token service: nothing signs in)');
  assert.equal(dir('frame-src').trim(), 'https://*.firebaseio.com');
  assert.notOk(/apis\.google\.com|accounts\.google\.com|www\.google\.com|firebaseapp\.com|googleapis\.com/.test(policy), 'no Google sign-in host');
  const scripts = [...TV_HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 5);
  scripts.forEach((m) => {
    assert.ok(/\bsrc="/.test(m[1]), 'every script is a file: ' + m[1]);
    assert.equal(m[2].trim(), '', 'and has no inline body');
  });
  assert.notOk(/\son[a-z]+\s*=\s*["']/i.test(TV_HTML.replace(/<!--[\s\S]*?-->/g, '')), 'no inline event handler attributes');
  assert.notOk(/javascript:/i.test(TV_HTML.replace(/<!--[\s\S]*?-->/g, '')), 'no javascript: URLs');
  scripts.forEach((m) => {
    const src = /\bsrc="([^"]+)"/.exec(m[1])[1];
    assert.ok(!/^https?:/.test(src) || /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\//.test(src), 'only same-origin files and the pinned Firebase SDK: ' + src);
    if (!/^https?:/.test(src)) assert.ok(/\?v=\d+$/.test(src), 'a cache-busted local file: ' + src);
  });
  assert.notOk(/id="loading"|auth-overlay/.test(TV_HTML.replace(/<!--[\s\S]*?-->/g, '')), 'no "Loading standings…" and no sign-in overlay in the markup');
});

test('the page loads its shared code in the order that works', () => {
  const order = [...TV_HTML.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map((m) => m[1]);
  const at = (f) => order.indexOf(f);
  assert.ok(at('defaults.js') >= 0 && at('defaults.js') < at('camps.js'), 'defaults.js (junior catalog) before camps.js');
  assert.ok(at('tv-camp.js') >= 0 && at('tv-camp.js') < at('camps.js'), 'tv-camp.js sets CAMP_FORCE before camps.js reads it');
  assert.ok(at('camps.js') < at('current-standings.js') && at('camp-core.js') < at('current-standings.js'));
  assert.ok(at('camp-core.js') < at('reveal-core.js') && at('reveal-core.js') < at('current-standings.js'), 'reveal-core needs camp-core\'s Eastern-time maths');
  assert.equal(order[order.length - 1], 'current-standings.js');
  assert.ok(at('firebase-config.js') >= 0 && at('firebase-config.js') < at('current-standings.js'));
  assert.equal([...TV_HTML.matchAll(/<script\b[^>]*\bsrc="https:\/\/www\.gstatic\.com\/firebasejs\//g)].length, 2, 'two SDK tags');
});

test('the build stamp is in two places: <meta name="tv-build"> and the exact `var TV_BUILD` text in an HTML comment', () => {
  const meta = TV_HTML.match(/<meta\s+name="tv-build"\s+content="([^"]+)">/g) || [];
  assert.equal(meta.length, 1, 'one meta tag');
  const stamp = /<meta\s+name="tv-build"\s+content="([^"]+)">/.exec(TV_HTML)[1];
  // The text a v184-or-earlier TV polls for: the page's own address, then this regex.
  const oldRe = /var TV_BUILD = '([^']+)'/g;
  const found = TV_HTML.match(oldRe) || [];
  assert.equal(found.length, 1, 'exactly one `var TV_BUILD = \'…\'` in the HTML');
  assert.equal(/var TV_BUILD = '([^']+)'/.exec(TV_HTML)[1], stamp, 'the same stamp as the meta tag');
  // ...and it has to be inside an HTML comment, not a script (which the CSP forbids).
  const comments = [...TV_HTML.matchAll(/<!--([\s\S]*?)-->/g)].filter((m) => /var TV_BUILD = '/.test(m[1]));
  assert.equal(comments.length, 1, 'inside one comment');
  assert.notOk(/--/.test(comments[0][1]), 'a comment body may not contain a double hyphen');
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(stamp), 'an ISO stamp');
  assert.notOk(/^\s*var TV_BUILD\b/m.test(TV_JS), 'the script does not declare its own copy');
});

test('a TV notices a newer build from the meta stamp, or from the old comment text, and reloads only while it is waiting', async () => {
  const page = (stamp, kind) => (kind === 'comment'
    ? `<html><head><!-- var TV_BUILD = '${stamp}' --></head></html>`
    : `<html><head><meta name="tv-build" content="${stamp}"></head></html>`);
  const reply = (html) => () => Promise.resolve({ ok: true, text: () => Promise.resolve(html) });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  const newer = loadTv({ build: 'B1', fetch: reply(page('B2', 'meta')) });
  await settle();
  assert.equal(newer.replaced.length, 1, 'while waiting it reloads itself');
  assert.ok(/[?&]r=\d+/.test(newer.replaced[0]), 'with a throwaway cache-buster');

  const oldFormat = loadTv({ build: 'B1', fetch: reply(page('B2', 'comment')) });
  await settle();
  assert.equal(oldFormat.replaced.length, 1, 'a page that only carries the comment text still counts');

  const same = loadTv({ build: 'B1', fetch: reply(page('B1', 'meta')) });
  await settle();
  assert.equal(same.replaced.length, 0, 'same build: nothing');

  const stamped = loadTv({ fetch: reply(page('B2', 'meta')), build: '' });
  await settle();
  assert.equal(stamped.replaced.length, 0, 'a page that cannot read its own stamp never guesses');
});

test('mid-reveal a newer build only shows the update chip (a reload would drop the frame), and the page reloads the moment the reveal is over', async () => {
  let calls = 0;
  const tv = loadTv({
    build: 'B1',
    // Not newer at load; newer when the poll fires after the reveal started.
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(calls++ === 0 ? '<meta name="tv-build" content="B1">' : '<meta name="tv-build" content="B2">') }),
  });
  await new Promise((r) => setTimeout(r, 0));
  tv.online(0);
  tv.feed({ real: nodeOf(tv, six(), { phase: 'table', cur: 5, shown: 6, seq: 9 }) });
  tv.advance(91000);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tv.replaced.length, 0, 'no reload');
  assert.equal(tv.byId('update-chip').hidden, false, 'the chip is offered instead');
  tv.feed(null); // the reveal is deleted (End of a practice, or 8 AM's cleanup)
  assert.equal(tv.replaced.length, 1, 'the reveal is over, so the update happens now');
});
