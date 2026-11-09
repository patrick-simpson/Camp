// The Teams screen (BUILD-PLAN Step 25, P2 §11.7; setup-ui.js section 13): the hub row's judgement (Appendix B, one case per
// sentence), what the screen and the sheet do with their handlers (stand-in elements, the real stateEdit), the photo's pure
// maths and its upload against the in-memory database, and the source pins a layout regression would quietly break. Anything
// that needs layout (the rows at 130% / 200% text, the swatch pills, the crop frame) is the Playwright pass.
// teams-screen.senior.test.js evals this file under the senior profile.

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const TS_INDEX = readFixture('../index.html');
const TS_CSS = readFixture('../styles.css');
const TS_UI = readFixture('../setup-ui.js');
// Section 13 only: it ends where People (14) begins (later sections have their own pins and write the catalog, not the roster).
const TS_TEAMS_SRC = TS_UI.slice(TS_UI.indexOf('// ── 13. Teams (§11.7'), TS_UI.indexOf('// ── 14. People'));

const tsPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
const tsRatio = (a, b) => {
  const lum = (h) => { const c = (i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5); };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function tsOpen(role) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  state.ui.view = 'settings';
  state.ui.builderScreen = 'teams';
  setupUi.wasOpen = false;
  setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
  undoClear();
  teamUi.edit = null; teamUi.colors = false;
}
function tsClose() {
  teamUi.edit = null; teamUi.colors = false;
  ['team-edit', 'team-colors'].forEach((id) => { if (shell.sheets.includes(id)) shellSheetClose(id); });
  try { setupPillHide(true); } catch (e) { /* no pill yet */ }
  setupUi.wasOpen = false;
  state.ui.view = 'home';
  state.ui.builderScreen = undefined;
  setMemberRole(null);
  freshState();
}
function tsEl(id) { return document.getElementById(id); }
const tsFill = (name, value) => { tsEl('team-' + name).value = value; tsEl('team-' + name).dispatchEvent && 0; };
// The paths of the newest undo entry: what ONE save actually wrote.
const tsPaths = () => (undoRecent()[0] ? undoRecent()[0].ops.map((o) => o[1]).sort() : []);
const tsView = (over) => Object.assign({ teamCount: CAMP.teamCount, isOwner: false, ownerName: 'Patrick', teams: [], teamInfo: {} }, over || {});
const tsInfo = (over) => Object.assign({ short: 'Foxes', emoji: '🦊', colorId: '', colorName: '', weak: [] }, over || {});

// ── the judgement (Appendix B): one case per sentence ──

test('teams: six slots with names, shorts and emoji are ready, and the summary says how many', () => {
  const teams = [{ id: 't0', name: 'Foxes' }, { id: 't1', name: 'Hawks' }];
  const r = hubStatus('teams', tsView({ teamCount: 2, teams, teamInfo: { t0: tsInfo(), t1: tsInfo({ short: 'Hawks', emoji: '🦅' }) } }));
  assert.deepEqual([r.mark, r.summary, r.word, r.problems], ['ok', '2 teams', 'Ready', []]);
});

test('teams: two teams on one colour is a warning that names the colour; three, and two pairs, read right', () => {
  const teams = ['t0', 't1', 't2', 't3', 't4', 't5'].map((id, i) => ({ id, name: 'Team ' + (i + 1) }));
  const info = (map) => teams.reduce((o, t) => { o[t.id] = tsInfo(map[t.id] || {}); return o; }, {});
  const blue = { colorId: 'blue', colorName: 'Blue' };
  const two = hubStatus('teams', tsView({ teamCount: 6, teams, teamInfo: info({ t0: blue, t3: blue }) }));
  assert.deepEqual([two.mark, two.problems], ['warn', ['Two teams are Blue']]);
  const three = hubStatus('teams', tsView({ teamCount: 6, teams, teamInfo: info({ t0: blue, t3: blue, t4: blue }) }));
  assert.deepEqual(three.problems, ['Three teams are Blue']);
  const red = { colorId: 'red', colorName: 'Red' };
  const pairs = hubStatus('teams', tsView({ teamCount: 6, teams, teamInfo: info({ t0: blue, t1: blue, t2: red, t5: red }) }));
  assert.deepEqual(pairs.problems, ['Two teams are Blue', 'Two teams are Red']);
  assert.equal(hubStatus('teams', tsView({ teamCount: 6, teams, teamInfo: info({ t0: blue, t3: { colorId: 'red', colorName: 'Red' } }) })).mark, 'ok', 'different colours are fine');
});

test('teams: a team with no short name or no emoji is named; a slot repair is the owner\'s sentence, or "Ask Patrick" for everyone else', () => {
  const teams = [{ id: 't0', name: 'Foxes' }, { id: 't1', name: 'Hawks' }];
  const r = hubStatus('teams', tsView({ teamCount: 2, teams, teamInfo: { t0: tsInfo({ short: '' }), t1: tsInfo({ emoji: '' }) } }));
  assert.deepEqual(r.problems, ['Foxes has no short name', 'Hawks has no emoji']);
  assert.deepEqual(hubStatus('teams', tsView({ teamCount: 6, teams })).problems, ['Ask Patrick to repair team slots']);
  assert.deepEqual(hubStatus('teams', tsView({ teamCount: 6, teams, isOwner: true })).problems, ['The team slots need repair']);
  assert.deepEqual(hubStatus('teams', tsView({ teamCount: 2, teams: [{ id: 't0', name: 'A' }, { id: 'x7', name: 'B' }] })).problems, ['Ask Patrick to repair team slots'], 'an id that is not tN');
});

test('teams: a legacy colour that is hard to read is a NOTE, never a counted warning (ux-R13), so the hub can reach ready', () => {
  const teams = [{ id: 't0', name: 'Foxes' }, { id: 't1', name: 'Turkey Dinner' }, { id: 't2', name: 'Maples' }];
  const one = hubStatus('teams', tsView({ teamCount: 3, teams, teamInfo: { t0: tsInfo(), t1: tsInfo({ weak: ['dark'], colorName: 'Last year’s colour' }), t2: tsInfo() } }));
  assert.deepEqual([one.mark, one.problems], ['ok', []], 'ready');
  assert.equal(one.note, 'Turkey Dinner’s colour is hard to read in dark mode');
  const two = hubStatus('teams', tsView({ teamCount: 3, teams, teamInfo: { t0: tsInfo({ weak: ['light'] }), t1: tsInfo({ weak: ['dark'] }), t2: tsInfo() } }));
  assert.equal(two.mark, 'ok');
  assert.equal(two.note, '2 teams’ colours are hard to read in light or dark mode');
  const both = hubStatus('teams', tsView({ teamCount: 3, teams, teamInfo: { t0: tsInfo({ weak: ['light', 'dark'] }), t1: tsInfo(), t2: tsInfo() } }));
  assert.equal(both.note, 'Foxes’ colour is hard to read in light and dark mode', 'one team weak on both themes says and');
  assert.equal(hubStatus('teams', tsView({ teamCount: 3, teams, teamInfo: { t0: tsInfo(), t1: tsInfo(), t2: tsInfo() } })).note, undefined, 'nothing flagged, no note');
});

// ── the model, from the live roster ──

test('teamColorInfo: a swatch is never weak; an older colour is weak on a theme it is under 3:1 on (the §8.1 boundary rule)', () => {
  freshState();
  state.teams[0].color = 'pumpkin';
  assert.deepEqual(teamColorInfo('t0'), { id: 'pumpkin', name: 'Pumpkin', legacy: false, weak: [] });
  Object.keys(CAMP_TEAM_PALETTE).forEach((cid) => {
    const sw = CAMP_TEAM_PALETTE[cid];
    assert.ok(tsRatio(sw.l, TEAM_SURFACE.light) >= 3 && tsRatio(sw.d, TEAM_SURFACE.dark) >= 3, cid + ' clears 3:1 on both surfaces, so a swatch is never flagged');
  });
  delete state.teams[0].color;
  teamIds().forEach((id) => {
    const info = teamColorInfo(id);
    const m = /--team-accent-l:(#[0-9a-f]{6});--team-accent-d:(#[0-9a-f]{6})/i.exec(teamAccentVars(id));
    const want = [];
    if (tsRatio(m[1], TEAM_SURFACE.light) < 3) want.push('light');
    if (tsRatio(m[2], TEAM_SURFACE.dark) < 3) want.push('dark');
    assert.deepEqual(info.weak, want, id + ' judged against the real surfaces');
    assert.equal(info.legacy, true);
    assert.equal(info.name, 'Last year’s colour');
  });
  // The spec's own examples: junior's Pilgrims navy and senior's Red are hard to read in dark mode.
  const example = CAMP.id === 'junior' ? 't4' : 't0';
  assert.ok(teamColorInfo(example).weak.includes('dark'), example + ' is hard to read on the dark surface');
  state.teams.push({ id: 't9', name: 'Extra', counselor: '' });
  assert.deepEqual(teamColorInfo('t9'), { id: '', name: '', legacy: false, weak: [] }, 'a team with no colour at all');
  freshState();
});

test('the surfaces the judgement uses are the stylesheet\'s own --sheet in both themes', () => {
  const sheets = TS_CSS.match(/--sheet:\s*(#[0-9a-fA-F]{6})/g).map((m) => m.slice(m.indexOf('#')).toLowerCase());
  assert.equal(sheets[0], TEAM_SURFACE.light);
  assert.equal(sheets[1], TEAM_SURFACE.dark);
});

test('teamsModel: a row per team, the shared colour flagged on BOTH rows, the counselor line, a photo, the headline from the same judgement', () => {
  tsOpen();
  state.teams[0].color = 'blue';
  state.teams[1].color = 'blue';
  state.teams[1].photoV = 3;
  state.teams[0].counselor = 'Sam, Pat';
  const m = teamsModel();
  assert.equal(m.rows.length, CAMP.teamCount);
  const [a, b] = m.rows;
  assert.deepEqual([a.warn, b.warn], [true, true]);
  assert.deepEqual(a.shares, ['t1']);
  assert.deepEqual(b.shares, ['t0']);
  assert.equal(b.photo, true);
  assert.equal(a.photo, false);
  assert.ok(m.status.problems.includes('Two teams are Blue'));
  assert.equal(m.rows.slice(2).every((r) => !r.warn), true, 'the others are fine');
  assert.ok(a.staff.includes('Sam') || a.staff.length > 0, 'counselors come from counselorName');
  tsClose();
});

test('the Teams row on the hub: its own screen, the model carries the shared-colour sentence, and the hub view hands it the team info', () => {
  assert.equal(HUB_OPENS.teams.screen, 'teams');
  tsOpen();
  state.ui.builderScreen = 'hub';
  hubOpen('teams');
  assert.equal(state.ui.builderScreen, 'teams');
  state.teams[0].color = 'teal';
  state.teams[2].color = 'teal';
  const view = hubView();
  assert.ok(view.teamInfo && view.teamInfo.t0 && view.teamInfo.t0.colorId === 'teal');
  const row = hubModel(view).rows.teams;
  assert.equal(row.mark, 'warn');
  assert.deepEqual(row.problems, ['Two teams are Teal']);
  tsClose();
});

// ── the screen ──

test('the screen paints the headline, a row per team and the weak-colour note, and writes nothing when nothing changed', () => {
  tsOpen();
  renderTeamsScreen();
  const list = tsEl('teams-list').innerHTML;
  teamIds().forEach((id) => assert.ok(list.includes('data-team-open="' + id + '"'), id + ' has a row'));
  assert.ok(!/data-warn/.test(list), 'a fresh camp has nothing to fix');
  assert.equal(tsEl('teams-title').textContent, 'Teams · ' + campWord());
  assert.equal(tsEl('teams-headline').textContent, CAMP.teamCount + ' teams');
  assert.equal(tsEl('teams-weak').hidden, !teamsModel().weak.length, 'the note shows exactly when a colour is flagged');
  assert.ok(!/<button[^>]*data-team-open="t[0-9]"[^>]*aria-disabled/.test(list));
  // Two teams on one colour: the headline is the sentence, both rows carry the mark.
  state.teams[0].color = 'gold'; state.teams[1].color = 'gold';
  renderTeamsScreen();
  assert.equal(tsEl('teams-headline').textContent, 'Two teams are Gold');
  assert.equal((tsEl('teams-list').innerHTML.match(/data-warn/g) || []).length, 2);
  tsClose();
});

test('hostile names, short names, emoji and colours render as text in the rows and the sheet', () => {
  tsOpen();
  state.teams[0].name = '"><img src=x onerror=alert(1)>';
  state.teams[0].short = '<script>alert(1)</script>';
  state.teams[0].emoji = '<b>x</b>';
  state.teams[0].color = '"><svg onload=alert(1)>';
  state.teams[0].counselor = '<i>Sam</i>';
  const row = teamRowHtml(teamsModel().rows[0]);
  assert.notOk(/<img src=x|<script|<svg onload|<i>|<b>/i.test(row), row);
  assert.ok(row.includes('&lt;'), 'escaped, not dropped');
  teamOpen('t0');
  renderTeamSheet();
  const sw = tsEl('team-swatches').innerHTML + tsEl('team-emoji-grid').innerHTML;
  assert.notOk(/<img src=x|<script|<svg onload/i.test(sw));
  tsClose();
});

// ── the sheet ──

test('opening a team and saving without a change writes nothing and offers no Undo', () => {
  tsOpen();
  teamOpen('t0');
  assert.ok(teamUi.edit && teamUi.edit.id === 't0');
  renderTeamSheet();
  assert.equal(tsEl('team-name').value, teamName('t0'));
  assert.equal(tsEl('team-short').value, teamShort('t0'));
  assert.equal(tsEl('team-emoji').value, teamEmojiOwn('t0'));
  assert.equal(teamDirty(), false);
  teamSave();
  assert.deepEqual(undoRecent(), [], 'nothing changed, nothing recorded');
  assert.equal(teamUi.edit, null, 'the sheet closed');
  tsClose();
});

test('a rename asks about the short name and emoji first, Keep them saves the name alone, one entry', () => {
  tsOpen();
  teamOpen('t0');
  renderTeamSheet();
  const before = JSON.parse(JSON.stringify(state.teams[0]));
  tsFill('name', 'Mighty Hawks');
  teamSave();
  assert.ok(teamUi.edit && teamUi.edit.ask, 'the question is up');
  assert.deepEqual(undoRecent(), [], 'nothing is written before it is answered');
  assert.equal(state.teams[0].name, before.name);
  renderTeamSheet();
  assert.equal(tsEl('team-rename-q').hidden, false);
  assert.ok(tsEl('team-rename-q-text').textContent.includes('short name') && tsEl('team-rename-q-text').textContent.includes(teamShort('t0')), tsEl('team-rename-q-text').textContent);
  assert.equal(tsEl('team-rename-suggest-text').textContent, 'Suggest: Hawks · 🦅');
  teamAnswerRename('keep');
  assert.equal(state.teams[0].name, 'Mighty Hawks');
  assert.equal(state.teams[0].short, before.short, 'the short name is kept');
  assert.equal(state.teams[0].emoji, before.emoji);
  assert.deepEqual(tsPaths(), ['teams/t0/name'], 'one path');
  assert.equal(undoRecent().length, 1, 'one Undo entry');
  assert.equal(undoRecent()[0].label, 'Renamed ' + before.name + ' to Mighty Hawks');
  tsClose();
});

test('Suggest takes the new name\'s last word as the short name and an emoji when the word is one we know, all in ONE entry', () => {
  tsOpen();
  teamOpen('t1');
  tsFill('name', 'Hawk Squad');
  teamSave();
  assert.equal(teamUi.edit.ask.suggestLabel, 'Suggest: Squad', 'no emoji for a word we do not know');
  teamAnswerRename('suggest');
  assert.equal(state.teams[1].name, 'Hawk Squad');
  assert.equal(state.teams[1].short, 'Squad');
  assert.deepEqual(tsPaths().filter((p) => p !== 'teams/t1/emoji'), ['teams/t1/name', 'teams/t1/short']);
  assert.equal(undoRecent().length, 1);
  tsClose();
  tsOpen();
  teamOpen('t2');
  tsFill('name', 'Flying Eagles');
  teamSave();
  assert.equal(teamUi.edit.ask.suggestLabel, 'Suggest: Eagles · 🦅');
  teamAnswerRename('suggest');
  assert.equal(state.teams[2].short, 'Eagles');
  assert.equal(state.teams[2].emoji, '🦅');
  assert.deepEqual(tsPaths(), ['teams/t2/emoji', 'teams/t2/name', 'teams/t2/short']);
  tsClose();
});

test('a rename that also changed the short name or the emoji is not asked about; it saves those fields it was given', () => {
  tsOpen();
  teamOpen('t0');
  tsFill('name', 'Silver Wolves');
  tsFill('short', 'Wolves');
  teamSave();
  assert.equal(teamUi.edit, null, 'saved without a question');
  assert.deepEqual(tsPaths(), ['teams/t0/name', 'teams/t0/short']);
  assert.equal(state.teams[0].short, 'Wolves');
  tsClose();
});

test('Save writes only what changed: a colour, an emoji, counselors, a cleared short name (back to the camp\'s own) — each its own path', () => {
  tsOpen();
  teamOpen('t0');
  teamPickColor('purple');
  tsFill('emoji', '🐺');
  tsFill('counselor', 'Sam and Pat');
  teamSave();
  assert.deepEqual(tsPaths(), ['teams/t0/color', 'teams/t0/counselor', 'teams/t0/emoji']);
  assert.equal(state.teams[0].color, 'purple');
  assert.equal(teamAccent('t0'), CAMP_TEAM_PALETTE.purple.l);
  assert.equal(teamEmoji('t0'), '🐺');
  undoClear();
  teamOpen('t0');
  tsFill('short', 'Wolfpack');
  teamSave();
  assert.deepEqual(tsPaths(), ['teams/t0/short']);
  undoClear();
  teamOpen('t0');
  tsFill('short', '');
  teamSave();
  assert.equal(state.teams[0].short, undefined, 'cleared: the field is removed and the camp\'s own short name shows again');
  assert.equal(teamShort('t0'), TEAM_ABBREV.t0);
  assert.deepEqual(tsPaths(), ['teams/t0/short']);
  tsClose();
});

test('a second director\'s change to another field of the same team survives: the save resolves the record by id and writes only its own fields', () => {
  tsOpen();
  teamOpen('t0');
  state.teams[0].counselor = 'Added by someone else meanwhile';   // a snapshot landed while the sheet was open
  tsFill('name', 'Ferocious Foxes II');
  teamSave();
  teamAnswerRename('keep');
  assert.equal(state.teams[0].name, 'Ferocious Foxes II');
  assert.equal(state.teams[0].counselor, 'Added by someone else meanwhile', 'the field this save did not touch is theirs');
  tsClose();
});

test('the rules\' limits are said in words and nothing is written: an empty or over-long name, a short name with < > & or a quote, an over-long emoji', () => {
  tsOpen();
  teamOpen('t0');
  const tries = [
    ['name', '', 'name', 'Give the team a name.'],
    ['name', 'x'.repeat(61), 'name', 'Keep the name to 60 characters.'],
    ['short', 'a<b', 'short', 'Leave out < > & and quote marks.'],
    ['short', 'Q"', 'short', 'Leave out < > & and quote marks.'],
    ['short', 'x'.repeat(21), 'short', 'Keep the short name to 20 characters.'],
    ['emoji', 'a&b', 'emoji', 'Use an emoji, without < > & or quote marks.'],
    ['emoji', '🦊'.repeat(9), 'emoji', 'That is more than one emoji.'],
  ];
  tries.forEach(([field, value, shown, words]) => {
    teamOpen('t0');
    tsFill(field, value);
    teamSave();
    renderTeamSheet();
    assert.equal(tsEl('team-' + shown + '-error').textContent, words, field + ' ' + JSON.stringify(value));
    assert.equal(tsEl('team-' + shown + '-error').hidden, false);
    assert.deepEqual(undoRecent(), [], 'nothing written');
    assert.ok(teamUi.edit, 'the sheet stays up');
  });
  tsClose();
});

test('an emoji another team uses cannot be picked from the grid and says whose; picking a free one fills the field', () => {
  tsOpen();
  teamOpen('t0');
  const other = teamEmojiOwn('t1');
  teamPickEmoji(other);
  assert.equal(teamUi.edit.error.emoji, (teamShort('t1') || teamName('t1')) + ' already uses ' + other + '.');
  assert.equal(tsEl('team-emoji').value, teamEmojiOwn('t0'), 'the field is untouched');
  teamPickEmoji('🐙');
  assert.equal(tsEl('team-emoji').value, '🐙');
  teamPickEmoji('<b>');
  assert.equal(tsEl('team-emoji').value, '🐙', 'junk is not a pick');
  teamPickColor('not-a-colour');
  assert.equal(teamUi.edit.color, teamColorId('t0'), 'only the twelve');
  teamPickColor('slate');
  assert.equal(teamUi.edit.color, 'slate');
  tsClose();
});

test('a counselor reaches none of it: no screen, no sheet, nothing opens, nothing is written', () => {
  tsOpen('viewer');
  assert.equal(setupGo('teams'), false);
  teamOpen('t0');
  assert.equal(teamUi.edit, null);
  teamUi.edit = { id: 't0', origin: {}, color: '', pane: 'form' };
  assert.equal(shellSheetAllowed('team-edit'), false);
  assert.equal(shellSheetAllowed('team-colors'), false);
  teamColorSet('t0', 'red');
  assert.equal(state.teams[0].color, undefined, 'a counselor\'s device writes no colour');
  tsClose();
});

test('closing a sheet with edits asks first (✕, Escape and Back reach the same guard); a clean one closes; the deploy reload waits on unsaved edits', () => {
  tsOpen();
  assert.equal(setupSheetGuardClose('team-edit'), false, 'no sheet open: nothing at stake');
  teamOpen('t0');
  assert.equal(teamGuardClose(), false, 'clean');
  assert.equal(teamEditBusy(), false);
  tsFill('name', 'Different');
  assert.equal(teamDirty(), true);
  assert.equal(teamEditBusy(), true, 'an edit in the form holds the auto-reload');
  assert.equal(reloadBlocked(), true, 'reloadBlocked asks it');
  const midReal = editorMidEntry;
  editorMidEntry = () => false;
  try { assert.equal(shellHasUnsentWork(), true, 'and so does the shell: ten minutes away does not discard the half-made edit'); } finally { editorMidEntry = midReal; }
  const asked = [];
  const real = askDialog;
  askDialog = async (o) => { asked.push(o); return 'keep'; };
  try {
    assert.equal(setupSheetGuardClose('team-edit'), true, 'the guard took the close over');
    assert.equal(teamGuardClose(true), true, '✕ and the backdrop too');
  } finally { askDialog = real; }
  assert.equal(asked.length >= 1 && asked[0].title.startsWith('Discard your changes to'), true);
  assert.ok(teamUi.edit, 'Keep editing leaves the sheet up');
  assert.equal(setupSheetGuardClose('sched-item'), false, 'the Schedule item guard is still its own');
  tsClose();
});

// ── the flagged-colours sheet ──

test('Pick colours for the flagged teams: one tap per team commits, the team leaves the list, and the sheet closes when none is left', () => {
  tsOpen();
  const flagged = teamsModel().weak.slice();
  assert.ok(flagged.length > 0, CAMP.id + ' has older colours that are hard to read on a theme');
  teamColorsOpen();
  assert.equal(teamUi.colors, true);
  renderTeamColorsSheet();
  const html = tsEl('team-colors-list').innerHTML;
  flagged.forEach((id) => assert.ok(html.includes('data-team-flag="' + id + '"'), id));
  assert.equal((html.match(/data-team-pick="t[0-9]"/g) || []).length, flagged.length * 12, 'twelve swatches each');
  flagged.forEach((id, i) => {
    teamColorSet(id, 'indigo');
    assert.equal(state.teams.find((t) => t.id === id).color, 'indigo');
    assert.equal(teamsModel().weak.includes(id), false, id + ' is fixed');
    assert.equal(undoRecent()[0].label, 'Colour for ' + teamName(id));
  });
  assert.equal(teamUi.colors, false, 'nothing left to pick');
  assert.equal(teamsModel().weak.length, 0);
  teamColorSet(flagged[0], 'not-a-colour');
  assert.equal(state.teams.find((t) => t.id === flagged[0]).color, 'indigo', 'a junk colour is ignored');
  tsClose();
});

// ── cleared teams (the new-year setup's Clear): "Team N", the number tile, no colour yet ──

function tsClear(n) {
  state.teams.forEach((t, i) => {
    if (n !== undefined && i >= n) return;
    Object.assign(t, { name: 'Team ' + (i + 1), short: 'Team ' + (i + 1), emoji: (i + 1) + '\uFE0F\u20E3', plain: true });
    delete t.color; delete t.photoV;
  });
}

test('a cleared team reads "Team 1" over "No colour yet": no short name equal to the name, no emoji beside its own number tile', () => {
  tsOpen();
  tsClear();
  renderTeamsScreen();
  const row = tsEl('teams-list').innerHTML.split('data-team-open="t0"')[1].split('</button>')[0];
  assert.ok(row.includes('Team 1'), row);
  assert.ok(row.includes('No colour yet'));
  assert.ok(row.includes('data-num="1"'), 'its number tile');
  assert.equal(/Team 1 · /.test(row.replace(/<[^>]*>/g, '')), false, 'the short name is left out when it is the name');
  assert.equal(row.replace(/<[^>]*>/g, '').includes('1\uFE0F\u20E3'), false, 'the keycap is not listed beside its own tile');
  // a picked emoji is a real choice and shows in the sub again
  state.teams[0].emoji = '🦅';
  renderTeamsScreen();
  assert.ok(tsEl('teams-list').innerHTML.split('data-team-open="t0"')[1].split('</button>')[0].includes('🦅'));
  tsClose();
});

test('the hub row: cleared teams with no colour are a gentle, uncounted note; a colour or a photo takes the team out of it', () => {
  tsOpen();
  tsClear();
  let m = teamsModel();
  assert.equal(m.status.mark, 'ok', 'still ready: the note is never a counted problem');
  assert.equal(m.status.note, CAMP.teamCount + ' teams have no colour yet');
  assert.equal(m.status.problems.length, 0, 'a cleared team is not "short name / emoji missing"');
  state.teams[0].color = 'teal';
  m = teamsModel();
  assert.equal(m.status.note, (CAMP.teamCount - 1) + ' teams have no colour yet');
  state.teams[1].photoV = 2;
  assert.equal(teamsModel().status.note, (CAMP.teamCount - 2 === 1 ? 'Team ' + CAMP.teamCount + ' has no colour yet' : (CAMP.teamCount - 2) + ' teams have no colour yet'));
  state.teams.forEach((t, i) => { if (i > 1) t.color = 'teal'; });
  assert.equal(teamsModel().status.note, undefined);
  tsClose();
});

test('the colours sheet also serves cleared teams: it lists them, a pick commits, and it says "Every team has a colour now" at the end', () => {
  tsOpen();
  tsClear(2);
  const bare = teamsModel().flag.slice();
  ['t0', 't1'].forEach((id) => assert.ok(bare.includes(id), id + ' is on the list (junior\'s older weak colours may join it)'));
  renderTeamsScreen();
  assert.equal(tsEl('teams-weak').hidden, false);
  assert.ok(/Pick (new )?colours for/.test(tsEl('teams-weak-btn-text').textContent), tsEl('teams-weak-btn-text').textContent);
  assert.ok(/Team[ \u00a0]1/.test(tsEl('teams-weak-text').textContent));
  teamColorsOpen();
  assert.equal(teamUi.colors, true);
  renderTeamColorsSheet();
  assert.ok(tsEl('team-colors-list').innerHTML.includes('No colour yet'));
  assert.ok(tsEl('team-colors-list').innerHTML.includes('data-team-flag="t0"'));
  teamColorSet('t0', 'indigo');
  assert.equal(state.teams[0].color, 'indigo');
  assert.equal(state.teams[0].plain, true, 'a pick never clears the marker');
  assert.equal(teamMarkSpec('t0').kind, 'tile', 'a camp with flags does not get its flag back');
  teamColorSet('t1', 'teal');
  const weakLeft = teamsModel().flag.length;
  if (!weakLeft) assert.equal(teamUi.colors, false, 'nothing left to pick');
  tsClose();
});

// ── the photo ──

test('teamCropRect: the picture always covers the frame, the offset is clamped, zoom is 1 to 3', () => {
  const W = TEAM_PHOTO_W, H = TEAM_PHOTO_H;
  const covers = (r) => r.dx <= 1e-9 && r.dy <= 1e-9 && r.dx + r.dw >= W - 1e-9 && r.dy + r.dh >= H - 1e-9;
  [[1000, 1000], [4000, 3000], [300, 900], [346, 480], [50, 50]].forEach(([w, h]) => {
    [1, 1.5, 3, 9, 0, -2, NaN].forEach((zoom) => {
      [0, 40, -40, 1e6, -1e6].forEach((o) => {
        const r = teamCropRect({ w, h, zoom, ox: o, oy: o });
        assert.ok(covers(r), `${w}×${h} zoom ${zoom} offset ${o}: the frame stays covered`);
      });
    });
  });
  const exact = teamCropRect({ w: W, h: H, zoom: 1, ox: 50, oy: 50 });
  assert.deepEqual([exact.dx, exact.dy, exact.dw, exact.dh], [0, 0, W, H], 'a picture already the frame\'s shape cannot move at zoom 1');
  const wide = teamCropRect({ w: 4000, h: 3000, zoom: 1, ox: 0, oy: 0 });
  assert.ok(Math.abs(wide.dx + wide.dw / 2 - W / 2) < 1e-9, 'centred to begin with');
  assert.equal(teamCropRect({ w: 1000, h: 1000, zoom: 99 }).dw, teamCropRect({ w: 1000, h: 1000, zoom: 3 }).dw, 'zoom stops at 3');
});

test('teamPhotoFit takes the first that fits the aim, else the best under the cap, else nothing; teamTint lightens toward white', () => {
  const u = (n) => 'x'.repeat(n);
  assert.equal(teamPhotoFit([u(80000), u(60000), u(40000)], 70000, 100000), u(60000));
  assert.equal(teamPhotoFit([u(95000), u(90000)], 70000, 100000), u(95000), 'over the aim but under the cap: the best quality that is allowed');
  assert.equal(teamPhotoFit([u(120000), u(110000)], 70000, 100000), null);
  assert.equal(teamPhotoFit([], 70000, 100000), null);
  assert.equal(teamPhotoFit([null, 5, u(10)], 70000, 100000), u(10));
  assert.equal(teamTint('#000000', 0.5), '#808080');
  assert.equal(teamTint('#ffffff', 0.9), '#ffffff');
  ['', null, 'red', '#fff'].forEach((bad) => assert.equal(teamTint(bad, 0.5), TEAM_SURFACE.light));
  assert.ok(TEAM_PHOTO_W / TEAM_PHOTO_H > 0.719 && TEAM_PHOTO_W / TEAM_PHOTO_H < 0.722, 'the shield\'s 480:667 shape, long edge 480');
  assert.equal(TEAM_PHOTO_H, 480);
});

test('teamSuggest: the last word of a name, an emoji for the words we know, singular or plural', () => {
  assert.deepEqual(teamSuggest('Mighty Hawks'), { short: 'Hawks', emoji: '🦅' });
  assert.deepEqual(teamSuggest('Red Fox'), { short: 'Fox', emoji: '🦊' });
  assert.deepEqual(teamSuggest('The Bees'), { short: 'Bees', emoji: '🐝' });
  assert.deepEqual(teamSuggest('Team Rocket'), { short: 'Rocket', emoji: '🚀' });
  assert.deepEqual(teamSuggest('Purple Zorbles'), { short: 'Zorbles', emoji: '' });
  assert.deepEqual(teamSuggest('???'), { short: '', emoji: '' });
  assert.deepEqual(teamSuggest(''), { short: '', emoji: '' });
  assert.ok(teamSuggest('A' + 'b'.repeat(40)).short === '', 'a last word over 20 characters is not a short name');
});

async function tsPhotoDb(opts) {
  tsOpen();
  const db = makeFakeRtdb();
  window.firebase = { database: () => ({ ref: (p) => db.ref(p) }) };
  fbRef = db.ref(dbPath('state'));
  fbConnKnown = true; fbConnected = true;
  remoteReady = true;
  if (opts && opts.refuse) db.refuse(dbPath('teamPhotos'));
  return db;
}
function tsPhotoDone() {
  fbRef = null; remoteReady = false; fbConnKnown = false; fbConnected = false;
  delete window.firebase;
  TEAM_PHOTO_MEM.clear(); teamPhotoAsked.clear();
  clearTimeout(pushTimer); pushTimer = null;
  tsClose();
}

test('the upload writes teamPhotos/<tid> = { v, data } first, then the record\'s photoV, in the rules\' shape; it is not undoable', async () => {
  const db = await tsPhotoDb();
  const r = await teamPhotoUpload('t0', tsPng);
  assert.equal(r.ok, true);
  const node = db.serverTree()[CAMP.dbRoot].teamPhotos.t0;
  assert.deepEqual(Object.keys(node).sort(), ['data', 'v']);
  assert.equal(node.data, tsPng);
  assert.ok(typeof node.v === 'number' && node.v >= 0 && node.v === r.v);
  assert.ok(node.data.length <= 100000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(node.data), 'the rules\' own limits');
  assert.equal(state.teams[0].photoV, r.v);
  assert.equal(teamCrestSrc('t0'), tsPng, 'this device shows it at once (memory)');
  assert.deepEqual(undoRecent(), [], 'no Undo entry: the node holds only the newest upload');
  // Replacing it: the version only goes up, even if the clock went back.
  const r2 = await teamPhotoUpload('t0', tsPng + 'AAAA');
  assert.ok(r2.ok && r2.v > r.v);
  assert.equal(teamPhotoVersion('t0'), r2.v);
  tsPhotoDone();
});

test('the upload is online-only and changes nothing when it cannot finish: offline, refused by the rules, a hostile or over-size picture', async () => {
  const db = await tsPhotoDb();
  fbConnected = false;
  assert.deepEqual(await teamPhotoUpload('t0', tsPng), { ok: false, reason: 'offline' });
  fbConnected = true;
  fbRef = null;
  assert.deepEqual(await teamPhotoUpload('t0', tsPng), { ok: false, reason: 'offline' }, 'no sync at all');
  fbRef = db.ref(dbPath('state'));
  assert.deepEqual(await teamPhotoUpload('t0', 'data:image/png;base64,AAAA" onerror="x'), { ok: false, reason: 'format' });
  assert.deepEqual(await teamPhotoUpload('t0', 'https://tracker.example/x.png'), { ok: false, reason: 'format' });
  assert.deepEqual(await teamPhotoUpload('t0', 'data:image/png;base64,' + 'A'.repeat(100000)), { ok: false, reason: 'format' });
  db.refuse(dbPath('teamPhotos'));
  assert.deepEqual(await teamPhotoUpload('t0', tsPng), { ok: false, reason: 'denied' });
  assert.equal(state.teams[0].photoV, undefined, 'the record still has no photo');
  assert.equal((db.serverTree()[CAMP.dbRoot] || {}).teamPhotos, undefined, 'and the node was not written');
  tsPhotoDone();
});

test('a photo still going up when the signal dies lets go of the sheet after the wait, says so, and finishes the record if it lands', async () => {
  const db = await tsPhotoDb();
  const held = [];
  // A set() whose connection died mid-write: it neither resolves nor rejects until the signal is back.
  const hanging = { database: () => ({ ref: (p) => ({ set: (val) => new Promise((res, rej) => { held.push(() => db.ref(p).set(val).then(res, rej)); }) }) }) };
  const normal = window.firebase;
  window.firebase = hanging;
  teamPhotoWaitMs = 10;
  try {
    const r = await teamPhotoUpload('t0', tsPng);
    assert.deepEqual(r, { ok: false, reason: 'slow' }, 'the sheet is let go of: the wait ended with a plain sentence, not a hang');
    assert.ok(/taking a while/.test(TEAM_PHOTO_WHY.slow) && /try again/.test(TEAM_PHOTO_WHY.slow));
    assert.equal(state.teams[0].photoV, undefined, 'nothing is claimed yet');
    assert.equal(held.length, 1);
    held[0]();
    await waitUntil(() => state.teams[0].photoV !== undefined, 'the late write to finish the record');
    assert.equal(state.teams[0].photoV, db.serverTree()[CAMP.dbRoot].teamPhotos.t0.v, 'the node and photoV agree');

    // A newer upload that has gone up since wins: a write that lands late must not put an older version on the record.
    state.teams[0].photoV = undefined; delete state.teams[0].photoV;
    teamPhotoSeq.t0 = 0;
    const slowOne = await teamPhotoUpload('t0', tsPng);
    assert.equal(slowOne.reason, 'slow');
    window.firebase = normal;
    const fresh = await teamPhotoUpload('t0', tsPng + 'AAAA');
    assert.ok(fresh.ok);
    held[1]();
    await waitQuiet();
    assert.equal(state.teams[0].photoV, fresh.v, 'the newest upload\'s version stays on the record');
  } finally { teamPhotoWaitMs = 20000; tsPhotoDone(); }
});

test('Remove photo takes photoV off (the node stays, so Undo can put it back) and the shield or flag shows again', async () => {
  await tsPhotoDb();
  state.teams[0].photoV = 7;
  TEAM_PHOTO_MEM.set('t0:7', tsPng);
  teamOpen('t0');
  assert.equal(teamCrestSrc('t0'), tsPng);
  teamPhotoRemove();
  assert.equal(state.teams[0].photoV, undefined);
  assert.deepEqual(tsPaths(), ['teams/t0/photoV']);
  assert.equal(teamCrestSrc('t0'), safeCrestSrc(TEAM_SHIELD.t0) || null);
  const entry = undoRecent()[0];
  assert.equal(undoEntry(entry.id).ok !== false, true);
  assert.equal(state.teams[0].photoV, 7, 'Undo puts the version back');
  tsPhotoDone();
});

// ── source pins ──

test('every element the Teams code reaches by id is in index.html, and every tap target is 44px', () => {
  const ids = new Set();
  (TS_TEAMS_SRC.match(/setupEl\('([a-z0-9-]+)'\)/g) || []).forEach((m) => ids.add(/'([^']+)'/.exec(m)[1]));
  (TS_TEAMS_SRC.match(/teamFieldEl\('([a-z]+)'\)/g) || []).forEach((m) => ids.add('team-' + /'([^']+)'/.exec(m)[1]));
  (TS_TEAMS_SRC.match(/on\('#([a-z0-9-]+)'/g) || []).forEach((m) => ids.add(/#([^']+)/.exec(m)[1]));
  (TS_TEAMS_SRC.match(/\('#?(team-[a-z-]+|teams-[a-z-]+)'\)/g) || []);
  ['team-name-error', 'team-short-error', 'team-emoji-error'].forEach((x) => ids.add(x));
  assert.ok(ids.size > 25, 'found the ids: ' + ids.size);
  ids.forEach((id) => assert.ok(new RegExp('id="' + id + '"').test(TS_INDEX), id + ' is in index.html'));
  ['sheet-team-edit', 'sheet-team-colors', 'setup-teams'].forEach((id) => assert.ok(new RegExp('id="' + id + '"').test(TS_INDEX), id));
  ['.tms-emo', '.tms-pick', '.tms-swatch', '.tms-zoom'].forEach((sel) => {
    const rule = new RegExp('\\n' + sel.replace('.', '\\.') + ' \\{[^}]*\\}').exec(TS_CSS.slice(TS_CSS.indexOf('SET UP THE WEEK: Teams')));
    assert.ok(rule && /var\(--target\)/.test(rule[0]), sel + ' is at least 44px');
  });
  assert.ok(/\.cb-row/.test(TS_CSS), 'the rows are the clipboard rows every setup screen uses');
});

test('the sheet\'s controls are native or plain buttons: labelled fields, a radiogroup for the swatches, nothing nested', () => {
  const sheet = TS_INDEX.slice(TS_INDEX.indexOf('id="sheet-team-edit"'), TS_INDEX.indexOf('id="sheet-team-colors"'));
  assert.ok(/role="radiogroup"/.test(sheet));
  assert.ok(/<label[^>]*>\s*<span class="fld-label">Team name<\/span>/.test(sheet));
  assert.ok(/for="team-emoji"/.test(sheet));
  assert.ok(/<legend class="fld-label">Colour<\/legend>/.test(sheet));
  assert.ok(/accept="image\/\*"/.test(sheet));
  assert.ok(!/confirm\(|alert\(|prompt\(/.test(TS_TEAMS_SRC), 'no native dialog: askDialog and an inline question');
  // The rename question is the item sheet's own inline question, never a dialog over the sheet.
  assert.ok(/class="si-ask" id="team-rename-q"/.test(sheet));
});

test('the Teams code touches the roster only through stateEdit, and every write is a per-field one', () => {
  const writes = TS_TEAMS_SRC.split('\n').filter((l) => /state\.teams\s*=|state\.teams\.(push|splice|pop|shift)|\.teams\s*=\s*\[/.test(l));
  assert.deepEqual(writes, [], 'no whole-roster write, no add or delete of a team');
  assert.equal((TS_TEAMS_SRC.match(/\bstateEdit\(/g) || []).length >= 4, true);
  assert.ok(!/\bsaveState\(/.test(TS_TEAMS_SRC), 'stateEdit is the one way in (it saves, and records the undo)');
});

test('editorsHere says where a director is: the Teams screen, and which team while its sheet is up', () => {
  tsOpen();
  assert.equal(setupWhereNow(), 'teams');
  teamOpen('t1');
  assert.equal(setupWhereNow(), 'team:t1');
  teamUi.edit = null;
  assert.equal(setupWhereNow(), 'teams');
  assert.equal(setupHereRow('team:t1'), 'teams', 'and the hub row carries the other director\'s initial');
  tsClose();
});
