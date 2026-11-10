// Step 18 design pass: the Games tab (redesign §5, mockups 08, 14, 14b and their dark twins) drawn into the REAL page
// with the real styles.css. Nothing is wired yet, so this script writes the documented markup itself (index.html: the
// "STEP 18: THE GAMES TAB" comment in #tab-games, #sheet-quick, #sheet-standings, and the "STEP 18 TEMPLATES" comment
// in #takeover-game). The specimens are a reference for the build session: the templates, filled with sample content
// through the page's own teamMarkHtml / teamAccentVars / teamShort.
// For each specimen, camp, width (360 / 390), theme and text size (100 / 130 / 200 %) it reports tap targets under
// 44x44, sideways scroll, and text that runs out of its box or is squeezed into a narrow column; SHOTS=1 writes
// screenshots (OUT=<dir>, default the OS temp dir + /shots/).
//   node step18-design.cjs [baseUrl]   (ONLY=<specimen>[,…], QUICK=1 for 390 light 100% only)
// Serve the worktree first: python3 -m http.server 8977 (Firebase is blocked; the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8977').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

const SPECIMENS = {
  // 08 · a director on Wednesday: the standings (a tie, arrows both ways), the gap sentence, the reveal link, the
  // day picker, two blocks of rows (done with its podium, live with a ranked board, up next with the gold Score).
  'games-director': { camp: 'junior', role: 'editor', build: 'gamesDirector' },
  // A director ON a team: that row is locked with its edge, a game where the team plays says why instead of Score,
  // and another day is chosen ("Thursday · not today").
  'games-director-team': { camp: 'junior', role: 'editor', build: 'gamesDirectorTeam' },
  // Monday morning: nothing scored, so no places or arrows; a day with no games and Add games.
  'games-empty': { camp: 'junior', role: 'editor', build: 'gamesEmpty' },
  // §5.6 · a counselor: the quiet secret line, no Score, a live tally in roster order with no numerals, and the
  // games on no schedule item.
  'games-counselor': { camp: 'junior', role: 'viewer', build: 'gamesCounselor' },
  // Senior: four teams with flags, Mon–Fri, the double points line.
  'senior-director': { camp: 'senior', role: 'editor', build: 'seniorDirector' },
  'senior-counselor': { camp: 'senior', role: 'viewer', build: 'seniorCounselor' },
  // The two sheets.
  'quick-sheet': { camp: 'junior', role: 'editor', build: 'quickSheet' },
  'quick-sheet-wait': { camp: 'senior', role: 'editor', build: 'quickSheetWait' },
  'standings-sheet': { camp: 'junior', role: 'editor', build: 'standingsSheet' },
  // 14 · the podium picker: gold and silver picked, bronze still to pick.
  'podium-pick': { camp: 'junior', role: 'editor', build: 'podiumPick' },
  // The first view: gold to pick, silver and bronze waiting.
  'podium-fresh': { camp: 'junior', role: 'editor', build: 'podiumFresh' },
  'podium-senior': { camp: 'senior', role: 'editor', build: 'podiumSenior' },
  // 14b · saved: the result with its points, Change the result, and Next game.
  'result-next': { camp: 'junior', role: 'editor', build: 'resultNext' },
  // Saved on this phone while offline; nothing left this director can score.
  'result-done': { camp: 'junior', role: 'editor', build: 'resultDone' },
  // A tally game's result as a counselor reads it: winners and scores, no points, no dock.
  'result-counselor': { camp: 'senior', role: 'viewer', build: 'resultCounselor' },
};

// Runs in the page. Writes the frame for one specimen.
function fill(kind) {
  const $ = (id) => document.getElementById(id);
  const ids = state.teams.map((t) => t.id);
  const nm = (id) => teamShort(id) || teamName(id);
  const vars = (id) => teamAccentVars(id) || '';
  const mark = (id, size) => teamMarkHtml(id, { size });
  const me = state.followTeam;
  const hide = (id, h) => { const el = $(id); if (el) el.hidden = h; };
  const text = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const html = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  const ico = (id, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const chev = ico('i-chev-r', 'gr-chev');
  const [t0, t1, t2, t3, t4, t5] = ids;

  // ── Games tab pieces ──
  const panel = (rows, o) => {
    const p = $('games-live'); p.hidden = false;
    if (o && o.empty) p.setAttribute('data-empty', ''); else p.removeAttribute('data-empty');
    text('gs-how', o && o.empty ? 'Tap a team to give quick points' : 'Arrows: places moved since this morning · tap a team to give quick points');
    html('gs-list', rows.map((r) => {
      const mv = r.mv > 0 ? `<span class="gs-mv" data-mv="up" aria-hidden="true">${ico('i-up')}${r.mv}</span>` : r.mv < 0
        ? `<span class="gs-mv" data-mv="down" aria-hidden="true">${ico('i-down')}${-r.mv}</span>` : '<span class="gs-mv" data-mv="same" aria-hidden="true">–</span>';
      const medals = `${r.g}&nbsp;gold · ${r.s}&nbsp;silver · ${r.b}&nbsp;bronze` + (r.x ? `<span class="gs-x"> · +${r.x}&nbsp;awarded</span>` : '');
      const inner = `<span class="gs-pl" aria-hidden="true"><b class="gs-pl-n">${r.pl}</b>${r.tie ? '<small class="gs-tie">tie</small>' : ''}</span>${mv}` +
        `<span class="gs-mark">${mark(r.id, 28)}</span><span class="gs-nm"><b class="gs-name">${nm(r.id)}${r.mine ? ico('i-lock', 'gs-lock') : ''}</b><small class="gs-medals">${medals}</small></span><b class="gs-pts">${r.pts}</b>`;
      return `<li class="gs-item" data-key="${r.id}" data-team="${r.id}" style="${vars(r.id)}"${r.tie ? ' data-tie' : ''}${r.mine ? ' data-mine' : ''}>` +
        (r.mine ? `<div class="gs-row" data-locked>${inner}<span class="visually-hidden">Your team: another director gives these points</span></div>`
          : `<button type="button" class="gs-row" data-quick-team="${r.id}" aria-haspopup="dialog" aria-controls="sheet-quick" aria-label="${nm(r.id)} · ${r.pl}${r.tie ? ', tied' : ''} · ${r.pts} points. Give quick points">${inner}</button>`) + '</li>';
    }).join(''));
    if (o && o.gap) { html('gs-gap', o.gap); hide('gs-gap', false); } else hide('gs-gap', true);
    hide('gs-reveal', !(o && o.reveal));
  };
  const days = (sel, st, todayIdx) => {
    const names = state.config.days.filter((d) => d.dow >= 1 && d.dow <= 5).map((d) => d.name).slice(0, 5);
    const full = names.length ? names : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const track = $('games-days-pick');
    track.style.setProperty('--n', String(full.length)); track.style.setProperty('--i', String(sel));
    const word = { done: 'Done', today: 'Today' };
    track.innerHTML = '<i class="gdp-pill" aria-hidden="true"></i>' + full.map((n, i) => {
      const s = st[i] || '';
      const w = s.startsWith('left') ? s.split(':')[1] + ' left' : (word[s] || '');
      const ds = s.startsWith('left') ? 'left' : s;
      return `<button type="button" class="gdp-btn" role="tab" id="gdp-d-${i}" aria-selected="${i === sel}" aria-controls="games-day" data-st="${ds}" aria-label="${n}${w ? ', ' + w.toLowerCase() : ''}"><span class="gdp-d">${n.slice(0, 3)}</span><span class="gdp-st">${w}</span></button>`;
    }).join('');
    $('games-week').hidden = false;
    if (todayIdx != null && todayIdx !== sel) { text('games-day-note', full[sel] + ' · not today'); hide('games-day-note', false); } else hide('games-day-note', true);
  };
  const pod = (g, s, b) => `<ol class="pd" aria-label="Medal winners">${[[g, 1, 'Gold'], [s, 2, 'Silver'], [b, 3, 'Bronze']].map(([id, p, w]) =>
    `<li class="pd-c" data-place="${p}" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}><span class="pd-top"><i class="pd-disc" aria-hidden="true">${p}</i>${mark(id, 24)}</span><span class="pd-nm"><span class="visually-hidden">${w}: </span>${nm(id)}</span></li>`).join('')}</ol>`;
  const tally = (pairs, ranked, cap) => `<div class="lb" data-kind="tally"${ranked ? ' data-ranked' : ''}><p class="lb-cap">${cap}</p><ol class="lb-rows">${pairs.map(([id, v], i) =>
    `<li class="lb-r" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}>${ranked ? `<span class="lb-pl">${i + 1}</span>` : ''}${mark(id, 20)}<span class="lb-nm">${nm(id)}</span><b class="lb-v">${v}</b></li>`).join('')}</ol></div>`;
  const gr = (o) => {
    const word = { done: 'Done: ', live: 'Live: ', todo: 'Not started: ' }[o.st];
    const end = o.score ? `<button type="button" class="btn btn-sm gr-score${o.gold ? ' btn-gold' : ''}" data-score-game="${o.key}" data-joy>Score</button>` : chev;
    return `<div class="gr" role="listitem" data-key="g-${o.key}" data-status="${o.st}"${o.next ? ' data-next' : ''}><span class="gr-st" aria-hidden="true"></span>` +
      `<button type="button" class="gr-hit" data-open-game="${o.key}"><span class="visually-hidden">${word}</span><span class="gr-name">${o.name}</span>${o.st === 'live' ? '<span class="gr-tag" data-tag="live">Live</span>' : ''}<span class="gr-sub">${o.sub}</span></button>` +
      (o.why ? chev + `<p class="gr-why">${ico('i-lock')}<span>${o.why}</span></p>` : end) + (o.extra || '') + '</div>';
  };
  const block = (key, title, when, rows, o) => `<section class="gb" data-key="${key}"${o && o.now ? ' data-now' : ''}${o && o.off ? ' data-off' : ''}>` +
    `<h3 class="gb-h"><span class="gb-t">${title}</span>${o && o.now ? '<span class="gb-now">Now</span>' : ''}${when ? `<span class="gb-when">${when}</span>` : ''}</h3>` +
    `<div class="gr-list" role="list">${rows.join('')}</div></section>`;
  const body = (h, notes) => {
    html('games-day-body', h);
    if (notes) { html('games-day-notes', notes); hide('games-day-notes', false); } else { html('games-day-notes', ''); hide('games-day-notes', true); }
  };
  const note = (k, icoId, words) => `<p class="nw-note" data-note="${k}">${ico(icoId)}<span>${words}</span></p>`;
  const quick = (day) => { text('games-quick-sub', 'Add a one-off game to ' + day); hide('games-quick', false); };

  // ── Takeover pieces ──
  const takeover = (title, sub, back) => {
    const g = state.config.games.find((x) => x.format === 'placement') || state.config.games[0];
    openGame(g.id, { from: 'games' });
    window.renderGameView = function () {}; // the specimen owns the takeover from here
    text('takeover-game-title', title); text('takeover-game-sub', sub); text('takeover-game-back-label', back);
    const b = $('takeover-game-body');
    b.innerHTML = '<details class="rules-details"><summary>How to play</summary><h4>The game</h4><ul><li>Draw with your nose.</li></ul></details><div id="entry-area"></div>';
  };
  const dock = (h) => { const d = $('takeover-game-dock'); d.innerHTML = h; d.hidden = !h; };
  const ppRow = (medal, place, label, pts, picks, o) => {
    const wait = o && o.wait;
    const keys = ids.map((id) => {
      const taken = Object.entries(picks).find(([m, t]) => t === id && m !== medal);
      const takenEarlier = taken && ['gold', 'silver', 'bronze'].indexOf(taken[0]) < ['gold', 'silver', 'bronze'].indexOf(medal);
      const on = picks[medal] === id;
      const dis = wait || takenEarlier;
      return `<button type="button" class="pp-team" role="radio" aria-checked="${on}" data-team="${id}" style="${vars(id)}"${dis ? ' aria-disabled="true"' : ''}${takenEarlier ? ` data-taken="${taken[0]}"` : ''}>` +
        `<span class="pp-mark">${mark(id, 28)}</span><span class="pp-nm">${nm(id)}</span>` +
        (on ? `<i class="pp-ok" aria-hidden="true">${ico('i-check')}</i>` : '') +
        (takenEarlier ? `<span class="pp-taken"><i class="pp-disc" data-place="${['gold', 'silver', 'bronze'].indexOf(taken[0]) + 1}" aria-hidden="true">${['gold', 'silver', 'bronze'].indexOf(taken[0]) + 1}</i>has ${taken[0]}</span>` : '') + '</button>';
    }).join('');
    return `<div class="pp-row" data-medal="${medal}"${wait ? ' data-wait' : ''}><p class="pp-h" id="pp-h-${medal}"><i class="pp-disc" data-place="${place}" aria-hidden="true">${place}</i>` +
      `<b class="pp-medal">${label}</b><span class="pp-pts">${pts} points</span><span class="pp-wait">${o && o.waitWord || ''}</span></p>` +
      `<div class="pp-teams" role="radiogroup" aria-labelledby="pp-h-${medal}" data-n="${ids.length}">${keys}</div></div>`;
  };
  const picker = (picks) => {
    const silverWait = !picks.gold; const bronzeWait = !picks.silver;
    html('entry-area', `<div class="pp" id="podium-picker">${ppRow('gold', 1, 'Gold', 7, picks)}${ppRow('silver', 2, 'Silver', 5, picks, { wait: silverWait, waitWord: 'after gold' })}` +
      `${ppRow('bronze', 3, 'Bronze', 3, picks, { wait: bronzeWait, waitWord: picks.gold ? 'after silver' : 'after gold and silver' })}</div><p id="entry-error" class="entry-error" role="alert" hidden></p>`);
  };
  const result = (rows, o) => html('entry-area',
    `<p class="gsv" id="game-saved" data-state="${o.state}" role="status">${ico(o.state === 'offline' ? 'i-phone' : 'i-check')}<span>${o.saved}</span></p>` +
    `<ol class="gres" aria-label="Final results">${rows.map(([id, place, pts]) =>
      `<li class="gres-r" data-place="${place}" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}><i class="pp-disc" data-place="${place}" aria-hidden="true">${place}</i><span class="gres-mark">${mark(id, 34)}</span>` +
      `<b class="gres-nm"><span class="visually-hidden">${['Gold', 'Silver', 'Bronze'][place - 1]}: </span>${teamName(id)}</b>${pts ? `<span class="gres-pts">+${pts}</span>` : ''}</li>`).join('')}</ol>` +
    (o.scores ? `<h3 class="gv-h">${o.scores.cap}</h3><ol class="gres-scores">${o.scores.rows.map(([id, v]) => `<li class="gres-s" data-team="${id}" style="${vars(id)}">${mark(id, 22)}<span class="gres-s-nm">${nm(id)}</span><b class="gres-s-v">${v}</b></li>`).join('')}</ol>` : '') +
    (o.change ? '<button type="button" class="btn gres-change" id="game-change">Change the result</button>' : ''));

  const S = {
    gamesDirector() {
      panel([
        { id: t2, pl: 1, mv: 1, g: 2, s: 2, b: 2, pts: 30 },
        { id: t1, pl: 2, mv: -1, g: 3, s: 0, b: 2, pts: 27, tie: true },
        { id: t3, pl: 2, mv: 0, g: 2, s: 1, b: 2, pts: 27, tie: true, x: 2 },
        { id: t0, pl: 4, mv: 2, g: 2, s: 1, b: 1, pts: 22 },
        { id: t4, pl: 5, mv: -1, g: 1, s: 1, b: 2, pts: 18 },
        { id: t5, pl: 6, mv: -1, g: 1, s: 1, b: 1, pts: 15 },
      ], { gap: `<b>${nm(t1)}</b> and <b>${nm(t3)}</b> trail <b>${nm(t2)}</b> by 3. One gold for either would put them in front.`, reveal: true });
      days(2, ['done', 'done', 'today', '', ''], 2);
      body(block('b-tc', 'Team competitions', '10:00–11:45', [
        gr({ key: 'axe', st: 'done', name: 'Axe Throwing', sub: 'Basketball Court · saved 10:31', extra: pod(t2, t0, t1) }),
        gr({ key: 'bowl', st: 'live', name: 'Inflatable Bowling', sub: 'Slip and Slide · 4 of 6 teams in', score: true, gold: true, extra: tally([[t3, 48], [t1, 41], [t0, 36], [t5, 22]], true, 'Scores so far · 4 of 6 in') }),
        gr({ key: 'pict', st: 'todo', next: true, name: 'Pumpkin Pictionary', sub: 'Chapel Lawn · <b>up next</b>', score: true }),
      ], { now: true }) + block('b-ev', 'Evening competition', '6:00–6:45 PM', [
        gr({ key: 'ccc', st: 'todo', name: 'Color Call Chaos', sub: 'Chapel Lawn', score: true }),
        gr({ key: 'run', st: 'todo', name: 'Color Run: Cleanup Edition', sub: 'Campground-wide', score: true }),
      ]));
      quick('Wednesday');
    },
    gamesDirectorTeam() {
      state.followTeam = t0;
      panel([
        { id: t0, pl: 1, mv: 0, g: 3, s: 1, b: 1, pts: 29, mine: true, x: 2 },
        { id: t2, pl: 2, mv: 1, g: 2, s: 2, b: 2, pts: 27 },
        { id: t1, pl: 3, mv: -1, g: 2, s: 0, b: 3, pts: 23 },
        { id: t3, pl: 4, mv: 0, g: 1, s: 2, b: 1, pts: 20 },
        { id: t4, pl: 5, mv: 0, g: 1, s: 1, b: 2, pts: 18 },
        { id: t5, pl: 6, mv: 0, g: 0, s: 1, b: 1, pts: 8 },
      ], { gap: `<b>${nm(t0)}</b> lead <b>${nm(t2)}</b> by 2. One silver for ${nm(t2)} would tie them.`, reveal: true });
      days(3, ['done', 'done', 'today', '', ''], 2);
      body(block('b-tc', 'Team competitions', '10:00–11:45', [
        gr({ key: 'ring', st: 'todo', name: 'Ring Toss Relay', sub: 'Gym', why: 'Your team plays · another director scores' }),
        gr({ key: 'hoop', st: 'todo', name: 'Hula Hoop Pass', sub: 'Gym', score: true }),
      ]) + block('b-ev', 'Evening competition', '6:00–6:45 PM', [
        gr({ key: 'cap', st: 'todo', name: 'Capture the Flag', sub: 'Big field', score: true }),
      ]), note('double', 'i-bolt', '<b>Double points</b> from Thursday evening to the end of Friday'));
      quick('Thursday');
    },
    gamesEmpty() {
      panel(ids.map((id) => ({ id, pl: 1, mv: 0, g: 0, s: 0, b: 0, pts: 0 })), { empty: true });
      text('gs-gap', 'No points yet. The first saved game starts the table.'); hide('gs-gap', false);
      days(3, ['today', '', '', '', ''], 0);
      body(`<div class="gw-empty"><p class="gw-empty-t">No games on Thursday yet.</p><button type="button" class="btn" data-games-add>Add games</button></div>`);
      hide('games-quick', true);
    },
    gamesCounselor() {
      hide('games-secret', false);
      days(2, ['done', 'done', 'today', '', ''], 2);
      body(block('b-tc', 'Team competitions', '10:00–11:45', [
        gr({ key: 'axe', st: 'done', name: 'Axe Throwing', sub: 'Basketball Court · finished 10:31', extra: pod(t2, t0, t1) }),
        gr({ key: 'bowl', st: 'live', name: 'Inflatable Bowling', sub: 'Slip and Slide · 4 of 6 teams in', extra: tally([[t0, 36], [t1, 41], [t3, 48], [t5, 22]], false, 'Scores so far · team order') }),
        gr({ key: 'pict', st: 'todo', next: true, name: 'Pumpkin Pictionary', sub: 'Chapel Lawn · <b>up next</b>' }),
      ], { now: true }) + block('none', 'Not on the schedule', '', [
        gr({ key: 'skit', st: 'todo', name: 'Team Skits', sub: 'Chapel · Being scored' }),
      ], { off: true }));
    },
    seniorDirector() {
      panel([
        { id: t1, pl: 1, mv: 0, g: 3, s: 1, b: 0, pts: 26 },
        { id: t0, pl: 2, mv: 1, g: 1, s: 2, b: 2, pts: 23, x: 3 },
        { id: t3, pl: 3, mv: -1, g: 1, s: 1, b: 2, pts: 18 },
        { id: t2, pl: 4, mv: 0, g: 0, s: 1, b: 1, pts: 8 },
      ], { gap: `<b>${nm(t0)}</b> trail <b>${nm(t1)}</b> by 3. One gold for ${nm(t0)} would put them in front.`, reveal: true });
      days(4, ['done', 'done', 'done', 'left:1', 'today'], 4);
      body(block('b-tc', 'Team competitions', '9:45–12:20', [
        gr({ key: 'tc1', st: 'done', name: 'Team Competition 1', sub: 'Gym · saved 10:40', extra: pod(t1, t0, t3) }),
        gr({ key: 'tc2', st: 'todo', next: true, name: 'Team Competition 2', sub: 'Gym · <b>up next</b>', score: true, gold: true }),
      ], { now: true }) + block('b-lg', 'Legacy Game', '4:50–5:30 PM', [
        gr({ key: 'lg', st: 'todo', name: 'Legacy Game', sub: '4-team bracket · Main field', score: true }),
      ]), note('double', 'i-bolt', '<b>Double points</b> all day: every medal counts twice'));
      quick('Friday');
    },
    seniorCounselor() {
      hide('games-secret', false);
      days(2, ['done', 'done', 'today', '', ''], 2);
      body(block('b-tc', 'Team competitions', '9:45–12:20', [
        gr({ key: 'tc1', st: 'live', name: 'Team Competition 1', sub: 'Gym · Round 1', extra: '' }),
        gr({ key: 'tc2', st: 'todo', next: true, name: 'Team Competition 2', sub: 'Gym · <b>up next</b>' }),
      ], { now: true }));
    },
    quickSheet() {
      S.gamesDirector();
      const s = $('sheet-quick'); s.hidden = false;
      html('qp-mark', mark(t0, 34)); text('qp-team', teamName(t0)); text('qp-now', '4th · 22 points so far');
      document.querySelectorAll('#qp-keys .qp-key').forEach((k) => k.setAttribute('aria-checked', String(k.dataset.pts === '3')));
      document.querySelectorAll('#qp-why .qp-chip').forEach((k) => k.setAttribute('aria-checked', String(k.dataset.why === 'other')));
      hide('qp-other', false); $('qp-other-text').value = 'Helped carry the canoes';
      hide('qp-x2', false);
      const add = $('qp-add'); add.removeAttribute('aria-disabled'); text('qp-add-label', 'Add 3 points to ' + nm(t0));
    },
    quickSheetWait() {
      S.seniorDirector();
      const s = $('sheet-quick'); s.hidden = false;
      html('qp-mark', mark(t2, 34)); text('qp-team', teamName(t2)); text('qp-now', '4th · 8 points so far');
    },
    standingsSheet() {
      S.gamesDirector();
      $('sheet-standings').hidden = false; hide('gs-share', false);
    },
    podiumPick() {
      takeover('Pumpkin Pictionary', 'Chapel Lawn · podium game', 'Wednesday games');
      picker({ gold: t3, silver: t0 });
      dock('<button type="button" class="btn btn-big btn-block gd-save" id="game-save" aria-disabled="true">Pick bronze, then save</button>');
    },
    podiumFresh() {
      takeover('Pumpkin Pictionary', 'Chapel Lawn · podium game', 'Now');
      picker({});
      dock('<button type="button" class="btn btn-big btn-block gd-save" id="game-save" aria-disabled="true">Pick gold, silver and bronze</button>');
    },
    podiumSenior() {
      takeover('Hot Seat', 'Chapel · podium game · double points', 'Friday games');
      picker({ gold: t1, silver: t3, bronze: t0 });
      document.querySelectorAll('.pp-pts').forEach((p, i) => { p.textContent = [14, 10, 6][i] + ' points'; });
      dock('<button type="button" class="btn btn-big btn-block btn-gold gd-save" id="game-save" data-joy>Save result</button>');
    },
    resultNext() {
      takeover('Pumpkin Pictionary', 'Chapel Lawn · podium game', 'Now');
      result([[t3, 1, 7], [t0, 2, 5], [t2, 3, 3]], { state: 'saved', saved: 'Saved 10:52 · everyone’s phone has it', change: true });
      dock('<p class="gd-left" id="game-left">2 games left today that you can score</p><div class="gd-next">' +
        '<button type="button" class="btn btn-big gd-back" id="game-dock-back" data-game-back>‹ Back to Now</button>' +
        '<button type="button" class="btn btn-big btn-gold gd-go" id="game-next" data-next-game="ccc" data-joy><span class="gd-go-t">Next game</span><span class="gd-go-s">Color Call Chaos →</span></button></div>');
    },
    resultDone() {
      state.followTeam = t0;
      takeover('Inflatable Bowling', 'Slip and Slide · score entry', 'Wednesday games');
      result([[t3, 1, 7], [t0, 2, 5], [t1, 3, 3]], { state: 'offline', saved: 'Saved on this phone · it sends when you’re back online', change: true,
        scores: { cap: 'Scores · pins', rows: [[t3, 48], [t0, 44], [t1, 41], [t2, 36], [t5, 22], [t4, 19]] } });
      dock('<p class="gd-left" id="game-left">Nothing left that you can score. 1 game needs another director: Color Call Chaos (your team plays)</p>' +
        '<button type="button" class="btn btn-big btn-block gd-back" id="game-dock-back" data-game-back>‹ Back to Wednesday games</button>');
    },
    resultCounselor() {
      takeover('Team Competition 1', 'Gym · score entry', 'Now');
      result([[t1, 1, 0], [t0, 2, 0], [t3, 3, 0]], { state: 'saved', saved: 'Final result',
        scores: { cap: 'Scores · points', rows: [[t1, 12], [t0, 10], [t3, 7], [t2, 4]] } });
      $('game-saved').querySelector('.ico').style.display = 'none';
      dock('');
    },
  };
  S[kind]();
}

// Every interactive thing a person can see, in the Games tab, the open sheet or the takeover.
const MEASURE = () => {
  const sel = 'button, a[href], [role="tab"], [role="radio"], summary';
  const shown = (e) => { if (e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const roots = ['#games-live', '#games-secret', '#games-week', '#sheet-quick:not([hidden]) .sheet', '#sheet-standings:not([hidden]) .sheet', '#takeover-game:not([hidden])']
    .map((s) => document.querySelector(s)).filter(Boolean);
  const small = [];
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (!shown(el)) return;
    let r = el.getBoundingClientRect();
    if (el.classList.contains('gr-hit')) r = el.closest('.gr').getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className.baseVal || el.className).split(' ')[0] + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"');
  }));
  const sideways = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  const textSel = '.gs-name, .gs-medals, .gs-kick, .gs-title, .gs-how, .gs-gap, .gdp-d, .gdp-st, .gb-t, .gb-when, .gr-name, .gr-sub, .pd-nm, .lb-nm, .gw-quick-t, .gw-quick-s, .gs-secret, .qp-team, .qp-chip, .pp-nm, .pp-medal, .gres-nm, .gres-s-nm, .gd-left, .gd-go-t, .gd-go-s, .gd-back, .gd-save, .gl-title, .gl-sub, .gw-empty-t, .gsv';
  const overflow = [];
  roots.forEach((root) => root.querySelectorAll(textSel).forEach((e) => {
    if (!shown(e)) return;
    const r = e.getBoundingClientRect();
    const box = e.closest('.gs, .gdp-btn, .pp-team, .gres, .gd, .sheet, .tk-body, .gw, .gr');
    if (box) { const c = box.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1) overflow.push((e.className + ' "' + e.textContent.trim().slice(0, 18) + '" sticks out ' + Math.round(r.right - c.right)).slice(0, 90)); }
    const cs = getComputedStyle(e);
    if (cs.overflow === 'visible' && e.scrollWidth > e.clientWidth + 1 && cs.display !== 'inline') overflow.push(e.className + ' "' + e.textContent.trim().slice(0, 18) + '" ' + e.scrollWidth + '>' + e.clientWidth);
    if (r.width < 70 && e.textContent.trim().length > 14 && !e.matches('.pd-nm, .pp-nm, .gdp-d, .gdp-st')) overflow.push(e.className + ' squeezed ' + Math.round(r.width) + 'px "' + e.textContent.trim().slice(0, 18) + '"');
  }));
  // Day picker: a status word wider than its segment.
  document.querySelectorAll('.gdp-btn').forEach((b) => { if (!shown(b)) return; const r = b.getBoundingClientRect(); b.querySelectorAll('.gdp-d, .gdp-st').forEach((t) => { const q = t.getBoundingClientRect(); if (q.width > r.width + 0.5) overflow.push('day "' + t.textContent + '" wider than its segment'); }); });
  // A Score button and the row's name must not collide; a points number must not touch the name.
  document.querySelectorAll('#games-week .gr').forEach((g) => {
    const s = g.querySelector('.gr-score'); const n = g.querySelector('.gr-name');
    if (s && n && shown(s)) { const a = s.getBoundingClientRect(); const b = n.getBoundingClientRect(); if (a.left < b.right - 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overflow.push('Score overlaps ' + n.textContent.trim().slice(0, 18)); }
  });
  document.querySelectorAll('.gs-row').forEach((row) => {
    if (!shown(row)) return;
    const p = row.querySelector('.gs-pts').getBoundingClientRect(); const n = row.querySelector('.gs-nm').getBoundingClientRect();
    if (p.left < n.right - 1) overflow.push('points touch the name in ' + row.textContent.trim().slice(0, 18));
  });
  return { small, sideways, overflow };
};

async function run() {
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const quick = !!process.env.QUICK;
  const problems = [];
  let n = 0;
  for (const [name, sp] of Object.entries(SPECIMENS)) {
    if (only && !only.includes(name)) continue;
    for (const w of quick ? [390] : (sp.widths || [360, 390])) {
      for (const scheme of quick ? ['light'] : ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, locale: 'en-US', timezoneId: 'America/New_York' });
        await ctx.addInitScript(({ camp, role }) => { try { localStorage.setItem('campScoreboardAuthHint', role); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, sp);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => problems.push(name + ' pageerror ' + String(e).slice(0, 160)));
        await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
        await page.goto(BASE + '/index.html?now=3-1042', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof setMemberRole === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(900);
        await page.evaluate(({ role }) => {
          const tp = document.getElementById('team-picker-overlay'); if (tp) tp.remove();
          document.querySelectorAll('jelly-dialog[open]').forEach((d) => d.removeAttribute('open'));
          setMemberRole(role);
          state.followTeam = '';
          renderAll();
          showTab('games');
        }, sp);
        await page.waitForTimeout(800); // the tab's arrive spring (a ~4% squash) is over before anything is measured
        // The interim cards are what the build session retires; the specimen shows the new frame alone.
        await page.addStyleTag({ content: '#sdk-banner, #hdr-pill, jelly-toaster, #games-days, #games-standings, #games-rows, #games-reveal-grid, #sync-status-footer { display: none !important; } jelly-dialog { display: none !important; }' });
        await page.evaluate(fill, sp.build);
        await page.waitForTimeout(700); // a takeover arrives on the `settle` spring: measure it at rest
        for (const text of quick ? [100] : [100, 130, 200]) {
          await page.evaluate((t) => { document.documentElement.style.fontSize = t === 100 ? '' : t + '%'; }, text);
          await page.waitForTimeout(140);
          const m = await page.evaluate(MEASURE);
          n++;
          const tag = `${name} ${sp.camp} ${w} ${scheme} ${text}%`;
          if (m.small.length) problems.push(tag + ' small: ' + m.small.join(' | '));
          if (m.sideways) problems.push(tag + ' sideways ' + m.sideways + 'px');
          if (m.overflow.length) problems.push(tag + ' overflow: ' + m.overflow.join(' | '));
          if (process.env.SHOTS && (text === 100 || process.env.SHOTS === 'all')) {
            await page.evaluate(() => { window.scrollTo(0, 0); const b = document.getElementById('takeover-game-body'); if (b) b.scrollTop = 0; });
            const full = !/^(podium|result|quick|standings)/.test(name);
            await page.screenshot({ path: `${OUT}${name}-${w}-${scheme}-${text}.png`, fullPage: full });
          }
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(n + ' views checked');
  console.log(problems.length ? problems.join('\n') : 'no problems');
}
run().catch((e) => { console.error(e); process.exit(1); });
