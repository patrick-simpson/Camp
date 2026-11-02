// Undo core (setup-rebuild-spec §7.1, build step 9): every builder commit that goes
// through configEdit (games, days) or stateEdit (teams) records what it changed as
// { id, label, at, epoch, ops: [[domain, path, before, after], …] } with canonical values
// from the engine's own diff, and offers an Undo button on its toast. Undo puts `before`
// back ONLY where the current value still equals `after`; anything somebody changed since
// is left alone and said out loud. The undo is itself a commit, so it becomes a new
// "Undid: …" entry (undoing THAT is the redo). Run under the senior profile too
// (undo.senior.test.js evals this file).

const vm = nodeRequire('vm');
const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');

const udWait = (ms) => new Promise((r) => setTimeout(r, ms || 5));

function udSetup() {
  freshState();
  setMemberRole('editor');
  undoClear();
  delete state._cfgBase;
  delete state._cfgNotes;
  fbConfigRef = null;
  configReady = false;
  return state;
}

function udTeardown() {
  undoClear();
  delete state._cfgBase;
  delete state._cfgNotes;
  delete state.meta.epoch;
  configReady = false;
  fbConfigRef = null;
  setMemberRole(null);
}

// Run fn with showToast recording every toast (message + options).
function udToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  try { return fn(toasts); } finally { showToast = real; }
}

const udGame = (id) => gameById(id);

test('a config commit records a canonical entry and offers Undo on its toast; Undo reverses it and offers Redo', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const g = state.config.games[0];
      const before = g.name;
      assert.equal(configEdit('Renamed ' + before, () => { udGame(g.id).name = 'Gaga Ball Deluxe'; }), true);
      const e = undoRecent()[0];
      assert.equal(e.label, 'Renamed ' + before);
      assert.deepEqual(e.ops, [['config', 'games/' + g.id + '/name', before, 'Gaga Ball Deluxe']], 'canonical before and after');
      assert.equal(e.epoch, '');
      assert.ok(e.at);
      const t = toasts[toasts.length - 1];
      assert.equal(t.msg, 'Renamed ' + before);
      assert.equal(t.opts.action.label, 'Undo');
      // Tap it.
      t.opts.action.run();
      assert.equal(udGame(g.id).name, before, 'undone');
      const redo = undoRecent()[0];
      assert.equal(redo.label, 'Undid: Renamed ' + before, 'the undo is a new entry');
      assert.equal(undoRecent().some((x) => x.id === e.id), false, 'the undone entry is spent');
      const last = toasts[toasts.length - 1];
      assert.equal(last.msg, 'Undone: Renamed ' + before);
      assert.equal(last.opts.action.label, 'Redo');
      last.opts.action.run();
      assert.equal(udGame(g.id).name, 'Gaga Ball Deluxe', 'undoing the undo is the redo');
    });
  } finally { udTeardown(); }
});

test('a commit that changes nothing real records nothing, stamps nothing and sends nothing', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const g = state.config.games[0];
      state.config.updatedAt = 'old';
      assert.equal(configEdit('No change', () => { udGame(g.id).name = g.name; }), true);
      assert.equal(undoRecent().length, 0);
      assert.equal(state.config.updatedAt, 'old', 'no false "Last edited" stamp');
      assert.equal(toasts.length, 0);
      assert.equal(configEdit('Declined', () => false), false, 'a mutation that declines commits nothing');
      assert.equal(configEdit('Healed only', () => { udGame(g.id).rules = udGame(g.id).rules; }), true);
      assert.equal(undoRecent().length, 0);
    });
  } finally { udTeardown(); }
});

test('Undo puts back only what is still as the commit left it, and says so about the rest', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const g = state.config.games[0];
      const nameBefore = g.name;
      const locBefore = g.location;
      configEdit('Renamed and moved ' + nameBefore, () => { const x = udGame(g.id); x.name = 'New name'; x.location = 'New spot'; });
      const e = undoRecent()[0];
      assert.equal(e.ops.length, 2);
      udGame(g.id).name = 'Someone else\'s name'; // a colleague's change landed since
      const res = undoEntry(e.id);
      assert.deepEqual(res, { applied: 1, total: 2 });
      assert.equal(udGame(g.id).location, locBefore, 'the untouched field went back');
      assert.equal(udGame(g.id).name, 'Someone else\'s name', 'the changed one was left alone');
      assert.ok(/Undid 1 of 2 changes — someone changed game “.*” · name since; left theirs/.test(toasts[toasts.length - 1].msg), toasts[toasts.length - 1].msg);
      // Everything changed since: nothing to undo, and the entry stays for a retry.
      configEdit('Again', () => { udGame(g.id).headline = 'H1'; });
      const e2 = undoRecent()[0];
      udGame(g.id).headline = 'H2';
      assert.equal(undoEntry(e2.id).applied, 0);
      assert.equal(toasts[toasts.length - 1].msg, 'Can’t undo — someone changed this since.');
      assert.ok(undoRecent().some((x) => x.id === e2.id), 'kept');
    });
  } finally { udTeardown(); }
});

test('adds, deletes and reorders all undo, a deleted game back in its place', () => {
  udSetup();
  try {
    udToasts(() => {
      const games = state.config.games.map((g) => g.id);
      // delete
      const victim = udGame(games[2]);
      const snapshot = syncCanon(victim);
      configEdit('Deleted “' + victim.name + '”', () => { state.config.games.splice(2, 1); });
      assert.equal(udGame(games[2]), undefined);
      undoEntry(undoRecent()[0].id);
      assert.deepEqual(syncCanon(udGame(games[2])), snapshot, 'the whole record is back');
      assert.equal(state.config.games[2].id, games[2], 'at its old position');
      // add
      configEdit('Added a game', () => { state.config.games.push({ id: 'brand-new', name: 'Brand new', dayId: state.config.days[0].id, session: 'Morning', format: 'placement', rules: [] }); });
      assert.ok(udGame('brand-new'));
      undoEntry(undoRecent()[0].id);
      assert.equal(udGame('brand-new'), undefined, 'undoing an add removes it');
      // reorder
      configEdit('Moved down', () => { moveItem(state.config.games, 0, 1); });
      assert.equal(state.config.games[0].id, games[1]);
      undoEntry(undoRecent()[0].id);
      assert.deepEqual(state.config.games.slice(0, 3).map((g) => g.id), games.slice(0, 3), 'order back');
      // days
      configEdit('Renamed day', () => { state.config.days[0].name = 'Renamed Monday'; });
      undoEntry(undoRecent()[0].id);
      assert.ok(state.config.days[0].name !== 'Renamed Monday');
    });
  } finally { udTeardown(); }
});

test('team commits (rename, counselors, reorder) record per field and undo through the same engine', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const t0 = state.teams[0];
      const oldName = t0.name;
      const oldCounselor = t0.counselor;
      stateEdit('Renamed ' + oldName, () => { state.teams.find((t) => t.id === 't0').name = 'Foxes'; });
      let e = undoRecent()[0];
      assert.deepEqual(e.ops, [['teams', 'teams/t0/name', oldName, 'Foxes']]);
      stateEdit('Counselors', () => { state.teams.find((t) => t.id === 't0').counselor = 'Sam & Pat'; });
      undoEntry(undoRecent()[0].id);
      assert.equal(state.teams[0].counselor, oldCounselor, 'the counselor edit undone');
      assert.equal(state.teams[0].name, 'Foxes', 'the rename (a different entry) untouched');
      undoEntry(e.id);
      assert.equal(state.teams[0].name, oldName);
      // reorder
      const order = state.teams.map((t) => t.id);
      stateEdit('Moved a team', () => { moveItem(state.teams, 0, 1); });
      assert.equal(state.teams[0].id, order[1]);
      e = undoRecent()[0];
      assert.ok(e.ops.every((op) => op[0] === 'teams' && /\/_o$/.test(op[1])), 'a reorder is two order ops');
      undoEntry(e.id);
      assert.deepEqual(state.teams.map((t) => t.id), order);
      // a change somebody else made since is left alone
      stateEdit('Renamed again', () => { state.teams[2].name = 'Mine'; });
      e = undoRecent()[0];
      state.teams[2].name = 'Theirs';
      assert.equal(undoEntry(e.id).applied, 0);
      assert.equal(state.teams[2].name, 'Theirs');
      assert.ok(/team “Theirs”/.test(toasts.map((t) => t.msg).join(' ')) || /Can’t undo/.test(toasts[toasts.length - 1].msg));
    });
  } finally { udTeardown(); }
});

test('an offline clash\'s synthetic entry changes MINE into THEIRS, so Undo brings my offline edit back', async () => {
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  udSetup();
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  remoteReady = true;
  try {
    await (async () => {
      db.serverSet(dbPath('config'), state.config);
      fbConfigRef = db.ref(dbPath('config'));
      attachConfigListener();
      db.deliverFirstSnapshots();
      await udWait(10);
      const id = state.config.games[0].id;
      state.config.games[0].location = 'Field 2'; // offline, never sent
      saveConfig();
      clearTimeout(pushConfigTimer); pushConfigTimer = null;
      configReady = false; // a reload
      const server = db.serverGet(dbPath('config'));
      server.games.find((g) => g.id === id).location = 'Gym';
      db.serverSet(dbPath('config'), server);
      await udWait(30);
      assert.equal(udGame(id).location, 'Gym', 'the server won the merge');
      const e = undoRecent().find((x) => /Bring back your offline change/.test(x.label));
      assert.ok(e, 'the synthetic entry exists');
      assert.deepEqual(e.ops, [['config', 'games/' + id + '/location', 'Field 2', 'Gym']], 'before = mine, after = the server\'s');
      udToasts(() => { assert.equal(undoEntry(e.id).applied, 1); });
      assert.equal(udGame(id).location, 'Field 2', 'the Undo pill restores mine');
      // ... and if someone has changed it again since, it says so instead.
    })();
  } finally { delete window.FIREBASE_CONFIG; remoteReady = false; udTeardown(); }
});

test('the history is per camp, persisted (≤ 50 entries, ≤ 200 KB, oldest dropped) and survives a reload', () => {
  udSetup();
  try {
    udToasts(() => {
      const g = state.config.games[0];
      for (let i = 0; i < 60; i += 1) configEdit('Edit ' + i, () => { udGame(g.id).headline = 'h' + i; });
      assert.equal(undoRecent().length, 50, 'capped at 50');
      assert.equal(undoRecent()[0].label, 'Edit 59', 'newest first');
      assert.equal(undoRecent()[49].label, 'Edit 10', 'the oldest ten were dropped');
      const key = lsKey(UNDO_KEY);
      assert.equal(key, 'campSetupUndo' + CAMP.storageSuffix);
      assert.ok(localStorage.getItem(key), 'stored under the camp\'s own key');
      undoList = null; // a reload: nothing in memory
      assert.equal(undoRecent().length, 50);
      assert.equal(undoRecent()[0].label, 'Edit 59', 'read back from storage');
      undoClear();
      assert.equal(localStorage.getItem(key), null, 'cleared means removed');
      // Bytes: big-but-allowed entries (19 KB each) push the oldest out beyond 200 KB.
      const pad = 'x'.repeat(9000);
      for (let i = 0; i < 20; i += 1) {
        undoRecord('Big ' + i, [['config', 'games/a/name', pad + i, pad + (i + 1)]], { quiet: true });
      }
      assert.ok(JSON.stringify(undoRecent()).length <= 200000, 'under the byte cap');
      assert.ok(undoRecent().length < 20 && undoRecent().length > 5);
      assert.equal(undoRecent()[0].label, 'Big 19');
    });
  } finally { udTeardown(); }
});

test('an entry over 20 KB (a restore, a seed) is not stacked, and the commit still happens', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const before = state.config.games.length;
      configEdit('Put back the original games', () => { state.config.games = state.config.games.slice(0, 2).concat([{ id: 'big', name: 'x'.repeat(30000), format: 'placement' }]); });
      assert.equal(state.config.games.length, 3, 'the commit went through');
      assert.equal(undoRecent().length, 0, 'but no undo entry: restore points cover it');
      assert.equal(toasts.length, 0, 'and no Undo button that could not work');
      assert.ok(before > 3);
    });
  } finally { udTeardown(); }
});

test('the history is cleared on a new epoch, when a device stops being an editor, and by clearLocalData; entries from an earlier epoch refuse', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const g = state.config.games[0];
      configEdit('One', () => { udGame(g.id).headline = 'one'; });
      assert.equal(undoRecent().length, 1);
      // An entry made in one epoch cannot be undone in the next.
      const e = undoRecent()[0];
      state.meta.epoch = 'w20270801';
      assert.equal(undoEntry(e.id), null);
      assert.ok(/earlier camp year/.test(toasts[toasts.length - 1].msg));
      assert.equal(undoRecent().length, 0, 'and the stale entry is dropped');
      delete state.meta.epoch;
      // The config baseline following a new epoch clears it too.
      configEdit('Two', () => { udGame(g.id).headline = 'two'; });
      configReady = true;
      state._cfgBase = cfgCanon(state.config);
      state.meta.epoch = 'w20270801';
      cfgFollowStateEpoch();
      assert.equal(undoRecent().length, 0, 'cleared on a new epoch');
      delete state.meta.epoch;
      // A demotion.
      configEdit('Three', () => { udGame(g.id).headline = 'three'; });
      assert.equal(undoRecent().length, 1);
      setMemberRole('viewer');
      assert.equal(undoRecent().length, 0, 'a device that stops being an editor keeps no history');
      assert.equal(localStorage.getItem(lsKey(UNDO_KEY)), null);
      assert.equal(undoEntry('anything'), null);
      // clearLocalData (sign-out).
      setMemberRole('editor');
      configEdit('Four', () => { udGame(g.id).headline = 'four'; });
      assert.ok(localStorage.getItem(lsKey(UNDO_KEY)));
      clearLocalData();
      assert.equal(localStorage.getItem(lsKey(UNDO_KEY)), null, 'sign-out wipes it');
    });
  } finally { udTeardown(); }
});

test('a viewer (or a read-only tab) cannot undo anything', () => {
  udSetup();
  try {
    udToasts((toasts) => {
      const g = state.config.games[0];
      configEdit('Mine', () => { udGame(g.id).headline = 'mine'; });
      const e = undoRecent()[0];
      const was = memberRole;
      memberRole = 'viewer'; // (setMemberRole would clear the history; here we only test the gate)
      assert.equal(undoEntry(e.id), null);
      assert.ok(/Only a director/.test(toasts[toasts.length - 1].msg));
      assert.equal(udGame(g.id).headline, 'mine');
      memberRole = was;
    });
  } finally { udTeardown(); }
});

test('Undo reads the live config at the moment it runs (a remote apply replaced every object since)', async () => {
  udSetup();
  try {
    udToasts(() => {
      const g = state.config.games[0];
      const oldName = g.name;
      configEdit('Renamed', () => { udGame(g.id).name = 'Changed'; });
      const e = undoRecent()[0];
      // A snapshot swaps in brand-new objects.
      state.config = JSON.parse(JSON.stringify(state.config));
      state.config.games[3].location = 'Remote edit elsewhere';
      assert.equal(undoEntry(e.id).applied, 1);
      assert.equal(udGame(g.id).name, oldName);
      assert.equal(state.config.games[3].location, 'Remote edit elsewhere', 'and nothing else moved');
    });
  } finally { udTeardown(); }
});
