// jelly-motion.js — the one spring system and the one calm-motion switch.
//
// A CLASSIC script (loaded after camps.js, before app.js) with NO dependency on
// vendor/jelly.js: that module can't even be parsed on iOS < 16.4, and
// boot-guard's jelly-failed path must still move. Nothing here runs a render;
// every animation is started by code that knows a change happened (a diff),
// never by a re-render, and every one is WAAPI-only — no inline style, no class,
// no commitStyles() — so it leaves no residue for setHtmlIfChanged to see
// (`el.__dom === el.innerHTML` would stop matching and the next render would
// rewrite the whole root, re-creating Jelly components and cutting the spring
// off). The one exception is follow(), which writes style and is therefore only
// for nodes no string renderer ever rewrites.
//
// SPRINGS. The six presets are integrated exactly the way vendor/jelly.js's E()
// integrates: semi-implicit Euler, mass 1, velocity first, ONE step per frame.
// Presets are sampled at dt = 1/60 s, which is what a Jelly component computes
// on a 60 Hz phone, so the feel matches (sampling at 1/240 made `snap`
// overshoot 7.3% where Jelly's own thumbs do 4.9%).
//
// CALM. calmMotion() is the single answer to "should this move?". App code
// never reads matchMedia for motion again. The OS setting beats the switch (it
// is an accessibility setting; "Off" must not override it); Auto adds the two
// battery signals. See the truth table in decide().
(function () {
  'use strict';

  var G = typeof window !== 'undefined' ? window : globalThis;

  // ── The six springs ───────────────────────────────────────────
  var PRESETS = Object.freeze({
    press:  Object.freeze({ k: 260, c: 17 }), // check marks, numbers changing, label swaps, tab icon pop
    arrive: Object.freeze({ k: 240, c: 16 }), // anything arriving: panels, sheets, banners, strips
    snap:   Object.freeze({ k: 310, c: 22 }), // tab blob, the on-screen tag, day pill, switches
    settle: Object.freeze({ k: 300, c: 26 }), // full-screen takeovers ONLY (a whole screen must not bounce)
    glide:  Object.freeze({ k: 260, c: 32 }), // things moving out of the way, progress, keyed FLIP
    wobble: Object.freeze({ k: 170, c: 9 }),  // chunky-button release, medals landing, the crown, a refused tap
  });
  var DT = 1 / 60;

  var sampleCache = {};
  // x runs 0 -> 1 (with overshoot) along the spring; vs is the velocity at each
  // sample. Memoised; the last sample is pinned to exactly rest (1, 0).
  function sample(name, v0) {
    var p = PRESETS[name];
    if (!p) return null;
    v0 = v0 || 0;
    var key = name + '|' + v0;
    if (sampleCache[key]) return sampleCache[key];
    var x = 0, v = v0;
    var xs = [0], vs = [v0];
    for (var f = 1; f <= 240; f++) {
      var a = (1 - x) * p.k - v * p.c;
      v += a * DT; x += v * DT;               // jelly.js E(): v first, then x
      xs.push(x); vs.push(v);
      if (f > 8 && Math.abs(1 - x) < 0.0015 && Math.abs(v) < 0.02) break;
    }
    xs[xs.length - 1] = 1; vs[vs.length - 1] = 0;
    return (sampleCache[key] = { xs: xs, vs: vs });
  }

  function durationMs(name, v0) {
    var s = sample(name, v0);
    return s ? Math.round((s.xs.length - 1) * DT * 1000) : 0;
  }

  // A CSS linear() easing sampled from a preset, for styles.css tokens. There is
  // no build step, so the string is generated once and pasted; motion.test.js
  // regenerates it and fails if styles.css drifts. Stops are spread by TIME.
  function cssLinear(name, stops) {
    var s = sample(name);
    if (!s) return '';
    stops = stops || 24;
    var n = s.xs.length - 1, out = [];
    var round = function (q, d) { var m = Math.pow(10, d); return Math.round(q * m) / m; };
    for (var i = 0; i < stops; i++) {
      var pos = (i / (stops - 1)) * n, lo = Math.floor(pos), hi = Math.min(n, lo + 1);
      var val = s.xs[lo] + (s.xs[hi] - s.xs[lo]) * (pos - lo);
      var pct = round((i / (stops - 1)) * 100, 1);
      if (i === 0) out.push('0');
      else if (i === stops - 1) out.push('1');
      else out.push(round(val, 3) + ' ' + pct + '%');
    }
    return 'linear(' + out.join(', ') + ')';
  }

  // ── What is moving right now ──────────────────────────────────
  var active = 0;
  var busySources = [];
  function busy() {
    if (active > 0) return true;
    for (var i = 0; i < busySources.length; i++) {
      try { if (busySources[i]()) return true; } catch (e) { /* a bad source never blocks the sampler */ }
    }
    return false;
  }
  // The app registers what it knows is running (confetti, a stopwatch tick, a
  // clock heartbeat); the calm sampler waits for all of it.
  function busySource(fn) { if (typeof fn === 'function') busySources.push(fn); }

  // One clock for everything here: performance.now() when there is one, which is
  // the time base rAF timestamps use (follow() mixes the two); tests replace it.
  function nowMs() { return JM.now(); }

  var running = typeof WeakMap === 'function' ? new WeakMap() : null;
  function track(anim) {
    var done = false;
    var end = function () { if (!done) { done = true; active = Math.max(0, active - 1); } };
    active++;
    anim.addEventListener('finish', end);
    anim.addEventListener('cancel', end);   // a finished animation can still fire cancel: count once
    return anim;
  }
  function canAnimate(el) { return !!(el && typeof el.animate === 'function'); }

  // Properties that MOVE things. Calm keyframes are opacity (and non-moving
  // paint) only; a test asserts no transform keyframe is ever created while calm.
  var MOTION_PROP = /^(transform|translate|rotate|scale|clipPath|offset(Path|Distance|Rotate|Anchor))/;
  function calmSafe(kf) {
    return kf.map(function (f) {
      var o = {};
      for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k) && !MOTION_PROP.test(k)) o[k] = f[k];
      return o;
    });
  }

  // play(el, preset, frame, opts): frame(x, v) -> keyframe ({transform,
  // transformOrigin, opacity, clipPath, ...}); x runs 0 -> 1 along the spring.
  // WAAPI keyframes from the samples, easing 'linear', fill 'backwards':
  // compositor-friendly, cancellable, no rAF loop, no DOM residue. Cancels the
  // element's previous motion unless opts.layer.
  // opts: { v0, delay, layer, calm: keyframes | false, calmMs }
  //   calm === false  -> purely decorative: returns null while calm
  //   calm === [..]   -> those keyframes (stripped of any transform) over calmMs
  //   (omitted)       -> a short opacity fade
  // Returns the Animation, or null (no WAAPI, or skipped while calm).
  function play(el, name, frame, o) {
    o = o || {};
    if (!canAnimate(el) || !PRESETS[name]) return null;
    var prev = running && running.get(el);
    if (prev && !o.layer) { try { prev.cancel(); } catch (e) { /* already gone */ } }
    var anim;
    if (calmMotion()) {
      if (o.calm === false) return null;
      var cf = calmSafe(o.calm || [{ opacity: 0.4 }, { opacity: 1 }]);
      anim = el.animate(cf, { duration: o.calmMs || 160, easing: 'cubic-bezier(.4,0,.2,1)', delay: (o.delay || 0) * 0.5, fill: 'backwards' });
    } else {
      var s = sample(name, o.v0), n = s.xs.length - 1;
      var kf = [];
      for (var i = 0; i <= n; i++) {
        var f = frame(s.xs[i], s.vs[i]);
        f.offset = i / n;
        kf.push(f);
      }
      anim = el.animate(kf, { duration: Math.round(n * DT * 1000), easing: 'linear', delay: o.delay || 0, fill: 'backwards' });
    }
    if (!o.layer && running) running.set(el, anim);
    return track(anim);
  }

  // Exits and replacements: short, accelerating out; calm = opacity only. The
  // animation holds its end (fill 'forwards') only until done() has removed or
  // hidden the element, then it is cancelled so nothing is left behind.
  function playOut(el, frame, ms, done) {
    if (!canAnimate(el)) { if (done) done(); return null; }
    var prev = running && running.get(el);
    if (prev) { try { prev.cancel(); } catch (e) { /* already gone */ } }
    var calm = calmMotion();
    var kf = calm ? [{ opacity: 1 }, { opacity: 0 }] : [frame(0), frame(1)];
    var a = el.animate(kf, { duration: calm ? 140 : ms, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    if (running) running.set(el, a);
    track(a);
    a.onfinish = function () {
      if (done) done();
      try { a.cancel(); } catch (e) { /* already gone */ }
    };
    return a;
  }

  // A tiny interruptible rAF spring for things that chase a moving target (the
  // tab blob, a sheet being dragged). Same integrator, the real frame dt clamped
  // to 33 ms like Jelly. WRITES whatever onFrame writes (usually style), so it
  // is ONLY for nodes that no string renderer rewrites.
  function follow(name, x0, onFrame, eps, vEps) {
    var p = PRESETS[name];
    eps = eps == null ? 0.25 : eps; vEps = vEps == null ? 4 : vEps;
    var st = { x: x0, v: 0, target: x0, raf: 0 };
    var last = 0, counted = false;
    function stop() {
      if (counted) { counted = false; active = Math.max(0, active - 1); }
      if (st.raf) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.raf); st.raf = 0; }
    }
    function step(t) {
      var dt = Math.min(0.033, Math.max(0, (t - last) / 1000)); last = t;
      var a = (st.target - st.x) * p.k - st.v * p.c;
      st.v += a * dt; st.x += st.v * dt;
      if (Math.abs(st.target - st.x) < eps && Math.abs(st.v) < vEps) {
        st.x = st.target; st.v = 0; st.raf = 0; stop(); onFrame(st.x, 0); return;
      }
      onFrame(st.x, st.v);
      st.raf = requestAnimationFrame(step);
    }
    st.to = function (target, v) {
      st.target = target;
      if (v !== undefined) st.v = v;
      if (calmMotion() || typeof requestAnimationFrame !== 'function') { stop(); st.x = target; st.v = 0; onFrame(target, 0); return; }
      if (!st.raf) { counted = true; active++; last = nowMs(); st.raf = requestAnimationFrame(step); }
    };
    st.set = function (x) { stop(); st.x = x; st.target = x; st.v = 0; onFrame(x, 0); };
    st.stop = stop;
    return st;
  }

  // ── Keyed, identity-preserving update ─────────────────────────
  // A root rewritten through innerHTML replaces the nodes a plain FLIP measured,
  // so neighbours just jumped. morph() keeps every child that carries the same
  // data-key (only its attributes and contents are brought up to date), inserts
  // new keys, removes missing ones and fixes the order. Children without a
  // data-key are always replaced. Returns the nodes it created.
  function syncAttrs(cur, n) {
    var i, a;
    var have = cur.attributes ? Array.prototype.slice.call(cur.attributes) : [];
    for (i = 0; i < have.length; i++) {
      if (!n.hasAttribute(have[i].name)) cur.removeAttribute(have[i].name);
    }
    var want = n.attributes ? Array.prototype.slice.call(n.attributes) : [];
    for (i = 0; i < want.length; i++) {
      a = want[i];
      if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
    }
  }
  function morph(root, html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var old = {}, kids = Array.prototype.slice.call(root.children);
    kids.forEach(function (c) {
      var k = c.dataset && c.dataset.key;
      if (k) old[k] = c; else c.remove();
    });
    var added = [], prev = null;
    Array.prototype.slice.call(tpl.content.children).forEach(function (n) {
      var k = n.dataset && n.dataset.key, cur = k ? old[k] : null;
      if (cur) {
        delete old[k];
        if (cur.attributes && n.attributes) syncAttrs(cur, n); else if (cur.className !== n.className) cur.className = n.className;
        if (cur.innerHTML !== n.innerHTML) cur.innerHTML = n.innerHTML;
        n = cur;
      } else added.push(n);
      var ref = prev ? prev.nextSibling : root.firstChild;
      if (ref !== n) root.insertBefore(n, ref);
      prev = n;
    });
    Object.keys(old).forEach(function (k) { old[k].remove(); });
    return added;
  }

  // Snapshot rects BY KEY, morph, then spring every surviving node back from its
  // old place. Calm: the survivors simply jump (play(..., {calm:false})).
  function flipKeyed(root, html, name) {
    var before = {};
    Array.prototype.forEach.call(root.children, function (c) {
      var k = c.dataset && c.dataset.key;
      if (k) { var r = c.getBoundingClientRect(); before[k] = { x: r.left, y: r.top }; }
    });
    var added = morph(root, html);
    Array.prototype.forEach.call(root.children, function (c) {
      var k = c.dataset && c.dataset.key, b = k && before[k];
      if (!b) return;
      var r = c.getBoundingClientRect(), dx = b.x - r.left, dy = b.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      play(c, name || 'glide', function (x) { return { transform: 'translate(' + dx * (1 - x) + 'px,' + dy * (1 - x) + 'px)' }; }, { calm: false, layer: true });
    });
    return added;
  }

  // For the rare unavoidable in-place change inside a setHtmlIfChanged root.
  function restamp(root) { if (root) root.__dom = root.innerHTML; }

  // ── Never move a row under a thumb ────────────────────────────
  // A list reflow waits until no pointer is down and 400 ms have passed since
  // the last touch: when another director saves, the row somebody is about to
  // tap must not slide 75 px under their finger.
  var HANDS_OFF_MS = 400, STALE_DOWN_MS = 10000;
  var downAt = {}, lastTouch = 0;
  function touchedNow() { lastTouch = nowMs(); }
  function pointersDown() {
    var t = nowMs(), n = 0;
    Object.keys(downAt).forEach(function (id) {
      if (t - downAt[id] > STALE_DOWN_MS) delete downAt[id]; // a lost pointerup must not freeze lists forever
      else n++;
    });
    return n;
  }
  function whenHandsOff(fn) {
    (function check() {
      if (pointersDown() > 0 || nowMs() - lastTouch < HANDS_OFF_MS) { setTimeout(check, 120); return; }
      fn();
    })();
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', function (e) { downAt[e.pointerId == null ? 0 : e.pointerId] = nowMs(); touchedNow(); }, { capture: true, passive: true });
    var up = function (e) { delete downAt[e.pointerId == null ? 0 : e.pointerId]; touchedNow(); };
    document.addEventListener('pointerup', up, { capture: true, passive: true });
    document.addEventListener('pointercancel', up, { capture: true, passive: true });
    document.addEventListener('visibilitychange', function () { if (document.hidden) downAt = {}; });
  }

  // ── The press dent ────────────────────────────────────────────
  // Down: in 70 ms the control dents TOWARD THE FINGER (transform-origin at the
  // touch point, a few degrees of skew toward the pressed side, ~12% squash).
  // Up: the wobble spring brings it back and rings ~3.6% past rest, the way a
  // pressed jelly-button bulges. All WAAPI. The hold is the one place fill
  // 'forwards' is allowed, and release always cancels it. Whole cards and scroll
  // containers are never press-scaled (the caller picks the targets).
  // A control wider than ~160 px (a full-width list row) gets a proportionally
  // gentler dent: 6% of 358 px is a 21 px sideways bulge past the gutter.
  var pressState = running ? new WeakMap() : null;
  var PRESS_CALM_OPACITY = 0.85;
  function pressFrame(p, q) {
    return {
      transform: 'translateY(' + (p.deep * q) + 'px) skewX(' + (-p.tilt * 0.6 * q) + 'deg) scale(' + (1 + 0.06 * p.amp * q) + ',' + (1 - 0.12 * p.amp * q) + ')',
      transformOrigin: p.origin,
    };
  }
  function press(el, point) {
    if (!canAnimate(el) || !pressState) return null;
    var r = el.getBoundingClientRect();
    var w = r.width || 1, h = r.height || 1;
    var ox = point && point.x != null ? Math.max(0, Math.min(1, (point.x - r.left) / w)) : 0.5;
    var oy = point && point.y != null ? Math.max(0, Math.min(1, (point.y - r.top) / h)) : 0.5;
    var p = {
      origin: Math.round(ox * 100) + '% ' + Math.round(oy * 100) + '%',
      tilt: (ox - 0.5) * 5,
      deep: 4,
      amp: Math.min(1, 160 / w),
    };
    pressState.set(el, p);
    var prev = running.get(el);
    if (prev) { try { prev.cancel(); } catch (e) { /* already gone */ } }
    var a;
    if (calmMotion()) {
      // Feedback, not motion: the control dims while held.
      a = el.animate([{ opacity: 1 }, { opacity: PRESS_CALM_OPACITY }], { duration: 60, fill: 'forwards' });
    } else {
      a = el.animate([pressFrame(p, 0), pressFrame(p, 1)], { duration: 70, easing: 'ease-out', fill: 'forwards' });
    }
    running.set(el, a);
    return track(a);
  }
  // release(el, {fromRest}): fromRest = the press never painted (a tap quicker
  // than the caller's press delay). Popping from the pressed state would snap
  // the control in one frame, so that pop starts at rest, dips partway, rings.
  function release(el, o) {
    if (!canAnimate(el) || !pressState) return null;
    var p = pressState.get(el) || { origin: '50% 50%', tilt: 0, deep: 4, amp: 1 };
    pressState.delete(el);
    var prev = running.get(el);
    if (prev) { try { prev.cancel(); } catch (e) { /* already gone */ } }
    var fromRest = !!(o && o.fromRest);
    if (calmMotion()) {
      var ca = el.animate([{ opacity: fromRest ? 1 : PRESS_CALM_OPACITY }, { opacity: 1 }], { duration: 120, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' });
      running.set(el, ca);
      return track(ca);
    }
    if (!fromRest) {
      return play(el, 'wobble', function (x) { return pressFrame(p, 1 - x); }, { calm: false });
    }
    var s = sample('wobble'), n = s.xs.length - 1, ramp = 50, total = ramp + Math.round(n * DT * 1000), cut = ramp / total;
    var kf = [Object.assign(pressFrame(p, 0), { offset: 0 }), Object.assign(pressFrame(p, 0.5), { offset: cut })];
    for (var i = 1; i <= n; i++) kf.push(Object.assign(pressFrame(p, 0.5 * (1 - s.xs[i])), { offset: cut + (i / n) * (1 - cut) }));
    var a = el.animate(kf, { duration: total, easing: 'linear', fill: 'backwards' });
    running.set(el, a);
    return track(a);
  }

  // The calm stand-in for confetti: one soft gold ring, no movement.
  function ring(el) {
    if (!canAnimate(el)) return null;
    var a = el.animate([
      { boxShadow: '0 0 0 0 rgba(247,185,40,0)' },
      { boxShadow: '0 0 0 6px rgba(247,185,40,.55)' },
      { boxShadow: '0 0 0 0 rgba(247,185,40,0)' },
    ], { duration: 700, easing: 'ease-out' });
    return track(a);
  }

  // ═════════════════════════════════════════════════════════════
  // Calm motion
  // ═════════════════════════════════════════════════════════════
  var PREF_KEY = 'campScoreboardCalmMotion';  // 'auto' | 'on' | 'off'
  var LAST_KEY = 'campScoreboardCalmLast';    // the last computed reason; absent = not calm
  var REASONS = ['switch-on', 'switch-off', 'os', 'battery-saver', 'battery-low'];
  var HELD = ['battery-saver', 'battery-low'];  // the reasons hysteresis may hold
  var OFF_AFTER_MS = 60000;                     // calm ends only after a minute without a signal
  var SAVER_HZ = 36, FULL_HZ = 50;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked: the guard just can't pre-paint it */ } }

  var pref = (function () { var v = lsGet(PREF_KEY); return v === 'on' || v === 'off' ? v : 'auto'; })();
  var inputs = { os: false, saver: false, batteryLow: false };
  var streak = { low: 0, high: 0 };
  var lastSignalAt = -Infinity;
  var calmNow = false, calmWhy = null, held = null;
  var holdTimer = 0;

  // The truth table, pure.
  //   OS prefers-reduced-motion  -> calm, whatever the switch says
  //   pref 'on'                  -> calm
  //   pref 'off'                 -> not calm (overrides the battery signals only)
  //   pref 'auto'                -> calm if the frame-rate sampler says <= 36 Hz
  //                                 or the battery is <= 20% and not charging
  // Returns { calm, reason }; reason is the one that applies ('switch-off' when
  // Off is chosen and nothing forces calm), or null for plain Auto.
  function decide(i) {
    if (i.os) return { calm: true, reason: 'os' };
    if (i.pref === 'on') return { calm: true, reason: 'switch-on' };
    if (i.pref === 'off') return { calm: false, reason: 'switch-off' };
    if (i.saver) return { calm: true, reason: 'battery-saver' };
    if (i.batteryLow) return { calm: true, reason: 'battery-low' };
    return { calm: false, reason: null };
  }

  // Recompute, apply what changed. Calm turns on at once; it turns off only
  // after OFF_AFTER_MS without a battery signal, so a phone near the threshold
  // doesn't flap (hysteresis applies to the AUTO signals only: the OS setting
  // and the switch act immediately in both directions).
  function refresh(at) {
    at = at == null ? JM.now() : at;
    var d = decide({ os: inputs.os, pref: pref, saver: inputs.saver, batteryLow: inputs.batteryLow });
    if (d.reason === 'battery-saver' || d.reason === 'battery-low') {
      held = d.reason; lastSignalAt = at;
    } else if (pref !== 'auto') {
      held = null;                                  // the switch decided; an old hold no longer applies
    } else if (!d.calm && held) {
      if (at - lastSignalAt < OFF_AFTER_MS) {
        d = { calm: true, reason: held };
        clearTimeout(holdTimer);
        holdTimer = setTimeout(function () { refresh(); }, OFF_AFTER_MS - (at - lastSignalAt) + 50);
      } else held = null;
    }
    var changed = d.calm !== calmNow || d.reason !== calmWhy;
    calmNow = d.calm; calmWhy = d.reason;
    if (changed) apply();
    return calmNow;
  }
  // Writes the verdict everywhere it is read. Also called once at boot even
  // when nothing changed, because boot-guard may have painted a calm first frame
  // from LAST_KEY that this session's inputs no longer justify.
  function apply() {
    lsSet(LAST_KEY, calmNow ? calmWhy : null);
    if (typeof document === 'undefined' || !document.documentElement) return;
    var root = document.documentElement;
    root.classList.toggle('calm-motion', calmNow);
    // Jelly's canvas components, springIn/springOut, toasts, tabs and
    // collapsibles read this attribute (vendor/jelly.js F()) and re-read it on
    // the window event below.
    root.setAttribute('data-jelly-motion', calmNow ? 'reduce' : 'no-preference');
    try {
      var ev = typeof Event === 'function' ? new Event('jelly-motion-change') : null;
      if (ev && G.dispatchEvent) G.dispatchEvent(ev);
    } catch (e) { /* no Event: nothing to announce to */ }
  }

  function calmMotion() { return calmNow; }
  function calmReason() { return calmWhy; }

  function setPref(v) {
    pref = v === 'on' || v === 'off' ? v : 'auto';
    lsSet(PREF_KEY, pref === 'auto' ? null : pref);
    // The switch is a deliberate act: it wins at once, in both directions.
    held = null; lastSignalAt = -Infinity;
    return refresh();
  }

  // ── Detection ─────────────────────────────────────────────────
  // Frame-rate sampler (iOS Low Power Mode and Chrome Energy Saver cap rAF at
  // ~30 Hz): 24 consecutive rAF intervals, the median. It never runs during
  // motion: it waits while busy() and abandons a sample if something starts
  // moving halfway, because a sample taken mid-animation reads the animation.
  function medianHz(stamps) {
    var d = [];
    for (var i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
    d.sort(function (a, b) { return a - b; });
    var med = d[Math.floor(d.length / 2)];
    return med > 0 ? 1000 / med : Infinity;
  }
  // <= 36 Hz twice in a row -> saver on; >= 50 Hz twice in a row -> off. 120 Hz
  // phones read ~120. A reading in between resets both streaks.
  function observeHz(hz) {
    if (hz <= SAVER_HZ) { streak.low++; streak.high = 0; }
    else if (hz >= FULL_HZ) { streak.high++; streak.low = 0; }
    else { streak.low = 0; streak.high = 0; }
    if (streak.low >= 2) inputs.saver = true;
    if (streak.high >= 2) inputs.saver = false;
    return refresh();
  }
  var samplerTimer = 0;
  function sampleSoon(ms) { clearTimeout(samplerTimer); samplerTimer = setTimeout(sampleNow, ms == null ? 1500 : ms); }
  // Returns 'waiting' (busy / hidden: retried), or 'sampling'.
  function sampleNow() {
    if (typeof requestAnimationFrame !== 'function') return 'waiting';
    if ((typeof document !== 'undefined' && document.hidden) || busy()) { sampleSoon(1500); return 'waiting'; }
    var stamps = [];
    (function frame(ts) {
      if (busy()) { sampleSoon(1500); return; }                 // something started moving: abandon
      stamps.push(typeof ts === 'number' ? ts : nowMs());
      if (stamps.length < 25) { requestAnimationFrame(frame); return; }  // 25 stamps = 24 intervals
      observeHz(medianHz(stamps));
      sampleSoon(5 * 60 * 1000);                                // and every 5 minutes while visible
    })();
    return 'sampling';
  }

  function setOs(v) { inputs.os = !!v; return refresh(); }
  function setBattery(b) {
    inputs.batteryLow = !!(b && typeof b.level === 'number' && b.level <= 0.2 && !b.charging);
    return refresh();
  }

  function init() {
    // The OS setting, live.
    try {
      var mq = typeof G.matchMedia === 'function' ? G.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mq) {
        inputs.os = !!mq.matches;
        var onOs = function () { setOs(mq.matches); };
        if (mq.addEventListener) mq.addEventListener('change', onOs);
        else if (mq.addListener) mq.addListener(onOs); // Safari < 14
      }
    } catch (e) { /* no matchMedia: the switch and the sampler still work */ }
    // A battery-saver verdict from the last session is held until a minute has
    // passed without a signal (boot-guard already painted it, so the first frame
    // was calm; flipping it off before the sampler's first read would flap).
    var last = lsGet(LAST_KEY);
    if (pref === 'auto' && !inputs.os && HELD.indexOf(last) >= 0) { held = last; lastSignalAt = JM.now(); }
    refresh();
    apply();
    // Battery (Android Chrome only; absent elsewhere, never polled).
    try {
      if (typeof navigator !== 'undefined' && navigator.getBattery) {
        navigator.getBattery().then(function (b) {
          setBattery(b);
          var on = function () { setBattery(b); };
          b.addEventListener('levelchange', on);
          b.addEventListener('chargingchange', on);
        }).catch(function () { /* the Battery API is optional */ });
      }
    } catch (e) { /* ditto */ }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) sampleSoon(1500); });
    }
    sampleSoon(2000); // 2 s after boot, when idle
  }

  var JM = {
    presets: PRESETS,
    calm: calmMotion,
    calmReason: calmReason,
    sample: sample,
    durationMs: durationMs,
    cssLinear: cssLinear,
    play: play,
    playOut: playOut,
    follow: follow,
    morph: morph,
    flipKeyed: flipKeyed,
    whenHandsOff: whenHandsOff,
    press: press,
    release: release,
    ring: ring,
    busy: busy,
    busySource: busySource,
    restamp: restamp,
    // calm internals, exposed because tests (and the Settings line) drive them
    pref: function () { return pref; },
    setPref: setPref,
    decide: decide,
    refresh: refresh,
    observeHz: observeHz,
    medianHz: medianHz,
    sampleNow: sampleNow,
    setOs: setOs,
    setBattery: setBattery,
    now: function () { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); },
    keys: { pref: PREF_KEY, last: LAST_KEY },
    reasons: REASONS,
    offAfterMs: OFF_AFTER_MS,
  };

  G.JellyMotion = JM;
  G.calmMotion = calmMotion;
  G.calmReason = calmReason;
  init();
})();
