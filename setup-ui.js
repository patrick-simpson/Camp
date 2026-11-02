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
// is not listed: the step that builds its screen turns the div into a button and adds its line here.
const HUB_OPENS = {
  games: { screen: 'classic', tab: 'games' },
  teams: { screen: 'classic', tab: 'teams' },
  notice: { screen: 'classic', tab: 'notice' },
  people: { drawer: 'members' },
  restore: { screen: 'backups' },
};
// The front door's buttons, owner only (Q8). A button exists only when its action does: the steps that
// build Edit the week here (15) and the new-year wizard (28) put a function here. Until then the door
// just says what is true and nobody is offered a button that can only fail.
const HUB_DOOR_ACTIONS = { original: null, 'new-year': null };

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
      const range = hubWeekRange(v.weekStart);
      return hubMark('soon', range || 'No dates set yet', []);
    }
    case 'schedule':
      return hubMark('soon', v.setupTooNew ? 'Made with a newer version — reload to see it' : (v.on && v.on.schedule ? 'Edited here' : HUB_ORIGINAL.schedule), []);
    case 'campers':
      return hubMark('soon', 'Camper lists come later', []);
    case 'meals': case 'verses': case 'cleanup': case 'electives':
      return hubMark('soon', v.on && v.on[section] ? 'Edited here' : HUB_ORIGINAL[section], []);
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
  };
}

// ── 2. The frame: screens, navigation, the head ──────────────────────

// #setup[data-screen] is the ONE switch the CSS reads (styles.css "SET UP THE WEEK"): hub | backups |
// classic. A step that adds a screen adds its name here and its pair of lines in the CSS.
const SETUP_SCREENS = ['hub', 'backups', 'classic'];
// Shell sheets this layer owns (shellSheetOpen ids; the elements are #sheet-<id>), one at a time.
const SETUP_SHEETS = ['setup-menu', 'setup-changes', 'setup-devices', 'restore'];
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
    const prob = st.problems[0] || '';
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
  setTextIfChanged(setupEl('setup-back-label'), screen === 'hub' ? cameFrom : 'Set up the week');
  paintSetupSync();
  paintSetupHere();
  paintSetupDock();
  setupMoveHere();
  if (screen === 'hub') paintHub();
  else if (screen === 'backups') renderBackups();
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
}

// Whether a setup sheet has anything to show (app.js shellSheetAllowed): the restore sheet needs a point
// that a tap opened, so a Forward or a stale history entry cannot raise an empty one.
function setupSheetReady(id) {
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
