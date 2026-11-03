// Step 17 design pass: every kind of Now card (redesign §3, mockups 01, 01b, 02, 03, 04, 12, 13), the messages strip,
// Still to do today, Up next / Later today and the defined empty states, drawn into the REAL page with the real
// styles.css. Nothing is wired yet, so this script writes the documented markup (index.html, the "NOW, BLOCK BY
// BLOCK" comment at #now-card) itself — the specimens below are a reference for the build session: they are the
// templates, filled with sample content through the page's own teamMarkHtml / teamAccentVars.
// For each specimen, camp, width (360 / 390), theme and text size (100 / 130 / 200 %) it reports tap targets under
// 44x44, sideways scroll, and text that runs out of its box or is squeezed into a narrow column; SHOTS=1 writes
// screenshots (OUT=<dir>, default the OS temp dir + /shots/).
//   node step17-design.cjs [baseUrl]   (ONLY=<specimen>[,…], QUICK=1 for 390 light 100% only)
// Serve the worktree first: python3 -m http.server 8971 (Firebase is blocked; the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8971').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

// ── The specimens: (camp, role) and a builder that fills the static frame in the page. ──
// Each builder runs IN the page (page.evaluate), so it can call teamMarkHtml / teamAccentVars / teamShort.
const SPECIMENS = {
  // 01 · a games block, counselor (Foxes): a done row with the podium, a live tally in roster order, the next game.
  'games-counselor': { camp: 'junior', role: 'viewer', build: 'gamesCounselor' },
  // 01b · 360 wide, running over, the widest podium and a 20-character short name.
  'running-over': { camp: 'junior', role: 'viewer', build: 'runningOver', widths: [360] },
  // 02 · the same block for a director: Score, the ranked board, Still to do today.
  'games-director': { camp: 'junior', role: 'editor', build: 'gamesDirector' },
  // A bracket game live (a match board) and a director's own team in the round.
  'match-director': { camp: 'junior', role: 'editor', build: 'matchDirector' },
  // 03 · Elective 1 for Sam: Your station, rain, Then, Who's where.
  'elective-counselor': { camp: 'junior', role: 'viewer', build: 'electiveCounselor' },
  'elective-director': { camp: 'junior', role: 'editor', build: 'electiveDirector' },
  'elective-ask': { camp: 'junior', role: 'viewer', build: 'electiveAsk' },
  // 04 · Team time after lunch: the cleanup moment with 0–3 for a director.
  'cleanup-director': { camp: 'junior', role: 'editor', build: 'cleanupDirector' },
  'cleanup-friday': { camp: 'junior', role: 'editor', build: 'cleanupFriday' },
  'cleanup-counselor': { camp: 'junior', role: 'viewer', build: 'cleanupCounselor' },
  // 12 · Bible study (shown dark in the mockup; every theme here).
  'bible-counselor': { camp: 'junior', role: 'viewer', build: 'bibleCounselor' },
  'bible-director': { camp: 'junior', role: 'editor', build: 'bibleDirector' },
  'meal': { camp: 'junior', role: 'viewer', build: 'meal' },
  'meeting': { camp: 'junior', role: 'viewer', build: 'meeting' },
  'generic': { camp: 'senior', role: 'viewer', build: 'generic' },
  'arrival': { camp: 'junior', role: 'viewer', build: 'arrival' },
  'between': { camp: 'junior', role: 'viewer', build: 'between' },
  'morning': { camp: 'junior', role: 'viewer', build: 'morning' },
  'night': { camp: 'junior', role: 'viewer', build: 'night' },
  'none-director': { camp: 'junior', role: 'editor', build: 'noneDirector' },
  'over': { camp: 'junior', role: 'viewer', build: 'over' },
  'sendoff': { camp: 'junior', role: 'editor', build: 'sendoff' },
  'messages': { camp: 'junior', role: 'editor', build: 'messages' },
  // 13 · senior: the Legacy Game as a 4-team bracket (Step 22 supplies the data).
  'legacy-counselor': { camp: 'senior', role: 'viewer', build: 'legacyCounselor' },
  'senior-games-director': { camp: 'senior', role: 'editor', build: 'seniorGamesDirector' },
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
  const chev = '<svg class="ico gr-chev" aria-hidden="true"><use href="#i-chev-r"/></svg>';
  const card = $('now-card');
  // reset
  card.hidden = false;
  card.removeAttribute('data-over');
  ['now-card-over', 'now-card-change', 'now-card-sub', 'now-card-notes', 'now-card-foot', 'now-card-hold', 'now-card-hold-note',
    'now-card-down', 'now-moment', 'now-moment-secret', 'now-moment-key', 'now-todo', 'now-todo-more', 'now-next', 'now-next-day',
    'now-later', 'now-notice', 'now-notice-yours', 'now-notice-down', 'now-msgs-more'].forEach((id) => hide(id, true));
  hide('now-card-bar', false); hide('now-later-day', false);
  ['now-card-body', 'now-moment-body', 'now-card-notes', 'now-card-sub', 'now-todo-list', 'now-next-list', 'now-later-list'].forEach((id) => html(id, ''));
  const head = (k, when, left, p, emoji, label) => {
    card.dataset.kind = k;
    text('now-card-k', when[0]); text('now-card-when', when[1]); text('now-card-left', left);
    if (p == null) hide('now-card-bar', true); else $('now-card-fill').style.setProperty('--p', String(p));
    text('now-card-emoji', emoji || ''); text('now-card-label', label);
  };
  const sub = (h) => { html('now-card-sub', h); hide('now-card-sub', false); };
  const notes = (h) => { html('now-card-notes', h); hide('now-card-notes', false); };
  const note = (k, ico, words) => `<p class="nw-note" data-note="${k}"><svg class="ico" aria-hidden="true"><use href="#${ico}"/></svg><span>${words}</span></p>`;
  const teamNote = (id, words, mine) => `<p class="nw-note" data-note="team" data-team="${id}" style="${vars(id)}"${mine ? ' data-mine' : ''}><span class="nw-note-mark">${mark(id, 22)}</span><span>${words}</span></p>`;
  const row = (time, emo, label, s, mine, key) => `<div class="nr" role="listitem" data-key="${key || time}"${mine ? ' data-mine' : ''}><span class="nr-time">${time}</span><span class="nr-main"><span class="nr-title">${emo ? `<span class="nr-emo" aria-hidden="true">${emo}</span>` : ''}<span>${label}</span></span>${s ? `<span class="nr-sub">${s}</span>` : ''}</span></div>`;
  const list = (id, rows, opts) => { html(id + '-list', rows.join('')); hide(id, false); if (opts && opts.day) hide(id + '-day', false); };
  const todo = (rows, more) => { html('now-todo-list', rows.join('')); hide('now-todo', false); if (more) { text('now-todo-more-text', more); hide('now-todo-more', false); } };
  const todoRow = (ico, t, s, key) => `<button type="button" class="nr nr-act" role="listitem" data-key="${key}" data-todo="x"><span class="nr-ico" aria-hidden="true"><svg class="ico"><use href="#${ico}"/></svg></span><span class="nr-main"><span class="nr-title">${t}</span><span class="nr-sub">${s}</span></span><svg class="ico nr-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></button>`;
  const pod = (g, s, b) => `<ol class="pd" aria-label="Medal winners">${[[g, 1, 'Gold'], [s, 2, 'Silver'], [b, 3, 'Bronze']].map(([id, p, w]) =>
    `<li class="pd-c" data-place="${p}" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}><span class="pd-top"><i class="pd-disc" aria-hidden="true">${p}</i>${mark(id, 24)}</span><span class="pd-nm"><span class="visually-hidden">${w}: </span>${nm(id)}</span></li>`).join('')}</ol>`;
  const tally = (pairs, ranked, cap) => `<div class="lb" data-kind="tally"${ranked ? ' data-ranked' : ''}><p class="lb-cap">${cap}</p><ol class="lb-rows">${pairs.map(([id, v], i) =>
    `<li class="lb-r" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}>${ranked ? `<span class="lb-pl">${i + 1}</span>` : ''}${mark(id, 20)}<span class="lb-nm">${nm(id)}</span><b class="lb-v">${v}</b></li>`).join('')}</ol></div>`;
  const gr = (o) => {
    const word = { done: 'Done: ', live: 'Live: ', todo: 'Not started: ' }[o.st];
    const end = o.score ? `<button type="button" class="btn btn-sm gr-score${o.gold ? ' btn-gold' : ''}" data-score-game="${o.key}">Score</button>` : chev;
    return `<div class="gr" role="listitem" data-key="g-${o.key}" data-status="${o.st}"${o.next ? ' data-next' : ''}><span class="gr-st" aria-hidden="true"></span>` +
      `<button type="button" class="gr-hit" data-open-game="${o.key}"><span class="visually-hidden">${word}</span><span class="gr-name">${o.name}</span>${o.st === 'live' ? '<span class="gr-tag" data-tag="live">Live</span>' : ''}<span class="gr-sub">${o.sub}</span></button>` +
      (o.why ? chev + `<p class="gr-why"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg><span>${o.why}</span></p>` : end) + (o.extra || '') + '</div>';
  };
  const games = (rows) => html('now-card-body', `<div class="gr-list" role="list">${rows.join('')}</div>`);
  const moment = (k, title, secret, body, key) => {
    const m = $('now-moment'); m.hidden = false; m.dataset.moment = k;
    text('now-moment-title', title); hide('now-moment-secret', !secret); html('now-moment-body', body);
    if (key) hide('now-moment-key', false);
  };
  const keys = (n, label, picked) => `<div class="aw-pts nm-pts" role="radiogroup" data-n="${n}" aria-label="${label}">${Array.from({ length: n }, (_, i) =>
    `<button type="button" class="aw-pt" role="radio" aria-checked="${picked === i}" data-pts="${i}" data-joy>${i}</button>`).join('')}</div>`;
  const nmTeam = (id, who, director, picked, locked) => `<div class="nm-team" data-key="c-${id}" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}${locked ? ' data-locked' : ''}>` +
    `<span class="nm-mark">${mark(id, 52)}</span><p class="nm-name">${teamName(id)}</p><p class="nm-who">${who}${id === me ? '<span class="nm-you">Your team</span>' : ''}</p>` +
    (director && !locked ? `<p class="nm-label">Cleanup points</p>${keys(4, teamName(id) + ' · lunch cleanup points', picked)}` + (picked != null ? `<p class="nm-saved"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>Saved · ${picked}</p>` : '') : '') +
    (director && locked ? `<p class="aw-lock"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg><span>Your team · another director gives these</span></p>` : '') + '</div>';
  const later = (rows) => list('now-later', rows);
  const msg = (id, t, meta, editor) => `<div class="msg" data-kind="banner" data-key="ann-${id}" role="status"><span class="msg-ico" aria-hidden="true"><svg class="ico"><use href="#i-megaphone"/></svg></span><div class="msg-body"><p class="msg-text">${t}</p><p class="msg-meta"><span>${meta}</span>${editor ? `<button type="button" class="msg-remove" data-ann-id="${id}">Remove for everyone</button>` : ''}</p></div><button type="button" class="msg-x" data-ann-id="${id}" aria-label="Dismiss this announcement on this phone"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button></div>`;
  const banners = (h) => { const a = $('announcements'); a.innerHTML = h; a.hidden = !h; };
  banners('');
  const [t0, t1, t2, t3, t4, t5] = ids;
  const S = {
    gamesCounselor() {
      banners(msg('a1', 'Water break at the Snack Shack after Axe Throwing. Bring bottles.', '10:31 · Jenn'));
      head('games', ['Now', ' · 10:00–11:45'], '63 min left', 0.38, '🏅', 'Team competitions');
      games([
        gr({ key: 'axe', st: 'done', name: 'Axe Throwing', sub: 'Basketball Court · finished 10:31', extra: pod(t2, t0, t1) }),
        gr({ key: 'bowl', st: 'live', name: 'Inflatable Bowling', sub: 'Slip and Slide · round 2 of 3', extra: tally(ids.map((id, i) => [id, [41, 30, 36, 48, 22, 19][i]]), false, 'Scores so far · team order') }),
        gr({ key: 'pict', st: 'todo', next: true, name: 'Pumpkin Pictionary', sub: 'Chapel Lawn · <b>up next</b>' }),
      ]);
      later([row('12:00', '🌭', 'Lunch · Hot Dogs', `${nm(t5)} on cleanup`), row('1:15', '🎨', 'Elective 1 · Crafts', 'with William')]);
    },
    runningOver() {
      const long = state.teams[4]; long.short = 'Patriotic Pilgrimzzz'; // a 20-character short name
      head('games', ['Running over', ' · 10:00–11:45'], '7 min over', 1, '🏅', 'Team competitions');
      card.dataset.over = '';
      sub('Still going · Lunch at 12:00');
      games([
        gr({ key: 'pict', st: 'live', name: 'Inflatable Bowling', sub: 'Slip and Slide · round 3 of 3' }),
        gr({ key: 'axe', st: 'done', name: 'Axe Throwing', sub: 'Basketball Court · finished 10:31', extra: pod(t3, t5, t4) }),
        gr({ key: 'pp', st: 'done', name: 'Pumpkin Pictionary', sub: 'Chapel Lawn · finished 11:20', extra: pod(t2, t0, t5) }),
      ]);
      list('now-next', [row('12:00', '🌭', 'Lunch · Hot Dogs', `${nm(t5)} on cleanup`)], { day: true });
    },
    gamesDirector() {
      head('games', ['Now', ' · 10:00–11:45'], '63 min left', 0.38, '🏅', 'Team competitions');
      sub('2 of 3 games still to score');
      notes(note('double', 'i-bolt', 'Double points until the end of Friday'));
      games([
        gr({ key: 'bowl', st: 'live', name: 'Inflatable Bowling', sub: 'Slip and Slide · round 2 of 3', score: true, gold: true, extra: tally([[t3, 48], [t0, 41], [t2, 36], [t1, 30], [t4, 22], [t5, 19]], true, 'Scores so far · 6 of 6 in') }),
        gr({ key: 'pict', st: 'todo', next: true, name: 'Pumpkin Pictionary', sub: 'Chapel Lawn · <b>up next</b>', score: true }),
        gr({ key: 'axe', st: 'done', name: 'Axe Throwing', sub: 'Basketball Court · saved 10:31', extra: pod(t2, t0, t1) }),
      ]);
      todo([todoRow('i-broom', 'Breakfast cleanup points', `${nm(t0)} · not given yet`, 't1'), todoRow('i-book', 'Verse points', '4 of 6 teams done', 't2')]);
      later([row('12:00', '🌭', 'Lunch · Hot Dogs', `${nm(t5)} on cleanup`)]);
    },
    matchDirector() {
      setMemberTeam(t0);
      head('games', ['Now', ' · 6:00–7:30 PM'], '41 min left', 0.55, '🏅', 'Evening competition');
      sub('1 of 2 games still to score');
      games([
        gr({ key: 'kick', st: 'live', name: 'Kickball', sub: 'Main field · Round 1', why: 'Your team plays · another director scores', extra: `<div class="lb" data-kind="match"><p class="lb-cap">Inning 2 of 3 · 1 out</p><div class="lb-vs"><p class="lb-side" data-team="${t2}" style="${vars(t2)}" data-up>${mark(t2, 28)}<span class="lb-nm">${nm(t2)}</span><b class="lb-v">3</b></p><span class="lb-x" aria-hidden="true">vs</span><p class="lb-side" data-team="${t0}" style="${vars(t0)}" data-mine>${mark(t0, 28)}<span class="lb-nm">${nm(t0)}</span><b class="lb-v">1</b></p></div><p class="lb-next">Next: <b>${nm(t3)}</b> vs <b>${nm(t5)}</b></p></div>` }),
        gr({ key: 'cc', st: 'todo', next: true, name: 'Color Call Chaos', sub: 'Dining hall · <b>up next</b>', score: true, gold: true }),
      ]);
      $('now-card-hold-text').textContent = 'Still on this · +10 min';
    },
    electiveCounselor() {
      head('elective', ['Now', ' · Elective 1 · 1:15–2:00'], '28 min left', 0.38, '🎨', 'Crafts with Eileen');
      hide('now-card-over', false); hide('now-card-change', false); text('now-card-change-text', 'Not Sam? Change');
      sub('with <b>William</b> · Pumpkins');
      notes(note('rain', 'i-rain', 'Rain likely around 4 PM · indoor plan: Dining Hall'));
      html('now-card-body', `<h3 class="nw-h">Then</h3><div class="nr-list nw-then" role="list">${row('2:00', '🍫', 'Snack Shack break')}${row('3:00', '🎲', 'Board Games', 'Elective 2 · with Patrick and Josh')}${row('4:00', '', 'Break', 'Elective 3 · you’re free')}</div>` +
        '<button type="button" class="nw-row" data-whos-where aria-haspopup="dialog" aria-controls="sheet-whos-where"><span class="nw-row-text"><span class="nw-row-t">Who’s where</span><span class="nw-row-s">5 stations · 8 counselors on break</span></span><svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button>');
      later([row('5:00', '🍖', 'Supper · Mystery Meat', `${nm(t4)} on cleanup`), row('6:00', '🏅', 'Evening competition', 'Color Call Chaos and 2 more')]);
    },
    electiveDirector() {
      head('elective', ['Now', ' · 1:15–2:00'], '28 min left', 0.38, '🌟', 'Elective 1');
      const st = (e, n, who, k) => `<div class="es-st" role="listitem" data-key="st-${k}"><p class="es-st-h"><span class="es-st-emo" aria-hidden="true">${e}</span><b class="es-st-name">${n}</b></p><p class="es-st-who">${who}</p></div>`;
      html('now-card-body', `<div class="es-all" role="list">${st('🎨', 'Crafts', 'Eileen, Sam, William', 'c')}${st('🎲', 'Board Games', 'Patrick, Josh', 'b')}${st('🏊', 'Swimming', 'Ella, Jacob, Lily', 's')}${st('🪓', 'Axe Throwing', 'Stephen, Eli', 'a')}${st('🎯', 'Archery', 'Alyssa, Sofia', 'r')}` +
        `<div class="es-st" role="listitem" data-key="break" data-break><p class="es-st-h"><b class="es-st-name">On break</b></p><p class="es-st-who">Laura, Mark, Jenn, Tim, Kelsey, Ben, Anna, Grace</p></div></div>`);
      later([row('2:00', '🍫', 'Snack Shack break'), row('3:00', '🌟', 'Elective 2')]);
    },
    electiveAsk() {
      head('elective', ['Now', ' · 1:15–2:00'], '28 min left', 0.38, '🌟', 'Elective 1');
      html('now-card-body', `<div class="es-ask"><p class="es-ask-q">Which counselor are you?</p><p class="es-ask-s">Tap your name to see your station. This phone remembers it.</p><div class="es-ask-names">${['Sam', 'Eileen', 'Eli', 'Sofia'].map((n) => `<button type="button" class="btn es-name" data-identity="${n}">${n}</button>`).join('')}</div></div>`);
    },
    cleanupDirector() {
      head('activity', ['Now', ' · 12:30–1:00'], '22 min left', 0.27, '🤝', 'Team time');
      moment('cleanup', 'Lunch cleanup', true, nmTeam(t5, 'On cleanup after lunch · Lily, Jacob', true, null), true);
      todo([todoRow('i-broom', 'Breakfast cleanup points', `${nm(t0)} · not given yet`, 't1'), todoRow('i-trophy', 'Pumpkin Pictionary', 'No score saved yet', 't3')]);
      list('now-next', [row('1:00', '🎒', 'Prepare for Elective 1')]);
      later([row('1:15', '🌟', 'Elective 1', '5 stations · 8 counselors on break'), row('5:00', '🍖', 'Supper · Mystery Meat', `${nm(t4)} on cleanup`)]);
    },
    cleanupFriday() {
      setMemberTeam(t1);
      head('activity', ['Now', ' · 12:30–1:00'], '9 min left', 0.7, '🤝', 'Team time');
      moment('cleanup', 'Lunch cleanup', true, nmTeam(t2, 'On cleanup after lunch · Ella, Ben', true, 2) + nmTeam(t1, 'On cleanup after lunch · Tim, Grace', true, null, true), true);
    },
    cleanupCounselor() {
      head('activity', ['Now', ' · 12:30–1:00'], '22 min left', 0.27, '🤝', 'Team time');
      moment('cleanup', 'Lunch cleanup', false, nmTeam(t0, 'On cleanup after lunch · Sam, Eileen', false));
      list('now-next', [row('1:00', '🎒', 'Prepare for Elective 1')], { day: false });
      later([row('1:15', '🎨', 'Elective 1 · Crafts', 'with William')]);
    },
    bibleCounselor() {
      head('bible', ['Now', ' · 9:00–9:45'], '18 min left', 0.6, '📖', 'Bible study');
      html('now-card-body', '<div class="vs"><p class="vs-k">Today’s memory verse</p><blockquote class="vs-text"><p>There is therefore now no condemnation for those who are in Christ Jesus.</p></blockquote><p class="vs-ref">Romans 8:1 ESV</p>' +
        '<a class="btn vs-song" href="https://example.com/" target="_blank" rel="noopener noreferrer"><svg class="ico" aria-hidden="true"><use href="#i-play"/></svg>Watch the verse song</a>' +
        '<p class="vs-theme"><span class="vs-theme-k">Week theme</span> · Harvest of the Heart · Galatians 2:20</p></div>');
      list('now-next', [row('9:45', '📣', 'Team huddle', 'Get ready for competitions')]);
      later([row('10:00', '🏅', 'Team competitions', 'Axe Throwing, Inflatable Bowling, Pumpkin Pictionary'), row('12:00', '🌭', 'Lunch · Hot Dogs', `${nm(t5)} on cleanup`)]);
    },
    bibleDirector() {
      setMemberTeam(t2);
      S.bibleCounselor();
      const rows = ids.map((id, i) => (id === t2
        ? `<div class="aw-row" data-key="v-${id}" data-team="${id}" data-locked><span class="aw-mark">${mark(id, 28)}</span><span class="aw-name">${teamName(id)}</span><p class="aw-lock"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg><span>Your team · another director gives these</span><b class="aw-given">+4</b></p></div>`
        : `<div class="aw-row" data-key="v-${id}" data-team="${id}"><span class="aw-mark">${mark(id, 28)}</span><span class="aw-name">${teamName(id)}</span><div class="aw-pts" role="radiogroup" aria-label="${teamName(id)} verse" data-n="6">${[0, 1, 2, 3, 4, 5].map((k) => `<button type="button" class="aw-pt" role="radio" aria-checked="${k === [5, 3, 0, 0, 4, 2][i]}" data-pts="${k}" data-joy>${k}</button>`).join('')}</div></div>`)).join('');
      moment('verse', 'Verse points', true, `<div class="aw-list nm-list">${rows}</div>`);
    },
    meal() {
      head('meal', ['Now', ' · 12:00–12:30'], '14 min left', 0.53, '🍽️', 'Lunch');
      sub('<span class="nw-dish"><span class="nw-dish-emo" aria-hidden="true">🌭</span>Hot Dogs and chips</span>');
      notes(teamNote(t0, '<b>Your team</b> is on cleanup after lunch', true));
      list('now-next', [row('12:30', '🤝', 'Team time')]);
      later([row('1:15', '🎨', 'Elective 1 · Crafts', 'with William'), row('5:00', '🍖', 'Supper · Mystery Meat', `${nm(t4)} on cleanup`)]);
    },
    meeting() {
      head('meeting', ['Now', ' · 7:30–8:00'], '12 min left', 0.6, '🔔', 'Rising bell & morning meeting');
      sub(`Laura’s cottage · ${nm(t0)}, ${nm(t3)} and ${nm(t4)}`);
      html('now-card-body', `<p class="nw-you" data-team="${t0}" style="${vars(t0)}">${mark(t0, 22)}<span>Your team meets today</span></p>`);
      list('now-next', [row('8:00', '🍳', 'Breakfast · French Toast', `<b>Your team is on cleanup</b>`, true)]);
    },
    generic() {
      head('activity', ['Now', ' · 1:30–5:30'], '2 h 10 min left', 0.42, '🌲', 'Free time below the tracks & EXILE');
      sub('Snack Shack open');
      list('now-next', [row('5:45', '🍲', 'Supper and free time')]);
      later([row('6:50', '🎤', 'Hot Seat and Let’s Make a Deal', 'Red plays first'), row('9:00', '🔥', 'Campfire')]);
    },
    arrival() {
      head('arrival', ['Today', ' · Sunday'], '', null, '🚌', 'Camp starts today');
      sub('Registration at 2:00 · in 3 h 10 min');
      html('now-card-body', `<div class="nw-welcome" data-team="${t0}" style="${vars(t0)}"><span class="nw-welcome-mark">${mark(t0, 56)}</span><p class="nw-welcome-t">Welcome to the <b>${teamName(t0)}</b></p><p class="nw-welcome-s">Meet your team at Team assignments · 5:30 · Chapel Lawn</p></div>`);
      text('now-later-h', 'Today');
      later([row('2:00', '📝', 'Registration'), row('4:00', '🏃', 'Welcome games'), row('5:30', '🎽', 'Team assignments', 'Chapel Lawn'), row('6:00', '🍕', 'Supper · Pizza'), row('7:30', '🙌', 'Evening service')]);
    },
    between() {
      head('between', ['Now', ' · free until 12:00'], '', null, '', 'Up next in 12 min');
      sub('🌭 Lunch at 12:00 · Hot Dogs');
      later([row('12:30', '🤝', 'Team time'), row('1:15', '🎨', 'Elective 1 · Crafts', 'with William')]);
    },
    morning() {
      head('morning', ['Today', ' · Wednesday'], '', null, '', 'Good morning');
      sub('The day starts at 7:30');
      html('now-card-body', `<div class="nr-list" role="list">${row('7:30', '🔔', 'Rising bell & morning meeting')}${row('8:00', '🍳', 'Breakfast · French Toast', `${nm(t3)} on cleanup`)}${row('9:00', '📖', 'Bible study')}</div>`);
    },
    night() {
      head('night', ['Tonight', ''], '', null, '🌙', 'Lights out');
      html('now-card-body', `<h3 class="nw-h">Tomorrow · Thursday</h3><div class="nr-list" role="list">${row('7:30', '🔔', 'Rising bell')}${row('8:00', '🍳', 'Breakfast · French Toast')}${row('9:00', '📖', 'Bible study')}</div>`);
    },
    noneDirector() {
      head('none', ['', ''], '', null, '', 'No camp week is set up yet');
      sub('Pick the camp’s Sunday and the schedule follows.');
      html('now-card-body', '<button type="button" class="nw-link" data-now-setup>Set up the week<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button>');
    },
    over() {
      head('over', ['', ''], '', null, '', 'See you next year');
      sub('Thank you for a wonderful week of camp.');
      const c = $('now-champion'); c.hidden = false; $('now-champion-mark').innerHTML = mark(t3, 34); $('now-champion-name').textContent = teamName(t3);
    },
    sendoff() {
      head('notice', ['Now', ' · Saturday'], '', null, '', 'Saturday cleanup');
      sub('Every team has one place to leave spotless before the buses at 11.');
      html('now-card-body', `<div class="nb"><div class="nb-yours" data-team="${t0}" style="${vars(t0)}"><p class="nb-yours-k">Your team</p><p class="nb-yours-p">${mark(t0, 34)}<span>Dining hall<small>Tables, chairs and the floor</small></span></p></div>` +
        `<h3 class="nw-h">Every team</h3><ul class="nb-zones" role="list">${ids.filter((x) => x !== t0).map((id, i) => `<li class="nb-zone" data-key="z-${id}">${mark(id, 24)}<span class="nb-team">${teamName(id)}</span><span class="nb-place">${['Chapel', 'Cabins 1–4', 'Bathrooms', 'Lawn', 'Snack Shack'][i]}${i === 0 ? '<small>Chairs stacked</small>' : ''}</span></li>`).join('')}</ul>` +
        '<ol class="nb-steps"><li class="nb-step"><p class="nb-when"><span class="nb-emo" aria-hidden="true">🧹</span>8:30 · Everyone</p><ul class="nb-items"><li>Strip the beds and bag the sheets</li><li>Pack and line up bags by the gate</li></ul></li><li class="nb-step"><p class="nb-when"><span class="nb-emo" aria-hidden="true">🚌</span>10:45 · Buses</p><ul class="nb-items"><li>Counselors walk their team to the buses</li></ul></li></ol><p class="nb-signoff">See you next year.</p></div>');
      $('now-card-foot').hidden = false; $('now-card-down').hidden = false;
    },
    messages() {
      head('activity', ['Now', ' · 12:30–1:00'], '22 min left', 0.27, '🤝', 'Team time');
      const n = $('now-notice'); n.hidden = false;
      text('now-notice-title', 'Saturday cleanup'); text('now-notice-sub', 'Every team has one place to leave spotless before the buses.');
      html('now-notice-yours', `<span class="nn-mark">${mark(t0, 24)}</span><span class="nn-words"><b>${nm(t0)}</b> · Dining hall<small>Tables, chairs and the floor</small></span>`); hide('now-notice-yours', false);
      hide('now-notice-down', false);
      banners(msg('a2', 'Supper moves to 5:30. The kitchen is running late.', '4:52 PM · Jenn', true) + msg('a3', 'Lost and found is on the porch until Friday.', '3:10 PM · Patrick', true));
      hide('now-msgs-more', false); text('now-msgs-more-text', '2 more messages');
      list('now-next', [row('1:00', '🎒', 'Prepare for Elective 1')], { day: true });
    },
    legacyCounselor() {
      head('games', ['Now', ' · 4:50–5:30'], '24 min left', 0.4, '🏆', 'Legacy Game');
      sub('4-team bracket · Main field');
      notes(teamNote(t0, `<b>${nm(t0)}</b> plays in the final next · 3rd place match first`, true));
      const t = (id, v, o) => `<p class="b4-t" data-team="${id}" style="${vars(id)}"${id === me ? ' data-mine' : ''}${o && o.lost ? ' data-lost' : ''}>${mark(id, 22)}<span class="b4-nm">${nm(id)}</span>${v != null ? `<b class="b4-v">${v}</b>` : ''}${o && o.won ? '<span class="b4-won">won</span>' : ''}</p>`;
      const tbd = (w) => `<p class="b4-t" data-tbd><i class="b4-tbd" aria-hidden="true"></i><span class="b4-nm">${w}</span></p>`;
      const cell = (slot, name, st, tag, body) => `<div class="b4-m" role="listitem" data-key="b4-${slot}" data-slot="${slot}" data-status="${st}"><p class="b4-h"><span class="b4-name">${name}</span>${tag ? `<span class="gr-tag" data-tag="${st === 'todo' ? 'next' : st}">${tag}</span>` : ''}</p>${body}</div>`;
      html('now-card-body', `<div class="b4" role="list" aria-label="Legacy Game bracket">${cell('s1', 'Semifinal 1', 'done', 'Done', t(t0, 2, { won: true }) + t(t3, 1, { lost: true }))}${cell('s2', 'Semifinal 2', 'live', 'Live', t(t1, 3) + t(t2, 2))}${cell('third', '3rd place', 'todo', 'Next', t(t3) + tbd('Semi 2 loser'))}${cell('final', 'Final', 'todo', '', t(t0) + tbd('Semi 2 winner'))}</div>`);
      later([row('5:45', '🍲', 'Supper and free time'), row('6:50', '🎤', 'Hot Seat and Let’s Make a Deal')]);
    },
    seniorGamesDirector() {
      head('games', ['Now', ' · 9:45–12:20'], '1 h 12 min left', 0.45, '🏅', 'Team competitions');
      sub('1 of 2 games still to score');
      games([
        gr({ key: 'tc1', st: 'done', name: 'Team Competition 1', sub: 'Gym · saved 10:40', extra: pod(t1, t0, t3) }),
        gr({ key: 'tc2', st: 'todo', next: true, name: 'Team Competition 2', sub: 'Gym · <b>up next</b>', score: true, gold: true }),
      ]);
      $('now-card-foot').hidden = false; $('now-card-hold').hidden = false; $('now-card-hold-note').hidden = false;
      todo([todoRow('i-book', 'Verse points', '2 of 4 teams done', 'v')]);
    },
  };
  S[kind]();
}

// Every interactive thing a person can see (the Step 24 pass's measure, aimed at Now).
const MEASURE = () => {
  const sel = 'button, a[href], [role="tab"], [role="radio"]';
  const shown = (e) => { if (e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const root = document.getElementById('tab-now');
  const small = [];
  root.querySelectorAll(sel).forEach((el) => {
    if (!shown(el)) return;
    if (el.closest('#setup') || el.closest('.you-strip')) return;
    let r = el.getBoundingClientRect();
    // .gr-hit's target is its ::after over the whole row
    if (el.classList.contains('gr-hit')) r = el.closest('.gr').getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"');
  });
  const sideways = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  const textSel = '.nw-label, .nw-sub, .gr-name, .gr-sub, .pd-nm, .lb-nm, .b4-nm, .nr-title, .nr-sub, .nm-name, .nm-who, .es-st-who, .nn-title, .nb-place, .nb-team, .vs-text, .nw-row-t, .nw-welcome-t, .lb-cap';
  const overflow = [];
  root.querySelectorAll(textSel).forEach((e) => {
    if (!shown(e)) return;
    const r = e.getBoundingClientRect();
    const card = e.closest('.nw-card, .nw-sec, .msg');
    if (card) { const c = card.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1) overflow.push((e.className + ' ' + e.textContent.trim().slice(0, 18) + ' sticks out ' + Math.round(r.right - c.right)).slice(0, 80)); }
    if (getComputedStyle(e).overflow === 'visible' && e.scrollWidth > e.clientWidth + 1) overflow.push(e.className + ' "' + e.textContent.trim().slice(0, 18) + '" ' + e.scrollWidth + '>' + e.clientWidth);
    if (r.width < 70 && e.textContent.trim().length > 14 && !e.classList.contains('pd-nm')) overflow.push(e.className + ' squeezed ' + Math.round(r.width) + 'px');
  });
  // A Score button and the row's name must not collide.
  root.querySelectorAll('.gr').forEach((g) => {
    const s = g.querySelector('.gr-score'); const n = g.querySelector('.gr-name');
    if (s && n && shown(s)) { const a = s.getBoundingClientRect(); const b = n.getBoundingClientRect(); if (a.left < b.right - 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overflow.push('Score overlaps ' + n.textContent.trim().slice(0, 18)); }
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
          state.followTeam = state.teams[0].id;
          renderAll();
        }, sp);
        await page.addStyleTag({ content: '#sdk-banner, #hdr-pill, jelly-toaster, .you-strip, #now-banner, #live-home, #notice-board, #now-reveal, #sync-status-footer { display: none !important; } jelly-dialog { display: none !important; }' });
        await page.evaluate(fill, sp.build);
        for (const text of quick ? [100] : [100, 130, 200]) {
          await page.evaluate((t) => { document.documentElement.style.fontSize = t === 100 ? '' : t + '%'; }, text);
          await page.waitForTimeout(120);
          const m = await page.evaluate(MEASURE);
          n++;
          const tag = `${name} ${sp.camp} ${w} ${scheme} ${text}%`;
          if (m.small.length) problems.push(tag + ' small: ' + m.small.join(' | '));
          if (m.sideways) problems.push(tag + ' sideways ' + m.sideways + 'px');
          if (m.overflow.length) problems.push(tag + ' overflow: ' + m.overflow.join(' | '));
          if (process.env.SHOTS && (text === 100 || process.env.SHOTS === 'all')) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: `${OUT}${name}-${w}-${scheme}-${text}.png`, fullPage: true });
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
