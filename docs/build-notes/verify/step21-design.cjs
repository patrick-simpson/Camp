// Step 21 design pass: Set up the week → Games (P2 §11.14) drawn into the REAL page with the real styles.css. Nothing is
// wired yet, so this script writes the documented markup itself (index.html: the "Games (P2 §11.14; Step 21)" comment at
// #setup-games, #sg-days in the head, and the GAMES comment at #sheet-game / #sheet-sg-day). The specimens are a
// reference for the build session: the templates, filled from the real week (planForDow, gamesForDay, unscheduledGames)
// through the page's own teamMarkHtml / teamAccentVars / teamShort / setupRange.
// For each specimen, camp, width (360 / 390), theme and text size (100 / 130 / 200 %) it reports tap targets under
// 44x44, sideways scroll, and text squeezed into a narrow column; SHOTS=1 writes screenshots (OUT=<dir>, default the OS
// temp dir + /shots/).
//   node step21-design.cjs [baseUrl]   (ONLY=<specimen>[,…], QUICK=1 for 390 light 100% only)
// Serve the worktree first: python3 -m http.server 8961 (Firebase is blocked; the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8961').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

const SPECIMENS = {
  // Wednesday, junior: two Games items with their games, a game parked on no item (Rain bowling), the day's note.
  'games-wed': { camp: 'junior', build: 'screen', dow: 3, extra: 'loose', note: 'Bring a towel, the evening games get wet' },
  // Friday: Team Skits on its own item, double points on the evening, a TBA place flagged.
  'games-fri': { camp: 'junior', build: 'screen', dow: 5, extra: 'tba' },
  // Saturday: not a games day.
  'games-sat': { camp: 'junior', build: 'screen', dow: 6 },
  // A games day with nothing under it yet (the guided first game).
  'games-empty': { camp: 'junior', build: 'screen', dow: 4, empty: true },
  // Senior Monday: four items, Legacy Game on its own.
  'senior-mon': { camp: 'senior', build: 'screen', dow: 1 },
  // The game sheet, new, from "Add a game here": only the name and where.
  'sheet-name': { camp: 'junior', build: 'sheet', stage: 'name', mode: 'new', dow: 3 },
  // A name is in: How is it scored? arrives.
  'sheet-format': { camp: 'junior', build: 'sheet', stage: 'format', mode: 'new', dow: 3, gname: 'Rain bowling' },
  // A bracket with its matchups set now (pairs board, two placed), the live scoreboard on.
  'sheet-bracket': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'edit', dow: 1, gid: 'kangaroo-kickball', seed: 'fixed', pairs: 2, collapsed: true },
  // Senior's bracket: by the standings (the rule in words), collapsed format row.
  'sheet-bracket-senior': { camp: 'senior', build: 'sheet', stage: 'game', mode: 'edit', dow: 1, format: 'tournament', seed: 'fixed', pairs: 1, collapsed: true },
  // Scores (tally): what's counted, the switches, counter buttons with an error; Extras open with the timer.
  'sheet-tally': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'edit', dow: 3, format: 'tally', extras: true, error: true, collapsed: true },
  // The quick game: Podium picked, named, created: Score it now.
  'sheet-quick': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'quick', dow: 3, format: 'placement', gname: 'Water balloon toss' },
  // How to play open, two sections; the order pair.
  'sheet-howto': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'edit', dow: 1, gid: 'shields', howto: true, order: true, collapsed: true },
  // Changing how a scored game is scored: all three ways open again, the warning first.
  'sheet-change': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'edit', dow: 1, gid: 'shields', changing: true },
  // Deleted on another phone while open.
  'sheet-gone': { camp: 'junior', build: 'sheet', stage: 'game', mode: 'edit', dow: 1, gid: 'shields', gone: true, collapsed: true },
  // The When pane: Thursday's items, the current one checked.
  'sheet-when': { camp: 'junior', build: 'when', dow: 4, gid: 'shields' },
  'sheet-when-senior': { camp: 'senior', build: 'when', dow: 2 },
  // The day's sheet.
  'day-sheet': { camp: 'junior', build: 'day', dow: 3, note: 'Bring a towel, the evening games get wet' },
};

// Runs in the page. Writes the frame for one specimen.
function fill(sp) {
  const $ = (id) => document.getElementById(id);
  const hide = (id, h) => { const el = $(id); if (el) el.hidden = h; };
  const text = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const html = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  const ico = (id, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const FMT = { tournament: 'Bracket', tally: 'Scores', placement: 'Podium' };
  const DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dow = sp.dow;
  const campName = CAMP.id === 'senior' ? 'Senior camp' : 'Junior camp';
  const dayIdsOf = (d) => competitionDays().filter((x) => x.dow === d).map((x) => x.id);
  const gamesOn = (d) => allGames().filter((g) => dayIdsOf(d).indexOf(g.dayId) !== -1);
  const richOf = (b) => (typeof setupRichOf === 'function' && setupRichOf(b)) || b;
  const emo = (e) => safeEmoji(e, '') ? `<span class="sched-emo" aria-hidden="true">${safeEmoji(e, '')}</span>` : '';
  const sub = (g, warn) => [FMT[g.format] || 'Not set', warn ? 'where: TBA' : (g.location || ''), g.messtival ? 'double points' : ''].filter(Boolean).map(esc).join(' · ');
  const gameRow = (g, warn) => `<button type="button" class="cb-row sg-game" data-key="g-${esc(g.id)}" data-sg-open="${esc(g.id)}"${warn ? ' data-warn' : ''}>` +
    `<span class="cb-main"><span class="cb-title">${emo(g.emoji)}<span>${esc(g.name)}</span></span><span class="cb-sub">${sub(g, warn)}</span></span>` +
    `<span class="cb-end">${ico('i-chev-r', 'gl-chev')}</span></button>`;
  const looseRow = (g, was) => `<div class="cb-row sg-game gl-row-split" data-key="g-${esc(g.id)}">` +
    `<button type="button" class="gl-row-hit" data-sg-open="${esc(g.id)}" aria-labelledby="sg-n-${esc(g.id)}"></button>` +
    `<span class="cb-main"><span class="cb-title">${emo(g.emoji)}<span id="sg-n-${esc(g.id)}">${esc(g.name)}</span></span><span class="cb-sub">${sub(g)}${was ? ' · was on ' + esc(was) : ''}</span></span>` +
    `<span class="cb-end"><button type="button" class="btn btn-sm sg-place" data-sg-place="${esc(g.id)}">Put on the schedule</button></span></div>`;

  // The frame: the Games screen, its back, and the strip.
  const setup = $('setup');
  setup.setAttribute('data-screen', 'games');
  text('setup-back-label', 'Set up the week');
  const today = 3;
  document.querySelectorAll('#sg-days-track .daypick-btn').forEach((b, i) => {
    const on = dayIdsOf(i).length > 0;
    const n = on ? (sp.empty && i === dow ? 0 : gamesOn(i).length + (sp.extra === 'loose' && i === dow ? 1 : 0)) : '';
    b.setAttribute('aria-selected', i === dow ? 'true' : 'false');
    b.toggleAttribute('data-off', !on);
    b.toggleAttribute('data-today', i === today);
    b.querySelector('[data-sg-n]').textContent = String(n);
    const warn = on && (n === 0 || (sp.extra === 'loose' && i === 3) || (sp.extra === 'tba' && i === 5));
    b.querySelector('[data-sd-warn]').hidden = !warn;
    b.setAttribute('aria-label', FULL[i] + (i === today ? ', today' : '') + (on ? ', ' + n + (n === 1 ? ' game' : ' games') : ', not a games day') + (warn ? ', needs a look' : ''));
  });

  if (sp.build === 'screen') {
    const plan = planForDow(dow);
    const isGamesDay = dayIdsOf(dow).length > 0;
    let groups = isGamesDay && !sp.empty ? gamesForDay(dow).map((x) => ({ b: richOf(x.block), games: x.games.slice() })) : [];
    // Games items with nothing on them yet are listed too (Add a game here).
    if (isGamesDay && !sp.empty) {
      plan.filter((b) => b.type === 'games' && !groups.some((x) => x.b.id === b.id)).forEach((b) => groups.push({ b, games: [] }));
      groups.sort((a, c) => a.b.start - c.b.start);
    }
    let loose = isGamesDay && !sp.empty ? unscheduledGames(dow).slice() : [];
    if (sp.extra === 'loose') {
      loose = loose.concat([{ id: 'rain-bowling', name: 'Rain bowling', emoji: '🎳', format: 'tally', location: 'Gym' }]);
    }
    const n = groups.reduce((s, x) => s + x.games.length, 0) + loose.length;
    text('sg-title', 'Games · ' + campName);
    text('sg-headline', FULL[dow]);
    text('sg-lede', !isGamesDay ? 'Not a games day' : sp.empty ? (dow === today ? 'Today · ' : '') + 'No games yet'
      : (dow === today ? 'Today · ' : '') + n + (n === 1 ? ' game' : ' games') + ' on ' + groups.filter((x) => x.games.length).length + ' schedule items' + (loose.length ? ' · ' + loose.length + ' isn’t on the schedule' : ''));
    hide('sg-day-btn', !isGamesDay);
    text('sg-day-btn-text', FULL[dow] + '’s options');
    hide('sg-note', !sp.note);
    text('sg-note-text', sp.note || '');
    hide('sg-noday', isGamesDay);
    text('sg-day-on-text', 'Make ' + FULL[dow] + ' a games day');
    hide('sg-empty', !(isGamesDay && sp.empty));
    text('sg-empty-text', 'No games on ' + FULL[dow] + ' yet.');
    html('sg-items', groups.map((x) => {
      const now = dow === today && x.b.start <= 615 && x.b.end > 615;
      return `<section class="sg-item" data-key="b-${esc(x.b.id || '')}"${now ? ' data-now' : ''}>` +
        `<h3 class="sg-item-h"><span class="sg-item-time">${esc(setupRange(x.b.start, x.b.end))}${now ? '<span class="sg-item-now">Now</span>' : ''}</span>` +
        `<span class="sg-item-name">${emo(x.b.emoji)}<span>${esc(x.b.base || x.b.label)}</span></span></h3>` +
        `<div class="gl cb-list sg-list">${x.games.map((g) => gameRow(g, sp.extra === 'tba' && g === x.games[x.games.length - 1] && x.b.start >= 1080)).join('')}` +
        `<button type="button" class="sg-add-here" data-sg-add="${esc(x.b.id || '')}">${ico('i-plus')}<span>Add a game here</span></button></div></section>`;
    }).join(''));
    hide('sg-sec-off', !loose.length);
    text('sg-off-note', loose.length ? loose.length + (loose.length === 1 ? ' game' : ' games') : '');
    html('sg-off-list', loose.map((g) => looseRow(g, sp.extra === 'loose' ? 'Tue · Team competitions' : '')).join(''));
    hide('sg-add', !isGamesDay || sp.empty);
    text('sg-add-text', 'Add a game to ' + FULL[dow]);
    hide('sg-orig', true);
    return;
  }

  // Sheets sit over the Games screen (render the screen first, then raise the sheet).
  fill(Object.assign({}, sp, { build: 'screen', note: sp.note }));
  if (sp.build === 'day') {
    text('sheet-sg-day-title', FULL[dow]);
    text('sg-day-note-label', 'Note on ' + FULL[dow] + '’s games');
    $('sg-day-note').value = sp.note || '';
    text('sg-day-off-title', 'Take ' + FULL[dow] + ' off the games days');
    text('sg-day-off-sub', 'First asks where its ' + gamesOn(dow).length + ' games go');
    $('sheet-sg-day').hidden = false;
    return;
  }

  const ov = $('sheet-game');
  const plan = planForDow(dow);
  let g = sp.gid ? gameById(sp.gid) : null;
  if (!g && sp.format === 'tournament') g = allGames().find((x) => x.format === 'tournament');
  if (!g && sp.format === 'tally') g = allGames().find((x) => x.format === 'tally');
  const block = plan.find((b) => g && b.id === g.blockId) || plan.find((b) => b.type === 'games') || plan[0];
  const format = sp.stage === 'name' ? '' : (sp.format || (g && g.format) || (sp.stage === 'format' ? '' : 'placement'));
  ov.dataset.pane = sp.build === 'when' ? 'when' : 'form';
  ov.dataset.stage = sp.stage || 'game';
  ov.dataset.mode = sp.mode || 'edit';
  if (format) ov.dataset.format = format; else delete ov.dataset.format;
  text('sheet-game-title', sp.build === 'when' ? 'When' : sp.mode === 'new' ? 'New game' : sp.mode === 'quick' ? 'Quick game' : 'Edit game');
  text('gm-when-text', (sp.mode === 'quick' ? 'Today' : FULL[dow]) + ' · ' + (block ? (block.base || block.label) + ', ' + setupRange(block.start, block.end) : 'Not on the schedule'));
  text('gm-when-btn', 'Change');
  $('gm-name').value = sp.gname || (g ? g.name : '');
  text('gm-emoji-now', g ? safeEmoji(g.emoji, '🏅') : (sp.gname ? '🎳' : '🏅'));
  $('gm-where').value = g ? (g.location || '') : (sp.mode === 'quick' ? 'Dining Hall' : 'Chapel Lawn');
  text('gm-where-hint', g ? '' : 'Where the last game here was');
  // How is it scored.
  const fmt = $('gm-format');
  fmt.querySelectorAll('[data-gm-format]').forEach((b) => b.setAttribute('aria-checked', b.dataset.gmFormat === format ? 'true' : 'false'));
  fmt.toggleAttribute('data-collapsed', !!sp.collapsed);
  const sub4 = CAMP.teamCount === 4;
  fmt.querySelector('[data-gm-fmt-sub="tournament"]').textContent = sub4 ? '2 semifinals, then the 3rd-place match, then the final' : 'Teams play head-to-head; winners move on';
  hide('gm-format-warn', !sp.changing);
  text('gm-format-warn-text', 'This game has a saved podium. Scoring it another way clears it.');
  // Bracket.
  text('gm-seed-standings-sub', sub4 ? '1st plays 4th, 2nd plays 3rd, from the points when it starts' : '1st plays 6th, 2nd plays 5th, 3rd plays 4th, from the points when it starts');
  $('gm-seed').querySelectorAll('[data-gm-seed]').forEach((b) => b.setAttribute('aria-checked', b.dataset.gmSeed === (sp.seed || 'standings') ? 'true' : 'false'));
  hide('gm-pairs', sp.seed !== 'fixed');
  if (sp.seed === 'fixed') {
    const ids = state.teams.map((t) => t.id);
    const order = ids.length === 4 ? ['t0', 't3', 't1', 't2'] : ['t0', 't3', 't1', 't4', 't2', 't5'];
    const want = sp.pairs * 2 - (sp.pairs > 1 ? 1 : 0); // a partly filled board
    const placed = order.slice(0, Math.min(want, ids.length));
    const matches = ids.length / 2;
    const slotHtml = (k) => {
      const tid = placed[k];
      if (tid) return `<span class="gm-slot" data-team="${tid}" style="${teamAccentVars(tid) || ''}">${teamMarkHtml(tid, { size: 22 })}<b>${esc(teamShort(tid) || tid)}</b></span>`;
      return k === placed.length ? '<span class="gm-slot" data-next>Next</span>' : '<span class="gm-slot"></span>';
    };
    let li = '';
    for (let m = 0; m < matches; m++) {
      li += `<li class="gm-match" data-match="${m}"><span class="gm-match-n">${sub4 ? 'Semifinal ' + (m + 1) : 'Match ' + (m + 1)}</span>${slotHtml(m * 2)}<span class="gm-vs" aria-hidden="true">v</span>${slotHtml(m * 2 + 1)}</li>`;
    }
    html('gm-matches', li);
    const keys = $('gm-keys');
    keys.dataset.n = String(ids.length);
    keys.innerHTML = ids.map((tid) => {
      const at = placed.indexOf(tid);
      const where = at === -1 ? '' : (sub4 ? 'Semifinal ' : 'Match ') + (Math.floor(at / 2) + 1);
      return `<button type="button" class="gm-key" data-team="${tid}" style="${teamAccentVars(tid) || ''}" aria-pressed="${at !== -1}" aria-label="${esc(teamShort(tid))}${where ? ', in ' + where + '. Tap to take them out' : ''}"><span class="gm-key-mark">${teamMarkHtml(tid, { size: 28 })}</span><span class="gm-key-nm">${esc(teamShort(tid) || tid)}</span><small class="gm-key-in">${where}</small></button>`;
    }).join('');
    const left = ids.length - placed.length;
    hide('gm-pairs-left', !left);
    text('gm-pairs-left', 'Pick ' + left + ' more ' + (left === 1 ? 'team' : 'teams') + '. Until then it plays as “Pick them when you start”.');
  }
  hide('gm-ladder', true);
  const trackerOn = !!(g && g.liveTracker) || sp.gid === 'kangaroo-kickball';
  $('gm-tracker').toggleAttribute('checked', trackerOn);
  document.querySelector('[data-switch-state="gm-tracker"]').textContent = trackerOn ? 'On' : 'Off';
  hide('gm-tracker-fields', !trackerOn);
  if (trackerOn) {
    const t = (g && g.liveTracker) || {};
    $('gm-tr-unit').value = t.unit || 'Home runs';
    $('gm-tr-period').value = t.periodLabel || 'Inning';
    $('gm-tr-periods').value = String(t.innings || 3);
    $('gm-tr-outs').value = String(t.outs == null ? 3 : t.outs);
  }
  // Scores.
  $('gm-unit').value = 'Laps';
  ['gm-lower', 'gm-times', 'gm-live'].forEach((id, i) => { const on = i === 2; $(id).toggleAttribute('checked', on); document.querySelector(`[data-switch-state="${id}"]`).textContent = on ? 'On' : 'Off'; });
  $('gm-steps').value = sp.error ? '1, five' : '1, 5';
  if (sp.error) $('gm-steps').setAttribute('aria-invalid', 'true'); else $('gm-steps').removeAttribute('aria-invalid');
  hide('gm-steps-error', !sp.error);
  text('gm-steps-error', 'Counter buttons must be numbers, like 1, 5.');
  hide('gm-negative-box', false);
  // Order.
  const siblings = block ? allGames().filter((x) => x.blockId === block.id) : [];
  const at = g ? siblings.indexOf(g) : -1;
  hide('gm-order', !(sp.order && siblings.length > 1));
  text('gm-order-label', 'Order in ' + (block ? (block.base || block.label) : ''));
  const earl = document.querySelector('[data-gm-order="earlier"]');
  const later = document.querySelector('[data-gm-order="later"]');
  earl.setAttribute('aria-disabled', at <= 0 ? 'true' : 'false');
  later.setAttribute('aria-disabled', at >= siblings.length - 1 ? 'true' : 'false');
  document.querySelector('[data-gm-order-sub="earlier"]').textContent = at > 0 ? 'Before ' + siblings[at - 1].name : 'First';
  document.querySelector('[data-gm-order-sub="later"]').textContent = at >= 0 && at < siblings.length - 1 ? 'After ' + siblings[at + 1].name : 'Last';
  // Extras.
  const dbl = !!(g && g.messtival) || sp.mode === 'quick';
  const timer = !!sp.extras;
  $('gm-double').toggleAttribute('checked', dbl);
  document.querySelector('[data-switch-state="gm-double"]').textContent = dbl ? 'On' : 'Off';
  $('gm-timer').toggleAttribute('checked', timer);
  document.querySelector('[data-switch-state="gm-timer"]').textContent = timer ? 'On' : 'Off';
  hide('gm-timer-fields', !timer);
  $('gm-timer-label').value = timer ? 'Round timer' : '';
  $('gm-timer-presets').value = timer ? '10, 8, 5' : '';
  $('gm-timer-rounds').value = timer ? '4' : '';
  text('gm-extras-sum', [dbl ? 'Double points' : '', timer ? 'Timer' : ''].filter(Boolean).join(' · ') || 'None yet');
  $('gm-extras').open = !!sp.extras;
  // How to play.
  const rules = (g && g.rules) || [];
  text('gm-howto-sum', rules.length ? rules.length + (rules.length === 1 ? ' section' : ' sections') : 'Not written yet');
  $('gm-howto').open = !!sp.howto;
  $('gm-headline').value = (g && g.headline) || '';
  html('gm-rules', rules.slice(0, 3).map((r, i) => `<div class="gm-rule" data-key="r-${i}">` +
    `<input type="text" class="fld-input gm-rule-h" data-gm-rule-h="${i}" maxlength="60" value="${esc(r.h || '')}" placeholder="Heading, like Setup" aria-label="Section ${i + 1} heading">` +
    `<textarea class="fld-input gm-rule-items gm-grow" data-gm-rule-items="${i}" rows="3" placeholder="One point per line" aria-label="Section ${i + 1}, one point per line">${esc((r.items || []).join('\n'))}</textarea>` +
    `<div class="gm-rule-acts">${i ? `<button type="button" class="btn-quiet" data-gm-rule-up="${i}">Move up</button>` : ''}<button type="button" class="btn-quiet btn-quiet-danger" data-gm-rule-remove="${i}">Remove</button></div></div>`).join(''));
  // Gone.
  hide('gm-gone', !sp.gone);
  text('gm-gone-text', 'Patrick deleted this game 2 minutes ago.');
  hide('gm-foot', sp.mode === 'new');
  // The dock.
  const stage = ov.dataset.stage;
  hide('gm-wait', stage === 'game');
  text('gm-wait-text', stage === 'name' ? 'Type the game’s name first' : 'Pick how it’s scored ↑');
  hide('gm-state', stage !== 'game');
  hide('gm-acts', stage !== 'game');
  const st = $('gm-state');
  st.dataset.tone = sp.error ? 'error' : 'saved';
  text('gm-state-text', sp.error ? 'Fix the counter buttons to save them' : sp.mode === 'quick' ? 'Added to today’s ' + (block ? (block.base || block.label) : 'games') : 'Saved');
  hide('gm-score', sp.mode !== 'quick');
  hide('gm-pane-back', sp.build !== 'when');
  text('gm-pane-back-label', g ? g.name : 'New game');

  if (sp.build === 'when') {
    const cur = g ? g.blockId : '';
    document.querySelectorAll('#gm-when-days .daypick-btn').forEach((b, i) => {
      b.setAttribute('aria-checked', i === dow ? 'true' : 'false');
      b.toggleAttribute('data-today', i === today);
    });
    const items = plan.filter((b) => !b.noTime);
    const first = items.filter((b) => b.type === 'games' || allGames().some((x) => x.blockId === b.id));
    const n = (b) => allGames().filter((x) => x.blockId === b.id && dayIdsOf(dow).indexOf(x.dayId) !== -1).length;
    html('gm-when-list', first.map((b) => {
      const here = b.id === cur;
      const c = n(b);
      return `<button type="button" class="cb-row gm-when-row" data-gm-block="${esc(b.id)}"${here ? ' aria-current="true"' : ''}>` +
        `<span class="cb-time">${esc(String(Math.floor(b.start / 60) % 12 || 12) + ':' + String(b.start % 60).padStart(2, '0'))}<small>–${esc(String(Math.floor(b.end / 60) % 12 || 12) + ':' + String(b.end % 60).padStart(2, '0'))}</small></span>` +
        `<span class="cb-main"><span class="cb-title">${emo(b.emoji)}<span>${esc(b.base || b.label)}</span></span><span class="cb-sub">${here ? 'Here now · ' : ''}${c ? c + (c === 1 ? ' game' : ' games') : 'No games yet'}</span></span>` +
        `<span class="cb-end">${here ? ico('i-check') : ico('i-chev-r', 'gl-chev')}</span></button>`;
    }).join(''));
    hide('gm-when-all', items.length <= first.length);
    text('gm-when-all-text', 'Other items on ' + FULL[dow]);
    hide('gm-when-empty', true);
    hide('gm-when-newday', true);
    hide('gm-when-double', !(sp.camp === 'junior' && dow === 4));
    text('gm-when-double-text', 'Evening competition is in double points time. Make ' + (g ? g.name : 'it') + ' count double too?');
  }
  ov.hidden = false;
  // The build's fit check (the item sheet's schedItemFit): when the pinned head, When line and dock take more than 45%
  // of the sheet, the whole sheet scrolls as one.
  const sh = ov.querySelector('.sheet');
  const pinned = [ov.querySelector('.sheet-grab'), ov.querySelector('.sheet-head'), $('gm-when'), $('gm-dock')].reduce((t, e) => t + (e && getComputedStyle(e).display !== 'none' ? e.getBoundingClientRect().height : 0), 0);
  sh.toggleAttribute('data-flow', pinned > 0.45 * sh.getBoundingClientRect().height);
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
    if (el.closest('#app-header') || el.closest('#tabbar')) return;
    const r = el.getBoundingClientRect();
    if (el.tagName === 'INPUT' && el.closest('label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5 && r.height >= 40) return; }
    if (r.width < 43.5 || r.height < 43.5) issues.push({ el: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) });
  }));
  const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  // (the day's ⋯ hangs 10px into the gutter by design, as the Schedule's does, so the screen is allowed that much)
  const clip = [...document.querySelectorAll('#setup-games, .sheet-overlay:not([hidden]) .sheet-body')].filter((e) => e.scrollWidth > e.clientWidth + (e.id === 'setup-games' ? 10 : 1)).map((e) => (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  const narrow = [...document.querySelectorAll('#setup-games .cb-title, #setup-games .cb-sub, #setup-games .sg-item-name, .sheet-overlay:not([hidden]) .gl-title, .sheet-overlay:not([hidden]) .gl-sub, .sheet-overlay:not([hidden]) .cb-title, .sheet-overlay:not([hidden]) .gm-key')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < (e.classList.contains('gm-key') ? 56 : 80)).map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  // A word broken mid-way (a line ending inside a word) in the names that matter.
  return { issues, sideways, clip, narrow };
};

async function openPage(browser, { camp, w, scheme, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2026-07-22T14:15:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1015&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(() => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'jenn@example.com', emailVerified: true };
    setMemberRole('editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
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
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : [[360, 'light', 100], [390, 'dark', 100], [360, 'light', 130], [390, 'light', 130], [360, 'dark', 200], [390, 'light', 200]];
  for (const name of only) {
    const sp = Object.assign({ name }, SPECIMENS[name]);
    for (const [w, scheme, txt] of sizes) {
      const { ctx, page, errs } = await openPage(browser, { camp: sp.camp, w, scheme, text: txt });
      try {
        await page.evaluate(`(${fill.toString()})(${JSON.stringify(sp)})`);
        await page.waitForTimeout(350);
        const m = await page.evaluate(MEASURE);
        const tag = [name, sp.camp, w, scheme, txt + '%'].join(' ');
        report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip, narrow: m.narrow });
        if (process.env.SHOTS) {
          const full = sp.build === 'screen';
          await page.screenshot({ path: OUT + ['s21', name, w, scheme, txt].join('-') + '.png', fullPage: full });
          // A sheet scrolls inside itself: two more frames, down its body.
          for (const k of sp.build === 'sheet' ? [1, 2] : []) {
            const moved = await page.evaluate((k) => { const sh = document.querySelector('#sheet-game .sheet'); const b = sh.hasAttribute('data-flow') ? sh : document.querySelector('#sheet-game [data-gm-pane="form"]'); if (!b || b.scrollHeight <= b.clientHeight + 4) return false; const top = Math.min(b.scrollHeight - b.clientHeight, k * (b.clientHeight - 60)); if (top <= b.scrollTop) return false; b.scrollTop = top; return true; }, k);
            if (!moved) break;
            await page.waitForTimeout(120);
            await page.screenshot({ path: OUT + ['s21', name, w, scheme, txt, 'p' + (k + 1)].join('-') + '.png' });
          }
        }
      } catch (e) { report.push({ tag: name + ' ' + w, error: String(e).slice(0, 300) }); }
      if (errs.length) report.push({ tag: name + ' ' + w + ' page errors', pageErrors: errs });
      await ctx.close();
    }
  }
  await browser.close();
  const bad = report.filter((r) => (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length) || (r.narrow && r.narrow.length) || r.error || r.pageErrors);
  console.log(JSON.stringify(bad, null, 1));
  console.log(report.length + ' checks, ' + bad.length + ' with findings');
})();
