// Step 29 pass 1 of 2: EVERY mockup screen (docs/build-notes/mockups/final, Appendix A) and every screen built since (the Set up the week
// screens and sheets, People / Teams / Campers, the new-year setup, the reveal in each state, the drawers) on the REAL renderers.
// Both camps; counselor / director / owner (per view); 360 and 390 wide; light and dark; 100 / 130 / 200% text. Reports: a tap target under
// 44x44, sideways scroll, a label clipped inside its box, a row squeezed to one word a line, a console / page error, and (counselor and
// preview views) a point or a place in the page's text.  Screens are in step29-views.cjs.
//   node step29-pass.cjs      env: CAMPS=junior  SIZES=390/light/100,360/dark/200  VIEWS=more-cou,hub  SHARD=0/4  SHOTS=dir
// Default is the whole matrix (about 1,500 page loads): run it as four shards, e.g. for i in 0 1 2 3; do SHARD=$i/4 node step29-pass.cjs & done
const fs = require('fs');
const { chromium, plan, openView } = require('./step29-views.cjs');
const SHOTS = process.env.SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ALL = [];
for (const w of [360, 390]) for (const s of ['light', 'dark']) for (const t of [100, 130, 200]) ALL.push(`${w}/${s}/${t}`);

const MEASURE = (rootSel) => {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  const shown = (e) => {
    if (e.closest('[hidden]') || e.closest('[inert]')) return false;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const out = { small: [], clipped: [], narrow: [], sideways: 0 };
  if (!root) { out.missing = true; return out; }
  const sel = 'button, a[href], [role="tab"], [role="radio"], [role="checkbox"], [role="button"], summary, input:not([type="hidden"]), select, textarea, jelly-switch, jelly-checkbox, jelly-chip, jelly-button, jelly-input';
  const seen = new Set();
  root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el) || !shown(el)) return; seen.add(el);
    if (el.closest('.sheet-grab, .tab-blob, [data-sheet-grab]')) return;
    // a stretched hit button (.gr-hit) is the whole row: its ::after covers the row's box
    const r = (el.classList.contains('gr-hit') && el.closest('.gr') ? el.closest('.gr') : el).getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight + 1) return; // slid away under a takeover, or scrolled off
    if (el.tagName === 'INPUT' && el.closest('label.gl-row, label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5) return; }
    if (el.closest('jelly-chip, jelly-button') && el !== el.closest('jelly-chip, jelly-button')) return;
    if (Math.min(r.width, r.height) < 43.5) out.small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"');
  });
  const sw = document.documentElement.scrollWidth - innerWidth; out.sideways = sw > 1 ? sw : 0;
  const W = innerWidth;
  root.querySelectorAll('*').forEach((e) => { if (!shown(e)) return; const r = e.getBoundingClientRect(); if (r.right > W + 1.5 && !e.closest('[data-scroll], .daypick, #award-jump, .chat-tabs, .tm-strip, svg, canvas')) out.clipped.push('past the edge: ' + String(e.className || e.tagName).split(' ')[0] + ' ' + Math.round(r.right)); });
  [...root.querySelectorAll('button, .gl-title, .gl-sub, .aw-name, .tell-tick-title, .tell-live-title, .cb-title, .cb-sub, .nw-label-w, .gr-name, .msg-text')]
    .filter((e) => shown(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && getComputedStyle(e).textOverflow !== 'ellipsis' && !e.closest('.daypick, .chat-tabs'))
    .forEach((e) => out.clipped.push('label cut: ' + ((e.id || e.className) + '').slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth));
  [...root.querySelectorAll('.gl-title, .gl-sub, .cb-title, .cb-sub, .aw-name, .gr-name')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < 80 && (e.textContent || '').trim().length > 12)
    .forEach((e) => out.narrow.push((e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px'));
  return out;
};
// What a counselor must not read: a point, a gap, a place nobody revealed (a reveal view and a bracket's "3rd place match" are the allowed places).
const LEAKS = (allowPlaces) => {
  const text = document.body.innerText || ''; const words = [];
  const pats = [[/\b\d+\s?pts?\b/i, 'points'], [/\bpoints? (behind|ahead|back)\b/i, 'a gap'], [/\bCurrent standings\b/i, 'the standings']];
  if (!allowPlaces) pats.push([/\b\d+(st|nd|rd|th) place\b/i, 'a place']);
  pats.forEach(([re, why]) => { const m = re.exec(text); if (m) words.push(why + ': ' + m[0]); });
  return words;
};

(async () => {
  const browser = await chromium.launch();
  const jobs = plan(ALL); const bad = []; let n = 0;
  for (const j of jobs) {
    const tag = `${j.v.n} | ${j.camp} ${j.sz.w} ${j.sz.scheme} ${j.sz.text}%`;
    const { ctx, page, errs } = await openView(browser, j);
    try {
      const m = await page.evaluate(MEASURE, j.v.root || null);
      const p = [];
      if (m.missing) p.push('root ' + j.v.root + ' missing');
      if (m.small.length) p.push('small: ' + [...new Set(m.small)].slice(0, 5).join(' | '));
      if (m.sideways) p.push('sideways +' + m.sideways);
      if (m.clipped.length) p.push('clipped: ' + [...new Set(m.clipped)].slice(0, 3).join(' | '));
      if (m.narrow.length) p.push('squeezed: ' + [...new Set(m.narrow)].slice(0, 3).join(' | '));
      if (j.v.who === 'counselor' || /^preview/.test(j.v.n)) {
        const w = await page.evaluate(LEAKS, /^(reveal|now-legacy|game-legacy|game-six)/.test(j.v.n));
        if (w.length) p.push('LEAK ' + w.join(' / '));
      }
      if (errs.length) p.push('errors: ' + errs.slice(0, 2).join(' | '));
      if (p.length) bad.push(tag + ' :: ' + p.join(' || '));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${j.camp}-${j.v.n}-${j.sz.w}-${j.sz.scheme}-${j.sz.text}.png`, fullPage: !j.v.root || j.v.root === '#setup' });
    } catch (e) { bad.push(tag + ' :: harness ' + String(e).slice(0, 120)); }
    await ctx.close(); n++;
  }
  await browser.close();
  console.log(`${n} screens checked`); console.log(bad.length ? bad.join('\n') : 'NO ISSUES');
  process.exitCode = bad.length ? 1 : 0;
})();
