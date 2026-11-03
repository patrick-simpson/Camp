// award.js — AWARD POINTS (redesign §7.3; BUILD-PLAN Step 24). Runs under both camp profiles (award.senior.test.js evals this
// file: four teams, flag marks, an empty cleanup rota). What these cases pin: that every tap goes through the code that
// already owns the slot (setVersePoints / setCleanupPoints / the bonus ledger's shared writers) so there is no second write
// path and the deterministic ids hold; the own-team guard (canScoreRound); that a stored 0 is never a mark; the doubled verse
// keys; the day's ledger by camp-time weekday; and that points stay with directors (the screen opens only for a CONFIRMED
// director, never for a counselor or a hint-painted phone).

// (var, not const: the senior twin evals this file and reads these)
var realCampNow = campNow;
var realDouble = inDoubleBonusWindow;
var realCleanupTeams = cleanupTeams;
const realAskA = typeof askDialog === 'function' ? askDialog : null;
let toasts = [];
let asked = [];
let answer = 'remove';
showToast = (m) => { toasts.push(String(m)); };
askDialog = async (o) => { asked.push(o); return answer; };

function el(id) { return document.getElementById(id); }
var WED = 3;
var T = () => state.teams.map((t) => t.id);

function boot(role) {
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  setMemberTeam(null);
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  toasts = []; asked = []; answer = 'remove';
  campNow = () => ({ dow: WED, minutes: 13 * 60 });
  inDoubleBonusWindow = () => false;
  // a rota that is the same on both camps: the first team on Wednesday lunch, the second on supper, nobody at breakfast
  cleanupTeams = (d, m) => (d === WED && m === 'Lunch' ? [T()[0]] : d === WED && m === 'Supper' ? [T()[1]] : []);
  state.bonuses = {};
  state.ui.tool = null;
  bonusDraft.teams = []; bonusDraft.points = ''; bonusDraft.custom = ''; bonusDraft.sign = 1;
  awardUi.dow = 0; awardUi.verseOpen = false;
}
function done() {
  campNow = realCampNow;
  inDoubleBonusWindow = realDouble;
  cleanupTeams = realCleanupTeams;
  state.ui.tool = null;
  state.bonuses = {};
  bonusDraft.teams = []; bonusDraft.points = ''; bonusDraft.custom = ''; bonusDraft.sign = 1;
  setMemberTeam(null);
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  setMemberRole(null);
}
function openAward() { assert.equal(openTool('award', { from: 'more' }), true); }
// a fake key button inside a fake row, the way awardTapKey reads them
function key(rowDataset, pts, inVerse) {
  const row = { dataset: rowDataset };
  return { dataset: { pts: String(pts) }, closest: (sel) => (sel === '.aw-row' ? row : sel === '#award-verse-list' ? (inVerse ? {} : null) : null) };
}
function entries(cat) { return Object.entries(state.bonuses).filter(([, b]) => b.category === cat); }


// Counts every innerHTML / textContent write to an element (the stub keeps them as plain properties, so an accessor
// makes each rewrite observable), for the idle-render checks below.
function countAllWrites(ids) {
  const counts = {};
  ids.forEach((id) => {
    const e = document.getElementById(id);
    let html = e.innerHTML || '';
    let text = e.textContent || '';
    counts[id] = 0;
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => { html = v; counts[id]++; }, configurable: true });
    Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => { text = v; counts[id]++; }, configurable: true });
  });
  return counts;
}

// ── who may open it ─────────────────────────────────────────────────

test('only a CONFIRMED director opens Award points: a counselor, a stale hint and a view-only second tab get nothing', () => {
  boot('viewer');
  assert.equal(toolMayOpen('award'), false);
  assert.equal(openTool('award', { from: 'more' }), false);
  state.ui.tool = 'award';
  renderAll();
  assert.equal(state.ui.tool, null, 'a stored open screen is dropped for a counselor');
  assert.equal(el('award-row').hidden, true, 'and More has no row');
  // a hint-painted director: canEdit() but the member record has not answered, so no points are readable yet
  setMemberRole('editor', { provisional: true });
  assert.equal(canEdit(), true);
  assert.equal(standingsVisible(), false);
  assert.equal(toolMayOpen('award'), false, 'points wait for the confirmed role');
  assert.equal(openTool('award', { from: 'more' }), false);
  setMemberRole('editor');
  assert.equal(toolMayOpen('award'), true);
  renderAll();
  assert.equal(el('award-row').hidden, false, 'a confirmed director gets the row');
  done();
});

test('a counselor-side call to every writer does nothing', () => {
  boot('viewer');
  awardTapKey(key({ team: T()[0], key: 'v-' + T()[0] }, 3, true));
  awardUi.dow = WED;
  awardTapKey(key({ team: T()[0], key: 'v-' + T()[0] }, 3, true));
  bonusDraft.teams = [T()[0]]; bonusDraft.points = '5';
  awardAdd();
  assert.deepEqual(state.bonuses, {}, 'nothing written');
  done();
});

test('a tap on a key or a team chip repaints its list, so a keyboard user\'s focus goes back onto the button that took its place', () => {
  boot();
  openAward();
  awardUi.dow = WED;
  const t0 = T()[0];
  const focused = [];
  const freshKey = document.querySelector('#takeover-award [data-key="v-' + t0 + '"] .aw-pt[data-pts="3"]');
  freshKey.focus = () => focused.push('key');
  const freshChip = document.querySelector('#award-quick-teams [data-team="' + t0 + '"]');
  freshChip.focus = () => focused.push('chip');
  const prev = document.activeElement;
  try {
    // a pointer tap in Safari never focuses the button: nothing is moved
    document.activeElement = null;
    awardTapKey(key({ team: t0, key: 'v-' + t0 }, 3, true));
    assert.deepEqual(focused, [], 'focus was not on the key, so nothing is focused for it');
    // keyboard / switch / screen reader: the key had focus, the list is repainted, focus is put back
    const btn = key({ team: t0, key: 'v-' + t0 }, 3, true);
    document.activeElement = btn;
    awardTapKey(btn);
    assert.deepEqual(focused, ['key']);
    assert.equal(state.bonuses[Object.keys(state.bonuses).find((k) => state.bonuses[k].category === 'verse')].points, 3);
    // a team chip in Quick points
    const chip = { dataset: { team: t0 } };
    document.activeElement = chip;
    awardToggleTeam(chip);
    assert.deepEqual(focused, ['key', 'chip']);
    // focus already on the new button (nothing replaced it): not asked again
    document.activeElement = freshChip;
    focused.length = 0;
    awardToggleTeam(chip);
    assert.deepEqual(focused, []);
  } finally { document.activeElement = prev; }
  assert.ok(/focusWas\(btn\)/.test(readFixture('../award.js')) && /focusBack\(had, fresh\)/.test(readFixture('../award.js')), 'the key tap asks before and puts focus back after');
  done();
});

// ── the day ─────────────────────────────────────────────────────────

test('it opens on today; on a weekend it opens on Monday; the day picker moves the lists', () => {
  boot();
  openAward();
  assert.equal(awardUi.dow, WED);
  assert.equal(el('award-ledger-title').textContent, 'Quick points on Wednesday');
  awardSetDay(2);
  assert.equal(awardUi.dow, 2);
  assert.equal(el('award-ledger-title').textContent, 'Quick points on Tuesday');
  awardSetDay(0);
  assert.equal(awardUi.dow, 2, 'a day that is not a competition day is not a choice');
  closeTool();
  campNow = () => ({ dow: 6, minutes: 600 });
  openAward();
  assert.equal(awardUi.dow, competitionDows()[0], 'Saturday opens on the first competition day');
  assert.equal(awardDefaultDay(), competitionDows()[0]);
  done();
});

// ── Memory verse ────────────────────────────────────────────────────

test('a verse tap sets the slot through setVersePoints: the deterministic id, replacing what was there, 0 clears', () => {
  boot();
  openAward();
  const t0 = T()[0];
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 4, true));
  assert.deepEqual(entries('verse').map(([id, b]) => [id, b.teamId, b.points, b.day]), [['verse-' + t0 + '-3', t0, 4, 3]]);
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 2, true));
  assert.equal(entries('verse').length, 1, 'still ONE entry for the slot');
  assert.equal(state.bonuses['verse-' + t0 + '-3'].points, 2, 'replaced, not added');
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 0, true));
  assert.equal(entries('verse').length, 0, '0 clears the slot');
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 6, true));
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, -1, true));
  awardTapKey(key({ team: t0, key: 'c-Lunch-' + t0, meal: 'Lunch' }, 4, false));
  assert.equal(entries('verse').length + entries('cleanup').length, 0, 'a value that is not a key (verse 0–5, cleanup 0–3) is ignored');
  done();
});

test('Award points and the Memory verse sheet share ONE slot: either order, never two entries', () => {
  boot();
  openAward();
  const t0 = T()[0];
  setVersePoints(t0, WED, 3);                                  // the More sheet's path
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 5, true));     // this screen
  setVersePoints(t0, WED, 1);
  assert.equal(entries('verse').length, 1);
  assert.equal(state.bonuses['verse-' + t0 + '-3'].points, 1);
  const shown = awardVerseRows(WED);
  assert.ok(new RegExp('data-pts="1" data-joy>1</button>').test(shown) && /aria-checked="true" data-pts="1"/.test(shown), 'and the screen shows what the sheet wrote');
  done();
});

test('verse keys: six, the stored value is the chosen one, and a chosen 0 is just 0 (the CSS only outlines it)', () => {
  boot();
  const t0 = T()[0];
  let html = awardVerseRows(WED);
  assert.equal(((html.match(/class="aw-pt"/g)) || []).length, 6 * T().length, 'six keys a team');
  assert.ok(new RegExp('data-key="v-' + t0 + '"[^>]*>').test(html));
  assert.ok(/aria-checked="true" data-pts="0"/.test(html), 'a team with nothing has the 0 key chosen');
  setVersePoints(t0, WED, 3);
  html = awardVerseRows(WED);
  const row = new RegExp('data-key="v-' + t0 + '"[\\s\\S]*?</div></div>').exec(html)[0];
  assert.ok(/aria-checked="true" data-pts="3"/.test(row) && !/aria-checked="true" data-pts="0"/.test(row));
  assert.ok(/role="radiogroup" aria-label="[^"]* · Wednesday verse" data-n="6"/.test(row));
  done();
});

test('in the double-points window a verse key shows what a tap is worth NOW (doubled), the stored value stays 0–5; cleanup never doubles', () => {
  boot();
  openAward();
  inDoubleBonusWindow = () => true;
  const t0 = T()[0];
  const verse = awardVerseRows(WED);
  const row = new RegExp('data-key="v-' + t0 + '"[\\s\\S]*?</div></div>').exec(verse)[0];
  assert.deepEqual([...row.matchAll(/data-pts="(\d)" data-joy>(\d+)</g)].map((m) => [m[1], m[2]]), [['0', '0'], ['1', '2'], ['2', '4'], ['3', '6'], ['4', '8'], ['5', '10']]);
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 5, true));
  assert.equal(state.bonuses['verse-' + t0 + '-3'].points, 5, 'the stored value is the 0–5 one');
  const cleanup = awardCleanupRows(WED);
  assert.deepEqual([...cleanup.matchAll(/data-pts="(\d)" data-joy>(\d+)</g)].slice(0, 4).map((m) => [m[1], m[2]]), [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], 'cleanup keys are never doubled');
  renderAll();
  assert.equal(el('award-double').hidden, false, 'and the plain double-points line shows');
  inDoubleBonusWindow = () => false;
  renderAll();
  assert.equal(el('award-double').hidden, true);
  done();
});

test('the verse in one line: its reference and words, a tap opens it in place, and a day with no verse says so', () => {
  boot();
  openAward();
  const v = verseFor(WED);
  assert.ok(v.text, 'precondition: both camps have a Wednesday verse');
  assert.equal(el('award-verse-ref').textContent, v.ref);
  assert.equal(el('award-verse-text').textContent, '“' + v.text + '”');
  const realVerse = verseFor;
  verseFor = () => NO_VERSE;
  awardPaint();
  assert.equal(el('award-verse-ref').textContent, 'No verse for Wednesday yet');
  assert.equal(el('award-verse-text').textContent, '');
  verseFor = realVerse;
  done();
});

// ── Meal cleanup ────────────────────────────────────────────────────

test('cleanup: a head per meal with its time, the team on the rota with 0–3, "No team on the rota" for a bare meal', () => {
  boot();
  const [t0, t1] = T();
  const html = awardCleanupRows(WED);
  assert.deepEqual([...html.matchAll(/class="aw-meal-name">([^<]+)</g)].map((m) => m[1]), ['Breakfast', 'Lunch', 'Supper']);
  assert.ok(/class="aw-none" data-key="none-Breakfast">No team on the rota</.test(html), 'nobody at breakfast');
  assert.ok(new RegExp('data-key="c-Lunch-' + t0 + '"').test(html) && new RegExp('data-key="c-Supper-' + t1 + '"').test(html));
  assert.ok(!new RegExp('data-key="c-Lunch-' + t1 + '"').test(html), 'only the team on the rota');
  const lunch = new RegExp('data-key="c-Lunch-' + t0 + '"[\\s\\S]*?</div></div>').exec(html)[0];
  assert.equal(((lunch.match(/class="aw-pt"/g)) || []).length, 4, 'four keys, 0–3');
  assert.ok(/data-n="4"/.test(lunch) && /Lunch cleanup"/.test(lunch));
  assert.ok(/class="aw-meal-time">\d{1,2}:\d\d [AP]M</.test(html), 'each meal says when it starts');
  done();
});

test('a cleanup tap sets the slot through setCleanupPoints: the deterministic id, replace, 0 clears; the same slot as the More sheet', () => {
  boot();
  openAward();
  const t0 = T()[0];
  const k = (p) => key({ team: t0, key: 'c-Lunch-' + t0, meal: 'Lunch' }, p, false);
  awardTapKey(k(3));
  assert.deepEqual(entries('cleanup').map(([id, b]) => [id, b.teamId, b.points, b.day, b.meal]), [['cleanup-' + t0 + '-3-Lunch', t0, 3, 3, 'Lunch']]);
  setCleanupPoints(t0, WED, 'Lunch', 1);                       // the More sheet's path
  assert.equal(entries('cleanup').length, 1);
  assert.equal(state.bonuses['cleanup-' + t0 + '-3-Lunch'].points, 1);
  awardTapKey(k(2));
  assert.equal(state.bonuses['cleanup-' + t0 + '-3-Lunch'].points, 2);
  awardTapKey(k(0));
  assert.equal(entries('cleanup').length, 0);
  awardTapKey(key({ team: t0, key: 'c-Nonsense-' + t0, meal: 'Nonsense' }, 1, false));
  assert.equal(entries('cleanup').length, 0, 'a meal that does not exist is ignored');
  done();
});

test('a team with cleanup points for a meal it is not on the rota for keeps its row, tagged, so it stays clearable', () => {
  boot();
  const t2 = T()[2];
  setCleanupPoints(t2, WED, 'Breakfast', 2);
  const html = awardCleanupRows(WED);
  const row = new RegExp('data-key="c-Breakfast-' + t2 + '"[\\s\\S]*?</div></div>').exec(html);
  assert.ok(row, 'its row is there');
  assert.ok(/class="aw-tag">Not on the rota</.test(row[0]));
  assert.ok(/aria-checked="true" data-pts="2"/.test(row[0]));
  assert.notOk(/data-key="none-Breakfast"/.test(html), 'so the meal is not "no team on the rota"');
  done();
});

// ── the own-team guard ──────────────────────────────────────────────

test('a director on a team gets no keys for it (a locked row showing what it has) and cannot write it, in any section', () => {
  boot();
  const [t0, t1] = T();
  setMemberTeam(t0);
  setVersePoints(t1, WED, 3);                                   // another director's award for the other team
  const verse = awardVerseRows(WED);
  const own = new RegExp('data-key="v-' + t0 + '"[\\s\\S]*?</p></div>').exec(verse)[0];
  assert.ok(/data-locked/.test(own) && /Your team · another director gives these/.test(own) && !/class="aw-pt"/.test(own), 'own row: locked, no keys');
  const other = new RegExp('data-key="v-' + t1 + '"[\\s\\S]*?</div></div>').exec(verse)[0];
  assert.ok(/class="aw-pt"/.test(other) && /aria-checked="true" data-pts="3"/.test(other), 'the others keep theirs');
  assert.ok(/<b class="aw-given">\+3<\/b>/.test(awardRowHtml({ key: 'v-x', team: t0, name: 'X', pts: 0, n: 6, mult: 1, label: 'l', locked: true, given: 3 })), 'a locked row shows what it has');
  assert.ok(!/aw-given/.test(awardRowHtml({ key: 'v-x', team: t0, name: 'X', pts: 0, n: 6, mult: 1, label: 'l', locked: true, given: 0 })), 'and nothing when it has nothing');
  openAward();
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 4, true));
  awardTapKey(key({ team: t0, key: 'c-Lunch-' + t0, meal: 'Lunch' }, 2, false));
  assert.equal(state.bonuses['verse-' + t0 + '-3'], undefined, 'a forged tap writes nothing for the own team');
  assert.equal(state.bonuses['cleanup-' + t0 + '-3-Lunch'], undefined);
  assert.ok(toasts.some((m) => /another director/.test(m)), 'and says why');
  done();
});

// ── Quick points ────────────────────────────────────────────────────

test('the Add button says what will happen, or the dashed well names what is missing, in the order a director meets it', () => {
  boot();
  const [t0, t1] = T();
  assert.equal(awardAddLabel(), 'Pick a team first');
  bonusDraft.teams = [t0];
  assert.equal(awardAddLabel(), 'Type the points');
  bonusDraft.points = '0';
  assert.equal(awardAddLabel(), 'Type the points', 'zero is not an amount');
  bonusDraft.points = '101';
  assert.equal(awardAddLabel(), 'Points are 1 to 100');
  bonusDraft.points = '2.5';
  assert.equal(awardAddLabel(), 'Points are 1 to 100', 'whole numbers only');
  bonusDraft.points = '5';
  assert.equal(awardAddLabel(), 'Add 5 points to ' + awardTeamWord(t0));
  bonusDraft.points = '1';
  assert.equal(awardAddLabel(), 'Add 1 point to ' + awardTeamWord(t0));
  bonusDraft.teams = [t0, t1]; bonusDraft.points = '5';
  assert.equal(awardAddLabel(), 'Add 5 points to 2 teams');
  bonusDraft.teams = [t1]; bonusDraft.points = '3'; bonusDraft.sign = -1;
  assert.equal(awardAddLabel(), 'Take 3 points from ' + awardTeamWord(t1));
  assert.equal(bonusDraftProblem(bonusDraft), '');
  done();
});

test('Add writes one custom bonus per picked team (same label and time), then clears what was entered; the Games tab\'s entry row shares the writer', () => {
  boot();
  openAward();
  const [t0, t1, t2] = T();
  const draft = bonusDraft;
  awardToggleTeam({ dataset: { team: t0 } });
  awardToggleTeam({ dataset: { team: t1 } });
  awardToggleTeam({ dataset: { team: t2 } });
  awardToggleTeam({ dataset: { team: t2 } });
  assert.deepEqual(draft.teams, [t0, t1], 'toggles in and out');
  draft.points = '5'; draft.custom = 'Helped carry the canoes';
  awardAdd();
  const rows = entries('custom');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(([, b]) => [b.teamId, b.points, b.label]).sort(), [[t0, 5, 'Helped carry the canoes'], [t1, 5, 'Helped carry the canoes']].sort());
  assert.equal(rows[0][1].at, rows[1][1].at, 'one moment');
  assert.deepEqual([draft.teams, draft.points, draft.custom, draft.sign], [[], '', '', 1], 'the form is clear for the next one');
  // a penalty
  draft.teams = [t0]; draft.points = '3'; draft.sign = -1;
  awardAdd();
  assert.equal(entries('custom').filter(([, b]) => b.points === -3).length, 1);
  assert.equal(draft.sign, 1, 'the sign goes back to Add');
  // an unlabeled one reads "Bonus"
  draft.teams = [t0]; draft.points = '2';
  awardAdd();
  assert.ok(entries('custom').some(([, b]) => b.label === 'Bonus'));
  const app = readFixture('../app.js');
  const bind = app.slice(app.indexOf('function bindBonusEntry'), app.indexOf('const BONUS_PROBLEMS'));
  assert.ok(/bonusAddFromDraft\(\)/.test(bind), 'the Games tab calls the same writer');
  assert.ok(!/state\.bonuses\[newBonusId\(\)\]/.test(bind), 'and writes nothing itself');
  done();
});

test('Add with a problem writes nothing and says which, in the words the Games tab uses', () => {
  boot();
  openAward();
  const t0 = T()[0];
  awardAdd();
  assert.equal(el('award-quick-error').textContent, 'Pick at least one team.');
  bonusDraft.teams = [t0];
  awardAdd();
  assert.equal(el('award-quick-error').textContent, 'Enter a non-zero point value.');
  bonusDraft.points = '500';
  awardAdd();
  assert.equal(el('award-quick-error').textContent, 'Points must be a whole number from 1 to 100.');
  assert.deepEqual(state.bonuses, {});
  assert.equal(bonusAddFromDraft(), 'range');
  done();
});

test('the own team cannot be picked, and even a draft that carries it is refused by the shared writer', () => {
  boot();
  openAward();
  const [t0, t1] = T();
  setMemberTeam(t0);
  awardToggleTeam({ dataset: { team: t0 } });
  assert.deepEqual(bonusDraft.teams, [], 'the toggle is locked');
  assert.ok(toasts.some((m) => /another director/.test(m)));
  assert.ok(/aria-disabled="true" data-locked data-team="/.test(awardTeamsHtml()), 'drawn locked');
  bonusDraft.teams = [t0, t1]; bonusDraft.points = '4';
  assert.equal(bonusDraftProblem(bonusDraft), 'own-team');
  assert.equal(bonusAddFromDraft(), 'own-team');
  assert.deepEqual(state.bonuses, {}, 'nothing written, not even for the other team');
  assert.equal(awardAddLabel(), 'Your own team is locked');
  done();
});

// ── the ledger ──────────────────────────────────────────────────────

test('the ledger lists the day\'s quick points by CAMP-TIME weekday, newest first, with ×2 for the doubled and legacy cleanup on Monday', () => {
  boot();
  const [t0, t1] = T();
  state.bonuses = {
    w1: { teamId: t0, category: 'custom', label: 'Canoes', points: 5, at: '2026-07-22T15:00:00Z' },        // Wed 11:00 ET
    w2: { teamId: t1, category: 'custom', label: 'Late', points: -2, at: '2026-07-22T23:30:00Z' },         // Wed 7:30 PM ET
    tu: { teamId: t0, category: 'custom', label: 'Tuesday thing', points: 3, at: '2026-07-21T15:00:00Z' }, // Tue
    mid: { teamId: t0, category: 'custom', label: 'After midnight', points: 1, at: '2026-07-23T02:30:00Z' }, // Wed 10:30 PM ET (UTC says Thursday)
    v1: { teamId: t0, category: 'verse', label: 'x', points: 4, at: '2026-07-22T15:00:00Z', day: 3 },
    c1: { teamId: t0, category: 'cleanup', label: 'x', points: 2, at: '2026-07-22T15:00:00Z', day: 3, meal: 'Lunch' },
    old: { teamId: t1, category: 'cleanup', label: 'Cleanup', points: 1, at: '2026-07-20T15:00:00Z' },        // no day: legacy
  };
  assert.deepEqual(awardLedgerEntries(3).map((r) => r.id), ['w2', 'mid', 'w1'].sort((a, b) => String(state.bonuses[b].at).localeCompare(String(state.bonuses[a].at))), 'Wednesday: by camp time (the 10:30 PM one is still Wednesday), newest first, no verse or cleanup');
  assert.deepEqual(awardLedgerEntries(2).map((r) => r.id), ['tu']);
  const mon = awardLedgerEntries(1);
  assert.deepEqual(mon.map((r) => r.id), ['old'], 'the dayless cleanup point rides on the first day');
  assert.equal(mon[0].why, 'Cleanup · no day set');
  const html = awardLedgerHtml(awardLedgerEntries(3));
  assert.ok(/class="aw-led-pts" data-sign="pos">\+5</.test(html) && /data-sign="neg">−2</.test(html), 'signed, with a real minus');
  assert.ok(/aria-label="Remove \+5 for /.test(html) && /aria-label="Remove −2 for /.test(html));
  assert.ok(/Canoes · <span class="aw-led-when">\d{1,2}:\d\d [AP]M</.test(html), 'why · time, in camp time');
  assert.notOk(/aw-x2/.test(html), 'not doubled');
  done();
});

test('quick points are filed under the day on screen (a Wednesday correction made on Thursday lists on Wednesday); the Games tab files none', () => {
  boot();
  openAward();
  const t0 = T()[0];
  awardSetDay(2);
  bonusDraft.teams = [t0]; bonusDraft.points = '4'; bonusDraft.custom = 'Forgot to count';
  awardAdd();
  let rows = entries('custom');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].day, 2, 'stamped with the day on screen');
  assert.ok(awardLedgerEntries(2).some((r) => r.id === rows[0][0]), 'so it lists under Tuesday');
  assert.equal(awardLedgerEntries(WED).length, 0, 'not under the day it was typed on');
  assert.equal(bonusDowOf({ at: new Date().toISOString(), day: 9 }), bonusDowOf({ at: new Date().toISOString() }), 'a day that is not a weekday is ignored');
  assert.equal(bonusDowOf({ at: '2026-07-22T15:00:00Z', day: 7 }), 0, '7 is Sunday');
  bonusDraft.teams = [t0]; bonusDraft.points = '1';
  assert.equal(bonusAddFromDraft(), '', 'the Games tab\'s call');
  rows = entries('custom').filter(([, b]) => b.points === 1);
  assert.equal(rows[0][1].day, undefined, 'files no day: it belongs to the weekday it was recorded on');
  done();
});

test('a doubled entry carries ×2 (by its own timestamp)', () => {
  boot();
  const t0 = T()[0];
  state.bonuses = { w1: { teamId: t0, category: 'custom', label: 'Canoes', points: 5, at: '2026-07-22T15:00:00Z' } };
  const real = bonusCountsDouble;
  bonusCountsDouble = () => true;
  assert.ok(/<small class="aw-x2">×2<\/small>/.test(awardLedgerHtml(awardLedgerEntries(3))));
  bonusCountsDouble = real;
  done();
});

test('removing an entry asks, then removes it; "Not now" keeps it; the own team\'s entry has no remove at all', async () => {
  boot();
  openAward();
  const [t0, t1] = T();
  state.bonuses = {
    w1: { teamId: t0, category: 'custom', label: 'Canoes', points: 5, at: new Date().toISOString() },
    w2: { teamId: t1, category: 'custom', label: 'Late', points: -2, at: new Date().toISOString() },
  };
  campNow = () => ({ dow: bonusDowOf(state.bonuses.w1), minutes: 600 });
  answer = 'cancel';
  await awardRemove('w1');
  assert.equal(asked.length, 1);
  assert.ok(/^Remove \+5 for /.test(asked[0].title) && /comes off the standings on every phone/.test(asked[0].body));
  assert.deepEqual(asked[0].actions.map((a) => [a.label, a.kind || '', !!a.cancel]), [['Remove it', 'danger', false], ['Not now', '', true]]);
  assert.ok(state.bonuses.w1, 'Not now: kept');
  answer = 'remove';
  await awardRemove('w1');
  assert.equal(state.bonuses.w1, undefined, 'removed');
  assert.ok(state.bonuses.w2, 'only that one');
  await awardRemove('nope');
  setMemberTeam(t1);
  const html = awardLedgerHtml([{ id: 'w2', b: state.bonuses.w2, why: 'Late' }]);
  assert.notOk(/aw-led-del/.test(html), 'a director on that team has no remove button for it');
  await awardRemove('w2');
  assert.ok(state.bonuses.w2, 'and the writer refuses it anyway');
  assert.ok(toasts.some((m) => /another director/.test(m)));
  done();
});

test('removeBonusEntry: a director\'s act, never the own team\'s, never a missing entry', () => {
  boot();
  const [t0, t1] = T();
  state.bonuses = { a: { teamId: t0, category: 'custom', label: 'x', points: 1, at: new Date().toISOString() }, b: { teamId: t1, category: 'custom', label: 'y', points: 1, at: new Date().toISOString() } };
  assert.equal(removeBonusEntry('missing'), false);
  setMemberTeam(t0);
  assert.equal(removeBonusEntry('a'), false);
  assert.equal(removeBonusEntry('b'), true);
  setMemberTeam(null);
  setMemberRole('viewer');
  assert.equal(removeBonusEntry('a'), false, 'a counselor cannot');
  assert.ok(state.bonuses.a);
  done();
});

// ── escaping, the shell, the file ───────────────────────────────────

test('team names, reasons and labels are escaped everywhere the screen writes markup', () => {
  boot();
  const hostile = '<img src=x onerror=alert(1)>"\'&';
  state.teams[0].name = hostile;
  state.bonuses = { w1: { teamId: state.teams[0].id, category: 'custom', label: hostile, points: 5, at: new Date().toISOString() } };
  campNow = () => ({ dow: bonusDowOf(state.bonuses.w1), minutes: 600 });
  const strip = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '');
  [awardVerseRows(WED), awardCleanupRows(WED), awardTeamsHtml(), awardLedgerHtml(awardLedgerEntries(bonusDowOf(state.bonuses.w1)))].forEach((h, i) => {
    assert.notOk(/<img src=x/.test(strip(h)), 'part ' + i + ' escaped');
  });
  assert.ok(/&lt;img src=x/.test(awardVerseRows(WED)) && /&lt;img src=x/.test(awardLedgerHtml(awardLedgerEntries(bonusDowOf(state.bonuses.w1)))), 'as text');
  done();
});

test('Award points is a takeover on the shell\'s stack: one at a time, Back closes it onto the tab it came from, and a game replaces it', () => {
  boot();
  state.ui.tab = 'more';
  openAward();
  assert.deepEqual(shellSnap().ov, [{ k: 'award', from: 'more' }]);
  assert.equal(shellTakeoverOpen(), true);
  assert.deepEqual(shellSnapFromRaw({ campShell: 1, tab: 'more', ov: [{ k: 'award', from: 'more' }] }).ov, [{ k: 'award', from: 'more' }]);
  assert.deepEqual(shellHistPlan({ tab: 'more', ov: [] }, shellSnap()).map((p) => p.op), ['push'], 'opening files ONE history entry');
  shellApply({ tab: 'more', ov: [] });
  assert.equal(state.ui.tool, null, 'the phone\'s Back closes it');
  openAward();
  openTool('tell', { from: 'more' });
  assert.equal(state.ui.tool, 'tell', 'one tool at a time');
  openAward();
  openGame(state.config.games[0].id, { from: 'now' });
  assert.equal(state.ui.tool, null, 'a game replaces it');
  done();
});

test('every id award.js names exists in index.html, and the script loads after tell.js and before the sign-in methods', () => {
  const html = readFixture('../index.html');
  const src = readFixture('../award.js');
  const ids = [...new Set([...src.matchAll(/awardEl\('([^']+)'\)/g)].map((m) => m[1]))];
  assert.deepEqual(ids.filter((id) => !html.includes('id="' + id + '"')), [], 'ids named in award.js but absent from index.html');
  assert.ok(html.indexOf('tell.js?v=') < html.indexOf('award.js?v=') && html.indexOf('award.js?v=') < html.indexOf('auth-phone.js?v='));
});

test('without award.js the app runs and More shows no Award points row', () => {
  const { makeContext } = nodeRequire('./harness.js');
  const vm = nodeRequire('vm');
  let boot2;
  assert.doesNotThrow(() => { boot2 = makeContext({ without: ['award.js'], camp: CAMP.id, seeded: scheduleIsShared() }); });
  const get = (expr) => vm.runInContext(expr, boot2.ctx);
  assert.equal(get('typeof renderAwardPoints'), 'undefined');
  assert.equal(get("toolMayOpen('award')"), false);
  assert.doesNotThrow(() => get('renderAll()'));
});

test('an idle re-render of the open screen writes nothing (render stability), and a tap writes only the lists it changed', () => {
  boot();
  const [t0] = T();
  state.bonuses = { w1: { teamId: t0, category: 'custom', label: 'Canoes', points: 5, at: '2026-07-22T15:00:00Z', day: 3 } };
  openAward();
  const ids = ['award-verse-list', 'award-cleanup-list', 'award-quick-teams', 'award-ledger', 'award-quick-add-label', 'award-ledger-title', 'award-ledger-empty',
    'award-verse-ref', 'award-verse-text', 'award-double-text', 'takeover-award-back-label'];
  const writes = countAllWrites(ids);
  renderAll();
  renderAll();
  assert.deepEqual(Object.entries(writes).filter(([, n]) => n), [], 'nothing rewritten by an idle render');
  awardTapKey(key({ team: t0, key: 'v-' + t0 }, 3, true));
  assert.ok(writes['award-verse-list'] > 0, 'the verse list changed');
  assert.equal(writes['award-cleanup-list'], 0, 'the cleanup list did not');
  assert.equal(writes['award-ledger'], 0, 'nor the ledger');
  done();
});
