// Step 23 dock audit: the remote's gold button and its refused-tap toast, in a real browser. For every face the button
// can wear (Start, a new reveal, a place, the wait, a tie, Friday's crown, the champions, the crowning, the final
// table), both camps, 360 and 390 wide, light and dark, 100 / 130 / 200% text, it compares the label's own text boxes
// (Range.getClientRects, which overflow:hidden cannot hide) with the button's box, and says when the wait's count has
// dropped onto a line of its own. Then it taps the button during the wait and checks the toast clears the dock.
// Serve the worktree first (python3 -m http.server 8977). node step23-dock.cjs [baseUrl]   QUICK=junior for one camp.
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8977').replace(/\/$/, '');

async function open(browser, { camp, scheme, w, h, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(({ camp }) => {
    localStorage.setItem('campScoreboardAuthHint', 'editor');
    if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior');
  }, { camp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1936', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderAll === 'function' && typeof renderRevealUi === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate((text) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    setMemberRole('editor');
    document.querySelectorAll('jelly-dialog[open]').forEach((d) => d.removeAttribute('open'));
    fbConnected = true; remoteReady = true; serverTimeOffset = 0; serverOffsetKnown = true;
    authUser = { email: 'jenn@example.com' };          // a Start with no sign-in reads "Sign in again to start" (revealStartBlock)
    revealStarted = true; revealMayCommand = () => ({ ok: true });
    renderAll();
    document.documentElement.style.fontSize = text + '%';
    openReveal({ from: 'more' });
  }, text);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// The reveal exactly as the server would hand it over (confirmedReveal via the engine's own change path).
function setReveal(page, spec) {
  return page.evaluate((o) => {
    const mode = 'real';
    const now = serverNow();
    const ids = state.teams.map((t) => t.id);
    const rows = ids.map((id, i) => ({ id, nm: state.teams[i].name, p: 40 - i * 4 - (o.tie && i === 2 ? 4 : 0), g: Math.max(0, 3 - i), s: i % 3, b: (i + 1) % 3, v: 4 - (i % 3), m: 3 - (i % 2), c: i % 2 }));
    const groups = revealFreezeGroups(rows.map((r) => Object.assign({}, r)));
    const shown = o.shown;
    const cur = o.cur === undefined ? shown - 1 : o.cur;
    const at = now - (o.ageMs === undefined ? 20000 : o.ageMs);
    const started = now - 600000;
    const ctl = { v: 1, id: 'r1kz9fxq-4hd2', seq: 3 + shown + (o.bump || 0), phase: o.phase, cur, shown, teams: ids.length, finale: !!o.finale, at, sa: at, ca: started, startedAt: started, until: untilFor(now, false) };
    if (ctl.phase === 'ended') { ctl.endedAt = at; ctl.endKind = 'early'; }
    const pub = {};
    for (let i = 0; i < shown; i++) pub['g' + i] = revealGroupWire(groups[i]);
    revealResetCommands();
    revealFullStore[mode] = { r: ctl.id, n: groups.length, groups: groups.map((g, i) => Object.assign({ idx: i }, g)), by: 'me@x,com' };
    revealAccept(mode, { ctl, pub: shown ? pub : null }, 'snapshot');
    revealLoaded.real = true; revealLoaded.practice = true;
  }, spec);
}

const MEASURE = () => {
  const go = document.getElementById('reveal-go');
  const b = go.getBoundingClientRect();
  const boxes = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()]; };
  const lines = (rs) => new Set(rs.map((x) => Math.round(x.top))).size;
  const inside = (rs) => rs.every((x) => x.left >= b.left + 2 && x.right <= b.right - 2 && x.top >= b.top && x.bottom <= b.bottom);
  const k = boxes(document.getElementById('reveal-go-k')), m = boxes(document.getElementById('reveal-go-m'));
  const crown = document.querySelector('.rm-go-crown');
  const cr = crown && crown.getBoundingClientRect();
  return {
    state: go.dataset.state, face: go.dataset.face || '',
    k: document.getElementById('reveal-go-k').textContent, m: document.getElementById('reveal-go-m').textContent,
    inK: inside(k), inM: inside(m), kLines: lines(k), mLines: lines(m),
    crownIn: !cr || !cr.width || (cr.left >= b.left && cr.right <= b.right),
  };
};

(async () => {
  const browser = await chromium.launch();
  const bad = [];
  let checked = 0;
  try {
    const camps = process.env.QUICK ? [process.env.QUICK] : ['junior', 'senior'];
    for (const camp of camps) for (const scheme of ['light', 'dark']) for (const w of [360, 390]) for (const text of [100, 130, 200]) {
      const tag = `${camp} ${scheme} ${w} ${text}%`;
      const { page, ctx, errors } = await open(browser, { camp, scheme, w, h: w === 360 ? 780 : 844, text });
      const n = await page.evaluate(() => state.teams.length);
      const faces = [
        ['start', null],
        ['new reveal', { phase: 'ended', shown: 3, cur: 2 }],
        ['a place', { phase: 'live', shown: 3 }],
        ['the wait (name)', { phase: 'live', shown: 3, ageMs: 1500, bump: 1 }],
        ['the wait (score)', { phase: 'live', shown: 3, ageMs: 3500, bump: 2 }],
        ['a tie', { phase: 'live', shown: 1, tie: true }],
        ['the crown', { phase: 'live', shown: n, cur: n - 1, finale: true }],
        ['the champions', { phase: 'champion', shown: n, cur: n - 1, finale: true }],
        ['the crowning', { phase: 'champion', shown: n, cur: n - 1, finale: true, ageMs: 1500, bump: 1 }],
        ['the final table', { phase: 'table', shown: n, cur: n - 1, finale: true }],
      ];
      // The Start that can never work (revealStartBlock): the dock's small line says why. Measured on the first face's own
      // screen (no reveal), each put back afterwards.
      const blocks = [
        ['blocked: teams', () => { state.teams[0].id = 'team-a'; }, () => { state.teams[0].id = 't0'; }, 'The teams need fixing first'],
        ['blocked: sign-in', () => { window.__au = authUser; authUser = null; }, () => { authUser = window.__au; }, 'Sign in again to start'],
      ];
      await page.evaluate(() => { revealLoaded.real = true; revealLoaded.practice = true; });   // "Loading the reveal…" outranks a reason
      for (const [name, on, off, words] of blocks) {
        await page.evaluate(on); await page.evaluate(() => renderRevealUi());
        await page.waitForTimeout(120);
        const r = await page.evaluate(MEASURE);
        checked++;
        const why = [r.state !== 'blocked' && 'the dock is not blocked', r.k !== words && 'the small line is not the reason', !r.inK && 'small line leaves the button', !r.inM && 'big line leaves the button'].filter(Boolean);
        if (why.length) bad.push(`${tag} · ${name} ("${r.k}" / "${r.m}"): ${why.join(', ')}`);
        await page.evaluate(off); await page.evaluate(() => renderRevealUi());
      }
      for (const [name, spec] of faces) {
        if (spec) await setReveal(page, spec);
        await page.waitForTimeout(120);
        const r = await page.evaluate(MEASURE);
        checked++;
        const waiting = r.state === 'charging';
        const why = [!r.inK && 'small line leaves the button', !r.inM && 'big line leaves the button', !r.crownIn && 'crown leaves the button',
          waiting && r.kLines > 1 && 'the wait wraps (its count on a line of its own)'].filter(Boolean);
        if (why.length) bad.push(`${tag} · ${name} ("${r.k}" / "${r.m}"): ${why.join(', ')}`);
      }
      // A tap during the wait: the engine refuses it with a toast, which must clear the dock.
      await setReveal(page, { phase: 'live', shown: 3, ageMs: 1500, bump: 5 });
      await page.evaluate(() => document.getElementById('reveal-go').click());
      await page.waitForTimeout(700);
      const t = await page.evaluate(() => {
        const toaster = document.querySelector('jelly-toaster');
        const els = toaster && toaster.shadowRoot ? [...toaster.shadowRoot.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().height > 20 && /toast/i.test(String(x.className) + ' ' + (x.getAttribute('part') || ''))) : [];
        const last = els[els.length - 1];
        return { toastBottom: last ? last.getBoundingClientRect().bottom : null, dockTop: document.getElementById('reveal-dock').getBoundingClientRect().top };
      });
      checked++;
      if (t.toastBottom === null) bad.push(`${tag} · the refused tap raised no toast`);
      else if (t.toastBottom > t.dockTop) bad.push(`${tag} · the toast covers the dock (${Math.round(t.toastBottom)} > ${Math.round(t.dockTop)})`);
      if (errors.length) bad.push(`${tag} · page errors: ${errors.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(checked + ' checks, ' + bad.length + ' problems');
  bad.forEach((b) => console.log('  ' + b));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
