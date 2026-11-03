// ── games-ui.js — THE GAMES TAB'S RENDERERS (redesign §5; BUILD-PLAN Step 18, build session 1) ─────────────────
// app.js's gamesModel() is the whole Games tab as PLAIN DATA (the day picker, the day's blocks with their game rows, the
// directors' standings); this file paints it onto the static markup in #tab-games (index.html: the comment there documents
// every hook and row template), runs the two sheets (#sheet-quick, #sheet-standings) and draws the takeover's Next game dock.
// Same contract as now-ui.js / award.js / tell.js: a classic script loaded after app.js and now-ui.js, every hook in app.js
// typeof-guarded (delete the <script> and the Games tab is an empty page, the app still runs), static markup, change-only writes.
// Hooks app.js calls: renderGamesPanel(model) for a paint, renderQuickSheet() / renderStandingsSheet() when those sheets fill,
// gamesQuickReady() to decide whether the quick-points sheet may open, renderGameDock(game) from the game takeover.
//
// THE RULES THIS FILE LIVES BY
//  - IT DRAWS WHAT THE MODEL HOLDS AND NOTHING ELSE. A counselor's model has no standings, no points and no place, so there
//    is nothing here to hide: a field is there or it is not. The taps that WRITE (quick points, Next game, Add games) re-check the
//    role at call time and go through app.js's own writers (gamesQuickAdd → bonusAddFromDraft, the own-team guard).
//  - RENDER STABILITY (§13.1). Every part goes through setHtmlIfChanged / paintKeyedList / setTextIfChanged / setHiddenIfChanged /
//    setAttrIfChanged, so an idle renderAll writes nothing; a keyed list glides (never under a thumb), the open sheet is patched.
//  - EVERY DATABASE STRING IS ESCAPED (esc); marks are teamMarkHtml, accents teamAccentAttr (laundered in the accessor).
//  - MOTION (§9.5, jelly-motion.js presets, calm-aware): the day pill springs on `snap`, the standings glide by team, a changed
//    number pops, a game going Live → Done pops its check, a day arrives from the side it came from. Motion starts from the DIFFS
//    made here, never from a render; calm motion fades or does nothing.
//  - Names are all `games…` / `renderGames…` (one global scope). Week data only through the model and the SEAM accessors.

const gamesUi = {
  wired: false,
  painted: false,      // a full paint has happened: from the second on, a change is one the person can see
  dayId: null,         // the day the picker last showed (another one slides the pill and brings the day in from its side)
  dayIdx: -1,
  statuses: {},        // game id → last status painted (Live → Done pops the check)
  pts: {},             // team id → last points painted (a changed number pops)
  quick: { team: null, pts: 0, why: '', other: '' }, // the quick-points sheet's own form
  quickWas: null,      // what the sheet last painted (so an idle pass writes nothing)
};

function gamesEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
function gamesIcon(id, cls) { return `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${id}"/></svg>`; }
function gamesAccent(id) { return typeof teamAccentAttr === 'function' ? teamAccentAttr(id) : ''; }

// Is Games what the person is looking at, with nothing stacked over it, and was it already showing (so a change is one they can
// SEE, not the panel arriving)? Motion starts only then.
function gamesOnScreen() {
  return typeof activeTab === 'function' && activeTab() === 'games' && !shell.dirty.games && !shellTakeoverOpen() && !builderOpen();
}

// ════════════════════════════════════════════════════════════════════
// PURE PIECES — markup from the model's plain data (tests/games-ui.test.js reads these)
// ════════════════════════════════════════════════════════════════════
// The day picker: ONE lifted pill (at rest under --i, set by the painter) then a tab per day. A status is words, never colour alone.
function gamesDayPickHtml(days) {
  return '<i class="gdp-pill" aria-hidden="true"></i>' + (days || []).map((d) => {
    const word = d.st === 'done' ? 'Done' : d.st === 'today' ? 'Today' : d.st === 'left' ? d.left + ' left' : '';
    return `<button type="button" class="gdp-btn" role="tab" id="gdp-${esc(d.id)}" aria-selected="${d.selected ? 'true' : 'false'}" aria-controls="games-day" ` +
      `tabindex="${d.selected ? 0 : -1}" data-day="${esc(d.id)}" data-st="${esc(d.st)}" aria-label="${esc(d.label)}">` +
      `<span class="gdp-d">${esc(d.short)}</span><span class="gdp-st">${esc(word)}</span></button>`;
  }).join('');
}

function gamesNotesHtml(notes) {
  return (notes || []).map((n) => {
    if (n.kind === 'double') return `<p class="nw-note" data-note="double">${gamesIcon('i-bolt')}<span>${esc(n.text)}</span></p>`;
    if (n.kind === 'day') return `<p class="nw-note" data-note="day">${gamesIcon('i-pin')}<span>${esc(n.text)}</span></p>`;
    return '';
  }).join('');
}

// A game's row is Now's row exactly (now-ui.js). Without that file a plain open-the-game row, so the tab is never blank.
function gamesRowHtml(r) {
  if (typeof nowGameRowHtml === 'function') return nowGameRowHtml(r);
  return `<div class="gr" role="listitem" data-key="${esc(r.key)}" data-status="${esc(r.status)}"><span class="gr-st" aria-hidden="true"></span>` +
    `<button type="button" class="gr-hit" data-open-game="${esc(r.id)}"><span class="gr-name">${esc(r.name)}</span></button></div>`;
}

function gamesBlockHtml(b) {
  return `<section class="gb" data-key="${esc(b.key)}"${b.now ? ' data-now' : ''}${b.off ? ' data-off' : ''}>` +
    `<h3 class="gb-h"><span class="gb-t">${esc(b.title)}</span>${b.now ? '<span class="gb-now">Now</span>' : ''}${b.when ? `<span class="gb-when">${esc(b.when)}</span>` : ''}</h3>` +
    `<div class="gr-list" role="list">${b.rows.map(gamesRowHtml).join('')}</div></section>`;
}

function gamesEmptyHtml(e) {
  return `<div class="gw-empty" data-key="empty"><p class="gw-empty-t">${esc(e.text)}</p>${e.add ? '<button type="button" class="btn" data-games-add>Add games</button>' : ''}</div>`;
}

// One team's row of the directors' standings: shared place (a tie says so), the arrow since this morning, the mark, the short
// name over its medals in words, the points. A team the director may give points is ONE button (quick points); their own team is a
// plain row with a lock — never a dead button.
function gamesStandingRowHtml(r, o) {
  o = o || {};
  const place = o.places && r.place ? `<span class="gs-pl" aria-hidden="true"><b class="gs-pl-n">${r.place}</b>${r.tie ? '<small class="gs-tie">tie</small>' : ''}</span>` : '';
  let mv = '';
  if (o.arrows) {
    mv = r.mv > 0 ? `<span class="gs-mv" data-mv="up" aria-hidden="true">${gamesIcon('i-up')}${r.mv}</span>`
      : r.mv < 0 ? `<span class="gs-mv" data-mv="down" aria-hidden="true">${gamesIcon('i-down')}${-r.mv}</span>`
      : '<span class="gs-mv" data-mv="same" aria-hidden="true">–</span>';
  }
  const awarded = r.awarded ? `<span class="gs-x"> · ${r.awarded > 0 ? '+' + r.awarded + '&nbsp;awarded' : '−' + Math.abs(r.awarded) + '&nbsp;taken off'}</span>` : '';
  const medals = `${r.gold}&nbsp;gold · ${r.silver}&nbsp;silver · ${r.bronze}&nbsp;bronze${awarded}`;
  const name = esc(r.short);
  const inner = `${place}${mv}<span class="gs-mark">${teamMarkHtml(r.team, { size: 28 })}</span>` +
    `<span class="gs-nm"><b class="gs-name">${name}${r.locked ? gamesIcon('i-lock', 'gs-lock') : ''}</b><small class="gs-medals">${medals}</small></span><b class="gs-pts">${r.pts}</b>`;
  const li = `<li class="gs-item" data-key="${esc(r.key)}" data-team="${esc(r.team)}"${gamesAccent(r.team)}${r.tie && o.places ? ' data-tie' : ''}${r.locked ? ' data-mine' : ''}>`;
  if (r.locked) return li + `<div class="gs-row" data-locked>${inner}<span class="visually-hidden">Your team: another director gives these points</span></div></li>`;
  if (!r.tap) return li + `<div class="gs-row">${inner}</div></li>`;
  const aria = r.name === r.short ? r.short : r.name;
  const said = [aria, o.places && r.place ? gamesOrdinal(r.place) + (r.tie ? ', tied' : '') : '', o.arrows && r.mv ? (r.mv > 0 ? 'up ' : 'down ') + Math.abs(r.mv) + ' since this morning' : '',
    r.pts + ' point' + (r.pts === 1 ? '' : 's')].filter(Boolean).join(' · ');
  return li + `<button type="button" class="gs-row" data-quick-team="${esc(r.team)}" aria-haspopup="dialog" aria-controls="sheet-quick" aria-label="${esc(said)}. Give quick points">${inner}</button></li>`;
}

function gamesStandingRowsHtml(st) {
  const o = { places: !st.empty, arrows: st.arrows };
  return st.rows.map((r) => gamesStandingRowHtml(r, o)).join('');
}

// The gap sentence with its team names in bold (the model hands the parts over; a name is escaped here).
function gamesGapHtml(sentence) {
  if (!sentence) return '';
  return sentence.parts.map((p) => (p.team ? `<b>${esc(nowTeamWord(p.team))}</b>` : esc(p.text))).join('');
}

// The takeover dock after a result is saved (directors): what is left, Next game, where Back goes.
function gamesDockHtml(d) {
  if (!d) return '';
  const back = (cls) => `<button type="button" class="btn btn-big ${cls} gd-back" id="game-dock-back" data-game-back>‹ ${esc(d.back)}</button>`;
  if (d.tone === 'next') {
    return `<p class="gd-left" id="game-left">${esc(d.left)}</p><div class="gd-next">${back('')}` +
      `<button type="button" class="btn btn-big btn-gold gd-go" id="game-next" data-next-game="${esc(d.next.id)}" data-joy><span class="gd-go-t">Next game</span><span class="gd-go-s">${esc(d.next.name)} →</span></button></div>`;
  }
  if (d.tone === 'done') return `<p class="gd-left" id="game-left" data-tone="done">${gamesIcon('i-check')}${esc(d.left)}</p>${back('btn-block')}`;
  return `<p class="gd-left" id="game-left">${esc(d.left)}</p>${back('btn-block')}`;
}

// ════════════════════════════════════════════════════════════════════
// THE PAINT
// ════════════════════════════════════════════════════════════════════
// The directors' standings panel. Its visibility is applyCardVisibility's (data-card="standings": a director's, confirmed); a model
// without standings (a counselor, a preview, a hint-painted phone) empties the list as well, so no row outlives a role flip.
function gamesPaintStandings(m, live) {
  const st = m.standings;
  const list = gamesEl('gs-list');
  const root = gamesEl('games-live');
  if (!st) {
    if (list) { setHtmlIfChanged(list, ''); list.__keyedView = undefined; }
    setHtmlIfChanged(gamesEl('gs-gap'), '');
    gamesUi.pts = {};
    return;
  }
  setAttrIfChanged(root, 'data-empty', st.empty);
  const taps = st.rows.some((r) => r.tap);
  const how = taps ? (st.arrows ? 'Arrows: places moved since this morning · tap a team to give quick points' : 'Tap a team to give quick points')
    : (st.arrows ? 'Arrows: places moved since this morning' : '');
  setTextIfChanged(gamesEl('gs-how'), how);
  setHiddenIfChanged(gamesEl('gs-how'), !how);
  const html = gamesStandingRowsHtml(st);
  paintKeyedList(list, html, { view: 'standings' });
  const gap = gamesEl('gs-gap');
  if (st.empty) {
    setHtmlIfChanged(gap, 'No points yet. The first saved game starts the table.');
    setHiddenIfChanged(gap, false);
  } else {
    const g = gamesGapHtml(st.sentence);
    setHtmlIfChanged(gap, g);
    setHiddenIfChanged(gap, !g);
  }
  // A number that changed under a person looking at it pops (a first paint, and the tab arriving, are plain writes).
  if (live && gamesUi.painted && typeof JellyMotion !== 'undefined' && list && list.querySelector) {
    st.rows.forEach((r) => {
      if (gamesUi.pts[r.team] === undefined || gamesUi.pts[r.team] === r.pts) return;
      const el = list.querySelector('[data-team="' + r.team + '"] .gs-pts');
      if (el) JellyMotion.play(el, 'press', (x) => ({ transform: 'scale(' + (1 + 0.3 * (1 - Math.min(1, x))) + ')', transformOrigin: '100% 50%' }), { calm: false });
    });
  }
  gamesUi.pts = {};
  st.rows.forEach((r) => { gamesUi.pts[r.team] = r.pts; });
}

// A phone that may not read the standings (a demoted director, a counselor preview starting, a role the member record has not
// confirmed yet) loses them from the page whichever tab is showing: the Games panel renders only while it is on screen, so
// hiding it is not enough — the markup is EMPTIED (secrecy: nothing a counselor must not read may sit in a node). app.js's
// runStandingsSideEffects calls this on every pass for such a phone. The quick-points sheet's own words go with them.
function gamesClearStandings() {
  setHtmlIfChanged(gamesEl('gs-list'), '');
  setHtmlIfChanged(gamesEl('gs-gap'), '');
  setHiddenIfChanged(gamesEl('gs-gap'), true);
  setHtmlIfChanged(gamesEl('qp-mark'), '');
  setTextIfChanged(gamesEl('qp-team'), 'Quick points');
  setTextIfChanged(gamesEl('qp-now'), '');
  gamesUi.pts = {};
  gamesUi.quick = { team: null, pts: 0, why: '', other: '' };
  gamesUi.quickWas = null;
}

// The counselors' one quiet line (§5.6), unless the revealed grid is up above it. reveal-ui calls this when the grid moves.
function gamesSecretShown() {
  if (standingsVisible()) return false;
  if (typeof nowHiddenSections === 'function' && nowHiddenSections().games) return false;
  return !(typeof revealGridView === 'function' && revealGridView());
}
function renderGamesSecret() {
  setHiddenIfChanged(gamesEl('games-secret'), !gamesSecretShown());
}

// The day picker: a pill that springs from the old day to the new, tabs with roving focus.
function gamesPaintPicker(m, live) {
  const track = gamesEl('games-days-pick');
  const nav = track && track.closest ? track.closest('nav') : null;
  setHiddenIfChanged(nav, !m.days.length);
  if (!track) return;
  const idx = m.days.findIndex((d) => d.selected);
  if (track.style && track.style.setProperty) {
    track.style.setProperty('--n', String(Math.max(1, m.days.length)));
    track.style.setProperty('--i', String(Math.max(0, idx)));
  }
  const prevIdx = gamesUi.dayIdx;
  const wrote = setHtmlIfChanged(track, gamesDayPickHtml(m.days));
  gamesUi.dayIdx = idx;
  if (!wrote || !live || prevIdx < 0 || prevIdx === idx || idx < 0 || typeof JellyMotion === 'undefined') return;
  const pill = track.querySelector ? track.querySelector('.gdp-pill') : null;
  const btns = track.querySelectorAll ? track.querySelectorAll('.gdp-btn') : [];
  const step = btns.length > 1 ? btns[1].offsetLeft - btns[0].offsetLeft : 0;
  if (!pill || !(step > 0)) return;
  const from = (prevIdx - idx) * step; // the pill rests under the new day; it springs from where the old one was
  JellyMotion.play(pill, 'snap', (x) => ({ transform: 'translateX(' + from * (1 - Math.min(1, x)) + 'px)' }), { calm: false });
}

// A day arrives from the side it came from (calm: a fade).
function gamesSlideIn(el, dir) {
  if (!el || typeof JellyMotion === 'undefined' || !dir) return;
  JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateX(' + dir * 22 * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.8) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 140 });
}

function gamesPaintDay(m, live) {
  const panel = gamesEl('games-day');
  const sel = m.days.find((d) => d.selected);
  setAttrIfChanged(panel, 'aria-labelledby', sel ? 'gdp-' + sel.id : null);
  const note = gamesEl('games-day-note');
  setTextIfChanged(note, m.dayNote);
  setHiddenIfChanged(note, !m.dayNote);
  const notes = gamesEl('games-day-notes');
  const nh = gamesNotesHtml(m.notes);
  setHtmlIfChanged(notes, nh);
  setHiddenIfChanged(notes, !nh);
  const body = gamesEl('games-day-body');
  const html = m.empty ? gamesEmptyHtml(m.empty) : m.blocks.map(gamesBlockHtml).join('');
  const dayId = m.day ? m.day.id : null;
  const changed = gamesUi.painted && gamesUi.dayId !== dayId;
  const view = 'day:' + dayId;
  if (changed) { body.__keyedView = undefined; setHtmlIfChanged(body, html); body.__keyedView = view; } else paintKeyedList(body, html, { view });
  if (changed && live && sel) {
    const was = m.days.findIndex((d) => d.id === gamesUi.dayId);
    const now = m.days.indexOf(sel);
    gamesSlideIn(body, was < 0 ? 0 : now > was ? 1 : -1);
  }
  gamesUi.dayId = dayId;
  const quick = gamesEl('games-quick');
  setHiddenIfChanged(quick, !m.quick);
  if (m.quick) setTextIfChanged(gamesEl('games-quick-sub'), m.quick.sub);
  // A game that went Live → Done under someone's eyes pops its check.
  const seen = {};
  m.blocks.forEach((b) => b.rows.forEach((r) => { seen[r.id] = r.status; }));
  if (live && !changed && gamesUi.painted && typeof nowCheckPop === 'function' && body.querySelector) {
    Object.keys(seen).forEach((id) => {
      if (gamesUi.statuses[id] === 'live' && seen[id] === 'done') nowCheckPop(body.querySelector('[data-key="g-' + id + '"] .gr-st'));
    });
  }
  gamesUi.statuses = seen;
}

function renderGamesPanel(m) {
  if (!m) return;
  gamesWire();
  const live = gamesOnScreen();
  if (m.off) { gamesUi.painted = true; return; } // What counselors see turned Games off: applyCardVisibility hides the sections, #games-off says so
  renderGamesSecret();
  gamesPaintStandings(m, live);
  gamesPaintPicker(m, live);
  gamesPaintDay(m, live);
  gamesUi.painted = true;
}

// ════════════════════════════════════════════════════════════════════
// TAPS
// ════════════════════════════════════════════════════════════════════
// Another day: the choice is this device's own (state.ui.day), painted at once, no renderAll round trip.
function gamesPickDay(id, focus) {
  if (!id || !competitionDays().some((d) => d.id === id) || state.ui.day === id) return;
  state.ui.day = id;
  saveState();
  renderGamesPanel(gamesModel());
  if (focus) { const b = gamesEl('gdp-' + id); if (b && typeof b.focus === 'function') { try { b.focus({ preventScroll: true }); } catch (e) { /* fine */ } } }
}

function gamesDayKey(e) {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const t = e.target && e.target.closest ? e.target.closest('.gdp-btn') : null;
  if (!dir || !t) return;
  const days = competitionDays();
  const at = days.findIndex((d) => d.id === t.dataset.day);
  const to = days[at + dir];
  if (!to) return;
  e.preventDefault();
  gamesPickDay(to.id, true);
}

// Tap a team: its quick-points sheet. A director only (the sheet is not allowed for anyone else, whatever asked), never the own team.
function gamesQuickReady() {
  const q = gamesUi.quick;
  return !!q.team && canEdit() && standingsVisible() && teamIds().includes(q.team) && canScoreRound(q.team);
}
function gamesOpenQuick(team, opener) {
  if (!canEdit() || !standingsVisible() || !teamIds().includes(team)) return;
  if (!canScoreRound(team)) { showToast("Your own team's points are given by another director."); return; }
  gamesUi.quick = { team, pts: 0, why: '', other: '' };
  gamesUi.quickWas = null;
  shellSheetOpen('quick', opener);
}

function gamesQuickWhy() {
  const q = gamesUi.quick;
  return q.why === 'other' ? q.other.trim() : q.why;
}

// The sheet: patched in place on open and on every pass while it is up (a key's aria-checked, the add button's words); an idle pass
// writes nothing.
function renderQuickSheet() {
  const q = gamesUi.quick;
  const info = q.team ? gamesQuickInfo(q.team) : null;
  if (!info) return;
  const sig = JSON.stringify([q, info.now, info.name, info.doubled, !!canScoreRound(q.team)]);
  if (gamesUi.quickWas === sig) return;
  gamesUi.quickWas = sig;
  setHtmlIfChanged(gamesEl('qp-mark'), teamMarkHtml(q.team, { size: 34 }));
  setTextIfChanged(gamesEl('qp-team'), info.name);
  setTextIfChanged(gamesEl('qp-now'), info.now);
  const keys = gamesEl('qp-keys');
  if (keys && keys.querySelectorAll) {
    const btns = keys.querySelectorAll('.qp-key');
    const any = Array.prototype.some.call(btns, (b) => Number(b.dataset.pts) === q.pts);
    Array.prototype.forEach.call(btns, (b, i) => {
      const on = Number(b.dataset.pts) === q.pts;
      setAttrIfChanged(b, 'aria-checked', on ? 'true' : 'false');
      setAttrIfChanged(b, 'tabindex', on || (!any && i === 0) ? '0' : '-1');
    });
  }
  const why = gamesEl('qp-why');
  if (why && why.querySelectorAll) {
    const chips = why.querySelectorAll('.qp-chip');
    const any = Array.prototype.some.call(chips, (b) => b.dataset.why === q.why);
    Array.prototype.forEach.call(chips, (b, i) => {
      const on = b.dataset.why === q.why;
      setAttrIfChanged(b, 'aria-checked', on ? 'true' : 'false');
      setAttrIfChanged(b, 'tabindex', on || (!any && i === 0) ? '0' : '-1');
    });
  }
  setHiddenIfChanged(gamesEl('qp-other'), q.why !== 'other');
  // the doubling is said once, here, so the button stays short
  const x2 = gamesEl('qp-x2');
  setHiddenIfChanged(x2, !info.doubled);
  if (info.doubled) {
    const span = x2 && x2.querySelector ? x2.querySelector('span') : null;
    setTextIfChanged(span, 'Double points today · ' + (q.pts ? '+' + q.pts + ' counts as ' + q.pts * 2 : 'quick points count twice'));
  }
  const add = gamesEl('qp-add');
  setAttrIfChanged(add, 'aria-disabled', q.pts ? null : 'true');
  setTextIfChanged(gamesEl('qp-add-label'), q.pts ? 'Add ' + q.pts + ' point' + (q.pts === 1 ? '' : 's') + ' to ' + info.short : 'Pick how many points');
}

function gamesQuickAddTap() {
  const q = gamesUi.quick;
  if (!q.pts) {
    // The dashed well: a tap says what is missing instead of doing nothing.
    const keys = gamesEl('qp-keys');
    const first = keys && keys.querySelector ? keys.querySelector('.qp-key') : null;
    if (first && typeof first.focus === 'function') { try { first.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
    return;
  }
  const team = q.team;
  const r = gamesQuickAdd(team, q.pts, gamesQuickWhy());
  if (!r.ok) {
    showToast(r.problem === 'own-team' ? "Your own team's points are given by another director." : 'Those points could not be added.');
    return;
  }
  const short = nowTeamWord(team);
  shellSheetClose('quick');
  gamesUi.quick = { team: null, pts: 0, why: '', other: '' };
  gamesUi.quickWas = null;
  glideNow(renderAll); // the standings re-sort and glide; the team's number pops
  showToast('+' + r.pts + ' for ' + short + (r.counted !== r.pts ? ' (counts as ' + r.counted + ')' : ''), {
    action: { label: 'Undo', run: () => { glideNow(() => gamesQuickUndo(r.ids)); } }, duration: GAMES_QUICK_UNDO_MS,
  });
}

// Radio groups (keys, reasons): the arrows move the choice and the focus with it.
function gamesRadioKeys(e, group, pick) {
  const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!dir) return;
  const btns = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
  const at = btns.indexOf(e.target.closest('[role="radio"]'));
  if (at < 0) return;
  e.preventDefault();
  const to = btns[(at + dir + btns.length) % btns.length];
  pick(to);
  if (typeof to.focus === 'function') { try { to.focus({ preventScroll: true }); } catch (err) { /* fine */ } }
}

function gamesPickKey(btn) {
  gamesUi.quick.pts = Number(btn.dataset.pts) || 0;
  renderQuickSheet();
}
function gamesPickWhy(btn) {
  const was = gamesUi.quick.why;
  gamesUi.quick.why = btn.dataset.why === was ? '' : btn.dataset.why; // tap the chosen reason again: no reason
  renderQuickSheet();
  if (gamesUi.quick.why === 'other') {
    const inp = gamesEl('qp-other-text');
    if (inp && typeof inp.focus === 'function') { try { inp.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  }
}

// The standings' "…" sheet: what the old table's buttons did, and the way into Award points.
function renderStandingsSheet() {
  setHiddenIfChanged(gamesEl('gs-share'), !(typeof navigator !== 'undefined' && navigator.share));
  setHiddenIfChanged(gamesEl('gs-award'), !(typeof toolMayOpen === 'function' && toolMayOpen('award')));
}
function gamesCopyStandings() {
  if (!standingsVisible()) return;
  shellSheetClose('standings');
  copyTextToClipboard(standingsSummaryText(), () => showToast('Copied the standings'));
}
function gamesShareStandings() {
  if (!standingsVisible() || typeof navigator === 'undefined' || !navigator.share) return;
  shellSheetClose('standings');
  navigator.share({ text: standingsSummaryText() }).catch(() => {});
}
function gamesOpenAward() {
  shellSheetClose('standings');
  if (typeof openTool === 'function') openTool('award', { from: 'games' });
}

// The takeover's dock (directors, after a result): Back and Next game. Written only when it changes.
function renderGameDock(g) {
  const dock = gamesEl('takeover-game-dock');
  if (!dock) return;
  gamesWire();
  const d = g ? gamesDock(g.id) : null;
  const html = gamesDockHtml(d);
  setHtmlIfChanged(dock, html);
  setHiddenIfChanged(dock, !d);
}

function gamesWire() {
  if (gamesUi.wired) return;
  const tab = gamesEl('tab-games');
  if (!tab || typeof tab.addEventListener !== 'function') return;
  gamesUi.wired = true;
  tab.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    let b;
    if ((b = t.closest('[data-quick-team]'))) { gamesOpenQuick(b.dataset.quickTeam, b); return; }
    if ((b = t.closest('.gdp-btn'))) { gamesPickDay(b.dataset.day); return; }
    if ((b = t.closest('[data-score-game]'))) { openGame(b.dataset.scoreGame, { from: 'games' }); return; }
    if ((b = t.closest('[data-open-game]'))) { openGame(b.dataset.openGame, { from: 'games' }); return; }
    if ((b = t.closest('[data-games-add]'))) { if (canEdit()) openBuilder('games'); return; }
    if (t.closest('#games-quick')) { if (typeof startQuickGame === 'function') startQuickGame(); return; }
    if (t.closest('#gs-more')) { shellSheetOpen('standings', t.closest('#gs-more')); return; }
  });
  tab.addEventListener('keydown', gamesDayKey);
  const qs = gamesEl('sheet-quick');
  if (qs && qs.addEventListener) {
    qs.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      let b;
      if ((b = t.closest('.qp-key'))) { gamesPickKey(b); return; }
      if ((b = t.closest('.qp-chip'))) { gamesPickWhy(b); return; }
      if (t.closest('#qp-add')) gamesQuickAddTap();
    });
    qs.addEventListener('keydown', (e) => {
      const keys = gamesEl('qp-keys');
      const why = gamesEl('qp-why');
      if (keys && keys.contains(e.target)) gamesRadioKeys(e, keys, gamesPickKey);
      else if (why && why.contains(e.target)) gamesRadioKeys(e, why, gamesPickWhy);
    });
    const other = gamesEl('qp-other-text');
    if (other) other.addEventListener('input', () => { gamesUi.quick.other = other.value; gamesUi.quickWas = null; renderQuickSheet(); });
  }
  const ss = gamesEl('sheet-standings');
  if (ss && ss.addEventListener) {
    ss.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('#gs-copy')) gamesCopyStandings();
      else if (t.closest('#gs-share')) gamesShareStandings();
      else if (t.closest('#gs-award')) gamesOpenAward();
    });
  }
  const dock = gamesEl('takeover-game-dock');
  if (dock && dock.addEventListener) {
    dock.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-next-game]')) { openNextGame(); return; }
      if (t.closest('[data-game-back]')) closeGame();
    });
  }
}
