// Step 29 shared drawer for the two audits (step29-pass.cjs, step29-contrast.cjs): the list of every mockup screen and every
// screen built since, the page-side helpers that put the real renderers in a known state (no Firebase, every section on as live),
// and a launcher. Serve the worktree first:  python3 -m http.server 8977   (BASE=http://localhost:8977/)
// A view: { n name, who counselor|director|owner|dteam, now '<dow>-<hhmm>' (?now= clock door), go page JS, root measured selector, camps }.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8977/';
const VIEWS = [
  { n: 'now-games', who: 'counselor', now: '3-1030', go: 'S.games(3)' },
  { n: 'now-games-dir', who: 'director', now: '3-1030', go: 'S.games(3)' },
  { n: 'now-legacy-start', who: 'counselor', now: '4-1700', camps: ['senior'] },
  { n: 'now-legacy-s2', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'L' })" },
  { n: 'now-legacy-third', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'W12', third: 'L' })" },
  { n: 'now-legacy-final', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'W12', third: 'W3', final: 'L' })" },
  { n: 'now-legacy-done', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'W12', third: 'W3', final: 'W0' })" },
  { n: 'now-legacy-recheck', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'W12', third: 'W3', recheck: true })" },
  { n: 'now-legacy-dir', who: 'director', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'L' })" },
  { n: 'now-meal', who: 'counselor', now: '3-1215' },
  { n: 'now-after-lunch', who: 'counselor', now: '3-1310' },
  { n: 'now-bible', who: 'counselor', now: 'bible' },
  { n: 'now-bible-dir', who: 'director', now: 'bible' },
  { n: 'now-elective', who: 'counselor', now: '3-1415', camps: ['junior'] },
  { n: 'now-morning', who: 'counselor', now: '3-0600' },
  { n: 'now-night', who: 'counselor', now: '3-2330' },
  { n: 'now-arrival', who: 'counselor', now: '0-1500' },
  { n: 'now-sendoff', who: 'counselor', now: '6-0900' },
  { n: 'now-supper', who: 'counselor', now: '3-1800' },
  { n: 'schedule', who: 'counselor', now: '3-1030', go: 'openSchedule()', root: '#schedule-overlay' },
  { n: 'team-sheet', who: 'counselor', now: '3-1030', go: "document.getElementById('hdr-id').click()", root: '#sheet-team' },
  { n: 'games-tab', who: 'counselor', now: '3-1030', go: "S.games(3); showTab('games')" },
  { n: 'games-tab-dir', who: 'director', now: '3-1030', go: "S.games(3); showTab('games')" },
  { n: 'game-podium', who: 'director', now: '3-1030', go: 'S.podium()', root: '#takeover-game' },
  { n: 'game-saved', who: 'director', now: '3-1030', go: 'S.games(3); S.openDone()', root: '#takeover-game' },
  { n: 'game-legacy-dir', who: 'director', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'L' }); S.openLegacy()", root: '#takeover-game' },
  { n: 'game-legacy-cou', who: 'counselor', now: '4-1700', camps: ['senior'], go: "S.b4({ s1: 'W03', s2: 'L' }); S.openLegacy()", root: '#takeover-game' },
  { n: 'game-tally-dir', who: 'director', now: '3-1030', go: "var gs = S.games(3); openGame(gs[1].id, { from: 'now' })", root: '#takeover-game' , camps: ['junior']},
  { n: 'game-tally-cou', who: 'counselor', now: '3-1030', go: "var gs = S.games(3); openGame(gs[1].id, { from: 'now' })", root: '#takeover-game' , camps: ['junior']},
  { n: 'game-six-dir', who: 'director', now: '1-1030', camps: ['junior'], go: "openGame('kangaroo-kickball', { from: 'now' })", root: '#takeover-game' },
  { n: 'game-six-cou', who: 'counselor', now: '1-1030', camps: ['junior'], go: "openGame('kangaroo-kickball', { from: 'now' })", root: '#takeover-game' },
  { n: 'chat', who: 'counselor', now: '3-1030', go: "showTab('chat')" },
  { n: 'more-cou', who: 'counselor', now: '3-1030', go: "showTab('more')" },
  { n: 'more-dir', who: 'director', now: '3-1030', go: "showTab('more')" },
  { n: 'verse-sheet', who: 'counselor', now: '3-1030', go: "showTab('more'); shellSheetOpen('verse')", root: '#sheet-verse' },
  { n: 'verse-sheet-dir', who: 'director', now: '3-1030', go: "showTab('more'); shellSheetOpen('verse')", root: '#sheet-verse' },
  { n: 'cleanup-sheet', who: 'counselor', now: '3-1030', go: "showTab('more'); shellSheetOpen('cleanup')", root: '#sheet-cleanup' },
  { n: 'cleanup-sheet-dir', who: 'director', now: '3-1030', go: "showTab('more'); shellSheetOpen('cleanup')", root: '#sheet-cleanup' },
  // senior ships with an empty rota and a placeholder verse: fill one verse day and one cleanup meal so those sheets are really audited
  { n: 'verse-sheet-filled', who: 'counselor', now: '3-1030', camps: ['senior'], go: "setupTree.verses.days.wed = { text: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', ref: 'Joshua 1:9' }; setupTree.cleanup.wed = { lunch: { t0: true, t1: true }, supper: { t2: true } }; setupRev++; showTab('more'); shellSheetOpen('verse')", root: '#sheet-verse' },
  { n: 'cleanup-sheet-filled', who: 'counselor', now: '3-1030', camps: ['senior'], go: "setupTree.verses.days.wed = { text: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', ref: 'Joshua 1:9' }; setupTree.cleanup.wed = { lunch: { t0: true, t1: true }, supper: { t2: true } }; setupRev++; showTab('more'); shellSheetOpen('cleanup')", root: '#sheet-cleanup' },
  { n: 'counselors-sheet', who: 'director', now: '3-1030', go: "showTab('more'); shellSheetOpen('counselors')", root: '#sheet-counselors' },
  { n: 'remote', who: 'director', now: '3-1930', go: 'openReveal()', root: '#takeover-reveal' },
  { n: 'tell', who: 'director', now: '3-1030', go: "openTool('tell')", root: '#takeover-tell' },
  { n: 'award', who: 'director', now: '3-1030', go: "openTool('award')", root: '#takeover-award' },
  { n: 'preview-now', who: 'director', now: '3-1030', go: 'S.games(3); previewStart(); showTab(\'now\')' },
  { n: 'preview-more', who: 'director', now: '3-1030', go: "previewStart(); showTab('more')" },
  { n: 'hub', who: 'owner', now: '3-1030', go: "S.builder('hub')", root: '#setup' },
  { n: 'hub-dir', who: 'director', now: '3-1030', go: "S.builder('hub')", root: '#setup' },
  { n: 'week', who: 'owner', now: '3-1030', go: "S.builder('week')", root: '#setup' },
  { n: 'sched', who: 'owner', now: '3-1030', go: "S.builder('schedule')", root: '#setup' },
  { n: 'rain', who: 'owner', now: '3-1030', go: "S.builder('schedule'); rainOpen && rainOpen('wed')", root: '#setup' },
  { n: 'sgames', who: 'owner', now: '3-1030', go: "S.builder('games')", root: '#setup' },
  { n: 'teams', who: 'owner', now: '3-1030', go: "S.builder('teams')", root: '#setup' },
  { n: 'people', who: 'owner', now: '3-1030', go: "S.builder('people')", root: '#setup' },
  { n: 'campers', who: 'owner', now: '3-1030', go: "S.builder('campers')", root: '#setup' },
  { n: 'meals', who: 'owner', now: '3-1030', go: "S.builder('meals')", root: '#setup' },
  { n: 'verses', who: 'owner', now: '3-1030', go: "S.builder('verses')", root: '#setup' },
  { n: 'cleanup', who: 'owner', now: '3-1030', go: "S.builder('cleanup')", root: '#setup' },
  { n: 'electives', who: 'owner', now: '3-1030', camps: ['junior'], go: "S.builder('electives')", root: '#setup' },
  { n: 'backups', who: 'owner', now: '3-1030', go: "S.builder('backups')", root: '#setup' },
  { n: 'wizard1', who: 'owner', now: '3-1030', go: 'S.wizard(1)', root: '#setup' },
  { n: 'wizard2', who: 'owner', now: '3-1030', go: 'S.wizard(2)', root: '#setup' },
  { n: 'reveal-mirror', who: 'counselor', now: '3-1930', go: 'S.reveal(2)' },
  { n: 'reveal-mirror-dir', who: 'director', now: '3-1930', go: 'S.reveal(2)' },
  { n: 'reveal-grid-now', who: 'counselor', now: '3-2330', go: "S.reveal(0, 'ended')" },
  { n: 'reveal-grid-games', who: 'counselor', now: '3-2330', go: "S.reveal(0, 'ended'); showTab('games')" },
  { n: 'remote-live', who: 'director', now: '3-1930', go: 'S.reveal(2); openReveal()', root: '#takeover-reveal' },
  { n: 'alerts-drawer', who: 'counselor', now: '3-1030', go: "showTab('more'); shellSheetOpen('alerts')" },
  { n: 'history-drawer', who: 'director', now: '3-1030', go: "showTab('more'); shellSheetOpen('history')" },
  { n: 'setup-menu', who: 'owner', now: '3-1030', go: "S.builder('hub'); shellSheetOpen('setup-menu')", root: '#sheet-setup-menu' },
  { n: 'setup-changes', who: 'owner', now: '3-1030', go: "S.builder('hub'); shellSheetOpen('setup-changes')", root: '#sheet-setup-changes' },
  // The old setup tools, back in the new screens (the day sheet's name / weekday / Delete, Days with no weekday, Restore points' Backups, the paste sheet)
  { n: 'sg-day', who: 'owner', now: '3-1030', go: "S.builder('games'); state.ui.sgDay = 'wed'; renderAll(); gmOpenDaySheet()", root: '#sheet-sg-day' },
  { n: 'sg-day-taken', who: 'owner', now: '3-1030', go: "S.builder('games'); state.ui.sgDay = 'wed'; renderAll(); gmOpenDaySheet(); renderAll(); var tk = document.querySelector('#sg-day-dows [data-taken]'); if (tk) tk.click()", root: '#sheet-sg-day' },
  { n: 'sg-day-dir', who: 'director', now: '3-1030', go: "S.builder('games'); state.ui.sgDay = 'wed'; renderAll(); gmOpenDaySheet()", root: '#sheet-sg-day' },
  { n: 'sg-nodow', who: 'owner', now: '3-1030', go: "state.config.days.push({ id: 'd-nodow', name: 'Messtival Saturday-Sunday', dow: null }); S.builder('games')", root: '#setup' },
  { n: 'sg-nodow-sheet', who: 'owner', now: '3-1030', go: "state.config.days.push({ id: 'd-nodow', name: 'Messtival Saturday-Sunday', dow: null }); S.builder('games'); gmOpenDayById('d-nodow')", root: '#sheet-sg-day' },
  { n: 'backup-paste', who: 'owner', now: '3-1030', go: "S.builder('backups'); openBackupPaste()", root: '#sheet-backup-paste' },
  { n: 'backup-paste-text', who: 'owner', now: '3-1030', go: "S.builder('backups'); openBackupPaste(); var bp = document.getElementById('bp-text'); bp.value = 'this is not a backup'; bp.dispatchEvent(new Event('input', { bubbles: true })); var bc = document.getElementById('bp-check'); if (bc) bc.click()", root: '#sheet-backup-paste' },
  { n: 'wizard3', who: 'owner', now: '3-1030', go: 'S.wizard(3)', root: '#setup' },
  { n: 'wizard4', who: 'owner', now: '3-1030', go: 'S.wizard(4)', root: '#setup' },
  { n: 'wizard5', who: 'owner', now: '3-1030', go: 'S.wizard(5)', root: '#setup' },
  // Build session 2 (Nov 9): the steps that name team names, the Remove… question with its tick, and Now with a note due.
  { n: 'wizard2-teams', who: 'owner', now: '3-1030', go: "S.wizard(2, { teams: 'clear' })", root: '#setup' },
  { n: 'wizard4-teams', who: 'owner', now: '3-1030', go: "S.wizard(4, { teams: 'clear' })", root: '#setup' },
  { n: 'wizard5-teams', who: 'owner', now: '3-1030', go: "S.wizard(5, { teams: 'clear' }, true)", root: '#setup' },
  { n: 'remove-tick', who: 'director', now: '3-1030', go: 'S.removeTick(false)', root: '#ask-dialog' },
  { n: 'remove-tick-off', who: 'director', now: '3-1030', go: 'S.removeTick(true)', root: '#ask-dialog' },
  { n: 'now-note-cou', who: 'counselor', now: '3-1030', go: 'S.note()' },
  { n: 'now-note-dir', who: 'director', now: '3-1030', go: 'S.note()' },
  { n: 'now-note-owner', who: 'owner', now: '3-1030', go: 'S.note()' },
  { n: 'now-note-dir-banner', who: 'director', now: '3-1030', go: 'S.note(true)' },
];

const INSTALL = (camp) => {
  const T = () => state.teams.map((t) => t.id);
  window.S = {
    games(dow) {
      const nb = nowBlocks(dow).find((x) => x.kind === 'games' && gamesForBlock(dow, x.b).length);
      const gs = nb ? gamesForBlock(dow, nb.b) : []; const t = T();
      if (gs[0]) state.results[gs[0].id] = { medals: { gold: t[2], silver: t[0], bronze: t[1] }, savedAt: new Date().toISOString() };
      if (gs[1]) { Object.assign(gs[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false }); state.drafts[gs[1].id] = { scores: { [t[3 % t.length]]: '48', [t[0]]: '41', [t[2]]: '36' } }; }
      return gs;
    },
    legacy() { const d = campNow().dow; const nb = nowBlocks(d).find((x) => gamesForBlock(d, x.b).some((g) => /legacy/i.test(g.name))); return nb ? gamesForBlock(d, nb.b).find((g) => /legacy/i.test(g.name)) : state.config.games.find((x) => /legacy/i.test(x.name)); },
    b4(spec) {
      const g = S.legacy(); if (!g) return; g.format = 'tournament';
      const t = T(); const m = { s1: { a: t[0], b: t[3] }, s2: { a: t[1], b: t[2] }, third: {}, final: {} };
      if (spec.s1 === 'W03') m.s1.winner = t[0];
      if (spec.s2 === 'W12') m.s2.winner = t[1];
      if (spec.third === 'W3') m.third = { a: t[3], b: t[2], winner: t[3] };
      if (spec.final === 'W0') m.final = { a: t[0], b: t[1], winner: t[0] };
      if (spec.recheck) { m.s1.winner = t[3]; }
      state.brackets4 = { [g.id]: { at: Date.now(), m } };
      if (spec.s2 === 'L') { state.liveMatches = state.liveMatches || {}; }
    },
    openLegacy() { const g = S.legacy(); if (g) openGame(g.id, { from: 'now' }); },
    podium() {
      const gs = S.games(3); const g = state.config.games.find((x) => x.format === 'placement' && !state.results[x.id]) || gs[2] || gs[0];
      const t = T(); state.drafts[g.id] = { medals: { gold: t[0], silver: t[1] } }; openGame(g.id, { from: 'now' });
    },
    reveal(shown, phase) {
      const T = Date.now(), N = state.teams.length; serverOffsetKnown = true;
      const ctl = { v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: phase || 'live', cur: Math.max(0, shown - 1), shown: shown || N, teams: N, finale: false, at: T - 20000, sa: T - 20000, ca: T - 60000, startedAt: T - 60000, until: untilFor(T, false) };
      const pub = {}; const n = shown || N;
      for (let i = 0; i < n; i++) { const tid = 't' + (N - 1 - i); pub['g' + i] = { place: N - i, e: { [tid]: { nm: teamShort(tid) || tid, p: 10 * (N - i), g: 2, s: 1, b: 1, v: 4, m: 3, c: 2 } } }; }
      revealAccept('real', { ctl, pub }, 'snapshot'); renderAll();
    },
    openDone() { const g = state.config.games.find((x) => state.results[x.id]); if (g) openGame(g.id, { from: 'games' }); },
    builder(screen) {
      setupReady = true; configReady = true; window.restoreOnline = () => true;
      openBuilder(); if (screen !== 'hub') setupGo(screen); renderAll();
    },
    // A note due on this phone: its memory is emptied (so the first one releases at once); `banner` also posts a director's banner above it.
    note(banner) {
      try { localStorage.removeItem('campScoreboardWhatsNew'); } catch (e) {}
      if (banner && typeof postBanner === 'function') { postBanner('The Tabernacle is open for the next hour.', 3600000); }
      renderAll();
    },
    removeTick(offline) {
      setupReady = true; configReady = true; window.restoreOnline = () => true;
      pushConfigured = () => true; pushSchedAlertsOff = false;
      campWeek = () => ({ start: '2026-11-08', phase: 'during' }); serverNow = () => etWallToEpoch('2026-11-11', 60);
      if (offline) setupNoSignal = () => true;
      state.ui.builderScreen = 'schedule'; state.ui.setupDay = 'wed'; openBuilder(); renderAll();
      const b = planForDow(3).find((x) => !x.noTime && x.type !== 'games' && !x.meal && x.origin === 'typical');
      schedOpenItem({ bid: b.id }); schedRemoveItem();
    },
    wizard(step, carry, done) {
      setupReady = true; configReady = true; window.restoreOnline = () => true;
      setupTree.meta.wizard = { step, byKey: OWNER_MEMBER_KEY, at: Date.now() - 60000, fromEpoch: 'legacy', answers: JSON.stringify({ dev: wizardDeviceId(), weekStart: '2027-07-18', double: 'same', carry: carry || {} }) }; setupRev++;
      const d = wizardDraftRead(); d.answers = wizardNormAnswers({ weekStart: '2027-07-18', double: 'same', carry: carry || {} });
      if (done) d.done = { epoch: 'w20270718', at: Date.now(), archiveId: 'x', counts: {}, teams: true, cleared: 0, failed: 0 };
      state.ui.builderScreen = 'wizard'; openBuilder(); renderAll();
    },
  };
};

const RESET = ({ who, camp }) => {
  document.querySelectorAll('jelly-dialog[open]').forEach((d) => d.removeAttribute('open'));
  const tp = document.getElementById('team-picker-overlay'); if (tp) tp.remove();
  const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
  window.scrollTo = () => {};
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 's', addedAt: 1 }, 'jenn,x@example,com': { role: 'editor', name: 'Jenn', addedBy: 's', addedAt: 1 }, 'sam,x@example,com': { role: 'viewer', name: 'Sam', teamId: 't0', addedBy: 's', addedAt: 1 } }; memberDirectoryLoaded = true;
  if (who === 'owner') authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true, uid: 'o' };
  else authUser = { email: who === 'counselor' ? 'sam@x.com' : 'jenn@example.com', emailVerified: true, uid: 'x' };
  setMemberRole(who === 'counselor' ? 'viewer' : 'editor');
  setMemberTeam(who === 'dteam' ? state.teams[1].id : null);
  state.followTeam = state.teams[0].id; state.identity = camp === 'junior' && who === 'counselor' ? 'Sam' : (state.identity || null);
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
  if (camp === 'senior' && setupTree.typical && setupTree.typical['b-supper-and-free-time-1065']) { setupTree.typical['b-supper-and-free-time-1065'].meal = 'supper'; setupRev++; }
  setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops);
  setupReady = true; configReady = true;
  weatherData = null;
  try { sdkLoadFailed = false; } catch (e) {}
};

// Env knobs shared by both audits: CAMPS=junior,senior  SIZES=390/light/100,360/dark/200  VIEWS=a,b  SHARD=i/n (run n processes in parallel)
const list = (v, d) => (process.env[v] ? process.env[v].split(',') : d);
function plan(defaultSizes) {
  const camps = list('CAMPS', ['junior', 'senior']);
  const sizes = list('SIZES', defaultSizes).map((s) => { const [w, scheme, text] = s.split('/'); return { w: +w, scheme, text: +text }; });
  const only = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
  const [si, sn] = (process.env.SHARD || '0/1').split('/').map(Number);
  const jobs = [];
  for (const camp of camps) for (const sz of sizes) for (const v of VIEWS) {
    if (only && !only.includes(v.n)) continue;
    if (v.camps && !v.camps.includes(camp)) continue;
    jobs.push({ camp, sz, v });
  }
  return jobs.filter((_, i) => i % sn === si);
}

// Open one view in a fresh page. Returns { ctx, page, errs } (errs = page errors and console errors that are not the blocked network).
async function openView(browser, { camp, sz, v }) {
  const h = sz.w === 360 ? 740 : 844;
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: h }, isMobile: true, hasTouch: true, colorScheme: sz.scheme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
  await ctx.addInitScript(({ camp, who }) => { try { localStorage.setItem('campScoreboardAuthHint', who === 'counselor' ? 'viewer' : 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp, who: v.who });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_FAILED|blocked|Content Security|Firebase|fonts\.g/i.test(m.text())) errs.push('console ' + m.text().slice(0, 160)); });
  // never reach Firebase, the live alert sender or the weather: the page runs on local sample data
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo|camp-alerts\.patricksimpson-fx\.workers\.dev/, (r) => r.abort());
  let now = v.now;
  if (now === 'bible') now = camp === 'junior' ? '3-0920' : '3-0900';
  await page.goto(BASE + 'index.html?now=' + now, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof setMemberRole === 'function' && typeof nowModel === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '#sdk-banner, jelly-toaster, #sync-status-footer { display: none !important; }' + (sz.text !== 100 ? 'html{font-size:' + sz.text + '% !important}' : '') });
  await page.evaluate(INSTALL, camp);
  try {
    await page.evaluate(RESET, { who: v.who, camp });
    if (v.go) await page.evaluate((go) => { (0, eval)(go); }, v.go);
    await page.evaluate(() => renderAll());
  } catch (e) { errs.push('setup: ' + String(e).slice(0, 160)); }
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}
module.exports = { chromium, BASE, VIEWS, INSTALL, RESET, plan, openView };
