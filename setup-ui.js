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
//  12. meals, memory verses, the cleanup rota, electives (step 19)
//  13. teams: the screen, the team sheet, the photo, "pick colours for the flagged teams" (step 25; the end of the file)

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
  games: { screen: 'games' },
  teams: { screen: 'teams' },
  notice: { screen: 'notice' },
  people: { screen: 'people' },
  campers: { screen: 'campers' },
  restore: { screen: 'backups' },
  alerts: { drawer: 'alerts' },
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

// "two" for a count in a sentence ("Two teams are Blue"); past ten, the digits.
function hubNumWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
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
      // Days with the very same unmarked items are one sentence ("Supper and free time on Monday, Tuesday … isn’t marked").
      const looseBy = {};
      (sc.unmarkedMeals || []).forEach((m) => { const k = m.names.join('|'); (looseBy[k] = looseBy[k] || { names: m.names, days: [] }).days.push(m.day); });
      Object.keys(looseBy).forEach((k) => { const m = looseBy[k]; problems.push((m.names.length === 1 ? m.names[0] : hubJoin(m.names)) + ' on ' + hubJoin(m.days) + (m.names.length === 1 ? ' isn’t marked as a meal' : ' aren’t marked as meals')); });
      const shape = sc.follow ? 'Typical day · ' + sc.follow + (sc.oneOffs ? ' · ' + hubPlural(sc.oneOffs, 'one-off', 'one-offs') : '') : 'Edited here';
      const row = hubMark(problems.length ? 'warn' : 'ok', shape, problems);
      // A day still on the seeded sample schedule (senior's arrival and send-off days) is a quiet note, never a warning (Q11).
      if (sc.sample && sc.sample.length) row.note = hubJoin(sc.sample) + (sc.sample.length === 1 ? ' still uses' : ' still use') + ' the sample schedule';
      return row;
    }
    case 'campers': {
      // Minors' names are read only while a camper-showing screen (this row's hub included) holds the editor-only listener, so the row can say
      // "Loading…" and nothing more until the list arrives. A team with no campers is a note once ANY camper exists (Appendix B).
      const c = v.campers || {};
      if (c.status === 'nosync') return hubMark('info', 'Needs the camp database', [], '');
      if (c.status === 'denied') return hubMark('info', 'Not available yet', [], '');
      if (c.status !== 'ok') return hubMark('info', 'Loading…', [], '');
      const total = Number(c.total) || 0;
      if (!total) return hubMark('todo', 'No campers yet', []);
      const problems = (Array.isArray(c.empty) ? c.empty : []).map((n) => n + ' has no campers yet');
      return hubMark(problems.length ? 'warn' : 'ok', hubPlural(total, 'camper', 'campers'), problems);
    }
    case 'meals': case 'verses': case 'cleanup': case 'electives':
      return hubSectionStatus(section, v);
    case 'alerts': {
      // Phone alerts (live since Step 27): is the sender switched on, does the week have dates, did the schedule reach the sender?
      // Never a warning: a phone that has not heard yet is the publisher catching up, and no dates is not a chore (P2 Appendix B).
      const a = v.alerts || {};
      if (!a.live) return hubMark('info', 'Phone alerts aren’t switched on yet', []);
      if (!a.weekStart) return hubMark('info', 'Reminders start once the camp week has dates', []);
      if (a.sent) return hubMark('ok', 'Schedule sent to phones', []);
      return hubMark('info', 'Sending the schedule to phones…', []);
    }
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
      // A bracket that needs a director's eye (Appendix B): a four-team one waiting for a re-check, or a tap that came in after its
      // result was saved. The Games screen lists them, the late ones with Discard.
      const bn = v.brackets || {};
      const re = Array.isArray(bn.recheck) ? bn.recheck : [];
      if (re.length) problems.push(re.length === 1 ? re[0] + '’s bracket is waiting for a re-check' : re.length + ' brackets are waiting for a re-check');
      const late = Array.isArray(bn.late) ? bn.late : [];
      if (late.length) problems.push(late.length === 1 ? 'A late bracket tap came in for ' + late[0] + ' after its result was saved' : 'Late bracket taps came in for ' + late.length + ' games after their results were saved');
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
      if (tba) problems.push(tba === 1 ? '1 game has no place yet' : tba + ' games have no place yet');
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
      // Appendix B: a team's short name and emoji (each falls back to the camp's own, so this is a team the camp has no
      // default for), and two teams on one palette colour. `v.teamInfo` is teamsInfoView(): id → { short, emoji, colorId,
      // colorName, weak }; a view without it (an older caller) is judged on the slots and names alone.
      const info = v.teamInfo && typeof v.teamInfo === 'object' ? v.teamInfo : {};
      const nameOf = (t, i) => String(t && t.name || '').trim() || 'Team ' + (i + 1);
      teams.forEach((t, i) => {
        const x = t && info[t.id];
        if (x && !x.short) problems.push(nameOf(t, i) + ' has no short name');
        if (x && !x.emoji) problems.push(nameOf(t, i) + ' has no emoji');
      });
      const byColor = {};
      teams.forEach((t) => { const x = t && info[t.id]; if (x && x.colorId) (byColor[x.colorId] = byColor[x.colorId] || { name: x.colorName || x.colorId, n: 0 }).n++; });
      Object.keys(byColor).forEach((c) => { if (byColor[c].n > 1) problems.push(hubCap(hubNumWord(byColor[c].n)) + ' teams are ' + byColor[c].name); });
      const row = hubMark(problems.length ? 'warn' : 'ok', hubPlural(teams.length, 'team', 'teams'), problems);
      // A colour from last year that is hard to see on a theme is a gentle NOTE, never a counted warning (ux-R13), so the hub can
      // reach "all ready" without touching every team; the Teams screen offers "Pick colours for the flagged teams".
      const weak = teams.filter((t) => { const x = t && info[t.id]; return x && x.weak && x.weak.length; });
      if (weak.length) {
        const modes = hubJoin(['light', 'dark'].filter((m) => weak.some((t) => info[t.id].weak.indexOf(m) !== -1)));
        const who = nameOf(weak[0], teams.indexOf(weak[0]));
        row.note = weak.length === 1 ? who + (/s$/i.test(who) ? '’' : '’s') + ' colour is hard to read in ' + modes + ' mode'
          : hubPlural(weak.length, 'team’s', 'teams’') + ' colours are hard to read in ' + modes.replace(' and ', ' or ') + ' mode';
      }
      return row;
    }
    case 'people': {
      if (!v.membersLoaded) return hubMark('info', 'Loading the list…', [], '');
      const problems = [];
      const members = Array.isArray(v.members) ? v.members : [];
      const now = Number(v.now) || 0;
      // Somebody asking to join is what a director must act on first (§11.1, ux-R10); asking left on after registration is a nudge.
      const join = v.join || {};
      if (join.waiting > 0) problems.push(join.waiting === 1 ? (join.first ? join.first + ' is asking to join' : '1 person is asking to join') : join.waiting + ' people are asking to join');
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
      const row = hubMark(problems.length ? 'warn' : members.length ? 'ok' : 'todo', summary, problems);
      if (join.long) row.note = 'Asking to join is still on — turn it off after registration?';
      return row;
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
  // A new-year setup under way outranks every other door: the owner's driving device carries on, the owner's other device
  // watches or takes over, every other director just reads where it is.
  if (v.wizard) {
    const w = v.wizard;
    const step = 'Step ' + w.step + ' of 5';
    if (w.state === 'mine') {
      return { door: 'wizard', lead: 'You’re setting up ' + w.year, text: step, ownerButton: actions.wizard ? 'Carry on' : '', ownerText: '', pair: false, takeover: false };
    }
    if (w.state === 'other') {
      return { door: 'wizard', lead: 'You’re setting up ' + w.year + ' on another device', text: step + ' · last tap ' + hubAgo(Date.now() - w.idleMs, Date.now()), ownerButton: '', ownerText: '', pair: true, takeover: !!w.canTakeOver };
    }
    return { door: 'wizard', lead: name + ' is setting up ' + w.year + ' (' + step.toLowerCase() + ').', text: 'Scores saved before ' + name + ' finishes are cleared with the rest.', ownerButton: '', ownerText: '', pair: false, takeover: false };
  }
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
      text: (held ? 'Your changes are kept. Turning ' + (off.length > 1 ? 'them' : 'it') + ' on brings them back.' : 'Turning ' + (off.length > 1 ? 'them' : 'it') + ' on changes nothing anyone can see until someone edits something.'),
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
    campLabel: campWord(), teamCount: CAMP.teamCount, electives: !!(CAMP.features && CAMP.features.electives),
    isOwner: typeof isOwner === 'function' && isOwner(), ownerName: typeof ownerName === 'function' ? ownerName() : 'the owner',
    now: typeof serverNow === 'function' ? serverNow() : Date.now(),
    teams: state.teams || [], teamInfo: teamsInfoView(), days: (state.config && state.config.days) || [], games: (state.config && state.config.games) || [],
    members: hubMembers(), membersLoaded: !!memberDirectoryLoaded, join: peopleJoinView(), campers: campersView(),
    on, skip: meta.skip && typeof meta.skip === 'object' ? meta.skip : {}, weekStart, weekRunning: hubWeekRunning(weekStart),
    newYearDue: typeof newYearDue === 'function' ? !!newYearDue() : false, nextYear: typeof nywNextYear === 'function' ? nywNextYear() : '',
    wizard: typeof nywDoorView === 'function' ? nywDoorView() : null,
    setupTooNew: typeof setupSchemaTooNew === 'function' && setupSchemaTooNew(),
    notice: { status: notice && notice.status, has: !!(notice && (notice.title || notice.sub || (notice.zones && notice.zones.length) || (notice.steps && notice.steps.length))) },
    restore: { status: rest.status, newestAt: rest.rows.length ? rest.rows[0].at : 0, count: rest.rows.length },
    doorActions,
    held: ['schedule'].concat(HUB_SECTIONS).reduce((o, s) => { o[s] = !!(hubSetupMeta().on && hubSetupMeta().on[s] === false); return o; }, {}),
    unscheduled: hubUnscheduledGames(),
    brackets: (function () { const b = typeof bracketNotes === 'function' ? bracketNotes() : { late: [], recheck: [] }; return { late: b.late.map((x) => x.name), recheck: b.recheck.map((x) => x.name) }; })(),
    schedule: hubScheduleView(),
    sec: hubSecView(),
    alerts: hubAlertsView(weekStart),
  };
}

// What the Phone alerts row judges. `sent` = the schedule on the sender is what this device would publish now (push.js keeps the
// published src); both halves are typeof-guarded, so a build with no push.js says the sender is off.
function hubAlertsView(weekStart) {
  const live = typeof pushConfigured === 'function' && pushConfigured();
  let sent = false;
  try {
    if (live && weekStart && typeof pushScheduleSrc === 'function' && typeof pushScheduleBlocks === 'function' && typeof pushPublishedSrc !== 'undefined' && pushPublishedSrc) {
      sent = pushScheduleSrc(weekStart, pushScheduleBlocks(scheduleWeek())) === pushPublishedSrc;
    }
  } catch (e) { sent = false; }
  return { live, weekStart: weekStart || '', sent };
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

// A plan's items that read like a meal ("Supper", "Supper and free time") but carry no Meal tag: they get no menu line and no
// cleanup line, so nothing on the Meals or Cleanup screens mentions them. Senior's printed "Supper and free time" is one.
function secLooseMeals(plan) {
  const loose = [];
  (plan || []).forEach((b) => {
    const head = setupHeadLabel(b.label);
    if (!b.meal && /^(breakfast|lunch|supper)\b/i.test(head) && loose.indexOf(head) === -1) loose.push(head);
  });
  return loose;
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
    typed.forEach((t) => { const hit = setupNearMember(t.name, members); if (hit) near.push({ name: t.name, member: setupNearLabel(t.name, hit) }); });
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
    const loose = secLooseMeals(plan);
    if (loose.length) out.unmarkedMeals.push({ day: SETUP_DAY_WORDS[dk], names: loose });
    if (day.placeholder === true && plan.length && hubStillSample(dow)) out.sample.push(SETUP_DAY_WORDS[dk]);
  }
  return out;
}

// ── 2. The frame: screens, navigation, the head ──────────────────────

// #setup[data-screen] is the ONE switch the CSS reads (styles.css "SET UP THE WEEK"): hub | backups |
// classic | week | schedule | rain. A step that adds a screen adds its name here and its pair of lines in the CSS.
const SETUP_SCREENS = ['hub', 'backups', 'classic', 'notice', 'week', 'schedule', 'rain', 'meals', 'verses', 'cleanup', 'electives', 'teams', 'people', 'campers', 'games', 'wizard'];
// Shell sheets this layer owns (shellSheetOpen ids; the elements are #sheet-<id>), one at a time.
const SETUP_SHEETS = ['setup-menu', 'setup-changes', 'setup-devices', 'restore', 'sched-day', 'sched-item', 'rain-item', 'rain-done', 'sec-teams', 'sec-person', 'sec-station', 'sec-verse', 'team-edit', 'team-colors', 'people-person', 'people-request', 'people-teams', 'people-add', 'people-blocked', 'camper-edit', 'camper-add', 'game', 'sg-day', 'setup-advanced', 'nyw-staff', 'nyw-undo'];
// The sheets that hold a half-made edit and ask before they let it go: the id → a function that takes the close over
// (it asks, and returns true) or returns false when nothing is at stake. app.js's Escape handler and shellApply (the
// phone's Back) call setupSheetGuardClose; ✕ and the backdrop reach the same question through the sheet's own
// capturing click handler.
const SETUP_SHEET_GUARDS = { 'sched-item': () => schedItemGuardClose(), 'team-edit': () => teamGuardClose(), 'people-person': () => peoplePersonGuardClose(), 'people-teams': () => peopleTeamsGuardClose(), 'people-add': () => peopleAddGuardClose(), 'camper-edit': () => campersEditGuardClose(), 'camper-add': () => campersAddGuardClose(), game: () => gmGuardClose() };
function setupSheetGuardClose(id) {
  const g = SETUP_SHEET_GUARDS[id];
  return !!(g && g());
}
// The classic builder's tabs, in editorsHere's short vocabulary (setup-sync.js editorsHereWhereWords).
const SETUP_CLASSIC_WHERE = { games: 'games', days: 'week', teams: 'teams', notice: 'notice', data: 'restore' };
// The owner's menu rows (⋯ → Owner). A row is listed only when its action exists (Step 15: original; Step 28: new-year,
// undo-new-year, and Advanced → "Start this section again from the original", the owner-only re-seed of a section that has
// ever been on — BUILD-PLAN Step 28 owns it), so the menu never offers a switch that can only fail.
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
  // The new-year setup is the owner's, and only while a run (or its step 5) is there to show: anyone else reads the hub.
  if (s === 'wizard' && !(typeof nywMayShow === 'function' && nywMayShow())) return 'hub';
  // The rain plan is the edited schedule's: a reload after Use the original week again lands on the Schedule preview.
  if (s === 'rain' && !(typeof scheduleIsShared === 'function' && scheduleIsShared())) return 'schedule';
  // A camp with no electives (senior) has no such screen: a stale stored one reads as the hub.
  if (s === 'electives' && !(typeof setupHasElectives === 'function' && setupHasElectives())) return 'hub';
  return SETUP_SCREENS.indexOf(s) !== -1 ? s : 'hub';
}

// app.js openBuilder(tab) calls this before it paints: More → Set up the week (no tab) opens the hub; a
// caller that names a classic tab ("Add games" on an empty day) lands on that tab of the classic screen.
function setupOnOpen(tab, screen) {
  // A named screen opens straight onto it (More → People); a named classic tab onto the classic editor; else the hub.
  state.ui.builderScreen = tab === 'notice' ? 'notice' : tab ? 'classic' : (screen && screen !== 'hub' && SETUP_SCREENS.indexOf(screen) !== -1 ? screen : 'hub');
  if (state.ui.builderScreen !== 'people') peopleUi.from = '';
  noticeUi.from = state.ui.builderScreen === 'notice' ? noticeUi.pend : '';
  noticeUi.pend = '';
}

// What this device should tell the other directors it is looking at.
function setupWhereNow() {
  const s = setupScreen();
  if (s === 'hub') return 'hub';
  if (s === 'backups') return 'restore';
  if (s === 'week') return 'week';
  if (s === 'wizard') return 'wizard';
  if (s === 'schedule') return 'schedule:' + (state.ui.setupDay || 'typical');
  if (s === 'rain') return 'rain:' + ((state.ui.rainDay && SETUP_DK.indexOf(state.ui.rainDay) !== -1) ? state.ui.rainDay : 'wed');
  if (HUB_SECTIONS.indexOf(s) !== -1) return s;
  if (s === 'teams') return teamUi.edit && /^t[0-9]$/.test(teamUi.edit.id) && shell.sheets.includes('team-edit') ? 'team:' + teamUi.edit.id : 'teams';
  if (s === 'people') return 'people';
  if (s === 'campers') return 'campers';
  if (s === 'notice') return 'notice';
  if (s === 'games') {
    // While a saved game's sheet is up, which game (the other directors read its name); an id past the vocabulary's 60 characters is just "the games".
    const o = gmUi.open;
    const w = o && o.gid && shell.sheets.includes('game') ? 'game:' + o.gid : '';
    return /^[a-z0-9:_-]{1,60}$/.test(w) ? w : 'games';
  }
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
  if (screen !== 'people') peopleUi.from = '';
  if (screen !== 'notice') noticeUi.from = '';
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
  if (!(await campersConfirmLeave())) return; // camper names typed with no signal, waiting in memory
  if (screen === 'rain') {
    if (!(await rainLeave())) return;
    if (rainBackHome()) return;
    state.ui.setupDay = rainDk();
    setupGo('schedule');
    return;
  }
  if (screen === 'hub') setupCloseBuilder();
  else if (screen === 'wizard') await nywBackFromScreen();
  else if (screen === 'people' && peopleUi.from === 'more') { peopleUi.from = ''; setupCloseBuilder(); } // opened from More: Back goes back there
  else if (screen === 'notice' && noticeUi.from === 'tell') { noticeUi.from = ''; setupCloseBuilder(); } // opened from Tell everyone: its composer comes back
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
  // While the owner's new-year setup is open (this device or another of theirs) the door below is the next thing: a
  // "Next: Games" above it would point the other way, at a week the run is about to change.
  const runOpen = !!(view.wizard && (view.wizard.state === 'mine' || view.wizard.state === 'other'));
  setTextIfChanged(setupEl('hub-lede'), runOpen ? 'Next: finish the new-year setup' : model.lede);
  // "Next: People" is the line to act on: when its row opens something it is a target (#hub-next) in
  // place of the plain lede, and opens that row.
  const nextKey = !runOpen && model.next && HUB_OPENS[model.next] ? model.next : '';
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
    // A note (no problem) is painted quietly: the row may say "Ready" and still carry one, and it must not read as a problem.
    setDataIfChanged(e.prob, 'tone', !st.problems[0] && st.note ? 'note' : null);
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
  setHiddenIfChanged(setupEl('hub-door-pair'), !(owner && door.pair));
  setHiddenIfChanged(setupEl('hub-door-takeover'), !(owner && door.takeover));
}

// A tap on a hub row that opens something.
function hubOpen(key) {
  const o = HUB_OPENS[key];
  if (!o) return;
  // Phone alerts: with no camp dates the row says reminders wait for them, so the tap goes where the dates are set (Camp
  // week); once there are dates it opens this phone's Alerts drawer.
  if (o.drawer === 'alerts') {
    if (!(campWeek() && campWeek().start)) { setupGo('week'); return; }
    if (typeof openPushDrawer === 'function') openPushDrawer();
    return;
  }
  if (o.drawer === 'members') { if (typeof openMembers === 'function') openMembers(); return; }
  if (o.screen === 'people') peopleUi.from = ''; // from the hub, Back is the hub
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
  if (typeof gmCleanSheets === 'function') gmCleanSheets(); // a sheet closed by any route leaves its state behind: drop it (a Forward must not reopen it)
  if (!open) {
    if (setupUi.wasOpen) setupUiClosed();
    return;
  }
  const justOpened = !setupUi.wasOpen;
  if (justOpened) setupUiOpened();
  const screen = setupScreen();
  if (root.dataset.screen !== screen) root.dataset.screen = screen;
  // The camper list (minors' names, memory only) is held only while a screen that shows counts or names is up; any other lets it go.
  if (typeof campersWant === 'function') campersWant(canEdit() && CAMPERS_SCREENS.indexOf(screen) !== -1);
  // The chips draw names, and only the Campers screen shows them: leaving it (to the hub, which still holds the list for its
  // counts, or to the Classic editor, which holds nothing) takes them out of the page, so a hidden screen never keeps a minor's name.
  if (screen !== 'campers' && typeof campersUiForget === 'function') campersUiForget();
  if (typeof applyOwnerClass === 'function') applyOwnerClass();
  if (nywUi.openNow !== (screen === 'wizard')) { nywUi.openNow = screen === 'wizard'; if (typeof wizardSetOpen === 'function') wizardSetOpen(nywUi.openNow); }
  // Back from the hub returns to the tab the builder was opened FROM (More, or Games from an empty day's
  // "Add games"): the shell keeps state.ui.tab untouched while the builder is up.
  const cameFrom = { now: 'Now', games: 'Games', chat: 'Chat', more: 'More' }[state.ui.tab] || 'More';
  setTextIfChanged(setupEl('setup-back-label'), screen === 'hub' ? cameFrom : screen === 'rain' ? (setupRain.cameFrom === 'now' ? 'Now' : 'Schedule') : screen === 'people' && peopleUi.from === 'more' ? cameFrom : screen === 'notice' && noticeUi.from === 'tell' ? 'Tell everyone' : 'Set up the week');
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
  else if (screen === 'teams') renderTeamsScreen();
  else if (screen === 'people') renderPeopleScreen();
  else if (screen === 'campers') renderCampersScreen();
  else if (screen === 'games') renderGamesScreen();
  else if (screen === 'wizard') renderNywScreen();
  else if (screen === 'notice') renderNoticeScreen();
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
  peopleUi.from = '';
  noticeUi.from = '';
  campersUiReset();
  if (typeof campersWant === 'function') campersWant(false);
  if (typeof editorsHereStop === 'function') editorsHereStop();
  setupPillHide(true);
  if (nywUi.openNow) { nywUi.openNow = false; if (typeof wizardSetOpen === 'function') wizardSetOpen(false); }
  SETUP_SHEETS.forEach((id) => { if (shell.sheets.includes(id)) shellSheetClose(id); });
}

// Engine events (setup-sync.js onSetupEvent): the cheap targeted paints, only while the builder is up.
function setupUiOnEvent(kind) {
  // The game sheet's dock ("Saving…" → "Saved") follows the sync line, over the Games tab too (the builder need not be open).
  if ((kind === 'sync' || kind === 'commit') && gmUi.open && shell.sheets.includes('game') && typeof renderGameSheet === 'function') renderGameSheet();
  if (!setupUi.wasOpen || !builderOpen()) return;
  if (kind === 'sync') { paintSetupSync(); if (setupScreen() === 'backups') paintRestoreNote(); }
  else if (kind === 'here') { paintSetupHere(); if (setupScreen() === 'hub') paintHub(); }
  else if (kind === 'tree' || kind === 'clashes') { paintSetupSync(); if (setupScreen() === 'hub') paintHub(); else if (setupScreen() === 'people') renderPeopleScreen(); else if (setupScreen() === 'wizard') renderNywScreen(); }
  else if (kind === 'requests') { if (setupScreen() === 'hub') paintHub(); else if (setupScreen() === 'people') renderPeopleScreen(); }
  else if (kind === 'campers') campersRepaint();
  else if (kind === 'commit') { paintSetupSync(); paintSetupDock(); }
}

// ── 4. askDialog: the one confirm of the setup screens ───────────────
// askDialog({ title, body, list, actions, input }) -> Promise of the chosen action's `value`.
//   title    plain text (the dialog's accessible name too)
//   body     a string, or an array of paragraphs (plain text; escaped here, never markup)
//   list     lines shown as a hairline list under the body ("Tuesday's schedule · 4 items")
//   html     markup the CALLER built from escaped parts (a preview table with team marks), shown in
//            place of body + list in the dialog; `body` stays the same words in plain text, which is
//            what the browser's own confirm shows where Jelly's dialog never loaded
//   stack    true: one full-width button a line (a list of choices, e.g. the days to copy from)
//   actions  [{ label, value, kind: 'gold' | 'danger' | 'quiet', cancel: true, sub }] in the order shown (`sub`: one short
//            line under the label, inside the button, saying what that choice does). A
//            verb on every button ("Keep editing", "Discard"), never OK / Cancel. At most one `gold` (THE
//            main action) or `danger` (destructive: danger text, never a red fill); `quiet` is a plain
//            link-like line (a way out after a list of choices). The `cancel` action is what Escape,
//            the ✕ and the backdrop resolve as (null when none).
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
  if (typeof o.html === 'string' && o.html) return o.html;
  const paras = (Array.isArray(o.body) ? o.body : o.body ? [o.body] : []).map((p) => '<p>' + esc(p) + '</p>').join('');
  const list = Array.isArray(o.list) && o.list.length ? '<ul>' + o.list.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '';
  return paras + list;
}

function askActionsHtml(actions) {
  // `sub` (optional) is what the choice does, said INSIDE its own button, so a consequence is never read as the next button's.
  return actions.map((a, i) => '<button type="button" class="' + (a.kind === 'quiet' ? 'btn-quiet' : 'btn') + (a.kind === 'gold' ? ' btn-gold' : a.kind === 'danger' ? ' btn-danger' : '') +
    (a.sub ? ' ask-sub' : '') + '" data-ask-i="' + i + '">' + (a.sub ? '<span class="ask-sub-t">' + esc(a.label) + '</span><span class="ask-sub-s">' + esc(a.sub) + '</span>' : esc(a.label)) + '</button>').join('');
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
  if (typeof box.toggleAttribute === 'function') box.toggleAttribute('data-stack', !!o.stack);
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
  // A change whose alert went to phones: its undo (and a redo of that) tells the same phones, or they would keep a buzz
  // saying Supper is at 6:30 while it is at 6:00 again. The Worker words it ("Supper → 6:00 PM (was 6:30 PM)").
  const told = setupTellLog.has(id);
  const before = told && typeof pushScheduleSnapshot === 'function' ? pushScheduleSnapshot() : null;
  const r = undoEntry(id);
  if (told && r && r.applied) {
    const redo = typeof undoLastRecorded !== 'undefined' && undoLastRecorded ? undoLastRecorded.id : '';
    setupTellAfter(before, true, { entry: redo, undo: true });
  }
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
  else if (id === 'sec-verse') renderSecVerseSheet();
  else if (id === 'team-edit') renderTeamSheet();
  else if (id === 'team-colors') renderTeamColorsSheet();
  else if (PEOPLE_SHEETS.indexOf(id) !== -1) renderPeopleSheetById(id);
  else if (id === 'camper-edit') renderCamperEditSheet();
  else if (id === 'camper-add') renderCamperAddSheet();
  else if (id === 'game') { if (typeof renderGameSheet === 'function') renderGameSheet(); }
  else if (id === 'sg-day') renderGmDaySheet();
  else if (id === 'setup-advanced') renderAdvancedSheet();
  else if (id === 'nyw-staff') renderNywStaffSheet();
  else if (id === 'nyw-undo') renderNywUndoSheet();
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
  if (id === 'team-edit') return !!teamUi.edit;
  if (id === 'team-colors') return teamUi.colors === true;
  if (PEOPLE_SHEETS.indexOf(id) !== -1) return peopleSheetReady(id);
  if (id === 'camper-edit') return !!campersUi.edit;
  if (id === 'camper-add') return !!campersUi.add;
  if (id === 'game') return typeof gmSheetReady === 'function' && gmSheetReady();
  if (id === 'sg-day') return gmIsGamesDay(gmUi.dayDk);
  if (id === 'setup-advanced') return isOwner();
  if (id === 'nyw-staff') return isOwner() && nywUi.staffOpen;
  if (id === 'nyw-undo') return isOwner() && !!nywUi.undo;
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
  setTextIfChanged(setupEl('backups-title'), 'Restore points · ' + campWord());
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
  const holdText = 'Hold to put back ' + campWord() + '’s scores';
  setTextIfChanged(setupEl('rp-hold-label'), holdText);
  setTextIfChanged(setupEl('rp-hold-fill-label'), holdText);
  const conf = setupEl('rp-hold-confirm');
  setHiddenIfChanged(conf, !(scores && ready && rs.reveal));
  setTextIfChanged(conf, 'Yes, put back ' + campWord() + '’s scores');
  setHiddenIfChanged(setupEl('rp-hold-cancel'), !(scores && ready && rs.reveal));
  // Keep / delete (the row's own actions, §7.2): a kept point can't be deleted from the app.
  const manage = setupEl('rp-manage');
  setHiddenIfChanged(manage, !(rs.source === 'index' && rs.row));
  const kind = rs.row && rs.row.kind;
  setHiddenIfChanged(setupEl('rp-keep-row'), !(rs.row && !rs.row.pinned && kind !== 'archive' && kind !== 'pre-wizard'));
  setHiddenIfChanged(setupEl('rp-delete-row'), !(rs.row && restoreDeletable(rs.row)));
  paintArchiveYear(rs);
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
  if (rs.row && rs.row.kind === 'archive') return; // a past year is never put back section by section (its scores would count against this year's window)
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
      const them = CAMPS[res.camp] ? campWord(CAMPS[res.camp]) : 'another camp';
      const choice = await askDialog({
        title: 'That backup is from ' + them, body: 'Copy its schedule, games and teams into ' + campWord() + '? Its scores and everything else are left out.',
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
  const camp = campWord();
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
  setTextIfChanged(setupEl('week-title'), 'Camp week · ' + campWord());
  setTextIfChanged(setupEl('week-headline'), ymd ? weekHeadline(ymd) : 'No dates yet');
  const tree = schedViewTree();
  const follow = SETUP_DK.filter((dk, i) => i >= 1 && i <= 5 && setupMapOf(setupMapOf(tree.days)[dk]).typical === true);
  setTextIfChanged(setupEl('week-lede'), ymd
    ? 'Sunday to Saturday' + (follow.length ? ' · ' + schedDaysWords(follow) + ' follow the typical day' : '')
    : 'Pick the Sunday camp starts. Reminders and the TV page use it.');
  paintPreviewDoor('week', preview);
  // Dates. A native date: the phone's own picker. While the new year is due, the OWNER's route into its setup replaces it;
  // every other director keeps the date and reads whose the setup is (a chevron row that does nothing is a dead button).
  const due = typeof newYearDue === 'function' && !!newYearDue();
  const route = due && isOwner();
  setHiddenIfChanged(setupEl('week-start-row'), route);
  setHiddenIfChanged(setupEl('week-wizard'), !route);
  setHiddenIfChanged(setupEl('week-wizard-owner'), !due || isOwner());
  if (due) {
    const ny = typeof nywNextYear === 'function' ? nywNextYear() : '';
    setTextIfChanged(setupEl('week-wizard-title'), 'Getting ready for ' + (ny || 'the new year') + '?');
    setTextIfChanged(setupEl('week-wizard-owner-text'), ownerSays('starts the new-year setup'));
  }
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
  setTextIfChanged(setupEl('sched-title'), 'Schedule · ' + campWord());
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
  // Add a game here: a Games item that exists (an item being made has no id to hold a game yet) opens the game sheet on it.
  setHiddenIfChanged(setupEl('si-add-game'), !(it.mode === 'edit' && f.kind === 'games' && it.dayKey !== 'typical' && scheduleIsShared() && canEdit()));
  const tell = schedItemTell(it, m);
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
  // "Tell people who follow Supper": ONE 44px row above the save, only for a change the alert sender would tell
  // (schedItemTell); with no signal a plain line in its place. Its state follows the change until the director
  // touches the box (it.tellChose), so a name fix that came after a time move doesn't keep the old default.
  setupTellPaint('si-tell', tell.show && !wait, it, it.tellPainted);
  setTextIfChanged(setupEl('si-tell-label'), tell.label || '');
  setupTellTick('si-tell-check', tell.show && !wait && !tell.offline, tell.def, it.tellChose);
  it.tellPainted = true;
  // Reminders. The tick's caveat lives here, in the body, never in the pinned dock (it pushed Save below the fold), and
  // only while the tick is there to be read with.
  const caveat = tell.show && !wait && !tell.offline ? (tell.kind === 'new' ? 'Only phones that get every schedule reminder hear about a new item, so tell everyone else in person.'
    : 'Only they get an alert about a change, so tell everyone else in person.') : '';
  const remind = it.mode === 'edit' ? 'People who follow “' + setupHeadLabel(it.label0) + '” get reminded before this.' : '';
  setTextIfChanged(setupEl('si-alert-text'), [remind, caveat].filter(Boolean).join(' '));
  setHiddenIfChanged(setupEl('si-alert'), !remind && !caveat);
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
  // The tick row comes and goes with the edit (a typed name, an answered question): measured, it switched the sheet
  // into flow under the finger and put the scope buttons below the fold. It is one compact row, so it is left out.
  const tell = setupEl('si-tell');
  if (tell && !tell.hidden) fixed -= Number(tell.offsetHeight) || 0;
  if (fixed > h * 0.45) { it.flow = true; sheet.setAttribute('data-flow', ''); }
}

// "Tell people who follow …" (ux-R11, P2 §12.2): offered only for a change the alert sender would actually tell — the
// start moved, the NAME changed (not just its team list, which the sender calls "details changed"), or a new item —
// when one of its times on the day being edited (the typical day: the days that follow it) is still to come today or
// tomorrow (push.js pushScheduleTimeTellable, the sender's own window). An end time, an emoji or a kind alone is never
// news to the sender, so it offers nothing. Ticked to start with only for a moved start on a real day; a new item, a
// name fix and a typical-day edit start unticked. `offline`: with no signal the row is a plain line instead.
function schedItemTell(it, m) {
  const none = { show: false, kind: '', def: false, label: '', offline: false };
  if (it.stage || typeof pushScheduleAlertOffered !== 'function' || typeof pushScheduleTimeTellable !== 'function' || !pushScheduleAlertOffered()) return none;
  const item = m.item;
  let kind = '';
  if (it.mode === 'add') kind = 'new';
  else if (m.changed.indexOf('start') !== -1) kind = 'move';
  else if (m.changed.indexOf('label') !== -1 && setupNameKey(setupHeadLabel(it.label0)) !== setupNameKey(setupHeadLabel(item.label))) kind = 'name';
  if (!kind || item.noTime || (it.rec && it.rec.noTime)) return none; // a block with no time is never published
  const typicalDays = () => SETUP_DK.filter((dk) => setupMapOf(setupMapOf(setupTree.days)[dk]).typical === true);
  const dks = it.dayKey === 'typical' ? (m.scopeInfo.change.length ? m.scopeInfo.change : typicalDays()) : [it.dayKey];
  const starts = [item.start].concat(it.rec ? [it.rec.start] : []);
  if (!dks.some((dk) => starts.some((st) => pushScheduleTimeTellable(SETUP_DK.indexOf(dk), st)))) return none;
  const name = setupHeadLabel(it.label0 || item.label);
  const label = kind === 'new' ? 'Tell people who get all reminders' : 'Tell people who follow ' + (name && name.length <= 22 ? name : 'this item');
  return { show: true, kind, def: kind === 'move' && it.dayKey !== 'typical', label, offline: setupNoSignal() };
}

// Known to have no connection (a device with no sync set up is not "offline": nothing would go out anyway).
function setupNoSignal() {
  return typeof restoreHasFirebase === 'function' && restoreHasFirebase() && typeof fbConnKnown !== 'undefined' && fbConnKnown && !fbConnected;
}

// The tick row (#si-tell / #rain-tell): shown or not, and with no signal its plain line (#…-off) instead of the box.
// It unfolds from its top when it appears on a sheet already on screen (§9.5, Now's moment: scaleY .6 → 1 on arrive,
// the overshoot spent as a landing squash), from the diff, never on the sheet's first paint; calm: a 120 ms fade.
function setupTellPaint(id, show, holder, painted) {
  const row = setupEl(id);
  if (!row) return;
  const was = !row.hidden;
  setHiddenIfChanged(row, !show);
  const off = !!(show && setupNoSignal());
  setHiddenIfChanged(setupEl(id + '-check'), off);
  setHiddenIfChanged(setupEl(id + '-off'), !off);
  if (show && !was && painted && typeof JellyMotion !== 'undefined') {
    JellyMotion.play(row, 'arrive', (x) => {
      const o = Math.max(0, x - 1);
      return { transform: 'scale(' + (1 + 0.04 * o) + ', ' + (0.6 + 0.4 * Math.min(1, x)) * (1 - 0.3 * o) + ')', transformOrigin: '50% 0', opacity: Math.min(1, x * 1.6) };
    }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 });
  }
}

// The box follows the default until the director touches it; hidden, it is never left ticked (nothing reads a hidden
// box, but the next time it appears it starts from the default again).
function setupTellTick(id, shown, def, chose) {
  const box = setupEl(id);
  if (!box || chose) return;
  const want = !!(shown && def);
  if (box.hasAttribute('checked') !== want) box.toggleAttribute('checked', want);
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
  const tellBefore = typeof pushScheduleSnapshot === 'function' ? pushScheduleSnapshot() : null;
  const tellEl = setupEl('si-tell-check');
  const tellOn = !!(tellEl && !setupEl('si-tell').hidden && !tellEl.hidden && tellEl.hasAttribute('checked'));
  const recWas = typeof undoLastRecorded !== 'undefined' ? undoLastRecorded : null;
  const r = schedCommit(p);
  if (!r.ok) {
    if (r.reason === 'unpatchable') setupSay('Just ' + SETUP_DAY_WORDS[it.dayKey] + ' can’t change the ' + r.fields + '. Use “Every day like ' + SETUP_DAY_WORDS[it.dayKey] + '”.');
    else if (r.reason === 'gone') setupSay('That item is gone, so the change wasn’t saved.');
    else weekRefused(Object.assign({}, r, { byName: r.byName }));
    return;
  }
  const tellWhat = setupHeadLabel(m.item.label) + (it.mode === 'add' ? ' added' : m.changed.indexOf('start') !== -1 ? ' moved' : ' renamed');
  setupTellAfter(tellBefore, tellOn, { entry: setupTellEntry(recWas), what: tellWhat });
  setupSched.item = null;
  shellSheetClose('sched-item');
}

// After a schedule commit: publish and name what changed to the alert sender (push.js). Fire and forget: the
// commit is done and saved whatever happens here, and a failure is one sentence, never an error on the setup.
// opts: `entry` — the undo entry the commit made (a ticked one is remembered, so undoing it tells the same phones it is
// back: setupUndoRun); `many` — the change named several items (the rain plan); `what` — the change in two or three words
// for the pill ("Supper moved"); `undo` — this is that undo's alert.
// Where the outcome is said (§9.8, the undo pill's reason for being: a toast over the builder swallowed the next tap):
// phones told → on the pill while it still shows this change, else a short toast; nobody told / a failure → a toast that
// stays 8 s, a failure with its own "Try again" (the sender gave the claim back, so a retry still finds the change). A
// "wait 10 seconds" refusal is retried once by itself, quietly (an Undo tapped right after the alert always meets it).
const setupTellLog = new Set(); // undo entry ids whose change was told to phones (this page's memory only)
const SETUP_TELL_SLOW_MS = 8000;
const SETUP_TELL_RATE_MS = 10500;

function setupTellEntry(was) {
  const now = typeof undoLastRecorded !== 'undefined' ? undoLastRecorded : null;
  return now && now !== was ? now.id : '';
}

function setupTellAfter(before, alert, opts) {
  if (typeof pushScheduleTell !== 'function' || !before) return;
  const o = opts || {};
  if (alert && o.entry) setupTellLog.add(o.entry);
  Promise.resolve(pushScheduleTell(before, alert)).then((r) => {
    if (!alert || !r) return;
    if (r.ok === false && r.reason === 'failed' && r.code === 'rate' && !o.retried) {
      setTimeout(() => setupTellAfter(before, true, Object.assign({}, o, { retried: true, entry: '' })), SETUP_TELL_RATE_MS);
      return;
    }
    const n = (r.sent || 0) + (r.queued || 0);
    if (o.undo) { // the change was undone: only "told them it's back" or "they still have the old news" are worth saying
      if (r.ok !== false && n) setupSay('Undone. Told ' + n + ' phone' + (n === 1 ? '' : 's') + ' it’s back as it was.');
      else if (r.ok === false && r.reason === 'failed') setupTellSay('Phones were already told about the change, and the alert that it’s back didn’t go out. Tell people in person.', before, o, true);
      return;
    }
    const w = typeof pushScheduleTellWords === 'function' ? pushScheduleTellWords(r, o.many) : '';
    if (!w) return;
    if (r.ok !== false && n) { if (!setupPillNote(o.entry, o.what, 'told ' + n + ' phone' + (n === 1 ? '' : 's'))) setupSay(w); return; }
    setupTellSay(w, before, o, r.ok === false && r.reason === 'failed');
  }).catch(() => {});
}

// A tick's outcome that needs reading (nobody heard, or it failed): longer than a toast's 4 s, and a failure carries its
// own Try again, which re-names the same change.
function setupTellSay(text, before, o, retry) {
  if (typeof showToast !== 'function') return;
  showToast(text, retry ? { duration: SETUP_TELL_SLOW_MS + 2000, action: { label: 'Try again', run: () => setupTellAfter(before, true, Object.assign({}, o, { retried: false, entry: '' })) } } : { duration: SETUP_TELL_SLOW_MS });
}

// The pill still offers this change's Undo: its words say the phones were told ("Undo  Supper moved · told 23 phones"),
// so the Undo is an informed one, and it stays long enough to be read. The change is said SHORT (`what`): the pill is one
// line and the entry's own label ("Changed Supper · start time, end time on Wednesday") cut the count off. false = say it
// elsewhere.
function setupPillNote(id, what, words) {
  const pill = setupEl('setup-undo');
  if (!id || !pill || pill.hidden || setupUi.pill.id !== id || typeof undoRecent !== 'function') return false;
  const entry = undoRecent().find((e) => e.id === id);
  if (!entry) return false;
  const label = setupEl('setup-undo-label');
  setTextIfChanged(label, (what || undoShape(entry).label) + ' · ' + words);
  clearTimeout(setupUi.pill.timer);
  setupUi.pill.timer = setTimeout(setupPillDock, 4500);
  // At large text the one-line pill cuts the words off: then the count is said in a toast as well.
  return !(label && Number(label.scrollWidth) > Number(label.clientWidth) + 1);
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
    else if (t.id === 'si-tell-check' && setupSched.item) setupSched.item.tellChose = true; // the director's choice from now on
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
    else if (q('#si-add-game')) schedItemAddGame();
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

// "Add a game here" on a Games item's own sheet: the game sheet on that item (edits not yet saved ask first, as any way out does).
function schedItemAddGame() {
  const it = setupSched.item;
  if (!it || it.mode !== 'edit' || it.dayKey === 'typical' || typeof gmOpenNew !== 'function') return;
  if (schedItemGuardClose()) return;
  const dk = it.dayKey;
  const bid = it.bid;
  shellSheetClose('sched-item');
  setupSched.item = null;
  gmOpenNew({ dk, target: bid });
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
  setupRain.tellChose = false;
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
  // "Tell people who follow these" (ux-R11): one 44px row docked above Done, so at any text size the choice is in view
  // beside the button that acts on it. Offered only when the alert sender would tell someone: a start that moved or an
  // item skipped whose time (before or after) is still to come today or tomorrow (push.js pushScheduleTimeTellable, the
  // sender's own window) — a plan for Friday made on Wednesday offers nothing. Ticked to start with (those are exactly
  // the changes people act on) until the director touches it. Its caveat is the body note #rain-tell-note.
  const tellable = typeof pushScheduleAlertOffered === 'function' && typeof pushScheduleTimeTellable === 'function' && pushScheduleAlertOffered() &&
    c.lines.some((l) => (l.kind === 'skip' && pushScheduleTimeTellable(dow, l.start)) ||
      (l.kind === 'time' && l.start !== l.was.start && (pushScheduleTimeTellable(dow, l.start) || pushScheduleTimeTellable(dow, l.was.start))));
  setupTellPaint('rain-tell', tellable, setupRain, setupRain.donePainted);
  setupTellTick('rain-tell-check', tellable && !setupNoSignal(), true, setupRain.tellChose);
  setHiddenIfChanged(setupEl('rain-tell-note'), !tellable || setupNoSignal());
  setHiddenIfChanged(setupEl('rain-offline'), restoreOnline() || !restoreHasFirebase());
  setupRain.donePainted = true;
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
  setupRain.donePainted = false; // the tick row unfolds only when it appears on a sheet already up
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
  const tellBefore = typeof pushScheduleSnapshot === 'function' ? pushScheduleSnapshot() : null;
  const recWas = typeof undoLastRecorded !== 'undefined' ? undoLastRecorded : null;
  const tellItems = rainChanges(setupTree, plan, dow, state.config).lines.filter((l) => l.kind !== 'game').length; // before: the commit makes the plan the tree
  const r = setupCombined(label, (d) => rainCommitMutate(d, plan, keepPaths), hasGames ? () => rainApplyGames(state.config, plan, keepGames) : null);
  if (!r.ok) {
    if (r.reason === 'config-loading') setupSay('Still loading the games list — try again in a moment.');
    else weekRefused(r);
    return;
  }
  const tell = setupEl('rain-tell-check');
  setupTellAfter(tellBefore, !!(tell && !setupEl('rain-tell').hidden && !tell.hidden && tell.hasAttribute('checked')), { entry: setupTellEntry(recWas), many: tellItems !== 1, what: 'Rain plan' });
  const online = restoreOnline() || !restoreHasFirebase();
  rainFinish(true);
  if (!online) setupSay('Saved on your phone only. Nobody else has this yet — it goes out when you have signal.');
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
  if (done) done.addEventListener('change', (e) => { if (e.target && e.target.id === 'rain-tell-check') setupRain.tellChose = true; });
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
  wireTeamsScreen();
  wirePeopleScreen();
  wireCampersScreen();
  wireGamesScreen();
  wireNoticeScreen();
  wireNyw();
  on('#hub-door-watch', 'click', () => { if (typeof nywWatch === 'function') nywWatch(); });
  on('#hub-door-takeover', 'click', () => { if (typeof nywTakeOver === 'function') nywTakeOver(); });
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
  verse: null,       // the open verse sheet: { key: 'theme' | 'mon'… }
  stripDay: undefined,
  slotShown: undefined,
};
// The meal row's emoji picker: one row of food, 44px each, "None" first.
const SEC_FOOD = [['🥞', 'Pancakes'], ['🍳', 'Eggs'], ['🥓', 'Bacon'], ['🧇', 'Waffles'], ['🥣', 'Cereal'], ['🥪', 'Sandwich'], ['🌭', 'Hot dog'], ['🍔', 'Burger'],
  ['🍕', 'Pizza'], ['🌮', 'Tacos'], ['🍝', 'Pasta'], ['🍗', 'Chicken'], ['🍲', 'Stew'], ['🥗', 'Salad'], ['🍦', 'Ice cream'], ['🍪', 'Cookies']];

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
  if (wk.phase === 'during' && days.indexOf(today) !== -1) return today;
  // Not in camp week: open on the first competition day, not on Sunday's lone supper (the menus list every day with a meal).
  const comp = hubCompetitionDks();
  return days.find((d) => comp.indexOf(d) !== -1) || days[0];
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
  // How many days show: seven (the menus' Sunday supper to Saturday breakfast) tighten so the week fits a 360px phone.
  if (track.dataset && track.dataset.n !== String(days.length)) track.dataset.n = String(days.length);
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
function secSetFlag(el, name, on) {
  if (!el || typeof el.hasAttribute !== 'function' || el.hasAttribute(name) === on) return;
  if (on) el.setAttribute(name, ''); else el.removeAttribute(name);
}

// A textarea grows with its words (CSS field-sizing where the browser has it; else its scroll height, once per new value).
function secGrow(el) {
  if (!el || !el.style || typeof el.scrollHeight !== 'number' || !el.offsetParent || el.__grownFor === el.value) return;
  if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content')) return;
  el.__grownFor = el.value;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + el.offsetHeight - el.clientHeight) + 'px';
}

// ── motion (§9.5, the Schedule's way) ──
// A list keyed `data-key` is painted through secPaintList: on the same view an edit glides the survivors to their new places
// once hands are off the list (a remote save never slides a row under a thumb), new rows arrive, and rows whose words changed
// give a small pop (`pulse`, e.g. after Fill evenly); `inner` does the same for the chips inside each keyed row. A new day or
// slot is an immediate replace that slides in from that side. Calm motion, no Jelly or no <template> support is a plain
// replace (and the slide a fade). Its own memo, so an idle renderAll touches nothing.
function secPaintList(list, html, view, o) {
  if (!list || (list.__secHtml === html && list.__secView === view)) return;
  const was = list.__secView;
  const same = list.__secHtml !== undefined && was === view;
  list.__secHtml = html;
  list.__secView = view;
  const calm = typeof calmMotion === 'function' && calmMotion();
  if (!same || calm || typeof JellyMotion === 'undefined' || !JellyMotion.flipKeyed || !list.children || !list.children.length) {
    list.innerHTML = html;
    if (was !== undefined && !same && o && o.dir) secSlideIn(list, o.dir(was, view));
    return;
  }
  JellyMotion.whenHandsOff(() => {
    if (list.__secHtml !== html) return;
    try {
      const inner = o && o.inner ? secInnerRects(list, o.inner) : null;
      const words = {};
      Array.prototype.forEach.call(list.children, (c) => { if (c.dataset && c.dataset.key) words[c.dataset.key] = c.textContent; });
      const added = JellyMotion.flipKeyed(list, html, 'glide') || [];
      added.forEach(secArrive);
      if (inner) secInnerGlide(list, o.inner, inner, added);
      if (o && o.pulse) {
        Array.prototype.forEach.call(list.children, (c) => {
          const k = c.dataset && c.dataset.key;
          const at = k && words[k] !== undefined && words[k] !== c.textContent ? c.querySelector(o.pulse) : null;
          if (at) JellyMotion.play(at, 'press', (x) => ({ transform: 'scale(' + (0.94 + 0.06 * x) + ')', transformOrigin: '0 50%' }), { calm: false });
        });
      }
    } catch (e) { list.innerHTML = html; } // a page that cannot morph (no template support) still shows the list
  });
}
function secArrive(n) {
  if (typeof JellyMotion === 'undefined') return;
  JellyMotion.play(n, 'arrive', (x) => ({ opacity: Math.min(1, x), transform: 'translateY(' + (-10 * (1 - Math.min(1, x))) + 'px)' }), { calm: [{ opacity: 0 }, { opacity: 1 }] });
}
// The list comes in from the side of the day (or slot) that was picked; calm: a short fade.
function secSlideIn(list, dir) {
  if (typeof JellyMotion === 'undefined' || !dir) return;
  JellyMotion.play(list, 'arrive', (x) => ({ opacity: Math.min(1, 0.35 + 0.65 * x), transform: 'translateX(' + (dir * 16 * (1 - x)) + 'px)' }), { calm: [{ opacity: 0.4 }, { opacity: 1 }] });
}
// Which way a view moved: 'tue' / 'tue|1' keys in week order (a slot is a third of a day).
function secViewDir(a, b) {
  const at = (v) => { const p = String(v).split('|'); return SETUP_DK.indexOf(p[0]) * 3 + (Number(p[1]) || 0); };
  const d = at(b) - at(a);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}
// Chips inside each keyed row, by row and chip key, relative to their row (the row may be gliding itself).
function secInnerRects(list, sel) {
  const out = {};
  Array.prototype.forEach.call(list.children, (row) => {
    const rk = row.dataset && row.dataset.key;
    if (!rk) return;
    const rr = row.getBoundingClientRect();
    row.querySelectorAll(sel).forEach((c) => { const r = c.getBoundingClientRect(); out[rk + '|' + c.dataset.key] = { x: r.left - rr.left, y: r.top - rr.top }; });
  });
  return out;
}
function secInnerGlide(list, sel, before, added) {
  Array.prototype.forEach.call(list.children, (row) => {
    const rk = row.dataset && row.dataset.key;
    if (!rk || added.indexOf(row) !== -1) return;
    const rr = row.getBoundingClientRect();
    row.querySelectorAll(sel).forEach((c) => {
      const b = before[rk + '|' + c.dataset.key];
      if (!b) { JellyMotion.play(c, 'arrive', (x) => ({ opacity: Math.min(1, x), transform: 'scale(' + (0.85 + 0.15 * x) + ')' }), { calm: [{ opacity: 0 }, { opacity: 1 }] }); return; }
      const r = c.getBoundingClientRect();
      const dx = b.x - (r.left - rr.left);
      const dy = b.y - (r.top - rr.top);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      JellyMotion.play(c, 'glide', (x) => ({ transform: 'translate(' + dx * (1 - x) + 'px,' + dy * (1 - x) + 'px)' }), { calm: false, layer: true });
    });
  });
}
// The pill that was picked springs into place (the day strip's snap).
function secSnap(el) {
  if (el && typeof JellyMotion !== 'undefined') JellyMotion.play(el, 'snap', (x) => ({ transform: 'scale(' + (0.86 + 0.14 * x) + ',' + (1.1 - 0.1 * x) + ')' }), { calm: false });
}

// ── Meals (§11.10) ──

// One meal: the time and the meal's name, then (live) the dish across the whole row with its emoji button after it — the dish
// first in the tab order — or (a preview) the dish as plain words. Same row either way: turning the section on only swaps which
// half shows. The emoji button's `value` is the emoji; it opens a one-row picker under the dish.
function secMealRowHtml(r) {
  const label = r.it.name;
  const picks = '<button type="button" class="sec-food sec-food-none" data-emo="" aria-pressed="false">None</button>' +
    SEC_FOOD.map((f) => '<button type="button" class="sec-food" data-emo="' + f[0] + '" aria-pressed="false" aria-label="' + esc(f[1]) + '">' + f[0] + '</button>').join('');
  return '<div class="cb-row sec-meal" data-key="' + esc(r.key) + '" data-meal="' + esc(r.it.meal) + '">' +
    '<span class="cb-time">' + secTimeHtml(r.it.start) + '</span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(label) + '</span><span class="cb-sub sec-dish-text" data-meal-text></span></span>' +
    '<span class="cb-end"></span>' +
    '<span class="sec-dish-line"><textarea class="fld-input sec-dish" data-meal-dish rows="1" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="What’s being served" aria-label="' + esc(label) + ' — what’s being served"></textarea>' +
    '<button type="button" class="sec-emo-btn" data-meal-emoji aria-expanded="false" aria-label="' + esc(label) + ' — emoji (optional)"><span class="sec-emo-now" aria-hidden="true"></span><svg class="ico sec-emo-plus" aria-hidden="true"><use href="#i-plus"/></svg></button></span>' +
    '<span class="sec-emo-pick" role="group" aria-label="An emoji for ' + esc(label) + '" hidden>' + picks + '</span></div>';
}

function renderMealsScreen() {
  const live = secLive('meals');
  const tree = secTree('meals');
  const dk = secDayKey('meals');
  const dow = SETUP_DK.indexOf(dk);
  const items = secMealItems(dow);
  const dishes = items.filter((it) => setupMealRecord(tree, dk, it.meal)).length;
  setTextIfChanged(setupEl('meals-title'), 'Meals · ' + campWord());
  setTextIfChanged(setupEl('meals-headline'), SETUP_DAY_WORDS[dk]);
  // An item that reads like a meal but has no Meal tag never gets a row here: say so, so a missing row isn't a mystery.
  const loose = secLooseMeals(planForDow(dow));
  setTextIfChanged(setupEl('meals-lede'), (!items.length ? 'No meals on this day'
    : hubPlural(items.length, 'meal', 'meals') + ' · ' + (dishes === items.length ? 'every one has a dish' : dishes ? dishes + ' with a dish' : 'no dishes yet')) +
    (loose.length ? ' · “' + loose[0] + '” isn’t marked as a meal' : ''));
  const rows = items.map((it) => ({ key: 'm-' + it.meal, it, rec: setupMealRecord(tree, dk, it.meal) }));
  const list = setupEl('meals-list');
  const newDay = !!list && list.__secView !== undefined && list.__secView !== dk;
  if (newDay && list.querySelectorAll) list.querySelectorAll('.sec-emo-pick:not([hidden])').forEach((p) => secMealPicker(p.closest('.sec-meal'), false));
  secPaintKeyed(list, rows, secMealRowHtml, (el, r) => {
    const dish = el.querySelector('[data-meal-dish]');
    const emo = el.querySelector('[data-meal-emoji]');
    const d = r.rec ? r.rec.dish : '';
    const e = r.rec && r.rec.emoji ? r.rec.emoji : '';
    // The rows are kept from day to day (same meals), so what differs by day — the time — is patched too.
    setHtmlIfChanged(el.querySelector('.cb-time'), secTimeHtml(r.it.start));
    secSetValue(dish, d);
    secSetValue(emo, e);
    secSetDisabled(dish, !live);
    secSetDisabled(emo, !live);
    // A preview is words, not fields (§8.1.3: static information is never chunky).
    const text = el.querySelector('[data-meal-text]');
    setTextIfChanged(text, d ? (e ? e + ' ' : '') + d : 'No dish yet');
    setHiddenIfChanged(text, live);
    setHiddenIfChanged(el.querySelector('.sec-dish-line'), !live);
    if (!live) secMealPicker(el, false);
    if (emo) {
      setTextIfChanged(emo.querySelector && emo.querySelector('.sec-emo-now'), emo.value || '');
      secSetFlag(emo, 'data-empty', !emo.value);
    }
    secGrow(dish);
  });
  if (list) {
    if (newDay) secSlideIn(list, secViewDir(list.__secView, dk));
    list.__secView = dk;
  }
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
  const f = setupFocusOut('meals/' + dk + '/' + meal, t.rec ? setupCanonVal(t.rec) : null); // canonical, like the verse form
  if (!f.changed) return;
  const r = mealsSet(dk, meal, t.dish, t.emoji);
  if (!r.ok) { secRefused(r, 'meals'); renderMealsScreen(); }
}

// The emoji picker under one meal's dish: one open at a time.
function secMealPicker(row, open) {
  if (!row || !row.querySelector) return;
  const btn = row.querySelector('[data-meal-emoji]');
  const pick = row.querySelector('.sec-emo-pick');
  if (!btn || !pick || typeof pick.querySelectorAll !== 'function') return;
  const want = open === undefined ? !!pick.hidden : open;
  if (want === !pick.hidden) return;
  if (want) {
    const list = setupEl('meals-list');
    if (list && list.querySelectorAll) list.querySelectorAll('.sec-emo-pick:not([hidden])').forEach((p) => { if (p !== pick) secMealPicker(p.closest('.sec-meal'), false); });
    pick.querySelectorAll('.sec-food').forEach((b) => { const on = String(b.dataset.emo === (btn.value || '')); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); });
  }
  pick.hidden = !want;
  if (typeof btn.setAttribute === 'function') btn.setAttribute('aria-expanded', String(want));
  if (want && typeof JellyMotion !== 'undefined') JellyMotion.play(pick, 'arrive', (x) => ({ opacity: Math.min(1, x), transform: 'translateY(' + (-6 * (1 - Math.min(1, x))) + 'px)' }), { calm: [{ opacity: 0 }, { opacity: 1 }] });
}

// A pick is one commit (the dish as typed, this emoji). The focus baseline is moved to what was just written, so the blur that
// follows doesn't write it a second time.
function secMealPick(row, emoji) {
  if (!row || !secLive('meals')) return;
  const dk = secDayKey('meals');
  const meal = row.dataset.meal;
  const btn = row.querySelector('[data-meal-emoji]');
  secMealPicker(row, false);
  const t = secMealTyped(row);
  if (!t.dish) {
    setupSay('Type the dish first, then pick its emoji.');
    const d = row.querySelector('[data-meal-dish]');
    if (d && typeof d.focus === 'function') d.focus();
    return;
  }
  if (btn) btn.value = emoji;
  const r = mealsSet(dk, meal, t.dish, emoji);
  if (!r.ok) secRefused(r, 'meals');
  if (row.contains && row.contains(document.activeElement)) setupFocusIn('meals/' + dk + '/' + meal);
  renderMealsScreen();
  if (btn && typeof btn.focus === 'function') { try { btn.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  const now = btn && btn.querySelector ? btn.querySelector('.sec-emo-now') : null;
  if (now && typeof JellyMotion !== 'undefined') JellyMotion.play(now, 'press', (x) => ({ transform: 'scale(' + (0.6 + 0.4 * x) + ')' }), { calm: false });
}

async function secMealCopy() {
  if (!secLive('meals')) return;
  const dk = secDayKey('meals');
  const from = secMealCopySources(dk);
  if (!from.length) { setupSay('No other day has a menu to copy yet.'); return; }
  const dishes = (k) => SETUP_MEAL_KEYS.filter((m) => setupMealRecord(setupTree, k, m)).length;
  // The days are rows to pick from, the way out a quiet line after them (it used to be the first cell of the day grid).
  const pick = await askDialog({
    title: 'Copy a menu to ' + SETUP_DAY_WORDS[dk] + '?',
    body: [SETUP_DAY_WORDS[dk] + '’s dishes are replaced by the day you pick. Undo is right there if it’s the wrong one.'],
    stack: true,
    actions: from.slice(0, 6).map((k) => ({ label: SETUP_DAY_WORDS[k] + ' · ' + hubPlural(dishes(k), 'dish', 'dishes'), value: k })).concat([{ label: 'Not now', value: 'no', cancel: true, kind: 'quiet' }]),
  });
  if (!pick || pick === 'no') return;
  const r = mealsCopyDay(pick, dk);
  if (!r.ok) secRefused(r, 'meals');
}

// ── Memory verses (§11.11) ──
// A run sheet: the theme, then a row per competition day ("Mon · Ephesians 2:8–9", the first words under it). A tap opens the
// verse's sheet; a record is committed when focus leaves the sheet's form (Save, the ✕, the backdrop), so moving between its
// fields writes nothing half-typed. A day whose words are still the seed's "to be announced", or that has no reference, carries
// the gold "!" with what's missing.

const SEC_VERSE_SAY = { text: 'A verse needs its words. Type them, or clear the whole verse.', video: 'Use a link that starts with https://', videoOdd: 'That link has a space or a quote in it. Paste it again.' };

function secVerseIsTba(rec) {
  return !!(rec && /\bto be announced\b/i.test(String(rec.text || '')));
}

function secVerseRowHtml(key, rec, live) {
  const theme = key === 'theme';
  const tag = live ? 'button' : 'div';
  const tba = secVerseIsTba(rec);
  const ref = rec && rec.ref ? rec.ref : '';
  const named = theme ? [rec && rec.title, ref].filter(Boolean).join(' · ') : ref;
  const title = named || (rec ? 'No reference yet' : theme ? 'No theme verse yet' : 'No verse yet');
  const sub = !rec ? 'Not set' : tba ? 'Still says “to be announced”' : rec.text;
  const warn = !rec || tba || !ref;
  return '<' + tag + (live ? ' type="button"' : '') + ' class="cb-row sec-row sec-vrow" data-key="v-' + esc(key) + '" data-verse="' + esc(key) + '"' + (warn ? ' data-warn' : '') + '>' +
    '<span class="cb-time">' + esc(theme ? 'Theme' : SETUP_DAY_WORDS[key].slice(0, 3)) + '</span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(title) + '</span><span class="cb-sub sec-vtext">' + esc(sub) + '</span></span>' +
    '<span class="cb-end">' + (live ? '<svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg>' : '') + '</span></' + tag + '>';
}

function renderVersesScreen() {
  const live = secLive('verses');
  const tree = secTree('verses');
  const days = hubCompetitionDks();
  const theme = setupVerseTheme(tree);
  const recs = [['theme', theme]].concat(days.map((dk) => [dk, setupVerseDay(tree, dk)]));
  const missing = days.filter((dk) => !setupVerseDay(tree, dk)).length;
  const tba = recs.filter((r) => secVerseIsTba(r[1])).length;
  const noRef = recs.filter((r) => r[1] && !secVerseIsTba(r[1]) && !r[1].ref).length;
  setTextIfChanged(setupEl('verses-title'), 'Memory verses · ' + campWord());
  // The answer is the headline: the week's theme by name.
  setTextIfChanged(setupEl('verses-headline'), theme && theme.title && !secVerseIsTba(theme) ? theme.title : theme ? 'Theme to be announced' : 'No theme yet');
  const bits = [];
  if (missing) bits.push(hubPlural(missing, 'day has', 'days have') + ' no verse');
  if (tba) bits.push(hubPlural(tba, 'verse still says', 'verses still say') + ' to be announced');
  if (noRef) bits.push(hubPlural(noRef, 'verse has', 'verses have') + ' no reference');
  setTextIfChanged(setupEl('verses-lede'), bits.length ? hubCap(bits.join(' · ')) : live ? 'Every day has its verse. Tap one to change it.' : 'The verses that came with the app.');
  secPaintList(setupEl('verses-list'), recs.map((r) => secVerseRowHtml(r[0], r[1], live)).join(''), 'all', { pulse: '.cb-sub' });
}

function secOpenVerse(key, opener) {
  if (!secLive('verses') || (key !== 'theme' && SETUP_DK.indexOf(key) === -1)) return;
  secFillVerse(key);
  setupSheet('sec-verse', opener);
  const form = setupEl('verses-form');
  const grow = () => { const t = form && form.querySelector ? form.querySelector('[data-verse-field="text"]') : null; secGrow(t); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(grow); else grow();
}
// The form shows one verse, filled from the tree when it opens (never on a repaint: that would undo typing in the other fields).
function secFillVerse(key) {
  const theme = key === 'theme';
  const rec = theme ? setupVerseTheme(setupTree) : setupVerseDay(setupTree, key);
  secUi.verse = { key };
  const form = setupEl('verses-form');
  if (form && form.querySelectorAll) {
    form.dataset.verse = key;
    form.querySelectorAll('[data-verse-only]').forEach((f) => setHiddenIfChanged(f, f.dataset.verseOnly !== (theme ? 'theme' : 'day')));
    form.querySelectorAll('[data-verse-field]').forEach((input) => { const f = input.dataset.verseField; input.value = rec && typeof rec[f] === 'string' ? rec[f] : ''; input.__grownFor = undefined; });
    secVerseSay(form, []);
  }
}

// Raised without a tap (Forward, a history entry) it shows the verse its form is on, fresh from the tree. A section that is
// not edited here shows it read-only.
function renderSecVerseSheet() {
  const form = setupEl('verses-form');
  if (!secUi.verse) secFillVerse(form && form.dataset && form.dataset.verse ? form.dataset.verse : hubCompetitionDks()[0]);
  const s = secUi.verse;
  setTextIfChanged(setupEl('sheet-sec-verse-title'), s.key === 'theme' ? 'Theme verse' : (SETUP_DAY_WORDS[s.key] || 'This day') + '’s verse');
  const live = secLive('verses');
  if (form && form.querySelectorAll) form.querySelectorAll('[data-verse-field]').forEach((input) => secSetDisabled(input, !live));
  secSetDisabled(setupEl('sec-verse-save'), !live);
}

// Save: the blur commits what was typed (secVerseFocusOut); the sheet stays up while anything in it is in error.
function secVerseSave() {
  const form = setupEl('verses-form');
  const a = document.activeElement;
  if (form && a && form.contains && form.contains(a) && typeof a.blur === 'function') a.blur();
  const err = form && form.querySelector ? form.querySelector('[data-verse-error]') : null;
  if (err && !err.hidden) return;
  shellSheetClose('sec-verse');
}

function secVerseGroup(target) {
  return target && target.closest ? target.closest('[data-verse]') : null;
}
function secVersePath(group) {
  return group.dataset.verse === 'theme' ? 'verses/theme' : 'verses/days/' + group.dataset.verse;
}
// The group's fields as a record to hand versesSetTheme / versesSetDay (a field this kind of verse doesn't have is hidden).
function secVerseTyped(group) {
  const rec = {};
  group.querySelectorAll('[data-verse-field]').forEach((input) => {
    if (input.closest && input.closest('[hidden]')) return;
    rec[input.dataset.verseField] = input.value;
  });
  return rec;
}
// Every problem at once (§8.1.6): each field in error is marked (aria-invalid, the danger edge) and the words sit right under
// the first of them.
function secVerseProblems(typed, theme) {
  const t = (k) => String(typed[k] || '').trim();
  const out = [];
  if (!t('text') && (t('ref') || (theme && t('title')) || (!theme && t('video')))) out.push({ field: 'text', say: SEC_VERSE_SAY.text });
  if (!theme && t('video') && !(typeof safeVideoUrl === 'function' && safeVideoUrl(t('video')) && /^https:\/\//.test(t('video')))) out.push({ field: 'video', say: /^https:\/\//.test(t('video')) ? SEC_VERSE_SAY.videoOdd : SEC_VERSE_SAY.video });
  return out;
}
function secVerseSay(group, problems) {
  const err = group.querySelector('[data-verse-error]');
  setTextIfChanged(err, problems.map((p) => p.say).join(' '));
  setHiddenIfChanged(err, !problems.length);
  group.querySelectorAll('[data-verse-field]').forEach((input) => {
    if (typeof input.setAttribute !== 'function') return;
    const bad = problems.some((p) => p.field === input.dataset.verseField);
    if (bad) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'verse-error'); } else if (input.hasAttribute('aria-invalid')) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  });
  const first = problems.length ? group.querySelector('[data-verse-field="' + problems[0].field + '"]') : null;
  const fld = first && first.closest ? first.closest('.fld') : null;
  if (err && fld && fld.parentNode && fld.nextSibling !== err) fld.parentNode.insertBefore(err, fld.nextSibling);
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
  // Compared in the focus-time value's CANONICAL form (keys sorted): versesRecord builds text, ref, title in its own order, so a
  // raw compare never matched a verse that has a reference, and every blur counted as an edit that rewrote a colleague's change.
  const f = setupFocusOut(secVersePath(group), r0.rec ? setupCanonVal(r0.rec) : null);
  // An error is said every time (the field was typed, the commit refused): the director fixes it where it is.
  if (!f.changed && !r0.error) { secVerseSay(group, []); return; }
  const r = theme ? versesSetTheme(typed) : versesSetDay(group.dataset.verse, typed);
  if (r.ok) { secVerseSay(group, []); return; }
  if (r.reason === 'text' || r.reason === 'video') {
    const all = secVerseProblems(typed, theme);
    secVerseSay(group, all.length ? all : [{ field: r.reason, say: SEC_VERSE_SAY[r.reason] }]);
  } else secRefused(r, 'verses');
}

// ── Cleanup rota (§11.12) ──

// A team in words: its shield or flag, then its name (the teams sheet's marks; senior's coloured circles were hue alone, §8.4).
function secTeamHtml(id, name) {
  return '<span class="sec-team">' + teamMarkHtml(id, { size: 20 }) + '<span>' + esc(name) + '</span></span>';
}
function secTeamWords(ids) {
  return ids.map((id) => secTeamHtml(id, teamName(id))).join('<span class="sec-plus" aria-hidden="true"> + </span>');
}

function secCleanupRowHtml(it, dk, tree, live) {
  const ids = setupCleanupIds(tree, dk, it.meal);
  const tag = live ? 'button' : 'div';
  const warn = !ids.length && SETUP_DK.some((k) => setupCleanupTracked(tree, k));
  return '<' + tag + (live ? ' type="button"' : '') + ' class="cb-row sec-row" data-key="c-' + esc(it.meal) + '" data-meal="' + esc(it.meal) + '"' + (warn ? ' data-warn' : '') + '>' +
    '<span class="cb-time">' + secTimeHtml(it.start) + '</span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(it.name) + '</span>' +
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
  setTextIfChanged(setupEl('cleanup-title'), 'Cleanup rota · ' + campWord());
  setTextIfChanged(setupEl('cleanup-headline'), SETUP_DAY_WORDS[dk]);
  setTextIfChanged(setupEl('cleanup-lede'), !items.length ? 'No meals on this day'
    : placed === items.length ? 'Every meal has a team' : placed ? placed + ' of ' + items.length + ' meals have a team' : 'No teams yet');
  secPaintList(setupEl('cleanup-list'), items.map((it) => secCleanupRowHtml(it, dk, tree, live)).join(''), dk, { dir: secViewDir, pulse: '.cb-sub' });
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

// The toggles are written once (per set of teams) and their aria-pressed patched, so a tap pops the very button tapped.
function renderSecTeamsSheet() {
  const s = secUi.teams;
  if (!s) return;
  setTextIfChanged(setupEl('sheet-sec-teams-title'), SETUP_DAY_WORDS[s.dk] + ' · ' + s.name);
  const box = setupEl('sec-teams');
  setHtmlIfChanged(box, teamIds().map((id) =>
    '<button type="button" class="si-team" data-team="' + esc(id) + '" aria-pressed="false">' + teamMarkHtml(id, { size: 24 }) + '<span>' + esc(teamName(id)) + '</span></button>').join(''));
  if (box && box.querySelectorAll) box.querySelectorAll('.si-team[data-team]').forEach((b) => { const on = String(s.picked.indexOf(b.dataset.team) !== -1); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); });
  // Save is always a live verb (it just closes when nothing changed): a dashed, disabled-looking Save read as "off" (§8.3).
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
  const box = setupEl('sec-teams');
  const btn = box && box.querySelector ? box.querySelector('.si-team[data-team="' + id + '"]') : null;
  if (btn && typeof JellyMotion !== 'undefined') JellyMotion.play(btn, 'press', (x) => ({ transform: 'scale(' + (0.9 + 0.1 * x) + ')' }), { calm: false });
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

// Fill evenly: ONE question with the preview in it — a hairline table, a day label then one row per meal (time · meal · the
// teams' marks and short names), the fairness line, any rule it had to bend — then Apply or Not now. When every meal already
// has a team it says that it replaces them all (no second question: Undo covers a mistake). The dialog keeps its two buttons
// in reach at the foot however long the table is (.ask-actions is sticky). `body` is the same preview in words, which is what
// the browser's own confirm shows where Jelly's dialog never loaded.
async function secFillEvenly() {
  if (!secLive('cleanup')) return;
  const slots = secCleanupSlots(setupTree);
  if (!slots.length) return;
  const redo = !slots.some((s) => !s.have.length);
  const res = rotaFillEvenly({ teams: teamIds(), redo, slots: slots.map((s) => ({ day: s.day, meal: s.meal, want: Math.max(1, s.have.length), have: s.have })) });
  const shortName = (id) => teamShort(id) || teamName(id);
  const days = hubCompetitionDks().filter((dk) => res.slots.some((s) => s.day === dk));
  const mealName = (m) => SETUP_MEAL_NAMES[m] || m;
  const lines = days.map((dk) => SETUP_DAY_WORDS[dk] + ': ' + res.slots.filter((s) => s.day === dk).map((s) => mealName(s.meal) + ' ' + (s.teams.map(shortName).join(' + ') || '—')).join(' · '));
  const fair = rotaFairness(res.slots, teamIds(), shortName, (k) => SETUP_DAY_WORDS[k]);
  const relaxed = res.relaxed.length ? 'A few meals couldn’t follow every rule (' + res.relaxed.map((r) => SETUP_DAY_WORDS[r.split(' ')[0]] + ' ' + r.split(' ')[1]).join(', ') + '): there aren’t enough teams to keep each one off the same meal two days running.' : '';
  const lede = redo ? 'This replaces every meal’s team.' : '';
  const table = days.map((dk) => {
    const items = secMealItems(SETUP_DK.indexOf(dk));
    return '<div class="ask-tday"><p class="ask-thead">' + esc(SETUP_DAY_WORDS[dk]) + '</p>' + res.slots.filter((s) => s.day === dk).map((s) => {
      const it = items.find((x) => x.meal === s.meal);
      return '<div class="ask-trow"><span class="ask-ttime">' + (it ? esc(setupClock(it.start)) : '') + '</span><span class="ask-tmeal">' + esc(it ? it.name : mealName(s.meal)) + '</span>' +
        '<span class="ask-tteams">' + (s.teams.length ? s.teams.map((id) => secTeamHtml(id, shortName(id))).join('') : '—') + '</span></div>';
    }).join('') + '</div>';
  }).join('');
  const html = (lede ? '<p>' + esc(lede) + '</p>' : '') + '<div class="ask-table">' + table + '</div><p>' + esc(fair.text) + '</p>' + (relaxed ? '<p>' + esc(relaxed) + '</p>' : '');
  const pick = await askDialog({
    title: redo ? 'Redo the whole rota evenly?' : 'Fill the rota evenly?',
    body: (lede ? [lede] : []).concat(lines, [fair.text], relaxed ? [relaxed] : []),
    html,
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Apply', value: 'apply', kind: 'gold' }],
  });
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

// One station's block, keyed `st-<id>`: its name, its people as chips keyed `p-<pid>` (tap = take off), the quiet "+ Add
// someone" line, and a row for a typed name that nearly matches somebody on the list. In a preview the people are one plain
// line of names ("Sam, Sofia"): static information is never chunky (§8.1.3).
function secStationHtml(row, live, members) {
  const emoji = esc(row.emoji || '🌟');
  const head = (live ? '<button type="button" class="sec-st-name" data-sec-station="' + esc(row.id) + '">' : '<div class="sec-st-name">') +
    '<span aria-hidden="true">' + emoji + '</span><span>' + esc(row.name) + '</span>' + (live ? '<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button>' : '</div>');
  const links = [];
  const chips = row.people.map((p) => {
    const near = live && p.typed ? setupNearMember(p.name, members) : null;
    const first = near ? setupNearLabel(p.name, near) : '';
    if (near) links.push('<div class="sec-link"><span>' + esc(p.name) + ' looks like ' + esc(first) + ' on your list.</span><button type="button" class="btn btn-sm" data-sec-link="' + esc(p.pid) + '" data-sec-member="' + esc(near.key) + '">Yes, it’s ' + esc(first) + '</button></div>');
    return live
      ? '<button type="button" class="sec-chip" data-key="p-' + esc(p.pid) + '" data-sec-off="' + esc(p.pid) + '" data-st="' + esc(row.id) + '"' + (near ? ' data-warn' : '') + ' aria-label="Take ' + esc(p.name) + ' off ' + esc(row.name) + '"><span>' + esc(p.name) + '</span><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>'
      : '<span class="sec-chip">' + esc(p.name) + '</span>';
  }).join('');
  const people = live ? '<div class="sec-st-people">' + chips + '</div>'
    : '<p class="sec-st-people" data-plain>' + (chips || '<span class="sec-nobody">Nobody yet</span>') + '</p>';
  const add = live ? '<button type="button" class="sec-add-link" data-sec-add="' + esc(row.id) + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Add someone</span></button>' : '';
  return '<div class="sec-st" data-key="st-' + esc(row.id) + '" data-st="' + esc(row.id) + '">' + head + people + add + links.join('') + '</div>';
}

function renderElectivesScreen() {
  const live = secLive('electives');
  const tree = secTree('electives');
  const dk = secDayKey('electives');
  const dow = SETUP_DK.indexOf(dk);
  const slot = secSlotNow();
  const rows = setupElectiveRows(tree, dk, slot);
  setTextIfChanged(setupEl('electives-title'), 'Electives · ' + campWord());
  setTextIfChanged(setupEl('electives-headline'), SETUP_DAY_WORDS[dk]);
  setTextIfChanged(setupEl('electives-lede'), rows.length
    ? hubPlural(rows.length, 'station', 'stations') + ' · ' + hubPlural(rows.reduce((n, r) => n + r.people.length, 0), 'person', 'people')
    : 'No stations in this elective yet');
  // Which elective: each segment is its number over its time (from the schedule's Elective item); the label above says what
  // the numbers are, so the segments still fit at 200% text.
  const seg = setupEl('elec-slots');
  if (seg && seg.querySelectorAll) {
    seg.querySelectorAll('.seg-btn[data-slot]').forEach((btn) => {
      const n = Number(btn.dataset.slot);
      const sel = n === slot;
      const at = setupClock(electiveSlotStart(n, dow));
      if (btn.getAttribute('aria-selected') !== String(sel)) btn.setAttribute('aria-selected', String(sel));
      setHtmlIfChanged(btn, '<span class="seg-n">' + (n + 1) + '</span><small>' + esc(at) + '</small>');
      const label = 'Elective ' + (n + 1) + ', ' + at;
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
    });
    if (secUi.slotShown !== undefined && secUi.slotShown !== slot) secSnap(seg.querySelector('.seg-btn[aria-selected="true"]'));
    secUi.slotShown = slot;
  }
  const members = live ? secLinkTargets() : [];
  secPaintList(setupEl('elec-list'), rows.map((r) => secStationHtml(r, live, members)).join(''), dk + '|' + slot, { dir: secViewDir, inner: '.sec-st-people > [data-key]' });
  setHiddenIfChanged(setupEl('elec-hint'), !(live && rows.some((r) => r.people.length)));
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
  return secBreakPeople(tree, dk, slot).map((p) => p.name);
}
// The same people with who they are: a member's key (never for a typed name), so adding them back keeps the key.
function secBreakPeople(tree, dk, slot) {
  const at = {};
  setupElectiveRows(tree, dk, slot).forEach((r) => r.people.forEach((p) => { at[p.name.toLowerCase()] = true; }));
  const out = [];
  const seen = {};
  for (let s = 0; s < 3; s++) {
    setupElectiveRows(tree, dk, s).forEach((r) => r.people.forEach((p) => {
      const k = p.name.toLowerCase();
      if (at[k] || seen[k]) return;
      seen[k] = true;
      out.push({ name: p.name, key: p.typed ? '' : p.pid });
    }));
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function secOpenAddPerson(st, opener) {
  if (!secLive('electives')) return;
  secUi.person = { dk: secDayKey('electives'), slot: secSlotNow(), st };
  const input = setupEl('sec-person-name');
  if (input) input.value = '';
  setupSheet('sec-person', opener);
}

// Who could go to this station: first the people on break in this elective (members and typed names alike — the ones a
// director is looking for), then everyone else on the list, each with where they already are ("At Laser Tag": adding them
// here books them twice) or their team. The icon is the team's mark, or the first letter in a disc.
function secPersonChoices(s) {
  const rows = setupElectiveRows(setupTree, s.dk, s.slot);
  const row = rows.find((r) => r.id === s.st);
  const here = {};
  ((row && row.people) || []).forEach((p) => { here[p.pid] = true; here[p.name.toLowerCase()] = true; });
  const at = {};
  rows.forEach((r) => r.people.forEach((p) => { if (r.id === s.st) return; at[p.name.toLowerCase()] = r.name; if (!p.typed) at[p.pid] = r.name; }));
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  const out = [];
  const taken = {};
  secBreakPeople(setupTree, s.dk, s.slot).forEach((p) => {
    const k = p.name.toLowerCase();
    if (here[k] || (p.key && here[p.key])) return;
    taken[k] = true;
    if (p.key) taken[p.key] = true;
    const m = p.key && dir[p.key];
    out.push({ key: p.key, name: p.name, teamId: (m && m.teamId) || '', sub: 'On break' });
  });
  hubMembers().filter((m) => m.name && !here[m.key] && !here[m.name.toLowerCase()] && !taken[m.key] && !taken[m.name.toLowerCase()])
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .forEach((m) => {
      const where = at[m.key] || at[m.name.toLowerCase()];
      out.push({ key: m.pending ? '' : m.key, name: m.name, teamId: m.teamId, sub: where ? 'At ' + where : m.teamId ? teamName(m.teamId) : '' });
    });
  return out;
}

function renderSecPersonSheet() {
  const s = secUi.person;
  if (!s) return;
  const row = setupElectiveRows(setupTree, s.dk, s.slot).find((r) => r.id === s.st);
  setTextIfChanged(setupEl('sheet-sec-person-title'), 'Add to ' + (row ? row.name : 'this station'));
  const people = secPersonChoices(s);
  setHtmlIfChanged(setupEl('sec-person-list'), people.map((m) =>
    '<button type="button" class="gl-row" data-sec-person="' + esc(m.key) + '" data-sec-name="' + esc(m.name) + '"><span class="gl-ico" aria-hidden="true">' +
    (m.teamId && teamIds().indexOf(m.teamId) !== -1 ? teamMarkHtml(m.teamId, { size: 24 }) : '<span class="sec-initial">' + esc(m.name.trim().charAt(0).toUpperCase()) + '</span>') + '</span>' +
    '<span class="gl-text"><span class="gl-title">' + esc(m.name) + '</span>' + (m.sub ? '<span class="gl-sub">' + esc(m.sub) + '</span>' : '') + '</span></button>').join(''));
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

// Tap a person off: the chip squashes out (scale and fade; calm: a fade), then the commit; the rest glide into the gap once hands
// are off the list (secPaintList). A refused commit brings the chip back.
function secChipOff(chip) {
  if (!chip || (chip.hasAttribute && chip.hasAttribute('data-leaving')) || !secLive('electives')) return;
  const dk = secDayKey('electives');
  const slot = secSlotNow();
  const st = chip.dataset.st;
  const pid = chip.dataset.secOff;
  const go = () => {
    const r = electivePersonRemove(dk, slot, st, pid);
    if (!r.ok) { secSetFlag(chip, 'data-leaving', false); if (chip.style) chip.style.visibility = ''; secRefused(r, 'electives'); }
  };
  secSetFlag(chip, 'data-leaving', true);
  if (typeof JellyMotion === 'undefined' || !JellyMotion.playOut) { go(); return; }
  JellyMotion.playOut(chip, (x) => ({ opacity: 1 - x, transform: 'scale(' + (1 - 0.04 * x) + ')' }), 150, () => { if (chip.style) chip.style.visibility = 'hidden'; go(); });
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
    body: ['Turning ' + (want.length > 1 ? 'them' : 'this') + ' on changes nothing anyone can see until someone edits something.', 'The first time, a restore point is saved first. Each screen has a “Use the original” button at the bottom that puts it all back.'],
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Turn on', value: 'go', kind: 'gold' }],
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
        actions: [{ label: 'Not yet', value: 'no', kind: 'gold' }, { label: 'Yes, it’s running', value: 'yes' }, { label: 'Don’t turn it on', value: 'cancel', cancel: true }],
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
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Use the original', value: 'go', kind: 'gold' }],
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
    // Enter finishes the dish (one line; it only wraps to show it all). Escape folds an open emoji picker.
    meals.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { const row = q(e, '.sec-meal'); if (row && row.querySelector('.sec-emo-pick:not([hidden])')) { e.stopPropagation(); secMealPicker(row, false); } return; }
      if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-meal-dish]') && typeof e.target.blur === 'function') { e.preventDefault(); e.target.blur(); }
    });
    meals.addEventListener('input', (e) => { if (e.target && e.target.matches && e.target.matches('[data-meal-dish]')) secGrow(e.target); });
    meals.addEventListener('click', (e) => {
      let b;
      if ((b = q(e, '.sec-food[data-emo]'))) secMealPick(q(e, '.sec-meal'), b.dataset.emo);
      else if ((b = q(e, '[data-meal-emoji]'))) secMealPicker(q(e, '.sec-meal'));
    });
  }
  on('#meals-copy', 'click', () => { secMealCopy(); });
  // Verses: a row opens its sheet; the sheet's form commits when focus leaves it (not between its own fields).
  on('#verses-list', 'click', (e) => { const b = q(e, 'button.sec-vrow[data-verse]'); if (b) secOpenVerse(b.dataset.verse, b); });
  const verses = setupEl('verses-form');
  if (verses) {
    verses.addEventListener('focusin', (e) => { if (!(e.relatedTarget && verses.contains(e.relatedTarget))) secVerseFocusIn(secVerseGroup(e.target)); });
    verses.addEventListener('focusout', (e) => { if (!(e.relatedTarget && verses.contains(e.relatedTarget))) secVerseFocusOut(secVerseGroup(e.target)); });
    verses.addEventListener('input', (e) => { if (e.target && e.target.matches && e.target.matches('textarea')) secGrow(e.target); });
    verses.addEventListener('submit', (e) => { e.preventDefault(); secVerseSave(); });
  }
  on('#sec-verse-save', 'click', () => secVerseSave());
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
    if ((b = q(e, '[data-sec-off]'))) secChipOff(b);
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


// ── 13. Teams (§11.7 — Step 25) ──────────────────────────────────────────────────────────────────────────────────────
// A fixed list (CAMP.teamCount rows: 6 junior, 4 senior) — no Add, Delete or reorder: the slots t0…tN key results, the rota, alerts
// and the rules. Each row opens ONE sheet: the name (1–60), the short name (1–20, "Used where space is tight, and when people
// mention the team in chat"), the emoji, the colour (twelve swatches, each a pill showing the team on a light chip and a dark chip
// at once), a shield or flag photo, and the counselors' fallback text. Save writes only the fields that changed, as ONE stateEdit
// (one Undo entry, per-field paths, so a second director's change to another field of the same team survives). Renaming a team
// asks about the rest of its identity first (ux-R13): "Also change the short name (Turkey) and emoji (🦃)?".
// Nothing here is a counselor's: the screen is reachable only by an editor, like every screen of the frame, and it names no point.

// The surfaces a team colour is judged against: --sheet in light and in dark (palette.test.js pins them to styles.css).
const TEAM_SURFACE = { light: '#fffdf8', dark: '#161c4b' };
// A colour from before the palette is "hard to read" on a theme when it is under the §8.1 boundary rule (3:1) there.
const TEAM_WEAK_BELOW = 3;
// The emoji grid: a dozen of the animals and mascots the camps use, then some that read well small. A taken one is dimmed.
const TEAM_EMOJI_CHOICES = ['🦊', '🦃', '🍁', '🎃', '🌽', '🚜', '🐻', '🦅', '🐺', '🦉', '🐯', '🦁', '🐸', '🐢', '🐙', '🦈', '🐬', '🦄', '🐲', '🔥', '⚡', '🌟', '🚀', '🏆', '🛡️', '⚓', '🌲', '⛰️', '🌊', '🍂', '🦬', '🐝'];
// "Suggest: Hawks · 🦅": a new name's last word as the short name, with an emoji when the word is one we know.
const TEAM_NAME_EMOJI = {
  fox: '🦊', turkey: '🦃', maple: '🍁', pumpkin: '🎃', corn: '🌽', tractor: '🚜', bear: '🐻', hawk: '🦅', eagle: '🦅', wolf: '🐺', owl: '🦉',
  tiger: '🐯', lion: '🦁', frog: '🐸', turtle: '🐢', octopus: '🐙', shark: '🦈', dolphin: '🐬', unicorn: '🦄', dragon: '🐲', flame: '🔥',
  fire: '🔥', lightning: '⚡', star: '🌟', rocket: '🚀', anchor: '⚓', pine: '🌲', mountain: '⛰️', wave: '🌊', bison: '🦬', bee: '🐝', buffalo: '🦬',
};
const TEAM_PHOTO_W = 346;   // the photo is cut to the shield's 480:667 shape, its long edge 480 px
const TEAM_PHOTO_H = 480;
const TEAM_PHOTO_AIM = 70000; // JPEG quality steps down until the data URL is this small (the rules' cap is 100,000)

const teamUi = {
  edit: null,     // the open team sheet: { id, origin, color, asked, pane, crop, busy, touched }
  colors: false,  // the "Pick new colours" sheet is meant to be open
  colorsFor: null, // the teams it opened for (each keeps its block until the sheet closes)
};

// ── the model: everything the screen, the hub row and the colours sheet say about a team ──

// The colour a team shows, as words and as a judgement: a palette swatch (never weak: the palette clears 4.5:1 on both
// surfaces), the camp's older single colour ("last year's colour"; weak on a theme it is under 3:1 on), or none.
function teamColorInfo(id) {
  const cid = teamColorId(id);
  if (cid) return { id: cid, name: CAMP_TEAM_PALETTE[cid].name, legacy: false, weak: [] };
  const m = /--team-accent-l:(#[0-9a-fA-F]{6});--team-accent-d:(#[0-9a-fA-F]{6})/.exec(teamAccentVars(id));
  if (!m) return { id: '', name: '', legacy: false, weak: [] };
  const weak = [];
  if (campContrast(m[1], TEAM_SURFACE.light) < TEAM_WEAK_BELOW) weak.push('light');
  if (campContrast(m[2], TEAM_SURFACE.dark) < TEAM_WEAK_BELOW) weak.push('dark');
  return { id: '', name: 'Last year’s colour', legacy: true, weak };
}

// id → what hubStatus('teams') judges: the effective short name and emoji, the palette id, the colour's name, the themes it is weak on.
function teamsInfoView() {
  const out = {};
  (state.teams || []).forEach((t) => {
    if (!t || typeof t.id !== 'string') return;
    const c = teamColorInfo(t.id);
    out[t.id] = { short: teamShort(t.id), emoji: teamEmojiOwn(t.id), colorId: c.id, colorName: c.name, weak: c.weak };
  });
  return out;
}

function teamsModel() {
  const info = teamsInfoView();
  const roster = (state.teams || []).filter((t) => t && typeof t.id === 'string');
  const status = hubStatus('teams', { teams: roster, teamCount: CAMP.teamCount, teamInfo: info, isOwner: typeof isOwner === 'function' && isOwner(), ownerName: typeof ownerName === 'function' ? ownerName() : 'the owner' });
  const byColor = {};
  roster.forEach((t) => { const c = info[t.id].colorId; if (c) (byColor[c] = byColor[c] || []).push(t.id); });
  const rows = roster.map((t) => {
    const c = teamColorInfo(t.id);
    const shares = c.id ? (byColor[c.id] || []).filter((x) => x !== t.id) : [];
    const staff = counselorName(t.id);
    return {
      id: t.id, name: String(t.name || '').trim(), short: info[t.id].short, emoji: info[t.id].emoji, color: c, shares,
      photo: teamPhotoVersion(t.id) !== null, staff, campers: campersStatus() === 'ok' ? campersCount(t.id) : null,
      warn: shares.length > 0 || !info[t.id].short || !info[t.id].emoji || !String(t.name || '').trim(),
    };
  });
  return { rows, info, status, weak: rows.filter((r) => r.color.weak.length).map((r) => r.id) };
}

// ── the screen ──

// "Pumpkins and Pilgrims are hard to read in dark mode" / "Pumpkins is hard to read in light mode, Pilgrims in dark mode": the weak
// colours, NAMED (the screen's note and its link must point at teams the director can find on the list above). Short names, in team order.
function teamsWeakSentence(ids) {
  const nameOf = (id) => teamShort(id) || teamName(id) || id;
  const modes = (id) => hubJoin(teamColorInfo(id).weak);
  const byModes = {};
  ids.forEach((id) => { (byModes[modes(id)] = byModes[modes(id)] || []).push(nameOf(id)); });
  const keys = Object.keys(byModes);
  if (keys.length === 1) return hubJoin(byModes[keys[0]]) + (byModes[keys[0]].length === 1 ? ' is' : ' are') + ' hard to read in ' + keys[0] + ' mode.';
  return keys.map((k, i) => hubJoin(byModes[k]) + (i ? '' : byModes[k].length === 1 ? ' is hard to read' : ' are hard to read') + ' in ' + k + ' mode').join(', ') + '.';
}

function teamRowHtml(r) {
  const dot = r.color.id || r.color.legacy ? '<i class="tms-dot" data-team="' + esc(r.id) + '"' + teamAccentAttr(r.id) + ' aria-hidden="true"></i>' : '';
  // The camp's own built-in colour reads "Original colour" (the glossary of the shipped screens: "The original menu"); one that is weak on a
  // theme says so on its own line's words, so the note under the list names a team the director can see here.
  const colorName = r.color.legacy ? 'Original colour' : r.color.name;
  const weakWords = r.color.weak.length ? ' · hard to read in ' + hubJoin(r.color.weak) + ' mode' : '';
  const colorWords = colorName ? dot + esc(colorName) + esc(weakWords) + (r.shares.length ? ' · same as ' + esc(r.shares.map((x) => teamShort(x) || teamName(x)).join(', ')) : '') : 'No colour yet';
  const sub = [r.short ? esc(r.short) : '', r.emoji ? esc(r.emoji) : '', colorWords].filter(Boolean).join(' · ');
  return '<button type="button" class="cb-row sec-row tms-row" data-key="t-' + esc(r.id) + '" data-team-open="' + esc(r.id) + '"' + (r.warn ? ' data-warn' : '') + '>' +
    '<span class="cb-time tms-mark">' + teamMarkHtml(r.id, { size: 40 }) + '</span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(r.name || 'Unnamed team') + '</span>' +
    '<span class="cb-sub">' + sub + '</span>' +
    '<span class="cb-sub tms-staff">' + (r.staff ? esc(r.staff) : 'No counselors yet') + (r.campers !== null && r.campers !== undefined ? ' · ' + esc(hubPlural(r.campers, 'camper', 'campers')) : '') + '</span></span>' +
    '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

function renderTeamsScreen() {
  const m = teamsModel();
  const st = m.status;
  setTextIfChanged(setupEl('teams-title'), 'Teams · ' + campWord());
  setTextIfChanged(setupEl('teams-headline'), st.problems.length ? st.problems[0] : st.summary);
  setTextIfChanged(setupEl('teams-lede'), st.problems.length > 1 ? hubPlural(st.problems.length - 1, 'more thing', 'more things') + ' to check' : st.problems.length ? 'Tap a team to fix it.' : 'Tap a team to change its name, colour or photo.');
  secPaintList(setupEl('teams-list'), m.rows.map(teamRowHtml).join(''), 'teams', { pulse: '.cb-sub' });
  // A camp whose roster doesn't match (slots missing, an id that isn't tN) can only be repaired by the owner: said in a line, never a button.
  const repair = st.problems.find((p) => /team slots/.test(p)) || '';
  setTextIfChanged(setupEl('teams-repair-text'), repair);
  setHiddenIfChanged(setupEl('teams-repair'), !repair);
  // Original colours that are hard to see on a theme: a gentle note that NAMES them, and the one place to fix them all, named too.
  const weakShort = m.weak.map((id) => teamShort(id) || teamName(id) || id);
  setTextIfChanged(setupEl('teams-weak-text'), weakShort.length ? teamsWeakSentence(m.weak) : '');
  setTextIfChanged(setupEl('teams-weak-btn-text'), weakShort.length ? 'Pick new colours for ' + hubJoin(weakShort) : '');
  setHiddenIfChanged(setupEl('teams-weak'), !weakShort.length);
  if (teamUi.colors && !m.weak.length) { teamUi.colors = false; if (shell.sheets.includes('team-colors')) shellSheetClose('team-colors'); }
}

// ── the team sheet ──

function teamFieldEl(name) { return setupEl('team-' + name); }

// What the form holds right now (the inputs are the draft: nothing is mirrored per keystroke).
function teamFormValues() {
  const e = teamUi.edit;
  const val = (n) => { const el = teamFieldEl(n); return el && typeof el.value === 'string' ? el.value : ''; };
  return {
    name: val('name').replace(/\s+/g, ' ').trim(),
    short: val('short').replace(/\s+/g, ' ').trim(),
    emoji: val('emoji').trim(),
    counselor: val('counselor').replace(/\s+/g, ' ').trim(),
    color: e ? e.color : '',
  };
}

// The rules' limits, in words, before anything is written (a value the rules would refuse is a parked, never-saved write).
function teamFormProblems(f) {
  const p = {};
  if (!f.name) p.name = 'Give the team a name.';
  else if (f.name.length > 60) p.name = 'Keep the name to 60 characters.';
  if (f.short && !teamShortValid(f.short)) p.short = f.short.length > 20 ? 'Keep the short name to 20 characters.' : 'Leave out < > & and quote marks.';
  if (f.emoji && !teamEmojiValid(f.emoji)) p.emoji = f.emoji.length > 16 ? 'That is more than one emoji.' : 'Use an emoji, without < > & or quote marks.';
  return p;
}

// "Hawks" and an emoji from a new name: its last word (letters, digits, apostrophes; at most 20) and, when that word is one we know
// (singular or plural), its emoji. Either may be '' (nothing to suggest).
function teamSuggest(name) {
  const words = String(name || '').match(/[A-Za-z0-9’']+/g) || [];
  const last = words.length ? words[words.length - 1] : '';
  const short = last && teamShortValid(last) ? last : '';
  const key = last.toLowerCase().replace(/’/g, '');
  const emoji = TEAM_NAME_EMOJI[key] || TEAM_NAME_EMOJI[key.replace(/(?:es|s)$/, '')] || TEAM_NAME_EMOJI[key.replace(/s$/, '')] || '';
  return { short, emoji };
}

function teamOpen(id, opener) {
  if (!canEdit()) return;
  const rec = teamRecord(id);
  if (!rec) return;
  // What the fields show is what the team shows now (its own value, else the camp's default; a team with no default emoji starts empty,
  // not on the placeholder flag), so opening and saving without a change writes nothing.
  const origin = { name: String(rec.name || '').trim(), short: teamShort(id), emoji: teamEmojiOwn(id), counselor: String(rec.counselor || '').trim(), color: teamColorId(id) };
  teamUi.edit = { id, origin, color: origin.color, asked: false, pane: 'form', crop: null, busy: false, touched: false, error: {}, fresh: true };
  setupSheet('team-edit', opener);
}

// Fills the inputs when the sheet opens (never on a repaint: a repaint must not take a typed word away).
function teamFillForm() {
  const e = teamUi.edit;
  if (!e || !e.fresh) return;
  e.fresh = false;
  const set = (n, v) => { const el = teamFieldEl(n); if (el && el.value !== v) el.value = v; };
  set('name', e.origin.name);
  set('short', e.origin.short);
  set('emoji', e.origin.emoji);
  set('counselor', e.origin.counselor);
  const sc = setupEl('sheet-team-edit');
  if (sc && sc.dataset && sc.dataset.pane !== 'form') sc.dataset.pane = 'form';
}

function teamDirty() {
  const e = teamUi.edit;
  if (!e) return false;
  const f = teamFormValues();
  const o = e.origin;
  return f.name !== o.name || f.short !== o.short || f.emoji !== o.emoji || f.counselor !== o.counselor || f.color !== o.color;
}

function renderTeamSheet() {
  const e = teamUi.edit;
  if (!e) return;
  teamFillForm();
  const rec = teamRecord(e.id);
  const sheet = setupEl('sheet-team-edit');
  if (sheet && sheet.dataset && sheet.dataset.pane !== e.pane) sheet.dataset.pane = e.pane;
  const f = teamFormValues();
  setTextIfChanged(setupEl('sheet-team-edit-title'), e.pane === 'crop' ? 'Fit the photo' : 'Edit team');
  setHiddenIfChanged(setupEl('team-pane-back'), e.pane !== 'crop');
  // The crest as it WILL be drawn (the photo, the shield, the flag or the emoji tile): a colour picked here shows on the flag or the
  // tile at once, before Save, so the director sees the pick land on the team's own mark. Then what the photo buttons offer.
  const markEl = setupEl('team-mark');
  if (markEl) setHtmlIfChanged(markEl, teamMarkPreviewHtml(e.id, e.color, 56));
  const hasPhoto = teamPhotoVersion(e.id) !== null;
  setTextIfChanged(setupEl('team-photo-add-text'), hasPhoto ? 'Replace photo' : 'Add a photo');
  setHiddenIfChanged(setupEl('team-photo-remove'), !hasPhoto);
  const offline = !teamOnline();
  setTextIfChanged(setupEl('team-photo-note'), offline ? 'Photos need a connection. Try again when you are back online.' : 'We’ll fit it to the shield’s shape.');
  secSetDisabled(setupEl('team-photo-add'), e.busy);
  // Errors, each under its own field (aria-invalid on the field, the words under it).
  const probs = Object.assign({}, teamFormProblems(f), e.error || {});
  ['name', 'short', 'emoji'].forEach((n) => {
    const el = teamFieldEl(n);
    if (el && el.setAttribute) { if (probs[n]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
    const msg = setupEl('team-' + n + '-error');
    const show = !!(e.error && e.error[n]) || (e.touched && !!probs[n]);
    setTextIfChanged(msg, show ? probs[n] : '');
    setHiddenIfChanged(msg, !show);
  });
  // The swatches (written once per sheet: the pill shows the team's short name) and their chosen state.
  const others = teamIds().filter((x) => x !== e.id);
  const label = f.short && teamShortValid(f.short) ? f.short : e.origin.short || e.origin.name || 'Team';
  const usedBy = (cid) => others.filter((x) => teamColorId(x) === cid).map((x) => teamShort(x) || teamName(x));
  setHtmlIfChanged(setupEl('team-swatches'), Object.keys(CAMP_TEAM_PALETTE).map((cid) => {
    const sw = CAMP_TEAM_PALETTE[cid];
    const used = usedBy(cid);
    return '<button type="button" class="tms-swatch" role="radio" aria-checked="false" data-team-color="' + cid + '" aria-label="' + esc(sw.name + (used.length ? ', also ' + used.join(', ') : '')) + '">' +
      '<span class="tms-chips"><span class="tms-chip tms-chip-l" style="--c:' + sw.l + '">' + esc(label) + '</span><span class="tms-chip tms-chip-d" style="--c:' + sw.d + '">' + esc(label) + '</span></span>' +
      '<span class="tms-swatch-name">' + esc(sw.name + (used.length ? ' · ' + used.join(', ') : '')) + '</span></button>';
  }).join(''));
  const swBox = setupEl('team-swatches');
  if (swBox && swBox.querySelectorAll) swBox.querySelectorAll('.tms-swatch').forEach((b) => { const on = String(b.dataset.teamColor === e.color); if (b.getAttribute('aria-checked') !== on) b.setAttribute('aria-checked', on); });
  // No swatch picked: say what the team wears now, so twelve unpicked tiles never read as "nothing" (the camp's own colour, with its dot).
  const nowEl = setupEl('team-color-now');
  const legacyNow = !e.color && teamColorInfo(e.id).legacy;
  if (nowEl) setHtmlIfChanged(nowEl, e.color ? '' : legacyNow ? 'Now: the original colour <i class="tms-dot" data-team="' + esc(e.id) + '"' + teamAccentAttr(e.id) + ' aria-hidden="true"></i>' : 'No colour yet: pick one.');
  setHiddenIfChanged(nowEl, !!e.color);
  // The counselor names typed here show only while nobody on this team signs in: say which is true right now.
  const signedIn = typeof teamStaffNames === 'function' ? teamStaffNames(e.id) : [];
  setTextIfChanged(setupEl('team-counselor-hint'), signedIn.length
    ? 'Not shown now: ' + respellCounselorText(hubJoin(signedIn.map((n) => String(n)))) + (signedIn.length === 1 ? ' signs in for this team.' : ' sign in for this team.')
    : 'Shown now: nobody on this team signs in yet.');
  // The emoji grid: the picked one is pressed, one another team uses is dimmed and says whose.
  const takenBy = {};
  others.forEach((x) => { const em = teamEmojiOwn(x); if (em) takenBy[em] = teamShort(x) || teamName(x); });
  setHtmlIfChanged(setupEl('team-emoji-grid'), TEAM_EMOJI_CHOICES.map((em) =>
    '<button type="button" class="tms-emo" data-team-emoji="' + esc(em) + '" aria-pressed="false"' + (takenBy[em] ? ' aria-disabled="true" data-taken aria-label="' + esc(em + ', ' + takenBy[em] + ' uses it') + '"' : ' aria-label="' + esc(em) + '"') + '>' + esc(em) + '</button>').join(''));
  const grid = setupEl('team-emoji-grid');
  if (grid && grid.querySelectorAll) grid.querySelectorAll('.tms-emo').forEach((b) => { const on = String(b.dataset.teamEmoji === f.emoji); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); });
  // Dimmed is never the only signal: one line under the grid says whose each dimmed emoji is.
  const taken = TEAM_EMOJI_CHOICES.filter((em) => takenBy[em]).map((em) => em + ' ' + takenBy[em]);
  setTextIfChanged(setupEl('team-emoji-taken'), taken.length ? 'Dimmed ones are taken: ' + taken.join(', ') + '.' : '');
  // The rename question, inline (never a dialog over the sheet): shown by Save when the name changed and nothing else of its identity did.
  const q = e.ask;
  setHiddenIfChanged(setupEl('team-rename-q'), !q);
  if (q) {
    setTextIfChanged(setupEl('team-rename-q-text'), q.text);
    setTextIfChanged(setupEl('team-rename-suggest-text'), q.suggestLabel);
  }
  setHiddenIfChanged(setupEl('team-save'), e.pane === 'crop');
  setHiddenIfChanged(setupEl('team-crop-use'), e.pane !== 'crop');
  setTextIfChanged(setupEl('team-crop-use-text'), e.busy ? 'Saving the photo…' : 'Use this photo');
  secSetDisabled(setupEl('team-crop-use'), e.busy);
  if (rec) setTextIfChanged(setupEl('team-head-name'), rec.name || '');
}

// The team's mark with a colour picked in the sheet laid over it (unsaved): the flag's fill or the tile's edge follows the swatch for the
// theme in force. A shield (artwork or a photo) wears no colour and is drawn as it is. The pair comes from the frozen palette constant, never
// from anything stored, and replaces only the style teamMarkHtml wrote (its shape is fixed: `style="--tm:Npx…"`).
function teamMarkPreviewHtml(id, cid, size) {
  const html = teamMarkHtml(id, { size });
  const sw = cid && cid !== teamColorId(id) && Object.prototype.hasOwnProperty.call(CAMP_TEAM_PALETTE, cid) ? CAMP_TEAM_PALETTE[cid] : null;
  if (!sw) return html;
  const pair = '--team-accent-l:' + sw.l + ';--team-accent-d:' + sw.d;
  if (/^<svg class="tm flag"/.test(html)) return html.replace(/ style="--tm:(\d+)px[^"]*"/, ' style="--tm:$1px;' + pair + ';--flag-fill:var(--team)"');
  if (/^<span class="tm tm-tile"/.test(html)) return html.replace(/ style="--tm:(\d+)px[^"]*"/, ' style="--tm:$1px;' + pair + ';--tm-accent:var(--team)"');
  return html;
}

function teamTouched() {
  const e = teamUi.edit;
  if (!e) return;
  e.touched = true;
  e.error = {};
  if (e.ask) e.ask = null;
  renderTeamSheet();
}

function teamPickColor(cid) {
  const e = teamUi.edit;
  if (!e || !teamColorValid(cid)) return;
  e.color = cid;
  renderTeamSheet();
  const b = setupEl('team-swatches') && setupEl('team-swatches').querySelector ? setupEl('team-swatches').querySelector('.tms-swatch[data-team-color="' + cid + '"]') : null;
  if (b && typeof JellyMotion !== 'undefined') JellyMotion.play(b, 'press', (x) => ({ transform: 'scale(' + (0.93 + 0.07 * x) + ')' }), { calm: false });
}

function teamPickEmoji(em) {
  const e = teamUi.edit;
  const el = teamFieldEl('emoji');
  if (!e || !el || !teamEmojiValid(em)) return;
  const taken = teamIds().filter((x) => x !== e.id && teamEmojiOwn(x) === em).map((x) => teamShort(x) || teamName(x));
  if (taken.length) { e.error = { emoji: taken[0] + ' already uses ' + em + '.' }; renderTeamSheet(); return; }
  el.value = em;
  e.error = {};
  e.touched = true;
  renderTeamSheet();
}

// Save: validate, ask the rename question once, then ONE stateEdit of only the changed fields (looked up by id when it runs).
function teamSave() {
  const e = teamUi.edit;
  if (!e || e.busy) return;
  const f = teamFormValues();
  const probs = teamFormProblems(f);
  if (Object.keys(probs).length) {
    e.touched = true;
    e.error = probs;
    renderTeamSheet();
    const first = ['name', 'short', 'emoji'].find((n) => probs[n]);
    const el = first && teamFieldEl(first);
    if (el && el.focus) el.focus();
    return;
  }
  const o = e.origin;
  const renamed = f.name !== o.name;
  const identityTouched = f.short !== o.short || f.emoji !== o.emoji;
  if (renamed && !identityTouched && !e.asked) {
    const sg = teamSuggest(f.name);
    e.ask = {
      text: 'Also change the short name' + (o.short ? ' (' + o.short + ')' : '') + (o.emoji ? ' and emoji (' + o.emoji + ')' : '') + '? Chat mentions and the morning-meeting label use them.',
      suggest: sg, suggestLabel: sg.short || sg.emoji ? 'Suggest: ' + [sg.short, sg.emoji].filter(Boolean).join(' · ') : '',
    };
    // Nothing to suggest (a name with no usable last word): the question has one honest answer.
    if (!e.ask.suggestLabel) { e.ask = null; e.asked = true; teamSave(); return; }
    renderTeamSheet();
    return;
  }
  teamCommit(f);
}

function teamAnswerRename(answer) {
  const e = teamUi.edit;
  if (!e || !e.ask) return;
  const sg = e.ask.suggest;
  e.asked = true;
  e.ask = null;
  if (answer === 'suggest') {
    if (sg.short) { const el = teamFieldEl('short'); if (el) el.value = sg.short; }
    if (sg.emoji) { const el = teamFieldEl('emoji'); if (el) el.value = sg.emoji; }
  }
  teamSave();
}

function teamCommit(f) {
  const e = teamUi.edit;
  if (!e) return;
  const o = e.origin;
  const id = e.id;
  const oldName = o.name || id;
  const label = f.name !== o.name ? 'Renamed ' + oldName + (f.name ? ' to ' + f.name : '') : 'Changed ' + (f.name || oldName);
  const ok = stateEdit(label, () => {
    const t = teamRecord(id);
    if (!t) return false;
    if (f.name !== o.name) t.name = f.name;
    if (f.counselor !== o.counselor) t.counselor = f.counselor;
    if (f.short !== o.short) { if (f.short) t.short = f.short; else delete t.short; }
    if (f.emoji !== o.emoji) { if (f.emoji) t.emoji = f.emoji; else delete t.emoji; }
    if (f.color !== o.color && f.color) t.color = f.color;
    return true;
  });
  if (ok === false) { setupSay('That team is not on the list any more, so nothing was changed.'); }
  // A team's short name and emoji end up in the schedule's labels (the morning meeting's tail), and the published schedule
  // carries those labels: republish it (identical content writes nothing; a colleague's device catches up on its next load).
  else if ((f.short !== o.short || f.emoji !== o.emoji) && typeof pushScheduleSoon === 'function') pushScheduleSoon();
  teamUi.edit = null;
  shellSheetClose('team-edit');
  renderAll();
}

// Closing by any route asks before it throws a half-made edit away (✕, the backdrop, Escape and the phone's Back all come
// here). true = taken over (a question is up, or already was: the sheet stays); false = nothing at stake.
function teamGuardClose(closing) {
  const e = teamUi.edit;
  if (!e || !shell.sheets.includes('team-edit')) return false;
  if (e.busy) return true; // a photo is going up: the sheet stays until it has landed or failed
  // Escape and the phone's Back inside the photo pane leave the pane, not the sheet (the ✕ and the backdrop close the sheet).
  if (e.pane === 'crop' && !closing) { teamSetPane('form'); return true; }
  if (!teamDirty()) return false;
  if (askIsOpen()) return true;
  askDialog({ title: 'Discard your changes to ' + (e.origin.name || 'this team') + '?', body: 'They haven’t been saved yet.', actions: [{ label: 'Keep editing', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }] })
    .then((v) => { if (v === 'discard' && teamUi.edit === e) { teamUi.edit = null; shellSheetClose('team-edit'); } });
  return true;
}

// An open sheet with unsaved edits, or a photo going up, holds the deploy's auto-reload (the form lives in memory only).
function teamEditBusy() {
  const e = teamUi.edit;
  return !!(e && typeof shell !== 'undefined' && shell.sheets.includes('team-edit') && (e.busy || teamDirty()));
}

// ── the photo: pick, fit, encode, upload ──

// Photos are online-only: the node is written first, then the record's photoV.
function teamOnline() {
  return !!fbRef && !(fbConnKnown && !fbConnected);
}

// A sheet pane changing in place arrives from the side it came from, as the rain plan's panes do (§9.5): forward from the right, Back from
// the left, the spring's overshoot spent as a small landing squash, never a slide past rest. Calm: a fade (no transform keyframe).
function setupPaneArrive(el, back) {
  if (!el || typeof JellyMotion === 'undefined') return;
  const dir = back ? -1 : 1;
  JellyMotion.play(el, 'arrive', (x) => {
    const o = Math.max(0, x - 1);
    return { opacity: Math.min(1, x * 1.6), transform: 'translateX(' + (dir * 24 * (1 - Math.min(1, x))) + 'px) scale(' + (1 - 0.6 * o) + ',' + (1 + 0.3 * o) + ')', transformOrigin: dir > 0 ? '0 50%' : '100% 50%' };
  }, { calm: [{ opacity: 0 }, { opacity: 1 }] });
}

function teamSetPane(pane) {
  const e = teamUi.edit;
  if (!e) return;
  const was = e.pane;
  e.pane = pane;
  if (pane === 'form') e.crop = null;
  renderTeamSheet();
  if (was !== pane && typeof document !== 'undefined' && document.querySelector) setupPaneArrive(document.querySelector('#sheet-team-edit [data-team-pane="' + pane + '"]'), pane === 'form');
  const body = setupEl('team-form');
  if (pane === 'form' && body && body.scrollTo) { try { body.scrollTo(0, 0); } catch (x) { /* fine */ } }
}

// Where the picture sits in the frame: the image covers the frame (never a gap), moved by (ox, oy) frame pixels and zoomed 1–3×;
// the offset is clamped so the frame always stays covered. Pure.
function teamCropRect(st) {
  const zoom = Math.min(3, Math.max(1, Number(st.zoom) || 1));
  const s = Math.max(TEAM_PHOTO_W / st.w, TEAM_PHOTO_H / st.h) * zoom;
  const dw = st.w * s;
  const dh = st.h * s;
  const mx = Math.max(0, (dw - TEAM_PHOTO_W) / 2);
  const my = Math.max(0, (dh - TEAM_PHOTO_H) / 2);
  const ox = Math.min(mx, Math.max(-mx, Number(st.ox) || 0));
  const oy = Math.min(my, Math.max(-my, Number(st.oy) || 0));
  return { dx: (TEAM_PHOTO_W - dw) / 2 + ox, dy: (TEAM_PHOTO_H - dh) / 2 + oy, dw, dh, ox, oy };
}

// The first data URL (best quality first) that fits the aim, else the best one under the cap, else null. Pure.
function teamPhotoFit(urls, aim, cap) {
  const list = (urls || []).filter((u) => typeof u === 'string');
  return list.find((u) => u.length <= aim) || list.find((u) => u.length <= cap) || null;
}

// '#rrggbb' lightened toward white, for the tint a transparent photo is flattened onto. Pure.
function teamTint(hex, amount) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return TEAM_SURFACE.light;
  const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0');
  return '#' + mix(1) + mix(3) + mix(5);
}

function teamCropDraw() {
  const e = teamUi.edit;
  const c = e && e.crop;
  const canvas = setupEl('team-crop-canvas');
  if (!c || !canvas || !canvas.getContext) return;
  const r = teamCropRect(c);
  c.ox = r.ox; c.oy = r.oy;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, TEAM_PHOTO_W, TEAM_PHOTO_H);
  ctx.drawImage(c.img, r.dx, r.dy, r.dw, r.dh);
}

async function teamPhotoChosen(file) {
  const e = teamUi.edit;
  if (!e || !file) return;
  if (!teamOnline()) { setupSay('Photos need a connection. Try again when you are back online.'); return; }
  let img;
  try { img = await loadImage(file); } catch (err) { img = null; }
  if (teamUi.edit !== e) return;
  const w = img && (img.width || img.naturalWidth);
  const h = img && (img.height || img.naturalHeight);
  if (!img || !(w > 0) || !(h > 0)) { setupSay('That file could not be opened as a picture.'); return; }
  e.crop = { img, w, h, zoom: 1, ox: 0, oy: 0 };
  const zoom = setupEl('team-crop-zoom');
  if (zoom) zoom.value = '1';
  teamSetPane('crop');
  teamCropDraw();
}

// The frame's pixels → PNG when any is see-through (and it fits), else JPEG (on the team's light tint when it had see-through parts),
// quality stepping down until it is under the aim; null when even the lowest is over the cap. { data, kind }.
function teamPhotoEncode(canvas, tintHex) {
  const ctx = canvas.getContext('2d');
  const px = ctx.getImageData(0, 0, TEAM_PHOTO_W, TEAM_PHOTO_H).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) { if (px[i] < 255) { alpha = true; break; } }
  if (alpha) {
    const png = canvas.toDataURL('image/png');
    if (png.length <= TEAM_PHOTO_MAX) return { data: png, kind: 'png' };
  }
  let flat = canvas;
  if (alpha) {
    flat = document.createElement('canvas');
    flat.width = TEAM_PHOTO_W; flat.height = TEAM_PHOTO_H;
    const f = flat.getContext('2d');
    f.fillStyle = tintHex || TEAM_SURFACE.light;
    f.fillRect(0, 0, TEAM_PHOTO_W, TEAM_PHOTO_H);
    f.drawImage(canvas, 0, 0);
  }
  const urls = [];
  for (const q of [0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28]) {
    const u = flat.toDataURL('image/jpeg', q);
    urls.push(u);
    if (u.length <= TEAM_PHOTO_AIM) break;
  }
  const data = teamPhotoFit(urls, TEAM_PHOTO_AIM, TEAM_PHOTO_MAX);
  return data ? { data, kind: 'jpeg' } : null;
}

// Write teamPhotos/<tid> = { v, data } first (awaited), then the record's photoV through the state engine. A failure at either step
// leaves the team exactly as it was. Not undoable: the node holds only the newest upload, so an older photoV would point at a photo
// that is gone. Resolves { ok, reason? }.
// How long a photo may take to go up before the sheet lets go of it (a variable so a test can wait it out). An RTDB set() on a
// connection that dies mid-write neither resolves nor rejects, and while it is pending the sheet cannot be closed and the
// deploy's auto-reload is held: a director on the camp's patchy network was trapped there until the signal came back.
let teamPhotoWaitMs = 20000;
const teamPhotoSeq = {}; // team id -> the newest upload attempt's number (a late landing completes only the newest)

// The two halves that make a photo real once its data is on the server: this device's copies, then the record's photoV.
function teamPhotoFinish(id, v, data) {
  teamPhotoStore(id, v, data);
  putPhoto(teamPhotoIdbKey(id, v), data).catch(() => { /* the memory copy serves this session */ });
  teamPhotoAsked.add(id + ':' + v);
  const ok = stateEdit('New photo for ' + (teamName(id) || id), () => { const t = teamRecord(id); if (!t) return false; t.photoV = v; return true; }, { undo: false });
  if (ok === false) return { ok: false, reason: 'gone' };
  return { ok: true, v };
}

async function teamPhotoUpload(id, data) {
  if (!teamPhotoClean(data)) return { ok: false, reason: 'format' };
  if (!teamOnline()) return { ok: false, reason: 'offline' };
  const prev = teamPhotoVersion(id);
  const v = Math.max(Date.now(), prev === null ? 0 : prev + 1);
  const seq = teamPhotoSeq[id] = (teamPhotoSeq[id] || 0) + 1;
  let put;
  let timer = null;
  let outcome;
  try {
    put = firebase.database().ref(dbPath('teamPhotos/' + id)).set({ v, data });
    const slow = new Promise((res) => { timer = setTimeout(() => res('slow'), teamPhotoWaitMs); });
    outcome = await Promise.race([put.then(() => 'ok'), slow]);
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: err && err.code === 'PERMISSION_DENIED' ? 'denied' : 'failed' };
  }
  clearTimeout(timer);
  if (outcome === 'slow') {
    // The write is queued in the SDK and lands if the connection comes back: finish the record then, so the node and photoV
    // never disagree — unless a newer upload for this team started meanwhile (its version is the newer one).
    put.then(() => {
      if (teamPhotoSeq[id] !== seq || !canEdit()) return;
      teamPhotoFinish(id, v, data);
      renderAll();
    }, () => { /* refused after all: nothing was written */ });
    return { ok: false, reason: 'slow' };
  }
  return teamPhotoFinish(id, v, data);
}

const TEAM_PHOTO_WHY = {
  format: 'That picture could not be made small enough. Try another one.',
  offline: 'Photos need a connection. Try again when you are back online.',
  denied: 'The camp database refused the photo. The new rules may not be published yet.',
  failed: 'The photo did not go up, so nothing was changed. Try again.',
  slow: 'The photo is taking a while to go up. It will appear on its own if the connection comes back; if it does not, try again.',
  gone: 'That team is not on the list any more, so nothing was changed.',
};

async function teamPhotoUse() {
  const e = teamUi.edit;
  const canvas = setupEl('team-crop-canvas');
  if (!e || !e.crop || !canvas || e.busy) return;
  teamCropDraw();
  const tintSrc = /--team-accent-l:(#[0-9a-fA-F]{6})/.exec(teamAccentVars(e.id));
  let enc = null;
  try { enc = teamPhotoEncode(canvas, teamTint(tintSrc ? tintSrc[1] : '', 0.88)); } catch (err) { enc = null; }
  if (!enc) { setupSay(TEAM_PHOTO_WHY.format); return; }
  e.busy = true;
  renderTeamSheet();
  const r = await teamPhotoUpload(e.id, enc.data);
  if (teamUi.edit !== e) return;
  e.busy = false;
  if (!r.ok) { setupSay(TEAM_PHOTO_WHY[r.reason] || TEAM_PHOTO_WHY.failed); renderTeamSheet(); return; }
  teamSetPane('form');
  setupSay('Photo saved.');
  renderAll();
}

function teamPhotoRemove() {
  const e = teamUi.edit;
  if (!e) return;
  const id = e.id;
  stateEdit('Removed the photo of ' + (teamName(id) || id), () => { const t = teamRecord(id); if (!t || t.photoV === undefined) return false; delete t.photoV; return true; });
  renderTeamSheet();
  renderAll();
}

// ── "Pick colours for the flagged teams": every team whose older colour is hard to see, one tap each ──

function teamColorsOpen(opener) {
  if (!canEdit() || !teamsModel().weak.length) return;
  teamUi.colors = true;
  // The teams this sheet is FOR, fixed when it opens: a team keeps its block after its pick (now marked, "Now Teal"), so nothing moves up
  // under the thumb between two taps (a solved block vanishing slid the next team's dots under the finger, and the second tap landed on it).
  teamUi.colorsFor = teamsModel().weak.slice();
  setupSheet('team-colors', opener);
}

function renderTeamColorsSheet() {
  const m = teamsModel();
  const weakNow = m.rows.filter((r) => r.color.weak.length).map((r) => r.id);
  const ids = (teamUi.colorsFor && teamUi.colorsFor.length ? teamUi.colorsFor : weakNow).filter((id) => m.rows.some((r) => r.id === id));
  const rows = ids.map((id) => m.rows.find((r) => r.id === id));
  const list = setupEl('team-colors-list');
  const act = typeof document !== 'undefined' ? document.activeElement : null;
  const had = act && act.closest && act.closest('#team-colors-list [data-team-pick]') === act ? act : null;
  setHtmlIfChanged(list, rows.map((r) => {
    // What the block says under the name: still weak → why; picked → the colour it has now, in words (the dot alone has no name).
    const sub = r.color.weak.length ? 'Hard to read in ' + hubJoin(r.color.weak) + ' mode' : r.color.id ? 'Now ' + r.color.name : '';
    return '<div class="tms-flag" data-team-flag="' + esc(r.id) + '"' + (r.color.weak.length ? '' : ' data-done') + '><div class="tms-flag-head">' + teamMarkHtml(r.id, { size: 30 }) +
    '<span class="tms-flag-name"><span class="cb-title">' + esc(r.name) + '</span><span class="cb-sub">' + esc(sub) + '</span></span></div>' +
    '<div class="tms-picks" role="radiogroup" aria-label="Colour for ' + esc(r.name) + '">' + Object.keys(CAMP_TEAM_PALETTE).map((cid) => {
      const sw = CAMP_TEAM_PALETTE[cid];
      const used = m.rows.filter((x) => x.id !== r.id && x.color.id === cid).map((x) => x.short || x.name);
      return '<button type="button" class="tms-pick" role="radio" aria-checked="' + (r.color.id === cid) + '" data-team-pick="' + esc(r.id) + '" data-color="' + cid + '" aria-label="' + esc(sw.name + (used.length ? ', also ' + used.join(', ') : '')) + '">' +
        '<span class="tms-pick-dot" style="--l:' + sw.l + ';--d:' + sw.d + '"></span></button>';
    }).join('') + '</div></div>';
  }).join(''));
  // A keyboard / switch user stays on the dot they just picked (the block was rewritten, in place).
  if (had && list && list.querySelector) focusBack(true, list.querySelector('[data-team-pick="' + had.dataset.teamPick + '"][data-color="' + had.dataset.color + '"]'));
  setTextIfChanged(setupEl('team-colors-lede'), weakNow.length ? 'Pick a colour for each team. Two teams can share one; Set up the week will point it out.' : 'Every colour is easy to read now.');
}

function teamColorSet(tid, cid) {
  if (!canEdit() || !teamColorValid(cid) || !teamRecord(tid)) return;
  stateEdit('Colour for ' + (teamName(tid) || tid), () => { const t = teamRecord(tid); if (!t) return false; t.color = cid; return true; });
  renderAll();
  if (!teamsModel().weak.length) { teamUi.colors = false; teamUi.colorsFor = null; shellSheetClose('team-colors'); setupSay('Every team’s colour is easy to read now.'); }
}

// ── wiring ──

function wireTeamsScreen() {
  const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(ev, fn); };
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  on('#teams-list', 'click', (e) => { const b = q(e, 'button[data-team-open]'); if (b) teamOpen(b.dataset.teamOpen, b); });
  on('#teams-weak-btn', 'click', (e) => teamColorsOpen(e.currentTarget));
  const sheet = setupEl('sheet-team-edit');
  if (sheet) {
    // ✕ and the backdrop ask before they throw a half-made edit away (Escape and Back reach the same question through setupSheetGuardClose).
    sheet.addEventListener('click', (e) => { if (q(e, '[data-sheet-close]') && teamGuardClose(true)) e.stopPropagation(); }, true);
    sheet.addEventListener('click', (e) => {
      let b;
      if ((b = q(e, '[data-team-color]'))) teamPickColor(b.dataset.teamColor);
      else if ((b = q(e, '[data-team-emoji]'))) teamPickEmoji(b.dataset.teamEmoji);
      else if ((b = q(e, '[data-team-rename]'))) teamAnswerRename(b.dataset.teamRename);
      else if (q(e, '#team-photo-remove')) teamPhotoRemove();
      else if (q(e, '#team-pane-back')) teamSetPane('form');
    });
    sheet.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'team-crop-zoom') {
        const c = teamUi.edit && teamUi.edit.crop;
        if (c) { c.zoom = Number(e.target.value) || 1; teamCropDraw(); }
        return;
      }
      if (e.target && /^team-(name|short|emoji|counselor)$/.test(e.target.id || '')) teamTouched();
    });
  }
  on('#team-form', 'submit', (e) => { e.preventDefault(); teamSave(); });
  on('#team-save', 'click', () => teamSave());
  on('#team-photo-input', 'change', (e) => {
    const file = e.target && e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    teamPhotoChosen(file);
  });
  on('#team-photo-add', 'click', () => {
    if (!teamOnline()) { setupSay(TEAM_PHOTO_WHY.offline); return; }
    const input = setupEl('team-photo-input');
    if (input && input.click) input.click();
  });
  on('#team-crop-use', 'click', () => { teamPhotoUse(); });
  // The picture is moved under the frame with a finger (or the arrow keys); the zoom slider does the rest.
  const canvas = setupEl('team-crop-canvas');
  if (canvas) {
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const c = teamUi.edit && teamUi.edit.crop;
      if (!c) return;
      drag = { x: e.clientX, y: e.clientY, ox: c.ox, oy: c.oy };
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } }
    });
    canvas.addEventListener('pointermove', (e) => {
      const c = teamUi.edit && teamUi.edit.crop;
      if (!drag || !c) return;
      const k = TEAM_PHOTO_W / (canvas.clientWidth || TEAM_PHOTO_W); // frame pixels per screen pixel
      c.ox = drag.ox + (e.clientX - drag.x) * k;
      c.oy = drag.oy + (e.clientY - drag.y) * k;
      teamCropDraw();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      const c = teamUi.edit && teamUi.edit.crop;
      const d = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
      if (!c || !d) return;
      e.preventDefault();
      c.ox += d[0]; c.oy += d[1];
      teamCropDraw();
    });
  }
  const colors = setupEl('sheet-team-colors');
  if (colors) colors.addEventListener('click', (e) => { const b = q(e, '[data-team-pick]'); if (b) teamColorSet(b.dataset.teamPick, b.dataset.color); });
}


// ── 14. People (§11.8, §11.18 — Step 25, session 2) ──────────────────────────────────────────────────────────────────
// One list by team for everyone on THIS camp (<root>/members, the retired Members drawer's data), the switch that lets people not on the
// list ask to join, and the people asking. The data half is setup-sync.js's "PEOPLE" section (peopleRows / peopleGroups / peopleLetIn …);
// this file paints and wires it. Each row opens ONE sheet (a person, a request) and three more hang off the screen (Put people on teams, Add
// people, People you've blocked) — shell sheets, one at a time, editors only. Rules this file keeps:
//   - everything a requester typed (name, note) reaches markup only through esc() and the input's own `value`;
//   - the forms are written once per open and the INPUTS are the draft (a repaint never takes a typed word away);
//   - a sheet with unsaved edits asks before it closes, by every route (setupSheetGuardClose), and holds the deploy's auto-reload;
//   - "Needs a connection": every action refuses offline in words (peopleWhy) — a decision about access never queues behind a dead signal;
//   - your own role and the owner row are read-only here ("Another director has to change your access" / "Owner · only the owner can change this row").

const peopleUi = {
  person: null,    // the open person sheet: { key, origin, role, fresh, error, busy }
  request: null,   // the open request sheet: { key, cand, role, fresh, busy, error }
  teams: null,     // Put people on teams: { built, busy }
  add: null,       // Add people: { pane, role, camps, fresh, busy, invite }
  blocked: false,  // the Blocked sheet is meant to be open
  other: { status: 'idle', list: null }, // the other camp's member list, ONE read, for a director of both camps' per-camp switch
  from: '',        // 'more': opened from More's People row (Back leaves the builder)
};

const PEOPLE_SHEETS = ['people-person', 'people-request', 'people-teams', 'people-add', 'people-blocked'];

function peopleRoleWord(role) { return role === 'editor' ? 'Director' : 'Counselor'; }

function peopleTeamNameOf(id) {
  return typeof teamShort === 'function' && teamShort(id) ? teamShort(id) : (typeof teamName === 'function' ? teamName(id) : id);
}

function peopleTeams() {
  return (state.teams || []).filter((t) => t && typeof t.id === 'string');
}

function peopleMyKey() { return typeof identityKey === 'function' ? identityKey(authUser) : ''; }

function peopleRowsNow() { return peopleRows(memberDirectory, peopleMyKey()); }

function peopleRowOf(key) { return peopleRowsNow().find((r) => r.key === key) || null; }

// "Signed in · Counselor", "No sign-in yet · Director", "Owner · only the owner can change this row": words, never a mark alone.
function peopleStatusWords(r) {
  if (r.owner) return 'Owner · only ' + (typeof ownerName === 'function' ? ownerName() : 'the owner') + ' can change this row'; // a name another director knows
  return (r.pending ? 'No sign-in yet' : 'Signed in') + ' · ' + peopleRoleWord(r.role);
}

function peopleOptionsHtml(selected, none) {
  return '<option value="">' + esc(none || 'No team') + '</option>' + peopleTeams().map((t) => '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(t.name || t.id) + '</option>').join('');
}

function peopleSetSelect(sel, selected, none) {
  if (!sel) return;
  setHtmlIfChanged(sel, peopleOptionsHtml(selected, none));
  if (sel.value !== (selected || '')) sel.value = selected || '';
}

function peopleSetSegChecked(box, attr, value) {
  if (!box || !box.querySelectorAll) return;
  box.querySelectorAll('[' + attr + ']').forEach((b) => { const on = String(b.getAttribute(attr) === value); if (b.getAttribute('aria-checked') !== on) b.setAttribute('aria-checked', on); });
}

function peopleOnline() { return typeof restoreOnline === 'function' && restoreOnline(); }

// ── routing ──

// More → People (and Now's join bar → People): the builder opens straight onto this screen, and Back leaves it (the hub is not in
// the way). `from` is named 'more' for the first caller; the Back label is whatever tab the builder was opened FROM (More, or Now
// for the join bar), because the builder keeps state.ui.tab untouched.
function setupOpenPeople() {
  if (!canEdit()) return false;
  peopleUi.from = 'more';
  openBuilder(undefined, 'people');
  return true;
}

// ── the screen ──

function peopleJoinView() {
  const waiting = typeof peopleRequests === 'function' ? peopleRequests() : [];
  return { on: pplAskingOn(), long: pplAskingLongOn(typeof serverNow === 'function' ? serverNow() : Date.now()), waiting: waiting.length, first: waiting[0] ? waiting[0].name : '' };
}

function peopleStatus() {
  return hubStatus('people', {
    membersLoaded: !!memberDirectoryLoaded, members: hubMembers(), teams: state.teams || [], now: typeof serverNow === 'function' ? serverNow() : Date.now(),
    join: peopleJoinView(),
  });
}

// An address that may wrap only where it reads well: before the "@" (a phone number has none and never needs to).
function peopleIdHtml(key) {
  const id = String(identityFromKey(key) || '');
  const at = id.indexOf('@');
  return at > 0 ? esc(id.slice(0, at)) + '<wbr>' + esc(id.slice(at)) : esc(id);
}

// A request row ends in the chevron alone, as every row that opens something does (§8.1 rule 3): a "See" word beside it took the room the
// address needed. A stranger's note is clamped to two lines here (CSS); the sheet shows all of it.
function peopleReqRowHtml(r, now) {
  return '<button type="button" class="cb-row ppl-row ppl-req" data-key="r-' + esc(r.key) + '" data-req="' + esc(r.key) + '" aria-label="' + esc(r.name + ', asking to join') + '">' +
    '<span class="cb-time"><small>' + esc(hubAgo(r.at, now)) + '</small></span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(r.name) + '</span><span class="cb-sub ppl-id">' + peopleIdHtml(r.key) + '</span>' +
    (r.note ? '<span class="cb-sub ppl-quote">' + esc(r.note) + '</span>' : '') + '</span>' +
    '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

// Somebody with no sign-in yet is what the hub counts (for a week after they were added, as hubStatus judges it): the gold "!" on their row
// makes the headline's "N more things to check" findable on the list.
function peoplePendingWarn(r) {
  if (!r.pending) return false;
  const at = Number(r.addedAt);
  const now = typeof serverNow === 'function' ? serverNow() : Date.now();
  return !(at > 0) || !now || now - at < HUB_PENDING_NAG_MS;
}

function peoplePersonRowHtml(r) {
  const initial = esc(String(r.name || '?').trim().charAt(0).toUpperCase() || '?');
  const title = esc(r.name) + (r.self ? '<span class="ppl-tag">you</span>' : '');
  const inner = '<span class="cb-time"><i class="ppl-face" aria-hidden="true">' + initial + '</i></span>' +
    '<span class="cb-main"><span class="cb-title">' + title + '</span><span class="cb-sub">' + esc(peopleStatusWords(r)) + '</span></span>';
  if (r.owner) return '<div class="cb-row ppl-row" data-key="p-' + esc(r.key) + '">' + inner + '<span class="cb-end"></span></div>';
  return '<button type="button" class="cb-row ppl-row" data-key="p-' + esc(r.key) + '" data-person="' + esc(r.key) + '"' + (peoplePendingWarn(r) ? ' data-warn' : '') + '>' + inner +
    '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

// A team with nobody on it is its HEADER alone — the gold "!" and "No counselors yet" where the count goes, then one quiet "Add someone"
// line for that team — never a bordered box saying "Nobody yet" (four empty teams made a screenful of identical boxes, §8.8).
function peopleGroupHtml(key, mark, name, rows, none, campers) {
  const camp = campers !== null && campers !== undefined ? ' · ' + hubPlural(campers, 'camper', 'campers') : '';
  if (!rows.length && none) {
    return '<section class="ppl-group" data-key="g-' + esc(key) + '" data-empty><h3 class="ppl-head">' + mark + '<span class="ppl-head-name">' + esc(name) + '</span>' +
      '<span class="ppl-count" data-warn>' + esc(none + camp) + '</span></h3>' +
      '<button type="button" class="sched-add ppl-add-to" data-ppl-add-team="' + esc(key) + '" aria-label="' + esc('Add someone to ' + name) + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Add someone</span></button></section>';
  }
  const counts = hubPlural(rows.length, 'person', 'people') + camp;
  return '<section class="ppl-group" data-key="g-' + esc(key) + '"><h3 class="ppl-head">' + mark + '<span class="ppl-head-name">' + esc(name) + '</span><span class="ppl-count">' + esc(counts) + '</span></h3>' +
    '<div class="gl cb-list">' + rows.map(peoplePersonRowHtml).join('') + '</div></section>';
}

function renderPeopleScreen() {
  peopleCleanSheets();
  const st = peopleStatus();
  const join = peopleJoinView();
  setTextIfChanged(setupEl('people-title'), 'People · ' + campWord());
  setTextIfChanged(setupEl('people-headline'), st.problems.length ? st.problems[0] : st.summary);
  // The lede names the NEXT problem, as the hub's "Next:" line does (a bare "5 more things to check" pointed at nothing on the list).
  const rest = st.problems.length - 2;
  setTextIfChanged(setupEl('people-lede'), st.problems.length > 1 ? 'Next: ' + st.problems[1] + (rest > 0 ? ' · ' + hubPlural(rest, 'more thing', 'more things') + ' to check' : '')
    : st.problems.length ? 'Tap a person to see or change their access.' : 'Tap a person to change their team, role or sign-in.');
  // the switch: the week's own meta/joinOpen, said in plain words either way
  const sw = setupEl('people-asking');
  if (sw && typeof sw.hasAttribute === 'function' && sw.hasAttribute('checked') !== join.on) sw.toggleAttribute('checked', join.on);
  if (typeof paintSwitchWord === 'function') paintSwitchWord('people-asking', join.on);
  setTextIfChanged(setupEl('people-ask-sub'), join.on ? 'Anyone signed in who isn’t on the list can ask from their own phone.' : 'Turn on during registration so people not on the list can ask from their own phone.');
  setHiddenIfChanged(setupEl('people-asking-long'), !join.long);
  // what is wrong with the data right now
  const note = !memberDirectoryLoaded ? 'Loading the list…' : !fbRef ? 'Needs a connection: the list can’t be reached right now.' : pplReq.denied ? 'Asking to join isn’t available yet — the database rules need updating.' : '';
  setTextIfChanged(setupEl('people-state-text'), note);
  setHiddenIfChanged(setupEl('people-state'), !note);
  // Its icon says what kind of note it is: the clock while loading, the lock only for the rules; no signal has no icon (a lock
  // read as "not allowed").
  const stateEl = setupEl('people-state');
  const ico = stateEl && stateEl.querySelector ? stateEl.querySelector('svg') : null;
  const icoName = !memberDirectoryLoaded ? 'i-clock' : !fbRef ? '' : 'i-lock';
  if (ico && typeof setAttrIfChanged === 'function') {
    setAttrIfChanged(ico, 'display', icoName ? null : 'none'); // an <svg> has no `hidden` property
    if (icoName) setAttrIfChanged(ico.querySelector('use'), 'href', '#' + icoName);
  }
  // the people asking, newest first
  const now = typeof serverNow === 'function' ? serverNow() : Date.now();
  const reqs = peopleRequests();
  secPaintList(setupEl('people-requests'), reqs.map((r) => peopleReqRowHtml(r, now)).join(''), 'req', {});
  setHiddenIfChanged(setupEl('people-req-sec'), !reqs.length);
  setTextIfChanged(setupEl('people-req-label'), 'Asking to join · ' + reqs.length);
  // everyone, by team
  const g = peopleGroups(peopleRowsNow(), peopleTeams());
  let html = '';
  if (memberDirectoryLoaded) {
    html = g.groups.map((x) => peopleGroupHtml(x.team.id, teamMarkHtml(x.team.id, { size: 24 }), x.team.name || x.team.id, x.rows, 'No counselors yet', campersStatus() === 'ok' ? campersCount(x.team.id) : null)).join('');
    if (g.none.length) html += peopleGroupHtml('none', '', 'Not on a team', g.none, '');
  }
  secPaintList(setupEl('people-groups'), html, 'groups', {});
  const online = peopleOnline();
  ['people-teams-btn', 'people-add-btn'].forEach((id) => { const b = setupEl(id); if (b) { if (b.getAttribute && b.getAttribute('aria-disabled') !== String(!online)) b.setAttribute('aria-disabled', String(!online)); } });
  setHiddenIfChanged(setupEl('people-teams-btn'), !memberDirectoryLoaded);
  setHiddenIfChanged(setupEl('people-add-btn'), !memberDirectoryLoaded);
}

async function peopleToggleAsking(on) {
  if (!peopleOnline()) { setupSay(peopleWhy({ reason: 'offline' })); renderPeopleScreen(); return; }
  const r = peopleSetAsking(on === true);
  if (!r.ok) { setupSay(r.reason === 'loading' ? 'The week is still loading. Try again in a moment.' : peopleWhy(r)); renderPeopleScreen(); return; }
  setupSay(on ? 'People who aren’t on the list can now ask to join.' : 'Asking to join is off.');
}

// A sheet that was closed by any route leaves its state behind; the next pass of the screen drops it (a Forward must not reopen a stale form).
function peopleCleanSheets() {
  if (peopleUi.person && !shell.sheets.includes('people-person')) peopleUi.person = null;
  if (peopleUi.request && !shell.sheets.includes('people-request')) peopleUi.request = null;
  if (peopleUi.teams && !shell.sheets.includes('people-teams')) peopleUi.teams = null;
  if (peopleUi.add && !shell.sheets.includes('people-add')) peopleUi.add = null;
  if (peopleUi.blocked && !shell.sheets.includes('people-blocked')) peopleUi.blocked = false;
}

// ── the person sheet ──

function peopleOtherLoad() {
  if (peopleUi.other.status === 'loading' || peopleUi.other.status === 'ok') return;
  if (typeof campRoleOf !== 'function' || campRoleOf(otherCampId()) !== 'editor' || !restoreHasFirebase()) return;
  peopleUi.other.status = 'loading';
  firebase.database().ref(CAMPS[otherCampId()].dbRoot + '/members').once('value').then((snap) => {
    peopleUi.other = { status: 'ok', list: snap.val() || {} };
    if (peopleUi.person && shell.sheets.includes('people-person')) renderPeopleSheet();
  }, () => { peopleUi.other = { status: 'denied', list: null }; });
}

function peopleOpenPerson(key, opener) {
  if (!canEdit()) return;
  const r = peopleRowOf(key);
  if (!r || r.owner) return;
  peopleUi.person = { key, origin: { name: r.name, teamId: r.teamId, role: r.role }, role: r.role, fresh: true, error: {}, busy: false };
  peopleOtherLoad();
  setupSheet('people-person', opener);
}

function peoplePersonForm() {
  const p = peopleUi.person;
  const v = (id) => { const el = setupEl(id); return el && typeof el.value === 'string' ? el.value : ''; };
  return { name: v('ppl-name').replace(/\s+/g, ' ').trim(), teamId: v('ppl-team'), role: p ? p.role : 'viewer' };
}

function peoplePersonDirty() {
  const p = peopleUi.person;
  if (!p || !shell.sheets.includes('people-person')) return false;
  const f = peoplePersonForm();
  return f.name !== p.origin.name || f.teamId !== p.origin.teamId || f.role !== p.origin.role;
}

function renderPeopleSheet() { renderPeoplePersonSheet(); }

function renderPeoplePersonSheet() {
  const p = peopleUi.person;
  if (!p) return;
  const r = peopleRowOf(p.key);
  if (!r) { peopleUi.person = null; shellSheetClose('people-person'); setupSay('That person is no longer on the list.'); return; }
  if (p.fresh) {
    p.fresh = false;
    const name = setupEl('ppl-name'); if (name) name.value = p.origin.name;
    const si = setupEl('ppl-signin'); if (si) si.value = '';
    const sel = setupEl('ppl-team'); if (sel) { setHtmlIfChanged(sel, peopleOptionsHtml(p.origin.teamId)); sel.value = p.origin.teamId; }
  }
  const me = r.self;
  setTextIfChanged(setupEl('sheet-people-person-title'), r.name);
  setTextIfChanged(setupEl('ppl-id-line'), r.pending ? 'No sign-in yet — a name and a team the directors typed.' : (me ? 'You · ' : '') + identityFromKey(r.key) + (me ? ' · another director has to change your access.' : ''));
  setSegRoles(setupEl('ppl-role'), 'data-ppl-role', p.role, me);
  setTextIfChanged(setupEl('ppl-role-note'), me ? 'Another director has to change your access.' : p.role === 'editor' ? 'Directors can enter scores, change the week and manage this list.' : 'Counselors can see the schedule, the games and chat.');
  const dup = peopleNameClash(setupEl('ppl-name') ? setupEl('ppl-name').value : '', peopleRowsNow(), r.key);
  void dup;
  // The OTHER camp's access, for a director of both camps (their own row is someone else's to change). THIS camp's role is the Role
  // control above (written by Save, with the name and team): a second control for it here wrote at once and left the first one, and
  // the saved baseline behind it, showing a stale role, so a later Save could write a role the director had already changed.
  const dual = !r.pending && !me && typeof campRoleOf === 'function' && campRoleOf(otherCampId()) === 'editor' && peopleUi.other.status === 'ok';
  setHiddenIfChanged(setupEl('ppl-camps-fld'), !dual);
  if (dual) {
    const camps = [otherCampId()].map((cid) => {
      const rec = (peopleUi.other.list || {})[r.key];
      const cur = rec && (rec.role === 'editor' || rec.role === 'viewer') ? rec.role : 'none';
      const seg = ['none', 'viewer', 'editor'].map((v) => '<button type="button" class="seg-btn" role="radio" aria-checked="' + (cur === v) + '" data-ppl-camp="' + esc(cid) + '" data-ppl-access="' + v + '">' + (v === 'none' ? 'None' : peopleRoleWord(v)) + '</button>').join('');
      return '<div class="ppl-camp"><span class="ppl-camp-name">' + esc(CAMPS[cid].label) + '</span><div class="seg seg-fit" role="radiogroup" aria-label="' + esc(CAMPS[cid].label + ' access') + '">' + seg + '</div></div>';
    }).join('');
    setHtmlIfChanged(setupEl('ppl-camps'), camps);
  }
  setHiddenIfChanged(setupEl('ppl-signin-fld'), !r.pending);
  setHiddenIfChanged(setupEl('ppl-same-fld'), !r.pending);
  if (r.pending) {
    const members = peopleRowsNow().filter((x) => !x.pending && !x.owner);
    const sel = setupEl('ppl-same');
    if (sel) {
      const html = '<option value="">Pick someone…</option>' + members.map((m) => '<option value="' + esc(m.key) + '">' + esc(m.name + (m.teamId ? ' · ' + peopleTeamNameOf(m.teamId) : '')) + '</option>').join('');
      setHtmlIfChanged(sel, html);
    }
  }
  setHiddenIfChanged(setupEl('ppl-invite'), r.pending || me);
  setHiddenIfChanged(setupEl('ppl-remove'), me);
  const nameErr = (p.error && p.error.name) || '';
  setTextIfChanged(setupEl('ppl-name-error'), nameErr);
  setHiddenIfChanged(setupEl('ppl-name-error'), !nameErr);
  const siErr = (p.error && p.error.signin) || '';
  setTextIfChanged(setupEl('ppl-signin-error'), siErr);
  setHiddenIfChanged(setupEl('ppl-signin-error'), !siErr);
  secSetDisabled(setupEl('ppl-save'), p.busy);
}

// A Counselor / Director segmented control: the chosen one checked, the pair disabled when it is not yours to change.
function setSegRoles(box, attr, value, locked) {
  peopleSetSegChecked(box, attr, value);
  if (box && box.querySelectorAll) box.querySelectorAll('[' + attr + ']').forEach((b) => { if (!!b.disabled !== !!locked) b.disabled = !!locked; });
}

async function peopleSavePersonSheet() {
  const p = peopleUi.person;
  if (!p || p.busy) return;
  const f = peoplePersonForm();
  p.error = {};
  if (!f.name) { p.error.name = 'Give them a name.'; renderPeopleSheet(); return; }
  const patch = {};
  if (f.name !== p.origin.name) patch.name = f.name;
  if (f.teamId !== p.origin.teamId) patch.teamId = f.teamId;
  if (f.role !== p.origin.role) patch.role = f.role;
  if (!Object.keys(patch).length) { peopleUi.person = null; shellSheetClose('people-person'); return; }
  p.busy = true; renderPeopleSheet();
  const res = await peopleSavePerson(p.key, patch);
  if (peopleUi.person !== p) return;
  p.busy = false;
  if (!res.ok) { p.error.name = peopleWhy(res); renderPeopleSheet(); return; }
  const who = patch.name || p.origin.name;
  setupSay(patch.role ? who + ' is now a ' + peopleRoleWord(patch.role).toLowerCase() : patch.teamId !== undefined ? (patch.teamId ? who + ' is with ' + peopleTeamNameOf(patch.teamId) : who + ' is not on a team') : 'Saved');
  peopleUi.person = null;
  shellSheetClose('people-person');
}

async function peopleRemovePerson() {
  const p = peopleUi.person;
  const r = p && peopleRowOf(p.key);
  if (!r || p.busy) return;
  if (!peopleOnline()) { setupSay(peopleWhy({ reason: 'offline' })); return; }
  const v = await askDialog({
    title: 'Remove ' + r.name + ' from ' + campWord() + '?',
    body: r.pending ? 'This takes their name off the list.' : 'They lose access to ' + campWord() + ' the moment this saves. Access changes can’t be undone with Undo — add them back here if you change your mind.',
    actions: [{ label: 'Keep ' + r.name, value: 'keep', cancel: true }, { label: 'Remove', value: 'remove', kind: 'danger' }],
  });
  if (v !== 'remove' || peopleUi.person !== p) return;
  const res = await peopleRemove(p.key);
  if (!res.ok) { setupSay(peopleWhy(res)); return; }
  setupSay(r.name + ' removed');
  peopleUi.person = null;
  shellSheetClose('people-person');
}

async function peoplePersonSignIn() {
  const p = peopleUi.person;
  if (!p || p.busy) return;
  const el = setupEl('ppl-signin');
  p.error = {};
  p.busy = true; renderPeopleSheet();
  const res = await peopleAddSignIn(p.key, el ? el.value : '');
  if (peopleUi.person !== p) return;
  p.busy = false;
  if (!res.ok) { p.error.signin = peopleWhy(res); renderPeopleSheet(); return; }
  setupSay(identityFromKey(res.key) + ' can now sign in');
  peopleUi.person = null;
  shellSheetClose('people-person');
  if (res.invite) peopleOpenAdd(null, 'one', { invite: res.invite });
}

async function peoplePersonSameAs() {
  const p = peopleUi.person;
  const sel = setupEl('ppl-same');
  const to = sel ? sel.value : '';
  if (!p || p.busy) return;
  if (!to) { p.error = { signin: 'Pick the person they are first.' }; renderPeopleSheet(); return; }
  const target = peopleRowOf(to);
  const me = peopleRowOf(p.key);
  if (!target || !me) return;
  const v = await askDialog({ title: 'Merge ' + me.name + ' into ' + target.name + '?', body: 'The “no sign-in yet” row goes away and ' + target.name + ' stays' + (me.teamId && !target.teamId ? ', on ' + peopleTeamNameOf(me.teamId) : '') + '.',
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Merge', value: 'yes', kind: 'gold' }] });
  if (v !== 'yes' || peopleUi.person !== p) return;
  const res = await peopleSameAs(p.key, to);
  if (!res.ok) { setupSay(peopleWhy(res)); return; }
  setupSay(me.name + ' is ' + target.name);
  peopleUi.person = null;
  shellSheetClose('people-person');
}

async function peopleCampAccess(cid, value) {
  const p = peopleUi.person;
  if (!p || p.busy) return;
  const r = peopleRowOf(p.key);
  if (!r) return;
  if (value === 'none') {
    const v = await askDialog({ title: 'Remove ' + r.name + ' from ' + CAMPS[cid].label + '?', body: 'They lose access to it the moment this saves.', actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Remove', value: 'yes', kind: 'danger' }] });
    if (v !== 'yes') return;
  }
  const res = await peopleSetCampAccess(p.key, cid, value);
  if (!res.ok) { setupSay(peopleWhy(res)); return; }
  if (cid !== CAMP.id && peopleUi.other.list) { if (value === 'none') delete peopleUi.other.list[p.key]; else peopleUi.other.list[p.key] = Object.assign({}, peopleUi.other.list[p.key], { role: value, name: r.name }); }
  setupSay(value === 'none' ? r.name + ' removed from ' + CAMPS[cid].label : r.name + ' is now a ' + peopleRoleWord(value).toLowerCase() + ' at ' + CAMPS[cid].label);
  renderPeopleSheet();
}

function peopleCopyInvite(btn) {
  const p = peopleUi.person;
  const r = p && peopleRowOf(p.key);
  if (!r || typeof inviteText !== 'function') return;
  copyTextToClipboard(inviteText(r.key, r.role), btn);
}

// ── a request ──

function peopleOpenRequest(key, opener) {
  if (!canEdit()) return;
  const req = peopleRequests().find((r) => r.key === key);
  if (!req) return;
  const hint = peopleTeamInText(req.note, peopleTeams());
  peopleUi.request = { key, cand: peopleCandidates(req, peopleRowsNow(), peopleTeams()).length ? null : '', role: 'viewer', teamId: hint, fresh: true, busy: false, error: '' };
  setupSheet('people-request', opener);
}

function peopleReqCurrent() {
  const q = peopleUi.request;
  return q ? peopleRequests().find((r) => r.key === q.key) || null : null;
}

function peopleReqDirName() {
  const el = setupEl('prq-dirname');
  return el && typeof el.value === 'string' ? el.value.replace(/\s+/g, ' ').trim() : '';
}

function renderPeopleRequestSheet() {
  const q = peopleUi.request;
  if (!q) return;
  const req = peopleReqCurrent();
  if (!req) { peopleUi.request = null; shellSheetClose('people-request'); if (!q.done) setupSay('Someone already dealt with that request.'); return; }
  const rows = peopleRowsNow();
  const cands = peopleCandidates(req, rows, peopleTeams());
  if (q.fresh) {
    q.fresh = false;
    const nm = setupEl('prq-dirname'); if (nm) nm.value = req.name;
    const cf = setupEl('prq-confirm'); if (cf) cf.value = '';
    const sel = setupEl('prq-team'); if (sel) { setHtmlIfChanged(sel, peopleOptionsHtml(q.teamId)); sel.value = q.teamId || ''; }
  }
  setTextIfChanged(setupEl('prq-name'), req.name);
  setTextIfChanged(setupEl('prq-id'), identityFromKey(req.key));
  setTextIfChanged(setupEl('prq-note'), req.note || '');
  setHiddenIfChanged(setupEl('prq-note'), !req.note);
  setTextIfChanged(setupEl('prq-when'), 'Asked ' + hubAgo(req.at, typeof serverNow === 'function' ? serverNow() : Date.now()));
  // "Is this someone already on the list?" — pending rows that might be them; nothing is guessed (ux-R8)
  setHiddenIfChanged(setupEl('prq-cands-sec'), !cands.length);
  const rowsHtml = cands.map((c) => '<button type="button" class="cb-row" role="radio" aria-checked="' + (q.cand === c.key) + '" data-prq-cand="' + esc(c.key) + '"><span class="cb-time"><i class="ppl-cand-dot" aria-hidden="true"></i></span>' +
    '<span class="cb-main"><span class="cb-title">' + esc(c.name) + '</span><span class="cb-sub">' + esc([c.teamId ? peopleTeamNameOf(c.teamId) : 'No team', peopleRoleWord(c.role), 'No sign-in yet'].join(' · ')) + '</span></span></button>').join('') +
    '<button type="button" class="cb-row" role="radio" aria-checked="' + (q.cand === '') + '" data-prq-cand=""><span class="cb-time"><i class="ppl-cand-dot" aria-hidden="true"></i></span><span class="cb-main"><span class="cb-title">None of these</span><span class="cb-sub">A new person</span></span></button>';
  setHtmlIfChanged(setupEl('prq-cands'), rowsHtml);
  const link = q.cand ? cands.find((c) => c.key === q.cand) : null;
  if (q.cand && !link) q.cand = cands.length ? null : '';
  const mode = link ? 'link' : q.cand === null ? 'choose' : 'new';
  setHiddenIfChanged(setupEl('prq-new'), mode !== 'new');
  setHiddenIfChanged(setupEl('prq-link'), mode !== 'link');
  if (link) {
    setTextIfChanged(setupEl('prq-link-text'), 'Link ' + req.name + ' to ' + link.name + ' (' + [link.teamId ? peopleTeamNameOf(link.teamId) : 'No team', peopleRoleWord(link.role)].join(' · ') + ')? Their sign-in takes over that row’s name, team and role.');
    setHiddenIfChanged(setupEl('prq-confirm-fld'), link.role !== 'editor');
  }
  peopleSetSegChecked(setupEl('prq-role'), 'data-prq-role', q.role);
  // the directory name is what chat trusts: a likely clash is said before it is written
  const clash = mode === 'new' ? peopleNameClash(peopleReqDirName(), rows, '') : null;
  setTextIfChanged(setupEl('prq-clash'), clash ? 'There’s already a ' + (peopleFirst(clash.name) ? clash.name.split(' ')[0] : clash.name) + ' on the list — use a last initial?' : '');
  setHiddenIfChanged(setupEl('prq-clash'), !clash);
  setTextIfChanged(setupEl('prq-error'), q.error || '');
  setHiddenIfChanged(setupEl('prq-error'), !q.error);
  const go = setupEl('prq-go');
  setTextIfChanged(go, mode === 'link' ? 'Link them' : mode === 'choose' ? 'Pick one above' : 'Let in as ' + peopleRoleWord(q.role).toLowerCase());
  secSetDisabled(go, q.busy || mode === 'choose');
  if (go && go.setAttribute) go.setAttribute('aria-disabled', String(q.busy || mode === 'choose'));
  secSetDisabled(setupEl('prq-notnow'), q.busy);
  secSetDisabled(setupEl('prq-block'), q.busy);
}

async function peopleRequestGo() {
  const q = peopleUi.request;
  const req = peopleReqCurrent();
  if (!q || !req || q.busy || q.cand === null) return;
  q.error = '';
  q.busy = true; renderPeopleRequestSheet();
  let res;
  let said;
  if (q.cand) {
    const cf = setupEl('prq-confirm');
    res = await peopleLink(req, q.cand, { confirm: cf ? cf.value : '' });
    said = req.name + ' is linked and can now sign in';
  } else {
    const name = peopleReqDirName();
    if (!name) { q.busy = false; q.error = 'Give them a name for the list.'; renderPeopleRequestSheet(); return; }
    const sel = setupEl('prq-team');
    res = await peopleLetIn(req, { name, role: q.role, teamId: sel ? sel.value : '' });
    said = name + ' can now sign in';
  }
  if (peopleUi.request !== q) return;
  q.busy = false;
  if (!res.ok) { q.error = peopleWhy(res); renderPeopleRequestSheet(); return; }
  q.done = true;
  setupSay(res.already ? 'They were already on the list.' : said);
  peopleUi.request = null;
  shellSheetClose('people-request');
}

async function peopleRequestNotNow() {
  const q = peopleUi.request;
  const req = peopleReqCurrent();
  if (!q || !req || q.busy) return;
  q.busy = true; renderPeopleRequestSheet();
  const res = await peopleNotNow(req);
  if (peopleUi.request !== q) return;
  q.busy = false;
  if (!res.ok) { q.error = peopleWhy(res); renderPeopleRequestSheet(); return; }
  q.done = true;
  setupSay('Request removed');
  peopleUi.request = null;
  shellSheetClose('people-request');
}

async function peopleRequestBlock() {
  const q = peopleUi.request;
  const req = peopleReqCurrent();
  if (!q || !req || q.busy) return;
  if (!peopleOnline()) { q.error = peopleWhy({ reason: 'offline' }); renderPeopleRequestSheet(); return; }
  const v = await askDialog({ title: 'Block ' + req.name + '?', body: ['They won’t be able to ask again until you unblock them (People → People you’ve blocked).', 'They’re told asking isn’t open, never that they were blocked.'],
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Block', value: 'yes', kind: 'danger' }] });
  if (v !== 'yes' || peopleUi.request !== q) return;
  q.busy = true; renderPeopleRequestSheet();
  const res = await peopleBlock(req);
  if (peopleUi.request !== q) return;
  q.busy = false;
  if (!res.ok) { q.error = peopleWhy(res); renderPeopleRequestSheet(); return; }
  q.done = true;
  setupSay(req.name + ' blocked');
  peopleUi.request = null;
  shellSheetClose('people-request');
}

// ── Put people on teams ──

function peopleOpenTeams(opener) {
  if (!canEdit()) return;
  if (!peopleOnline()) { setupSay(peopleWhy({ reason: 'offline' })); return; }
  peopleUi.teams = { built: false, busy: false, error: '' };
  setupSheet('people-teams', opener);
}

// The rows are written once per open; the native selects ARE the draft.
function renderPeopleTeamsSheet() {
  const t = peopleUi.teams;
  if (!t) return;
  if (!t.built) {
    t.built = true;
    const teams = peopleTeams();
    const order = (r) => { const i = teams.findIndex((x) => x.id === r.teamId); return i === -1 ? 999 : i; };
    const rows = peopleRowsNow().filter((r) => !r.owner).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    setHtmlIfChanged(setupEl('ppt-list'), rows.map((r) => '<div class="cb-row" data-key="t-' + esc(r.key) + '"><span class="cb-main"><span class="cb-title">' + esc(r.name) + '</span><span class="cb-sub">' + esc(peopleStatusWords(r)) + '</span></span>' +
      '<select class="fld-input" data-ppt-pick="' + esc(r.key) + '" aria-label="' + esc('Team for ' + r.name) + '">' + peopleOptionsHtml(r.teamId) + '</select></div>').join(''));
  }
  setTextIfChanged(setupEl('ppt-error'), t.error || '');
  setHiddenIfChanged(setupEl('ppt-error'), !t.error);
  secSetDisabled(setupEl('ppt-save'), t.busy);
  setTextIfChanged(setupEl('ppt-save'), t.busy ? 'Saving…' : 'Save teams');
}

function peopleTeamsPicks() {
  const picks = {};
  const list = setupEl('ppt-list');
  if (list && list.querySelectorAll) list.querySelectorAll('select[data-ppt-pick]').forEach((s) => { picks[s.dataset.pptPick] = s.value; });
  return picks;
}

function peopleTeamsDirty() {
  return !!(peopleUi.teams && shell.sheets.includes('people-teams') && peopleTeamChanges(peopleRowsNow(), peopleTeamsPicks()).length);
}

async function peopleSaveTeamsSheet() {
  const t = peopleUi.teams;
  if (!t || t.busy) return;
  const changes = peopleTeamChanges(peopleRowsNow(), peopleTeamsPicks());
  t.error = '';
  if (!changes.length) { peopleUi.teams = null; shellSheetClose('people-teams'); return; }
  t.busy = true; renderPeopleTeamsSheet();
  const res = await peopleSaveTeams(changes);
  if (peopleUi.teams !== t) return;
  t.busy = false;
  if (res.reason) { t.error = peopleWhy(res); renderPeopleTeamsSheet(); return; }
  if (!res.ok) { t.error = 'Couldn’t save ' + hubJoin(res.failed.map((f) => f.name || 'someone')) + '. The rest are saved.'; renderPeopleTeamsSheet(); return; }
  setupSay(res.saved === 1 ? 'Saved 1 team' : 'Saved ' + res.saved + ' teams');
  peopleUi.teams = null;
  shellSheetClose('people-teams');
}

// ── Add people ──

function peopleOpenAdd(opener, pane, o) {
  if (!canEdit()) return;
  if (!peopleOnline()) { setupSay(peopleWhy({ reason: 'offline' })); return; }
  peopleUi.add = { pane: pane === 'one' ? 'one' : 'list', role: 'viewer', camps: 'active', fresh: true, busy: false, error: '', invite: (o && o.invite) || '', teamId: (o && o.teamId) || '' };
  setupSheet('people-add', opener);
}

function peopleAddFields() {
  const v = (id) => { const el = setupEl(id); return el && typeof el.value === 'string' ? el.value : ''; };
  return { lines: v('ppa-lines'), id: v('ppa-id').trim(), name: v('ppa-name').replace(/\s+/g, ' ').trim(), team: v('ppa-team') };
}

function peopleAddDirty() {
  const a = peopleUi.add;
  if (!a || !shell.sheets.includes('people-add') || a.busy) return false;
  const f = peopleAddFields();
  return !!(f.lines.trim() || f.id || f.name);
}

function peopleAddPreviewHtml(parsed) {
  return parsed.rows.filter((r) => r.status !== 'empty').map((r, i) => {
    const team = r.teamId ? peopleTeamNameOf(r.teamId) : '';
    const title = r.status === 'new' ? r.name + ' → ' + (team || 'Not on a team')
      : r.status === 'update' ? r.name + ' → put on ' + team
      : r.status === 'same' ? r.name + ' is already on the list'
      : r.name + ' is listed twice';
    const sub = r.status === 'new' ? (r.note ? r.note + ', so no team' : 'Will be added with no sign-in yet')
      : r.status === 'update' ? 'Already on the list — only their team changes'
      : r.status === 'same' ? (r.note || 'Nothing to change') : 'Skipped';
    return '<div class="cb-row" data-key="a-' + i + '" data-status="' + r.status + '"><span class="cb-main"><span class="cb-title">' + esc(title) + '</span><span class="cb-sub">' + esc(sub) + '</span></span></div>';
  }).join('');
}

function renderPeopleAddSheet() {
  const a = peopleUi.add;
  if (!a) return;
  const sheet = setupEl('sheet-people-add');
  if (a.fresh) {
    a.fresh = false;
    ['ppa-lines', 'ppa-id', 'ppa-name'].forEach((id) => { const el = setupEl(id); if (el) el.value = ''; });
    const sel = setupEl('ppa-team'); if (sel) { setHtmlIfChanged(sel, peopleOptionsHtml(a.teamId || '')); sel.value = a.teamId || ''; }
  }
  if (sheet && sheet.dataset && sheet.dataset.pane !== a.pane) sheet.dataset.pane = a.pane;
  peopleSetSegChecked(setupEl('ppa-pane'), 'data-ppa-pane', a.pane);
  peopleSetSegChecked(setupEl('ppa-role'), 'data-ppa-role', a.role);
  peopleSetSegChecked(setupEl('ppa-camps'), 'data-ppa-camps', a.camps);
  const dual = typeof campRoleOf === 'function' && campRoleOf(otherCampId()) === 'editor';
  setHiddenIfChanged(setupEl('ppa-camps-fld'), !dual);
  const missing = typeof missingSeedCounselors === 'function' && (CAMP.seedCounselors || []).length ? missingSeedCounselors(memberDirectory || {}) : [];
  setHiddenIfChanged(setupEl('ppa-roster'), !missing.length);
  const parsed = peopleParseLines(peopleAddFields().lines, peopleRowsNow(), peopleTeams());
  setHtmlIfChanged(setupEl('ppa-preview'), a.pane === 'list' ? peopleAddPreviewHtml(parsed) : '');
  const n = parsed.add.length, m = parsed.update.length;
  const go = setupEl('ppa-go');
  const label = a.pane === 'one' ? 'Add person' : !n && !m ? 'Add people' : n && m ? 'Add ' + n + ', update ' + m : n ? 'Add ' + hubPlural(n, 'person', 'people') : 'Update ' + hubPlural(m, 'person', 'people');
  setTextIfChanged(go, a.busy ? 'Saving…' : label);
  secSetDisabled(go, a.busy || (a.pane === 'list' && !n && !m));
  setTextIfChanged(setupEl('ppa-error'), a.error || '');
  setHiddenIfChanged(setupEl('ppa-error'), !a.error);
  setHiddenIfChanged(setupEl('ppa-invite'), !a.invite);
  const it = setupEl('ppa-invite-text'); if (it && it.value !== a.invite) it.value = a.invite || '';
}

async function peopleAddGo() {
  const a = peopleUi.add;
  if (!a || a.busy) return;
  a.error = '';
  const f = peopleAddFields();
  if (a.pane === 'list') {
    const parsed = peopleParseLines(f.lines, peopleRowsNow(), peopleTeams());
    if (!parsed.add.length && !parsed.update.length) { renderPeopleAddSheet(); return; }
    a.busy = true; renderPeopleAddSheet();
    const res = await peopleAddLines(parsed, 'viewer');
    if (peopleUi.add !== a) return;
    a.busy = false;
    if (!res.ok) { a.error = peopleWhy(res); renderPeopleAddSheet(); return; }
    setupSay((res.added ? 'Added ' + hubPlural(res.added, 'person', 'people') : '') + (res.added && res.moved ? ' · ' : '') + (res.moved ? hubPlural(res.moved, 'person', 'people') + ' put on a team' : ''));
    peopleUi.add = null;
    shellSheetClose('people-add');
    return;
  }
  a.busy = true; renderPeopleAddSheet();
  const res = await peopleAddMember({ id: f.id, name: f.name, role: a.role, teamId: f.team, bothCamps: a.camps === 'both' });
  if (peopleUi.add !== a) return;
  a.busy = false;
  if (!res.ok) { a.error = peopleWhy(res); renderPeopleAddSheet(); return; }
  setupSay(res.pending ? (f.name || 'They') + ' added — no sign-in yet' : identityFromKey(res.key) + ' can now sign in');
  a.invite = res.invite || '';
  ['ppa-id', 'ppa-name'].forEach((id) => { const el = setupEl(id); if (el) el.value = ''; });
  if (!a.invite) { peopleUi.add = null; shellSheetClose('people-add'); return; }
  renderPeopleAddSheet();
}

// "Fill in last year's printed roster" (junior): the people the printed list has that the camp's list doesn't, as lines the preview reads.
function peopleFillRoster() {
  if (typeof missingSeedCounselors !== 'function') return;
  const lines = missingSeedCounselors(memberDirectory || {}).map((c) => c.name + (c.teamId ? ', ' + peopleTeamNameOf(c.teamId) : ''));
  const ta = setupEl('ppa-lines');
  if (ta && lines.length) { ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + lines.join('\n'); renderPeopleAddSheet(); }
}

// ── the Blocked list ──

function peopleOpenBlocked(opener) {
  if (!canEdit()) return;
  peopleUi.blocked = true;
  setupSheet('people-blocked', opener);
  peopleLoadBlocked().then(() => { if (peopleUi.blocked && shell.sheets.includes('people-blocked')) renderPeopleBlockedSheet(); });
}

function renderPeopleBlockedSheet() {
  const b = pplReq.blocked;
  const now = typeof serverNow === 'function' ? serverNow() : Date.now();
  setHtmlIfChanged(setupEl('blk-list'), b.status === 'ok' ? b.rows.map((r) => '<div class="cb-row" data-key="b-' + esc(r.key) + '"><span class="cb-main"><span class="cb-title">' + esc(identityFromKey(r.key)) + '</span>' +
    '<span class="cb-sub">Blocked ' + esc(hubAgo(r.at, now)) + '</span></span><span class="cb-end"><button type="button" class="btn btn-sm" data-ppl-unblock="' + esc(r.key) + '">Unblock</button></span></div>').join('') : '');
  const empty = b.status === 'ok' ? (b.rows.length ? '' : 'Nobody is blocked.') : b.status === 'loading' || b.status === 'idle' ? 'Loading…' : b.status === 'denied' ? 'Blocking isn’t available yet — the database rules need updating.' : 'Needs the camp database.';
  setTextIfChanged(setupEl('blk-empty'), empty);
  setHiddenIfChanged(setupEl('blk-empty'), !empty);
}

async function peopleUnblockRow(key) {
  const res = await peopleUnblock(key);
  if (!res.ok) { setupSay(peopleWhy(res)); return; }
  setupSay(identityFromKey(key) + ' can ask again');
  renderPeopleBlockedSheet();
}

// ── closing: unsaved edits ask first, by every route ──

function peopleGuardClose(dirty, noun, onDiscard) {
  if (!dirty()) return false;
  if (askIsOpen()) return true;
  askDialog({ title: 'Discard your changes' + (noun ? ' to ' + noun : '') + '?', body: 'They haven’t been saved yet.', actions: [{ label: 'Keep editing', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }] })
    .then((v) => { if (v === 'discard') onDiscard(); });
  return true;
}

function peoplePersonGuardClose() {
  const p = peopleUi.person;
  return peopleGuardClose(peoplePersonDirty, p ? p.origin.name : '', () => { if (peopleUi.person === p) { peopleUi.person = null; shellSheetClose('people-person'); } });
}
function peopleTeamsGuardClose() {
  const t = peopleUi.teams;
  return peopleGuardClose(peopleTeamsDirty, 'teams', () => { if (peopleUi.teams === t) { peopleUi.teams = null; shellSheetClose('people-teams'); } });
}
function peopleAddGuardClose() {
  const a = peopleUi.add;
  return peopleGuardClose(peopleAddDirty, '', () => { if (peopleUi.add === a) { peopleUi.add = null; shellSheetClose('people-add'); } });
}

// An open sheet with unsaved edits, or one still writing, holds the deploy's auto-reload (the forms live in memory only).
function peopleBusy() {
  return !!((peopleUi.person && (peopleUi.person.busy || peoplePersonDirty())) || (peopleUi.request && peopleUi.request.busy) ||
    (peopleUi.teams && (peopleUi.teams.busy || peopleTeamsDirty())) || (peopleUi.add && (peopleUi.add.busy || peopleAddDirty())));
}

function renderPeopleSheetById(id) {
  if (id === 'people-person') renderPeoplePersonSheet();
  else if (id === 'people-request') renderPeopleRequestSheet();
  else if (id === 'people-teams') renderPeopleTeamsSheet();
  else if (id === 'people-add') renderPeopleAddSheet();
  else if (id === 'people-blocked') renderPeopleBlockedSheet();
}

function peopleSheetReady(id) {
  if (id === 'people-person') return !!peopleUi.person;
  if (id === 'people-request') return !!peopleUi.request;
  if (id === 'people-teams') return !!peopleUi.teams;
  if (id === 'people-add') return !!peopleUi.add;
  if (id === 'people-blocked') return peopleUi.blocked === true;
  return false;
}

// ── wiring ──

function wirePeopleScreen() {
  const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(ev, fn); };
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  on('#people-asking', 'change', (e) => { peopleToggleAsking(!!e.target.checked); });
  on('#people-requests', 'click', (e) => { const b = q(e, 'button[data-req]'); if (b) peopleOpenRequest(b.dataset.req, b); });
  on('#people-groups', 'click', (e) => {
    const b = q(e, 'button[data-person]');
    if (b) { peopleOpenPerson(b.dataset.person, b); return; }
    // An empty team's "Add someone": the one-person form, that team already picked.
    const a = q(e, 'button[data-ppl-add-team]');
    if (a && a.getAttribute('aria-disabled') !== 'true') peopleOpenAdd(a, 'one', { teamId: a.dataset.pplAddTeam });
  });
  on('#people-teams-btn', 'click', (e) => peopleOpenTeams(e.currentTarget));
  on('#people-add-btn', 'click', (e) => peopleOpenAdd(e.currentTarget, 'list'));
  on('#people-blocked-btn', 'click', (e) => peopleOpenBlocked(e.currentTarget));
  // ✕ and the backdrop of a form ask before they throw edits away (Escape and Back reach the same question through setupSheetGuardClose).
  const guarded = { 'sheet-people-person': peoplePersonGuardClose, 'sheet-people-teams': peopleTeamsGuardClose, 'sheet-people-add': peopleAddGuardClose };
  Object.keys(guarded).forEach((id) => { const s = setupEl(id); if (s) s.addEventListener('click', (e) => { if (q(e, '[data-sheet-close]') && guarded[id]()) e.stopPropagation(); }, true); });
  // the person
  const person = setupEl('sheet-people-person');
  if (person) {
    person.addEventListener('click', (e) => {
      let b;
      if ((b = q(e, '[data-ppl-role]'))) { const p = peopleUi.person; if (p && !b.disabled) { p.role = b.dataset.pplRole; renderPeoplePersonSheet(); } }
      else if ((b = q(e, '[data-ppl-camp]'))) peopleCampAccess(b.dataset.pplCamp, b.dataset.pplAccess);
      else if (q(e, '#ppl-signin-btn')) peoplePersonSignIn();
      else if (q(e, '#ppl-same-btn')) peoplePersonSameAs();
      else if (q(e, '#ppl-remove')) peopleRemovePerson();
      else if ((b = q(e, '#ppl-invite'))) peopleCopyInvite(b);
    });
    person.addEventListener('input', (e) => { if (e.target && e.target.id === 'ppl-name') { const p = peopleUi.person; if (p && p.error) { p.error = {}; } } });
  }
  on('#ppl-form', 'submit', (e) => { e.preventDefault(); peopleSavePersonSheet(); });
  on('#ppl-save', 'click', () => peopleSavePersonSheet());
  // a request
  const req = setupEl('sheet-people-request');
  if (req) {
    req.addEventListener('click', (e) => {
      let b;
      const r = peopleUi.request;
      if (!r) return;
      if ((b = q(e, '[data-prq-cand]'))) { r.cand = b.dataset.prqCand; r.error = ''; renderPeopleRequestSheet(); }
      else if ((b = q(e, '[data-prq-role]'))) { r.role = b.dataset.prqRole; renderPeopleRequestSheet(); }
    });
    req.addEventListener('input', (e) => { if (e.target && (e.target.id === 'prq-dirname' || e.target.id === 'prq-confirm')) { const r = peopleUi.request; if (r) { r.error = ''; renderPeopleRequestSheet(); } } });
  }
  on('#prq-form', 'submit', (e) => { e.preventDefault(); peopleRequestGo(); });
  on('#prq-go', 'click', () => peopleRequestGo());
  on('#prq-notnow', 'click', () => peopleRequestNotNow());
  on('#prq-block', 'click', () => peopleRequestBlock());
  // Put people on teams
  on('#ppt-save', 'click', () => peopleSaveTeamsSheet());
  on('#ppt-paste', 'click', () => {
    if (peopleTeamsDirty()) { setupSay('Save your team changes first.'); return; }
    peopleUi.teams = null; peopleOpenAdd(null, 'list');
  });
  // Add people
  const add = setupEl('sheet-people-add');
  if (add) {
    add.addEventListener('click', (e) => {
      let b;
      const a = peopleUi.add;
      if (!a) return;
      if ((b = q(e, '[data-ppa-pane]'))) {
        const was = a.pane;
        a.pane = b.dataset.ppaPane; a.error = ''; renderPeopleAddSheet();
        // the list / one-person switch is a pane change: the new pane arrives from the side its segment sits on
        if (was !== a.pane) setupPaneArrive(document.querySelector('#sheet-people-add [data-ppa-body="' + (a.pane === 'one' ? 'one' : 'list') + '"]'), a.pane === 'list');
      }
      else if ((b = q(e, '[data-ppa-role]'))) { a.role = b.dataset.ppaRole; renderPeopleAddSheet(); }
      else if ((b = q(e, '[data-ppa-camps]'))) { a.camps = b.dataset.ppaCamps; renderPeopleAddSheet(); }
      else if (q(e, '#ppa-roster')) peopleFillRoster();
      else if ((b = q(e, '#ppa-invite-copy'))) copyTextToClipboard(a.invite, b);
    });
    add.addEventListener('input', (e) => { if (e.target && e.target.id === 'ppa-lines') renderPeopleAddSheet(); });
  }
  on('#ppa-form', 'submit', (e) => { e.preventDefault(); });
  on('#ppa-go', 'click', () => peopleAddGo());
  on('#blk-list', 'click', (e) => { const b = q(e, 'button[data-ppl-unblock]'); if (b) peopleUnblockRow(b.dataset.pplUnblock); });
}

// ── 15. Campers (§11.9 — Step 25, session 3) ─────────────────────────────────────────────────────────────────────────
// Minors' first names, per team, for directors only. The data half is setup-sync.js's "CAMPERS" section (campersFor / campersAdd / …): an
// editor-only listener held in memory, never stored. This file paints and wires it. The rules of THIS section, pinned by tests/campers.test.js:
//   - no storage of any kind, no console, no markup built from a name except through esc(): a camper name reaches the page only as escaped text
//     or as an input's `value`; nothing here is mirrored into `state`, a hint, a draft cache or the undo stack;
//   - the Add and Edit forms are written once per open and the INPUTS are the draft; a sheet with a name typed and not saved asks before it
//     closes, by every route, and holds the deploy's auto-reload;
//   - names typed while the signal is gone wait in memory on this open screen (setup-sync.js campersAdd) and the screen says so; leaving with
//     names still waiting asks first (campersConfirmLeave, and app.js builderLeaveWarning for the phone's Back);
//   - Undo is ONE line on this screen for a few seconds, a closure holding the change in memory — the setup undo stack is persisted, so a camper
//     op must never go into it (setup-rebuild-spec §7.1);
//   - toasts and the sync line say counts ("3 campers added"), never a name.

const campersUi = {
  edit: null,   // the open camper sheet: { tid, cid, origin: { name, tid, ord }, fresh, error, busy }
  add: null,    // the Add sheet: { tid, fresh, busy, error }
  undo: null,   // the one line that undoes the last change: { text, run, timer }
};
const CAMPERS_SCREENS = ['hub', 'campers', 'people', 'teams', 'wizard'];  // the screens that hold the list (counts on the hub, Teams, People, the new-year clear)
const CAMPERS_UNDO_MS = 15000;

// The hub row's plain view: only counts, never a name.
function campersView() {
  const st = typeof campersStatus === 'function' ? campersStatus() : 'loading';
  const teams = (state.teams || []).filter((t) => t && typeof t.id === 'string');
  return {
    status: st, total: st === 'ok' ? campersTotal() : 0,
    empty: st === 'ok' ? teams.filter((t) => !campersCount(t.id)).map((t) => String(t.name || '').trim() || t.id) : [],
  };
}

// The chips and the held list are the ONLY places a minor's name is drawn. Clearing writes nothing when they are already empty
// (an idle render must not touch the DOM), so this can run on every paint of a screen that is not the Campers screen.
function campersUiForget() {
  ['campers-groups', 'campers-held-list'].forEach((id) => {
    const el = setupEl(id);
    if (el && (el.innerHTML || el.__secHtml !== undefined)) { el.innerHTML = ''; el.__secHtml = undefined; el.__secView = undefined; el.__dom = undefined; }
  });
}

function campersUiReset() {
  if (campersUi.undo && campersUi.undo.timer) clearTimeout(campersUi.undo.timer);
  campersUi.edit = null; campersUi.add = null; campersUi.undo = null;
  // The names go with the screen: nothing a closed builder leaves behind in the page holds a minor's name (the typed inputs included).
  campersUiForget();
  ['cme-name', 'cma-lines'].forEach((id) => { const el = setupEl(id); if (el && typeof el.value === 'string') el.value = ''; });
}

// What a listener event repaints: whatever counts or names the open screen shows.
function campersRepaint() {
  const s = setupScreen();
  if (s === 'hub') paintHub();
  else if (s === 'teams') renderTeamsScreen();
  else if (s === 'people') renderPeopleScreen();
  else if (s === 'campers') renderCampersScreen();
  else if (s === 'wizard' && typeof renderNywScreen === 'function') renderNywScreen(); // step 4's count
  if (campersUi.edit && shell.sheets.includes('camper-edit')) renderCamperEditSheet();
  if (campersUi.add && shell.sheets.includes('camper-add')) renderCamperAddSheet();
}

// The deploy's auto-reload waits for a camper sheet with a name typed and not saved (the forms live in memory only).
function campersUiBusy() {
  return !!((campersUi.edit && (campersUi.edit.busy || campersEditDirty())) || (campersUi.add && (campersUi.add.busy || campersAddDirty())));
}

// "Camper names are never kept" also means Undo is a closure: the line lasts a few seconds on this screen and is gone with it.
function campersSayUndo(text, run) {
  if (campersUi.undo && campersUi.undo.timer) clearTimeout(campersUi.undo.timer);
  const u = { text, run, timer: null };
  u.timer = setTimeout(() => { if (campersUi.undo === u) { campersUi.undo = null; if (setupScreen() === 'campers') renderCampersScreen(); } }, CAMPERS_UNDO_MS);
  campersUi.undo = u;
}

function campersUndoClear() {
  if (campersUi.undo && campersUi.undo.timer) clearTimeout(campersUi.undo.timer);
  campersUi.undo = null;
}

async function campersUndoGo() {
  const u = campersUi.undo;
  if (!u) return;
  campersUndoClear();
  renderCampersScreen();
  const res = await u.run();
  if (!res.ok) { setupSay(campersWhy(res)); return; }
  setupSay('Undone');
}

// A name where a screen reader and a thumb both need it: "Maya" and nothing more. A team's own chip row is a group named for the team.
function campersChipHtml(tid, c) {
  return '<button type="button" class="sec-chip cmp-chip" data-key="c-' + esc(c.id) + '" data-camper="' + esc(tid) + '|' + esc(c.id) + '">' + esc(c.name) + '</button>';
}

function campersGroupHtml(t) {
  const rows = campersFor(t.id);
  const name = String(t.name || '').trim() || t.id;
  // A team with nobody says so where the count goes, and its "+ Add" chip is the row under it (a separate "Nobody yet" line, then the lone
  // chip on a third line, repeated per empty team, made a stack of near-empty blocks).
  return '<section class="ppl-group cmp-group" data-key="g-' + esc(t.id) + '" aria-label="' + esc(name) + '"><h3 class="ppl-head">' + teamMarkHtml(t.id, { size: 24 }) +
    '<span class="ppl-head-name">' + esc(name) + '</span><span class="ppl-count">' + esc(rows.length ? hubPlural(rows.length, 'camper', 'campers') : 'Nobody yet') + '</span></h3>' +
    '<div class="cmp-chips">' + rows.map((c) => campersChipHtml(t.id, c)).join('') +
    '<button type="button" class="sec-chip cmp-chip cmp-add" data-key="add" data-camper-add="' + esc(t.id) + '" aria-label="Add a camper to ' + esc(name) + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>Add</button></div></section>';
}

function renderCampersScreen() {
  campersCleanSheets();
  const status = campersStatus();
  const total = campersTotal();
  const ok = status === 'ok';
  setTextIfChanged(setupEl('campers-title'), 'Campers · ' + campWord());
  setTextIfChanged(setupEl('campers-headline'), ok ? (total ? hubPlural(total, 'camper', 'campers') : 'No campers yet') : status === 'loading' ? 'Loading…' : 'The lists aren’t available');
  const note = status === 'nosync' ? 'Needs a connection: the camper lists can’t be reached right now.' : status === 'denied' ? 'The camper lists aren’t available yet — the database rules need updating.' : '';
  setTextIfChanged(setupEl('campers-state-text'), note);
  setHiddenIfChanged(setupEl('campers-state'), !note);
  // names typed with no signal, waiting on this screen
  const held = campersHeldList();
  setHiddenIfChanged(setupEl('campers-held'), !held.length);
  setTextIfChanged(setupEl('campers-held-title'), held.length === 1 ? '1 name waiting to be saved' : held.length + ' names waiting to be saved');
  setHtmlIfChanged(setupEl('campers-held-list'), held.map((h, i) => '<span class="sec-chip cmp-chip cmp-wait" data-key="w-' + i + '">' + esc(h.name) + '<small>' + esc(peopleTeamNameOf(h.tid)) + '</small></span>').join(''));
  const heldNote = campersMem.heldNote || '';
  setTextIfChanged(setupEl('campers-held-error'), heldNote);
  setHiddenIfChanged(setupEl('campers-held-error'), !heldNote);
  // the one line that undoes the last change
  setTextIfChanged(setupEl('campers-undo-text'), campersUi.undo ? campersUi.undo.text : '');
  setHiddenIfChanged(setupEl('campers-undo'), !campersUi.undo);
  // everyone, by team
  secPaintList(setupEl('campers-groups'), ok ? peopleTeams().map(campersGroupHtml).join('') : '', 'groups', { inner: '.cmp-chip' });
  setHiddenIfChanged(setupEl('campers-add-btn'), !ok);
  // "Not using camper lists this year": the week's own meta/skip/campers, said in plain words either way
  const sw = setupEl('campers-skip');
  const skip = !!(setupTree && setupTree.meta && setupTree.meta.skip && setupTree.meta.skip.campers === true);
  if (sw && typeof sw.hasAttribute === 'function' && sw.hasAttribute('checked') !== skip) sw.toggleAttribute('checked', skip);
  if (typeof paintSwitchWord === 'function') paintSwitchWord('campers-skip', skip);
}

// A sheet that was closed by any route leaves its state behind; the next pass of the screen drops it (a Forward must not reopen a stale form).
function campersCleanSheets() {
  if (campersUi.edit && !shell.sheets.includes('camper-edit')) campersUi.edit = null;
  if (campersUi.add && !shell.sheets.includes('camper-add')) campersUi.add = null;
}

async function campersToggleSkip(on) {
  if (!canEdit()) return;
  const r = commitSetup((d) => {
    d.meta.skip = d.meta.skip && typeof d.meta.skip === 'object' ? d.meta.skip : {};
    if (on) d.meta.skip.campers = true; else delete d.meta.skip.campers;
  }, { label: on ? 'Not using camper lists this year' : 'Use camper lists again', undo: false });
  if (r && r.ok === false) { setupSay(r.reason === 'loading' ? 'The week is still loading. Try again in a moment.' : peopleWhy(r)); renderCampersScreen(); return; }
  setupSay(on ? 'The hub will show a dash for campers.' : 'The hub will ask for camper lists again.');
}

// ── the camper sheet: rename, move, remove ──

function campersOpenEdit(tid, cid, opener) {
  if (!canEdit()) return;
  const c = campersFor(tid).find((x) => x.id === cid);
  if (!c) return;
  campersUi.edit = { tid, cid, origin: { name: c.name, tid, ord: c.ord }, fresh: true, error: '', busy: false };
  setupSheet('camper-edit', opener);
}

function campersEditForm() {
  const v = (id) => { const el = setupEl(id); return el && typeof el.value === 'string' ? el.value : ''; };
  return { name: campersCleanName(v('cme-name')), team: v('cme-team') };
}

function campersEditDirty() {
  const e = campersUi.edit;
  if (!e || !shell.sheets.includes('camper-edit') || e.busy) return false;
  const f = campersEditForm();
  return f.name !== e.origin.name || f.team !== e.origin.tid;
}

function renderCamperEditSheet() {
  const e = campersUi.edit;
  if (!e) return;
  const here = campersFind(e.tid, e.cid);
  if (e.fresh) {
    e.fresh = false;
    const nm = setupEl('cme-name'); if (nm) nm.value = e.origin.name;
    const sel = setupEl('cme-team');
    if (sel) { setHtmlIfChanged(sel, peopleTeams().map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + '</option>').join('')); sel.value = e.tid; }
  }
  setTextIfChanged(setupEl('sheet-camper-edit-title'), e.origin.name);
  const msg = e.error || (here ? '' : campersWhy({ reason: 'gone' }));
  setTextIfChanged(setupEl('cme-error'), msg);
  setHiddenIfChanged(setupEl('cme-error'), !msg);
  const save = setupEl('cme-save');
  setTextIfChanged(save, e.busy ? 'Saving…' : 'Save');
  secSetDisabled(save, e.busy || !here);
}

async function campersSaveEdit() {
  const e = campersUi.edit;
  if (!e || e.busy) return;
  e.error = '';
  const f = campersEditForm();
  if (!f.name) { e.error = campersWhy({ reason: 'name' }); renderCamperEditSheet(); return; }
  const renamed = f.name !== e.origin.name;
  const moved = f.team !== e.origin.tid;
  if (!renamed && !moved) { campersUi.edit = null; shellSheetClose('camper-edit'); return; }
  e.busy = true; renderCamperEditSheet();
  const was = { name: e.origin.name, tid: e.tid, ord: e.origin.ord, cid: e.cid };
  const res = moved ? await campersMove(e.tid, e.cid, f.team, { name: f.name }) : await campersRename(e.tid, e.cid, f.name);
  if (campersUi.edit !== e) return;
  e.busy = false;
  if (!res.ok) { e.error = campersWhy(res); renderCamperEditSheet(); return; }
  campersUi.edit = null;
  shellSheetClose('camper-edit');
  setupSay(moved ? 'Moved to ' + peopleTeamNameOf(f.team) : 'Renamed');
  campersSayUndo(moved ? 'Moved ' + f.name + ' to ' + peopleTeamNameOf(f.team) + '.' : 'Renamed ' + was.name + ' to ' + f.name + '.',
    () => (moved ? campersMove(f.team, was.cid, was.tid, { name: was.name, ord: was.ord }) : campersRename(was.tid, was.cid, was.name)));
  renderCampersScreen();
}

async function campersRemoveGo() {
  const e = campersUi.edit;
  if (!e || e.busy) return;
  const was = { name: e.origin.name, tid: e.tid, ord: e.origin.ord, cid: e.cid };
  e.busy = true; renderCamperEditSheet();
  const res = await campersRemove(e.tid, e.cid);
  if (campersUi.edit !== e) return;
  e.busy = false;
  if (!res.ok) { e.error = campersWhy(res); renderCamperEditSheet(); return; }
  campersUi.edit = null;
  shellSheetClose('camper-edit');
  setupSay('Removed');
  campersSayUndo('Removed ' + was.name + '.', () => campersPut(was.tid, was.cid, { name: was.name, ord: was.ord }));
  // The chip squashes out (scale and fade, as an elective chip taken off; calm: a fade), then the list closes the gap.
  const sel = /^[\w-]+$/.test(was.tid) && /^[\w-]+$/.test(was.cid) ? '#campers-groups [data-camper="' + was.tid + '|' + was.cid + '"]' : '';
  const chip = sel && typeof document !== 'undefined' && document.querySelector ? document.querySelector(sel) : null;
  if (chip && typeof JellyMotion !== 'undefined' && JellyMotion.playOut) JellyMotion.playOut(chip, (x) => ({ opacity: 1 - x, transform: 'scale(' + (1 - 0.04 * x) + ')' }), 150, () => renderCampersScreen());
  else renderCampersScreen();
}

// ── Add campers ──

function campersOpenAdd(tid, opener) {
  if (!canEdit()) return;
  const teams = peopleTeams();
  if (!teams.length) return;
  campersUi.add = { tid: teams.some((t) => t.id === tid) ? tid : teams[0].id, fresh: true, busy: false, error: '' };
  setupSheet('camper-add', opener);
}

function campersAddFields() {
  const v = (id) => { const el = setupEl(id); return el && typeof el.value === 'string' ? el.value : ''; };
  return { lines: v('cma-lines'), team: v('cma-team') };
}

function campersAddDirty() {
  const a = campersUi.add;
  if (!a || !shell.sheets.includes('camper-add') || a.busy) return false;
  return campersAddFields().lines.trim() !== '';
}

function renderCamperAddSheet() {
  const a = campersUi.add;
  if (!a) return;
  if (a.fresh) {
    a.fresh = false;
    const ta = setupEl('cma-lines'); if (ta) ta.value = '';
    const sel = setupEl('cma-team');
    if (sel) { setHtmlIfChanged(sel, peopleTeams().map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + '</option>').join('')); sel.value = a.tid; }
  }
  const f = campersAddFields();
  const parsed = campersParseNames(f.lines);
  const n = parsed.names.length;
  const online = typeof restoreOnline === 'function' && restoreOnline();
  const bits = [];
  if (n && !online) bits.push('There’s no signal, so these will wait on this screen until it’s back. Keep it open.');
  if (parsed.cut) bits.push(parsed.cut === 1 ? '1 name is longer than 40 characters and will be shortened.' : parsed.cut + ' names are longer than 40 characters and will be shortened.');
  if (parsed.over) bits.push('That’s a lot at once — the first ' + CAMPERS_ADD_MAX + ' will be added.');
  const warn = bits.join(' ');
  setTextIfChanged(setupEl('cma-warn'), warn);
  setHiddenIfChanged(setupEl('cma-warn'), !warn);
  const go = setupEl('cma-go');
  setTextIfChanged(go, a.busy ? 'Saving…' : n ? 'Add ' + hubPlural(n, 'camper', 'campers') : 'Add campers');
  secSetDisabled(go, a.busy || !n);
  setTextIfChanged(setupEl('cma-error'), a.error || '');
  setHiddenIfChanged(setupEl('cma-error'), !a.error);
}

async function campersAddGo() {
  const a = campersUi.add;
  if (!a || a.busy) return;
  a.error = '';
  const f = campersAddFields();
  const parsed = campersParseNames(f.lines);
  if (!parsed.names.length) { renderCamperAddSheet(); return; }
  a.busy = true; renderCamperAddSheet();
  const res = await campersAdd(f.team, parsed.names);
  if (campersUi.add !== a) return;
  a.busy = false;
  if (!res.ok) { a.error = campersWhy(res); renderCamperAddSheet(); return; }
  campersUi.add = null;
  shellSheetClose('camper-add');
  setupSay(res.held ? 'No signal — ' + hubPlural(res.held, 'name', 'names') + ' will wait on this screen' : 'Added ' + hubPlural(res.added, 'camper', 'campers'));
  renderCampersScreen();
}

// The signal came back and the held names went (setup-sync.js campersFlushHeld): counts only.
function onCampersFlushed(n) {
  if (canEdit()) setupSay(hubPlural(n, 'camper name', 'camper names') + ' saved');
}

// ── leaving with names still waiting, and closing a form with a name typed ──

async function campersConfirmLeave() {
  const n = typeof campersHeldCount === 'function' ? campersHeldCount() : 0;
  if (!n) return true;
  const choice = await askDialog({
    title: (n === 1 ? 'This name hasn’t' : 'These ' + n + ' names haven’t') + ' been saved yet',
    body: 'They’ll be lost if you leave. Camper names aren’t stored on phones.',
    actions: [{ label: 'Keep waiting', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }],
  });
  if (choice !== 'discard') return false;
  campersDiscardHeld();
  return true;
}

async function campersDiscardHeldGo() {
  if (!campersHeldCount()) return;
  if (await campersConfirmLeave()) renderCampersScreen();
}

function campersEditGuardClose() {
  const e = campersUi.edit;
  return peopleGuardClose(campersEditDirty, '', () => { if (campersUi.edit === e) { campersUi.edit = null; shellSheetClose('camper-edit'); } });
}
function campersAddGuardClose() {
  const a = campersUi.add;
  return peopleGuardClose(campersAddDirty, '', () => { if (campersUi.add === a) { campersUi.add = null; shellSheetClose('camper-add'); } });
}

// ── wiring ──

function wireCampersScreen() {
  const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(ev, fn); };
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  on('#campers-skip', 'change', (e) => { campersToggleSkip(!!e.target.checked); });
  on('#campers-groups', 'click', (e) => {
    let b;
    if ((b = q(e, 'button[data-camper]'))) { const p = String(b.dataset.camper).split('|'); campersOpenEdit(p[0], p[1], b); }
    else if ((b = q(e, 'button[data-camper-add]'))) campersOpenAdd(b.dataset.camperAdd, b);
  });
  on('#campers-add-btn', 'click', (e) => campersOpenAdd('', e.currentTarget));
  on('#campers-undo-btn', 'click', () => campersUndoGo());
  on('#campers-held-discard', 'click', () => campersDiscardHeldGo());
  // ✕ and the backdrop of a form ask before they throw edits away (Escape and Back reach the same question through setupSheetGuardClose).
  const guarded = { 'sheet-camper-edit': campersEditGuardClose, 'sheet-camper-add': campersAddGuardClose };
  Object.keys(guarded).forEach((id) => { const s = setupEl(id); if (s) s.addEventListener('click', (e) => { if (q(e, '[data-sheet-close]') && guarded[id]()) e.stopPropagation(); }, true); });
  on('#cme-form', 'submit', (e) => { e.preventDefault(); campersSaveEdit(); });
  on('#cme-save', 'click', () => campersSaveEdit());
  on('#cme-remove', 'click', () => campersRemoveGo());
  const edit = setupEl('sheet-camper-edit');
  if (edit) edit.addEventListener('input', (e) => { if (e.target && e.target.id === 'cme-name') { const c = campersUi.edit; if (c && c.error) { c.error = ''; renderCamperEditSheet(); } } });
  on('#cma-form', 'submit', (e) => { e.preventDefault(); });
  on('#cma-go', 'click', () => campersAddGo());
  const add = setupEl('sheet-camper-add');
  if (add) add.addEventListener('input', (e) => { if (e.target && e.target.id === 'cma-lines') { const a = campersUi.add; if (a) a.error = ''; renderCamperAddSheet(); } });
}

// ── 16. Games (§11.14 — Step 21) ─────────────────────────────────────────────────────────────────────────────────────────
// The week's games by schedule item (the Games screen, `#setup-games`) and ONE progressive sheet for a new game, an existing
// one and the ⚡ quick game (`#sheet-game`). Hooks are prefixed `sg-` (the screen) and `gm-` (the sheet): see index.html's
// templates and CLAUDE.md. The rules of this section, pinned by tests/games-screen.test.js:
//   - the catalog is written ONLY through configEdit (settings.js / app.js: the config engine's field ops, one undo entry per
//     change). There is no draft and no Save: a game is created whole the moment it has a name and a way of being scored, and from
//     then on every field saves as it changes, ONE field at a time, onto the game as it is NOW (looked up by id when the write
//     runs, so a colleague's edit to another field is never undone and a game deleted elsewhere is noticed, not resurrected);
//   - a new game's id is makeId's (the name's slug + a random tail) over takenGameIds (every per-game map, brackets4 included), so
//     two directors adding "Rain bowling" at once make two games and a new game never meets a leftover bracket, clock or result;
//   - the week's data is read through the accessors (allGames, competitionDays, gamesForBlock, unscheduledGames, planForDow);
//   - a game's place is `blockId` (+ `ord`) once the schedule is edited here, with `dayId` and `session` DERIVED from it exactly as
//     the rain plan's move does (setup-sync.js rainSessionFor, SETUP_GAME_ORD_STEP); with the original schedule only `dayId` +
//     `session` are read, and the screen groups by session.

const GM_FORMAT_WORDS = { tournament: 'Bracket', tally: 'Scores', placement: 'Podium' };
// The fields that belong to one way of scoring: a format change drops the other formats' (the classic editor's own rule).
const GM_TALLY_ONLY = ['unit', 'counterSteps', 'counterStepLabels', 'counterAllowNegative', 'lowerWins', 'timeInput', 'liveRankings'];
const GM_BRACKET_ONLY = ['liveTracker', 'ladderScoring', 'roundOneMatchups', 'bracketSeed'];
const GM_SEEDS = ['standings', 'pick', 'fixed'];
const GM_NBSP = ' ';

// ── the week's days and games, by weekday ──

function gmDow(dk) { return SETUP_DK.indexOf(dk); }
// The competition days (config.days) that fall on this weekday (normally one).
function gmDayRecs(dk) {
  const dow = gmDow(dk);
  return dow < 0 ? [] : competitionDays().filter((d) => d && d.dow === dow);
}
function gmIsGamesDay(dk) { return gmDayRecs(dk).length > 0; }
// The weekday key a competition day id falls on ('' for a day with no weekday).
function gmDkOfDayId(dayId) {
  const d = dayById(dayId);
  return d && Number.isInteger(d.dow) && d.dow >= 0 && d.dow <= 6 ? SETUP_DK[d.dow] : '';
}
function gmGamesOnDay(dk) {
  const ids = gmDayRecs(dk).map((d) => d.id);
  return allGames().filter((g) => g && ids.indexOf(g.dayId) !== -1);
}
// The games linked to one schedule item on this weekday, in the order everyone sees them (ord, ties by catalog position:
// gamesForBlock's own order), without `exceptId`.
function gmGamesOnBlock(dk, bid, exceptId) {
  const ids = gmDayRecs(dk).map((d) => d.id);
  return allGames().map((g, i) => ({ g, i }))
    .filter((x) => x.g && x.g.blockId === bid && ids.indexOf(x.g.dayId) !== -1 && x.g.id !== exceptId)
    .sort((a, b) => ((Number.isFinite(a.g.ord) ? a.g.ord : 1e9) - (Number.isFinite(b.g.ord) ? b.g.ord : 1e9)) || (a.i - b.i))
    .map((x) => x.g);
}
// One item of that weekday, as the schedule's rich block (null for an item that isn't there any more).
function gmBlock(dk, bid) {
  const dow = gmDow(dk);
  return dow < 0 || !bid ? null : (planForDow(dow).find((b) => b.id === bid) || null);
}
function gmSessions() {
  const s = state.config && state.config.sessions;
  return Array.isArray(s) && s.length ? s.filter((x) => typeof x === 'string' && x) : ['Morning', 'Evening'];
}
function gmIsTba(g) { return /^tba$/i.test(String(g && g.location || '').trim()); }

// A game's row: the format in a word, then where, then "double points". A place that still says TBA is flagged.
function gmGameSub(g) {
  const where = String(g.location || '').trim();
  const bits = [GM_FORMAT_WORDS[g.format] || 'No scoring yet'];
  if (gmIsTba(g)) bits.push('no place yet'); else if (where) bits.push(where);
  if (g.messtival === true) bits.push('double points');
  return { text: bits.join(' · '), warn: gmIsTba(g) };
}

// ── the day: what the screen draws ──
// { dk, dow, isDay, live, games, groups: [{ key, bid, block, session, time, now, games }], loose, n, warn, today, lede, headline, note }
// With the schedule edited here a group is a schedule item (one that holds games, or a Games item to put some under); with the
// original schedule a group is a session ("Morning games"), because the printed week's blockId links are not read. `loose`
// is the games on no item (unscheduledGames: in either mode the same list the rest of the app uses).
function gmDayModel(dk) {
  const dow = gmDow(dk);
  const recs = gmDayRecs(dk);
  const isDay = recs.length > 0;
  const live = typeof scheduleIsShared === 'function' && scheduleIsShared();
  const games = isDay ? gmGamesOnDay(dk) : [];
  const wk = typeof campWeek === 'function' ? campWeek() : { phase: 'unset' };
  const today = dk === SETUP_DK[campNow().dow] && wk.phase === 'during';
  const nowMin = campNow().minutes;
  let groups = [];
  let loose = [];
  if (isDay && live) {
    scheduleForDow(dow).forEach((legacy) => {
      const rich = typeof setupRichOf === 'function' ? setupRichOf(legacy) : null;
      if (!rich) return;
      const here = gamesForBlock(dow, legacy);
      if (!here.length && rich.type !== 'games') return;
      groups.push({
        key: 'b-' + rich.id, bid: rich.id, block: rich, session: '', games: here.slice(),
        time: rich.noTime ? '' : setupRange(rich.start, rich.end),
        now: today && !rich.noTime && rich.start <= nowMin && nowMin < rich.end,
      });
    });
    loose = unscheduledGames(dow).slice();
  } else if (isDay) {
    const sessions = gmSessions();
    games.forEach((g) => { if (g.session && sessions.indexOf(g.session) === -1) sessions.push(g.session); });
    groups = sessions.map((s) => ({ key: 's-' + s, bid: '', block: null, session: s, time: '', now: false, games: games.filter((g) => g.session === s) }));
    loose = games.filter((g) => !g.session);
  }
  const withGames = groups.filter((x) => x.games.length).length;
  const n = games.length;
  const warn = isDay && (n === 0 || loose.length > 0 || games.some(gmIsTba));
  const dayWord = SETUP_DAY_WORDS[dk];
  let lede;
  if (!isDay) lede = 'Not a games day';
  else if (!n) lede = (today ? 'Today · ' : '') + 'No games yet';
  else {
    // With items shown, the count before "on N schedule items" is the games ON them: counting the loose ones too read "6 games on 2
    // schedule items · 1 isn't on the schedule" when only 5 were.
    const onItems = groups.reduce((s, x) => s + x.games.length, 0);
    const bits = [hubPlural(live && withGames ? onItems : n, 'game', 'games').replace(' ', GM_NBSP)];
    if (live && withGames) bits[0] += ' on ' + hubPlural(withGames, 'schedule item', 'schedule items').replace(' ', GM_NBSP);
    if (loose.length) bits.push((loose.length === 1 ? '1' + GM_NBSP + 'isn’t' : loose.length + GM_NBSP + 'aren’t') + ' on the schedule');
    lede = (today ? 'Today · ' : '') + bits.join(' · ');
  }
  return { dk, dow, isDay, live, games, groups, loose, n, warn, today, lede, headline: dayWord, note: isDay ? String(recs[0].note || '').trim() : '' };
}

// The seven day chips: the count under the name (empty for a day that isn't a games day), the gold "!" and the words a screen
// reader hears — the count and the mark are drawn, so the label says them.
function gmStripModel() {
  return SETUP_DK.map((dk) => {
    const m = gmDayModel(dk);
    const word = SETUP_DAY_WORDS[dk];
    const label = m.isDay
      ? word + (m.today ? ', today' : '') + ', ' + (m.n ? hubPlural(m.n, 'game', 'games') : 'no games yet') + (m.warn ? ', needs a look' : '')
      : word + (m.today ? ', today' : '') + ', not a games day';
    return { dk, off: !m.isDay, n: m.isDay ? String(m.n) : '', warn: m.warn, today: m.today, label };
  });
}

// ── where a game goes ──
// The place a NEW game (or one being moved) takes on a weekday: with the schedule edited here and an item named, its `blockId`
// after what the item already holds (`ord`, in SETUP_GAME_ORD_STEPs) and the session that item's time belongs to (the rain
// plan's rainSessionFor); else only the day and a session. null for a weekday that isn't a games day (the caller makes it one).
function gmPlacement(dk, bid, hint) {
  const recs = gmDayRecs(dk);
  const rec = (hint && hint.dayId && recs.find((d) => d.id === hint.dayId)) || recs[0];
  if (!rec) return null;
  const block = typeof scheduleIsShared === 'function' && scheduleIsShared() && bid ? gmBlock(dk, bid) : null;
  if (block) {
    const top = gmGamesOnBlock(dk, bid, hint && hint.exceptId).reduce((o, x) => Math.max(o, Number.isFinite(x.ord) ? x.ord : 0), 0);
    return { dayId: rec.id, session: rainSessionFor(state.config, block), blockId: bid, ord: top + SETUP_GAME_ORD_STEP };
  }
  const sessions = gmSessions();
  const session = hint && hint.session && sessions.indexOf(hint.session) !== -1 ? hint.session : (hint && hint.minutes != null ? rainSessionFor(state.config, { start: hint.minutes }) : sessions[0]);
  return { dayId: rec.id, session };
}

// Where the last game on this item (else on this day) was played: what a new game's Where starts as (never a TBA).
function gmDefaultWhere(dk, bid) {
  const usable = (g) => String(g.location || '').trim() && !gmIsTba(g);
  const there = (bid ? gmGamesOnBlock(dk, bid) : []).filter(usable);
  const day = gmGamesOnDay(dk).filter(usable);
  const last = there[there.length - 1] || day[day.length - 1];
  return last ? String(last.location).trim() : '';
}

// What a game picks up with its way of being scored: live scoring is the house default (owner's call, 2026-07-24), as the classic
// editor's format pick sets it — Scores come with the live leaderboard, a bracket with the plain running scoreboard — and a bracket
// starts by the standings.
function gmFormatDefaults(format, from) {
  const out = {};
  if (format === 'tally') { if (!from || from.liveRankings === undefined) out.liveRankings = true; }
  if (format === 'tournament') {
    out.bracketSeed = from && GM_SEEDS.indexOf(from.bracketSeed) !== -1 ? from.bracketSeed : 'standings';
    if (!from || from.liveTracker === undefined) out.liveTracker = { unit: 'Points', periodLabel: 'Round', innings: 1, outs: 0 };
  }
  return out;
}

// ── creating a game ──
// One config edit that adds the whole record. The id is makeId's over takenGameIds; a game with no item named on a schedule
// edited here is offered A2's natural item (setupAttachNewGame), as every new game is. `form`: { name, emoji, location, format,
// messtival?, bracketSeed? }. Returns { ok, id } or { ok: false, reason: 'locked' | 'name' | 'format' | 'day' }.
function gmCreateGame(form, place) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const name = String(form && form.name || '').trim().slice(0, 60);
  if (!name) return { ok: false, reason: 'name' };
  if (!GM_FORMAT_WORDS[form.format]) return { ok: false, reason: 'format' };
  if (!place || !place.dayId) return { ok: false, reason: 'day' };
  const emoji = String(form.emoji || '').trim();
  const rec = {
    id: null, name, emoji: emoji && safeEmoji(emoji, '') === emoji ? emoji : '🏅',
    dayId: place.dayId, session: place.session || gmSessions()[0], location: String(form.location || '').trim().slice(0, 60),
    format: form.format, headline: '', rules: [],
  };
  if (place.blockId) { rec.blockId = place.blockId; rec.ord = place.ord; }
  if (form.messtival === true) rec.messtival = true;
  Object.assign(rec, gmFormatDefaults(form.format, form));
  let id = null;
  const ok = configEdit('Added “' + name + '”', () => {
    id = makeId(name, takenGameIds());
    rec.id = id;
    state.config.games.push(rec);
    if (!rec.blockId && !place.none && typeof setupAttachNewGame === 'function') setupAttachNewGame(state.config, rec);
  });
  if (ok === false) return { ok: false, reason: 'locked' };
  // The id is new to every per-game map on this device (takenGameIds); make sure of it anyway: a leftover is cleared, never inherited.
  clearGameRecords(id);
  saveState();
  return { ok: true, id };
}

// ── changing one game ──
function gmCanon(v) { const c = syncCanon(v); return JSON.stringify(c === undefined ? null : c); }

// Write some fields of one game (`patch`: field → value, `undefined` removes it), as ONE config edit, onto the game as it is
// now. Returns { ok: true, changed } | { ok: false, reason: 'locked' | 'gone' }.
function gmCommit(gid, patch, label) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const g = gameById(gid);
  if (!g) return { ok: false, reason: 'gone' };
  const fields = Object.keys(patch).filter((f) => f !== 'id' && gmCanon(g[f]) !== gmCanon(patch[f]));
  if (!fields.length) return { ok: true, changed: false };
  const was = g.name;
  // Inside Set up the week the docked undo pill offers each change; over the Games tab (the ⚡ quick game) a toast per field would stack
  // up, so a field edit is recorded (Recent changes, Undo there) but quiet — the dock's saved line is what says it landed.
  const ok = configEdit(label === undefined ? 'Edited “' + was + '”' : label, () => {
    const x = gameById(gid); // by id, when the write runs (P10)
    if (!x) return false;
    fields.forEach((f) => { if (patch[f] === undefined || patch[f] === null) delete x[f]; else x[f] = JSON.parse(JSON.stringify(patch[f])); });
    return undefined;
  }, builderOpen() ? undefined : { quiet: true });
  if (ok === false) return { ok: false, reason: 'gone' };
  return { ok: true, changed: true };
}

function gmRename(gid, name) {
  const g = gameById(gid);
  const v = String(name || '').trim().slice(0, 60);
  if (!g) return { ok: false, reason: 'gone' };
  if (!v) return { ok: false, reason: 'name' };
  return gmCommit(gid, { name: v }, v === g.name ? undefined : 'Renamed “' + g.name + '”');
}

// The words for what a format change would clear, "the saved result, the bracket in progress and the live match".
function gmGoingWords(gid) {
  const list = gameRecordLabels(gid);
  return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : (list[0] || '');
}

// How is it scored? On a game with records under its old format the caller asks first (`confirmed`); the records go with the old
// format's fields, and the change is then not undoable (an Undo that brought the format back would not bring the result back).
function gmChangeFormat(gid, format, opts) {
  const g = gameById(gid);
  if (configLocked()) return { ok: false, reason: 'locked' };
  if (!g) return { ok: false, reason: 'gone' };
  if (!GM_FORMAT_WORDS[format]) return { ok: false, reason: 'format' };
  if (g.format === format) return { ok: true, changed: false };
  const going = gameRecordLabels(gid);
  if (going.length && !(opts && opts.confirmed)) return { ok: false, reason: 'confirm', going: gmGoingWords(gid) };
  const patch = { format };
  (format === 'tally' ? GM_BRACKET_ONLY : format === 'tournament' ? GM_TALLY_ONLY : GM_TALLY_ONLY.concat(GM_BRACKET_ONLY)).forEach((f) => { patch[f] = undefined; });
  Object.assign(patch, gmFormatDefaults(format, g));
  if (going.length) { clearGameRecords(gid); saveState(); }
  return gmCommit(gid, patch, going.length ? null : 'Changed how “' + g.name + '” is scored');
}

// ── Matchups (bracket games) ──
// The saved choice: an explicit bracketSeed, else what the game already does (fixed pairs, or the free pick the wizard has
// always offered). A game on `fixed` with no complete set of pairs reads as `pick`.
function gmSeedOf(g) {
  if (GM_SEEDS.indexOf(g && g.bracketSeed) !== -1 && (g.bracketSeed !== 'fixed' || gmPairsValid(g.roundOneMatchups))) return g.bracketSeed;
  return gmPairsValid(g && g.roundOneMatchups) ? 'fixed' : 'pick';
}
// Pairs that cover every team exactly once, a pair per match.
function gmPairsValid(pairs) {
  const ids = teamIds();
  if (!Array.isArray(pairs) || ids.length < 2 || pairs.length !== ids.length / 2) return false;
  const seen = {};
  const ok = pairs.every((p) => Array.isArray(p) && p.length === 2 && p.every((t) => ids.indexOf(t) !== -1 && !seen[t] && (seen[t] = true)));
  return ok;
}
// The board: teams in the order they were tapped → matches [[a, b], …] (a missing slot is null).
function gmPairsBoard(order) {
  const n = teamIds().length;
  const out = [];
  for (let m = 0; m < n / 2; m++) out.push([order[m * 2] || null, order[m * 2 + 1] || null]);
  return out;
}
// One tap on a team key: a placed team comes out (the ones after it close up), a free one is placed next; with two teams left
// they fill the last match themselves (in the roster's order). Returns the new order.
function gmPairsTap(order, tid) {
  const ids = teamIds();
  if (ids.indexOf(tid) === -1) return order.slice();
  if (order.indexOf(tid) !== -1) return order.filter((t) => t !== tid);
  const next = order.concat([tid]);
  const free = ids.filter((t) => next.indexOf(t) === -1);
  return free.length === 2 && ids.length > 2 ? next.concat(free) : next;
}
function gmPairsFromOrder(order) {
  const b = gmPairsBoard(order);
  return b.every((p) => p[0] && p[1]) ? b.map((p) => p.slice()) : null;
}
// Save the Matchups choice. standings / pick drop any fixed pairs; fixed needs the whole board (a partly filled one is saved as
// "Pick them when you start", which is what the game will do).
function gmSetSeed(gid, mode, order) {
  if (GM_SEEDS.indexOf(mode) === -1) return { ok: false, reason: 'mode' };
  const pairs = mode === 'fixed' ? gmPairsFromOrder(order || []) : null;
  const eff = mode === 'fixed' && !pairs ? 'pick' : mode;
  return gmCommit(gid, { bracketSeed: eff, roundOneMatchups: pairs || undefined }, 'Matchups for “' + ((gameById(gid) || {}).name || 'this game') + '”');
}

// ── order inside an item ──
// Earlier / Later: the game trades places with its neighbour on the same item. Every game of the item is renumbered 10, 20, 30…
// in the new order (only the ones whose `ord` changes are written), so ties and missing numbers never leave it ambiguous.
function gmOrderGame(gid, dir) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const g = gameById(gid);
  if (!g) return { ok: false, reason: 'gone' };
  const dk = gmDkOfDayId(g.dayId);
  if (!dk || typeof g.blockId !== 'string' || !(typeof scheduleIsShared === 'function' && scheduleIsShared())) return { ok: false, reason: 'no-item' };
  const list = gmGamesOnBlock(dk, g.blockId);
  const i = list.findIndex((x) => x.id === gid);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return { ok: false, reason: 'edge' };
  const next = list.slice();
  next[i] = list[j];
  next[j] = list[i];
  const ords = {};
  next.forEach((x, k) => { ords[x.id] = (k + 1) * SETUP_GAME_ORD_STEP; });
  const ok = configEdit('Moved “' + g.name + '” ' + (dir < 0 ? 'earlier' : 'later'), () => {
    next.forEach((x) => { const y = gameById(x.id); if (y && y.ord !== ords[x.id]) y.ord = ords[x.id]; });
  });
  return { ok: ok !== false };
}

// ── When (the move picker) ──
// A game moves to an item (with the schedule edited here), or to a session on a day (the original schedule), or off the
// schedule. Its day follows the item's weekday, its session the item's time, its order goes after what the item holds. Onto
// an item that has double-points games the caller asks first (`opts.double` 'yes' | 'no'). A weekday that isn't a games day
// is made one first by the caller (gmMakeDay). `to`: { dk, bid } | { dk, session } | { none: true }.
function gmMoveGame(gid, to, opts) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const g = gameById(gid);
  if (!g) return { ok: false, reason: 'gone' };
  if (to && to.none) {
    return gmCommit(gid, { blockId: undefined, ord: undefined }, 'Took “' + g.name + '” off the schedule');
  }
  const place = gmPlacement(to.dk, to.bid, { dayId: g.dayId, exceptId: gid, session: to.session });
  if (!place) return { ok: false, reason: 'day' };
  // An item that isn't on that day any more (a colleague removed it) must not quietly turn into "not on the schedule".
  if (to.bid && !place.blockId) return { ok: false, reason: 'item' };
  // Already on that item: nothing moves (a re-sort to the end of the item, with an undo entry, is not what a tap on "here" means).
  if (place.blockId && g.blockId === place.blockId && g.dayId === place.dayId) return { ok: true, changed: false };
  const patch = { dayId: place.dayId, session: place.session, blockId: place.blockId, ord: place.blockId ? place.ord : undefined };
  if (place.blockId) {
    const doubles = gmGamesOnBlock(to.dk, to.bid, gid).some((x) => x.messtival === true) && g.messtival !== true;
    if (doubles && !(opts && (opts.double === 'yes' || opts.double === 'no'))) return { ok: false, reason: 'double' };
    if (doubles && opts.double === 'yes') patch.messtival = true;
  }
  const block = place.blockId ? gmBlock(to.dk, to.bid) : null;
  const where = block ? (block.base || block.label) : SETUP_DAY_WORDS[to.dk] + ' ' + (place.session || '').toLowerCase();
  return gmCommit(gid, patch, 'Moved “' + g.name + '” to ' + where);
}

// ── make a copy, delete ──
function gmDuplicate(gid) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const orig = gameById(gid);
  if (!orig) return { ok: false, reason: 'gone' };
  const copy = JSON.parse(JSON.stringify(orig));
  copy.name = (orig.name + ' (copy)').slice(0, 60);
  delete copy.prompts; // only one drawing-prompts game is supported per week
  let id = null;
  const ok = configEdit('Made a copy of “' + orig.name + '”', () => {
    const idx = allGames().findIndex((x) => x.id === gid);
    id = makeId(copy.name, takenGameIds());
    copy.id = id;
    if (idx > -1) state.config.games.splice(idx + 1, 0, copy); else state.config.games.push(copy);
  });
  if (ok === false) return { ok: false, reason: 'locked' };
  clearGameRecords(id);
  saveState();
  return { ok: true, id };
}

// Delete: asks first (what goes with it, in words), takes a `pre-delete` restore point when it has a saved result, then removes
// the game and everything kept under its id (GAME_RECORD_MAPS). With records the delete is not undoable.
async function gmDeleteGame(gid) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const g = gameById(gid);
  if (!g) return { ok: false, reason: 'gone' };
  const going = gmGoingWords(gid);
  const hasResult = !!(state.results && state.results[gid]);
  const day = dayById(g.dayId);
  const body = [going ? 'This also removes ' + going + '. It can’t be undone.' : 'It comes off ' + (day ? day.name + '’s' : 'the') + ' list of games. “Undo” puts it back.'];
  const go = await askDialog({
    title: 'Delete “' + g.name + '”?', body,
    actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Delete it', value: 'go', kind: 'danger' }],
  });
  if (go !== 'go') return { ok: false, reason: 'cancelled' };
  if (!gameById(gid)) return { ok: true, gone: true };
  if (hasResult && typeof schedSafetyPoint === 'function' && !(await schedSafetyPoint('Before deleting ' + g.name))) return { ok: false, reason: 'safety' };
  const hadRecords = gameRecordLabels(gid).length > 0;
  configEdit(hadRecords ? null : 'Deleted “' + g.name + '”', () => {
    const idx = allGames().findIndex((x) => x.id === gid);
    if (idx > -1) state.config.games.splice(idx, 1);
  });
  clearGameRecords(gid);
  if (state.ui.gameId === gid) state.ui.gameId = null;
  saveState();
  return { ok: true };
}

// ── days with games (ux-R14: moved here from Camp week) ──
// Make a weekday a games day: one competition day at its place in the week (the order the Games tab lists them). An empty
// games day is harmless; Take it off again from its ⋯.
function gmMakeDay(dk) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const dow = gmDow(dk);
  if (dow < 0) return { ok: false, reason: 'day' };
  if (gmIsGamesDay(dk)) return { ok: true, changed: false };
  let id = null;
  const ok = configEdit('Made ' + SETUP_DAY_WORDS[dk] + ' a games day', () => {
    id = 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const days = state.config.days;
    const at = days.findIndex((d) => d && Number.isInteger(d.dow) && d.dow > dow);
    const rec = { id, name: SETUP_DAY_WORDS[dk], dow, note: '' };
    if (at === -1) days.push(rec); else days.splice(at, 0, rec);
  });
  return ok === false ? { ok: false, reason: 'locked' } : { ok: true, changed: true, id };
}

// The day's note (the banner above its games on the Games tab).
function gmSetDayNote(dk, text) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const rec = gmDayRecs(dk)[0];
  if (!rec) return { ok: false, reason: 'day' };
  const v = String(text || '').trim().slice(0, 200);
  if (v === String(rec.note || '').trim()) return { ok: true, changed: false };
  const id = rec.id;
  const ok = configEdit('Edited the note for ' + SETUP_DAY_WORDS[dk], () => { const d = dayById(id); if (!d) return false; d.note = v; return undefined; });
  return ok === false ? { ok: false, reason: 'gone' } : { ok: true, changed: true };
}

// Take a weekday off the games days. A day with games asks where they go (every other games day is a choice; they never just
// vanish): the games move to that day, off any item they were on (they get their natural one there, as a new game does).
// `moveTo`: the weekday key the games go to ('' when the day holds none).
function gmTakeDayOff(dk, moveTo) {
  if (configLocked()) return { ok: false, reason: 'locked' };
  const recs = gmDayRecs(dk);
  if (!recs.length) return { ok: true, changed: false };
  const ids = recs.map((d) => d.id);
  const games = gmGamesOnDay(dk);
  // The games go to ANOTHER games day: the day being taken off is never its own destination (its record is deleted below, which
  // would leave them on a day that isn't there).
  const target = moveTo && moveTo !== dk ? (gmDayRecs(moveTo)[0] || null) : null;
  if (games.length && !target) return { ok: false, reason: 'where' };
  const moved = games.map((g) => g.id);
  const ok = configEdit('Took ' + SETUP_DAY_WORDS[dk] + ' off the games days', () => {
    moved.forEach((id) => {
      const g = gameById(id);
      if (!g) return;
      g.dayId = target.id;
      delete g.blockId;
      delete g.ord;
      if (typeof setupAttachNewGame === 'function') setupAttachNewGame(state.config, g);
    });
    const list = state.config.days;
    for (let i = list.length - 1; i >= 0; i--) if (list[i] && ids.indexOf(list[i].id) !== -1) list.splice(i, 1);
  });
  if (ok === false) return { ok: false, reason: 'locked' };
  if (ids.indexOf(state.ui.day) !== -1) state.ui.day = defaultDay(state.config);
  saveState();
  return { ok: true, changed: true, moved: moved.length };
}

// ── the ⚡ quick game ──
// Where a quick game lands: the day being looked at (the Games tab's day, else today when it is a games day, else the first), and
// on that day the item Now is on — the very block the Now card shows (app.js nowCurrentBlock: a games item that ran over is still
// the one) — when it is a Games item or already holds games; else the next such item today; on another day the first Games item;
// else off the schedule (the printed week: its session by the clock). A quick game is never hung under lunch or free time. The old
// guess (`>= 720 ? 'Evening'` by the clock) put senior's afternoons wrong.
function gmQuickTarget() {
  const now = campNow();
  const viewed = dayById(state.ui && state.ui.day);
  let dk = viewed && Number.isInteger(viewed.dow) ? SETUP_DK[viewed.dow] : '';
  if (!dk || !gmIsGamesDay(dk)) dk = gmIsGamesDay(SETUP_DK[now.dow]) ? SETUP_DK[now.dow] : (competitionDays().filter((d) => Number.isInteger(d.dow)).map((d) => SETUP_DK[d.dow])[0] || '');
  if (!dk) return null;
  const isToday = gmDow(dk) === now.dow;
  let bid = '';
  if (typeof scheduleIsShared === 'function' && scheduleIsShared()) {
    const holds = (b) => !b.noTime && (b.type === 'games' || gmGamesOnBlock(dk, b.id).length > 0);
    const items = planForDow(gmDow(dk)).filter(holds);
    let hit = items[0];
    if (isToday) {
      const cur = typeof nowCurrentBlock === 'function' ? nowCurrentBlock() : null;
      const rich = cur && typeof setupRichOf === 'function' ? setupRichOf(cur.b) : null;
      const under = rich ? items.find((b) => b.id === rich.id) : null;
      hit = under || items.find((b) => b.start > now.minutes) || null;
    }
    bid = hit ? hit.id : '';
  }
  return { dk, bid, today: isToday, minutes: now.minutes };
}

// ── the Games screen ──
// The state of the screen and of its sheets (device-local, in memory: a half-typed name is never synced or cached).
const gmUi = {
  open: null,          // the open game sheet (see gmOpenSheet)
  dayDk: '',           // the weekday the ⋯ sheet is about
  stripDay: undefined, // the day the strip last scrolled to
  stripPlaced: false,  // the strip opened scrolled to today once per visit
  closing: false,      // a close is flushing the field being typed: that blur saves a game, it never makes one
};

// The day being looked at: the one chosen (device-local), else today during the camp week, else the first games day.
function gmDayKey() {
  const v = state.ui && state.ui.sgDay;
  if (SETUP_DK.indexOf(v) !== -1) return v;
  const wk = typeof campWeek === 'function' ? campWeek() : { phase: 'unset' };
  const today = SETUP_DK[campNow().dow];
  if (wk.phase === 'during' && gmIsGamesDay(today)) return today;
  return SETUP_DK.find((dk) => gmIsGamesDay(dk)) || 'mon';
}

function gmSetDay(dk) {
  if (SETUP_DK.indexOf(dk) === -1) return;
  state.ui.sgDay = dk;
  saveState();
  renderAll();
}

// A day's emoji, drawn as the run sheet draws one (laundered: it came from the database).
function gmEmoHtml(e) {
  const s = safeEmoji(e, '');
  return s ? '<span class="sched-emo" aria-hidden="true">' + esc(s) + '</span>' : '';
}

function gmGameRowHtml(g) {
  const sub = gmGameSub(g);
  return '<button type="button" class="cb-row sg-game" data-key="g-' + esc(g.id) + '" data-sg-open="' + esc(g.id) + '"' + (sub.warn ? ' data-warn' : '') + '>' +
    '<span class="cb-main"><span class="cb-title">' + gmEmoHtml(g.emoji) + '<span>' + esc(g.name) + '</span></span><span class="cb-sub">' + esc(sub.text) + '</span></span>' +
    '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

// Games on no item: an invisible full-row button opens the game and "Put on the schedule" (its own 44px target) opens it on When.
function gmLooseRowHtml(g, live) {
  const sub = gmGameSub(g);
  return '<div class="cb-row sg-game gl-row-split" data-key="g-' + esc(g.id) + '"' + (sub.warn ? ' data-warn' : '') + '>' +
    '<button type="button" class="gl-row-hit" data-sg-open="' + esc(g.id) + '" aria-labelledby="sg-n-' + esc(g.id) + '"></button>' +
    '<span class="cb-main"><span class="cb-title">' + gmEmoHtml(g.emoji) + '<span id="sg-n-' + esc(g.id) + '">' + esc(g.name) + '</span></span><span class="cb-sub">' + esc(sub.text) + '</span></span>' +
    '<span class="cb-end">' + (live ? '<button type="button" class="btn btn-sm sg-place" data-sg-place="' + esc(g.id) + '">Put on the schedule</button>' : '') + '</span></div>';
}

function gmGroupHtml(g) {
  const label = g.block ? (g.block.base || g.block.label) : g.session + ' games';
  const target = g.bid || 'session:' + g.session;
  return '<section class="sg-item" data-key="' + esc(g.key) + '"' + (g.now ? ' data-now' : '') + '>' +
    '<h3 class="sg-item-h"><span class="sg-item-time">' + esc(g.time) + (g.now ? '<span class="sg-item-now">Now</span>' : '') + '</span>' +
    '<span class="sg-item-name">' + (g.block ? gmEmoHtml(g.block.emoji) : '') + '<span>' + esc(label) + '</span></span></h3>' +
    '<div class="gl cb-list sg-list">' + g.games.map(gmGameRowHtml).join('') +
    '<button type="button" class="sg-add-here" data-sg-add="' + esc(target) + '"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Add a game here</span></button></div></section>';
}

// The seven chips: selected, today, "not a games day" (data-off), the count and the gold "!" and the words read aloud.
function renderGmStrip(dk) {
  const track = setupEl('sg-days-track');
  if (!track || typeof track.querySelectorAll !== 'function') return;
  const chips = gmStripModel();
  track.querySelectorAll('.daypick-btn[data-day]').forEach((btn) => {
    const c = chips.find((x) => x.dk === btn.dataset.day);
    if (!c) return;
    const sel = c.dk === dk;
    if (btn.getAttribute('aria-selected') !== String(sel)) btn.setAttribute('aria-selected', String(sel));
    if (c.off !== btn.hasAttribute('data-off')) { if (c.off) btn.setAttribute('data-off', ''); else btn.removeAttribute('data-off'); }
    if (c.today !== btn.hasAttribute('data-today')) { if (c.today) btn.setAttribute('data-today', ''); else btn.removeAttribute('data-today'); }
    setTextIfChanged(btn.querySelector('[data-sg-n]'), c.n);
    setHiddenIfChanged(btn.querySelector('[data-sd-warn]'), !c.warn);
    if (btn.getAttribute('aria-label') !== c.label) btn.setAttribute('aria-label', c.label);
  });
  // Opens with today's chip at the left edge during the camp week, and keeps the chosen chip whole in view (the Schedule's rules).
  if (!gmUi.stripPlaced) {
    const chip = track.querySelector('.daypick-btn[data-today]');
    if (chip && typeof chip.offsetLeft === 'number') { track.scrollLeft = chip.offsetLeft; gmUi.stripPlaced = true; }
  }
  const prev = gmUi.stripDay;
  if (prev !== dk && track.clientWidth > 0) {
    gmUi.stripDay = dk;
    const chosen = track.querySelector('.daypick-btn[aria-selected="true"]');
    stripRevealChip(track, chosen, prev !== undefined);
    if (chosen && prev !== undefined) secSnap(chosen);
  }
  paintStripOverflow(track);
}

function renderGamesScreen() {
  const dk = gmDayKey();
  const m = gmDayModel(dk);
  const word = SETUP_DAY_WORDS[dk];
  const editable = canEdit();
  renderGmStrip(dk);
  setTextIfChanged(setupEl('sg-title'), 'Games · ' + campWord());
  setTextIfChanged(setupEl('sg-headline'), m.headline);
  setTextIfChanged(setupEl('sg-lede'), m.lede);
  setHiddenIfChanged(setupEl('sg-day-btn'), !(m.isDay && editable));
  setTextIfChanged(setupEl('sg-day-btn-text'), word + '’s options');
  setHiddenIfChanged(setupEl('sg-note'), !m.note);
  setTextIfChanged(setupEl('sg-note-text'), m.note);
  setHiddenIfChanged(setupEl('sg-orig'), m.live || !m.isDay);
  // Not a games day: the one way to make it one (asks nothing — an empty games day is harmless, and its ⋯ takes it off again).
  setHiddenIfChanged(setupEl('sg-noday'), m.isDay || !editable);
  setTextIfChanged(setupEl('sg-day-on-text'), 'Make ' + word + ' a games day');
  // A games day with nothing to put a game under: the one main action.
  const empty = m.isDay && !m.groups.length && !m.loose.length;
  setHiddenIfChanged(setupEl('sg-empty'), !(empty && editable));
  setTextIfChanged(setupEl('sg-empty-text'), 'No games on ' + word + ' yet.');
  secPaintList(setupEl('sg-items'), m.groups.map(gmGroupHtml).join(''), dk, { inner: '.sg-game', dir: secViewDir });
  setHiddenIfChanged(setupEl('sg-sec-off'), !m.loose.length);
  setTextIfChanged(setupEl('sg-off-note'), m.loose.length ? hubPlural(m.loose.length, 'game', 'games').replace(' ', GM_NBSP) : '');
  secPaintList(setupEl('sg-off-list'), m.loose.map((g) => gmLooseRowHtml(g, m.live)).join(''), dk, { inner: '.sg-place' });
  setHiddenIfChanged(setupEl('sg-add'), !(m.isDay && !empty && editable));
  setTextIfChanged(setupEl('sg-add-text'), 'Add a game to ' + word);
  renderGmBracketNotes(editable);
}

// Brackets that need a look, whichever day is open (the hub's Games row says so, and this is where it is put right): a late tap after
// a result was saved (Discard removes what it left; the result is not touched) and a four-team bracket waiting for a re-check.
function gmBracketNoteRowHtml(n, kind) {
  // Named with its day ("Legacy Game · Wednesday"): senior plays one every day, and a name alone does not say which.
  const g = typeof gameById === 'function' ? gameById(n.id) : null;
  const day = g && typeof dayById === 'function' ? dayById(g.dayId) : null;
  const title = esc(n.name) + (day && day.name ? ' · ' + esc(day.name) : '');
  const id = 'sg-bn-' + kind + '-' + esc(n.id);
  if (kind === 'late') {
    return '<div class="cb-row sg-game sg-bn-row" data-key="bn-late-' + esc(n.id) + '"><span class="cb-main"><span class="cb-title"><span id="' + id + '">' + title + '</span></span>' +
      '<span class="cb-sub">A match was recorded after the result was saved. The result is not changed.</span></span>' +
      '<span class="cb-end"><button type="button" class="btn btn-sm" data-sg-discard="' + esc(n.id) + '" aria-describedby="' + id + '">Discard</button></span></div>';
  }
  // A re-check is settled in the game itself: the whole row opens it (never a sentence telling the director where to go).
  return '<button type="button" class="cb-row sg-game sg-bn-row" data-key="bn-recheck-' + esc(n.id) + '" data-sg-settle="' + esc(n.id) + '"><span class="cb-main"><span class="cb-title">' + title + '</span>' +
    '<span class="cb-sub">Two phones recorded different winners. It’s waiting for a director to choose which is right.</span></span>' +
    '<span class="cb-end"><svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>';
}

function renderGmBracketNotes(editable) {
  const bn = typeof bracketNotes === 'function' ? bracketNotes() : { late: [], recheck: [] };
  const rows = bn.late.map((n) => gmBracketNoteRowHtml(n, 'late')).concat(bn.recheck.map((n) => gmBracketNoteRowHtml(n, 'recheck')));
  setHiddenIfChanged(setupEl('sg-sec-bn'), !(editable && rows.length));
  setHtmlIfChanged(setupEl('sg-bn-list'), editable ? rows.join('') : '');
}

// ── a day's own sheet (⋯): its note, and taking it off the games days ──
function gmOpenDaySheet(opener) {
  const dk = gmDayKey();
  if (!canEdit() || !gmIsGamesDay(dk)) return;
  gmUi.dayDk = dk;
  setupSheet('sg-day', opener);
}

function renderGmDaySheet() {
  const dk = gmUi.dayDk;
  const rec = gmDayRecs(dk)[0];
  if (!rec) { shellSheetClose('sg-day'); return; }
  const word = SETUP_DAY_WORDS[dk];
  const n = gmGamesOnDay(dk).length;
  setTextIfChanged(setupEl('sheet-sg-day-title'), word);
  setTextIfChanged(setupEl('sg-day-note-label'), 'Note on ' + word + '’s games');
  const box = setupEl('sg-day-note');
  if (box && document.activeElement !== box && box.value !== String(rec.note || '')) box.value = String(rec.note || '');
  setTextIfChanged(setupEl('sg-day-off-title'), 'Make ' + word + ' a day with no games');
  setTextIfChanged(setupEl('sg-day-off-sub'), n ? 'First asks where its ' + hubPlural(n, 'game', 'games') + ' go' : 'It has no games');
}

// The note saves when focus leaves the box (nothing else to press).
function gmDayNoteBlur() {
  const box = setupEl('sg-day-note');
  if (!box || !gmUi.dayDk) return;
  if (gmFocusUntouched(box)) return; // only a changed note is written (a colleague's newer one is not put back)
  const r = gmSetDayNote(gmUi.dayDk, box.value);
  if (r.ok && r.changed) renderAll();
}

// Take the day off: a day with games asks where they go (every other games day is a choice); the games never just vanish.
async function gmTakeDayOffFlow() {
  const dk = gmUi.dayDk;
  if (!canEdit() || !gmIsGamesDay(dk)) return { ok: false, reason: 'day' };
  const word = SETUP_DAY_WORDS[dk];
  const n = gmGamesOnDay(dk).length;
  let moveTo = '';
  if (n) {
    const others = SETUP_DK.filter((d) => d !== dk && gmIsGamesDay(d));
    if (!others.length) { setupSay('Make another day a games day first — ' + word + '’s games need somewhere to go.'); return { ok: false, reason: 'where' }; }
    const pick = await askDialog({
      title: 'Where do ' + word + '’s ' + hubPlural(n, 'game', 'games') + ' go?', body: ['They move to the day you pick, and keep their results.'], stack: true,
      actions: others.slice(0, 6).map((d) => ({ label: 'Move them to ' + SETUP_DAY_WORDS[d], value: d })).concat([{ label: 'Not now', value: 'no', kind: 'quiet', cancel: true }]),
    });
    if (!pick || pick === 'no') return { ok: false, reason: 'cancelled' };
    moveTo = pick;
  } else {
    const go = await askDialog({
      title: 'Take ' + word + ' off the games days?', body: ['It has no games. “Make ' + word + ' a games day” puts it back.'],
      actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Take it off', value: 'go', kind: 'danger' }],
    });
    if (go !== 'go') return { ok: false, reason: 'cancelled' };
  }
  const r = gmTakeDayOff(dk, moveTo);
  if (r.ok) { shellSheetClose('sg-day'); renderAll(); }
  return r;
}

function gmMakeDayGo(dk) {
  const r = gmMakeDay(dk);
  if (r.ok && r.changed) renderAll();
  return r;
}

// ── opening a game (the sheet itself is below) ──
// The Games screen on a day: a weekday key, or a competition day's id (the Games tab's own day). Opens the builder on it.
function gmOpenScreen(day) {
  if (!canEdit()) return;
  const dk = SETUP_DK.indexOf(day) !== -1 ? day : gmDkOfDayId(day);
  if (dk) state.ui.sgDay = dk;
  openBuilder(null, 'games');
}

// The Games tab's "Add games" on a day with none: the game sheet itself, on that day's first Games item, over the tab (the builder
// stays closed, so Done lands back on the day with the game on it). With no games day to put it on (a camp with no competition days
// at all) it is the Games screen, where a weekday is made a games day. Returns whether a sheet or a screen opened.
function gmAddGames(day) {
  if (!canEdit()) return false;
  const dk = SETUP_DK.indexOf(day) !== -1 ? day : gmDkOfDayId(day);
  if (dk && gmIsGamesDay(dk)) { state.ui.sgDay = dk; return gmOpenNew({ dk }); }
  gmOpenScreen(day);
  return builderOpen();
}

function wireGamesScreen() {
  const on = (sel, ev, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); };
  on('#sg-days', 'click', (e) => { const b = e.target.closest && e.target.closest('.daypick-btn[data-day]'); if (b) gmSetDay(b.dataset.day); });
  const track = setupEl('sg-days-track');
  if (track) track.addEventListener('scroll', () => paintStripOverflow(track), { passive: true });
  on('#setup-games', 'click', (e) => {
    const q = (sel) => (e.target.closest ? e.target.closest(sel) : null);
    let b;
    if ((b = q('[data-sg-discard]'))) { const r = typeof discardLateBracket === 'function' ? discardLateBracket(b.dataset.sgDiscard) : null; if (r && r.ok) showToast('Discarded.'); return; }
    if ((b = q('[data-sg-settle]'))) { gmSettleBracket(b.dataset.sgSettle); return; }
    if ((b = q('[data-sg-place]'))) { if (typeof gmOpenGame === 'function') gmOpenGame(b.dataset.sgPlace, { pane: 'when', opener: b }); }
    else if ((b = q('[data-sg-open]'))) { if (typeof gmOpenGame === 'function') gmOpenGame(b.dataset.sgOpen, { opener: b }); }
    else if ((b = q('[data-sg-add]'))) { if (typeof gmOpenNew === 'function') gmOpenNew({ dk: gmDayKey(), target: b.dataset.sgAdd, opener: b }); }
    else if (q('#sg-add') || q('#sg-add-first')) { if (typeof gmOpenNew === 'function') gmOpenNew({ dk: gmDayKey(), opener: q('#sg-add') || q('#sg-add-first') }); }
    else if (q('#sg-day-on')) gmMakeDayGo(gmDayKey());
    else if ((b = q('#sg-day-btn'))) gmOpenDaySheet(b);
  });
  const day = setupEl('sheet-sg-day');
  if (day) {
    day.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-sg-day-act="off"]')) gmTakeDayOffFlow(); });
    day.addEventListener('focusin', (e) => { if (e.target && e.target.id === 'sg-day-note') gmFieldIn(e.target); });
    day.addEventListener('focusout', (e) => { if (e.target && e.target.id === 'sg-day-note') gmDayNoteBlur(); });
  }
  if (typeof wireGameSheet === 'function') wireGameSheet();
}

// ── the sheet's fields, as the classic editor's own rules read them (validateGameDraft / saveGameDraft) ──
// Each parser takes what was typed and returns { ok: true, value } (`value` undefined removes the field) or { ok: false, error }
// in words. Nothing is written for a field in error: it keeps aria-invalid and its message, everything else is saved.
function gmParseSteps(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: true, value: undefined };
  const tokens = t.split(',').map((x) => x.trim());
  if (tokens.some((x) => !x || !isFinite(Number(x)) || isNaN(parseFloat(x)) || parseFloat(x) <= 0)) return { ok: false, error: 'Counter buttons must be numbers above zero, like 1, 5.' };
  return { ok: true, value: tokens.map((x) => parseFloat(x)) };
}
// The countdown: minutes typed, seconds saved; rounds a whole number from 2 up (blank = one go). `on: false` removes it.
function gmParseTimer(label, presets, rounds) {
  const tokens = String(presets || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!tokens.length || tokens.some((x) => isNaN(parseFloat(x)) || parseFloat(x) <= 0)) return { ok: false, error: 'Timer lengths must be numbers of minutes, like 5, 3.' };
  const r = String(rounds || '').trim();
  if (r && (!/^\d+$/.test(r) || parseInt(r, 10) < 1)) return { ok: false, error: 'Rounds must be a whole number like 4, or blank for one go.' };
  const out = { label: String(label || '').trim().slice(0, 30), presets: tokens.map((x) => Math.round(parseFloat(x) * 60)) };
  if (parseInt(r, 10) > 1) out.rounds = parseInt(r, 10);
  return { ok: true, value: out };
}
// The live match scoreboard. Keys the sheet doesn't show (Kickball's sideLabel) ride along untouched.
function gmParseTracker(prev, unit, period, periods, outs) {
  const innings = String(periods == null ? '' : periods).trim();
  if (innings && (!/^\d+$/.test(innings) || parseInt(innings, 10) < 1)) return { ok: false, error: 'Periods must be a whole number, like 1 or 2.' };
  const o = String(outs == null ? '' : outs).trim();
  if (o && !/^\d+$/.test(o)) return { ok: false, error: 'Outs per side must be 0 or a whole number.' };
  const out = Object.assign({}, prev && typeof prev === 'object' ? prev : {});
  out.unit = String(unit || '').trim().slice(0, 30) || 'Points';
  out.periodLabel = String(period || '').trim().slice(0, 20) || 'Round';
  out.innings = Math.max(1, parseInt(innings, 10) || 1);
  out.outs = Math.max(0, parseInt(o, 10) || 0);
  return { ok: true, value: out };
}
// Drawing prompts: one per line. Only one game a week can have them (the drawing round is keyed by team, not by game).
function gmParsePrompts(text, gid) {
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return { ok: true, value: undefined };
  const other = allGames().find((g) => g.id !== gid && Array.isArray(g.prompts) && g.prompts.length);
  if (other) return { ok: false, error: 'Only one game can have drawing prompts — take them off “' + other.name + '” first.' };
  return { ok: true, value: lines };
}
// How to play: sections of a heading and points, one per line; a section with neither is dropped.
function gmRulesFrom(rows) {
  return (rows || []).map((r) => ({ h: String(r.h || '').trim().slice(0, 60), items: String(r.items || '').split('\n').map((x) => x.trim()).filter(Boolean) })).filter((r) => r.h || r.items.length);
}
// The one-line summary of a folded section ("Double points · Timer"; "None yet").
function gmExtrasSummary(g) {
  const bits = [];
  if (g.messtival === true) bits.push('Double points');
  if (g.timer) bits.push('Timer');
  if (Array.isArray(g.prompts) && g.prompts.length) bits.push('Drawing prompts');
  return bits.join(' · ') || 'None yet';
}
function gmHowtoSummary(g) {
  const n = Array.isArray(g.rules) ? g.rules.length : 0;
  return n ? hubPlural(n, 'section', 'sections') : (String(g.headline || '').trim() ? 'One line' : 'Not written yet');
}
// The scoring sentence under "Bracket" and the rule under "By the standings", per camp (the pairs are never named: no place is
// said in setup).
function gmBracketSub() {
  return teamIds().length === 4 ? '2 semifinals, then the 3rd-place match, then the final' : 'Teams play head-to-head; winners move on';
}
function gmStandingsRule() {
  const n = teamIds().length;
  const ord = (i) => i + (i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th');
  const pairs = [];
  for (let i = 1; i <= Math.floor(n / 2); i++) pairs.push(ord(i) + ' v ' + ord(n + 1 - i));
  return 'Suggests ' + (pairs.length > 1 ? pairs.slice(0, -1).join(', ') + ' and ' + pairs[pairs.length - 1] : pairs[0] || 'the pairs') + ' from the points';
}
function gmMatchName(i) { return teamIds().length === 4 ? 'Semifinal ' + (i + 1) : 'Match ' + (i + 1); }

// ── the game sheet (#sheet-game): one sheet for a new game, an existing one and the ⚡ quick game ──
// PROGRESSIVE (the overlay's data-stage; the CSS shows what is due): name → how is it scored? → the game exists. Nothing is written
// before the game has a name AND a way of being scored; at that moment it is created whole (gmCreateGame) and from then on every
// field saves as it changes — on blur / Enter for text, on tap for the rest — one field at a time through gmCommit. There is no Save.
// The inputs hold what is typed (their markup is static: a value is set only while the field is not focused, so a colleague's
// snapshot never takes a word away mid-typing and a re-render never rebuilds a focused field). Two panes (data-pane): the form and
// When (the rain plan's move picker). A game deleted elsewhere while the sheet is open asks inline (#gm-gone), never silently.
//   gmUi.open = { mode: 'new' | 'edit' | 'quick', pane: 'form' | 'when', gid (null until created), dk, bid, session, minutes,
//     form: { name, emoji, location, format, messtival }, made (just created: "Added to …"), err: { field: message }, formatOpen,
//     seedUi ('fixed' while the pairs board is open), order (the board's teams in tap order), emojiOpen, when: { dk, all, newDay,
//     double }, whenOnly (opened on When from "Put on the schedule": it closes instead of going back), gone, last (the game as last
//     seen, for "Put it back"), blank (empty How-to-play sections added and not yet written), stageSeen }

const GM_EMOJI = [['🏅', 'Medal'], ['🛡️', 'Shield'], ['🎯', 'Target'], ['⚽', 'Soccer'], ['🏀', 'Basketball'], ['🏐', 'Volleyball'], ['🎳', 'Bowling'], ['🪁', 'Kite'],
  ['🏹', 'Archery'], ['🪢', 'Rope'], ['🎲', 'Dice'], ['🏊', 'Swim'], ['🚣', 'Boat'], ['🏃', 'Run'], ['🎨', 'Art'], ['🎪', 'Circus'],
  ['🎃', 'Pumpkin'], ['🍂', 'Leaves'], ['🏆', 'Trophy'], ['🧩', 'Puzzle'], ['🎈', 'Balloon'], ['💦', 'Splash'], ['🏁', 'Finish'], ['🏕️', 'Camp']];
// What a field in error is called in the dock's sentence ("Fix the counter buttons to save them").
const GM_ERR_WORDS = { name: ['the name', 'it'], steps: ['the counter buttons', 'them'], tracker: ['the scoreboard', 'it'], timer: ['the timer', 'it'], prompts: ['the drawing prompts', 'them'] };

function gmClone(v) { return JSON.parse(JSON.stringify(v)); }
function gmSheetState(o) {
  return Object.assign({
    mode: 'new', pane: 'form', gid: null, dk: '', bid: '', session: '', minutes: null,
    form: { name: '', emoji: '', location: '', format: '', messtival: false }, whereAuto: false,
    made: false, err: {}, formatOpen: false, seedUi: '', order: null, emojiOpen: false, when: null, whenOnly: false,
    gone: null, last: null, blank: 0, stageSeen: '', paneSeen: 'form',
  }, o);
}

// ── opening ──
// "Add a game here" / "Add a game to Wednesday": a new game on an item (or a session, with the original schedule); with none
// named the day's first Games item. Where starts as the last-used place on that item.
function gmOpenNew(o) {
  if (!canEdit() || configLocked()) return false;
  const dk = SETUP_DK.indexOf(o && o.dk) !== -1 ? o.dk : gmDayKey();
  if (!gmIsGamesDay(dk)) { setupSay('Make ' + SETUP_DAY_WORDS[dk] + ' a games day first.'); return false; }
  const t = String(o && o.target || '');
  let bid = '';
  let session = '';
  if (t.indexOf('session:') === 0) session = t.slice(8);
  else if (t) bid = t;
  else if (scheduleIsShared()) { const first = planForDow(gmDow(dk)).find((b) => b.type === 'games' && !b.noTime); bid = first ? first.id : ''; }
  const where = gmDefaultWhere(dk, bid);
  gmUi.open = gmSheetState({ mode: 'new', dk, bid, session, form: { name: '', emoji: '', location: where, format: '', messtival: false }, whereAuto: !!where });
  gmShowFresh(o && o.opener);
  return true;
}

// An existing game (its row), or straight on When ("Put on the schedule").
function gmOpenGame(gid, o) {
  if (!canEdit()) return false;
  const g = gameById(gid);
  if (!g) return false;
  const pane = o && o.pane === 'when' ? 'when' : 'form';
  const st = gmSheetState({ mode: 'edit', gid, dk: gmDkOfDayId(g.dayId), last: gmClone(g), pane, whenOnly: pane === 'when' });
  if (pane === 'when') st.when = { dk: st.dk || gmDayKey(), all: false, newDay: '', double: null };
  gmUi.open = st;
  gmShowFresh(o && o.opener);
  return true;
}

// ⚡ Quick game: Podium already picked, so naming it is the one step; it lands on the Games item under way now or next (or off the
// schedule), counting double inside the double-points window.
function gmOpenQuick(opener) {
  if (!canEdit() || configLocked()) return false;
  const t = gmQuickTarget();
  if (!t) { setupSay('Make a games day first (Set up the week → Games).'); return false; }
  const where = gmDefaultWhere(t.dk, t.bid);
  const dbl = typeof inDoubleBonusWindow === 'function' && inDoubleBonusWindow();
  gmUi.open = gmSheetState({ mode: 'quick', dk: t.dk, bid: t.bid, minutes: t.minutes, form: { name: '', emoji: '', location: where, format: 'placement', messtival: !!dbl }, whereAuto: !!where });
  gmShowFresh(opener);
  return true;
}

// ONE sheet serves every game, so a game it takes starts afresh: at its top (the sheet kept the last game's scroll, and the next
// game opened 600px down its form with its name out of view), with Extras and How to play folded (the static <details> kept the
// last game's open ones), and with the large-text layout decided again (a data-flow left over from the last open kept the whole
// sheet scrolling at normal text, its dock below the screen). The flag goes BEFORE the sheet is painted (the paint decides it
// again); the scroll is reset AFTER it is shown (a hidden box has no scroll position to set).
function gmFreshSheet() {
  const sheet = document.querySelector('#sheet-game .sheet');
  if (sheet && typeof sheet.removeAttribute === 'function') sheet.removeAttribute('data-flow');
  Array.prototype.forEach.call(document.querySelectorAll('#sheet-game details[open]') || [], (d) => { d.open = false; });
  gmScrollTop();
}
function gmScrollTop() {
  const els = [document.querySelector('#sheet-game .sheet')].concat(Array.prototype.slice.call(document.querySelectorAll('#sheet-game .sheet-body') || []));
  els.forEach((el) => { if (el && el.scrollTop) el.scrollTop = 0; });
}
function gmShowFresh(opener) {
  gmFreshSheet();
  setupSheet('game', opener);
  gmScrollTop();
}

function gmSheetReady() { return !!gmUi.open; }
// A sheet closed by any route leaves its state behind; the next pass of the frame drops it (a Forward must not reopen a stale game).
function gmCleanSheets() { if (gmUi.open && !shell.sheets.includes('game')) gmUi.open = null; }
// shellSheetClose's hook (app.js): the state goes the moment the sheet closes, not at the next paint, which closing does not trigger —
// a Forward in between would reopen the sheet on a half-typed name. (After the opener took the focus back: a field blurred by that
// still saves.)
function setupSheetClosed(id) { if (id === 'game') gmUi.open = null; }
// Each text field's value when focus arrived. A field only writes when it was CHANGED while focused: the box shows what it showed on
// arrival, which a colleague's edit since may have made stale, so a bare tap in and out must never put the old words back over
// theirs (setupFocusIn / Out, §6.4.9, for this sheet's own fields). A field with no baseline (focus never reached it through the
// sheet) writes as it always did.
const gmFocusVal = new WeakMap();
const gmIsTextEl = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.id !== 'gm-emoji-other';
function gmFieldIn(t) { if (gmIsTextEl(t) && typeof t === 'object') gmFocusVal.set(t, String(t.value == null ? '' : t.value)); }
function gmFocusUntouched(t) {
  if (!t || typeof t !== 'object' || !gmFocusVal.has(t)) return false;
  const same = gmFocusVal.get(t) === String(t.value == null ? '' : t.value);
  gmFocusVal.delete(t);
  return same;
}
function gmFieldOut(t) { if (gmIsTextEl(t)) gmCommitText(t); }
// A field still being typed saves first (a blur commits it).
function gmFlush() {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  if (gmUi.open && a && a.closest && a.closest('#sheet-game') && typeof a.blur === 'function') { try { a.blur(); } catch (e) { /* fine */ } }
}
// Escape, Back and ✕ reach the sheet's close through here: a field still being typed saves first (nothing else is at stake — every
// change has already been written). Never asks. Closing NEVER creates: a name typed for a game that doesn't exist yet is dropped
// (a quick game has its way of scoring already, so its name alone would otherwise make a real game that counselors then see, on a
// close nobody meant as "Add").
function gmGuardClose() {
  gmUi.closing = true;
  try { gmFlush(); } finally { gmUi.closing = false; }
  return false;
}
// A new game with a name typed and nothing saved yet holds the deploy's auto-reload (it lives in memory only); once created, every
// change is in the config engine and its own accounting.
function gmBusy() {
  const o = gmUi.open;
  return !!(o && !o.gid && o.form.name.trim() && shell.sheets.includes('game'));
}

// ── what the sheet says ──
function gmSrc(o) { return (o.gid && gameById(o.gid)) || o.last || null; }
function gmFormatOf(o) { const g = gmSrc(o); return g ? g.format : o.form.format; }
function gmStageOf(o) { return o.gid ? 'game' : (o.form.name.trim() || o.mode === 'quick') ? 'format' : 'name'; }

// "Tuesday · Team competitions, 10:00–11:45 AM" · "Tuesday · Morning games" · "Wednesday · Not on the schedule" (the gold "!").
function gmWhenInfo(o) {
  const g = gmSrc(o);
  const dk = (g && gmDkOfDayId(g.dayId)) || o.dk;
  // One word for the day, before and after the game exists (a quick game said "Today" until it was named, then "Wednesday").
  const word = SETUP_DAY_WORDS[dk] || 'This week';
  if (scheduleIsShared()) {
    const bid = g ? g.blockId : o.bid;
    const blk = typeof bid === 'string' && bid ? gmBlock(dk, bid) : null;
    if (blk) return { text: word + ' · ' + (blk.base || blk.label) + (blk.noTime ? '' : ', ' + gmNoBreak(setupRange(blk.start, blk.end))), warn: false, btn: 'Change', item: blk.base || blk.label };
    return { text: word + ' · Not on the schedule', warn: true, btn: 'Put it on the schedule', item: '' };
  }
  // The printed week: the session it is (or will be) in — a new game's is the one the clock says for a quick game, else the one named.
  const place = g ? null : gmPlacement(dk, '', { session: o.session, minutes: o.mode === 'quick' ? o.minutes : null });
  const sess = g ? g.session : (place ? place.session : (o.session || gmSessions()[0]));
  return { text: word + (sess ? ' · ' + sess + ' games' : ''), warn: false, btn: 'Change', item: sess ? sess + ' games' : '' };
}
// A run sheet's time range never breaks across lines ("10:00–11:45 / AM" at 360px): no-break spaces, and word joiners round the dash.
function gmNoBreak(range) { return String(range).replace(/ /g, GM_NBSP).replace(/–/g, '\u2060–\u2060'); }

// The line in the dock: idle · saved · saving · offline · error (a field in error is named; everything else was saved).
function gmDockState(o) {
  const errs = Object.keys(o.err || {}).filter((k) => o.err[k]);
  if (errs.length) { const w = GM_ERR_WORDS[errs[0]] || ['it', 'it']; return { tone: 'error', text: 'Fix ' + w[0] + ' to save ' + w[1] }; }
  const line = typeof setupUiSyncLine === 'function' ? setupUiSyncLine() : { tone: 'saved' };
  if (line.tone === 'offline') return { tone: 'offline', text: 'Saved on this phone · it sends when you’re back online' };
  if (line.tone === 'error') return { tone: 'error', text: 'Couldn’t save — see the bar at the top' };
  if (line.tone === 'saving') return { tone: 'saving', text: 'Saving…' };
  // Just created: where it went, the ITEM only (the day and time are right under the title). An existing game says nothing has
  // been saved until something has ("✓ Saved" on opening read as if a tap had already done something).
  if (o.made) { const w = gmWhenInfo(o); return { tone: 'saved', text: w.item ? 'Added to ' + w.item : 'Added to ' + (SETUP_DAY_WORDS[o.dk] || 'the week') + ', not on the schedule' }; }
  return o.saved ? { tone: 'saved', text: 'Saved' } : { tone: 'idle', text: 'Changes save as you go' };
}
// What the dashed well before the game exists says (and, tapped, takes the director to).
function gmWaitInfo(o) {
  if (!o.form.name.trim()) return { text: 'Type the game’s name first', to: 'gm-name' };
  return { text: 'Pick how it’s scored ↑', to: 'gm-format' };
}

// The game's current choice of Matchups as the radios show it: what the director tapped, else what is saved.
function gmSeedUi(o) {
  const g = gmSrc(o);
  return o.seedUi || (g ? gmSeedOf(g) : 'standings');
}
function gmBoardOrder(o) {
  if (Array.isArray(o.order)) return o.order;
  const g = gmSrc(o);
  return g && gmPairsValid(g.roundOneMatchups) ? [].concat.apply([], g.roundOneMatchups) : [];
}

// ── paint ──
function gmSetData(el, name, v) { if (el && el.dataset && el.dataset[name] !== v) { if (v === '' || v == null) delete el.dataset[name]; else el.dataset[name] = v; } }
function gmSetValue(el, v) { if (el && document.activeElement !== el && el.value !== v) el.value = v; }
function gmSetSwitch(id, on) {
  const sw = setupEl(id);
  if (sw && typeof sw.hasAttribute === 'function' && sw.hasAttribute('checked') !== !!on) sw.toggleAttribute('checked', !!on);
  paintSwitchWord(id, !!on);
}
function gmSetInvalid(el, bad) {
  if (!el || typeof el.setAttribute !== 'function') return;
  if (bad) el.setAttribute('aria-invalid', 'true'); else if (el.getAttribute('aria-invalid')) el.removeAttribute('aria-invalid');
}
function gmSetError(id, msg) {
  setTextIfChanged(setupEl(id), msg || '');
  setHiddenIfChanged(setupEl(id), !msg);
}

function gmBoardHtml(order) {
  const slot = (tid, i) => (tid
    ? '<span class="gm-slot" data-team="' + esc(tid) + '" style="' + teamAccentVars(tid) + '">' + teamMarkHtml(tid, { size: 22 }) + '<b>' + esc(teamShort(tid) || tid) + '</b></span>'
    : i === order.length ? '<span class="gm-slot" data-next>Next</span>' : '<span class="gm-slot"></span>');
  return gmPairsBoard(order).map((p, m) => '<li class="gm-match" data-match="' + m + '"><span class="gm-match-n">' + esc(gmMatchName(m)) + '</span>' + slot(p[0], m * 2) + '<span class="gm-vs" aria-hidden="true">v</span>' + slot(p[1], m * 2 + 1) + '</li>').join('');
}
function gmKeysHtml(order) {
  return teamIds().map((tid) => {
    const at = order.indexOf(tid);
    const where = at === -1 ? '' : gmMatchName(Math.floor(at / 2));
    const nm = teamShort(tid) || tid;
    return '<button type="button" class="gm-key" data-team="' + esc(tid) + '" style="' + teamAccentVars(tid) + '" aria-pressed="' + (at !== -1) + '" aria-label="' + esc(nm + (where ? ', in ' + where + '. Tap to take them out' : '')) + '">' +
      '<span class="gm-key-mark">' + teamMarkHtml(tid, { size: 28 }) + '</span><span class="gm-key-nm">' + esc(nm) + '</span><small class="gm-key-in">' + esc(where) + '</small></button>';
  }).join('');
}
// The How-to-play sections: STATIC markup (no value attribute) so a snapshot or a save never rebuilds a row under a focused field;
// the words are set as properties when the field is not focused. Rebuilt only when the number of sections changes.
function gmRuleRowsHtml(n) {
  let h = '';
  for (let i = 0; i < n; i++) {
    h += '<div class="gm-rule" data-key="r-' + i + '"><input type="text" class="fld-input gm-rule-h" data-gm-rule-h="' + i + '" maxlength="60" placeholder="Heading, like Setup" aria-label="Section ' + (i + 1) + ' heading">' +
      '<textarea class="fld-input gm-rule-items gm-grow" data-gm-rule-items="' + i + '" rows="3" placeholder="One point per line" aria-label="Section ' + (i + 1) + ', one point per line"></textarea>' +
      '<div class="gm-rule-acts">' + (i ? '<button type="button" class="btn-quiet" data-gm-rule-up="' + i + '">Move up</button>' : '') + '<button type="button" class="btn-quiet btn-quiet-danger" data-gm-rule-remove="' + i + '">Remove</button></div></div>';
  }
  return h;
}

function renderGameSheet() {
  const o = gmUi.open;
  const overlay = setupEl('sheet-game');
  if (!o || !overlay) return;
  let g = o.gid ? gameById(o.gid) : null;
  if (o.gid && !g && !o.gone) o.gone = { at: Date.now() };
  if (g) { o.last = gmClone(g); if (o.gone) o.gone = null; }
  const src = g || o.last;
  const stage = gmStageOf(o);
  const format = src ? src.format : o.form.format;
  const lost = !!o.gone;
  // The game's own options unfold the moment it exists, and the sheet grows: its top edge is measured before and glides up from
  // where it was after (a FLIP), so nothing jumps under the director's thumb.
  const sheet = typeof overlay.querySelector === 'function' ? overlay.querySelector('.sheet') : null;
  const top0 = o.pane === 'form' && o.stageSeen && o.stageSeen !== stage && stage === 'game' ? gmTopOf(sheet) : null;
  gmSetData(overlay, 'mode', o.mode);
  gmSetData(overlay, 'pane', o.pane);
  gmSetData(overlay, 'stage', stage);
  gmSetData(overlay, 'format', format || '');
  setTextIfChanged(setupEl('sheet-game-title'), o.pane === 'when' ? 'When' : o.mode === 'new' ? 'New game' : o.mode === 'quick' ? 'Quick game' : 'Edit game');
  // On When the back already names the game ("‹ Capture the Flag"): the title "When" is then for the screen reader only, so the
  // two never fight over the ✕ (the rain sheet's data-title-quiet).
  const quiet = o.pane === 'when' && !o.whenOnly;
  if (typeof overlay.toggleAttribute === 'function' && overlay.hasAttribute('data-title-quiet') !== quiet) overlay.toggleAttribute('data-title-quiet', quiet);
  if (o.pane === 'when') { renderGmWhen(o, g); } else { renderGmForm(o, g, src, stage, format, lost); }
  // The pane that came in arrives from its side (forward from the right, Back from the left); calm: a fade.
  if (o.paneSeen !== o.pane) {
    const pane = document.querySelector('#sheet-game [data-gm-pane="' + o.pane + '"]');
    if (o.paneSeen) setupPaneArrive(pane, o.pane === 'form');
    o.paneSeen = o.pane;
  }
  gmFitSheet();
  if (top0 != null) gmGlideEdge(sheet, top0);
}

function gmTopOf(el) { return el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().top : null; }
// The FLIP: the grown sheet starts where its top edge was and glides up to its new height (glide: no overshoot, so it never rises
// past where it ends). Calm: no movement (the unfolding sections fade in).
function gmGlideEdge(sheet, top0) {
  const top1 = gmTopOf(sheet);
  if (typeof JellyMotion === 'undefined' || top1 == null) return;
  const dy = top0 - top1;
  if (!(Math.abs(dy) > 2)) return;
  JellyMotion.play(sheet, 'glide', (x) => ({ transform: 'translateY(' + dy * (1 - x) + 'px)' }), { calm: false });
}

function renderGmForm(o, g, src, stage, format, lost) {
  const form = o.form;
  setHiddenIfChanged(setupEl('gm-pane-back'), true);
  const w = gmWhenInfo(o);
  setTextIfChanged(setupEl('gm-when-text'), w.text);
  setTextIfChanged(setupEl('gm-when-btn'), w.btn);
  const whenLine = setupEl('gm-when');
  if (whenLine && typeof whenLine.toggleAttribute === 'function') { if (w.warn !== whenLine.hasAttribute('data-warn')) whenLine.toggleAttribute('data-warn', w.warn); }
  // The deleted-elsewhere question.
  setHiddenIfChanged(setupEl('gm-gone'), !lost);
  if (lost) setTextIfChanged(setupEl('gm-gone-text'), 'This game was deleted on another phone' + (o.gone.at ? ' ' + hubAgo(o.gone.at, Date.now()) : '') + '.');
  // 1 · name, emoji, where
  gmSetValue(setupEl('gm-name'), src ? String(src.name || '') : form.name);
  setTextIfChanged(setupEl('gm-emoji-now'), safeEmoji(src ? src.emoji : form.emoji, '') || '🏅');
  const eb = setupEl('gm-emoji-btn');
  if (eb && eb.getAttribute('aria-expanded') !== String(!!o.emojiOpen)) eb.setAttribute('aria-expanded', String(!!o.emojiOpen));
  setHiddenIfChanged(setupEl('gm-emoji'), !o.emojiOpen);
  const grid = setupEl('gm-emoji-grid');
  const cur = safeEmoji(src ? src.emoji : form.emoji, '');
  if (grid) setHtmlIfChanged(grid, GM_EMOJI.map((e) => '<button type="button" class="si-emo" data-emoji="' + e[0] + '" aria-pressed="' + (e[0] === cur) + '" aria-label="' + esc(e[1]) + '">' + e[0] + '</button>').join(''));
  gmSetValue(setupEl('gm-where'), src ? String(src.location || '') : form.location);
  setTextIfChanged(setupEl('gm-where-hint'), !src && o.whereAuto && form.location ? 'Where the last game here was' : '');
  gmSetError('gm-name-error', o.err.name || '');
  gmSetInvalid(setupEl('gm-name'), !!o.err.name);
  // 2 · How is it scored?
  const fmt = setupEl('gm-format');
  const collapsed = !!o.gid && !o.formatOpen;
  if (fmt && typeof fmt.toggleAttribute === 'function' && fmt.hasAttribute('data-collapsed') !== collapsed) fmt.toggleAttribute('data-collapsed', collapsed);
  document.querySelectorAll('#gm-format [data-gm-format]').forEach((b) => { const on = b.dataset.gmFormat === format; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
  setTextIfChanged(document.querySelector('[data-gm-fmt-sub="tournament"]'), gmBracketSub());
  const going = o.gid ? gmGoingWords(o.gid) : '';
  const warnOn = !!o.gid && !!going && o.formatOpen;
  setHiddenIfChanged(setupEl('gm-format-warn'), !warnOn);
  if (warnOn) setTextIfChanged(setupEl('gm-format-warn-text'), 'This game has ' + going + '. Scoring it another way clears ' + (/,| and /.test(going) ? 'them' : 'it') + '.');
  // 3 · the format's own options
  if (stage === 'game' && src) renderGmOptions(o, g, src, format);
  // dock
  setHiddenIfChanged(setupEl('gm-wait'), stage === 'game');
  const wait = gmWaitInfo(o);
  setTextIfChanged(setupEl('gm-wait-text'), wait.text);
  const dock = gmDockState(o);
  const st = setupEl('gm-state');
  gmSetData(st, 'tone', dock.tone);
  const was = st ? st.textContent : '';
  setTextIfChanged(setupEl('gm-state-text'), dock.text);
  setHiddenIfChanged(st, stage !== 'game');
  setHiddenIfChanged(setupEl('gm-acts'), stage !== 'game');
  setHiddenIfChanged(setupEl('gm-score'), !(o.mode === 'quick' && o.gid && !lost));
  if (stage === 'game' && was && was !== dock.text && dock.tone === 'saved' && st) secSnap(st);
  // The game's own options unfold once it exists (calm: a fade); the first paint of a sheet does not. "How is it scored?" is drawn
  // from the first paint, so naming the game moves nothing.
  if (o.stageSeen !== stage) {
    if (o.stageSeen && stage === 'game') gmArrive(document.querySelectorAll('#sheet-game [data-gm-step="game"]'));
    o.stageSeen = stage;
  }
}

// The sections that arrive as the sheet grows unfold from their top (§9.5 "panel appears": scaleY .6 → 1, the overshoot spent as a
// landing squash), while the sheet's edge glides (gmGlideEdge). Only what is drawn moves.
function gmArrive(list) {
  if (typeof JellyMotion === 'undefined' || !list) return;
  Array.prototype.forEach.call(list, (n) => {
    if (n && n.getClientRects && !n.getClientRects().length) return;
    JellyMotion.play(n, 'arrive', (x) => {
      const o = Math.max(0, x - 1);
      return { transform: 'scale(' + (1 + 0.12 * o) + ', ' + (0.6 + 0.4 * Math.min(1, x)) * (1 - 0.3 * o) + ')', transformOrigin: '50% 0', opacity: Math.min(1, x * 1.6) };
    }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 160 });
  });
}

function renderGmOptions(o, g, src, format) {
  // Bracket: Matchups and the live scoreboard
  if (format === 'tournament') {
    const seed = gmSeedUi(o);
    document.querySelectorAll('#gm-seed [data-gm-seed]').forEach((b) => { const on = b.dataset.gmSeed === seed; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
    setTextIfChanged(setupEl('gm-seed-standings-sub'), gmStandingsRule());
    setHiddenIfChanged(setupEl('gm-pairs'), seed !== 'fixed');
    if (seed === 'fixed') {
      const order = gmBoardOrder(o);
      setHtmlIfChanged(setupEl('gm-matches'), gmBoardHtml(order));
      const keys = setupEl('gm-keys');
      if (keys) { gmSetData(keys, 'n', String(teamIds().length)); setHtmlIfChanged(keys, gmKeysHtml(order)); }
      const left = teamIds().length - order.length;
      setHiddenIfChanged(setupEl('gm-pairs-left'), !left);
      setTextIfChanged(setupEl('gm-pairs-left'), left ? 'Pick ' + hubPlural(left, 'more team', 'more teams') + '. Until then it plays as “Pick them when you start”.' : '');
    }
    const ladder = !!src.ladderScoring;
    setHiddenIfChanged(setupEl('gm-ladder'), !ladder);
    setHiddenIfChanged(setupEl('gm-tracker-box'), ladder);
    if (ladder) setTextIfChanged(setupEl('gm-ladder-text'), 'This game has its own Ladder Ball scorer, first to exactly ' + (Number(src.ladderScoring.target) || 21) + ', with a live board for each match.');
    const t = src.liveTracker && typeof src.liveTracker === 'object' ? src.liveTracker : null;
    gmSetSwitch('gm-tracker', !!t);
    setHiddenIfChanged(setupEl('gm-tracker-fields'), !t);
    if (t) {
      gmSetValue(setupEl('gm-tr-unit'), String(t.unit || ''));
      gmSetValue(setupEl('gm-tr-period'), String(t.periodLabel || ''));
      gmSetValue(setupEl('gm-tr-periods'), t.innings == null ? '' : String(t.innings));
      gmSetValue(setupEl('gm-tr-outs'), t.outs == null ? '' : String(t.outs));
    }
    gmSetError('gm-tracker-error', o.err.tracker || '');
    const b4 = setupEl('gm-b4-note');
    // The note says so only while this many teams cannot be played as a bracket in the app (bracketPlayable: six or four).
    setHiddenIfChanged(b4, bracketPlayable(teamIds().length));
  }
  // Scores
  if (format === 'tally') {
    gmSetValue(setupEl('gm-unit'), String(src.unit || ''));
    gmSetSwitch('gm-lower', src.lowerWins === true);
    gmSetSwitch('gm-times', src.timeInput === true);
    gmSetSwitch('gm-live', src.liveRankings === true);
    const steps = Array.isArray(src.counterSteps) ? src.counterSteps : [];
    gmSetValue(setupEl('gm-steps'), steps.join(', '));
    gmSetError('gm-steps-error', o.err.steps || '');
    gmSetInvalid(setupEl('gm-steps'), !!o.err.steps);
    setHiddenIfChanged(setupEl('gm-negative-box'), !steps.length);
    gmSetSwitch('gm-negative', src.counterAllowNegative === true);
  }
  // Order inside its item
  const dk = gmDkOfDayId(src.dayId);
  const sibs = scheduleIsShared() && typeof src.blockId === 'string' && dk ? gmGamesOnBlock(dk, src.blockId) : [];
  const at = sibs.findIndex((x) => x.id === src.id);
  setHiddenIfChanged(setupEl('gm-order'), !(sibs.length > 1 && at > -1));
  if (sibs.length > 1 && at > -1) {
    const blk = gmBlock(dk, src.blockId);
    setTextIfChanged(setupEl('gm-order-label'), 'Order in ' + (blk ? (blk.base || blk.label) : 'this item'));
    const set = (dir, ok, sub) => {
      const b = document.querySelector('[data-gm-order="' + dir + '"]');
      if (b && b.getAttribute('aria-disabled') !== (ok ? 'false' : 'true')) b.setAttribute('aria-disabled', ok ? 'false' : 'true');
      setTextIfChanged(document.querySelector('[data-gm-order-sub="' + dir + '"]'), sub);
    };
    set('earlier', at > 0, at > 0 ? 'Before ' + sibs[at - 1].name : 'First');
    set('later', at < sibs.length - 1, at < sibs.length - 1 ? 'After ' + sibs[at + 1].name : 'Last');
  }
  // Extras
  gmSetSwitch('gm-double', src.messtival === true);
  const timer = src.timer && typeof src.timer === 'object' ? src.timer : null;
  gmSetSwitch('gm-timer', !!timer);
  setHiddenIfChanged(setupEl('gm-timer-fields'), !timer);
  if (timer) {
    gmSetValue(setupEl('gm-timer-label'), String(timer.label || ''));
    gmSetValue(setupEl('gm-timer-presets'), (Array.isArray(timer.presets) ? timer.presets : []).map((x) => Math.round(x / 6) / 10).join(', '));
    gmSetValue(setupEl('gm-timer-rounds'), timer.rounds ? String(timer.rounds) : '');
  }
  gmSetError('gm-timer-error', o.err.timer || '');
  gmSetValue(setupEl('gm-prompts'), Array.isArray(src.prompts) ? src.prompts.join('\n') : '');
  gmSetError('gm-prompts-error', o.err.prompts || '');
  setTextIfChanged(setupEl('gm-extras-sum'), gmExtrasSummary(src));
  // How to play
  setTextIfChanged(setupEl('gm-howto-sum'), gmHowtoSummary(src));
  gmSetValue(setupEl('gm-headline'), String(src.headline || ''));
  const rules = Array.isArray(src.rules) ? src.rules : [];
  const n = rules.length + (o.blank || 0);
  setHtmlIfChanged(setupEl('gm-rules'), gmRuleRowsHtml(n));
  const rows = document.querySelectorAll('#gm-rules .gm-rule');
  Array.prototype.forEach.call(rows, (row, i) => {
    const h = row.querySelector('.gm-rule-h');
    const it = row.querySelector('.gm-rule-items');
    const r = rules[i];
    gmSetValue(h, r ? String(r.h || '') : '');
    gmSetValue(it, r ? (Array.isArray(r.items) ? r.items.join('\n') : String(r.items || '')) : '');
    if (it) secGrow(it);
  });
  // Make a copy / Delete
  setHiddenIfChanged(setupEl('gm-foot'), !o.gid);
}

// When the pinned parts of the sheet (grab, head, When line, dock) take more than 45% of the height the sheet may GROW to (large
// text), the WHOLE sheet scrolls as one (the item sheet's rule): decided per open and only ever switched on while open, so the form
// never jumps mid-edit. Measured against the cap (90dvh), never the sheet's current height: a new game's sheet starts short, and
// against that every phone at normal text looked like large text and went on scrolling as one with its dock below the screen.
function gmFitSheet() {
  const o = gmUi.open;
  const sheet = document.querySelector('#sheet-game .sheet');
  if (!o || !sheet || !sheet.children || o.flow) return;
  const h = gmSheetCap(sheet);
  if (!h) return;
  let fixed = 0;
  Array.prototype.forEach.call(sheet.children, (c) => { if (!(c.classList && c.classList.contains('sheet-body'))) fixed += Number(c.offsetHeight) || 0; });
  if (fixed > h * 0.45) { o.flow = true; sheet.setAttribute('data-flow', ''); }
}
// The tallest the sheet may be (styles.css .sheet-tall: min(90dvh, the screen less 40px)), in px.
function gmSheetCap(sheet) {
  let cap = 0;
  try { cap = parseFloat(getComputedStyle(sheet).maxHeight) || 0; } catch (e) { /* no layout here */ }
  const vh = typeof window !== 'undefined' ? Number(window.innerHeight) || 0 : 0;
  if (!cap && vh) cap = Math.min(vh * 0.9, vh - 40);
  return cap || Number(sheet.clientHeight) || 0;
}

// ── the When pane ──
function gmWhenDays() { return SETUP_DK; }
// Rows: with the schedule edited here the day's items (Games items and items that already have games first, the rest behind
// "Other items on Thursday"); with the original one the day's sessions.
function gmWhenRows(o, g) {
  const w = o.when;
  const dow = gmDow(w.dk);
  const curDk = g ? gmDkOfDayId(g.dayId) : o.dk;
  if (!scheduleIsShared()) {
    const curSession = g ? g.session : (o.session || gmSessions()[0]);
    return { first: gmSessions().map((s) => ({ key: 'session:' + s, label: s + ' games', here: s === curSession && curDk === w.dk, n: gmGamesOnDay(w.dk).filter((x) => x.session === s).length })), rest: [] };
  }
  const cur = g ? g.blockId : (o.none ? '' : o.bid);
  const rows = planForDow(dow).filter((b) => !b.noTime).map((b) => ({ key: b.id, b, label: b.base || b.label, here: b.id === cur && curDk === w.dk, n: gmGamesOnBlock(w.dk, b.id).length }));
  return { first: rows.filter((r) => r.b.type === 'games' || r.n || r.here), rest: rows.filter((r) => !(r.b.type === 'games' || r.n || r.here)) };
}

function gmWhenRowHtml(r) {
  const time = r.b ? '<span class="cb-time">' + esc(schedClock(r.b.start, false)) + '<small>–' + esc(schedClockWords(r.b.end)) + '</small></span>' : '';
  const sub = (r.here ? 'Here now · ' : '') + (r.n ? hubPlural(r.n, 'game', 'games') : 'No games yet');
  return '<button type="button" class="cb-row gm-when-row' + (r.b ? '' : ' gm-when-session') + '" data-gm-block="' + esc(r.key) + '"' + (r.here ? ' aria-current="true"' : '') + '>' + time +
    '<span class="cb-main"><span class="cb-title">' + (r.b ? gmEmoHtml(r.b.emoji) : '') + '<span>' + esc(r.label) + '</span></span><span class="cb-sub">' + esc(sub) + '</span></span>' +
    '<span class="cb-end">' + (r.here ? '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>' : '<svg class="ico gl-chev" aria-hidden="true"><use href="#i-chev-r"/></svg>') + '</span></button>';
}

function renderGmWhen(o, g) {
  if (!o.when) o.when = { dk: o.dk || gmDayKey(), all: false, newDay: '', double: null };
  const w = o.when;
  const live = scheduleIsShared();
  const name = (g && g.name) || o.form.name.trim() || 'New game';
  setHiddenIfChanged(setupEl('gm-pane-back'), !!o.whenOnly);
  setTextIfChanged(setupEl('gm-pane-back-label'), name);
  const todayDk = SETUP_DK[campNow().dow];
  const wk = typeof campWeek === 'function' ? campWeek() : { phase: 'unset' };
  const strip = setupEl('gm-when-days');
  document.querySelectorAll('#gm-when-days [data-dk]').forEach((btn) => {
    const dk = btn.dataset.dk;
    const on = dk === w.dk;
    if (btn.getAttribute('aria-checked') !== String(on)) btn.setAttribute('aria-checked', String(on));
    const today = dk === todayDk && wk.phase === 'during';
    if (today !== btn.hasAttribute('data-today')) { if (today) btn.setAttribute('data-today', ''); else btn.removeAttribute('data-today'); }
    setTextIfChanged(btn.querySelector('.daypick-name'), today ? 'Today' : SETUP_DAY_WORDS[dk].slice(0, 3));
    const label = SETUP_DAY_WORDS[dk] + (today ? ', today' : '') + (gmIsGamesDay(dk) ? '' : ', not a games day');
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  });
  if (strip && strip.dataset.shown !== w.dk && strip.clientWidth > 0) { strip.dataset.shown = w.dk; stripRevealChip(strip, strip.querySelector('[aria-checked="true"]'), false); }
  paintStripOverflow(strip);
  const isDay = gmIsGamesDay(w.dk);
  const asking = !isDay && !!w.newDay;
  setHiddenIfChanged(setupEl('gm-when-newday'), !asking);
  if (asking) {
    setTextIfChanged(setupEl('gm-when-newday-text'), SETUP_DAY_WORDS[w.dk] + ' isn’t a games day yet. Putting a game on it makes it one.');
    setTextIfChanged(setupEl('gm-when-newday-yes'), 'Make ' + SETUP_DAY_WORDS[w.dk] + ' a games day');
  }
  const rows = isDay ? gmWhenRows(o, g) : { first: [], rest: [] };
  const shown = rows.first.concat(w.all ? rows.rest : []);
  setHtmlIfChanged(setupEl('gm-when-list'), shown.map(gmWhenRowHtml).join(''));
  setHiddenIfChanged(setupEl('gm-when-all'), !isDay || w.all || !rows.rest.length);
  setTextIfChanged(setupEl('gm-when-all-text'), w.dk === todayDk ? 'Other items today' : 'Other items on ' + SETUP_DAY_WORDS[w.dk]);
  setHiddenIfChanged(setupEl('gm-when-empty'), !(isDay && !shown.length));
  setHiddenIfChanged(setupEl('gm-when-double'), !w.double);
  if (w.double) setTextIfChanged(setupEl('gm-when-double-text'), w.double.label + ' is in double points time. Make ' + name + ' count double too?');
  // Not on the schedule: only where the schedule is edited here (the original one reads no links)
  const none = document.querySelector('#sheet-game .rain-move-off');
  setHiddenIfChanged(none, !live);
}

// ── what a tap or a blur does ──
// After an engine call: a write that landed repaints the frame (the screen behind the sheet follows), a game that was deleted
// meanwhile is noticed (the question appears), a refusal says nothing here (configLocked already toasted a loading list).
function gmAfter(r, o, quiet) {
  if (!r) return r;
  if (r.ok) { if (r.changed !== false) { if (!quiet) o.made = false; o.saved = true; renderAll(); } }
  else if (r.reason === 'gone') { if (!o.gone) o.gone = { at: Date.now() }; renderGameSheet(); }
  return r;
}

// The game is created the moment it has a name AND a way of being scored (name committed on blur / Enter, or a format tapped).
function gmTryCreate() {
  const o = gmUi.open;
  if (!o || o.gid || o.busy || gmUi.closing) return null;
  const f = o.form;
  if (!f.name.trim() || !GM_FORMAT_WORDS[f.format]) return null;
  const place = gmPlacement(o.dk, o.bid, { session: o.session, minutes: o.mode === 'quick' ? o.minutes : null });
  if (!place) { setupSay('Make ' + (SETUP_DAY_WORDS[o.dk] || 'that day') + ' a games day first.'); return null; }
  if (o.none) place.none = true;
  const r = gmCreateGame(f, place);
  if (!r.ok) { if (r.reason === 'name') { o.err.name = 'Give the game a name.'; renderGameSheet(); } return r; }
  o.gid = r.id;
  o.made = true;
  o.last = gmClone(gameById(r.id));
  renderAll();
  return r;
}

function gmNameBlur(v) {
  const o = gmUi.open;
  if (!o) return;
  if (!o.gid) { o.form.name = v; o.err.name = ''; renderGameSheet(); gmTryCreate(); return; }
  if (!v.trim()) { o.err.name = 'Give the game a name.'; renderGameSheet(); return; }
  o.err.name = '';
  gmAfter(gmRename(o.gid, v), o);
}

function gmSetEmoji(e) {
  const o = gmUi.open;
  if (!o || safeEmoji(e, '') !== e || !e) return;
  o.emojiOpen = false;
  if (!o.gid) { o.form.emoji = e; renderGameSheet(); return; }
  gmAfter(gmCommit(o.gid, { emoji: e }), o);
  renderGameSheet();
}

async function gmPickFormat(f) {
  const o = gmUi.open;
  if (!o || o.gone || !GM_FORMAT_WORDS[f]) return;
  // Before the game exists the three ways are there from the start (nothing jumps as a name is typed): one tapped first is kept,
  // and the name field, the one thing still missing, takes the focus.
  if (!o.gid) { o.form.format = f; renderGameSheet(); if (!gmTryCreate() && !o.form.name.trim()) gmWaitTap(); return; }
  const g = gameById(o.gid);
  if (!g) { gmAfter({ ok: false, reason: 'gone' }, o); return; }
  if (!o.formatOpen) { o.formatOpen = true; renderGameSheet(); return; } // folded: a tap opens all three
  if (g.format === f) { o.formatOpen = false; renderGameSheet(); return; }
  let r = gmChangeFormat(o.gid, f);
  if (r.reason === 'confirm') {
    const go = await askDialog({
      title: 'Score “' + g.name + '” another way?', body: ['This clears ' + r.going + '. It can’t be undone.'],
      actions: [{ label: 'Keep it as it is', value: 'no', cancel: true }, { label: 'Clear it and change', value: 'go', kind: 'danger' }],
    });
    if (go !== 'go' || gmUi.open !== o) return;
    r = gmChangeFormat(o.gid, f, { confirmed: true });
  }
  if (r.ok) { o.formatOpen = false; o.seedUi = ''; o.order = null; }
  gmAfter(r, o);
}

function gmPickSeed(mode) {
  const o = gmUi.open;
  if (!o || !o.gid || o.gone || GM_SEEDS.indexOf(mode) === -1) return;
  if (mode === 'fixed') { o.seedUi = 'fixed'; o.order = gmBoardOrder(o).slice(); }
  else { o.seedUi = ''; o.order = null; }
  gmAfter(gmSetSeed(o.gid, mode, o.order), o);
  renderGameSheet();
}

function gmBoardTap(tid) {
  const o = gmUi.open;
  if (!o || !o.gid || o.gone) return;
  o.seedUi = 'fixed';
  o.order = gmPairsTap(gmBoardOrder(o), tid);
  gmAfter(gmSetSeed(o.gid, 'fixed', o.order), o);
  renderGameSheet();
  // The keys are rewritten with the board (a placed team's key is dashed and says where): focus stays on the one that was tapped.
  const key = /^t\d+$/.test(tid) ? document.querySelector('#gm-keys .gm-key[data-team="' + tid + '"]') : null;
  if (key && typeof key.focus === 'function') { try { key.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

function gmOrderTap(dir) {
  const o = gmUi.open;
  if (!o || !o.gid || o.gone) return;
  gmAfter(gmOrderGame(o.gid, dir === 'earlier' ? -1 : 1), o);
}

// A switch was turned: one field, written now.
function gmSwitch(id, on) {
  const o = gmUi.open;
  if (!o || !o.gid || o.gone) return;
  const g = gameById(o.gid);
  if (!g) { gmAfter({ ok: false, reason: 'gone' }, o); return; }
  let patch = null;
  if (id === 'gm-lower') patch = { lowerWins: on ? true : undefined };
  else if (id === 'gm-times') patch = { timeInput: on ? true : undefined };
  else if (id === 'gm-live') patch = { liveRankings: on ? true : undefined };
  else if (id === 'gm-negative') patch = { counterAllowNegative: on ? true : undefined };
  else if (id === 'gm-double') patch = { messtival: on ? true : undefined };
  else if (id === 'gm-tracker') patch = { liveTracker: on ? (g.liveTracker || gmFormatDefaults('tournament', {}).liveTracker) : undefined };
  else if (id === 'gm-timer') patch = { timer: on ? (g.timer || { label: '', presets: [300] }) : undefined };
  if (!patch) return;
  if (id === 'gm-tracker') o.err.tracker = '';
  if (id === 'gm-timer') o.err.timer = '';
  gmAfter(gmCommit(o.gid, patch), o);
}

// A text field lost focus (or Enter): one field, written if it changed and passes the classic editor's own checks.
function gmCommitText(el) {
  const o = gmUi.open;
  if (!o || o.pane !== 'form' || !el) return;
  const id = el.id || '';
  const v = String(el.value == null ? '' : el.value);
  // A saved game's field that is still what it was on arrival writes nothing (see gmFocusVal). Before the game exists the typed text
  // only lands on the form, which is harmless.
  if (gmFocusUntouched(el) && o.gid) return;
  if (id === 'gm-name') { gmNameBlur(v); return; }
  if (id === 'gm-where') {
    if (!o.gid) { o.form.location = v; o.whereAuto = false; renderGameSheet(); return; }
    if (!o.gone) gmAfter(gmCommit(o.gid, { location: v.trim().slice(0, 60) }), o);
    return;
  }
  if (!o.gid || o.gone) return;
  const field = (name, r, key) => { // a parse result: an error stays on the field and nothing is written; a value is one commit
    if (!r.ok) { o.err[key] = r.error; renderGameSheet(); return; }
    o.err[key] = '';
    gmAfter(gmCommit(o.gid, { [name]: r.value }), o);
  };
  const g = gameById(o.gid);
  if (!g) { gmAfter({ ok: false, reason: 'gone' }, o); return; }
  const val = (i) => { const e2 = setupEl(i); return e2 && typeof e2.value === 'string' ? e2.value : ''; };
  if (id === 'gm-unit') gmAfter(gmCommit(o.gid, { unit: v.trim().slice(0, 30) || undefined }), o);
  else if (id === 'gm-steps') field('counterSteps', gmParseSteps(v), 'steps');
  else if (id === 'gm-headline') gmAfter(gmCommit(o.gid, { headline: v.replace(/\s+/g, ' ').trim().slice(0, 140) }), o);
  else if (id === 'gm-prompts') field('prompts', gmParsePrompts(v, o.gid), 'prompts');
  else if (/^gm-tr-/.test(id)) field('liveTracker', gmParseTracker(g.liveTracker, val('gm-tr-unit'), val('gm-tr-period'), val('gm-tr-periods'), val('gm-tr-outs')), 'tracker');
  else if (/^gm-timer-/.test(id)) field('timer', gmParseTimer(val('gm-timer-label'), val('gm-timer-presets'), val('gm-timer-rounds')), 'timer');
  else if (el.classList && (el.classList.contains('gm-rule-h') || el.classList.contains('gm-rule-items'))) gmCommitRules();
}

// How to play: every section as typed → the saved list (a section with neither heading nor points is dropped; a blank one added
// and not yet filled stays on the sheet).
function gmCommitRules() {
  const o = gmUi.open;
  if (!o || !o.gid || o.gone) return;
  const rows = Array.prototype.map.call(document.querySelectorAll('#gm-rules .gm-rule'), (row) => {
    const h = row.querySelector('.gm-rule-h');
    const it = row.querySelector('.gm-rule-items');
    return { h: h ? h.value : '', items: it ? it.value : '' };
  });
  const list = gmRulesFrom(rows);
  o.blank = Math.max(0, rows.length - list.length);
  gmAfter(gmCommit(o.gid, { rules: list.length ? list : undefined }), o);
  renderGameSheet();
}
function gmRuleMoveUp(i) {
  const o = gmUi.open;
  const g = o && o.gid ? gameById(o.gid) : null;
  if (!g || !Array.isArray(g.rules) || i < 1 || i >= g.rules.length) return;
  const list = gmClone(g.rules);
  const t = list[i]; list[i] = list[i - 1]; list[i - 1] = t;
  gmAfter(gmCommit(o.gid, { rules: list }), o);
}
function gmRuleRemove(i) {
  const o = gmUi.open;
  const g = o && o.gid ? gameById(o.gid) : null;
  if (!g) return;
  const list = Array.isArray(g.rules) ? gmClone(g.rules) : [];
  if (i < list.length) { list.splice(i, 1); gmAfter(gmCommit(o.gid, { rules: list.length ? list : undefined }), o); }
  else { o.blank = Math.max(0, (o.blank || 0) - 1); renderGameSheet(); }
}

// ── When ──
function gmShowWhen() {
  const o = gmUi.open;
  if (!o || o.gone) return;
  const g = o.gid ? gameById(o.gid) : null;
  o.when = { dk: (g && gmDkOfDayId(g.dayId)) || o.dk || gmDayKey(), all: false, newDay: '', double: null };
  o.pane = 'when';
  renderGameSheet();
}
function gmShowForm() {
  const o = gmUi.open;
  if (!o) return;
  if (o.whenOnly) { shellSheetClose('game'); return; }
  o.pane = 'form';
  o.when = null;
  renderGameSheet();
}
function gmWhenDay(dk) {
  const o = gmUi.open;
  if (!o || !o.when || SETUP_DK.indexOf(dk) === -1) return;
  o.when.dk = dk;
  o.when.all = false;
  o.when.double = null;
  o.when.newDay = gmIsGamesDay(dk) ? '' : dk;
  renderGameSheet();
}
function gmWhenNewDay(answer) {
  const o = gmUi.open;
  if (!o || !o.when) return;
  if (answer === 'yes') {
    const r = gmMakeDay(o.when.dk);
    if (r.ok) { o.when.newDay = ''; renderAll(); } else renderGameSheet();
    return;
  }
  const g = o.gid ? gameById(o.gid) : null;
  o.when.dk = (g && gmDkOfDayId(g.dayId)) || o.dk || SETUP_DK.find(gmIsGamesDay) || o.when.dk;
  o.when.newDay = '';
  renderGameSheet();
}
// A row of the When list: an item (or a session). A new game only remembers it; a saved one moves, asking first about double points.
function gmWhenPick(key, answer) {
  const o = gmUi.open;
  if (!o || !o.when || o.gone || !gmIsGamesDay(o.when.dk)) return;
  const w = o.when;
  const session = key.indexOf('session:') === 0 ? key.slice(8) : '';
  if (!o.gid) {
    o.dk = w.dk; o.bid = session ? '' : key; o.session = session; o.none = false; o.whereAuto = false;
    gmShowForm();
    return;
  }
  const r = gmMoveGame(o.gid, session ? { dk: w.dk, session } : { dk: w.dk, bid: key }, answer ? { double: answer } : undefined);
  if (r.reason === 'double') {
    const b = gmBlock(w.dk, key);
    w.double = { key, label: b ? (b.base || b.label) : 'That item' };
    renderGameSheet();
    return;
  }
  if (!r.ok) { if (r.reason === 'item') setupSay('That item isn’t on the schedule any more.'); gmAfter(r, o); return; }
  w.double = null;
  o.dk = w.dk;
  gmAfter(r, o);
  gmShowForm();
}
function gmWhenNone() {
  const o = gmUi.open;
  if (!o || o.gone) return;
  if (!o.gid) { o.bid = ''; o.none = true; gmShowForm(); return; }
  const r = gmMoveGame(o.gid, { none: true });
  gmAfter(r, o);
  if (r.ok) gmShowForm();
}

// ── the dock and the foot ──
function gmWaitTap() {
  const o = gmUi.open;
  if (!o) return;
  const w = gmWaitInfo(o);
  const el = setupEl(w.to);
  if (!el) return;
  if (typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* fine */ } }
  const focus = w.to === 'gm-format' ? document.querySelector('#gm-format [data-gm-format]') : el;
  if (focus && typeof focus.focus === 'function') { try { focus.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}
function gmScoreNow() {
  gmFlush();
  const o = gmUi.open;
  if (!o || !o.gid || !gameById(o.gid)) return;
  const gid = o.gid;
  shellSheetClose('game');
  if (builderOpen()) setupCloseBuilder();
  openGame(gid, { from: state.ui.tab === 'games' ? 'games' : undefined });
}
// A bracket waiting for a re-check: the builder closes and the game's takeover opens on its Re-check card (the same way Score now
// leaves the builder for the game).
function gmSettleBracket(gid) {
  if (!canEdit() || !gid || !gameById(gid)) return;
  if (builderOpen()) setupCloseBuilder();
  openGame(gid, { from: state.ui.tab === 'games' ? 'games' : undefined });
}
function gmCopyGo() {
  gmFlush();
  const o = gmUi.open;
  if (!o || !o.gid || o.gone) return;
  const r = gmDuplicate(o.gid);
  if (!r.ok) { gmAfter(r, o); return; }
  const g = gameById(r.id);
  gmUi.open = gmSheetState({ mode: 'edit', gid: r.id, dk: g ? gmDkOfDayId(g.dayId) : o.dk, last: g ? gmClone(g) : null, stageSeen: 'game' });
  gmFreshSheet();
  setupSay('Made a copy. Rename it when you like.');
  renderAll();
}
async function gmDeleteGo() {
  const o = gmUi.open;
  if (!o || !o.gid) return;
  const r = await gmDeleteGame(o.gid);
  if (r.ok) { shellSheetClose('game'); renderAll(); } else if (r.reason === 'gone') gmAfter(r, o);
}
// Deleted on another phone: put it back with what is on the sheet, or close.
function gmGoneAnswer(answer) {
  const o = gmUi.open;
  if (!o) return;
  if (answer === 'close') { shellSheetClose('game'); return; }
  if (!o.last || gameById(o.last.id)) { o.gone = null; renderAll(); return; }
  const rec = gmClone(o.last);
  const ok = configEdit('Put back “' + rec.name + '”', () => { if (gameById(rec.id)) return false; state.config.games.push(rec); return undefined; });
  if (ok !== false) { o.gone = null; saveState(); renderAll(); }
}

// ── wiring ──
function wireGameSheet() {
  const sheet = setupEl('sheet-game');
  if (!sheet) return;
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  // ✕ and the backdrop: a field still being typed saves first (Escape and Back reach the same through setupSheetGuardClose).
  sheet.addEventListener('click', (e) => { if (q(e, '[data-sheet-close]')) gmGuardClose(); }, true);
  // On a phone a press on ✕ or the backdrop takes the focus off the field BEFORE the click that closes the sheet, and that blur
  // would make a quick game from its half-typed name. The press itself says it is a close, so creation is held from the press until
  // a moment after it ends (the blur's own timing differs between mouse and touch).
  let closeHold = 0;
  const holdClose = (ms) => { clearTimeout(closeHold); closeHold = setTimeout(() => { gmUi.closing = false; }, ms); };
  sheet.addEventListener('pointerdown', (e) => { if (q(e, '[data-sheet-close]')) { gmUi.closing = true; holdClose(1500); } }, true);
  ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, () => { if (gmUi.closing) holdClose(700); }, true));
  sheet.addEventListener('click', (e) => {
    const o = gmUi.open;
    if (!o) return;
    let b;
    if (q(e, '#gm-pane-back')) gmShowForm();
    else if (q(e, '#gm-when-btn')) gmShowWhen();
    else if (q(e, '#gm-emoji-btn')) { o.emojiOpen = !o.emojiOpen; renderGameSheet(); }
    else if ((b = q(e, '.si-emo'))) gmSetEmoji(b.dataset.emoji);
    else if ((b = q(e, '[data-gm-format]'))) gmPickFormat(b.dataset.gmFormat);
    else if ((b = q(e, '[data-gm-seed]'))) gmPickSeed(b.dataset.gmSeed);
    else if ((b = q(e, '.gm-key[data-team]'))) gmBoardTap(b.dataset.team);
    else if ((b = q(e, '[data-gm-order]'))) { if (b.getAttribute('aria-disabled') !== 'true') gmOrderTap(b.dataset.gmOrder); }
    else if ((b = q(e, '.gm-when-row[data-gm-block]'))) gmWhenPick(b.dataset.gmBlock);
    else if ((b = q(e, '#gm-when-days [data-dk]'))) gmWhenDay(b.dataset.dk);
    else if ((b = q(e, '[data-gm-newday]'))) gmWhenNewDay(b.dataset.gmNewday);
    else if ((b = q(e, '[data-gm-double]'))) { if (o.when && o.when.double) gmWhenPick(o.when.double.key, b.dataset.gmDouble); }
    else if (q(e, '#gm-when-all')) { if (o.when) { o.when.all = true; renderGameSheet(); } }
    else if (q(e, '#gm-when-none')) gmWhenNone();
    else if (q(e, '#gm-wait')) gmWaitTap();
    else if (q(e, '#gm-done')) { gmFlush(); shellSheetClose('game'); }
    else if (q(e, '#gm-score')) gmScoreNow();
    else if (q(e, '#gm-copy')) gmCopyGo();
    else if (q(e, '#gm-delete')) gmDeleteGo();
    else if ((b = q(e, '[data-gm-gone]'))) gmGoneAnswer(b.dataset.gmGone);
    else if (q(e, '#gm-rule-add')) { o.blank = (o.blank || 0) + 1; renderGameSheet(); const rows = document.querySelectorAll('#gm-rules .gm-rule-h'); const last = rows[rows.length - 1]; if (last && last.focus) { try { last.focus(); } catch (x) { /* fine */ } } }
    else if ((b = q(e, '[data-gm-rule-up]'))) gmRuleMoveUp(Number(b.dataset.gmRuleUp));
    else if ((b = q(e, '[data-gm-rule-remove]'))) gmRuleRemove(Number(b.dataset.gmRuleRemove));
  });
  // Text: what is typed before the game exists is kept on the form (it creates nothing); after, a field is written when focus leaves it.
  sheet.addEventListener('focusin', (e) => gmFieldIn(e.target));
  sheet.addEventListener('focusout', (e) => gmFieldOut(e.target));
  sheet.addEventListener('input', (e) => {
    const o = gmUi.open;
    const t = e.target;
    if (!o || !t) return;
    if (t.id === 'gm-name' && !o.gid) { o.form.name = t.value; o.err.name = ''; renderGameSheet(); }
    else if (t.id === 'gm-where' && !o.gid) { o.form.location = t.value; o.whereAuto = false; }
    if (t.classList && t.classList.contains('gm-grow')) secGrow(t);
  });
  sheet.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t && t.tagName === 'INPUT' && t.type !== 'checkbox' && typeof t.blur === 'function') { e.preventDefault(); t.blur(); }
  });
  sheet.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'gm-emoji-other') { const v = String(t.value || '').trim(); if (v) { gmSetEmoji(v); t.value = ''; } return; }
    if (/^gm-(lower|times|live|negative|double|tracker|timer)$/.test(t.id || '')) gmSwitch(t.id, !!t.checked);
  });
}

// ════════════════════════════════════════════════════════════════════
// 17. THE NEW-YEAR SETUP (P2 §11.3, §7.3, §10.1, §11.16 — Step 28, build session 2)
// ════════════════════════════════════════════════════════════════════
// The screens of the wizard whose ENGINE is setup-sync.js §11 (claim, archive, clear, undo). OWNER ONLY: `setupScreen()` reads a
// stored `wizard` as the hub for anyone else, every handler asks isOwner() again, and every other director reads the hub door's
// sentence (ownerSays). The markup is index.html's `#setup-wizard` (hooks documented there); a renderer patches text, `hidden` and
// data-*, never rebuilds a control (the tally lists are the only setHtmlIfChanged roots). Nothing here writes to the database but
// through the engine's functions: wizardStart / wizardTakeOver / wizardSetStep / wizardAnswer / wizardArchive / wizardClear /
// wizardUndo, and setupRestartSection for Advanced.
//
//   mode  me     this device drives the claim (or has just finished: step 5 from the device's own `done` record)
//         watch  the owner's OTHER device drives and this one chose Watch: the step reads, nothing in it takes a tap
//         other  the same, before Watch: only the claim panel
// The step is the CLAIM's step (a reload resumes on it); the answers are the device draft (wizardAnswers()).

const NYW_STEPS = 5;
const NYW_WHY = {
  loading: 'Still loading the week setup. Try again in a moment.',
  denied: 'The new-year setup isn’t available yet: the database rules need updating first.',
  schema: 'This camp’s setup was made by a newer version. Reload the page first.',
  tab: 'This tab is view-only. Use the tab that is open for editing.',
  offline: 'This needs a connection. Nothing was changed.',
  refused: 'The database turned it away, so nothing was changed.',
  failed: 'That didn’t go through, so nothing was changed.',
  dates: 'Pick the Sunday camp starts first.',
  teams: 'The teams aren’t set up for a clear. Ask for the team slots to be repaired first.',
  archive: 'The last camp week isn’t saved and checked yet.',
  busy: 'Something on this phone hasn’t finished saving. Wait a moment and try again.',
  requests: 'Couldn’t read the people asking to join. Check your connection and try again.',
  'not-mine': 'Another device has taken over the setup.',
  gone: 'The setup was closed on another device.',
  other: 'Your other device is setting up the new year.',
  'camp-week': 'A camp week is running. The new-year setup waits for later.',
  save: 'Couldn’t save the last camp week, so nothing was cleared.',
  verify: 'The saved copy didn’t match, so nothing was cleared.',
  claim: 'Couldn’t record the saved copy. Try again.',
  step: 'That step doesn’t exist.',
};

const nywUi = {
  openNow: false, lastStep: 0, lastMode: '', watching: false,
  typed: '',                       // a date typed that is not a Sunday (never an answer)
  ask: null,                       // the one inline question: { q, list?, a: {label, run}, b: {label, run, danger?} }
  save: { state: 'idle', res: null, why: '' },   // step 3: idle | saving | saved | offline | error
  clear: { state: 'idle', why: '', reveal: false }, // step 4: idle | saving | offline | error
  members: null,                   // step 4's preflight read: { ok, withTeam, incomplete }
  membersAsked: false,
  done: null,                      // the clear's own answer (in memory: names of people it could not move)
  doneLeft: false,
  a1Ran: false,
  claim: null, claimAt: 0,         // the claim an acknowledged write handed back, until the tree catches up
  freeze: {},                      // { campRunning, overrideCampWeek }: what the owner answered
  undo: null,                      // the Undo sheet: { rid, row, offer, body, state, why, reveal, busy }
  staffOpen: false,
  shown: { rows: '' },
};

// ── pure helpers ─────────────────────────────────────────────────────

function newYearDue() {
  return typeof campWeek === 'function' && campWeek().phase === 'after';
}

function nywYmdParts(ymd) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? { t, dow: d.getUTCDay() } : null;
}

// The Sunday nearest a typed date ('' when it isn't a date at all): Mon–Wed go back, Thu–Sat forward.
function nywSundayNear(ymd) {
  const p = nywYmdParts(ymd);
  if (!p) return '';
  const back = p.dow <= 3 ? p.dow : p.dow - 7;
  return new Date(p.t - back * 86400000).toISOString().slice(0, 10);
}

function nywDayWords(ymd) {
  const p = nywYmdParts(ymd);
  return p ? new Date(p.t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
}

function nywClockWords(min) {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return ((h % 12) || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}

// "Thursday 5:00 PM until the end of Friday"
function nywDoubleWords(d) {
  if (!d || !wizardDoubleOk(d)) return '';
  const to = d.toMin === 0 ? 'the end of ' + WEEK_DOW_WORDS[(d.toDow + 6) % 7] : WEEK_DOW_WORDS[d.toDow % 7] + ' ' + nywClockWords(d.toMin);
  return WEEK_DOW_WORDS[d.fromDow] + ' ' + nywClockWords(d.fromMin) + ' until ' + to;
}

// What "Same as last year" is: the legacy week's printed window, else the week's own.
function nywLastDouble() {
  return wizardDoubleValue('same', { epoch: state.meta && state.meta.epoch, double: setupTree.meta && setupTree.meta.double });
}

// The two years the run names, from DATES only (never a score's timestamp or the clock: one stray score in the new year
// would otherwise make the run read "Save 2027 … Ready for 2027"): `next` is the chosen Sunday's year, else the year after
// the outgoing week; `out` is the outgoing week's year, else the year before `next`. After the clear (`done`) the camp's own
// week IS the new one. With no date anywhere both are '' and the words say "last year" / "the new year".
function nywYears(answers, opts) {
  const a = answers || wizardAnswers();
  const o = opts || {};
  const yr = (ymd) => (/^20\d\d-\d\d-\d\d$/.test(String(ymd || '')) ? String(ymd).slice(0, 4) : '');
  const cur = (typeof campWeek === 'function' && campWeek().start) || '';
  const chosen = a && a.weekStart ? a.weekStart : '';
  let next = yr(chosen) || (o.done ? yr(cur) : '');
  // The camp's week is the outgoing one until the clear writes the chosen Sunday over it.
  let out = !o.done && cur && cur !== chosen ? yr(cur) : '';
  if (!next && out) next = String(Number(out) + 1);
  if (!out && next) out = String(Number(next) - 1);
  return { out, next };
}

function nywNextYear(answers) {
  return nywYears(answers).next;
}

// "July 2027", "July – August 2027" (a week that crosses a month).
function nywMonthWords(ymd) {
  const p = nywYmdParts(ymd);
  if (!p) return 'The week';
  const f = (t, o) => new Date(t).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o));
  const a = f(p.t, { month: 'long' });
  const b = f(p.t + 6 * 86400000, { month: 'long' });
  return a === b ? a + ' ' + f(p.t, { year: 'numeric' }) : a + ' – ' + b + ' ' + f(p.t + 6 * 86400000, { year: 'numeric' });
}

const NYW_CARRY_WORDS = {
  schedule: 'The schedule back to the one the app came with', games: 'Games back to the ones the app came with', teams: 'Team names, emoji and colours back to the app’s own',
  counselors: 'Counselor names typed on teams', photos: 'Team photos', cleanup: 'Cleanup rota', meals: 'Meal menus', verses: 'Memory verses and theme',
  stations: 'Elective stations', stationPeople: 'Who’s at each station',
};
const NYW_KEEP_WORDS = { schedule: 'the schedule', games: 'games', teams: 'team names', cleanup: 'cleanup rota', stations: 'elective stations', counselors: 'typed counselor names', photos: 'team photos', meals: 'menus', verses: 'verses', stationPeople: 'who’s at each station' };

function nywTallyRow(key, n, what, sub) {
  const num = n && typeof n === 'object' && n.mark ? '<span class="nyw-t-n" data-mark="' + esc(n.mark) + '"></span>'
    : n && typeof n === 'object' && n.html ? '<span class="nyw-t-n">' + n.html + '</span>'
    : '<span class="nyw-t-n">' + esc(String(n)) + '</span>';
  return '<div class="nyw-t" data-key="' + esc(key) + '">' + num + '<span class="nyw-t-text"><span class="nyw-t-what">' + esc(what) + '</span>' +
    (sub ? '<span class="nyw-t-sub">' + esc(sub) + '</span>' : '') + '</span></div>';
}

function nywWord(n, one, many) { return n === 1 ? one : many; }

// The year's champion for the receipt: directors only (the points guard), '' team with nothing scored.
function nywChampion() {
  if (typeof standingsVisible !== 'function' || !standingsVisible()) return null;
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  const top = ranked[0];
  if (!top || !(counts[top.id] && counts[top.id].points > 0)) return null;
  const n = counts[top.id].points;
  const tied = !!(ranked[1] && counts[ranked[1].id] && counts[ranked[1].id].points === n);
  return { id: top.id, name: String(top.name || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60), points: n, tied };
}

// Schedule items whose label names someone (ux-R9): a label's tail after " — " with a first name the camp knows. Nothing is
// changed by it; the sheet only lists them.
function nywStaffItems() {
  if (typeof setupOn !== 'function' || !setupOn('schedule') || typeof resolveDay !== 'function') return [];
  const known = {};
  const add = (n) => { const w = String(n || '').trim().split(/\s+/)[0].toLowerCase(); if (w.length > 1) known[w] = String(n).trim().split(/\s+/)[0]; };
  try { (staffNames() || []).forEach(add); } catch (e) { /* none */ }
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  Object.keys(dir).forEach((k) => add(dir[k] && dir[k].name));
  const out = [];
  const seen = {};
  for (let dow = 0; dow < 7; dow++) {
    resolveDay(setupTree, dow).forEach((b) => {
      if (!b || b.skipped || b.broken || seen[b.id]) return;
      const label = String((b.base && b.base.label) || b.label || '');
      const tail = label.split(' — ')[1];
      if (!tail) return;
      const names = [];
      tail.split(/[^A-Za-z’']+/).forEach((w) => { const f = known[w.toLowerCase()]; if (f && names.indexOf(f) === -1) names.push(f); });
      if (!names.length) return;
      seen[b.id] = true;
      out.push({ id: b.id, label, emoji: b.emoji, start: b.start, names, dow });
    });
  }
  return out;
}

// ── the model ────────────────────────────────────────────────────────

// Which claim this screen draws: the tree's, or the one an acknowledged write handed back a moment ago (the tree catches up a
// beat later). Returns null when there is nothing to show (the hub stands in).
function nywModelNow() {
  if (typeof wizardModel !== 'function') return null;
  const wm = wizardModel();
  const dev = wizardDeviceId();
  const fresh = nywUi.claim && Date.now() - nywUi.claimAt < 8000 && nywUi.claim.fromEpoch === wizardCurrentEpoch() ? nywUi.claim : null;
  if (wm.state === 'mine') {
    const c = fresh && fresh.at >= wm.claim.at ? fresh : wm.claim;
    return { mode: 'me', step: c.step, claim: c, wm };
  }
  if (fresh && fresh.dev === dev && wm.state === 'none') return { mode: 'me', step: fresh.step, claim: fresh, wm };
  if (wm.state === 'other') return { mode: nywUi.watching ? 'watch' : 'other', step: wm.claim.step, claim: wm.claim, wm };
  if (nywDoneOn()) return { mode: 'me', step: 5, claim: null, wm, done: true };
  return null;
}

function nywDoneOn() {
  if (nywUi.doneLeft) return false;
  const d = wizardDraftRead().done;
  return !!(d && Date.now() - Number(d.at || 0) < 3 * 86400000);
}

function nywMayShow() {
  return typeof isOwner === 'function' && isOwner() && !!nywModelNow();
}

// The answers on screen: this device's draft; Watching, the driver's own (the claim).
function nywAnswersFor(m) {
  if (m && m.mode === 'watch' && m.claim) return m.claim.answers;
  const d = wizardDraftRead();
  // A reload that lost the device draft resumes from the claim's copy.
  if (m && m.mode === 'me' && m.claim && !d.answers.weekStart && m.claim.answers.weekStart) { d.answers = m.claim.answers; wizardDraftWrite(); }
  return d.answers;
}

function nywWhy(r) {
  if (!r) return NYW_WHY.failed;
  if (r.reason === 'owner') return r.message || 'Only the owner can do that.';
  return NYW_WHY[r.reason] || NYW_WHY.failed;
}

// The hub door's view of a run: null when none (or a leftover from another year).
function nywDoorView() {
  if (typeof wizardModel !== 'function') return null;
  const wm = wizardModel();
  if (wm.state === 'none' || wm.state === 'stale') return null;
  const answers = wm.claim.answers;
  return {
    state: wm.state, step: wm.claim.step, byName: wm.byName, idleMs: wm.idleMs, canTakeOver: !!wm.canTakeOver,
    year: nywNextYear(answers) || 'the new year',
  };
}

// ── starting, resuming, watching ─────────────────────────────────────

function nywOpenScreen() {
  nywUi.save = { state: 'idle', res: null, why: '' };
  nywUi.clear = { state: 'idle', why: '', reveal: false };
  nywUi.members = null; nywUi.membersAsked = false; nywUi.ask = null; nywUi.lastStep = 0;
  setupGo('wizard');
}

// The owner's front door (hub door, Camp week's route, ⋯ → Start the new-year setup). The freeze is asked in words; a schedule
// that isn't edited here yet is turned on first (A1, one restore point) by the engine.
async function nywStart() {
  if (!requireOwner('set up the new year')) return { ok: false, reason: 'owner' };
  const opts = Object.assign({}, nywUi.freeze);
  for (let guard = 0; guard < 4; guard++) {
    const needA1 = !setupOn('schedule');
    const r = await wizardStart(opts);
    if (r.ok) {
      if (r.claim) { nywUi.claim = r.claim; nywUi.claimAt = Date.now(); }
      nywUi.a1Ran = nywUi.a1Ran || needA1;
      nywUi.freeze = {};
      nywUi.watching = false;
      nywOpenScreen();
      return r;
    }
    if (r.reason === 'other') { nywUi.watching = false; nywOpenScreen(); return r; }
    if (r.reason === 'ask-camp-week') {
      const running = await askDialog({
        title: 'Is a camp week running right now?',
        body: 'No dates are set, so the app can’t tell. The new-year setup clears the scoreboard, so it waits until camp is over.',
        actions: [{ label: 'Not now', value: 'cancel', cancel: true }, { label: 'No, it’s not', value: 'no', kind: 'gold' }, { label: 'Yes, it is', value: 'yes' }],
      });
      if (running === 'cancel' || running === null) return { ok: false, reason: 'cancelled' };
      opts.campRunning = running === 'yes';
      if (running === 'yes') nywUi.freeze.campRunning = true;
      continue;
    }
    if (r.reason === 'camp-week') {
      const again = await askDialog({
        title: 'A camp week is running',
        body: ['The new-year setup clears the scoreboard. It is meant for after camp.', 'Carry on anyway?'],
        actions: [{ label: 'Not now', value: 'wait', cancel: true }, { label: 'Carry on anyway', value: 'go', kind: 'danger' }],
      });
      if (again !== 'go') return { ok: false, reason: 'cancelled' };
      opts.overrideCampWeek = true;
      continue;
    }
    if (r.reason === 'a1') { setupSay(r.a1 === 'owner' ? r.message : (TURNON_WHY[r.a1] || TURNON_WHY.failed)); return r; }
    setupSay(nywWhy(r));
    return r;
  }
  return { ok: false, reason: 'failed' };
}

function nywWatch() {
  if (!isOwner()) return;
  nywUi.watching = true;
  nywOpenScreen();
}

async function nywTakeOver() {
  if (!requireOwner('take over the new-year setup')) return;
  const r = await wizardTakeOver();
  if (!r.ok) { setupSay(r.reason === 'busy' ? 'That device is still being used. Take over appears once it has been idle 15 minutes.' : nywWhy(r)); return; }
  if (r.claim) { nywUi.claim = r.claim; nywUi.claimAt = Date.now(); }
  nywUi.watching = false;
  nywUi.save = { state: 'idle', res: null, why: '' };
  const inh = r.inherited;
  nywOpenScreen(); // (it clears any question: the one about the inherited answers is raised after it)
  if (inh && !r.already && (inh.weekStart || JSON.stringify(inh.carry) !== JSON.stringify(wizardNormAnswers({}).carry) || inh.double !== 'same')) {
    nywUi.ask = {
      q: 'You chose on your other device:', list: nywAnswerLines(inh),
      a: { label: 'Use these', run: () => { nywUi.ask = null; renderAll(); } },
      b: { label: 'Start over', run: async () => { nywUi.ask = null; await wizardStartOver(); renderAll(); } },
    };
  }
  if (nywUi.ask) renderAll();
}

// What an answers object says, as plain lines.
function nywAnswerLines(a) {
  const out = [];
  out.push(a.weekStart ? 'Camp starts ' + nywDayWords(a.weekStart) : 'No camp date yet');
  out.push('Double points ' + (a.double === 'none' ? 'off' : a.double === 'same' ? 'the same as last year' : nywDoubleWords(a.double)));
  const keep = WIZARD_ITEMS.filter((k) => a.carry[k] === 'keep' && NYW_KEEP_WORDS[k] && !(k === 'stations' || k === 'stationPeople') || (CAMP.features && CAMP.features.electives && (k === 'stations' || k === 'stationPeople') && a.carry[k] === 'keep'));
  const clear = WIZARD_ITEMS.filter((k) => a.carry[k] === 'clear' && NYW_KEEP_WORDS[k]);
  if (keep.length) out.push('Keep ' + hubJoin(keep.map((k) => NYW_KEEP_WORDS[k])));
  if (clear.length) out.push('Clear ' + hubJoin(clear.map((k) => NYW_KEEP_WORDS[k])));
  return out;
}

// ── navigation ───────────────────────────────────────────────────────

async function nywGo(n) {
  const m = nywModelNow();
  if (!m || m.mode !== 'me' || m.step === 5) return;
  const r = await wizardSetStep(n);
  if (!r.ok) { setupSay(nywWhy(r)); return; }
  if (r.claim) { nywUi.claim = r.claim; nywUi.claimAt = Date.now(); }
  nywUi.ask = null;
  renderAll();
  if (typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0); } catch (e) { /* fine */ } }
}

async function nywNext() {
  const m = nywModelNow();
  if (!m || m.mode !== 'me') return;
  wizardTouch();
  if (m.step === 5) { nywLeaveDone(); return; }
  const why = nywNextWhy(m, nywAnswersFor(m));
  if (why) { setupSay(why); return; }
  if (m.step === 1) await wizardFlushAnswers();
  nywGo(m.step + 1);
}

// The words on the Next button when it is the dashed well ('' when it can be pressed).
function nywNextWhy(m, a) {
  if (m.step === 1) {
    if (nywUi.typed && !wizardIsSunday(nywUi.typed)) return 'Pick a Sunday: camp weeks start on one.';
    return a.weekStart ? '' : 'Pick the Sunday camp starts';
  }
  if (m.step === 3) {
    const s = nywUi.save.state;
    if (s === 'saved') return '';
    const out = nywYears(a).out;
    return s === 'offline' ? 'Needs a connection' : s === 'error' ? 'Try the copy again first' : 'Saving ' + (out || 'last year') + '…';
  }
  return '';
}

function nywLeaveDone() {
  const d = wizardDraftRead();
  d.done = null;
  d.preWizard = '';
  wizardDraftWrite();
  nywUi.done = null; nywUi.doneLeft = true;
  setupGo('hub');
}

// Back on the wizard's own screen: step 1 offers to put the whole setup away; any other step just leaves it open for later
// (the hub's door says Carry on).
async function nywBackFromScreen() {
  const m = nywModelNow();
  if (!m || m.mode !== 'me' || m.step !== 1) { setupGo('hub'); return; }
  const a = nywAnswersFor(m);
  if (!a.weekStart) {
    const c = await askDialog({
      title: 'Leave the new-year setup?', body: 'Nothing has been changed yet.',
      actions: [{ label: 'Keep it for later', value: 'later', kind: 'gold' }, { label: 'Cancel the setup', value: 'cancel', kind: 'danger' }, { label: 'Stay', value: 'stay', cancel: true }],
    });
    if (c === 'cancel') { await wizardRelease(); nywUi.claim = null; setupGo('hub'); return; }
    if (c === 'later') setupGo('hub');
    return;
  }
  setupGo('hub');
}

// ── answers ──────────────────────────────────────────────────────────

function nywSetDate(v) {
  const m = nywModelNow();
  if (!m || m.mode !== 'me') return;
  wizardTouch();
  if (!v) { nywUi.typed = ''; renderAll(); return; }
  if (wizardIsSunday(v)) { nywUi.typed = ''; wizardAnswer({ weekStart: v }); } else nywUi.typed = v;
  renderAll();
}

function nywSetDouble(choice) {
  const m = nywModelNow();
  if (!m || m.mode !== 'me') return;
  wizardTouch();
  const cur = wizardAnswers().double;
  if (choice === 'same') wizardAnswer({ double: 'same' });
  else if (choice === 'none') wizardAnswer({ double: 'none' });
  else if (!wizardDoubleOk(cur)) wizardAnswer({ double: setupClone(nywLastDouble() || WIZARD_DOUBLE_SAME_LEGACY) });
  renderAll();
}

function nywDoubleFromForm() {
  const m = nywModelNow();
  if (!m || m.mode !== 'me') return; // a watching device reads, never answers
  const from = Number((setupEl('nyw-double-from') || {}).value);
  const until = Number((setupEl('nyw-double-until') || {}).value);
  const at = String((setupEl('nyw-double-at') || {}).value || '17:00').split(':').map(Number);
  const fromMin = (at[0] || 0) * 60 + (at[1] || 0);
  const d = { fromDow: from, fromMin, toDow: until, toMin: 0 };
  if (!wizardDoubleOk(d)) { setupSay('Double points have to end after they start.'); renderAll(); return; }
  wizardAnswer({ double: d });
  renderAll();
}

function nywPick(item, pick) {
  const m = nywModelNow();
  if (!m || m.mode !== 'me' || WIZARD_ITEMS.indexOf(item) === -1 || (pick !== 'keep' && pick !== 'clear')) return;
  wizardTouch();
  wizardAnswer({ carry: { [item]: pick } });
  renderAll();
}

// ── step 3: save last year ───────────────────────────────────────────

async function nywRunSave() {
  if (nywUi.save.state === 'saving') return;
  nywUi.save = { state: 'saving', res: null, why: '' };
  if (!restoreOnline()) { nywUi.save = { state: 'offline', res: null, why: 'offline' }; renderAll(); return; }
  renderAll();
  let r;
  try { r = await wizardArchive(); } catch (e) { r = { ok: false, reason: 'failed' }; }
  const m = nywModelNow();
  if (!m || m.step !== 3) { nywUi.save = { state: 'idle', res: null, why: '' }; return; }
  if (r.ok) nywUi.save = { state: 'saved', res: r, why: '' };
  else if (r.reason === 'offline') nywUi.save = { state: 'offline', res: null, why: 'offline' };
  else nywUi.save = { state: 'error', res: null, why: r.reason === 'owner' ? (r.message || '') : r.reason };
  renderAll();
}

async function nywDownloadCopy() {
  if (!canEdit()) return;
  let body = null;
  const rid = nywUi.save.res && nywUi.save.res.rid;
  if (rid && typeof restoreRead === 'function') { try { const r = await restoreRead(rid); if (r && r.ok) body = r.body; } catch (e) { body = null; } }
  if (!body && typeof restoreBodyObject === 'function') body = restoreBodyObject();
  if (!body) return;
  downloadBlob(new Blob([JSON.stringify(body)], { type: 'application/json' }), 'camp-' + CAMP.id + '-' + (nywYears().out || 'last-year') + '-copy-' + new Date().toISOString().slice(0, 10) + '.json');
}

// ── step 4: the clear ────────────────────────────────────────────────

async function nywLoadMembers() {
  if (nywUi.membersAsked) return;
  nywUi.membersAsked = true;
  const r = await wizardMembersPreflight();
  nywUi.members = r.ok ? r : null;
  if (!r.ok) nywUi.membersAsked = false;
  if (setupScreen() === 'wizard') renderNywScreen();
}

async function nywRunClear() {
  const m = nywModelNow();
  if (!m || m.mode !== 'me' || m.step !== 4 || nywUi.clear.state === 'saving') return;
  nywUi.ask = null;
  nywUi.clear = { state: 'saving', why: '', reveal: false };
  renderAll();
  let r;
  try { r = await wizardClear(nywUi.freeze); } catch (e) { r = { ok: false, reason: 'failed' }; }
  if (r.ok) {
    nywUi.done = r; nywUi.doneLeft = false; nywUi.freeze = {};
    nywUi.clear = { state: 'idle', why: '', reveal: false };
    nywUi.save = { state: 'idle', res: null, why: '' };
    nywUi.claim = null;
    renderAll();
    return;
  }
  nywUi.clear = { state: r.reason === 'offline' ? 'offline' : 'error', why: r.reason, reveal: false, message: r.message || '' };
  if (r.reason === 'ask-camp-week') {
    nywUi.clear = { state: 'idle', why: '', reveal: false };
    nywUi.ask = {
      q: 'Is a camp week running right now?',
      a: { label: 'No, it’s not', run: () => { nywUi.freeze.campRunning = false; nywUi.ask = null; nywRunClear(); } },
      b: { label: 'Yes, it is', run: () => { nywUi.freeze.campRunning = true; nywUi.ask = null; nywRunClear(); } },
    };
  } else if (r.reason === 'camp-week') {
    const wk = campWeek();
    nywUi.clear = { state: 'idle', why: '', reveal: false };
    nywUi.ask = {
      q: 'Camp week is running' + (wk.start ? ' (' + weekHeadline(wk.start) + ')' : '') + '. The new-year setup clears its scoreboard.',
      a: { label: 'Not now', run: () => { nywUi.ask = null; renderAll(); } },
      b: { label: 'Carry on anyway', danger: true, run: () => { nywUi.freeze.overrideCampWeek = true; nywUi.ask = null; nywRunClear(); } },
    };
  }
  renderAll();
}

// ── the screen ───────────────────────────────────────────────────────

// `out` / `next` are nywYears' (either may be '': then the words say "last year" / "the new year").
function nywStepHeadline(step, out, next) {
  return [
    ['When is camp?', 'Pick the Sunday it starts. The rest of the week follows.'],
    ['What carries over from ' + (out || 'last year') + '?', 'Pick for each one. You can change anything after.'],
    ['Save ' + (out || 'last year'), 'A copy of the whole week is saved and checked before anything is cleared.'],
    ['Clear the scoreboard', 'Hold the button to start ' + (next || 'the new year') + ' fresh.'],
    ['Ready for ' + (next || 'the new year'), 'Here’s what was done.'],
  ][step - 1];
}

function paintNywBars(step, animate) {
  document.querySelectorAll('#nyw-track .nyw-bar').forEach((bar) => {
    const n = Number(bar.dataset.nywBar);
    const st = n < step || step === 5 ? 'done' : n === step ? 'now' : 'todo';
    if (bar.dataset.state !== st) {
      bar.dataset.state = st;
      if (animate && st === 'now' && typeof JellyMotion !== 'undefined') {
        JellyMotion.play(bar, 'glide', (x) => ({ transform: 'scaleX(' + (0.2 + 0.8 * Math.min(1, x)) + ')', transformOrigin: '0 50%' }), { calm: [{ opacity: 0.4 }, { opacity: 1 }] });
      }
    }
  });
}

function renderNywScreen() {
  const root = setupEl('setup-wizard');
  const m = nywModelNow();
  if (!root || !m) return;
  const owner = isOwner();
  const a = nywAnswersFor(m);
  const step = m.step;
  // Another device's run is named by ITS answers (the claim's), never this device's draft.
  const yrs = nywYears(m.mode !== 'me' && m.claim ? m.claim.answers : a, { done: step === 5 });
  const out = yrs.out;
  const next = yrs.next;
  const stepChanged = nywUi.lastStep && (nywUi.lastStep !== step || nywUi.lastMode !== m.mode);
  const back = nywUi.lastStep > step;
  // The screen's two switches (the CSS reads them).
  const drive = m.mode === 'me' ? 'me' : m.mode;
  if (root.dataset.step !== String(step)) root.dataset.step = String(step);
  if (root.dataset.drive !== drive) root.dataset.drive = drive;
  // Watching reads the other device's step: `inert` keeps every control out of reach of a tap AND the keyboard (the
  // CSS draws the picks read-only), so nothing on the watching device can answer for the driving one.
  document.querySelectorAll('#setup-wizard > .nyw-step').forEach((el) => {
    const inert = m.mode === 'watch';
    if (el.hasAttribute('inert') !== inert) el.toggleAttribute('inert', inert);
  });
  setTextIfChanged(setupEl('nyw-title'), 'New-year setup · ' + campWord());
  paintNywBars(step, stepChanged);
  setTextIfChanged(setupEl('nyw-count'), 'Step ' + step + ' of ' + NYW_STEPS);
  const claimMode = m.mode !== 'me';
  const head = claimMode && m.mode === 'other' ? ['You’re setting up ' + (next || 'the new year') + ' on another device', ''] : nywStepHeadline(step, out, next);
  setTextIfChanged(setupEl('nyw-headline'), head[0]);
  setTextIfChanged(setupEl('nyw-lede'), head[1]);
  setHiddenIfChanged(setupEl('nyw-lede'), !head[1]);
  // The claim panel.
  const claim = setupEl('nyw-claim');
  setHiddenIfChanged(claim, !claimMode);
  if (claimMode && claim) {
    const dv = m.mode === 'watch' ? 'watching' : 'other';
    if (claim.dataset.claim !== dv) claim.dataset.claim = dv;
    const ago = hubAgo(m.claim.at, typeof serverNow === 'function' ? serverNow() : Date.now());
    setTextIfChanged(setupEl('nyw-claim-lead'), m.mode === 'watch' ? 'Watching your other device · read only · last tap ' + ago : 'Set up on your other device · step ' + step + ' of ' + NYW_STEPS);
    setTextIfChanged(setupEl('nyw-claim-sub'), 'Last tap there ' + ago);
    setHiddenIfChanged(setupEl('nyw-takeover'), !m.wm.canTakeOver);
    setHiddenIfChanged(setupEl('nyw-takeover-note'), !!m.wm.canTakeOver || m.mode === 'watch');
    setHiddenIfChanged(setupEl('nyw-watch'), m.mode === 'watch');
  }
  // The one inline question.
  const ask = nywUi.ask;
  setHiddenIfChanged(setupEl('nyw-ask'), !ask);
  if (ask) {
    setTextIfChanged(setupEl('nyw-ask-q'), ask.q);
    const list = setupEl('nyw-ask-list');
    setHiddenIfChanged(list, !(ask.list && ask.list.length));
    setHtmlIfChanged(list, (ask.list || []).map((t) => '<li>' + esc(t) + '</li>').join(''));
    setTextIfChanged(setupEl('nyw-ask-a'), ask.a.label);
    setTextIfChanged(setupEl('nyw-ask-b'), ask.b.label);
    const bb = setupEl('nyw-ask-b');
    if (bb) { if (!!ask.b.danger !== bb.hasAttribute('data-danger')) { if (ask.b.danger) bb.setAttribute('data-danger', ''); else bb.removeAttribute('data-danger'); } }
  }
  // Plain lines.
  const dev = typeof devicesList === 'function' && canEdit() ? devicesList() : null;
  setTextIfChanged(setupEl('nyw-older-text'), dev && dev.older ? dev.lede : '');
  setHiddenIfChanged(setupEl('nyw-older'), !(dev && dev.older) || m.mode !== 'me');
  setHiddenIfChanged(setupEl('nyw-a1'), !(m.mode === 'me' && step === 1 && !setupOn('schedule')));
  const offline = m.mode === 'me' && (step === 3 || step === 4) && !restoreOnline();
  // Once the copy is saved and checked, "saving needs a connection" would contradict the line under it: say what is next.
  setTextIfChanged(setupEl('nyw-offline-text'), step === 3 && nywUi.save.state === 'saved'
    ? 'No signal. Clearing in the next step needs a connection.'
    : step === 3
      ? 'No signal. Your answers are kept on this phone; saving ' + (out || 'last year') + ' needs a connection.'
      : 'No signal. Clearing needs a connection. Nothing has been cleared.');
  setHiddenIfChanged(setupEl('nyw-offline'), !offline);
  if (step === 1) paintNywStep1(a, m, out);
  else if (step === 2) paintNywStep2(a, m);
  else if (step === 3) paintNywStep3(a, out);
  else if (step === 4) paintNywStep4(a, out, next);
  else paintNywStep5(out, next);
  paintNywDock(m, a, out);
  // Motion: a step arrives from the side it came from (calm: a fade).
  if (stepChanged && m.mode === 'me') {
    const el = document.querySelector('#setup-wizard [data-nyw-step="' + step + '"]');
    if (el) setupPaneArrive(el, back);
  }
  // Doing what the step is for, once, when it is reached (a reload on step 3 saves again; a saved copy is simply verified).
  if (m.mode === 'me' && step === 3) {
    if (nywUi.save.state === 'idle' || (nywUi.save.state === 'offline' && restoreOnline())) nywRunSave();
  } else if (nywUi.save.state !== 'idle' && nywUi.save.state !== 'saving') nywUi.save = { state: 'idle', res: null, why: '' };
  if (m.mode === 'me' && step === 4) nywLoadMembers();
  nywUi.lastStep = step; nywUi.lastMode = m.mode;
}

function paintNywStep1(a, m, out) {
  const input = setupEl('nyw-start');
  const shown = nywUi.typed || a.weekStart;
  if (input && document.activeElement !== input && input.value !== shown) input.value = shown;
  // A date that isn't a Sunday: never an error, a nudge to the nearest one. Until it is answered the row and the
  // calendar don't go on showing the week that was picked before it.
  const near = nywUi.typed && !wizardIsSunday(nywUi.typed) ? nywSundayNear(nywUi.typed) : '';
  setTextIfChanged(setupEl('nyw-start-sub'), a.weekStart && !near ? hubWeekRange(a.weekStart).replace(' – ', ' to ') : 'A Sunday');
  const was = hubWeekStart();
  setTextIfChanged(setupEl('nyw-start-was'), was && was !== a.weekStart ? 'Last camp: ' + weekHeadline(was) : '');
  setHiddenIfChanged(setupEl('nyw-snap'), !near);
  if (near) {
    setTextIfChanged(setupEl('nyw-snap-q'), 'Camp weeks start on a Sunday. Did you mean ' + nywDayWords(near) + '?');
    setTextIfChanged(setupEl('nyw-snap-use'), 'Use ' + nywDayWords(near));
    setupEl('nyw-snap-use').dataset.sunday = near;
  }
  // The week it makes, as a printed calendar.
  const ymd = near ? '' : a.weekStart;
  setHiddenIfChanged(setupEl('nyw-sec-week'), !ymd);
  if (ymd) {
    const p = nywYmdParts(ymd);
    setTextIfChanged(setupEl('nyw-week-month'), nywMonthWords(ymd));
    setTextIfChanged(setupEl('nyw-week-was'), 'Day names as in ' + (out || 'last year'));
    const days = weekDays();
    document.querySelectorAll('#nyw-days .nyw-day').forEach((li) => {
      const dow = Number(li.dataset.dow);
      const t = new Date(p.t + dow * 86400000);
      const date = t.getUTCDate() === 1 && dow > 0 ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(t.getUTCDate());
      setTextIfChanged(li.querySelector('[data-nyw-date]'), date);
      setTextIfChanged(li.querySelector('[data-nyw-tag]'), (days[dow] && days[dow].tag) || '');
    });
  }
  // Double points.
  const last = nywLastDouble();
  const choice = a.double === 'none' ? 'none' : a.double === 'same' ? 'same' : 'change';
  document.querySelectorAll('[data-nyw-double]').forEach((b) => {
    const on = b.dataset.nywDouble === choice;
    if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on));
  });
  const lastWords = nywDoubleWords(last);
  setTextIfChanged(setupEl('nyw-double-same-sub'), lastWords || 'No double points last year');
  setTextIfChanged(setupEl('nyw-double-same-t'), 'Same as ' + (out || 'last year'));
  // Watching: the chosen window in words, never the form (a control on a read-only screen looks broken).
  const watch = m && m.mode === 'watch';
  setTextIfChanged(setupEl('nyw-double-change-sub'), watch && choice === 'change' ? nywDoubleWords(a.double) : '');
  const form = setupEl('nyw-double-form');
  setHiddenIfChanged(form, choice !== 'change' || watch);
  if (choice === 'change') {
    const d = a.double;
    weekSelectOptions(setupEl('nyw-double-from'), WEEK_DOW_WORDS.map((w, i) => [i, w]), d.fromDow);
    weekSelectOptions(setupEl('nyw-double-until'), WEEK_DOW_WORDS.map((w, i) => [i + 1, 'End of ' + w]), d.toDow);
    const at = setupEl('nyw-double-at');
    const hh = String(Math.floor(d.fromMin / 60)).padStart(2, '0') + ':' + String(d.fromMin % 60).padStart(2, '0');
    if (at && document.activeElement !== at && at.value !== hh) at.value = hh;
  }
}

function paintNywStep2(a) {
  const electives = !!(CAMP.features && CAMP.features.electives);
  document.querySelectorAll('.nyw-carry .nyw-item').forEach((row) => {
    const k = row.dataset.nywItem;
    if (row.hasAttribute('data-feature')) setHiddenIfChanged(row, !electives);
    const v = a.carry[k];
    if (row.dataset.choice !== v) row.dataset.choice = v;
    row.querySelectorAll('[data-nyw-pick]').forEach((t) => {
      const on = t.dataset.nywPick === v;
      if (t.getAttribute('aria-checked') !== String(on)) t.setAttribute('aria-checked', String(on));
    });
  });
  const items = a.carry.schedule === 'keep' ? nywStaffItems() : [];
  setHiddenIfChanged(setupEl('nyw-staff'), !items.length);
  if (items.length) {
    // Whole labels (the names ARE the difference: "Snack and campfire — TJ" and "— Laura" are two items), each once.
    const labels = items.map((i) => i.label).filter((l, i, all) => all.indexOf(l) === i);
    const cut = labels.length > 2;
    setTextIfChanged(setupEl('nyw-staff-text'), items.length + ' ' + nywWord(items.length, 'item names', 'items name') + ' people: ' + labels.slice(0, 2).join(', ') + (cut ? '…' : '.'));
  }
}

function nywSaveWords(out0) {
  const out = out0 || 'last year';
  const s = nywUi.save;
  if (s.state === 'saved') return ['saved', 'Saved and checked: the copy on the server matches.'];
  if (s.state === 'offline') return ['offline', 'Needs a connection. Nothing is saved yet.'];
  if (s.state === 'error') return ['error', s.why === 'not-mine' ? NYW_WHY['not-mine'] : s.why === 'verify' ? 'Couldn’t check the copy. Nothing will be cleared until it matches.' : 'Couldn’t save ' + out + '. Nothing will be cleared.'];
  return ['saving', 'Saving ' + out + '…'];
}

function paintNywStep3(a, out) {
  const [tone, text] = nywSaveWords(out);
  const st = setupEl('nyw-save-state');
  if (st && st.dataset.tone !== tone) st.dataset.tone = tone;
  setTextIfChanged(setupEl('nyw-save-text'), text);
  setHiddenIfChanged(setupEl('nyw-save-retry'), !(tone === 'error' || tone === 'offline'));
  const res = nywUi.save.res;
  setHiddenIfChanged(setupEl('nyw-sec-saved'), !res);
  setTextIfChanged(setupEl('nyw-saved-label'), out ? 'In the ' + out + ' restore point' : 'In the restore point');
  setTextIfChanged(setupEl('nyw-save-download-text'), 'Download a copy of ' + (out || 'last year'));
  let rows = '';
  if (res) {
    const c = res.counts || {};
    const ch = nywChampion();
    if (ch) rows += '<div class="nyw-t nyw-champ" data-key="champion"><span class="nyw-t-n">' + teamMarkHtml(ch.id, { size: 34 }) + '</span><span class="nyw-t-text"><span class="nyw-t-what">' +
      esc(ch.tied ? 'Tied for first' + (out ? ' in ' + out : '') : ch.name + ' won' + (out ? ' ' + out : '')) + '</span><span class="nyw-t-sub">' + esc(ch.points + ' points') + '</span></span></div>';
    if (c.results) rows += nywTallyRow('results', c.results, nywWord(c.results, 'game result', 'game results'), '');
    if (c.bonuses) rows += nywTallyRow('bonuses', c.bonuses, nywWord(c.bonuses, 'bonus point entry', 'bonus point entries'), '');
    if (c.brackets) rows += nywTallyRow('brackets', c.brackets, nywWord(c.brackets, 'bracket in progress', 'brackets in progress'), '');
    if (c.announcements) rows += nywTallyRow('announcements', c.announcements, nywWord(c.announcements, 'announcement', 'announcements'), '');
    rows += nywTallyRow('week', { mark: 'item' }, 'The schedule, games, teams and verses', 'As they are now');
  }
  setHtmlIfChanged(setupEl('nyw-saved-list'), rows);
}

const NYW_CAMPERS_GONE = 'Not saved anywhere · Undo can’t bring them back';

function nywClearRows(a) {
  const c = wizardCounts(state);
  const req = typeof peopleRequests === 'function' ? peopleRequests().length : 0;
  let rows = '';
  const add = (key, n, what, sub) => { if (n === 0) return; rows += nywTallyRow(key, n, what, sub); }; // a count of nothing is no row
  add('results', c.results, nywWord(c.results, 'game result', 'game results'), '');
  add('bonuses', c.bonuses, nywWord(c.bonuses, 'bonus point entry', 'bonus point entries'), '');
  add('brackets', c.brackets, nywWord(c.brackets, 'bracket in progress', 'brackets in progress'), '');
  add('announcements', c.announcements, nywWord(c.announcements, 'announcement', 'announcements'), '');
  // Camper names are the one thing the clear deletes that neither the restore point nor Undo brings back, so the list always
  // says them: the count once this screen holds it (CAMPERS_SCREENS has 'wizard': counts only, never a name), else in words.
  // A list known to be empty is a count of nothing (no row).
  const kidsKnown = typeof campersStatus === 'function' && campersStatus() === 'ok' && canEdit();
  if (kidsKnown) {
    const kids = campersTotal();
    add('campers', kids, nywWord(kids, 'camper name', 'camper names'), NYW_CAMPERS_GONE);
  } else rows += nywTallyRow('campers-all', { mark: 'item' }, 'Every camper name', NYW_CAMPERS_GONE);
  add('requests', req, nywWord(req, 'request to join', 'requests to join'), '');
  add('reveal', { mark: 'item' }, 'The standings reveal on the big screen', '');
  WIZARD_ITEMS.forEach((k) => {
    if (a.carry[k] !== 'clear' || !NYW_CARRY_WORDS[k]) return;
    if ((k === 'stations' || k === 'stationPeople') && !(CAMP.features && CAMP.features.electives)) return;
    if (k === 'stationPeople' && a.carry.stations === 'clear') return;
    add('c-' + k, { mark: 'item' }, NYW_CARRY_WORDS[k], '');
  });
  if (c.noticePosted) add('notice', { mark: 'item' }, 'Notice board · back to a draft', '');
  const mem = nywUi.members;
  if (a.carry.memberTeams === 'clear' && mem && mem.withTeam.length) {
    add('members', mem.withTeam.length, nywWord(mem.withTeam.length, 'counselor taken off their team', 'counselors taken off their teams'), 'After the clear · Undo doesn’t put teams back');
  }
  return rows;
}

function paintNywStep4(a, out, next) {
  setTextIfChanged(setupEl('nyw-clear-label'), next ? 'Cleared for ' + next : 'Cleared');
  setTextIfChanged(setupEl('nyw-clear-note'), 'Everything else is in the ' + (out ? out + ' ' : '') + 'restore point');
  setHtmlIfChanged(setupEl('nyw-clear-list'), nywClearRows(a));
  const keep = WIZARD_ITEMS.filter((k) => a.carry[k] === 'keep' && NYW_KEEP_WORDS[k] && (!(k === 'stations' || k === 'stationPeople') || (CAMP.features && CAMP.features.electives)));
  setTextIfChanged(setupEl('nyw-kept-text'), hubJoin(keep.map((k) => NYW_KEEP_WORDS[k]).concat(['every sign-in'])) + '.');
  const mem = nywUi.members;
  const bad = a.carry.memberTeams === 'clear' && mem && mem.incomplete.length ? mem.incomplete : [];
  setHiddenIfChanged(setupEl('nyw-members-warn'), !bad.length);
  if (bad.length) setTextIfChanged(setupEl('nyw-members-warn-text'), hubJoin(bad.slice(0, 3).map((p) => p.name)) + (bad.length > 3 ? ' and ' + (bad.length - 3) + ' more' : '') + ' ' + nywWord(bad.length, 'has an incomplete sign-in record, so they’ll stay', 'have incomplete sign-in records, so they’ll stay') + ' on their ' + nywWord(bad.length, 'team', 'teams') + '.');
  const cs = nywUi.clear;
  const showState = cs.state !== 'idle';
  setHiddenIfChanged(setupEl('nyw-clear-state'), !showState);
  if (showState) {
    const tone = cs.state === 'saving' ? 'saving' : cs.state === 'offline' ? 'offline' : 'error';
    const st = setupEl('nyw-clear-state');
    if (st && st.dataset.tone !== tone) st.dataset.tone = tone;
    setTextIfChanged(setupEl('nyw-clear-text'), cs.state === 'saving' ? 'Clearing…'
      : cs.state === 'offline' ? 'Needs a connection. Nothing was cleared.'
      : 'Nothing was cleared: ' + (cs.why === 'refused' ? 'the server turned it away.' : cs.why === 'busy' ? NYW_WHY.busy.toLowerCase() : nywWhy({ reason: cs.why, message: cs.message }).replace(/^./, (x) => x.toLowerCase())));
  }
  setHiddenIfChanged(setupEl('nyw-clear-retry'), !(cs.state === 'error' || cs.state === 'offline'));
}

function paintNywStep5(out, next) {
  const d = nywUi.done;
  const dd = wizardDraftRead().done || {};
  const cleared = d ? d.members.cleared : (dd.cleared || 0);
  let rows = '';
  const add = (key, text, sub) => { rows += nywTallyRow(key, { mark: 'check' }, text, sub); };
  if (nywUi.a1Ran) add('a1', 'Editing turned on for the schedule', '');
  add('saved', (out || 'Last year') + ' saved', 'In Restore points, under Past years');
  add('cleared', 'Scoreboard cleared', '');
  if (cleared) add('members', cleared + ' ' + nywWord(cleared, 'counselor taken off their team', 'counselors taken off their teams'), '');
  setHtmlIfChanged(setupEl('nyw-done-list'), rows);
  const failed = d ? d.members.failed.concat(d.members.incomplete.filter((p) => !d.members.failed.some((f) => f.key === p.key))) : [];
  setHiddenIfChanged(setupEl('nyw-left'), !failed.length);
  if (failed.length) {
    setTextIfChanged(setupEl('nyw-left-q'), 'Couldn’t take ' + failed.length + ' ' + nywWord(failed.length, 'person', 'people') + ' off their teams: their sign-in records are incomplete.');
    setHtmlIfChanged(setupEl('nyw-left-list'), failed.map((p) => '<li>' + esc(p.name) + '</li>').join(''));
  }
  const skip = !!(setupTree.meta && setupTree.meta.skip && setupTree.meta.skip.campers);
  setHiddenIfChanged(document.querySelector('[data-nyw-go="campers"]'), skip);
  const undo = nywUndoRowNow();
  const until = undo && undo.row ? nywUndoUntil(undo) : '';
  setTextIfChanged(setupEl('nyw-done-undo-text'), until ? 'Changed your mind? Undo the new-year setup is in the ⋯ menu until ' + until + '.' : 'Changed your mind? Undo the new-year setup is in the ⋯ menu for ' + WIZARD_UNDO_DAYS + ' days.');
  const check = document.querySelector('#nyw-done-list .nyw-t-n[data-mark="check"]');
  if (check && !check.__popped && typeof JellyMotion !== 'undefined') {
    check.__popped = true;
    JellyMotion.play(check, 'snap', (x) => ({ opacity: Math.min(1, x * 2), transform: 'scale(' + (0.3 + 0.7 * x) + ') rotate(' + (-14 * (1 - Math.min(1, x))) + 'deg)' }), { calm: [{ opacity: 0 }, { opacity: 1 }] });
  }
}

function nywUndoUntil(offer) {
  const at = (state.meta && state.meta.epochAt) || offer.row.at;
  try { return new Date(at + WIZARD_UNDO_DAYS * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: CAMP_TZ }); } catch (e) { return ''; }
}

function paintNywDock(m, a, out) {
  const me = m.mode === 'me';
  const step = m.step;
  const cs = nywUi.clear;
  const holding = me && step === 4;
  setHiddenIfChanged(document.querySelector('.nyw-dock-pair'), holding);
  setHiddenIfChanged(setupEl('nyw-back'), step === 1 || step === 5);
  const nextBtn = setupEl('nyw-next');
  const why = me ? nywNextWhy(m, a) : '';
  // Step 5 has ONE next action, the filled "1 Put people on teams" in the list: the dock is a plain Done (back to the
  // checklist), never a second gold.
  const label = step === 1 ? 'Next: what carries over' : step === 2 ? 'Next: save ' + (out || 'last year') : step === 3 ? 'Next: clear the scoreboard' : 'Done';
  setTextIfChanged(nextBtn, why || label);
  if (nextBtn) {
    const dis = !!why; if ((nextBtn.getAttribute('aria-disabled') === 'true') !== dis) { if (dis) nextBtn.setAttribute('aria-disabled', 'true'); else nextBtn.removeAttribute('aria-disabled'); }
    const gold = step !== 5; if (nextBtn.classList.contains('btn-gold') !== gold) nextBtn.classList.toggle('btn-gold', gold);
  }
  const busy = cs.state === 'saving';
  // No signal: the dashed well in the hold's place (the hold could only be refused after 1.2 s); it comes back with the signal.
  const online = restoreOnline();
  const hold = setupEl('nyw-hold-btn');
  setHiddenIfChanged(setupEl('nyw-hold-wait'), !(holding && !cs.reveal && !busy && !online));
  setHiddenIfChanged(hold, !(holding && !cs.reveal && !busy && online));
  const holdText = 'Hold to clear ' + campWord() + '’s scoreboard';
  setTextIfChanged(setupEl('nyw-hold-label'), holdText);
  setTextIfChanged(setupEl('nyw-hold-fill-label'), holdText);
  setHiddenIfChanged(setupEl('nyw-hold-confirm'), !(holding && cs.reveal && !busy));
  setTextIfChanged(setupEl('nyw-hold-confirm'), 'Yes, clear ' + campWord() + '’s scoreboard');
  setHiddenIfChanged(setupEl('nyw-hold-cancel'), !(holding && cs.reveal && !busy));
  // While the two-tap confirm is up, Cancel is the way out: Back beside it read as a second one.
  setHiddenIfChanged(setupEl('nyw-back-quiet'), !(holding && !busy && !cs.reveal));
  setTextIfChanged(setupEl('nyw-back-quiet-text'), 'Back to Save ' + (out || 'last year'));
}

// ── taps ─────────────────────────────────────────────────────────────

function wireNyw() {
  const root = setupEl('setup-wizard');
  if (!root || root.__wired) return;
  root.__wired = true;
  const on = (sel, ev, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); };
  on('#nyw-start', 'change', (e) => nywSetDate(e.target.value));
  on('#nyw-snap-use', 'click', (e) => { const s = e.currentTarget.dataset.sunday; if (s) nywSetDate(s); });
  root.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-nyw-double],[data-nyw-pick],[data-nyw-go]') : null;
    if (!t) return;
    if (t.dataset.nywDouble) nywSetDouble(t.dataset.nywDouble);
    else if (t.dataset.nywPick) { const row = t.closest('.nyw-item'); if (row) nywPick(row.dataset.nywItem, t.dataset.nywPick); }
    else if (t.dataset.nywGo) nywGoNext(t.dataset.nywGo);
  });
  ['#nyw-double-from', '#nyw-double-at', '#nyw-double-until'].forEach((id) => on(id, 'change', nywDoubleFromForm));
  on('#nyw-next', 'click', () => { nywNext(); });
  on('#nyw-back', 'click', () => { const m = nywModelNow(); if (m && m.step > 1 && m.step < 4) nywGo(m.step - 1); });
  on('#nyw-back-quiet', 'click', () => { nywUi.clear = { state: 'idle', why: '', reveal: false }; nywGo(3); });
  on('#nyw-watch', 'click', nywWatch);
  on('#nyw-takeover', 'click', () => { nywTakeOver(); });
  on('#nyw-ask-a', 'click', () => { if (nywUi.ask) nywUi.ask.a.run(); });
  on('#nyw-ask-b', 'click', () => { if (nywUi.ask) nywUi.ask.b.run(); });
  on('#nyw-save-retry', 'click', () => { nywUi.save = { state: 'idle', res: null, why: '' }; renderAll(); });
  on('#nyw-save-download', 'click', () => { nywDownloadCopy(); });
  on('#nyw-clear-retry', 'click', () => { nywUi.clear = { state: 'idle', why: '', reveal: false }; renderAll(); });
  on('#nyw-members-warn-btn', 'click', () => { peopleUi.from = ''; setupGo('people'); });
  on('#nyw-left-btn', 'click', () => { peopleUi.from = ''; setupGo('people'); });
  on('#nyw-staff-btn', 'click', () => { nywUi.staffOpen = true; setupSheet('nyw-staff'); });
  // The hold (Step 14's, 1.2 s) and its two-tap alternative.
  let armed = false;
  on('#nyw-hold-confirm', 'pointerdown', () => { armed = true; });
  on('#nyw-hold-confirm', 'click', (e) => { const ok = armed || e.detail === 0; armed = false; if (ok) nywRunClear(); });
  const hold = setupEl('nyw-hold-btn');
  const focusOn = (id) => { const b = setupEl(id); if (b && !b.hidden && typeof b.focus === 'function') { try { b.focus({ preventScroll: true }); } catch (x) { /* fine */ } } };
  if (hold) wireHold(hold, () => { nywRunClear(); }, () => { nywUi.clear.reveal = true; renderNywScreen(); focusOn('nyw-hold-confirm'); });
  on('#nyw-hold-cancel', 'click', () => { nywUi.clear.reveal = false; renderNywScreen(); focusOn('nyw-hold-btn'); });
  on('#nyw-hold-wait', 'click', () => { setupSay('No signal. Clearing needs a connection. Nothing has been cleared.'); });
  wireNywSheets();
}

function nywGoNext(go) {
  if (go === 'people-teams') { peopleUi.from = ''; setupGo('people'); peopleOpenTeams(); }
  else if (go === 'teams') setupGo('teams');
  else if (go === 'campers') setupGo('campers');
  else setupGo('hub');
}

// ── the sheets: items that name people, Undo the new-year setup, Advanced, a past year ────────────

function renderNywStaffSheet() {
  const list = setupEl('nyw-staff-list');
  if (!list) return;
  const rows = nywStaffItems();
  setHtmlIfChanged(list, rows.map((r) => '<div class="cb-row"><span class="cb-time">' + esc(typeof setupClock === 'function' ? setupClock(r.start) : '') + '</span><span class="cb-main"><span class="cb-title"><span class="sched-emo">' +
    esc(safeEmoji(r.emoji) || '') + '</span><span>' + esc(r.label) + '</span></span><span class="cb-sub">' + esc('Names ' + hubJoin(r.names)) + '</span></span></div>').join(''));
}

function nywUndoRowNow() {
  const rows = setupUi.restore && setupUi.restore.rows;
  return typeof wizardUndoPick === 'function' ? wizardUndoPick(rows) : null;
}

function nywOpenUndo(opener) {
  if (!requireOwner('undo the new-year setup')) return;
  const offer = nywUndoRowNow();
  if (!offer) { setupSay('There is no new-year setup to undo.'); return; }
  nywUi.undo = { rid: offer.rid, row: offer.row, offer, body: null, state: 'loading', why: '', reveal: false, busy: false };
  setupSheet('nyw-undo', opener);
  (async () => {
    let r;
    try { r = await restoreRead(offer.rid); } catch (e) { r = { ok: false, reason: 'offline' }; }
    const u = nywUi.undo;
    if (!u || u.rid !== offer.rid) return;
    if (r.ok) { u.body = r.body; u.state = 'ready'; } else { u.state = 'error'; u.why = r.reason; }
    renderNywUndoSheet();
  })();
}

function nywUndoYear(row) {
  const m = /^(20\d\d)/.exec(String((row && row.label) || ''));
  return m ? m[1] : '';
}

function renderNywUndoSheet() {
  const u = nywUi.undo;
  if (!u) return;
  const year = nywUndoYear(u.row);
  const when = u.row.at ? setupClockParts(u.row.at) : null;
  setTextIfChanged(setupEl('nyu-sub'), when ? 'Saved ' + when.day + ', ' + when.time + ', just before the setup' : '');
  setTextIfChanged(setupEl('nyu-lede'), campWord().replace(/^./, (x) => x.toUpperCase()) + ' goes back to the ' + (year || 'earlier') + ' week, exactly as it was saved.');
  const b = u.body;
  const st = b && setupIsMap(b.state) ? b.state : {};
  const c = wizardCounts(st);
  const meta = b && setupIsMap(b.setup) && setupIsMap(b.setup.meta) ? b.setup.meta : {};
  let back = '';
  if (c.results) back += nywTallyRow('results', c.results, nywWord(c.results, 'game result', 'game results'), '');
  if (c.bonuses) back += nywTallyRow('bonuses', c.bonuses, nywWord(c.bonuses, 'bonus point entry', 'bonus point entries'), '');
  if (c.brackets) back += nywTallyRow('brackets', c.brackets, nywWord(c.brackets, 'bracket in progress', 'brackets in progress'), '');
  if (typeof meta.weekStart === 'string' && weekHeadline(meta.weekStart)) back += nywTallyRow('week', { mark: 'item' }, 'Camp week · ' + weekHeadline(meta.weekStart), '');
  const dbl = wizardDoubleOk(meta.double) ? meta.double : (!(b && b.epoch) ? WIZARD_DOUBLE_SAME_LEGACY : null);
  if (dbl) back += nywTallyRow('double', { mark: 'item' }, 'Double points · ' + nywDoubleWords(dbl), '');
  back += nywTallyRow('week-data', { mark: 'item' }, 'The schedule, games, menus and verses as they were', '');
  back += nywTallyRow('history', { mark: 'item' }, 'The change history shows ' + (year || 'that year') + ' again', '');
  setHtmlIfChanged(setupEl('nyu-back'), u.state === 'ready' ? back : '');
  let stay = nywTallyRow('members', { mark: 'item' }, 'Counselors’ teams', 'As they are now. Put people on teams again in People');
  stay += nywTallyRow('campers', { mark: 'item' }, 'Campers', 'Not in the saved copy');
  const edited = typeof setupEditedAt === 'function' && setupEditedAt('schedule') > ((state.meta && state.meta.epochAt) || Infinity);
  if (edited) stay += nywTallyRow('since', { mark: 'item' }, 'Changes made since the setup', 'Kept in a restore point first');
  setHtmlIfChanged(setupEl('nyu-stay'), stay);
  const stEl = setupEl('nyu-state');
  const show = u.state === 'loading' || u.state === 'error' || u.busy || !!u.msg;
  setHiddenIfChanged(stEl, !show);
  if (show && stEl) {
    const tone = u.busy || u.state === 'loading' ? 'saving' : 'error';
    if (stEl.dataset.tone !== tone) stEl.dataset.tone = tone;
    setTextIfChanged(setupEl('nyu-state-text'), u.busy ? 'Putting ' + (year || 'last year') + ' back…' : u.state === 'loading' ? 'Reading the saved copy…' : u.msg || 'Couldn’t read the saved copy. Check your connection.');
  }
  const ready = u.state === 'ready' && !u.busy;
  // Short enough not to break "new-/year" at 360px; the sheet's title already says which camp and what it undoes.
  const holdText = 'Hold to put ' + (year || 'last year') + ' back';
  // No signal: the dashed well in the hold's place (the undo needs the server); the hold comes back with the signal.
  const online = restoreOnline();
  setHiddenIfChanged(setupEl('nyu-hold-btn'), !(ready && !u.reveal && online));
  setHiddenIfChanged(setupEl('nyu-hold-wait'), !(ready && !u.reveal && !online));
  setTextIfChanged(setupEl('nyu-hold-wait'), 'Needs a connection to put ' + (year || 'last year') + ' back');
  setTextIfChanged(setupEl('nyu-hold-label'), holdText);
  setTextIfChanged(setupEl('nyu-hold-fill-label'), holdText);
  setTextIfChanged(setupEl('nyu-hold-confirm'), 'Yes, put ' + (year || 'last year') + ' back');
  setHiddenIfChanged(setupEl('nyu-hold-confirm'), !(ready && u.reveal));
  setHiddenIfChanged(setupEl('nyu-hold-cancel'), !(ready && u.reveal));
}

async function nywRunUndo() {
  const u = nywUi.undo;
  if (!u || u.state !== 'ready' || u.busy || !shell.sheets.includes('nyw-undo')) return;
  if (!requireOwner('undo the new-year setup')) return;
  u.busy = true; u.msg = ''; u.reveal = false;
  renderNywUndoSheet();
  let r;
  try { r = await wizardUndo(u.rid); } catch (e) { r = { ok: false, reason: 'failed' }; }
  u.busy = false;
  if (!r.ok) {
    u.msg = r.reason === 'not-newest' ? 'A newer saved year exists, so this one can’t be undone.' : r.reason === 'nothing' ? 'There is nothing to undo any more.' : r.reason === 'pre-restore' ? 'Couldn’t save today’s week first, so nothing was changed.' : nywWhy(r);
    renderNywUndoSheet();
    return;
  }
  const year = nywUndoYear(u.row);
  nywUi.undo = null;
  shellSheetClose('nyw-undo');
  nywUi.done = null; nywUi.doneLeft = true;
  const d = wizardDraftRead(); d.done = null; wizardDraftWrite();
  showToast(campWord().replace(/^./, (x) => x.toUpperCase()) + ' is back to ' + (year || 'last year') + '. Today’s week is in Restore points.');
  refreshRestoreIndex();
  if (setupScreen() === 'wizard') setupGo('hub');
}

const ADV_STATE_WORDS = { schedule: 'schedule', meals: 'meals', verses: 'verses', cleanup: 'cleanup', electives: 'electives' };

function advStateOf(s) {
  const on = setupTree && setupTree.meta && setupTree.meta.on ? setupTree.meta.on[s] : undefined;
  return on === true ? 'on' : on === false ? 'off' : 'never';
}

function renderAdvancedSheet() {
  const electives = !!(CAMP.features && CAMP.features.electives);
  document.querySelectorAll('#sheet-setup-advanced [data-adv-section]').forEach((row) => {
    const s = row.dataset.advSection;
    if (row.hasAttribute('data-feature')) setHiddenIfChanged(row, !electives);
    const st = advStateOf(s);
    setTextIfChanged(row.querySelector('[data-adv-state]'), st === 'on' ? 'Edited here' : st === 'off' ? 'Showing the original · your edits are kept' : 'Never turned on');
    const dis = st === 'never';
    if ((row.getAttribute('aria-disabled') === 'true') !== dis) { if (dis) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled'); }
  });
}

// One question per section (askDialog, stack): what it is now, what starting again replaces, the choices.
async function advAsk(section) {
  if (!requireOwner('start a section again')) return;
  const st = advStateOf(section);
  if (st === 'never') { setupSay('That section was never turned on, so there is nothing to start again.'); return; }
  const noun = setupSectionWords(section);
  const extra = section === 'schedule' ? ' Games keep their schedule items where the item still exists.' : '';
  const choice = await askDialog({
    title: 'Start ' + noun + ' again?',
    body: ['Replaces what this camp has for ' + noun + ' with the copy that came with the app.' + extra, 'A restore point is saved first.'],
    stack: true,
    actions: [
      st === 'on' ? { label: 'Show the original instead', value: 'original', sub: 'Your edits are kept' } : { label: 'Use our edits again', value: 'edits', sub: 'Brings back what was edited here' },
      { label: 'Start again from the original', value: 'again', kind: 'danger', sub: 'Replaces ' + noun },
      { label: 'Not now', value: 'cancel', kind: 'quiet', cancel: true },
    ],
  });
  if (choice === 'original') {
    const r = setupUseOriginal([section]);
    setupSay(r.ok ? 'Showing the original ' + noun.replace(/^the /, '') + '. Your edits are kept.' : r.reason === 'owner' ? r.message : NYW_WHY.failed);
    return;
  }
  if (choice === 'edits') {
    const r = await setupTurnOn([section], {});
    setupSay(r.ok ? 'Your edits are back.' : (TURNON_WHY[r.reason] || r.message || TURNON_WHY.failed));
    return;
  }
  if (choice !== 'again') return;
  const opts = {};
  for (let guard = 0; guard < 4; guard++) {
    const r = await setupRestartSection(section, opts);
    if (r.ok) { setupSay('Started ' + noun.replace(/^the /, '') + ' again from the original.'); return; }
    if (r.reason === 'ask-camp-week') {
      const running = await askDialog({ title: 'Is a camp week running right now?', body: 'No dates are set, so the app can’t tell.', actions: [{ label: 'Not now', value: 'cancel', cancel: true }, { label: 'No, it’s not', value: 'no', kind: 'gold' }, { label: 'Yes, it is', value: 'yes' }] });
      if (running === 'cancel' || running === null) return;
      opts.campRunning = running === 'yes';
      continue;
    }
    if (r.reason === 'camp-week') {
      const go = await askDialog({ title: 'A camp week is running', body: ['Starting this again changes what counselors see.', 'Carry on anyway?'], actions: [{ label: 'Not now', value: 'wait', cancel: true }, { label: 'Carry on anyway', value: 'go', kind: 'danger' }] });
      if (go !== 'go') return;
      opts.overrideCampWeek = true;
      continue;
    }
    setupSay(r.reason === 'owner' ? r.message : r.reason === 'never' ? 'That section was never turned on.' : r.reason === 'restore-point' ? 'The restore point couldn’t be saved first, so nothing was changed.' : (TURNON_WHY[r.reason] || TURNON_WHY.failed));
    return;
  }
}

// A past year's point (restore sheet, kind archive): download it; the newest one, for the owner, undoes the setup.
function paintArchiveYear(rs) {
  const sheet = setupEl('sheet-restore');
  const arch = !!(rs && rs.row && rs.row.kind === 'archive');
  if (sheet) { const k = rs && rs.row ? rs.row.kind : ''; if (sheet.dataset.kind !== k) sheet.dataset.kind = k; }
  setHiddenIfChanged(setupEl('rp-year'), !arch);
  if (!arch) return;
  const year = nywUndoYear(rs.row);
  setTextIfChanged(setupEl('rp-year-download-title'), 'Download ' + (year || 'this year'));
  const owner = isOwner();
  const offer = nywUndoRowNow();
  const newest = !!(offer && offer.rid === rs.rid);
  setHiddenIfChanged(setupEl('rp-year-undo'), !(owner && newest));
  setTextIfChanged(setupEl('rp-year-undo-sub'), 'Puts ' + (year || 'that year') + ' back: its scores, dates and history');
  setHiddenIfChanged(setupEl('rp-year-owner'), owner || !newest);
  setTextIfChanged(setupEl('rp-year-owner-text'), ownerSays('can undo the new-year setup'));
}

function nywDownloadYear() {
  const rs = setupUi.rsheet;
  if (!rs || !rs.body || !rs.row) return;
  downloadBlob(new Blob([JSON.stringify(rs.body)], { type: 'application/json' }), 'camp-' + CAMP.id + '-' + (nywUndoYear(rs.row) || 'past-year') + '.json');
}

function wireNywSheets() {
  const on = (sel, ev, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); };
  on('#sheet-setup-advanced', 'click', (e) => { const r = e.target.closest && e.target.closest('[data-adv-section]'); if (r && r.getAttribute('aria-disabled') !== 'true') { shellSheetClose('setup-advanced'); advAsk(r.dataset.advSection); } else if (r) setupSay('That section was never turned on, so there is nothing to start again.'); });
  on('#setup-advanced-open', 'click', (e) => { if (isOwner()) setupSheet('setup-advanced', e.currentTarget); });
  on('#rp-year-download', 'click', nywDownloadYear);
  on('#rp-year-undo', 'click', (e) => { if (isOwner()) nywOpenUndo(e.currentTarget); });
  let armed = false;
  on('#nyu-hold-confirm', 'pointerdown', () => { armed = true; });
  on('#nyu-hold-confirm', 'click', (e) => { const ok = armed || e.detail === 0; armed = false; if (ok) nywRunUndo(); });
  const hold = setupEl('nyu-hold-btn');
  const focusOn = (id) => { const b = setupEl(id); if (b && !b.hidden && typeof b.focus === 'function') { try { b.focus({ preventScroll: true }); } catch (x) { /* fine */ } } };
  if (hold) wireHold(hold, () => { nywRunUndo(); }, () => { if (nywUi.undo && shell.sheets.includes('nyw-undo')) { nywUi.undo.reveal = true; renderNywUndoSheet(); focusOn('nyu-hold-confirm'); } });
  on('#nyu-hold-cancel', 'click', () => { if (nywUi.undo) { nywUi.undo.reveal = false; renderNywUndoSheet(); focusOn('nyu-hold-btn'); } });
  on('#nyu-hold-wait', 'click', () => { setupSay('No signal. Putting last year back needs a connection. Nothing has changed.'); });
}

// ── the doors ────────────────────────────────────────────────────────

HUB_DOOR_ACTIONS['new-year'] = nywStart;
HUB_DOOR_ACTIONS.wizard = nywStart;
SETUP_OWNER_ACTIONS['new-year'] = { run: nywStart, why: () => (typeof campWeek === 'function' && campWeek().phase === 'during' ? 'Not during camp week' : '') };
SETUP_OWNER_ACTIONS['undo-new-year'] = {
  run: () => nywOpenUndo(),
  why: () => { const o = nywUndoRowNow(); return !o ? 'Nothing to undo yet' : o.recent ? '' : 'More than ' + WIZARD_UNDO_DAYS + ' days ago: find it under Past years'; },
};
SETUP_OWNER_ACTIONS.advanced = { run: () => setupSheet('setup-advanced'), advanced: true };

// ── 18. The Notice board screen (Step 30) ────────────────────────────
// state.notice as a screen of the frame (markup: index.html `#setup-notice`, its comment names every hook). There is ONE write
// path: the notice object is edited in place (noticeBoard()) and saved whole with saveState() — the same path Tell everyone's pin
// and setNoticeStatus use — never a second copy. Every handler reads the notice AT CALL TIME (a snapshot replaces the object), and
// a team's area is addressed by its team id, never by its position in the array. A field commits on its native `change` (blur,
// and only when it changed since focus) and the painter never writes a focused field.

const noticeUi = { from: '', pend: '', wired: false };

// More → Set up the week → Notice, or Tell everyone's "Write a full notice" (`from: 'tell'`: Back then comes home to the composer).
function setupOpenNotice(from) {
  if (typeof canEdit === 'function' && !canEdit()) return;
  noticeUi.pend = from || '';
  openBuilder(undefined, 'notice');
}

function noticeHasWords(n) {
  return !!(n.title || n.sub || n.signoff || n.zones.length || n.steps.length);
}

// The screen as plain data: the one `state` the CSS switches on, the words, the rows. Pure over the notice and the roster.
function nbsModel() {
  const n = noticeBoard();
  const ids = teamIds();
  const words = noticeHasWords(n);
  const posted = n.status === 'posted';
  const state_ = posted ? (words ? 'posted' : 'hollow') : (words ? 'draft' : 'empty');
  const zoneOf = (id) => n.zones.find((z) => z.teamId === id) || null;
  const on = (z) => !!(z && (z.place || z.note));
  const listed = [];
  n.zones.forEach((z) => { if (ids.indexOf(z.teamId) !== -1 && on(z) && z === zoneOf(z.teamId) && listed.indexOf(z.teamId) === -1) listed.push(z.teamId); });
  const rest = ids.filter((id) => listed.indexOf(id) === -1);
  const zones = listed.concat(rest).map((id, i) => ({ key: 'z-' + id, id, zone: on(zoneOf(id)) ? zoneOf(id) : null, first: i === 0 }));
  const copy = {
    empty: ['Nothing written yet', 'Write it here, then put it on every phone when it’s ready.'],
    draft: ['A draft only directors see', 'Counselors see nothing until you put it on every phone. Edit it as long as you like.'],
    posted: ['On every phone', 'It’s at the top of Now for everyone. Changes show there as you make them.'],
    hollow: ['Nothing to show', 'It’s switched on, but phones show nothing until something is written here.'],
  }[state_];
  // The picture is a counselor's: the director's own team if the notice lists it, else the first team it lists.
  const mine = typeof nowMyTeam === 'function' ? nowMyTeam() : '';
  const previewTeam = listed.indexOf(mine) !== -1 ? mine : (listed[0] || '');
  return {
    n, state: state_, headline: copy[0], lede: copy[1], zones, listedCount: listed.length, total: ids.length, previewTeam,
    steps: n.steps.map((s, i) => ({ key: 's-' + i, i, step: s })),
  };
}

function nbsPlural(n, one, many) { return n === 1 ? one : many; }

function nbsZoneHtml(r) {
  const id = esc(r.id);
  const nm = esc(teamName(r.id));
  return '<div class="nbs-zone" data-key="' + esc(r.key) + '" data-team="' + id + '" data-empty>' +
    '<span class="nbs-mark"></span>' +
    '<p class="nbs-zone-name"><span class="nbs-zone-nm">' + nm + '</span><small>Not on the notice</small></p>' +
    '<button type="button" class="nbs-up nb-zone-move" data-team="' + id + '" data-dir="-1" aria-label="Move ' + nm + ' up" hidden><svg class="ico" aria-hidden="true"><use href="#i-up"/></svg></button>' +
    '<span class="nbs-zone-flds">' +
    '<textarea class="fld-input nbs-grow nb-zone-place" data-team="' + id + '" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Where they go" aria-label="Where ' + nm + ' go"></textarea>' +
    '<textarea class="fld-input nbs-grow nb-zone-note" data-team="' + id + '" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Small print (optional)" aria-label="Small print for ' + nm + ' (optional)"></textarea>' +
    '</span></div>';
}

function nbsStepHtml(r) {
  const i = r.i;
  const nth = 'Step ' + (i + 1);
  return '<div class="nbs-step" data-key="' + esc(r.key) + '" data-step="' + i + '">' +
    '<span class="nbs-num" aria-hidden="true">' + (i + 1) + '</span>' +
    '<span class="nbs-step-head">' +
    '<input type="text" class="fld-input nbs-emo nb-step-emoji" data-idx="' + i + '" maxlength="16" autocomplete="off" placeholder="+" aria-label="' + nth + ' emoji (optional)">' +
    '<textarea class="fld-input nbs-grow nbs-when nb-step-when" data-idx="' + i + '" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Heading, like “In your area”" aria-label="' + nth + ' heading"></textarea>' +
    '</span>' +
    '<textarea class="fld-input nbs-grow nb-step-items" data-idx="' + i + '" rows="2" placeholder="One instruction per line" aria-label="' + nth + ', one instruction per line"></textarea>' +
    '<span class="nbs-acts">' +
    (i > 0 ? '<button type="button" class="btn-quiet nb-step-move" data-idx="' + i + '" data-dir="-1">Move up</button>' : '') +
    '<button type="button" class="btn-quiet btn-quiet-danger nb-step-remove" data-idx="' + i + '">Remove step</button>' +
    '</span></div>';
}

function nbsSetAttr(el, name, v) {
  if (el && el.getAttribute(name) !== v) el.setAttribute(name, v);
}

function nbsZonePatch(el, r) {
  const q = (s) => el.querySelector(s);
  secSetFlag(el, 'data-empty', !r.zone);
  paintTeamMark(q('.nbs-mark'), r.id, { size: 28 });
  const nm = teamName(r.id);
  setTextIfChanged(q('.nbs-zone-nm'), nm);
  const up = q('.nbs-up');
  setHiddenIfChanged(up, !(r.zone && !r.first));
  nbsSetAttr(up, 'aria-label', 'Move ' + nm + ' up');
  const place = q('.nb-zone-place');
  const note = q('.nb-zone-note');
  nbsSetAttr(place, 'aria-label', 'Where ' + nm + ' go');
  nbsSetAttr(note, 'aria-label', 'Small print for ' + nm + ' (optional)');
  secSetValue(place, r.zone ? r.zone.place : '');
  secSetValue(note, r.zone ? r.zone.note : '');
  secGrow(place); secGrow(note);
}

function nbsStepPatch(el, r) {
  const q = (s) => el.querySelector(s);
  secSetValue(q('.nb-step-emoji'), r.step.emoji);
  const when = q('.nb-step-when');
  const items = q('.nb-step-items');
  secSetValue(when, r.step.when);
  secSetValue(items, r.step.items.join('\n'));
  secGrow(when); secGrow(items);
}

// A list of keyed rows kept in place: a row that is gone leaves, a new one is built and arrives, the rest are patched (a
// focused field keeps its text and caret) and, when the order changed, glide to their new places (calm: they just move).
// Nodes are moved only when they must be (a moved node drops its focus). Without a live DOM (the test stub) it is one plain write.
function nbsSyncRows(list, rows, build, patch) {
  if (!list) return;
  if (!list.children || typeof list.insertBefore !== 'function' || typeof document.createElement !== 'function') {
    setHtmlIfChanged(list, rows.map(build).join(''));
    return;
  }
  const kids = Array.prototype.slice.call(list.children);
  const byKey = {};
  const before = {};
  kids.forEach((k) => {
    const key = k.dataset && k.dataset.key;
    if (!key) { k.remove(); return; }
    byKey[key] = k;
    const r = k.getBoundingClientRect ? k.getBoundingClientRect() : null;
    if (r) before[key] = { x: r.left, y: r.top };
  });
  const want = rows.map((r) => r.key);
  Object.keys(byKey).forEach((k) => { if (want.indexOf(k) === -1 && !byKey[k].__leaving) { byKey[k].remove(); delete byKey[k]; } });
  const fresh = [];
  let prev = null;
  rows.forEach((r) => {
    let el = byKey[r.key];
    if (!el) {
      const t = document.createElement('div');
      t.innerHTML = build(r);
      el = t.firstElementChild || t.children[0];
      if (!el) return;
      fresh.push(el);
    }
    const ref = prev ? prev.nextSibling : list.firstChild;
    if (ref !== el) list.insertBefore(el, ref);
    prev = el;
    patch(el, r);
  });
  const motion = typeof JellyMotion !== 'undefined' && typeof calmMotion === 'function' && !calmMotion();
  if (!motion) return;
  rows.forEach((r) => {
    const el = byKey[r.key];
    if (!el) return;
    if (fresh.indexOf(el) !== -1) { if (Object.keys(before).length) secArrive(el); return; }
    const b = before[r.key];
    if (!b || !el.getBoundingClientRect) return;
    const nr = el.getBoundingClientRect();
    const dx = b.x - nr.left;
    const dy = b.y - nr.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    JellyMotion.play(el, 'glide', (x) => ({ transform: 'translate(' + dx * (1 - x) + 'px,' + dy * (1 - x) + 'px)' }), { calm: false, layer: true });
  });
}

function renderNoticeScreen() {
  const root = setupEl('setup-notice');
  if (!root) return;
  const m = nbsModel();
  const n = m.n;
  setDataIfChanged(root, 'state', m.state);
  setTextIfChanged(setupEl('nbs-title'), 'Notice board · ' + campWord());
  setTextIfChanged(setupEl('nbs-headline'), m.headline);
  setTextIfChanged(setupEl('nbs-lede'), m.lede);
  // The three plain fields. The stored small label (`eyebrow`) has no field: no phone draws it, but the strip falls back to it
  // when the heading is empty, so the heading shows it as its hint then.
  root.querySelectorAll('[data-nb-field]').forEach((el) => {
    const f = el.dataset.nbField;
    secSetValue(el, n[f] || '');
    if (f === 'title') nbsSetAttr(el, 'placeholder', n.eyebrow ? n.eyebrow : 'Like “Where your team cleans”');
    secGrow(el);
  });
  setTextIfChanged(setupEl('nbs-zones-note'), m.listedCount ? m.listedCount + ' of ' + m.total + ' listed' : 'None listed yet');
  nbsSyncRows(setupEl('nbs-zones'), m.zones, nbsZoneHtml, nbsZonePatch);
  setTextIfChanged(setupEl('nbs-steps-note'), m.steps.length ? m.steps.length + ' ' + nbsPlural(m.steps.length, 'step', 'steps') : 'None yet');
  nbsSyncRows(setupEl('nbs-steps'), m.steps, nbsStepHtml, nbsStepPatch);
  // A counselor's phone, as it draws the notice (phones show nothing for a notice with no words: CSS hides the picture then).
  const showPic = m.state === 'draft' || m.state === 'posted';
  const team = m.previewTeam;
  setTextIfChanged(setupEl('nbs-preview-label'), team ? 'On a ' + (teamShort(team) || teamName(team)) + ' counselor’s phone' : 'On a counselor’s phone');
  setHtmlIfChanged(setupEl('nbs-preview'), showPic ? (noticeCardHtml(true, n, team ? { team } : undefined) || '') : '');
  const post = setupEl('nbs-post');
  if (post) {
    nbsSetAttr(post, 'aria-disabled', m.state === 'empty' ? 'true' : 'false');
    setTextIfChanged(setupEl('nbs-post-label'), m.state === 'empty' ? 'Write the notice first' : 'Put it on every phone');
  }
}

// ── the edits (each reads the live notice; each returns whether it changed anything) ──
function nbsOneLine(v) { return String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim(); }
function nbsLines(v) { return String(v == null ? '' : v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }

function nbsCommit() {
  saveState();
  renderAll();
}

function nbsSetField(field, value) {
  if (!canEdit() || ['title', 'sub', 'signoff'].indexOf(field) === -1) return false;
  const n = noticeBoard();
  const v = nbsOneLine(value);
  if (n[field] === v) return false;
  n[field] = v;
  nbsCommit();
  return true;
}

function nbsZoneSet(team, patch) {
  if (!canEdit() || teamIds().indexOf(team) === -1) return false;
  const n = noticeBoard();
  const i = n.zones.findIndex((z) => z.teamId === team);
  const z = i === -1 ? null : n.zones[i];
  const place = patch.place !== undefined ? nbsOneLine(patch.place) : z ? z.place : '';
  const note = patch.note !== undefined ? nbsOneLine(patch.note) : z ? z.note : '';
  if (!z) {
    if (!place) return false; // small print without a place puts nobody on the notice
    n.zones.push({ teamId: team, place, note });
  } else if (!place && patch.place !== undefined) {
    n.zones.splice(i, 1); // clearing the place takes the team off the notice
  } else if (z.place === place && z.note === note) {
    return false;
  } else {
    z.place = place; z.note = note;
  }
  nbsCommit();
  return true;
}

// Move a team's area up one place among the teams the notice lists (a team the roster no longer has is stepped over).
function nbsZoneUp(team) {
  if (!canEdit()) return false;
  const n = noticeBoard();
  const ids = teamIds();
  const i = n.zones.findIndex((z) => z.teamId === team);
  if (i === -1) return false;
  let j = i - 1;
  while (j >= 0 && ids.indexOf(n.zones[j].teamId) === -1) j--;
  if (j < 0) return false;
  const t = n.zones[i]; n.zones[i] = n.zones[j]; n.zones[j] = t;
  nbsCommit();
  return true;
}

function nbsStepSet(idx, patch) {
  if (!canEdit()) return false;
  const st = noticeBoard().steps[idx];
  if (!st) return false;
  let changed = false;
  if (patch.emoji !== undefined && st.emoji !== patch.emoji.trim()) { st.emoji = patch.emoji.trim(); changed = true; }
  if (patch.when !== undefined && st.when !== nbsOneLine(patch.when)) { st.when = nbsOneLine(patch.when); changed = true; }
  if (patch.items !== undefined) {
    const items = nbsLines(patch.items);
    if (JSON.stringify(items) !== JSON.stringify(st.items)) { st.items = items; changed = true; }
  }
  if (changed) nbsCommit();
  return changed;
}

function nbsStepAdd() {
  if (!canEdit()) return false;
  noticeBoard().steps.push({ emoji: '', when: '', items: [] });
  nbsCommit();
  // The new step's heading is where the director types next.
  const f = setupEl('nbs-steps') && setupEl('nbs-steps').querySelector ? setupEl('nbs-steps').querySelector('.nbs-step:last-child .nb-step-when') : null;
  if (f && typeof f.focus === 'function') { try { f.focus({ preventScroll: false }); } catch (e) { /* fine */ } }
  return true;
}

function nbsStepUp(idx) {
  if (!canEdit()) return false;
  const steps = noticeBoard().steps;
  if (!(idx > 0 && idx < steps.length)) return false;
  const t = steps[idx]; steps[idx] = steps[idx - 1]; steps[idx - 1] = t;
  nbsCommit();
  return true;
}

function nbsStepRemove(idx, row) {
  if (!canEdit() || !noticeBoard().steps[idx]) return false;
  const go = () => { if (canEdit() && noticeBoard().steps[idx]) { noticeBoard().steps.splice(idx, 1); nbsCommit(); } };
  if (row && typeof playRowOut === 'function') playRowOut(row, go); else go();
  return true;
}

async function nbsPost() {
  if (!canEdit()) return;
  if (!noticeHasWords(noticeBoard())) { nbsFocusHeading(); return; }
  const choice = await askDialog({
    title: 'Put the notice on every phone now?',
    body: 'Everyone with Camp open sees it at the top of Now.',
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: 'Put it on every phone', value: 'go', kind: 'gold' }],
  });
  if (choice === 'go' && canEdit()) setNoticeStatus('posted');
}

function nbsDown() {
  if (!canEdit()) return;
  if (typeof tellNoticeDown === 'function') tellNoticeDown(); else setNoticeStatus('draft', { celebrate: false });
}

async function nbsStartOver(kind) {
  if (!canEdit()) return;
  const reset = kind === 'reset';
  const choice = await askDialog({
    title: reset ? 'Start again from the cleanup example?' : 'Clear the whole notice?',
    body: (reset ? 'What’s written here is replaced by the cleanup example.' : 'Everything written here is removed.') + (noticeBoard().status === 'posted' ? ' It comes down from every phone and stays here as a draft.' : ' It stays a draft.'),
    actions: [{ label: 'Not now', value: 'no', cancel: true }, { label: reset ? 'Replace it' : 'Clear it', value: 'go', kind: 'danger' }],
  });
  if (choice !== 'go' || !canEdit()) return;
  state.notice = reset ? Object.assign(defaultNotice(), { status: 'draft' }) : { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
  nbsCommit();
}

function nbsFocusHeading() {
  const h = document.querySelector ? document.querySelector('#setup-notice .nbs-heading') : null;
  if (h && typeof h.focus === 'function') { try { h.focus(); } catch (e) { /* fine */ } }
}

// Enter finishes a one-line field: on to the next field, or off the keyboard after the last.
function nbsNextField(el) {
  const root = setupEl('setup-notice');
  const all = root && root.querySelectorAll ? Array.prototype.filter.call(root.querySelectorAll('textarea, input'), (f) => f.offsetParent !== null) : [];
  const nxt = all[all.indexOf(el) + 1];
  if (nxt && typeof nxt.focus === 'function') nxt.focus(); else if (typeof el.blur === 'function') el.blur();
}

function wireNoticeScreen() {
  if (noticeUi.wired) return;
  const root = setupEl('setup-notice');
  if (!root || typeof root.addEventListener !== 'function') return;
  noticeUi.wired = true;
  const q = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    if (el.dataset.nbField) nbsSetField(el.dataset.nbField, el.value);
    else if (el.classList.contains('nb-zone-place')) nbsZoneSet(el.dataset.team, { place: el.value });
    else if (el.classList.contains('nb-zone-note')) nbsZoneSet(el.dataset.team, { note: el.value });
    else if (el.classList.contains('nb-step-emoji')) nbsStepSet(+el.dataset.idx, { emoji: el.value });
    else if (el.classList.contains('nb-step-when')) nbsStepSet(+el.dataset.idx, { when: el.value });
    else if (el.classList.contains('nb-step-items')) nbsStepSet(+el.dataset.idx, { items: el.value });
  });
  root.addEventListener('input', (e) => { if (e.target && e.target.classList && e.target.classList.contains('nbs-grow')) secGrow(e.target); });
  root.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && el && el.hasAttribute && el.hasAttribute('data-oneline')) { e.preventDefault(); nbsNextField(el); }
  });
  root.addEventListener('click', (e) => {
    let b;
    if ((b = q(e, '.nb-zone-move'))) {
      const team = b.dataset.team;
      if (nbsZoneUp(team)) { // the button may have gone (the first row has none): keep the focus in the row
        const row = root.querySelector('.nbs-zone[data-team="' + team + '"]');
        const up = row && row.querySelector('.nbs-up');
        const to = up && !up.hidden ? up : row && row.querySelector('.nb-zone-place');
        if (to && typeof to.focus === 'function') { try { to.focus({ preventScroll: true }); } catch (x) { /* fine */ } }
      }
    } else if ((b = q(e, '.nb-step-move'))) nbsStepUp(+b.dataset.idx);
    else if ((b = q(e, '.nb-step-remove'))) nbsStepRemove(+b.dataset.idx, b.closest('.nbs-step'));
    else if (q(e, '#nbs-add-step')) nbsStepAdd();
    else if (q(e, '#nbs-post')) nbsPost();
    else if (q(e, '#nbs-down')) nbsDown();
    else if (q(e, '#nbs-reset')) nbsStartOver('reset');
    else if (q(e, '#nbs-clear')) nbsStartOver('clear');
  });
}
