// "Tell people who follow this", the client half (Step 26): after a schedule change the page names the published blocks it
// touched to the Worker's /notify kind 'schedule' and never sends words. Dormant while PUSH_SERVICE_URL is blank, hidden on
// an "unknown kind" answer, never throws. The Worker itself is push-worker.test.js; the sheets are schedule-screen /
// rain-plan tests. Runs under the senior profile too (push-schedule-tell.senior.test.js evals this file).

function ptStart(opts) {
  const o = opts || {};
  freshState();
  setMemberRole(o.role || 'editor');
  authUser = { email: 'jenn@example.com', emailVerified: true };
  const real = { cfg: pushConfigured, week: campWeek, post: pushPost, repub: pushRepublishSchedule, drain: pushDrainBatches };
  const calls = [];
  pushConfigured = () => o.configured !== false;
  campWeek = () => ({ start: '2027-07-18', phase: o.phase || 'during' });
  pushRepublishSchedule = async () => ({ published: true });
  pushDrainBatches = () => {};
  pushPost = async (path, body) => {
    calls.push({ path, body });
    if (o.answer) return o.answer(body);
    return { ok: true, sent: 2, queued: 0, failed: 0, devices: 2, items: 1 };
  };
  pushSchedSent = null; pushSchedAlertsOff = false; pushSchedResetOwed = false;
  return { calls, real };
}
function ptEnd(ctx) {
  pushConfigured = ctx.real.cfg; campWeek = ctx.real.week; pushPost = ctx.real.post; pushRepublishSchedule = ctx.real.repub; pushDrainBatches = ctx.real.drain;
  pushSchedSent = null; pushSchedAlertsOff = false; pushSchedResetOwed = false;
  authUser = null; setMemberRole(null);
}
const ptBlocks = () => ({ 'wed-lunch': { dow: 3, start: 720, label: 'Lunch', emoji: '🍽', key: 'lunch' }, 'wed-supper': { dow: 3, start: 1080, label: 'Supper', emoji: '🍽', key: 'supper' } });

test('pushScheduleChangedIds names added, removed, moved and renamed blocks, never an unchanged one', () => {
  const a = ptBlocks();
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(pushScheduleChangedIds(a, b), []);
  b['wed-supper'].start = 1110;
  b['wed-new'] = { dow: 3, start: 900, label: 'Swim', emoji: '🏊', key: 'swim' };
  delete b['wed-lunch'];
  assert.deepEqual(pushScheduleChangedIds(a, b).sort(), ['wed-lunch', 'wed-new', 'wed-supper']);
  assert.deepEqual(pushScheduleChangedIds(null, b), [], 'no "before": nothing to name');
});

test('the tick is offered only with phone alerts live, a director, the camp week running, and (for a day) today or tomorrow', () => {
  let ctx = ptStart({ configured: false });
  try { assert.equal(pushScheduleAlertOffered(), false, 'dormant: PUSH_SERVICE_URL blank'); } finally { ptEnd(ctx); }
  ctx = ptStart({ phase: 'before' });
  try { assert.equal(pushScheduleAlertOffered(), false, 'outside the camp week'); } finally { ptEnd(ctx); }
  ctx = ptStart({ role: 'viewer' });
  try { assert.equal(pushScheduleAlertOffered(), false, 'a counselor'); } finally { ptEnd(ctx); }
  ctx = ptStart();
  try {
    assert.equal(pushScheduleAlertOffered(), true);
    const today = campNow().dow;
    assert.equal(pushScheduleAlertOffered(today), true);
    assert.equal(pushScheduleAlertOffered((today + 1) % 7), true);
    assert.equal(pushScheduleAlertOffered((today + 3) % 7), false, 'the Worker only tells about today and tomorrow');
    pushSchedAlertsOff = true;
    assert.equal(pushScheduleAlertOffered(), false, 'an older Worker did not know the kind');
  } finally { ptEnd(ctx); }
});

test('a tick sends ONLY block ids and the flag: no words, and the schedule is published first', async () => {
  const ctx = ptStart();
  try {
    const order = [];
    pushRepublishSchedule = async (o) => { order.push('publish:' + (o && o.force)); return { published: true }; };
    const post = pushPost;
    pushPost = async (p, b, a) => { order.push('post'); return post(p, b, a); };
    const before = ptBlocks();
    const real = pushScheduleSnapshot;
    pushScheduleSnapshot = () => Object.assign(JSON.parse(JSON.stringify(before)), { 'wed-supper': Object.assign({}, before['wed-supper'], { start: 1110 }) });
    try {
      const r = await pushScheduleTell(before, true);
      assert.equal(r.ok, true);
      assert.equal(r.sent, 2);
      assert.deepEqual(order, ['publish:true', 'post']);
    } finally { pushScheduleSnapshot = real; }
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].path, '/notify');
    assert.deepEqual(ctx.calls[0].body, { camp: CAMP.id, kind: 'schedule', alert: true, ids: ['wed-supper'] });
    assert.ok(/Told 2 phones/.test(pushScheduleTellWords({ ok: true, sent: 2, queued: 0 })));
  } finally { ptEnd(ctx); }
});

test('an untouched schedule sends nothing; an unticked change is named with alert:false; outside the camp week it is not even sent', async () => {
  const ctx = ptStart();
  const real = pushScheduleSnapshot;
  try {
    const before = ptBlocks();
    pushScheduleSnapshot = () => JSON.parse(JSON.stringify(before));
    assert.equal((await pushScheduleTell(before, true)).reason, 'no-change');
    assert.equal(ctx.calls.length, 0);
    pushScheduleSnapshot = () => Object.assign(JSON.parse(JSON.stringify(before)), { 'wed-lunch': Object.assign({}, before['wed-lunch'], { label: 'Lunch!' }) });
    const r = await pushScheduleTell(before, false);
    assert.equal(r.ok, true);
    assert.equal(ctx.calls[0].body.alert, false, 'the baseline keeps up without telling anyone');
    campWeek = () => ({ start: '2027-07-18', phase: 'before' });
    ctx.calls.length = 0;
    pushScheduleSnapshot = () => Object.assign(JSON.parse(JSON.stringify(before)), { 'wed-lunch': Object.assign({}, before['wed-lunch'], { label: 'Lunch?' }) });
    assert.equal((await pushScheduleTell(before, false)).reason, 'quiet');
    assert.equal(ctx.calls.length, 0);
  } finally { pushScheduleSnapshot = real; ptEnd(ctx); }
});

test('dormant, a counselor, and a failing sender never throw and never block: the answer is a plain result', async () => {
  let ctx = ptStart({ configured: false });
  try { assert.equal((await pushScheduleTell(ptBlocks(), true)).reason, 'off'); } finally { ptEnd(ctx); }
  ctx = ptStart({ role: 'viewer' });
  try { assert.equal((await pushScheduleTell(ptBlocks(), true)).reason, 'readonly'); } finally { ptEnd(ctx); }
  ctx = ptStart({ answer: () => { throw new Error('network'); } });
  const real = pushScheduleSnapshot;
  try {
    pushScheduleSnapshot = () => ({});
    const r = await pushScheduleTell(ptBlocks(), true);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'failed');
    assert.ok(/saved, but the alert didn’t go out/.test(pushScheduleTellWords(r)));
    assert.equal(pushSchedAlertsOff, false, 'a network blip is not "unknown kind"');
  } finally { pushScheduleSnapshot = real; ptEnd(ctx); }
});

test('an older Worker that does not know the kind switches the tick off for this page and changes nothing else', async () => {
  const ctx = ptStart({ answer: () => { const e = new Error('bad-kind'); e.serverError = 'bad-kind'; throw e; } });
  const real = pushScheduleSnapshot;
  try {
    pushScheduleSnapshot = () => ({});
    const r = await pushScheduleTell(ptBlocks(), true);
    assert.equal(r.ok, false);
    assert.equal(pushSchedAlertsOff, true);
    assert.equal(pushScheduleAlertOffered(), false, 'the row hides itself');
  } finally { pushScheduleSnapshot = real; ptEnd(ctx); }
});

test('the words: followers told, nobody follows, too far off, and nothing at all for a quiet save', () => {
  assert.ok(/Told 1 phone that follows this/.test(pushScheduleTellWords({ ok: true, sent: 0, queued: 1 })));
  assert.ok(/Nobody has reminders on/.test(pushScheduleTellWords({ ok: true, reason: 'no-followers' })));
  assert.ok(/too far off/.test(pushScheduleTellWords({ ok: true, reason: 'nothing-to-tell' })));
  assert.equal(pushScheduleTellWords({ ok: true, reason: 'no-change' }), '');
  assert.equal(pushScheduleTellWords({ ok: false, reason: 'off' }), '');
});

test('the quiet settle after other setup commits: names what changed since the sender was told, remakes the baseline when the switch moved', async () => {
  const ctx = ptStart();
  const real = pushScheduleSnapshot;
  try {
    const a = ptBlocks();
    pushScheduleSnapshot = () => JSON.parse(JSON.stringify(a));
    await pushScheduleSettle();
    assert.equal(ctx.calls.length, 0, 'the first look only remembers');
    a['wed-lunch'].start = 750;
    await pushScheduleSettle();
    assert.deepEqual(ctx.calls[0].body, { camp: CAMP.id, kind: 'schedule', alert: false, ids: ['wed-lunch'] });
    await pushScheduleSettle();
    assert.equal(ctx.calls.length, 1, 'told once');
    pushSchedResetOwed = true;
    await pushScheduleSettle();
    assert.deepEqual(ctx.calls[1].body, { camp: CAMP.id, kind: 'schedule', alert: false, ids: ['*'] }, 'a reset never alerts');
    assert.equal(pushSchedResetOwed, false);
  } finally { pushScheduleSnapshot = real; ptEnd(ctx); }
});

test('the schedule switch moving owes a baseline reset', () => {
  const ctx = ptStart();
  try {
    pushLastShared = false;
    const realShared = scheduleIsShared;
    scheduleIsShared = () => true;
    try { pushOnSetupEvent('tree'); } finally { scheduleIsShared = realShared; clearTimeout(pushRepublishTimer); pushRepublishTimer = null; pushLastShared = null; }
    assert.equal(pushSchedResetOwed, true);
  } finally { ptEnd(ctx); }
});

test('a send that fails gives the sender-state back, so the next quiet settle still names the change', async () => {
  const ctx = ptStart({ answer: () => { throw new Error('network'); } });
  const real = pushScheduleSnapshot;
  try {
    const before = ptBlocks();
    const old = JSON.parse(JSON.stringify(before));
    pushSchedSent = old;
    pushScheduleSnapshot = () => Object.assign(JSON.parse(JSON.stringify(before)), { 'wed-supper': Object.assign({}, before['wed-supper'], { start: 1110 }) });
    const r = await pushScheduleTell(before, true);
    assert.equal(r.reason, 'failed');
    assert.equal(pushSchedSent, old, 'the failed send did not move what the sender was told');
  } finally { pushScheduleSnapshot = real; ptEnd(ctx); }
});

test('pushScheduleTimeTellable: only a time still to come, before the end of tomorrow, in the camp week (camp time, server clock)', () => {
  const real = { week: campWeek, now: serverNow };
  try {
    campWeek = () => ({ start: '2027-07-18', phase: 'during' });
    serverNow = () => etWallToEpoch('2027-07-20', 600); // Tuesday 10:00
    assert.equal(pushScheduleTimeTellable(2, 660), true, 'later today');
    assert.equal(pushScheduleTimeTellable(2, 540), false, 'already started');
    assert.equal(pushScheduleTimeTellable(3, 1430), true, 'tomorrow, up to the end of the day');
    assert.equal(pushScheduleTimeTellable(4, 600), false, 'two days off');
    assert.equal(pushScheduleTimeTellable(2, -1), false);
    campWeek = () => ({ start: '', phase: 'unset' });
    assert.equal(pushScheduleTimeTellable(2, 660), false, 'no camp date');
    // the spring-forward edge: Sunday 2027-03-14 has no 02:30, and the window still ends at tomorrow's midnight
    campWeek = () => ({ start: '2027-03-14', phase: 'during' });
    serverNow = () => etWallToEpoch('2027-03-14', 60);
    assert.equal(pushScheduleTimeTellable(0, 1200), true);
    assert.equal(pushScheduleTimeTellable(2, 600), false);
  } finally { campWeek = real.week; serverNow = real.now; }
});
