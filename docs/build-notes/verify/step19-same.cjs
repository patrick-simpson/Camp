// Step 19 equivalence check, in a real browser (a counselor's page, no sign-in): the Happening Now banner at every quarter hour of
// all seven days, the schedule sheet body for each day, the verses, the cleanup rota, the electives and the staff names are
// compared between "schedule edited here" and "every section edited here too" (the seed switched on for all five). Expected:
// identical on both camps, except staffNames() on junior gains the two game leaders on the elective stations (Patrick, Stephen),
// which is the spec's "+ elective people names" for the chat mention dictionary.
// node step19-same.cjs   (serve the worktree on :8943 first: python3 -m http.server 8943)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  for (const camp of ['junior', 'senior']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York' });
    await ctx.addInitScript(({ camp }) => { localStorage.setItem('campScoreboardAuthHint', 'viewer'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); }, { camp });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
    await page.goto('http://localhost:8943/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && !!document.getElementById('tab-btn-more') && typeof setMemberRole === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const res = await page.evaluate(() => {
      const snap = () => {
        const out = [];
        for (let dow = 0; dow < 7; dow++) {
          for (let m = 0; m < 1440; m += 15) out.push(String(nowBannerHtml(dow, m)));
          scheduleDay = dow; renderScheduleBody();
          out.push(document.getElementById('schedule-body').innerHTML);
                  }
        out.push(JSON.stringify([1, 2, 3, 4, 5].map((d) => [verseFor(d), cleanupTeams(d, 'Lunch'), electivesFor(d).map((s) => s.map((r) => [r[0], r[1]]))])), JSON.stringify(verseTheme()));
        out.push(JSON.stringify(staffNames()));
        return out.join('\n');
      };
      const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16) + ':' + s.length; };
      setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP)))); setupRev++;
      const off = snap();
      setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
      const on = snap();
      let firstDiff = ''; if (off !== on) { const a = off.split('\n'), b = on.split('\n'); const i = a.findIndex((x, k) => x !== b[k]); firstDiff = i + ': ' + a[i].slice(0, 300) + ' ||| ' + String(b[i]).slice(0, 300); }
      return { off: hash(off), on: hash(on), same: off === on, firstDiff };
    });
    console.log(camp, JSON.stringify(res), errs.length ? errs : 'no page errors');
    await ctx.close();
  }
  await browser.close();
})();
