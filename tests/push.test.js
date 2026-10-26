// Phone alerts (push.js + sw.js), the parts that can be wrong without a
// phone in hand: the schedule → subscribable-block mapping (keys are a
// contract between every phone's prefs and the published schedule), the
// prefs defaults (shared with the sender), the record shape (shared with the
// rules), mention targeting, the week picker, the environment checks behind
// the drawer's status card, and sw.js's payload → notification mapping.
// Subscribing, the sender round-trip and the notifications themselves are
// exercised on real devices against the deployed site.

const RULES = JSON.parse(readFixture('../database.rules.json')).rules;
const KEY_RE = /^[a-z0-9-]{1,48}$/;

// ── pushBlockKey ──────────────────────────────────────────────────

test('pushBlockKey: the cases the spec names', () => {
  assert.equal(pushBlockKey('Snack and campfire — TJ'), 'snack-and-campfire');
  assert.equal(pushBlockKey("Rising bell, shower & morning meeting (Laura's cottage) — 🦃 Turkey, 🍁 Maples & 🚜 John Deeres"),
    'rising-bell-shower-morning-meeting');
  assert.equal(pushBlockKey('Team assignments (Chapel Lawn)'), 'team-assignments');
  assert.equal(pushBlockKey('“Hot Seat” & “Let’s Make a Deal!”'), 'hot-seat-let-s-make-a-deal');
  assert.equal(pushBlockKey('Supper'), 'supper');
  assert.equal(pushBlockKey('Prepare for competitions / team huddle'), 'prepare-for-competitions-team-huddle');
});

test('pushBlockKey: cuts at whichever decoration comes first, and never returns junk', () => {
  assert.equal(pushBlockKey('A (b) — c'), 'a', 'the parenthesis comes first here');
  assert.equal(pushBlockKey('A — b (c)'), 'a', 'the dash comes first here');
  assert.equal(pushBlockKey(''), 'block');
  assert.equal(pushBlockKey('🔥🔥🔥'), 'block', 'nothing alphanumeric left ⇒ the fallback');
  assert.equal(pushBlockKey(null), 'block');
  const long = pushBlockKey('x'.repeat(200));
  assert.ok(long.length <= 48 && KEY_RE.test(long), 'capped at the rules length');
});

// ── pushScheduleBlocks / pushBlockCatalog ─────────────────────────

test('pushScheduleBlocks: every timed block, none of the untimed ones', () => {
  const blocks = pushScheduleBlocks(DAY_SCHEDULE);
  let timed = 0;
  Object.keys(DAY_SCHEDULE).forEach((dow) => {
    DAY_SCHEDULE[dow].forEach((b) => { if (!b.noTime) timed++; });
  });
  assert.equal(Object.keys(blocks).length, timed, 'one entry per timed block');
  Object.keys(blocks).forEach((id) => {
    const b = blocks[id];
    assert.ok(/^[a-z0-9-]{1,40}$/.test(id), `block id ${id} is a legal, rules-valid key`);
    assert.ok(Number.isInteger(b.dow) && b.dow >= 0 && b.dow <= 6, `${id}: dow`);
    assert.ok(Number.isInteger(b.start) && b.start >= 0 && b.start <= 1439, `${id}: start`);
    assert.ok(KEY_RE.test(b.key), `${id}: key ${b.key} matches the rules`);
    assert.ok(b.label && b.label.length <= 120, `${id}: label`);
    assert.ok(b.emoji && b.emoji.length <= 16, `${id}: emoji`);
    assert.equal(id, `d${b.dow}-${b.start}-${id.split('-')[2]}`, 'id is d<dow>-<start>-<index>');
  });
  assert.notOk(Object.values(blocks).some((b) => b.label === 'Lights out' && b.dow === 1),
    "Monday's untimed lights-out is left out (nothing to remind anyone about)");
});

test('pushScheduleBlocks is deterministic — the republish check compares it', () => {
  assert.equal(pushStableJson(pushScheduleBlocks(DAY_SCHEDULE)), pushStableJson(pushScheduleBlocks(DAY_SCHEDULE)));
  assert.deepEqual(pushScheduleBlocks(null), {});
  assert.deepEqual(pushScheduleBlocks({ 1: [{ start: 2000, label: 'x' }, { start: 60, label: 'y', noTime: true }] }), {},
    'out-of-range and untimed blocks never reach the database');
});

test('the catalog merges each block\'s variants into one row', () => {
  const cat = pushBlockCatalog(DAY_SCHEDULE);
  const keys = cat.map((b) => b.key);
  assert.equal(new Set(keys).size, keys.length, 'one row per key');
  const snack = cat.filter((b) => b.key === 'snack-and-campfire');
  assert.equal(snack.length, 1, 'every "Snack and campfire — <leader>" is one subscription');
  assert.equal(snack[0].label, 'Snack and campfire', 'labeled by the head label');
  assert.equal(snack[0].when, 'Sun–Thu 8:00 PM · Fri 9:00 PM');
  const morning = cat.filter((b) => b.key === 'rising-bell-shower-morning-meeting');
  assert.equal(morning.length, 1, 'both team-group morning meetings are one subscription');
  assert.equal(morning[0].when, 'Mon–Sat 7:30 AM');
  const supper = cat.find((b) => b.key === 'supper');
  assert.equal(supper.when, 'Sun–Fri 5:00 PM');
  assert.equal(supper.emoji, '🍽️');
  assert.equal(cat[0].key, 'registration', 'ordered by first appearance, Sunday first');
  cat.forEach((b) => assert.ok(KEY_RE.test(b.key) && b.label && b.when, `${b.key} is complete`));
});

test('pushWhenText / pushDayRange read like a printed schedule', () => {
  assert.equal(pushDayRange([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(pushDayRange([0, 6]), 'Sun, Sat');
  assert.equal(pushDayRange([0, 1, 2, 3, 4, 5, 6]), 'Daily');
  assert.equal(pushDayRange([1, 2, 4]), 'Mon, Tue, Thu');
  assert.equal(pushClock(0), '12:00 AM');
  assert.equal(pushClock(12 * 60), '12:00 PM');
  assert.equal(pushClock(17 * 60 + 5), '5:05 PM');
  assert.equal(pushWhenText([{ dow: 2, start: 600 }, { dow: 1, start: 600 }]), 'Mon, Tue 10:00 AM');
});

// ── Prefs ─────────────────────────────────────────────────────────

const DEFAULT_PREFS = {
  ch: { announcements: true, general: false, memes: false, photos: false },
  mention: true, director: true, blocksAll: false, blocks: {}, lead: 10,
};

test('normalizePushPrefs: missing anything means the documented default', () => {
  [null, undefined, 'junk', 42, [], {}].forEach((raw) => {
    assert.deepEqual(normalizePushPrefs(raw), DEFAULT_PREFS, `defaults for ${JSON.stringify(raw)}`);
  });
});

test('normalizePushPrefs heals every shape RTDB pruning or a bad write can leave', () => {
  const p = normalizePushPrefs({
    ch: { general: true, memes: 'yes', bogus: true },
    mention: false,
    director: 'no',
    blocksAll: 1,
    blocks: { supper: true, 'Bad Key': true, lunch: 'true', breakfast: false },
    lead: 7,
  });
  assert.deepEqual(p.ch, { announcements: true, general: true, memes: false, photos: false },
    'booleans kept, junk → default, unknown channels dropped');
  assert.equal(p.mention, false);
  assert.equal(p.director, true, 'a non-boolean is the default, not truthy');
  assert.equal(p.blocksAll, false);
  assert.deepEqual(p.blocks, { supper: true }, 'only rules-valid keys set to exactly true survive');
  assert.equal(p.lead, 10, 'a lead outside 5/10/15 falls back to 10');
  assert.equal(normalizePushPrefs({ lead: 15 }).lead, 15);
  assert.equal(normalizePushPrefs({ ch: { announcements: false } }).ch.announcements, false,
    'announcements can be muted');
  assert.deepEqual(normalizePushPrefs({ ch: null, blocks: [] }), DEFAULT_PREFS);
});

test('the channel prefs ARE the chat bells — one source of truth on the device', () => {
  freshState();
  setChatSub('memes', true);
  setChatSub('announcements', false);
  const p = pushCurrentPrefs();
  assert.equal(p.ch.memes, true);
  assert.equal(p.ch.announcements, false);
  assert.equal(p.ch.general, false);
  setChatSub('memes', false);
  setChatSub('announcements', true);
  assert.deepEqual(pushCurrentPrefs().ch, DEFAULT_PREFS.ch);
  setChatSub('not-a-channel', true);
  assert.notOk('not-a-channel' in readChatSubs(), 'unknown channels are never stored');
});

test('drawer prefs persist per camp and merge with the chat bells', () => {
  pushStorePrefs({ mention: false, lead: 5, blocks: { supper: true }, ch: { memes: true } });
  const p = pushCurrentPrefs();
  assert.equal(p.mention, false);
  assert.equal(p.lead, 5);
  assert.deepEqual(p.blocks, { supper: true });
  assert.equal(p.ch.memes, false, 'a stray ch in the stored prefs never overrides the bells');
  assert.ok(localStorage.getItem('campScoreboardPushPrefs'), 'junior key is the bare base name');
  localStorage.removeItem('campScoreboardPushPrefs');
});

// ── The device record vs the security rules ──────────────────────
// A JS re-implementation of what database.rules.json's validate rules demand
// of push/<key>/<deviceId>, with the regexes READ FROM the rules file — so a
// rules edit that the client doesn't follow fails here, not on a phone.

function rulesRegex(expr, before) {
  const i = expr.indexOf(before);
  assert.ok(i > -1, `rules expression contains ${before}`);
  const m = /matches\(\/(.+?)\/\)/.exec(expr.slice(i));
  return new RegExp(m[1]);
}

function validatePushRecord(deviceId, rec) {
  const dev = RULES.campScoreboard.push.$memberKey.$deviceId;
  const problems = [];
  const need = (cond, what) => { if (!cond) problems.push(what); };
  need(rulesRegex(dev['.validate'], '$deviceId').test(deviceId), 'deviceId');
  const required = JSON.parse(/hasChildren\((\[.*?\])\)/.exec(dev['.validate'])[1].replace(/'/g, '"'));
  required.forEach((k) => need(rec[k] !== undefined && rec[k] !== null, `has ${k}`));
  Object.keys(rec).forEach((k) => need(k in dev && k !== '$other', `no unknown field ${k}`));
  need(typeof rec.endpoint === 'string' && rec.endpoint.startsWith('https://') && rec.endpoint.length <= 1024, 'endpoint');
  need(typeof rec.p256dh === 'string' && rulesRegex(dev.p256dh['.validate'], 'matches').test(rec.p256dh), 'p256dh');
  need(typeof rec.auth === 'string' && rulesRegex(dev.auth['.validate'], 'matches').test(rec.auth), 'auth');
  need(typeof rec.at === 'number' || (rec.at && rec.at['.sv'] === 'timestamp'), 'at');
  if ('label' in rec) need(typeof rec.label === 'string' && rec.label.length <= 40, 'label');
  if ('team' in rec) need(typeof rec.team === 'string' && rulesRegex(dev.team['.validate'], 'matches').test(rec.team), 'team');
  const prefs = rec.prefs || {};
  const pr = dev.prefs;
  JSON.parse(/hasChildren\((\[.*?\])\)/.exec(pr['.validate'])[1].replace(/'/g, '"'))
    .forEach((k) => need(prefs[k] !== undefined, `prefs.${k}`));
  Object.keys(prefs).forEach((k) => need(k in pr && k !== '$other', `no unknown prefs.${k}`));
  Object.keys(prefs.ch || {}).forEach((k) => need(k in pr.ch && k !== '$other' && typeof prefs.ch[k] === 'boolean', `prefs.ch.${k}`));
  ['mention', 'director', 'blocksAll'].forEach((k) => need(typeof prefs[k] === 'boolean', `prefs.${k} boolean`));
  need([5, 10, 15].includes(prefs.lead), 'prefs.lead');
  const blockKey = rulesRegex(pr.blocks.$key['.validate'], '$key');
  Object.keys(prefs.blocks || {}).forEach((k) => need(blockKey.test(k) && prefs.blocks[k] === true, `prefs.blocks.${k}`));
  return problems;
}

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123:APA91b-example',
  p256dh: 'B' + 'x'.repeat(86), // 87 chars, the size of a 65-byte point
  auth: 'a'.repeat(22),         // 16 bytes
};

test('pushDeviceRecord produces exactly what the rules accept', () => {
  const rec = pushDeviceRecord(SUB, { blocks: { supper: true }, lead: 15 }, 't2', 'iPhone');
  assert.deepEqual(validatePushRecord('dev_ABC-123xyz', rec), []);
  assert.equal(rec.team, 't2');
  assert.equal(rec.label, 'iPhone');
  assert.deepEqual(rec.prefs.blocks, { supper: true });
  assert.equal(rec.prefs.lead, 15);
});

test('pushDeviceRecord drops what the rules would refuse instead of writing it', () => {
  const rec = pushDeviceRecord(SUB, { blocks: { 'NOT OK': true }, lead: 'eleven', ch: 'junk' }, 'team-2', 'x'.repeat(70));
  assert.deepEqual(validatePushRecord('abcdefgh', rec), []);
  assert.notOk('team' in rec, 'an invalid team is left out, not written');
  assert.equal(rec.label.length, 40, 'a long label is clipped');
  assert.notOk('blocks' in rec.prefs, 'an empty block map is omitted (RTDB would prune it anyway)');
  const bare = pushDeviceRecord(SUB, null, null, '');
  assert.notOk('label' in bare, 'an empty label is omitted');
  assert.deepEqual(validatePushRecord('abcdefgh', bare), []);
  assert.ok(validatePushRecord('short', bare).includes('deviceId'), 'the validator itself has teeth');
});

test('a minted device id satisfies the rules and is reused', () => {
  localStorage.removeItem('campScoreboardPushDevice');
  assert.equal(pushDeviceId(false), null, "reading never invents an id");
  const id = pushDeviceId();
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(id), `id ${id} is rules-valid`);
  assert.equal(pushDeviceId(), id, 'one id per browser');
  assert.equal(localStorage.getItem('campScoreboardPushDevice'), id, 'not per-camp: the bare key');
});

test('pushRecordMatches ignores the timestamp and key order, nothing else', () => {
  const a = pushDeviceRecord(SUB, { lead: 5 }, 't1', 'iPhone');
  const b = JSON.parse(JSON.stringify(a));
  b.at = 12345;
  assert.ok(pushRecordMatches(b, a));
  assert.notOk(pushRecordMatches(null, a), 'a missing record needs writing');
  assert.notOk(pushRecordMatches(Object.assign({}, b, { endpoint: 'https://other' }), a), 'a rotated endpoint needs writing');
  assert.notOk(pushRecordMatches(Object.assign({}, b, { team: 't3' }), a), 'a changed team needs writing');
  const c = JSON.parse(JSON.stringify(b));
  c.prefs.lead = 15;
  assert.notOk(pushRecordMatches(c, a), 'changed prefs need writing');
});

test('the client contract matches the rules', () => {
  assert.equal(String(PUSH_BLOCK_KEY_RE), String(rulesRegex(RULES.campScoreboard.push.$memberKey.$deviceId.prefs.blocks.$key['.validate'], '$key')),
    'block-key format');
  assert.deepEqual(pushChannelIds(), chatChannels().map((c) => c.id));
});

// ── Mentions → who to buzz ───────────────────────────────────────

test('pushMentionTargets: a named member, a team, never myself, no duplicates', () => {
  freshState();
  memberDirectory = {
    'jovi@x,com': { role: 'viewer', name: 'Jovi Smith', teamId: 't2' },
    'pat@x,com': { role: 'editor', name: 'Patrick' },
  };
  memberDirectoryLoaded = true;
  authUser = { email: 'pat@x.com' };
  const t = pushMentionTargets('Jovi and jovi — Turkey Dinner to the lawn, Patrick too');
  assert.deepEqual(t.keys, ['jovi@x,com'], 'Jovi once; my own name never buzzes me');
  assert.deepEqual(t.teams, ['t1'], 'Turkey Dinner is t1');
  assert.deepEqual(pushMentionTargets(''), { keys: [], teams: [] });
  assert.deepEqual(pushMentionTargets('nobody here'), { keys: [], teams: [] });
});

test('pushMentionTargets: a shared first name reaches everyone who has it', () => {
  // The bubble highlights "Sam" for BOTH Sams (mentionIsMine matches by
  // label on each device); the phones must agree.
  freshState();
  memberDirectory = {
    'a@x,com': { role: 'viewer', name: 'Sam Lee' },
    'b@x,com': { role: 'viewer', name: 'Sam Cho' },
  };
  memberDirectoryLoaded = true;
  authUser = { email: 'someone@else.com' };
  assert.deepEqual(pushMentionTargets('Sam to the office please').keys.sort(), ['a@x,com', 'b@x,com']);
});

test('pushMentionTargets: a keyless roster name resolves through the directory', () => {
  freshState();
  memberDirectory = { 'cam@x,com': { role: 'viewer', name: 'Cam' } };
  authUser = null;
  const real = chatMentionTargets;
  chatMentionTargets = () => [{ label: 'Cam', lower: 'cam', kind: 'person' }]; // as if from the printed list
  try {
    assert.deepEqual(pushMentionTargets('cam, grab the cones').keys, ['cam@x,com']);
    memberDirectory = {};
    assert.deepEqual(pushMentionTargets('cam, grab the cones').keys, [], 'nobody by that name ⇒ nobody to buzz');
  } finally {
    chatMentionTargets = real;
    memberDirectory = null;
    memberDirectoryLoaded = false;
  }
});

// ── Camp week ─────────────────────────────────────────────────────

test('isValidWeekStart: a real date that is a Sunday', () => {
  assert.ok(isValidWeekStart('2027-07-18'), 'Sunday');
  assert.ok(isValidWeekStart('2026-07-19'), 'Sunday');
  assert.notOk(isValidWeekStart('2027-07-19'), 'Monday');
  assert.notOk(isValidWeekStart('2027-02-30'), 'no such date');
  assert.notOk(isValidWeekStart('2027-7-18'), 'not zero-padded');
  assert.notOk(isValidWeekStart('1999-07-18'), 'the rules only accept 20xx');
  [null, undefined, '', 'soon', 20270718].forEach((v) => assert.notOk(isValidWeekStart(v), `${v}`));
});

test('pushWeekLabel reads naturally across a month boundary', () => {
  assert.equal(pushWeekLabel('2027-07-18'), 'Jul 18–24');
  assert.equal(pushWeekLabel('2027-07-25'), 'Jul 25–31');
  assert.equal(pushWeekLabel('2028-07-30'), 'Jul 30 – Aug 5');
  assert.equal(pushWeekLabel('2027-07-19'), '', 'not a Sunday ⇒ nothing');
});

// ── Environment → status card ────────────────────────────────────

const IPHONE_16_4 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const IPHONE_15 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const READY = { hasSW: true, hasPush: true, permission: 'default', standalone: false, maxTouchPoints: 0 };

test('pushEnvironment: iPhone needs the Home Screen app, and iOS 16.4+', () => {
  const env = (o) => pushEnvironment(Object.assign({}, READY, o));
  assert.equal(env({ ua: IPHONE_16_4, hasPush: false, maxTouchPoints: 5 }), 'ios-needs-install',
    'Safari in a tab — no PushManager there, so it must not read as "unsupported"');
  assert.equal(env({ ua: IPHONE_16_4, standalone: true, maxTouchPoints: 5 }), 'ready');
  assert.equal(env({ ua: IPHONE_15, standalone: true, maxTouchPoints: 5 }), 'ios-too-old');
  assert.equal(env({ ua: IPAD_AS_MAC, maxTouchPoints: 5, standalone: true }), 'ios-too-old',
    'an iPad in desktop mode is read by its Safari version, not "OS X 10_15"');
  assert.equal(env({ ua: IPAD_AS_MAC, maxTouchPoints: 0 }), 'ready', 'a real Mac is not iOS');
  assert.equal(env({ ua: IPHONE_16_4, standalone: true, maxTouchPoints: 5, permission: 'denied' }), 'denied');
});

test('pushEnvironment: everything else is feature-detected', () => {
  const env = (o) => pushEnvironment(Object.assign({}, READY, o));
  assert.equal(env({ ua: ANDROID }), 'ready', 'Android Chrome works from the browser');
  assert.equal(env({ ua: ANDROID, permission: 'denied' }), 'denied');
  assert.equal(env({ ua: ANDROID, hasPush: false }), 'unsupported');
  assert.equal(env({ ua: ANDROID, hasSW: false }), 'unsupported');
  assert.equal(env({ ua: ANDROID, permission: null }), 'unsupported', 'no Notification API at all');
  assert.equal(pushEnvironment(), 'unsupported', 'and the test harness itself has none of it');
});

test('pushDeviceLabel names the common devices', () => {
  assert.equal(pushDeviceLabel(IPHONE_16_4, 5), 'iPhone');
  assert.equal(pushDeviceLabel(IPAD_AS_MAC, 5), 'iPad');
  assert.equal(pushDeviceLabel(IPAD_AS_MAC, 0), 'Mac');
  assert.equal(pushDeviceLabel(ANDROID, 0), 'Android phone');
  assert.equal(pushDeviceLabel('', 0), 'This device');
});

// ── Dormant, sign-out, and the hooks ─────────────────────────────

test('with no sender configured, the feature is fully dormant', async () => {
  assert.equal(PUSH_SERVICE_URL, '', 'ships blank until the Worker exists — never an invented URL');
  assert.notOk(pushConfigured());
  assert.equal(pushStatus(), 'dormant');
  assert.equal(await pushNotifyChat('general', 'm1', 'hi Jovi'), null, 'a chat send asks nothing of anyone');
  assert.doesNotThrow(() => pushPrefsChanged());
  assert.ok(pushSwUrl().startsWith('sw.js?v=') && !pushSwUrl().includes('push='), 'no sender ⇒ no push= in the worker URL');
  assert.doesNotThrow(() => renderPushDrawer(), 'the drawer renders its dormant card without a DOM to speak of');
});

test('pushSignOut never rejects and clears the on-flag for both camps', async () => {
  localStorage.setItem('campScoreboardPushOn', '1');
  localStorage.setItem('campScoreboardPushOn:senior', '1');
  localStorage.setItem('campScoreboardPushDevice', 'keepThisDeviceId');
  await pushSignOut();
  assert.equal(localStorage.getItem('campScoreboardPushOn'), null);
  assert.equal(localStorage.getItem('campScoreboardPushOn:senior'), null);
  assert.equal(localStorage.getItem('campScoreboardPushDevice'), 'keepThisDeviceId',
    "the device id isn't camp data — it survives sign-out");
});

test('clearLocalData takes the push flags and prefs, not the device id', () => {
  localStorage.setItem('campScoreboardPushOn', '1');
  localStorage.setItem('campScoreboardPushPrefs:senior', '{}');
  localStorage.setItem('campScoreboardPushDevice', 'keepThisDeviceId');
  clearLocalData();
  assert.equal(localStorage.getItem('campScoreboardPushOn'), null);
  assert.equal(localStorage.getItem('campScoreboardPushPrefs:senior'), null);
  assert.equal(localStorage.getItem('campScoreboardPushDevice'), 'keepThisDeviceId');
});

test('a notification tap only ever opens a known kind of target', () => {
  freshState();
  ['javascript:alert(1)', 'chat:../../x', 'chat:', '', null, 'settings'].forEach((t) => {
    assert.doesNotThrow(() => pushHandleOpen(t, ''), `${t} is ignored quietly`);
  });
  assert.notOk(state.ui.chatOpen, 'nothing opened');
  const before = __reloads || 0;
  pushHandleOpen('chat:general', 'senior');
  assert.equal(__reloads || 0, before, "another camp this account isn't known to be on never switches");
  assert.notOk(state.ui.chatOpen, "and the other camp's channel never opens here");
});

test('pushStableJson: same data, same string, whatever the key order', () => {
  assert.equal(pushStableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }),
    pushStableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.ok(pushStableJson({ a: 1 }) !== pushStableJson({ a: 2 }));
});

test('base64url round-trips, and a VAPID key must be a real P-256 point', () => {
  const bytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) bytes[i] = (i * 37 + 4) & 255;
  bytes[0] = 4;
  const key = pushB64url(bytes.buffer);
  assert.equal(key.length, 87, '65 bytes ⇒ 87 unpadded chars');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(key), 'url-safe alphabet, no padding');
  assert.deepEqual(Array.from(pushB64urlToBytes(key)), Array.from(bytes));
  assert.ok(pushValidVapidKey(key));
  [1, 2, 3, 16, 17].forEach((n) => {
    const b = new Uint8Array(n).map((_, i) => 255 - i * 7);
    assert.deepEqual(Array.from(pushB64urlToBytes(pushB64url(b.buffer))), Array.from(b), `${n} bytes round-trip`);
  });
  assert.equal(pushB64url(new Uint8Array([251, 255]).buffer), '-_8', 'the url-safe characters, not + and /');
  const notAPoint = new Uint8Array(65);
  assert.notOk(pushValidVapidKey(pushB64url(notAPoint.buffer)), 'must start 0x04 (uncompressed)');
  assert.notOk(pushValidVapidKey(key.slice(0, 60)), 'wrong length');
  assert.notOk(pushValidVapidKey(key.slice(0, 86) + '!'), 'bad character');
  assert.notOk(pushValidVapidKey(null));
  assert.throws(() => pushB64urlToBytes('a'), 'a single trailing character is never valid');
});

test('pushAudienceLabel names every audience the composer offers', () => {
  freshState();
  assert.equal(pushAudienceLabel('all'), 'Everyone');
  assert.equal(pushAudienceLabel('editors'), 'Directors only');
  assert.ok(pushAudienceLabel('t1').includes(state.teams.find((t) => t.id === 't1').name));
  assert.equal(pushAudienceLabel('t9'), 'One team', 'a team that no longer exists still reads sensibly');
});

// ── sw.js: payload → notification ────────────────────────────────
// Loaded the way a service worker runs it: no window, no document — just a
// stub `self` that records which events the file listens for.

function loadServiceWorker() {
  const listeners = {};
  const stubSelf = {
    location: { href: 'https://camp.example/sw.js?v=2&push=https%3A%2F%2Fcamp-alerts.example.workers.dev' },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
    registration: {},
  };
  const exports = new Function('self', readFixture('../sw.js') +
    '\nreturn { campNotificationFromPayload, campPushServiceUrl };')(stubSelf);
  return { exports, listeners };
}

test('sw.js never gets a fetch handler', () => {
  const { listeners } = loadServiceWorker();
  assert.notOk('fetch' in listeners, 'a fetch handler could pin stale code mid-camp — see the sw.js header');
  ['install', 'activate', 'push', 'notificationclick', 'pushsubscriptionchange'].forEach((t) => {
    assert.ok(listeners[t] && listeners[t].length === 1, `listens for ${t} exactly once`);
  });
});

test('campNotificationFromPayload: a well-formed chat payload', () => {
  const { campNotificationFromPayload } = loadServiceWorker().exports;
  const n = campNotificationFromPayload({
    v: 1, camp: 'junior', kind: 'announcement', title: '📣 Announcements', body: 'Patrick: Pizza tonight!',
    tag: 'chat--Nx1abc', ts: 1784000000000, open: 'chat:announcements', urgent: false,
  }, 1);
  assert.equal(n.title, '📣 Announcements');
  assert.equal(n.options.body, 'Patrick: Pizza tonight!');
  assert.equal(n.options.tag, 'chat--Nx1abc', 'the same tag the page uses — so the two collapse');
  assert.equal(n.options.renotify, false);
  assert.equal(n.options.requireInteraction, false);
  assert.equal(n.options.timestamp, 1784000000000);
  assert.deepEqual(n.options.data, { open: 'chat:announcements', camp: 'junior', kind: 'announcement' });
  assert.equal(n.payload.kind, 'announcement');
});

test('campNotificationFromPayload: urgent rings louder and stays up', () => {
  const { campNotificationFromPayload } = loadServiceWorker().exports;
  const n = campNotificationFromPayload({ kind: 'urgent', urgent: true, title: '🚨 URGENT — Patrick', body: 'Storm — everyone inside', tag: 'alert-x1' }, 5);
  assert.equal(n.options.requireInteraction, true);
  assert.equal(n.options.renotify, true);
  assert.deepEqual(n.options.vibrate, [400, 150, 400, 150, 400]);
  assert.equal(n.options.timestamp, 5, 'no ts in the payload ⇒ the time it arrived');
  const alert = campNotificationFromPayload({ kind: 'alert', title: '📢 Patrick', body: 'Supper moved', tag: 'alert-x2' }, 5);
  assert.equal(alert.options.renotify, true, 'a director alert buzzes even when it replaces one');
  assert.equal(alert.options.requireInteraction, false);
});

test('campNotificationFromPayload: missing or garbage still shows SOMETHING', () => {
  // iOS revokes push permission from a site whose pushes show nothing.
  const { campNotificationFromPayload } = loadServiceWorker().exports;
  [null, undefined, 'x', 42, [], {}, { title: 7 }, { title: '   ' }].forEach((raw) => {
    const n = campNotificationFromPayload(raw, 1);
    assert.equal(n.title, 'Camp', `fallback title for ${JSON.stringify(raw)}`);
    assert.ok(n.options.body.length > 0, 'and a body');
    assert.ok(n.options.tag, 'and a tag');
  });
  const junk = campNotificationFromPayload({
    title: 'x'.repeat(500), body: 'y'.repeat(900), tag: 'bad tag with spaces', open: 'javascript:alert(1)',
    camp: 'other', kind: 'nope', ts: 'later',
  }, 9);
  assert.equal(junk.title.length, 80, 'title capped');
  assert.equal(junk.options.body.length, 300, 'body capped');
  assert.equal(junk.options.tag, 'camp-push', 'an unsafe tag is replaced');
  assert.deepEqual(junk.options.data, { open: '', camp: '', kind: '' }, 'unknown targets/camps/kinds are dropped');
  assert.equal(junk.options.timestamp, 9);
});

test('sw.js reads the sender URL from its own registration URL, https only', () => {
  const { campPushServiceUrl } = loadServiceWorker().exports;
  assert.equal(campPushServiceUrl(), '', 'the test harness has no URL API — it fails closed');
});
