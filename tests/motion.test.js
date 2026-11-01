// jelly-motion.js — the spring system and the one calm-motion switch.
//
// The helper is loaded here into its OWN small vm context (not the app's): a
// hand-made DOM with just enough to run morph/flipKeyed/press, a fake clock that
// also drives setTimeout, a queue-driven requestAnimationFrame, and a WAAPI
// recorder (the app harness has no Element.animate, which is itself one of the
// things pinned: motion must be a no-op there). What a browser actually paints
// (the feel, the compositor) is checked by eye against motion-demo.html.

const MOTION_SRC = readFixture('../jelly-motion.js');
const JELLY_SRC = readFixture('../vendor/jelly.js');

// ── A tiny DOM ────────────────────────────────────────────────────
class FakeAnim {
  constructor(kf, opts) { this.kf = kf; this.opts = opts; this.l = { finish: [], cancel: [] }; this.cancelled = false; this.finished = false; }
  addEventListener(t, fn) { (this.l[t] = this.l[t] || []).push(fn); }
  cancel() { this.cancelled = true; this.l.cancel.forEach((f) => f()); }
  finish() { this.finished = true; this.l.finish.forEach((f) => f()); if (this.onfinish) this.onfinish(); }
}
function parseInto(root, html) {
  const re = /<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*>|<\/(\w+)>|([^<]+)/g;
  const stack = [root];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const n = new FakeNode(m[1]);
      n.parent = top; top.children.push(n);
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) n.attrs.set(a[1], a[2]);
      stack.push(n);
    } else if (m[3]) stack.pop();
    else top.text += m[4];
  }
}
class FakeNode {
  constructor(tag) { this.tag = tag; this.attrs = new Map(); this.children = []; this.parent = null; this.text = ''; this.animations = []; this.rect = null; this.canAnimate = true; }
  get dataset() { const d = {}; for (const [k, v] of this.attrs) if (k.startsWith('data-')) d[k.slice(5)] = v; return d; }
  get className() { return this.attrs.get('class') || ''; }
  set className(v) { this.attrs.set('class', v); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  hasAttribute(n) { return this.attrs.has(n); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  insertBefore(n, ref) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(i < 0 ? this.children.length : i, 0, n);
    return n;
  }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  get isConnected() { return !!this.parent; }
  get innerHTML() { return this.text + this.children.map((c) => c.outerHTML).join(''); }
  set innerHTML(html) { this.children.forEach((c) => { c.parent = null; }); this.children = []; this.text = ''; parseInto(this, html); }
  get outerHTML() { return `<${this.tag}${[...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join('')}>${this.innerHTML}</${this.tag}>`; }
  get content() { return this; }
  getBoundingClientRect() { return this.rect ? this.rect() : { left: 0, top: 0, width: 100, height: 40 }; }
}
FakeNode.prototype.animate = function (kf, opts) {
  if (!this.canAnimate) return undefined;
  const a = new FakeAnim(kf, opts);
  this.animations.push(a);
  return a;
};

// ── The environment the helper runs in ─────────────────────────────
function makeEnv(o) {
  o = o || {};
  const vmm = nodeRequire('vm');
  const clock = { t: 1000000 };
  const timers = [];
  let tid = 0;
  const events = [];
  const rafQ = [];
  const store = new Map(Object.entries(o.storage || {}));
  const listeners = {};
  const mqListeners = [];
  const mq = { matches: !!o.os };
  if (o.legacyMq) mq.addListener = (fn) => mqListeners.push(fn); // Safari < 14
  else mq.addEventListener = (t, fn) => mqListeners.push(fn);
  const root = new FakeNode('html');
  const classes = new Set();
  root.classList = { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
  const doc = {
    documentElement: root, hidden: false,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    createElement: (tag) => new FakeNode(tag),
  };
  const sb = {
    console, document: doc, navigator: o.navigator || {},
    performance: { now: () => clock.t },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    // A MediaQueryList is live: .matches changes under the same object.
    matchMedia: () => mq,
    setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, at: clock.t + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: (cb) => { rafQ.push(cb); return rafQ.length; },
    cancelAnimationFrame: () => {},
    Event: class { constructor(type) { this.type = type; } },
    dispatchEvent: (e) => { events.push(e.type); return true; },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const ctx = vmm.createContext(sb);
  vmm.runInContext(MOTION_SRC, ctx, { filename: 'jelly-motion.js' });
  const advance = (ms) => {
    const end = clock.t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const n = timers[0];
      if (!n || n.at > end) break;
      timers.shift(); clock.t = Math.max(clock.t, n.at); n.fn();
    }
    clock.t = end;
  };
  // One rAF turn: every queued callback gets the next 60 Hz (or `dt`) timestamp.
  const frame = (dt) => { clock.t += dt == null ? 1000 / 60 : dt; const q = rafQ.splice(0); q.forEach((cb) => cb(clock.t)); return q.length; };
  const fire = (type, ev) => (listeners[type] || []).forEach((h) => h(ev || {}));
  return { JM: sb.JellyMotion, win: sb, doc, root, classes, mq, events, store, clock, timers, rafQ, advance, frame, fire, mqListeners, listeners,
    calm: () => sb.calmMotion(), why: () => sb.calmReason(), el: (tag) => new FakeNode(tag || 'div') };
}

// Jelly's own integrator, pulled out of the vendored file so the test cannot
// drift from it: this is what "the sampler matches jelly.js" means.
function jellyE() {
  const m = /function E\(n, t, e, i, s, r\) \{[\s\S]*?\n\}/.exec(JELLY_SRC);
  assert.ok(m, 'vendor/jelly.js still has its E() integrator');
  return new Function('return ' + m[0].replace(/^function E/, 'function'))();
}

const tf = (kf) => kf.map((f) => f.transform).filter(Boolean);
const hasMotion = (kf) => kf.some((f) => Object.keys(f).some((k) => /^(transform|translate|rotate|scale|clipPath)/.test(k)));

// ── Springs ───────────────────────────────────────────────────────

test('the six presets are exactly the spec table (k, c, damping ratio)', () => {
  const { JM } = makeEnv();
  const want = { press: [260, 17, 0.53], arrive: [240, 16, 0.52], snap: [310, 22, 0.62], settle: [300, 26, 0.75], glide: [260, 32, 0.99], wobble: [170, 9, 0.35] };
  assert.deepEqual(Object.keys(JM.presets).sort(), Object.keys(want).sort());
  Object.keys(want).forEach((n) => {
    assert.equal(JM.presets[n].k, want[n][0], n + ' k');
    assert.equal(JM.presets[n].c, want[n][1], n + ' c');
    const zeta = JM.presets[n].c / (2 * Math.sqrt(JM.presets[n].k));
    assert.ok(Math.abs(zeta - want[n][2]) < 0.006, `${n} damping ratio ${zeta.toFixed(3)} vs ${want[n][2]}`);
  });
  assert.ok(Object.isFrozen(JM.presets) && Object.keys(JM.presets).every((n) => Object.isFrozen(JM.presets[n])), 'presets are frozen');
});

test('presets overshoot exactly as the table says when sampled at 1/60 s', () => {
  const { JM } = makeEnv();
  const want = { press: 0.114, arrive: 0.124, snap: 0.049, settle: 0.006, glide: 0, wobble: 0.30 };
  Object.keys(want).forEach((n) => {
    const peak = Math.max(...JM.sample(n).xs) - 1;
    assert.ok(Math.abs(peak - want[n]) < 0.0015, `${n} overshoot ${(peak * 100).toFixed(2)}% vs ${want[n] * 100}%`);
  });
});

test('sampling is jelly.js E() one step per 1/60 s, velocity first, and ends at rest', () => {
  const { JM } = makeEnv();
  const E = jellyE();
  Object.keys(JM.presets).forEach((n) => {
    const { k, c } = JM.presets[n];
    const s = JM.sample(n);
    let x = 0, v = 0;
    for (let i = 1; i < s.xs.length - 1; i++) {
      [x, v] = E(x, v, 1, k, c, 1 / 60);
      assert.ok(Math.abs(x - s.xs[i]) < 1e-12 && Math.abs(v - s.vs[i]) < 1e-9, `${n} frame ${i} matches Jelly's integrator`);
    }
    assert.equal(s.xs[s.xs.length - 1], 1, n + ' ends at rest');
    assert.equal(s.vs[s.vs.length - 1], 0);
    assert.equal(JM.sample(n), s, 'memoised');
  });
  assert.equal(JM.sample('nope'), null, 'an unknown preset is refused, not guessed');
  assert.ok(Math.max(...JM.sample('press', 4).xs) !== Math.max(...JM.sample('press').xs), 'an initial velocity changes the curve');
});

test('follow() chases a target with the same integrator at the real frame dt', () => {
  const env = makeEnv();
  const E = jellyE();
  const seen = [];
  const f = env.JM.follow('snap', 0, (x, v) => seen.push([x, v]));
  f.to(100);
  assert.ok(env.JM.busy(), 'a running follower counts as motion');
  let x = 0, v = 0;
  for (let i = 0; i < 10; i++) {
    env.frame(1000 / 60);
    [x, v] = E(x, v, 100, 310, 22, 1 / 60);
    assert.ok(Math.abs(seen[i][0] - x) < 1e-9, 'frame ' + i);
  }
  // A frame gap longer than 33 ms is clamped, like Jelly's.
  const before = seen.length;
  env.frame(500);
  [x, v] = E(x, v, 100, 310, 22, 0.033);
  assert.ok(Math.abs(seen[before][0] - x) < 1e-9, 'dt is clamped to 33 ms');
  for (let i = 0; i < 400 && env.rafQ.length; i++) env.frame();
  assert.equal(seen[seen.length - 1][0], 100, 'it lands exactly on the target');
  assert.notOk(env.JM.busy(), 'and stops counting once settled');
});

test('the §9.5 rows meet their minimum visible deformation (arrivals ≥ 4% or ≥ 3px, reveal rows and medals ≥ 8%)', () => {
  const { JM } = makeEnv();
  const dev = (preset, fn) => { // peak |scale − 1| and peak overshoot px past rest across the samples
    const s = JM.sample(preset);
    let sc = 0, px = 0;
    s.xs.forEach((x, i) => { const r = fn(x, s.vs[i]); sc = Math.max(sc, Math.abs(r.sx - 1), Math.abs(r.sy - 1)); px = Math.max(px, r.over || 0); });
    return { sc, px };
  };
  const rows = [
    // arrivals: ≥ 4% scale deformation OR ≥ 3 px of overshoot past rest
    ['tab panel arrives', 'arrive', (x) => { const q = 1 - Math.min(1, x), o = Math.max(0, x - 1); return { sx: 1 - 0.02 * q + o * 0.12, sy: 1 - 0.06 * q - o * 0.3, over: o * 30 }; }, 'arrival'],
    ['a banner drops in', 'arrive', (x) => ({ sx: 1, sy: 1, over: Math.max(0, x - 1) * 56 }), 'arrival'],
    ['a number rolls and pops', 'press', (x) => ({ sx: 1 + 0.12 * (1 - x), sy: 1 + 0.12 * (1 - x) }), 'arrival'],
    ['the check pops', 'press', (x) => ({ sx: 0.3 + 0.7 * x, sy: 0.3 + 0.7 * x }), 'arrival'],
    // reveal rows and medals: ≥ 8%
    ['a revealed row unwraps', 'wobble', (x) => ({ sx: 1.05 - 0.05 * x, sy: 0.55 + 0.45 * x }), 'reveal'],
    ['a medal lands', 'wobble', (x) => { const o = x - 1, sq = o > 0 ? Math.min(0.3, o * 1.6) : 0; return { sx: 1 + sq * 0.6, sy: 1 - sq }; }, 'reveal'],
  ];
  rows.forEach(([name, preset, fn, kind]) => {
    const d = dev(preset, fn);
    if (kind === 'arrival') assert.ok(d.sc >= 0.04 || d.px >= 3, `${name}: ${(d.sc * 100).toFixed(1)}% / ${d.px.toFixed(1)}px is too subtle to read as jelly`);
    else assert.ok(d.sc >= 0.08, `${name}: ${(d.sc * 100).toFixed(1)}% is under 8%`);
  });
});

// ── play / playOut: WAAPI only, calm paths, no residue ─────────────

test('play() makes WAAPI keyframes along the sampled spring and cancels the previous motion', () => {
  const env = makeEnv();
  const el = env.el();
  const a1 = env.JM.play(el, 'arrive', (x) => ({ transform: 'translateY(' + 22 * (1 - x) + 'px)' }));
  const n = env.JM.sample('arrive').xs.length - 1;
  assert.equal(a1.kf.length, n + 1, 'one keyframe per 1/60 s sample');
  assert.equal(a1.kf[0].offset, 0); assert.equal(a1.kf[n].offset, 1);
  assert.equal(a1.opts.easing, 'linear'); assert.equal(a1.opts.fill, 'backwards');
  assert.equal(a1.opts.duration, env.JM.durationMs('arrive'));
  const a2 = env.JM.play(el, 'snap', (x) => ({ transform: 'scale(' + x + ')' }));
  assert.ok(a1.cancelled, 'a new motion on the same element cancels the old');
  const a3 = env.JM.play(el, 'press', (x) => ({ opacity: x }), { layer: true, delay: 40 });
  assert.notOk(a2.cancelled, 'layer: true leaves the others running');
  assert.equal(a3.opts.delay, 40);
  assert.equal(env.JM.play(el, 'nope', () => ({})), null, 'an unknown preset plays nothing');
});

test('with no Element.animate (very old WebKit, the app harness) everything is an instant no-op', () => {
  const env = makeEnv();
  const el = env.el(); el.animate = undefined;
  const bare = { tagName: 'DIV' }; // no animate at all
  [el, bare, null].forEach((t) => {
    assert.equal(env.JM.play(t, 'arrive', () => ({})), null);
    assert.equal(env.JM.press(t, { x: 1, y: 1 }), null);
    assert.equal(env.JM.release(t), null);
    assert.equal(env.JM.ring(t), null);
  });
  let done = 0;
  assert.equal(env.JM.playOut(bare, () => ({}), 130, () => { done++; }), null);
  assert.equal(done, 1, 'playOut still runs done() so the element is removed/hidden anyway');
  assert.notOk(env.JM.busy());
});

test('playOut holds its end only until done() has removed the element, then cancels', () => {
  const env = makeEnv();
  const row = env.el(); const box = env.el(); box.insertBefore(row, null);
  let removedAt = null;
  const a = env.JM.playOut(row, (x) => ({ transform: 'scale(' + (1 - 0.04 * x) + ')', opacity: 1 - x }), 130, () => { row.remove(); removedAt = a.cancelled; });
  assert.equal(a.opts.fill, 'forwards'); assert.equal(a.opts.duration, 130);
  assert.ok(env.JM.busy());
  a.finish();
  assert.equal(removedAt, false, 'done() ran while the end state was still held');
  assert.ok(a.cancelled, 'then the animation was cancelled');
  assert.notOk(row.isConnected);
  assert.notOk(env.JM.busy(), 'busy counts a finish and the following cancel once');
});

test('every play has a calm path or returns null; while calm there are NO transform keyframes', () => {
  const env = makeEnv();
  const { JM } = env;
  JM.setPref('on');
  assert.ok(env.calm());
  const el = env.el();
  const move = (x) => ({ transform: 'translateY(' + 22 * (1 - x) + 'px) scale(1.1)', transformOrigin: '50% 0', clipPath: 'inset(0)', opacity: x });
  const calls = [
    () => JM.play(el, 'arrive', move),
    () => JM.play(el, 'wobble', move, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 }),
    // a calm path someone wrote carelessly is stripped, not trusted
    () => JM.play(el, 'press', move, { calm: [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none', offset: 1 }] }),
    () => JM.playOut(el, move, 130, () => {}),
    () => JM.press(el, { x: 10, y: 10 }),
    () => JM.release(el),
    () => JM.release(el, { fromRest: true }),
  ];
  calls.forEach((fn, i) => {
    const a = fn();
    assert.ok(a, 'call ' + i + ' has a calm path');
    assert.notOk(hasMotion(a.kf), 'call ' + i + ' made a moving keyframe while calm: ' + JSON.stringify(a.kf));
  });
  assert.equal(JM.play(el, 'arrive', move, { calm: false }), null, 'purely decorative motion is skipped while calm');
  assert.equal(JM.play(el, 'arrive', move, { calm: false, layer: true }), null);
  // the FLIP survivors jump
  const root = env.el(); root.innerHTML = '<div data-key="a">1</div><div data-key="b">2</div>';
  root.children.forEach((c) => { c.rect = () => ({ left: 0, top: 50 * (c.parent ? c.parent.children.indexOf(c) : 0), width: 10, height: 10 }); });
  const kids = root.children.slice();
  JM.flipKeyed(root, '<div data-key="b">2</div><div data-key="a">1</div>');
  assert.ok(kids.every((k) => !k.animations.length), 'calm: neighbours jump, nothing is animated');
  // follow() jumps too
  const seen = []; const f = JM.follow('snap', 0, (x) => seen.push(x)); f.to(50);
  assert.deepEqual(seen, [50]); assert.equal(env.rafQ.length, 0, 'and starts no rAF loop');
});

test('motion leaves no trace in the DOM: outerHTML and __dom are unchanged after press, release, play, playOut, flipKeyed', () => {
  const env = makeEnv();
  const { JM } = env;
  const root = env.el('section');
  const html = '<div data-key="a" class="row">A</div><div data-key="b" class="row">B</div><div data-key="c" class="row">C</div>';
  root.innerHTML = html; root.__html = html; root.__dom = root.innerHTML;
  const snap = root.outerHTML;
  const a = root.children[0], b = root.children[1];
  // geometry for the keyed FLIP: after the reorder every row sits where its index says
  root.children.forEach((c, i) => { c.rect = () => ({ left: 0, top: (c.parent ? c.parent.children.indexOf(c) : i) * 50, width: 100, height: 40 }); });
  JM.press(a, { x: 10, y: 10 });
  JM.release(a);
  JM.release(a, { fromRest: true });
  JM.play(b, 'arrive', (x) => ({ transform: 'translateY(' + 22 * (1 - x) + 'px)', opacity: x }));
  JM.playOut(root.children[2], (x) => ({ transform: 'scale(' + (1 - 0.04 * x) + ')' }), 130, () => {});
  env.win.document.createElement = (t) => new FakeNode(t);
  JM.flipKeyed(root, '<div data-key="b" class="row">B</div><div data-key="a" class="row">A</div><div data-key="c" class="row">C</div>');
  // Put it back: the point is not what flipKeyed ordered but that animating left no mark.
  JM.flipKeyed(root, html);
  assert.equal(root.outerHTML, snap, 'no inline style, no class, no attribute residue');
  assert.equal(root.__dom, root.innerHTML, 'so setHtmlIfChanged sees nothing changed and rewrites nothing');
  assert.ok(root.children[0] === a && root.children[1] === b, 'and the very same nodes survived');
  JM.restamp(root); // the rare in-place change inside a setHtmlIfChanged root
  assert.equal(root.__dom, root.innerHTML);
});

// ── morph / flipKeyed ─────────────────────────────────────────────

test('morph keeps keyed nodes, inserts new ones, drops missing ones and fixes the order', () => {
  const env = makeEnv();
  const { JM } = env;
  const root = env.el();
  root.innerHTML = '<div data-key="a" class="x" title="old">1</div><div data-key="b">2</div><div data-key="c">3</div><p>loose</p>';
  const [a, b, c] = root.children;
  const added = JM.morph(root, '<div data-key="c">3</div><div data-key="d">new</div><div data-key="a" class="y">one</div><p>fresh</p>');
  assert.deepEqual(root.children.map((n) => n.attrs.get('data-key') || n.tag), ['c', 'd', 'a', 'p']);
  assert.ok(root.children[0] === c && root.children[2] === a, 'same keys, same nodes');
  assert.notOk(b.isConnected, 'a missing key is removed');
  assert.equal(a.className, 'y'); assert.equal(a.innerHTML, 'one');
  assert.notOk(a.hasAttribute('title'), 'an attribute the new markup dropped is dropped');
  assert.deepEqual(added.map((n) => n.attrs.get('data-key') || n.tag), ['d', 'p'], 'returns the nodes it created (unkeyed ones are always replaced)');
});

test('flipKeyed springs only the survivors that moved, from where they were', () => {
  const env = makeEnv();
  const { JM } = env;
  const root = env.el();
  root.innerHTML = '<div data-key="a">1</div><div data-key="b">2</div><div data-key="c">3</div>';
  const geo = (c) => { c.rect = () => ({ left: 0, top: 50 * (c.parent ? c.parent.children.indexOf(c) : 0), width: 100, height: 40 }); };
  root.children.forEach(geo);
  const [a, b, c] = root.children;
  JM.flipKeyed(root, '<div data-key="c">3</div><div data-key="a">1</div><div data-key="b">2</div>');
  assert.deepEqual(root.children.map((n) => n.attrs.get('data-key')), ['c', 'a', 'b']);
  assert.equal(c.animations.length, 1, 'c moved up two rows');
  assert.equal(a.animations.length, 1); assert.equal(b.animations.length, 1);
  const kf = c.animations[0].kf;
  assert.equal(kf[0].transform, 'translate(0px,100px)', 'it starts at its OLD place (two rows down)');
  assert.equal(kf[kf.length - 1].transform, 'translate(0px,0px)', 'and lands in its new one');
  assert.equal(c.animations[0].opts.fill, 'backwards');
  assert.equal(c.animations[0].opts.duration, JM.durationMs('glide'), 'the glide spring');
  // nothing moved: nothing animates
  const before = a.animations.length;
  JM.flipKeyed(root, '<div data-key="c">3</div><div data-key="a">1</div><div data-key="b">2</div>');
  assert.equal(a.animations.length, before, 'an identical render starts no motion');
});

// ── The press dent ────────────────────────────────────────────────

test('press dents toward the finger (≥ 10%), release rings past rest (≥ 3%), wide rows get a gentler dent', () => {
  const env = makeEnv();
  const { JM } = env;
  const btn = env.el('button'); btn.rect = () => ({ left: 100, top: 100, width: 120, height: 48 });
  const down = JM.press(btn, { x: 190, y: 110 }); // right side, upper part
  const held = down.kf[1];
  assert.ok(/scale\(1\.06,0\.88\)/.test(held.transform), 'a 12% dent: ' + held.transform);
  assert.equal(held.transformOrigin, '75% 21%', 'around the touch point');
  assert.ok(/skewX\(-/.test(held.transform), 'skewed toward the pressed side');
  assert.equal(down.opts.fill, 'forwards', 'the hold is the one forwards fill…');
  const up = JM.release(btn);
  assert.ok(down.cancelled, '…and release always cancels it');
  const sy = up.kf.map((f) => parseFloat(/scale\([\d.]+,([\d.]+)\)/.exec(f.transform)[1]));
  assert.ok(Math.min(...sy) <= 0.88 + 1e-9, 'the release starts from the dent');
  assert.ok(Math.max(...sy) >= 1.03, 'and stretches ≥ 3% past rest: ' + Math.max(...sy));
  assert.equal(sy[sy.length - 1], 1, 'ending exactly at rest');
  assert.equal(up.opts.duration, JM.durationMs('wobble'));
  // a full-width list row must not bulge past the gutter
  const row = env.el('button'); row.rect = () => ({ left: 16, top: 0, width: 358, height: 56 });
  const wide = JM.press(row, { x: 100, y: 20 }).kf[1].transform;
  const widthScale = parseFloat(/scale\(([\d.]+),/.exec(wide)[1]);
  assert.ok(widthScale > 1 && widthScale < 1.04, 'a wide row grows under 4%: ' + widthScale);
  // a tap quicker than the press delay pops from REST, never snapping in
  const quick = JM.release(env.el('button'), { fromRest: true });
  assert.equal(quick.kf[0].transform.includes('scale(1,1)'), true, 'the first frame is at rest');
  assert.equal(quick.kf[0].offset, 0);
});

test('a held press does not count as motion forever (the calm sampler must not wait on a thumb)', () => {
  const env = makeEnv();
  const btn = env.el('button');
  const a = env.JM.press(btn, { x: 1, y: 1 });
  assert.ok(env.JM.busy());
  a.finish(); // the 70 ms dent completed; the control is simply held
  assert.notOk(env.JM.busy());
});

// ── Hands off ─────────────────────────────────────────────────────

test('whenHandsOff waits for the pointer to lift and 400 ms of quiet', () => {
  const env = makeEnv();
  let ran = 0;
  env.fire('pointerdown', { pointerId: 7 });
  env.JM.whenHandsOff(() => { ran++; });
  env.advance(3000);
  assert.equal(ran, 0, 'a finger is down: nothing moves under it');
  env.fire('pointerup', { pointerId: 7 });
  env.advance(300);
  assert.equal(ran, 0, 'lifted, but under 400 ms ago');
  env.advance(300);
  assert.equal(ran, 1, 'quiet for 400 ms: the reflow runs');
  env.JM.whenHandsOff(() => { ran++; });
  assert.equal(ran, 2, 'with no touch at all it runs at once');
});

test('a lost pointerup cannot freeze list reflows for good, and a hidden page forgets its pointers', () => {
  const env = makeEnv();
  let ran = 0;
  env.fire('pointerdown', { pointerId: 1 });
  env.JM.whenHandsOff(() => { ran++; });
  env.advance(11000);
  assert.equal(ran, 1, 'a pointer "down" for over 10 s is treated as lost');
  env.fire('pointerdown', { pointerId: 2 });
  env.doc.hidden = true; env.fire('visibilitychange');
  env.advance(500);
  env.JM.whenHandsOff(() => { ran++; });
  assert.equal(ran, 2);
});

// ── Calm: the truth table ─────────────────────────────────────────

test('calm truth table: the OS beats the switch, Off beats only the battery signals', () => {
  const { JM } = makeEnv();
  const bools = [false, true];
  ['auto', 'on', 'off'].forEach((pref) => bools.forEach((os) => bools.forEach((saver) => bools.forEach((batteryLow) => {
    const got = JM.decide({ os, pref, saver, batteryLow });
    let calm, reason;
    if (os) { calm = true; reason = 'os'; }
    else if (pref === 'on') { calm = true; reason = 'switch-on'; }
    else if (pref === 'off') { calm = false; reason = 'switch-off'; }
    else if (saver) { calm = true; reason = 'battery-saver'; }
    else if (batteryLow) { calm = true; reason = 'battery-low'; }
    else { calm = false; reason = null; }
    const tag = JSON.stringify({ pref, os, saver, batteryLow });
    assert.equal(got.calm, calm, tag); assert.equal(got.reason, reason, tag);
  }))));
});

test('the live switch: Off on a phone that asks for less motion stays calm, and says why', () => {
  const env = makeEnv();
  const { JM } = env;
  assert.notOk(env.calm(), 'plain Auto on a normal phone is not calm');
  assert.equal(env.why(), null);
  JM.setPref('on');
  assert.ok(env.calm()); assert.equal(env.why(), 'switch-on');
  JM.setPref('off');
  assert.notOk(env.calm()); assert.equal(env.why(), 'switch-off');
  JM.setOs(true);
  assert.ok(env.calm(), 'the OS setting wins over Off');
  assert.equal(env.why(), 'os', 'so the line under the switch can say the phone asked');
  JM.setOs(false);
  assert.notOk(env.calm(), 'and Off applies again the moment the OS stops asking');
  assert.equal(JM.calm(), env.calm(), 'JellyMotion.calm() is calmMotion()');
});

test('a change toggles html.calm-motion, data-jelly-motion, tells Jelly, and mirrors the verdict for the boot guard', () => {
  const env = makeEnv();
  const { JM, store } = env;
  assert.equal(env.root.getAttribute('data-jelly-motion'), 'no-preference', 'set at boot even when not calm: Jelly reads the app\'s verdict, not its own');
  assert.notOk(env.classes.has('calm-motion'));
  const n0 = env.events.length;
  JM.setPref('on');
  assert.ok(env.classes.has('calm-motion'));
  assert.equal(env.root.getAttribute('data-jelly-motion'), 'reduce');
  assert.equal(env.events.length, n0 + 1); assert.equal(env.events[n0], 'jelly-motion-change');
  assert.equal(store.get('campScoreboardCalmMotion'), 'on');
  assert.equal(store.get('campScoreboardCalmLast'), 'switch-on');
  JM.refresh();
  assert.equal(env.events.length, n0 + 1, 'a refresh that changes nothing announces nothing');
  JM.setPref('auto');
  assert.notOk(env.classes.has('calm-motion'));
  assert.equal(store.has('campScoreboardCalmMotion'), false, 'Auto is the key being absent');
  assert.equal(store.has('campScoreboardCalmLast'), false, 'and a non-calm verdict leaves no hint for the guard');
});

test('the stored switch survives a reload; junk in it is Auto', () => {
  assert.ok(makeEnv({ storage: { campScoreboardCalmMotion: 'on' } }).calm());
  assert.notOk(makeEnv({ storage: { campScoreboardCalmMotion: 'off' } }).calm());
  const junk = makeEnv({ storage: { campScoreboardCalmMotion: 'maybe' } });
  assert.equal(junk.JM.pref(), 'auto');
  assert.ok(makeEnv({ os: true, storage: { campScoreboardCalmMotion: 'off' } }).calm(), 'the OS beats a stored Off at boot too');
});

test('the OS setting is followed live (a change listener, Safari < 14 addListener too)', () => {
  [false, true].forEach((legacyMq) => {
    const env = makeEnv({ legacyMq });
    assert.equal(env.mqListeners.length, 1);
    env.mq.matches = true;
    env.mqListeners[0]();
    assert.ok(env.calm(), 'the listener re-reads the query');
    assert.equal(env.why(), 'os');
    env.mq.matches = false;
    env.mqListeners[0]();
    assert.notOk(env.calm());
  });
});

test('battery: ≤ 20% and not charging is calm (Auto only); charging or 21% is not', () => {
  const { JM, calm } = (() => { const e = makeEnv(); return { JM: e.JM, calm: e.calm }; })();
  JM.setBattery({ level: 0.2, charging: false });
  assert.ok(calm()); assert.equal(JM.calm() && JM.pref(), 'auto');
  JM.setBattery({ level: 0.2, charging: true }); JM.refresh(JM.now() + JM.offAfterMs + 1);
  assert.notOk(calm(), 'charging again: the hold has passed');
  JM.setBattery({ level: 0.21, charging: false }); JM.refresh(JM.now() + 2 * JM.offAfterMs);
  assert.notOk(calm());
  JM.setBattery({ level: 0.05, charging: false });
  assert.ok(calm());
  JM.setPref('off');
  assert.notOk(calm(), 'Off overrides the battery signals');
  JM.setBattery(null);
  assert.notOk(calm());
});

test('the frame-rate sampler: ≤ 36 Hz twice in a row is saver, ≥ 50 Hz twice in a row is not, the middle resets', () => {
  const env = makeEnv();
  const { JM } = env;
  JM.observeHz(30);
  assert.notOk(env.calm(), 'once is a hiccup');
  JM.observeHz(45);
  JM.observeHz(30);
  assert.notOk(env.calm(), 'a reading in between resets the streak');
  JM.observeHz(30);
  assert.ok(env.calm(), 'twice in a row'); assert.equal(env.why(), 'battery-saver');
  JM.observeHz(120);
  assert.ok(env.calm(), 'one fast reading is not enough');
  assert.equal(JM.medianHz([0, 33.3, 66.6, 100, 133.3]) | 0, 30);
  assert.equal(JM.medianHz([0, 8.3, 16.7, 25]) | 0, 120);
});

test('hysteresis: calm comes on at once but ends only after 60 s without a signal', () => {
  const env = makeEnv();
  const { JM } = env;
  const t0 = env.clock.t;
  JM.observeHz(30); JM.observeHz(30);
  assert.ok(env.calm(), 'on immediately');
  JM.observeHz(60); JM.observeHz(60);
  assert.ok(env.calm(), 'two fast samples: still calm, the phone may be near the threshold');
  JM.refresh(t0 + 30000);
  assert.ok(env.calm(), '30 s on');
  JM.refresh(t0 + 59000);
  assert.ok(env.calm(), '59 s on');
  env.advance(61000);
  assert.notOk(env.calm(), 'a minute with no signal: the hold timer ends it by itself');
  // a signal inside the window renews it
  JM.observeHz(30); JM.observeHz(30);
  env.advance(50000);
  JM.observeHz(30);
  env.advance(50000);
  assert.ok(env.calm(), 'a fresh signal 50 s in restarts the minute');
  // the switch and the OS are NOT delayed
  JM.setPref('off');
  assert.notOk(env.calm(), 'Off is immediate');
});

test('a battery-saver verdict from the last session is held through boot, not flipped off before the sampler reads', () => {
  const env = makeEnv({ storage: { campScoreboardCalmLast: 'battery-saver' } });
  assert.ok(env.calm(), 'boot-guard painted it calm; the first compute agrees');
  assert.equal(env.why(), 'battery-saver');
  env.advance(61000);
  assert.notOk(env.calm(), 'and with no signal for a minute it lets go');
  const off = makeEnv({ storage: { campScoreboardCalmLast: 'battery-saver', campScoreboardCalmMotion: 'off' } });
  assert.notOk(off.calm(), 'an explicit Off ignores a stale battery verdict');
  assert.equal(off.root.getAttribute('data-jelly-motion'), 'no-preference');
  assert.notOk(off.classes.has('calm-motion'), 'and undoes whatever the guard painted');
  const stale = makeEnv({ storage: { campScoreboardCalmLast: 'os' } });
  assert.notOk(stale.calm(), 'only the two battery verdicts are held; the OS is read live');
});

// ── The sampler never runs during motion ──────────────────────────

test('the sampler waits while anything is moving and abandons a sample if motion starts mid-way', () => {
  const env = makeEnv();
  const { JM } = env;
  let moving = true;
  JM.busySource(() => moving);
  assert.equal(JM.sampleNow(), 'waiting', 'confetti, a stopwatch tick or a clock heartbeat is running');
  assert.equal(env.rafQ.length, 0, 'not a single frame was spent measuring');
  moving = false;
  assert.equal(JM.sampleNow(), 'sampling');
  env.frame(); env.frame(); env.frame();
  moving = true; // something started halfway
  env.frame();
  assert.equal(env.rafQ.length, 0, 'the sample was abandoned');
  assert.notOk(env.calm(), 'and nothing was concluded from it');
  // a play() in flight is motion too
  moving = false;
  const el = env.el(); const a = JM.play(el, 'arrive', () => ({}));
  assert.equal(JM.sampleNow(), 'waiting');
  a.finish();
  assert.equal(JM.sampleNow(), 'sampling');
  // a hidden page is not sampled
  env.rafQ.length = 0; env.doc.hidden = true;
  assert.equal(JM.sampleNow(), 'waiting');
});

test('a full 24-interval sample at 30 Hz, twice, turns the saver on; the next is scheduled five minutes out', () => {
  const env = makeEnv();
  const sample = () => { env.JM.sampleNow(); let n = 0; while (env.rafQ.length && n++ < 40) env.frame(1000 / 30); };
  sample();
  assert.notOk(env.calm());
  sample();
  assert.ok(env.calm(), 'two low readings');
  assert.ok(env.timers.some((t) => t.at - env.clock.t > 4 * 60 * 1000), 'the next sample is minutes away, not a poll');
});

test('the sampler starts 2 s after boot and again 1.5 s after the page becomes visible', () => {
  const env = makeEnv();
  assert.ok(env.timers.some((t) => t.at - env.clock.t === 2000), 'the boot sample');
  env.timers.length = 0;
  env.fire('visibilitychange');
  assert.ok(env.timers.some((t) => t.at - env.clock.t === 1500), 'the wake-up sample');
});
