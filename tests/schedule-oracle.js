// THE SCHEDULE ORACLE (tests only: the harness loads this after the app's scripts, and index.html never does).
// The old "Happening now" banner as markup, for any weekday and minute. Since Step 17 nothing on the page calls it: the Now card paints
// from nowModel(). It lives here because week.test.js / week.senior.test.js / seed.test.js (and docs/build-notes/verify/step19-same.cjs, which
// injects this file into a page) compare the schedule's DATA through it — a 10,080-minute digest before and after the schedule is edited
// here — which is a check nowModel's own walk does not replace. It must stay byte-for-byte what it was: the digests pin its output.
// Do not add a caller; do not extend it.

// Rain warning for the banner: upcomingRain() (app.js) as markup.
function upcomingRainHint() {
  const r = upcomingRain();
  return r ? `<div class="now-wx">🌧️ ${r.precip}% chance of rain ${r.when}</div>` : '';
}

function nowBannerHtml(dow, minutes) {
  const blocks = scheduleForDow(dow);
  if (!blocks.length) return null;

  const eyebrow = `<div class="now-eyebrow-row">
    <span class="now-eyebrow">Happening now</span>
    <span class="now-open-hint">📅 Full schedule ›</span>
  </div>`;
  // progress is the elapsed fraction of the current timed block (0–1), or null
  // to omit the bar (untimed blocks, or before the day's first block).
  const progressBar = (progress) => progress == null ? '' :
    `<jelly-progress class="now-progress" size="small" value="${Math.round(Math.max(0, Math.min(1, progress)) * 100)}" max="100" aria-hidden="true"></jelly-progress>`;
  // `meal` / `nextMeal`: the Meal tag of the block and of the one after it (blockMeal), for the cleanup note.
  const main = (emoji, label, time, next, progress, meal, nextMeal) => eyebrow +
    `<div class="now-main"><span class="now-emoji">${emoji}</span><div class="now-body">
      <div class="now-label">${esc(label)}${time ? ` <span class="now-time">${time}</span>` : ''}${mealCleanupNote(dow, label, meal)}</div>
      ${next ? `<div class="now-next">Up next: ${next.emoji} ${esc(next.label)} at ${schedClock(next.start, true)}${mealCleanupNote(dow, next.label, nextMeal)}</div>` : ''}
      ${upcomingRainHint()}
    </div></div>` + progressBar(progress);

  // Early morning, before the first block of the day.
  if (minutes < blocks[0].start) {
    const first = decorateMealBlock(dow, blocks[0]);
    if (dow === 0) return main('🚌', 'Camp starts today!', null, first, null, undefined, blockMeal(blocks[0]));
    return main('🛏️', "Lights out — everyone's sleeping", null, first, null, undefined, blockMeal(blocks[0]));
  }

  const found = blocks.find((x) => minutes >= x.start && minutes < x.end);
  if (!found) return null;

  // During competition blocks the scoreboard is the main event — keep the
  // banner to a slim, tappable one-liner rather than hiding it entirely, so the
  // schedule sheet stays reachable.
  if (found.type === 'games') {
    // Named after the actual block — junior's say "Team competitions" /
    // "Evening competition", senior's include the Legacy Game by name.
    return `<div class="now-slim"><span class="now-slim-label">${esc(found.emoji)} ${esc(found.label)}</span><span class="now-open-hint">📅 Full schedule ›</span></div>` + upcomingRainHint();
  }

  const b = decorateMealBlock(dow, found);
  const time = b.noTime ? null : schedRange(b.start, b.end);
  const progress = b.noTime ? null : (minutes - b.start) / (b.end - b.start);
  if (b.type === 'elective') {
    const chip = (k, key) => { const you = electiveIsMe(k, key || ''); return `<span class="kid-chip${you ? ' kid-chip-you' : ''}">${esc(k)}${you ? ' ⭐' : ''}</span>`; };
    const stations = electivesFor(dow)[b.slot] || [];
    let rows = stations.map((row) =>
      `<div class="now-station${electiveRowHasMe(row) ? ' now-station-you' : ''}"><span class="now-station-name">${stationEmoji(row[0])} ${esc(row[0])}</span>
        <span class="now-kids">${row[1].map((k, i) => chip(k, row[2] && row[2][i])).join('')}</span></div>`).join('');
    const breakKids = electiveBreakKids(dow, b.slot);
    if (breakKids.length) {
      rows += `<div class="now-station now-break${breakKids.some((k) => electiveIsMe(k, '')) ? ' now-station-you' : ''}"><span class="now-station-name">☕ Break</span>
        <span class="now-kids">${breakKids.map((k) => chip(k)).join('')}</span></div>`;
    }
    return main(b.emoji, b.label, time, null, progress) + `<div class="now-stations">${rows}</div>`;
  }

  // "Up next" = the next block that starts at or after this one ends. Using
  // the end time (not just index+1) keeps it correct when blocks overlap
  // (e.g. tonight's movie night sitting over the wind-down) — for a normal,
  // non-overlapping day this is the very next block, exactly as before.
  const after = blocks.find((x) => x.start >= found.end);
  const next = decorateMealBlock(dow, after || null);
  return main(b.emoji, b.label, time, next, progress, blockMeal(found), blockMeal(after));
}
