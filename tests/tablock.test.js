// S2c - two tabs of the same camp: ONE writer (setup-rebuild-spec section 6.9).
//
// STORAGE_KEY holds a device's unconfirmed edits and the confirmed baseline they
// are measured against. Two tabs each kept their own in-memory copy and each wrote
// the WHOLE cache, so the later write erased the other's unsent edits. An editor
// tab now takes a Web Lock ('camp-writer:<camp>') BEFORE it persists anything; a
// tab that does not get it is view-only. Driven with a stubbed navigator.locks
// (including the real API's steal / ifAvailable semantics) and a fake clock, and
// against the in-memory database for what a tab pushes. Every scenario boots its
// OWN copy of the app (makeContext), so two tabs are two contexts that share one
// lock manager and one localStorage, like two tabs of one browser.

const vm = nodeRequire('vm');
const { makeContext } = nodeRequire('./harness.js');
const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');

const TL_CAMP = CAMP.id;                 // junior, or senior for the twin of this file
const TL_LOCK = 'camp-writer:' + TL_CAMP;
const tlRealWait = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const tlFlush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// navigator.locks as the browser has it: ifAvailable answers null when held, steal
// rejects the holder's request() promise with AbortError, a held lock is a callback
// promise that never settles. `deferAnswers` parks every request until answerNext().
function tlLocks(opts) {
  const o = opts || {};
  const held = new Map();
  const parked = [];
  const mgr = { calls: [], held, parked };
  const abort = () => Object.assign(new Error('The lock request was aborted'), { name: 'AbortError' });
  const process = (name, op, cb, resolve, reject) => {
    const cur = held.get(name);
    const grant = () => {
      const entry = { reject: null };
      held.set(name, entry);
      const done = (fn) => (v) => { if (held.get(name) === entry) held.delete(name); fn(v); };
      entry.reject = (e) => reject(e);
      Promise.resolve().then(() => {
        let r;
        try { r = cb({ name }); } catch (e) { done(reject)(e); return; }
        Promise.resolve(r).then(done(resolve), done(reject));
      });
    };
    if (!cur) { grant(); return; }
    if (op.steal) { held.delete(name); cur.reject(abort()); grant(); return; }
    if (op.ifAvailable) {
      Promise.resolve().then(() => {
        let r;
        try { r = cb(null); } catch (e) { reject(e); return; }
        Promise.resolve(r).then(resolve, reject);
      });
    }
  };
  mgr.request = (name, a, b) => {
    const cb = typeof a === 'function' ? a : b;
    const op = typeof a === 'function' ? {} : (a || {});
    mgr.calls.push({ name, opts: op });
    return new Promise((resolve, reject) => {
      if (o.deferAnswers) parked.push(() => process(name, op, cb, resolve, reject));
      else process(name, op, cb, resolve, reject);
    });
  };
  mgr.answerNext = () => { const f = parked.shift(); if (f) f(); };
  // Another page (a reloading one, a second tab) holds / lets go of the lock.
  mgr.otherPageHolds = (name) => { held.set(name || TL_LOCK, { reject: () => {} }); };
  mgr.otherPageGone = (name) => { held.delete(name || TL_LOCK); };
  return mgr;
}

// A clock the test advances by hand; installed over the tab's setTimeout.
function tlClock(sandbox) {
  const timers = [];
  let now = 0;
  let seq = 0;
  sandbox.setTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
  sandbox.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  return {
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
        await tlFlush();
      }
      now = end;
      await tlFlush();
    },
  };
}

// One tab = one copy of the app. opts: storage (seeds localStorage), locks,
// BroadcastChannel, clock (true = fake timers), shareStorageWith (another tab).
function tlTab(opts) {
  const o = opts || {};
  const { ctx, sandbox } = makeContext({ camp: TL_CAMP, storage: o.storage });
  if (o.locks) sandbox.navigator.locks = o.locks;
  if (o.BroadcastChannel) sandbox.BroadcastChannel = o.BroadcastChannel;
  if (o.shareStorageWith) sandbox.localStorage = o.shareStorageWith.sandbox.localStorage;
  const tab = {
    ctx,
    sandbox,
    run: (code) => vm.runInContext(code, ctx),
    clock: o.clock ? tlClock(sandbox) : null,
    stored: () => { const raw = sandbox.localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; },
    storedRaw: () => sandbox.localStorage.getItem(STORAGE_KEY),
  };
  // A cache a hinted director's phone would load: an OLD shape (no config), so the
  // load-time migrate has something to persist.
  return tab;
}

// A cached week whose config is missing: migrateState() upgrades it at load.
function tlOldCache() {
  const s = JSON.parse(JSON.stringify(makeFreshState()));
  delete s.config;
  return JSON.stringify(s);
}
const tlHintedEditor = () => ({ campScoreboardAuthHint: 'editor', [STORAGE_KEY]: tlOldCache() });

// Connect a tab to a fake database already holding its week, as a connected phone.
async function tlConnect(tab, db) {
  tab.sandbox.__db = db;
  const ref = db.ref(dbPath('state'));
  await ref.set(tab.run('syncedSnapshot()'));
  tab.run("fbRef = __db.ref(dbPath('state')); remoteReady = true; pendingWrites = 0; dataEditPending = false; lastSyncedTree = syncedSnapshot();");
  db.log.length = 0;
}
// The week config is pushed as a transaction of this phone's unconfirmed ops (config engine v2),
// so a push needs a server copy the SDK has cached (a listener), a confirmed baseline, and a
// real edit to send. Leaves the tab ready for pushConfig().
function tlSeedConfigEdit(tab, db) {
  db.serverSet(CAMP.dbRoot + '/config', JSON.parse(tab.run('JSON.stringify(state.config)')));
  tab.run("fbConfigRef = __db.ref(dbPath('config')); fbConfigRef.on('value', () => {}); configReady = true; " +
    "state._cfgBase = cfgCanon(state.config); state.config.games[0].name = 'Edited while undecided'");
}
const tlUpdates = (db) => db.log.filter((l) => l.kind === 'update' || l.kind === 'set');
const tlRes = (n) => ({ medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'v' + n });

test('no Web Locks API: an editor is a writer at once and writes the cache (today)', () => {
  const t = tlTab();
  t.run("setMemberRole('editor')");
  assert.equal(t.run('tabWriter'), true, 'fail open, decided synchronously');
  assert.equal(t.run('canEdit()'), true);
  t.run('saveState()');
  assert.ok(t.stored(), 'the cache was written');
});

test('the lock is per camp, and viewers never take it', async () => {
  const mgr = tlLocks();
  const t = tlTab({ locks: mgr });
  assert.equal(t.run('tabLockName()'), TL_LOCK);
  t.run("setMemberRole('viewer')");
  await tlFlush();
  assert.equal(mgr.calls.length, 0, 'a viewer asks for nothing');
  assert.equal(t.run('tabWriter'), true, 'viewers are writers by default (no unconfirmed edits to protect)');
  t.run('saveState()');
  assert.ok(t.stored(), 'and persist as before');
  assert.equal(t.run('canEdit()'), false);
});

test('an editor asks for camp-writer:<camp> with ifAvailable and holds it until unload', async () => {
  const mgr = tlLocks();
  const t = tlTab({ locks: mgr });
  t.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(mgr.calls.length, 1);
  assert.equal(mgr.calls[0].name, TL_LOCK);
  assert.deepEqual(mgr.calls[0].opts, { ifAvailable: true });
  assert.equal(t.run('tabWriter'), true);
  assert.ok(mgr.held.has(TL_LOCK), 'the callback promise never settles, so the lock stays held');
  assert.equal(t.run('canEdit()'), true);
});

test('undecided: the load-time migrate, a save and a first-snapshot adopt write nothing; the lock answer flushes them', async () => {
  const mgr = tlLocks({ deferAnswers: true });
  const t = tlTab({ locks: mgr, clock: true, storage: tlHintedEditor() });
  const before = t.storedRaw();
  assert.equal(t.run('tabWriter'), null, 'a hinted director starts undecided, at load');
  assert.equal(t.storedRaw(), before, 'the load-time migrate did not write ahead of the election');
  assert.equal(t.run('JSON.stringify(state.config) !== undefined && !!state.config.games'), true, 'but the week IS upgraded in memory');
  t.run("setMemberRole('editor', { provisional: true })"); // boot(): the hinted role
  await tlFlush();
  assert.equal(mgr.calls.length, 1, 'the request is out, unanswered');
  t.run("state.results.g1 = " + JSON.stringify(tlRes(1)) + '; saveState()');
  t.run('applyRemoteState(syncedSnapshot(), syncedSnapshot())'); // a first-snapshot adopt persists too
  assert.equal(t.storedRaw(), before, 'still nothing written while undecided');
  mgr.answerNext();
  await tlFlush();
  assert.equal(t.run('tabWriter'), true);
  const after = t.stored();
  assert.ok(after.config && after.config.games, 'the migrated week was written once decided');
  assert.ok(after.results.g1, 'and so was the score typed meanwhile');
});

test('a non-hinted tab writes the load-time migrate at load, exactly as before', () => {
  const t = tlTab({ storage: { [STORAGE_KEY]: tlOldCache() } });
  assert.equal(t.run('tabWriter'), true);
  assert.ok(t.stored().config, 'the upgraded shape was persisted at load');
});

test('undecided: a push waits (queued, not dropped) and goes out once the tab is the writer', async () => {
  const mgr = tlLocks({ deferAnswers: true });
  const db = makeFakeRtdb();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await tlConnect(t, db);
  t.run('state.results.g1 = ' + JSON.stringify(tlRes(1)) + '; touchData(); saveState(); flushPendingPush()');
  await tlRealWait(5);
  assert.equal(tlUpdates(db).length, 0, 'nothing is sent while undecided');
  assert.equal(t.run('editorMidEntry()'), true, 'the held push counts as unsent work, so a snapshot is not adopted over it');
  mgr.answerNext();
  await tlFlush();
  await t.clock.advance(500); // the re-armed 400 ms push timer
  await tlRealWait(5);
  assert.equal(tlUpdates(db).length, 1, 'the held push went out');
  assert.ok(db.serverTree()[CAMP.dbRoot].state.results.g1, 'the score reached the server');
  assert.equal(t.run('editorMidEntry()'), false);
});

test('not granted: retries every 250 ms for 1.5 s, then the tab is view-only and writes nothing', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(mgr.calls.length, 1);
  await t.clock.advance(249);
  assert.equal(mgr.calls.length, 1, 'not before 250 ms');
  await t.clock.advance(1);
  assert.equal(mgr.calls.length, 2);
  await t.clock.advance(1000);
  assert.equal(mgr.calls.length, 6, 'still asking at 1.25 s');
  assert.equal(t.run('tabWriter'), null, 'and undecided until the window is over');
  await t.clock.advance(250);
  assert.equal(mgr.calls.length, 7, 'the last ask is at 1.5 s');
  assert.equal(t.run('tabWriter'), false);
  assert.equal(t.run('tabReadOnly()'), true);
  assert.equal(t.run('canEdit()'), false, 'every existing write gate holds');
  assert.equal(t.run('memberRole'), 'editor', 'still a director by record');
  const cache = t.storedRaw(); // (a fresh device wrote its first shape at load, before any election)
  t.run("state.results.g1 = " + JSON.stringify(tlRes(1)) + '; saveState()');
  assert.equal(t.storedRaw(), cache, 'a view-only tab never writes the cache');
  await t.clock.advance(5000);
  assert.equal(mgr.calls.length, 7, 'and stops asking');
});

test('reload ordering: the old page still holds the lock for 800 ms, then the new page is the writer', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds(); // the page that is reloading
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(800);
  assert.equal(t.run('tabWriter'), null, 'still within the retry window');
  mgr.otherPageGone(); // the old document unloads
  await t.clock.advance(250);
  assert.equal(t.run('tabWriter'), true, 'the next ask is granted');
  assert.equal(t.run('canEdit()'), true);
  t.run('saveState()');
  assert.ok(t.stored(), 'and it writes');
});

test('the API throwing, or failing some other way, fails open (today\'s behaviour)', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sync = tlTab({ locks: { request: () => { throw new Error('SecurityError'); } } });
    sync.run("setMemberRole('editor')");
    assert.equal(sync.run('tabWriter'), true, 'a synchronous throw');
    const rejected = tlTab({ locks: { request: () => Promise.reject(Object.assign(new Error('nope'), { name: 'NotSupportedError' })) } });
    rejected.run("setMemberRole('editor')");
    await tlFlush();
    assert.equal(rejected.run('tabWriter'), true, 'a rejection that is not an abort');
    rejected.run('saveState()');
    assert.ok(rejected.stored());
  } finally { console.warn = warn; }
});

test('a hinted director whose record says viewer lets go of the lock and is a writer', async () => {
  const mgr = tlLocks();
  const t = tlTab({ locks: mgr });
  t.run("setMemberRole('editor', { provisional: true })");
  await tlFlush();
  assert.ok(mgr.held.has(TL_LOCK));
  t.run("setMemberRole('viewer')");
  await tlFlush();
  assert.equal(mgr.held.has(TL_LOCK), false, 'the lock is released');
  assert.equal(t.run('tabWriter'), true);
  assert.equal(t.run('canEdit()'), false);
  // A second tab can now take it.
  const t2 = tlTab({ locks: mgr });
  t2.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(t2.run('tabWriter'), true);
});

test('the confirmed role after the hinted one does not restart the election', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor', { provisional: true })");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('tabWriter'), false);
  t.run("setMemberRole('editor')"); // the member record answers
  await tlFlush();
  assert.equal(mgr.calls.length, 7, 'no new request');
  assert.equal(t.run('tabWriter'), false, 'still view-only');
});

test('a view-only director still sees standings but cannot write, seed or score', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('standingsVisible()'), true, 'the person is still a director');
  assert.equal(t.run("canScoreRound('t0', 't1')"), false);
  t.run("fbRef = {}; remoteReady = true; delete state.meta.hiddenCards; ensureSecrecySeed()");
  assert.equal(t.run('!!(state.meta.hiddenCards && state.meta.hiddenCards.standings)'), false, 'a view-only tab writes no secrecy seed');
  t.run("fbRef = null; remoteReady = false");
  // Cards hidden from viewers follow the ROLE: the second tab shows them, a counselor does not.
  const cardHidden = (tab) => tab.run("state.meta.hiddenCards = { verse: true }; applyCardVisibility(); document.querySelector('[data-card=\"verse\"]').hidden");
  assert.equal(cardHidden(t), false, 'a view-only director tab still shows a hide-from-viewers card');
  const v = tlTab();
  v.run("setMemberRole('viewer')");
  assert.equal(cardHidden(v), true, '(a real viewer does not)');
});

test('the view-only bar says so and offers the switch; the strip carries it for a director only', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  t.run('updateSyncAlert()');
  const el = t.run("document.getElementById('sync-alert')");
  assert.equal(el.hidden, false);
  assert.ok(/another tab/i.test(el.innerHTML) && /view-only/i.test(el.innerHTML), 'the sentence');
  assert.ok(/data-tab-claim/.test(el.innerHTML) && /Use this tab instead/.test(el.innerHTML), 'the button');
  assert.ok(/Editor \(view-only tab\)/.test(t.run("(updateAccountRow(), document.getElementById('account-label').textContent)")), 'the account row names it');
  // a tap on the button asks the claim; a tap on anything else does not
  t.run('window.__claims = 0; claimWriterTab = () => { window.__claims++; }');
  t.run("onSyncStatusClick({ target: { closest: (s) => (s === '[data-tab-claim]' ? { dataset: { tabClaim: '1' } } : null) } })");
  assert.equal(t.run('window.__claims'), 1);
  // a viewer never sees it
  const v = tlTab({ locks: mgr });
  v.run("setMemberRole('viewer'); updateSyncAlert()");
  assert.equal(v.run("document.getElementById('sync-alert').hidden"), true);
});

test('Use this tab instead: steal, the old tab stops persisting BEFORE it flushes, the new one reloads', async () => {
  const mgr = tlLocks();
  const db = makeFakeRtdb();
  const a = tlTab({ locks: mgr });                 // the first tab: gets the lock
  a.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(a.run('tabWriter'), true);
  await tlConnect(a, db);
  const b = tlTab({ locks: mgr, clock: true, shareStorageWith: a }); // the second tab: refused
  b.run("setMemberRole('editor')");
  await tlFlush();
  await b.clock.advance(1500);
  assert.equal(b.run('tabWriter'), false);

  // A has a score typed and its push still queued (offline, so no ack yet).
  db.goOffline();
  a.run('state.results.g1 = ' + JSON.stringify(tlRes(1)) + '; touchData(); saveState()');
  assert.ok(a.stored().results.g1, 'written as the writer');
  const atDemotion = a.storedRaw();
  assert.equal(tlUpdates(db).length, 0, 'queued, not yet sent');

  // Make the order observable: what does pushState see of the write lock when the
  // demoted tab flushes? (Swapping the flush ahead of the demotion would let its
  // ack, and anything else it does on the way out, write the cache as a writer.)
  a.run("window.__seen = []; { const real = pushState; pushState = function () { window.__seen.push(tabWriter); return real.apply(this, arguments); }; }");

  // B: the button.
  b.run('claimWriterTab()');
  await tlFlush();
  assert.equal(b.sandbox.__reloads, 1, 'the claiming tab reloads to re-adopt from the cache and the server');
  assert.deepEqual(a.run('window.__seen'), [false], 'the flush ran AFTER tabWriter was set to false, and only once');
  assert.equal(a.run('tabWriter'), false, 'the old tab was told its lock is gone');
  assert.equal(a.run('canEdit()'), false);
  assert.equal(tlUpdates(db).length, 1, 'it flushed the queued push on the way out');
  assert.equal(a.storedRaw(), atDemotion, 'and wrote nothing after demotion');

  // The ack lands after the demotion: it must not touch the cache.
  db.goOnline();
  await tlRealWait(10);
  assert.ok(db.serverTree()[CAMP.dbRoot].state.results.g1, 'the flushed score reached the server');
  assert.equal(a.storedRaw(), atDemotion, 'an ack arriving after demotion does not touch the cache');
  assert.equal(a.run('(updateSyncAlert(), document.getElementById("sync-alert").hidden)'), false, 'the old tab shows the bar too');

  // From here the old tab never pushes (no edits of its own) - and cannot write.
  a.run('state.results.g2 = ' + JSON.stringify(tlRes(2)) + '; saveState(); pushState()');
  await tlRealWait(5);
  assert.equal(tlUpdates(db).length, 1, 'a demoted tab sends nothing more');
  assert.equal(a.storedRaw(), atDemotion);

  // The reloaded page (B's successor) elects after B's document is gone.
  mgr.otherPageGone(); // B unloads and takes the lock with it
  const c = tlTab({ locks: mgr, clock: true, storage: { [STORAGE_KEY]: atDemotion }, shareStorageWith: a });
  c.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(c.run('tabWriter'), true, 'the new page is the writer');
  assert.equal(JSON.parse(c.storedRaw()).results.g1.savedAt, 'v1', 'and re-adopts the cache the old tab last wrote as a writer');
});

test('a tab that turns out read-only still sends the push it held while undecided', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const db = makeFakeRtdb();
  const t = tlTab({ locks: mgr, clock: true });
  const cache = t.storedRaw();
  t.run("setMemberRole('editor')");
  await tlFlush();
  await tlConnect(t, db);
  t.run('state.results.g1 = ' + JSON.stringify(tlRes(1)) + '; touchData(); saveState(); flushPendingPush()');
  await tlRealWait(5);
  assert.equal(tlUpdates(db).length, 0, 'held while the answer is out');
  await t.clock.advance(1500);
  await tlRealWait(5);
  assert.equal(t.run('tabWriter'), false);
  assert.equal(tlUpdates(db).length, 1, 'an edit typed in the first second is the person\'s: it is sent, not dropped');
  assert.equal(t.storedRaw(), cache, 'but the cache stays the other tab\'s');
  assert.equal(t.run('editorMidEntry()'), false, 'and nothing is left holding adoption');
});

test('a view-only tab never pushes what it adopted from the cache (the writer tab owns those)', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const db = makeFakeRtdb();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  await tlConnect(t, db);
  t.run('state.results.g9 = ' + JSON.stringify(tlRes(9)) + '; pushState(); pushConfig()');
  await tlRealWait(5);
  assert.equal(db.log.length, 0, 'no write of any kind');
});

test('BroadcastChannel fallback: a newcomer asks, the writer answers, the claim hands the cache over', async () => {
  const buses = {};
  class TlChannel {
    constructor(name) { this.name = name; (buses[name] = buses[name] || []).push(this); this.onmessage = null; }
    postMessage(data) {
      buses[this.name].filter((c) => c !== this).forEach((c) => {
        Promise.resolve().then(() => { if (c.onmessage) c.onmessage({ data: JSON.parse(JSON.stringify(data)) }); });
      });
    }
    close() { buses[this.name] = buses[this.name].filter((c) => c !== this); }
  }
  const a = tlTab({ BroadcastChannel: TlChannel, clock: true });  // no Web Locks API in either tab
  a.run("setMemberRole('editor')");
  assert.equal(a.run('tabWriter'), null, 'waiting for anyone to answer hello');
  await a.clock.advance(300);
  assert.equal(a.run('tabWriter'), true, 'nobody answered: the first tab writes');
  const b = tlTab({ BroadcastChannel: TlChannel, clock: true });
  b.run("setMemberRole('editor')");
  await tlFlush();
  assert.equal(b.run('tabWriter'), false, 'the writer answered: the newcomer is view-only');
  assert.equal(a.run('tabWriter'), true);
  b.run('claimWriterTab()');
  await tlFlush();
  assert.equal(a.run('tabWriter'), false, 'the claim turned the old writer read-only');
  assert.equal(b.sandbox.__reloads, 1, 'and the claimant reloads once it has let go');
  a.run('tabBecomeViewer()'); // (leaves the channel registry tidy for the next case)
});

test('a snapshot is not adopted over a push an undecided tab is holding (state AND config)', async () => {
  const mgr = tlLocks({ deferAnswers: true });
  const db = makeFakeRtdb();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await tlConnect(t, db);
  tlSeedConfigEdit(t, db);
  assert.equal(t.run('editorMidEntry() || canAdoptRemote() === false'), false, 'quiet to start with');
  // Only the held flag may be what keeps adoption away: no pending edit, no timers.
  t.run('dataEditPending = false; pushTimer = null; pushConfigTimer = null; pushState()');
  assert.equal(t.run('tabHeldState'), true, 'the state push was held');
  assert.equal(t.run('editorMidEntry()'), true, 'a held state push is unsent work');
  assert.equal(t.run('canAdoptRemote()'), false, 'so a snapshot is deferred, not adopted over it');
  t.run('deferRemoteSnapshot()');
  assert.equal(t.run('remoteRefetchPending'), true, 'and owed as a re-read');
  t.run('tabHeldState = false');
  assert.equal(t.run('editorMidEntry()'), false);
  t.run('pushConfig()');
  assert.equal(t.run('tabHeldConfig'), true, 'the config push was held');
  assert.equal(t.run('editorMidEntry()'), true, 'a held config push is unsent work too');
  assert.equal(t.run('canAdoptRemote()'), false);
  assert.equal(db.log.length, 0, 'nothing reached the database while undecided');
  mgr.answerNext();
  await tlFlush();
  await t.clock.advance(500);
  await tlRealWait(5);
  assert.equal(t.run('tabWriter'), true);
  assert.equal(t.run('tabHeldConfig'), false, 'the held config push was re-armed on the yes');
  assert.equal(db.serverGet(CAMP.dbRoot + '/config').games[0].name, 'Edited while undecided', 'and the week config edit reached the server');
});

test('a week-config edit follows the same gate: held while undecided, never sent by a read-only tab', async () => {
  // Undecided, then read-only: the config transaction must not go out at all.
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const db = makeFakeRtdb();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await tlConnect(t, db);
  tlSeedConfigEdit(t, db);
  db.log.length = 0;
  t.run('pushConfig()');
  assert.equal(db.log.length, 0, 'held while the answer is out');
  assert.equal(t.run('tabHeldConfig'), true);
  await t.clock.advance(1500);
  await tlRealWait(5);
  assert.equal(t.run('tabWriter'), false);
  // The demotion flush sends what was held (an edit typed in the first second is the person's) ...
  assert.equal(db.log.filter((l) => l.kind === 'transaction').length, 1, 'the held config edit is sent on the way to read-only');
  const sent = db.log.length;
  // ... and from then on a read-only tab sends no config at all.
  t.run('pushConfig(); schedulePushConfig()');
  await t.clock.advance(1000);
  await tlRealWait(5);
  assert.equal(db.log.length, sent, 'a view-only tab never pushes the week config');
  assert.equal(t.run('tabHeldConfig'), false, 'and holds nothing');
});

test('a Web Locks request that never answers fails open after 4 s (the tab is not stuck undecided)', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const db = makeFakeRtdb();
    const t = tlTab({ locks: { request: () => new Promise(() => {}) }, clock: true });
    t.run("setMemberRole('editor')");
    await tlFlush();
    await tlConnect(t, db);
    t.run('state.results.g1 = ' + JSON.stringify(tlRes(1)) + '; touchData(); saveState(); flushPendingPush()');
    assert.equal(t.run('tabWriter'), null, 'undecided while the request is out');
    assert.equal(t.run('editorMidEntry()'), true);
    await t.clock.advance(3999);
    assert.equal(t.run('tabWriter'), null, 'not before the deadline');
    await t.clock.advance(1);
    assert.equal(t.run('tabWriter'), true, 'then it writes as before, no lock');
    assert.equal(t.run('canEdit()'), true);
    assert.ok(t.stored().results.g1, 'the owed cache write was made');
    await t.clock.advance(500);
    await tlRealWait(5);
    assert.ok(db.serverTree()[CAMP.dbRoot].state.results.g1, 'and the held push went out');
  } finally { console.warn = warn; }
});

test('the watchdog is per ask: a "no" answer cancels it, and a late grant after failing open lets go', async () => {
  // A held-by-another answer arrives promptly; the 1.5 s retry loop (not the 4 s
  // watchdog) decides, and 4 s later nothing flips the tab back.
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('tabWriter'), false);
  await t.clock.advance(10000);
  assert.equal(t.run('tabWriter'), false, 'the watchdog did not fire after a real answer');

  // A request that is granted only AFTER the watchdog failed the tab open releases at once.
  const warn = console.warn;
  console.warn = () => {};
  try {
    let grant = null;
    const late = { request: (name, o, cb) => new Promise((resolve) => { grant = () => Promise.resolve(cb({ name })).then(resolve); }) };
    const u = tlTab({ locks: late, clock: true });
    u.run("setMemberRole('editor')");
    await tlFlush();
    await u.clock.advance(4000);
    assert.equal(u.run('tabWriter'), true, 'failed open');
    grant();
    await tlFlush();
    assert.equal(u.run('tabLockRelease'), null, 'the late lock was not kept (no second, conflicting decision)');
    assert.equal(u.run('tabWriter'), true);
  } finally { console.warn = warn; }
});

test('Use this tab instead needs a connection: offline it says so and steals nothing', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('tabReadOnly()'), true);
  const asked = mgr.calls.length;
  t.run("window.__toast = null; showToast = (m) => { window.__toast = m; }");
  t.sandbox.navigator.onLine = false;
  t.run('claimWriterTab()');
  await tlFlush();
  assert.ok(/connection/i.test(t.run('window.__toast') || ''), 'a toast names why');
  assert.equal(mgr.calls.length, asked, 'the lock was not stolen');
  assert.equal(t.sandbox.__reloads, 0, 'and the page did not reload into an error page');
  assert.equal(t.run('tabReadOnly()'), true, 'still a working (view-only) page');
  t.sandbox.navigator.onLine = true;
  t.run('claimWriterTab()');
  await tlFlush();
  assert.equal(t.sandbox.__reloads, 1, 'back online it goes ahead');
});

test('a view-only director tab: chat follows the member role (a hidden Chat tab still opens for a director)', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('canEdit()'), false);
  t.run("state.meta.hiddenCards = { chat: true }");
  assert.equal(t.run('chatHiddenFromMe()'), false, 'the card is drawn for a director, so a tap must open it');
  t.run("openChat('general')");
  assert.equal(t.run("activeTab()"), 'chat', 'chat opens in the view-only tab');
  t.run("showTab('now')");
  // a real viewer, same hidden card: refused (unchanged)
  const v = tlTab();
  v.run("setMemberRole('viewer'); state.meta.hiddenCards = { chat: true }");
  assert.equal(v.run('chatHiddenFromMe()'), true);
  v.run("openChat('general')");
  assert.equal(v.run('activeTab()'), 'now', 'refused: the viewer stays where they were');
});

test('a view-only tab shows a parked change without Retry / Discard, and those do nothing there', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  t.run("stateQuarantine = { 'results/g1': { medals: { gold: 't0' } } }");
  assert.ok(!/data-sync-quarantine/.test(t.run('quarantineLineHtml()')), 'no buttons in a read-only tab');
  assert.ok(/couldn’t be saved/.test(t.run('quarantineLineHtml()')), 'but the line still says so');
  t.run("fbRef = {}; remoteReady = true; window.__confirms = 0; confirm = () => { window.__confirms++; return true; }");
  t.run('retryQuarantined(); discardQuarantined()');
  assert.equal(Object.keys(t.run('stateQuarantine')).length, 1, 'the parked path is still parked (the writer tab owns it)');
  assert.equal(t.run('window.__confirms'), 0, 'nothing even asked');
  // an editor that can write gets them
  const w = tlTab();
  w.run("setMemberRole('editor'); stateQuarantine = { 'results/g1': { medals: { gold: 't0' } } }");
  assert.ok(/data-sync-quarantine=\"retry\"/.test(w.run('quarantineLineHtml()')), 'a writer still has Retry');
});

test('html.standings-shown follows standingsVisible(), so a director\'s view-only tab does not show the sync line twice', async () => {
  const mgr = tlLocks();
  mgr.otherPageHolds();
  const flag = (tab) => tab.run("(window.__cls = {}, document.documentElement.classList.toggle = (c, on) => { window.__cls[c] = on; }, applyCardVisibility(), window.__cls['standings-shown'])");
  const t = tlTab({ locks: mgr, clock: true });
  t.run("setMemberRole('editor')");
  await tlFlush();
  await t.clock.advance(1500);
  assert.equal(t.run('canEdit()'), false);
  assert.equal(flag(t), true, 'a view-only director has the Current Standings card, which carries the line');
  const v = tlTab();
  v.run("setMemberRole('viewer')");
  assert.equal(flag(v), false, 'a counselor has no card, so the footer line is theirs');
  assert.ok(/html\.view-only:not\(\.standings-shown\) \.sync-status-footer/.test(readFixture('../styles.css')), 'and the footer rule keys off it');
});

test('persistence gate: the cache has exactly one writer in the source', () => {
  const files = ['app.js', 'settings.js', 'chat.js', 'push.js', 'camps.js', 'defaults.js', 'camp-core.js', 'reveal-core.js',
    'auth-email-link.js', 'auth-phone.js', 'boot-guard.js'];
  const hits = [];
  files.forEach((f) => {
    const src = readFixture('../' + f);
    const re = /setItem\(\s*(STORAGE_KEY|lsKey\(\s*['"]campScoreboardV2['"]\s*\)|['"]campScoreboardV2)/g;
    let m;
    while ((m = re.exec(src))) hits.push({ f, at: src.slice(0, m.index).split('\n').length });
  });
  assert.equal(hits.length, 1, 'any other setItem on the cache key bypasses the writer lock: ' + JSON.stringify(hits));
  const app = readFixture('../app.js');
  const fn = app.slice(app.indexOf('function persistState()'));
  assert.ok(fn.slice(0, fn.indexOf('\n}\n')).includes('setItem(STORAGE_KEY'), 'and it is inside persistState()');
});

test('the two camps never contend: a junior tab and a senior tab of one browser both write', async () => {
  const mgr = tlLocks();
  const other = TL_CAMP === 'junior' ? 'senior' : 'junior';
  const mine = tlTab({ locks: mgr });
  mine.run("setMemberRole('editor')");
  const { ctx: octx, sandbox: osb } = makeContext({ camp: other });
  osb.navigator.locks = mgr;
  vm.runInContext("setMemberRole('editor')", octx);
  await tlFlush();
  assert.equal(mine.run('tabWriter'), true);
  assert.equal(vm.runInContext('tabWriter', octx), true, 'the other camp has its own lock');
  assert.deepEqual(mgr.calls.map((c) => c.name).sort(), ['camp-writer:junior', 'camp-writer:senior']);
});
