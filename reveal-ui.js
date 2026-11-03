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

const REVEAL_UI_PEEK_MS = 350;          // how long a finger holds the masked next row before it shows
const REVEAL_UI_PEEK_MAX_MS = 3000;     // a peek never lasts longer than this, finger or not
const REVEAL_UI_SCREEN_HOST = 'camp.patricksimpson.info';
const REVEAL_UI_REFUSED = ['wait', 'offline', 'busy', 'not-ready', 'loading', 'no-full'];   // the codes that mean "that tap sent nothing"

const revealUi = {
  wired: false,
  ledger: {},          // §9.8: what each animated thing last animated to; a first sighting records and never plays
  timer: null,         // the next moment the remote's own words change with no snapshot (a countdown second, a beat)
  peekHold: 0, peekOff: 0, peekOk: true,
  go: { state: '', big: '', key: '' },
  seq: null,           // the remote's last painted command (a new one scrolls the ladder, re-masks the peek)
  tvSeq: null, tvBeat: null, tvMode: null,
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
  // The remote's compact ladder carries the short name too: at large text CSS shows it instead of a full name cut to
  // five letters ("Feroci…"), so the director can still read who is on the big screen. One shows at a time
  // (display:none takes the other out of the accessibility tree too).
  const shortName = kind === 'remote' ? teamShort(e.id) : '';
  const nameHtml = shortName && shortName !== name
    ? '<span class="rv-name-full">' + esc(name) + '</span><span class="rv-name-short">' + esc(shortName) + '</span>'
    : esc(name);
  return '<div class="rv-team" data-team="' + esc(e.id) + '"><span class="rv-mark">' + teamMarkHtml(e.id, { size: kind === 'remote' ? 32 : 34 }) + '</span>' +
    '<span class="rv-nm"><b class="rv-name">' + nameHtml + '</b>' + you + counts + '</span>' +
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

// The champions as the ROWS may show them: revealView names them the moment a finale's 1st place is shown, but the
// crown and its confetti wait for the crowning itself (phase champion, then the final table or the end), so no phone
// celebrates ahead of the room while the remote still says "Crown the champions". The champion LINE keeps the view's
// own trigger (revealChampionLine).
function revealUiCrowned(v) {
  return v && v.champion && v.phase !== 'intro' && v.phase !== 'live' ? v.champion : null;
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

// The director's ladder: 1st at the top, hidden places in the well, ONE masked next row, the shown ones with their
// teams. `full` (the private freeze) names the places; without it the unrevealed rows are plain "Hidden" rows with no
// number. Returns { html, items } (items: [{ key, state }] in order, for tests and motion).
function revealUiLadderModel(m) {
  const c = m.ctl;
  if (!c) return { html: '', items: [] };
  const node = confirmedReveal[m.mode];
  const pub = normalizeRevealPub(node && node.pub).filter((g) => g.idx < c.shown);
  const byIdx = {};
  pub.forEach((g) => { byIdx[g.idx] = g; });
  const full = revealFullFor(m.mode);
  const view = m.view;
  const champion = !!revealUiCrowned(view);
  const items = [];
  const html = [];
  const push = (key, state, h) => { items.push({ key, state }); html.push(h); };
  const hiddenRow = (key, place) => '<div class="rv-row" role="listitem" data-key="' + key + '" data-state="hidden">' +
    '<span class="rv-pl">' + (place ? revealUiOrdHtml(place) : '') + '</span><span class="rv-msg">' + REVEAL_UI_ICON('i-lock') + 'Hidden until you reveal it</span></div>';
  const row = (g, o) => revealUiShownRowHtml({ place: g.place, tie: g.entries.length > 1, entries: g.entries }, Object.assign({ kind: 'remote', mine: null }, o));
  const onScreenPlace = view ? view.onScreen : null;
  if (full) {
    const nextIdx = m.next && m.next.action === 'reveal' ? m.next.idx : -1;
    for (let idx = full.n - 1; idx >= 0; idx--) {
      const fg = full.groups.find((g) => g.idx === idx);
      if (!fg) continue;
      if (idx < c.shown && byIdx[idx]) {
        const g = byIdx[idx];
        push('g' + g.place, 'shown', row(g, { onscreen: onScreenPlace === g.place, champion: champion && g.place === 1 }));
      } else if (idx === nextIdx) {
        const word = revealUi.peekOk ? 'Press and hold to peek' : 'Masked while the big screen plays';
        push('g' + fg.place, 'next', '<div class="rv-row" role="listitem" tabindex="0" data-key="g' + fg.place + '" data-state="next" aria-label="Up next, hidden. Press and hold, or press Enter, to peek.">' +
          '<span class="rv-pl">' + revealUiOrdHtml(fg.place) + (fg.entries.length > 1 ? '<em class="rv-tie">tie</em>' : '') + '</span>' +
          '<span class="rv-mask">' + REVEAL_UI_ICON('i-eye-off') + '<span><b>Up next · only on this phone</b><small>' + word + '</small></span></span>' +
          '<div class="rv-teams rv-peek">' + fg.entries.map((e) => revealUiTeamHtml('remote', e, null)).join('') + '</div></div>');
      } else {
        push('g' + fg.place, 'hidden', hiddenRow('g' + fg.place, fg.place));
      }
    }
  } else {
    // The freeze has not been read (yet): the hidden count is the teams not shown, an upper bound on the places left.
    const shownTeams = pub.reduce((n, g) => n + g.entries.length, 0);
    for (let i = 0; i < Math.max(0, c.teams - shownTeams); i++) push('h-' + i, 'hidden', hiddenRow('h-' + i, 0));
    pub.slice().sort((a, b) => b.idx - a.idx).forEach((g) => {
      push('g' + g.place, 'shown', row(g, { onscreen: onScreenPlace === g.place, champion: champion && g.place === 1 }));
    });
  }
  return { html: html.join(''), items };
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
    const before = revealUiTagBefore(root);
    let added = [];
    try { added = JellyMotion.flipKeyed(root, html, 'glide') || []; } catch (e) { root.innerHTML = html; }
    root.__html = html;
    root.__dom = root.innerHTML;
    revealUiTagMoved(root, before);
    if (o.after) o.after(added, root);
  };
  root.__rvPending = html;
  if (o.handsOff && JellyMotion.whenHandsOff) JellyMotion.whenHandsOff(run); else run();
  return true;
}

// "On the big screen now" moves from one row to another (Back, or a newer place): the tag slides from where it was, on
// `snap`, stretched by its own speed (calm: it simply jumps). Measured before the morph and played after it.
function revealUiTagBefore(root) {
  const tag = root && root.querySelector ? root.querySelector('.rv-os') : null;
  return tag && tag.getBoundingClientRect ? { y: tag.getBoundingClientRect().top } : null;
}
function revealUiTagMoved(root, before) {
  if (!before || typeof JellyMotion === 'undefined' || !root.querySelector) return;
  const tag = root.querySelector('.rv-os');
  if (!tag || !tag.getBoundingClientRect) return;
  const dy = before.y - tag.getBoundingClientRect().top;
  if (Math.abs(dy) < 2) return;
  JellyMotion.play(tag, 'snap', (x, v) => {
    const s = Math.min(0.5, Math.abs(v * dy) / 1600);
    return { transform: 'translateY(' + dy * (1 - x) + 'px) scale(' + (1 - 0.2 * s) + ',' + (1 + s) + ')', transformOrigin: '0 50%' };
  }, { calm: false });
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
  const crowned = revealUiCrowned(v);
  revealUiPaintList(revealUiEl('now-reveal-list'), revealUiMirrorHtml(crowned === v.champion ? v : Object.assign({}, v, { champion: null }), mine), {
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
  if (revealUiNote('champ:' + v.id, !!crowned) && crowned && active) revealUiCrownMoment(revealUiEl('now-reveal-list'));
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
// THE DIRECTOR'S REMOTE (#takeover-reveal)
// ════════════════════════════════════════════════════════════════════
// The mini TV: tvFrame() — the same pure function the big-screen page runs — drawn into the static slots. Always the
// TV's own light colours (CSS), in container units, so the 352px stage and the 150px thumbnail are one picture.
function revealUiMarksHtml(ids, size) {
  return ids.map((id) => teamMarkHtml(id, { size })).join('');
}

// The board as the big screen draws it (current-standings.js paintBoard): one sheet, best place first, a faint "Still to
// come" row per TEAM not yet shown above them (never per place, so no tie can be read off the count; it also keeps the
// frame from being two rows at the foot of a blank picture), the place just shown with the gold edge (o.nowIdx), and
// the crown on 1st only once the champions were crowned (o.crown).
function revealUiBoardHtml(groups, o) {
  o = o || {};
  const rows = [];
  const shownTeams = groups.reduce((n, g) => n + g.entries.length, 0);
  for (let i = 0; i < Math.max(0, (o.teams || 0) - shownTeams); i++) {
    rows.push('<li class="mtv-row" data-key="still-' + i + '" data-state="still"><span class="mtv-still">Still to come</span></li>');
  }
  groups.slice().sort((a, b) => b.idx - a.idx).forEach((g) => {
    g.entries.forEach((e) => {
      const crown = o.crown && g.place === 1 ? '<svg class="ico mtv-row-crown" aria-hidden="true"><use href="#i-crown"/></svg>' : '';
      rows.push('<li class="mtv-row" data-key="g' + g.place + '-' + esc(e.id) + '" data-pl="' + g.place + '"' + (o.nowIdx === g.idx ? ' data-now' : '') + '><span class="mtv-pl">' + crown + esc(ordinal(g.place)) + '</span>' +
        '<span class="mtv-mk">' + teamMarkHtml(e.id, { size: 24 }) + '</span><span class="mtv-nm">' + esc(e.nm) + '</span><span class="mtv-pts">' + e.p + '</span></li>');
    });
  });
  return rows.join('');
}

// What the big screen is showing, in words (the thumbnail's caption on a small phone; the mini TV's text for a screen reader).
function revealUiTvWords(frame, m) {
  let w;
  if (frame.mode === 'hero') { const g = frame.groups.find((x) => x.idx === frame.heroIdx); w = g ? ordinal(g.place) + ' place on the big screen' : 'A place on the big screen'; }
  else if (frame.mode === 'intro') w = 'Current standings on the big screen';
  else if (frame.mode === 'board') w = 'The standings so far on the big screen';
  else if (frame.mode === 'table') w = 'The final table on the big screen';
  else if (frame.mode === 'champion') w = 'The champions on the big screen';
  else w = 'Waiting for the directors';
  return m.practice && frame.mode !== 'waiting' ? 'Practice · ' + w : w;
}

function revealUiPaintTv(m) {
  const tv = revealUiEl('reveal-tv');
  if (!tv) return;
  const node = confirmedReveal[m.mode];
  const frame = tvFrame(node && node.ctl, node && node.pub, serverNow, { denied: m.mode === 'real' ? revealDenied : revealPracticeDenied });
  revealUiData(tv, 'frame', frame.mode);
  revealUiData(tv, 'beat', frame.mode === 'hero' ? frame.beat : null);
  const ids = teamIds();
  setHtmlIfChanged(revealUiEl('mtv-wait-marks'), revealUiMarksHtml(ids, 40));
  setHtmlIfChanged(revealUiEl('mtv-intro-marks'), revealUiMarksHtml(ids, 36));
  if (frame.mode === 'hero') {
    const g = frame.groups.find((x) => x.idx === frame.heroIdx);
    if (g) {
      setTextIfChanged(revealUiEl('mtv-hero-place'), ordinal(g.place) + ' place' + (g.entries.length > 1 ? ' · tie' : ''));
      setHtmlIfChanged(revealUiEl('mtv-hero-marks'), revealUiMarksHtml(g.entries.map((e) => e.id), 112));
      setTextIfChanged(revealUiEl('mtv-hero-name'), g.entries.map((e) => e.nm).join(' & '));
      setTextIfChanged(revealUiEl('mtv-hero-points'), String(g.entries[0].p));
      setTextIfChanged(revealUiEl('mtv-hero-break'), g.entries.length === 1 ? g.entries[0].g + ' gold · ' + g.entries[0].s + ' silver · ' + g.entries[0].b + ' bronze' : '');
    }
  } else if (frame.mode === 'board' || frame.mode === 'table') {
    setTextIfChanged(revealUiEl('mtv-board-title'), frame.mode === 'table' ? 'Final standings' : 'Standings so far');
    const docked = frame.groups.filter((x) => x.idx < frame.docked);
    const c = normalizeRevealCtl(node && node.ctl);
    setHtmlIfChanged(revealUiEl('mtv-board'), revealUiBoardHtml(docked, {
      teams: c ? c.teams : 0, nowIdx: frame.mode === 'board' ? frame.docked - 1 : -1, crown: frame.mode === 'table' && !!(c && c.finale),
    }));
  } else if (frame.mode === 'champion') {
    const first = frame.groups.find((x) => x.place === 1);
    setHtmlIfChanged(revealUiEl('mtv-champ-marks'), first ? revealUiMarksHtml(first.entries.map((e) => e.id), 64) : '');
    setTextIfChanged(revealUiEl('mtv-champ-name'), first ? first.entries.map((e) => e.nm).join(' & ') : '');
  }
  setTextIfChanged(revealUiEl('reveal-tv-now'), revealUiTvWords(frame, m));
  // The picture moves with the show: a new place's shield drops and its name arrives, the score pops at its beat, the
  // crown lands. Only for a change on a remote already looking (§9.8), and never replayed on a reopen.
  const seq = frame.mode === 'hero' || frame.mode === 'champion' ? node.ctl.seq : null;
  const moved = revealUiNote('tv:seq', seq) && seq !== null;
  if (moved && revealUiVisible() && typeof JellyMotion !== 'undefined') {
    if (frame.mode === 'hero') {
      revealUiDrop(revealUiEl('mtv-hero-marks'));
      JellyMotion.play(revealUiEl('mtv-hero-name'), 'arrive', (x) => ({ transform: 'translateY(' + (18 * (1 - Math.min(1, x))) + 'px)' }), { calmMs: 200 });
    } else {
      revealUiCrownMoment(tv);
    }
  }
  const beat = frame.mode === 'hero' ? frame.beat : null;
  if (revealUiNote('tv:beat:' + seq, beat) && beat === 'score' && revealUiVisible() && typeof JellyMotion !== 'undefined') {
    JellyMotion.play(revealUiEl('mtv-hero-points'), 'press', (x) => ({ transform: 'scale(' + (0.8 + 0.2 * Math.min(1.4, x)) + ')', transformOrigin: '0 100%' }), { calmMs: 200 });
  }
  return frame;
}

// The ready screen's checks (mockup 06). Only "this phone is up to date" gates a Start; the others inform.
function revealUiScoredWords(gate) {
  const n = gate.unscored.length;
  if (!n) {
    const when = gate.lastScoreAt ? 'Last score saved ' + revealUiClock(gate.lastScoreAt, true) : '';
    return { tone: 'ok', title: 'Every game today is scored', sub: when };
  }
  if (n === 1) return { tone: 'warn', title: gate.unscored[0] + ' has no score yet', sub: 'You can still start. Scores saved later are not in this reveal.' };
  const names = gate.unscored.slice(0, 3).join(', ') + (n > 3 ? ' and ' + (n - 3) + ' more' : '');
  return { tone: 'warn', title: n + ' games have no score yet', sub: names + '. You can still start; scores saved later are not in this reveal.' };
}

function revealUiPhoneWords(gate) {
  if (gate.phoneCaughtUp) return { tone: 'ok', title: 'This phone is up to date', sub: 'Connected · nothing waiting to send' };
  let sub = 'Waiting for this phone to catch up…';
  if (!fbConnected) sub = 'Not connected yet';
  else if (gate.quiet) sub = 'The connection just changed. Waiting a few seconds';
  else if (typeof pendingWrites !== 'undefined' && pendingWrites > 0) sub = 'Sending scores…';
  else if (!remoteReady) sub = 'Loading the latest scores…';
  return { tone: 'wait', title: 'This phone is catching up', sub };
}

function revealUiScreenPath() {
  return CAMP.id === 'senior' ? 'current-standings.html?camp=senior' : 'current-standings.html';
}

function revealUiBuzzTitle() {
  let n = 0;
  if (memberDirectoryLoaded && memberDirectory) {
    Object.keys(memberDirectory).forEach((k) => { const r = memberDirectory[k]; if (r && r.role !== 'editor' && !/^pending-/.test(k)) n += 1; });
  }
  return n > 0 ? 'Buzz all ' + n + ' counselors' : 'Buzz all counselors';
}

function revealUiPaintReady(m, gate) {
  const ended = m.stage === 'ended';
  setHiddenIfChanged(revealUiEl('reveal-ended'), !ended);
  if (ended) {
    setTextIfChanged(revealUiEl('reveal-ended-title'), 'Last reveal ended ' + revealUiClock(m.endedAt, true));
    setTextIfChanged(revealUiEl('reveal-ended-sub'), 'Counselors see it ' + revealUiUntilWords(m.until));
  }
  const sc = revealUiScoredWords(gate);
  const ph = revealUiPhoneWords(gate);
  [['reveal-check-scored', sc], ['reveal-check-phone', ph]].forEach(([id, w]) => {
    revealUiData(revealUiEl(id), 'tone', w.tone);
    setTextIfChanged(revealUiEl(id + '-title'), w.title);
    setTextIfChanged(revealUiEl(id + '-sub'), w.sub);
  });
  setTextIfChanged(revealUiEl('reveal-screen-path'), revealUiScreenPath());
  // The Practice switch: its state in words beside the track.
  const on = revealPracticeSwitch();
  const psw = revealUiEl('reveal-practice');
  if (psw && psw.hasAttribute('checked') !== on) psw.toggleAttribute('checked', on);
  setTextIfChanged(revealUiEl('reveal-practice-state'), on ? 'On' : 'Off');
  // Buzz: greyed with its reason while a practice is on (practice runs never buzz) or phone alerts are not live yet.
  const bz = revealBuzzState(m.practice ? 'practice' : 'real');
  const off = !bz.available;
  revealUiData(revealUiEl('reveal-opt-buzz'), 'off', off ? true : null);
  setTextIfChanged(revealUiEl('reveal-buzz-title'), revealUiBuzzTitle());
  setTextIfChanged(revealUiEl('reveal-buzz-sub'), off ? bz.reason : '“' + REVEAL_BUZZ_TEXT + '”');
  const bsw = revealUiEl('reveal-buzz');
  if (bsw) {
    if (bsw.hasAttribute('disabled') !== off) bsw.toggleAttribute('disabled', off);
    if (bsw.hasAttribute('checked') !== !!bz.on) bsw.toggleAttribute('checked', !!bz.on);
  }
  setTextIfChanged(revealUiEl('reveal-buzz-state'), bz.on ? 'On' : 'Off');
}

// The first name of the director who started the reveal, from the private freeze (never from the public node, which has
// none), or '' when the member list cannot say.
function revealUiStarterName(by) {
  if (!by || !memberDirectoryLoaded || !memberDirectory || !Object.prototype.hasOwnProperty.call(memberDirectory, by)) return '';
  const rec = memberDirectory[by];
  const first = rec && typeof rec.name === 'string' ? rec.name.trim().split(/\s+/)[0] : '';
  return first.slice(0, 30);
}

function revealUiPaintLive(m) {
  setTextIfChanged(revealUiEl('reveal-count'), m.count ? m.count.shown + ' of ' + m.count.total + ' shown' : '');
  setTextIfChanged(revealUiEl('reveal-end-label'), m.practice ? 'End practice' : 'End reveal');
  setHiddenIfChanged(revealUiEl('reveal-stale'), !m.freezeStale);
  setHiddenIfChanged(revealUiEl('reveal-offer'), !(m.practice && m.mayCommand));
  const full = revealFullFor(m.mode);
  const other = !!(full && full.by && full.by !== identityKey(authUser));
  setHiddenIfChanged(revealUiEl('reveal-started'), !other);
  if (other) setTextIfChanged(revealUiEl('reveal-started'), 'Started by ' + (revealUiStarterName(full.by) || 'another director') + ' at ' + revealUiClock(m.startedAt, true));
  // The peek is allowed while nothing is playing on the big screen (a counselor beside the director could read 1st place
  // off a phone held up in a crowded room during a beat).
  const c = m.ctl;
  revealUi.peekOk = !c || c.phase === 'intro' || serverNow() - c.at >= REVEAL_BEAT_DOCK_MS;
  const ladder = revealUiLadderModel(m);
  revealUiPaintList(revealUiEl('reveal-ladder'), ladder.html, {
    animate: true, after: (added) => revealUiLanded(added, null),
  });
  const list = revealUiEl('reveal-ladder');
  if (!revealUi.peekOk || (c && revealUi.seq !== null && revealUi.seq !== c.id + ':' + c.seq)) revealUiPeek(false);
  // A new command: keep the place on the big screen and the next one in view (the ladder can be taller than the screen).
  const seqKey = c ? c.id + ':' + c.seq : null;
  if (seqKey && revealUi.seq !== seqKey && list && list.querySelector) {
    const target = list.querySelector('[data-onscreen]') || list.querySelector('[data-state="next"]');
    // Also on the first paint after the remote opens (revealUi.seq is null then), at once: a "Scores changed" row above
    // the ladder could otherwise leave the masked next place under the dock on a fresh open.
    if (target && target.scrollIntoView) { try { target.scrollIntoView({ block: 'nearest', behavior: revealUi.seq === null || revealUiCalm() ? 'auto' : 'smooth' }); } catch (e) { /* fine */ } }
  }
  revealUi.seq = seqKey;
}

// The two buttons. The dock never takes `disabled` (a tap during the wait must still reach the handler, which answers
// with the wobble and one toast): "can't press" is aria-disabled plus data-state.
function revealUiBlockedWords(m, gate) {
  if (m.loading) return 'Loading the reveal…'; // the phone reads the database here, not the TV: never send anyone to look at it
  if (m.why === 'no-sync') return 'Sync is off on this phone';
  if (m.stage === 'ready' || m.stage === 'ended') return 'Waiting for this phone to catch up…';
  return 'Loading the places…';
}

function revealUiPaintDock(m, gate) {
  const go = revealUiEl('reveal-go');
  const back = revealUiEl('reveal-back');
  const startStage = m.stage === 'ready' || m.stage === 'ended';
  let st = m.go.state;
  let kicker = m.go.kicker;
  const big = m.go.big;
  if (startStage && st === 'ready') {
    if (!gate.canStart) st = 'blocked';
    else if (m.stage === 'ready') kicker = m.practice ? 'Practice · uses the real standings' : 'Freezes the standings when you tap';
  }
  if (st === 'blocked') kicker = revealUiBlockedWords(m, gate);
  const prevState = revealUi.go.state;
  const prevBig = revealUi.go.big;
  revealUiData(go, 'state', st);
  revealUiData(go, 'face', m.go.face);
  revealUiAttr(go, 'aria-disabled', st !== 'ready' ? 'true' : null);
  setTextIfChanged(revealUiEl('reveal-go-k'), kicker);
  setTextIfChanged(revealUiEl('reveal-go-m'), big);
  if (st === 'charging' && m.ctl) {
    const key = m.ctl.id + ':' + m.ctl.seq;
    if (revealUi.go.key !== key) {
      revealUi.go.key = key;
      const elapsed = Math.max(0, Math.round(serverNow() - m.ctl.at));
      if (go && go.style) { go.style.setProperty('--charge-ms', m.charge.total + 'ms'); go.style.setProperty('--charge-from', '-' + elapsed + 'ms'); }
    }
  } else revealUi.go.key = '';
  revealUi.go.state = st;
  revealUi.go.big = big;
  if (prevState !== '' && revealUiVisible() && typeof JellyMotion !== 'undefined') {
    // The label swap: the new line rises (§9.5). The countdown's own seconds never animate, only a change of the big line.
    if (prevBig && prevBig !== big) {
      const m2 = revealUiEl('reveal-go-m');
      if (m2) JellyMotion.play(m2, 'press', (x) => ({ transform: 'translateY(' + (28 * (1 - Math.min(1, x))) + 'px) scale(' + (0.9 + 0.1 * Math.min(1, x)) + ')' }), { calmMs: 120 });
    }
    // Ready again: one pop (and a tick on a phone that can feel it); iOS has no vibrate, the label swap is its signal.
    if (prevState === 'charging' && st === 'ready') {
      if (go) JellyMotion.play(go, 'press', (x) => ({ transform: 'scale(' + (0.94 + 0.06 * Math.min(1.5, x)) + ')' }), { calm: false });
      try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8); } catch (e) { /* no haptics */ }
    }
  }
  // Back
  const bs = m.back.state === 'hidden' ? 'first' : m.back.state;
  revealUiData(back, 'state', bs);
  revealUiAttr(back, 'aria-disabled', bs !== 'ready' ? 'true' : null);
  setTextIfChanged(revealUiEl('reveal-back-sub'), m.back.sub);
}

// The words and the shape of the remote's roof: chip, title, back label.
function revealUiPaintRoof(tk, m) {
  revealUiData(tk, 'phase', m.stage);
  revealUiData(tk, 'mode', m.mode);
  let tone = 'ready';
  let text = 'Ready';
  if (m.stage === 'off') { tone = 'off'; text = 'Not on yet'; }
  else if (m.stage === 'ended') { tone = 'ended'; text = 'Ended'; }
  else if (m.practice) { tone = 'practice'; text = 'Practice'; }
  else if (m.stage !== 'ready') { tone = 'live'; text = 'Live'; }
  revealUiData(revealUiEl('reveal-chip'), 'tone', tone);
  setTextIfChanged(revealUiEl('reveal-chip-text'), text);
  const label = shellRevealBackLabel();
  setTextIfChanged(revealUiEl('takeover-reveal-back-label'), label);
  const backBtn = tk.querySelector('[data-takeover-back]');
  revealUiAttr(backBtn, 'aria-label', 'Back to ' + label);
}

function revealUiPaintMeta() {
  const n = typeof presenceCount === 'number' ? presenceCount : 0;
  setTextIfChanged(revealUiEl('reveal-phones'), syncEnabled() && n > 0 ? n + (n === 1 ? ' phone has' : ' phones have') + ' Camp open' : '');
  const wake = revealWakeHeld();
  revealUiData(revealUiEl('reveal-wake'), 'wake', wake ? 'on' : 'off');
  setTextIfChanged(revealUiEl('reveal-wake-text'), wake ? 'Screen stays on' : 'Screen may sleep');
}

// The next moment the remote's own words change with no snapshot to say so: a countdown second on the button, the end of
// a beat on the mini TV, the end of the 10 s a Start waits after the connection last changed, the end of the peek ban.
function revealUiNextMoment(m) {
  const now = serverNow();
  let best = null;
  const take = (t) => { if (Number.isFinite(t) && t > now && (best === null || t < best)) best = t; };
  const c = m.ctl;
  if (c) {
    [REVEAL_BEAT_SCORE_MS, REVEAL_BEAT_BREAKDOWN_MS, REVEAL_BEAT_DOCK_MS].forEach((b) => take(c.at + b));
    if (m.charge.left > 0) take(now + (m.charge.left % 1000 || 1000));
  }
  return best === null ? null : Math.max(30, best - now + 15);
}

function revealUiArm(m) {
  if (revealUi.timer) { clearTimeout(revealUi.timer); revealUi.timer = null; }
  if (!revealRemoteIsOpen()) return;
  let wait = revealUiNextMoment(m);
  // a Start also waits out the quiet window after the connection last changed
  if (typeof revealConnChangedAt !== 'undefined' && revealConnChangedAt && Date.now() - revealConnChangedAt < REVEAL_CONNECT_QUIET_MS) {
    const q = REVEAL_CONNECT_QUIET_MS - (Date.now() - revealConnChangedAt) + 30;
    wait = wait === null ? q : Math.min(wait, q);
  }
  if (wait === null) return;
  revealUi.timer = setTimeout(() => { revealUi.timer = null; if (revealRemoteIsOpen()) renderRevealRemote(); }, wait);
}

function revealUiRoofSync() {
  if (typeof shell === 'undefined' || typeof roofUp !== 'function') return;
  if (shell.roof !== roofUp()) { shell.roof = roofUp(); applyChromeColor(); }
}

// Called from renderAll (renderRevealUi) and by every change the engine reports while the remote is open.
function renderRevealRemote() {
  const tk = revealUiEl('takeover-reveal');
  if (!tk) return;
  if (!revealRemoteIsOpen()) { revealUiCloseRemote(tk); return; }
  const opening = tk.hidden || !tk.__open;
  if (tk.hidden) tk.hidden = false;
  if (tk.style && tk.style.pointerEvents) tk.style.pointerEvents = '';
  tk.__open = true;
  if (opening) {
    // A reopened remote draws the current picture and replays nothing (§9.8).
    revealUi.go.key = ''; revealUi.seq = null; revealUi.go.state = ''; revealUi.go.big = '';
    Object.keys(revealUi.ledger).forEach((k) => { if (k.indexOf('tv:') === 0) delete revealUi.ledger[k]; });
  }
  revealSetRemoteOpen(true);
  const m = revealRemoteModel();
  const gate = revealStartGate();
  revealUiPaintRoof(tk, m);
  revealUiPaintTv(m);
  revealUiPaintMeta();
  if (m.stage === 'ready' || m.stage === 'ended') revealUiPaintReady(m, gate);
  if (m.stage !== 'ready' && m.stage !== 'ended' && m.stage !== 'off') revealUiPaintLive(m);
  revealUiPaintDock(m, gate);
  revealUiArm(m);
  if (opening) {
    revealUiRoofSync();
    // A whole screen arrives with the full-screen spring; the page behind it is inert, so focus moves in with it.
    if (typeof JellyMotion !== 'undefined') JellyMotion.play(tk, 'settle', (x) => ({ transform: 'translateX(' + (1 - x) * 100 + '%)' }));
    const back = tk.querySelector('[data-takeover-back]');
    if (back && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  }
}

function revealUiCloseRemote(tk) {
  if (tk.__open) {
    tk.__open = false;
    revealSetRemoteOpen(false);
    revealUiPeek(false);
    if (revealUi.timer) { clearTimeout(revealUi.timer); revealUi.timer = null; }
    const o = shell.opener;
    shell.opener = null;
    if (o && o.isConnected !== false && typeof o.focus === 'function') { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    // It slides back out to the right (220 ms; calm: a 140 ms fade), taking no taps on the way, hidden at the end unless
    // the remote was reopened meanwhile.
    if (!tk.hidden && typeof JellyMotion !== 'undefined') {
      if (tk.style) tk.style.pointerEvents = 'none';
      JellyMotion.playOut(tk, (x) => ({ transform: 'translateX(' + x * 100 + '%)' }), 220, () => {
        if (tk.__open) return;
        tk.hidden = true;
        if (tk.style) tk.style.pointerEvents = '';
        revealUiRoofSync();
      });
    } else tk.hidden = true;
    revealUiRoofSync();
  } else if (!tk.hidden && !(tk.style && tk.style.pointerEvents)) { tk.hidden = true; revealUiRoofSync(); }
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
  renderRevealRemote();
}

// reveal.js calls this after every confirmed change and every time-driven one (why: snapshot, reread, denied, role,
// rescan, tick, timer, wake, clock, connection, full).
function revealPaint(why, mode) {
  renderRevealUi();
}

// ════════════════════════════════════════════════════════════════════
// TAPS
// ════════════════════════════════════════════════════════════════════
// A tap that sent nothing: one short sideways wobble (calm: a 200 ms dim), and the toast the engine already raised.
function revealUiRefused(el) {
  if (!el) return;
  if (revealUiCalm()) {
    revealUiData(el, 'refused', true);
    setTimeout(() => revealUiData(el, 'refused', null), 200);
    return;
  }
  if (typeof JellyMotion !== 'undefined') JellyMotion.play(el, 'wobble', (x) => ({ transform: 'translateX(' + 9 * (1 - Math.min(1, x)) * Math.cos(9 * x) + 'px)' }), { calm: false });
}

async function revealUiAsk(opts) {
  if (typeof askDialog === 'function') return askDialog(opts);
  return confirm([opts.title].concat(opts.body || []).join('\n\n')) ? opts.actions.find((a) => !a.cancel).value : opts.actions.find((a) => a.cancel).value;
}

// Start (or Start a practice, or Start a new reveal over last night's). A real Start over a reveal that is still showing
// asks first; a practice never does (it replaces nothing real); a game with no score is a warning, never a gate.
async function revealUiStartFlow(m, o) {
  o = o || {};
  const practice = !!m.practice;
  const gate = revealStartGate();
  if (!o.again && gate.canStart) {
    if (!practice && m.stage === 'ended') {
      const ok = await revealUiAsk({
        title: 'Start a new reveal?',
        body: 'This replaces tonight’s standings on every counselor’s phone. The places already shown disappear at once.',
        actions: [{ label: 'Keep tonight’s', value: 'keep', cancel: true }, { label: 'Start a new reveal', value: 'start', kind: 'gold' }],
      });
      if (ok !== 'start') return { ok: false, code: 'cancelled' };
    }
    if (gate.unscored.length) {
      const n = gate.unscored.length;
      const ok = await revealUiAsk({
        title: n === 1 ? gate.unscored[0] + ' has no score yet' : n + ' games have no score yet',
        body: [n === 1 ? 'Scores saved after you start are not in this reveal.' : 'They are not in this reveal unless you score them first.', 'Start anyway?'],
        list: n === 1 ? [] : gate.unscored.slice(0, 6),
        actions: [{ label: 'Not now', value: 'wait', cancel: true }, { label: practice ? 'Start a practice' : 'Start anyway', value: 'start', kind: 'gold' }],
      });
      if (ok !== 'start') return { ok: false, code: 'cancelled' };
    }
  }
  return revealStart({ practice });
}

async function revealUiEndFlow(m) {
  const practice = !!m.practice;
  const early = m.stage !== 'table';
  const ok = await revealUiAsk({
    title: practice ? 'End the practice?' : 'End the reveal?',
    body: practice
      ? 'The practice places leave the big screen at once. Nothing is kept.'
      : (early ? 'Counselors keep the places shown so far ' : 'Counselors keep tonight’s standings ') + revealUiUntilWords(m.until) + '. The big screen goes back to waiting.',
    actions: [{ label: 'Keep showing', value: 'keep', cancel: true }, { label: practice ? 'End practice' : 'End the reveal', value: 'end', kind: 'gold' }],
  });
  if (ok !== 'end') return { ok: false, code: 'cancelled' };
  const res = await revealEnd({ mode: m.mode });
  if (res && res.ok) {
    revealUiPeek(false);
    if (practice && typeof showToast === 'function') showToast('Practice ended. The big screen is waiting again.');
  }
  return res;
}

function revealUiSparkle(ev) {
  if (!ev || typeof joyBurst !== 'function') return;
  joyBurst(ev.clientX, ev.clientY, false);   // calm: joyBurst returns, nothing moves
}

async function revealUiGo(ev) {
  const el = revealUiEl('reveal-go');
  const m = revealRemoteModel();
  let res;
  if (m.go.action === 'start') res = await revealUiStartFlow(m);
  else if (m.go.action === 'end') res = await revealUiEndFlow(m);
  else res = await revealNext();
  if (res && res.ok) revealUiSparkle(ev);
  else if (res && REVEAL_UI_REFUSED.includes(res.code)) revealUiRefused(el);
  return res;
}

async function revealUiBack() {
  const el = revealUiEl('reveal-back');
  const res = await revealBack();
  if (res && !res.ok && (REVEAL_UI_REFUSED.includes(res.code) || res.code === 'first')) revealUiRefused(el);
  return res;
}

// A practice is playing and the real reveal is wanted. The remote follows a live practice (there is no other Start button
// on screen), so this is the one way to a real Start while one plays; the practice stays in its own child until its End,
// and the big screen switches to the real reveal at once (real wins, redesign §4.13). It asks what a real Start asks:
// "Start a new reveal?" when last night's grid would be replaced, and the unscored-games warning.
async function revealUiStartReal() {
  const el = revealUiEl('reveal-start-real');
  const rv = revealRemoteView('real');
  const res = await revealUiStartFlow({ practice: false, stage: rv && !rv.expired ? 'ended' : 'ready' });
  if (res && !res.ok && REVEAL_UI_REFUSED.includes(res.code)) revealUiRefused(el);
  return res;
}

// "Scores changed since you started": a fresh freeze over the same intro (nobody has seen a place, so nothing to confirm).
async function revealUiRestart() {
  const m = revealRemoteModel();
  return revealUiStartFlow(m, { again: true });
}

function revealUiCopyLink() {
  const url = 'https://' + REVEAL_UI_SCREEN_HOST + '/' + revealUiScreenPath();
  const done = () => { if (typeof showToast === 'function') showToast('Copied the big screen’s address.'); };
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, () => { copyTextToClipboard(url); done(); }); return; }
  } catch (e) { /* fall through */ }
  copyTextToClipboard(url);
  done();
}

// ── the peek ─────────────────────────────────────────────────────────
// Hold the masked next row for 350 ms and the team, shield and points show until the finger lifts (or 3 s pass); the
// mask comes back at once whenever the big screen is playing a beat and whenever a new command lands. The LIST holds the
// attribute, so peeking never changes the row's markup (a rewrite would cut the hold off).
function revealUiPeek(on) {
  const list = revealUiEl('reveal-ladder');
  clearTimeout(revealUi.peekHold);
  clearTimeout(revealUi.peekOff);
  revealUi.peekHold = 0;
  revealUi.peekOff = 0;
  if (!list) return;
  if (on) {
    if (!revealUi.peekOk) return;
    revealUiData(list, 'peek', true);
    revealUi.peekOff = setTimeout(() => revealUiPeek(false), REVEAL_UI_PEEK_MAX_MS);
    const row = list.querySelector ? list.querySelector('[data-state="next"]') : null;
    if (row && typeof JellyMotion !== 'undefined') JellyMotion.play(row, 'press', (x) => ({ transform: 'scaleY(' + (0.96 + 0.04 * Math.min(1.4, x)) + ')' }), { calmMs: 120 });
  } else revealUiData(list, 'peek', null);
}

function revealUiWirePeek(list) {
  if (!list) return;
  const isNext = (e) => !!(e.target && e.target.closest && e.target.closest('[data-state="next"]'));
  list.addEventListener('pointerdown', (e) => {
    if (!isNext(e)) return;
    clearTimeout(revealUi.peekHold);
    revealUi.peekHold = setTimeout(() => { revealUi.peekHold = 0; revealUiPeek(true); }, REVEAL_UI_PEEK_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => list.addEventListener(t, () => revealUiPeek(false)));
  list.addEventListener('contextmenu', (e) => { if (isNext(e) && e.preventDefault) e.preventDefault(); }); // iOS's callout would fight the hold
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && isNext(e)) { if (e.preventDefault) e.preventDefault(); revealUiPeek(true); }
  });
}

function wireRevealUi() {
  if (revealUi.wired) return;
  revealUi.wired = true;
  const on = (id, type, fn) => { const el = revealUiEl(id); if (el) el.addEventListener(type, fn); };
  on('reveal-go', 'click', revealUiGo);
  on('reveal-back', 'click', revealUiBack);
  on('reveal-end', 'click', () => { revealUiEndFlow(revealRemoteModel()); });
  on('reveal-restart', 'click', revealUiRestart);
  on('reveal-start-real', 'click', revealUiStartReal);
  on('reveal-copy-link', 'click', revealUiCopyLink);
  // A change event is the person's own tap (a programmatic `checked` never fires one), so a switch simply flips.
  on('reveal-practice', 'change', () => { revealSetPractice(!revealPracticeSwitch()); renderRevealRemote(); });
  on('reveal-buzz', 'change', () => { revealSetBuzz(!revealBuzzState('real').on); renderRevealRemote(); });
  on('reveal-row', 'click', (e) => openReveal({ from: 'more' }));
  on('games-reveal-link', 'click', () => openReveal({ from: 'games' }));
  on('now-reveal-remote', 'click', () => openReveal({ from: 'now' }));
  on('now-reveal-day', 'click', () => { if (typeof openSchedule === 'function') openSchedule(); });
  revealUiWirePeek(revealUiEl('reveal-ladder'));
  // The dock's drawn height lifts the toasts clear of it (styles.css, THE BOTTOM STACK): a refused tap's toast must not
  // land on the gold button it is talking about. Measured, not guessed: the dock grows with the text size, the face and
  // the home-indicator inset. A hidden remote measures 0, which the CSS never reads (it applies only while it is open).
  const dock = revealUiEl('reveal-dock');
  if (dock && typeof ResizeObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    let last = -1;
    try {
      new ResizeObserver(() => {
        const h = Math.round(dock.offsetHeight || 0);
        if (!h || h === last) return;
        last = h;
        document.documentElement.style.setProperty('--reveal-dock-h', h + 'px');
      }).observe(dock);
    } catch (e) { /* the fallback height stands */ }
  }
  // What the big screen is showing is also said to a screen reader as it changes.
  revealUiAttr(revealUiEl('reveal-tv-now'), 'aria-live', 'polite');
  document.addEventListener('visibilitychange', () => { if (document.hidden) revealUiPeek(false); });
}
