// Standings secrecy (redesign §4.12, owner's rule 2026-10-27): a counselor sees
// NO points, places or gaps anywhere in the app. Only the medal WINNERS of a
// finished game stay visible; a director sees everything, always.
//
// Four wires hold the rule, and each is pinned here:
//   1. a guard inside every points reader (standingsVisible / pointsReadAllowed),
//      which THROWS for a viewer under test, so a render path that reaches one as
//      a viewer fails loudly instead of quietly drawing zeros;
//   2. every viewer surface gated in code, never CSS (html.view-only leaves the
//      nodes in the DOM);
//   3. the SINK RECORDER (tests/harness.js): the stub DOM records nothing by
//      itself, so a viewer's "+7 pts (now 23)" toast used to be invisible to the
//      suite. Every way text leaves the app (toasts, notifications, share,
//      clipboard, innerHTML / textContent / attribute writes, chimes) is logged
//      while a scenario runs, and each entry is matched against the leak patterns;
//   4. a positive control: the SAME scenarios as a director DO hit the patterns,
//      so a recorder that has stopped recording can't turn this file green.

installSinks();
const SINKS = __sinkRec;
const hostDoc = document;

// What a counselor must never read: points, a place, a signed delta, a gap.
// (The spec's /[+−-]\d+/ is anchored to a word start: "10:00–11:45" and
// "2026-07-20" are not deltas.)
const LEAK_PATTERNS = [
  [/\bpts?\b/i, 'points'],
  [/(^|[\s(])[+−-]\d+/, 'a signed number'],
  [/\b\d+(st|nd|rd|th)\b/i, 'an ordinal place'],
  [/\b(trail|trails|trailing|behind|ahead)\b/i, 'a gap word'],
];
// Static page copy says "points" all over (game rules, "Double points day"):
// that is the rule, not the standings. The bare word is only a leak in the sinks
// that carry a dynamic sentence.
const SENTENCE_SINKS = ['toast', 'jellyToast', 'notification', 'Notification', 'share', 'clipboard', 'copy'];
const POINTS_WORD = /\bpoints?\b/i;

// The words a person can read out of a sink entry: markup becomes its text plus
// the attributes that carry words; everything else is already text.
function readable(entry) {
  if (entry.kind !== 'innerHTML' && entry.kind !== 'insertAdjacentHTML') return entry.text;
  const attrs = [];
  entry.text.replace(/\s(?:title|aria-label|alt|placeholder|label)="([^"]*)"/g, (m, v) => { attrs.push(v); return m; });
  return entry.text.replace(/<[^>]+>/g, ' ').concat(' ', attrs.join(' '));
}

function leaksIn(entries) {
  const out = [];
  entries.forEach((e) => {
    const text = readable(e);
    LEAK_PATTERNS.forEach(([re, why]) => { if (re.test(text)) out.push(`${why} in ${e.kind}: ${text.replace(/\s+/g, ' ').trim().slice(0, 140)}`); });
    if (SENTENCE_SINKS.includes(e.kind) && POINTS_WORD.test(text)) out.push(`the word points in ${e.kind}: ${text.slice(0, 140)}`);
  });
  return out;
}

function record(fn) {
  SINKS.log.length = 0;
  SINKS.on = true;
  try { fn(); } finally { SINKS.on = false; }
  return SINKS.log.slice();
}

const kinds = (entries, ...k) => entries.filter((e) => k.includes(e.kind));

// A week with points everywhere a leak could come from: medals, verse, cleanup,
// custom bonuses (one negative), a live tally, a started bracket.
function seedWeek() {
  freshState();
  const games = state.config.games;
  games.slice(0, 4).forEach((g, i) => {
    state.results[g.id] = { medals: { gold: 't' + (i % 3), silver: 't' + ((i + 1) % 3), bronze: 't' + ((i + 2) % 3) }, savedAt: '2026-07-20T12:0' + i + ':00Z' };
  });
  state.bonuses = {
    v1: { teamId: 't0', category: 'verse', label: 'Mon memory verse', points: 5, at: '2026-07-20T12:05:00Z', day: 1 },
    c1: { teamId: 't1', category: 'cleanup', label: 'Mon Lunch cleanup', points: 3, at: '2026-07-20T12:06:00Z', day: 1, meal: 'Lunch' },
    q1: { teamId: 't2', category: 'custom', label: 'Spirit', points: 4, at: '2026-07-20T12:07:00Z' },
    q2: { teamId: 't3', category: 'custom', label: 'Penalty', points: -2, at: '2026-07-20T12:08:00Z' },
  };
  const live = games.find((g) => g.liveRankings && !state.results[g.id]);
  if (live) {
    const scores = {};
    state.teams.forEach((t, i) => { scores[t.id] = String(10 + i * 3); });
    state.drafts[live.id] = { scores, medals: {} };
  }
  const tour = games.find((g) => g.format === 'tournament' && !state.results[g.id]);
  if (tour && CAMP.teamCount === 6) {
    const b = freshBracket();
    b.phase = 'round1';
    b.selectedPair = ['t0', 't1'];
    state.brackets[tour.id] = b;
  }
  state.followTeam = 't1';
  state.notify = true;
  appStarted = true;
  fbRef = null;
  resultAlertsArmed = true;
  return { live, tour };
}

// Every synced key, as a snapshot would carry it, with `mutate` applied.
function snapshotWith(mutate) {
  const snap = JSON.parse(JSON.stringify(syncedSnapshot()));
  if (mutate) mutate(snap);
  return snap;
}

function asViewer(fn) {
  setMemberRole('viewer');
  setStandingsGuardThrows(true);
  try { return fn(); } finally { setStandingsGuardThrows(false); }
}

function openGameAsViewer(gameId) {
  state.ui.gameId = gameId;
  state.ui.view = 'home';
}

// ── The guard ────────────────────────────────────────────────────────

test('standingsVisible is true for a director only, and a role that has not resolved is not one', () => {
  setMemberRole('editor');
  assert.ok(standingsVisible());
  setMemberRole('viewer');
  assert.notOk(standingsVisible());
  setMemberRole(null);
  assert.notOk(standingsVisible(), 'fail closed: no role yet is not a director');
});

test('every points reader THROWS for a viewer under test and returns nothing in production', () => {
  seedWeek();
  setMemberRole('editor');
  const realCounts = medalCounts();
  const readers = {
    medalCounts: () => medalCounts(),
    rankTeamsByPoints: () => rankTeamsByPoints(realCounts),
    bonusBreakdown: () => bonusBreakdown(),
    versePointsByDay: () => versePointsByDay(),
    cleanupMealPoints: () => cleanupMealPoints(1, 'Lunch'),
    bonusCountsDouble: () => bonusCountsDouble({ category: 'custom', at: '2026-07-24T12:00:00Z' }),
  };
  Object.keys(readers).forEach((name) => {
    setMemberRole('viewer');
    setStandingsGuardThrows(true);
    assert.throws(readers[name], name + ' must throw for a viewer under test');
    setStandingsGuardThrows(false);
    assert.doesNotThrow(readers[name], name + ' must not throw in production');
    setMemberRole('editor');
    assert.doesNotThrow(readers[name], name + ' is open to a director');
  });
});

test('in production a viewer gets zeros and an empty list, never the truth', () => {
  seedWeek();
  setMemberRole('editor');
  const real = medalCounts();
  assert.ok(real.t0.points > 0, 'precondition: this week has points');
  setMemberRole('viewer');
  const counts = medalCounts();
  state.teams.forEach((t) => {
    assert.deepEqual(counts[t.id], { gold: 0, silver: 0, bronze: 0, medalPts: 0, verse: 0, meals: 0, custom: 0, bonus: 0, points: 0 }, t.id);
  });
  assert.deepEqual(rankTeamsByPoints(counts).map((t) => t.id), state.teams.map((t) => t.id), 'the roster in its own fixed order, not a standings order');
  assert.deepEqual(bonusBreakdown()[state.teams[0].id], { verse: 0, meals: 0, custom: 0 });
  assert.deepEqual(versePointsByDay(), {});
  assert.equal(cleanupMealPoints(1, 'Lunch'), 0);
  assert.equal(bonusCountsDouble({ category: 'custom', at: '2026-07-24T12:00:00Z' }), false);
});

test('a role that flips back to director reads the real numbers again', () => {
  seedWeek();
  setMemberRole('viewer');
  assert.equal(medalCounts().t0.points, 0);
  setMemberRole('editor');
  assert.ok(medalCounts().t0.points > 0);
});

// ── The whole page as a counselor ────────────────────────────────────

test('a full viewer renderAll with the guard throwing completes and leaks nothing to any sink or node', () => {
  const { live, tour } = seedWeek();
  setMemberRole('editor');
  renderAll(); // a director's page first, so every node holds director markup: the flip must clear it
  const out = record(() => asViewer(() => {
    renderAll();
    // every open game the viewer can reach, too
    state.config.games.forEach((g) => { openGameAsViewer(g.id); renderAll(); });
    if (live) { openGameAsViewer(live.id); renderAll(); }
    if (tour && state.brackets[tour.id]) { openGameAsViewer(tour.id); renderAll(); }
    state.ui.gameId = null;
    renderAll();
  }));
  assert.ok(out.length > 20, 'the recorder is live: ' + out.length + ' sink writes seen');
  assert.deepEqual(leaksIn(out), []);
  // a render that skips an unchanged node writes nothing: look at what is IN the page too
  assert.deepEqual(leaksIn(__domSweep()), [], 'markup left in a node after the flip');
});

test('POSITIVE CONTROL: the same render as a director does hit the patterns (the recorder is not blind)', () => {
  seedWeek();
  setMemberRole('editor');
  renderAll();
  const found = leaksIn(__domSweep());
  assert.ok(found.length >= 3, 'a director\'s home carries points, places and the rest: ' + found.length);
  assert.ok(found.some((f) => f.startsWith('points')), 'the follow card says pts');
  assert.ok(found.some((f) => f.startsWith('an ordinal place')), 'and names a place');
  assert.ok(found.some((f) => f.startsWith('a signed number')), 'the ledgers carry signed numbers');
  // and the log half: a director\'s point toast lands in the sinks
  const toast = record(() => notifyPointChanges([{ team: state.teams[0], delta: 7, total: 23 }]));
  assert.ok(leaksIn(toast).length >= 1, 'a director\'s point toast is caught by the recorder');
});

test('a viewer\'s standings table and ledgers are emptied, not just hidden', () => {
  seedWeek();
  const tbody = document.getElementById('standings-tbody');
  const bonus = document.getElementById('bonus-body');
  setMemberRole('editor');
  renderAll();
  assert.ok(tbody.innerHTML.length > 100, 'precondition: a director\'s table has rows');
  assert.ok(bonus.innerHTML.length > 50, 'and a ledger');
  asViewer(() => renderAll()); // the role flip: a demoted editor's next render
  assert.equal(tbody.innerHTML, '', 'the standings root is emptied');
  assert.equal(bonus.innerHTML, '', 'the quick-points root is emptied');
  assert.equal(document.getElementById('catchup-hint').innerHTML, '', 'and the catch-up sentence');
  assert.equal(document.getElementById('catchup-hint').hidden, true);
});

test('role flip: a demoted director\'s next render drops every editor-only number, a promoted one gets them', () => {
  seedWeek();
  setMemberRole('editor');
  renderAll();
  const card = document.getElementById('follow-team-card');
  assert.ok(/pts/.test(card.innerHTML) && /place/.test(card.innerHTML), 'a director\'s team card carries rank and points');
  asViewer(() => renderAll());
  assert.notOk(/pts|place|\d+(st|nd|rd|th)/i.test(card.innerHTML.replace(/<[^>]+>/g, ' ')), 'a counselor\'s carries neither: ' + card.innerHTML.replace(/\s+/g, ' ').slice(0, 200));
  assert.ok(card.innerHTML.includes(teamName('t1')), 'but it is still the team card');
  setMemberRole('editor');
  assert.ok(/pts/.test(card.innerHTML), 'promoted again: the numbers come back');
});

test('the hide switches on the two secret cards are gone, and nothing un-hides them', () => {
  seedWeek();
  assert.deepEqual(SECRET_CARDS, ['standings', 'bonus']);
  state.meta.hiddenCards = {};
  SECRET_CARDS.forEach((k) => assert.ok(cardHiddenFromViewers(k), k + ' is hidden from non-directors whatever meta says'));
  state.meta.hiddenCards = { standings: true };
  toggleCardHidden('standings');
  assert.deepEqual(state.meta.hiddenCards, { standings: true }, 'a director cannot toggle a secret card');
  toggleCardHidden('bonus');
  assert.notOk(state.meta.hiddenCards.bonus);
  const html = readFixture('../index.html');
  assert.notOk(/data-hide-card="standings"/.test(html) || /data-hide-card="bonus"/.test(html), 'no switch markup for them');
  assert.ok((html.match(/Counselors can't see this/g) || []).length === 2, 'each carries the note instead');
  // and a viewer's applyCardVisibility hides both cards
  const cards = {};
  const realQuery = document.querySelector;
  document.querySelector = (sel) => { const m = /data-card="([a-z]+)"/.exec(sel); if (m) { cards[m[1]] = cards[m[1]] || { hidden: false, hasAttribute: () => false }; return cards[m[1]]; } return realQuery(sel); };
  try {
    setMemberRole('viewer');
    applyCardVisibility();
    assert.equal(cards.standings.hidden, true);
    assert.equal(cards.bonus.hidden, true);
    setMemberRole('editor');
    applyCardVisibility();
    assert.equal(cards.standings.hidden, false, 'a director always sees them');
    assert.equal(cards.bonus.hidden, false);
  } finally { document.querySelector = realQuery; }
});

// ── Each viewer surface (§4.12 rows) ─────────────────────────────────

test('row 5: the follow card has no rank pill and no points for a counselor', () => {
  seedWeek();
  const card = document.getElementById('follow-team-card');
  asViewer(() => renderFollowCard());
  const text = card.innerHTML.replace(/<[^>]+>/g, ' ');
  assert.ok(!/place|pts|follow-rank-pill|follow-points/.test(card.innerHTML), 'no rank markup at all');
  assert.deepEqual(leaksIn([{ kind: 'innerHTML', text: card.innerHTML }]), [], text.trim());
});

test('row 6: a counselor hears no point change, a director still does', () => {
  seedWeek();
  const change = [{ team: state.teams[0], delta: 7, total: 23 }];
  const viewer = record(() => asViewer(() => notifyPointChanges(change)));
  assert.equal(viewer.length, 0, 'no toast, notification or chime for a viewer: ' + JSON.stringify(viewer));
  setMemberRole('editor');
  const director = record(() => notifyPointChanges(change));
  assert.ok(kinds(director, 'toast').length === 1 && /\+7 pts/.test(director[0].text), 'a director keeps it: ' + JSON.stringify(director));
});

test('row 6: a bonus, a verse award or a cleanup award saved elsewhere makes a counselor\'s phone say nothing', () => {
  seedWeek();
  setMemberRole('viewer');
  renderAll();
  const scenarios = {
    'a quick-points bonus': (s) => { s.bonuses.q9 = { teamId: 't0', category: 'custom', label: 'x', points: 6, at: '2026-07-20T13:00:00Z' }; },
    'a verse award': (s) => { s.bonuses['verse-t3-2'] = { teamId: 't3', category: 'verse', label: 'x', points: 5, at: '2026-07-21T13:00:00Z', day: 2 }; },
    'a cleanup award': (s) => { s.bonuses['cleanup-t4-2-Lunch'] = { teamId: 't4', category: 'cleanup', label: 'x', points: 3, at: '2026-07-21T13:00:00Z', day: 2, meal: 'Lunch' }; },
    'a penalty': (s) => { s.bonuses.q8 = { teamId: 't2', category: 'custom', label: 'x', points: -3, at: '2026-07-21T13:00:00Z' }; },
  };
  hostDoc.hidden = true; // so an OS notification would be attempted too
  Object.keys(scenarios).forEach((name) => {
    const out = record(() => asViewer(() => applyRemoteState(snapshotWith(scenarios[name]))));
    assert.deepEqual(kinds(out, 'toast', 'jellyToast', 'notification', 'Notification', 'chime', 'share', 'copy', 'clipboard'), [], name + ' must make no noise');
    assert.deepEqual(leaksIn(out), [], name);
  });
  hostDoc.hidden = false;
});

test('row 6: a result saved elsewhere gives a counselor ONE alert that names the winners and no points', () => {
  const { live } = seedWeek();
  setMemberRole('viewer');
  state.followTeam = 't5'; // not a medallist below
  renderAll();
  hostDoc.hidden = true;
  const g = state.config.games.find((x) => !state.results[x.id] && x !== live) || state.config.games[10];
  const out = record(() => asViewer(() => applyRemoteState(snapshotWith((s) => {
    s.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T14:00:00Z' };
  }))));
  hostDoc.hidden = false;
  const toasts = kinds(out, 'toast');
  assert.equal(toasts.length, 1, JSON.stringify(toasts));
  assert.equal(toasts[0].text, `🏅 ${g.name}: ${teamName('t0')} gold, ${teamName('t1')} silver, ${teamName('t2')} bronze`);
  assert.equal(kinds(out, 'chime').length, 1);
  assert.equal(kinds(out, 'notification', 'Notification').length, 0, 'not your team: no OS notification');
  assert.deepEqual(leaksIn(kinds(out, 'toast', 'notification', 'Notification', 'chime', 'jellyToast')), []);
});

test('row 6: when your own team wins a medal the alert says so by name, loudly, and still no points', () => {
  seedWeek();
  setMemberRole('viewer');
  state.followTeam = 't1';
  renderAll();
  hostDoc.hidden = true;
  const g = state.config.games.find((x) => !state.results[x.id]);
  const out = record(() => asViewer(() => applyRemoteState(snapshotWith((s) => {
    s.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T14:00:00Z' };
  }))));
  hostDoc.hidden = false;
  const toasts = kinds(out, 'toast');
  assert.equal(toasts.length, 1, 'your team\'s medal replaces the generic line: ' + JSON.stringify(toasts));
  assert.ok(toasts[0].text.includes(`${teamName('t1')} won silver in ${g.name}!`), toasts[0].text);
  assert.equal(kinds(out, 'Notification').length, 1, 'and it reaches the OS');
  assert.equal(kinds(out, 'chime').length, 1);
  assert.deepEqual(leaksIn(kinds(out, 'toast', 'Notification', 'notification', 'chime')), []);
});

test('a cleared result is not news, and several results in one snapshot share one toast', () => {
  const { live } = seedWeek();
  setMemberRole('viewer');
  state.followTeam = 't5';
  renderAll();
  const cleared = record(() => asViewer(() => applyRemoteState(snapshotWith((s) => { delete s.results[state.config.games[0].id]; }))));
  assert.equal(kinds(cleared, 'toast', 'chime').length, 0, 'a cleared result says nothing');
  const open = state.config.games.filter((g) => !state.results[g.id] && g !== live).slice(0, 4);
  const many = record(() => asViewer(() => applyRemoteState(snapshotWith((s) => {
    open.forEach((g, i) => { s.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T15:0' + i + ':00Z' }; });
  }))));
  const toasts = kinds(many, 'toast');
  assert.equal(toasts.length, 1, 'four games finished at once: one toast');
  assert.deepEqual(leaksIn(toasts), []);
});

test('row 6: a director\'s phone is not sent result alerts (it keeps the point toasts)', () => {
  seedWeek();
  setMemberRole('editor');
  const out = record(() => notifyResultChanges([{ game: state.config.games[0], medals: { gold: 't0', silver: 't1', bronze: 't2' } }]));
  assert.equal(out.length, 0);
});

test('row 7: Copy and Share give a counselor only the game winners', () => {
  seedWeek();
  const viewer = asViewer(() => standingsSummaryText());
  assert.ok(/Medals so far:/.test(viewer), 'the winners list stays');
  assert.deepEqual(leaksIn([{ kind: 'copy', text: viewer }]).filter((l) => !/ordinal/.test(l)), [], viewer);
  assert.notOk(/Standings|pts|\d\)/.test(viewer), 'no table: ' + viewer);
  setMemberRole('editor');
  const director = standingsSummaryText();
  assert.ok(/Standings \(/.test(director) && /pts/.test(director), 'a director\'s copy is unchanged');
});

test('rows 9 and 10: verse shows the verse and nothing else, cleanup shows the rota and no points', () => {
  seedWeek();
  const verse = document.getElementById('verse-body');
  const cleanup = document.getElementById('cleanup-body');
  asViewer(() => { renderMemoryVerse(); renderMealCleanup(); });
  assert.ok(/verse-day-card/.test(verse.innerHTML), 'the verse text is there');
  assert.notOk(/pts-grid|pts-row|pts-btn|\+\d/.test(verse.innerHTML), 'no per-team rows or "+N": ' + verse.innerHTML.replace(/\s+/g, ' ').slice(0, 160));
  assert.ok(/cleanup-meal-row/.test(cleanup.innerHTML), 'the rota is there');
  assert.notOk(/cleanup-meal-pts|bonus-ledger|bonus-item|\+\d/.test(cleanup.innerHTML), 'no "+N" badge, no ledger');
  setMemberRole('editor');
  renderMemoryVerse(); renderMealCleanup();
  // Cleanup buttons sit on a rota team, so they only exist where the day has
  // one — senior's rota is all TBA until it is filled in.
  const rotaSet = ['Breakfast', 'Lunch', 'Supper'].some((m) => cleanupAssigned(cleanupDay, m));
  assert.ok(/pts-btn/.test(verse.innerHTML) && (!rotaSet || /pts-btn/.test(cleanup.innerHTML)), 'a director keeps the award buttons');
});

test('rows 11 and 12: a finished game shows its winners without "+N pts", a live tally shows no suggested medals', () => {
  const { live } = seedWeek();
  const entry = document.getElementById('entry-area');
  const g = state.config.games.find((x) => state.results[x.id]);
  asViewer(() => { openGameAsViewer(g.id); renderGameView(); });
  assert.ok(entry.innerHTML.includes(teamName(state.results[g.id].medals.gold)), 'the gold winner is named');
  assert.notOk(/medal-points|pts/.test(entry.innerHTML), 'but not what it is worth: ' + entry.innerHTML.replace(/\s+/g, ' ').slice(0, 200));
  setMemberRole('editor');
  openGameAsViewer(g.id); renderGameView();
  assert.ok(/medal-points/.test(entry.innerHTML) && /\+\d+ pts/.test(entry.innerHTML), 'a director\'s result keeps the chips');
  if (live) {
    asViewer(() => { openGameAsViewer(live.id); renderGameView(); });
    assert.ok(/lw-rank-list/.test(entry.innerHTML), 'the live scores are public');
    assert.notOk(/live-watch-suggest|Suggested|🥇/.test(entry.innerHTML), 'but no suggested winners before a director saves');
    const home = asViewer(() => liveHomeTallyCard(live) + tallyBoardHTML(live));
    assert.notOk(/medals ready|🥇/.test(home), 'nor on the home cards');
    setMemberRole('editor');
    assert.ok(/medals ready/.test(liveHomeTallyCard(live)), 'a director still sees them');
  }
});

test('row 16: the copy no longer promises point alerts to a counselor', () => {
  seedWeek();
  const shown = [];
  const real = showToast;
  showToast = (m) => shown.push(m);
  try {
    asViewer(() => { state.notify = false; toggleNotify(); });
    assert.ok(/when a game finishes/.test(shown[0]) && !/points/.test(shown[0]), shown[0]);
    state.notify = false;
    shown.length = 0;
    setMemberRole('editor');
    toggleNotify();
    assert.ok(/team's points change/.test(shown[0]), 'a director is still told about points');
  } finally { showToast = real; }
  const html = readFixture('../index.html');
  assert.ok(html.includes("You'll get alerts when your team plays and wins medals."), 'the picker says it plainly');
  assert.notOk(/when they score/.test(html + readFixture('../app.js')), 'no "when they score" anywhere');
});

test('the change history is a director\'s: a counselor cannot open it', () => {
  seedWeek();
  let opened = 0;
  const realRender = renderHistory;
  renderHistory = () => { opened++; };
  try {
    setMemberRole('viewer');
    openHistory();
    assert.equal(opened, 0);
    setMemberRole('editor');
    openHistory();
    assert.equal(opened, 1);
  } finally { renderHistory = realRender; }
});

test('the quick-points card for a counselor is empty even when called directly', () => {
  seedWeek();
  const wrap = document.getElementById('bonus-body');
  setMemberRole('editor');
  renderBonuses();
  assert.ok(/bonus-ledger/.test(wrap.innerHTML));
  asViewer(() => renderBonuses());
  assert.equal(wrap.innerHTML, '');
});

// ── The first frame ──────────────────────────────────────────────────

test('hint-paint: a counselor phone booting from a cached week with points paints no points on any sink', () => {
  seedWeek();
  setMemberRole('editor');
  const cache = JSON.stringify(state);
  assert.ok(medalCounts().t0.points > 0);
  const vm = nodeRequire('vm');
  const { makeContext } = nodeRequire('./harness.js');
  const boot = makeContext({ storage: { [STORAGE_KEY]: cache, campScoreboardAuthHint: 'viewer', campScoreboardCampsHint: JSON.stringify({ junior: 'viewer' }) } });
  boot.sandbox.installSinks();
  const get = (expr) => vm.runInContext(expr, boot.ctx);
  // applyTheme dispatches an event on window; the stub window has neither
  get('globalThis.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; }; globalThis.dispatchEvent = function () { return true; }');
  get('setStandingsGuardThrows(true)');
  boot.sandbox.__sinkRec.on = true;
  assert.doesNotThrow(() => get('boot()'), 'the first frame of a viewer never reaches a points reader');
  boot.sandbox.__sinkRec.on = false;
  assert.equal(get('canEdit()'), false, 'the hint painted a viewer');
  assert.equal(get('appStarted'), true, 'and the app really painted');
  assert.ok(boot.sandbox.__sinkRec.log.length > 20, 'with the recorder live');
  assert.deepEqual(leaksIn(boot.sandbox.__sinkRec.log), []);
  assert.deepEqual(leaksIn(boot.sandbox.__domSweep()), [], 'and none left in a node');
});

// ── The seeded keys for builds that predate this ─────────────────────

function sealedSeedEnvironment() {
  seedWeek();
  fbRef = {}; // sync on
  remoteReady = true;
  state.meta.hiddenCards = {};
  let saves = 0;
  const realSave = saveState;
  saveState = () => { saves++; };
  return { saves: () => saves, restore: () => { saveState = realSave; fbRef = null; } };
}

test('a director build seeds hiddenCards.standings and .bonus so a not-yet-updated counselor phone hides them', () => {
  const env = sealedSeedEnvironment();
  try {
    setMemberRole('editor');
    ensureSecrecySeed();
    assert.deepEqual(state.meta.hiddenCards, { standings: true, bonus: true });
    assert.equal(env.saves(), 1);
    ensureSecrecySeed();
    assert.equal(env.saves(), 1, 'idempotent: nothing left to write');
    // an old director build un-hides one: the next new build sets it right again
    delete state.meta.hiddenCards.standings;
    ensureSecrecySeed();
    assert.deepEqual(state.meta.hiddenCards, { bonus: true, standings: true });
    assert.equal(env.saves(), 2);
    // other cards' choices are left alone
    state.meta.hiddenCards.chat = true;
    ensureSecrecySeed();
    assert.equal(state.meta.hiddenCards.chat, true);
  } finally { env.restore(); }
});

test('the seed is a director\'s write, after the first pull, with sync on: never a counselor\'s, never early', () => {
  const env = sealedSeedEnvironment();
  try {
    setMemberRole('viewer');
    ensureSecrecySeed();
    assert.deepEqual(state.meta.hiddenCards, {}, 'a counselor\'s phone cannot write the node');
    setMemberRole('editor');
    remoteReady = false;
    ensureSecrecySeed();
    assert.deepEqual(state.meta.hiddenCards, {}, 'before the first snapshot a write would queue stale state');
    remoteReady = true;
    fbRef = null;
    ensureSecrecySeed();
    assert.deepEqual(state.meta.hiddenCards, {}, 'with sync off there is nobody to protect');
    assert.equal(env.saves(), 0);
  } finally { env.restore(); }
});

test('the seed is not part of normalizeSyncedState, which runs for everyone and on every load', () => {
  freshState();
  setMemberRole('editor');
  fbRef = {}; remoteReady = true;
  normalizeSyncedState();
  fbRef = null;
  assert.deepEqual(state.meta.hiddenCards, {}, 'healing a pruned map must not write the secrecy keys');
});
