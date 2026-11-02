// The fidelity comparison for export-replay.mjs: two snapshots of what the camp reads from the week (replay-page.js
// rrSnapshot — flat { key: string }), before and after Edit the week here, diffed key by key. The ONLY differences
// allowed are the documented intended ones below, each a named matcher that claims the exact keys it explains;
// everything else is a FINDING. Pure Node: no emulator, no app.
//
// A matcher is deliberately narrow (a camp, a weekday, a block, the shape of the change), so it cannot excuse
// unrelated drift. When the printed week in camps.js changes, update the matchers with it.

const DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const j = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };

// ── readable output, with no email, phone number or chat in it ─────────────────────────────────────────────────
// A diff is printed to a terminal and may be pasted somewhere: emails and phone numbers (an elective's member key,
// a member-derived name) are replaced, and long lines cut. Not everything personal can be caught by a pattern: a
// difference the matchers cannot explain is printed as the text the camp reads, so it can name a game, a dish, a
// verse, an elective station or a counselor. Chat is never loaded into the client at all (replay-client.mjs LOAD_KEYS).
export function redact(s) {
  return String(s).replace(/[\w.+-]+@[\w-]+(?:[.,][\w-]+)+/g, '‹member›').replace(/\+\d{7,15}/g, '‹phone›');
}
export function scrub(s, max = 170) {
  const t = redact(s).replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Two long strings that differ: a window around the first place they do, so the difference itself is on screen.
function around(a, b, width = 70) {
  a = String(a); b = String(b);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (x) => (x.length <= width * 2 + 20 ? x : (i > width ? '…' : '') + x.slice(Math.max(0, i - width), i + width) + (x.length > i + width ? '…' : ''));
  return [scrub(cut(a), 400), scrub(cut(b), 400)];
}
const finding = (key, a, b, why) => { const [x, y] = around(a, b); return { key, before: x, after: y, why: why || '' }; };

// A line saying what kind of thing differs and how many ("banner ×460, sheet ×1"): the first screenful of a long list
// of findings is otherwise all one kind.
export function summarize(findings) {
  const by = {};
  findings.forEach((f) => { const k = f.key.split('/')[0].split(' ')[0]; by[k] = (by[k] || 0) + 1; });
  return Object.keys(by).map((k) => k + ' ×' + by[k]).join(', ');
}

// ── calendar files ─────────────────────────────────────────────────────────────────────────────────────────────
export function icsParse(text) {
  const lines = String(text || '').replace(/\r\n[ \t]/g, '').split('\r\n').filter((l) => l !== '');
  const head = [], tail = [], events = [];
  let cur = null;
  lines.forEach((l) => {
    if (l === 'BEGIN:VEVENT') { cur = []; return; }
    if (l === 'END:VEVENT') { events.push(cur); cur = null; return; }
    if (cur) cur.push(l); else (events.length ? tail : head).push(l);
  });
  return { head, tail, events };
}
const prop = (lines, name) => lines.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';')) || '';
const icsMinutes = (dtstart) => { const m = /T(\d\d)(\d\d)\d\d$/.exec(dtstart); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const icsDate = (dtstart) => { const m = /:(\d{4})(\d\d)(\d\d)T/.exec(dtstart); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const unesc = (s) => String(s).replace(/\\n/gi, ' ').replace(/\\(.)/g, '$1');

// ── the matchers ───────────────────────────────────────────────────────────────────────────────────────────────
// compare(before, after, { camp: 'junior'|'senior', weekStart }) -> { diffs, matched: {name: count}, findings: [...] }
export function compare(before, after, ctx) {
  const camp = ctx.camp;
  const keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).sort();
  const diffs = keys.filter((k) => before[k] !== after[k]);
  const claimed = new Map(); // key -> matcher name
  const matched = {};
  const claim = (key, name) => { claimed.set(key, name); matched[name] = (matched[name] || 0) + 1; };
  const game = (snap, id) => j(snap['game/' + id]) || {};
  const idOf = (entry) => String(entry).split(' ')[0];
  const nameOf = (entry) => String(entry).slice(String(entry).indexOf(' ') + 1);
  const ownSet = new Set(diffs);
  const why = {}; // key -> the reason a matcher that looked at it still could not explain it
  const allowedBlocks = new Map(); // `${dow} ${start}` -> { before: [names], after: [names], name }
  const placedNow = new Set();     // game ids a matched block change newly lists
  const nameAdded = {};            // dow -> ids the name rule newly lists on an item

  // 1. The schedule switch itself.
  if (ownSet.has('shared') && before.shared === 'false' && after.shared === 'true') claim('shared', 'schedule edited here (the switch)');

  // 2. Which games a block lists. Built in, the rule is "a games block holds that weekday's Morning games if it starts
  //    before noon, else its Evening ones"; once the schedule is edited here it is the game's own link (A2).
  diffs.filter((k) => k.startsWith('block-games/')).forEach((k) => {
    const m = /^block-games\/(\d)\/(\d+) (\d+) (.*)$/.exec(k);
    if (!m) return;
    const dow = Number(m[1]), start = Number(m[3]), label = m[4];
    const b = (j(before[k]) || []), a = (j(after[k]) || []);
    const bIds = b.map(idOf), aIds = a.map(idOf);
    let name = null;
    if (camp === 'senior' && dow >= 1 && dow <= 5 && ((start === 900 && label === 'Team competitions') || (start === 1010 && label === 'Legacy Game'))
      && aIds.length && aIds.every((id) => game(after, id).session === 'Afternoon') && bIds.every((id) => game(before, id).session === 'Evening')) {
      name = 'senior: the Afternoon games sit on their own blocks (3:00 PM Team competitions, 4:50 PM Legacy Game) and no longer show the Evening pair';
    }
    // (the game's id is stable, its name is a director's to edit)
    if (camp === 'junior' && dow === 5 && label === 'Team Skits' && !b.length && a.length && a.every((e) => /^team-skits/.test(idOf(e)) || /skits/i.test(nameOf(e)))) {
      name = "junior: Friday's Team Skits item lists the Team Skits game";
    }
    // A2's own name rule: a game whose name is the item's name (or sits inside a games item's name) goes on that item.
    // Pure additions only; every added game must carry the item's name.
    const nk = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const head = label.split(' — ')[0].split(' (')[0];
    if (!name && aIds.length && bIds.every((id) => aIds.includes(id)) && aIds.some((id) => !bIds.includes(id))
      && aIds.filter((id) => !bIds.includes(id)).every((id) => nk(head).includes(nk(nameOf(a[aIds.indexOf(id)]))) && nk(nameOf(a[aIds.indexOf(id)])).length >= 4)) {
      name = 'a game is listed on the schedule item that carries its name (A2\'s name rule)';
    }
    if (!name) return;
    if (name.startsWith('a game is listed')) aIds.filter((id) => !bIds.includes(id)).forEach((id) => { (nameAdded[dow] = nameAdded[dow] || new Set()).add(id); });
    claim(k, name);
    allowedBlocks.set(dow + ' ' + start, { before: b.map(nameOf), after: a.map(nameOf), name });
    aIds.forEach((id) => { if (!bIds.includes(id)) placedNow.add(id); });
  });
  // ...and the same game, on the block its session put it on while the schedule was built in, is no longer listed there.
  diffs.filter((k) => k.startsWith('block-games/') && !claimed.has(k)).forEach((k) => {
    const m = /^block-games\/(\d)\/(\d+) (\d+) (.*)$/.exec(k);
    if (!m) return;
    const dow = Number(m[1]), start = Number(m[3]);
    const b = (j(before[k]) || []), a = (j(after[k]) || []);
    const removed = b.map(idOf).filter((id) => !a.map(idOf).includes(id));
    const added = a.map(idOf).filter((id) => !b.map(idOf).includes(id));
    if (removed.length && !added.length && removed.every((id) => nameAdded[dow] && nameAdded[dow].has(id))) {
      const name = "a game that is listed on the item carrying its name is no longer listed on the block its session put it on (A2's name rule)";
      claim(k, name);
      allowedBlocks.set(dow + ' ' + start, { before: b.map(nameOf), after: a.map(nameOf), name });
    }
  });

  // 3. "On no block" shrinks by exactly the games a matched block change newly lists.
  diffs.filter((k) => k.startsWith('unscheduled/')).forEach((k) => {
    const b = j(before[k]) || [], a = j(after[k]) || [];
    const removed = b.filter((id) => !a.includes(id)), added = a.filter((id) => !b.includes(id));
    if (!added.length && removed.length && removed.every((id) => placedNow.has(id))) claim(k, 'games that were on no block are now placed (the same games the block changes list)');
  });

  // 4. The schedule sheet: the same timeline, only the game chips differ, on a day that has a matched block change.
  const stripChips = (h) => String(h).replace(/<div class="sched-games">[\s\S]*?<\/div>/g, '');
  diffs.filter((k) => k.startsWith('sheet/')).forEach((k) => {
    const dow = Number(k.split('/')[1]);
    const dayHasChange = Array.from(allowedBlocks.keys()).some((x) => Number(x.split(' ')[0]) === dow);
    if (dayHasChange && stripChips(before[k]) === stripChips(after[k])) claim(k, 'the schedule sheet differs only in the game chips of a changed block');
  });

  // 5. Calendar files: UIDs become block ids, the description names the games a changed block now holds.
  const camps = camp;
  const uidOk = (b, a, dated) => {
    const bu = b.replace(/^UID:/, ''), au = a.replace(/^UID:/, '');
    const tail = '@camp.patricksimpson.info';
    if (!bu.endsWith(tail) || !au.endsWith(tail)) return false;
    const bx = bu.slice(0, -tail.length), ax = au.slice(0, -tail.length);
    if (dated) {
      const bm = new RegExp('^' + camps + '-(\\d{4}-\\d\\d-\\d\\d)-(' + DK.join('|') + ')-(\\d+)-(\\d+)$').exec(bx);
      const am = new RegExp('^' + camps + '-(\\d{4}-\\d\\d-\\d\\d)-(' + DK.join('|') + ')-(b-[a-z0-9-]+)$').exec(ax);
      return !!(bm && am && bm[1] === am[1] && bm[2] === am[2]);
    }
    const bm = new RegExp('^' + camps + '-(\\d)-(\\d+)-(\\d+)$').exec(bx);
    const am = new RegExp('^' + camps + '-(\\d)-(b-[a-z0-9-]+)$').exec(ax);
    return !!(bm && am && bm[1] === am[1]);
  };
  const icsExplain = (k, dated, dowFixed) => {
    const b = icsParse(before[k]), a = icsParse(after[k]);
    if (b.head.join('\n') !== a.head.join('\n') || b.tail.join('\n') !== a.tail.join('\n') || b.events.length !== a.events.length) return 'the file header or the number of events changed';
    let uids = 0, descs = 0;
    for (let i = 0; i < b.events.length; i++) {
      const be = b.events[i], ae = a.events[i];
      const names = new Set(be.map((l) => l.split(/[:;]/)[0]).concat(ae.map((l) => l.split(/[:;]/)[0])));
      for (const p of names) {
        const bl = prop(be, p), al = prop(ae, p);
        if (bl === al) continue;
        if (p === 'UID' && uidOk(bl, al, dated)) { uids++; continue; }
        if (p === 'DESCRIPTION') {
          // which block is this? weekday from the date (dated) or the key (legacy), start from DTSTART
          const dt = prop(ae, 'DTSTART');
          let dow = dowFixed;
          if (dow === undefined && ctx.weekStart) { const [y, mo, d] = ctx.weekStart.split('-').map(Number); dow = Math.round((icsDate(dt) - Date.UTC(y, mo - 1, d)) / 86400000); }
          const hit = allowedBlocks.get(dow + ' ' + icsMinutes(dt));
          if (!hit) return 'the description of the event at ' + icsMinutes(dt) + ' on day ' + dow + ' changed, and no block change explains it';
          const bt = unesc(bl), at = unesc(al);
          if (hit.after.every((n) => at.includes(unesc(n))) && hit.before.every((n) => bt.includes(unesc(n))) && (hit.after.length || !al)) { descs++; continue; }
          return 'the description of the event at ' + icsMinutes(dt) + ' on day ' + dow + ' does not list the games the block change says';
        }
        return 'a ' + p + ' line changed: ' + scrub(bl, 70) + '  =>  ' + scrub(al, 70);
      }
    }
    return { uids, descs };
  };
  diffs.filter((k) => k.startsWith('ics-')).forEach((k) => {
    const dated = !k.startsWith('ics-day-legacy/') || after['ics-legacy-dated'] === 'true';
    const dowFixed = /\/(\d)$/.test(k) ? Number(k.split('/')[1]) : undefined;
    const r = icsExplain(k, dated, dowFixed);
    if (typeof r === 'string') { why[k] = r; return; }
    claim(k, 'calendar files: UIDs follow block ids' + (r.descs ? ', descriptions list the placed games' : ''));
  });

  // 6. The alert publisher: ids change format (d<dow>-<start>-<position> -> <dk>-<block id>); the blocks, labels,
  //    times and keys themselves (the push-block/ keys) are compared equal above and are NOT in this list.
  if (ownSet.has('push-block-ids')) {
    const b = j(before['push-block-ids']) || [], a = j(after['push-block-ids']) || [];
    if (b.length && b.length === a.length && b.every((id) => /^d[0-6]-\d+-\d+$/.test(id)) && a.every((id) => /^(sun|mon|tue|wed|thu|fri|sat)-b-[a-z0-9-]{1,36}$/.test(id) && id.length <= 40)) {
      claim('push-block-ids', 'alert publisher: block ids change format (d<dow>-<start>-<pos> to <day>-<block id>)');
      if (ownSet.has('push-src')) claim('push-src', 'alert publisher: the content hash follows the ids');
    }
  }

  // 7. Senior's lunch is at 12:30 in its printed schedule; built in, "Lunch" always started at 12:00.
  diffs.filter((k) => /^meal-start\/[1-5]\/Lunch$/.test(k)).forEach((k) => {
    const dow = Number(k.split('/')[1]);
    const lunch = (j(after['schedule/' + dow]) || []).find((b) => /^Lunch\b/.test(b.label));
    if (camp === 'senior' && before[k] === '720' && after[k] === '750' && lunch && lunch.start === 750) claim(k, "senior: mealStart for Lunch becomes 12:30 (the schedule item's own start)");
  });

  // 8. Electives (junior): a station's row gains the third list, the member key behind each name ('' for a typed one).
  diffs.filter((k) => /^electives\/\d$/.test(k)).forEach((k) => {
    const b = j(before[k]), a = j(after[k]);
    if (!Array.isArray(b) || !Array.isArray(a) || b.length !== a.length) return;
    const same = a.every((slot, s) => Array.isArray(slot) && slot.length === (b[s] || []).length && slot.every((row, r) => {
      const was = b[s][r];
      return Array.isArray(row) && Array.isArray(row[2]) && row[2].length === row[1].length && row[2].every((x) => typeof x === 'string')
        && JSON.stringify([row[0], row[1]]) === JSON.stringify([was[0], was[1]]);
    }));
    if (camp === 'junior' && same) claim(k, 'junior electives: each station row gains its member-key list (names and stations unchanged)');
  });

  // 9. staffNames gains the stations' typed game-leader names (people on an elective who are on no team).
  if (ownSet.has('staff')) {
    const b = j(before.staff) || [], a = j(after.staff) || [];
    const onStations = new Set();
    Object.keys(after).filter((k) => /^electives\/\d$/.test(k)).forEach((k) => (j(after[k]) || []).forEach((slot) => (slot || []).forEach((row) => (row[1] || []).forEach((n) => onStations.add(n)))));
    const added = a.filter((n) => !b.includes(n));
    if (camp === 'junior' && added.length && JSON.stringify(a.filter((n) => b.includes(n))) === JSON.stringify(b) && added.every((n) => onStations.has(n))) {
      claim('staff', "junior: staffNames gains the elective stations' typed game-leader names (" + added.length + ')');
    }
  }

  const findings = [];
  diffs.forEach((k) => {
    if (claimed.has(k)) return;
    findings.push(finding(k, before[k], after[k], why[k] ? '  (' + why[k] + ')' : ''));
  });
  return { total: keys.length, diffs: diffs.length, matched, findings };
}

// Strict equality of two snapshots (the rollback): every key, byte for byte.
export function equalSnapshots(a, b) {
  const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
  const bad = keys.filter((k) => a[k] !== b[k]);
  return { total: keys.length, findings: bad.map((k) => finding(k, a[k], b[k])) };
}

// The matchers a run is expected to claim at least once: a comparison that explains nothing means the "after" client
// never saw the edited week, which is a broken harness, not a clean result.
export const REQUIRED_MATCHERS = ['schedule edited here (the switch)'];
export const REQUIRED_PREFIXES = ['calendar files: UIDs follow block ids', 'alert publisher: block ids change format'];
