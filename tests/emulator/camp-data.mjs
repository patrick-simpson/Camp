// The real camp data, for the emulator suites: loads defaults.js + camp-core.js + camps.js
// into a vm (as tests/harness.js does, minus the app) for either camp, and builds a
// `setup` seed tree from it by the rules of setup-rebuild-spec §10.2.
//
// This is a TEST FIXTURE of the seed, written before the real `buildSeed` exists (BUILD-PLAN
// Step 15). It exists so R1 is proven against the actual week — junior's Tue/Thu/Fri team
// patches and one-offs, senior's 100%-typical days and placeholder stubs — and not only
// against hand-made records. When Step 15 lands, its output replaces this function's.
import { readFileSync } from 'fs';
import vm from 'vm';

const ROOT = new URL('../../', import.meta.url);
const DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const json = (x) => JSON.parse(JSON.stringify(x));

export function loadCamp(id) {
  const ctx = vm.createContext({ CAMP_FORCE: id, window: {}, console, localStorage: { getItem: () => null } });
  ['defaults.js', 'camp-core.js', 'camps.js'].forEach((f) => vm.runInContext(readFileSync(new URL(f, ROOT), 'utf8'), ctx, { filename: f }));
  return json(vm.runInContext('({ camp: CAMP, config: CAMP.defaultConfig() })', ctx));
}

// pushHeadLabel / pushBlockKey (push.js), verbatim in behaviour
const head = (label) => {
  const cuts = [label.indexOf(' — '), label.indexOf(' (')].filter((i) => i >= 0);
  return (cuts.length ? label.slice(0, Math.min(...cuts)) : label).trim();
};
const slug = (s, n) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, n).replace(/^-+|-+$/g, '');
const alertKey = (label) => slug(head(label), 48) || 'block';
const mealOf = (label) => { const m = /^(breakfast|lunch|supper)\b/i.exec(head(label)); return m ? m[1].toLowerCase() : null; };

// Team group in the morning-meeting tail ("— 🦃 Turkey, 🍁 Maples & 🚜 John Deeres") -> a teams map
function teamsOfTail(camp, label) {
  const tail = label.includes(' — ') ? label.slice(label.indexOf(' — ') + 3) : '';
  const ids = Object.keys(camp.teamAbbrev).filter((t) => tail.includes(camp.teamEmoji[t] + ' ' + camp.teamAbbrev[t]));
  return ids.length && /^(?:.+?)(?:, | & |$)/.test(tail) && ids.length >= 2 && label.startsWith('Rising bell') ? ids : null;
}

export function buildSeed(id) {
  const { camp } = loadCamp(id);
  const sched = camp.daySchedule;
  const mk = (b, prefix, i, ord) => {
    const base = { start: b.start, end: b.end, label: b.label, emoji: b.emoji, type: b.type };
    if (b.slot !== undefined) base.slot = b.slot;
    if (b.noTime) base.noTime = true;
    const meal = mealOf(b.label);
    if (meal) base.meal = meal;
    base.ord = ord;
    return base;
  };
  const idOf = (prefix, b, taken) => {
    let bid = 'b-' + prefix + slug(head(b.label), 24) + '-' + b.start, n = 2;
    while (taken.has(bid)) bid = 'b-' + prefix + slug(head(b.label), 24) + '-' + b.start + '-' + n++;
    taken.add(bid);
    return bid;
  };
  const setup = { meta: { schema: 1, on: {}, weekStart: '2027-07-18' }, days: {}, typical: {}, patches: {}, dayBlocks: {} };

  // typical day = Monday, re-keyed; teams converted where the tail reproduces
  const typical = sched[1].map((b, i) => ({ b, i }));
  const tIds = new Set();
  const typicalIds = typical.map(({ b, i }) => {
    const bid = idOf('', b, tIds);
    const rec = mk(b, '', i, 10 * i);
    rec.alertKey = alertKey(b.label);
    const teams = teamsOfTail(camp, b.label);
    if (teams) { rec.label = head(b.label); rec.teams = Object.fromEntries(teams.map((t) => [t, true])); }
    setup.typical[bid] = rec;
    return bid;
  });

  camp.schedDays.forEach(({ dow, tag }) => {
    const dk = DK[dow];
    const blocks = sched[dow] || [];
    const day = { typical: false, tag };
    if (dow >= 1 && dow <= 5 && id === 'junior' || (id === 'senior' && dow >= 1 && dow <= 5)) day.typical = true;
    if (id === 'senior' && (dow === 0 || dow === 6)) day.placeholder = true;
    setup.days[dk] = day;
    if (!day.typical) {
      const taken = new Set();
      setup.dayBlocks[dk] = {};
      blocks.forEach((b, i) => {
        const bid = idOf(dk + '-', b, taken);
        const rec = mk(b, dk + '-', i, 10 * i);
        rec.alertKey = alertKey(b.label);
        const teams = teamsOfTail(camp, b.label);
        if (teams) { rec.label = head(b.label); rec.teams = Object.fromEntries(teams.map((t) => [t, true])); }
        setup.dayBlocks[dk][bid] = rec;
      });
      return;
    }
    if (dow === 1) return;
    // Tue–Fri: match each block to an UNUSED typical block (same start/end/type/slot/noTime and head label)
    const used = new Set();
    const patches = {};
    const oneOffs = {};
    blocks.forEach((b, i) => {
      const hit = typical.find(({ b: t }, k) => !used.has(typicalIds[k]) && t.start === b.start && t.end === b.end && t.type === b.type
        && t.slot === b.slot && !!t.noTime === !!b.noTime && head(t.label) === head(b.label));
      if (!hit) {
        const next = typical.find(({ b: t }) => t.start >= b.start && t.start !== b.start) || null;
        const bid = idOf(dk + '-', b, new Set(Object.keys(oneOffs)));
        const rec = mk(b, dk + '-', i, next ? setup.typical[typicalIds[typical.indexOf(next)]].ord - 5 : 10 * blocks.length);
        rec.alertKey = alertKey(b.label);
        if (id === 'junior' && b.start === 1275) rec.overlapOk = true;
        oneOffs[bid] = rec;
        return;
      }
      const tid = typicalIds[typical.indexOf(hit)];
      used.add(tid);
      const diff = {};
      const t = setup.typical[tid];
      const teams = teamsOfTail(camp, b.label);
      const label = teams ? head(b.label) : b.label;
      if (label !== t.label) diff.label = label;
      if (b.emoji !== t.emoji) diff.emoji = b.emoji;
      if (teams && JSON.stringify(Object.keys(t.teams || {}).sort()) !== JSON.stringify(teams.slice().sort())) diff.teams = Object.fromEntries(teams.map((x) => [x, true]));
      if (Object.keys(diff).length) patches[tid] = diff;
    });
    typicalIds.forEach((tid) => { if (!used.has(tid)) patches[tid] = { off: true }; });
    if (Object.keys(patches).length) setup.patches[dk] = patches;
    if (Object.keys(oneOffs).length) setup.dayBlocks[dk] = oneOffs;
  });

  // meals, cleanup, verses, electives
  setup.meals = {};
  Object.entries(camp.meals || {}).forEach(([dow, m]) => {
    setup.meals[DK[dow]] = {};
    Object.entries(m).forEach(([meal, v]) => { setup.meals[DK[dow]][meal] = { dish: v.dish, emoji: v.emoji }; });
  });
  setup.cleanup = {};
  Object.entries(camp.mealCleanupSchedule || {}).forEach(([dow, m]) => {
    setup.cleanup[DK[dow]] = {};
    Object.entries(m).forEach(([meal, v]) => {
      setup.cleanup[DK[dow]][meal.toLowerCase()] = Object.fromEntries([].concat(v).map((t) => [t, true]));
    });
  });
  const theme = camp.memoryVerseTheme || {};
  setup.verses = { theme: { title: theme.title, text: theme.text, ref: theme.ref }, days: {} };
  Object.entries(camp.memoryVerses || {}).forEach(([dow, v]) => {
    const rec = { text: v.text, ref: v.ref };
    if (v.video && v.video.startsWith('https://')) rec.video = v.video;
    setup.verses.days[DK[dow]] = rec;
  });
  if (camp.features && camp.features.electives && camp.electives) {
    setup.electives = { stations: {}, slots: {} };
    Object.entries(camp.electives).forEach(([dow, slots]) => {
      setup.electives.slots[DK[dow]] = {};
      slots.forEach((stations, s) => {
        setup.electives.slots[DK[dow]]['s' + s] = {};
        stations.forEach(([name, people], j) => {
          const st = 'st-' + slug(name, 36);
          setup.electives.stations[st] = { name, emoji: camp.stationEmoji[name] || '⭐' };
          setup.electives.slots[DK[dow]]['s' + s][st] = {
            ord: 10 * (j + 1),
            people: Object.fromEntries(people.map((p, k) => ['n-' + slug(p, 40), { name: p, ord: 10 * (k + 1) }])),
          };
        });
      });
    });
  }
  ['schedule', 'meals', 'verses', 'cleanup'].concat(setup.electives ? ['electives'] : []).forEach((s) => { setup.meta.on[s] = true; });
  return setup;
}

if (process.argv[1] && process.argv[1].endsWith('camp-data.mjs')) {
  // `node camp-data.mjs` prints the shape counts the spec quotes (§10.2) — a quick eyeball check
  ['junior', 'senior'].forEach((id) => {
    const s = buildSeed(id);
    const n = (o) => Object.values(o || {}).reduce((a, d) => a + Object.keys(d).length, 0);
    console.log(id, 'typical', Object.keys(s.typical).length, 'patches', n(s.patches), 'dayBlocks', n(s.dayBlocks),
      'bytes', JSON.stringify(s).length, 'longest id', Math.max(...Object.keys(s.typical).concat(...Object.values(s.dayBlocks).map(Object.keys)).map((x) => x.length)));
  });
}
