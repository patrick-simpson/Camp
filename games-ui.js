// ── games-ui.js — THE GAMES TAB'S RENDERERS (redesign §5; BUILD-PLAN Step 18, build session 1) ─────────────────
// app.js's gamesModel() is the whole Games tab as PLAIN DATA (the day picker, the day's blocks with their game rows, the
// directors' standings); this file paints it onto the static markup in #tab-games (index.html: the comment there documents
// every hook and row template), runs the two sheets (#sheet-quick, #sheet-standings) and draws the takeover's Next game dock.
// Same contract as now-ui.js / award.js / tell.js: a classic script loaded after app.js and now-ui.js, every hook in app.js
// typeof-guarded (delete the <script> and the Games tab is an empty page, the app still runs), static markup, change-only writes.
// Hooks app.js calls: renderGamesPanel(model) for a paint, renderQuickSheet() / renderStandingsSheet() when those sheets fill,
// gamesQuickReady() to decide whether the quick-points sheet may open, renderGameDock(game) from the game takeover, and (build
// session 2) renderPodiumPicker(container, game) / renderSavedResult(container, game, result) for the takeover's entry area and
// gamesSavedRefresh() when a write is acknowledged or the connection changes.
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
  // While a podium is being picked: ONE button. The dashed well names what is still to pick (a tap on it goes there); complete,
  // it is the gold Save.
  // A four-team bracket ready to save: the same gold button (its id is the bracket's own Save, fourSaveResult behind it).
  if (d.tone === 'four') return '<button type="button" class="btn btn-big btn-block btn-gold gd-save" id="save-bracket-btn" data-kind="four" data-joy>Save result</button>';
  if (d.tone === 'six') return '<button type="button" class="btn btn-big btn-block btn-gold gd-save" id="save-bracket-btn" data-kind="six" data-joy>Save result</button>';
  // Score entry: the dashed well naming what is missing, or (a small line, then) the gold Save.
  if (d.tone === 'tally') {
    return d.save.ready
      ? (d.note ? `<p class="gd-left" id="game-save-note">${esc(d.note)}</p>` : '') + '<button type="button" class="btn btn-big btn-block btn-gold gd-save" id="game-save" data-tone="tally" data-joy>Save result</button>'
      : `<button type="button" class="btn btn-big btn-block gd-save" id="game-save" data-tone="tally" aria-disabled="true">${esc(d.save.label)}</button>`;
  }
  if (d.tone === 'pick') {
    return d.save.ready ? '<button type="button" class="btn btn-big btn-block btn-gold gd-save" id="game-save" data-joy>Save result</button>'
      : `<button type="button" class="btn btn-big btn-block gd-save" id="game-save" aria-disabled="true">${esc(d.save.label)}</button>`;
  }
  // The button shows the header back's own short words ("‹ Wednesday games", "‹ Now": two lines at most beside Next game); its
  // spoken name is the whole sentence ("Back to Wednesday games"), which contains the words it shows.
  const back = (cls) => `<button type="button" class="btn btn-big ${cls} gd-back" aria-label="${esc(d.back)}" id="game-dock-back" data-game-back>‹ ${esc(d.to || d.back)}</button>`;
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
  setDataIfChanged(root, 'empty', st.empty);
  // Arrows off (no baseline this morning: a first competition day) takes the arrow column away, or it leaves a hole by the place.
  setDataIfChanged(root, 'noarrows', !st.empty && !st.arrows);
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
      // §9.5's points pop: the new number rolls up 10px and settles from 1.12 (calm: nothing moves, the number is simply new).
      if (el) JellyMotion.play(el, 'press', (x) => { const r = 1 - Math.min(1, x); return { transform: 'translateY(' + 10 * r + 'px) scale(' + (1 + 0.12 * r) + ')', transformOrigin: '100% 50%' }; }, { calm: false });
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
  // §9.5: translateX with a stretch from the pill's own speed (the tab blob's rule: scale(1+s, 1−0.4s), s = min(.5, |v|/1600)).
  JellyMotion.play(pill, 'snap', (x, v) => {
    const s = Math.min(0.5, Math.abs(v * from) / 1600);
    return { transform: 'translateX(' + from * (1 - Math.min(1, x)) + 'px) scale(' + (1 + s) + ', ' + (1 - 0.4 * s) + ')' };
  }, { calm: false });
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
  if (m.off) { // What counselors see turned Games off: applyCardVisibility hides the sections, #games-off says so; nothing stays in them
    setHtmlIfChanged(gamesEl('games-day-body'), '');
    setHtmlIfChanged(gamesEl('games-days-pick'), '');
    gamesUi.painted = true;
    gamesUi.dayId = null;
    gamesUi.dayIdx = -1;
    return;
  }
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
  const sig = JSON.stringify([q, info.now, info.medals, info.short, info.doubled, !!canScoreRound(q.team)]);
  if (gamesUi.quickWas === sig) return;
  gamesUi.quickWas = sig;
  setHtmlIfChanged(gamesEl('qp-mark'), teamMarkHtml(q.team, { size: 34 }));
  // The title is the short name the tapped row and the Add button say ("Maples", not three lines of the full name at large text).
  setTextIfChanged(gamesEl('qp-team'), info.short);
  // The place and points, then the medals on a line of their own (the row leaves them out at very large text).
  setTextIfChanged(gamesEl('qp-now'), info.medals ? info.now + '\n' + info.medals : info.now);
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

// ════════════════════════════════════════════════════════════════════
// THE PODIUM PICKER (mockup 14) AND THE SAVED RESULT (mockup 14b)
// ════════════════════════════════════════════════════════════════════
// app.js's renderPlacement / renderResult hand the takeover's entry area here (gamesPodium / gamesResultModel are the data). The
// picker is built ONCE per game and team list and then PATCHED in place (attributes and two small slots per key), so a pick
// cross-fades the next row from waiting, a finger and the keyboard focus stay on the key they pressed, and a snapshot that changes
// nothing writes nothing. Its taps write the draft's own leaves (podiumPick), never a form: two directors can pick at once.
// data-joy: a pick is a sparkle place (§9.7), a key that can't be pressed is not.
function gamesPodiumKeyAttrs(k) {
  return { 'aria-pressed': k.picked ? 'true' : 'false', 'aria-disabled': k.disabled ? 'true' : null, 'data-taken': k.taken || null, 'aria-label': k.label, 'data-joy': k.disabled ? null : '' };
}
function gamesPodiumTakenHtml(k) {
  const place = PODIUM_MEDALS.indexOf(k.taken) + 1;
  return place ? `<i class="pp-disc" data-place="${place}" aria-hidden="true">${place}</i>has ${esc(k.taken)}` : '';
}
// A key: the team's mark over its short name; the check and the "has gold" tab are permanent slots, shown with `hidden`. Taken
// is a tab with the MEDAL named, never the bare word (senior has a team called Gold); the spoken label says it too.
function gamesPodiumKeyHtml(k) {
  const attrs = gamesPodiumKeyAttrs(k);
  const at = Object.keys(attrs).filter((n) => attrs[n] !== null).map((n) => ` ${n}="${esc(attrs[n])}"`).join('');
  return `<button type="button" class="pp-team" data-team="${esc(k.team)}"${gamesAccent(k.team)}${at}>` +
    `<span class="pp-mark">${teamMarkHtml(k.team, { size: 28 })}</span><span class="pp-nm">${esc(k.short)}</span>` +
    `<i class="pp-ok" aria-hidden="true"${k.picked ? '' : ' hidden'}>${gamesIcon('i-check')}</i>` +
    `<span class="pp-taken" aria-hidden="true"${k.taken ? '' : ' hidden'}>${gamesPodiumTakenHtml(k)}</span></button>`;
}
// `shapeOnly` draws every key idle (nothing picked, nothing waiting): what must match for the built picker to be kept.
function gamesPodiumHtml(m, shapeOnly) {
  const idle = (k) => (shapeOnly ? { team: k.team, short: k.short, label: k.name, picked: false, taken: '', disabled: false } : k);
  const rows = m.rows.map((r) => {
    const above = r.place > 1 ? PODIUM_MEDALS[r.place - 2] : null;
    return `<div class="pp-row" data-medal="${r.medal}"${!shapeOnly && r.wait ? ' data-wait' : ''}>` +
      `<p class="pp-h" id="pp-h-${r.medal}"><i class="pp-disc" data-place="${r.place}" aria-hidden="true">${r.place}</i><b class="pp-medal">${r.word}</b>` +
      (r.pts !== null ? `<span class="pp-pts">${r.pts} points</span>` : '') + (above ? `<span class="pp-wait">after ${above}</span>` : '') + '</p>' +
      `<div class="pp-teams" role="group" aria-labelledby="pp-h-${r.medal}" data-n="${r.teams.length}">${r.teams.map((k) => gamesPodiumKeyHtml(idle(k))).join('')}</div></div>`;
  }).join('');
  return `<div class="pp" id="podium-picker"><p class="visually-hidden">Pick the gold, silver and bronze teams. Tap a picked team again to clear it.</p>${rows}</div>`;
}

// Bring the built picker up to date with the model, in place. Returns the check marks that just appeared (they pop).
function gamesPodiumPatch(root, m) {
  const popped = [];
  m.rows.forEach((r) => {
    const row = root.querySelector('.pp-row[data-medal="' + r.medal + '"]');
    if (!row) return;
    setAttrIfChanged(row, 'data-wait', r.wait);
    const keys = Array.prototype.slice.call(row.querySelectorAll('.pp-team'));
    r.teams.forEach((k) => {
      const b = keys.find((x) => x.dataset && x.dataset.team === k.team);
      if (!b) return;
      const was = b.getAttribute('aria-pressed') === 'true';
      const attrs = gamesPodiumKeyAttrs(k);
      Object.keys(attrs).forEach((n) => setAttrIfChanged(b, n, attrs[n]));
      const ok = b.querySelector('.pp-ok');
      setHiddenIfChanged(ok, !k.picked);
      if (k.picked && !was && ok) popped.push(ok);
      const tab = b.querySelector('.pp-taken');
      setHiddenIfChanged(tab, !k.taken);
      if (k.taken) setHtmlIfChanged(tab, gamesPodiumTakenHtml(k));
    });
  });
  return popped;
}

function renderPodiumPicker(container, g) {
  if (!container || !g) return;
  gamesWireEntry(container);
  const m = gamesPodium(g);
  const shape = gamesPodiumHtml(m, true);
  const root = container.querySelector ? container.querySelector('#podium-picker') : null;
  if (!root || container.__ppShape !== shape || container.__ppGid !== g.id) {
    setHtmlIfChanged(container, gamesPodiumHtml(m, false));
    container.__ppShape = shape;
    container.__ppGid = g.id;
    container.__liveKey = null; // the result view compares against its own last write: that key is no longer what is on screen
    container.__liveHolds = null;
    return;
  }
  const popped = gamesPodiumPatch(root, m);
  if (typeof JellyMotion !== 'undefined') popped.forEach((el) => JellyMotion.play(el, 'snap', (x) => ({ transform: 'scale(' + (0.3 + 0.7 * x) + ')' }), { calm: false }));
}

// A tap on a key: pick, the same key again clears, a team holding another medal moves. A refusal says why in a few words.
function gamesPodiumTap(btn) {
  const row = btn && btn.closest ? btn.closest('.pp-row') : null;
  const gid = state.ui && state.ui.gameId;
  if (!row || !gid) return null;
  const r = podiumPick(gid, row.dataset.medal, btn.dataset.team);
  if (!r.ok) {
    if (r.problem === 'wait') showToast('Pick the ' + PODIUM_MEDALS[PODIUM_MEDALS.indexOf(row.dataset.medal) - 1] + ' team first.');
    return r;
  }
  renderAll();
  // A move says what happened (the key's "has silver" tab was the warning; the screen then shows it); a swap names both teams.
  if (r.action === 'move') showToast(nowTeamWord(btn.dataset.team) + ' moved from ' + r.from + ' to ' + r.medal + '.');
  if (r.action === 'swap') {
    showToast(nowTeamWord(r.team) + ' and ' + nowTeamWord(r.other) + ' swapped: ' + nowTeamWord(r.team) + ' has ' + r.medal + ', '
      + nowTeamWord(r.other) + ' has ' + r.from + '.');
  }
  return r;
}

// The dashed Save well names what is missing; a tap on it goes to that row (and its first free key).
function gamesPodiumGoto(medal) {
  const root = gamesEl('podium-picker');
  const row = root && root.querySelector ? root.querySelector('.pp-row[data-medal="' + medal + '"]') : null;
  if (!row) return;
  const key = row.querySelector('.pp-team:not([aria-disabled="true"])') || row.querySelector('.pp-team');
  try { row.scrollIntoView({ block: 'center', behavior: calmMotion() ? 'auto' : 'smooth' }); } catch (e) { /* fine */ }
  if (key && typeof key.focus === 'function') { try { key.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

// Save: the dock's gold button. Then the takeover is the saved result and Next game is what the thumb is there for.
function gamesSaveTap(btn) {
  const gid = state.ui && state.ui.gameId;
  if (!gid) return null;
  const had = focusWas(btn);
  const r = podiumSave(gid);
  if (!r.ok) {
    if (r.problem === 'incomplete') gamesPodiumGoto(r.target);
    return r;
  }
  const body = gamesEl('takeover-game-body');
  if (body) body.scrollTop = 0; // the saved line and the winners, from the top
  if (had) focusBack(true, gamesEl('game-next') || gamesEl('game-dock-back'));
  gamesSavedArrive(body);
  return r;
}

// The four-team bracket's Save (the dock's gold button while the summary shows): resolved at the tap, the refusal said in words,
// then the same landing as a podium's Save — the saved winners from the top, focus on Next game.
function gamesFourSaveTap(btn) {
  const gid = state.ui && state.ui.gameId;
  const g = gid ? gameById(gid) : null;
  if (!g || typeof fourSaveResult !== 'function') return null;
  const had = focusWas(btn);
  const r = fourSaveResult(g);
  if (!r.ok) { if (typeof fourSay === 'function') fourSay(r); return r; }
  const body = gamesEl('takeover-game-body');
  if (body) body.scrollTop = 0;
  if (had) focusBack(true, gamesEl('game-next') || gamesEl('game-dock-back'));
  gamesSavedArrive(body);
  return r;
}

// The six-team bracket's Save: the same landing as the four-team one; a stale screen (the bracket moved on, a result is already
// saved) is said by sixLive and repainted.
function gamesSixSaveTap(btn) {
  const gid = state.ui && state.ui.gameId;
  const g = gid ? gameById(gid) : null;
  if (!g || typeof sixSaveResult !== 'function' || !canEdit()) return null;
  const had = focusWas(btn);
  const r = sixSaveResult(g);
  if (!r.ok) return r;
  const body = gamesEl('takeover-game-body');
  if (body) body.scrollTop = 0;
  if (had) focusBack(true, gamesEl('game-next') || gamesEl('game-dock-back'));
  gamesSavedArrive(body);
  return r;
}

// Score entry's Save (the dock's gold button): then the takeover is the saved result and Next game is what the thumb is there for.
function gamesTallySaveTap(btn) {
  const gid = state.ui && state.ui.gameId;
  if (!gid) return null;
  const had = focusWas(btn);
  const r = tallySave(gid);
  if (!r.ok) { if (r.problem === 'incomplete') gamesTallyGoto(r.target); return r; }
  const body = gamesEl('takeover-game-body');
  if (body) body.scrollTop = 0;
  if (had) focusBack(true, gamesEl('game-next') || gamesEl('game-dock-back'));
  gamesSavedArrive(body);
  return r;
}

// The dashed well's tap: to the score box (nothing typed yet) or the medal pick that needs a team, and focus it.
function gamesTallyGoto(target) {
  const entry = gamesEl('entry-area');
  if (!entry || !entry.querySelector) return;
  const el = target === 'scores'
    ? (entry.querySelector('.score-input-row input:not([disabled])'))
    : entry.querySelector('select[data-medal="' + target + '"]');
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', behavior: calmMotion() ? 'auto' : 'smooth' }); } catch (e) { /* fine */ }
  if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

// The save just landed (podiumSave rendered the result synchronously): the winners drop in bronze → silver → gold, 120 ms apart,
// landing with a wobble's squash at their foot (Now's medals, §9.5), and the Next game dock arrives from below. Started by THIS
// tap, never by a render, so a re-render or a snapshot never replays it. Calm: they fade.
function gamesSavedArrive(body) {
  if (typeof JellyMotion === 'undefined') return;
  const rows = body && body.querySelectorAll ? Array.prototype.slice.call(body.querySelectorAll('.gres-r')) : [];
  rows.reverse().forEach((m, i) => {
    JellyMotion.play(m, 'wobble', (x) => {
      const o = Math.max(0, x - 1);
      return { transform: 'translateY(' + (-22 * (1 - Math.min(1, x))) + 'px) scale(' + (1 + 0.6 * o) + ', ' + (1 - o) + ')', transformOrigin: '50% 100%', opacity: Math.min(1, x * 1.8) };
    }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 160, delay: i * 120 });
  });
  const dock = gamesEl('takeover-game-dock');
  const inner = dock && dock.querySelector ? dock.querySelector('.gd-next') || dock.querySelector('.gd-back') : null;
  if (inner) {
    JellyMotion.play(inner, 'arrive', (x) => {
      const o = Math.max(0, x - 1);
      return { transform: 'translateY(' + 18 * (1 - Math.min(1, x)) + 'px) scale(' + (1 + 0.04 * o) + ', ' + (1 - 0.08 * o) + ')', transformOrigin: '50% 100%', opacity: Math.min(1, x * 1.6) };
    }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 160, delay: rows.length * 120 });
  }
}

// A saved result: the line (director only), the winners as a hairline list, a tally's scores under it, Change the result.
// The static markup is compared (setLiveHtmlIfChanged); the line's state and words are patched in place after it, so a write being
// acknowledged never rebuilds the list.
function gamesResultHtml(r) {
  const saved = r.saved ? `<p class="gsv" id="game-saved" role="status">${gamesIcon('i-check')}<span></span></p>` : '';
  const list = `<ol class="gres" aria-label="Final results">${r.places.map((p) =>
    `<li class="gres-r" data-place="${p.place}" data-team="${esc(p.team)}"${gamesAccent(p.team)}${p.mine ? ' data-mine' : ''}>` +
    `<i class="pp-disc" data-place="${p.place}" aria-hidden="true">${p.place}</i><span class="gres-mark">${teamMarkHtml(p.team, { size: 34 })}</span>` +
    `<b class="gres-nm"><span class="visually-hidden">${esc(p.word)}: </span>${esc(p.name)}</b>${p.pts !== null ? `<span class="gres-pts">+${p.pts}</span>` : ''}</li>`).join('')}</ol>`;
  const scores = r.scores ? `<h3 class="gv-h">${esc(r.scores.cap)}</h3><ol class="gres-scores">${r.scores.rows.map((x) =>
    `<li class="gres-s" data-team="${esc(x.team)}"${gamesAccent(x.team)}>${teamMarkHtml(x.team, { size: 22 })}<span class="gres-s-nm">${esc(x.short)}</span><b class="gres-s-v">${esc(x.v)}</b></li>`).join('')}</ol>` : '';
  return saved + list + scores + (r.change ? '<button type="button" class="btn gres-change" id="game-change">Change the result</button>' : '');
}

const GAMES_SAVED_ICON = { saved: 'i-check', saving: 'i-check', offline: 'i-phone', refused: 'i-x' };
function gamesPaintSaved(saved) {
  const el = gamesEl('game-saved');
  if (!el || !saved) return;
  const was = el.dataset ? el.dataset.state : undefined;
  setDataIfChanged(el, 'state', saved.state);
  setTextIfChanged(el.querySelector('span'), saved.text);
  setAttrIfChanged(el.querySelector('use'), 'href', '#' + (GAMES_SAVED_ICON[saved.state] || 'i-check'));
  // The moment the server says it has it, the check pops (a first paint, and a result that was already saved, are plain writes).
  if (was && was !== 'saved' && saved.state === 'saved' && typeof nowCheckPop === 'function') nowCheckPop(el.querySelector('.ico'));
}
// A write was acknowledged, or the connection / a refusal changed: the open game's line follows (it is the only part that does).
function gamesSavedRefresh() {
  const gid = state.ui && state.ui.gameId;
  const result = gid && state.results ? state.results[gid] : null;
  if (!result || !canEdit() || !gameById(gid)) return;
  const st = gameResultState(gid);
  if (st) gamesPaintSaved({ state: st, text: gameSavedWords(st, result.savedAt) });
}

function renderSavedResult(container, g, result) {
  if (!container || !g) return;
  gamesWireEntry(container);
  const r = gamesResultModel(g, result);
  container.__ppShape = null;
  setLiveHtmlIfChanged(container, gamesResultHtml(r), []);
  gamesPaintSaved(r.saved);
}

// Change the result: clears it (its points come off the standings for everyone) and opens the picker again. Asked first. A four-team
// bracket's result can also Reopen the final: the bracket comes back at the final with every other match as it was.
async function gamesChangeResult() {
  const gid = state.ui && state.ui.gameId;
  const g = gid ? gameById(gid) : null;
  if (!g || !canEdit() || !(state.results && state.results[gid])) return false;
  const reopen = typeof fourCanReopen === 'function' && fourCanReopen(g);
  // A director whose own team played the final is not offered Reopen (it decides the final again, as Undo does): the dialog says so.
  const ownFinal = !reopen && typeof fourReopenOwnTeam === 'function' && fourReopenOwnTeam(g);
  // Reopen the final is the main way back (gold, and what it keeps said inside it); Start over, the destructive one, sits under it on
  // its own line, never beside it as an equal; Keep it is the quiet way out.
  const opts = {
    title: 'Change the result for ' + g.name + '?',
    body: 'Its points come off the standings until you save it again.' + (ownFinal ? ' Your team played the final, so another director can reopen it instead.' : ''),
    stack: reopen,
    actions: reopen
      ? [{ label: 'Reopen the final', sub: 'The semifinals and 3rd place stay as they were', value: 'reopen', kind: 'gold' },
        { label: 'Start over', sub: 'The whole bracket is cleared', value: 'clear', kind: 'danger' },
        { label: 'Keep it', value: 'cancel', kind: 'quiet', cancel: true }]
      : [{ label: 'Clear it and pick again', value: 'clear', kind: 'danger' }, { label: 'Keep it', value: 'cancel', cancel: true }],
  };
  const answer = typeof askDialog === 'function' ? await askDialog(opts) : (confirm(opts.title + '\n\n' + opts.body) ? 'clear' : 'cancel');
  // The answer may have taken a while: another director may have changed it, or this phone may have lost its right to.
  if ((answer !== 'clear' && answer !== 'reopen') || !canEdit() || !(state.results && state.results[gid]) || state.ui.gameId !== gid) return false;
  if (answer === 'reopen') {
    if (!fourReopen(g).ok) return false;
    const body = gamesEl('takeover-game-body');
    if (body) body.scrollTop = 0;
    return true;
  }
  delete state.results[gid];
  // "Start over" clears the whole bracket: a node a late tap left under the saved result goes with it, or it would come back as a
  // bracket nobody started (or block the next Start as "already started").
  if (typeof dropBracketNodes === 'function') dropBracketNodes(gid);
  touchData();
  saveState();
  renderAll();
  gamesPodiumGoto('gold');
  return true;
}

// The entry area's own taps (the picker's keys, Change the result), delegated once per node.
function gamesWireEntry(container) {
  if (container.__gamesWired || typeof container.addEventListener !== 'function') return;
  container.__gamesWired = true;
  container.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t) gamesEntryTap(t);
  });
}
function gamesEntryTap(t) {
  let b;
  if ((b = t.closest('.pp-team'))) { gamesPodiumTap(b); return true; }
  if (t.closest('#game-change')) { gamesChangeResult(); return true; }
  return false;
}

// A tap inside the dock: the Save (the dashed well goes to what is missing, the gold one saves), Next game, Back.
function gamesDockTap(t) {
  let b;
  if ((b = t.closest('#save-bracket-btn'))) { if (b.dataset && b.dataset.kind === 'six') gamesSixSaveTap(b); else gamesFourSaveTap(b); return true; }
  if ((b = t.closest('#game-save'))) {
    const tally = b.dataset && b.dataset.tone === 'tally';
    if (b.getAttribute('aria-disabled') === 'true') {
      const d = gamesDock(state.ui && state.ui.gameId);
      if (d && d.save && d.save.target) { if (tally) gamesTallyGoto(d.save.target); else gamesPodiumGoto(d.save.target); }
    } else if (tally) gamesTallySaveTap(b);
    else gamesSaveTap(b);
    return true;
  }
  if (t.closest('[data-next-game]')) { openNextGame(); return true; }
  if (t.closest('[data-game-back]')) { closeGame(); return true; }
  return false;
}

// The takeover's dock (directors): Save while a podium is picked, Back and Next game once a result is saved. Written only when it changes.
function renderGameDock(g) {
  const dock = gamesEl('takeover-game-dock');
  if (!dock) return;
  gamesWire();
  const d = g ? gamesDock(g.id) : null;
  const html = gamesDockHtml(d);
  const wrote = setHtmlIfChanged(dock, html);
  setHiddenIfChanged(dock, !d);
  const pick = !!d && (d.tone === 'pick' || d.tone === 'tally');
  const ready = pick && d.save.ready;
  // The dashed well turning into the gold Save: it lands (a first paint, and a dock that was not picking, are plain writes).
  if (wrote && ready && dock.__saveReady === false && typeof JellyMotion !== 'undefined' && dock.querySelector) {
    const b = dock.querySelector('#game-save');
    if (b) JellyMotion.play(b, 'snap', (x) => ({ transform: 'scale(' + (0.94 + 0.06 * Math.min(1, x)) + ')' }), { calm: false });
  }
  dock.__saveReady = pick ? ready : undefined;
  // A four-team bracket's last winner was just recorded: its Save comes up from the foot of the screen (§9.5 "panel appears";
  // calm: a fade). A first paint of the takeover is a plain write.
  const four = !!d && (d.tone === 'four' || d.tone === 'six');
  const sameGame = !!g && dock.__fourGid === g.id;
  if (wrote && four && sameGame && !dock.__four && typeof JellyMotion !== 'undefined' && dock.querySelector) {
    const b = dock.querySelector('#save-bracket-btn');
    if (b) {
      JellyMotion.play(b, 'arrive', (x) => {
        const o = Math.max(0, x - 1);
        return { transform: 'translateY(' + 18 * (1 - Math.min(1, x)) + 'px) scale(' + (1 + 0.04 * o) + ', ' + (1 - 0.08 * o) + ')', transformOrigin: '50% 100%', opacity: Math.min(1, x * 1.6) };
      }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 160 });
    }
  }
  dock.__four = four;
  dock.__fourGid = g ? g.id : null;
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
    // "Add games" on a day with none: the game sheet on that day (setup-ui.js; the Games screen when no day takes games).
    if ((b = t.closest('[data-games-add]'))) { if (canEdit()) { if (typeof gmAddGames === 'function') gmAddGames(state.ui.day); else openBuilder('games'); } return; }
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
      if (t) gamesDockTap(t);
    });
  }
}
