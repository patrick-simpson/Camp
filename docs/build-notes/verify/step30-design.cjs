// Step 30 design pass: the Notice board screen of Set up the week (P2 §11.16), drawn into the REAL page with the real
// styles.css. Nothing is wired yet, so this script writes the documented markup itself (index.html: the comment at
// #setup-notice and its row templates), filled from the camp's own notice through the page's own teamMarkHtml / teamName /
// teamShort / esc and the app's own preview (noticeCardHtml → now-ui.js nowNoticePreviewHtml). The specimens are a reference
// for the build session: the copy per state and the row templates.
// For each specimen, camp, width (360 / 390), theme and text size (100 / 130 / 200 %) it reports tap targets under 44x44,
// sideways scroll, clipped boxes and text squeezed into a narrow column; SHOTS=1 writes screenshots (OUT=<dir>, default the
// OS temp dir + /shots/).
//   node step30-design.cjs [baseUrl]   (ONLY=<specimen>[,…], QUICK=1 for 390 light 100% only, CAMPS=junior|senior,
//                                        SIZE=360,dark,200 for one size)
// Serve the worktree first: python3 -m http.server 8973 (Firebase and the alert sender are blocked; the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8973').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

const SPECIMENS = {
  // The camp's own example as a draft: every team listed (junior: six; senior: four "TBA"), the steps, the closing line.
  draft: { build: 'notice', status: 'draft' },
  // Posted: the dock's Take it down. Opened from Tell everyone's "Write a full notice…" (its Back says so).
  posted: { build: 'notice', status: 'posted', from: 'tell' },
  // Nothing written: the dashed well; every team unlisted, no steps.
  empty: { build: 'notice', status: 'draft', notice: 'empty' },
  // Two teams listed (the rest say "Not on the notice"), one with small print, a step with no emoji, no closing line.
  partial: { build: 'notice', status: 'draft', notice: 'partial' },
  // The same while the second team's place is being typed in: its small print box shows under it (CSS :focus-within).
  'partial-focus': { build: 'notice', status: 'draft', notice: 'partial', focus: true },
  // Posted but emptied: phones show nothing.
  hollow: { build: 'notice', status: 'posted', notice: 'empty' },
  // The ⋯ menu without its Classic editor row (the owner's rows shown).
  menu: { build: 'sheet', sheet: 'setup-menu' },
};

// Runs in the page. Writes the markup for one specimen.
function fill(sp) {
  const $ = (id) => document.getElementById(id);
  const text = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const senior = CAMP.id === 'senior';
  const campName = senior ? 'Senior camp' : 'Junior camp';
  document.body.classList.add('setup-owner');

  if (sp.build === 'sheet') {
    document.querySelectorAll('.sheet-overlay').forEach((o) => { o.hidden = true; });
    const ov = $('sheet-' + sp.sheet);
    ov.querySelectorAll('[data-owner-only]').forEach((el) => { el.hidden = false; });
    ov.hidden = false;
    return;
  }

  // The notice for this specimen (always a whole, normalized card: what noticeBoard() hands the build session).
  let n = JSON.parse(JSON.stringify(noticeBoard()));
  if (sp.notice === 'empty') n = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
  if (sp.notice === 'partial') {
    n.zones = n.zones.slice(0, 2).map((z, i) => Object.assign({}, z, { place: i ? 'Tabernacle porch' : 'Dining Hall', note: i ? '' : 'breakfast cleanup' }));
    n.steps = n.steps.slice(0, 1).concat([{ emoji: '', when: 'When your area is done', items: ['Help finish up at the Tabernacle.'] }]);
    n.signoff = '';
  }
  n.status = sp.status;
  const said = !!(n.title || n.sub || n.signoff || n.zones.length || n.steps.length);
  const st = n.status === 'posted' ? (said ? 'posted' : 'hollow') : (said ? 'draft' : 'empty');
  const COPY = {
    empty: ['Nothing written yet', 'Write it here, then put it on every phone when it’s ready.'],
    draft: ['A draft only directors see', 'Counselors see nothing until you put it on every phone. Edit it as long as you like.'],
    posted: ['On every phone', 'It’s at the top of Now for everyone. Changes show there as you make them.'],
    hollow: ['Nothing to show', 'It’s switched on, but phones show nothing until something is written here.'],
  };

  $('setup').setAttribute('data-screen', 'notice');
  text('setup-back-label', sp.from === 'tell' ? 'Tell everyone' : 'Set up the week');
  const sec = $('setup-notice');
  sec.setAttribute('data-state', st);
  text('nbs-title', 'Notice board · ' + campName);
  text('nbs-headline', COPY[st][0]);
  text('nbs-lede', COPY[st][1]);

  // Heading, intro, closing line: values set as properties (never markup).
  const field = (k) => sec.querySelector('[data-nb-field="' + k + '"]');
  field('title').value = n.title;
  if (!n.title && n.eyebrow) field('title').placeholder = n.eyebrow;
  field('sub').value = n.sub;
  field('signoff').value = n.signoff;

  // Where each team goes: the listed teams in the notice's order, then the rest in roster order.
  const ids = teamIds();
  const listed = n.zones.filter((z) => ids.includes(z.teamId) && z.place);
  const order = listed.map((z) => z.teamId).concat(ids.filter((id) => !listed.some((z) => z.teamId === id)));
  $('nbs-zones').innerHTML = order.map((id, i) => {
    const z = listed.find((x) => x.teamId === id);
    const name = esc(teamName(id));
    return `<div class="nbs-zone" data-key="z-${esc(id)}" data-team="${esc(id)}"${z ? '' : ' data-empty'}>` +
      `<span class="nbs-mark">${teamMarkHtml(id, { size: 28 })}</span>` +
      `<p class="nbs-zone-name">${name}<small>Not on the notice</small></p>` +
      `<button type="button" class="nbs-up nb-zone-move" data-team="${esc(id)}" data-dir="-1" aria-label="Move ${name} up"${z && i ? '' : ' hidden'}><svg class="ico" aria-hidden="true"><use href="#i-up"/></svg></button>` +
      `<span class="nbs-zone-flds">` +
      `<textarea class="fld-input nbs-grow nb-zone-place" data-team="${esc(id)}" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Where they go" aria-label="Where ${name} go"></textarea>` +
      `<textarea class="fld-input nbs-grow nb-zone-note" data-team="${esc(id)}" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Small print (optional)" aria-label="Small print for ${name} (optional)"></textarea>` +
      `</span></div>`;
  }).join('');
  order.forEach((id) => {
    const z = listed.find((x) => x.teamId === id);
    if (!z) return;
    sec.querySelector('.nb-zone-place[data-team="' + id + '"]').value = z.place;
    sec.querySelector('.nb-zone-note[data-team="' + id + '"]').value = z.note;
  });
  text('nbs-zones-note', listed.length ? listed.length + ' of ' + ids.length + ' listed' : 'None listed yet');

  // Steps.
  $('nbs-steps').innerHTML = n.steps.map((s, i) =>
    `<div class="nbs-step" data-key="s-${i}" data-step="${i}"><span class="nbs-num" aria-hidden="true">${i + 1}</span>` +
    `<span class="nbs-step-head"><input type="text" class="fld-input nbs-emo nb-step-emoji" data-idx="${i}" maxlength="16" autocomplete="off" placeholder="+" aria-label="Step ${i + 1} emoji (optional)">` +
    `<textarea class="fld-input nbs-grow nbs-when nb-step-when" data-idx="${i}" data-oneline rows="1" autocomplete="off" enterkeyhint="next" placeholder="Heading, like “In your area”" aria-label="Step ${i + 1} heading"></textarea></span>` +
    `<textarea class="fld-input nbs-grow nb-step-items" data-idx="${i}" rows="2" placeholder="One instruction per line" aria-label="Step ${i + 1}, one instruction per line"></textarea>` +
    `<span class="nbs-acts">${i ? `<button type="button" class="btn-quiet nb-step-move" data-idx="${i}" data-dir="-1">Move up</button>` : ''}` +
    `<button type="button" class="btn-quiet btn-quiet-danger nb-step-remove" data-idx="${i}">Remove step</button></span></div>`).join('');
  n.steps.forEach((s, i) => {
    sec.querySelector('.nb-step-emoji[data-idx="' + i + '"]').value = s.emoji;
    sec.querySelector('.nb-step-when[data-idx="' + i + '"]').value = s.when;
    sec.querySelector('.nb-step-items[data-idx="' + i + '"]').value = s.items.join('\n');
  });
  text('nbs-steps-note', n.steps.length ? n.steps.length + (n.steps.length === 1 ? ' step' : ' steps') : 'None yet');

  // The preview, as a counselor on the first listed team sees it.
  const keep = state.followTeam;
  const who = listed.length ? listed[0].teamId : '';
  state.followTeam = who;
  try { $('nbs-preview').innerHTML = noticeCardHtml(true, n) || ''; } finally { state.followTeam = keep; }
  text('nbs-preview-label', who ? 'On a ' + teamShort(who) + ' counselor’s phone' : 'On a counselor’s phone');

  // The dock.
  const post = $('nbs-post');
  if (st === 'empty') { post.setAttribute('aria-disabled', 'true'); text('nbs-post-label', 'Write the notice first'); }
  else { post.removeAttribute('aria-disabled'); text('nbs-post-label', 'Put it on every phone'); }

  if (sp.focus) { const f = sec.querySelectorAll('.nbs-zone:not([data-empty]) .nb-zone-place')[1]; if (f) f.focus({ preventScroll: true }); }

  // Grow the text boxes the way setup-ui.js secGrow will (where field-sizing is missing).
  sec.querySelectorAll('textarea').forEach((t) => {
    if (CSS.supports('field-sizing', 'content')) return;
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + t.offsetHeight - t.clientHeight) + 'px';
  });
}

const MEASURE = () => {
  const issues = [];
  const sel = 'button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), textarea, select, summary, jelly-switch, jelly-checkbox';
  const roots = [document.getElementById('setup'), ...document.querySelectorAll('.sheet-overlay:not([hidden]) .sheet')].filter(Boolean);
  const seen = new Set();
  const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (!shown(el)) return;
    if (el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
    if (el.closest('.tell-phone-screen')) return; // the preview is a picture: nothing in it takes a tap
    if (!document.body.classList.contains('builder-open') && el.closest('#setup')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) issues.push({ el: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.value || '').trim().slice(0, 24) });
  }));
  const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const clip = [...document.querySelectorAll('#setup-notice, #setup-notice .gl, #setup-notice .fld-input, .nbs-dock .btn, .sheet-overlay:not([hidden]) .sheet-body')]
    .filter((e) => shown(e) && e.tagName !== 'TEXTAREA' && e.scrollWidth > e.clientWidth + (e.classList.contains('setup-screen') ? 2 * rem + 1 : 1))
    .map((e) => {
      // Name the widest thing that runs past the box's right edge.
      const right = e.getBoundingClientRect().right;
      const past = [...e.querySelectorAll('*')].filter((c) => shown(c) && c.getBoundingClientRect().right > right + 1).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
      return (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth + (past ? ' (' + past.tagName.toLowerCase() + '.' + String(past.className).split(' ')[0] + ' "' + (past.textContent || '').trim().slice(0, 20) + '" ' + Math.round(past.getBoundingClientRect().right) + '>' + Math.round(right) + ')' : '');
    });
  const narrow = [...document.querySelectorAll('#setup-notice .nbs-zone-name,#setup-notice .nb-zone-place, #setup-notice .nbs-when, #setup-notice .nb-step-items, .sheet-overlay:not([hidden]) .gl-title')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < 80).map((e) => (e.textContent || e.value || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  return { issues, sideways, clip, narrow };
};

async function openPage(browser, { camp, w, scheme, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2027-05-12T19:15:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo|camp-alerts\.patricksimpson-fx\.workers\.dev/, (r) => r.abort());
  await page.goto(BASE + '/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(() => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    setMemberRole('editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupReady = true; configReady = true;
    openBuilder();
    renderAll();
    // Nothing is wired: keep the renderer from putting the hub back while the specimen is up.
    window.renderSetupUi = () => {};
  });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(SPECIMENS);
  const camps = process.env.CAMPS ? process.env.CAMPS.split(',') : ['junior', 'senior'];
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : process.env.SIZE ? [process.env.SIZE.split(',').map((x, i) => (i === 1 ? x : +x))]
    : [[360, 'light', 100], [390, 'dark', 100], [360, 'light', 130], [390, 'light', 130], [360, 'dark', 200], [390, 'light', 200]];
  for (const name of only) {
    for (const camp of camps) {
      const sp = Object.assign({ name }, SPECIMENS[name]);
      for (const [w, scheme, txt] of sizes) {
        const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt });
        try {
          await page.evaluate(`(${fill.toString()})(${JSON.stringify(sp)})`);
          // The team shields are images: let every one finish decoding before anything is measured or drawn.
          await page.evaluate(() => Promise.race([Promise.all([...document.querySelectorAll('#setup-notice img')].map((i) => (i.decode ? i.decode().catch(() => {}) : null))), new Promise((r) => setTimeout(r, 5000))]));
          await page.waitForTimeout(350);
          const m = await page.evaluate(MEASURE);
          const tag = [name, camp, w, scheme, txt + '%'].join(' ');
          report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip, narrow: m.narrow });
          if (process.env.SHOTS) {
            const full = sp.build !== 'sheet';
            // The first screen as the phone shows it (the dock pinned), then the whole page with the dock in flow.
            if (full) await page.screenshot({ path: OUT + ['s30', name, camp, w, scheme, txt, 'v'].join('-') + '.png' });
            if (full) await page.addStyleTag({ content: '.setup-dock{position:static!important}' });
            await page.screenshot({ path: OUT + ['s30', name, camp, w, scheme, txt].join('-') + '.png', fullPage: full });
          }
        } catch (e) { report.push({ tag: name + ' ' + camp + ' ' + w, error: String(e).slice(0, 300) }); }
        if (errs.length) report.push({ tag: name + ' ' + camp + ' ' + w + ' page errors', pageErrors: errs });
        await ctx.close();
      }
    }
  }
  await browser.close();
  const bad = report.filter((r) => (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length) || (r.narrow && r.narrow.length) || r.error || r.pageErrors);
  console.log(JSON.stringify(bad, null, 1));
  console.log(report.length + ' checks, ' + bad.length + ' with findings');
})();
