// ── Catalog helpers shared by the setup screens ──────────────────
// What is left of the v197 "classic builder" (Games / Days / Teams / Notice / Data tabs), which Step 30 removed: its editors
// were replaced by the Set up the week screens (setup-ui.js). These are the pieces those screens, the Games tab and the backup /
// restore engine still call. This file touches state only through the globals app.js and the engines provide: saveState(),
// renderAll(), canEdit(), allGames(), configEdit(), configEditable(), migrateState(), normalizeSyncedState(), teamsFromBackup(),
// restoreAuto(), restoreImportExtras(), putGamesOnSchedule().

// Guard for every writer of state.config (the Games screen's game and day edits,
// Import, the ⚡ quick game). The loading
// card above hides their controls, so this only catches a stale handler.
function configLocked() {
  // The builder is a director's screen and its mutators ask here first: nothing in it writes for a phone that may not
  // act as a director (a counselor preview included), whatever stale handler asks.
  if (!canEdit()) return true;
  if (configEditable()) return false;
  showToast('The games list is still loading — try again in a moment.');
  return true;
}

// A new game's id: the name's slug + '-' + 4 random base36 (rain-bowling-k3f9). Two
// directors adding "Rain bowling" at the same moment used to mint the SAME id, and the
// later create replaced the other's game outright; with a tail they can't (and the
// engine refuses to overwrite a different record anyway — applyOpsSafe). `takenSet`
// still guards the rare repeat. Seed and existing ids never change.
function makeId(name, takenSet) {
  let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'game';
  let id;
  do {
    id = base + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  } while (takenSet.has(id));
  return id;
}

const GAME_RECORD_MAPS = [
  { key: 'results', label: 'the saved result' },
  { key: 'brackets', label: 'the bracket in progress' },
  // The four-team bracket's node. A game created under a reused id must never inherit one, and a delete or a format change
  // clears it with the rest (every reader here still tolerates a missing map: an old cache has none).
  { key: 'brackets4', label: 'the bracket in progress' },
  { key: 'drafts', label: 'the score entry in progress' },
  { key: 'live', label: 'the live match' },
  { key: 'clocks', label: 'the game clock' },
  { key: 'picSetup', label: 'the drawing-words setup' },
];

// Every id something is already kept under — the games themselves and every per-game
// map above — so a new id can never land on a leftover record.
function takenGameIds() {
  const taken = new Set(allGames().map((g) => g.id));
  GAME_RECORD_MAPS.forEach((m) => Object.keys(state[m.key] || {}).forEach((k) => taken.add(k)));
  return taken;
}

// Labels of whatever is recorded for this game right now (empty ⇒ nothing).
function gameRecordLabels(gameId) {
  // One word per KIND of record: a game can hold a six-team and a four-team bracket label at once, and the question says it once.
  return GAME_RECORD_MAPS.filter((m) => state[m.key] && state[m.key][gameId]).map((m) => m.label).filter((l, i, a) => a.indexOf(l) === i);
}

function clearGameRecords(gameId) {
  GAME_RECORD_MAPS.forEach((m) => { if (state[m.key]) delete state[m.key][gameId]; });
}

// The ⚡ quick game (Games tab): the game sheet (setup-ui.js section 16) is the quick game — Podium already picked, naming it is
// the one step, and it lands on the Games item under way now or next.
function startQuickGame() {
  if (!canEdit() || configLocked()) return;
  if (typeof gmOpenQuick === 'function') gmOpenQuick();
}

function backupJSON() {
  // Backups v3 (setup-sync.js): the restore-point body plus exportedAt — it now carries camp, setup,
  // notice, meta, clocks and brackets4 as well, and still never campers, members, chat or photos.
  if (typeof backupObject === 'function') return JSON.stringify(backupObject(), null, 2);
  const payload = {
    app: 'campScoreboardV2',
    exportedAt: new Date().toISOString(),
    config: state.config,
    teams: state.teams,
    results: state.results,
    brackets: state.brackets,
    brackets4: state.brackets4,
    drafts: state.drafts,
    picRounds: state.picRounds,
    picSetup: state.picSetup,
    bonuses: state.bonuses,
    live: state.live,
    announcements: state.announcements,
  };
  return JSON.stringify(payload, null, 2);
}

// `opts.copyFromOtherCamp`: the backup is the OTHER camp's, and only its Schedule, Games and Teams are
// taken (the "copy from the other camp" tick). Without it another camp's backup is refused.
function tryImport(text, opts) {
  // `opts.say(message)` takes the complaint where the caller shows it (Set up the week's Restore points
  // screen: a toast); `opts.confirmed` says the caller already asked (its own dialog).
  const say = (opts && opts.say) || ((msg) => { if (msg) showToast(msg); });
  if (!configEditable()) {
    say('The games list is still loading. Try again in a moment.');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    say('That isn’t a whole backup. Copy it again and paste all of it.');
    return;
  }

  // Backups v3 (setup-sync.js) nest the synced keys under `state` and carry the camp they came from; v2
  // is flat and is accepted exactly as before. `src` is the flat view both are read through.
  const v3 = !!(parsed && parsed.app === 'campScoreboardV3' && parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state));
  // Whose backup is it? A `camp` that names another camp refuses it WHATEVER the file's other markers
  // say (an edited `app` flag or a missing `state` must not skip the check), and a v3 file with no
  // readable camp is refused outright — restoreParseBody does the same for restore points.
  const campOf = parsed && typeof parsed === 'object' ? parsed.camp : undefined;
  if ((campOf !== undefined || (parsed && parsed.app === 'campScoreboardV3')) && typeof campOf !== 'string') {
    say('That backup doesn’t say which camp it’s from, so it can’t be put back.');
    return;
  }
  const otherCamp = typeof campOf === 'string' && campOf !== CAMP.id;
  const copyMode = !!(otherCamp && opts && opts.copyFromOtherCamp);
  if (otherCamp && !copyMode) {
    say('That backup is from ' + (CAMPS[parsed.camp] ? CAMPS[parsed.camp].label : 'another camp') + ', not ' + CAMP.label + '. Nothing was changed.');
    return;
  }
  const src = v3 ? Object.assign({}, parsed.state, { config: parsed.config }) : parsed;

  let config = null;
  if (src && src.config && Array.isArray(src.config.games)) {
    config = src.config;
  } else if (src && Array.isArray(src.games)) {
    config = src; // legacy backup: the whole object IS the config
  }

  if (!config) {
    say('That isn’t a whole backup. Copy it again and paste all of it.');
    return;
  }
  // The Teams tab can no longer add or delete a team (S0j), so a restore must not
  // be the back door that does: it would swap in the OTHER camp's roster (or a
  // hand-edited / t-<timestamp> one) with no UI left to repair it, and every
  // result keyed by team id would score the wrong teams. Refuse before the
  // confirm. An absent or empty `teams` is still fine — the camp keeps its own.
  let teamsOk = Array.isArray(src.teams) && src.teams.length > 0;
  if (teamsOk) {
    const ids = src.teams.map((t) => t && t.id);
    const wellFormed = ids.length === CAMP.teamCount && ids.every(isTeamId) && new Set(ids).size === ids.length;
    if (!wellFormed) {
      if (!copyMode) {
        say('That backup has ' + src.teams.length + ' teams, but ' + CAMP.label + ' has ' + CAMP.teamCount + '. Nothing was changed.');
        return;
      }
      teamsOk = false; // copying from the other camp: a roster that doesn't fit is simply left out
    }
  }
  say('');

  if (!(opts && opts.confirmed) && !confirm("Replace this device's entire setup (teams, days, games) AND saved scores? This syncs to every device. Consider downloading a backup first.")) return;
  // The week as it is NOW, kept as a `pre-import` restore point before anything changes (written in the
  // background: the import goes ahead, and a restore point can put this back).
  if (typeof restoreAuto === 'function') restoreAuto('pre-import', 'Before importing a backup');

  // One commit of the whole catalog: it goes up as field ops against the confirmed
  // baseline (a game the backup lacks is a delete op, one it adds a create). No Undo
  // entry: a restore also swaps scores and the roster, which Undo does not cover
  // (restore points will).
  configEdit('Restored a backup', () => {
    state.config = config;
    migrateState(state);
  }, { undo: false });
  // Only accept correctly-typed sections — a hand-edited backup with e.g.
  // "results": null would crash every render after it had already synced.
  if (teamsOk) state.teams = teamsFromBackup(src.teams); // only well-formed branding fields come in (never a photo version)
  // Copying from the other camp takes the Schedule, Games and Teams only — never its scores.
  if (!copyMode) {
    ['results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'clocks', 'announcements'].forEach((key) => {
      const v = src[key];
      if (!(v && typeof v === 'object' && !Array.isArray(v))) return;
      if (key === 'picSetup' && v3) { // a v3 backup carries the modes only: the words on this device are kept
        Object.keys(v).forEach((gid) => {
          const source = v[gid] && v[gid].source;
          if (source === undefined) return;
          state.picSetup = state.picSetup || {};
          state.picSetup[gid] = Object.assign({ words: [] }, state.picSetup[gid], { source });
        });
        return;
      }
      state[key] = v;
    });
  }
  // The setup data (only sections switched on here), the notice board — never `meta`, which carries the epoch.
  if (v3 && typeof restoreImportExtras === 'function') restoreImportExtras(parsed, copyMode);
  // A backup is untrusted input with exactly the shape problem CLAUDE.md warns
  // about: anything that round-tripped through Realtime Database has had its
  // empty arrays/objects pruned away, so an imported bracket can arrive with no
  // `matches` and blank-screen renderTournament — on every device, since the
  // import syncs. Heal it before anything renders or pushes.
  normalizeSyncedState();
  pruneOrphanedGameData();
  // An older backup (or the other camp's copy) has games with no schedule item: with the schedule edited here that
  // leaves them on no block, so A2 puts each on its natural one (it never moves a link that still resolves).
  if (typeof putGamesOnSchedule === 'function') putGamesOnSchedule();

  saveState();
  renderAll();
}

// Drop results/brackets/drafts/clocks/… for game ids that no longer exist in the
// config — otherwise their medals keep counting in standings forever with
// no UI left to clear them.
function pruneOrphanedGameData() {
  const ids = new Set(allGames().map((g) => g.id));
  GAME_RECORD_MAPS.map((m) => m.key).forEach((key) => {
    Object.keys(state[key] || {}).forEach((gid) => {
      if (!ids.has(gid)) delete state[key][gid];
    });
  });
  if (state.ui.gameId && !ids.has(state.ui.gameId)) state.ui.gameId = null;
}
