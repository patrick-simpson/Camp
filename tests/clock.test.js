// The synced game clock. Every device counts down to the same absolute `endAt`,
// so the maths has to agree even when the handsets' own clocks don't.

const game = { id: 'g', timer: { label: 'Game clock', presets: [600, 300] } };

function setup() {
  freshState();
  state.config.games = [game];
  state.clocks = {};
  serverTimeOffset = 0;
  return game;
}

test('a game with no stored clock falls back to its first preset', () => {
  setup();
  const c = getClock(game);
  assert.equal(c.duration, 600 * 1000);
  assert.equal(c.remaining, 600 * 1000);
  assert.equal(c.running, false);
  assert.equal(c.round, 1);
  assert.equal(clockRemaining(c), 600 * 1000);
});

test('a paused clock reports its stored remainder', () => {
  setup();
  state.clocks.g = { running: false, endAt: 0, remaining: 90 * 1000, duration: 600 * 1000, round: 1 };
  assert.equal(clockRemaining(getClock(game)), 90 * 1000);
});

test('a running clock counts down to endAt and never goes negative', () => {
  setup();
  state.clocks.g = { running: true, endAt: serverNow() + 30 * 1000, remaining: 0, duration: 600 * 1000, round: 1 };
  const left = clockRemaining(getClock(game));
  assert.ok(left > 28 * 1000 && left <= 30 * 1000, `expected ~30s, got ${left}ms`);

  state.clocks.g.endAt = serverNow() - 5 * 1000; // already expired
  assert.equal(clockRemaining(getClock(game)), 0);
});

test('a device whose own clock is wrong still shows the right countdown', () => {
  setup();
  // Date.now() here stands in for THIS handset's (wrong) clock; the server is
  // `offset` milliseconds ahead of it. A ref elsewhere starts a 10-minute clock,
  // stamping endAt in server time.
  [-3 * 60 * 1000, 3 * 60 * 1000].forEach((offset) => {
    serverTimeOffset = offset;
    const endAt = serverNow() + 600 * 1000;
    state.clocks.g = { running: true, endAt, remaining: 0, duration: 600 * 1000, round: 1 };

    const left = clockRemaining(getClock(game));
    assert.ok(Math.abs(left - 600 * 1000) < 2000,
      `offset ${offset / 1000}s: expected ~10:00, got ${Math.round(left / 1000)}s`);

    // The old device-time reading was wrong by exactly the skew — three minutes
    // off on the Big Board, and a second EDITOR device would have buzzed early
    // and stopped the synced clock for everyone.
    assert.ok(Math.abs((endAt - Date.now()) - 600 * 1000) > 150 * 1000,
      'this is the reading serverNow() exists to correct');
  });
});

test('with sync off, serverNow is exactly device time', () => {
  setup();
  assert.ok(Math.abs(serverNow() - Date.now()) < 5);
});

test('start writes endAt on the shared clock, not the local one', () => {
  setup();
  serverTimeOffset = 5 * 60 * 1000; // this device is five minutes behind the server
  applyClockAction(game, 'start');
  const c = state.clocks.g;
  assert.ok(c.running);
  assert.ok(c.endAt > Date.now() + 600 * 1000, 'endAt must be stamped in server time');
  assert.ok(Math.abs(clockRemaining(getClock(game)) - 600 * 1000) < 1000,
    'and reading it back with the same offset gives the full duration');
});

test('pause banks the remainder, resume gives it back', () => {
  setup();
  state.clocks.g = { running: true, endAt: serverNow() + 100 * 1000, remaining: 0, duration: 600 * 1000, round: 1 };
  applyClockAction(game, 'pause');
  assert.notOk(state.clocks.g.running);
  assert.ok(Math.abs(state.clocks.g.remaining - 100 * 1000) < 1500);

  applyClockAction(game, 'start');
  assert.ok(state.clocks.g.running);
  assert.ok(Math.abs(clockRemaining(getClock(game)) - 100 * 1000) < 1500, 'resumes where it stopped');
});

test('reset goes back to full, and start from zero restarts', () => {
  setup();
  state.clocks.g = { running: false, endAt: 0, remaining: 12 * 1000, duration: 600 * 1000, round: 1 };
  applyClockAction(game, 'reset');
  assert.equal(state.clocks.g.remaining, 600 * 1000);

  state.clocks.g = { running: false, endAt: 0, remaining: 0, duration: 600 * 1000, round: 1 };
  applyClockAction(game, 'start');
  assert.ok(Math.abs(clockRemaining(getClock(game)) - 600 * 1000) < 1000, 'a spent clock restarts from full');
});

test('a preset re-arms the clock at the new length, stopped', () => {
  setup();
  applyClockAction(game, 'preset', '300');
  assert.equal(state.clocks.g.duration, 300 * 1000);
  assert.equal(state.clocks.g.remaining, 300 * 1000);
  assert.notOk(state.clocks.g.running);
});

test('next round re-arms at full and advances the round counter', () => {
  setup();
  state.clocks.g = { running: false, endAt: 0, remaining: 0, duration: 600 * 1000, round: 1 };
  applyClockAction(game, 'next-round');
  assert.equal(state.clocks.g.round, 2);
  assert.equal(state.clocks.g.remaining, 600 * 1000);
  assert.notOk(state.clocks.g.running);
});

test('a clock stripped of its fields by a sync round-trip still reads sanely', () => {
  setup();
  state.clocks.g = { duration: 600 * 1000 }; // running:false / endAt:0 / round:1 all pruned
  const c = getClock(game);
  assert.equal(c.running, false);
  assert.equal(c.round, 1);
  assert.equal(clockRemaining(c), 0);
});

test('anyTimerRunning drives the wake lock off the synced clocks', () => {
  setup();
  assert.notOk(anyTimerRunning());
  state.clocks.g = { running: true, endAt: serverNow() + 1000, remaining: 0, duration: 1000, round: 1 };
  assert.ok(anyTimerRunning());
});

test('fmtBoardClock formats the readings the Big Board shows', () => {
  assert.equal(fmtBoardClock(0), '0:00');
  assert.equal(fmtBoardClock(9 * 1000), '0:09');
  assert.equal(fmtBoardClock(600 * 1000), '10:00');
  assert.equal(fmtBoardClock(65 * 1000), '1:05');
});

// ── Screen wake lock: re-armed on return, never held for viewers ──

// A stand-in for navigator.wakeLock: counts requests and lets a test play the
// browser dropping the lock when the page is hidden.
function stubWakeLock() {
  const lock = { requests: 0, sentinels: [] };
  navigator.wakeLock = {
    request: async () => {
      lock.requests++;
      const s = {
        released: false,
        listeners: [],
        addEventListener(type, fn) { if (type === 'release') s.listeners.push(fn); },
        release() { s.released = true; s.listeners.forEach((fn) => fn()); },
      };
      lock.sentinels.push(s);
      return s;
    },
  };
  lock.browserDrops = () => { // what the browser does when the document is hidden
    const s = lock.sentinels[lock.sentinels.length - 1];
    s.released = true;
    s.listeners.forEach((fn) => fn());
  };
  return lock;
}
function resetWakeLock() {
  releaseWakeLock();
  delete navigator.wakeLock;
  wakeLockPending = false;
}
const nextTick = () => new Promise((r) => setTimeout(r, 0));

test('the wake lock is re-acquired when the app comes back after being hidden', async () => {
  setup();
  setMemberRole('editor');
  const lock = stubWakeLock();
  applyClockAction(game, 'start');
  await nextTick();
  assert.equal(lock.requests, 1, 'Start takes the lock');
  assert.ok(wakeLockSentinel);

  lock.browserDrops(); // ref switches to Messages for a few seconds
  assert.equal(wakeLockSentinel, null, 'the browser let go');
  rearmWakeLock(); // visibilitychange → visible
  await nextTick();
  assert.equal(lock.requests, 2, 'coming back re-arms it');
  assert.ok(wakeLockSentinel, 'and the screen is held again');

  rearmWakeLock(); // a second foreground event must not stack a second lock
  await nextTick();
  assert.equal(lock.requests, 2);
  resetWakeLock();
});

test('a device that never started a timer never holds the screen (viewers stay asleep-able)', async () => {
  setup();
  setMemberRole('viewer');
  const lock = stubWakeLock();
  // A synced clock is running on someone else's phone.
  state.clocks.g = { running: true, endAt: serverNow() + 60 * 1000, remaining: 0, duration: 600 * 1000, round: 1 };
  assert.ok(anyTimerRunning(), 'precondition: a clock really is running');
  rearmWakeLock();
  await nextTick();
  assert.equal(lock.requests, 0, 'a plain re-request would keep every viewer\'s screen on');
  setMemberRole('editor');
  resetWakeLock();
});

test('returning after the clock finished stands down instead of re-arming', async () => {
  setup();
  const lock = stubWakeLock();
  applyClockAction(game, 'start');
  await nextTick();
  lock.browserDrops();
  state.clocks.g.endAt = serverNow() - 1000; // it ran out while the app was hidden
  rearmWakeLock();
  await nextTick();
  assert.equal(lock.requests, 1, 'no new lock for a finished clock');
  assert.notOk(wakeLockWanted, 'and the intent is cleared');
  resetWakeLock();
});

test('an expired-but-still-"running" clock no longer counts as a running timer', () => {
  setup();
  state.clocks.g = { running: true, endAt: serverNow() - 1000, remaining: 0, duration: 1000, round: 1 };
  assert.notOk(anyTimerRunning(), 'a stale clock must not hold the wake lock');
  assert.notOk(clockLive(state.clocks.g));
  state.clocks.g.endAt = serverNow() + 5000;
  assert.ok(clockLive(state.clocks.g));
});

test('the lock is released when the clock auto-stops at zero', async () => {
  setup();
  setMemberRole('editor');
  const lock = stubWakeLock();
  fbRef = null;
  applyClockAction(game, 'start');
  await nextTick();
  assert.ok(wakeLockSentinel);
  const sentinel = lock.sentinels[0];

  state.clocks.g.endAt = serverNow() - 100; // the countdown just ran out
  countAlarms(() => tickBoardClocks());
  assert.notOk(state.clocks.g.running, 'settled');
  assert.ok(sentinel.released, 'screen may sleep again');
  assert.notOk(wakeLockWanted);
  resetWakeLock();
});

test('a Pictionary lap holds the screen and lets go when the lap stops', async () => {
  setup();
  setMemberRole('editor');
  const lock = stubWakeLock();
  const g = { id: 'pic', name: 'Pictionary', prompts: ['Pumpkin', 'Scarecrow', 'Acorn'], timeInput: true };
  state.config.games.push(g);
  state.ui.picTeam = 't0';
  const w = liveWatches[g.id] = { running: false, startAt: 0, lapsTotal: 0 };
  const handlers = {};
  const box = { querySelectorAll: (sel) => (sel === '[data-action]'
    ? ['start-lap', 'stop-lap'].map((a) => ({ dataset: { action: a }, addEventListener: (t, fn) => { handlers[a] = fn; } }))
    : []) };
  const wrap = { innerHTML: '', querySelector: (sel) => (sel.includes('pic-round') ? box : null) };
  bindPicRound(wrap, g);

  handlers['start-lap']();
  await nextTick();
  assert.ok(w.running);
  assert.equal(lock.requests, 1, 'a lap is a timer too');
  assert.ok(wakeLockSentinel);

  handlers['stop-lap']();
  assert.notOk(w.running);
  assert.ok(lock.sentinels[0].released, 'the screen may sleep once nothing is timing');
  delete liveWatches[g.id];
  state.ui.picTeam = null;
  state.config.games.pop();
  resetWakeLock();
});

// ── Zero handling comes from state, not from what is on screen ────

function expiredClock(agoMs) {
  state.clocks.g = { running: true, endAt: serverNow() - agoMs, remaining: 0, duration: 600 * 1000, round: 1 };
}
function countAlarms(fn) {
  const real = playAlarm;
  let n = 0;
  playAlarm = () => { n++; };
  try { fn(); } finally { playAlarm = real; }
  return n;
}

test('a clock that ends while its game is not on screen is still stopped and buzzed', () => {
  setup();
  setMemberRole('editor');
  fbRef = null;
  expiredClock(800);
  document.querySelectorAll = () => []; // no [data-game-clock] anywhere (the ref opened another game)
  const alarms = countAlarms(() => tickBoardClocks());
  assert.equal(alarms, 1, 'the buzzer sounds');
  assert.notOk(state.clocks.g.running, 'and the clock is stopped for everyone');
  assert.equal(state.clocks.g.remaining, 0);
});

test('a render that repainted the clock at 0 (data-prev=0) no longer hides the crossing', () => {
  setup();
  setMemberRole('editor');
  fbRef = null;
  expiredClock(1200);
  const el = { dataset: { gameId: 'g', prev: '0' }, textContent: '', classList: { toggle() {}, add() {}, remove() {} }, closest: () => null };
  // Only the clock query finds it — the settle re-renders, and renderAll asks
  // for other things (Big Boards) that a clock element isn't.
  document.querySelectorAll = (sel) => (sel === '[data-game-clock]' ? [el] : []);
  const alarms = countAlarms(() => tickBoardClocks());
  assert.equal(alarms, 1);
  assert.notOk(state.clocks.g.running, 'the old code left it running at 0:00 forever');
  assert.equal(el.textContent, '0:00', 'the display still updates');
  document.querySelectorAll = () => [];
});

test('a long-expired clock is settled quietly — no 20-minute-late blast', () => {
  setup();
  setMemberRole('editor');
  fbRef = null;
  expiredClock(20 * 60 * 1000); // the phone slept through it
  const alarms = countAlarms(() => tickBoardClocks());
  assert.equal(alarms, 0, 'no alarm for a long-dead expiry');
  assert.notOk(state.clocks.g.running, 'but the clock is still settled');
});

test('each expiry buzzes once; a restart arms a new one', () => {
  setup();
  setMemberRole('editor');
  fbRef = null;
  expiredClock(500);
  const first = countAlarms(() => { tickBoardClocks(); tickBoardClocks(); tickBoardClocks(); });
  assert.equal(first, 1, 'three ticks, one buzz');

  // A remote snapshot re-asserts the same expired running clock: still no second buzz.
  const endAt = state.clocks.g.endAt;
  state.clocks.g = { running: true, endAt, remaining: 0, duration: 600 * 1000, round: 1 };
  assert.equal(countAlarms(() => tickBoardClocks()), 0, 'same gid@endAt is remembered');

  expiredClock(300); // a later run of the clock, new endAt
  assert.equal(countAlarms(() => tickBoardClocks()), 1, 'a new expiry buzzes again');
});

test('viewers never buzz or write; they just see the clock', () => {
  setup();
  setMemberRole('viewer');
  fbRef = null;
  expiredClock(500);
  const alarms = countAlarms(() => tickBoardClocks());
  assert.equal(alarms, 0);
  assert.ok(state.clocks.g.running, 'a viewer cannot settle a synced clock');
  setMemberRole('editor');
});

test('nothing is written before the first server snapshot (never push before pull)', () => {
  setup();
  setMemberRole('editor');
  fbRef = { };            // sync is on...
  remoteReady = false;    // ...but no snapshot has landed yet
  dirtySinceLoad = false;
  expiredClock(500);
  const alarms = countAlarms(() => tickBoardClocks());
  assert.equal(alarms, 1, 'the buzzer is not a write, so an offline ref still gets it');
  assert.ok(state.clocks.g.running, 'but state.clocks is untouched until the server has spoken');
  assert.notOk(dirtySinceLoad, 'no write → the first merge is not forced down the "defend local work" path');
  assert.notOk(anyTimerRunning(), 'meanwhile the expired clock reads as finished (no Pause, no wake lock)');

  remoteReady = true; // the first snapshot lands
  assert.equal(countAlarms(() => tickBoardClocks()), 0, 'no second buzz for the same expiry');
  assert.notOk(state.clocks.g.running, 'now it is settled');
  fbRef = null;
});

test('a stuck running-at-zero clock can be restarted, and shows Restart rather than Pause', () => {
  setup();
  setMemberRole('editor');
  fbRef = null;
  expiredClock(60 * 1000);
  const html = clockBlockHTML(game);
  assert.notOk(html.includes('data-clock="pause"'), 'no Pause button on a clock that is not counting');
  assert.ok(html.includes('data-clock="start"') || html.includes('data-clock="next-round"'));

  applyClockAction(game, 'start');
  assert.ok(state.clocks.g.running);
  assert.ok(Math.abs(clockRemaining(getClock(game)) - 600 * 1000) < 1500, 'restarts from full, not already expired');
  resetWakeLock();
});
