// ── award.js — AWARD POINTS (redesign §7.3; build plan Step 24) ──────────────────────────────────────────
// One takeover, one day picker (Mon–Fri, opens on today) and three sections: the Memory verse (0–5 per team), Meal
// cleanup (0–3 per team per meal) and Quick points (corrections and minus points, with the day's ledger). It is the
// place for CORRECTIONS: the everyday paths are Now's cleanup moment and the Games standings. Same contract as
// chat.js / tell.js / reveal-ui.js: a classic script loaded after app.js, every hook in app.js typeof-guarded (delete its
// <script> and More shows no Award points row), static markup in index.html, only-if-changed writes.
//
// THE RULES THIS FILE LIVES BY
//  - NEVER A SECOND WRITE PATH FOR THE SAME SLOT. A verse tap is app.js's setVersePoints (the deterministic id
//    `verse-<team>-<dow>`, replacing what the slot held), a cleanup tap is setCleanupPoints (`cleanup-<team>-<dow>-<meal>`),
//    Quick points are bonusAddFromDraft / removeBonusEntry on the shared `bonusDraft` (the Games tab's entry row calls the
//    same functions). So the Memory verse and Meal cleanup sheets in More and this screen can be open in turn and always
//    agree, and no rule (the own-team guard, 1–100, the sign) lives twice.
//  - THE OWN-TEAM GUARD (canScoreRound): a director who is on a team never gets keys for it — its row says so and shows
//    what it has — and its quick-points toggle is locked; the shared writers refuse it anyway.
//  - SECRECY. Points are directors' eyes only: the screen opens only for a CONFIRMED director (toolMayOpen('award') asks
//    standingsVisible()), reads points only through app.js's guarded readers (versePointsByDay, cleanupEarned,
//    bonusCountsDouble), and writes nothing for anyone else.
//  - A STORED 0 IS NOT A MARK: a team that got nothing never looks awarded (the chosen 0 is only outlined in CSS) and a 0 tap
//    clears the slot.
//  - Verse keys show what a tap is worth NOW (doubled in the double-points window; the stored value stays 0–5); cleanup
//    never doubles.
//  - Every database string is escaped (esc) and a team mark is teamMarkHtml. Everything that moves is a JellyMotion preset
//    and honours calm motion. Names are all `award…` / `renderAward…` (one global scope).

const awardUi = {
  dow: 0,            // the day on screen (1 = Monday … 5 = Friday)
  verseOpen: false,  // the verse line opened in place
  wired: false,
  wasOpen: false,
  seenDow: 0,        // the day the lists last drew (a change slides them in from that side)
};

function awardEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }

// "12:30 PM" from minutes since midnight.
function awardClock(min) {
  if (typeof min !== 'number' || !Number.isFinite(min)) return '';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
}

// Today when it is a competition day, else the first one (the weekend opens on Monday).
function awardDefaultDay() {
  const dows = competitionDows();
  const today = campNow().dow;
  return dows.includes(today) ? today : dows[0];
}

function awardTeamWord(id) {
  const t = (state.teams || []).find((x) => x.id === id);
  return t ? (teamShort(id) || t.name) : '';
}

// ════════════════════════════════════════════════════════════════════
// PURE PIECES
// ════════════════════════════════════════════════════════════════════
function awardPts(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }

// The keys alone (verse: 6, cleanup: 4): a radiogroup of `.aw-pt` buttons, the chosen one aria-checked. Now's cleanup moment
// (now-ui.js) draws the same keys, so a key looks and taps the same in both places. `o`: { n, pts, mult, label, cls? }.
function awardKeysHtml(o) {
  const keys = [];
  for (let i = 0; i < o.n; i++) {
    keys.push(`<button type="button" class="aw-pt" role="radio" aria-checked="${o.pts === i}" data-pts="${i}" data-joy>${i * o.mult}</button>`);
  }
  return `<div class="aw-pts${o.cls ? ' ' + o.cls : ''}" role="radiogroup" aria-label="${esc(o.label)}" data-n="${o.n}">${keys.join('')}</div>`;
}

// One team's row of keys (verse: 6 keys, cleanup: 4). `o`: { key, team, meal?, name, tag?, pts (the stored value), n, label,
// mult (what a key is worth: 2 in the window for the verse), locked, given (its shown total, for a locked row) }.
function awardRowHtml(o) {
  const mark = `<span class="aw-mark">${teamMarkHtml(o.team, { size: 28 })}</span>`;
  const name = `<span class="aw-name">${esc(o.name)}</span>${o.tag ? `<span class="aw-tag">${esc(o.tag)}</span>` : ''}`;
  const meal = o.meal ? ` data-meal="${esc(o.meal)}"` : '';
  if (o.locked) {
    const given = o.given > 0 ? `<b class="aw-given">+${o.given}</b>` : '';
    return `<div class="aw-row" data-key="${esc(o.key)}" data-team="${esc(o.team)}"${meal} data-locked>${mark}${name}` +
      `<p class="aw-lock"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg><span>Your team · another director gives these</span>${given}</p></div>`;
  }
  return `<div class="aw-row" data-key="${esc(o.key)}" data-team="${esc(o.team)}"${meal}>${mark}${name}${awardKeysHtml(o)}</div>`;
}

// The Memory verse rows for a day: every team, in roster order.
function awardVerseRows(dow) {
  const earned = versePointsByDay()[dow] || { raw: {}, effective: {} };
  const mult = inDoubleBonusWindow() ? 2 : 1;
  return (state.teams || []).map((t) => awardRowHtml({
    key: 'v-' + t.id, team: t.id, name: t.name, pts: earned.raw[t.id] || 0, n: 6, mult,
    label: t.name + ' · ' + dayLabel(dow) + ' verse', locked: !canScoreRound(t.id), given: earned.effective[t.id] || 0,
  })).join('');
}

// The Meal cleanup rows for a day: a head per meal, the team(s) on the rota (and any team that has points for a meal it is
// not on the rota for, so it stays clearable), or "No team on the rota".
function awardCleanupRows(dow) {
  return MEAL_CLEANUP_MEALS.map((meal) => {
    const assigned = cleanupTeams(dow, meal);
    const earned = cleanupEarned(dow, meal);
    const rows = assigned.concat(teamIds().filter((id) => earned[id] && !assigned.includes(id)));
    const time = awardClock(mealStart(dow, meal));
    const head = `<div class="aw-meal" data-key="m-${esc(meal)}"><span class="aw-meal-name">${esc(meal)}</span>${time ? `<span class="aw-meal-time">${esc(time)}</span>` : ''}</div>`;
    if (!rows.length) return head + `<p class="aw-none" data-key="none-${esc(meal)}">No team on the rota</p>`;
    return head + rows.map((id) => awardRowHtml({
      key: 'c-' + meal + '-' + id, team: id, meal, name: teamName(id), tag: assigned.includes(id) ? '' : 'Not on the rota',
      pts: earned[id] || 0, n: 4, mult: 1, label: teamName(id) + ' · ' + meal + ' cleanup', locked: !canScoreRound(id), given: earned[id] || 0,
    })).join('');
  }).join('');
}

function awardTeamsHtml() {
  const d = bonusDraft;
  return (state.teams || []).map((t) => {
    const locked = !canScoreRound(t.id);
    return `<button type="button" class="aw-team" aria-pressed="${!locked && d.teams.includes(t.id)}"${locked ? ' aria-disabled="true" data-locked' : ''} data-team="${esc(t.id)}">` +
      `<span class="aw-team-mark">${teamMarkHtml(t.id, { size: 24 })}</span><span class="aw-team-name">${esc(awardTeamWord(t.id) || t.name)}</span></button>`;
  }).join('');
}

// The words on the Add button: what will happen, or the dashed well naming what is missing.
function awardAddLabel() {
  const d = bonusDraft;
  const problem = bonusDraftProblem(d);
  if (problem === 'teams') return 'Pick a team first';
  if (problem === 'points') return 'Type the points';
  if (problem === 'range') return 'Points are 1 to 100';
  if (problem === 'own-team') return 'Your own team is locked';
  const mag = Math.abs(Number(d.points));
  // In the double-points window a quick point counts twice (bonusCountsDouble, by its own timestamp: now), so the
  // button says what the standings will get, as the doubled verse keys do: "Add 5 points (counts as 10) to Turkey".
  const pts = mag + ' point' + (mag === 1 ? '' : 's') + (inDoubleBonusWindow() ? ' (counts as ' + mag * 2 + ')' : '');
  // A team is the chip's short name with NO article ("to the Turkey", senior's "to the Blue" was broken English).
  const who = d.teams.length === 1 ? awardTeamWord(d.teams[0]) : d.teams.length + ' teams';
  return d.sign < 0 ? 'Take ' + pts + ' from ' + who : 'Add ' + pts + ' to ' + who;
}

// The day's quick points, newest first: the custom bonuses recorded that camp day, and (on the first day) the older cleanup
// points that were never given a day, so their points are not invisible. [{ id, b, why }].
function awardLedgerEntries(dow) {
  const first = competitionDows()[0];
  const rows = [];
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (!b) return;
    if (b.category === 'verse') return;
    if (b.category === 'cleanup') {
      if (dow === first && !(Number(b.day) >= 1 && Number(b.day) <= 5)) rows.push({ id, b, why: 'Cleanup · no day set', legacy: true });
      return;
    }
    if (bonusDowOf(b) === dow) rows.push({ id, b, why: b.label || 'Bonus' });
  });
  return rows.sort((x, y) => (x.legacy ? 1 : 0) - (y.legacy ? 1 : 0) || String(y.b.at || '').localeCompare(String(x.b.at || '')));
}

function awardLedgerHtml(rows) {
  return rows.map(({ id, b, why }) => {
    const pts = Number(b.points) || 0;
    const when = messageClock(b.at, true);
    const locked = !canScoreRound(b.teamId);
    return `<div class="aw-led" data-key="b-${esc(id)}"><span class="aw-mark">${teamMarkHtml(b.teamId, { size: 24 })}</span>` +
      `<span class="aw-led-text"><span class="aw-led-name">${esc(teamName(b.teamId))}</span><span class="aw-led-why">${esc(why)}${when ? ` · <span class="aw-led-when">${esc(when)}</span>` : ''}</span></span>` +
      `<span class="aw-led-pts" data-sign="${pts < 0 ? 'neg' : 'pos'}">${esc(awardPts(pts))}${bonusCountsDouble(b) ? '<small class="aw-x2">×2</small>' : ''}</span>` +
      // Your own team's entry: the lock where the bin would be, saying why (no button with nothing behind it).
      (locked ? '<span class="aw-led-lock" role="img" title="Your team: another director removes these" aria-label="Your team: another director removes these"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg></span>'
        : `<button type="button" class="aw-led-del" data-bonus-id="${esc(id)}" aria-label="Remove ${esc(awardPts(pts))} for ${esc(teamName(b.teamId))}"><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>`) + '</div>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════════
// PAINTING
// ════════════════════════════════════════════════════════════════════
function awardPaintDays() {
  const dows = competitionDows();
  const today = campNow().dow;
  document.querySelectorAll('#award-days .daypick-btn').forEach((b) => {
    const dow = Number(b.dataset.dow);
    setHiddenIfChanged(b, !dows.includes(dow));
    setTextIfChanged(b, dayLabel(dow).slice(0, 3));
    setAttrIfChanged(b, 'aria-selected', dow === awardUi.dow ? 'true' : 'false');
    setDataIfChanged(b, 'today', dow === today ? 'true' : null);
  });
  // At large text the strip and the jump row scroll (one row each, like the Schedule's): fade the edge they continue past.
  if (typeof paintStripOverflow === 'function') { paintStripOverflow(awardEl('award-days')); paintStripOverflow(awardEl('award-jump')); }
}

// Keep the chosen day whole in view (the strip scrolls at large text).
function awardRevealDay(smooth) {
  const track = awardEl('award-days');
  const chip = track && track.querySelector ? track.querySelector('.daypick-btn[aria-selected="true"]') : null;
  if (chip && typeof stripRevealChip === 'function') stripRevealChip(track, chip, smooth);
  if (typeof paintStripOverflow === 'function') paintStripOverflow(track);
}

function awardPaint() {
  const dow = awardUi.dow;
  const dayName = dayLabel(dow);
  setTextIfChanged(awardEl('takeover-award-back-label'), shellToolBackLabel());
  awardPaintDays();

  const double = inDoubleBonusWindow();
  setHiddenIfChanged(awardEl('award-double'), !double);
  setTextIfChanged(awardEl('award-double-text'), "Double points are on: verse and quick points count twice. Cleanup doesn't.");
  // The verse note follows the keys: they read 0 2 4 … 10 in the window, so "0–5 per team" would contradict them.
  setTextIfChanged(awardEl('award-verse-note'), double ? 'Counts twice now · tap 0 to clear' : '0–5 per team · tap 0 to clear');

  // The verse in one line. The seed's "Verse to be announced." (senior) is a missing verse, as Step 19's verses screen
  // says: a plain line, not scripture with a chevron that opens nothing.
  const verse = verseFor(dow);
  const line = awardEl('award-verse-line');
  const has = !!(verse && verse.text);
  const real = has && !/\bto be announced\b/i.test(String(verse.text));
  setAttrIfChanged(line, 'aria-disabled', real ? null : 'true');
  setDataIfChanged(line, 'empty', real ? null : 'true');
  setAttrIfChanged(line, 'aria-expanded', real && awardUi.verseOpen ? 'true' : 'false');
  setTextIfChanged(awardEl('award-verse-ref'), has ? (verse.ref || '') : 'No verse for ' + dayName + ' yet');
  setTextIfChanged(awardEl('award-verse-text'), has ? '“' + verse.text + '”' : '');
  setHtmlIfChanged(awardEl('award-verse-list'), awardVerseRows(dow));
  setHtmlIfChanged(awardEl('award-cleanup-list'), awardCleanupRows(dow));

  // Quick points.
  const d = bonusDraft;
  setHtmlIfChanged(awardEl('award-quick-teams'), awardTeamsHtml());
  const amount = awardEl('award-quick-amount');
  setDataIfChanged(amount, 'sign', d.sign < 0 ? '-1' : '1');
  const sign = awardEl('award-quick-sign');
  if (sign && sign.querySelectorAll) sign.querySelectorAll('.seg-btn').forEach((b) => setAttrIfChanged(b, 'aria-checked', Number(b.dataset.sign) === d.sign ? 'true' : 'false'));
  const pts = awardEl('award-quick-pts');
  if (pts && document.activeElement !== pts && pts.value !== String(d.points)) pts.value = String(d.points);
  const why = awardEl('award-quick-reason');
  if (why && document.activeElement !== why && why.value !== d.custom) why.value = d.custom;
  const add = awardEl('award-quick-add');
  setAttrIfChanged(add, 'aria-disabled', bonusDraftProblem(d) ? 'true' : null);
  setTextIfChanged(awardEl('award-quick-add-label'), awardAddLabel());

  const rows = awardLedgerEntries(dow);
  setTextIfChanged(awardEl('award-ledger-title'), 'Quick points on ' + dayName);
  // Keyed, per day: an added entry arrives and the rest glide down; a removed one squashes out and the rest glide up.
  // Another day is a plain replace (awardSetDay slides the lists in from that side).
  paintKeyedList(awardEl('award-ledger'), awardLedgerHtml(rows), { view: dow, arrive: awardArrive });
  setHiddenIfChanged(awardEl('award-ledger-empty'), rows.length > 0);
  setTextIfChanged(awardEl('award-ledger-empty'), 'No quick points on ' + dayName + ' yet.');
}

function awardPaintMoreRow() {
  const row = awardEl('award-row');
  if (row) setHiddenIfChanged(row, !toolMayOpen('award'));
}

function awardCloseScreen(tk) {
  if (tk.__open) {
    tk.__open = false;
    const o = shell.opener;
    shell.opener = null;
    if (o && o.isConnected !== false && typeof o.focus === 'function') { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    if (!tk.hidden && typeof JellyMotion !== 'undefined') {
      if (tk.style) tk.style.pointerEvents = 'none';
      JellyMotion.playOut(tk, (x) => ({ transform: 'translateX(' + x * 100 + '%)' }), 220, () => {
        if (tk.__open) return;
        tk.hidden = true;
        if (tk.style) tk.style.pointerEvents = '';
      });
    } else tk.hidden = true;
  } else if (!tk.hidden && !(tk.style && tk.style.pointerEvents)) tk.hidden = true;
}

// Called from renderAll: More's row always, the screen only while it is open.
function renderAwardPoints() {
  awardPaintMoreRow();
  const tk = awardEl('takeover-award');
  if (!tk) return;
  const open = typeof toolIsOpen === 'function' && toolIsOpen('award');
  if (!open) { awardUi.wasOpen = false; awardCloseScreen(tk); return; }
  const opening = tk.hidden || !tk.__open;
  if (tk.hidden) tk.hidden = false;
  if (tk.style && tk.style.pointerEvents) tk.style.pointerEvents = '';
  tk.__open = true;
  if (opening) { awardUi.dow = awardDefaultDay(); awardUi.verseOpen = false; awardUi.seenDow = awardUi.dow; }
  if (!competitionDows().includes(awardUi.dow)) awardUi.dow = awardDefaultDay();
  awardWire(tk);
  awardPaint();
  if (opening) {
    awardRevealDay(false);
    if (typeof JellyMotion !== 'undefined') JellyMotion.play(tk, 'settle', (x) => ({ transform: 'translateX(' + (1 - x) * 100 + '%)' }));
    const back = tk.querySelector('[data-takeover-back]');
    if (back && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  }
  awardUi.wasOpen = true;
}

// ════════════════════════════════════════════════════════════════════
// MOTION (calm-aware)
// ════════════════════════════════════════════════════════════════════
function awardPop(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'press', (x) => ({ transform: 'scale(' + (0.82 + 0.18 * x) + ')' }), { calm: false });
}
function awardArrive(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateY(' + 10 * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.6) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 });
}
function awardSlide(els, dx) {
  if (typeof JellyMotion === 'undefined') return;
  els.forEach((el) => {
    if (!el) return;
    JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateX(' + dx * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.6) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 });
  });
}

// ════════════════════════════════════════════════════════════════════
// TAPS (every handler reads the day, the draft and the state AT CALL TIME)
// ════════════════════════════════════════════════════════════════════
function awardMayUse() {
  return typeof toolMayOpen === 'function' && toolMayOpen('award');
}

function awardSetDay(dow) {
  if (!competitionDows().includes(dow) || dow === awardUi.dow) return;
  const dx = dow > awardUi.dow ? 28 : -28;
  awardUi.dow = dow;
  awardUi.verseOpen = false;
  awardPaint();
  awardRevealDay(true);
  awardSlide([awardEl('award-verse-list'), awardEl('award-cleanup-list'), awardEl('award-ledger')], dx);
}

// The jump row: scroll the body to a section (calm: no smooth scroll) and put focus on its heading.
function awardJump(id) {
  const sec = awardEl(id);
  const body = awardEl('takeover-award-body');
  if (!sec || !body || typeof sec.getBoundingClientRect !== 'function') return;
  const top = Math.max(0, sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8);
  const calm = typeof calmMotion === 'function' && calmMotion();
  if (typeof body.scrollTo === 'function') body.scrollTo({ top, behavior: calm ? 'auto' : 'smooth' }); else body.scrollTop = top;
  const h = sec.querySelector('.dt-h');
  if (h && typeof h.focus === 'function') { try { h.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

// A tap on a key: the slot is set to exactly that value through the same functions the Memory verse and Meal cleanup
// sheets call. Those save and render; the pop lands on the key the re-render drew.
function awardTapKey(btn) {
  if (!awardMayUse()) return;
  const row = btn.closest('.aw-row');
  if (!row) return;
  const team = row.dataset.team;
  const pts = Number(btn.dataset.pts);
  const inVerse = !!btn.closest('#award-verse-list');
  // Only a value the section has a key for (the verse 0–5, cleanup 0–3): a stale or forged tap never writes 9 points.
  if (!Number.isInteger(pts) || pts < 0 || pts > (inVerse ? 5 : 3) || !competitionDows().includes(awardUi.dow)) return;
  if (!canScoreRound(team)) { showToast("Your own team's points are given by another director."); return; }
  const key = row.dataset.key;
  const had = focusWas(btn); // the render below replaces this button: a keyboard user keeps their place (focusBack)
  if (inVerse) setVersePoints(team, awardUi.dow, pts);
  else if (row.dataset.meal && MEAL_CLEANUP_MEALS.includes(row.dataset.meal)) setCleanupPoints(team, awardUi.dow, row.dataset.meal, pts);
  else return;
  const fresh = document.querySelector('#takeover-award [data-key="' + key + '"] .aw-pt[data-pts="' + pts + '"]');
  awardPop(fresh);
  focusBack(had, fresh);
}

function awardToggleTeam(btn) {
  const id = btn.dataset.team;
  if (!awardMayUse()) return;
  if (!canScoreRound(id)) { showToast("Your own team's points are given by another director."); return; }
  const d = bonusDraft;
  const i = d.teams.indexOf(id);
  const had = focusWas(btn);
  if (i > -1) d.teams.splice(i, 1); else d.teams.push(id);
  awardClearError();
  awardPaint();
  const fresh = document.querySelector('#award-quick-teams [data-team="' + id + '"]');
  awardPop(fresh);
  focusBack(had, fresh);
}

function awardClearError() {
  setHiddenIfChanged(awardEl('award-quick-error'), true);
}

function awardAdd() {
  if (!awardMayUse()) return;
  const problem = bonusAddFromDraft({ day: awardUi.dow }); // under the day on screen, whatever day it is now
  const err = awardEl('award-quick-error');
  if (problem) {
    setTextIfChanged(err, BONUS_PROBLEMS[problem]);
    setHiddenIfChanged(err, false);
    if (typeof JellyMotion !== 'undefined') JellyMotion.play(awardEl('award-quick-add'), 'wobble', (x) => ({ transform: 'translateX(' + 9 * (1 - Math.min(1, x)) * Math.cos(9 * x) + 'px)' }), { calm: false });
    return;
  }
  awardClearError();
  glideNow(renderAll); // the new entry arrives at the top of the ledger and the rest glide down (paintKeyedList)
}

// Removing a ledger entry confirms (it syncs everywhere; every other destructive act here is a tap on a key you can tap
// back): askDialog where the setup frame loaded, the browser's own confirm where it did not.
async function awardRemove(id) {
  if (!awardMayUse()) return;
  const b = state.bonuses && state.bonuses[id];
  if (!b) return;
  const pts = Number(b.points) || 0;
  const title = 'Remove ' + awardPts(pts) + ' for ' + teamName(b.teamId) + '?';
  const body = '“' + (b.label || 'Bonus') + '” comes off the standings.';
  let yes;
  if (typeof askDialog === 'function') yes = (await askDialog({ title, body, actions: [{ label: 'Remove it', value: 'remove', kind: 'danger' }, { label: 'Not now', value: 'cancel', cancel: true }] })) === 'remove';
  else yes = confirm(title + '\n\n' + body);
  if (!yes || !awardMayUse()) return;
  const row = document.querySelector('#award-ledger [data-key="b-' + id + '"]');
  const go = () => {
    if (!removeBonusEntry(id)) { showToast("Your own team's points are changed by another director."); return; }
    glideNow(renderAll); // the rest of the day's ledger glides up at once
  };
  playRowOut(row, go); // squashes out (calm: a fade)
}

function awardWire(tk) {
  if (awardUi.wired) return;
  awardUi.wired = true;
  tk.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    let b;
    if ((b = t.closest('#award-days .daypick-btn'))) { awardSetDay(Number(b.dataset.dow)); return; }
    if ((b = t.closest('[data-award-jump]'))) { awardJump(b.dataset.awardJump); return; }
    if ((b = t.closest('.aw-pt'))) { awardTapKey(b); return; }
    if (t.closest('#award-verse-line')) {
      if (awardEl('award-verse-line').getAttribute('aria-disabled') === 'true') return;
      awardUi.verseOpen = !awardUi.verseOpen;
      awardPaint();
      return;
    }
    if ((b = t.closest('.aw-team'))) { awardToggleTeam(b); return; }
    if ((b = t.closest('#award-quick-sign .seg-btn'))) { bonusDraft.sign = Number(b.dataset.sign) < 0 ? -1 : 1; awardClearError(); awardPaint(); return; }
    if ((b = t.closest('.aw-led-del'))) { awardRemove(b.dataset.bonusId); return; }
    if (t.closest('#award-quick-add')) { awardAdd(); }
  });
  const pts = awardEl('award-quick-pts');
  if (pts) pts.addEventListener('input', () => { bonusDraft.points = pts.value; awardClearError(); awardPaint(); });
  const why = awardEl('award-quick-reason');
  if (why) why.addEventListener('input', () => { bonusDraft.custom = why.value; });
  const sign = awardEl('award-quick-sign');
  if (sign && typeof segArrowKeys === 'function') segArrowKeys(sign, (btn) => { bonusDraft.sign = Number(btn.dataset.sign) < 0 ? -1 : 1; awardPaint(); });
  ['award-days', 'award-jump'].forEach((id) => {
    const track = awardEl(id);
    if (track && track.addEventListener && typeof paintStripOverflow === 'function') track.addEventListener('scroll', () => paintStripOverflow(track), { passive: true });
  });
}

// More's row opens the screen (wired once, the row is static markup).
(function awardWireRow() {
  if (typeof document === 'undefined') return;
  const row = document.getElementById('award-row');
  if (row && row.addEventListener) row.addEventListener('click', () => openTool('award', { from: 'more' }));
})();
