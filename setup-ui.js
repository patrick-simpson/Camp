// ════════════════════════════════════════════════════════════════════
// SET UP THE WEEK: THE SCREENS' UI (setup-rebuild-spec §6.7, §7.1, §7.2, §11.0-11.2 — build step 14)
// ════════════════════════════════════════════════════════════════════
// The behaviour under index.html's #setup frame (the markup and CSS were designed first: see
// CLAUDE.md "Set up the week: the frame, the hub, the clipboard"). This file paints and wires
// it; the DATA is setup-sync.js's engine, and every hook into the page is typeof-guarded, so
// deleting this <script> tag leaves the v197 builder (no data-screen on #setup) exactly as it was.
//
// A renderer here patches text, `hidden` and data-* on static markup and never rebuilds a row
// (render-stability rules: setTextIfChanged / setHiddenIfChanged / setHtmlIfChanged), and every
// moving thing is a JellyMotion preset with a calm path.
//
// Sections of this file:
//   1. the hub's model: hubStatus (pure), hubModel, the front door, hubView (reads the page)
//   2. the frame: screens, navigation, Back, the head (sync line, who's here), owner gating
//   3. the hub's painting
//   4. askDialog (the one confirm of the setup screens)
//   5. the undo pill and Recent changes
//   6. the sheets (menu, recent changes, devices) and who's here
//   7. restore points: the screen, the restore sheet, hold-to-confirm, backup files
//   8. wiring (wireSetupUi, called from app.js init)
//  12. meals, memory verses, the cleanup rota, electives (step 19; the end of the file)

// ── 1. The hub's model ───────────────────────────────────────────────

// The rows that count toward "N of M ready" (the first group); alerts, notice and restore
// belong to "Sharing and backups" and are not counted.
const HUB_COUNTED = ['week', 'schedule', 'games', 'teams', 'people', 'campers', 'meals', 'verses', 'cleanup', 'electives'];
const HUB_ROW_KEYS = HUB_COUNTED.concat(['alerts', 'notice', 'restore']);
const HUB_LABELS = {
  week: 'Camp week', schedule: 'Schedule', games: 'Games', teams: 'Teams', people: 'People', campers: 'Campers',
  meals: 'Meals', verses: 'Memory verses', cleanup: 'Cleanup rota', electives: 'Electives',
  alerts: 'Phone alerts', notice: 'Notice board', restore: 'Restore points',
};
// What a section says while its own screen is still to come (Steps 15, 19, 25): the app still shows the
// copy that came with it, and the row says so in plain words instead of pretending to be editable.
const HUB_ORIGINAL = {
  schedule: 'The original schedule', meals: 'The original menu', verses: 'The original verses',
  cleanup: 'The original rota', electives: 'The original stations',
};
// Optional sections can be "not used this year" (setup/meta/skip/<section>): a dash, never a warning.
const HUB_OPTIONAL = ['campers', 'meals', 'verses', 'cleanup', 'electives'];
const HUB_PENDING_NAG_MS = 7 * 24 * 3600 * 1000; // a person with no sign-in is a warning for a week, then just a note
const HUB_SOON_WORD = 'Editing comes next';
// Which rows open something today. A row whose screen comes later is a plain <div> in the markup and
// is not listed: the step that builds its screen turns the div into a button and adds its line here
// (Step 15: Camp week and Schedule; Step 19: Meals, Memory verses, Cleanup rota, Electives).
const HUB_OPENS = {
  week: { screen: 'week' },
  schedule: { screen: 'schedule' },
  meals: { screen: 'meals' },
  verses: { screen: 'verses' },
  cleanup: { screen: 'cleanup' },
  electives: { screen: 'electives' },
  games: { screen: 'classic', tab: 'games' },
  teams: { screen: 'classic', tab: 'teams' },
  notice: { screen: 'classic', tab: 'notice' },
  people: { drawer: 'members' },
  restore: { screen: 'backups' },
};
// The front door's buttons, owner only (Q8). A button exists only when its action does: the steps that
// build Edit the week here (15) and the new-year wizard (28) put a function here. Until then the door
// just says what is true and nobody is offered a button that can only fail.
const HUB_DOOR_ACTIONS = { original: null, 'new-year': null, sections: null };
const HUB_SECTIONS = ['meals', 'verses', 'cleanup', 'electives'];     // the four smaller sections, each with its own switch (step 19)
const HUB_SECTION_NOUNS = { meals: 'the menus', verses: 'the memory verses', cleanup: 'the cleanup rota', electives: 'the electives' };

function hubPlural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function hubJoin(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

function hubCap(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "12 min ago", "3 h ago", "2 days ago".
function hubAgo(at, now) {
  const ms = Number(now) - Number(at);
  if (!(Number(at) > 0) || !(ms > 60000)) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return hubPlural(Math.floor(h / 24), 'day', 'days') + ' ago';
}

// "Sun Jul 18 – Sat Jul 24" from a Sunday's YYYY-MM-DD ('' for anything that isn't a date).
function hubWeekRange(ymd) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(start);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
  const f = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
  return f(start) + ' – ' + f(start + 6 * 86400000);
}

function hubMark(mark, summary, problems, word) {
  const n = problems.length;
  const words = { ok: 'Ready', warn: n + ' to check', todo: 'Not started', skip: 'Not used', soon: HUB_SOON_WORD, info: '' };
  return { mark, word: word !== undefined ? word : words[mark] || '', summary, problems };
}

// Appendix B: the status of ONE section, from a plain `view` (hubView() builds it from the page; tests hand
// one in). Pure: reads nothing else. Returns { mark: ok | warn | todo | skip | soon | info, word, summary,
// problems: [plain sentences] }. `soon` is this step's own: the section's screen is still to come, so
// nothing is claimed about it beyond what the app shows today. Marks, words and sentences follow Appendix B
// and C (verbs, sentence case, "Saturday is empty", never "Incomplete").
function hubStatus(section, view) {
  const v = view || {};
  const skip = HUB_OPTIONAL.indexOf(section) !== -1 && !!(v.skip && v.skip[section] === true);
  if (skip) return hubMark('skip', 'Not used this year', []);
  const owner = v.ownerName || 'the owner';
  switch (section) {
    case 'week': {
      // Dates are the camp week's own setting and always editable; a camp that never set them is not "not ready"
      // (the 2026 week has none), so no dates is a plain line, never a warning.
      const range = hubWeekRange(v.weekStart);
      return range ? hubMark('ok', range, []) : hubMark('info', 'No dates set yet', [], '');
    }
    case 'schedule': {
      if (v.setupTooNew) return hubMark('warn', 'Made with a newer version', ['Reload to see the schedule that was made with a newer version']);
      // Turned off again with the edits kept (Use the original week again): said plainly, so nobody wonders where they went.
      if (!(v.on && v.on.schedule)) return hubMark('info', v.held && v.held.schedule ? 'Showing the original — your edits are kept' : HUB_ORIGINAL.schedule, [], '');
      const sc = v.schedule || {};
      const problems = [];
      if (sc.typicalEmpty) problems.push('The typical day is empty');
      (sc.empty || []).forEach((d) => problems.push(d + ' is empty'));
      (sc.broken || []).forEach((b) => problems.push(hubPlural(b.n, 'broken item', 'broken items') + ' on ' + b.day));
      (sc.overlaps || []).forEach((o) => problems.push(hubPlural(o.n, 'item overlaps', 'items overlap') + ' on ' + o.day + ' at ' + o.at));
      (sc.unmarkedMeals || []).forEach((m) => problems.push(m.names.length === 1 ? m.names[0] + ' on ' + m.day + ' isn’t marked as a meal' : hubJoin(m.names) + ' on ' + m.day + ' aren’t marked as meals'));
      const shape = sc.follow ? 'Typical day · ' + sc.follow + (sc.oneOffs ? ' · ' + hubPlural(sc.oneOffs, 'one-off', 'one-offs') : '') : 'Edited here';
      const row = hubMark(problems.length ? 'warn' : 'ok', shape, problems);
      // A day still on the seeded sample schedule (senior's arrival and send-off days) is a quiet note, never a warning (Q11).
      if (sc.sample && sc.sample.length) row.note = hubJoin(sc.sample) + (sc.sample.length === 1 ? ' still uses' : ' still use') + ' the sample schedule';
      return row;
    }
    case 'campers':
      return hubMark('soon', 'Camper lists come later', []);
    case 'meals': case 'verses': case 'cleanup': case 'electives':
      return hubSectionStatus(section, v);
    case 'alerts':
      return hubMark('soon', 'Reminders follow the original schedule', []);
    case 'games': {
      const problems = [];
      const days = Array.isArray(v.days) ? v.days : [];
      const games = Array.isArray(v.games) ? v.games : [];
      const dayIds = {};
      days.forEach((d) => { if (d) dayIds[d.id] = true; });
      const lost = games.filter((g) => !dayIds[g.dayId]);
      if (lost.length) problems.push(lost.length === 1 ? (lost[0].name || 'A game') + ' isn’t on a day' : lost.length + ' games aren’t on a day');
      const empty = days.filter((d) => d && !games.some((g) => g.dayId === d.id)).map((d) => d.name || 'A day');
      if (empty.length) problems.push(empty.length > 2 ? empty.length + ' days have no games' : hubJoin(empty) + (empty.length === 1 ? ' has' : ' have') + ' no games');
      // With the schedule edited here a game must sit on one of its items, or no counselor sees it in the schedule.
      const loose = Array.isArray(v.unscheduled) ? v.unscheduled : [];
      if (loose.length) problems.push(loose.length === 1 ? loose[0] + ' isn’t on the schedule' : loose.length + ' games aren’t on the schedule');
      const tc = Number(v.teamCount) || 0;
      if (tc !== 4 && tc !== 6) {
        const bad = games.filter((g) => g && g.format === 'tournament').map((g) => g.name || 'A tournament');
        if (bad.length) {
          const shown = bad.slice(0, 2);
          const who = bad.length > 2 ? shown.join(', ') + ' and ' + (bad.length - 2) + ' more' : hubJoin(shown);
          problems.push(who + (bad.length === 1 ? ' is a tournament' : ' are tournaments') + ', but there is no bracket for ' + tc + ' teams');
        }
      }
      const tba = games.filter((g) => g && String(g.location || '').trim().toLowerCase() === 'tba').length;
      if (tba) problems.push(tba === 1 ? '1 game still says TBA for where' : tba + ' games still say TBA for where');
      const summary = games.length ? hubPlural(games.length, 'game', 'games') + ' · ' + hubPlural(days.length, 'day', 'days') : 'No games yet';
      return hubMark(problems.length ? 'warn' : games.length ? 'ok' : 'todo', summary, problems);
    }
    case 'teams': {
      const problems = [];
      const teams = Array.isArray(v.teams) ? v.teams : [];
      const ids = teams.map((t) => t && t.id);
      const badIds = ids.some((id) => !(typeof id === 'string' && /^t\d+$/.test(id))) || new Set(ids).size !== ids.length;
      if (teams.length !== Number(v.teamCount) || badIds) {
        problems.push(v.isOwner ? 'The team slots need repair' : 'Ask ' + owner + ' to repair team slots');
      }
      teams.forEach((t, i) => { if (t && !String(t.name || '').trim()) problems.push('Team ' + (i + 1) + ' has no name'); });
      return hubMark(problems.length ? 'warn' : 'ok', hubPlural(teams.length, 'team', 'teams'), problems);
    }
    case 'people': {
      if (!v.membersLoaded) return hubMark('info', 'Loading the list…', [], '');
      const problems = [];
      const members = Array.isArray(v.members) ? v.members : [];
      const now = Number(v.now) || 0;
      members.filter((m) => !m.owner).forEach((m) => {
        if ((m.role !== 'viewer' && m.role !== 'editor') || !m.addedBy || !m.addedAt) problems.push((m.name || 'Someone') + '’s sign-in record is incomplete');
      });
      const teams = Array.isArray(v.teams) ? v.teams : [];
      teams.forEach((t) => {
        if (t && !members.some((m) => m.teamId === t.id)) problems.push((String(t.name || '').trim() || 'A team') + ' has no counselors yet');
      });
      const pending = members.filter((m) => m.pending);
      const fresh = pending.filter((m) => !(Number(m.addedAt) > 0) || !now || now - Number(m.addedAt) < HUB_PENDING_NAG_MS);
      if (fresh.length) problems.push(fresh.length === 1 ? '1 person has no sign-in yet' : fresh.length + ' people have no sign-in yet');
      const directors = members.filter((m) => m.role === 'editor').length;
      const counselors = members.length - directors;
      const summary = hubPlural(counselors, 'counselor', 'counselors') + ' · ' + hubPlural(directors, 'director', 'directors');
      return hubMark(problems.length ? 'warn' : members.length ? 'ok' : 'todo', summary, problems);
    }
    case 'notice': {
      const n = v.notice || {};
      if (n.status === 'posted') return hubMark('info', 'On every phone', [], 'Posted');
      return hubMark('info', n.has ? 'Not on anyone’s phone yet' : 'Nothing written yet', [], 'Draft');
    }
    case 'restore': {
      const r = v.restore || {};
      if (r.status === 'denied') return hubMark('warn', 'Not available yet', ['Restore points can’t be saved yet — the database rules need updating']);
      if (r.status !== 'ok') return hubMark('info', r.status === 'offline' ? 'Needs a connection' : r.status === 'nosync' ? 'Needs the camp database' : 'Checking…', [], '');
      return hubMark('info', r.count ? 'Last saved ' + hubAgo(r.newestAt, v.now) : 'None saved yet', [], '');
    }
    default:
      return hubMark('info', '', [], '');
  }
}

// Meals, Memory verses, Cleanup rota and Electives (Appendix B; step 19), from the plain `v.sec[section]` hubView builds:
//   meals      { listed: dishes in all, days: 'Mon–Fri', missing: [{ day, meal }] }
//   verses     { theme: bool, days: n, missing: ['Wednesday'] }
//   cleanup    { any: bool, empty: [{ day, meal }], unknown: [ids], line: 'Each team cleans 2–3 times.' }
//   electives  { stations: n, slots: n, noStations: [{ day, slot }], nobody: [{ name, day }], twice: [{ name, day, slot }], near: [{ name, member }] }
// Not edited here: the section is the original and the row says so (nothing is judged); its screen is a read-only preview.
function hubSectionStatus(section, v) {
  if (!(v.on && v.on[section])) return hubMark('info', v.held && v.held[section] ? 'Showing the original — your edits are kept' : HUB_ORIGINAL[section], [], '');
  const s = (v.sec && v.sec[section]) || {};
  const problems = [];
  if (section === 'meals') {
    if (!s.listed) return hubMark('todo', 'No dishes yet', []);
    const miss = s.missing || [];
    if (miss.length) problems.push(miss.length === 1 ? miss[0].day + '’s ' + miss[0].meal + ' has no dish' : hubPlural(miss.length, 'meal has', 'meals have') + ' no dish');
    return hubMark(problems.length ? 'warn' : 'ok', s.days || 'Mon–Fri', problems);
  }
  if (section === 'verses') {
    if (!s.theme && !s.days) return hubMark('todo', 'No verses yet', []);
    if (!s.theme) problems.push('There is no theme verse yet');
    const miss = s.missing || [];
    if (miss.length) problems.push(miss.length <= 2 ? hubJoin(miss) + (miss.length === 1 ? ' has' : ' have') + ' no verse' : miss.length + ' days have no verse');
    return hubMark(problems.length ? 'warn' : 'ok', (s.theme ? 'Theme + ' : '') + hubPlural(s.days || 0, 'day', 'days'), problems);
  }
  if (section === 'cleanup') {
    if (!s.any) return hubMark('todo', 'Nobody on the rota yet', []);
    const empty = s.empty || [];
    if (empty.length) problems.push(empty.length === 1 ? empty[0].day + '’s ' + empty[0].meal + ' has no team' : hubPlural(empty.length, 'meal has', 'meals have') + ' no team');
    if ((s.unknown || []).length) problems.push('A team that isn’t on this camp is on the rota');
    return hubMark(problems.length ? 'warn' : 'ok', String(s.line || 'Everyone is on the rota').replace(/\.$/, ''), problems);
  }
  // electives
  if (!s.stations) return hubMark('todo', 'No stations yet', []);
  const none = s.noStations || [];
  if (none.length) problems.push(none.length === 1 ? none[0].day + '’s Elective ' + (none[0].slot + 1) + ' has no stations' : hubPlural(none.length, 'elective has', 'electives have') + ' no stations');
  const nobody = s.nobody || [];
  if (nobody.length) problems.push(nobody.length === 1 ? nobody[0].name + ' has nobody on ' + nobody[0].day : hubPlural(nobody.length, 'station has', 'stations have') + ' nobody');
  const twice = s.twice || [];
  if (twice.length) problems.push(twice.length === 1 ? twice[0].name + ' is at two stations in ' + twice[0].day + '’s Elective ' + (twice[0].slot + 1) : hubPlural(twice.length, 'person is', 'people are') + ' at two stations at once');
  const near = s.near || [];
  if (near.length) problems.push(near.length === 1 ? near[0].name + ' looks like ' + near[0].member + ' on your list' : hubPlural(near.length, 'name', 'names') + ' look like people on your list');
  return hubMark(problems.length ? 'warn' : 'ok', hubPlural(s.slots || 0, 'slot', 'slots') + ' · ' + hubPlural(s.stations, 'station', 'stations'), problems);
}

// The paragraph above the list (§11.2, one front door at a time), in the spec's order:
//   1. camp week is running  2. the new year is due  3. nothing is edited here yet
// `ownerButton` is the owner's gold button label ('' when there is no action behind it yet) and `ownerText`
// the sentence every other director reads in its place (§11.2, Q8). With no action behind a door, nobody is
// told "Patrick turns on editing": the text just says it comes next.
function hubDoor(view) {
  const v = view || {};
  const name = hubCap(v.ownerName || 'the owner');
  const actions = v.doorActions || {};
  if (v.weekRunning) {
    return { door: 'running', lead: 'Camp week in progress — the new-year setup is locked.', text: v.on && v.on.schedule ? 'Rain plans and small edits are fine.' : '', ownerButton: '', ownerText: '' };
  }
  if (v.newYearDue) {
    return {
      door: 'new-year', lead: 'Getting ready for ' + (v.nextYear || 'the new year') + '?', text: '',
      ownerButton: actions['new-year'] ? 'Start the new-year setup' : '',
      ownerText: actions['new-year'] ? name + ' starts the new-year setup.' : '',
    };
  }
  const anyOn = ['schedule', 'meals', 'verses', 'cleanup', 'electives'].some((s) => v.on && v.on[s]);
  if (!anyOn && v.held && v.held.schedule) {
    const act = !!actions.original;
    return {
      door: 'original', lead: 'This camp is showing the original week.',
      text: 'Your changes to the schedule are kept. Turning on editing brings them back.',
      ownerButton: act ? 'Edit the week here' : '',
      ownerText: act ? name + ' can switch it back on.' : '',
    };
  }
  if (!anyOn) {
    const act = !!actions.original;
    return {
      door: 'original', lead: 'This camp is still using the original week.',
      text: act
        ? 'The schedule, menus and verses are the copy that came with the app. Turning on editing changes nothing anyone can see until someone edits something.'
        : 'The schedule, menus and verses are the copy that came with the app. Editing them here comes in the next update; nothing changes for anyone until then.',
      ownerButton: act ? 'Edit the week here' : '',
      ownerText: act ? name + ' turns on editing.' : '',
    };
  }
  // A camp already editing its schedule here: the menus, verses, cleanup rota and electives can be edited here too
  // (step 19). One question for the owner, one sentence for everyone else; it goes when the last one is on.
  const off = HUB_SECTIONS.filter((s) => (s !== 'electives' || v.electives) && !(v.on && v.on[s]));
  if (v.on && v.on.schedule && off.length) {
    const act = !!actions.sections;
    const held = off.some((s) => v.held && v.held[s]);
    return {
      door: 'sections', lead: hubCap(hubJoin(off.map((s) => HUB_SECTION_NOUNS[s]))) + ' can now be edited here too.',
      text: held ? 'Your changes are kept. Turning it on brings them back.' : 'Turning it on changes nothing anyone can see until someone edits something.',
      ownerButton: act ? 'Turn on' : '',
      ownerText: act ? name + ' turns it on.' : '',
    };
  }
  return null;
}

// Everything the hub shows, as data: one status per row, "7 of 10 ready", what is next, the front door.
// Only ok / warn / todo rows count toward the total: `soon` (nothing is known about it yet), `skip` (set
// aside on purpose) and `info` (still loading) are left out.
function hubModel(view) {
  const v = view || {};
  const rows = {};
  HUB_ROW_KEYS.forEach((k) => { rows[k] = hubStatus(k, v); });
  const counted = HUB_COUNTED.filter((k) => k !== 'electives' || v.electives);
  // `info` is "still loading" (the people list): not ready, not a problem, so it is not counted either way.
  const assessed = counted.filter((k) => ['ok', 'warn', 'todo'].indexOf(rows[k].mark) !== -1);
  const ready = assessed.filter((k) => rows[k].mark === 'ok');
  const next = assessed.find((k) => rows[k].mark === 'warn') || assessed.find((k) => rows[k].mark === 'todo') || '';
  const waiting = counted.filter((k) => rows[k].mark === 'soon');
  const headline = assessed.length ? ready.length + ' of ' + assessed.length + ' ready' : 'Nothing to check yet';
  let lede = '';
  if (next) lede = 'Next: ' + HUB_LABELS[next];
  else if (waiting.length) lede = 'Everything that can be checked is ready.';
  else lede = 'Everything is ready.';
  return {
    kicker: 'Set up the week' + (v.campLabel ? ' · ' + v.campLabel : ''),
    headline, lede, rows, next, ready: ready.length, total: assessed.length,
    door: hubDoor(v),
  };
}

// ── hubView: what the page knows, as the plain data hubStatus reads ──────────

function hubSetupMeta() {
  return (typeof setupTree !== 'undefined' && setupTree && setupTree.meta) || {};
}

function hubWeekStart() {
  const m = hubSetupMeta();
  if (typeof m.weekStart === 'string' && hubWeekRange(m.weekStart)) return m.weekStart;
  // The one "camp week" the app already has is the push drawer's "Starts on (a Sunday)".
  return typeof pushWeekStart === 'string' && hubWeekRange(pushWeekStart) ? pushWeekStart : '';
}

function hubWeekRunning(weekStart) {
  if (!weekStart || typeof etWallToEpoch !== 'function') return false;
  const start = etWallToEpoch(weekStart, 0);
  if (!Number.isFinite(start)) return false;
  const now = typeof serverNow === 'function' ? serverNow() : Date.now();
  return now >= start && now < start + 7 * 86400000;
}

function hubMembers() {
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  return Object.keys(dir).map((key) => {
    const r = dir[key] || {};
    return {
      key, role: r.role, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : (typeof identityFromKey === 'function' ? identityFromKey(key) : key),
      teamId: r.teamId || '', addedBy: r.addedBy, addedAt: r.addedAt,
      pending: typeof isPendingKey === 'function' && isPendingKey(key), owner: key === OWNER_MEMBER_KEY,
    };
  });
}

function hubView() {
  const meta = hubSetupMeta();
  const on = {};
  ['schedule', 'meals', 'verses', 'cleanup', 'electives'].forEach((s) => { on[s] = typeof setupOn === 'function' && setupOn(s); });
  const notice = typeof noticeBoard === 'function' ? noticeBoard() : null;
  const rest = setupUi.restore;
  const weekStart = hubWeekStart();
  const doorActions = {};
  Object.keys(HUB_DOOR_ACTIONS).forEach((k) => { doorActions[k] = !!HUB_DOOR_ACTIONS[k]; });
  return {
    campLabel: CAMP.label, teamCount: CAMP.teamCount, electives: !!(CAMP.features && CAMP.features.electives),
    isOwner: typeof isOwner === 'function' && isOwner(), ownerName: typeof ownerName === 'function' ? ownerName() : 'the owner',
    now: typeof serverNow === 'function' ? serverNow() : Date.now(),
    teams: state.teams || [], days: (state.config && state.config.days) || [], games: (state.config && state.config.games) || [],
    members: hubMembers(), membersLoaded: !!memberDirectoryLoaded,
    on, skip: meta.skip && typeof meta.skip === 'object' ? meta.skip : {}, weekStart, weekRunning: hubWeekRunning(weekStart),
    newYearDue: typeof newYearDue === 'function' ? !!newYearDue() : false, nextYear: '',
    setupTooNew: typeof setupSchemaTooNew === 'function' && setupSchemaTooNew(),
    notice: { status: notice && notice.status, has: !!(notice && (notice.title || notice.sub || (notice.zones && notice.zones.length) || (notice.steps && notice.steps.length))) },
    restore: { status: rest.status, newestAt: rest.rows.length ? rest.rows[0].at : 0, count: rest.rows.length },
    doorActions,
    held: ['schedule'].concat(HUB_SECTIONS).reduce((o, s) => { o[s] = !!(hubSetupMeta().on && hubSetupMeta().on[s] === false); return o; }, {}),
    unscheduled: hubUnscheduledGames(),
    schedule: hubScheduleView(),
    sec: hubSecView(),
  };
}

// ── what the four smaller sections' rows judge (read from the live tree, only for a section that is on) ──

function hubCompetitionDks() {
  return competitionDows().map((d) => SETUP_DK[d]);
}

// The meals a day has: its Meal-tagged items, once each (a menu is per meal, not per item), in time order — from the plan
// the app shows (the edited schedule, else the printed week resolved the same way).
function secMealItems(dow) {
  const seen = {};
  const out = [];
  planForDow(dow).filter((b) => b.meal && !b.noTime).slice().sort((a, b) => a.start - b.start).forEach((b) => {
    if (seen[b.meal]) return;
    seen[b.meal] = true;
    out.push({ meal: b.meal, name: SETUP_MEAL_NAMES[b.meal] || hubCap(b.meal), start: b.start });
  });
  return out;
}

function hubSecView() {
  const out = {};
  if (typeof setupSectionLive !== 'function') return out;
  const tree = setupTree;
  const comp = hubCompetitionDks();
  if (setupSectionLive('meals')) {
    let listed = 0;
    const missing = [];
    const dishDays = [];
    SETUP_DK.forEach((dk, dow) => {
      const have = SETUP_MEAL_KEYS.filter((m) => setupMealRecord(tree, dk, m));
      listed += have.length;
      if (have.length) dishDays.push(dk);
      // Only a competition day, or a day that lists any dish, is judged: a Saturday breakfast nobody planned is not a problem.
      secMealItems(dow).forEach((it) => { if (!setupMealRecord(tree, dk, it.meal) && (comp.indexOf(dk) !== -1 || have.length)) missing.push({ day: SETUP_DAY_WORDS[dk], meal: it.name.toLowerCase() }); });
    });
    out.meals = { listed, days: dishDays.length ? schedDaysWords(dishDays) : '', missing };
  }
  if (setupSectionLive('verses')) {
    const days = comp.filter((dk) => setupVerseDay(tree, dk));
    out.verses = { theme: !!setupVerseTheme(tree), days: days.length, missing: comp.filter((dk) => !setupVerseDay(tree, dk)).map((dk) => SETUP_DAY_WORDS[dk]) };
  }
  if (setupSectionLive('cleanup')) {
    const slots = secCleanupSlots();
    const unknown = [];
    SETUP_DK.forEach((dk) => SETUP_MEAL_KEYS.forEach((m) => Object.keys(setupMapOf(setupMapOf(setupMapOf(tree.cleanup)[dk])[m])).forEach((id) => { if (/^t[0-9]$/.test(id) && setupTeamSlot(id) >= CAMP.teamCount && unknown.indexOf(id) === -1) unknown.push(id); })));
    out.cleanup = {
      any: SETUP_DK.some((dk) => setupCleanupTracked(tree, dk)),
      empty: slots.filter((s) => !s.have.length).map((s) => ({ day: SETUP_DAY_WORDS[s.day], meal: s.name.toLowerCase() })),
      unknown, line: rotaFairness(slots.map((s) => ({ day: s.day, teams: s.have })), teamIds(), (id) => teamShort(id) || teamName(id), (dk) => SETUP_DAY_WORDS[dk]).line,
    };
  }
  if (setupSectionLive('electives') && setupHasElectives()) {
    const noStations = [];
    const nobody = [];
    const twice = [];
    const typed = [];
    const slotsUsed = [];
    comp.forEach((dk) => {
      planForDow(SETUP_DK.indexOf(dk)).filter((b) => b.type === 'elective' && Number.isInteger(b.slot)).forEach((b) => {
        if (slotsUsed.indexOf(b.slot) === -1) slotsUsed.push(b.slot);
        const rows = setupElectiveRows(tree, dk, b.slot);
        if (!rows.length) { noStations.push({ day: SETUP_DAY_WORDS[dk], slot: b.slot }); return; }
        const seen = {};
        rows.forEach((r) => {
          if (!r.people.length) nobody.push({ name: r.name, day: SETUP_DAY_WORDS[dk] });
          r.people.forEach((p) => {
            const k = p.name.toLowerCase();
            if (seen[k] && seen[k] !== r.id && !twice.some((t) => t.name === p.name && t.day === SETUP_DAY_WORDS[dk] && t.slot === b.slot)) twice.push({ name: p.name, day: SETUP_DAY_WORDS[dk], slot: b.slot });
            seen[k] = r.id;
          });
        });
      });
      for (let slot = 0; slot < 3; slot++) setupElectiveRows(tree, dk, slot).forEach((r) => r.people.forEach((p) => { if (p.typed && !typed.some((t) => t.pid === p.pid)) typed.push({ pid: p.pid, name: p.name }); }));
    });
    const members = hubMembers().filter((m) => !m.pending).map((m) => ({ key: m.key, name: m.name }));
    const near = [];
    typed.forEach((t) => { const hit = setupNearMember(t.name, members); if (hit) near.push({ name: t.name, member: String(hit.name).trim().split(/\s+/)[0] }); });
    out.electives = { stations: setupElectiveStations(tree).length, slots: slotsUsed.length || 3, noStations, nobody, twice, near };
  }
  return out;
}

// The cleanup rota as slots: every Meal-tagged item of a competition day, with the teams on it now.
// [{ day: 'mon', meal: 'lunch', name: 'Lunch', start, have: ['t4'] }]
function secCleanupSlots(tree) {
  const t = tree || setupTree;
  const out = [];
  hubCompetitionDks().forEach((dk) => secMealItems(SETUP_DK.indexOf(dk)).forEach((it) => out.push({ day: dk, meal: it.meal, name: it.name, start: it.start, have: setupCleanupIds(t, dk, it.meal) })));
  return out;
}

// What the Schedule row needs to judge the edited week (null while the schedule is the built-in copy): the days that
// follow the typical day, one-offs, empty days, broken items and unmarked overlaps, each as the sentence's parts.
// The names of the games on a competition day that sit on no schedule item, once the schedule is edited here ([]
// while it is the built-in copy: there the Morning / Evening rule decides, and senior's Afternoon games are known).
function hubUnscheduledGames() {
  if (typeof scheduleIsShared !== 'function' || !scheduleIsShared() || typeof unscheduledGames !== 'function') return [];
  const dows = [];
  competitionDays().forEach((d) => { if (Number.isInteger(d.dow) && dows.indexOf(d.dow) === -1) dows.push(d.dow); });
  const names = [];
  dows.forEach((dow) => unscheduledGames(dow).forEach((g) => names.push(String(g.name || '').trim() || 'A game')));
  return names;
}

// Is this weekday's plan still the seeded one (same items at the same times)? Placeholder days stay flagged in the tree
// for good, so the quiet "sample schedule" note asks the plan, not the flag, whether anyone has replaced it.
function hubStillSample(dow) {
  const built = typeof setupBuiltInPlans === 'function' ? setupBuiltInPlans().rich[dow] || [] : [];
  const now = planForDow(dow);
  return now.length === built.length && now.every((b, i) => b.label === built[i].label && b.start === built[i].start && b.end === built[i].end);
}

function hubScheduleView() {
  if (typeof scheduleIsShared !== 'function' || !scheduleIsShared() || typeof planForDow !== 'function') return null;
  const tree = setupTree;
  const out = { typicalEmpty: false, follow: '', oneOffs: 0, empty: [], broken: [], overlaps: [], unmarkedMeals: [], sample: [] };
  const followDks = SETUP_DK.filter((dk) => setupMapOf(setupMapOf(tree.days)[dk]).typical === true);
  out.typicalEmpty = followDks.length > 0 && !Object.keys(setupMapOf(tree.typical)).length;
  out.follow = followDks.length ? schedDaysWords(followDks) : '';
  for (let dow = 0; dow < 7; dow++) {
    const dk = SETUP_DK[dow];
    const day = setupMapOf(setupMapOf(tree.days)[dk]);
    const plan = planForDow(dow);
    out.oneOffs += plan.filter((b) => b.origin === 'oneoff').length;
    if (!plan.length && !(day.typical === true && out.typicalEmpty) && day.placeholder !== true) out.empty.push(SETUP_DAY_WORDS[dk]);
    if (plan.broken && plan.broken.length) out.broken.push({ day: SETUP_DAY_WORDS[dk], n: plan.broken.length });
    const timed = plan.filter((b) => !b.noTime && !b.overlapOk);
    let n = 0;
    let first = 0;
    timed.forEach((a, i) => timed.slice(i + 1).forEach((b) => { if (b.start < a.end && a.start < b.end) { if (!n) first = Math.max(a.start, b.start); n++; } }));
    if (n) out.overlaps.push({ day: SETUP_DAY_WORDS[dk], n, at: setupClock(first) });
    // A Breakfast / Lunch / Supper item without the Meal tag gets no menu and no cleanup line.
    const loose = [];
    plan.forEach((b) => {
      const head = setupHeadLabel(b.label);
      if (!b.meal && /^(breakfast|lunch|supper)$/i.test(head) && loose.indexOf(head) === -1) loose.push(head);
    });
    if (loose.length) out.unmarkedMeals.push({ day: SETUP_DAY_WORDS[dk], names: loose });
    if (day.placeholder === true && plan.length && hubStillSample(dow)) out.sample.push(SETUP_DAY_WORDS[dk]);
  }
  return out;
}

// ── 2. The frame: screens, navigation, the head ──────────────────────

// #setup[data-screen] is the ONE switch the CSS reads (styles.css "SET UP THE WEEK"): hub | backups |
// classic | week | schedule | rain. A step that adds a screen adds its name here and its pair of lines in the CSS.
const SETUP_SCREENS = ['hub', 'backups', 'classic', 'week', 'schedule', 'rain', 'meals', 'verses', 'cleanup', 'electives'];
// Shell sheets this layer owns (shellSheetOpen ids; the elements are #sheet-<id>), one at a time.
const SETUP_SHEETS = ['setup-menu', 'setup-changes', 'setup-devices', 'restore', 'sched-day', 'sched-item', 'rain-item', 'rain-done', 'sec-teams', 'sec-person', 'sec-station'];
// The classic builder's tabs, in editorsHere's short vocabulary (setup-sync.js editorsHereWhereWords).
const SETUP_CLASSIC_WHERE = { games: 'games', days: 'week', teams: 'teams', notice: 'notice', data: 'restore' };
// The owner's menu rows (⋯ → Owner). A row is listed only when its action exists (Step 15: original,
// advanced; Step 28: new-year, undo-new-year), so the menu never offers a switch that can only fail.
// { run(), why() } — why() returns a reason to show in place of the row's subline and grey it out
// ("Not during camp week"), or ''.
const SETUP_OWNER_ACTIONS = {};

const setupUi = {
  wired: false,
  wasOpen: false,
  where: '',             // what this device last told editorsHere
  detailsOpen: false,    // the sync line's Details: the Retry / Discard / Download bar
  alertShown: false,     // updateSyncAlert says the bar has something to show
  restore: { status: 'idle', rows: [], at: 0, loading: false },
  rows: null,            // the hub's row elements, found once
  pill: null,            // see section 5
};

function setupEl(id) {
  return document.getElementById(id);
}

function setupScreen() {
  const s = state.ui && state.ui.builderScreen;
  // The rain plan is the edited schedule's: a reload after Use the original week again lands on the Schedule preview.
  if (s === 'rain' && !(typeof scheduleIsShared === 'function' && scheduleIsShared())) return 'schedule';
  // A camp with no electives (senior) has no such screen: a stale stored one reads as the hub.
  if (s === 'electives' && !(typeof setupHasElectives === 'function' && setupHasElectives())) return 'hub';
  return SETUP_SCREENS.indexOf(s) !== -1 ? s : 'hub';
}

// app.js openBuilder(tab) calls this before it paints: More → Set up the week (no tab) opens the hub; a
// caller that names a classic tab ("Add games" on an empty day) lands on that tab of the classic screen.
function setupOnOpen(tab) {
  state.ui.builderScreen = tab ? 'classic' : 'hub';
}

// What this device should tell the other directors it is looking at.
function setupWhereNow() {
  const s = setupScreen();
  if (s === 'hub') return 'hub';
  if (s === 'backups') return 'restore';
  if (s === 'week') return 'week';
  if (s === 'schedule') return 'schedule:' + (state.ui.setupDay || 'typical');
  if (s === 'rain') return 'rain:' + ((state.ui.rainDay && SETUP_DK.indexOf(state.ui.rainDay) !== -1) ? state.ui.rainDay : 'wed');
  if (HUB_SECTIONS.indexOf(s) !== -1) return s;
  return SETUP_CLASSIC_WHERE[state.ui.settingsTab] || 'games';
}

function setupMoveHere() {
  const w = setupWhereNow();
  if (w === setupUi.where) return;
  setupUi.where = w;
  if (typeof editorsHereMove === 'function') editorsHereMove(w);
}

// Go to a screen of the frame (opts.tab: the classic builder's tab). Back always returns to the hub.
function setupGo(screen, opts) {
  if (SETUP_SCREENS.indexOf(screen) === -1 || !canEdit()) return false;
  const o = opts || {};
  if (o.tab) state.ui.settingsTab = o.tab;
  state.ui.builderScreen = screen;
  setupUi.detailsOpen = false;
  shellStamp();
  saveState();
  renderAll();
  if (typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0); } catch (e) { /* no scroll */ } }
  // The tapped row is gone from the screen: focus lands on Back, which names where you are.
  setupFocusBack();
  return true;
}

function setupCloseBuilder() {
  if (typeof discardGameDraft === 'function') discardGameDraft();
  state.ui.view = 'home';
  saveState();
  renderAll(); // the shell puts the tab it came from back where it was scrolled
}

// Leaving with a game editor open and edited asks first (the classic builder's own guard, in the dialog
// instead of a native confirm). "Keep editing" puts the person back on the editor.
async function setupConfirmLeave() {
  if (typeof builderDirty !== 'function' || !builderDirty()) return true;
  const what = typeof builderDirtyName === 'function' ? builderDirtyName() : 'this game';
  const choice = await askDialog({
    title: 'Discard your changes to ' + what + '?',
    body: 'They haven’t been saved yet.',
    actions: [{ label: 'Keep editing', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }],
  });
  if (choice === 'discard') return true;
  if (state.ui.builderScreen !== 'classic' || state.ui.settingsTab !== 'games') setupGo('classic', { tab: 'games' });
  return false;
}

async function setupBack() {
  const screen = setupScreen();
  if (!(await setupConfirmLeave())) return;
  if (screen === 'rain') {
    if (!(await rainLeave())) return;
    if (rainBackHome()) return;
    state.ui.setupDay = rainDk();
    setupGo('schedule');
    return;
  }
  if (screen === 'hub') setupCloseBuilder();
  else {
    if (typeof discardGameDraft === 'function') discardGameDraft();
    setupGo('hub');
  }
}

// The one sentence the sync line says, from the engines' own accounts. The setup engine speaks first
// (its refusals and "rules not published" are the ones nothing else would tell); then a refused score,
// then anything still unconfirmed. With no setup engine the same words come from the basics.
function setupUiSyncLine() {
  const base = typeof setupSyncLine === 'function' ? setupSyncLine() : null;
  if (base && (base.tone === 'error' || base.tone === 'off')) return base;
  const parked = typeof stateQuarantine === 'object' && stateQuarantine ? Object.keys(stateQuarantine).length : 0;
  if (parked) return { tone: 'error', text: 'Couldn’t save ' + (parked === 1 ? '1 change' : parked + ' changes'), act: 'details' };
  if (base) {
    if (base.tone === 'saved' && typeof pendingWritesTotal === 'function' && pendingWritesTotal() > 0) return { tone: 'saving', text: 'Saving…', act: '' };
    return base;
  }
  const configured = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) && !sdkLoadFailed;
  if (!configured) return { tone: 'off', text: 'This device only — changes aren’t shared', act: '' };
  if (fbConnKnown && !fbConnected) return { tone: 'offline', text: 'Offline — changes will save when you’re back', act: '' };
  if (typeof pendingWritesTotal === 'function' && pendingWritesTotal() > 0) return { tone: 'saving', text: 'Saving…', act: '' };
  return { tone: 'saved', text: 'Saved', act: '' };
}

function paintSetupSync() {
  const line = setupUiSyncLine();
  const el = setupEl('setup-sync');
  if (el && el.dataset.tone !== line.tone) el.dataset.tone = line.tone;
  setTextIfChanged(setupEl('setup-sync-text'), line.text);
  setHiddenIfChanged(setupEl('setup-sync-act'), line.act !== 'details');
}

// app.js updateSyncAlert hands its bar here (the header steps aside for the builder). A refused save stays
// one calm red line until Details is tapped; a view-only or set-aside notice (`calm`) shows at once.
function setupUiSyncAlert(show, html, calm) {
  const el = setupEl('setup-sync-alert');
  if (!el) return;
  setupUi.alertShown = !!show;
  if (!show) setupUi.detailsOpen = false;
  if (show) setHtmlIfChanged(el, html);
  el.classList.toggle('sync-alert-tab', !!calm);
  setHiddenIfChanged(el, !(show && (setupUi.detailsOpen || calm)));
}

function setupToggleDetails() {
  setupUi.detailsOpen = !setupUi.detailsOpen;
  const el = setupEl('setup-sync-alert');
  setHiddenIfChanged(el, !(setupUi.alertShown && setupUi.detailsOpen));
}

// Up to three initials and one sentence; on a screen another director is also on, the sentence names it
// ("Jenn is also editing the games — changes merge field by field").
function paintSetupHere() {
  const btn = setupEl('setup-here');
  if (!btn) return;
  const h = typeof editorsHereHeader === 'function' && canEdit() ? editorsHereHeader() : { count: 0, faces: [], text: '' };
  setHiddenIfChanged(btn, !h.count);
  if (!h.count) return;
  setHtmlIfChanged(setupEl('setup-here-faces'), h.faces.map((f) => '<i class="setup-face">' + esc(f) + '</i>').join(''));
  // On a screen another director is ALSO editing the line says so, short ("Sam is also editing the games"); the
  // "changes merge field by field" half is in the tap-through. The hub itself is nothing anyone edits.
  const same = setupScreen() !== 'hub' && typeof editorsHereOn === 'function' ? editorsHereOn(setupUi.where).split(' — ')[0] : '';
  setTextIfChanged(setupEl('setup-here-text'), same || h.text);
}

// "Jenn · Tuesday's schedule · 2 min ago", one line each.
async function setupShowWhoIsHere() {
  const h = typeof editorsHereHeader === 'function' ? editorsHereHeader() : { rows: [] };
  if (!h.rows.length) return;
  const same = typeof editorsHereOn === 'function' && setupScreen() !== 'hub' ? editorsHereOn(setupUi.where) : '';
  await askDialog({
    title: 'Also here', body: same ? same + '.' : '', list: h.rows.map((r) => r.text),
    actions: [{ label: 'Close', value: 'close', cancel: true }],
  });
}

// ── 3. The hub's painting ────────────────────────────────────────────

// Where another director is → which hub row carries their initial (editorsHere's `where` vocabulary).
function setupHereRow(where) {
  const head = String(where || '').split(':')[0];
  if (head === 'item' || head === 'rain') return 'schedule';
  if (head === 'game') return 'games';
  if (head === 'team') return 'teams';
  return HUB_ROW_KEYS.indexOf(head) !== -1 ? head : '';
}

function setupFaceOf(name) {
  return name === 'You (another device)' ? 'Y' : name === 'Another director' ? 'D' : String(name || '?').charAt(0).toUpperCase();
}

function hubRowEls() {
  if (setupUi.rows) return setupUi.rows;
  const rows = {};
  HUB_ROW_KEYS.forEach((k) => {
    const row = document.querySelector('[data-hub-row="' + k + '"]');
    if (!row) return;
    rows[k] = {
      row, sum: row.querySelector('[data-hub-summary]'), prob: row.querySelector('[data-hub-problem]'),
      here: row.querySelector('[data-hub-here]'), mark: row.querySelector('[data-hub-mark]'), word: row.querySelector('[data-hub-word]'),
    };
  });
  // Only a real page caches them: the elements are static markup that nothing rebuilds.
  if (Object.keys(rows).length === HUB_ROW_KEYS.length) setupUi.rows = rows;
  return rows;
}

function paintHub() {
  const view = hubView();
  const model = hubModel(view);
  setTextIfChanged(setupEl('hub-title'), model.kicker);
  setTextIfChanged(setupEl('hub-headline'), model.headline);
  setTextIfChanged(setupEl('hub-lede'), model.lede);
  // "Next: People" is the line to act on: when its row opens something it is a target (#hub-next) in
  // place of the plain lede, and opens that row.
  const nextKey = model.next && HUB_OPENS[model.next] ? model.next : '';
  setHiddenIfChanged(setupEl('hub-lede'), !!nextKey);
  setTextIfChanged(setupEl('hub-next-text'), nextKey ? model.lede : '');
  const nextBtn = setupEl('hub-next');
  if (nextBtn && nextBtn.dataset && nextBtn.dataset.hubOpen !== nextKey) nextBtn.dataset.hubOpen = nextKey;
  setHiddenIfChanged(nextBtn, !nextKey);
  // Why only some rows count toward "N of M ready": said once, beside the group's name.
  const waiting = HUB_COUNTED.filter((k) => (k !== 'electives' || view.electives) && model.rows[k].mark === 'soon').length;
  setTextIfChanged(setupEl('hub-week-note'), waiting ? waiting + ' can’t be changed here yet' : '');
  const hereBy = {};
  if (typeof editorsHereList === 'function') {
    editorsHereList().forEach((r) => { const k = setupHereRow(r.where); if (k && !hereBy[k]) hereBy[k] = setupFaceOf(r.name); });
  }
  const els = hubRowEls();
  HUB_ROW_KEYS.forEach((k) => {
    const e = els[k];
    if (!e) return;
    const st = model.rows[k];
    if (k === 'electives') setHiddenIfChanged(e.row, !view.electives);
    setTextIfChanged(e.sum, st.summary);
    const prob = st.problems[0] || st.note || '';
    setTextIfChanged(e.prob, prob);
    setHiddenIfChanged(e.prob, !prob);
    if (e.mark) {
      if (e.mark.dataset.mark !== st.mark) e.mark.dataset.mark = st.mark;
      setTextIfChanged(e.word, st.word);
      setHiddenIfChanged(e.mark, !st.word && st.mark === 'info');
    }
    if (e.here) {
      setTextIfChanged(e.here, hereBy[k] || '');
      setHiddenIfChanged(e.here, !hereBy[k]);
    }
  });
  paintHubDoor(model.door);
}

function paintHubDoor(door) {
  const el = setupEl('hub-door');
  if (!el) return;
  setHiddenIfChanged(el, !door);
  if (!door) return;
  if (el.dataset.door !== door.door) el.dataset.door = door.door;
  // Nothing behind the original-week door yet: its lead alone, as one plain line (data-quiet). The
  // paragraph about what comes in which update repeated what the rows already show.
  const quiet = door.door === 'original' && !door.ownerButton;
  if (quiet !== el.hasAttribute('data-quiet')) { if (quiet) el.setAttribute('data-quiet', ''); else el.removeAttribute('data-quiet'); }
  setTextIfChanged(setupEl('hub-door-lead'), door.lead);
  setTextIfChanged(setupEl('hub-door-text'), door.text);
  // Owner gating (Q8): the button is the owner's and only exists with its action; everyone else reads the
  // same sentence with the owner's name. `body.setup-owner` (applyOwnerClass) is the CSS half of the same rule.
  const owner = typeof isOwner === 'function' && isOwner();
  const btn = setupEl('hub-door-btn');
  setTextIfChanged(btn, door.ownerButton);
  setHiddenIfChanged(btn, !(owner && door.ownerButton));
  setTextIfChanged(setupEl('hub-door-owner-text'), door.ownerText);
  setHiddenIfChanged(setupEl('hub-door-owner'), owner || !door.ownerText);
}

// A tap on a hub row that opens something.
function hubOpen(key) {
  const o = HUB_OPENS[key];
  if (!o) return;
  if (o.drawer === 'members') { if (typeof openMembers === 'function') openMembers(); return; }
  if (o.screen === 'backups') { setupGo('backups'); refreshRestoreIndex(); return; }
  setupGo(o.screen, { tab: o.tab });
}

// The frame's one paint, called from renderAll with whether the builder is up. Idempotent: every write
// below is a patch of static markup that changes only when its value does.
function renderSetupUi(open) {
  const root = setupEl('setup');
  if (!root || !root.querySelector) { // a page without the frame's markup: the v197 builder as it was
    if (open && typeof renderSettings === 'function') renderSettings();
    return;
  }
  if (!open) {
    if (setupUi.wasOpen) setupUiClosed();
    return;
  }
  const justOpened = !setupUi.wasOpen;
  if (justOpened) setupUiOpened();
  const screen = setupScreen();
  if (root.dataset.screen !== screen) root.dataset.screen = screen;
  if (typeof applyOwnerClass === 'function') applyOwnerClass();
  // Back from the hub returns to the tab the builder was opened FROM (More, or Games from an empty day's
  // "Add games"): the shell keeps state.ui.tab untouched while the builder is up.
  const cameFrom = { now: 'Now', games: 'Games', chat: 'Chat', more: 'More' }[state.ui.tab] || 'More';
  setTextIfChanged(setupEl('setup-back-label'), screen === 'hub' ? cameFrom : screen === 'rain' ? (setupRain.cameFrom === 'now' ? 'Now' : 'Schedule') : 'Set up the week');
  paintSetupSync();
  paintSetupHere();
  paintSetupDock();
  setupMoveHere();
  if (screen === 'hub') paintHub();
  else if (screen === 'backups') renderBackups();
  else if (screen === 'week') renderWeekScreen();
  else if (screen === 'schedule') renderScheduleScreen();
  else if (screen === 'rain') renderRainScreen();
  else if (HUB_SECTIONS.indexOf(screen) !== -1) renderSecScreen(screen);
  else if (typeof renderSettings === 'function') renderSettings();
  renderSetupMenuRows();
  paintSetupFit();
  // Opening the takeover puts focus on its labelled back (redesign §8.9), as every screen change does
  // (setupGo). A tap leaves :focus-visible off, so touch shows no ring.
  if (justOpened) setupFocusBack();
}

function setupFocusBack() {
  const back = setupEl('setup-back');
  if (back && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

// Large text: the frame is under 18em of its own text across (the test the hub's rows and the clipboard
// lists use in CSS, read here because it decides how the HEAD itself is pinned, which no container query
// can). styles.css .setup-big then pins only the bar. Read from layout each paint, never stored.
function paintSetupFit() {
  const root = setupEl('setup');
  if (!root || !root.classList || typeof getComputedStyle !== 'function') return;
  let big = false;
  try {
    const em = parseFloat(getComputedStyle(root).fontSize) || 16;
    const w = root.clientWidth;
    big = w > 0 && w / em < 18;
  } catch (e) { big = false; }
  if (root.classList.contains('setup-big') !== big) root.classList.toggle('setup-big', big);
}

function setupUiOpened() {
  setupUi.wasOpen = true;
  setupUi.where = '';
  if (typeof editorsHereStart === 'function') editorsHereStart(setupWhereNow());
  setupUi.where = setupWhereNow();
  if (!setupUi.restore.at || Date.now() - setupUi.restore.at > 60000) refreshRestoreIndex();
}

// The builder closed (Back, a demotion, the shell): the row goes, the pill and every setup sheet with it.
function setupUiClosed() {
  setupUi.wasOpen = false;
  setupUi.where = '';
  setupUi.detailsOpen = false;
  if (typeof editorsHereStop === 'function') editorsHereStop();
  setupPillHide(true);
  SETUP_SHEETS.forEach((id) => { if (shell.sheets.includes(id)) shellSheetClose(id); });
}

// Engine events (setup-sync.js onSetupEvent): the cheap targeted paints, only while the builder is up.
function setupUiOnEvent(kind) {
  if (!setupUi.wasOpen || !builderOpen()) return;
  if (kind === 'sync') { paintSetupSync(); if (setupScreen() === 'backups') paintRestoreNote(); }
  else if (kind === 'here') { paintSetupHere(); if (setupScreen() === 'hub') paintHub(); }
  else if (kind === 'tree' || kind === 'clashes') { paintSetupSync(); if (setupScreen() === 'hub') paintHub(); }
  else if (kind === 'commit') { paintSetupSync(); paintSetupDock(); }
}

// ── 4. askDialog: the one confirm of the setup screens ───────────────
// askDialog({ title, body, list, actions, input }) -> Promise of the chosen action's `value`.
//   title    plain text (the dialog's accessible name too)
//   body     a string, or an array of paragraphs (plain text; escaped here, never markup)
//   list     lines shown as a hairline list under the body ("Tuesday's schedule · 4 items")
//   actions  [{ label, value, kind: 'gold' | 'danger', cancel: true }] in the order shown. A verb on
//            every button ("Keep editing", "Discard"), never OK / Cancel. At most one `gold` (THE main
//            action) or `danger` (destructive: danger text, never a red fill). The `cancel` action is
//            what Escape, the ✕ and the backdrop resolve as (null when none).
//   input    { label, value, placeholder, maxLength } adds one text field; read the answer with
//            askForText(), which resolves { value, text }.
// Replaces native confirm / alert / prompt on every screen this project touches. One at a time: a second
// call waits for the first one's exit (Jelly's dialog ignores a re-open that lands mid-exit and would
// then close it). Where Jelly's dialog never loaded (html.jelly-failed) the same question is asked with
// the browser's own confirm, so no caller is ever left without an answer.
let askState = null;
let askClosing = null;

// Is a question up (app.js's Escape handler leaves the sheet underneath alone while one is)?
function askIsOpen() {
  return !!askState;
}

function askAvailable() {
  const dlg = setupEl('ask-dialog');
  return !!(dlg && typeof dlg.setAttribute === 'function' && typeof customElements !== 'undefined' && customElements.get('jelly-dialog'));
}

function askBodyHtml(o) {
  const paras = (Array.isArray(o.body) ? o.body : o.body ? [o.body] : []).map((p) => '<p>' + esc(p) + '</p>').join('');
  const list = Array.isArray(o.list) && o.list.length ? '<ul>' + o.list.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '';
  return paras + list;
}

function askActionsHtml(actions) {
  return actions.map((a, i) => '<button type="button" class="btn' + (a.kind === 'gold' ? ' btn-gold' : a.kind === 'danger' ? ' btn-danger' : '') +
    '" data-ask-i="' + i + '">' + esc(a.label) + '</button>').join('');
}

function askFinish(i, fromClose) {
  const s = askState;
  if (!s) return;
  askState = null;
  const a = i == null ? s.actions.find((x) => x.cancel) : s.actions[i];
  const input = s.input ? setupEl('ask-input') : null;
  const text = input && typeof input.value === 'string' ? input.value : '';
  s.resolve({ value: a ? a.value : null, text });
  if (fromClose) return; // Jelly already closed it
  const dlg = setupEl('ask-dialog');
  askClosing = new Promise((done) => {
    const fin = () => { dlg.removeEventListener('close', fin); done(); };
    dlg.addEventListener('close', fin);
    setTimeout(fin, 700); // the safety net: never leave the next question waiting on an event that didn't come
  });
  try { if ('open' in dlg) dlg.open = false; else dlg.removeAttribute('open'); } catch (e) { dlg.removeAttribute('open'); }
}

async function askOpen(opts) {
  const o = opts || {};
  const actions = Array.isArray(o.actions) && o.actions.length ? o.actions : [{ label: 'Close', value: 'close', cancel: true }];
  if (!askAvailable()) {
    const main = actions.find((a) => !a.cancel) || actions[0];
    const cancel = actions.find((a) => a.cancel);
    let text = '';
    let yes;
    if (o.input && typeof prompt === 'function') { const t = prompt(String(o.title || '') + (o.input.label ? '\n' + o.input.label : ''), o.input.value || ''); yes = t !== null; text = t || ''; }
    else yes = confirm([o.title].concat(Array.isArray(o.body) ? o.body : o.body ? [o.body] : [], o.list || []).filter(Boolean).join('\n\n'));
    return { value: yes ? main.value : (cancel ? cancel.value : null), text };
  }
  if (askState) askFinish(null, false); // a newer question replaces an older one (it reads as its cancel)
  if (askClosing) { await askClosing; askClosing = null; }
  const dlg = setupEl('ask-dialog');
  dlg.setAttribute('label', String(o.title || ''));
  setTextIfChanged(setupEl('ask-title'), String(o.title || ''));
  const body = setupEl('ask-body');
  body.innerHTML = askBodyHtml(o) + (o.input ? '<jelly-input class="form-input ask-input" id="ask-input" type="text" label="' + esc(o.input.label || '') + '" placeholder="' + esc(o.input.placeholder || '') +
    '" maxlength="' + (Number(o.input.maxLength) || 120) + '" value="' + esc(o.input.value || '') + '"></jelly-input>' : '');
  body.__html = null;
  const box = setupEl('ask-actions');
  box.innerHTML = askActionsHtml(actions);
  return new Promise((resolve) => {
    askState = { resolve, actions, input: !!o.input };
    dlg.setAttribute('open', '');
    // Focus lands on the safe choice (or the field), never on the destructive one.
    const focusWhat = () => {
      const target = o.input ? setupEl('ask-input') : box.querySelector('[data-ask-i="' + Math.max(0, actions.findIndex((a) => a.cancel)) + '"]');
      if (target && typeof target.focus === 'function') { try { target.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusWhat); else focusWhat();
  });
}

async function askDialog(opts) {
  return (await askOpen(opts)).value;
}

async function askForText(opts) {
  return askOpen(Object.assign({}, opts, { input: Object.assign({}, opts && opts.input) }));
}

// ── 5. The undo pill and Recent changes (§7.1) ───────────────────────
// After a commit: "↶ Undo  Moved Swim to 3:00 PM", hanging under the head for 6 s, then it shrinks into
// the head's dock (#setup-undo-dock). It is NEVER a toast: a toast at the foot of the screen swallowed
// the next tap on a sheet's Save, and Step 9's Undo / Redo toast action is retired for the builder
// (app.js undoRecord / undoSay hand the entry here when the frame is up, and only fall back to the toast
// elsewhere). One at a time, a new one replaces it. Tap the pill or the dock = undo that entry; long-press
// the dock, or ⋯ → Recent changes, opens the list; Ctrl/Cmd-Z undoes the newest when focus isn't in a
// text field. There is no redo stack: an undo is itself an entry ("Undid: …"), so it reads "Redo".
const UNDO_PILL_MS = 6000;
const UNDO_LONG_PRESS_MS = 500;
setupUi.pill = { id: '', timer: 0, press: 0, longFired: false };

// What the pill (or a list row) says for an entry: an "Undid: …" entry puts the original back, so it
// reads "Redo" and names what it brings back.
function undoShape(entry) {
  const label = String(entry && entry.label || '');
  const m = /^Undid: (.*)$/.exec(label);
  return m ? { verb: 'Redo', label: m[1] } : { verb: 'Undo', label };
}

function undoTop() {
  if (typeof undoRecent !== 'function') return null;
  return undoRecent()[0] || null;
}

function setupUndoOffer(entry) {
  if (!entry || !setupUi.wasOpen || !builderOpen() || !canEdit()) return false;
  const pill = setupEl('setup-undo');
  if (!pill || typeof pill.querySelector !== 'function') return false;
  const shape = undoShape(entry);
  const p = setupUi.pill;
  p.id = entry.id;
  setTextIfChanged(pill.querySelector('.setup-undo-verb'), shape.verb);
  setTextIfChanged(setupEl('setup-undo-label'), shape.label);
  pill.hidden = false;
  paintSetupDock(); // the dock steps aside while the pill is up
  // It drops in from above and squashes on landing, the overshoot spent as a squash from its top corner
  // instead of a swell (§9.5 "Banner arrives"); calm is a fade.
  if (typeof JellyMotion !== 'undefined') {
    JellyMotion.play(pill, 'arrive', (x) => {
      const o = Math.max(0, x - 1);
      return { opacity: Math.min(1, x * 1.8), transform: 'translateY(' + (Math.min(1, x) - 1) * 16 + 'px) scale(' + (1 + 0.5 * o) + ',' + (1 - 1.4 * o) + ')', transformOrigin: '100% 0' };
    });
  }
  clearTimeout(p.timer);
  p.timer = setTimeout(setupPillDock, UNDO_PILL_MS);
  return true;
}

// 6 s are up: the pill shrinks toward the dock and the dock takes over.
function setupPillDock() {
  const pill = setupEl('setup-undo');
  const p = setupUi.pill;
  clearTimeout(p.timer);
  p.timer = 0;
  if (!pill || pill.hidden) { paintSetupDock(); return; }
  const dock = setupEl('setup-undo-dock');
  let dx = 0;
  let dy = 0;
  if (dock && typeof pill.getBoundingClientRect === 'function') {
    const a = pill.getBoundingClientRect();
    const was = dock.hidden;
    dock.hidden = false;
    const b = dock.getBoundingClientRect();
    dock.hidden = was;
    dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  }
  const done = () => {
    pill.hidden = true;
    paintSetupDock();
    // The dock takes the pill in with a small pop of its icon (decorative: none under calm).
    const ico = dock && !dock.hidden && dock.querySelector ? dock.querySelector('.ico') : null;
    if (ico && typeof JellyMotion !== 'undefined') JellyMotion.play(ico, 'press', (x) => ({ transform: 'scale(' + (0.78 + 0.22 * x) + ')' }), { calm: false });
  };
  if (typeof JellyMotion !== 'undefined') {
    JellyMotion.playOut(pill, (x) => ({ opacity: 1 - x, transform: 'translate(' + (x * dx) + 'px,' + (x * dy) + 'px) scale(' + (1 - 0.8 * x) + ')', transformOrigin: '50% 50%' }), 260, done);
  } else done();
}

function setupPillHide(immediate) {
  const p = setupUi.pill;
  clearTimeout(p.timer);
  p.timer = 0;
  const pill = setupEl('setup-undo');
  if (pill && immediate !== false) pill.hidden = true;
  paintSetupDock();
}

// The dock: there whenever something can be undone and the pill isn't up; its label says what a tap does.
function paintSetupDock() {
  const dock = setupEl('setup-undo-dock');
  if (!dock) return;
  const pill = setupEl('setup-undo');
  const top = setupUi.wasOpen && canEdit() ? undoTop() : null;
  const show = !!top && !(pill && !pill.hidden);
  setHiddenIfChanged(dock, !show);
  // While the pill hangs under the head, the screen makes room for it (styles.css .setup[data-pill]): it floated
  // over the headline that was the feedback for the very change it undoes.
  const root = setupEl('setup');
  const up = !!(pill && !pill.hidden);
  if (root && root.hasAttribute && up !== root.hasAttribute('data-pill')) { if (up) root.setAttribute('data-pill', ''); else root.removeAttribute('data-pill'); }
  if (!top) return;
  const s = undoShape(top);
  const label = s.verb + ': ' + s.label;
  if (dock.getAttribute('aria-label') !== label) dock.setAttribute('aria-label', label);
}

// Undo (or redo) one entry through the app's own engine, then settle the pill, the dock and the list.
function setupUndoRun(id) {
  if (!id) return null;
  setupPillHide(true);
  const r = undoEntry(id);
  paintSetupDock();
  if (shell.sheets.includes('setup-changes')) renderSetupChanges();
  return r;
}

// The clock time and a short day word for a moment, in camp time (never the device's zone).
function setupClockParts(ms) {
  try {
    const t = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
    const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: CAMP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
    const now = Date.now();
    let word;
    if (day(ms) === day(now)) word = 'Today';
    else if (day(ms) === day(now - 86400000)) word = 'Yesterday';
    else word = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)).replace(',', '');
    return { time: t, day: word };
  } catch (e) { return { time: '', day: '' }; }
}

function setupTimeCell(ms) {
  const p = setupClockParts(ms);
  return '<span class="cb-time">' + esc(p.time) + '<small>' + esc(p.day) + '</small></span>';
}

// "game “Shields” · name and 2 more": what an entry touched, from the domains' own words.
function undoEntryWhat(entry) {
  const ops = Array.isArray(entry.ops) ? entry.ops : [];
  if (!ops.length) return '';
  let first = '';
  try { const h = UNDO_DOMAINS[ops[0][0]]; first = h && h.what ? h.what(ops[0][1]) : ''; } catch (e) { first = ''; }
  const more = ops.length - 1;
  return (first || (ops.length === 1 ? '1 change' : '')) + (more > 0 ? (first ? ' and ' : '') + more + ' more' : '');
}

// The Recent changes sheet: newest first, each row ends in its own Undo (or Redo for an "Undid:" entry).
function renderSetupChanges() {
  const list = setupEl('setup-changes-list');
  if (!list) return;
  const rows = typeof undoRecent === 'function' ? undoRecent() : [];
  const html = rows.map((e) => {
    const s = undoShape(e);
    const when = Date.parse(e.at);
    return '<div class="cb-row">' + setupTimeCell(Number.isFinite(when) ? when : Date.now()) +
      '<span class="cb-main"><span class="cb-title">' + esc(s.label) + '</span><span class="cb-sub">' + esc(undoEntryWhat(e)) + '</span></span>' +
      '<span class="cb-end"><button type="button" class="btn btn-sm" data-undo-id="' + esc(e.id) + '">' + s.verb + '</button></span></div>';
  }).join('');
  setHtmlIfChanged(list, html);
  setHiddenIfChanged(setupEl('setup-changes-empty'), rows.length > 0);
}

// ── 6. The sheets: menu, recent changes, devices ─────────────────────
// Shell sheets (shellSheetOpen / shellSheetAllowed: directors only), ONE at a time (§11.0: never a stack).
// ⋯ → Devices CLOSES the menu and opens Devices; the history stack follows (a replace, then a push).

function setupSheet(id, opener) {
  SETUP_SHEETS.forEach((s) => { if (s !== id && shell.sheets.includes(s)) shellSheetClose(s); });
  shellSheetOpen(id, opener);
}

// What fills a sheet when it opens and on every pass while it stays open (app.js shellSheetFill).
function renderSetupSheet(id) {
  if (id === 'setup-menu') renderSetupMenuRows();
  else if (id === 'setup-changes') renderSetupChanges();
  else if (id === 'setup-devices') renderSetupDevices();
  else if (id === 'restore') renderRestoreSheet();
  else if (id === 'sched-day') renderSchedDaySheet();
  else if (id === 'sched-item') renderSchedItemSheet();
  else if (id === 'rain-item') renderRainItemSheet();
  else if (id === 'rain-done') renderRainDoneSheet();
  else if (id === 'sec-teams') renderSecTeamsSheet();
  else if (id === 'sec-person') renderSecPersonSheet();
  else if (id === 'sec-station') renderSecStationSheet();
}

// Whether a setup sheet has anything to show (app.js shellSheetAllowed): the restore sheet needs a point
// that a tap opened, so a Forward or a stale history entry cannot raise an empty one.
function setupSheetReady(id) {
  if (id === 'sched-item') return !!setupSched.item;
  if (id === 'sched-day') return schedDayKey() !== 'typical';
  if (id === 'rain-item') return !!(setupRain.plan && (setupRain.bid || setupRain.gid));
  if (id === 'rain-done') return !!setupRain.plan;
  if (id === 'sec-teams') return !!secUi.teams;
  if (id === 'sec-person') return !!secUi.person;
  if (id === 'sec-station') return !!secUi.station;
  return id !== 'restore' || !!setupUi.rsheet;
}

// The owner's rows (Q8): listed only for the owner AND only when their action exists; one that can't be
// used right now stays listed, greyed, with its reason where the subline was.
function renderSetupMenuRows() {
  const d = typeof devicesList === 'function' && canEdit() ? devicesList() : null;
  setTextIfChanged(setupEl('setup-menu-devices-sub'), d && d.older ? d.lede : 'Which version each one is running');
  const owner = typeof isOwner === 'function' && isOwner();
  let any = false;
  ['new-year', 'undo-new-year', 'original', 'advanced'].forEach((act) => {
    const row = document.querySelector('[data-setup-act="' + act + '"]');
    if (!row) return;
    const a = SETUP_OWNER_ACTIONS[act];
    const show = owner && !!a;
    setHiddenIfChanged(row, !show);
    if (!show) return;
    any = true;
    const why = a.why ? String(a.why() || '') : '';
    const whyEl = row.querySelector('[data-setup-why]');
    if (whyEl) {
      if (whyEl.__dflt === undefined) whyEl.__dflt = whyEl.textContent;
      setTextIfChanged(whyEl, why || whyEl.__dflt);
    }
    if (why && row.getAttribute('aria-disabled') !== 'true') row.setAttribute('aria-disabled', 'true');
    else if (!why && row.getAttribute('aria-disabled') === 'true') row.removeAttribute('aria-disabled');
  });
  setHiddenIfChanged(document.querySelector('.setup-owner-sec'), !any);
}

function renderSetupDevices() {
  const lede = setupEl('setup-devices-lede');
  const list = setupEl('setup-devices-list');
  if (!lede || !list) return;
  const d = typeof devicesList === 'function' ? devicesList() : { rows: [], lede: '' };
  setTextIfChanged(lede, d.lede);
  // Nobody else here: the empty line alone says it (the lede said the same thing above a bare rule).
  setHiddenIfChanged(lede, !d.rows.length);
  const html = d.rows.map((r) =>
    '<div class="cb-row">' + setupTimeCell(r.at) + '<span class="cb-main"><span class="cb-title">' + esc(r.mine ? 'This device' : r.name) + '</span>' +
    '<span class="cb-sub">' + esc(r.v === null ? 'Version unknown' : 'Version ' + r.v) + ' · seen ' + esc(r.ago) + '</span></span>' +
    '<span class="cb-end">' + (r.older ? 'Older version' : '') + '</span></div>').join('');
  setHtmlIfChanged(list, html);
  setHiddenIfChanged(setupEl('setup-devices-empty'), d.rows.length > 0);
}

// A menu row was tapped.
function setupMenuAct(act, opener) {
  if (act === 'changes') { setupSheet('setup-changes', opener); return; }
  if (act === 'devices') { setupSheet('setup-devices', opener); return; }
  if (act === 'classic') {
    shellSheetClose('setup-menu');
    setupGo('classic', { tab: state.ui.settingsTab || 'games' });
    return;
  }
  const a = SETUP_OWNER_ACTIONS[act];
  if (!a || !(typeof isOwner === 'function' && isOwner())) return; // never a switch for anyone else
  if (a.why && a.why()) return; // greyed: the reason is on the row
  shellSheetClose('setup-menu');
  a.run();
}

// ── 7. Restore points: the screen, the restore sheet, hold-to-confirm, backup files (§7.2, §7.4) ──
const RP_KIND_WORDS = {
  auto: 'Automatic', manual: 'Saved by hand', 'pre-seed': 'Before turning on editing', 'pre-delete': 'Before a delete',
  'pre-import': 'Before restoring a file', 'pre-restore': 'Before putting a point back', 'pre-wizard': 'Before the new-year setup', archive: 'Past year',
};
const RP_SECTION_WORDS = { schedule: 'the schedule and week', games: 'the games', teams: 'the teams', notice: 'the notice board', scores: 'the scores' };
const RP_HOLD_MS = 1200;

function restoreCampWord() {
  return String(CAMP.label || 'this camp').replace(/\bCamp\b/, 'camp');
}

// Reads the point list once (never a listener) and repaints what shows it.
async function refreshRestoreIndex() {
  const r = setupUi.restore;
  if (r.loading || !canEdit() || typeof restoreList !== 'function') return;
  if (typeof restoreHasFirebase === 'function' && !restoreHasFirebase()) { r.status = 'nosync'; paintRestoreSurfaces(); return; }
  if (typeof restoreOnline === 'function' && !restoreOnline()) { if (r.status === 'idle') r.status = 'offline'; paintRestoreSurfaces(); return; }
  r.loading = true;
  if (r.status === 'idle') r.status = 'loading';
  try {
    r.rows = await restoreList();
    r.status = 'ok';
    r.at = Date.now();
  } catch (e) {
    r.status = e && e.code === 'PERMISSION_DENIED' ? 'denied' : 'offline';
  } finally {
    r.loading = false;
  }
  paintRestoreSurfaces();
}

function paintRestoreSurfaces() {
  if (!setupUi.wasOpen || !builderOpen()) return;
  if (setupScreen() === 'hub') paintHub();
  else if (setupScreen() === 'backups') renderBackups();
}

function paintRestoreNote() {
  const r = setupUi.restore;
  const text = r.status === 'denied' ? 'Restore points aren’t available yet — the database rules haven’t been updated.'
    : r.status === 'nosync' ? 'This device isn’t connected to the camp database, so it can’t keep restore points.'
    : r.status === 'offline' ? 'You’re offline. The list loads when you’re back.' : '';
  setTextIfChanged(setupEl('rp-note-text'), text);
  setHiddenIfChanged(setupEl('rp-note'), !text);
}

function rpWho(row) {
  if (row.kind === 'archive' || row.kind === 'pre-wizard') return RP_KIND_WORDS[row.kind];
  const key = row.byKey || '';
  const name = typeof setupEditorName === 'function' ? setupEditorName(key) : 'A director';
  return (name === 'You' ? 'You' : name) + ' · ' + (RP_KIND_WORDS[row.kind] || row.kind).toLowerCase();
}

// A past year's point says its YEAR where the others say a time of day (6:12 AM means nothing for 2026).
function rpYearCell(ms) {
  try {
    const d = new Date(ms);
    const y = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, year: 'numeric' }).format(d);
    const md = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, month: 'short', day: 'numeric' }).format(d);
    return '<span class="cb-time">' + esc(y) + '<small>' + esc(md) + '</small></span>';
  } catch (e) { return setupTimeCell(ms); }
}

function rpRowHtml(row) {
  const pin = row.pinned ? '<svg class="ico" aria-hidden="true" role="img" aria-label="Kept"><use href="#i-pin"/></svg>' : '';
  const when = row.kind === 'archive' || row.kind === 'pre-wizard' ? rpYearCell(row.at) : setupTimeCell(row.at);
  return '<button type="button" class="cb-row" data-rp-open="' + esc(row.rid) + '">' + when +
    '<span class="cb-main"><span class="cb-title">' + esc(row.label || RP_KIND_WORDS[row.kind]) + '</span><span class="cb-sub">' + esc(rpWho(row)) +
    (row.note ? ' · ' + esc(row.note) : '') + '</span></span><span class="cb-end">' + pin + '<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

function renderBackups() {
  const r = setupUi.restore;
  // The screen's name small, the answer big (§8.1 rule 1), one lede line.
  setTextIfChanged(setupEl('backups-title'), 'Restore points · ' + CAMP.label);
  setTextIfChanged(setupEl('backups-headline'), hubStatus('restore', { restore: { status: r.status, newestAt: r.rows.length ? r.rows[0].at : 0, count: r.rows.length }, now: typeof serverNow === 'function' ? serverNow() : Date.now() }).summary);
  setTextIfChanged(setupEl('backups-lede'), 'One is saved for you before every big change.');
  paintRestoreNote();
  const dead = r.status === 'denied' || r.status === 'nosync';
  const save = setupEl('rp-save-btn');
  if (save && save.disabled !== dead) save.disabled = dead;
  const rows = dead ? [] : r.rows;
  const kept = rows.filter((x) => x.kind !== 'archive' && !restoreDeletable(x));
  const years = rows.filter((x) => x.kind === 'archive');
  const recent = rows.filter((x) => x.kind !== 'archive' && restoreDeletable(x));
  setHtmlIfChanged(setupEl('rp-kept'), kept.map(rpRowHtml).join(''));
  setHtmlIfChanged(setupEl('rp-list'), recent.map(rpRowHtml).join(''));
  setHtmlIfChanged(setupEl('rp-years'), years.map(rpRowHtml).join(''));
  setHiddenIfChanged(setupEl('rp-sec-kept'), !kept.length);
  setHiddenIfChanged(setupEl('rp-sec-years'), !years.length);
  setHiddenIfChanged(setupEl('rp-sec-recent'), dead);
  setTextIfChanged(setupEl('rp-recent-note'), recent.length ? recent.length + ' saved' : '');
  setHiddenIfChanged(setupEl('rp-empty'), !(r.status === 'ok' && !recent.length));
  const owner = typeof isOwner === 'function' && isOwner();
  setHiddenIfChanged(setupEl('setup-advanced'), !(owner && Object.keys(SETUP_OWNER_ACTIONS).some((k) => SETUP_OWNER_ACTIONS[k] && SETUP_OWNER_ACTIONS[k].advanced)));
}

// "Save a restore point now": asks for a name, then writes a manual point (setup-sync.js restoreSave).
async function rpSaveManual() {
  if (!canEdit() || typeof restoreSave !== 'function') return;
  const first = typeof memberName === 'string' && memberName.trim() ? memberName.trim().split(/\s+/)[0] : 'a director';
  const dflt = ('Saved by ' + first + ', ' + setupClockParts(Date.now()).time).trim();
  const ask = await askForText({
    title: 'Save a restore point', body: 'Give it a name you will recognise later.',
    input: { label: 'Name', value: dflt, placeholder: 'Before the rain plan', maxLength: 60 },
    actions: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Save', value: 'save', kind: 'gold' }],
  });
  if (ask.value !== 'save') return;
  const name = String(ask.text || '').trim().slice(0, 60) || dflt;
  const btn = setupEl('rp-save-btn');
  if (btn) btn.disabled = true;
  let res;
  try { res = await restoreSave('manual', name); } catch (e) { res = { ok: false, reason: 'refused' }; }
  if (btn) btn.disabled = false;
  if (res.ok) {
    showToast(res.queued ? 'Saved on this phone. It goes up when you’re back online.' : 'Saved “' + name + '”.');
    refreshRestoreIndex();
    return;
  }
  if (res.reason === 'manual-full') { await rpMakeRoom(name); return; }
  showToast(rpSaveWhy(res.reason));
}

function rpSaveWhy(reason) {
  return reason === 'offline' ? 'Restore points need a connection to the camp database.'
    : reason === 'too-big' ? 'The week is too big to save as one restore point.'
    : reason === 'readonly' ? 'Only a director can save a restore point.'
    : reason === 'refused' ? 'Couldn’t save it. The database refused it — the rules may not be updated yet.' : 'Couldn’t save it.';
}

// 20 saved by hand is the cap: say so, and offer to delete the oldest one that isn't kept.
async function rpMakeRoom(name) {
  const old = setupUi.restore.rows.filter((x) => x.kind === 'manual' && restoreDeletable(x)).sort((a, b) => a.at - b.at)[0];
  if (!old) { showToast('You already have 20 saved by hand. Keep or delete one first.'); return; }
  const choice = await askDialog({
    title: 'You have 20 saved by hand',
    body: 'To save a new one, delete the oldest: “' + old.label + '”.',
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Delete it and save', value: 'go', kind: 'danger' }],
  });
  if (choice !== 'go') return;
  const gone = await restoreDelete(old.rid);
  if (!gone.ok) { showToast('Couldn’t delete it.'); return; }
  const res = await restoreSave('manual', name);
  showToast(res.ok ? 'Saved “' + name + '”.' : rpSaveWhy(res.reason));
  refreshRestoreIndex();
}

// ── the restore sheet ──
// setupUi.rsheet = { rid, row, source: 'index' | 'file', state: loading | ready | error, body, preview, picks, reveal, busy, why }
function rpDefaultPicks(preview) {
  const picks = {};
  RP_SECTIONS.forEach((s) => {
    const sec = preview.sections[s];
    picks[s] = s !== 'scores' && !!(sec && sec.offered && sec.count > 0);
  });
  return picks;
}

async function openRestoreSheet(rid, opener) {
  const row = setupUi.restore.rows.find((r) => r.rid === rid);
  if (!row) return;
  setupUi.rsheet = { rid, row, source: 'index', state: 'loading', body: null, preview: null, picks: {}, reveal: false, busy: false, why: '' };
  setupSheet('restore', opener);
  let res;
  try { res = await restoreRead(rid); } catch (e) { res = { ok: false, reason: 'offline' }; }
  const rs = setupUi.rsheet;
  if (!rs || rs.rid !== rid) return; // another point (or none) since
  if (!res.ok) { rs.state = 'error'; rs.why = res.reason; }
  else rpReady(rs, res.body);
  renderRestoreSheet();
}

function rpReady(rs, body) {
  rs.body = body;
  rs.preview = restorePreview(body);
  rs.picks = rpDefaultPicks(rs.preview);
  rs.state = 'ready';
}

// A backup FILE of this camp goes through the same sheet: you pick what to put back.
function openRestoreSheetForFile(body, name) {
  const when = Date.parse(body.at);
  setupUi.rsheet = {
    rid: '', row: { label: name || 'Backup file', at: Number.isFinite(when) ? when : Date.now(), byKey: '', kind: 'manual', note: '' }, source: 'file',
    state: 'loading', body: null, preview: null, picks: {}, reveal: false, busy: false, why: '',
  };
  rpReady(setupUi.rsheet, body);
  setupSheet('restore');
}

function rpWhyText(why) {
  return why === 'other-camp' ? 'That point is from the other camp.' : why === 'missing' ? 'That restore point is gone.'
    : why === 'unreadable' ? 'That restore point couldn’t be read.' : 'Couldn’t load it. Check your connection.';
}

function renderRestoreSheet() {
  const rs = setupUi.rsheet;
  const sheet = setupEl('sheet-restore');
  if (!sheet) return;
  if (!rs) return;
  const ready = rs.state === 'ready';
  setTextIfChanged(setupEl('sheet-restore-title'), (rs.row && rs.row.label) || 'Restore point');
  const when = rs.row && rs.row.at ? setupClockParts(rs.row.at) : null;
  setTextIfChanged(setupEl('rp-meta'), rs.state === 'loading' ? 'Loading…' : rs.state === 'error' ? rpWhyText(rs.why)
    : [rs.source === 'file' ? 'Backup file' : rpWho(rs.row), when ? when.day + ' ' + when.time : ''].filter(Boolean).join(' · '));
  const prev = ready ? rs.preview : null;
  setTextIfChanged(setupEl('rp-epoch-text'), prev ? prev.epochNote : '');
  setHiddenIfChanged(setupEl('rp-epoch-note'), !(prev && prev.epochNote));
  RP_SECTIONS.forEach((s) => {
    const row = document.querySelector('[data-rp-section="' + s + '"]');
    if (!row) return;
    const sec = prev && prev.sections[s];
    setHiddenIfChanged(row, !(sec && sec.offered));
    const what = row.querySelector('[data-rp-what]');
    if (what && sec) {
      setTextIfChanged(what, s === 'scores' ? (sec.summary || (rs.picks.scores ? 'Same as now' : 'Left as they are unless you tick this')) : (sec.count ? sec.summary || sec.count + ' to change' : 'Same as now'));
    }
    const cb = row.querySelector('[data-rp-pick]');
    if (cb && !!cb.checked !== !!rs.picks[s]) cb.checked = !!rs.picks[s];
  });
  const kept = prev ? prev.kept : [];
  setTextIfChanged(setupEl('rp-kept-text'), kept.length ? 'Kept because they have scores: ' + kept.map((k) => k.name + ' (' + k.why + ')').join(', ') : '');
  setHiddenIfChanged(setupEl('rp-kept-note'), !kept.length);
  const no = prev ? prev.notOffered.map((n) => n.text).filter((t, i, a) => a.indexOf(t) === i).join(' ') : '';
  setTextIfChanged(setupEl('rp-not-offered-text'), no);
  setHiddenIfChanged(setupEl('rp-not-offered'), !no);
  // The dock: ONE action. Scores ticked → the hold button, which names the camp; a tap or a key on it
  // reveals the two-tap alternative under it.
  const scores = !!rs.picks.scores;
  const any = ready && RP_SECTIONS.some((s) => rs.picks[s] && prev.sections[s] && prev.sections[s].offered);
  const go = setupEl('rp-restore-btn');
  setHiddenIfChanged(go, scores || !ready);
  if (go) { if (go.disabled !== (!any || rs.busy)) go.disabled = !any || rs.busy; setTextIfChanged(go, rs.busy ? 'Putting back…' : 'Put these back'); }
  // Revealed, the hold button steps aside for the filled "Yes" and a Cancel back to it: two identical red
  // buttons stacked left a director guessing which one commits.
  setHiddenIfChanged(setupEl('rp-hold-btn'), !(scores && ready && !rs.reveal));
  const holdText = 'Hold to put back ' + restoreCampWord() + '’s scores';
  setTextIfChanged(setupEl('rp-hold-label'), holdText);
  setTextIfChanged(setupEl('rp-hold-fill-label'), holdText);
  const conf = setupEl('rp-hold-confirm');
  setHiddenIfChanged(conf, !(scores && ready && rs.reveal));
  setTextIfChanged(conf, 'Yes, put back ' + restoreCampWord() + '’s scores');
  setHiddenIfChanged(setupEl('rp-hold-cancel'), !(scores && ready && rs.reveal));
  // Keep / delete (the row's own actions, §7.2): a kept point can't be deleted from the app.
  const manage = setupEl('rp-manage');
  setHiddenIfChanged(manage, !(rs.source === 'index' && rs.row));
  const kind = rs.row && rs.row.kind;
  setHiddenIfChanged(setupEl('rp-keep-row'), !(rs.row && !rs.row.pinned && kind !== 'archive' && kind !== 'pre-wizard'));
  setHiddenIfChanged(setupEl('rp-delete-row'), !(rs.row && restoreDeletable(rs.row)));
}

const RP_WHY = {
  busy: 'Something on this phone hasn’t finished saving. Wait a moment and try again.',
  offline: 'You need to be online to put a restore point back.',
  readonly: 'Only a director can put a restore point back.',
  nothing: 'Tick at least one thing to put back.',
  loading: 'The games list is still loading. Try again in a moment.',
  'pre-restore': 'Couldn’t save a restore point first, so nothing was changed.',
  schedule: 'Couldn’t put the schedule back.',
  'other-camp': 'That point is from the other camp.',
  'not-offered': 'One of those can’t be put back from this point.',
  confirm: 'Hold the button to put the scores back.',
};

async function rpApply() {
  const rs = setupUi.rsheet;
  // The sheet must still be OPEN: a hold that was still down when Escape / Back / a re-render dismissed
  // the sheet would otherwise finish 1.2 s in and put the scores back after the person said no.
  if (!rs || rs.state !== 'ready' || rs.busy || !shell.sheets.includes('restore')) return;
  const picks = {};
  RP_SECTIONS.forEach((s) => { picks[s] = !!(rs.picks[s] && rs.preview.sections[s] && rs.preview.sections[s].offered); });
  if (!RP_SECTIONS.some((s) => picks[s])) { showToast(RP_WHY.nothing); return; }
  rs.busy = true;
  renderRestoreSheet();
  let res;
  try { res = await restoreApply(rs.body, picks, { label: rs.row.label || 'a restore point', confirmed: !!picks.scores }); } catch (e) { res = { ok: false, reason: 'error' }; }
  rs.busy = false;
  if (!res.ok) { renderRestoreSheet(); showToast(RP_WHY[res.reason] || 'Couldn’t put it back. Nothing was changed.'); return; }
  setupUi.rsheet = null;
  shellSheetClose('restore');
  const words = res.applied.map((s) => RP_SECTION_WORDS[s] || s);
  showToast('Put back ' + hubJoin(words) + '. A restore point from just before is saved.' +
    (res.kept && res.kept.length ? ' Kept because they have scores: ' + res.kept.map((k) => k.name).join(', ') + '.' : ''));
  refreshRestoreIndex();
}

// Name and keep: write-once, so the question says what it means.
async function rpKeepPoint() {
  const rs = setupUi.rsheet;
  if (!rs || !rs.row || !rs.rid) return;
  const choice = await askDialog({
    title: 'Keep this restore point?', body: 'Kept points can’t be deleted from the app.',
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Keep it', value: 'keep', kind: 'gold' }],
  });
  if (choice !== 'keep') return;
  let res;
  try { res = await restorePin(rs.rid); } catch (e) { res = { ok: false }; }
  if (!res.ok) { showToast('Couldn’t keep it.'); return; }
  rs.row.pinned = true;
  showToast('Kept “' + rs.row.label + '”.');
  await refreshRestoreIndex();
  renderRestoreSheet();
}

async function rpDeletePoint() {
  const rs = setupUi.rsheet;
  if (!rs || !rs.row || !rs.rid || !restoreDeletable(rs.row)) return;
  const choice = await askDialog({
    title: 'Delete this restore point?', body: '“' + rs.row.label + '” will be gone for good.',
    actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Delete', value: 'delete', kind: 'danger' }],
  });
  if (choice !== 'delete') return;
  let res;
  try { res = await restoreDelete(rs.rid); } catch (e) { res = { ok: false }; }
  if (!res.ok) { showToast(res.reason === 'kept' ? 'Kept points can’t be deleted from the app.' : 'Couldn’t delete it.'); return; }
  setupUi.rsheet = null;
  shellSheetClose('restore');
  refreshRestoreIndex();
}

// Hold-to-confirm (§11.0): the fill wipes across over 1.2 s while pressed (a clip-path, not a transform, so
// calm keeps it: it is the only way to see how long is left); letting go early drains it. A quick tap, or a
// key / assistive-tech activation, reveals the two-tap alternative instead.
function wireHold(btn, onDone, onReveal) {
  const fill = btn.querySelector('.btn-hold-fill');
  let anim = null;
  let held = false;
  let done = false;
  let downAt = 0;
  let timer = 0;
  const wipe = (from, to, ms) => {
    if (!fill || typeof fill.animate !== 'function') return null;
    return fill.animate([{ clipPath: 'inset(0 ' + (100 - from * 100) + '% 0 0)' }, { clipPath: 'inset(0 ' + (100 - to * 100) + '% 0 0)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
  };
  const finish = () => { if (held && !done) { done = true; held = false; clearTimeout(timer); onDone(); } };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    held = true; done = false; downAt = Date.now();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    anim = wipe(0, 1, RP_HOLD_MS);
    if (anim) anim.onfinish = finish; else timer = setTimeout(finish, RP_HOLD_MS);
  });
  const release = () => {
    if (!held) return;
    held = false;
    clearTimeout(timer);
    const p = anim && anim.currentTime != null ? Math.min(1, anim.currentTime / RP_HOLD_MS) : 0;
    if (anim) { try { anim.cancel(); } catch (e) { /* gone */ } anim = null; }
    const drain = wipe(p, 0, 220);
    if (drain) drain.onfinish = () => { try { drain.cancel(); } catch (e) { /* gone */ } };
    if (Date.now() - downAt < 350) onReveal(); // a tap, not a hold
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  // A tap reveals the alternative IN this button's place (it steps aside, and the sheet grows by Cancel):
  // the browser's click for that same tap would land on whatever now fills the spot ("Yes", or Cancel).
  // The button's own acts are all pointer and key handlers, so its touch click is never needed.
  btn.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReveal(); } });
  btn.addEventListener('click', (e) => { if (e.detail === 0) onReveal(); }); // assistive tech activates with a click and no pointer
}

// A backup file picked on the Restore points screen. A v3 backup of THIS camp opens the same restore sheet
// (you pick what to put back); another camp's, or an older flat one, goes through tryImport's own checks,
// asked in the dialog instead of a native confirm.
async function rpRestoreFile(file) {
  if (!file || !canEdit()) return;
  let text = '';
  try { text = await file.text(); } catch (e) { showToast('Couldn’t read that file.'); return; }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') { showToast('That doesn’t look like a Camp Scoreboard backup.'); return; }
  const v3 = parsed.app === 'campScoreboardV3';
  if (v3 && typeof restoreParseBody === 'function') {
    const res = restoreParseBody(text);
    if (res.ok) { openRestoreSheetForFile(res.body, file.name); return; }
    if (res.reason === 'other-camp') {
      const them = CAMPS[res.camp] ? CAMPS[res.camp].label : 'another camp';
      const choice = await askDialog({
        title: 'That backup is from ' + them, body: 'Copy its schedule, games and teams into ' + CAMP.label + '? Its scores and everything else are left out.',
        actions: [{ label: 'Cancel', value: 'no', cancel: true }, { label: 'Copy them', value: 'copy', kind: 'gold' }],
      });
      // Asked once, here: tryImport must not ask again with a native confirm.
      if (choice === 'copy' && typeof tryImport === 'function') tryImport(text, { copyFromOtherCamp: true, confirmed: true, say: (msg) => { if (msg) showToast(msg); } });
      return;
    }
    showToast('That backup couldn’t be read.');
    return;
  }
  await rpImportLegacy(text, {});
}

async function rpImportLegacy(text, opts) {
  if (typeof tryImport !== 'function') return;
  const choice = await askDialog({
    title: 'Replace this camp’s setup?', body: 'The teams, days, games and saved scores on every phone become what the file holds. A restore point of the week as it is now is saved first.',
    actions: [{ label: 'Cancel', value: 'no', cancel: true }, { label: 'Put it back', value: 'go', kind: 'danger' }],
  });
  if (choice !== 'go') return;
  tryImport(text, Object.assign({ confirmed: true, say: (msg) => { if (msg) showToast(msg); } }, opts));
}

function rpDownloadBackup() {
  if (typeof backupJSON !== 'function' || typeof downloadBlob !== 'function') return;
  const blob = new Blob([backupJSON()], { type: 'application/json' });
  downloadBlob(blob, 'camp-scoreboard-' + CAMP.id + '-backup-' + new Date().toISOString().slice(0, 10) + '.json');
}

// ── 8. Wiring (app.js init calls wireSetupUi once; the markup is static, so one pass is enough) ──

// ── 8. Owner doors and the Camp week screen (§10.1, §11.4) ───────────

// The sentence for each reason setupTurnOn can refuse with, said BEFORE anything is written.
const TURNON_WHY = {
  loading: 'Still loading the week setup — try again in a moment.',
  denied: 'Editing here isn’t available yet — the database rules need updating first.',
  schema: 'This camp’s setup was made by a newer version. Reload the page first.',
  tab: 'This tab is view-only. Use the tab that is open for editing.',
  offline: 'Turning on editing needs a connection. Try again when you’re online.',
  already: 'Editing is already on.',
  'restore-point': 'The restore point couldn’t be saved first, so nothing was changed.',
  refused: 'The database refused it, so nothing was changed.',
  failed: 'That didn’t go through, so nothing was changed.',
  none: 'Nothing to turn on.',
};

function setupSay(text) {
  if (typeof showToast === 'function') showToast(text);
}

// Edit the week here (A1): the owner's front-door button. A plain question first (it changes nothing anyone sees), the
// camp-week freeze as a question in words, then the transaction. Every refusal is said in a sentence; the owner can
// override the freeze only by saying so.
async function setupEditTheWeek() {
  if (!requireOwner('turn on editing')) return { ok: false, reason: 'owner' };
  const camp = CAMP.label;
  const go = await askDialog({
    title: 'Edit the ' + camp + ' week here?',
    body: ['Turning this on changes nothing anyone can see until someone edits something.', 'The first time, a restore point is saved first. “Use the original week again” in the ⋯ menu puts it all back.'],
    actions: [{ label: 'Not yet', value: 'no', cancel: true }, { label: 'Turn on editing', value: 'go', kind: 'gold' }],
  });
  if (go !== 'go') return { ok: false, reason: 'cancelled' };
  const opts = {};
  for (let guard = 0; guard < 4; guard++) {
    const r = await setupTurnOn(['schedule'], opts);
    if (r.ok) {
      const n = r.attach ? r.attach.attached : 0;
      setupSay('Editing is on for ' + camp + '.' + (n ? ' ' + hubPlural(n, 'game', 'games') + ' put on the schedule.' : ''));
      return r;
    }
    if (r.reason === 'ask-camp-week') {
      const running = await askDialog({
        title: 'Is a camp week running right now?',
        body: 'No dates are set, so the app can’t tell. Turning on editing mid-week changes what the schedule is made from while counselors are relying on it.',
        actions: [{ label: 'Not yet', value: 'no', kind: 'gold' }, { label: 'Yes, it’s running', value: 'yes' }, { label: 'Cancel', value: 'cancel', cancel: true }],
      });
      if (running === 'cancel' || running === null) return { ok: false, reason: 'cancelled' };
      opts.campRunning = running === 'yes';
      continue;
    }
    if (r.reason === 'camp-week') {
      const again = await askDialog({
        title: 'A camp week is running',
        body: ['Turning on editing now is meant for before or after camp. Rain plans and small edits are fine once it’s on.', 'Turn it on anyway?'],
        actions: [{ label: 'Wait for later', value: 'wait', cancel: true }, { label: 'I know — turn it on', value: 'go', kind: 'danger' }],
      });
      if (again !== 'go') return { ok: false, reason: 'cancelled' };
      opts.overrideCampWeek = true;
      continue;
    }
    setupSay(r.reason === 'owner' ? r.message : (TURNON_WHY[r.reason] || TURNON_WHY.failed));
    return r;
  }
  return { ok: false, reason: 'failed' };
}

// Use the original week again: the switch goes false on every device at once; every edit is kept.
async function setupUseOriginalFlow() {
  if (!requireOwner('switch back to the original week')) return { ok: false, reason: 'owner' };
  const go = await askDialog({
    title: 'Use the original week again?',
    body: ['Everyone sees the schedule that came with the app. Your changes are kept, and Edit the week here brings them back.'],
    actions: [{ label: 'Keep editing here', value: 'no', cancel: true }, { label: 'Use the original week', value: 'go', kind: 'gold' }],
  });
  if (go !== 'go') return { ok: false, reason: 'cancelled' };
  const r = setupUseOriginal(['schedule']);
  if (r.ok) setupSay('Back to the original week. Your edits are kept.');
  else setupSay(r.reason === 'owner' ? r.message : r.reason === 'already' ? 'Already using the original week.' : 'That didn’t go through, so nothing was changed.');
  return r;
}

HUB_DOOR_ACTIONS.original = setupEditTheWeek;
SETUP_OWNER_ACTIONS.original = { run: setupUseOriginalFlow, why: () => (scheduleIsShared() ? '' : 'Already using the original week.') };

// The read-only door a screen shows while the schedule is still the copy that came with the app: the same words as the
// hub's, the owner's gold button, everyone else's sentence with the owner's name (§11.1, ux-R18). `prefix`: week | sched.
function paintPreviewDoor(prefix, preview, copy) {
  const el = setupEl(prefix + '-door');
  if (!el) return;
  setHiddenIfChanged(el, !preview);
  if (!preview) return;
  const owner = typeof isOwner === 'function' && isOwner();
  const name = hubCap(typeof ownerName === 'function' ? ownerName() : 'the owner');
  const c = copy || {};
  // The hub says it in full; here one line (§8.8: no explanation paragraph above every screen's content). On Camp week
  // the dates, double points and finale stay editable, so only the days are called read-only. A section's screen (step 19)
  // passes its own words: "The menus can now be edited here too." and the owner's "Turn on".
  setTextIfChanged(setupEl(prefix + '-door-lead'), c.lead !== undefined ? c.lead : prefix === 'week' ? 'The original week · the days are read-only' : 'The original week · read-only');
  setTextIfChanged(setupEl(prefix + '-door-text'), '');
  const btn = setupEl(prefix + '-door-btn');
  setTextIfChanged(btn, c.btn || 'Edit the week here');
  setHiddenIfChanged(btn, !owner);
  setTextIfChanged(setupEl(prefix + '-door-owner-text'), c.ownerText || name + ' turns on editing.');
  setHiddenIfChanged(setupEl(prefix + '-door-owner'), owner);
}

// The tree a Schedule or Camp week screen reads: the live one when the schedule is edited here, else the seeded
// built-in week (a read-only preview with real block ids).
function schedViewTree() {
  return scheduleIsShared() ? setupTree : setupBuiltInTree();
}

// The date of weekday `dow` of the camp week that starts on `ymd` ("Jul 21"), or ''.
function weekDateWords(ymd, dow) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + dow * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// "Jul 18–24, 2027" (or "Jul 28 – Aug 3, 2027" across a month) for the camp week that starts on the Sunday `ymd`.
function weekHeadline(ymd) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const a = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const b = new Date(a.getTime() + 6 * 86400000);
  const mon = (d) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = b.getUTCFullYear();
  return mon(a) === mon(b) ? mon(a) + ' ' + a.getUTCDate() + '–' + b.getUTCDate() + ', ' + year : mon(a) + ' ' + a.getUTCDate() + ' – ' + mon(b) + ' ' + b.getUTCDate() + ', ' + year;
}

const WEEK_DOW_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "Thu Jul 23, 5 PM" in camp time, for the fixed legacy double-points window.
function weekStampWords(ms) {
  const f = (o) => new Date(ms).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
  const t = f({ hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  return f({ weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '') + ', ' + t;
}

function weekDoubleLegacy() {
  return !(state.meta && state.meta.epoch);
}

function weekSelectOptions(sel, items, value) {
  if (!sel) return;
  const html = items.map((it) => '<option value="' + esc(String(it[0])) + '">' + esc(it[1]) + '</option>').join('');
  setHtmlIfChanged(sel, html);
  if (document.activeElement !== sel && String(sel.value) !== String(value)) sel.value = String(value);
}

function renderWeekScreen() {
  const preview = !scheduleIsShared();
  const ymd = (typeof campWeek === 'function' && campWeek().start) || '';
  const range = hubWeekRange(ymd);
  setTextIfChanged(setupEl('week-title'), 'Camp week · ' + CAMP.label);
  setTextIfChanged(setupEl('week-headline'), ymd ? weekHeadline(ymd) : 'No dates yet');
  const tree = schedViewTree();
  const follow = SETUP_DK.filter((dk, i) => i >= 1 && i <= 5 && setupMapOf(setupMapOf(tree.days)[dk]).typical === true);
  setTextIfChanged(setupEl('week-lede'), ymd
    ? 'Sunday to Saturday' + (follow.length ? ' · ' + schedDaysWords(follow) + ' follow the typical day' : '')
    : 'Pick the Sunday camp starts. Reminders and the TV page use it.');
  paintPreviewDoor('week', preview);
  // Dates. A native date: the phone's own picker. While the new year is due, the route into its setup replaces it.
  const due = typeof newYearDue === 'function' && !!newYearDue();
  setHiddenIfChanged(setupEl('week-start-row'), due);
  setHiddenIfChanged(setupEl('week-wizard'), !due);
  const input = setupEl('week-start');
  if (input && document.activeElement !== input && input.value !== ymd) input.value = ymd;
  setTextIfChanged(setupEl('week-start-sub'), range ? range : 'A Sunday');
  // Days: a tick sheet. Each row names its day, its date and its tag; the chosen tick is aria-checked.
  document.querySelectorAll('#week-days .wk-day[data-dow]').forEach((row) => {
    const dow = Number(row.dataset.dow);
    const dk = SETUP_DK[dow];
    const day = setupMapOf(setupMapOf(tree.days)[dk]);
    const tag = weekDays()[dow] ? weekDays()[dow].tag : '';
    setTextIfChanged(row.querySelector('[data-week-date]'), ymd ? ' · ' + weekDateWords(ymd, dow) : '');
    setTextIfChanged(row.querySelector('[data-week-tag]'), tag || '');
    row.querySelectorAll('.wk-tick').forEach((t) => {
      const on = (t.dataset.weekFollow === 'typical') === (day.typical === true);
      if (t.getAttribute('aria-checked') !== String(on)) t.setAttribute('aria-checked', String(on));
      if (preview) { if (t.getAttribute('aria-disabled') !== 'true') t.setAttribute('aria-disabled', 'true'); } else if (t.hasAttribute('aria-disabled')) t.removeAttribute('aria-disabled');
    });
  });
  // Double points: in the legacy epoch the window is fixed; later it is the week's own (meta/double).
  const legacy = weekDoubleLegacy();
  setHiddenIfChanged(setupEl('week-double-legacy'), !legacy);
  setHiddenIfChanged(setupEl('week-double-box'), legacy);
  setHiddenIfChanged(setupEl('week-double-note'), true);
  if (legacy && typeof DOUBLE_WINDOW_LEGACY === 'object') {
    const endDay = new Date(DOUBLE_WINDOW_LEGACY.end - 1).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).replace(',', '');
    setTextIfChanged(setupEl('week-double-legacy-text'),
      'This year’s double points are fixed (' + weekStampWords(DOUBLE_WINDOW_LEGACY.start) + ' – end of ' + endDay + ', ' + etParts(DOUBLE_WINDOW_LEGACY.start).year +
      '). A new window takes effect with the new-year setup.');
  } else {
    const dbl = setupMapOf(setupTree.meta).double;
    const on = setupIsMap(dbl);
    const sw = setupEl('week-double-on');
    if (sw && sw.hasAttribute('checked') !== on) sw.toggleAttribute('checked', on);
    paintSwitchWord('week-double-on', on);
    setHiddenIfChanged(setupEl('week-double-form'), !on);
    const d = on ? dbl : { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 };
    weekSelectOptions(setupEl('week-double-from'), WEEK_DOW_WORDS.map((w, i) => [i, w]), d.fromDow);
    weekSelectOptions(setupEl('week-double-until'), WEEK_DOW_WORDS.map((w, i) => [i + 1, 'End of ' + w]), d.toDow);
    const at = setupEl('week-double-at');
    const hh = String(Math.floor(d.fromMin / 60)).padStart(2, '0') + ':' + String(d.fromMin % 60).padStart(2, '0');
    if (at && document.activeElement !== at && at.value !== hh) at.value = hh;
  }
  // The big screen's finale day (Friday unless chosen).
  const fin = setupMapOf(setupTree.meta).finaleDow;
  weekSelectOptions(setupEl('week-finale'), WEEK_DOW_WORDS.map((w, i) => [i, w]), Number.isInteger(fin) ? fin : 5);
}

function weekSetStart(value) {
  const err = setupEl('week-start-error');
  const say = (t) => { setTextIfChanged(err, t); setHiddenIfChanged(err, !t); };
  if (!value) { say('Pick a date, or leave it as it was.'); return; }
  if (typeof isValidWeekStart === 'function' && !isValidWeekStart(value)) { say('Camp starts on a Sunday. Pick the Sunday the week begins.'); const i = setupEl('week-start'); if (i) i.value = campWeek().start || ''; return; }
  say('');
  const r = commitSetup((d) => { d.meta.weekStart = value; }, { label: 'Camp starts ' + hubWeekRange(value).split(' – ')[0] });
  if (!r.ok) weekRefused(r);
}

function weekSaveDouble(on) {
  const from = Number((setupEl('week-double-from') || {}).value);
  const until = Number((setupEl('week-double-until') || {}).value);
  const at = String((setupEl('week-double-at') || {}).value || '17:00').split(':').map(Number);
  const fromMin = (at[0] || 0) * 60 + (at[1] || 0);
  const note = (t) => { setTextIfChanged(setupEl('week-double-note-text'), t); setHiddenIfChanged(setupEl('week-double-note'), !t); };
  if (!on) { const r = commitSetup((d) => { delete d.meta.double; }, { label: 'No double points this week' }); if (!r.ok) weekRefused(r); note(''); return; }
  if (until * 1440 <= from * 1440 + fromMin) { note('Double points have to end after they start.'); return; }
  note('');
  const r = commitSetup((d) => { d.meta.double = { fromDow: from, fromMin, toDow: until, toMin: 0 }; }, { label: 'Double points ' + WEEK_DOW_WORDS[from] + ' to ' + WEEK_DOW_WORDS[Math.min(6, until - 1)] });
  if (!r.ok) weekRefused(r);
}

function weekSetFinale(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return;
  const r = commitSetup((d) => { d.meta.finaleDow = n; }, { label: 'TV finale on ' + WEEK_DOW_WORDS[n] });
  if (!r.ok) weekRefused(r);
}

// A commit the engine refused, in words (the one place both the Camp week and Schedule screens say it).
function weekRefused(r) {
  if (!r || r.ok) return;
  let t = 'That didn’t go through, so nothing was changed.';
  if (r.reason === 'readonly') t = 'Only a director can change the week.';
  else if (r.reason === 'loading') t = 'Still loading the week setup — try again in a moment.';
  else if (r.reason === 'off') t = 'Turn on editing first (Edit the week here).';
  else if (r.reason === 'removed') t = (r.byName || 'Another director') + ' removed this item, so the change wasn’t saved.';
  else if (r.reason === 'owner') t = r.message || t;
  setupSay(t);
}

// A tick on the Days sheet: its day follows the typical day, or has its own schedule — the same two operations as the
// Schedule screen's day menu.
function weekTick(dow, kind) {
  if (!scheduleIsShared()) return;
  const dk = SETUP_DK[dow];
  const now = setupMapOf(setupTree.days[dk]).typical === true ? 'typical' : 'own';
  if (kind === now) return;
  if (kind === 'own') schedGiveOwn(dow); else schedMakeFollowAgain(dow);
}

// ── 9. Day operations shared by Camp week and Schedule (§11.4, §11.5) ─

// ONE undo entry for a change that touches the setup tree AND the games catalog (a day that stops following the typical
// day re-homes its games; a rain plan moves them): both writes go in undo-less and their before/after pairs are recorded
// together, so Undo puts the games back with the items. `configMutate` may be null. Returns commitSetup's result plus
// { entry }. Nothing is written when the games list can't be edited yet.
function setupCombined(label, setupMutate, configMutate, opts) {
  const o = opts || {};
  if (configMutate && typeof configEditable === 'function' && !configEditable()) return { ok: false, reason: 'config-loading' };
  const beforeSetup = setupCanon(setupTree);
  const beforeCfg = cfgCanon(state.config);
  const r = commitSetup(setupMutate, Object.assign({}, o, { undo: false }));
  if (!r.ok) return r;
  let cfgOps = {};
  if (configMutate) {
    configEdit(label, configMutate, { undo: false });
    cfgOps = treeDiff(beforeCfg, cfgCanon(state.config), CFG_DEPTHS);
  }
  const ops = Object.keys(r.ops).map((p) => ['setup', p, setupValueAt(beforeSetup, p), r.ops[p]])
    .concat(Object.keys(cfgOps).map((p) => ['config', p, cfgValueAt(beforeCfg, p), cfgOps[p]]));
  const entry = ops.length ? undoRecord(label, ops) : null;
  return Object.assign(r, { entry, cfgOps });
}

// The games (config) that sit on schedule items of a day that is about to lose them.
function schedGamesLosing(dow, ids) {
  const dayIds = competitionDays().filter((d) => d.dow === dow).map((d) => d.id);
  return schedGamesOn(state.config, ids, dayIds);
}

function schedUnlinkMutator(games) {
  const set = {};
  games.forEach((g) => { set[g.id] = true; });
  return () => { ((state.config && state.config.games) || []).forEach((g) => { if (g && set[g.id]) { delete g.blockId; delete g.ord; } }); };
}

// The `pre-delete` restore point a destructive day operation takes first. A device with no sync has nowhere to keep one
// and goes on; any other refusal stops it, said in a sentence.
async function schedSafetyPoint(label) {
  const rp = await restoreSave('pre-delete', label);
  if (rp.ok || rp.reason === 'offline') return true;
  setupSay('A restore point couldn’t be saved first, so nothing was changed.');
  return false;
}

function schedDayWord(dow) {
  return SETUP_DAY_WORDS[SETUP_DK[dow]];
}

// Give a day its own schedule: its items are copied with the same ids and it stops following the typical day, in one
// atomic commit (so a colleague's late "Just Friday" is refused by the rules' anchor and explained).
async function schedGiveOwn(dow) {
  const dk = SETUP_DK[dow];
  const word = schedDayWord(dow);
  const go = await askDialog({
    title: 'Give ' + word + ' its own schedule?',
    body: ['It keeps the items it shows now. After this, changes to the typical day stop reaching ' + word + '.'],
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Give ' + word + ' its own', value: 'go', kind: 'gold' }],
  });
  if (go !== 'go') return false;
  const r = commitSetup((d) => schedOwnMutate(d, dk, planForDow(dow)), { label: 'Gave ' + word + ' its own schedule' });
  if (!r.ok) weekRefused(r);
  return r.ok;
}

// Make a day follow the typical day again: its own items go, and games on items only that day had are listed as not
// on the schedule. Asks first and saves a `pre-delete` restore point.
async function schedMakeFollowAgain(dow) {
  const dk = SETUP_DK[dow];
  const word = schedDayWord(dow);
  const own = Object.keys(setupMapOf(setupMapOf(setupTree.dayBlocks)[dk]));
  const only = own.filter((id) => !setupIsMap(setupMapOf(setupTree.typical)[id]));
  const games = schedGamesLosing(dow, only);
  const body = [word + '’s own items go and it shows the typical day again.'];
  if (games.length) body.push(hubPlural(games.length, 'game sits', 'games sit') + ' on items only ' + word + ' has. ' + (games.length === 1 ? 'It keeps its results and is' : 'They keep their results and are') + ' listed as not on the schedule.');
  const go = await askDialog({
    title: 'Make ' + word + ' follow the typical day again?', body,
    actions: [{ label: 'Keep its own', value: 'no', cancel: true }, { label: 'Follow the typical day', value: 'go', kind: 'danger' }],
  });
  if (go !== 'go') return false;
  if (!(await schedSafetyPoint('Before ' + word + ' follows the typical day'))) return false;
  const r = setupCombined('Made ' + word + ' follow the typical day', (d) => schedFollowMutate(d, dk), games.length ? schedUnlinkMutator(games) : null);
  if (!r.ok) { if (r.reason === 'config-loading') setupSay('Still loading the games list — try again in a moment.'); else weekRefused(r); }
  return r.ok;
}

// Clear all of a day's changes (its patches and one-offs), leaving it on the typical day. Same safety as above.
async function schedClearDay(dow) {
  const dk = SETUP_DK[dow];
  const word = schedDayWord(dow);
  const oneOffs = Object.keys(setupMapOf(setupMapOf(setupTree.dayBlocks)[dk]));
  const games = schedGamesLosing(dow, oneOffs);
  const body = [word + ' goes back to exactly the typical day: its changes and its own items are removed.'];
  if (games.length) body.push(hubPlural(games.length, 'game sits', 'games sit') + ' on items only ' + word + ' has; ' + (games.length === 1 ? 'it is' : 'they are') + ' listed as not on the schedule.');
  const go = await askDialog({
    title: 'Clear all of ' + word + '’s changes?', body,
    actions: [{ label: 'Keep them', value: 'no', cancel: true }, { label: 'Clear ' + word + '’s changes', value: 'go', kind: 'danger' }],
  });
  if (go !== 'go') return false;
  if (!(await schedSafetyPoint('Before clearing ' + word + '’s changes'))) return false;
  const r = setupCombined('Cleared ' + word + '’s changes', (d) => schedClearMutate(d, dk), games.length ? schedUnlinkMutator(games) : null);
  if (!r.ok) { if (r.reason === 'config-loading') setupSay('Still loading the games list — try again in a moment.'); else weekRefused(r); }
  return r.ok;
}


// ── 10. The Schedule screen (§11.5): the day strip, the rows, the item sheet ─────────────────────────

// The state the sheets hold while they are open (device-local, in memory: a half-made edit is never synced or cached).
const setupSched = {
  item: null,        // the open item sheet: { dayKey, dk, dow, mode: 'add' | 'edit', bid, where, origin, rec, form, ask, moves, hasTeams, label0 }
  stripPlaced: false, // the strip opened scrolled to today once per visit
};

const SCHED_PARTS = ['morning', 'afternoon', 'evening'];
const SCHED_EMOJI = [
  ['🏅', 'Medal'], ['🍽️', 'Meal'], ['🍳', 'Breakfast'], ['🥪', 'Lunch'], ['🍲', 'Supper'], ['☕', 'Break'], ['🌟', 'Star'], ['📣', 'Announcement'],
  ['🎲', 'Games'], ['🏊', 'Swim'], ['🎯', 'Target'], ['🏕️', 'Camp'], ['🔥', 'Campfire'], ['🎬', 'Movie'], ['🎶', 'Music'], ['🙏', 'Prayer'],
  ['📖', 'Reading'], ['🧼', 'Cleanup'], ['🛏️', 'Bed'], ['🌙', 'Night'], ['⚽', 'Sports'], ['🎨', 'Crafts'], ['🚌', 'Travel'], ['👋', 'Welcome'],
];

// 'typical' or a day key, from state.ui.setupDay; with nothing chosen, today during the camp week, else the typical day.
function schedDayKey() {
  const v = state.ui && state.ui.setupDay;
  if (v === 'typical' || SETUP_DK.indexOf(v) !== -1) return v;
  const wk = typeof campWeek === 'function' ? campWeek() : { phase: 'unset' };
  return wk.phase === 'during' ? SETUP_DK[campNow().dow] : 'typical';
}
function schedDowOf(dayKey) { return SETUP_DK.indexOf(dayKey); }
function schedDayName(dayKey) { return dayKey === 'typical' ? 'the typical day' : SETUP_DAY_WORDS[dayKey]; }
function schedTodayKey() { return SETUP_DK[campNow().dow]; }

// The typical day as rich blocks, in the order a day shows them.
function schedTypicalBlocks(tree) {
  return Object.keys(setupMapOf(tree.typical)).map((id) => {
    const rec = tree.typical[id];
    if (!setupIsMap(rec)) return null;
    const b = Object.assign({ id, dk: '', origin: 'typical' }, rec);
    return validBlock(b) ? setupRichBlock(b) : null;
  }).filter(Boolean).sort((a, b) => (a.start - b.start) || (a.ord - b.ord) || (a.id < b.id ? -1 : 1));
}

function schedBlocksFor(dayKey) {
  return dayKey === 'typical' ? schedTypicalBlocks(schedViewTree()) : planForDow(schedDowOf(dayKey));
}

function schedPartOf(b) { return b.start < 720 ? 'morning' : b.start < 1020 ? 'afternoon' : 'evening'; }

function schedClockWords(m) { return m >= 1440 ? 'midnight' : schedClock(m, false); }

// Setup's one time style in words (P2 §11.6): "1:15–2:00 PM", "11:30 AM–12:15 PM", "9:30 PM–midnight" — the same
// "9:40 AM" as setup-sync.js setupClock. The run-sheet rows keep their bare "10:00–11:45" column (the part of day is the
// list's heading); every sentence, question and struck "was" uses this, never app.js schedRange's "10:00–11:45am".
function setupRange(start, end) {
  if (end >= 1440) return setupClock(start) + '–midnight';
  return ((start < 720) === (end < 720) ? schedClock(start, false) : setupClock(start)) + '–' + setupClock(end);
}
// A length in words: "45 min", "1 h", "1 h 45 min".
function setupLength(mins) {
  const m = Math.max(0, Math.round(mins));
  return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
}

function schedGamesOf(b, dow) {
  const dayIds = dow >= 0 ? competitionDays().filter((d) => d.dow === dow).map((d) => d.id) : null;
  return allGames().filter((g) => g.blockId === b.id && (!dayIds || dayIds.indexOf(g.dayId) !== -1));
}

// The sub of a row: the KIND in words (none for a plain activity, none when the label already says it), then at most one
// tag — a difference from the typical day.
function schedRowSub(b, ctx) {
  const parts = [];
  const label = String(b.label).toLowerCase();
  if (b.type === 'games') {
    const n = ctx.shared ? schedGamesOf(b, ctx.dow).length : 0;
    parts.push('Games' + (n ? ' · ' + hubPlural(n, 'game', 'games') : ''));
  } else if (b.type === 'elective') {
    const w = 'Elective ' + ((Number.isInteger(b.slot) ? b.slot : 0) + 1);
    if (label.indexOf(w.toLowerCase()) === -1) parts.push(w);
  } else if (b.meal) parts.push('Meal');
  let tag = '';
  if (ctx.dayKey !== 'typical') {
    const short = SETUP_DAY_WORDS[ctx.dayKey].slice(0, 3);
    if (b.origin === 'oneoff') tag = short + ' only';
    else if (b.origin === 'changed') tag = 'Changed for ' + short;
  } else if (ctx.shared) {
    const days = SETUP_DK.filter((dk) => {
      if (setupMapOf(setupMapOf(setupTree.days)[dk]).typical !== true) return false;
      const p = setupMapOf(setupMapOf(setupTree.patches)[dk])[b.id];
      return setupIsMap(p) && setupPatchDiffers(p, setupTree.typical[b.id] || {});
    });
    if (days.length === 1) tag = 'Own version on ' + SETUP_DAY_WORDS[days[0]].slice(0, 3);
    else if (days.length > 1) tag = 'Own version on ' + days.length + ' days';
  }
  const warn = !b.noTime && !b.overlapOk && schedOverlaps(ctx.blocks, b).length ? schedOverlaps(ctx.blocks, b)[0] : null;
  if (warn) parts.push('Overlaps ' + setupHeadLabel(warn.label));
  return { text: parts.join(' · '), tag, warn: !!warn };
}

function schedRowHtml(b, ctx) {
  const sub = schedRowSub(b, ctx);
  const time = b.noTime
    ? esc(schedClock(b.start, false)) + '<small>time hidden</small>'
    : esc(schedClock(b.start, false)) + '<small>–' + esc(schedClockWords(b.end)) + '</small>';
  const subHtml = sub.text || sub.tag ? '<span class="cb-sub">' + esc(sub.text) + (sub.tag ? '<b class="sched-tag">' + esc(sub.tag) + '</b>' : '') + '</span>' : '';
  const inner = '<span class="cb-time">' + time + '</span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.label) + '</span></span>' + subHtml + '</span>' +
    '<span class="cb-end">' + (ctx.editable ? '<svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' : '') + '</span>';
  const attrs = ' class="cb-row sched-row" data-bid="' + esc(b.id) + '"' + (b.noTime ? ' data-notime' : '') + (sub.warn ? ' data-warn' : '') +
    (sub.tag ? ' data-diff="' + (b.origin === 'oneoff' ? 'only' : 'changed') + '"' : '') + ' data-key="r-' + esc(b.id) + '"';
  return ctx.editable ? '<button type="button"' + attrs + '>' + inner + '</button>' : '<div' + attrs + '>' + inner + '</div>';
}

// Paint one part-of-day list. On the same day an edit that re-sorts it glides the survivors to their new places (the
// rain list's keyed FLIP, once hands are off the list); a day switch, calm motion or no Jelly is a plain replace — on a
// new day the shared block ids would otherwise all slide about. Its own memo, so an idle renderAll touches nothing.
function schedPaintList(list, html, dayKey) {
  if (!list || (list.__schedHtml === html && list.__schedDay === dayKey)) return;
  const same = list.__schedHtml !== undefined && list.__schedDay === dayKey;
  list.__schedHtml = html;
  list.__schedDay = dayKey;
  const calm = typeof calmMotion === 'function' && calmMotion();
  if (!same || calm || typeof JellyMotion === 'undefined' || !JellyMotion.flipKeyed || !list.children || !list.children.length) { list.innerHTML = html; return; }
  JellyMotion.whenHandsOff(() => {
    if (list.__schedHtml !== html) return;
    try { JellyMotion.flipKeyed(list, html, 'glide'); } catch (e) { list.innerHTML = html; }
  });
}

function schedGapHtml(g) {
  return '<button type="button" class="sched-gap" data-key="gap-' + g.start + '" data-gap-start="' + g.start + '" data-gap-end="' + g.end + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Add something · ' + esc(setupRange(g.start, g.end)) + '</span></button>';
}

// How many items of a day differ from the typical day, in the words of the note under the lede.
function schedDayDiffs(dow) {
  const dk = SETUP_DK[dow];
  const day = setupMapOf(setupMapOf(setupTree.days)[dk]);
  if (day.typical !== true) return null;
  const plan = planForDow(dow);
  return { skipped: plan.skipped.length, oneOffs: plan.filter((b) => b.origin === 'oneoff').length, changed: plan.filter((b) => b.origin === 'changed').length };
}

function schedStripLabel(dk, dow, shared) {
  const name = SETUP_DAY_WORDS[dk];
  const bits = [name];
  if (dk === schedTodayKey()) bits.push('today');
  if (shared) {
    const d = schedDayDiffs(dow);
    bits.push(d ? 'follows the typical day' : 'its own schedule');
    if (d) { const n = d.skipped + d.oneOffs + d.changed; if (n) bits.push(hubPlural(n, 'change', 'changes')); }
  }
  return bits.join(', ');
}

function renderSchedStrip(dayKey, shared) {
  const track = setupEl('sched-days-track');
  if (!track) return;
  const todayKey = schedTodayKey();
  track.querySelectorAll('.daypick-btn[data-day]').forEach((btn) => {
    const dk = btn.dataset.day;
    const sel = dk === dayKey;
    if (btn.getAttribute('aria-selected') !== String(sel)) btn.setAttribute('aria-selected', String(sel));
    if (dk === 'typical') {
      btn.setAttribute('aria-label', 'The typical day' + (sel ? ', chosen' : ''));
      return;
    }
    const dow = schedDowOf(dk);
    const isToday = dk === todayKey && campWeek().phase === 'during';
    if (isToday !== btn.hasAttribute('data-today')) { if (isToday) btn.setAttribute('data-today', ''); else btn.removeAttribute('data-today'); }
    const diffs = shared ? schedDayDiffs(dow) : null;
    const follows = !!diffs || (!shared && setupMapOf(setupMapOf(schedViewTree().days)[dk]).typical === true);
    const changed = !!diffs && (diffs.skipped + diffs.oneOffs + diffs.changed) > 0;
    const dotT = btn.querySelector('[data-dot="typical"]');
    const dotC = btn.querySelector('[data-dot="changed"]');
    setHiddenIfChanged(dotT, !follows || changed);
    setHiddenIfChanged(dotC, !changed);
    const issues = shared ? schedDayIssues(dow) : false;
    setHiddenIfChanged(btn.querySelector('[data-sd-warn]'), !issues);
    btn.setAttribute('aria-label', schedStripLabel(dk, dow, shared) + (issues ? ', something to check' : ''));
  });
  // Opens with today's chip pinned at the left edge, during the camp week (ux-R2); otherwise from the start.
  if (!setupSched.stripPlaced) {
    const chip = track.querySelector('.daypick-btn[data-today]');
    if (chip && typeof chip.offsetLeft === 'number') { track.scrollLeft = chip.offsetLeft; setupSched.stripPlaced = true; }
  }
  // The chosen day is always in view: once per day change the strip moves just enough to show its chip whole, clear of
  // the edge fade (outside camp week nothing placed it, and Saturday opened with no chosen chip on screen).
  const prev = setupSched.stripDay;
  if (prev !== dayKey && track.clientWidth > 0) {
    setupSched.stripDay = dayKey;
    stripRevealChip(track, track.querySelector('.daypick-btn[aria-selected="true"]'), prev !== undefined);
    // The chosen chip lands with the day pill's snap (§9.5); calm: nothing (the lift itself says it).
    const chip = prev !== undefined && track.querySelector('.daypick-btn[aria-selected="true"]');
    if (chip && typeof JellyMotion !== 'undefined') JellyMotion.play(chip, 'snap', (x) => ({ transform: 'scale(' + (0.86 + 0.14 * x) + ',' + (1.1 - 0.1 * x) + ')' }), { calm: false });
  }
  paintStripOverflow(track);
  setHiddenIfChanged(setupEl('sched-days-key'), !(shared && dayKey === 'typical'));
}

// Scroll a day strip just enough that `chip` is whole and clear of the edge fades (the "nearest" rule). The strip snaps
// chips to its start (scroll-padding keeps that clear of the left fade), so the target is a snap position — a spot
// between two would be snapped back, and on the right that hid the chip again.
function stripRevealChip(track, chip, smooth) {
  if (!track || !chip || typeof chip.getBoundingClientRect !== 'function') return;
  const t = track.getBoundingClientRect();
  const origin = t.left - track.scrollLeft; // content x = viewport x - origin
  const startOf = (el) => el.getBoundingClientRect().left - origin;
  const viewL = track.scrollLeft + 16;
  const viewR = track.scrollLeft + track.clientWidth - 24;
  let left = null;
  if (startOf(chip) < viewL) left = startOf(chip) - 16;
  else if (chip.getBoundingClientRect().right - origin > viewR) {
    const need = chip.getBoundingClientRect().right - origin - track.clientWidth + 24;
    const snaps = Array.prototype.filter.call(track.children, (c) => !c.hidden && c.getBoundingClientRect().width > 0).map((c) => startOf(c) - 16);
    const snap = snaps.find((x) => x >= need - 1);
    left = snap !== undefined ? snap : need;
  }
  if (left === null) return;
  left = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, Math.round(left)));
  const calm = typeof calmMotion === 'function' && calmMotion();
  if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: smooth && !calm ? 'smooth' : 'auto' });
  else track.scrollLeft = left;
}

// A strip that scrolls fades out at the edge(s) it continues past (styles.css .daypick[data-overflow]): with the
// scrollbar hidden, a strip that ended cleanly after "Thu" read as a week without Friday.
function paintStripOverflow(track) {
  if (!track || !(track.clientWidth > 0)) return;
  const max = track.scrollWidth - track.clientWidth;
  const at = track.scrollLeft;
  const v = max <= 1 ? '' : at <= 1 ? 'end' : at >= max - 1 ? 'start' : 'both';
  if ((track.getAttribute('data-overflow') || '') === v) return;
  if (v) track.setAttribute('data-overflow', v); else track.removeAttribute('data-overflow');
}

// Whether a day has something to look at: empty, a broken item, an overlap nobody okayed.
function schedDayIssues(dow) {
  const dk = SETUP_DK[dow];
  const plan = planForDow(dow);
  if (plan.broken && plan.broken.length) return true;
  const day = setupMapOf(setupMapOf(setupTree.days)[dk]);
  if (!plan.length && day.placeholder !== true) return true;
  const timed = plan.filter((b) => !b.noTime && !b.overlapOk);
  return timed.some((a, i) => timed.slice(i + 1).some((b) => b.start < a.end && a.start < b.end));
}

function renderScheduleScreen() {
  const shared = scheduleIsShared();
  const preview = !shared;
  const dayKey = schedDayKey();
  const dow = schedDowOf(dayKey);
  const tree = schedViewTree();
  const blocks = schedBlocksFor(dayKey);
  const ctx = { dayKey, dow, shared, editable: shared && canEdit(), blocks };
  renderSchedStrip(dayKey, shared);
  // Head
  setTextIfChanged(setupEl('sched-title'), 'Schedule · ' + CAMP.label);
  setTextIfChanged(setupEl('sched-headline'), dayKey === 'typical' ? 'The typical day' : SETUP_DAY_WORDS[dayKey]);
  const dayRec = dow >= 0 ? setupMapOf(setupMapOf(tree.days)[dayKey]) : {};
  const follows = dow >= 0 && dayRec.typical === true;
  const followers = SETUP_DK.filter((dk) => setupMapOf(setupMapOf(tree.days)[dk]).typical === true);
  const diffs = shared && dow >= 0 ? schedDayDiffs(dow) : null;
  let lede;
  if (dayKey === 'typical') lede = followers.length ? schedDaysWords(followers) + ' follow this' : 'No day follows it yet';
  else {
    const n = diffs ? diffs.skipped + diffs.oneOffs + diffs.changed : 0;
    lede = (dayKey === schedTodayKey() && campWeek().phase === 'during' ? 'Today · ' : '') + (follows ? 'Follows the typical day' + (n ? ' · ' + hubPlural(n, 'change', 'changes') : '') : 'Its own schedule') +
      (weekDays()[dow] && weekDays()[dow].tag ? ' · ' + weekDays()[dow].tag : '');
  }
  setTextIfChanged(setupEl('sched-lede'), lede);
  const menu = shared && dayKey !== 'typical' && canEdit();
  setHiddenIfChanged(setupEl('sched-rain-link'), !menu || !blocks.length); // an empty day has nothing to rain-plan
  setHiddenIfChanged(setupEl('sched-day-btn'), !menu);
  if (menu) setTextIfChanged(setupEl('sched-rain-link-text'), 'Rain plan for ' + (dayKey === schedTodayKey() ? 'today' : SETUP_DAY_WORDS[dayKey]));
  paintPreviewDoor('sched', preview);
  const note = diffs && (diffs.skipped + diffs.oneOffs + diffs.changed) >= 3
    ? SETUP_DAY_WORDS[dayKey] + ' is different from the typical day: ' + [diffs.skipped ? hubPlural(diffs.skipped, 'item skipped', 'items skipped') : '', diffs.oneOffs ? diffs.oneOffs + ' ' + SETUP_DAY_WORDS[dayKey] + '-only' : '', diffs.changed ? diffs.changed + ' changed' : ''].filter(Boolean).join(', ')
    : '';
  setTextIfChanged(setupEl('sched-day-note-text'), note);
  setHiddenIfChanged(setupEl('sched-day-note'), !note);
  setTextIfChanged(setupEl('sched-scope-note-text'), 'Changes ' + (followers.length ? schedDaysWords(followers) : 'to the typical day') + ', except days that have their own version of this');
  setHiddenIfChanged(setupEl('sched-scope-note'), !(shared && dayKey === 'typical' && blocks.length));
  // The guided first build, and Copy to Mon–Fri once the typical day has three items
  const empty = !blocks.length && shared && canEdit();
  setHiddenIfChanged(setupEl('sched-empty'), !empty);
  if (empty) {
    setTextIfChanged(setupEl('sched-empty-text'), dayKey === 'typical' ? 'Start with the first thing in the morning, usually breakfast.' : SETUP_DAY_WORDS[dayKey] + ' has nothing yet. Start with the first thing, or copy another day.');
    setHiddenIfChanged(setupEl('sched-copy-from'), dayKey === 'typical');
    setHiddenIfChanged(setupEl('sched-copy-archive'), true);
  }
  const copyDays = schedCopyWeekDays(tree);
  const showCopy = shared && canEdit() && dayKey === 'typical' && blocks.length >= 3 && copyDays.length > 0;
  setHiddenIfChanged(setupEl('sched-copy'), !showCopy);
  // The lists, by part of the day
  SCHED_PARTS.forEach((part) => {
    const mine = blocks.filter((b) => schedPartOf(b) === part);
    setHiddenIfChanged(document.querySelector('[data-sched-part="' + part + '"]'), !mine.length);
    const list = document.querySelector('[data-sched-list="' + part + '"]');
    if (!list) return;
    const gaps = ctx.editable ? schedGaps(blocks) : [];
    let html = '';
    mine.forEach((b, i) => {
      const gap = gaps.find((g) => g.end === b.start && i > 0 && g.start >= mine[i - 1].start);
      if (gap) html += schedGapHtml(gap);
      html += schedRowHtml(b, ctx);
    });
    schedPaintList(list, html, dayKey);
  });
  // Skipped on this day
  const skipped = dayKey !== 'typical' && blocks.skipped ? blocks.skipped : [];
  setHiddenIfChanged(setupEl('sched-sec-skipped'), !skipped.length);
  if (skipped.length) {
    setTextIfChanged(setupEl('sched-skipped-label'), 'Skipped on ' + SETUP_DAY_WORDS[dayKey]);
    setHtmlIfChanged(setupEl('sched-skipped-list'), skipped.map((b) =>
      '<div class="cb-row sched-row" data-bid="' + esc(b.id) + '" data-skipped><span class="cb-time">' + esc(schedClock(b.start, false)) + '<small>–' + esc(schedClockWords(b.end)) + '</small></span>' +
      '<span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.label) + '</span></span></span>' +
      '<span class="cb-end">' + (ctx.editable ? '<button type="button" class="btn btn-sm" data-sched-bring="' + esc(b.id) + '">Bring back</button>' : '') + '</span></div>').join(''));
  }
  setHiddenIfChanged(setupEl('sched-add'), !ctx.editable || !blocks.length);
  setTextIfChanged(setupEl('sched-add-text'), dayKey === 'typical' ? 'Add to the typical day' : 'Add to ' + SETUP_DAY_WORDS[dayKey]);
}

// Mon–Fri days that could follow the typical day: not following it, and with nothing of their own.
function schedCopyWeekDays(tree) {
  return [1, 2, 3, 4, 5].map((i) => SETUP_DK[i]).filter((dk) => setupMapOf(setupMapOf(tree.days)[dk]).typical !== true && !Object.keys(setupMapOf(setupMapOf(tree.dayBlocks)[dk])).length);
}

function schedSetDay(dayKey) {
  if (dayKey !== 'typical' && SETUP_DK.indexOf(dayKey) === -1) return;
  state.ui.setupDay = dayKey;
  saveState();
  renderAll();
}

// ── the item sheet ──

function schedMinToInput(m) {
  const v = Math.max(0, Math.min(1439, m));
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}
function schedInputToMin(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

// A rich block (or nothing) as the sheet's form.
function schedFormOf(b, defaults) {
  if (!b) {
    const d = defaults || {};
    const start = Number.isInteger(d.start) ? d.start : 9 * 60;
    return { label: '', emoji: '🌟', start, end: Number.isInteger(d.end) ? d.end : Math.min(1440, start + 45), noTime: false, kind: 'activity', meal: 'lunch', slot: 0, teams: [], overlapOk: false };
  }
  return {
    label: b.base, emoji: b.emoji, start: b.start, end: b.end, noTime: !!b.noTime,
    kind: b.meal ? 'meal' : b.type === 'games' ? 'games' : b.type === 'elective' ? 'elective' : 'activity',
    meal: b.meal || 'lunch', slot: Number.isInteger(b.slot) ? b.slot : 0, teams: setupTeamList(b.teams), overlapOk: !!b.overlapOk,
  };
}

// The sheet's form as the engine's item.
function schedFormItem(f) {
  const item = { label: String(f.label).trim(), emoji: f.emoji, start: f.start, end: f.end, noTime: f.noTime, overlapOk: f.overlapOk, type: f.kind === 'meal' ? 'activity' : f.kind, teams: f.teams };
  if (f.kind === 'meal') item.meal = f.meal;
  if (f.kind === 'elective') item.slot = f.slot;
  return item;
}

// Open the item sheet: edit an item of the day being looked at, or add one (`opts.add`, with optional start / end).
function schedOpenItem(opts) {
  const o = opts || {};
  const dayKey = o.dayKey || schedDayKey();
  const dk = dayKey === 'typical' ? '' : dayKey;
  let b = null;
  if (o.bid) b = schedBlocksFor(dayKey).find((x) => x.id === o.bid) || null;
  if (o.bid && !b) return;
  const found = b ? schedFind(setupTree, dk, b.id) : null;
  const form = schedFormOf(b, o);
  setupSched.item = {
    dayKey, dk, dow: schedDowOf(dayKey), mode: b ? 'edit' : 'add', bid: b ? b.id : null, where: found ? found.where : null,
    origin: b ? b.origin : 'new', rec: b ? schedItemOfBlock(b) : null, form, ask: { overlap: null, own: null, rekey: null }, moves: null,
    hasTeams: form.teams.length > 0, label0: form.label, stage: !!o.stage, // stage: a one-off added in the rain plan is STAGED, not saved
  };
  const sheetEl = document.querySelector('#sheet-sched-item .sheet');
  if (sheetEl && sheetEl.removeAttribute) sheetEl.removeAttribute('data-flow');
  setupSched.item.emojiOpen = false;
  setupSched.item.flow = false;
  setupSheet('sched-item', o.opener);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(schedItemFit); // measured once it is laid out
  if (typeof setupMoveHere === 'function') setupMoveHere();
}

function schedItemOfBlock(b) {
  return { label: b.base, emoji: b.emoji, start: b.start, end: b.end, type: b.meal ? 'activity' : b.type, slot: b.slot, meal: b.meal, noTime: b.noTime, teams: b.teams, overlapOk: b.overlapOk };
}

// Everything the sheet shows that is NOT a plain field, as data: errors, the questions that apply, the save buttons.
function schedItemModel(it) {
  const f = it.form;
  const item = schedFormItem(f);
  const errors = { label: '', time: '' };
  if (!item.label) errors.label = 'Give it a name.';
  else if (item.label.length > 120) errors.label = 'Keep the name under 120 characters.';
  if (!(item.start >= 0 && item.start <= 1439)) errors.time = 'Pick a start time.';
  else if (!(item.end > item.start && item.end <= 1440)) errors.time = 'Ends before it starts.';
  const valid = !errors.label && !errors.time && safeEmoji(item.emoji, '') === item.emoji && !!item.emoji;
  const typicalView = it.dayKey === 'typical';
  const changed = it.rec ? schedChanged(it.rec, item) : SCHED_FIELDS.slice();
  const timeChanged = it.mode === 'add' || changed.some((x) => x === 'start' || x === 'end' || x === 'noTime');
  const blocks = schedBlocksFor(it.dayKey).filter((b) => b.id !== it.bid);
  let overlap = null;
  let pushBy = 0;
  if (valid && timeChanged && !f.overlapOk && it.ask.overlap === null) {
    const hits = schedOverlaps(blocks, { id: it.bid, start: item.start, end: item.end, noTime: item.noTime });
    if (hits.length) {
      overlap = hits[0];
      const later = hits.filter((b) => b.start >= item.start);
      pushBy = later.length ? Math.ceil(Math.max.apply(null, later.map((b) => item.end - b.start)) / SCHED_STEP) * SCHED_STEP : 0;
    }
  }
  // Which days an "Every day like …" save reaches, and which keep their own value.
  const fromTypical = it.origin === 'typical' || it.origin === 'changed' || typicalView;
  const scopeInfo = fromTypical && it.mode === 'edit' && changed.length ? schedScopeInfo(setupTree, it.bid, changed) : { change: [], keep: [] };
  const keep = scopeInfo.keep.filter((k) => k.dk !== it.dk);
  // An answer belongs to the question it was given for: a keystroke elsewhere never re-asks it.
  const ownKey = JSON.stringify(keep);
  const ownAsk = valid && keep.length && (it.ask.own === null || it.ask.ownKey !== ownKey) ? keep : null;
  const headOld = setupNameKey(setupHeadLabel(it.label0));
  const headNew = setupNameKey(setupHeadLabel(item.label));
  const rekey = valid && it.mode === 'edit' && (it.ask.rekey === null || it.ask.rekeyKey !== headNew) && headOld && headNew && headOld !== headNew &&
    headOld.indexOf(headNew) === -1 && headNew.indexOf(headOld) === -1 && headOld.split(' ')[0] !== headNew.split(' ')[0];
  const unpatchable = fromTypical && !typicalView && it.mode === 'edit' && it.rec ? schedUnpatchable(setupTree.typical[it.bid] || {}, item) : '';
  const pending = !!(overlap || ownAsk || rekey);
  const nofit = it.moves && it.moves.nofit.length ? it.moves.nofit : [];
  return { item, errors, valid, changed, overlap, pushBy, ownAsk, ownKey, headNew, keep, scopeInfo, rekey, unpatchable, pending, nofit, fromTypical, typicalView };
}

function schedFieldWords(fields) {
  return fields.map((x) => SCHED_FIELD_WORDS[x] || x);
}

function renderSchedItemSheet() {
  const it = setupSched.item;
  if (!it || !setupEl('sheet-sched-item')) return;
  const f = it.form;
  const m = schedItemModel(it);
  const dayWord = it.dayKey === 'typical' ? 'the typical day' : SETUP_DAY_WORDS[it.dayKey];
  // A short fixed title: the name is the first field under it (a long name as the title took the screen at 200%).
  setTextIfChanged(setupEl('sheet-sched-item-title'), it.mode === 'add' ? 'New item' : 'Edit item');
  let where;
  if (it.mode === 'add') where = it.dayKey === 'typical' ? 'Adding to the typical day' : 'Adding to ' + dayWord;
  else if (it.dayKey === 'typical') where = 'The typical day · ' + (schedDaysWords(SETUP_DK.filter((dk) => setupMapOf(setupMapOf(setupTree.days)[dk]).typical === true)) || 'no day yet');
  else if (it.origin === 'changed') where = 'Changed for ' + dayWord;
  else if (it.origin === 'oneoff') where = dayWord + ' only';
  else if (it.origin === 'own') where = dayWord;
  else where = dayWord + ' · from the typical day';
  setTextIfChanged(setupEl('si-where-text'), where);
  setHiddenIfChanged(setupEl('si-reset'), !(it.origin === 'changed' && it.mode === 'edit'));
  const label = setupEl('si-label');
  if (label && document.activeElement !== label && label.value !== f.label) label.value = f.label;
  setTextIfChanged(setupEl('si-label-error'), m.errors.label);
  setHiddenIfChanged(setupEl('si-label-error'), !m.errors.label || !f.touched);
  // Emoji: one tile beside the name shows the choice and opens the grid inline (it.emojiOpen); the grid is built once,
  // one is pressed, or the "other" box holds a custom one.
  setTextIfChanged(setupEl('si-emoji-now'), f.emoji || '🙂');
  const pick = setupEl('si-emoji-btn');
  if (pick) {
    const lbl = 'Emoji' + (f.emoji ? ' ' + f.emoji : '') + (it.emojiOpen ? '' : ', change');
    if (pick.getAttribute('aria-label') !== lbl) pick.setAttribute('aria-label', lbl);
    if (pick.getAttribute('aria-expanded') !== String(!!it.emojiOpen)) pick.setAttribute('aria-expanded', String(!!it.emojiOpen));
  }
  setHiddenIfChanged(setupEl('si-emoji'), !it.emojiOpen);
  const grid = setupEl('si-emoji-grid');
  if (grid && !grid.children.length) grid.innerHTML = SCHED_EMOJI.map((e) => '<button type="button" class="si-emo" data-emoji="' + e[0] + '" aria-pressed="false" aria-label="' + esc(e[1]) + '">' + e[0] + '</button>').join('');
  let inGrid = false;
  grid.querySelectorAll('.si-emo').forEach((b) => {
    const on = b.dataset.emoji === f.emoji;
    if (on) inGrid = true;
    if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
  });
  const other = setupEl('si-emoji-other');
  if (other && document.activeElement !== other) { const v = inGrid ? '' : f.emoji; if (other.value !== v) other.value = v; }
  // Times
  const st = setupEl('si-start');
  if (st && document.activeElement !== st && st.value !== schedMinToInput(f.start)) st.value = schedMinToInput(f.start);
  const allday = f.end >= 1440;
  const en = setupEl('si-end');
  if (en && document.activeElement !== en && !allday && en.value !== schedMinToInput(f.end)) en.value = schedMinToInput(f.end);
  setHiddenIfChanged(setupEl('si-end-fld'), allday);
  setHiddenIfChanged(setupEl('si-time-error'), !m.errors.time);
  setTextIfChanged(setupEl('si-time-error'), m.errors.time || 'Ends before it starts');
  const ad = setupEl('si-allday');
  if (ad && ad.hasAttribute('checked') !== allday) ad.toggleAttribute('checked', allday);
  paintSwitchWord('si-allday', allday);
  const sh = setupEl('si-showtime');
  if (sh && sh.hasAttribute('checked') === f.noTime) sh.toggleAttribute('checked', !f.noTime);
  paintSwitchWord('si-showtime', !f.noTime);
  // Kind
  document.querySelectorAll('[data-si-type]').forEach((b) => {
    const on = b.dataset.siType === f.kind;
    if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on));
    if (b.dataset.siType === 'elective') setHiddenIfChanged(b, !(CAMP.features && CAMP.features.electives));
  });
  setHiddenIfChanged(setupEl('si-meal-fld'), f.kind !== 'meal');
  document.querySelectorAll('[data-si-meal]').forEach((b) => { const on = b.dataset.siMeal === f.meal; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
  setHiddenIfChanged(setupEl('si-slot-fld'), f.kind !== 'elective');
  document.querySelectorAll('[data-si-slot]').forEach((b) => { const on = Number(b.dataset.siSlot) === f.slot; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
  // Teams, when the item lists them
  setHiddenIfChanged(setupEl('si-teams-fld'), !it.hasTeams);
  if (it.hasTeams) setHtmlIfChanged(setupEl('si-teams'), teamIds().map((id) =>
    '<button type="button" class="si-team" data-team="' + esc(id) + '" aria-pressed="' + (f.teams.indexOf(id) !== -1) + '">' + teamMarkHtml(id, { size: 24 }) + '<span>' + esc(teamName(id)) + '</span></button>').join(''));
  // Games here
  const games = it.mode === 'edit' ? schedGamesOf({ id: it.bid }, it.dayKey === 'typical' ? -1 : it.dow) : [];
  setHiddenIfChanged(setupEl('si-games-fld'), !games.length);
  if (games.length) setHtmlIfChanged(setupEl('si-games'), games.map((g) =>
    '<div class="cb-row"><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(g.emoji) + '</span><span>' + esc(g.name) + '</span></span></span></div>').join(''));
  setHiddenIfChanged(setupEl('si-add-game'), true);
  // Reminders
  setTextIfChanged(setupEl('si-alert-text'), it.mode === 'edit' ? 'People who follow “' + setupHeadLabel(it.label0) + '” get reminded before this.' : '');
  setHiddenIfChanged(setupEl('si-alert'), it.mode !== 'edit');
  // Questions
  setHiddenIfChanged(setupEl('si-overlap'), !m.overlap);
  if (m.overlap) {
    setTextIfChanged(setupEl('si-overlap-text'), 'Overlaps ' + setupHeadLabel(m.overlap.label) + ' (' + setupRange(m.overlap.start, m.overlap.end) + ').');
    // A clash with an item that starts at or before this one is solved by starting after it; pushing later items back
    // is the answer only for a clash with a LATER item (it never moved Breakfast out of Cabin time's way).
    const after = schedOverlapAfter(f, m.overlap);
    setHiddenIfChanged(setupEl('si-overlap-after'), after === null);
    if (after !== null) setTextIfChanged(setupEl('si-overlap-after'), 'Start at ' + setupClock(after) + ' instead');
    setHiddenIfChanged(setupEl('si-overlap-push'), !m.pushBy || after !== null);
    setTextIfChanged(setupEl('si-overlap-push'), 'Push later items back ' + m.pushBy + ' min');
  }
  setHiddenIfChanged(setupEl('si-ownday'), !m.ownAsk);
  if (m.ownAsk) {
    const k = m.ownAsk[0];
    const day = SETUP_DAY_WORDS[k.dk];
    const many = m.ownAsk.length > 1;
    setTextIfChanged(setupEl('si-ownday-text'), (many ? m.ownAsk.map((x) => SETUP_DAY_WORDS[x.dk]).join(' and ') + ' have their own ' : day + ' has its own ') + schedFieldWords(k.fields).join(' and ') +
      (many ? '' : (k.fields.length === 1 && k.fields[0] === 'start' ? ' (' + schedClockWords(setupTree.patches[k.dk][it.bid].start) + ')' : '')) + '.');
    setTextIfChanged(setupEl('si-ownday-keep'), many ? 'Keep their own' : 'Keep ' + day + '’s');
    setTextIfChanged(setupEl('si-ownday-change'), many ? 'Change them too' : 'Change ' + day + ' too');
  }
  setHiddenIfChanged(setupEl('si-rekey'), !m.rekey);
  setHiddenIfChanged(setupEl('si-nofit'), !m.nofit.length);
  if (m.nofit.length) setTextIfChanged(setupEl('si-nofit'), m.nofit.map((b) => setupHeadLabel(b.label)).join(', ') + (m.nofit.length === 1 ? ' doesn’t' : ' don’t') + ' fit before midnight — shorten it or skip it today.');
  // Remove
  setHiddenIfChanged(setupEl('si-remove'), it.mode !== 'edit');
  setTextIfChanged(setupEl('si-remove-text'), it.mode !== 'edit' ? '' : 'Remove…');
  // The dock: one gold Save, or the two equal scope buttons
  const dayScoped = !it.stage && it.dayKey !== 'typical' && (it.origin === 'typical' || it.origin === 'changed' || (it.mode === 'add' && setupMapOf(setupMapOf(setupTree.days)[it.dayKey]).typical === true));
  const blocked = !m.valid || m.pending;
  // Not yet: ONE dashed well that names the missing step and takes the director to it (styles.css .btn:disabled's
  // rule — never two greyed-out copies of the real buttons, the reason below the fold). The real buttons step aside
  // (still aria-disabled, so a tap that slips through does nothing).
  const wait = blocked ? schedItemWait(it, m) : null;
  setHiddenIfChanged(setupEl('si-wait'), !wait);
  setTextIfChanged(setupEl('si-wait-text'), wait ? wait.text : '');
  setHiddenIfChanged(setupEl('si-scope'), !dayScoped || !!wait);
  setHiddenIfChanged(setupEl('si-save'), dayScoped || !!wait);
  setHiddenIfChanged(setupEl('si-tell'), true);
  const setDisabled = (el, off) => { if (!el) return; if (off) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); };
  const save = setupEl('si-save');
  setTextIfChanged(save, it.mode === 'add' ? (it.stage ? 'Add for ' + (it.dayKey === schedTodayKey() ? 'today' : dayWord) : it.dayKey === 'typical' ? 'Add to the typical day' : 'Add to ' + dayWord) : 'Save');
  setDisabled(save, blocked);
  if (dayScoped) {
    const add = it.mode === 'add';
    setTextIfChanged(setupEl('si-save-day-text'), (add ? 'Add to just ' : 'Just ') + SETUP_DAY_WORDS[it.dayKey]);
    setTextIfChanged(setupEl('si-save-all-text'), (add ? 'Add to every day like ' : 'Every day like ') + SETUP_DAY_WORDS[it.dayKey]);
    let caption;
    if (add) caption = 'Mon–Fri, and any day that follows the typical day';
    else {
      const days = m.scopeInfo.change.length ? m.scopeInfo.change : SETUP_DK.filter((dk) => setupMapOf(setupMapOf(setupTree.days)[dk]).typical === true);
      caption = schedDaysWords(days) + (m.keep.length && it.ask.own === 'keep' ? ' — ' + m.keep.map((k) => SETUP_DAY_WORDS[k.dk]).join(' and ') + ' keep' + (m.keep.length === 1 ? 's' : '') + ' ' + (m.keep.length === 1 ? 'its' : 'their') + ' own ' + schedFieldWords(m.keep[0].fields).join(' and ') : '');
    }
    setTextIfChanged(setupEl('si-scope-caption'), m.unpatchable ? 'Just ' + SETUP_DAY_WORDS[it.dayKey] + ' can’t change the ' + m.unpatchable : caption);
    setDisabled(setupEl('si-save-day'), blocked || !!m.unpatchable);
    setDisabled(setupEl('si-save-all'), blocked);
  }
  schedItemFit();
}

// What the dock's well says while the save can't happen yet, and where a tap on it goes (`to`: an element id), in the
// order a director meets them going down the sheet: the name, the times, then the open question.
function schedItemWait(it, m) {
  const verb = it.mode === 'add' ? 'add' : 'save';
  if (m.errors.label) return { text: String(it.form.label).trim() ? 'Shorten the name, then ' + verb : 'Type what happens, then ' + verb, to: 'si-label' };
  if (m.errors.time) return { text: 'Fix the times first ↑', to: 'si-start' };
  if (!m.valid) return { text: 'Pick an emoji first ↑', to: 'si-emoji-btn' };
  if (m.overlap) return { text: 'Answer the overlap question first ↑', to: 'si-overlap' };
  if (m.ownAsk) return { text: 'Answer the question about ' + (m.ownAsk.length > 1 ? 'the other days' : SETUP_DAY_WORDS[m.ownAsk[0].dk]) + ' first ↑', to: 'si-ownday' };
  if (m.rekey) return { text: 'Answer the reminders question first ↑', to: 'si-rekey' };
  return null;
}

// The well's tap: bring the step into view and put focus on it (a question's first answer, or the field itself).
function schedItemGoToWait() {
  const it = setupSched.item;
  if (!it) return;
  const w = schedItemWait(it, schedItemModel(it));
  const el = w && setupEl(w.to);
  if (!el) return;
  if (w.to === 'si-emoji-btn' && !it.emojiOpen) { it.emojiOpen = true; renderSchedItemSheet(); }
  try { el.scrollIntoView({ block: 'center', behavior: typeof calmMotion === 'function' && calmMotion() ? 'auto' : 'smooth' }); } catch (e) { /* no layout */ }
  const target = el.classList && el.classList.contains('si-ask') ? el.querySelector('button:not([hidden])') : el;
  if (target && typeof target.focus === 'function') { try { target.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

// "Start at 8:30 instead": a clash with an item that starts at or before this one is answered by starting right after
// it, the same length (capped at midnight). null when that isn't the clash, or the item would start at midnight.
function schedOverlapAfter(f, hit) {
  if (!hit || hit.start > f.start || !(hit.end < 1440)) return null;
  return hit.end;
}

// Large text: when the sheet's fixed parts (grab, head, where-from line, dock) take more than 45% of it, the whole
// sheet scrolls as one (styles.css [data-flow]): pinned, they left a 38px window onto the form at 200%. Decided per
// open and only ever switched ON while it is open, so the form never jumps between the two layouts mid-edit.
function schedItemFit() {
  const it = setupSched.item;
  const sheet = document.querySelector('#sheet-sched-item .sheet');
  if (!it || !sheet || !sheet.children || it.flow) return;
  const h = Number(sheet.clientHeight) || 0;
  if (!h) return;
  let fixed = 0;
  Array.prototype.forEach.call(sheet.children, (c) => { if (!(c.classList && c.classList.contains('sheet-body'))) fixed += Number(c.offsetHeight) || 0; });
  if (fixed > h * 0.45) { it.flow = true; sheet.setAttribute('data-flow', ''); }
}

// A field changed: whatever it was, the questions the old answer belonged to are asked again.
function schedItemTouched(what) {
  const it = setupSched.item;
  if (!it) return;
  it.form.touched = true;
  if (what === 'time') { it.ask.overlap = null; it.moves = null; }
  renderSchedItemSheet();
}

async function schedSaveItem(scope) {
  const it = setupSched.item;
  if (!it) return;
  const m = schedItemModel(it);
  if (!m.valid) { it.form.touched = true; renderSchedItemSheet(); return; }
  if (m.pending || (scope === 'day' && m.unpatchable)) return;
  const dk = it.dk;
  if (it.stage) { // the rain plan's "Add something for today": a whole one-off record, staged with the rest
    const taken = schedTakenIds(rainStagedTree(setupTree, rainEnsure()));
    const id = setupMintNewId(taken);
    const rec = schedRecord(m.item, { alertKey: setupAlertKey(m.item.label), ord: schedNextOrd(rainStagedTree(setupTree, rainEnsure()), dk, 'day') });
    rainStageNow((plan) => rainStage(plan, setupTree, 'dayBlocks/' + dk + '/' + id, rec));
    setupSched.item = null;
    shellSheetClose('sched-item');
    return;
  }
  const word = it.dayKey === 'typical' ? 'the typical day' : SETUP_DAY_WORDS[it.dayKey];
  const moves = it.moves && Object.keys(it.moves.moves).length ? it.moves.moves : null;
  const label = it.mode === 'add' ? 'Added ' + m.item.label + ' to ' + word
    : 'Changed ' + (m.item.label || it.label0) + (m.changed.length ? ' · ' + schedFieldWords(m.changed).join(', ') : '') + ' on ' + word;
  const p = { kind: it.mode === 'add' ? 'add' : 'edit', dk, bid: it.bid, where: it.where, scope: it.dayKey === 'typical' ? 'typical' : (it.origin === 'new' && setupMapOf(setupMapOf(setupTree.days)[it.dayKey]).typical !== true ? 'day' : scope || 'day'),
    item: m.item, changeOwn: it.ask.own === 'change' && it.ask.ownKey === m.ownKey ? m.keep.map((k) => k.dk) : [], moves, label };
  if (it.mode === 'edit' && it.ask.rekey === 'fresh' && it.ask.rekeyKey === m.headNew) p.alertKey = setupAlertKey(m.item.label);
  const r = schedCommit(p);
  if (!r.ok) {
    if (r.reason === 'unpatchable') setupSay('Just ' + SETUP_DAY_WORDS[it.dayKey] + ' can’t change the ' + r.fields + '. Use “Every day like ' + SETUP_DAY_WORDS[it.dayKey] + '”.');
    else if (r.reason === 'gone') setupSay('That item is gone, so the change wasn’t saved.');
    else weekRefused(Object.assign({}, r, { byName: r.byName }));
    return;
  }
  setupSched.item = null;
  shellSheetClose('sched-item');
}

// "Back to the usual": the day's patch on this item goes.
function schedItemReset() {
  const it = setupSched.item;
  if (!it || it.origin !== 'changed') return;
  const typ = setupTree.typical[it.bid] || {};
  const rich = setupRichBlock(Object.assign({ id: it.bid, dk: '', origin: 'typical' }, typ));
  const r = schedCommit({ kind: 'edit', dk: it.dk, bid: it.bid, where: it.where, scope: 'day', item: schedItemOfBlock(rich), label: 'Put ' + (typ.label || 'the item') + ' back to the usual on ' + SETUP_DAY_WORDS[it.dayKey] });
  if (!r.ok) { weekRefused(r); return; }
  setupSched.item = null;
  shellSheetClose('sched-item');
}

async function schedRemoveItem() {
  const it = setupSched.item;
  if (!it || it.mode !== 'edit') return;
  const word = it.dayKey === 'typical' ? 'the typical day' : SETUP_DAY_WORDS[it.dayKey];
  const name = setupHeadLabel(it.label0) || it.label0;
  const dayGames = schedGamesOf({ id: it.bid }, it.dayKey === 'typical' ? -1 : it.dow);
  const allGamesOn = schedGamesOf({ id: it.bid }, -1);
  let scope = 'day';
  const fromTypical = it.origin === 'typical' || it.origin === 'changed';
  const note = (games) => (games.length ? [hubPlural(games.length, 'game sits', 'games sit') + ' on it. ' + (games.length === 1 ? 'It keeps its results and is' : 'They keep their results and are') + ' listed as not on the schedule.'] : []);
  if (it.dayKey === 'typical' || fromTypical) {
    const day = it.dayKey === 'typical' ? '' : SETUP_DAY_WORDS[it.dayKey];
    const actions = it.dayKey === 'typical'
      ? [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Remove from the typical day', value: 'typical', kind: 'danger' }]
      : [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Skip just ' + day, value: 'day' }, { label: 'Remove from every day like ' + day, value: 'typical', kind: 'danger' }];
    const pick = await askDialog({ title: it.dayKey === 'typical' ? 'Remove ' + name + ' from the typical day?' : 'Remove ' + name + '?', body: it.dayKey === 'typical' ? ['Every day that follows the typical day loses it.'].concat(note(allGamesOn)) : ['Skipping it affects only ' + day + ', and you can bring it back. Removing it takes it off every day that follows the typical day.'].concat(note(dayGames)), actions });
    if (pick !== 'day' && pick !== 'typical') return;
    scope = pick;
  } else {
    const ok = await askDialog({ title: 'Remove ' + name + '?', body: ['It is only on ' + word + '.'].concat(note(dayGames)), actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Remove it', value: 'go', kind: 'danger' }] });
    if (ok !== 'go') return;
  }
  const losing = scope === 'typical' ? allGamesOn : (fromTypical ? [] : dayGames);
  const dk = it.dk;
  const label = (scope === 'day' && fromTypical ? 'Skipped ' : 'Removed ') + name + ' ' + (scope === 'typical' ? 'from the typical day' : 'on ' + word);
  const r = setupCombined(label, (d) => {
    const x = schedRemoveMutate(d, { dk, bid: it.bid, scope });
    if (!x.ok) return false;
  }, losing.length ? schedUnlinkMutator(losing) : null, { expect: it.where === 'dayBlocks' ? ['dayBlocks/' + dk + '/' + it.bid] : ['typical/' + it.bid] });
  if (!r.ok) { if (r.reason === 'config-loading') setupSay('Still loading the games list — try again in a moment.'); else weekRefused(r); return; }
  setupSched.item = null;
  shellSheetClose('sched-item');
}

// ── the day's menu (⋯ on a day) and the other actions of the screen ──

function renderSchedDaySheet() {
  const dayKey = schedDayKey();
  if (dayKey === 'typical' || !setupEl('sheet-sched-day')) return;
  const dow = schedDowOf(dayKey);
  const word = SETUP_DAY_WORDS[dayKey];
  const follows = setupMapOf(setupMapOf(setupTree.days)[dayKey]).typical === true;
  const diffs = schedDayDiffs(dow);
  const changes = diffs ? diffs.skipped + diffs.oneOffs + diffs.changed : 0;
  setTextIfChanged(setupEl('sheet-sched-day-title'), word);
  const show = { rain: true, own: follows, follow: !follows, copy: !follows && !planForDow(dow).length, clear: follows && changes > 0 };
  Object.keys(show).forEach((act) => {
    const row = document.querySelector('[data-sched-act="' + act + '"]');
    if (!row) return;
    setHiddenIfChanged(row, !show[act]);
    const t = row.querySelector('[data-sched-act-title]');
    if (t) setTextIfChanged(t, act === 'rain' ? 'Rain plan for ' + word : act === 'own' ? 'Give ' + word + ' its own schedule' : act === 'follow' ? 'Make ' + word + ' follow the typical day again' : 'Clear all of ' + word + '’s changes');
  });
  setTextIfChanged(document.querySelector('[data-sched-act-sub]'), 'Start ' + word + ' from another day’s items');
}

async function schedDayAct(act) {
  const dayKey = schedDayKey();
  if (dayKey === 'typical') return;
  const dow = schedDowOf(dayKey);
  shellSheetClose('sched-day');
  if (act === 'rain') { if (typeof rainOpen === 'function') rainOpen(dayKey); return; }
  if (act === 'own') await schedGiveOwn(dow);
  else if (act === 'follow') await schedMakeFollowAgain(dow);
  else if (act === 'clear') await schedClearDay(dow);
  else if (act === 'copy') await schedCopyFromDay(dow);
}

// Copy another day's items onto an empty own day (a day picker in an askDialog, one button per day that has items).
async function schedCopyFromDay(dow) {
  const dk = SETUP_DK[dow];
  const options = [];
  for (let i = 0; i < 7; i++) if (i !== dow && planForDow(i).length) options.push(i);
  if (!options.length) { setupSay('No other day has items to copy yet.'); return; }
  const pick = await askDialog({
    title: 'Copy from which day?', body: ['Its items become ' + SETUP_DAY_WORDS[dk] + '’s own, and you can change them from there.'],
    actions: [{ label: 'Not now', value: 'no', cancel: true }].concat(options.slice(0, 6).map((i) => ({ label: SETUP_DAY_WORDS[SETUP_DK[i]], value: String(i) }))),
  });
  if (pick === 'no' || pick === null || pick === undefined) return;
  const from = Number(pick);
  const r = schedCommit({ kind: 'copy', dk, blocks: planForDow(from), label: 'Copied ' + SETUP_DAY_WORDS[SETUP_DK[from]] + ' to ' + SETUP_DAY_WORDS[dk] });
  if (!r.ok) weekRefused(r);
}

function schedCopyWeek() {
  const dks = schedCopyWeekDays(setupTree);
  if (!dks.length) return;
  const r = commitSetup((d) => { dks.forEach((dk) => { d.days[dk] = Object.assign(setupMapOf(d.days[dk]), { typical: true }); }); }, { label: 'Made ' + schedDaysWords(dks) + ' follow the typical day' });
  if (!r.ok) weekRefused(r);
}

function schedBringBack(bid) {
  const dayKey = schedDayKey();
  const dk = dayKey === 'typical' ? '' : dayKey;
  const b = (schedBlocksFor(dayKey).skipped || []).find((x) => x.id === bid);
  const r = schedCommit({ kind: 'bring', dk, bid, label: 'Brought back ' + (b ? b.label : 'an item') + ' on ' + (dk ? SETUP_DAY_WORDS[dk] : 'the typical day') });
  if (!r.ok) weekRefused(r);
}

// The emoji tile opens (or closes) the grid inline; it arrives with the shell's arrive spring, calm: a fade.
function schedItemEmojiToggle(open) {
  const it = setupSched.item;
  if (!it) return;
  it.emojiOpen = !!open;
  renderSchedItemSheet();
  const box = setupEl('si-emoji');
  if (open && box && typeof JellyMotion !== 'undefined') {
    JellyMotion.play(box, 'arrive', (x) => ({ opacity: Math.min(1, x), transform: 'translateY(' + (-8 * (1 - Math.min(1, x))) + 'px)' }), { calm: [{ opacity: 0 }, { opacity: 1 }] });
  }
}

// The item sheet's own handlers (delegated from #sheet-sched-item; wireSetupUi calls this once).
function wireSchedItemSheet() {
  const root = setupEl('sheet-sched-item');
  if (!root) return;
  const form = () => (setupSched.item && setupSched.item.form) || null;
  root.addEventListener('input', (e) => {
    const f = form();
    if (!f) return;
    const t = e.target;
    if (t.id === 'si-label') { f.label = String(t.value || ''); schedItemTouched('label'); }
    else if (t.id === 'si-emoji-other') { const v = String(t.value || '').trim(); if (v) { f.emoji = v; schedItemTouched('emoji'); } }
  });
  root.addEventListener('change', (e) => {
    const f = form();
    if (!f) return;
    const t = e.target;
    if (t.id === 'si-start') {
      const v = schedInputToMin(t.value);
      if (!Number.isNaN(v)) { const len = f.end - f.start; f.start = v; if (f.end < 1440 && f.end <= f.start) f.end = Math.min(1440, v + Math.max(5, len > 0 ? len : 45)); schedItemTouched('time'); }
    } else if (t.id === 'si-end') {
      const v = schedInputToMin(t.value);
      if (!Number.isNaN(v)) { f.end = v === 0 ? 1440 : v; schedItemTouched('time'); }
    } else if (t.id === 'si-allday') { f.end = t.checked ? 1440 : Math.min(1439, f.start + 45); schedItemTouched('time'); }
    else if (t.id === 'si-showtime') { f.noTime = !t.checked; schedItemTouched('time'); }
    else if (t.id === 'si-tell-check') { /* the alert intent: Step 26 */ }
  });
  root.addEventListener('click', (e) => {
    const f = form();
    const it = setupSched.item;
    if (!f || !it) return;
    const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
    let b;
    if (q('#si-emoji-btn')) { schedItemEmojiToggle(!it.emojiOpen); }
    else if ((b = q('.si-emo'))) { f.emoji = b.dataset.emoji; it.emojiOpen = false; schedItemTouched('emoji'); const t = setupEl('si-emoji-btn'); if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (err) { /* fine */ } } }
    else if (q('#si-wait')) schedItemGoToWait();
    else if ((b = q('[data-si-type]'))) { f.kind = b.dataset.siType; schedItemTouched('kind'); }
    else if ((b = q('[data-si-meal]'))) { f.meal = b.dataset.siMeal; schedItemTouched('kind'); }
    else if ((b = q('[data-si-slot]'))) { f.slot = Number(b.dataset.siSlot); schedItemTouched('kind'); }
    else if ((b = q('.si-team'))) { const id = b.dataset.team; f.teams = f.teams.indexOf(id) === -1 ? f.teams.concat([id]) : f.teams.filter((x) => x !== id); if (!f.teams.length) f.teams = [id]; schedItemTouched('teams'); }
    else if ((b = q('[data-si-overlap]'))) {
      const m = schedItemModel(it);
      const after = b.dataset.siOverlap === 'after' ? schedOverlapAfter(f, m.overlap) : null;
      if (after !== null) {
        const len = f.end - f.start;
        f.start = after;
        if (f.end < 1440) f.end = Math.min(1440, after + len);
        schedItemTouched('time');
        return;
      }
      if (b.dataset.siOverlap === 'ok') { f.overlapOk = true; it.ask.overlap = 'ok'; } else if (m.overlap && m.pushBy) {
        const others = schedBlocksFor(it.dayKey).filter((x) => x.id !== it.bid);
        it.moves = schedRipple(others, m.overlap.id, m.pushBy);
        it.ask.overlap = 'push';
      }
      renderSchedItemSheet();
    }
    else if ((b = q('[data-si-ownday]'))) { const m = schedItemModel(it); it.ask.own = b.dataset.siOwnday; it.ask.ownKey = m.ownKey; renderSchedItemSheet(); }
    else if ((b = q('[data-si-rekey]'))) { const m = schedItemModel(it); it.ask.rekey = b.dataset.siRekey; it.ask.rekeyKey = m.headNew; renderSchedItemSheet(); }
    else if (q('#si-reset')) schedItemReset();
    else if (q('#si-remove')) schedRemoveItem();
    else if (q('#si-save-day')) { if (!q('#si-save-day').hasAttribute('aria-disabled')) schedSaveItem('day'); }
    else if (q('#si-save-all')) { if (!q('#si-save-all').hasAttribute('aria-disabled')) schedSaveItem('typical'); }
    else if (q('#si-save')) { if (!q('#si-save').hasAttribute('aria-disabled')) schedSaveItem('day'); }
  });
  // ✕ and the backdrop ask before they throw a half-made edit away; Escape and the phone's Back reach the same question
  // through schedItemGuardClose (app.js's Escape handler and shellApply call it).
  root.addEventListener('click', (e) => {
    const close = e.target.closest && e.target.closest('[data-sheet-close]');
    if (close && schedItemGuardClose()) e.stopPropagation();
  }, true);
}

// Closing the item sheet by ANY route asks before it throws a half-made edit away. Returns true when it took the close
// over (a question is up, or already was: the sheet stays) and false when nothing is at stake, so the caller closes
// as it always did. Discard closes it; Keep editing leaves everything as it was.
function schedItemGuardClose() {
  const it = setupSched.item;
  if (!it || !it.form || !it.form.touched || !shell.sheets.includes('sched-item')) return false;
  if (askIsOpen()) return true;
  askDialog({ title: 'Discard your changes to ' + (it.form.label || it.label0 || 'this item') + '?', body: 'They haven’t been saved yet.', actions: [{ label: 'Keep editing', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }] })
    .then((ok) => { if (ok === 'discard' && setupSched.item === it) { setupSched.item = null; shellSheetClose('sched-item'); } });
  return true;
}

// An open item sheet with edits that are not saved holds the deploy's auto-reload (reloadBlocked), as the game editor's
// draft does: the form lives in memory only. Only while the sheet is really up — a close path that left the item set
// must never hold a reload for good.
function schedItemBusy() {
  const it = setupSched.item;
  return !!(it && it.form && it.form.touched && typeof shell !== 'undefined' && shell.sheets.includes('sched-item'));
}

// The Schedule screen's own handlers (delegated from #setup-schedule and #sched-days).
function wireScheduleScreen() {
  const on = (sel, ev, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); };
  on('#sched-days', 'click', (e) => { const b = e.target.closest && e.target.closest('.daypick-btn[data-day]'); if (b) schedSetDay(b.dataset.day); });
  const track = setupEl('sched-days-track');
  if (track) track.addEventListener('scroll', () => paintStripOverflow(track), { passive: true });
  on('#setup-schedule', 'click', (e) => {
    const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
    let b;
    if ((b = q('button.sched-row[data-bid]'))) schedOpenItem({ bid: b.dataset.bid, opener: b });
    else if ((b = q('.sched-gap'))) schedOpenItem({ start: Number(b.dataset.gapStart), end: Number(b.dataset.gapEnd), opener: b });
    else if ((b = q('[data-sched-bring]'))) schedBringBack(b.dataset.schedBring);
    else if (q('#sched-add') || q('#sched-add-first')) {
      const blocks = schedBlocksFor(schedDayKey());
      const last = blocks.length ? Math.min(1380, Math.max.apply(null, blocks.map((x) => x.end))) : 8 * 60;
      schedOpenItem({ start: last >= 1380 ? 9 * 60 : last, opener: q('#sched-add') || q('#sched-add-first') });
    }
    else if (q('#sched-copy-from')) schedCopyFromDay(schedDowOf(schedDayKey()));
    else if (q('#sched-copy-week')) schedCopyWeek();
    else if (q('#sched-day-btn')) setupSheet('sched-day', q('#sched-day-btn'));
    else if (q('#sched-rain-link')) { if (typeof rainOpen === 'function') rainOpen(schedDayKey()); }
  });
  const day = setupEl('sheet-sched-day');
  if (day) day.addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('[data-sched-act]'); if (r) schedDayAct(r.dataset.schedAct); });
  wireSchedItemSheet();
}


// ── 11. The rain plan (§11.6): one day, staged, one hand ─────────────────────────────────────────

// The plan being made (in memory), and the sheet's own state. The DRAFT (what survives a reload) is the plan in
// lsKey(RAIN_DRAFT_KEY): a plan is dropped on an epoch change, one older than 12 hours asks first, and the panel holds a
// reload only while it is open and was touched in the last 2 minutes (rainBusy), so an abandoned plan never stops updates.
const setupRain = {
  plan: null,        // rainPlanNew(...) shape: { dk, epoch, at, items, games }
  touchedAt: 0,
  expanded: false,   // "Show the whole day"
  restored: '',      // "Your unfinished plan from 9:12 is back"
  pane: 'actions',   // the item sheet's pane
  cameFrom: '',      // 'now': opened from the home schedule sheet (Back / Done return there)
  bid: null,         // the item the sheet is about
  gid: null,         // the game the move pane is about
  from: '',          // where the move pane came from: 'games' | 'list'
  swap: { other: null, showEarlier: false },
  time: { start: 0, end: 0, allday: false, ripple: false },
  move: { dk: '', all: false, ask: null },
  picks: {},         // Done's clashes: key -> 'mine' | 'theirs'
  staged: {},        // bid -> true: which rows carried the Changed tag at the last paint (a new one pops)
  painted: false,
};

function rainDk() {
  const v = state.ui && state.ui.rainDay;
  return SETUP_DK.indexOf(v) !== -1 ? v : 'wed';
}
function rainDow() { return SETUP_DK.indexOf(rainDk()); }
function rainDayName() { return SETUP_DAY_WORDS[rainDk()]; }
function rainEpoch() { return (state.meta && state.meta.epoch) || ''; }
function rainIsToday() { return rainDk() === schedTodayKey(); }

function rainDraftLoad() {
  try {
    const raw = localStorage.getItem(lsKey(RAIN_DRAFT_KEY));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || SETUP_DK.indexOf(d.dk) === -1 || !setupIsMap(d.items) || !setupIsMap(d.games)) return null;
    return d;
  } catch (e) { return null; }
}
function rainDraftSave() {
  setupRain.touchedAt = Date.now();
  if (!setupRain.plan) return;
  setupRain.plan.at = Date.now();
  try {
    if (Object.keys(setupRain.plan.items).length || Object.keys(setupRain.plan.games).length) localStorage.setItem(lsKey(RAIN_DRAFT_KEY), JSON.stringify(setupRain.plan));
    else localStorage.removeItem(lsKey(RAIN_DRAFT_KEY));
  } catch (e) { /* the plan still works in memory */ }
}
function rainDraftDrop() {
  try { localStorage.removeItem(lsKey(RAIN_DRAFT_KEY)); } catch (e) { /* fine */ }
}

// The panel holds a reload only while it is open and was touched in the last two minutes.
function rainBusy() {
  return !!(setupRain.plan && (Object.keys(setupRain.plan.items).length || Object.keys(setupRain.plan.games).length) && builderOpen() && setupScreen() === 'rain' && Date.now() - setupRain.touchedAt < RAIN_BUSY_MS);
}

function rainCount(plan) {
  const c = rainChanges(setupTree, plan, rainDow(), state.config);
  return c.lines.length;
}

// Open the rain plan on a day (the typical day means today, else Wednesday). A draft for the same day and year comes
// back; one older than 12 hours asks whether to finish it.
async function rainOpen(dayKey, opts) {
  if (!canEdit() || !scheduleIsShared()) return false;
  // Where the director came from: 'now' (the home schedule sheet's "Change today's plan") — then Back says Now, and
  // Back and Done go back there with the schedule sheet open, not into Set up the week. In memory only: a reload lands
  // on the Schedule screen as before.
  setupRain.cameFrom = opts && opts.from === 'now' ? 'now' : '';
  const dk = SETUP_DK.indexOf(dayKey) !== -1 ? dayKey : (campWeek().phase === 'during' ? schedTodayKey() : 'wed');
  const draft = rainDraftLoad();
  let plan = null;
  let restored = '';
  if (draft && draft.dk === dk && draft.epoch === rainEpoch()) {
    let keep = true;
    if (Date.now() - (draft.at || 0) > RAIN_DRAFT_STALE_MS) {
      const pick = await askDialog({ title: 'Finish or discard yesterday’s rain plan?', body: ['You started a rain plan for ' + SETUP_DAY_WORDS[dk] + ' that was never finished.'], actions: [{ label: 'Discard it', value: 'discard', kind: 'danger' }, { label: 'Finish it', value: 'finish', kind: 'gold', cancel: true }] });
      keep = pick !== 'discard';
    }
    if (keep) { plan = draft; restored = 'Your unfinished plan from ' + new Date(draft.at || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' ', ' ') + ' is back.'; }
    else rainDraftDrop();
  }
  setupRain.plan = plan || rainPlanNew(dk, rainEpoch(), Date.now());
  setupRain.restored = restored;
  setupRain.expanded = false;
  setupRain.picks = {};
  setupRain.tellSet = false;
  setupRain.painted = false;
  state.ui.rainDay = dk;
  setupRain.touchedAt = Date.now();
  if (builderOpen()) setupGo('rain');
  else { openBuilder(); setupGo('rain'); }
  return true;
}

// The plan for the open screen: the one in memory, else the draft (a reload reopens the screen), else a fresh one.
function rainEnsure() {
  const dk = rainDk();
  if (setupRain.plan && setupRain.plan.dk === dk) return setupRain.plan;
  const draft = rainDraftLoad();
  setupRain.plan = draft && draft.dk === dk && draft.epoch === rainEpoch() ? draft : rainPlanNew(dk, rainEpoch(), Date.now());
  setupRain.touchedAt = Date.now();
  return setupRain.plan;
}

// Back from the rain plan: with nothing staged it just goes; with something staged it asks (the draft stays for later
// unless the director discards it).
async function rainLeave() {
  const plan = setupRain.plan;
  if (!plan || (!Object.keys(plan.items).length && !Object.keys(plan.games).length)) { setupRain.plan = null; rainDraftDrop(); return true; }
  const pick = await askDialog({
    title: 'Leave the rain plan?', body: ['Nothing is saved for anyone until you press Done. Your plan stays on this phone if you leave it for later.'],
    actions: [{ label: 'Keep planning', value: 'keep', cancel: true }, { label: 'Leave it for later', value: 'later' }, { label: 'Discard the plan', value: 'discard', kind: 'danger' }],
  });
  if (pick === 'discard') { setupRain.plan = null; rainDraftDrop(); return true; }
  if (pick === 'later') { rainDraftSave(); return true; }
  return false;
}

// ── the list ──

function rainClock(m) { return m >= 1440 ? 'midnight' : schedClock(m, false); }

// Which rows the collapsed list shows: the item happening now (or the first), the next three, any item with games, and
// every staged item. A day that isn't today starts from its top.
function rainVisible(items, nowMin, plan, games) {
  const shown = {};
  let nowIdx = items.findIndex((b) => !b.noTime && nowMin !== null && b.start <= nowMin && nowMin < b.end);
  if (nowIdx < 0) nowIdx = items.findIndex((b) => !b.noTime && (nowMin === null || b.start >= nowMin));
  if (nowIdx < 0) nowIdx = 0;
  for (let i = nowIdx; i < Math.min(items.length, nowIdx + 4); i++) shown[items[i].id] = true;
  items.forEach((b) => { if (games[b.id] && games[b.id].length) shown[b.id] = true; if (rainIsStaged(plan, rainDk(), b.id)) shown[b.id] = true; });
  return shown;
}

function rainGamesByBlock(view) {
  const dow = rainDow();
  const dayIds = competitionDays().filter((d) => d.dow === dow).map((d) => d.id);
  const out = {};
  allGames().forEach((g) => {
    if (g.blockId && dayIds.indexOf(g.dayId) !== -1) (out[g.blockId] = out[g.blockId] || []).push(g);
  });
  Object.keys(out).forEach((k) => out[k].sort((a, b) => ((Number.isFinite(a.ord) ? a.ord : 1e9) - (Number.isFinite(b.ord) ? b.ord : 1e9))));
  return out;
}

function rainRowHtml(b, ctx) {
  const staged = ctx.stagedIds[b.id];
  const was = ctx.was[b.id];
  const isNow = ctx.nowMin !== null && !b.noTime && b.start <= ctx.nowMin && ctx.nowMin < b.end;
  const past = ctx.nowMin !== null && !b.noTime && b.end <= ctx.nowMin;
  const nGames = (ctx.games[b.id] || []).length;
  const timeCell = isNow
    ? esc(schedClock(b.start, false)) + '<small class="rain-now">Now</small>'
    : b.noTime ? esc(schedClock(b.start, false)) + '<small>time hidden</small>' : esc(schedClock(b.start, false)) + '<small>–' + esc(rainClock(b.end)) + '</small>';
  const bits = [];
  if (isNow) bits.push('Until ' + rainClock(b.end));
  if (b.type === 'games' && !nGames) bits.push('Games');
  const sub = (staged ? '<b class="sched-tag" data-tag="changed">Changed</b>' + (was ? '<s class="rain-was">' + esc(setupRange(was.start, was.end)) + '</s>' : '') : '') + esc(bits.join(' · '));
  const attrs = ' class="cb-row rain-row" data-key="r-' + esc(b.id) + '" data-bid="' + esc(b.id) + '"' + (isNow ? ' data-when="now"' : past ? ' data-when="past"' : '') + (staged ? ' data-staged' : '');
  return '<button type="button"' + attrs + '><span class="cb-time">' + timeCell + '</span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.label) + '</span></span>' +
    (sub ? '<span class="cb-sub">' + sub + '</span>' : '') + '</span><span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

function rainGameHtml(g, b, plan) {
  const st = plan.games[g.id];
  const to = st && st.staged;
  let toWords = '';
  if (to) {
    if (!to.blockId) toWords = 'Off the schedule';
    else {
      const day = (competitionDays().find((d) => d.id === to.dayId) || {});
      const dowT = day.dow;
      const blk = Number.isInteger(dowT) ? planForDow(dowT).find((x) => x.id === to.blockId) : null;
      toWords = 'To ' + (Number.isInteger(dowT) ? (dowT === rainDow() ? 'today' : SETUP_DAY_WORDS[SETUP_DK[dowT]]) : 'another day') + (blk ? ' · ' + setupHeadLabel(blk.label) : '');
    }
  }
  return '<button type="button" class="rain-game" data-key="g-' + esc(g.id) + '" data-gid="' + esc(g.id) + '" data-bid="' + esc(b.id) + '"' + (to ? ' data-staged' : '') + '><span class="rain-game-name"><span class="sched-emo" aria-hidden="true">' + esc(g.emoji) + '</span><span>' + esc(g.name) + '</span>' +
    (to ? '<span class="rain-game-to">' + esc(toWords) + '</span>' : '') + '</span><span class="rain-game-act">Move<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

// Paint the list with the shell's motion: survivors glide to their new place (only once hands are off the list), new rows
// arrive; with calm motion or no Jelly it is a plain replace.
function rainPaintList(list, html, unfold) {
  if (!list || list.__rainHtml === html) return;
  const first = list.__rainHtml === undefined;
  list.__rainHtml = html;
  const calm = typeof calmMotion === 'function' && calmMotion();
  if (first || calm || typeof JellyMotion === 'undefined' || !JellyMotion.flipKeyed) { list.innerHTML = html; return; }
  JellyMotion.whenHandsOff(() => {
    if (list.__rainHtml !== html) return;
    try {
      const added = JellyMotion.flipKeyed(list, html, 'glide') || [];
      if (unfold) added.forEach((n) => JellyMotion.play(n, 'arrive', (x) => ({ opacity: Math.min(1, x), transform: 'translateY(' + (-10 * (1 - Math.min(1, x))) + 'px)' }), { calm: [{ opacity: 0 }, { opacity: 1 }] }));
    } catch (e) { list.innerHTML = html; } // a page that cannot morph (no template support) still shows the list
  });
}

function renderRainScreen() {
  if (!setupEl('setup-rain')) return;
  const plan = rainEnsure();
  const dk = rainDk();
  const dow = rainDow();
  const day = rainDayName();
  const view = rainView(setupTree, plan, dow);
  const changes = rainChanges(setupTree, plan, dow, state.config);
  const n = changes.lines.length;
  setTextIfChanged(setupEl('rain-title'), 'Rain plan · ' + day);
  setTextIfChanged(setupEl('rain-headline'), n ? hubPlural(n, 'change', 'changes') + ' to ' + day : day + ' as planned');
  setTextIfChanged(setupEl('rain-lede'), 'For ' + (rainIsToday() ? 'today' : day) + ' only. Nobody sees a change until you press Done.');
  const clashes = rainClashes(setupTree, plan).length + rainGameClashes(state.config, plan).length;
  const by = typeof setupEditedBy === 'function' ? setupEditedBy('schedule') : null;
  const note = clashes ? ((by && by.name && by.name !== 'You (another device)') ? by.name : 'Someone') + ' changed something you moved since you started: you’ll choose at Done.' : setupRain.restored;
  setTextIfChanged(setupEl('rain-note-text'), note);
  setHiddenIfChanged(setupEl('rain-note'), !note);
  const games = rainGamesByBlock(view);
  const nowMin = rainIsToday() ? campNow().minutes : null;
  const stagedIds = {};
  const was = {};
  changes.lines.forEach((l) => { stagedIds[l.id] = true; if (l.kind === 'time') was[l.id] = l.was; });
  Object.keys(plan.items).forEach((p) => { const parts = p.split('/'); if (parts[1] === dk) stagedIds[parts[2]] = true; });
  const items = view.after;
  const shown = setupRain.expanded ? null : rainVisible(items, nowMin, plan, games);
  const ctx = { stagedIds, was, nowMin, games };
  let html = '';
  let hidden = 0;
  let run = [];
  const flush = (nextStart) => {
    if (!run.length) return;
    // The last fold says when the run ENDS ("6 more until midnight"), like the ones between rows; "after" in front of
    // the last item's end read as if the run happened after it.
    const label = html === '' ? hubPlural(run.length, 'earlier item', 'earlier items')
      : run.length + ' more until ' + rainClock(nextStart === null ? Math.max.apply(null, run.map((b) => b.end)) : nextStart);
    html += '<button type="button" class="rain-fold" data-key="f-' + esc(run[0].id) + '" data-rain-expand><span>' + esc(label) + '</span><svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button>';
    hidden += run.length;
    run = [];
  };
  items.forEach((b) => {
    if (shown && !shown[b.id]) { run.push(b); return; }
    flush(b.start);
    html += rainRowHtml(b, ctx);
    (games[b.id] || []).forEach((g) => { html += rainGameHtml(g, b, plan); });
  });
  flush(null);
  (view.after.skipped || []).forEach((b) => {
    html += '<div class="cb-row rain-row" data-key="s-' + esc(b.id) + '" data-bid="' + esc(b.id) + '" data-skipped><span class="cb-time">' + esc(schedClock(b.start, false)) + '<small>–' + esc(rainClock(b.end)) + '</small></span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.label) + '</span></span><span class="cb-sub">Skipped today</span></span><span class="cb-end"><button type="button" class="btn btn-sm" data-rain-bring="' + esc(b.id) + '">Bring back</button></span></div>';
  });
  rainPaintList(setupEl('rain-list'), html, setupRain.unfold);
  setupRain.unfold = false;
  setHiddenIfChanged(setupEl('rain-more'), !hidden || setupRain.expanded);
  if (hidden) setTextIfChanged(setupEl('rain-more-text'), 'Show the whole day (' + hidden + ' more)');
  setTextIfChanged(setupEl('rain-done-count'), n ? hubPlural(n, 'change', 'changes') : '');
  setHiddenIfChanged(setupEl('rain-done-count'), !n);
  rainPopNewTags(stagedIds);
  setupRain.painted = true;
}

// A row that just became "Changed" pops its tag (press; calm: nothing).
function rainPopNewTags(now) {
  const prev = setupRain.staged;
  setupRain.staged = now;
  if (!setupRain.painted || typeof JellyMotion === 'undefined' || (typeof calmMotion === 'function' && calmMotion())) return;
  Object.keys(now).forEach((id) => {
    if (prev[id]) return;
    const row = document.querySelector('#rain-list .rain-row[data-bid="' + id + '"] .sched-tag');
    if (row) JellyMotion.play(row, 'press', (x) => ({ transform: 'scale(' + (0.7 + 0.3 * x) + ')' }), { calm: false });
  });
}

function rainStageNow(mutator) {
  const plan = rainEnsure();
  mutator(plan);
  rainDraftSave();
  renderAll();
}

// ── the item sheet and its panes ──

function rainBlock(bid) {
  const v = rainView(setupTree, rainEnsure(), rainDow());
  return v.after.find((b) => b.id === bid) || (v.after.skipped || []).find((b) => b.id === bid) || null;
}

function rainSetPane(pane, opts) {
  const sheet = setupEl('sheet-rain-item');
  if (!sheet) return;
  const was = sheet.dataset.pane;
  setupRain.pane = pane;
  if (was !== pane) {
    sheet.dataset.pane = pane;
    // Forward panes arrive from the right, Back from the left (opts.back); the spring's overshoot is spent as a small
    // squash on landing (the shell's panel arrive, §9.5), never as a slide past rest. Calm: a fade.
    const el = document.querySelector('[data-rain-pane="' + pane + '"]');
    const dir = opts && opts.back ? -1 : 1;
    if (el && typeof JellyMotion !== 'undefined') {
      JellyMotion.play(el, 'arrive', (x) => {
        const o = Math.max(0, x - 1);
        return { opacity: Math.min(1, x * 1.6), transform: 'translateX(' + (dir * 24 * (1 - Math.min(1, x))) + 'px) scale(' + (1 - 0.6 * o) + ',' + (1 + 0.3 * o) + ')', transformOrigin: dir > 0 ? '0 50%' : '100% 50%' };
      }, { calm: [{ opacity: 0 }, { opacity: 1 }] });
    }
  }
  renderRainItemSheet();
  if (!opts || !opts.keepScroll) { const body = sheet.querySelector('.sheet-body'); if (body && pane !== 'swap') body.scrollTop = 0; }
}

function rainOpenItem(bid, opener) {
  setupRain.bid = bid;
  setupRain.gid = null;
  setupRain.swap = { other: null, showEarlier: false };
  setupRain.from = '';
  setupSheet('rain-item', opener);
  rainSetPane('actions');
}

function rainOpenMove(gid, from, opener) {
  setupRain.gid = gid;
  setupRain.from = from;
  const g = gameById(gid);
  const dayDow = g ? (competitionDays().find((d) => d.id === g.dayId) || {}).dow : null;
  setupRain.move = { dk: Number.isInteger(dayDow) ? SETUP_DK[dayDow] : rainDk(), all: false, ask: null };
  if (!shell.sheets.includes('rain-item')) setupSheet('rain-item', opener);
  rainSetPane('move');
}

function rainWhenWords(b, plan) {
  const l = rainChanges(setupTree, plan, rainDow(), state.config).lines.find((x) => x.id === b.id && x.kind === 'time');
  const nGames = (rainGamesByBlock()[b.id] || []).length;
  const base = setupRange(b.start, b.end) + (nGames ? ' · ' + hubPlural(nGames, 'game', 'games') : '');
  return l ? 'Now ' + base + ' · was ' + setupRange(l.was.start, l.was.end) : base;
}

function rainOthers(bid) {
  const v = rainView(setupTree, rainEnsure(), rainDow());
  return rainTimed(v.after);
}

function renderRainItemSheet() {
  const sheet = setupEl('sheet-rain-item');
  if (!sheet) return;
  const plan = rainEnsure();
  const pane = setupRain.pane;
  if (sheet.dataset && sheet.dataset.pane !== pane) sheet.dataset.pane = pane;
  const b = setupRain.bid ? rainBlock(setupRain.bid) : null;
  const g = setupRain.gid ? gameById(setupRain.gid) : null;
  // Header: the item's name (no emoji: §8.6) and when it is; a game move names the game.
  const title = pane === 'move' && g ? g.name : b ? b.label : '';
  setTextIfChanged(setupEl('rain-item-title'), title);
  setTextIfChanged(setupEl('rain-item-when'), pane === 'move' ? 'Which item does it belong to?' : b ? rainWhenWords(b, plan) : '');
  const backTo = pane === 'actions' ? '' : pane === 'move' && setupRain.from === 'list' ? '' : pane === 'move' && setupRain.from === 'games' ? 'Games' : (b ? setupHeadLabel(b.label) : 'Back');
  setHiddenIfChanged(setupEl('rain-pane-back'), !backTo);
  setTextIfChanged(setupEl('rain-pane-back-label'), backTo);
  // The back already names the item: the title is then for the screen reader only (styles.css .rain-sheet[data-title-quiet]).
  const quiet = !!backTo && pane !== 'move';
  if (quiet !== sheet.hasAttribute('data-title-quiet')) { if (quiet) sheet.setAttribute('data-title-quiet', ''); else sheet.removeAttribute('data-title-quiet'); }
  setHiddenIfChanged(setupEl('rain-item-dock'), pane !== 'time');
  if (pane === 'actions') renderRainActions(b, plan);
  else if (pane === 'swap') renderRainSwap(b);
  else if (pane === 'how') renderRainHow(b);
  else if (pane === 'time') renderRainTime(b);
  else if (pane === 'games') renderRainGames(b);
  else if (pane === 'move') renderRainMove(g);
}

function renderRainActions(b, plan) {
  if (!b) return;
  const timed = rainTimed(rainView(setupTree, plan, rainDow()).after);
  const i = timed.findIndex((x) => x.id === b.id);
  const prev = i > 0 ? timed[i - 1] : null;
  const next = i >= 0 && i < timed.length - 1 ? timed[i + 1] : null;
  const setDis = (el, off) => { if (!el) return; if (off) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); };
  const earlier = document.querySelector('[data-rain-act="earlier"]');
  const later = document.querySelector('[data-rain-act="later"]');
  setDis(earlier, !prev || b.noTime);
  setDis(later, !next || b.noTime);
  setTextIfChanged(document.querySelector('[data-rain-pair-sub="earlier"]'), prev ? 'Before ' + setupHeadLabel(prev.label) : 'Nothing earlier');
  setTextIfChanged(document.querySelector('[data-rain-pair-sub="later"]'), next ? 'After ' + setupHeadLabel(next.label) : 'Nothing later');
  const gms = (rainGamesByBlock()[b.id] || []);
  const gamesRow = document.querySelector('[data-rain-act="games"]');
  setHiddenIfChanged(gamesRow, !gms.length);
  setTextIfChanged(setupEl('rain-games-sub'), gms.length ? hubPlural(gms.length, 'game', 'games') + ' here · move any of them' : '');
  const staged = rainIsStaged(plan, rainDk(), b.id);
  setHiddenIfChanged(document.querySelector('[data-rain-act="reset"]'), !staged);
  const l = rainChanges(setupTree, plan, rainDow(), state.config).lines.find((x) => x.id === b.id && x.kind === 'time');
  setTextIfChanged(setupEl('rain-reset-sub'), l ? 'Back to ' + setupRange(l.was.start, l.was.end) : '');
  setDis(document.querySelector('[data-rain-act="swap"]'), b.noTime);
  setDis(document.querySelector('[data-rain-act="time"]'), b.noTime);
}

function renderRainSwap(b) {
  if (!b) return;
  const nowMin = rainIsToday() ? campNow().minutes : null;
  const all = rainOthers(b.id);
  const earlier = (x) => nowMin !== null && x.end <= nowMin && x.id !== b.id;
  const show = setupRain.swap.showEarlier ? all : all.filter((x) => !earlier(x));
  setHiddenIfChanged(setupEl('rain-swap-earlier'), setupRain.swap.showEarlier || show.length === all.length);
  setHtmlIfChanged(setupEl('rain-swap-list'), show.map((x) => {
    const lenWords = setupLength(x.end - x.start);
    const inner = '<span class="cb-time">' + esc(schedClock(x.start, false)) + '<small>–' + esc(rainClock(x.end)) + '</small></span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(x.emoji) + '</span><span>' + esc(x.label) + '</span></span><span class="cb-sub">' + (x.id === b.id ? 'This one' : esc(lenWords)) + '</span></span>';
    return x.id === b.id ? '<div class="cb-row rain-pick" data-self data-bid="' + esc(x.id) + '">' + inner + '</div>'
      : '<button type="button" class="cb-row rain-pick" data-bid="' + esc(x.id) + '">' + inner + '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
  }).join(''));
  // The body opens with "This one" at its top: what follows it is what a rain plan swaps with.
  if (!setupRain.swap.placed) {
    setupRain.swap.placed = true;
    const self = document.querySelector('#rain-swap-list [data-self]');
    const body = document.querySelector('#sheet-rain-item .sheet-body');
    if (self && body && typeof self.offsetTop === 'number') body.scrollTop = Math.max(0, self.offsetTop - 4);
  }
}

// What each option of a swap leaves: its lines and the overlaps it opens, named before choosing.
function rainHowOption(b, other, moves) {
  const view = rainView(setupTree, rainEnsure(), rainDow()).after;
  const after = view.map((x) => (moves[x.id] ? Object.assign({}, x, moves[x.id]) : x));
  const lines = [b, other].map((x) => { const m = moves[x.id]; return { id: x.id, emoji: x.emoji, label: x.label, start: m.start, end: m.end }; });
  const warns = [];
  lines.forEach((l) => {
    schedOverlaps(after.filter((x) => !moves[x.id]), { id: l.id, start: l.start, end: l.end }).forEach((o) => warns.push('Overlaps ' + setupHeadLabel(o.label) + ', ' + setupRange(Math.max(l.start, o.start), Math.min(l.end, o.end))));
  });
  return { lines, warns };
}

function renderRainHow(b) {
  const other = rainBlock(setupRain.swap.other);
  if (!b || !other) return;
  const opts = { slots: rainSwapSlots(b, other), lengths: rainSwapLengths(b, other) };
  setTextIfChanged(setupEl('rain-how-lede'), b.label + ' is ' + setupLength(b.end - b.start) + ' and ' + other.label + ' is ' + setupLength(other.end - other.start) + '. How should they trade?');
  ['slots', 'lengths'].forEach((k) => {
    const btn = document.querySelector('[data-rain-how="' + k + '"]');
    const moves = opts[k];
    if (!moves) { if (btn) btn.setAttribute('aria-disabled', 'true'); setHtmlIfChanged(document.querySelector('[data-rain-how-lines="' + k + '"]'), '<span class="rain-opt-line">It would run past midnight</span>'); setHtmlIfChanged(document.querySelector('[data-rain-how-foot="' + k + '"]'), ''); return; }
    if (btn) btn.removeAttribute('aria-disabled');
    const r = rainHowOption(b, other, moves);
    setHtmlIfChanged(document.querySelector('[data-rain-how-lines="' + k + '"]'), r.lines.map((l) => '<span class="rain-opt-line"><span class="sched-emo" aria-hidden="true">' + esc(l.emoji) + '</span><span>' + esc(l.label) + '</span><b>' + esc(setupRange(l.start, l.end)) + '</b></span>').join(''));
    setHtmlIfChanged(document.querySelector('[data-rain-how-foot="' + k + '"]'), r.warns.length ? r.warns.map((w) => '<span class="rain-opt-warn">' + esc(w) + '</span>').join('') : 'Nothing else moves');
  });
}

function rainStageMoves(moves) {
  const plan = rainEnsure();
  const group = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  Object.keys(moves).forEach((id) => rainStageFields(plan, setupTree, rainDk(), id, moves[id], moves[id] && Object.keys(moves).length > 1 ? group : undefined));
  rainDraftSave();
}

function renderRainTime(b) {
  if (!b) return;
  const t = setupRain.time;
  if (!t.init || t.bid !== b.id) { setupRain.time = Object.assign({ init: true, bid: b.id }, { start: b.start, end: b.end, allday: b.end >= 1440, ripple: false }); }
  const tt = setupRain.time;
  const st = setupEl('rain-start');
  if (st && document.activeElement !== st && st.value !== schedMinToInput(tt.start)) st.value = schedMinToInput(tt.start);
  const en = setupEl('rain-end');
  if (en && document.activeElement !== en && !tt.allday && en.value !== schedMinToInput(tt.end)) en.value = schedMinToInput(tt.end);
  setHiddenIfChanged(setupEl('rain-end-fld'), tt.allday);
  const bad = !(tt.start >= 0 && tt.start <= 1439) || !(tt.end > tt.start && tt.end <= 1440);
  setHiddenIfChanged(setupEl('rain-time-error'), !bad);
  const ad = setupEl('rain-allday');
  if (ad && ad.hasAttribute('checked') !== tt.allday) ad.toggleAttribute('checked', tt.allday);
  paintSwitchWord('rain-allday', tt.allday);
  const rp = setupEl('rain-ripple');
  if (rp && rp.hasAttribute('checked') !== tt.ripple) rp.toggleAttribute('checked', tt.ripple);
  paintSwitchWord('rain-ripple', tt.ripple);
  const r = bad ? { moves: {}, nofit: [] } : rainRetime(rainTimed(rainView(setupTree, rainEnsure(), rainDow()).after), b.id, tt.start, tt.end, tt.ripple);
  setHiddenIfChanged(setupEl('rain-time-warn'), !r.nofit.length);
  setHtmlIfChanged(setupEl('rain-time-warn'), r.nofit.map((x) => '<p class="si-ask-q si-ask-warn">' + esc(setupHeadLabel(x.label)) + ' doesn’t fit before midnight — shorten it or skip it today</p>').join(''));
  const use = setupEl('rain-time-use');
  if (use) { if (bad) use.setAttribute('aria-disabled', 'true'); else use.removeAttribute('aria-disabled'); }
}

function renderRainGames(b) {
  const gms = b ? (rainGamesByBlock()[b.id] || []) : [];
  // One look for one action: the whole row is the button and ends in "Move ›", as a game row on the list does.
  setHtmlIfChanged(setupEl('rain-games-list'), gms.map((g) => '<button type="button" class="cb-row rain-game-pick" data-rain-move="' + esc(g.id) + '"><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(g.emoji) + '</span><span>' + esc(g.name) + '</span></span></span><span class="cb-end"><span class="rain-game-act">Move<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></span></span></button>').join(''));
}

// The move pane: days that have a competition day (the strip), that day's Games items first, the rest behind
// "Other items on Thursday", and Not on the schedule last.
function rainMoveDays() {
  return SETUP_DK.filter((dk, i) => competitionDays().some((d) => d.dow === i));
}

function renderRainMove(g) {
  if (!g) return;
  const m = setupRain.move;
  const days = rainMoveDays();
  if (days.indexOf(m.dk) === -1) m.dk = days.indexOf(rainDk()) !== -1 ? rainDk() : (days[0] || rainDk());
  document.querySelectorAll('#rain-move-days [data-dk]').forEach((btn) => {
    const dk = btn.dataset.dk;
    setHiddenIfChanged(btn, days.indexOf(dk) === -1);
    const on = dk === m.dk;
    if (btn.getAttribute('aria-checked') !== String(on)) btn.setAttribute('aria-checked', String(on));
    const name = btn.querySelector('.daypick-name');
    if (name) setTextIfChanged(name, dk === rainDk() ? 'Today' : SETUP_DAY_WORDS[dk].slice(0, 3));
  });
  const strip = setupEl('rain-move-days');
  if (strip && strip.dataset.shown !== m.dk && strip.clientWidth > 0) { strip.dataset.shown = m.dk; stripRevealChip(strip, strip.querySelector('[aria-checked="true"]'), false); }
  paintStripOverflow(strip);
  const dow = SETUP_DK.indexOf(m.dk);
  const blocks = dow === rainDow() ? rainView(setupTree, rainEnsure(), dow).after : planForDow(dow);
  const gamesFor = (b) => allGames().filter((x) => x.blockId === b.id && (competitionDays().find((d) => d.id === x.dayId) || {}).dow === dow && x.id !== g.id);
  const first = blocks.filter((b) => b.type === 'games' || gamesFor(b).length);
  const rest = blocks.filter((b) => first.indexOf(b) === -1 && !b.noTime);
  const row = (b) => '<button type="button" class="cb-row" data-bid="' + esc(b.id) + '"><span class="cb-time">' + esc(schedClock(b.start, false)) + '<small>–' + esc(rainClock(b.end)) + '</small></span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.label) + '</span></span>' +
    (gamesFor(b).length ? '<span class="cb-sub">' + hubPlural(gamesFor(b).length, 'game', 'games') + '</span>' : '') + '</span><span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
  setHtmlIfChanged(setupEl('rain-move-list'), first.map(row).join('') + (m.all ? rest.map(row).join('') : ''));
  setHiddenIfChanged(setupEl('rain-move-all'), m.all || !rest.length);
  setTextIfChanged(setupEl('rain-move-all-text'), m.dk === rainDk() ? 'Other items today' : 'Other items on ' + SETUP_DAY_WORDS[m.dk]);
  setHiddenIfChanged(setupEl('rain-move-double'), !m.ask);
  if (m.ask) setTextIfChanged(setupEl('rain-move-double-text'), 'That item has double-points games. Make ' + g.name + ' double points too?');
}

// Moving a game onto an item: its day follows the item's weekday, its session the item's time, its order after what the
// item holds; onto an item of double-points games the director is asked first.
function rainPickMove(bid, doubleAnswer) {
  const g = gameById(setupRain.gid);
  const m = setupRain.move;
  if (!g) return;
  const dow = SETUP_DK.indexOf(m.dk);
  const blocks = dow === rainDow() ? rainView(setupTree, rainEnsure(), dow).after : planForDow(dow);
  const block = blocks.find((b) => b.id === bid);
  if (!block) return;
  const dayRec = competitionDays().find((d) => d.dow === dow && d.id === g.dayId) || competitionDays().find((d) => d.dow === dow);
  if (!dayRec) return;
  const there = allGames().filter((x) => x.blockId === bid && (competitionDays().find((d) => d.id === x.dayId) || {}).dow === dow && x.id !== g.id);
  const doubles = there.some((x) => x.messtival === true) && g.messtival !== true;
  if (doubles && doubleAnswer === undefined) { m.ask = { bid }; renderRainItemSheet(); return; }
  const top = there.reduce((o, x) => Math.max(o, Number.isFinite(x.ord) ? x.ord : 0), 0);
  const to = { blockId: bid, dayId: dayRec.id, session: rainSessionFor(state.config, block), ord: top + SETUP_GAME_ORD_STEP };
  if (doubles) to.messtival = doubleAnswer === 'yes';
  m.ask = null;
  rainStageNow((plan) => rainStageGame(plan, g, to));
  shellSheetClose('rain-item');
}

function rainMoveNone() {
  const g = gameById(setupRain.gid);
  if (!g) return;
  rainStageNow((plan) => rainStageGame(plan, g, { blockId: null }));
  shellSheetClose('rain-item');
}

function rainAct(act) {
  const b = setupRain.bid ? rainBlock(setupRain.bid) : null;
  if (!b) return;
  const plan = rainEnsure();
  const dk = rainDk();
  if (act === 'swap') { setupRain.swap = { other: null, showEarlier: false, placed: false }; rainSetPane('swap', { keepScroll: true }); return; }
  if (act === 'time') { setupRain.time = { init: false }; rainSetPane('time'); return; }
  if (act === 'games') { rainSetPane('games'); return; }
  if (act === 'earlier' || act === 'later') {
    const moves = rainNudge(rainView(setupTree, plan, rainDow()).after, b.id, act === 'earlier' ? -1 : 1);
    if (!moves) return;
    rainStageNow(() => rainStageMoves(moves));
    shellSheetClose('rain-item');
    return;
  }
  if (act === 'skip') {
    const gms = rainGamesByBlock()[b.id] || [];
    rainStageNow((p) => rainStageFields(p, setupTree, dk, b.id, { off: true }));
    if (gms.length) rainSetPane('games'); else shellSheetClose('rain-item');
    return;
  }
  if (act === 'reset') { rainStageNow((p) => rainUnstage(p, dk, b.id)); shellSheetClose('rain-item'); }
}

function rainPickSwap(bid) {
  const b = rainBlock(setupRain.bid);
  const other = rainBlock(bid);
  if (!b || !other || b.id === other.id) return;
  setupRain.swap.other = bid;
  if (b.end - b.start === other.end - other.start) { rainStageNow(() => rainStageMoves(rainSwapSlots(b, other))); shellSheetClose('rain-item'); return; }
  rainSetPane('how');
}

function rainPickHow(how) {
  const b = rainBlock(setupRain.bid);
  const other = rainBlock(setupRain.swap.other);
  if (!b || !other) return;
  const moves = how === 'slots' ? rainSwapSlots(b, other) : rainSwapLengths(b, other);
  if (!moves) return;
  rainStageNow(() => rainStageMoves(moves));
  shellSheetClose('rain-item');
}

function rainUseTime() {
  const b = rainBlock(setupRain.bid);
  const t = setupRain.time;
  if (!b || !t) return;
  if (!(t.start >= 0 && t.start <= 1439) || !(t.end > t.start && t.end <= 1440)) return;
  const r = rainRetime(rainTimed(rainView(setupTree, rainEnsure(), rainDow()).after), b.id, t.start, t.end, t.ripple);
  rainStageNow(() => rainStageMoves(r.moves));
  shellSheetClose('rain-item');
}

// ── Done ──

function rainClashRows(plan) {
  const out = [];
  rainClashes(setupTree, plan).forEach((c) => {
    const parts = c.path.split('/');
    const b = rainBlock(parts[2]) || { label: parts[2] };
    out.push({ key: c.path, label: b.label, field: parts[3], mine: c.mine, theirs: c.theirs, game: false });
  });
  rainGameClashes(state.config, plan).forEach((c) => out.push({ key: 'game:' + c.gid, label: c.game.name, field: 'place', mine: null, theirs: null, game: true }));
  return out;
}

function rainClashValue(row, which) {
  if (row.game) return which === 'mine' ? 'your move' : 'their move';
  const v = which === 'mine' ? row.mine : row.theirs;
  if (v === null || v === undefined) return row.field === 'off' ? 'not skipped' : 'as planned';
  if (row.field === 'start' || row.field === 'end') return schedClockWords(v);
  if (row.field === 'off') return 'skipped';
  return String(v);
}

function renderRainDoneSheet() {
  const plan = rainEnsure();
  const dow = rainDow();
  const day = rainDayName();
  const c = rainChanges(setupTree, plan, dow, state.config);
  const n = c.lines.length;
  setTextIfChanged(setupEl('rain-sum-title'), n ? hubPlural(n, 'change', 'changes') + ' to ' + day : 'Nothing to change');
  const clashRows = rainClashRows(plan);
  setHiddenIfChanged(setupEl('rain-clashes'), !clashRows.length);
  setHtmlIfChanged(setupEl('rain-clashes'), clashRows.map((r, i) => {
    const q = 'rain-clash-q-' + i;
    const btn = (who, which) => '<button type="button" class="seg-btn" role="radio" aria-checked="' + (setupRain.picks[r.key] === which) + '" data-rain-clash="' + esc(r.key) + '" data-pick="' + which + '"><span class="clash-who">' + who + '</span><span class="clash-val">' + esc(rainClashValue(r, which)) + '</span></button>';
    return '<div class="clash"><p class="clash-q" id="' + q + '">While you were planning, someone changed <b>' + esc(r.label) + '</b></p><div class="seg clash-pick" role="radiogroup" aria-labelledby="' + q + '">' + btn('Use yours', 'mine') + btn('Keep theirs', 'theirs') + '</div></div>';
  }).join(''));
  setHtmlIfChanged(setupEl('rain-sum-list'), c.lines.map((l) => {
    let text;
    if (l.kind === 'time') text = '<b>' + esc(l.label) + '</b> now ' + esc(setupRange(l.start, l.end)) + ' <s>' + esc(setupRange(l.was.start, l.was.end)) + '</s>';
    else if (l.kind === 'skip') text = '<b>' + esc(l.label) + '</b> skipped today';
    else if (l.kind === 'add') text = '<b>' + esc(l.label) + '</b> added, ' + esc(setupRange(l.start, l.end));
    else {
      const to = l.to;
      const dayRec = to.blockId ? (competitionDays().find((d) => d.id === to.dayId) || {}) : null;
      const blk = dayRec && Number.isInteger(dayRec.dow) ? planForDow(dayRec.dow).find((x) => x.id === to.blockId) : null;
      text = '<b>' + esc(l.label) + '</b> ' + (to.blockId ? 'moves to ' + (dayRec && Number.isInteger(dayRec.dow) ? (dayRec.dow === dow ? 'today' : SETUP_DAY_WORDS[SETUP_DK[dayRec.dow]]) : 'another day') + (blk ? ' · ' + esc(setupHeadLabel(blk.label)) : '') : 'comes off the schedule');
    }
    return '<li class="rain-sum-li"><span class="sched-emo" aria-hidden="true">' + esc(l.emoji) + '</span><span class="rain-sum-text">' + text + '</span></li>';
  }).join(''));
  // ALWAYS said: overlaps and new gaps, or that there are none.
  const verdict = rainVerdict(c.before, c.after);
  const lines = verdict.map((v) => v.kind === 'overlap'
    ? setupHeadLabel(v.a.label) + ' overlaps ' + setupHeadLabel(v.b.label) + ', ' + setupRange(v.start, v.end)
    : 'There is a gap from ' + setupRange(v.start, v.end));
  const vEl = setupEl('rain-verdict');
  const tone = verdict.length ? 'warn' : 'ok';
  if (vEl && vEl.dataset && vEl.dataset.tone !== tone) vEl.dataset.tone = tone;
  setHtmlIfChanged(setupEl('rain-verdict-lines'), (lines.length ? lines : ['Nothing overlaps.']).map((t) => '<p class="rain-verdict-line">' + esc(t) + '</p>').join(''));
  // "Tell people who get reminders for these": only when phone alerts are live and the day is today or later in the camp
  // week; ticked for a time that moved or an item skipped (ux-R11). The choice is kept as an intent for the alert sender
  // (Step 26); nothing is sent from here.
  const tellable = typeof pushConfigured === 'function' && pushConfigured() && campWeek().phase === 'during' && dow >= campNow().dow && c.lines.some((l) => l.kind === 'time' || l.kind === 'skip');
  setHiddenIfChanged(setupEl('rain-tell'), !tellable);
  const tellBox = setupEl('rain-tell-check');
  if (tellable && tellBox && !setupRain.tellSet) { setupRain.tellSet = true; tellBox.toggleAttribute('checked', true); }
  setHiddenIfChanged(setupEl('rain-offline'), restoreOnline() || !restoreHasFirebase());
  const waiting = clashRows.find((r) => !setupRain.picks[r.key]);
  const commit = setupEl('rain-commit');
  if (commit) {
    setTextIfChanged(commit, waiting ? 'Pick one for ' + waiting.label + ' first' : 'Done');
    if (waiting) commit.setAttribute('aria-disabled', 'true'); else commit.removeAttribute('aria-disabled');
  }
}

function rainOpenDone() {
  const plan = rainEnsure();
  if (!Object.keys(plan.items).length && !Object.keys(plan.games).length) { rainFinish(false); return; }
  setupRain.picks = {};
  setupSheet('rain-done', setupEl('rain-done'));
}

// Back to the day's schedule after Done, Discard or Done with nothing staged.
function rainFinish(wrote) {
  setupRain.plan = null;
  rainDraftDrop();
  shellSheetClose('rain-done');
  shellSheetClose('rain-item');
  if (rainBackHome()) return;
  state.ui.setupDay = rainDk();
  setupGo('schedule');
}

// Opened from the home schedule sheet: leave the builder for Now and put that sheet back up. false otherwise.
function rainBackHome() {
  if (setupRain.cameFrom !== 'now') return false;
  setupRain.cameFrom = '';
  state.ui.builderScreen = 'hub'; // nothing stale for the next More → Set up the week
  setupCloseBuilder();
  if (typeof openSchedule === 'function') openSchedule();
  return true;
}

async function rainCommit() {
  const plan = rainEnsure();
  const dow = rainDow();
  const day = rainDayName();
  const rows = rainClashRows(plan);
  if (rows.some((r) => !setupRain.picks[r.key])) return;
  const keepPaths = rows.filter((r) => !r.game && setupRain.picks[r.key] === 'theirs').map((r) => r.key);
  const keepGames = rows.filter((r) => r.game && setupRain.picks[r.key] === 'theirs').map((r) => r.key.slice(5));
  const hasGames = Object.keys(plan.games).length > 0;
  const label = 'Rain plan for ' + day;
  const r = setupCombined(label, (d) => rainCommitMutate(d, plan, keepPaths), hasGames ? () => rainApplyGames(state.config, plan, keepGames) : null);
  if (!r.ok) {
    if (r.reason === 'config-loading') setupSay('Still loading the games list — try again in a moment.');
    else weekRefused(r);
    return;
  }
  const tell = setupEl('rain-tell-check');
  if (tell && !setupEl('rain-tell').hidden && tell.hasAttribute('checked')) setupAlertIntentAdd({ at: Date.now(), dk: rainDk(), label, lines: rainChanges(setupTree, plan, dow, state.config).lines.map((l) => ({ kind: l.kind, id: l.id })) });
  const online = restoreOnline() || !restoreHasFirebase();
  rainFinish(true);
  if (!online) setupSay('Saved on your phone only. Nobody else has this yet — it goes out when you have signal.');
}

// The director's "tell people" choice, kept for the alert sender (Step 26) and wiped on sign-out.
function setupAlertIntentAdd(entry) {
  try {
    const key = lsKey('campSetupAlertIntent');
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push(entry);
    localStorage.setItem(key, JSON.stringify(list.slice(-10)));
  } catch (e) { /* the sender is not built yet: losing the intent loses nothing else */ }
}

async function rainDiscard() {
  const ok = await askDialog({ title: 'Discard the rain plan?', body: ['Nothing was saved for anyone. This throws the plan away.'], actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Discard the plan', value: 'go', kind: 'danger' }] });
  if (ok === 'go') rainFinish(false);
}

// One plain line to add a one-off for the day: the item sheet in staging mode (the same fields and questions).
function rainAddItem(opener) {
  const dk = rainDk();
  const blocks = rainView(setupTree, rainEnsure(), rainDow()).after;
  const last = blocks.length ? Math.min(1380, Math.max.apply(null, blocks.map((x) => x.end))) : 8 * 60;
  schedOpenItem({ dayKey: dk, stage: true, start: last >= 1380 ? 9 * 60 : last, opener });
}

function wireRainPlan() {
  const on = (sel, ev, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); };
  on('#setup-rain', 'click', (e) => {
    const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
    let b;
    if ((b = q('[data-rain-bring]'))) { rainStageNow((p) => rainStage(p, setupTree, rainPath(setupTree, rainDk(), b.dataset.rainBring, 'off'), null)); }
    else if ((b = q('.rain-game'))) rainOpenMove(b.dataset.gid, 'list', b);
    else if ((b = q('button.rain-row[data-bid]'))) rainOpenItem(b.dataset.bid, b);
    else if (q('[data-rain-expand]')) { setupRain.expanded = true; setupRain.unfold = true; renderAll(); }
    else if (q('#rain-add')) rainAddItem(q('#rain-add'));
    else if (q('#rain-done')) rainOpenDone();
  });
  const sheet = setupEl('sheet-rain-item');
  const moveDays = setupEl('rain-move-days');
  if (moveDays) moveDays.addEventListener('scroll', () => paintStripOverflow(moveDays), { passive: true });
  if (sheet) {
    sheet.addEventListener('click', (e) => {
      const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
      let b;
      if (q('#rain-pane-back')) {
        const p = setupRain.pane;
        if (p === 'how') rainSetPane('swap', { keepScroll: true, back: true }); else if (p === 'move' && setupRain.from === 'games') rainSetPane('games', { back: true }); else rainSetPane('actions', { back: true });
      }
      else if ((b = q('[data-rain-act]'))) { if (!b.hasAttribute('aria-disabled')) rainAct(b.dataset.rainAct); }
      else if (q('#rain-swap-earlier')) { setupRain.swap.showEarlier = true; renderRainItemSheet(); }
      else if ((b = q('#rain-swap-list button.rain-pick[data-bid]'))) rainPickSwap(b.dataset.bid);
      else if ((b = q('[data-rain-how]'))) { if (!b.hasAttribute('aria-disabled')) rainPickHow(b.dataset.rainHow); }
      else if (q('#rain-time-use')) { if (!q('#rain-time-use').hasAttribute('aria-disabled')) rainUseTime(); }
      else if ((b = q('[data-rain-move]'))) rainOpenMove(b.dataset.rainMove, 'games');
      else if ((b = q('#rain-move-days [data-dk]'))) { setupRain.move.dk = b.dataset.dk; setupRain.move.ask = null; renderRainItemSheet(); }
      else if (q('#rain-move-all')) { setupRain.move.all = true; renderRainItemSheet(); }
      else if (q('#rain-move-none')) rainMoveNone();
      else if ((b = q('[data-rain-double]'))) rainPickMove(setupRain.move.ask && setupRain.move.ask.bid, b.dataset.rainDouble);
      else if ((b = q('#rain-move-list button[data-bid]'))) rainPickMove(b.dataset.bid);
    });
    sheet.addEventListener('change', (e) => {
      const t = e.target;
      const tt = setupRain.time;
      if (!tt || !tt.init) return;
      if (t.id === 'rain-start') { const v = schedInputToMin(t.value); if (!Number.isNaN(v)) { const len = tt.end - tt.start; tt.start = v; if (tt.end < 1440 && tt.end <= tt.start) tt.end = Math.min(1440, v + Math.max(5, len > 0 ? len : 45)); } }
      else if (t.id === 'rain-end') { const v = schedInputToMin(t.value); if (!Number.isNaN(v)) tt.end = v === 0 ? 1440 : v; }
      else if (t.id === 'rain-allday') { tt.allday = !!t.checked; tt.end = tt.allday ? 1440 : Math.min(1439, tt.start + 45); }
      else if (t.id === 'rain-ripple') tt.ripple = !!t.checked;
      else return;
      renderRainItemSheet();
    });
  }
  const done = setupEl('sheet-rain-done');
  if (done) done.addEventListener('click', (e) => {
    const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
    let b;
    if ((b = q('[data-rain-clash]'))) { setupRain.picks[b.dataset.rainClash] = b.dataset.pick; renderRainDoneSheet(); }
    else if (q('#rain-commit')) { if (!q('#rain-commit').hasAttribute('aria-disabled')) rainCommit(); }
    else if (q('#rain-keep')) shellSheetClose('rain-done');
    else if (q('#rain-discard')) rainDiscard();
  });
}

// The home schedule sheet's way in (editors only; §11.1, ux-R18): with the schedule edited here "Change today's plan"
// (another day's name when it isn't today); otherwise one line pointing at Set up the week. Never a button that leads to
// a refusal. Called from app.js renderSchedule.
function renderSchedulePlan(dow) {
  const box = document.getElementById('schedule-plan');
  if (!box) return;
  const show = typeof canEdit === 'function' && canEdit();
  setHiddenIfChanged(box, !show);
  if (!show) return;
  const shared = scheduleIsShared();
  setHiddenIfChanged(setupEl('schedule-plan-btn'), !shared);
  setHiddenIfChanged(setupEl('schedule-plan-note'), shared);
  if (shared) {
    const today = campNow().dow;
    const d = Number.isInteger(dow) ? dow : today;
    setTextIfChanged(setupEl('schedule-plan-text'), d === today ? 'Change today’s plan' : 'Change ' + SETUP_DAY_WORDS[SETUP_DK[d]] + '’s plan');
    box.dataset.dow = String(d);
  }
}

function wireSchedulePlan() {
  const btn = setupEl('schedule-plan-btn');
  if (btn) btn.addEventListener('click', () => {
    const box = setupEl('schedule-plan');
    const d = Number(box && box.dataset && box.dataset.dow);
    if (typeof closeSchedule === 'function') closeSchedule();
    rainOpen(SETUP_DK[Number.isInteger(d) && d >= 0 && d <= 6 ? d : campNow().dow], { from: 'now' });
  });
  const hub = setupEl('schedule-plan-hub');
  if (hub) hub.addEventListener('click', () => {
    if (typeof closeSchedule === 'function') closeSchedule();
    openBuilder();
  });
}

function wireSetupUi() {
  if (setupUi.wired) return;
  setupUi.wired = true;
  const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(ev, fn); };
  on('#setup-back', 'click', () => { setupBack(); });
  on('#setup-menu-btn', 'click', (e) => setupSheet('setup-menu', e.currentTarget));
  on('#setup-sync-act', 'click', setupToggleDetails);
  on('#setup-sync', 'click', (e) => { const a = setupEl('setup-sync-act'); if (a && !a.hidden && e.target !== a && !a.contains(e.target)) setupToggleDetails(); });
  on('#setup-here', 'click', () => { setupShowWhoIsHere(); });
  // The hub: a tap on a row that opens something.
  on('#setup-hub', 'click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('button[data-hub-row]') : null;
    if (row) hubOpen(row.dataset.hubRow);
  });
  on('#hub-next', 'click', (e) => { const k = e.currentTarget.dataset.hubOpen; if (k) hubOpen(k); });
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', () => { if (setupUi.wasOpen) paintSetupFit(); });
  on('#hub-door-btn', 'click', () => {
    const door = setupEl('hub-door');
    const fn = HUB_DOOR_ACTIONS[door && door.dataset.door];
    if (typeof fn === 'function' && typeof isOwner === 'function' && isOwner()) fn();
  });
  wireScheduleScreen();
  wireRainPlan();
  wireSchedulePlan();
  wireSecScreens();
  // Camp week (§11.4): dates, the Days tick sheet, double points, the TV finale.
  on('#week-start', 'change', (e) => weekSetStart(e.target.value));
  on('#week-days', 'click', (e) => { const t = e.target.closest && e.target.closest('.wk-tick'); const row = t && t.closest('.wk-day'); if (t && row) weekTick(Number(row.dataset.dow), t.dataset.weekFollow); });
  on('#week-double-on', 'change', (e) => weekSaveDouble(!!e.target.checked));
  ['#week-double-from', '#week-double-at', '#week-double-until'].forEach((id) => on(id, 'change', () => weekSaveDouble(true)));
  on('#week-finale', 'change', (e) => weekSetFinale(e.target.value));
  on('#week-wizard', 'click', () => { const fn = HUB_DOOR_ACTIONS['new-year']; if (typeof fn === 'function' && isOwner()) fn(); });
  ['week', 'sched'].forEach((pre) => on('#' + pre + '-door-btn', 'click', () => { if (isOwner()) setupEditTheWeek(); }));
  // Undo: the pill and the dock are one gesture each; a long press on the dock opens Recent changes.
  on('#setup-undo', 'click', () => setupUndoRun(setupUi.pill.id));
  const dock = setupEl('setup-undo-dock');
  if (dock) {
    const p = setupUi.pill;
    dock.addEventListener('pointerdown', () => {
      p.longFired = false;
      clearTimeout(p.press);
      p.press = setTimeout(() => { p.longFired = true; setupSheet('setup-changes', dock); }, UNDO_LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(p.press);
    dock.addEventListener('pointerup', cancel);
    dock.addEventListener('pointercancel', cancel);
    dock.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 12) cancel(); });
    dock.addEventListener('click', () => {
      if (p.longFired) { p.longFired = false; return; }
      const top = undoTop();
      if (top) setupUndoRun(top.id);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (!setupUi.wasOpen || !builderOpen() || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return;
    if (textEntryFocused() || shell.sheets.length) return;
    const top = undoTop();
    if (!top) return;
    e.preventDefault();
    setupUndoRun(top.id);
  });
  // The sheets.
  const menu = setupEl('sheet-setup-menu');
  if (menu) menu.addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('[data-setup-act]'); if (r) setupMenuAct(r.dataset.setupAct, r); });
  const changes = setupEl('sheet-setup-changes');
  if (changes) changes.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-undo-id]'); if (b) setupUndoRun(b.dataset.undoId); });
  // Restore points.
  on('#rp-save-btn', 'click', () => { rpSaveManual(); });
  on('#setup-backups', 'click', (e) => { const r = e.target.closest && e.target.closest('[data-rp-open]'); if (r) openRestoreSheet(r.dataset.rpOpen, r); });
  on('#backup-download-btn', 'click', rpDownloadBackup);
  on('#backup-file-input', 'change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) rpRestoreFile(f); });
  document.querySelectorAll('[data-rp-pick]').forEach((cb) => cb.addEventListener('change', () => {
    const rs = setupUi.rsheet;
    if (!rs) return;
    rs.picks[cb.dataset.rpPick] = !!cb.checked;
    rs.reveal = false;
    renderRestoreSheet();
  }));
  on('#rp-restore-btn', 'click', () => { rpApply(); });
  // Belt and braces for the same hazard with a mouse or a hybrid pointer: "Yes" counts only when the press
  // began on it (or comes from a key or assistive tech, detail 0), never a click left over from the tap that
  // revealed it.
  let confirmArmed = false;
  on('#rp-hold-confirm', 'pointerdown', () => { confirmArmed = true; });
  on('#rp-hold-confirm', 'click', (e) => { const ok = confirmArmed || e.detail === 0; confirmArmed = false; if (ok) rpApply(); });
  const hold = setupEl('rp-hold-btn');
  // The button under the finger goes when the alternative shows, so focus follows it (and back on Cancel).
  const focusOn = (id) => { const b = setupEl(id); if (b && !b.hidden && typeof b.focus === 'function') { try { b.focus({ preventScroll: true }); } catch (e) { /* fine */ } } };
  if (hold) wireHold(hold, () => { rpApply(); }, () => { if (setupUi.rsheet && shell.sheets.includes('restore')) { setupUi.rsheet.reveal = true; renderRestoreSheet(); focusOn('rp-hold-confirm'); } });
  on('#rp-hold-cancel', 'click', () => { if (setupUi.rsheet) { setupUi.rsheet.reveal = false; renderRestoreSheet(); focusOn('rp-hold-btn'); } });
  on('#rp-keep-row', 'click', () => { rpKeepPoint(); });
  on('#rp-delete-row', 'click', () => { rpDeletePoint(); });
  // askDialog: a choice resolves it; Escape, the ✕ and the backdrop reach us as Jelly's own `close`.
  on('#ask-actions', 'click', (e) => { const b = e.target.closest && e.target.closest('[data-ask-i]'); if (b) askFinish(Number(b.dataset.askI), false); });
  on('#ask-body', 'keydown', (e) => {
    if (e.key !== 'Enter' || !askState || !askState.input) return;
    const i = askState.actions.findIndex((a) => a.kind === 'gold');
    if (i !== -1) { e.preventDefault(); askFinish(i, false); }
  });
  on('#ask-dialog', 'close', () => askFinish(null, true));
  if (typeof onSetupEvent === 'function') onSetupEvent(setupUiOnEvent);
}

// ── 12. Meals, memory verses, the cleanup rota, electives (§11.10–11.13 — Step 19) ──────────────────
// Four screens in the Step 14 / 15 frame, in the same clipboard language. While a section is the ORIGINAL its screen is a
// read-only preview of the printed data (every control disabled; its door says so: the owner's Turn on, everyone else "Patrick
// turns it on."); once it is on, every edit is one commitSetup (setup-sync.js section 10) and the undo pill is the way back.
// Rows that hold inputs (a meal) are patched in place by key and never rebuilt under a focused field; a commit happens on blur
// and only when the value changed since it gained focus (§6.4.9), so tabbing across the menu rewrites nothing.

const secUi = {
  teams: null,       // the open cleanup sheet: { dk, meal, name, picked: [ids], was: [ids] }
  person: null,      // the open "Add someone" sheet: { dk, slot, st }
  station: null,     // the open station sheet: { mode: 'add' | 'edit', dk, slot, st }
  stripDay: undefined,
  versesBuilt: false,
};
const SEC_MEAL_ICONS = { breakfast: '🍳', lunch: '🥪', supper: '🍲' };

function secOn(section) {
  return typeof sectionIsShared === 'function' && sectionIsShared(section);
}
// The controls work only for a director, on a section that is edited here.
function secLive(section) {
  return secOn(section) && canEdit();
}
function secTree(section) {
  return secOn(section) ? setupTree : setupBuiltInSections();
}

// The days a screen is about: Mon–Fri, or for the menus every day that has a Meal item (Sunday supper, Saturday breakfast).
function secDays(section) {
  if (section === 'meals') {
    const d = SETUP_DK.filter((dk, dow) => secMealItems(dow).length);
    if (d.length) return d;
  }
  return hubCompetitionDks();
}
function secDayKey(section) {
  const days = secDays(section);
  const v = state.ui && state.ui.secDay;
  if (days.indexOf(v) !== -1) return v;
  const wk = typeof campWeek === 'function' ? campWeek() : { phase: 'unset' };
  const today = SETUP_DK[campNow().dow];
  return wk.phase === 'during' && days.indexOf(today) !== -1 ? today : days[0];
}
function secSetDay(dk) {
  if (SETUP_DK.indexOf(dk) === -1) return;
  state.ui.secDay = dk;
  saveState();
  renderAll();
}
function secSlotNow() {
  const v = state.ui && state.ui.secSlot;
  return v === 1 || v === 2 ? v : 0;
}
function secSetSlot(n) {
  if (![0, 1, 2].includes(n)) return;
  state.ui.secSlot = n;
  saveState();
  renderAll();
}

// "12:00<small>PM</small>" for a time column.
function secTimeHtml(min) {
  const t = setupClock(min).split(' ');
  return esc(t[0]) + (t[1] ? '<small>' + esc(t[1]) + '</small>' : '');
}

// A refused commit in the words a section's screen uses (everything else is the Camp week's).
function secRefused(r, section) {
  if (r && !r.ok && r.reason === 'off') { setupSay('Turn on editing for ' + HUB_SECTION_NOUNS[section] + ' first.'); return; }
  weekRefused(r);
}

// ── the door, the strip, the shared paint ──

function secPaintDoor(section) {
  const on = secOn(section);
  const held = !!(hubSetupMeta().on && hubSetupMeta().on[section] === false);
  const name = hubCap(typeof ownerName === 'function' ? ownerName() : 'the owner');
  paintPreviewDoor(section, !on, {
    lead: held ? 'Showing the original · your edits are kept' : hubCap(HUB_SECTION_NOUNS[section]) + ' can now be edited here too.',
    btn: 'Turn on', ownerText: name + ' turns it on.',
  });
  // The owner's way back, only while the section is on (nobody else is ever offered a switch).
  setHiddenIfChanged(setupEl(section + '-original'), !(on && typeof isOwner === 'function' && isOwner()));
}

// Which days carry a gold "!": the same judgement as the hub's row, day by day.
function secDayIssue(section, dk) {
  if (!secOn(section)) return false;
  const dow = SETUP_DK.indexOf(dk);
  if (section === 'meals') {
    const any = SETUP_DK.some((k) => SETUP_MEAL_KEYS.some((m) => setupMealRecord(setupTree, k, m)));
    const listed = SETUP_MEAL_KEYS.some((m) => setupMealRecord(setupTree, dk, m));
    return any && (hubCompetitionDks().indexOf(dk) !== -1 || listed) && secMealItems(dow).some((it) => !setupMealRecord(setupTree, dk, it.meal));
  }
  if (section === 'cleanup') return secMealItems(dow).some((it) => !setupCleanupIds(setupTree, dk, it.meal).length) && SETUP_DK.some((k) => setupCleanupTracked(setupTree, k));
  if (section === 'electives') {
    return planForDow(dow).some((b) => b.type === 'elective' && Number.isInteger(b.slot) && (!setupElectiveRows(setupTree, dk, b.slot).length || setupElectiveRows(setupTree, dk, b.slot).some((r) => !r.people.length)));
  }
  return false;
}

function renderSecStrip(section, dk) {
  const track = setupEl('sec-days-track');
  if (!track || !track.querySelectorAll) return;
  const days = secDays(section);
  const todayKey = schedTodayKey();
  const during = typeof campWeek === 'function' && campWeek().phase === 'during';
  track.querySelectorAll('.daypick-btn[data-day]').forEach((btn) => {
    const d = btn.dataset.day;
    setHiddenIfChanged(btn, days.indexOf(d) === -1);
    const sel = d === dk;
    if (btn.getAttribute('aria-selected') !== String(sel)) btn.setAttribute('aria-selected', String(sel));
    const isToday = d === todayKey && during;
    if (isToday !== btn.hasAttribute('data-today')) { if (isToday) btn.setAttribute('data-today', ''); else btn.removeAttribute('data-today'); }
    const issue = secDayIssue(section, d);
    setHiddenIfChanged(btn.querySelector('[data-sd-warn]'), !issue);
    btn.setAttribute('aria-label', SETUP_DAY_WORDS[d] + (isToday ? ', today' : '') + (issue ? ', something to check' : ''));
  });
  // The chosen day stays in view (once per change; the strip scrolls sideways at large text).
  if (secUi.stripDay !== dk && track.clientWidth > 0) {
    const prev = secUi.stripDay;
    secUi.stripDay = dk;
    stripRevealChip(track, track.querySelector('.daypick-btn[aria-selected="true"]'), prev !== undefined);
    const chip = prev !== undefined && track.querySelector('.daypick-btn[aria-selected="true"]');
    if (chip && typeof JellyMotion !== 'undefined') JellyMotion.play(chip, 'snap', (x) => ({ transform: 'scale(' + (0.86 + 0.14 * x) + ',' + (1.1 - 0.1 * x) + ')' }), { calm: false });
  }
  paintStripOverflow(track);
}

// Rows keyed `data-key`: the list is written only when its SET of rows changes; otherwise each row is patched in place
// (a focused field keeps its text and its caret).
function secPaintKeyed(list, rows, build, patch) {
  if (!list) return;
  const have = Array.prototype.map.call(list.children || [], (el) => el.dataset && el.dataset.key).join('|');
  if (have !== rows.map((r) => r.key).join('|')) list.innerHTML = rows.map(build).join('');
  rows.forEach((r) => { const el = list.querySelector('[data-key="' + r.key + '"]'); if (el && patch) patch(el, r); });
}

function secSetValue(input, value) {
  if (!input) return;
  if (document.activeElement !== input && input.value !== value) input.value = value;
}
function secSetDisabled(el, disabled) {
  if (!el) return;
  if (!!el.disabled !== disabled) el.disabled = disabled;
}

// ── Meals (§11.10) ──

function secMealRowHtml(r) {
  const label = r.it.name;
  return '<div class="cb-row sec-meal" data-key="' + esc(r.key) + '" data-meal="' + esc(r.it.meal) + '">' +
    '<span class="cb-time">' + secTimeHtml(r.it.start) + '</span>' +
    '<span class="cb-main"><span class="sec-meal-head"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + (SEC_MEAL_ICONS[r.it.meal] || '🍽️') + '</span><span>' + esc(label) + '</span></span>' +
    '<input type="text" class="fld-input sec-emoji" data-meal-emoji maxlength="16" autocomplete="off" placeholder="🍽️" aria-label="' + esc(label) + ' — emoji"></span>' +
    '<input type="text" class="fld-input sec-dish" data-meal-dish maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="What’s being served" aria-label="' + esc(label) + ' — what’s being served"></span>' +
    '<span class="cb-end"></span></div>';
}

function renderMealsScreen() {
  const live = secLive('meals');
  const tree = secTree('meals');
  const dk = secDayKey('meals');
  const dow = SETUP_DK.indexOf(dk);
  const items = secMealItems(dow);
  const dishes = items.filter((it) => setupMealRecord(tree, dk, it.meal)).length;
  setTextIfChanged(setupEl('meals-title'), 'Meals · ' + CAMP.label);
  setTextIfChanged(setupEl('meals-headline'), SETUP_DAY_WORDS[dk]);
  setTextIfChanged(setupEl('meals-lede'), !items.length ? 'No meals on this day'
    : hubPlural(items.length, 'meal', 'meals') + ' · ' + (dishes === items.length ? 'every one has a dish' : dishes ? dishes + ' with a dish' : 'no dishes yet'));
  const rows = items.map((it) => ({ key: 'm-' + it.meal, it, rec: setupMealRecord(tree, dk, it.meal) }));
  secPaintKeyed(setupEl('meals-list'), rows, secMealRowHtml, (el, r) => {
    const dish = el.querySelector('[data-meal-dish]');
    const emo = el.querySelector('[data-meal-emoji]');
    // The rows are kept from day to day (same meals), so what differs by day — the time — is patched too.
    setHtmlIfChanged(el.querySelector('.cb-time'), secTimeHtml(r.it.start));
    secSetValue(dish, r.rec ? r.rec.dish : '');
    secSetValue(emo, r.rec && r.rec.emoji ? r.rec.emoji : '');
    secSetDisabled(dish, !live);
    secSetDisabled(emo, !live);
  });
  setHiddenIfChanged(setupEl('meals-empty'), items.length > 0);
  setTextIfChanged(setupEl('meals-empty-text'), 'This day has no meal items. Mark an item as a meal on the Schedule screen and it shows up here.');
  const from = secMealCopySources(dk);
  setHiddenIfChanged(setupEl('meals-copy'), !(live && items.length && from.length));
}

// The days whose menu could be copied here: another day with at least one dish.
function secMealCopySources(dk) {
  return SETUP_DK.filter((k) => k !== dk && SETUP_MEAL_KEYS.some((m) => setupMealRecord(setupTree, k, m)));
}

// The value of one meal row's two inputs as the canonical record (null = no dish), for the "changed since focus" test.
function secMealTyped(row) {
  const dish = setupCap((row.querySelector('[data-meal-dish]') || {}).value, 80);
  const emoji = safeEmoji((row.querySelector('[data-meal-emoji]') || {}).value, '');
  if (!dish) return { dish: '', emoji: '', rec: null };
  return { dish, emoji, rec: emoji ? { dish, emoji } : { dish } };
}

function secMealFocusIn(row) {
  if (!row || !secLive('meals')) return;
  setupFocusIn('meals/' + secDayKey('meals') + '/' + row.dataset.meal);
}
function secMealFocusOut(row) {
  if (!row || !secLive('meals')) return;
  const dk = secDayKey('meals');
  const meal = row.dataset.meal;
  const t = secMealTyped(row);
  const f = setupFocusOut('meals/' + dk + '/' + meal, t.rec);
  if (!f.changed) return;
  const r = mealsSet(dk, meal, t.dish, t.emoji);
  if (!r.ok) { secRefused(r, 'meals'); renderMealsScreen(); }
}

async function secMealCopy() {
  if (!secLive('meals')) return;
  const dk = secDayKey('meals');
  const from = secMealCopySources(dk);
  if (!from.length) { setupSay('No other day has a menu to copy yet.'); return; }
  const pick = await askDialog({
    title: 'Copy a menu to ' + SETUP_DAY_WORDS[dk] + '?',
    body: [SETUP_DAY_WORDS[dk] + '’s dishes are replaced by the day you pick. Undo is right there if it’s the wrong one.'],
    actions: [{ label: 'Not now', value: 'no', cancel: true }].concat(from.slice(0, 6).map((k) => ({ label: SETUP_DAY_WORDS[k], value: k }))),
  });
  if (!pick || pick === 'no') return;
  const r = mealsCopyDay(pick, dk);
  if (!r.ok) secRefused(r, 'meals');
}

// ── Memory verses (§11.11) ──

const SEC_VERSE_FIELDS = [['title', 'Title'], ['text', 'Verse'], ['ref', 'Where it is'], ['video', 'Video link (optional)']];

function secVerseGroupHtml(key, label, theme) {
  const fld = (f, labelText, extra) => '<label class="fld"><span class="fld-label">' + labelText + '</span>' + extra + '</label>';
  return '<div class="more-sec" data-verse="' + key + '"><div class="gl-head"><h3 class="gl-label">' + esc(label) + '</h3></div><div class="gl sec-verse">' +
    (theme ? fld('title', 'Title', '<input type="text" class="fld-input" data-verse-field="title" maxlength="80" autocomplete="off" placeholder="Harvest of the Heart">') : '') +
    fld('text', 'Verse', '<textarea class="fld-input sec-text" data-verse-field="text" rows="3" maxlength="600" placeholder="The words"></textarea>') +
    fld('ref', 'Where it is', '<input type="text" class="fld-input" data-verse-field="ref" maxlength="80" autocomplete="off" placeholder="Romans 8:1 ESV">') +
    (theme ? '' : fld('video', 'Video link (optional)', '<input type="url" class="fld-input" data-verse-field="video" maxlength="300" autocomplete="off" inputmode="url" placeholder="https://">')) +
    '<p class="fld-error" data-verse-error role="alert" hidden></p></div></div>';
}

function renderVersesScreen() {
  const live = secLive('verses');
  const tree = secTree('verses');
  const form = setupEl('verses-form');
  const days = hubCompetitionDks();
  if (form && !secUi.versesBuilt) {
    form.innerHTML = secVerseGroupHtml('theme', 'Theme verse', true) + days.map((dk) => secVerseGroupHtml(dk, SETUP_DAY_WORDS[dk], false)).join('');
    secUi.versesBuilt = true;
  }
  const theme = setupVerseTheme(tree);
  const have = days.filter((dk) => setupVerseDay(tree, dk)).length;
  setTextIfChanged(setupEl('verses-title'), 'Memory verses · ' + CAMP.label);
  setTextIfChanged(setupEl('verses-headline'), (theme ? 'Theme + ' : '') + hubPlural(have, 'day', 'days'));
  setTextIfChanged(setupEl('verses-lede'), live ? 'Type the words and where they are. A video link is optional.' : 'The verses that came with the app.');
  if (!form || !form.querySelectorAll) return;
  form.querySelectorAll('[data-verse]').forEach((group) => {
    const key = group.dataset.verse;
    const rec = key === 'theme' ? theme : setupVerseDay(tree, key);
    group.querySelectorAll('[data-verse-field]').forEach((input) => {
      const f = input.dataset.verseField;
      secSetValue(input, rec && typeof rec[f] === 'string' ? rec[f] : '');
      secSetDisabled(input, !live);
    });
  });
}

function secVerseGroup(target) {
  return target && target.closest ? target.closest('[data-verse]') : null;
}
function secVersePath(group) {
  return group.dataset.verse === 'theme' ? 'verses/theme' : 'verses/days/' + group.dataset.verse;
}
// The group's fields as a record to hand versesSetTheme / versesSetDay.
function secVerseTyped(group) {
  const rec = {};
  group.querySelectorAll('[data-verse-field]').forEach((input) => { rec[input.dataset.verseField] = input.value; });
  return rec;
}
function secVerseFocusIn(group) {
  if (!group || !secLive('verses')) return;
  setupFocusIn(secVersePath(group));
}
function secVerseFocusOut(group) {
  if (!group || !secLive('verses')) return;
  const theme = group.dataset.verse === 'theme';
  const typed = secVerseTyped(group);
  const r0 = versesRecord(typed, theme);
  const f = setupFocusOut(secVersePath(group), r0.rec || null);
  const err = group.querySelector('[data-verse-error]');
  const say = (t) => { setTextIfChanged(err, t); setHiddenIfChanged(err, !t); };
  // An error is said every time (the field was typed, the commit refused): the director fixes it where it is.
  if (!f.changed && !r0.error) { say(''); return; }
  const r = theme ? versesSetTheme(typed) : versesSetDay(group.dataset.verse, typed);
  if (r.ok) { say(''); return; }
  if (r.reason === 'text') say('A verse needs its words. Type them, or clear the whole verse.');
  else if (r.reason === 'video') say('Use a link that starts with https://');
  else secRefused(r, 'verses');
}

// ── Cleanup rota (§11.12) ──

function secTeamWords(ids) {
  return ids.map((id) => teamEmoji(id) + ' ' + esc(teamName(id))).join(' + ');
}

function secCleanupRowHtml(it, dk, tree, live) {
  const ids = setupCleanupIds(tree, dk, it.meal);
  const tag = live ? 'button' : 'div';
  const warn = !ids.length && SETUP_DK.some((k) => setupCleanupTracked(tree, k));
  return '<' + tag + (live ? ' type="button"' : '') + ' class="cb-row sec-row" data-meal="' + esc(it.meal) + '"' + (warn ? ' data-warn' : '') + '>' +
    '<span class="cb-time">' + secTimeHtml(it.start) + '</span>' +
    '<span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">' + (SEC_MEAL_ICONS[it.meal] || '🍽️') + '</span><span>' + esc(it.name) + '</span></span>' +
    '<span class="cb-sub">' + (ids.length ? secTeamWords(ids) : 'No team yet') + '</span></span>' +
    '<span class="cb-end">' + (live ? '<svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' : '') + '</span></' + tag + '>';
}

function renderCleanupScreen() {
  const live = secLive('cleanup');
  const tree = secTree('cleanup');
  const dk = secDayKey('cleanup');
  const dow = SETUP_DK.indexOf(dk);
  const items = secMealItems(dow);
  const ids = items.map((it) => setupCleanupIds(tree, dk, it.meal));
  const placed = ids.filter((x) => x.length).length;
  setTextIfChanged(setupEl('cleanup-title'), 'Cleanup rota · ' + CAMP.label);
  setTextIfChanged(setupEl('cleanup-headline'), SETUP_DAY_WORDS[dk]);
  setTextIfChanged(setupEl('cleanup-lede'), !items.length ? 'No meals on this day'
    : placed === items.length ? 'Every meal has a team' : placed ? placed + ' of ' + items.length + ' meals have a team' : 'No teams yet');
  setHtmlIfChanged(setupEl('cleanup-list'), items.map((it) => secCleanupRowHtml(it, dk, tree, live)).join(''));
  setHiddenIfChanged(setupEl('cleanup-empty'), items.length > 0);
  setTextIfChanged(setupEl('cleanup-empty-text'), 'This day has no meal items. Mark an item as a meal on the Schedule screen and it shows up here.');
  // The fairness line, over the whole week.
  const slots = secCleanupSlots(tree);
  const fair = rotaFairness(slots.map((s) => ({ day: s.day, teams: s.have })), teamIds(), (id) => teamShort(id) || teamName(id), (k) => SETUP_DAY_WORDS[k]);
  setTextIfChanged(setupEl('cleanup-fair-text'), fair.text);
  setHiddenIfChanged(setupEl('cleanup-fair'), !slots.length || !fair.max);
  setHiddenIfChanged(setupEl('cleanup-fill'), !(live && slots.length));
}

function secOpenTeams(meal, opener) {
  if (!secLive('cleanup')) return;
  const dk = secDayKey('cleanup');
  const it = secMealItems(SETUP_DK.indexOf(dk)).find((x) => x.meal === meal);
  if (!it) return;
  const was = setupCleanupIds(setupTree, dk, meal);
  secUi.teams = { dk, meal, name: it.name, was, picked: was.slice() };
  setupSheet('sec-teams', opener);
}

function renderSecTeamsSheet() {
  const s = secUi.teams;
  if (!s) return;
  setTextIfChanged(setupEl('sheet-sec-teams-title'), SETUP_DAY_WORDS[s.dk] + ' · ' + s.name);
  setHtmlIfChanged(setupEl('sec-teams'), teamIds().map((id) =>
    '<button type="button" class="si-team" data-team="' + esc(id) + '" aria-pressed="' + (s.picked.indexOf(id) !== -1) + '">' + teamMarkHtml(id, { size: 24 }) + '<span>' + esc(teamName(id)) + '</span></button>').join(''));
  const changed = JSON.stringify(s.picked.slice().sort()) !== JSON.stringify(s.was.slice().sort());
  const save = setupEl('sec-teams-save');
  setTextIfChanged(save, s.picked.length ? 'Save' : 'No team yet');
  if (save) save.setAttribute('aria-disabled', String(!changed));
  setHiddenIfChanged(setupEl('sec-teams-clear'), !s.was.length || !s.picked.length);
}

function secTeamsToggle(id) {
  const s = secUi.teams;
  if (!s || teamIds().indexOf(id) === -1) return;
  const note = setupEl('sec-teams-note');
  if (s.picked.indexOf(id) !== -1) s.picked = s.picked.filter((x) => x !== id);
  else if (s.picked.length >= 2) { setTextIfChanged(note, 'A meal has one or two teams. Tap one to take it off first.'); setHiddenIfChanged(note, false); return; }
  else s.picked = s.picked.concat([id]);
  setTextIfChanged(note, '');
  setHiddenIfChanged(note, true);
  renderSecTeamsSheet();
}

function secTeamsSave(clear) {
  const s = secUi.teams;
  if (!s) return;
  const picked = clear ? [] : s.picked;
  if (JSON.stringify(picked.slice().sort()) === JSON.stringify(s.was.slice().sort())) { shellSheetClose('sec-teams'); return; }
  const r = cleanupSet(s.dk, s.meal, picked, SETUP_DAY_WORDS[s.dk] + ' ' + s.meal + ' cleanup: ' + (picked.length ? picked.map((id) => teamShort(id) || teamName(id)).join(' + ') : 'no team'));
  if (!r.ok) { secRefused(r, 'cleanup'); return; }
  shellSheetClose('sec-teams');
}

// Fill evenly: a preview in words first (one line a day, the fairness line, any rule it had to bend), then Apply or Cancel.
async function secFillEvenly() {
  if (!secLive('cleanup')) return;
  const slots = secCleanupSlots(setupTree);
  if (!slots.length) return;
  let redo = false;
  if (!slots.some((s) => !s.have.length)) {
    const again = await askDialog({
      title: 'Redo the whole rota evenly?', body: ['Every meal already has a team. This starts over and replaces them all.'],
      actions: [{ label: 'Keep it as it is', value: 'no', cancel: true }, { label: 'Redo it', value: 'redo', kind: 'gold' }],
    });
    if (again !== 'redo') return;
    redo = true;
  }
  const res = rotaFillEvenly({ teams: teamIds(), redo, slots: slots.map((s) => ({ day: s.day, meal: s.meal, want: Math.max(1, s.have.length), have: s.have })) });
  const short = (id) => teamEmoji(id) + ' ' + (teamShort(id) || teamName(id));
  const lines = hubCompetitionDks().map((dk) => SETUP_DAY_WORDS[dk] + ': ' + res.slots.filter((s) => s.day === dk).map((s) => (SETUP_MEAL_NAMES[s.meal] || s.meal) + ' ' + (s.teams.map(short).join(' + ') || '—')).join(' · '));
  const fair = rotaFairness(res.slots, teamIds(), (id) => teamShort(id) || teamName(id), (k) => SETUP_DAY_WORDS[k]);
  const body = lines.concat([fair.text]);
  if (res.relaxed.length) body.push('A few meals couldn’t follow every rule (' + res.relaxed.map((r) => SETUP_DAY_WORDS[r.split(' ')[0]] + ' ' + r.split(' ')[1]).join(', ') + '): there aren’t enough teams to keep each one off the same meal two days running.');
  const pick = await askDialog({ title: 'Fill the rota evenly?', body, actions: [{ label: 'Cancel', value: 'no', cancel: true }, { label: 'Apply', value: 'apply', kind: 'gold' }] });
  if (pick !== 'apply') return;
  const changed = res.slots.filter((s, i) => JSON.stringify(s.teams) !== JSON.stringify(slots[i].have));
  if (!changed.length) { setupSay('The rota was already even.'); return; }
  const r = cleanupApply(changed, 'Filled the cleanup rota evenly');
  if (!r.ok) secRefused(r, 'cleanup');
}

// ── Electives (§11.13) ──

function secLinkTargets() {
  return hubMembers().filter((m) => !m.pending).map((m) => ({ key: m.key, name: m.name }));
}

// One station's block: its name, its people as chips (tap = take off), "Add someone", and a Link row for a typed name that
// nearly matches somebody on the list.
function secStationHtml(row, live, members) {
  const emoji = esc(row.emoji || '🌟');
  const head = (live ? '<button type="button" class="sec-st-name" data-sec-station="' + esc(row.id) + '">' : '<div class="sec-st-name">') +
    '<span aria-hidden="true">' + emoji + '</span><span>' + esc(row.name) + '</span>' + (live ? '<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button>' : '</div>');
  const links = [];
  const chips = row.people.map((p) => {
    const near = live && p.typed ? setupNearMember(p.name, members) : null;
    if (near) links.push('<div class="sec-link"><span>' + esc(p.name) + ' looks like ' + esc(String(near.name).trim().split(/\s+/)[0]) + ' on your list.</span><button type="button" class="btn btn-sm" data-sec-link="' + esc(p.pid) + '" data-sec-member="' + esc(near.key) + '">Link</button></div>');
    return live
      ? '<button type="button" class="sec-chip" data-sec-off="' + esc(p.pid) + '" data-st="' + esc(row.id) + '"' + (near ? ' data-warn' : '') + ' aria-label="Take ' + esc(p.name) + ' off ' + esc(row.name) + '"><span>' + esc(p.name) + '</span><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>'
      : '<span class="sec-chip">' + esc(p.name) + '</span>';
  }).join('');
  const add = live ? '<button type="button" class="sec-chip sec-chip-add" data-sec-add="' + esc(row.id) + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Add someone</span></button>' : '';
  return '<div class="sec-st" data-st="' + esc(row.id) + '">' + head + '<div class="sec-st-people">' + chips + add + '</div>' + links.join('') + '</div>';
}

function renderElectivesScreen() {
  const live = secLive('electives');
  const tree = secTree('electives');
  const dk = secDayKey('electives');
  const dow = SETUP_DK.indexOf(dk);
  const slot = secSlotNow();
  const rows = setupElectiveRows(tree, dk, slot);
  setTextIfChanged(setupEl('electives-title'), 'Electives · ' + CAMP.label);
  setTextIfChanged(setupEl('electives-headline'), SETUP_DAY_WORDS[dk]);
  setTextIfChanged(setupEl('electives-lede'), rows.length
    ? hubPlural(rows.length, 'station', 'stations') + ' · ' + hubPlural(rows.reduce((n, r) => n + r.people.length, 0), 'person', 'people')
    : 'No stations in this elective yet');
  // Which elective: each segment names its time (from the schedule's Elective item).
  const seg = setupEl('elec-slots');
  if (seg && seg.querySelectorAll) {
    seg.querySelectorAll('.seg-btn[data-slot]').forEach((btn) => {
      const n = Number(btn.dataset.slot);
      const sel = n === slot;
      if (btn.getAttribute('aria-selected') !== String(sel)) btn.setAttribute('aria-selected', String(sel));
      setHtmlIfChanged(btn, 'Elective ' + (n + 1) + '<small>' + esc(setupClock(electiveSlotStart(n, dow))) + '</small>');
    });
  }
  const members = live ? secLinkTargets() : [];
  setHtmlIfChanged(setupEl('elec-list'), rows.map((r) => secStationHtml(r, live, members)).join(''));
  setHiddenIfChanged(setupEl('elec-empty'), rows.length > 0);
  setTextIfChanged(setupEl('elec-empty-text'), live ? 'Add the stations that run at this time.' : 'No stations at this time.');
  // "On break": the people on this day's sheet who are at no station in this slot (the app calls the same line Break).
  const brk = secBreakNames(tree, dk, slot);
  setTextIfChanged(setupEl('elec-break-text'), brk.length ? 'On break: ' + hubJoin(brk) : '');
  setHiddenIfChanged(setupEl('elec-break'), !brk.length);
  const first = hubCompetitionDks()[0];
  setHiddenIfChanged(setupEl('elec-add-station'), !live);
  setHiddenIfChanged(setupEl('elec-same'), !(live && dk !== first && setupElectiveRows(tree, first, 0).length + setupElectiveRows(tree, first, 1).length + setupElectiveRows(tree, first, 2).length));
  setTextIfChanged(setupEl('elec-same-text'), 'Same as ' + SETUP_DAY_WORDS[first]);
}

// Everyone on the day's sheet (any slot) who is at no station in this one, A to Z.
function secBreakNames(tree, dk, slot) {
  const at = {};
  setupElectiveRows(tree, dk, slot).forEach((r) => r.people.forEach((p) => { at[p.name.toLowerCase()] = true; }));
  const out = [];
  for (let s = 0; s < 3; s++) setupElectiveRows(tree, dk, s).forEach((r) => r.people.forEach((p) => { if (!at[p.name.toLowerCase()] && out.indexOf(p.name) === -1) out.push(p.name); }));
  return out.sort();
}

function secOpenAddPerson(st, opener) {
  if (!secLive('electives')) return;
  secUi.person = { dk: secDayKey('electives'), slot: secSlotNow(), st };
  const input = setupEl('sec-person-name');
  if (input) input.value = '';
  setupSheet('sec-person', opener);
}

function renderSecPersonSheet() {
  const s = secUi.person;
  if (!s) return;
  const row = setupElectiveRows(setupTree, s.dk, s.slot).find((r) => r.id === s.st);
  setTextIfChanged(setupEl('sheet-sec-person-title'), 'Add to ' + (row ? row.name : 'this station'));
  const here = {};
  ((row && row.people) || []).forEach((p) => { here[p.pid] = true; here[p.name.toLowerCase()] = true; });
  const people = hubMembers().filter((m) => m.name && !here[m.key] && !here[m.name.toLowerCase()]).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  setHtmlIfChanged(setupEl('sec-person-list'), people.map((m) =>
    '<button type="button" class="gl-row" data-sec-person="' + esc(m.pending ? '' : m.key) + '" data-sec-name="' + esc(m.name) + '"><span class="gl-text"><span class="gl-title">' + esc(m.name) + '</span>' +
    (m.teamId ? '<span class="gl-sub">' + esc(teamName(m.teamId)) + '</span>' : '') + '</span></button>').join(''));
  setHiddenIfChanged(setupEl('sec-person-empty'), people.length > 0);
}

function secPersonAdd(key, name) {
  const s = secUi.person;
  if (!s) return;
  const r = electivePersonAdd(s.dk, s.slot, s.st, { key: key || '', name });
  if (!r.ok && r.reason === 'name') { const i = setupEl('sec-person-name'); if (i && typeof i.focus === 'function') i.focus(); return; }
  if (!r.ok && r.reason !== 'cancelled') { secRefused(r, 'electives'); return; }
  shellSheetClose('sec-person');
}

function secOpenStation(mode, st, opener) {
  if (!secLive('electives')) return;
  secUi.station = { mode, dk: secDayKey('electives'), slot: secSlotNow(), st: st || '' };
  const rec = st ? setupMapOf(setupMapOf(setupTree.electives).stations)[st] : null;
  const name = setupEl('sec-station-name');
  const emo = setupEl('sec-station-emoji');
  if (name) name.value = rec && typeof rec.name === 'string' ? rec.name : '';
  if (emo) emo.value = rec && typeof rec.emoji === 'string' ? rec.emoji : '';
  setHiddenIfChanged(setupEl('sec-station-error'), true);
  setupSheet('sec-station', opener);
}

function renderSecStationSheet() {
  const s = secUi.station;
  if (!s) return;
  const edit = s.mode === 'edit';
  const inSlot = {};
  setupElectiveRows(setupTree, s.dk, s.slot).forEach((r) => { inSlot[r.id] = true; });
  const pick = edit ? [] : setupElectiveStations(setupTree).filter((x) => !inSlot[x.id]);
  setTextIfChanged(setupEl('sheet-sec-station-title'), edit ? 'Edit this station' : 'Add a station');
  setHtmlIfChanged(setupEl('sec-station-list'), pick.map((x) =>
    '<button type="button" class="gl-row" data-sec-pick="' + esc(x.id) + '"><span class="gl-ico" aria-hidden="true">' + esc(x.emoji || '🌟') + '</span><span class="gl-text"><span class="gl-title">' + esc(x.name) + '</span></span></button>').join(''));
  setHiddenIfChanged(setupEl('sec-station-list'), !pick.length);
  setTextIfChanged(setupEl('sec-station-form-label'), edit ? 'Name' : pick.length ? 'Or a new station' : 'A new station');
  setTextIfChanged(setupEl('sec-station-save'), edit ? 'Save' : 'Add');
  setHiddenIfChanged(setupEl('sec-station-manage'), !edit);
  const key = 'Elective ' + (s.slot + 1);
  setTextIfChanged(setupEl('sec-station-off-title'), 'Take it off ' + SETUP_DAY_WORDS[s.dk] + '’s ' + key);
}

function secStationSave() {
  const s = secUi.station;
  if (!s) return;
  const name = (setupEl('sec-station-name') || {}).value;
  const emoji = (setupEl('sec-station-emoji') || {}).value;
  const err = setupEl('sec-station-error');
  const bad = () => { setTextIfChanged(err, 'Give it a name.'); setHiddenIfChanged(err, false); const i = setupEl('sec-station-name'); if (i && typeof i.focus === 'function') i.focus(); };
  const r = s.mode === 'edit' ? electiveStationEdit(s.st, name, emoji) : electiveStationAddToSlot(name, emoji, s.dk, s.slot);
  if (!r.ok && r.reason === 'name') { bad(); return; }
  if (!r.ok) { secRefused(r, 'electives'); return; }
  shellSheetClose('sec-station');
}

async function secStationDelete() {
  const s = secUi.station;
  if (!s || !s.st) return;
  const rec = setupMapOf(setupMapOf(setupTree.electives).stations)[s.st];
  const name = rec && rec.name ? rec.name : 'this station';
  const pick = await askDialog({
    title: 'Delete ' + name + '?', body: ['It comes off every day it runs. Undo is right there if it was a mistake.'],
    actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Delete it', value: 'delete', kind: 'danger' }],
  });
  if (pick !== 'delete') return;
  const r = electiveStationRemove(s.st);
  if (!r.ok) { secRefused(r, 'electives'); return; }
  shellSheetClose('sec-station');
}

async function secElectiveSame() {
  if (!secLive('electives')) return;
  const dk = secDayKey('electives');
  const first = hubCompetitionDks()[0];
  if (dk === first) return;
  const holds = [0, 1, 2].some((n) => setupElectiveRows(setupTree, dk, n).length);
  if (holds) {
    const pick = await askDialog({
      title: 'Make ' + SETUP_DAY_WORDS[dk] + ' the same as ' + SETUP_DAY_WORDS[first] + '?',
      body: [SETUP_DAY_WORDS[dk] + '’s three electives are replaced. Undo is right there if it’s not what you wanted.'],
      actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Make it the same', value: 'go', kind: 'gold' }],
    });
    if (pick !== 'go') return;
  }
  const r = electiveCopyDay(first, dk);
  if (!r.ok) secRefused(r, 'electives');
}

function secLinkPerson(pid, key) {
  const m = secLinkTargets().find((x) => x.key === key);
  if (!m) return;
  const r = electiveLinkPerson(pid, m);
  if (!r.ok && r.reason !== 'cancelled') secRefused(r, 'electives');
}

// ── the screens' paint, the owner's two doors, the wiring ──

function renderSecScreen(section) {
  secPaintDoor(section);
  if (section !== 'verses') renderSecStrip(section, secDayKey(section));
  if (section === 'meals') renderMealsScreen();
  else if (section === 'verses') renderVersesScreen();
  else if (section === 'cleanup') renderCleanupScreen();
  else if (section === 'electives') renderElectivesScreen();
}

// Turn on: the owner's, one plain question first, the camp-week freeze as a question in words (the same conversation as Edit the
// week here, for any list of sections). `sections` may name several (the hub's door turns on every one that is off, in one sitting).
async function secTurnOnFlow(sections) {
  if (!requireOwner('turn on editing')) return { ok: false, reason: 'owner' };
  const want = sections.filter((s) => s !== 'electives' || setupHasElectives());
  const nouns = hubJoin(want.map((s) => HUB_SECTION_NOUNS[s]));
  const go = await askDialog({
    title: 'Edit ' + nouns + ' here?',
    body: ['Turning this on changes nothing anyone can see until someone edits something.', 'The first time, a restore point is saved first. The screen’s “Use the original … again” puts it all back.'],
    actions: [{ label: 'Not yet', value: 'no', cancel: true }, { label: 'Turn on', value: 'go', kind: 'gold' }],
  });
  if (go !== 'go') return { ok: false, reason: 'cancelled' };
  const opts = {};
  for (let guard = 0; guard < 4; guard++) {
    const r = await setupTurnOn(want, opts);
    if (r.ok) { setupSay('Editing is on for ' + nouns + '.'); return r; }
    if (r.reason === 'ask-camp-week') {
      const running = await askDialog({
        title: 'Is a camp week running right now?',
        body: 'No dates are set, so the app can’t tell. Turning on editing mid-week changes what these are made from while counselors are relying on them.',
        actions: [{ label: 'Not yet', value: 'no', kind: 'gold' }, { label: 'Yes, it’s running', value: 'yes' }, { label: 'Cancel', value: 'cancel', cancel: true }],
      });
      if (running === 'cancel' || running === null) return { ok: false, reason: 'cancelled' };
      opts.campRunning = running === 'yes';
      continue;
    }
    if (r.reason === 'camp-week') {
      const again = await askDialog({
        title: 'A camp week is running',
        body: ['Turning on editing now is meant for before or after camp. Small edits are fine once it’s on.', 'Turn it on anyway?'],
        actions: [{ label: 'Wait for later', value: 'wait', cancel: true }, { label: 'I know — turn it on', value: 'go', kind: 'danger' }],
      });
      if (again !== 'go') return { ok: false, reason: 'cancelled' };
      opts.overrideCampWeek = true;
      continue;
    }
    setupSay(r.reason === 'owner' ? r.message : (TURNON_WHY[r.reason] || TURNON_WHY.failed));
    return r;
  }
  return { ok: false, reason: 'failed' };
}

// The sections of this camp that are still the original — what the hub's door turns on in one sitting.
function secOffSections() {
  return HUB_SECTIONS.filter((s) => (s !== 'electives' || setupHasElectives()) && !secOn(s));
}

async function secUseOriginal(section) {
  if (!requireOwner('switch back to the original')) return { ok: false, reason: 'owner' };
  const noun = HUB_SECTION_NOUNS[section];
  const go = await askDialog({
    title: 'Use the original ' + noun.replace(/^the /, '') + ' again?',
    body: ['Everyone sees what came with the app. Your changes are kept, and Turn on brings them back.'],
    actions: [{ label: 'Keep editing here', value: 'no', cancel: true }, { label: 'Use the original', value: 'go', kind: 'gold' }],
  });
  if (go !== 'go') return { ok: false, reason: 'cancelled' };
  const r = setupUseOriginal([section]);
  if (r.ok) setupSay('Back to the original. Your edits are kept.');
  else setupSay(r.reason === 'owner' ? r.message : r.reason === 'already' ? 'Already using the original.' : 'That didn’t go through, so nothing was changed.');
  return r;
}

HUB_DOOR_ACTIONS.sections = () => secTurnOnFlow(secOffSections());

function wireSecScreens() {
  const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(ev, fn); };
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  on('#sec-days', 'click', (e) => { const b = q(e, '.daypick-btn[data-day]'); if (b) secSetDay(b.dataset.day); });
  const track = setupEl('sec-days-track');
  if (track) track.addEventListener('scroll', () => paintStripOverflow(track), { passive: true });
  HUB_SECTIONS.forEach((s) => {
    on('#' + s + '-door-btn', 'click', () => { if (isOwner()) secTurnOnFlow([s]); });
    on('#' + s + '-original', 'click', () => { if (isOwner()) secUseOriginal(s); });
  });
  // Meals: focus in / out on the row's two inputs; Enter finishes the field.
  const meals = setupEl('meals-list');
  if (meals) {
    meals.addEventListener('focusin', (e) => secMealFocusIn(q(e, '.sec-meal')));
    meals.addEventListener('focusout', (e) => secMealFocusOut(q(e, '.sec-meal')));
    meals.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && typeof e.target.blur === 'function') { e.preventDefault(); e.target.blur(); } });
  }
  on('#meals-copy', 'click', () => { secMealCopy(); });
  // Verses.
  const verses = setupEl('verses-form');
  if (verses) {
    verses.addEventListener('focusin', (e) => secVerseFocusIn(secVerseGroup(e.target)));
    verses.addEventListener('focusout', (e) => secVerseFocusOut(secVerseGroup(e.target)));
  }
  // Cleanup.
  on('#cleanup-list', 'click', (e) => { const b = q(e, 'button.sec-row[data-meal]'); if (b) secOpenTeams(b.dataset.meal, b); });
  on('#cleanup-fill', 'click', () => { secFillEvenly(); });
  const teams = setupEl('sheet-sec-teams');
  if (teams) teams.addEventListener('click', (e) => { const b = q(e, '.si-team'); if (b) secTeamsToggle(b.dataset.team); });
  on('#sec-teams-save', 'click', () => secTeamsSave(false));
  on('#sec-teams-clear', 'click', () => secTeamsSave(true));
  // Electives.
  on('#elec-slots', 'click', (e) => { const b = q(e, '.seg-btn[data-slot]'); if (b) secSetSlot(Number(b.dataset.slot)); });
  on('#elec-list', 'click', (e) => {
    let b;
    if ((b = q(e, '[data-sec-off]'))) { const r = electivePersonRemove(secDayKey('electives'), secSlotNow(), b.dataset.st, b.dataset.secOff); if (!r.ok) secRefused(r, 'electives'); }
    else if ((b = q(e, '[data-sec-add]'))) secOpenAddPerson(b.dataset.secAdd, b);
    else if ((b = q(e, '[data-sec-station]'))) secOpenStation('edit', b.dataset.secStation, b);
    else if ((b = q(e, '[data-sec-link]'))) secLinkPerson(b.dataset.secLink, b.dataset.secMember);
  });
  on('#elec-add-station', 'click', (e) => secOpenStation('add', '', e.currentTarget));
  on('#elec-same', 'click', () => { secElectiveSame(); });
  const person = setupEl('sheet-sec-person');
  if (person) person.addEventListener('click', (e) => { const b = q(e, '[data-sec-person]'); if (b) secPersonAdd(b.dataset.secPerson, b.dataset.secName); });
  on('#sec-person-form', 'submit', (e) => { e.preventDefault(); secPersonAdd('', (setupEl('sec-person-name') || {}).value); });
  const station = setupEl('sheet-sec-station');
  if (station) station.addEventListener('click', (e) => {
    const b = q(e, '[data-sec-pick]');
    if (b && secUi.station) {
      const r = electiveSlotAddStation(secUi.station.dk, secUi.station.slot, b.dataset.secPick);
      if (r.ok || r.reason === 'cancelled') shellSheetClose('sec-station'); else secRefused(r, 'electives');
    }
  });
  on('#sec-station-form', 'submit', (e) => { e.preventDefault(); secStationSave(); });
  on('#sec-station-off', 'click', () => {
    const s = secUi.station;
    if (!s) return;
    const r = electiveSlotRemoveStation(s.dk, s.slot, s.st);
    if (!r.ok) secRefused(r, 'electives'); else shellSheetClose('sec-station');
  });
  on('#sec-station-delete', 'click', () => { secStationDelete(); });
}
