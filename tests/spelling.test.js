// The counselor spelling merge (setup-rebuild-spec S0k, decision Q21). The
// printed sheets spelled three counselors two ways; the owner merged them to
// ONE spelling each: Alysa -> Alyssa, Sofie -> Sofia, Lilly -> Lily. The camp
// data (camps.js, tests/fixtures-junior-week.json) changed once, on purpose,
// before anything derives an id from a name. Data already out there — a member
// row typed "Alysa", a phone whose stored identity is "Lilly" — still has to
// match, through ONE function: canonicalCounselorName.

const OLD_SPELLINGS = /\b(Alysa|Sofie|Lilly)\b/;

test('canonicalCounselorName maps the three old spellings, case- and space-insensitively', () => {
  assert.equal(canonicalCounselorName('Alysa'), 'Alyssa');
  assert.equal(canonicalCounselorName('Sofie'), 'Sofia');
  assert.equal(canonicalCounselorName('Lilly'), 'Lily');
  assert.equal(canonicalCounselorName('  alysa '), 'Alyssa');
  assert.equal(canonicalCounselorName('LILLY'), 'Lily');
  assert.deepEqual(COUNSELOR_NAME_ALIASES, { alysa: 'Alyssa', sofie: 'Sofia', lilly: 'Lily' });
});

test('canonicalCounselorName leaves every other value exactly as it was', () => {
  ['Alyssa', 'Sofia', 'Lily', 'Cam', 'TJ', 'Sofi', 'Lilian', 'Sarah Kim', '', '  '].forEach((n) =>
    assert.equal(canonicalCounselorName(n), n));
  assert.equal(canonicalCounselorName(null), null);
  assert.equal(canonicalCounselorName(undefined), undefined);
  assert.equal(canonicalCounselorName(5), 5);
});

test('the old spellings exist ONLY in the alias table', () => {
  const src = readFixture('../camps.js');
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.includes("Three counselors' names were spelled two ways"));
  const end = lines.findIndex((l) => l.startsWith('function canonicalCounselorName'));
  assert.ok(start > -1 && end > start, 'found the alias block');
  lines.forEach((l, i) => {
    if (i >= start && i <= end + 5) return; // the table, its comment, and the function
    assert.notOk(OLD_SPELLINGS.test(l), `camps.js line ${i + 1} still uses an old spelling: ${l.trim().slice(0, 80)}`);
  });
  // Nothing else that ships carries them either — except in a comment that
  // explains the merge.
  const code = (f) => readFixture(f).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  ['../app.js', '../settings.js', '../chat.js', '../push.js', '../defaults.js'].forEach((f) =>
    assert.notOk(OLD_SPELLINGS.test(code(f)), f + ' uses an old spelling in code'));
  assert.notOk(OLD_SPELLINGS.test(readFixture('../index.html')), 'index.html');
});

test('the junior week fixture was regenerated for the merge and holds only the new spellings', () => {
  const fix = readFixture('fixtures-junior-week.json');
  assert.notOk(OLD_SPELLINGS.test(fix), 'no old spelling left in the fixture');
  ['Alyssa', 'Sofia', 'Lily'].forEach((n) => assert.ok(fix.includes('"' + n + '"'), n + ' is in the fixture'));
});

test('the data uses one spelling everywhere: electives, team lists, seed roster, morning labels, Wednesday', () => {
  assert.ok(TEAM_COUNSELORS.t0.includes('Alyssa'));
  assert.ok(TEAM_COUNSELORS.t3.includes('Sofia'));
  assert.ok(TEAM_COUNSELORS.t5.includes('Lily'));
  const seed = {};
  SEED_COUNSELORS.forEach(([tid, names]) => { seed[tid] = names; });
  assert.deepEqual(seed.t0, TEAM_COUNSELORS.t0);
  assert.deepEqual(seed.t3, TEAM_COUNSELORS.t3);
  assert.deepEqual(seed.t5, TEAM_COUNSELORS.t5);
  assert.deepEqual(DEFAULT_COUNSELORS, ['Alyssa/Cam/Sam (B)', 'Bria/Lydia/Zac (A)', 'Jovi/Brody/Josh (A)', 'Sofia/William (B)', 'Abby/TJ/Ella (B)', 'Lily/Jacob (A)']);
  // Every team counselor appears on the electives sheet under the SAME
  // spelling, which is what the "You" chip's lookup depends on.
  const onSheet = new Set();
  Object.keys(ELECTIVES).forEach((dow) => ELECTIVES[dow].forEach((slot) => slot.forEach(([, kids]) => kids.forEach((k) => onSheet.add(k)))));
  Object.keys(TEAM_COUNSELORS).forEach((tid) => TEAM_COUNSELORS[tid].forEach((n) =>
    assert.ok(onSheet.has(n), n + ' is on the electives sheet under that spelling')));
  assert.notOk(['Alysa', 'Sofie', 'Lilly'].some((n) => onSheet.has(n)));
  // Wednesday evening carries Sofia, and no schedule label keeps an old spelling.
  const wed = DAY_SCHEDULE[3].map((b) => b.label);
  assert.ok(wed.includes('Snack and campfire — Sofia'), wed.join(' | '));
  const labels = [].concat(...Object.values(DAY_SCHEDULE)).map((b) => b.label);
  assert.notOk(labels.some((l) => OLD_SPELLINGS.test(l)));
});

test('alert block keys do not move: they are cut before any name in a label', () => {
  // pushHeadLabel stops at " — " and " (", so no counselor name ever reaches a
  // block key. Recorded here so the rename is visibly a no-op for phone alerts
  // (dormant today, but a subscribed block must keep its key): the renamed
  // Wednesday label, old and new, and the one counselor-name-bearing default.
  assert.equal(pushBlockKey('Snack and campfire — Sofie'), 'snack-and-campfire', 'the old label');
  assert.equal(pushBlockKey('Snack and campfire — Sofia'), 'snack-and-campfire', 'the new label');
  DEFAULT_COUNSELORS.forEach((c) => assert.equal(pushBlockKey('Morning meeting — ' + c), 'morning-meeting'));
  const wed = pushScheduleBlocks(DAY_SCHEDULE);
  const snack = Object.values(wed).find((b) => b.dow === 3 && /campfire/.test(b.label));
  assert.equal(snack.label, 'Snack and campfire — Sofia');
  assert.equal(snack.key, 'snack-and-campfire');
  const keys = Object.values(wed).map((b) => b.key);
  assert.notOk(keys.some((k) => /alys|sofi|lill|lily/.test(k)), 'no block key carries a counselor name');
});

// ── Data already out there keeps matching ─────────────────────────

test('a member row typed with an old spelling still counts as on the seed list', () => {
  const all = missingSeedCounselors({});
  const members = {
    'a@x,com': { role: 'viewer', name: 'Alysa' },       // seed has Alyssa
    'pending-lilly-ab12': { role: 'viewer', name: 'Lilly' }, // seed has Lily
    's@x,com': { role: 'viewer', name: 'sofie' },       // seed has Sofia, any case
  };
  const left = missingSeedCounselors(members);
  assert.equal(left.length, all.length - 3);
  ['Alyssa', 'Lily', 'Sofia'].forEach((n) => assert.notOk(left.some((c) => c.name === n), n + ' is not offered again'));
});

test('an account row typed "Alysa" adopts the merged spelling the electives data knows', () => {
  state.followTeam = undefined;
  state.identity = undefined;
  memberName = 'Alysa';
  setMemberTeam('t0');
  assert.ok(adoptMemberTeam());
  assert.equal(state.identity, 'Alyssa', 'identity is the spelling TEAM_COUNSELORS and ELECTIVES use');
  memberName = 'Lilly';
  setMemberTeam('t5');
  state.identity = undefined;
  adoptMemberTeam();
  assert.equal(state.identity, 'Lily');
  memberName = null;
  setMemberTeam(null);
});

test('a stored identity with an old spelling is moved onto the new one when state is normalized', () => {
  freshState();
  ['Alysa', 'Sofie', 'Lilly'].forEach((old) => {
    state.identity = old;
    normalizeSyncedState();
    assert.equal(state.identity, canonicalCounselorName(old));
    assert.ok(OLD_SPELLINGS.test(state.identity) === false);
  });
  state.identity = 'Cam'; normalizeSyncedState(); assert.equal(state.identity, 'Cam');
  state.identity = null; normalizeSyncedState(); assert.equal(state.identity, null, 'skipped stays skipped');
  state.identity = undefined; normalizeSyncedState(); assert.equal(state.identity, undefined, 'never asked stays never asked');
});

// The (dow, slot) where `name` stands at a station on the electives sheet.
function stationOf(name) {
  for (const dow of Object.keys(ELECTIVES)) {
    for (let slot = 0; slot < ELECTIVES[dow].length; slot += 1) {
      const hit = ELECTIVES[dow][slot].find(([, kids]) => kids.includes(name));
      if (hit) return { dow: Number(dow), slot, station: hit[0] };
    }
  }
  return null;
}

test('the "You" chip finds the same elective station for the old and the new spelling', () => {
  freshState();
  [['Alysa', 'Alyssa'], ['Lilly', 'Lily'], ['Sofie', 'Sofia']].forEach(([old, merged]) => {
    const at = stationOf(merged);
    assert.ok(at, merged + ' stands at a station somewhere on the sheet');
    state.identity = merged;
    const fresh = myStationFor(at.dow, at.slot);
    assert.equal(fresh.station, at.station);
    state.identity = old; // a device whose identity was never rewritten
    assert.deepEqual(myStationFor(at.dow, at.slot), fresh, old + ' resolves exactly like ' + merged);
  });
  state.identity = undefined;
});

test('a chat message naming Alyssa reaches a member whose row still says Alysa', () => {
  memberName = 'Alysa';
  state.identity = null;
  memberDirectory = null;
  assert.ok(mentionIsMine([{ kind: 'person', label: 'Alyssa', key: null }]));
  assert.ok(mentionIsMine([{ kind: 'person', label: 'Alysa', key: null }]), 'and the spelling they were typed with');
  assert.notOk(mentionIsMine([{ kind: 'person', label: 'Cam', key: null }]));
  memberName = null;
});

test('the printed counselor list offers the merged names as mention targets', () => {
  memberDirectory = null;
  const labels = chatMentionTargets().map((t) => t.label);
  assert.ok(labels.includes('Alyssa') && labels.includes('Sofia') && labels.includes('Lily'));
  assert.notOk(labels.some((l) => OLD_SPELLINGS.test(l)));
});

test('counselorName respells stored text on display, without writing anything', () => {
  freshState();
  state.teams[1].counselor = 'Alysa/Cam/Sam (B)';
  state.teams[2].counselor = 'Sofie/William (B) and lilly';
  const before = JSON.stringify(state.teams);
  assert.equal(counselorName(state.teams[1].id), 'Alyssa/Cam/Sam (B)');
  assert.equal(counselorName(state.teams[2].id), 'Sofia/William (B) and Lily');
  assert.equal(JSON.stringify(state.teams), before, 'display only: the stored text is untouched');
  assert.equal(respellCounselorText('Lillian, Sofi, Alyssa'), 'Lillian, Sofi, Alyssa', 'whole words only');
  assert.equal(respellCounselorText(null), null);
});

test('a directory name typed with an old spelling displays merged too', () => {
  freshState();
  const tid = state.teams[0].id;
  const was = memberDirectory;
  memberDirectory = { 'a@x,com': { name: 'Alysa', teamId: tid }, 'b@x,com': { name: 'Zed', teamId: tid } };
  try {
    assert.equal(counselorName(tid), 'Alyssa, Zed');
  } finally { memberDirectory = was; }
});
