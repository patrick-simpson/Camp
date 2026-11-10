// Step 29 pass 2 of 2: CONTRAST. Every visible text node's computed colour against its effective background (the opaque ancestors'
// backgrounds composited, text opacity included), in BOTH themes, both camps, on every screen of step29-views.cjs. The rule (CLAUDE.md):
// 7:1 under 16px, 4.5:1 at 16px and over, 3:1 for boundaries (a field's edge or fill against its surround; the keyboard focus ring of
// the first controls reached with Tab). Fix a failure in styles.css's VISUAL SYSTEM block (the token), not at the rule; a one-off colour
// needs a WHY comment. Text inside a Jelly component's shadow root is read from its host's --jelly-* tokens by the token tests
// (contrast.test.js), not here; gradients / images as a background are skipped (reported as "unknown bg" with CONTRAST_VERBOSE=1).
//   node step29-contrast.cjs     env: CAMPS=junior  SIZES=390/dark/100,390/light/200  VIEWS=more-cou  SHARD=0/4  CONTRAST_VERBOSE=1
const { plan, openView, chromium } = require('./step29-views.cjs');
const FOCUS_TABS = +(process.env.FOCUS_TABS || 6);

const AUDIT = ({ verbose }) => {
  const parse = (c) => { const sr = c && c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/); if (sr) return { r: sr[1] * 255, g: sr[2] * 255, b: sr[3] * 255, a: sr[4] == null ? 1 : +sr[4] }; const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,/ ]+/).filter(Boolean).map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (fg, bg, op) => { const a = fg.a * (op == null ? 1 : op); return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }; };
  const shown = (e) => { if (e.closest('[hidden]') || e.closest('[inert]')) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let unknown = 0;
  const bgOf = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { unknown++; return null; }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor); if (!base || base.a < 0.5) base = { r: 255, g: 255, b: 255, a: 1 };
    if (document.body) { const bb = parse(getComputedStyle(document.body).backgroundColor); if (bb && bb.a >= 0.99 && !stack.length) base = bb; }
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const opacityOf = (e) => { let o = 1; for (let q = e; q; q = q.parentElement) o *= parseFloat(getComputedStyle(q).opacity); return o; };
  const out = { text: [], edge: [], unknown: 0 };
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const p = n.parentElement; if (!p || !n.textContent.trim() || !shown(p) || p.closest('script, style, svg, canvas, jelly-toaster')) continue;
    const cs = getComputedStyle(p); const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(p); if (!bg) continue;
    const eff = over(fg, bg, opacityOf(p));
    const r = ratio(eff, bg); const size = parseFloat(cs.fontSize); const need = size < 16 ? 7 : 4.5;
    if (r < need - 0.05) out.text.push('"' + n.textContent.trim().slice(0, 24) + '" ' + r.toFixed(2) + ' (need ' + need + ') @' + size.toFixed(0) + 'px ' + (p.id ? '#' + p.id : '.' + String(p.className).split(' ')[0] || p.tagName.toLowerCase()));
  }
  // boundaries: a field's edge (or fill) against what it sits on
  document.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea').forEach((el) => {
    if (!shown(el) || el.type === 'file') return; // a file input is a visually hidden twin of its label row
    const cs = getComputedStyle(el); const par = bgOf(el.parentElement); if (!par) return;
    const bw = parseFloat(cs.borderTopWidth) || 0; const bc = parse(cs.borderTopColor);
    let best = 0;
    if (bw >= 1 && cs.borderTopStyle !== 'none' && bc) best = Math.max(best, ratio(over(bc, par), par));
    const own = parse(cs.backgroundColor); if (own && own.a > 0.5) best = Math.max(best, ratio(over(own, par), par));
    const sh = (cs.boxShadow || '').match(/rgba?\([^)]+\)/); if (sh && /inset|0px 0px 0px/.test(cs.boxShadow)) { const c = parse(sh[0]); if (c) best = Math.max(best, ratio(over(c, par), par)); }
    if (best < 3 - 0.02) out.edge.push('field edge ' + best.toFixed(2) + ' ' + (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]));
  });
  out.unknown = unknown;
  return out;
};
// The element holding keyboard focus after a Tab: its ring (outline, or a box-shadow on it or its ::after) against what is behind it.
const FOCUS = () => {
  const el = document.activeElement; if (!el || el === document.body) return null;
  const parse = (c) => { const sr = c && c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/); if (sr) return { r: sr[1] * 255, g: sr[2] * 255, b: sr[3] * 255, a: sr[4] == null ? 1 : +sr[4] }; const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,/ ]+/).filter(Boolean).map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  let bg = { r: 255, g: 255, b: 255 };
  const stack = []; for (let n = el.parentElement; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; } }
  for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }; }
  const cands = [];
  for (const pe of [null, '::after', '::before']) {
    const cs = getComputedStyle(el, pe);
    if (!pe && parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') { const c = parse(cs.outlineColor); if (c) cands.push(ratio(c, bg)); }
    const sh = (cs.boxShadow || '').match(/rgba?\([^)]+\)/g); if (sh && cs.boxShadow !== 'none') sh.forEach((s) => { const c = parse(s); if (c && c.a > 0.5) cands.push(ratio(c, bg)); });
  }
  // a field that swaps its ring for a darker/camp-blue EDGE on focus (outline none): the border is the indicator
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { const cs = getComputedStyle(el); const c = parse(cs.borderTopColor); if (c && parseFloat(cs.borderTopWidth) >= 1.5) cands.push(ratio(c, bg)); }
  // a Jelly component draws its own ring inside its shadow root: only the host's token is readable here
  const jelly = /^JELLY-/.test(el.tagName);
  const best = cands.length ? Math.max(...cands) : 0;
  return { who: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]), best, jelly };
};

(async () => {
  const browser = await chromium.launch();
  const jobs = plan(['390/light/100', '390/dark/100']); const bad = []; let n = 0; const seen = new Set();
  for (const j of jobs) {
    const tag = `${j.v.n} | ${j.camp} ${j.sz.w} ${j.sz.scheme} ${j.sz.text}%`;
    const { ctx, page, errs } = await openView(browser, j);
    try {
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' }); // a ring still easing in reads as none
      const a = await page.evaluate(AUDIT, { verbose: !!process.env.CONTRAST_VERBOSE });
      const p = [];
      if (a.text.length) p.push('text: ' + [...new Set(a.text)].slice(0, 6).join(' | '));
      if (a.edge.length) p.push([...new Set(a.edge)].slice(0, 3).join(' | '));
      for (let i = 0; i < FOCUS_TABS; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(160); // outlines transition
        const f = await page.evaluate(FOCUS);
        if (f && !f.jelly && f.best < 3 - 0.02) { const k = j.camp + j.sz.scheme + f.who; if (!seen.has(k)) { seen.add(k); p.push('focus ring ' + f.best.toFixed(2) + ' on ' + f.who); } }
      }
      if (process.env.CONTRAST_VERBOSE && a.unknown) p.push('unknown bg x' + a.unknown);
      if (p.length) bad.push(tag + ' :: ' + p.join(' || '));
    } catch (e) { bad.push(tag + ' :: harness ' + String(e).slice(0, 120)); }
    await ctx.close(); n++;
  }
  await browser.close();
  console.log(`${n} screens audited`); console.log(bad.length ? bad.join('\n') : 'NO ISSUES');
  process.exitCode = bad.length ? 1 : 0;
})();
