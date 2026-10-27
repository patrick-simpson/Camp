// Smoke + behaviour checks for motion-demo.html (scratch tooling).
const path = require('path'); const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const errs = [], reqs = [], out = {};
  try {
    const c = await b.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 }); const p = await c.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
    p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) reqs.push(r.url()); });
    await p.goto('file://' + path.join(__dirname, 'motion-demo.html')); await p.waitForTimeout(900);
    out.jellyDefined = await p.evaluate(() => !!customElements.get('jelly-button') && !!window.jellyToast);
    const act = async (a, w = 900) => { await p.click(`.cb[data-act="${a}"]`); await p.waitForTimeout(w); };
    // 1 game done
    await act('game', 2200); await p.screenshot({ path: path.join(__dirname, '_t1.png') });
    // 2 reveal: keyed FLIP keeps nodes and glides neighbours
    await act('reveal', 700); await act('reveal', 1700); await act('reveal', 300);
    out.flip = await p.evaluate(() => { const rows = [...document.querySelectorAll('#lad .rv.shown')]; return rows.map((r) => r.getAnimations().length); });
    await p.waitForTimeout(1800);
    out.lookShownDuringLag = await p.evaluate(() => document.querySelectorAll('#lad .rv.look').length);
    await act('reveal', 2200); await p.screenshot({ path: path.join(__dirname, '_t2.png') });
    // 3 remote: blocked tap is explained, back locked during the beat
    await act('remote', 900); await act('remote', 300);
    out.faceWhileCharging = await p.locator('#biglab').innerText();
    await p.click('#bigbtn'); await p.waitForTimeout(400);
    out.blockedToast = await p.evaluate(() => { const t = document.querySelector('jelly-toaster'); return t && t.shadowRoot ? [...t.shadowRoot.querySelectorAll('.toast-text')].map((x) => x.textContent) : []; });
    out.backLocked = await p.evaluate(() => document.getElementById('rm-backbtn').classList.contains('locked'));
    await p.waitForTimeout(3200); await p.screenshot({ path: path.join(__dirname, '_t3.png') });
    // peek
    const nx = await p.locator('#rl .rr.nx').boundingBox(); await p.mouse.move(nx.x + 60, nx.y + 20); await p.mouse.down(); await p.waitForTimeout(600);
    out.peekShowsName = await p.evaluate(() => !!document.querySelector('#rl .rr.nx.peek b.n'));
    await p.mouse.up(); await p.waitForTimeout(200);
    out.remaskedAfterRelease = await p.evaluate(() => !document.querySelector('#rl .rr.nx.peek'));
    await p.click('#remote-back'); await p.waitForTimeout(500);
    // 4 sheet: list scrolls, a button inside gets its tap, strip drag closes
    await act('sheet', 900);
    await p.mouse.move(700, 600); // ensure somewhere
    const sb = await p.locator('#sheet-b').boundingBox(); await p.mouse.move(sb.x + 100, sb.y + 100); await p.mouse.wheel(0, 200); await p.waitForTimeout(300);
    out.sheetScrolled = await p.evaluate(() => document.getElementById('sheet-b').scrollTop);
    const btn = p.locator('#sheet-b [data-msg]').nth(4); await btn.click(); await p.waitForTimeout(400);
    out.buttonInSheetToast = await p.evaluate(() => { const t = document.querySelector('jelly-toaster'); return [...t.shadowRoot.querySelectorAll('.toast-text')].map((x) => x.textContent).filter((x) => x.startsWith('Opening')); });
    await p.screenshot({ path: path.join(__dirname, '_t4.png') });
    const st = await p.locator('#sheet-h').boundingBox(); await p.mouse.move(st.x + 100, st.y + 20); await p.mouse.down(); await p.mouse.move(st.x + 100, st.y + 300, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(700);
    out.sheetClosedByStrip = await p.evaluate(() => document.getElementById('sheet').hidden);
    // 5 calm: no transform keyframes are created while calm
    await p.click('#calmseg button[data-v="on"]'); await act('reset', 700);
    await p.evaluate(() => { window.__tf = 0; const o = Element.prototype.animate; Element.prototype.animate = function (k, t) { const arr = Array.isArray(k) ? k : []; if (arr.some((f) => f && f.transform && f.transform !== 'none' && !/scaleX/.test(f.transform))) window.__tf++; return o.call(this, k, t); }; });
    await act('game', 800); await act('reveal', 300); await act('reveal', 1700); await act('remote', 800); await act('remote', 600); await act('toast', 400); await p.click('#remote-back'); await p.waitForTimeout(400);
    out.transformAnimationsWhileCalm = await p.evaluate(() => window.__tf);
    // Off does not beat the phone's Reduce Motion
    await p.click('#calmseg button[data-v="off"]'); await p.check('#fake-reduce'); await p.waitForTimeout(100);
    out.offVsOsReduce = await p.locator('#readout').innerText();
    out.legend = await p.locator('#legend').innerText();
  } finally { await b.close(); }
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errs); console.log('external requests', reqs);
})();
