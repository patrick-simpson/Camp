// The SOURCE of the "R1" rules release (BUILD-PLAN Step 10): P2's setup / campers /
// photos / access-request / restore / editors-here blocks (setup-rebuild-spec §8.2),
// the additive amendments to state and pushSchedule (§8.3), the owner-only clauses
// (decision Q8) and the standings-reveal blocks (app-shell-redesign-spec §4.4).
//
// WHY A GENERATOR: the file that is published, database.rules.json, spells every
// expression out (RTDB rules have no macros), and a hand-pasted copy of the same
// 400-character `SELF(...)` clause in forty places is exactly where a typo opens a
// door. So the blocks are written ONCE here, with the spec's macro names, and
//
//   node tests/rules-macros.js    rewrites the R1 blocks in database.rules.json
//   node tests/run.js rules       fails when the file differs from this source
//
// The existing blocks (state, config, members, chat, push …) are NOT generated: they
// stay byte-for-byte as published, and only the additive amendments are merged in.
// Junior and senior come out of the same functions, so they are identical modulo the
// root name by construction (rules.test.js still asserts it on the file).
//
// A rules edit is therefore: change this file, run it, run `node tests/run.js`, run the
// emulator suites (tests/emulator/README.md), then publish by the runbook.

'use strict';

const OWNER_KEY = 'patricksimpson,fx@gmail,com'; // == OWNER_MEMBER_KEY (app.js) == the members-immutability literal

function macros(R) {
  const P = (s) => '(' + s + ')'; // every composite macro expands inside parentheses
  const members = `root.child('${R}').child('members')`;
  const ekey = "auth.token.email.toLowerCase().replace('.', ',')";
  const byEmail = (tail) => `auth.token.email != null && auth.token.email_verified == true && ${members}.child(${ekey})${tail}`;
  const byPhone = (tail) => `auth.token.phone_number != null && ${members}.child(auth.token.phone_number)${tail}`;
  const EDITOR_TAIL = ".child('role').val() == 'editor'";
  const m = {};
  m.MEMBER = `auth != null && (${P(byEmail('.exists()'))} || ${P(byPhone('.exists()'))})`;
  m.EDITOR = `auth != null && (${P(byEmail(EDITOR_TAIL))} || ${P(byPhone(EDITOR_TAIL))})`;
  m.SELF = (x) => `auth != null && ((auth.token.email != null && auth.token.email_verified == true && ${x} === ${ekey}) || (auth.token.phone_number != null && ${x} === auth.token.phone_number))`;
  m.BRANCH = '!newData.isString() && !newData.isNumber() && !newData.isBoolean()';
  m.STR = (n) => `newData.isString() && newData.val().length <= ${n}`;
  m.NESTR = (n) => `${m.STR(n)} && newData.val().length >= 1`;
  m.INT = (a, b) => `newData.isNumber() && newData.val() >= ${a} && newData.val() <= ${b}`;
  m.EMOJI = `${m.NESTR(16)} && !newData.val().contains('<') && !newData.val().contains('>') && !newData.val().contains('&') && !newData.val().contains('"')`;
  m.DKRE = '/^(sun|mon|tue|wed|thu|fri|sat)$/';
  m.DK = '$dk.matches(' + m.DKRE + ')';
  // A record's anchor pair: after ANY write both must exist, so a field write into a
  // deleted record (or a {start,end} move of one) is refused instead of recreating half a block.
  m.ANCHOR = "newData.parent().child('start').exists() && newData.parent().child('label').exists()";
  // Patch leaves sit at patches/$dk/$bid/<field>: four .parent() calls reach `setup`; a teams/$tid
  // leaf is one level deeper, so five (the `teams` NODE itself is a field: four, never five).
  const panchor = (up) => {
    const SETUP = 'newData' + '.parent()'.repeat(up);
    const TYP = `${SETUP}.child('typical').child($bid)`;
    return `${m.DK} && ${TYP}.child('start').exists() && ${TYP}.child('label').exists() && ${SETUP}.child('days').child($dk).child('typical').val() === true`;
  };
  m.PANCHOR = panchor(4);
  // The team-flag LEAF carries the block anchor too (review of Step 10): its protection must not come
  // only from the ancestor `teams` node's validate, the very thing whose evaluation is in doubt live.
  m.ANCHOR_TID = "newData.parent().parent().child('start').exists() && newData.parent().parent().child('label').exists()";
  m.PANCHOR_TID = panchor(5);
  m.NOWKEEP = 'newData.isNumber() && (newData.val() === now || newData.val() === data.val())';
  m.SELFKEEP = `newData.val() === data.val() || ${P(m.SELF('newData.val()'))}`;
  m.OWNER = m.SELF(`'${OWNER_KEY}'`);
  m.OWNERKEEP = `newData.val() === data.val() || ${P(m.OWNER)}`;
  m.P = P;
  return m;
}

// ── setup/typical, dayBlocks, patches ────────────────────────────────────────
function blockShape(m, kind) {
  const { ANCHOR, PANCHOR, ANCHOR_TID, PANCHOR_TID, NESTR, INT, EMOJI, P } = m;
  const patch = kind === 'patch';
  const A = patch ? PANCHOR : ANCHOR;
  const A_TID = patch ? PANCHOR_TID : ANCHOR_TID;
  const startKey = '$bid.matches(/^b-[a-z0-9-]{1,36}$/)';
  const startHead = kind === 'dayBlock' ? `${m.DK} && ${startKey}` : startKey;
  const f = (expr) => ({ '.validate': expr });
  const out = {};
  if (!patch) out['.validate'] = "newData.hasChildren(['start', 'end', 'label', 'type'])"; // whole-record shape (defence in depth)
  else out['.validate'] = m.BRANCH;
  out.start = f(patch ? `${INT(0, 1439)} && ${A}` : `${startHead} && ${INT(0, 1439)} && ${A}`);
  out.end = f(patch
    ? `${INT(1, 1440)} && ${A}`
    : `${INT(1, 1440)} && ${A} && newData.val() > newData.parent().child('start').val()`);
  out.label = f(`${NESTR(120)} && ${A}`);
  out.emoji = f(`${EMOJI} && ${A}`);
  out.type = f(`${P("newData.val() === 'activity' || newData.val() === 'games' || newData.val() === 'elective'")} && ${A}`);
  out.slot = f(`${P('newData.val() === 0 || newData.val() === 1 || newData.val() === 2')} && ${A}`);
  out.noTime = f(`newData.isBoolean() && ${A}`);
  out.meal = f(`${P("newData.val() === 'breakfast' || newData.val() === 'lunch' || newData.val() === 'supper'")} && ${A}`);
  out.ord = f(`newData.isNumber() && ${A}`);
  if (!patch) out.alertKey = f(`newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/) && ${A}`);
  out.overlapOk = f(`newData.isBoolean() && ${A}`);
  if (kind !== 'typical') out.off = f(`newData.isBoolean() && ${A}`);
  out.teams = { '.validate': `newData.hasChildren() && ${A}`, $tid: f(`$tid.matches(/^t[0-9]$/) && newData.val() === true && ${A_TID}`) };
  out.$other = f(false);
  return out;
}

// ── the reveal's group (revealPublic pub/$g and revealFull g/$g share it) ────
function groupShape(m, extra) {
  const { INT, NESTR } = m;
  return {
    '.validate': `$g.matches(/^g[0-5]$/) && newData.hasChildren(['place', 'e'])${extra || ''}`,
    place: { '.validate': INT(1, 6) },
    e: {
      '.validate': 'newData.hasChildren()',
      $tid: {
        '.validate': "$tid.matches(/^t[0-5]$/) && newData.hasChildren(['nm', 'p', 'g', 's', 'b'])",
        nm: { '.validate': NESTR(30) },
        k: { '.validate': "newData.isString() && newData.val().matches(/^[a-z]{2,12}$/)" },
        p: { '.validate': INT(-9999, 99999) },
        g: { '.validate': INT(0, 99) },
        s: { '.validate': INT(0, 99) },
        b: { '.validate': INT(0, 99) },
        v: { '.validate': INT(-9999, 99999) },
        m: { '.validate': INT(-9999, 99999) },
        c: { '.validate': INT(-9999, 99999) },
        $other: { '.validate': false },
      },
    },
    $other: { '.validate': false },
  };
}

// The nodes R1 adds under a camp root, in the order they are written to the file.
function newBlocks(R) {
  const m = macros(R);
  const { MEMBER, EDITOR, SELF, BRANCH, STR, NESTR, INT, EMOJI, DK, NOWKEEP, SELFKEEP, OWNER, OWNERKEEP, P } = m;
  const v = (expr) => ({ '.validate': expr });
  const EDIT = P(EDITOR);
  const out = {};

  // ── setup ──────────────────────────────────────────────────────────────────
  out.setup = {
    '.read': MEMBER,
    '.write': EDITOR,
    '.validate': BRANCH,
    meta: {
      '.validate': BRANCH,
      schema: v(INT(1, 99)),
      on: { '.validate': BRANCH, // Q8: every value changes only by the owner (a whole-node write may carry it unchanged)
        $s: v(`$s.matches(/^(schedule|meals|verses|cleanup|electives)$/) && newData.isBoolean() && ${P(OWNERKEEP)}`) },
      seeded: { '.validate': "newData.hasChildren(['at', 'byKey', 'from'])",
        at: v('newData.isNumber() && newData.val() <= now'),
        byKey: v(SELFKEEP),
        from: v(STR(60)),
        $other: v(false) },
      weekStart: v('newData.isString() && newData.val().matches(/^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/)'),
      double: { '.validate': "newData.hasChildren(['fromDow', 'fromMin', 'toDow', 'toMin'])",
        fromDow: v(INT(0, 6)), fromMin: v(INT(0, 1439)), toDow: v(INT(0, 7)), toMin: v(INT(0, 1439)),
        $other: v(false) },
      finaleDow: v(INT(0, 6)),
      epoch: v(`newData.isString() && newData.val().matches(/^w20[0-9]{6}(-[2-9])?$/) && ${P(OWNERKEEP)}`),
      epochAt: v(`newData.isNumber() && newData.val() <= now && ${P(OWNERKEEP)}`),
      joinOpen: v('newData.isBoolean()'),
      skip: { '.validate': BRANCH,
        $s: v('$s.matches(/^(campers|meals|verses|cleanup|electives)$/) && newData.isBoolean()') },
      edited: { '.validate': BRANCH,
        $s: { '.validate': "$s.matches(/^(week|schedule|meals|verses|cleanup|electives)$/) && newData.hasChildren(['at', 'byKey'])",
          at: v(NOWKEEP),
          byKey: v(SELFKEEP),
          $other: v(false) } },
      // Q8: a claim is the owner's alone, so every leaf requires OWNER whenever it is written
      wizard: { '.validate': "newData.hasChildren(['step', 'byKey', 'at', 'fromEpoch'])",
        step: v(`${INT(1, 5)} && ${P(OWNER)}`),
        byKey: v(`${P(SELFKEEP)} && ${P(OWNER)}`),
        at: v(`${P(NOWKEEP)} && ${P(OWNER)}`),
        fromEpoch: v(`${NESTR(40)} && ${P(OWNER)}`), // 'legacy' for the legacy epoch, never ''
        archiveId: v(`newData.isString() && newData.val().matches(/^rp-[a-z0-9-]{4,48}$/) && ${P(OWNER)}`),
        answers: v(`${STR(2000)} && ${P(OWNER)}`), // JSON string: the step-1/2 answers
        $other: v(false) },
      $other: v(false),
    },
    days: { '.validate': BRANCH, $dk: {
      '.validate': `${DK} && newData.hasChildren(['typical'])`,
      typical: v('newData.isBoolean()'),
      tag: v(`${STR(60)} && newData.parent().child('typical').exists()`),
      placeholder: v("newData.isBoolean() && newData.parent().child('typical').exists()"),
      $other: v(false) } },
    typical: { '.validate': BRANCH, $bid: blockShape(m, 'typical') },
    dayBlocks: { '.validate': BRANCH, $dk: { '.validate': `${DK} && ${BRANCH}`, $bid: blockShape(m, 'dayBlock') } },
    patches: { '.validate': BRANCH, $dk: { '.validate': `${DK} && ${BRANCH}`, $bid: blockShape(m, 'patch') } },
    meals: { '.validate': BRANCH, $dk: { '.validate': `${DK} && ${BRANCH}`, $meal: {
      '.validate': "$meal.matches(/^(breakfast|lunch|supper)$/) && newData.hasChildren(['dish'])",
      dish: v(NESTR(80)),
      emoji: v(`${EMOJI} && newData.parent().child('dish').exists()`),
      $other: v(false) } } },
    verses: {
      '.validate': BRANCH,
      theme: { '.validate': "newData.hasChildren(['text'])",
        text: v(NESTR(600)),
        title: v(`${STR(80)} && newData.parent().child('text').exists()`),
        ref: v(`${STR(80)} && newData.parent().child('text').exists()`),
        $other: v(false) },
      days: { '.validate': BRANCH, $dk: {
        '.validate': `${DK} && newData.hasChildren(['text'])`,
        text: v(NESTR(600)),
        ref: v(`${STR(80)} && newData.parent().child('text').exists()`),
        video: v("newData.isString() && newData.val().length <= 300 && newData.val().beginsWith('https://') && newData.parent().child('text').exists()"),
        $other: v(false) } },
      $other: v(false),
    },
    cleanup: { '.validate': BRANCH, $dk: { '.validate': `${DK} && ${BRANCH}`, $meal: {
      '.validate': `$meal.matches(/^(breakfast|lunch|supper)$/) && ${BRANCH}`,
      $tid: v("$tid.matches(/^t[0-9]$/) && newData.val() === true") } } },
    electives: {
      '.validate': BRANCH,
      stations: { '.validate': BRANCH, $st: {
        '.validate': "$st.matches(/^st-[a-z0-9-]{1,36}$/) && newData.hasChildren(['name'])",
        name: v(NESTR(60)),
        emoji: v(`${EMOJI} && newData.parent().child('name').exists()`),
        $other: v(false) } },
      slots: { '.validate': BRANCH, $dk: { '.validate': `${DK} && ${BRANCH}`, $slot: {
        '.validate': `$slot.matches(/^s[0-2]$/) && ${BRANCH}`, $st: {
          '.validate': "$st.matches(/^st-[a-z0-9-]{1,36}$/) && newData.hasChildren(['ord'])",
          ord: v('newData.isNumber()'),
          people: { '.validate': BRANCH, $p: {
            '.validate': "$p.length <= 200 && newData.hasChildren(['name', 'ord'])",
            name: v(`${NESTR(60)} && newData.parent().child('ord').exists() && newData.parent().parent().parent().child('ord').exists()`),
            ord: v("newData.isNumber() && newData.parent().child('name').exists() && newData.parent().parent().parent().child('ord').exists()"),
            $other: v(false) } },
          $other: v(false) } } } },
      $other: v(false),
    },
    $other: v(false),
  };

  // ── campers (editor-only: minors' names) ───────────────────────────────────
  out.campers = {
    '.read': EDITOR,
    '.write': EDITOR,
    '.validate': BRANCH,
    $tid: {
      '.validate': `$tid.matches(/^t[0-9]$/) && ${BRANCH}`,
      $cid: {
        '.validate': "$cid.matches(/^c-[a-z0-9]{6,20}$/) && newData.hasChildren(['name', 'ord'])",
        name: v(`${NESTR(40)} && newData.parent().child('ord').exists()`), // anchor pair: a rename into a moved camper is refused
        ord: v("newData.isNumber() && newData.parent().child('name').exists()"),
        $other: v(false),
      },
    },
  };

  // ── teamPhotos (member-read crest images; the full charset regex stops a quote-breakout) ──
  out.teamPhotos = {
    '.read': MEMBER,
    $tid: {
      '.write': EDITOR,
      '.validate': "$tid.matches(/^t[0-9]$/) && newData.hasChildren(['v', 'data'])",
      v: v('newData.isNumber() && newData.val() >= 0'),
      data: v('newData.isString() && newData.val().length <= 100000 && newData.val().matches(/^data:image\\/(png|jpeg);base64,[A-Za-z0-9+\\/]+={0,2}$/)'),
      $other: v(false),
    },
  };

  // ── accessRequests (the only node a NON-member can write: closed unless setup/meta/joinOpen) ──
  const joinOpen = `root.child('${R}').child('setup').child('meta').child('joinOpen').val() === true`;
  out.accessRequests = {
    '.read': EDITOR,
    '.indexOn': ['at'],
    $reqKey: {
      '.read': SELF('$reqKey'),
      '.write': `(${P(SELF('$reqKey'))} && newData.exists() && newData.child('at').val() === now && ${joinOpen} && !root.child('${R}').child('accessBlocked').child($reqKey).exists() && !${P(MEMBER)} && (!data.exists() || data.child('at').val() < now - 60000)) || (!newData.exists() && (${EDIT} || (${P(SELF('$reqKey'))} && data.child('at').val() < now - 60000)))`,
      '.validate': "($reqKey.contains('@') || $reqKey.beginsWith('+')) && $reqKey.length <= 200 && newData.hasChildren(['name', 'at'])",
      name: v(NESTR(60)),
      note: v(STR(200)),
      at: v('newData.isNumber() && newData.val() === now'),
      $other: v(false),
    },
  };
  out.accessBlocked = {
    '.read': EDITOR,
    $k: {
      '.write': EDITOR,
      '.validate': "($k.contains('@') || $k.beginsWith('+')) && $k.length <= 200 && newData.hasChildren(['at', 'byKey'])",
      at: v('newData.isNumber() && newData.val() <= now'),
      byKey: v(SELFKEEP),
      $other: v(false),
    },
  };

  // ── restore points: an archive, a pre-wizard point or a pinned one can't be deleted ──
  const rIdx = (f) => `root.child('${R}').child('restoreIndex').child($rid).child('${f}').val()`;
  out.restoreIndex = {
    '.read': EDITOR,
    $rid: {
      '.write': `${EDIT} && (!data.exists() || (!newData.exists() && data.child('kind').val() !== 'archive' && data.child('kind').val() !== 'pre-wizard' && data.child('pinned').val() !== true))`,
      '.validate': "$rid.matches(/^rp-[a-z0-9-]{4,48}$/) && newData.hasChildren(['at', 'byKey', 'kind', 'label', 'bytes', 'hash'])",
      at: v('newData.isNumber() && newData.val() === now'),
      byKey: v(SELF('newData.val()')),
      kind: v(`newData.isString() && newData.val().matches(/^(auto|manual|pre-seed|pre-delete|pre-import|pre-restore|pre-wizard|archive)$/) && ((newData.val() !== 'archive' && newData.val() !== 'pre-wizard') || newData.val() === data.val() || ${P(OWNER)})`), // Q8
      label: v(NESTR(120)),
      note: v(STR(200)),
      bytes: v(INT(0, 900000)),
      hash: v('newData.isString() && newData.val().matches(/^[0-9a-f]{8}$/)'),
      epoch: v(STR(40)),
      pinned: { '.write': `${EDIT} && !data.exists() && newData.val() === true`,
        '.validate': "newData.isBoolean() && newData.parent().child('at').exists()" },
      $other: v(false),
    },
  };
  out.restoreBody = {
    '.read': EDITOR,
    $rid: {
      '.write': `${EDIT} && (!data.exists() || (!newData.exists() && ${rIdx('kind')} !== 'archive' && ${rIdx('kind')} !== 'pre-wizard' && ${rIdx('pinned')} !== true))`,
      '.validate': '$rid.matches(/^rp-[a-z0-9-]{4,48}$/) && newData.isString() && newData.val().length <= 900000',
    },
  };

  // ── editorsHere (the builder's "also here" row; editor-only both ways) ─────
  out.editorsHere = {
    '.read': EDITOR,
    $k: { $d: {
      '.write': `${P(SELF('$k'))} && (!newData.exists() || (${EDIT} && (!data.exists() || data.child('at').val() < now - 1000)))`,
      '.validate': "$d.matches(/^[A-Za-z0-9_-]{8,64}$/) && newData.hasChildren(['at', 'v'])",
      at: v('newData.isNumber() && newData.val() === now'),
      v: v(INT(0, 99999)),
      where: v("newData.isString() && newData.val().matches(/^[a-z0-9:_-]{1,60}$/)"),
      $other: v(false),
    } },
  };

  // ── the standings reveal (redesign §4.4). revealPublic/.read is the ONE anonymous-read path ──
  const SHOWN = "newData.parent().parent().child('ctl').child('shown').val()";
  const ctlNew = (f) => `newData.child('${f}').val()`;
  const ctlOld = (f) => `data.child('${f}').val()`;
  const sameAsOld = (f) => `${ctlNew(f)} === ${ctlOld(f)}`;
  const place = (g, n) => `($g === '${g}' && ${SHOWN} >= ${n})`;
  out.revealPublic = {
    '.read': true, // ★ `.read` cascades DOWN only: <root>, state, members, revealFull … all still need membership
    // An editor may start, drive, replace or end a reveal. DELETING the real reveal is allowed only once its
    // `until` (08:00 next day) has passed on the SERVER's clock, so a wrong phone clock or a buggy client can't
    // erase counselors' grid early; OWNER (the new-year wizard) may clear it at any time. Deleting `practice`
    // is never restricted. LIMIT, recorded not hidden (owner-visible in CLAUDE.md): this guards the NODE, not
    // its places — a director can still delete one shown place (or `pub`) mid-reveal. The same director can
    // Start a replacement at any time, so a per-group delete guard would only cover a client bug, at the price
    // of a ~1 KB expression plus a "new id" exception; reveal.mjs pins the behaviour so a change is noticed.
    '.write': `${EDIT} && (!data.child('real').exists() || newData.child('real').exists() || data.child('real').child('ctl').child('until').val() <= now || ${P(OWNER)})`,
    // anonymous readers download this node whole, so a scalar (a multi-megabyte string) must never land
    // at it or at `pub`: BRANCH here, on pub, and on revealFull / its `g` (the $mode level demands ctl / r)
    '.validate': BRANCH,
    $mode: {
      '.validate': "$mode.matches(/^(real|practice)$/) && newData.hasChildren(['ctl'])",
      ctl: {
        '.validate': "newData.hasChildren(['v', 'id', 'seq', 'phase', 'cur', 'shown', 'teams', 'finale', 'at', 'sa', 'ca', 'startedAt', 'until'])"
          + ` && ${ctlNew('cur')} < ${ctlNew('shown')}`
          + ` && ((data.exists() && ${sameAsOld('id')})`
          + ` ? (${ctlNew('seq')} === ${ctlOld('seq')} + 1`
          + ` && ${ctlOld('phase')} !== 'ended'`
          + ` && ${ctlNew('shown')} >= ${ctlOld('shown')}`
          + ` && ${ctlNew('shown')} <= ${ctlOld('shown')} + 1`
          + ` && (${ctlNew('shown')} > ${ctlOld('shown')} ? ${ctlNew('sa')} === now : ${sameAsOld('sa')})`
          + ` && ${sameAsOld('ca')} && ${sameAsOld('startedAt')} && ${sameAsOld('until')} && ${sameAsOld('finale')})`
          // a Start leaves no place of an earlier reveal behind: a client that writes only `ctl` (not the
          // whole node, spec 4.5) can't carry the previous reveal's places under a fresh ctl with shown 0
          + ` : (${ctlNew('seq')} === 1 && ${ctlNew('shown')} === 0 && ${ctlNew('phase')} === 'intro'`
          + ` && ${ctlNew('startedAt')} === now && ${ctlNew('sa')} === now`
          + ` && ${ctlNew('ca')} > now - 60000 && ${ctlNew('ca')} <= now + 60000`
          + ` && !newData.parent().child('pub').exists()))`,
        v: v(INT(1, 9)),
        id: v('newData.isString() && newData.val().matches(/^r[a-z0-9]{6,12}-[a-z0-9]{4}$/)'),
        seq: v(INT(1, 9999)),
        phase: v('newData.isString() && newData.val().matches(/^(intro|live|champion|table|ended)$/)'),
        cur: v(INT(-1, 5)),
        shown: v(INT(0, 6)),
        teams: v(INT(2, 6)),
        finale: v('newData.isBoolean()'),
        at: v('newData.isNumber() && newData.val() === now'),
        sa: v('newData.isNumber() && newData.val() <= now'),
        ca: v('newData.isNumber()'),
        startedAt: v(NOWKEEP),
        until: v("newData.isNumber() && (newData.val() === data.val() || (newData.val() > now && newData.val() <= now + ($mode === 'practice' ? 10800000 : 172800000)))"),
        endedAt: v(NOWKEEP),
        endKind: v('newData.isString() && newData.val().matches(/^(done|early)$/)'),
        epoch: v(STR(24)),
        $other: v(false), // no startedBy, no by, no member key of any kind
      },
      pub: { '.validate': BRANCH, $g: groupShape(m, " && (!data.exists() || newData.parent().parent().child('ctl').child('id').val() !== data.parent().parent().child('ctl').child('id').val())"
        + ` && (${place('g0', 1)} || ${place('g1', 2)} || ${place('g2', 3)} || ${place('g3', 4)} || ${place('g4', 5)} || ${place('g5', 6)})`) },
      $other: v(false),
    },
  };
  out.revealFull = {
    '.read': EDITOR,
    '.write': EDITOR,
    '.validate': BRANCH,
    $mode: {
      '.validate': "$mode.matches(/^(real|practice)$/) && newData.hasChildren(['r', 'n', 'frozenAt', 'startedBy', 'g'])"
        + " && newData.child('r').val() === newData.parent().parent().child('revealPublic').child($mode).child('ctl').child('id').val()",
      r: v('newData.isString() && newData.val().matches(/^r[a-z0-9]{6,12}-[a-z0-9]{4}$/)'),
      n: v(INT(1, 6)),
      frozenAt: v(NOWKEEP),
      lastScoreAt: v('newData.isNumber() && newData.val() <= now'),
      startedBy: v(SELFKEEP),
      g: { '.validate': BRANCH, $g: groupShape(m) },
      $other: v(false),
    },
  };
  return out;
}

// Additive amendments to blocks that already exist (setup-rebuild-spec §8.3). Each is a
// list of [path-inside-the-camp-block, node] merged in WITHOUT touching what is there.
function amendments(R) {
  const m = macros(R);
  const { EMOJI, NESTR, P, OWNERKEEP } = m;
  const v = (expr) => ({ '.validate': expr });
  return [
    // the new optional sync key (the 4-team bracket, Step 22)
    [['state', 'brackets4'], v(m.BRANCH)],
    // new OPTIONAL branding fields only: id, name and counselor stay unvalidated and there is no
    // $other:false, so a v183 whole-array `teams` write (which carries none of these) is still accepted
    [['state', 'teams', '$i'], {
      emoji: v(`${EMOJI} && !newData.val().contains("'")`),
      short: v(`${NESTR(20)} && !newData.val().contains('<') && !newData.val().contains('>') && !newData.val().contains('&') && !newData.val().contains('"')`),
      color: v('newData.isString() && newData.val().matches(/^[a-z]{2,12}$/)'),
      photoV: v('newData.isNumber() && newData.val() >= 0'),
    }],
    // the epoch pair is owner-only (decision Q8); no $other:false under meta, so old builds' fields stay valid
    [['state', 'meta', 'epoch'], v(`newData.isString() && newData.val().matches(/^w20[0-9]{6}(-[2-9])?$/) && ${P(OWNERKEEP)}`)],
    [['state', 'meta', 'epochAt'], v(`newData.isNumber() && newData.val() <= now && ${P(OWNERKEEP)}`)],
    // pushSchedule — two new OPTIONAL children
    [['pushSchedule', 'rev'], v('newData.isNumber() && newData.val() >= 0')],
    [['pushSchedule', 'src'], v('newData.isString() && newData.val().matches(/^[0-9a-f]{8}$/)')],
  ];
}

// Apply R1 to a parsed ruleset (idempotent: setting a node twice gives the same tree).
function applyR1(rulesFile) {
  const out = JSON.parse(JSON.stringify(rulesFile));
  ['campScoreboard', 'seniorScoreboard'].forEach((R) => {
    const camp = out.rules[R];
    const blocks = newBlocks(R);
    Object.keys(blocks).forEach((k) => { camp[k] = blocks[k]; });
    amendments(R).forEach(([path, node]) => {
      let at = camp;
      path.slice(0, -1).forEach((k) => { at = at[k]; });
      const last = path[path.length - 1];
      // an amendment adds children beside what is there (`$i` is a NEW wildcard under teams);
      // `$other` stays the last key of its block, where a reader of the file expects it
      at[last] = Object.assign(at[last] || {}, node);
      if (at.$other && last !== '$other') { const o = at.$other; delete at.$other; at.$other = o; }
    });
  });
  return out;
}

module.exports = { OWNER_KEY, macros, newBlocks, amendments, applyR1, blockShape, groupShape };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', 'database.rules.json');
  const next = applyR1(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log('database.rules.json rewritten with the R1 blocks (' + fs.statSync(file).size + ' bytes)');
}
