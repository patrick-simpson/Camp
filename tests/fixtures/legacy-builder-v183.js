// The week builder's game editor exactly as it shipped in v183 (before the v184
// glitch sweep), copied VERBATIM from settings.js at commit 554fbe1:
// toEditableDraft (saved game -> text-mode draft) and saveGameDraft (draft ->
// saved game, after validateGameDraft).
//
// Why it is kept: the config engine rebuild (setup-rebuild-spec S3) replaces
// "whole-game save" with "save only the fields that changed". The new save must
// produce the SAME game from the SAME draft as this one did, so tests run a
// scenario through both and compare. Nothing in the app loads this file, and the
// runner only executes top-level *.test.js files, so it never ships or runs by
// itself.
//
// Use: `const legacy = nodeRequire('./fixtures/legacy-builder-v183.js')`.
// `legacy.source` is the two functions as text, for vm.runInContext inside a
// FRESH app context (they read that context's `state`, `gameDraft`,
// `validateGameDraft`, `splitLines`, `makeId`, `gameById`, `saveConfig`,
// `saveState`, `renderAll`, `document`, `confirm`, so they replace the live
// versions there). Never edit the function bodies below: a diff against
// `git show 554fbe1:settings.js` should stay empty.

/* eslint-disable no-undef */
// Converts a saved game into the editor's "text mode" shape, where
// list-ish fields (counterSteps, timer.presets, prompts, rule items)
// are edited as plain strings and only parsed back on Save.
function toEditableDraft(game) {
  const d = JSON.parse(JSON.stringify(game));
  d.counterSteps = Array.isArray(d.counterSteps) ? d.counterSteps.join(', ') : (d.counterSteps || '');
  if (d.timer) {
    d.timer = Object.assign({}, d.timer, {
      presets: (d.timer.presets || []).map((s) => s / 60).join(', '),
      rounds: d.timer.rounds == null ? '' : String(d.timer.rounds),
    });
  }
  if (d.liveTracker) {
    d.liveTracker = Object.assign({}, d.liveTracker, {
      innings: d.liveTracker.innings == null ? '' : String(d.liveTracker.innings),
      outs: d.liveTracker.outs == null ? '' : String(d.liveTracker.outs),
    });
  }
  d.prompts = Array.isArray(d.prompts) ? d.prompts.join('\n') : (d.prompts || '');
  d.rules = (d.rules || []).map((sec) => ({
    h: sec.h || '',
    items: Array.isArray(sec.items) ? sec.items.join('\n') : (sec.items || ''),
  }));
  return d;
}

function saveGameDraft() {
  const draft = gameDraft;
  const errEl = document.getElementById('gd-error');
  const err = validateGameDraft(draft);
  if (err) {
    errEl.textContent = err;
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;

  const isNew = state.ui.editGameId === 'new';
  const out = JSON.parse(JSON.stringify(draft));
  out.name = out.name.trim();
  out.emoji = (out.emoji && out.emoji.trim()) || '🏕️';

  if (out.format === 'tally') {
    const steps = String(out.counterSteps || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => parseFloat(t));
    if (steps.length) out.counterSteps = steps;
    else delete out.counterSteps;
  }
  if (out.format !== 'tally') {
    delete out.unit;
    delete out.counterSteps;
    delete out.counterStepLabels;
    delete out.counterAllowNegative;
    delete out.lowerWins;
    delete out.timeInput;
    delete out.liveRankings;
  }

  if (out.format === 'tournament' && out.liveTracker) {
    // Parse the text-mode tracker back to numbers; unknown keys the editor
    // doesn't expose (e.g. Kickball's sideLabel) ride along untouched.
    const t = out.liveTracker;
    t.unit = (t.unit || '').trim() || 'Points';
    t.periodLabel = (t.periodLabel || '').trim() || 'Round';
    t.innings = Math.max(1, parseInt(String(t.innings).trim(), 10) || 1);
    t.outs = Math.max(0, parseInt(String(t.outs).trim(), 10) || 0);
  }
  if (out.format !== 'tournament') {
    delete out.liveTracker;
    delete out.ladderScoring;
    delete out.roundOneMatchups;
  }

  if (out.timer) {
    const presets = String(out.timer.presets || '').split(',').map((t) => t.trim()).filter(Boolean)
      .map((t) => Math.round(parseFloat(t) * 60));
    out.timer.presets = presets;
    out.timer.label = (out.timer.label || '').trim();
    const rounds = parseInt(String(out.timer.rounds || '').trim(), 10);
    if (rounds > 1) out.timer.rounds = rounds;
    else delete out.timer.rounds;
  }

  if (typeof out.prompts === 'string') {
    const lines = splitLines(out.prompts);
    if (lines.length) out.prompts = lines;
    else delete out.prompts;
  }

  if (!out.messtival) delete out.messtival;

  out.rules = (out.rules || [])
    .map((sec) => ({ h: (sec.h || '').trim(), items: splitLines(sec.items) }))
    .filter((sec) => sec.h || sec.items.length);

  if (!isNew) {
    const existing = gameById(out.id);
    const formatChanged = existing && existing.format !== out.format;
    if (formatChanged && state.results[out.id]) {
      if (!confirm('"' + out.name + '" has a saved result under its old format. Saving clears that result so it can be re-run. Continue?')) return;
      delete state.results[out.id];
    }
  }

  if (isNew) {
    const taken = new Set([...(state.config.games || []).map((g) => g.id), ...Object.keys(state.results || {})]);
    out.id = makeId(out.name, taken);
    state.config.games.push(out);
  } else {
    const idx = state.config.games.findIndex((g) => g.id === out.id);
    if (idx > -1) state.config.games.splice(idx, 1, out);
  }

  saveConfig();
  saveState();
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  renderAll();
}

module.exports = {
  toEditableDraft,
  saveGameDraft,
  source: [toEditableDraft, saveGameDraft].map((f) => f.toString()).join('\n\n'),
};
