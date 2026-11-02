// ── reveal-ui.js — the standings reveal's SCREENS (redesign §4.1, §4.8–4.10, build plan Step 23) ──
// What every phone and the director's remote DRAW for a reveal. reveal.js (the engine) knows what is true and
// when it changes; this file paints it, through the static markup the design pass put in index.html (the
// comments there name every hook) and the styles in styles.css's THE STANDINGS REVEAL block. Same contract as
// chat.js / push.js / setup-ui.js: a classic script (loaded right after reveal.js), every hook into it from
// app.js is typeof-guarded, and deleting its <script> leaves a running app and an engine that paints nothing.
//
// THE RULES THIS FILE LIVES BY
//  - SECRECY. A counselor's screens (the Now mirror, the frozen grid, the header strip, the tab dot, the
//    champion line) read the reveal through reveal.js's revealMirrorView() / revealLiveView() /
//    revealGridView() / revealChampionLine() ONLY — reveal-core's revealView, which fails closed. Nothing here
//    reads state, medalCounts or a points helper for a phone's screen, and a counselor's phone never builds
//    the remote's model (that touches the private freeze). The director's live standings stay in Games.
//  - Markup is STABLE STRINGS written through setHtmlIfChanged (or a keyed morph), never animation classes;
//    motion starts from a diff (the ledger below), never from a render. Everything text, hidden or data-*
//    patches only when it differs, so an idle renderAll writes nothing here.
//  - Every database string is laundered before markup: names come out of normalizeRevealPub already cleaned
//    and go through esc(); a team mark is teamMarkHtml(id), whose image address is a shipped crest or null.
//  - Everything that moves is a JellyMotion preset and honours calm motion (opacity only, no transform).
//  - Names are all `revealUi…` / `renderReveal…` so they cannot collide with reveal.js / reveal-core.js
//    (one global scope).

const revealUi = {
  wired: false,
  ledger: {},          // §9.8: what each animated thing last animated to; a first sighting records and never plays
  timer: null,         // the next moment the remote's own words change with no snapshot (a countdown second, a beat)
  lastLive: undefined,  // undefined: never evaluated; '': evaluated, not live; else the live reveal's id
  once: {},
};

function revealUiEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }

// data-* written only when it differs (a same-value write is still a mutation record).
function revealUiData(el, k, v) {
  if (!el || !el.dataset) return;
  if (v === null || v === undefined || v === false) {
    if (Object.prototype.hasOwnProperty.call(el.dataset, k) || k in el.dataset) delete el.dataset[k];
  } else {
    const s = v === true ? '' : String(v);
    if (el.dataset[k] !== s) el.dataset[k] = s;
  }
}

function revealUiAttr(el, name, v) {
  if (!el) return;
  if (v === null || v === undefined || v === false) { if (el.getAttribute(name) !== null) el.removeAttribute(name); }
  else { const s = v === true ? '' : String(v); if (el.getAttribute(name) !== s) el.setAttribute(name, s); }
}

// A time of day in camp time: "7:31" or, with `period`, "7:31 PM". Never the device's own zone, and never the
// narrow no-break space newer engines put before PM.
function revealUiClock(ms, period) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms));
    const get = (t) => ((parts.find((p) => p.type === t) || {}).value || '').replace(/[  ]/g, ' ');
    return get('hour') + ':' + get('minute') + (period ? ' ' + get('dayPeriod').toUpperCase() : '');
  } catch (e) { return ''; }
}

// "until 8 AM" the same morning, "until 8 AM tomorrow" otherwise (a reveal that ended after midnight is
// hidden at 8 AM that same day).
function revealUiUntilWords(untilMs) {
  const now = serverNow();
  return revealYmdOf(untilMs) === revealYmdOf(now) ? 'until 8 AM' : 'until 8 AM tomorrow';
}

function revealUiOrdHtml(n) {
  const w = ordinal(n);
  const d = String(n);
  return d + '<sup>' + w.slice(d.length) + '</sup>';
}

function revealUiMine() { return state && state.followTeam ? state.followTeam : null; }

function revealUiCalm() { return typeof calmMotion === 'function' && calmMotion(); }
function revealUiVisible() { return typeof document !== 'undefined' && !document.hidden; }

// §9.8: animate only when the value this thing last animated to differs, and never on the first sighting (a
// reload, a late join and a tab that was never open play nothing).
function revealUiNote(key, value) {
  const had = Object.prototype.hasOwnProperty.call(revealUi.ledger, key);
  const changed = had && revealUi.ledger[key] !== value;
  revealUi.ledger[key] = value;
  return changed;
}
// True the first time a key is asked about (a one-off moment that must never repeat for the same reveal).
function revealUiOnce(key) {
  if (revealUi.once[key]) return false;
  revealUi.once[key] = true;
  return true;
}

// ════════════════════════════════════════════════════════════════════
// ROWS (one shape for the remote ladder, the Now mirror and the grid: ROW MARKUP at #now-reveal in index.html)
// ════════════════════════════════════════════════════════════════════
function revealUiMedals(e) {
  return '<span>' + e.g + ' gold</span> · <span>' + e.s + ' silver</span> · <span>' + e.b + ' bronze</span>';
}
function revealUiExtras(e) {
  return '<span>verse ' + e.v + '</span> · <span>cleanup ' + e.m + '</span> · <span>quick ' + e.c + '</span>';
}

// One team's line. kind: 'mirror' | 'grid' | 'remote'. The remote's CSS leaves the counts out, so its markup does too.
function revealUiTeamHtml(kind, e, mine) {
  const name = kind === 'grid' ? (teamShort(e.id) || e.nm) : e.nm;
  const you = kind !== 'remote' && mine && mine === e.id ? '<span class="rv-you">Your team</span>' : '';
  const counts = kind === 'remote' ? '' : '<small class="rv-medals">' + revealUiMedals(e) + '</small>' + (kind === 'grid' ? '<small class="rv-extra">' + revealUiExtras(e) + '</small>' : '');
  return '<div class="rv-team" data-team="' + esc(e.id) + '"><span class="rv-mark">' + teamMarkHtml(e.id, { size: kind === 'remote' ? 32 : 34 }) + '</span>' +
    '<span class="rv-nm"><b class="rv-name">' + esc(name) + '</b>' + you + counts + '</span>' +
    '<span class="rv-pts">' + e.p + '<small> points</small></span></div>';
}

const REVEAL_UI_ICON = (id) => '<svg class="ico" aria-hidden="true"><use href="#' + id + '"/></svg>';

// A revealed place. g = { place, tie, entries }. o = { kind, mine, onscreen, champion }.
function revealUiShownRowHtml(g, o) {
  const crown = o.champion ? '<svg class="ico rv-crown" aria-hidden="true"><use href="#i-crown"/></svg>' : '';
  const tie = g.tie ? '<em class="rv-tie">tie</em>' : '';
  const os = o.onscreen && o.kind !== 'grid' ? '<span class="rv-os">On the big screen now</span>' : '';
  return '<div class="rv-row" role="listitem" data-key="g' + g.place + '" data-state="shown"' + (o.onscreen ? ' data-onscreen' : '') + (o.champion ? ' data-champion' : '') + '>' +
    '<span class="rv-pl">' + crown + revealUiOrdHtml(g.place) + tie + '</span>' +
    '<div class="rv-teams">' + g.entries.map((e) => revealUiTeamHtml(o.kind, e, o.mine)).join('') + os + '</div></div>';
}

function revealUiStillRowHtml(i, label, state) {
  return '<div class="rv-row" role="listitem" data-key="' + (state === 'unrevealed' ? 'unrev-' : 'still-') + i + '" data-state="' + state + '">' + REVEAL_UI_ICON('i-lock') + '<span class="rv-msg">' + esc(label) + '</span></div>';
}

function revealUiLookingRowHtml() {
  return '<div class="rv-row" role="listitem" data-key="look" data-state="looking">' + REVEAL_UI_ICON('i-tv') + '<span class="rv-msg">Look at the big screen</span><span class="rv-os">On the big screen now</span></div>';
}

// The Now mirror (a counselor's, or a director's) from a live revealView: the teams still to come first (one row
// per TEAM, no place numbers, so a tie cannot be read off the count), then the revealed places, best first. While
// the newest place is held back for the 3 s the room sees it first, one of the still rows becomes "Look at the big
// screen", right where the place will land.
function revealUiMirrorHtml(v, mine) {
  const out = [];
  const stills = Math.max(0, v.remaining - (v.looking ? 1 : 0));
  for (let i = 0; i < stills; i++) out.push(revealUiStillRowHtml(i, 'Still to come', 'still'));
  if (v.looking) out.push(revealUiLookingRowHtml());
  v.rows.forEach((g) => {
    out.push(revealUiShownRowHtml(g, { kind: 'mirror', mine, onscreen: v.onScreen === g.place, champion: !!(v.champion && g.place === 1) }));
  });
  return out.join('');
}

// The frozen grid (mockup 05b) from a view that is no longer live: a place never shown reads "Not revealed", one row
// per team still hidden (a count of teams, never of groups).
function revealUiGridHtml(v, mine) {
  const out = [];
  for (let i = 0; i < v.remaining; i++) out.push(revealUiStillRowHtml(i, 'Not revealed', 'unrevealed'));
  v.rows.forEach((g) => {
    out.push(revealUiShownRowHtml(g, { kind: 'grid', mine, onscreen: false, champion: !!(v.champion && g.place === 1) }));
  });
  return out.join('');
}

// ════════════════════════════════════════════════════════════════════
// PAINTING A KEYED LIST (the one place a row list is written)
// ════════════════════════════════════════════════════════════════════
// First paint, or a tab that is not on screen, is a plain write (setHtmlIfChanged: an idle pass writes nothing). A
// change on a list that is already drawn MORPHS it by data-key — the surviving rows are the same nodes, so they glide
// and a landing row is new — and hands the rows it created to `after`. `handsOff` waits until no finger is down
// (the mirror: never move a row under a reader's thumb); the director's own ladder does not wait, its finger is on the
// dock, not on the list.
function revealUiPaintList(root, html, o) {
  if (!root) return false;
  o = o || {};
  if (root.__html === html && root.__dom === root.innerHTML) return false;
  if (root.__rvPending === html) return false;
  const drawn = root.__html !== undefined && root.children && root.children.length > 0;
  const mayMove = drawn && o.animate !== false && revealUiVisible() && typeof JellyMotion !== 'undefined' && JellyMotion.flipKeyed;
  if (!mayMove) { root.__rvPending = null; return setHtmlIfChanged(root, html); }
  const run = () => {
    if (root.__rvPending !== html) return;
    root.__rvPending = null;
    let added = [];
    try { added = JellyMotion.flipKeyed(root, html, 'glide') || []; } catch (e) { root.innerHTML = html; }
    root.__html = html;
    root.__dom = root.innerHTML;
    if (o.after) o.after(added, root);
  };
  root.__rvPending = html;
  if (o.handsOff && JellyMotion.whenHandsOff) JellyMotion.whenHandsOff(run); else run();
  return true;
}

// ── motion: a place lands (§9.5) ─────────────────────────────────────
// "Look at the big screen" arrives where the place will land (scaleY .5 → 1 with the overshoot as a squash); a row
// that becomes a place unwraps from flat on `wobble` and its shield drops. Calm: a fade (play's default), nothing moves.
function revealUiArrive(node, big) {
  if (!node || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(node, big ? 'wobble' : 'arrive', (x) => {
    const o = Math.max(0, x - 1);
    return big
      ? { transform: 'scale(' + (1.05 - 0.05 * Math.min(1, x)) + ',' + (0.55 + 0.45 * Math.min(1, x) - 0.2 * o) + ')', transformOrigin: '50% 0' }
      : { transform: 'scaleY(' + (0.5 + 0.5 * Math.min(1, x) - 0.25 * o) + ')', transformOrigin: '50% 0' };
  }, { calmMs: 200 });
}

// A shield (or a pair) dropping into place: translateY(-26 → 0) with the overshoot as a landing squash.
function revealUiDrop(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'wobble', (x) => {
    const o = Math.max(0, x - 1);
    return { transform: 'translateY(' + (-26 * (1 - Math.min(1, x))) + 'px) scale(' + (1 + 0.1 * o) + ',' + (1 - 0.18 * o) + ')', transformOrigin: '50% 100%' };
  }, { calm: false });
}
function revealUiDropMark(node) {
  revealUiDrop(node && node.querySelector ? node.querySelector('.rv-mark') : null);
}

function revealUiRollPoints(node) {
  const pts = node && node.querySelector ? node.querySelector('.rv-pts') : null;
  if (!pts || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(pts, 'press', (x) => ({ transform: 'translateY(' + (16 * (1 - Math.min(1, x))) + 'px)' }), { calm: false, delay: 120 });
}

function revealUiLanded(added, o) {
  (added || []).forEach((n) => {
    const st = n && n.dataset ? n.dataset.state : '';
    if (st === 'looking') revealUiArrive(n, false);
    else if (st === 'shown') {
      revealUiArrive(n, true);
      revealUiDropMark(n);
      revealUiRollPoints(n);
      // Your team's place landing: a burst in the team's colours (calm: one soft ring). The ledger makes it once.
      if (o && o.mine && n.querySelector && n.querySelector('.rv-you') && revealUiOnce('you:' + o.rid + ':' + n.dataset.key)) {
        const r = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
        const x = r ? r.left + r.width / 2 : null;
        const y = r ? r.top + r.height / 2 : null;
        try { if (revealUiCalm()) { if (typeof joyRing === 'function') joyRing(x, y); } else if (typeof joyBurst === 'function') joyBurst(x, y, true); } catch (e) { /* a burst is a treat */ }
      }
    }
  });
}

// The crown drops and wobbles over a finale's 1st place, with confetti (calm: the crown fades in, a gold ring).
function revealUiCrownMoment(root) {
  const crown = root && root.querySelector ? root.querySelector('.rv-crown') : null;
  if (crown && typeof JellyMotion !== 'undefined') {
    JellyMotion.play(crown, 'wobble', (x) => ({ transform: 'translateY(' + (-30 * (1 - Math.min(1, x))) + 'px) rotate(' + (-20 * (1 - Math.min(1, x))) + 'deg)' }), { calmMs: 200 });
  }
  // The confetti is a treat, never a dependency: a canvas that will not draw must not cost a place on the screen.
  try {
    if (revealUiCalm()) { if (typeof joyRing === 'function') joyRing(null, null); } else if (typeof celebrate === 'function') celebrate(null);
  } catch (e) { /* no confetti */ }
}

// ════════════════════════════════════════════════════════════════════
// THE PHONES' SURFACES: Now's mirror, the frozen grid, the header strip, the tab dot, the champion line
// ════════════════════════════════════════════════════════════════════
function revealUiTotal(v) {
  const shown = v.rows.reduce((n, r) => n + r.entries.length, 0);
  return { shown, total: shown + v.remaining };
}

// The reveal is the director's own work: they see live standings in Games and no frozen grid (§4.1).
function revealUiIsDirector() { return memberRole === 'editor'; }

// "Happening now", the current block shrunk to one row under the mirror. Read from the schedule accessors, which are
// the one door to the week's data; plain text only.
function revealUiHappening() {
  let blocks = [];
  let now;
  try { now = campNow(); blocks = scheduleForDow(now.dow) || []; } catch (e) { return null; }
  const found = blocks.find((b) => now.minutes >= b.start && now.minutes < b.end);
  if (!found) return null;
  const after = blocks.find((b) => b.start >= found.end);
  const sub = [found.noTime ? '' : 'until ' + schedClock(found.end, false), after ? 'next: ' + after.label : ''].filter(Boolean).join(' · ');
  return { time: found.noTime ? '' : schedClock(found.start, false), emoji: found.emoji || '', label: found.label, sub };
}

function renderRevealMirror() {
  const root = revealUiEl('now-reveal');
  const tab = revealUiEl('tab-now');
  if (!root) return;
  const v = revealLiveView();
  const live = !!v;
  setHiddenIfChanged(root, !live);
  revealUiData(tab, 'reveal', live ? 'live' : null);
  const prev = revealUi.lastLive;
  revealUi.lastLive = live ? v.id : '';
  if (!live) {
    // The places shown leave the page with the mirror: a hidden list is not a place to keep numbers (the grid is the one
    // surface that holds them after the final table, until 8 AM).
    setHtmlIfChanged(revealUiEl('now-reveal-list'), '');
    return;
  }
  const mine = revealUiMine();
  const t = revealUiTotal(v);
  const active = activeTab() === 'now' && !builderOpen();
  setTextIfChanged(revealUiEl('now-reveal-started'), 'Started ' + revealUiClock(v.startedAt, false));
  setTextIfChanged(revealUiEl('now-reveal-count'), t.shown + ' of ' + t.total + ' shown');
  revealUiPaintList(revealUiEl('now-reveal-list'), revealUiMirrorHtml(v, mine), {
    animate: active, handsOff: true, after: (added) => revealUiLanded(added, { mine, rid: v.id }),
  });
  // The panel appears while this phone is looking at Now: it unfolds from its top (never on a cold load: prev is undefined).
  if (prev === '' && active && typeof JellyMotion !== 'undefined') {
    JellyMotion.play(root, 'arrive', (x) => {
      const o = Math.max(0, x - 1);
      return { transform: 'scaleY(' + (0.6 + 0.4 * Math.min(1, x) - 0.3 * o) + ')', transformOrigin: '50% 0' };
    }, { calmMs: 160 });
  }
  // A champion crowned in front of the whole camp: the crown drops (once, and only for a phone that was watching).
  if (revealUiNote('champ:' + v.id, !!v.champion) && v.champion && active) revealUiCrownMoment(revealUiEl('now-reveal-list'));
  setHiddenIfChanged(revealUiEl('now-reveal-remote'), !revealRemoteMayOpen());
  const hn = revealUiHappening();
  setHiddenIfChanged(revealUiEl('now-reveal-happening'), !hn);
  if (hn) {
    setTextIfChanged(revealUiEl('now-reveal-hn-time'), hn.time);
    setTextIfChanged(revealUiEl('now-reveal-hn-emoji'), hn.emoji);
    setTextIfChanged(revealUiEl('now-reveal-hn-label'), hn.label);
    setTextIfChanged(revealUiEl('now-reveal-hn-sub'), hn.sub);
  }
}

// One section for the frozen grid, Now's or Games' (the same rows, their own ids).
function revealUiPaintGrid(prefix, v, mine) {
  const root = revealUiEl(prefix + '-reveal-grid');
  if (!root) return;
  const show = !!v;
  setHiddenIfChanged(root, !show);
  if (!show) { setHtmlIfChanged(revealUiEl(prefix + '-reveal-grid-list'), ''); return; }
  const tonight = revealYmdOf(v.startedAt) === revealYmdOf(serverNow());
  setTextIfChanged(revealUiEl(prefix + '-reveal-grid-title'), tonight ? 'Tonight’s standings' : 'Last night’s standings');
  setTextIfChanged(revealUiEl(prefix + '-reveal-grid-sub'), 'Revealed ' + revealUiClock(v.startedAt, true) + ' · hides at 8 AM');
  revealUiPaintList(revealUiEl(prefix + '-reveal-grid-list'), revealUiGridHtml(v, mine), { animate: false });
}

function renderRevealGrids() {
  // A director sees live standings, not the frozen copy (§4.1); a counselor sees only what a reveal has shown.
  const v = revealUiIsDirector() ? null : revealGridView();
  const mine = revealUiMine();
  revealUiPaintGrid('now', v, mine);
  revealUiPaintGrid('games', v, mine);
}

function renderRevealChampion() {
  const root = revealUiEl('now-champion');
  if (!root) return;
  const line = revealChampionLine();
  // Beside the grid it would say the same thing twice, and during the live mirror it is the surprise.
  const grid = !revealUiIsDirector() && revealGridView();
  const show = !!line && !grid && !revealLiveView();
  setHiddenIfChanged(root, !show);
  if (!show) return;
  setHtmlIfChanged(revealUiEl('now-champion-mark'), line.map((c) => teamMarkHtml(c.id, { size: 34 })).join(''));
  setTextIfChanged(revealUiEl('now-champion-name'), line.map((c) => c.name).join(' and '));
}

// The red "Live on the big screen" strip in the header (every tab but Now, which has its own; a takeover covers the
// header) and the red dot on the Now tab. The strip's appearance moves the page down by its own height, so a reader who
// has scrolled keeps the line they were on.
function renderRevealStrip() {
  const strip = revealUiEl('reveal-strip');
  const dot = revealUiEl('tab-dot-now');
  const v = revealLiveView();
  const away = !!v && activeTab() !== 'now';
  if (strip) {
    if (strip.hidden === away) {
      // It is about to appear or go: the header grows or shrinks by its own height. Measured only now (an idle pass reads
      // no layout), and a reader who has scrolled is moved by the same amount, so the line they were on stays put.
      const hdr = revealUiEl('app-header');
      const before = hdr ? hdr.offsetHeight : 0;
      strip.hidden = !away;
      if (hdr && typeof window !== 'undefined' && (window.scrollY || 0) > 2 && activeTab() !== 'chat') {
        const delta = hdr.offsetHeight - before;
        if (delta) window.scrollBy(0, delta);
      }
    }
    if (v) {
      const t = revealUiTotal(v);
      setTextIfChanged(revealUiEl('reveal-strip-count'), t.shown ? t.shown + ' of ' + t.total + ' shown' : '');
    }
  }
  setHiddenIfChanged(dot, !away);
}

// More → Run the reveal: the one gold row. Words, never a count of screens (the big screen is public and cannot report in).
function renderRevealMoreRow() {
  const row = revealUiEl('reveal-row');
  if (!row) return;
  const director = revealUiIsDirector();
  setHiddenIfChanged(row, !director || !revealRemoteMayOpen());
  if (!director) return;
  let st = 'ready';
  let text = 'Ready';
  if (revealDenied) { st = 'blocked'; text = 'Not switched on yet'; }
  else {
    const real = revealRemoteView('real');
    const prac = revealRemoteView('practice');
    if (real && real.live) { const t = revealUiTotal(real); st = 'live'; text = 'Live · ' + t.shown + ' of ' + t.total + ' shown'; }
    else if (prac && prac.live) { st = 'practice'; text = 'Practice on the big screen'; }
  }
  revealUiData(row, 'state', st);
  setTextIfChanged(revealUiEl('more-reveal-state'), text);
}

function renderRevealGamesLink() {
  setHiddenIfChanged(revealUiEl('games-reveal-link'), !(revealUiIsDirector() && revealRemoteMayOpen()));
}

// ════════════════════════════════════════════════════════════════════
// WHAT THE ENGINE AND THE SHELL CALL
// ════════════════════════════════════════════════════════════════════
// Every surface, each writing only what changed. Cheap enough to run on every renderAll: a phone with no reveal reads
// one null view and writes nothing.
function renderRevealUi() {
  if (typeof confirmedReveal === 'undefined') return;
  renderRevealMirror();
  renderRevealGrids();
  renderRevealChampion();
  renderRevealStrip();
  renderRevealMoreRow();
  renderRevealGamesLink();
}

// reveal.js calls this after every confirmed change and every time-driven one (why: snapshot, reread, denied, role,
// rescan, tick, timer, wake, clock, connection, full).
function revealPaint(why, mode) {
  renderRevealUi();
}

function wireRevealUi() {
  if (revealUi.wired) return;
  revealUi.wired = true;
  const on = (id, type, fn) => { const el = revealUiEl(id); if (el) el.addEventListener(type, fn); };
  on('now-reveal-day', 'click', () => { if (typeof openSchedule === 'function') openSchedule(); });
}
