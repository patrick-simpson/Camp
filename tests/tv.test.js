// The TV page (current-standings.html + current-standings.js), for both camps.
//
// The page is not part of the app bundle, so it gets its own vm context per
// scenario: the same scripts in the same order as the page's <script> tags
// (defaults, camp-core, tv-camp, camps, current-standings), behind a small DOM
// that RECORDS what the page writes — every innerHTML / insertAdjacentHTML
// string and every element it creates — so a test can prove a hostile string
// came out inert rather than assume it. Timers never fire on their own and the
// confetti loop never starts; tests drive the reveal through the page's own
// keydown handler, exactly as a presenter would.

const tvVm = nodeRequire('vm');
const MAIN_URL = tvVm.runInThisContext('URL');
const MAIN_URL_PARAMS = tvVm.runInThisContext('URLSearchParams');

const TV_SCRIPTS = ['defaults.js', 'camp-core.js', 'reveal-core.js', 'tv-camp.js', 'camps.js', 'current-standings.js'];
const TV_HTML = readFixture('../current-standings.html');

function loadTv(o) {
  o = o || {};
  const log = { html: [], created: [] };
  const byId = new Map();
  const bySel = new Map();
  const listeners = {};
  const timers = [];
  // A director's device unless a test says otherwise: the cached-snapshot fallback
  // shows standings only on a device that was a director's (secrecy interim).
  const store = new Map(Object.entries(Object.assign({ campScoreboardAuthHint: 'editor' }, o.storage || {})));
  const replaced = [];

  function el(tag, track) {
    let inner = '';
    const cls = new Set();
    const e = {
      tagName: String(tag || 'div').toUpperCase(), className: '', children: [], style: {}, attrs: {}, hidden: false,
      textContent: '', width: 0, height: 0,
      get innerHTML() { return inner; },
      set innerHTML(v) { inner = String(v); log.html.push(inner); if (inner === '') e.children.length = 0; },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
        contains: (c) => cls.has(c) || String(e.className).split(/\s+/).includes(c), toggle: () => {},
      },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
      appendChild(c) { e.children.push(c); return c; },
      insertAdjacentHTML(pos, h) { log.html.push(String(h)); inner += String(h); },
      addEventListener() {}, removeEventListener() {}, remove() {},
      getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
      // Ids resolve document-wide (they are unique on the page); a class selector
      // looks through what the page itself appended; anything else is a memoized stub.
      querySelector(sel) {
        if (sel[0] === '#') return byIdFn(sel.slice(1));
        if (sel[0] === '.') {
          const find = (n) => {
            for (const c of n.children) {
              if (String(c.className).split(/\s+/).includes(sel.slice(1))) return c;
              const d = find(c);
              if (d) return d;
            }
            return null;
          };
          return find(e);
        }
        return el('div');
      },
      querySelectorAll: () => [],
      offsetWidth: 0,
    };
    if (track) log.created.push(e);
    return e;
  }
  function byIdFn(id) {
    if (!byId.has(id)) byId.set(id, el('div'));
    return byId.get(id);
  }
  byIdFn('auth-overlay').style.display = 'none'; // the page's own inline style hides it
  byIdFn('update-chip').hidden = true;
  byIdFn('waiting').hidden = true;  // the page's own `hidden` attributes
  byIdFn('screen').hidden = true;

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
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
  };
  const sandbox = {
    console, document,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: {
      search: o.search || '', href: 'https://camp.example/current-standings.html' + (o.search || ''),
      replace: (u) => replaced.push(String(u)),
    },
    URL: MAIN_URL, URLSearchParams: MAIN_URL_PARAMS, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    // Nothing fires by itself: the 3s/8s reveal timers, the 90s update poll and the
    // confetti loop all wait for the test.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame() {},
    fetch: o.fetch || (() => new Promise(() => {})),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  if (o.firebase) { sandbox.firebase = o.firebase; sandbox.FIREBASE_CONFIG = { apiKey: 'k', databaseURL: 'https://db.example' }; }
  const ctx = tvVm.createContext(sandbox);
  // `beforePage`: code run after camps.js and before the page script, i.e. a camp
  // profile as some future build or data source would hand it over.
  TV_SCRIPTS.forEach((f) => {
    if (f === 'current-standings.js' && o.beforePage) tvVm.runInContext(o.beforePage, ctx);
    tvVm.runInContext(readFixture('../' + f), ctx, { filename: f });
  });

  const press = (key) => (listeners.keydown || []).forEach((fn) => fn({ key, preventDefault() {} }));
  const api = {
    ctx, log, listeners, timers, replaced, press,
    camp: () => tvVm.runInContext('CAMP.id', ctx),
    run: (code) => tvVm.runInContext(code, ctx),
    byId: byIdFn,
    next: () => press('ArrowRight'),
    // Press → until the reveal has finished (champion screen or the final table).
    finishReveal: () => { for (let i = 0; i < 40; i++) press('ArrowRight'); },
    board: () => byIdFn('board').innerHTML,
    // [{name, pts}] from the board's rows, top place first.
    rows: () => {
      const out = [];
      const re = /<span class="nm">([^<]*)<\/span>[\s\S]*?<span class="pts">(-?\d+)<small>/g;
      let m;
      const html = byIdFn('board').innerHTML;
      while ((m = re.exec(html))) out.push({ name: m[1], pts: Number(m[2]) });
      return out;
    },
    introCrests: () => byIdFn('intro-shields').children,
  };
  return api;
}

// Every tag and attribute the page writes must be one the page itself uses; a
// payload that turned into markup shows up here as an unexpected tag or an on*= /
// src= attribute.
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

function stateWith(teams, extra) {
  return Object.assign({ teams, results: {}, bonuses: {} }, extra || {});
}
const T6 = ['Ferocious Foxes', 'Turkey Dinner', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deersz']
  .map((name, i) => ({ id: 't' + i, name }));
const T4 = ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'].map((name, i) => ({ id: 't' + i, name }));

// ── Camp selection ───────────────────────────────────────────────────

test('?camp= picks the camp, then the presenter\'s app choice, then junior', () => {
  assert.equal(loadTv({ search: '?demo' }).camp(), 'junior', 'no hint at all');
  assert.equal(loadTv({ search: '?camp=senior' }).camp(), 'senior');
  assert.equal(loadTv({ search: '?demo&camp=SENIOR' }).camp(), 'senior', 'case does not matter');
  assert.equal(loadTv({ search: '?camp=junior', storage: { campScoreboardActiveCamp: 'senior' } }).camp(), 'junior', '?camp= beats the stored choice');
  assert.equal(loadTv({ search: '', storage: { campScoreboardActiveCamp: 'senior' } }).camp(), 'senior', 'the same-origin app camp is the fallback');
  assert.equal(loadTv({ search: '?camp=bogus', storage: { campScoreboardActiveCamp: 'senior' } }).camp(), 'senior', 'junk is ignored');
  assert.equal(loadTv({ search: '?camp=constructor' }).camp(), 'junior', 'an inherited property name is not a camp');
  assert.equal(loadTv({ search: '?camp=' }).camp(), 'junior');
  assert.equal(loadTv({ search: '?camp=senior' }).run('document.title'), 'Current Standings — Senior Camp', 'the tab names its camp');
  assert.equal(loadTv({ search: '?demo' }).run('document.title'), 'Current Standings — Junior Camp');
});

test('each camp reads only its own database root and members list', () => {
  for (const [camp, root] of [['junior', 'campScoreboard'], ['senior', 'seniorScoreboard']]) {
    const rec = freshRec();
    const tv = loadTv({ search: '?camp=' + camp, firebase: tvFirebase(rec) });
    assert.equal(tv.camp(), camp);
    const me = memberPath(root, 'Pat.Simpson@Gmail.com');
    rec.auth({ email: 'Pat.Simpson@Gmail.com' });
    assert.deepEqual(rec.on, [me], camp + ': the approval read is this camp\'s list, dots as commas, and the only read before approval');
    deliver(rec, me, { role: 'editor' });
    assert.deepEqual(rec.on.slice().sort(), [me, root + '/config', root + '/state'].sort(), camp + ': an editor adds only its own config and state');
    // A remote snapshot renders (the intro comes up with the camp's own teams).
    deliver(rec, root + '/state', stateWith(camp === 'senior' ? T4 : T6));
    assert.equal(tv.introCrests().length, camp === 'senior' ? 4 : 6);
  }
});

test('the local cache fallback reads this camp\'s namespaced key', () => {
  const junior = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6)) } });
  assert.equal(junior.introCrests().length, 6, 'junior: the bare key');
  const senior = loadTv({ search: '?camp=senior', storage: { 'campScoreboardV2:senior': JSON.stringify(stateWith(T4)), campScoreboardV2: JSON.stringify(stateWith(T6)) } });
  assert.equal(senior.introCrests().length, 4, 'senior: the ":senior" key, never junior\'s cache');
});

// ── N teams, null-safe crests ────────────────────────────────────────

test('the intro shows one crest per real team: six shields for junior, four emoji tiles for senior', () => {
  const j = loadTv({ search: '?demo' });
  assert.equal(j.introCrests().length, 6);
  assert.ok(j.introCrests().every((n) => n.tagName === 'IMG' && /^images\/team-shields\/[a-z-]+\.webp\?v=5$/.test(n.src)), 'junior crests are the shipped shields');
  assert.deepEqual(j.introCrests().map((n) => n.className), Array(6).fill('intro-crest'));
  const s = loadTv({ search: '?demo&camp=senior' });
  assert.equal(s.introCrests().length, 4);
  assert.ok(s.introCrests().every((n) => n.tagName === 'DIV' && /\bcrest-tile\b/.test(n.className)), 'no flag artwork yet: emoji tiles');
  assert.deepEqual(s.introCrests().map((n) => n.textContent), ['🔴', '🔵', '🟢', '🟡']);
  assert.ok(s.log.created.every((n) => n.tagName !== 'IMG'), 'senior never builds an <img> at all');
});

test('a full reveal for four teams counts down from 4th and ends on a four-row table (no "undefined" anywhere)', () => {
  const tv = loadTv({ search: '?demo&camp=senior' });
  tv.next(); // intro -> the first reveal
  assert.ok(/4th/i.test(tv.byId('hero-wrap').children[0].children[0].innerHTML), 'the first place shown is 4th of 4');
  tv.finishReveal();
  assert.equal(tv.rows().length, 4, 'the final table has the four teams');
  assert.deepEqual(tv.rows().map((r) => r.name), ['Red Team', 'Blue Team', 'Green Team', 'Gold Team']);
  const all = tv.log.html.join('\n') + tv.log.created.map((n) => n.src || '').join('\n');
  assert.notOk(/undefined|null|NaN/.test(all), 'nothing the page wrote reads undefined/null/NaN');
  assertInertHtml(tv.log.html);
});

test('the junior demo still plays a six-team reveal in its original order', () => {
  const tv = loadTv({ search: '?demo' });
  tv.next();
  assert.ok(/6th/i.test(tv.byId('hero-wrap').children[0].children[0].innerHTML));
  tv.finishReveal();
  assert.deepEqual(tv.rows().map((r) => [r.name, r.pts]), [
    ['Ferocious Foxes', 24], ['Patriotic Pilgrims', 15], ['Turkey Dinner', 15],
    ['Methodic Mediocre Maples', 13], ['Particularly Perilous Pumpkins', 10], ['Runaway John Deersz', 5],
  ], 'the demo standings are unchanged');
});

test('a team with no crest gets an emoji tile, never an <img> with no usable source', () => {
  const tv = loadTv({
    storage: { campScoreboardV2: JSON.stringify(stateWith(T6)) },
    beforePage: "delete CAMP.teamCrest.t3; CAMP.teamCrest.t4 = undefined; CAMP.teamCrest.t5 = '';",
  });
  const nodes = tv.introCrests();
  assert.equal(nodes.length, 6);
  assert.deepEqual(nodes.map((n) => n.tagName), ['IMG', 'IMG', 'IMG', 'DIV', 'DIV', 'DIV']);
  assert.equal(nodes[3].textContent, '🎃', 'the tile carries the team\'s own emoji');
  assert.ok(nodes.every((n) => n.tagName !== 'IMG' || (n.src && n.src !== 'undefined')), 'every <img> has a real source');
  tv.next(); tv.finishReveal();
  assert.notOk(/undefined/.test(tv.log.html.join('\n') + tv.log.created.map((n) => n.src || '').join('')), 'no screen wrote "undefined"');
});

// ── Hostile database strings render inert ────────────────────────────

test('a markup emoji in a team record falls back to the team\'s own mascot and never becomes a tag', () => {
  const teams = T6.map((t) => Object.assign({}, t));
  teams[0].emoji = '<img src=x onerror=alert(1)>';
  teams[1].emoji = '"><script>alert(1)</script>';
  teams[2].emoji = '🍂'; // a legitimate custom emoji still comes through
  const tv = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(teams)) } });
  tv.next(); tv.finishReveal();
  assertInertHtml(tv.log.html);
  const all = tv.log.html.join('\n');
  assert.notOk(/onerror|<script|<img/i.test(all), 'no payload text in any markup the page wrote');
  assert.ok(all.indexOf('🦊') >= 0 && all.indexOf('🦃') >= 0, 'the defaults stand in');
  assert.ok(all.indexOf('🍂') >= 0, 'a good custom emoji is kept');
  assert.ok(tv.log.created.every((n) => !('onerror' in n.attrs) && n.tagName !== 'SCRIPT'), 'no element carries an event attribute');
});

test('a hostile team name is escaped text', () => {
  const teams = T6.map((t) => Object.assign({}, t));
  teams[3].name = '<img src=x onerror=alert(1)>';
  teams[4].name = '"><svg onload=alert(1)>';
  const tv = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(teams)) } });
  tv.next(); tv.finishReveal();
  assertInertHtml(tv.log.html);
  const all = tv.log.html.join('\n');
  assert.ok(all.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, 'shown as visible text');
  assert.notOk(/<svg|<img/i.test(all));
});

test('a quote-breakout or external crest address is refused: tile, not <img>', () => {
  const tv = loadTv({
    storage: { campScoreboardV2: JSON.stringify(stateWith(T6)) },
    beforePage: `CAMP.teamCrest.t0 = 'data:image/png;base64,AAAA" onerror="alert(1)';
                 CAMP.teamCrest.t1 = 'javascript:alert(1)';
                 CAMP.teamCrest.t2 = 'https://evil.example/pixel.png';
                 CAMP.teamCrest.t3 = "data:image/png;base64,AAAA' onerror='alert(1)";
                 CAMP.teamCrest.t4 = '//evil.example/x.png';
                 CAMP.teamCrest.t5 = 'images/team-shields/../../app.js';`,
  });
  assert.deepEqual(tv.introCrests().map((n) => n.tagName), Array(6).fill('DIV'), 'every refused address became a tile');
  tv.next(); tv.finishReveal();
  assert.ok(tv.log.created.every((n) => n.tagName !== 'IMG'), 'no <img> anywhere, on any screen');
  assert.notOk(/onerror|evil|javascript:/.test(tv.log.html.join('\n')), 'and none of it in markup either');
  // The good case, for contrast: a whole inline PNG goes through img.src.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const ok = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6)) }, beforePage: `CAMP.teamCrest.t0 = ${JSON.stringify(png)}` });
  assert.equal(ok.introCrests()[0].tagName, 'IMG');
  assert.equal(ok.introCrests()[0].src, png);
});

test('the champion screen builds its crests the same safe way (a tile per team, hostile text inert)', () => {
  const teams = T4.map((t) => Object.assign({}, t));
  teams[0].emoji = '<img src=x onerror=alert(1)>';
  teams[0].name = '<b onmouseover=alert(1)>Reds</b>';
  const results = { a: { medals: { gold: 't0', silver: 't1', bronze: 't2' } } };
  const tv = loadTv({ search: '?finale&camp=senior', storage: { 'campScoreboardV2:senior': JSON.stringify(stateWith(teams, { results })) } });
  // Stop AT the champion screen: one more press would move on to the final table.
  for (let i = 0; i < 12 && !tv.byId('finale').classList.contains('show'); i++) tv.next();
  assert.ok(tv.byId('finale').classList.contains('show'), 'the finale is up');
  const champ = tv.byId('champ');
  const crests = champ.children.find((n) => n.className === 'champ-shields');
  assert.ok(crests, 'a crest row');
  assert.deepEqual(crests.children.map((n) => n.className), ['champ-crest crest-tile'], 'one tile for the one champion');
  assert.equal(crests.children[0].textContent, '🔴', 'the hostile emoji fell back to the slot\'s own');
  assertInertHtml(tv.log.html);
  assert.ok(champ.innerHTML.indexOf('&lt;b onmouseover=alert(1)&gt;Reds&lt;/b&gt;') >= 0, 'the champion\'s name is escaped text');
});

// ── Standings the TV shows ───────────────────────────────────────────

test('results for a game that is no longer in the week are not counted once the config is known; before that everything counts', () => {
  const games = [{ id: 'g1', name: 'One', messtival: true }, { id: 'g2', name: 'Two' }];
  const results = {
    g1: { medals: { gold: 't0', silver: 't1', bronze: 't2' } },
    gone: { medals: { gold: 't1', silver: 't2', bronze: 't0' } },
  };
  const withConfig = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6, { results, config: { games } })) } });
  withConfig.next(); withConfig.finishReveal();
  const pts = (tv) => Object.fromEntries(tv.rows().map((r) => [r.name, r.pts]));
  assert.equal(pts(withConfig)['Ferocious Foxes'], 14, 'g1 is a messtival game: gold 7 x 2; the orphan\'s bronze is ignored');
  assert.equal(pts(withConfig)['Turkey Dinner'], 10, 'silver 5 x 2 and not the orphan\'s gold');
  const noConfig = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6, { results })) } });
  noConfig.next(); noConfig.finishReveal();
  assert.equal(pts(noConfig)['Turkey Dinner'], 7 * 1 + 5 * 1, 'no config yet: nothing to judge by, every result counts (and the built-in catalog does not double the made-up ids)');
});

test('verse and custom bonuses double inside the legacy window, meal cleanup never does', () => {
  const inside = '2026-07-24T15:00:00Z';
  const bonuses = {
    a: { teamId: 't0', points: 5, category: 'verse', at: inside },
    b: { teamId: 't0', points: 4, category: 'custom', at: inside },
    c: { teamId: 't0', points: 3, category: 'cleanup', at: inside },
    d: { teamId: 't0', points: 2, category: 'verse', at: '2026-07-22T15:00:00Z' },
  };
  const tv = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6, { bonuses })) } });
  tv.next(); tv.finishReveal();
  assert.equal(tv.rows().find((r) => r.name === 'Ferocious Foxes').pts, 10 + 8 + 3 + 2);
});

test('until the live config arrives the camp\'s built-in catalog decides which games double', () => {
  const results = {
    'bushel-bustle': { medals: { gold: 't0', silver: 't1', bronze: 't2' } },  // a junior messtival game
    shields: { medals: { gold: 't3', silver: 't4', bronze: 't5' } },          // an ordinary one
  };
  const jr = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(T6, { results })) } });
  jr.next(); jr.finishReveal();
  const pts = Object.fromEntries(jr.rows().map((r) => [r.name, r.pts]));
  assert.equal(pts['Ferocious Foxes'], 14, 'bushel-bustle gold is doubled');
  assert.equal(pts['Particularly Perilous Pumpkins'], 7, 'shields gold is not');
  const sr = loadTv({ search: '?camp=senior', storage: { 'campScoreboardV2:senior': JSON.stringify(stateWith(T4, { results })) } });
  sr.next(); sr.finishReveal();
  assert.equal(Object.fromEntries(sr.rows().map((r) => [r.name, r.pts]))['Red Team'], 7, 'senior has no messtival games');
});

// ── The page itself: CSP, no inline script, build stamp ──────────────

test('the page carries its own CSP and no inline script or handler', () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(TV_HTML);
  assert.ok(csp, 'a CSP meta tag');
  const policy = csp[1].replace(/\s+/g, ' ');
  const dir = (name) => (new RegExp('(?:^|; |;)\\s*' + name + ' ([^;]+)').exec(policy) || [])[1] || '';
  assert.ok(/script-src 'self' /.test(policy), "script-src starts at 'self'");
  assert.notOk(/'unsafe-inline'|'unsafe-eval'/.test(dir('script-src')), 'no inline or eval script');
  assert.equal(dir('img-src').trim(), "'self' data:", 'images only from here or inline');
  assert.equal(dir('object-src').trim(), "'none'");
  assert.equal(dir('base-uri').trim(), "'self'");
  assert.ok(/default-src 'self'/.test(policy));
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
});

test('the page loads its shared code in the order that works', () => {
  const order = [...TV_HTML.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map((m) => m[1]);
  const at = (f) => order.indexOf(f);
  assert.ok(at('defaults.js') >= 0 && at('defaults.js') < at('camps.js'), 'defaults.js (junior catalog) before camps.js');
  assert.ok(at('tv-camp.js') >= 0 && at('tv-camp.js') < at('camps.js'), 'tv-camp.js sets CAMP_FORCE before camps.js reads it');
  assert.ok(at('camps.js') < at('current-standings.js') && at('camp-core.js') < at('current-standings.js'));
  assert.equal(order[order.length - 1], 'current-standings.js');
  assert.ok(at('firebase-config.js') >= 0 && at('firebase-config.js') < at('current-standings.js'));
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
  assert.notOk(/^\s*var TV_BUILD\b/m.test(readFixture('../current-standings.js')), 'the script does not declare its own copy');
});

test('a TV notices a newer build from the meta stamp, or from the old comment text, and only reloads on its intro', async () => {
  const page = (stamp, kind) => (kind === 'comment'
    ? `<html><head><!-- var TV_BUILD = '${stamp}' --></head></html>`
    : `<html><head><meta name="tv-build" content="${stamp}"></head></html>`);
  const reply = (html) => () => Promise.resolve({ ok: true, text: () => Promise.resolve(html) });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  const newer = loadTv({ search: '?demo', build: 'B1', fetch: reply(page('B2', 'meta')) });
  await settle();
  assert.equal(newer.replaced.length, 1, 'on the intro screen it reloads itself');
  assert.ok(/[?&]r=\d+/.test(newer.replaced[0]), 'with a throwaway cache-buster');

  const oldFormat = loadTv({ search: '?demo', build: 'B1', fetch: reply(page('B2', 'comment')) });
  await settle();
  assert.equal(oldFormat.replaced.length, 1, 'a page that only carries the comment text still counts');

  const same = loadTv({ search: '?demo', build: 'B1', fetch: reply(page('B1', 'meta')) });
  await settle();
  assert.equal(same.replaced.length, 0, 'same build: nothing');

  const stamped = loadTv({ search: '?demo', fetch: reply(page('B2', 'meta')), build: '' });
  await settle();
  assert.equal(stamped.replaced.length, 0, 'a page that cannot read its own stamp never guesses');
});

test('mid-reveal, a newer build only shows the update chip (reloading would wipe the presenter\'s place)', async () => {
  const html = '<html><head><meta name="tv-build" content="B2"></head></html>';
  let calls = 0;
  const tv = loadTv({
    search: '?demo', build: 'B1',
    // Not newer at load; newer when the 90 s poll fires after the reveal started.
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(calls++ === 0 ? '<meta name="tv-build" content="B1">' : html) }),
  });
  await new Promise((r) => setTimeout(r, 0));
  tv.next(); // intro -> reveal
  tv.listeners.visibilitychange.forEach((fn) => fn()); // the TV coming back into view re-checks
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tv.replaced.length, 0, 'no reload');
  assert.equal(tv.byId('update-chip').hidden, false, 'the chip is offered instead');
});

// ── Secrecy: live standings are for directors only (until the public page, Step 23) ──

// A fake Firebase for the page's sign-in. The approval read is a LIVE listener, so
// each test delivers the values itself (deliver / refuse) and can script any order.
function tvFirebase(rec) {
  const fb = {
    apps: [], initializeApp() { fb.apps.push({}); },
    auth: Object.assign(() => ({ onAuthStateChanged(cb) { rec.auth = cb; }, signInWithPopup: () => Promise.resolve(), signOut: () => Promise.resolve() }), { GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
    database: () => ({ ref: (path) => ({
      on(ev, cb, failed) { rec.on.push(path); rec.cb[path] = cb; rec.failed[path] = failed; },
    }) }),
  };
  return fb;
}
function freshRec() { return { on: [], cb: {}, failed: {}, auth: null }; }
// The page's own key for an account: lowercased, ALL dots as commas (app.js emailKey).
function memberPath(root, email) { return root + '/members/' + email.trim().toLowerCase().replaceAll('.', ','); }
function deliver(rec, path, val) { rec.cb[path]({ val: () => (val === undefined ? null : val) }); }
function refuse(rec, path) { rec.failed[path](new Error('permission_denied')); }
// A key press and a tap, as the page sees them.
function tapAll(tv) {
  tv.press('ArrowRight');
  (tv.listeners.click || []).forEach((fn) => fn({ target: { closest: () => null } }));
}
// A reveal builds elements; a page that is not showing standings builds none.
const createdCount = (tv) => tv.log.created.length;

test('a counselor\'s account gets "Waiting for the directors…" and the page never reads state', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'counselor@example.com');
  rec.auth({ email: 'counselor@example.com' });
  deliver(rec, me, { role: 'viewer' });
  assert.equal(tv.byId('waiting').hidden, false, 'the waiting screen is up');
  assert.equal(tv.byId('loading').style.display, 'none');
  assert.deepEqual(rec.on, [me], 'only the approval read is attached: no state or config listener');
  const before = createdCount(tv);
  tapAll(tv);
  assert.equal(createdCount(tv), before, 'a key or a tap builds no reveal');
  assert.deepEqual(tv.introCrests(), [], 'no intro');
  assert.ok(/Waiting for the directors…/.test(TV_HTML), 'the page ships the waiting words');
});

test('a director\'s account gets the live standings', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'director@example.com');
  rec.auth({ email: 'director@example.com' });
  deliver(rec, me, { role: 'editor' });
  assert.deepEqual(rec.on.slice().sort(), [me, 'campScoreboard/config', 'campScoreboard/state'].sort());
  assert.equal(tv.byId('waiting').hidden, true, 'nothing to wait for');
  deliver(rec, 'campScoreboard/state', stateWith(T6));
  assert.equal(tv.introCrests().length, 6);
});

test('a counselor promoted while the page is open gets the standings without a reload', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'pat@example.com');
  rec.auth({ email: 'pat@example.com' });
  deliver(rec, me, { role: 'viewer' });
  assert.equal(tv.byId('waiting').hidden, false);
  deliver(rec, me, { role: 'editor' });
  assert.equal(tv.byId('waiting').hidden, true, 'the waiting screen gives way');
  assert.ok(rec.on.includes('campScoreboard/state'), 'the state listener is attached now');
  assert.equal(tv.replaced.length, 0, 'no reload needed');
  deliver(rec, 'campScoreboard/state', stateWith(T6));
  assert.equal(tv.introCrests().length, 6);
});

test('a director demoted while the page is open reloads into Waiting, and nothing stays on screen', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'director@example.com');
  rec.auth({ email: 'director@example.com' });
  deliver(rec, me, { role: 'editor' });
  deliver(rec, 'campScoreboard/state', stateWith(T6));
  tv.next(); // intro -> the first reveal
  assert.ok(createdCount(tv) > 0, 'the reveal is up');
  deliver(rec, me, { role: 'viewer' });
  assert.equal(tv.replaced.length, 1, 'the page reloads itself');
  const before = createdCount(tv);
  deliver(rec, 'campScoreboard/state', stateWith(T6)); // a late snapshot paints nothing
  tapAll(tv);
  assert.equal(createdCount(tv), before, 'and no key or tap builds anything');
});

test('a second account on the same page reloads it, and the first account\'s listeners do not survive', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  rec.auth({ email: 'director@example.com' });
  deliver(rec, memberPath('campScoreboard', 'director@example.com'), { role: 'editor' });
  deliver(rec, 'campScoreboard/state', stateWith(T6));
  const attached = rec.on.length;
  rec.auth({ email: 'counselor@example.com' });
  assert.equal(tv.replaced.length, 1, 'a different account on the page reloads it');
  assert.equal(rec.on.length, attached, 'and attaches nothing');
  const before = createdCount(tv);
  tapAll(tv);
  assert.equal(createdCount(tv), before, 'the old reveal takes no more keys');

  // Signing out is the same reload, into the sign-in panel.
  const rec2 = freshRec();
  const tv2 = loadTv({ firebase: tvFirebase(rec2) });
  rec2.auth({ email: 'director@example.com' });
  deliver(rec2, memberPath('campScoreboard', 'director@example.com'), { role: 'editor' });
  deliver(rec2, 'campScoreboard/state', stateWith(T6));
  rec2.auth(null);
  assert.equal(tv2.replaced.length, 1, 'signing out reloads the page into the sign-in panel');
});

test('an approval read still in flight for the account the page has left attaches nothing', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'director@example.com');
  rec.auth({ email: 'director@example.com' }); // the read is in flight
  rec.auth(null);                              // signed out before it answers
  assert.equal(tv.replaced.length, 1);
  deliver(rec, me, { role: 'editor' });
  assert.deepEqual(rec.on, [me], 'no state or config listener for the stale editor');
  assert.equal(tv.byId('waiting').hidden, true);
});

test('a refused approval read gets the denied panel, and a refusal mid-session reloads the page', () => {
  const rec = freshRec();
  const tv = loadTv({ firebase: tvFirebase(rec) });
  const me = memberPath('campScoreboard', 'stranger@example.com');
  rec.auth({ email: 'stranger@example.com' });
  deliver(rec, me, null);
  assert.equal(tv.byId('auth-ov-denied').style.display, 'block', 'not on the list: the denied panel');
  assert.equal(tv.byId('waiting').hidden, true, 'and not the waiting screen');
  assert.deepEqual(rec.on, [me]);

  const rec2 = freshRec();
  const tv2 = loadTv({ firebase: tvFirebase(rec2) });
  const d = memberPath('campScoreboard', 'director@example.com');
  rec2.auth({ email: 'director@example.com' });
  deliver(rec2, d, { role: 'editor' });
  refuse(rec2, d);
  assert.equal(tv2.replaced.length, 1, 'a director whose read is refused mid-session is reloaded');
});

test('the TV page has no way to show a counselor standings, in code or in CSS', () => {
  const TV = readFixture('../current-standings.js');
  assert.ok(/#screen\[hidden\]\s*\{\s*display:\s*none/.test(TV_HTML), 'the reveal screen\'s hidden attribute beats the author rule');
  assert.ok(/function computeStandings\(state\) \{\s*if \(!directorStandings\) return \[\];/.test(TV), 'standings are not computed without a director');
  assert.notOk(/members\/[^\n]*\)\s*\.once\(/.test(TV), 'the approval read is live, not one-shot');
  assert.notOk(/^\s*function groupPlaces\(/m.test(TV), 'the page keeps no copy of the places rule');
  assert.ok(/groupPlaces\(rows\)/.test(TV), 'and calls reveal-core\'s groupPlaces');
  assert.ok(/reveal-core\.js\?v=/.test(TV_HTML), 'reveal-core.js is loaded by the page');
});

test('the cached fallback: a camp missing from the per-camp ledger is not a director\'s on this device', () => {
  const cache = { campScoreboardV2: JSON.stringify(stateWith(T6)) };
  const junior = loadTv({ storage: Object.assign({ campScoreboardAuthHint: 'editor', campScoreboardCampsHint: JSON.stringify({ senior: 'editor' }) }, cache) });
  assert.equal(junior.byId('waiting').hidden, false, 'junior has no ledger entry here: it waits, whatever the single hint says');
  assert.deepEqual(junior.introCrests(), []);
});

test('a tie reads top to bottom in reveal-core order (golds, silvers, bronzes, then name), not in slot order', () => {
  const names = ['Apple Team', 'Zebra Team', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deersz'];
  const teams = names.map((name, i) => ({ id: 't' + i, name }));
  const tv = loadTv({ storage: { campScoreboardV2: JSON.stringify(stateWith(teams, { bonuses: {
    a: { teamId: 't0', points: 5, category: 'custom' },
    b: { teamId: 't1', points: 5, category: 'custom' },
  } })) } });
  tv.next();
  tv.finishReveal();
  assert.deepEqual(tv.rows().slice(0, 2).map((r) => r.name), ['Apple Team', 'Zebra Team'], 'the tie at first: name order');
});

test('the cached-snapshot fallback shows standings only on a device that was a director\'s', () => {
  const cache = { campScoreboardV2: JSON.stringify(stateWith(T6, { results: { x: { medals: { gold: 't0', silver: 't1', bronze: 't2' } } } })) };
  const counselor = loadTv({ storage: Object.assign({ campScoreboardAuthHint: 'viewer' }, cache) });
  assert.equal(counselor.byId('waiting').hidden, false, 'a counselor\'s phone with the SDK blocked waits');
  assert.deepEqual(counselor.introCrests(), []);
  const bare = loadTv({ storage: Object.assign({ campScoreboardAuthHint: '' }, cache) });
  assert.equal(bare.byId('waiting').hidden, false, 'no hint at all fails closed');
  // the per-camp ledger beats the single hint: a director of senior who is only a counselor on junior
  const dual = loadTv({ storage: Object.assign({ campScoreboardAuthHint: 'editor', campScoreboardCampsHint: JSON.stringify({ junior: 'viewer', senior: 'editor' }) }, cache) });
  assert.equal(dual.byId('waiting').hidden, false, 'junior: a counselor there, so it waits');
  const senior = loadTv({ search: '?camp=senior', storage: { campScoreboardAuthHint: 'editor', campScoreboardCampsHint: JSON.stringify({ junior: 'viewer', senior: 'editor' }), 'campScoreboardV2:senior': JSON.stringify(stateWith(T4)) } });
  assert.equal(senior.byId('waiting').hidden, true);
  assert.equal(senior.introCrests().length, 4, 'senior: a director there, so it shows');
  const director = loadTv({ storage: cache });
  assert.equal(director.introCrests().length, 6, 'a director\'s device (hint editor) is unchanged');
  assert.equal(loadTv({ search: '?demo', storage: { campScoreboardAuthHint: '' } }).introCrests().length, 6, 'the demo is fake data, open to all');
});
