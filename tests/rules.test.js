// The security rules are the ONLY real boundary — canEdit() and every other
// client check just shapes UI. Until now they lived solely in the Firebase
// console: unreviewable, undiffable, and invisible to this suite, so a rules
// regression would have been silent. `database.rules.json` in the repo root is
// now the source of truth; these tests pin the invariants the app depends on.
//
// This does NOT prove what is published — there is no deploy pipeline, the
// console is still pasted by hand. It proves the file we intend to publish is
// internally coherent, and it fails loudly if someone edits it carelessly.
// After any change: paste the file into the console, then re-run the
// unauthenticated probes in the runbook.

const RULES_TEXT = readFixture('../database.rules.json');
const RULES = JSON.parse(RULES_TEXT).rules;
const ROOTS = ['campScoreboard', 'seniorScoreboard'];
const OWNER = 'patricksimpson,fx@gmail,com';
// The R1 blocks (setup, campers, reveal …) are written once, with the spec's macro
// names, in tests/rules-macros.js; the file we publish spells them out. Both camps come
// from the same functions. `node tests/rules-macros.js` regenerates the file.
const SRC = nodeRequire('./rules-macros.js');
const R1_NODES = ['setup', 'campers', 'teamPhotos', 'accessRequests', 'accessBlocked', 'restoreIndex',
  'restoreBody', 'editorsHere', 'revealPublic', 'revealFull'];

// Every rule expression anywhere in the tree, with its path — the workhorse.
function walk(node, path, out) {
  Object.keys(node).forEach((k) => {
    const v = node[k];
    if (k.startsWith('.')) out.push({ path: path.join('/'), rule: k, expr: v });
    else if (v && typeof v === 'object') walk(v, path.concat(k), out);
  });
  return out;
}
const ALL = walk(RULES, [], []);

test('nothing is granted at the database root — no cascading read or write', () => {
  assert.equal(RULES['.read'], false, 'a cascading root .read would expose every camp');
  assert.equal(RULES['.write'], false);
  ROOTS.forEach((r) => {
    assert.equal(RULES[r]['.read'], undefined, `${r} must not grant read for the whole camp`);
    assert.equal(RULES[r]['.write'], undefined, `${r} gates per child, never at the root`);
  });
});

test('both camps exist and expose exactly the same set of gated paths', () => {
  const expected = ['accessBlocked', 'accessRequests', 'campers', 'changelog', 'chat', 'chatPhotos', 'chatRate',
    'config', 'editorsHere', 'members', 'presence', 'push', 'pushAlerts', 'pushSchedule', 'restoreBody',
    'restoreIndex', 'revealFull', 'revealPublic', 'setup', 'state', 'teamPhotos'];
  ROOTS.forEach((r) => {
    assert.deepEqual(Object.keys(RULES[r]).filter((k) => !k.startsWith('.')).sort(), expected,
      `${r} covers every path the client touches — an ungated path is an open door`);
  });
});

test('every rule in a camp block references its OWN camp members list', () => {
  // The senior ruleset was copied from junior; a missed swap would let junior
  // members read and write senior data (and it is easy to miss by eye).
  ROOTS.forEach((root) => {
    const other = ROOTS.find((r) => r !== root);
    walk(RULES[root], [root], []).forEach(({ path, rule, expr }) => {
      if (typeof expr !== 'string') return;
      assert.notOk(expr.includes(`'${other}'`), `${path} ${rule} reaches into ${other}`);
      if (expr.includes('members')) {
        assert.ok(expr.includes(`child('${root}')`), `${path} ${rule} must scope its members lookup to ${root}`);
      }
    });
  });
});

test('reads require membership and writes require the editor role', () => {
  ROOTS.forEach((root) => {
    ['state', 'config'].forEach((p) => {
      const b = RULES[root][p];
      assert.ok(/members/.test(b['.read']) && /email_verified/.test(b['.read']), `${root}/${p} read is member-gated`);
      assert.ok(/role'?\)?\.val\(\) == 'editor'/.test(b['.write']), `${root}/${p} write is editor-only`);
    });
    assert.ok(/role/.test(RULES[root].changelog['.read']), `${root}/changelog is editor-read`);
  });
});

test('an unverified email can never satisfy a rule', () => {
  // A Google account with an unverified address must not pass as a member.
  ALL.forEach(({ path, rule, expr }) => {
    if (typeof expr !== 'string' || !expr.includes('auth.token.email')) return;
    assert.ok(expr.includes('email_verified'), `${path} ${rule} checks email without requiring verification`);
  });
});

test('the members key transform matches emailKey() exactly', () => {
  // The rules language replaces ALL dots; the client must use replaceAll. A
  // mismatch locks out every multi-dot address — including the owner's.
  const seen = ALL.filter((r) => typeof r.expr === 'string' && r.expr.includes('toLowerCase()'));
  assert.ok(seen.length > 0, 'the transform is actually used');
  seen.forEach(({ path, rule, expr }) => {
    assert.ok(expr.includes("toLowerCase().replace('.', ',')"),
      `${path} ${rule} must transform the address the same way emailKey() does`);
  });
  assert.equal(emailKey('Patrick.Simpson.FX@Gmail.com '), 'patrick,simpson,fx@gmail,com',
    'and the client still agrees — every dot, lowercased, trimmed');
});

test('the owner record is immutable from any client, in both camps', () => {
  // The permanent break-glass path: if a rules edit ever locks everyone out,
  // this key is still an editor and the console can still reach it.
  ROOTS.forEach((root) => {
    const w = RULES[root].members.$memberKey['.write'];
    assert.ok(w.includes(`$memberKey != '${OWNER}'`),
      `${root}: no client write may target the owner key — this is the lockout anchor`);
  });
});

test('chat is member-writable but identity-bound, create-and-delete only', () => {
  ROOTS.forEach((root) => {
    const msg = RULES[root].chat.$channel.$msgId;
    const w = msg['.write'];
    assert.ok(w.includes("newData.child('byKey').val() === auth.token.email"),
      `${root}: a created message must carry the SENDER's identity — this is what makes byKey trustworthy`);
    assert.ok(w.includes('!data.exists()') && w.includes('!newData.exists()'),
      `${root}: create or delete only — an edit path would let history be rewritten`);
    ['announcements', 'general', 'memes', 'photos'].forEach((ch) => {
      assert.ok(w.includes(`$channel === '${ch}'`), `${root}: channel ${ch} allowed`);
    });
    assert.equal(msg.$other['.validate'], false, `${root}: no unknown fields on a message`);
  });
});

test('the four channel ids match the client contract exactly', () => {
  const ids = chatChannels().map((c) => c.id);
  ROOTS.forEach((root) => {
    const w = RULES[root].chat.$channel.$msgId['.write'];
    ids.forEach((id) => assert.ok(w.includes(`'${id}'`), `${root}: client channel ${id} is allowed by the rules`));
    const allowed = (w.match(/\$channel === '(\w+)'/g) || []).map((s) => s.split("'")[1]);
    assert.deepEqual(allowed.sort(), ids.slice().sort(), `${root}: rules and client agree on the channel list`);
  });
});

test('image fields are pinned to inline JPEG data URLs — no outbound requests', () => {
  // An <img src> is the one place a database string becomes a network request.
  // Without this, any member could plant a tracking beacon that fires for
  // every viewer of a channel. chatSafeImageSrc() is the second layer.
  ROOTS.forEach((root) => {
    const thumb = RULES[root].chat.$channel.$msgId.thumb['.validate'];
    assert.ok(thumb.includes("beginsWith('data:image/jpeg;base64,')"), `${root}: thumb must be an inline image`);
    assert.ok(/length <= \d+/.test(thumb), `${root}: thumb is size-capped`);
    const photo = RULES[root].chatPhotos.$photoId['.validate'];
    assert.ok(photo.includes("beginsWith('data:image/jpeg;base64,')"), `${root}: full photo must be an inline image`);
    // team crests (P2) accept png OR jpeg, but only through the FULL base64 charset regex: a prefix
    // check lets a quote-breakout payload through, and the crest string is later built into an <img>
    const crest = RULES[root].teamPhotos.$tid.data['.validate'];
    assert.ok(crest.includes('matches(/^data:image\\/(png|jpeg);base64,[A-Za-z0-9+\\/]+={0,2}$/)'),
      `${root}: a team photo is an inline png/jpeg matched end to end, not by prefix`);
    assert.ok(/length <= 100000/.test(crest), `${root}: and capped at 100,000 characters`);
  });
});

test('every object with named children also closes the door on unnamed ones', () => {
  // $other: false is what stops a member appending arbitrary fields (or whole
  // subtrees) to a record that otherwise validates.
  const shouldSeal = [
    ['chat', '$channel', '$msgId'],
    ['chatPhotos', '$photoId'],
    ['members', '$memberKey'],
    ['push', '$memberKey', '$deviceId'],
    ['push', '$memberKey', '$deviceId', 'prefs'],
    ['push', '$memberKey', '$deviceId', 'prefs', 'ch'],
    ['pushSchedule'],
    ['pushSchedule', 'blocks', '$blockId'],
  ];
  ROOTS.forEach((root) => {
    shouldSeal.forEach((p) => {
      const node = p.reduce((n, k) => (n ? n[k] : null), RULES[root]);
      assert.ok(node, `${root}/${p.join('/')} exists`);
      assert.equal(node.$other && node.$other['.validate'], false,
        `${root}/${p.join('/')} must reject unknown children`);
    });
  });
});

test('the unused PII paths do not exist at all', () => {
  // `roster` and `contacts` were pre-gated for a camper/parent-details feature
  // that was never built, and were readable by ANY member with no validation.
  // Dead permissive rules are the ones that get forgotten and then quietly
  // filled in — and this would be minors' PII. Deleted, so the deny-all root
  // covers them. When the feature is actually built, write rules FOR it then:
  // editor-only read, not member-read.
  ROOTS.forEach((root) => {
    ['roster', 'contacts'].forEach((p) => {
      assert.equal(RULES[root][p], undefined, `${root}/${p} must not have a rules block until it has a feature`);
    });
    // `campers` (minors' first names, P2 S7) IS published ahead of its feature, but only as part
    // of the reviewed R1 release and with the strict gate the comment above asks for: EDITOR-only
    // read, the very expression state's write uses, and no member grant anywhere beneath it.
    assert.equal(RULES[root].campers['.read'], RULES[root].state['.write'], `${root}: campers is editor-read`);
    assert.equal(RULES[root].campers['.write'], RULES[root].state['.write'], `${root}: and editor-write`);
    walk(RULES[root].campers, [], []).forEach(({ path, rule, expr }) => {
      if (rule === '.read' || rule === '.write') {
        assert.equal(expr, RULES[root].state['.write'], `${root}/campers/${path} must not grant members anything`);
      }
    });
    const named = Object.keys(RULES[root]).filter((k) => /camper/i.test(k));
    assert.deepEqual(named, ['campers'], `${root}: no other node may hold camper data`);
  });
});

test('no rule is accidentally left permanently true — except the one public read', () => {
  // The standings reveal (redesign §4.4) is the ONE path a person with no sign-in may read: the
  // big-screen page has no login. Everything else, reads and writes, stays closed.
  ALL.forEach(({ path, rule, expr }) => {
    if (rule === '.read' || rule === '.write') {
      if (rule === '.read' && ROOTS.some((r) => path === r + '/revealPublic')) return;
      assert.ok(expr !== true && expr !== 'true', `${path} ${rule} is unconditionally open`);
    }
  });
});

test('revealPublic/.read is the ONLY anonymous read in either camp', () => {
  const trues = ALL.filter((r) => r.rule === '.read' && (r.expr === true || r.expr === 'true'));
  assert.deepEqual(trues.map((r) => r.path).sort(), ROOTS.map((r) => r + '/revealPublic').sort(),
    'exactly one `true` read per camp, and it is the reveal feed');
  ALL.forEach(({ path, rule, expr }) => {
    if (rule !== '.read' && rule !== '.write') return;
    if (rule === '.read' && path.endsWith('/revealPublic')) return;
    if (expr === false) return; // a closed door needs no sign-in check
    assert.ok(typeof expr === 'string' && expr.includes('auth != null'),
      `${path} ${rule} must require a sign-in (only revealPublic/.read is public)`);
  });
  ROOTS.forEach((root) => {
    // `.read` cascades down only: the feed's parent and its private twin stay member-only
    assert.equal(RULES[root]['.read'], undefined, `${root} itself grants nothing`);
    assert.equal(RULES[root].revealFull['.read'], RULES[root].state['.write'], `${root}/revealFull is editor-read`);
    assert.equal(RULES[root].revealFull['.write'], RULES[root].state['.write'], `${root}/revealFull is editor-write`);
    // nothing under the public node re-grants a read, and its write is editor-only
    assert.notOk(walk(RULES[root].revealPublic.$mode, [], []).some((r) => r.rule === '.read' || r.rule === '.write'),
      `${root}: nothing beneath revealPublic/$mode may add its own read or write`);
    assert.ok(RULES[root].revealPublic['.write'].startsWith('(' + RULES[root].state['.write'] + ')'),
      `${root}: revealPublic is editor-write`);
  });
});

test('message timestamps are bounded, not merely numeric', () => {
  // Unbounded, a single out-of-range `at` on an announcements message crashes
  // renderAll on every device (new Date(x).toISOString() throws). chat.js
  // clamps on read; this is the other half, so the value never lands at all.
  ROOTS.forEach((root) => {
    [RULES[root].chat.$channel.$msgId, RULES[root].chatPhotos.$photoId].forEach((node) => {
      const v = node.at['.validate'];
      assert.ok(v.includes('<= now'), `${root}: a timestamp from the future is refused`);
      assert.ok(v.includes('> now -'), `${root}: and one from the distant past`);
    });
  });
});

test('a photo is pinned to one of the four real channels', () => {
  // 'ch' is what channel-clear queries on. A photo tagged with anything else
  // is unreachable by every cleanup path and lives in the database forever.
  ROOTS.forEach((root) => {
    const v = RULES[root].chatPhotos.$photoId.ch['.validate'];
    chatChannels().forEach((c) => assert.ok(v.includes(`'${c.id}'`), `${root}: ${c.id} allowed`));
    assert.ok(!/\$other/.test(v));
  });
});

test('changelog entries are sealed and capped like every other record', () => {
  ROOTS.forEach((root) => {
    const e = RULES[root].changelog.$entryId;
    assert.equal(e.$other['.validate'], false, `${root}: no unknown fields on an audit entry`);
    ['at', 'teamId', 'team', 'reason', 'by', 'byKey'].forEach((f) => {
      assert.ok(e[f] && /length <= \d+/.test(e[f]['.validate']), `${root}: ${f} is capped`);
    });
    ['delta', 'before', 'after'].forEach((f) => {
      assert.ok(e[f]['.validate'].includes('isNumber'), `${root}: ${f} is a number`);
    });
  });
});

test('the client clamps changelog strings to the caps the rules enforce', () => {
  // A refused changelog push is swallowed, so a client value over the cap is a
  // silently missing audit entry — keep recordPointHistory's clamps (reason via
  // CHANGELOG_REASON_MAX, team 60, by 80) in lockstep with the rules.
  const cap = (e, f) => Number(/length <= (\d+)/.exec(e[f]['.validate'])[1]);
  ROOTS.forEach((root) => {
    const e = RULES[root].changelog.$entryId;
    assert.equal(cap(e, 'reason'), CHANGELOG_REASON_MAX, `${root}: reason cap`);
    assert.equal(cap(e, 'team'), 60, `${root}: team cap`);
    assert.equal(cap(e, 'by'), 80, `${root}: by cap`);
  });
});

test('the rate limit is bound to the writer and to the server clock', () => {
  // The only thing a member may write to their own rate node is `now`. If they
  // could backdate it they could clear their own throttle; if they could write
  // someone else's they could throttle that person out of chat.
  ROOTS.forEach((root) => {
    const w = RULES[root].chatRate.$memberKey['.write'];
    assert.ok(w.includes('newData.val() === now'), `${root}: the stamp must be the server's clock`);
    assert.ok(w.includes('$memberKey === auth.token.email') || w.includes('$memberKey ==='),
      `${root}: a member may only stamp their OWN row`);
  });
});

test('creating chat content requires advancing the rate stamp; deleting does not', () => {
  ROOTS.forEach((root) => {
    [RULES[root].chat.$channel.$msgId, RULES[root].chatPhotos.$photoId].forEach((node) => {
      const w = node['.write'];
      assert.ok(w.includes("child('chatRate')"), `${root}: create consults the rate node`);
      assert.ok(w.includes('<= now - 1000'), `${root}: and enforces a floor between writes`);
      assert.ok(w.includes("newData.parent()"),
        `${root}: and requires the SAME atomic update to advance it — otherwise a caller just never stamps`);
      // The delete branch must stay clean, or moderation would be throttled.
      const del = w.slice(w.indexOf('data.exists() && !newData.exists()'));
      assert.notOk(del.includes('chatRate'), `${root}: deletes are never rate-limited`);
    });
  });
});

test('the client throttle sits above the server floor, so real people never hit the wall', () => {
  const floor = Number((RULES.campScoreboard.chat.$channel.$msgId['.write'].match(/<= now - (\d+)/) || [])[1]);
  assert.ok(floor > 0, 'a floor is set');
  assert.ok(CHAT_MIN_SEND_MS > floor,
    `client gap ${CHAT_MIN_SEND_MS}ms must exceed the ${floor}ms the rules enforce`);
});

test('changelog attribution is pinned to the writer, like chat', () => {
  // The one node whose whole purpose is accountability was accepting any `by`
  // and any `byKey`. historyAuthorName() renders byKey through the directory,
  // so this pin is what makes the displayed name mean something.
  ROOTS.forEach((root) => {
    const w = RULES[root].changelog.$entryId['.write'];
    assert.ok(w.includes("newData.child('byKey').val() === auth.token.email"),
      `${root}: an entry must carry the writer's own identity`);
  });
});

test('presence is bound to its owner and carries no self-declared role', () => {
  ROOTS.forEach((root) => {
    const p = RULES[root].presence;
    assert.ok(p.$memberKey, `${root}: presence is keyed by member, not by a caller-chosen id`);
    assert.ok(p.$memberKey['.write'].includes('$memberKey === auth.token.email'),
      `${root}: only I may write my own presence subtree`);
    const dev = p.$memberKey.$deviceId;
    assert.equal(dev.$other['.validate'], false, `${root}: no extra fields on a presence row`);
    assert.equal(dev.role, undefined,
      `${root}: role is gone — nothing read it, and a viewer could declare 'editor'`);
    assert.ok(dev.at['.validate'].includes('=== now'), `${root}: the stamp is the server's`);
  });
});

test('state accepts exactly the synced keys, and each must be a branch', () => {
  // A fat write lands in every device's localStorage snapshot. Rules can't
  // measure subtree size, but they can refuse a scalar where a tree belongs,
  // which is the actual vector (a multi-megabyte string at state/results).
  ROOTS.forEach((root) => {
    const st = RULES[root].state;
    SYNC_KEYS.forEach((k) => {
      assert.ok(st[k], `${root}/state/${k} is named in the rules`);
      assert.ok(st[k]['.validate'].includes('!newData.isString()'), `${root}/state/${k} must be a branch`);
    });
    assert.equal(st.$other['.validate'], false, `${root}/state refuses unknown keys`);
    // `brackets4` (the 4-team bracket, BUILD-PLAN Step 22) was published AHEAD of its client in R1; since Step 22
    // it is one of SYNC_KEYS like the rest, so the loop above already holds it to a branch.
    assert.ok(SYNC_KEYS.includes('brackets4'), 'the client writes brackets4');
    const named = Object.keys(st).filter((k) => !k.startsWith('.') && k !== '$other').sort();
    assert.deepEqual(named, SYNC_KEYS.slice().sort(),
      `${root}/state's allowed keys must be exactly SYNC_KEYS — a mismatch silently drops a write`);
  });
});

test('state/teams and state/meta take only the NEW optional fields, and a v183 whole-array write still passes', () => {
  ROOTS.forEach((root) => {
    const teams = RULES[root].state.teams;
    // id / name / counselor stay unvalidated and there is no $other:false — a v183 client's
    // whole `teams` array (which carries none of the branding fields) must keep being accepted.
    assert.deepEqual(Object.keys(teams.$i).sort(), ['color', 'emoji', 'photoV', 'short'], `${root}: only the new fields`);
    assert.equal(teams.$i.$other, undefined, `${root}: no $other:false under a team`);
    assert.ok(teams.$i.emoji['.validate'].includes("contains('<')") && teams.$i.emoji['.validate'].includes('contains("\'")'),
      `${root}: team emoji refuses markup and a quote`);
    assert.ok(/length <= 20/.test(teams.$i.short['.validate']), `${root}: team short is capped`);
    assert.ok(teams.$i.color['.validate'].includes('/^[a-z]{2,12}$/'), `${root}: color is a bare key, never a quote-breakout`);
    assert.equal(RULES[root].state.meta.$other, undefined,
      `${root}: no $other:false under state/meta — older builds' fields stay valid`);
  });
});

test('config type-pins match the keys the client actually pushes', () => {
  ROOTS.forEach((root) => {
    const cf = RULES[root].config;
    CONFIG_KEYS.forEach((k) => assert.ok(cf[k], `${root}/config/${k} is pinned`));
    assert.ok(cf.version['.validate'].includes('isNumber'), `${root}: version is a number`);
    // Sealed 2026-07-26 after reading the live node: exactly the five keys.
    // Safe even if a stray ever appears, because pushConfig is a whole-node
    // set() of configForSync() output — the write never carries an unknown key,
    // and being a set() it prunes any stray already there.
    assert.equal(cf.$other['.validate'], false, `${root}/config refuses unknown keys`);
  });
});

// ── Phone alerts (Web Push) ────────────────────────────────────────
// Three nodes per camp: push/<memberKey>/<deviceId> (one record per person per
// phone — its endpoint, encryption keys and what it wants to hear about),
// pushSchedule (the week, published by an editor's device because the sender
// can't run camps.js), and pushAlerts (the sender's log of director alerts).
// The sender itself is a Cloudflare Worker with admin credentials, which the
// rules don't govern — so every rule here is about what a SIGNED-IN CLIENT
// may do.

test('a push record is readable and writable only by its owner', () => {
  // An endpoint plus its keys is enough to send that phone notifications
  // without the sender, so nobody else — editors included — may read them.
  ROOTS.forEach((root) => {
    const push = RULES[root].push;
    assert.equal(push['.read'], undefined, `${root}: nothing is readable at push/ itself`);
    assert.equal(push['.write'], undefined, `${root}: nothing is writable at push/ itself`);
    const mk = push.$memberKey;
    assert.ok(mk['.read'].includes('$memberKey === auth.token.email') && mk['.read'].includes('$memberKey === auth.token.phone_number'),
      `${root}: read is bound to the caller's own key (email or phone)`);
    assert.ok(/members/.test(mk['.read']), `${root}: and to being a member`);
    assert.ok(mk['.write'].includes('$memberKey === auth.token.email') && mk['.write'].includes('$memberKey === auth.token.phone_number'),
      `${root}: write is bound to the caller's own key`);
  });
});

test("a removed member can still delete their own push record, but can't create one", () => {
  // Sign-out deletes this phone's records while still signed in; someone just
  // removed from the list must be able to do the same (their phone should stop
  // buzzing), while creating needs current membership.
  ROOTS.forEach((root) => {
    const w = RULES[root].push.$memberKey['.write'];
    const i = w.indexOf('!newData.exists() ||');
    assert.ok(i > -1, `${root}: deletion has its own branch`);
    assert.notOk(w.slice(0, i).includes('members'), `${root}: the delete branch doesn't require membership`);
    assert.ok(w.slice(i).includes(`child('${root}').child('members')`), `${root}: but writing data does`);
    assert.ok(w.slice(0, i).includes('$memberKey ==='), `${root}: and either way it's only your OWN key`);
    // A rule's newData is the node AT the rule, so the branch above only
    // covers deleting the whole subtree. Deleting ONE phone while another
    // remains needs its own grant at the device level (verified against the
    // emulator — without it, that delete required membership).
    const dw = RULES[root].push.$memberKey.$deviceId['.write'];
    assert.ok(dw && dw.endsWith('&& !newData.exists()'), `${root}: a single device record is owner-deletable`);
    assert.ok(dw.includes('$memberKey === auth.token.email') && dw.includes('$memberKey === auth.token.phone_number'),
      `${root}: and only by its owner`);
    assert.notOk(dw.includes('members'), `${root}: membership not required to delete`);
  });
});

test('every push record field is pinned to the shape the client writes', () => {
  ROOTS.forEach((root) => {
    const dev = RULES[root].push.$memberKey.$deviceId;
    assert.ok(dev['.validate'].includes('$deviceId.matches(/^[A-Za-z0-9_-]{8,64}$/)'), `${root}: device ids are url-safe and bounded`);
    assert.ok(dev.endpoint['.validate'].includes('matches(/^https:'), `${root}: endpoints are https only (and a known push host — see below)`);
    assert.ok(/length <= 1024/.test(dev.endpoint['.validate']), `${root}: and bounded`);
    assert.ok(dev.at['.validate'].includes('=== now'), `${root}: the stamp is the server's`);
    assert.ok(dev.team['.validate'].includes('/^t[0-9]$/'), `${root}: team is a team id`);
    assert.ok(/length <= 40/.test(dev.label['.validate']), `${root}: device label is capped`);
    const prefs = dev.prefs;
    assert.ok(prefs.lead['.validate'].includes('=== 5') && prefs.lead['.validate'].includes('=== 10') && prefs.lead['.validate'].includes('=== 15'),
      `${root}: lead is one of 5/10/15`);
    assert.ok(prefs.blocks.$key['.validate'].includes('newData.val() === true'), `${root}: block subscriptions are true-only`);
    // The channel switches name exactly the chat channels — same contract as
    // the chat rules, so adding a channel means a rules re-paste here too.
    const ch = Object.keys(prefs.ch).filter((k) => !k.startsWith('.') && k !== '$other').sort();
    assert.deepEqual(ch, chatChannels().map((c) => c.id).sort(), `${root}: prefs.ch names exactly the chat channels`);
  });
});

test('every object in the push nodes closes the door on unnamed children', () => {
  // A generic sweep rather than a list, so a field added later can't forget it.
  const sweep = (node, path, out) => {
    if (!node || typeof node !== 'object') return out;
    const named = Object.keys(node).filter((k) => !k.startsWith('.') && !k.startsWith('$'));
    if (named.length) out.push({ path, sealed: !!(node.$other && node.$other['.validate'] === false) });
    Object.keys(node).filter((k) => !k.startsWith('.')).forEach((k) => sweep(node[k], path + '/' + k, out));
    return out;
  };
  ROOTS.forEach((root) => {
    ['push', 'pushSchedule'].forEach((p) => {
      const found = sweep(RULES[root][p], root + '/' + p, []);
      assert.ok(found.length > 0, `${root}/${p} has records to check`);
      found.forEach(({ path, sealed }) => assert.ok(sealed, `${path} must reject unknown children`));
    });
  });
});

test('pushAlerts is written by the sender only; editors read it', () => {
  ROOTS.forEach((root) => {
    const a = RULES[root].pushAlerts;
    assert.equal(a['.write'], false, `${root}: no client may write the alert log — the Worker does, with admin`);
    assert.ok(/role'?\)?\.val\(\) == 'editor'/.test(a['.read']), `${root}: the log is editor-read`);
    assert.notOk(walk(a, [], []).some((r) => r.rule === '.write' && r.expr !== false),
      `${root}: nothing under pushAlerts re-opens a write`);
  });
});

test('pushSchedule: members read it, only editors publish it, every field pinned', () => {
  ROOTS.forEach((root) => {
    const s = RULES[root].pushSchedule;
    assert.ok(/members/.test(s['.read']) && /email_verified/.test(s['.read']), `${root}: member read`);
    assert.ok(/role'?\)?\.val\(\) == 'editor'/.test(s['.write']), `${root}: editor-only write`);
    assert.ok(s.weekStart['.validate'].includes('matches(/^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/)'), `${root}: weekStart is a date`);
    assert.ok(s.at['.validate'].includes('=== now'), `${root}: stamped by the server`);
    const b = s.blocks.$blockId;
    assert.ok(b['.validate'].includes('$blockId.matches(/^[a-z0-9-]{1,40}$/)'), `${root}: block ids are path-safe`);
    assert.ok(b.dow['.validate'].includes('<= 6') && b.start['.validate'].includes('<= 1439'), `${root}: dow/start are in range`);
    assert.ok(b.key['.validate'].includes('/^[a-z0-9-]{1,48}$/'), `${root}: keys match the subscription key format`);
  });
});

test('the phone-alert blocks are identical in both camps, modulo the root name', () => {
  // Same discipline as every other block: senior is junior with only the
  // members-lookup root swapped. A hand-edit to one camp would silently
  // diverge the two.
  ['push', 'pushSchedule', 'pushAlerts'].forEach((p) => {
    const junior = JSON.stringify(RULES.campScoreboard[p]).replaceAll("'campScoreboard'", "'seniorScoreboard'");
    assert.equal(junior, JSON.stringify(RULES.seniorScoreboard[p]), `${p} differs between camps beyond the root name`);
  });
});

test('a push endpoint must be a real push service (no relaying through the sender)', () => {
  // Without this a member could store https://anything as their "phone" and
  // have the alert sender POST to it on every message. The Worker enforces
  // the same host list; this is the first line. Behaviour verified in the
  // RTDB emulator (2026-10-26): fcm.googleapis.com, *.google.com, Apple,
  // Mozilla and Windows accepted; look-alike hosts and plain http refused.
  ROOTS.forEach((root) => {
    const v = RULES[root].push.$memberKey.$deviceId.endpoint['.validate'];
    ['google', 'googleapis', 'push\\.services\\.mozilla', 'push\\.apple', 'notify\\.windows'].forEach((h) => {
      assert.ok(v.includes(h), `${root} endpoint allowlist names ${h}`);
    });
    assert.ok(v.includes('matches(/^https:'), `${root} endpoint must be anchored and https`);
  });
});

// ── R1 (BUILD-PLAN Step 10): setup, campers, photos, requests, restore points, "also here",
//    the owner-only clauses and the standings reveal. Written but NOT yet published — Step 11
//    pastes it. The emulator suites in tests/emulator prove what these blocks DO; these tests
//    prove the file is the one tests/rules-macros.js produces and that its invariants hold.

test('the R1 blocks in the file are exactly what the macro source produces, in both camps', () => {
  ROOTS.forEach((root) => {
    const want = SRC.newBlocks(root);
    assert.deepEqual(Object.keys(want).sort(), R1_NODES.slice().sort(), 'the source writes the ten R1 nodes');
    R1_NODES.forEach((k) => {
      assert.equal(JSON.stringify(RULES[root][k]), JSON.stringify(want[k]),
        `${root}/${k} differs from tests/rules-macros.js — edit the source and run \`node tests/rules-macros.js\`, never the JSON`);
    });
    // and the additive amendments to existing blocks are present, node for node
    SRC.amendments(root).forEach(([path, node]) => {
      const at = path.reduce((n, k) => (n ? n[k] : null), RULES[root]);
      assert.ok(at, `${root}/${path.join('/')} exists`);
      Object.keys(node).forEach((k) => assert.equal(JSON.stringify(at[k]), JSON.stringify(node[k]), `${root}/${path.join('/')}/${k}`));
    });
  });
});

test('the macro source expands to the expressions already published (MEMBER, EDITOR, the owner key)', () => {
  ROOTS.forEach((root) => {
    const m = SRC.macros(root);
    assert.equal(m.MEMBER, RULES[root].state['.read'], `${root}: MEMBER is today's state/.read`);
    assert.equal(m.EDITOR, RULES[root].state['.write'], `${root}: EDITOR is today's state/.write`);
    assert.ok(RULES[root].members.$memberKey['.write'].includes(`$memberKey != '${OWNER}'`),
      `${root}: and the members-immutability literal is the owner key`);
  });
  assert.equal(SRC.OWNER_KEY, OWNER);
  assert.equal(SRC.OWNER_KEY, OWNER_MEMBER_KEY, 'the OWNER clause is the client constant (app.js)');
});

test('every R1 block is identical in both camps, modulo the root name', () => {
  R1_NODES.concat(['state', 'pushSchedule']).forEach((k) => {
    const junior = JSON.stringify(RULES.campScoreboard[k]).replaceAll("'campScoreboard'", "'seniorScoreboard'");
    assert.equal(junior, JSON.stringify(RULES.seniorScoreboard[k]), `${k} differs between camps beyond the root name`);
  });
});

test('every R1 node is gated by sign-in, with the read gates the plan promised', () => {
  ROOTS.forEach((root) => {
    const R = RULES[root];
    const editor = R.state['.write'];
    const member = R.state['.read'];
    assert.equal(R.setup['.read'], member, `${root}/setup is member-read`);
    assert.equal(R.setup['.write'], editor, `${root}/setup is editor-write`);
    assert.equal(R.teamPhotos['.read'], member, `${root}/teamPhotos is member-read`);
    assert.equal(R.teamPhotos.$tid['.write'], editor, `${root}/teamPhotos is editor-write`);
    ['accessRequests', 'accessBlocked', 'restoreIndex', 'restoreBody', 'editorsHere'].forEach((k) => {
      assert.equal(R[k]['.read'], editor, `${root}/${k} is editor-read`);
    });
    assert.ok(R.restoreIndex.$rid['.write'].startsWith('(' + editor + ')'), `${root}/restoreIndex is editor-write`);
    assert.ok(R.restoreBody.$rid['.write'].startsWith('(' + editor + ')'), `${root}/restoreBody is editor-write`);
    assert.equal(R.accessBlocked.$k['.write'], editor, `${root}/accessBlocked is editor-write`);
  });
});

// A container is only a branch if its rule says so — otherwise a multi-megabyte STRING dropped at
// setup/typical (or a scalar at a $dk level) lands in every device's cache.
test('every setup / campers / reveal container is a branch (or demands children), so a scalar never lands', () => {
  const bare = (node, path, out) => {
    Object.keys(node).filter((k) => !k.startsWith('.') && k !== '$other').forEach((k) => {
      const child = node[k];
      if (!child || typeof child !== 'object' || !Object.keys(child).some((c) => !c.startsWith('.'))) return;
      const v = child['.validate'];
      if (!(typeof v === 'string' && (v.includes('!newData.isString()') || v.includes('hasChildren')))) out.push(path.concat(k).join('/'));
      bare(child, path.concat(k), out);
    });
    return out;
  };
  ROOTS.forEach((root) => {
    // revealPublic is the one node an anonymous reader downloads whole: a scalar (a multi-megabyte string)
    // at it, at pub, or at revealFull / its g would otherwise be accepted (review of Step 10)
    ['setup', 'campers', 'revealPublic', 'revealFull'].forEach((top) => {
      assert.ok(RULES[root][top]['.validate'].includes('!newData.isString()'), `${root}/${top} must itself be a branch`);
      assert.deepEqual(bare(RULES[root][top], [top], []), [], `${root}: containers with no branch/hasChildren guard`);
    });
    assert.ok(RULES[root].revealPublic.$mode.pub['.validate'].includes('!newData.isString()'), `${root}/revealPublic/$mode/pub is a branch`);
    assert.ok(RULES[root].revealFull.$mode.g['.validate'].includes('!newData.isString()'), `${root}/revealFull/$mode/g is a branch`);
  });
});

test('every block field and team-flag leaf carries the anchor; the patch teams rule is the four-parent anchor, its leaf five', () => {
  const FOUR = 'newData.parent().parent().parent().parent()';
  const ANCHOR = "newData.parent().child('start').exists() && newData.parent().child('label').exists()";
  const ANCHOR_TID = "newData.parent().parent().child('start').exists() && newData.parent().parent().child('label').exists()";
  const fields = (block) => Object.keys(block).filter((k) => !k.startsWith('.') && !k.startsWith('$'));
  ROOTS.forEach((root) => {
    const setup = RULES[root].setup;
    [['typical', setup.typical.$bid], ['dayBlocks', setup.dayBlocks.$dk.$bid]].forEach(([kind, block]) => {
      fields(block).forEach((f) => {
        assert.ok(block[f]['.validate'].includes(ANCHOR), `${root}/${kind}.${f} must refuse a write into a record whose start/label are gone`);
      });
      assert.ok(block['.validate'].includes("hasChildren(['start', 'end', 'label', 'type'])"), `${root}/${kind}: whole-record shape`);
      // the team-flag leaf is anchored too: its protection must not rest on the teams node's validate alone
      assert.ok(block.teams.$tid['.validate'].includes(ANCHOR_TID), `${root}/${kind}.teams.$tid must refuse a flag written into a deleted block`);
    });
    const patch = setup.patches.$dk.$bid;
    fields(patch).forEach((f) => {
      const v = patch[f]['.validate'];
      assert.ok(v.includes(`${FOUR}.child('typical').child($bid).child('start').exists()`) &&
        v.includes(`${FOUR}.child('days').child($dk).child('typical').val() === true`),
        `${root}/patches.${f} needs a real typical block on a day that uses the typical day`);
      assert.notOk(v.includes(`${FOUR}.parent()`), `${root}/patches.${f}: never five parents (that is <root>/typical)`);
    });
    assert.ok(patch.teams['.validate'].startsWith('newData.hasChildren() && '), `${root}: patch teams is a non-empty branch`);
    assert.equal(patch.alertKey, undefined, `${root}: a patch never carries an alertKey`);
    assert.equal(setup.typical.$bid.off, undefined, `${root}: the typical day has no off flag`);
    assert.ok(setup.dayBlocks.$dk.$bid.off && patch.off, `${root}: one-offs and patches can be cancelled`);
    assert.ok(patch.teams.$tid['.validate'].includes('$tid.matches(/^t[0-9]$/)'), `${root}: team ids`);
    // the patch team-flag LEAF is one level below its siblings, so `setup` is FIVE parents away (the teams node: four)
    const FIVE = `${FOUR}.parent()`;
    const tv = patch.teams.$tid['.validate'];
    assert.ok(tv.includes(`${FIVE}.child('typical').child($bid).child('start').exists()`) &&
      tv.includes(`${FIVE}.child('typical').child($bid).child('label').exists()`) &&
      tv.includes(`${FIVE}.child('days').child($dk).child('typical').val() === true`),
      `${root}/patches.teams.$tid: a flag needs a real typical block on a day that uses the typical day`);
    assert.notOk(tv.includes(`${FIVE}.parent()`), `${root}/patches.teams.$tid: never six parents`);
  });
});

test('accessRequests: own row only, server time, closed until joinOpen, 60 s throttle, not a member, not blocked', () => {
  ROOTS.forEach((root) => {
    const a = RULES[root].accessRequests;
    const w = a.$reqKey['.write'];
    const split = w.indexOf(') || (!newData.exists()');
    assert.ok(split > 0, `${root}: create and delete are separate branches`);
    const create = w.slice(0, split);
    assert.ok(create.includes('$reqKey ===') && create.includes('email_verified'), `${root}: create is the requester's own verified identity`);
    assert.ok(create.includes("newData.child('at').val() === now"), `${root}: and stamps server time on every create/rewrite`);
    assert.ok(create.includes(`root.child('${root}').child('setup').child('meta').child('joinOpen').val() === true`), `${root}: closed until a director opens asking`);
    assert.ok(create.includes(`!root.child('${root}').child('accessBlocked').child($reqKey).exists()`), `${root}: a blocked identity can't write`);
    assert.ok(create.includes('!(auth != null') && create.includes(".child('members')"), `${root}: and a member can't create one`);
    assert.ok(create.includes("data.child('at').val() < now - 60000"), `${root}: rewriting waits a minute`);
    const del = w.slice(split);
    assert.ok(del.includes("data.child('at').val() < now - 60000"), `${root}: a requester deletes their own row only after 60 s (no delete-and-recreate)`);
    assert.ok(del.includes(RULES[root].state['.write']), `${root}: an editor may delete any row`);
    assert.ok(a.$reqKey['.read'].includes('$reqKey ===') && a.$reqKey['.read'].includes('email_verified'), `${root}: a requester reads only their own row`);
    assert.deepEqual(a['.indexOn'], ['at'], `${root}: the editor's limitToLast(25) query is indexed`);
    assert.equal(a.$reqKey.$other['.validate'], false, `${root}: a request carries name/note/at and nothing else`);
    // R1 opens no stranger-writable surface: joinOpen itself is only editor-written
    assert.equal(RULES[root].setup['.write'], RULES[root].state['.write'], `${root}: joinOpen is editor-written`);
  });
});

test('restore points: an archive, a pre-wizard or a pinned point can never be deleted; pinned is write-once', () => {
  ROOTS.forEach((root) => {
    const idx = RULES[root].restoreIndex.$rid;
    ["data.child('kind').val() !== 'archive'", "data.child('kind').val() !== 'pre-wizard'", "data.child('pinned').val() !== true"].forEach((c) => {
      assert.ok(idx['.write'].includes(c), `${root}/restoreIndex delete is refused unless ${c}`);
    });
    const body = RULES[root].restoreBody.$rid['.write'];
    ['archive', 'pre-wizard'].forEach((k) => assert.ok(body.includes(`.child('kind').val() !== '${k}'`), `${root}/restoreBody: its body is protected too (${k})`));
    assert.ok(body.includes(".child('pinned').val() !== true"), `${root}/restoreBody: and a pinned point's body`);
    assert.ok(idx.pinned['.write'].includes('!data.exists() && newData.val() === true'), `${root}: pinned may be set once, to true, never unset`);
    assert.ok(idx.at['.validate'].includes('=== now'), `${root}: a point is stamped by the server`);
    assert.ok(idx.byKey['.validate'].includes('auth.token.email'), `${root}: and signed by the writer`);
    assert.ok(/length <= 900000/.test(RULES[root].restoreBody.$rid['.validate']), `${root}: bodies are capped`);
    assert.equal(idx.$other['.validate'], false, `${root}: no unknown fields on an index row`);
    assert.ok(idx.kind['.validate'].includes("'archive'") && idx.kind['.validate'].includes("'pre-wizard'") && idx.kind['.validate'].includes(SRC.macros(root).OWNER),
      `${root}: the archive / pre-wizard kinds name OWNER (Q8)`);
  });
});

test('editorsHere is editor-only both ways, pinned to the writer, and its location has no slash', () => {
  ROOTS.forEach((root) => {
    const e = RULES[root].editorsHere;
    assert.equal(e['.read'], RULES[root].state['.write'], `${root}: a viewer can't see who is in the builder`);
    const w = e.$k.$d['.write'];
    assert.ok(w.includes('$k ===') && w.includes('email_verified'), `${root}: only your own key`);
    assert.ok(w.includes(RULES[root].state['.write']), `${root}: and only while an editor (a delete needs only the key)`);
    assert.ok(w.includes("data.child('at').val() < now - 1000"), `${root}: a second write inside a second is refused`);
    assert.ok(e.$k.$d.at['.validate'].includes('=== now'), `${root}: stamped by the server`);
    const where = e.$k.$d.where['.validate'];
    assert.ok(where.includes('/^[a-z0-9:_-]{1,60}$/'), `${root}: where is a short token — its character class has no slash, so it can't smuggle a path`);
  });
});

test('every new named record closes the door on unnamed children (the sweep)', () => {
  const sweep = (node, path, out) => {
    if (!node || typeof node !== 'object') return out;
    const named = Object.keys(node).filter((k) => !k.startsWith('.') && !k.startsWith('$'));
    if (named.length && !(node.$other && node.$other['.validate'] === false)) out.push(path);
    Object.keys(node).filter((k) => !k.startsWith('.')).forEach((k) => sweep(node[k], path + '/' + k, out));
    return out;
  };
  ROOTS.forEach((root) => {
    const open = [];
    ['setup', 'campers', 'teamPhotos', 'accessRequests', 'accessBlocked', 'restoreIndex', 'editorsHere', 'revealPublic', 'revealFull']
      .forEach((p) => sweep(RULES[root][p], p, open));
    assert.deepEqual(open, [], `${root}: records that name fields but accept others`);
  });
});

test('stamps use server time or carry an unchanged value — never a client clock', () => {
  const KEEP = 'newData.val() === now || newData.val() === data.val()';
  ROOTS.forEach((root) => {
    const s = RULES[root].setup.meta;
    assert.ok(s.edited.$s.at['.validate'].includes(KEEP), `${root}: edited.at is NOWKEEP`);
    assert.ok(s.edited.$s.byKey['.validate'].includes('newData.val() === data.val() ||') && s.edited.$s.byKey['.validate'].includes('email_verified'),
      `${root}: edited.byKey is SELFKEEP — yours when written, someone else's only carried unchanged`);
    assert.ok(s.seeded.byKey['.validate'].includes('newData.val() === data.val() ||'), `${root}: seeded.byKey is SELFKEEP`);
    assert.ok(RULES[root].revealPublic.$mode.ctl.at['.validate'].includes('=== now'), `${root}: a reveal command is stamped by the server`);
    assert.ok(RULES[root].revealFull.$mode.frozenAt['.validate'].includes(KEEP), `${root}: frozenAt is NOWKEEP`);
    assert.ok(RULES[root].revealFull.$mode.startedBy['.validate'].includes('email_verified'), `${root}: startedBy is the writer's own key`);
  });
});

// ── decision Q8: four acts are the OWNER's alone, without adding a role ─────────
test('the OWNER clause compares the owner literal to the caller, verified email or phone', () => {
  ROOTS.forEach((root) => {
    const o = SRC.macros(root).OWNER;
    assert.ok(o.includes(`'${OWNER_MEMBER_KEY}' === auth.token.email.toLowerCase().replace('.', ',')`), `${root}: the caller's email key`);
    assert.ok(o.includes(`'${OWNER_MEMBER_KEY}' === auth.token.phone_number`), `${root}: and, like every SELF, a phone number — which an E.164 key never equals`);
    assert.ok(o.includes('email_verified == true'), `${root}: an unverified email is never the owner`);
  });
});

test('meta/on, the epoch pair, the wizard claim and the archive kinds all require the owner', () => {
  ROOTS.forEach((root) => {
    const O = SRC.macros(root).OWNER;
    const KEEP = `newData.val() === data.val() || (${O})`;
    const setup = RULES[root].setup.meta;
    assert.ok(setup.on.$s['.validate'].includes(KEEP), `${root}: setup/meta/on/<section> is OWNERKEEP`);
    ['epoch', 'epochAt'].forEach((f) => {
      assert.ok(setup[f]['.validate'].includes(KEEP), `${root}: setup/meta/${f} is OWNERKEEP`);
      assert.ok(RULES[root].state.meta[f]['.validate'].includes(KEEP), `${root}: state/meta/${f} is OWNERKEEP`);
    });
    ['step', 'byKey', 'at', 'fromEpoch', 'archiveId', 'answers'].forEach((f) => {
      assert.ok(setup.wizard[f]['.validate'].includes(`(${O})`), `${root}: wizard.${f} requires OWNER whenever it is written`);
    });
    assert.ok(setup.wizard.fromEpoch['.validate'].includes('length >= 1'), `${root}: fromEpoch is never empty — 'legacy' stands for the legacy epoch`);
    // an owner clause on a `.validate` sits on a LEAF, never on a branch node: the design must not
    // depend on how rules compare whole branches or on whether ancestor .validate runs
    let found = 0;
    const visit = (node, path) => {
      Object.keys(node).forEach((k) => {
        const v = node[k];
        if (k === '.validate' && typeof v === 'string' && v.includes(O)) {
          found++;
          assert.notOk(Object.keys(node).some((c) => !c.startsWith('.')), `${root}/${path.join('/')}: an owner clause on a branch node`);
        } else if (!k.startsWith('.') && v && typeof v === 'object') visit(v, path.concat(k));
      });
    };
    visit(RULES[root], []);
    assert.equal(found, 12, `${root}: setup/meta on + epoch + epochAt, state/meta epoch + epochAt, six wizard leaves, the restore kind`);
  });
});

// ── the standings reveal (redesign §4.4), written from the spec ────────────────
test('the reveal blocks exist in both camps with a real and a practice child, and no screens node', () => {
  ROOTS.forEach((root) => {
    ['revealScreens', 'revealPractice', 'reveal'].forEach((k) => assert.equal(RULES[root][k], undefined, `${root}/${k} must not exist`));
    ['revealPublic', 'revealFull'].forEach((k) => {
      assert.ok(RULES[root][k].$mode['.validate'].includes('$mode.matches(/^(real|practice)$/)'), `${root}/${k}: one rule for both modes`);
    });
    const c = RULES[root].revealPublic.$mode.ctl;
    assert.equal(c.$other['.validate'], false, `${root}: no startedBy, no by, no member key — unknown fields are refused`);
    ['startedBy', 'by', 'name'].forEach((f) => assert.equal(c[f], undefined, `${root}: ctl names no ${f}`));
    const known = ['v', 'id', 'seq', 'phase', 'cur', 'shown', 'teams', 'finale', 'at', 'sa', 'ca', 'startedAt', 'until', 'endedAt', 'endKind', 'epoch'];
    assert.deepEqual(Object.keys(c).filter((k) => !k.startsWith('.') && k !== '$other').sort(), known.slice().sort(), `${root}: the ctl fields`);
  });
});

test('the public reveal is bounded: group g0-g5, team t0-t5, names <= 30, numbers in range', () => {
  ROOTS.forEach((root) => {
    const g = RULES[root].revealPublic.$mode.pub.$g;
    assert.ok(g['.validate'].includes('$g.matches(/^g[0-5]$/)'), `${root}: groups g0..g5`);
    assert.ok(g.e.$tid['.validate'].includes('$tid.matches(/^t[0-5]$/)'), `${root}: teams t0..t5`);
    assert.ok(/length <= 30/.test(g.e.$tid.nm['.validate']) && /length >= 1/.test(g.e.$tid.nm['.validate']), `${root}: nm is 1-30 characters`);
    assert.ok(g.place['.validate'].includes('>= 1') && g.place['.validate'].includes('<= 6'), `${root}: place 1..6`);
    assert.equal(g.$other['.validate'], false, `${root}: a group has place and e only`);
    assert.equal(g.e.$tid.$other['.validate'], false, `${root}: an entry has the listed fields only`);
    ['p', 'v', 'm', 'c'].forEach((f) => assert.ok(g.e.$tid[f]['.validate'].includes('<= 99999') && g.e.$tid[f]['.validate'].includes('>= -9999'), `${root}: ${f} is bounded`));
    // a group can be published only once its place has been shown, and never rewritten in the same reveal
    for (let i = 0; i < 6; i++) {
      assert.ok(g['.validate'].includes(`($g === 'g${i}' && newData.parent().parent().child('ctl').child('shown').val() >= ${i + 1})`), `${root}: g${i} needs shown >= ${i + 1}`);
    }
    assert.ok(g['.validate'].includes("!data.exists() || newData.parent().parent().child('ctl').child('id').val() !== data.parent().parent().child('ctl').child('id').val()"),
      `${root}: a published place can't be rewritten inside the same reveal`);
    // the private twin holds the whole order but is editor-only, and its id must match the public ctl
    const f = RULES[root].revealFull.$mode;
    assert.ok(f['.validate'].includes("newData.child('r').val() === newData.parent().parent().child('revealPublic').child($mode).child('ctl').child('id').val()"), `${root}: revealFull.r == ctl.id`);
    assert.equal(f.g.$g['.validate'].includes('shown'), false, `${root}: revealFull groups have no SHOWN clause`);
  });
});

test('the reveal ctl enforces compare-and-set, one place at a time, a fresh Start, and a guarded delete', () => {
  ROOTS.forEach((root) => {
    const v = RULES[root].revealPublic.$mode.ctl['.validate'];
    ["newData.child('seq').val() === data.child('seq').val() + 1", "data.child('phase').val() !== 'ended'",
      "newData.child('shown').val() <= data.child('shown').val() + 1", "newData.child('shown').val() >= data.child('shown').val()",
      "newData.child('cur').val() < newData.child('shown').val()",
      "newData.child('ca').val() > now - 60000", "newData.child('ca').val() <= now + 60000",
      "newData.child('startedAt').val() === now", "newData.child('seq').val() === 1", "newData.child('shown').val() === 0",
      "newData.child('phase').val() === 'intro'",
      "newData.child('until').val() === data.child('until').val()", "newData.child('finale').val() === data.child('finale').val()",
      "newData.child('ca').val() === data.child('ca').val()", "newData.child('startedAt').val() === data.child('startedAt').val()",
      "!newData.parent().child('pub').exists()", // a Start carries no places from an earlier reveal, even if written as ctl alone
    ].forEach((c) => assert.ok(v.includes(c), `${root}: ctl rule says ${c}`));
    const until = RULES[root].revealPublic.$mode.ctl.until['.validate'];
    assert.ok(until.includes('10800000') && until.includes('172800000'), `${root}: a practice <= 3 h, a real reveal <= 48 h`);
    // the one delete clause: only after `until` (server clock) — or by the owner (the new-year wizard)
    const w = RULES[root].revealPublic['.write'];
    assert.ok(w.includes("!data.child('real').exists() || newData.child('real').exists() || data.child('real').child('ctl').child('until').val() <= now"),
      `${root}: deleting the real reveal waits for until`);
    assert.ok(w.endsWith(`(${SRC.macros(root).OWNER}))`), `${root}: the owner may clear it any time`);
  });
});

test('the public read is switched off by changing ONE value (the kill switch in the runbook)', () => {
  // setup-rebuild-spec Appendix E: if the usage graph ever shows polling, change revealPublic/.read
  // from true to the member expression and re-publish. Phones and remotes carry on; the big screen
  // shows Waiting. The replacement expression must therefore exist verbatim in the file already.
  ROOTS.forEach((root) => {
    assert.equal(RULES[root].revealPublic['.read'], true);
    assert.equal(RULES[root].setup['.read'], SRC.macros(root).MEMBER, `${root}: the member expression the kill switch swaps in`);
  });
});

test('the rules file stays well inside the published size limit', () => {
  // A PUT over the limit is refused and leaves the OLD rules live (nothing breaks), but a refused
  // release at 9 PM is a bad evening. RTDB's documented limit is 256 KiB; keep a margin.
  const { Buffer } = nodeRequire('buffer'); // the vm context has no Buffer of its own
  const bytes = Buffer.byteLength(RULES_TEXT, 'utf8');
  const minified = Buffer.byteLength(JSON.stringify(JSON.parse(RULES_TEXT)), 'utf8');
  assert.ok(bytes < 192 * 1024, `as committed ${bytes} bytes — over 192 KiB, split R1 into R1a/R1b (setup-rebuild-spec §8.6)`);
  assert.ok(minified < 160 * 1024, `minified ${minified} bytes`);
});
