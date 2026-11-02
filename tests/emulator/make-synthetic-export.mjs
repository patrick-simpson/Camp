// A stand-in for the owner's Firebase console export (Data → ⋮ → Export JSON), built from the SHIPPED code, so
// export-replay.mjs can be proven before the real file exists. Two flavours, written next to each other:
//
//   synthetic-clean.export.json  what a quiet week looks like: the camp's default week and teams, a few results, a
//                                bracket, chat, presence, a members list (the owner, two directors, counselors).
//   synthetic-clean-junior-root.export.json / synthetic-clean-senior-root.export.json
//                                an export taken at ONE camp's root, as the console writes it (no wrapper key)
//   synthetic-junk.export.json   the same, roughened the way a real database gets: RTDB-pruned empties, an old
//                                build's whole `teams` array, a result whose game left the week, a TBA game and one
//                                that can't be placed, a pending member, a legacy flat presence row, a published
//                                schedule from an older build, a private `pushServer` node the replay must ignore.
//
// Every person is fake (example.com). Nothing here is read from, or written to, the real database. Usage:
//   node make-synthetic-export.mjs [outDir]      (default: the scratchpad's exports/ directory, outside the repo)
//
// The shape is the console's: ONE JSON document at the database root, the two camp roots under it, in RTDB's
// stored form (nulls and empties pruned, a dense list as an array, a list with gaps as an index-keyed map).
import { createRequire } from 'module';
import vm from 'vm';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { makeContext, clearAllTimers } = require('../harness.js');
const { toStored, fromStored } = require('../fake-rtdb.js');

export const DEFAULT_EXPORT_DIR = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad/exports';
const stored = (v) => fromStored(toStored(JSON.parse(JSON.stringify(v))));

const OWNER = 'patricksimpson,fx@gmail,com';
const JENN = 'jenn@example,com';
const SAM = 'sam@example,com';
const AT = '2026-07-14T12:00:00.000Z';
const TS = 1784030400000; // 2026-07-14T12:00:00Z, a server timestamp

function camp(id, flavour) {
  const { ctx } = makeContext({ camp: id });
  const get = (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx));
  vm.runInContext('state = makeFreshState(); migrateState(state); normalizeSyncedState();', ctx);
  const root = get('({ dbRoot: CAMP.dbRoot, teamCount: CAMP.teamCount, snapshot: syncedSnapshot(), config: configForSync(state.config) })');
  const games = root.config.games;
  const days = root.config.days;
  const snap = root.snapshot;
  const ids = (n) => Array.from({ length: n }, (_, i) => 't' + i);
  const team = ids(root.teamCount);

  // a few finished games, a medal count that is not all one team
  const played = games.filter((g) => g.format === 'placement').slice(0, 4);
  snap.results = {};
  played.forEach((g, i) => { snap.results[g.id] = { medals: { gold: team[i % team.length], silver: team[(i + 1) % team.length], bronze: team[(i + 2) % team.length] }, savedAt: AT }; });
  // one bracket on a tournament game (the six-team wizard's shape; senior has no bracket until Step 22)
  const tour = games.find((g) => g.format === 'tournament');
  if (tour && root.teamCount === 6) snap.brackets = { [tour.id]: { phase: 'round1', pool: team.slice(), selectedPair: [], matches: [{ a: 't0', b: 't3', winner: 't0' }], byeTeamId: null } };
  snap.meta = { lastDataChangeAt: AT, hiddenCards: { standings: true } };

  const members = {
    [OWNER]: { role: 'editor', name: 'Patrick', addedBy: 'console', addedAt: AT },
    [JENN]: { role: 'editor', name: 'Jenn Reed', addedBy: 'Patrick', addedAt: AT },
    [SAM]: { role: 'viewer', name: 'Sam Lee', teamId: 't2', addedBy: 'Jenn Reed', addedAt: AT },
    'kim@example,com': { role: 'viewer', name: 'Kim Park', teamId: 't1', addedBy: 'Jenn Reed', addedAt: AT },
    '+15555550142': { role: 'viewer', name: 'Phone Counselor', teamId: 't0', addedBy: 'Jenn Reed', addedAt: AT },
  };
  const rootNode = {
    state: snap,
    config: root.config,
    members,
    presence: { [SAM]: { dev1: { at: TS } }, [JENN]: { dev2: { at: TS } } },
    changelog: { '-Nfake0001': { at: AT, by: 'Jenn Reed', byKey: JENN, action: 'Saved a result' } },
    chat: { general: { '-Nfake0001': { at: TS, byKey: JENN, name: 'Jenn Reed', text: 'Synthetic message: lunch is at noon.' } }, announcements: { '-Nfake0002': { at: TS, byKey: OWNER, name: 'Patrick', text: 'Synthetic announcement.' } } },
  };

  if (flavour === 'junk') {
    // an old build's whole `teams` array: generic names, no counselors (the 2026 migration will rewrite it)
    if (root.teamCount === 6) rootNode.state.teams = team.map((id, i) => ({ id, name: 'Team ' + (i + 1), counselor: 'TBD' }));
    else rootNode.state.teams = team.map((id, i) => ({ id, name: 'Team ' + (i + 1) }));
    // a result whose game left the week; one for a game that exists
    rootNode.state.results['game-that-was-deleted'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: AT };
    // a TBA game, and one in a session no schedule item holds
    const d3 = days.find((d) => d.dow === 3) || days[0];
    rootNode.config.games = games.concat([
      { id: 'tba-game-abcd', name: 'TBA', emoji: '❓', dayId: d3.id, session: 'Evening', location: 'TBD', format: 'placement', headline: '' },
      // a director's own game named for a schedule item: A2 puts it on that item
      { id: 'bible-study-quiz', name: 'Bible Study', emoji: '📖', dayId: d3.id, session: 'Morning', location: 'Chapel', format: 'placement', headline: '' },
      { id: 'night-owl-wxyz', name: 'Night Owl Relay', emoji: '🦉', dayId: d3.id, session: 'Midnight', location: 'Chapel Lawn', format: 'placement', headline: 'Nobody can place this one.' },
    ]);
    // a pending member (no sign-in yet), a legacy flat presence row (an old build's), an old schedule publication
    rootNode.members['pending-pat-q7k2'] = { role: 'viewer', name: 'Pat', teamId: 't3', addedBy: 'Jenn Reed', addedAt: AT };
    rootNode.presence['0b9f7f4e-legacy-device-uuid'] = { at: TS, role: 'editor' };
    rootNode.pushSchedule = { weekStart: '2026-07-19', at: TS, by: JENN, blocks: { 'd1-480-0': { dow: 1, start: 480, label: 'Breakfast', emoji: '🍳', key: 'breakfast' } } };
    // a stray, a bonus with a pruned field, an announcement
    rootNode.state.bonuses = { 'bonus-1': { teamId: 't1', category: 'Spirit', label: 'Loudest cheer', points: 2, at: AT } };
    rootNode.state.announcements = { 'ann-1': { id: 'ann-1', text: 'Synthetic: bring a sweater.', at: Date.parse(AT), by: 'Jenn Reed', ttlMs: 3600000 } };
  }
  const out = stored(rootNode);
  clearAllTimers();
  return { dbRoot: root.dbRoot, node: out };
}

export function makeExport(flavour) {
  const whole = {};
  ['junior', 'senior'].forEach((id) => { const c = camp(id, flavour); whole[c.dbRoot] = c.node; });
  // the owner's other roots, which the replay must ignore (and must never print)
  whole.pushServer = { cron: { cursor: 1 }, rate: { stamp: TS } };
  return whole;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1].endsWith('make-synthetic-export.mjs')) {
  const dir = process.argv[2] || DEFAULT_EXPORT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); console.log(`wrote ${file} (${fs.statSync(file).size} bytes)`); };
  ['clean', 'junk'].forEach((f) => write(`synthetic-${f}.export.json`, makeExport(f)));
  // an export taken at ONE camp's root (Data → the camp's node → Export JSON): no wrapper key
  const whole = makeExport('clean');
  write('synthetic-clean-junior-root.export.json', whole.campScoreboard);
  write('synthetic-clean-senior-root.export.json', whole.seniorScoreboard);
  process.exit(0);
}
