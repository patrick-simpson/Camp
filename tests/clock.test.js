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
