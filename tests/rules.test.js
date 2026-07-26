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

const RULES = JSON.parse(readFixture('../database.rules.json')).rules;
const ROOTS = ['campScoreboard', 'seniorScoreboard'];
const OWNER = 'patricksimpson,fx@gmail,com';

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
  const expected = ['changelog', 'chat', 'chatPhotos', 'chatRate', 'config', 'members', 'presence', 'state'];
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
  });
});

test('every object with named children also closes the door on unnamed ones', () => {
  // $other: false is what stops a member appending arbitrary fields (or whole
  // subtrees) to a record that otherwise validates.
  const shouldSeal = [
    ['chat', '$channel', '$msgId'],
    ['chatPhotos', '$photoId'],
    ['members', '$memberKey'],
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
  });
});

test('no rule is accidentally left permanently true', () => {
  ALL.forEach(({ path, rule, expr }) => {
    if (rule === '.read' || rule === '.write') {
      assert.ok(expr !== true && expr !== 'true', `${path} ${rule} is unconditionally open`);
    }
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
