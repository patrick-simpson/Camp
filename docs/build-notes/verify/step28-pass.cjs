// Step 28 browser pass: the REAL renderers of the new-year setup (setup-ui.js §17) in the real page, no specimen markup. As the
// owner (every screen and sheet), as another director (the hub door's sentence, the screen shut) and as a counselor (nothing),
// both camps, 360 / 390 wide, light / dark, 100 / 130 / 200 % text. Checks: no tap target under 44x44, no sideways scroll, no
// clipped box, no squeezed words, no page error, and that the owner-only controls exist for the owner alone.
//   node step28-pass.cjs [baseUrl]   (ONLY=<state>[,…], QUICK=1, CAMPS=junior|senior, SHOTS=1 with OUT=<dir>)
// Serve the worktree first: python3 -m http.server 8962 (Firebase is blocked; the role and the week are set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8962').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots28/';
fs.mkdirSync(OUT, { recursive: true });
// The design pass's measurer, taken from its own file so the two passes judge by one rule.
const designSrc = fs.readFileSync(__dirname + '/step28-design.cjs', 'utf8');
const MEASURE = eval('(' + designSrc.match(/const MEASURE = ([\s\S]*?\n\});?\n/)[1].replace(/;\s*$/, '') + ')');

// What each state sets up in the page (runs inside it). `who`: owner | director | counselor.
function fill(sp) {
  const draft = (a) => { const d = wizardDraftRead(); d.answers = wizardNormAnswers(a); };
  const claim = (step, dev, at) => { setupTree.meta.wizard = { step, byKey: OWNER_MEMBER_KEY, at: at || Date.now(), fromEpoch: 'legacy', answers: JSON.stringify({ dev: dev || wizardDeviceId(), weekStart: '2027-07-18', double: 'same' }) }; setupRev++; };
  const dev = wizardDeviceId();
  const A = { weekStart: '2027-07-18', double: 'same', carry: {} };
  if (sp.who !== 'owner') authUser = { email: 'jenn@example.com', emailVerified: true };
  if (sp.who === 'counselor') setMemberRole('viewer');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 's', addedAt: 1 } }; memberDirectoryLoaded = true;
  if (sp.claim) claim(sp.step || 1, sp.claim === 'other' ? 'other-device-123' : dev, sp.idle ? Date.now() - 20 * 60000 : Date.now() - 4 * 60000);
  if (sp.step) draft(Object.assign({}, A, sp.answers || {}));
  if (sp.step === 3) nywUi.save = { state: sp.save || 'saved', res: sp.save === 'error' ? null : { rid: 'rp-x-1234', counts: { results: 22, bonuses: 4, brackets: 1, announcements: 2 } }, why: 'verify' };
  if (sp.step === 4) { nywUi.members = { ok: true, withTeam: [{ key: 'a', name: 'Alex' }, { key: 'b', name: 'Bo' }], incomplete: [{ key: 'c', name: 'Casey' }] }; nywUi.membersAsked = true; if (sp.reveal) nywUi.clear.reveal = true; }
  if (sp.step === 5) { wizardDraftRead().done = { epoch: 'w20270718', at: Date.now(), archiveId: 'rp-x-1234', counts: {}, cleared: 2, failed: 1 }; nywUi.done = { ok: true, members: { cleared: 2, failed: [{ key: 'c', name: 'Casey' }], incomplete: [] } }; }
  if (sp.ask) nywUi.ask = { q: 'Is a camp week running right now?', a: { label: 'No, it’s not', run() {} }, b: { label: 'Yes, it is', run() {} } };
  if (sp.watch) nywUi.watching = true;
  state.ui.builderScreen = sp.screen || (sp.step ? 'wizard' : state.ui.builderScreen);
  if (sp.sheet === 'nyw-undo') { nywUi.undo = { rid: 'rp-x-1234', row: { rid: 'rp-x-1234', kind: 'archive', label: '2026 week (junior)', at: Date.now() - 86400000 * 3, epoch: '' }, body: { state: { results: { a: 1, b: 2 }, bonuses: { c: 1 } }, setup: { meta: { weekStart: '2026-07-19' } }, epoch: '' }, state: 'ready', reveal: false, busy: false }; }
  if (sp.sheet === 'nyw-staff') nywUi.staffOpen = true;
  if (sp.menu) { setupUi.restore = { status: 'ok', rows: [{ rid: 'rp-x-1234', kind: 'archive', label: '2026 week (junior)', at: Date.now() - 86400000, epoch: '' }], at: Date.now(), loading: false }; }
  renderAll();
  if (sp.sheet) { renderSetupSheet(sp.sheet); const el = document.getElementById('sheet-' + sp.sheet); if (el) el.hidden = false; }
  if (sp.menu) { document.getElementById('sheet-setup-menu').hidden = false; renderSetupMenuRows(); }
  if (sp.past) {
    const row = { rid: 'rp-x-1234', kind: 'archive', label: '2026 week (junior)', at: Date.now() - 86400000, epoch: '', byKey: OWNER_MEMBER_KEY };
    setupUi.restore = { status: 'ok', rows: [row], at: Date.now(), loading: false };
    setupUi.rsheet = { rid: row.rid, row, source: 'index', state: 'ready', body: { state: {} }, preview: { sections: {}, kept: [], notOffered: [], epochNote: '' }, picks: {}, reveal: false, busy: false, why: '' };
    document.getElementById('sheet-restore').hidden = false; renderRestoreSheet();
  }
}

const STATES = {
  w1: { who: 'owner', claim: 'mine', step: 1 },
  w2: { who: 'owner', claim: 'mine', step: 2 },
  w3: { who: 'owner', claim: 'mine', step: 3, save: 'saved' },
  'w3-fail': { who: 'owner', claim: 'mine', step: 3, save: 'error' },
  w4: { who: 'owner', claim: 'mine', step: 4 },
  'w4-confirm': { who: 'owner', claim: 'mine', step: 4, reveal: true },
  w5: { who: 'owner', step: 5 },
  'w-ask': { who: 'owner', claim: 'mine', step: 1, ask: true },
  'w-other': { who: 'owner', claim: 'other', step: 3 },
  'w-watch': { who: 'owner', claim: 'other', step: 2, idle: true, watch: true },
  'hub-mine': { who: 'owner', claim: 'mine', step: 3, screen: 'hub' },
  'hub-other': { who: 'owner', claim: 'other', step: 3, screen: 'hub' },
  'hub-director': { who: 'director', claim: 'other', step: 3, screen: 'hub' },
  'screen-shut': { who: 'director', claim: 'other', step: 3, screen: 'wizard' },
  undo: { who: 'owner', screen: 'hub', sheet: 'nyw-undo' },
  staff: { who: 'owner', screen: 'hub', sheet: 'nyw-staff' },
  advanced: { who: 'owner', screen: 'hub', sheet: 'setup-advanced' },
  menu: { who: 'owner', screen: 'hub', menu: true },
  past: { who: 'owner', screen: 'backups', past: true },
};

async function openPage(browser, { camp, w, scheme, text, who }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp, who }) => { try { localStorage.setItem('campScoreboardAuthHint', who === 'counselor' ? 'viewer' : 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp, who });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2027-05-12T19:15:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate((who) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    setMemberRole(who === 'counselor' ? 'viewer' : 'editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupReady = true; configReady = true;
    if (who !== 'counselor') { openBuilder(); renderAll(); }
  }, who);
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(STATES);
  const camps = process.env.CAMPS ? process.env.CAMPS.split(',') : ['junior', 'senior'];
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : [[360, 'light', 100], [390, 'dark', 100], [360, 'light', 130], [390, 'light', 130], [360, 'dark', 200], [390, 'light', 200]];
  for (const name of only) {
    for (const camp of camps) {
      const sp = Object.assign({ name }, STATES[name]);
      for (const [w, scheme, txt] of sizes) {
        const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt, who: sp.who });
        const tag = [name, camp, w, scheme, txt + '%'].join(' ');
        try {
          await page.evaluate(`(${fill.toString()})(${JSON.stringify(sp)})`);
          await page.waitForTimeout(500);
          const m = await page.evaluate(MEASURE);
          const facts = await page.evaluate((sp) => ({
            screen: setupScreen(), owner: isOwner(),
            doorBtn: !document.getElementById('hub-door-btn').hidden, pair: !document.getElementById('hub-door-pair').hidden,
            ownerControls: [...document.querySelectorAll('[data-owner-only]')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).length,
            headline: (document.getElementById('nyw-headline') || {}).textContent, dataStep: (document.getElementById('setup-wizard') || {}).dataset && document.getElementById('setup-wizard').dataset.step,
          }), sp);
          const wrong = [];
          if (sp.who !== 'owner' && facts.ownerControls) wrong.push('owner controls visible to a non-owner: ' + facts.ownerControls);
          if (sp.who === 'director' && facts.screen === 'wizard') wrong.push('a plain director reached the wizard screen');
          if (sp.screen === 'wizard' && sp.who === 'owner' && facts.screen !== 'wizard') wrong.push('the owner was shut out of the screen');
          report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip, narrow: m.narrow, wrong });
          if (process.env.SHOTS) await page.screenshot({ path: OUT + ['s28p', name, camp, w, scheme, txt].join('-') + '.png', fullPage: !sp.sheet && !sp.menu });
        } catch (e) { report.push({ tag, error: String(e).slice(0, 300) }); }
        if (errs.length) report.push({ tag: tag + ' page errors', pageErrors: errs });
        await ctx.close();
      }
    }
  }
  await browser.close();
  const bad = report.filter((r) => (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length) || (r.narrow && r.narrow.length) || (r.wrong && r.wrong.length) || r.error || r.pageErrors);
  console.log(JSON.stringify(bad, null, 1));
  console.log(report.length + ' checks, ' + bad.length + ' with findings');
})();
