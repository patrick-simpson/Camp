// The seam stays a seam (setup-rebuild-spec §9.3). The week's own data — the
// printed schedule, meals, electives, verses, cleanup rota, team branding, the
// game catalog — is read in ONE place, the SEAM block in app.js, and every
// renderer asks an accessor. This reads the source of app.js, chat.js, push.js
// and settings.js and fails, with the line, on any direct read outside the
// block. Reads only: the week builder WRITES the game and day catalog straight
// into state.config (it is the authority the accessors front), and those few
// mutation sites are recognised by shape below.

const SEAM_OPEN = '// ── SEAM: week data accessors';
const SEAM_CLOSE = '// ── end SEAM';
const SEAM_FILES = ['app.js', 'chat.js', 'push.js', 'settings.js', 'tell.js', 'award.js', 'now-ui.js'];

// The camps.js constants the SEAM block aliases (and the retired ones they replace).
const SEAM_CONSTANTS = /\b(?:DAY_SCHEDULE|SCHED_DAYS|MEALS|ELECTIVES|STATION_EMOJI|ELECTIVE_SLOT_MIN|MEMORY_VERSE[A-Z_]*|MEAL_CLEANUP_SCHEDULE|MEAL_START_MINUTES|TEAM_(?:EMOJI|SHIELD|ACCENT|ABBREV|COUNSELORS)|DEFAULT_[A-Z_]+|OLD_PLACEHOLDER_[A-Z_]+|DAY_NAMES|DOUBLE_BONUS_[A-Z]+|DOUBLE_WINDOW_LEGACY)\b/;
// The same data read straight off the camp profile.
const SEAM_CAMP_FIELDS = /\bCAMP\??\.(?:daySchedule|schedDays|meals|electives|stationEmoji|electiveSlotMin|memoryVerseTheme|memoryVerses|mealCleanupSchedule|teamEmoji|teamCrest|teamAccent|teamAbbrev|teamCounselors|defaultTeamNames|defaultCounselors|oldPlaceholderTeamNames|oldPlaceholderCounselors)\b/;
// The synced catalog, read directly — unless it is the builder's own write to it.
const SEAM_CATALOG = /\bstate\.config\??\.(?:days|games)\b/;
// Writes are cut out of the line BEFORE the read test, so a write sharing a line
// with a read (`state.config.games.push(state.config.games.length)`) still trips it.
const SEAM_CATALOG_WRITE = /\bstate\.config\.(?:days|games)(?:\.(?:push|splice|unshift|pop|shift|sort|reverse)\(|\[[^\]]*\]\s*=(?!=))|\bmoveItem\(state\.config\.(?:days|games)\b/g;
// The shapes a property regex cannot see: a computed key (`state.config['days']`,
// `CAMP['meals']`), an alias (`const cfg = state.config;`, `const { meals } = CAMP;`)
// and a read split across lines (the line ends in `state.config` / `CAMP`, the
// property starts the next). Passing the whole object as an argument
// (`defaultDay(state.config)`, `config: state.config,`) is none of these.
const SEAM_INDIRECT = /\b(?:state\.config|CAMP)\s*(?:\?\.)?\[|=\s*(?:state\.config|CAMP)\s*;?\s*$|(?:^|[^\w.])(?:state\.config|CAMP)\s*$/;
const SEAM_SETUP_TREE = /\bsetupTree\b/;

// Drop what isn't code: whole-line and trailing // comments, block comments.
function codeOf(line) {
  return line.replace(/\/\*.*?\*\//g, '').replace(/(^|[\s;,{}()])\/\/.*$/, '$1').replace(/^\s*\*.*$/, '');
}

// Every direct read in `text`, as "line: source". `text` must already have the
// SEAM block cut out.
function seamViolations(text) {
  const hits = [];
  text.split('\n').forEach((raw, i) => {
    const code = codeOf(raw);
    if (!code.trim()) return;
    const bad = SEAM_CONSTANTS.test(code) || SEAM_CAMP_FIELDS.test(code) || SEAM_SETUP_TREE.test(code)
      || SEAM_INDIRECT.test(code) || SEAM_CATALOG.test(code.replace(SEAM_CATALOG_WRITE, ''));
    if (bad) hits.push((i + 1) + ': ' + raw.trim());
  });
  return hits;
}

// app.js with the SEAM block cut out (its lines blanked, so numbers still match the file).
function outsideTheSeam(src) {
  const open = src.indexOf(SEAM_OPEN);
  const close = src.indexOf(SEAM_CLOSE);
  const after = src.indexOf('\n', close) + 1;
  const cut = src.slice(open, after);
  return src.slice(0, open) + cut.replace(/[^\n]/g, '') + src.slice(after);
}

test('the SEAM block exists once in app.js, whole, and holds every week constant', () => {
  const src = readFixture('../app.js');
  assert.equal(src.split(SEAM_OPEN).length, 2, 'one opening marker');
  assert.equal(src.split(SEAM_CLOSE).length, 2, 'one closing marker');
  assert.ok(src.indexOf(SEAM_OPEN) < src.indexOf(SEAM_CLOSE), 'markers in order');
  const block = src.slice(src.indexOf(SEAM_OPEN), src.indexOf(SEAM_CLOSE));
  [
    'DAY_SCHEDULE', 'SCHED_DAYS', 'DAY_NAMES', 'MEALS', 'MEAL_CLEANUP_SCHEDULE', 'MEAL_START_MINUTES',
    'MEMORY_VERSE_THEME', 'MEMORY_VERSES', 'ELECTIVES', 'STATION_EMOJI', 'ELECTIVE_SLOT_MIN',
    'TEAM_COUNSELORS', 'TEAM_EMOJI', 'TEAM_SHIELD', 'TEAM_ACCENT', 'TEAM_ABBREV', 'DEFAULT_TEAM_NAMES',
    'DEFAULT_COUNSELORS', 'OLD_PLACEHOLDER_TEAM_NAMES', 'OLD_PLACEHOLDER_COUNSELORS',
    'MEAL_CLEANUP_MEALS', 'MEAL_ICONS',
  ].forEach((name) => {
    assert.ok(new RegExp('^const ' + name + ' = ', 'm').test(block), name + ' is declared inside the block');
    assert.equal((src.match(new RegExp('^const ' + name + ' = ', 'gm')) || []).length, 1, name + ' is declared once');
  });
  [
    'scheduleForDow', 'scheduleWeek', 'weekDays', 'dayLabel', 'competitionDays', 'competitionDows', 'dayById',
    'allGames', 'gameById', 'gamesForDayId', 'gamesForBlock', 'legacyMealOf', 'mealFor', 'mealStart',
    'cleanupOnRota', 'cleanupTeams', 'blockKey', 'blockPushId', 'verseTheme', 'verseFor', 'electivesFor',
    'stationEmoji', 'electiveSlotStart', 'doubleWindow', 'teamIds', 'teamEmoji', 'teamShort', 'teamAccent',
    'teamCrestSrc', 'teamRoster', 'staffNames', 'seedTeams', 'legacyRosterFor',
    // step 25: a team's own record and its laundered colour
    'teamRecord', 'teamColorId', 'teamAccentVars', 'teamEmojiOwn', 'teamPhotoVersion',
    // step 15: the schedule's "on" half (planForDow, campWeek) and the game links
    'scheduleIsShared', 'weekdayIndex', 'planForDow', 'campWeek', 'gamesForDay', 'unscheduledGames',
  ].forEach((fn) => {
    assert.ok(block.includes('function ' + fn + '('), fn + '() lives in the block');
    assert.equal(src.split('function ' + fn + '(').length, 2, fn + '() is defined once');
  });
});

test('no renderer reads the week data directly: app.js, chat.js, push.js and settings.js use the accessors', () => {
  const hits = [];
  SEAM_FILES.forEach((file) => {
    const src = readFixture('../' + file);
    const body = file === 'app.js' ? outsideTheSeam(src) : src;
    seamViolations(body).forEach((h) => hits.push(file + ':' + h));
  });
  assert.deepEqual(hits, [], 'ask an accessor in the SEAM block instead:\n  ' + hits.join('\n  '));
});

test('the scan itself catches what it should and lets the allowed shapes through', () => {
  const flagged = (line) => seamViolations(line).length === 1;
  // Direct reads of the constants, the profile and the catalog are caught…
  assert.ok(flagged('const blocks = DAY_SCHEDULE[dow] || [];'));
  assert.ok(flagged("const emoji = `${STATION_EMOJI[station]}`;"));
  assert.ok(flagged('const names = TEAM_COUNSELORS[tid];'));
  assert.ok(flagged('const t = CAMP.teamEmoji;'));
  assert.ok(flagged('const days = state.config.days.filter((d) => d.dow === dow);'));
  assert.ok(flagged('const g = state.config.games.find((x) => x.id === id);'));
  assert.ok(flagged('return state.config.games[0];'));
  assert.ok(flagged('const base = setupTree.meta;'));
  assert.ok(flagged('t.name = DEFAULT_TEAM_NAMES[i];'));
  // …including the shapes a property regex misses: destructuring, a computed key,
  // an alias, an optional chain, a read split across lines, a write beside a read.
  assert.ok(flagged('const { games } = state.config;'));
  assert.ok(flagged("const d = state.config['days'];"));
  assert.ok(flagged('const cfg = state.config;'));
  assert.ok(flagged('  = state.config'), 'an alias whose declaration wrapped');
  assert.ok(flagged('const g = state.config?.games;'));
  assert.ok(flagged("const s = CAMP['daySchedule'];"));
  assert.ok(flagged('const { meals } = CAMP;'));
  assert.ok(flagged('const c = CAMP?.meals;'));
  assert.ok(flagged('const profile = CAMP'));
  assert.equal(seamViolations('const rows = state.config\n  .games\n  .filter(Boolean);').length, 1, 'a read split across lines');
  assert.ok(flagged('state.config.games.push(state.config.games.length);'));
  // …accessor calls, comments and the builder's own writes are not.
  assert.ok(!flagged('const blocks = scheduleForDow(dow);'));
  assert.ok(!flagged('// the old DAY_SCHEDULE[dow] read'));
  assert.ok(!flagged('  * TEAM_COUNSELORS, in a block comment'));
  assert.ok(!flagged('const x = 1; // was MEALS[dow]'));
  assert.ok(!flagged('state.config.games.push(out);'));
  assert.ok(!flagged('if (idx > -1) state.config.games.splice(idx, 1);'));
  assert.ok(!flagged('state.config.games[iA] = allGames()[iB];'));
  assert.ok(!flagged('moveItem(state.config.days, idx, 1);'));
  assert.ok(!flagged('state.config = CAMP.defaultConfig();'));
  assert.ok(!flagged('const n = CAMP.teamCount;'));
  assert.ok(!flagged('const sessions = state.config.sessions || [];'));
  assert.ok(!flagged('    config: state.config,'));
  assert.ok(!flagged('state.ui.day = defaultDay(state.config);'));
  assert.ok(!flagged('state.config = remote;'));
  assert.ok(!flagged("const c = (typeof CAMPS !== 'undefined' && CAMPS[campId]) || CAMP;"));
});

test('outsideTheSeam blanks the block and keeps every other line where it was', () => {
  const src = 'a\n' + SEAM_OPEN + ' ──\nconst DAY_SCHEDULE = 1;\n' + SEAM_CLOSE + ' ──\nb\n';
  const out = outsideTheSeam(src);
  assert.equal(out.split('\n').length, src.split('\n').length, 'same number of lines');
  assert.deepEqual(seamViolations(out), []);
  assert.deepEqual(seamViolations(src).length, 1, 'uncut, the constant is a hit');
});
