// ── Settings / builder UI ────────────────────────────────────────
// Renders into #settings-view. This file never touches localStorage
// or state directly except through the globals app.js provides:
// saveConfig(), saveState(), renderAll(), canEdit(), esc(), gameById(),
// dayById(), teamName(), medalCounts(), copyTextToClipboard(),
// downloadBlob(), FORMAT_BADGES, defaultConfig(), migrateState().
//
// The game editor stages every edit in a local draft (gameDraft) and
// only writes to state.config on Save — nothing else in the app can
// see a game mid-edit.

const SETTINGS_TABS = [
  { key: 'games', label: 'Games' },
  { key: 'days', label: 'Days' },
  { key: 'teams', label: 'Teams' },
  { key: 'data', label: 'Data' },
];

let gameDraft = null;
let gameDraftFor = null; // which editGameId gameDraft was built for
let gameDraftSnapshot = '';
let extrasOpen = false;
let quickGamePrefill = null; // one-shot defaults for the next new-game draft

// True while the game editor holds unsaved edits. app.js's editorMidEntry()
// checks this so the update-poll auto-reload and remote merges never wipe a
// half-built game.
function builderDirty() {
  return !!gameDraft && JSON.stringify(gameDraft) !== gameDraftSnapshot;
}

// ── Entry point ───────────────────────────────────────────────────

function renderSettings() {
  const view = document.getElementById('settings-view');
  if (!view) return;
  const tab = state.ui.settingsTab || 'games';
  const updatedLine = state.config.updatedAt
    ? `<p class="muted">Last edited ${esc(new Date(state.config.updatedAt).toLocaleString())}</p>`
    : '';

  view.innerHTML = `
    <button class="link-btn back-btn" id="settings-back-btn">← Back to scoreboard</button>
    <h2>Set up the week</h2>
    ${updatedLine}
    <nav class="settings-tabs">
      <jelly-segmented size="small" label="Builder section" value="${esc(tab)}">
        ${SETTINGS_TABS.map((t) => `<jelly-segment value="${t.key}">${esc(t.label)}</jelly-segment>`).join('')}
      </jelly-segmented>
    </nav>
    <div class="card settings-card" id="settings-card"></div>
  `;

  document.getElementById('settings-back-btn').addEventListener('click', () => {
    state.ui.view = 'home';
    state.ui.editGameId = null;
    saveState();
    renderAll();
  });

  view.querySelector('.settings-tabs jelly-segmented').addEventListener('change', (e) => {
    state.ui.settingsTab = (e.detail && e.detail.value) || e.target.getAttribute('value');
    state.ui.editGameId = null;
    saveState();
    renderAll();
  });

  const card = document.getElementById('settings-card');
  if (tab === 'games' && state.ui.editGameId) {
    renderGameEditor(card);
  } else if (tab === 'days') {
    renderDaysTab(card);
  } else if (tab === 'teams') {
    renderTeamsTab(card);
  } else if (tab === 'data') {
    renderDataTab(card);
  } else {
    renderGamesTab(card);
  }
}

// ── Small shared helpers ──────────────────────────────────────────

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function makeId(name, takenSet) {
  let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'game';
  let id = base;
  let n = 2;
  while (takenSet.has(id)) {
    id = base + '-' + n;
    n += 1;
  }
  return id;
}

function splitLines(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function bracketRefsTeam(b, teamId) {
  if (!b) return false;
  const refs = []
    .concat(b.pool || [])
    .concat(b.selectedPair || [])
    .concat((b.matches || []).reduce((a, m) => a.concat([m.a, m.b, m.winner, m.loser]), []))
    .concat([b.byeTeamId])
    .concat(b.semifinal ? [b.semifinal.a, b.semifinal.b, b.semifinal.winner, b.semifinal.loser] : [])
    .concat(b.championship ? [b.championship.a, b.championship.b, b.championship.winner, b.championship.loser] : []);
  return refs.includes(teamId);
}

function teamRefs(teamId) {
  let medalCount = 0;
  const resultGames = [];
  Object.entries(state.results || {}).forEach(([gid, r]) => {
    if (!r || !r.medals) return;
    let hit = false;
    ['gold', 'silver', 'bronze'].forEach((k) => {
      if (r.medals[k] === teamId) { medalCount += 1; hit = true; }
    });
    if (hit) {
      const g = gameById(gid);
      resultGames.push(g ? g.name : gid);
    }
  });

  const inProgressGames = [];
  Object.entries(state.brackets || {}).forEach(([gid, b]) => {
    if (bracketRefsTeam(b, teamId)) {
      const g = gameById(gid);
      inProgressGames.push(g ? g.name : gid);
    }
  });
  Object.entries(state.drafts || {}).forEach(([gid, d]) => {
    if (!d) return;
    const inScores = d.scores && Object.prototype.hasOwnProperty.call(d.scores, teamId) && String(d.scores[teamId]).trim() !== '';
    const inMedals = d.medals && Object.values(d.medals).includes(teamId);
    if (inScores || inMedals) {
      const g = gameById(gid);
      const name = g ? g.name : gid;
      if (!inProgressGames.includes(name)) inProgressGames.push(name);
    }
  });

  const hasPicRound = !!(state.picRounds && state.picRounds[teamId]);
  return { medalCount, resultGames, inProgressGames, hasPicRound };
}

// ── Games tab: list ───────────────────────────────────────────────

function gameGroupKey(g, dayIds) {
  return dayIds.has(g.dayId) ? g.dayId + '|' + g.session : 'unscheduled';
}

function renderGamesTab(card) {
  const games = state.config.games || [];
  const days = state.config.days || [];
  const sessions = state.config.sessions || [];
  const dayIds = new Set(days.map((d) => d.id));

  let groupsHTML = '';
  days.forEach((day) => {
    const dayGames = games.filter((g) => g.dayId === day.id);
    if (!dayGames.length) {
      groupsHTML += `<h3 class="session-heading">${esc(day.name)}</h3>
        <p class="muted session-empty">Nothing on ${esc(day.name)} yet.</p>`;
      return;
    }
    sessions.forEach((session) => {
      const sessionGames = dayGames.filter((g) => g.session === session);
      if (!sessionGames.length) return;
      groupsHTML += `<h3 class="session-heading">${esc(day.name)} — ${esc(session)}</h3>`;
      groupsHTML += sessionGames.map((g) => gameRowHTML(g, games, dayIds)).join('');
    });
  });

  const unscheduled = games.filter((g) => !dayIds.has(g.dayId));
  if (unscheduled.length) {
    groupsHTML += `<h3 class="session-heading">Unscheduled</h3>`;
    groupsHTML += unscheduled.map((g) => gameRowHTML(g, games, dayIds)).join('');
  }

  card.innerHTML = `
    <jelly-button class="primary-btn" id="new-game-btn">+ New game</jelly-button>
    ${groupsHTML}
  `;

  document.getElementById('new-game-btn').addEventListener('click', () => {
    state.ui.editGameId = 'new';
    saveState();
    renderAll();
  });

  wireGameRows(card);
}

function gameRowHTML(g, games, dayIds) {
  const group = games.filter((x) => gameGroupKey(x, dayIds) === gameGroupKey(g, dayIds));
  const idx = group.indexOf(g);
  const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
  const hasResult = !!state.results[g.id];
  return `
    <div class="builder-row game-row">
      <jelly-icon-button class="reorder-btn" label="Move up" data-game-id="${esc(g.id)}" data-dir="-1" ${idx <= 0 ? 'disabled' : ''}>↑</jelly-icon-button>
      <jelly-icon-button class="reorder-btn" label="Move down" data-game-id="${esc(g.id)}" data-dir="1" ${idx >= group.length - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
      <button type="button" class="game-row-main" data-game-id="${esc(g.id)}">
        <span class="game-emoji">${esc(g.emoji || '')}</span>
        <span class="game-row-name">${esc(g.name)}</span>
        <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge>
        ${hasResult ? '<span class="result-dot" title="Has a saved result">●</span>' : ''}
      </button>
    </div>
  `;
}

function wireGameRows(card) {
  card.querySelectorAll('.reorder-btn[data-game-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = gameById(btn.dataset.gameId);
      if (!g) return;
      const dayIds = new Set(state.config.days.map((d) => d.id));
      const group = state.config.games.filter((x) => gameGroupKey(x, dayIds) === gameGroupKey(g, dayIds));
      const posInGroup = group.indexOf(g);
      const neighbor = group[posInGroup + parseInt(btn.dataset.dir, 10)];
      if (!neighbor) return;
      const iA = state.config.games.indexOf(g);
      const iB = state.config.games.indexOf(neighbor);
      const tmp = state.config.games[iA];
      state.config.games[iA] = state.config.games[iB];
      state.config.games[iB] = tmp;
      saveConfig();
      renderAll();
    });
  });

  card.querySelectorAll('.game-row-main').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.editGameId = btn.dataset.gameId;
      saveState();
      renderAll();
    });
  });
}

// ── Game editor ───────────────────────────────────────────────────

function newGameShape() {
  const days = state.config.days || [];
  const dayId = days.some((d) => d.id === state.ui.day) ? state.ui.day : (days[0] ? days[0].id : null);
  const shape = {
    id: null,
    name: '',
    emoji: '',
    dayId,
    session: (state.config.sessions || [])[0] || '',
    location: '',
    format: null,
    headline: '',
    rules: [],
  };
  if (quickGamePrefill) {
    Object.assign(shape, quickGamePrefill);
    quickGamePrefill = null;
  }
  return shape;
}

// One-tap "quick game" (scoreboard ⚡ button): jump straight into the game
// editor with a fresh draft prefilled for right now — the day being viewed
// (newGameShape already uses state.ui.day), the current session by camp
// clock, and the podium-pick format (fastest to score). From there it's the
// normal editor flow: name it, save, score it.
function startQuickGame() {
  if (!canEdit()) return;
  const sess = campNow().minutes >= 720 ? 'Evening' : 'Morning';
  quickGamePrefill = { format: 'placement' };
  if ((state.config.sessions || []).includes(sess)) quickGamePrefill.session = sess;
  // Inside the Thu-evening/Friday double-points window, a game added on the
  // spot should count double by default (untickable in the editor's extras).
  if (typeof inDoubleBonusWindow === 'function' && inDoubleBonusWindow()) quickGamePrefill.messtival = true;
  gameDraft = null;
  gameDraftFor = null; // force a fresh draft even if an older 'new' draft exists
  state.ui.editGameId = 'new';
  openBuilder('games');
}

// Converts a saved game into the editor's "text mode" shape, where
// list-ish fields (counterSteps, timer.presets, prompts, rule items)
// are edited as plain strings and only parsed back on Save.
function toEditableDraft(game) {
  const d = JSON.parse(JSON.stringify(game));
  d.counterSteps = Array.isArray(d.counterSteps) ? d.counterSteps.join(', ') : (d.counterSteps || '');
  if (d.timer) {
    d.timer = Object.assign({}, d.timer, { presets: (d.timer.presets || []).map((s) => s / 60).join(', ') });
  }
  d.prompts = Array.isArray(d.prompts) ? d.prompts.join('\n') : (d.prompts || '');
  d.rules = (d.rules || []).map((sec) => ({
    h: sec.h || '',
    items: Array.isArray(sec.items) ? sec.items.join('\n') : (sec.items || ''),
  }));
  return d;
}

function ensureGameDraft() {
  const editId = state.ui.editGameId;
  if (gameDraftFor === editId && gameDraft) return;
  gameDraftFor = editId;
  extrasOpen = false;
  if (editId === 'new') {
    gameDraft = toEditableDraft(newGameShape());
  } else {
    const g = gameById(editId);
    gameDraft = g ? toEditableDraft(g) : toEditableDraft(newGameShape());
  }
  gameDraftSnapshot = JSON.stringify(gameDraft);
}

function renderGameEditor(card) {
  ensureGameDraft();
  const draft = gameDraft;
  const isNew = state.ui.editGameId === 'new';
  const hasSavedResult = !isNew && !!state.results[draft.id];

  card.innerHTML = `
    <button type="button" class="link-btn back-btn" id="editor-back-btn">← All games</button>
    <h2>${isNew ? 'New game' : 'Edit game'}</h2>
    ${hasSavedResult ? '<p class="warn-note">This game has a saved result — changing its format will clear that result when you save.</p>' : ''}

    <div class="form-field">
      <label class="form-label">Name*</label>
      <jelly-input class="form-input" id="gd-name" type="text" value="${esc(draft.name)}" placeholder="Game name"></jelly-input>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label class="form-label">Emoji</label>
        <jelly-input class="form-input" id="gd-emoji" type="text" value="${esc(draft.emoji)}" placeholder="🏕️"></jelly-input>
      </div>
      <div class="form-field">
        <label class="form-label">Location</label>
        <jelly-input class="form-input" id="gd-location" type="text" value="${esc(draft.location)}" placeholder="Location"></jelly-input>
      </div>
    </div>
    <div class="form-field">
      <label class="form-label">Tagline</label>
      <jelly-input class="form-input" id="gd-headline" type="text" value="${esc(draft.headline)}" placeholder="One line about the game"></jelly-input>
    </div>

    <div class="form-field">
      <label class="form-label">Day</label>
      <jelly-select class="form-input" id="gd-day" value="${esc(draft.dayId || '')}" label="Day">
        ${(state.config.days || []).map((d) => `<jelly-option value="${esc(d.id)}">${esc(d.name)}</jelly-option>`).join('')}
      </jelly-select>
    </div>
    <div class="form-field">
      <label class="form-label">Session</label>
      <div class="segmented">
        ${(state.config.sessions || []).map((s) => `<button type="button" class="team-chip ${draft.session === s ? 'selected' : ''}" data-session="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
    </div>

    <div class="form-field">
      <label class="form-label">Format</label>
      <div class="format-cards">
        ${formatCardHTML('tournament', '🥊 Bracket', 'Head-to-head matches; a medal round decides.', draft.format)}
        ${formatCardHTML('tally', '🔢 Score entry', 'Every team posts a score; top 3 medal.', draft.format)}
        ${formatCardHTML('placement', '🏆 Podium pick', 'Just pick who took gold, silver, bronze.', draft.format)}
      </div>
    </div>

    ${draft.format === 'tally' ? tallyFieldsHTML(draft) : ''}

    <details class="rules-details" id="gd-extras" ${extrasOpen ? 'open' : ''}>
      <summary>Tools &amp; extras</summary>
      ${extrasHTML(draft)}
    </details>

    <h3>How to play</h3>
    <div id="gd-rules">${rulesEditorHTML(draft)}</div>
    <button type="button" class="link-btn" id="gd-add-rule">+ Add section</button>

    <p class="entry-error" id="gd-error" hidden></p>
    <div class="editor-actions">
      <jelly-button class="primary-btn" id="gd-save-btn">Save game</jelly-button>
      <button type="button" class="link-btn" id="gd-cancel-btn">Cancel</button>
    </div>

    ${!isNew ? `
      <div class="editor-footer">
        <jelly-button class="secondary-btn" variant="platinum" id="gd-duplicate-btn">Duplicate game</jelly-button>
        <button type="button" class="link-btn danger-link" id="gd-delete-btn">Delete game</button>
      </div>
    ` : ''}
  `;

  wireGameEditor(card);
}

function formatCardHTML(key, label, desc, current) {
  return `<button type="button" class="format-card ${current === key ? 'selected' : ''}" data-format="${key}">
    <div class="format-card-label">${esc(label)}</div>
    <div class="format-card-desc muted">${esc(desc)}</div>
  </button>`;
}

function tallyFieldsHTML(draft) {
  return `
    <div class="form-field">
      <label class="form-label">Unit</label>
      <jelly-input class="form-input" id="gd-unit" type="text" value="${esc(draft.unit || '')}" placeholder="points, balls collected, laps…"></jelly-input>
    </div>
    <jelly-checkbox class="checkbox-field" id="gd-lowerwins" size="small" ${draft.lowerWins ? 'checked' : ''}>Lowest score wins</jelly-checkbox>
    <jelly-checkbox class="checkbox-field" id="gd-timeinput" size="small" ${draft.timeInput ? 'checked' : ''}>Scores are times (m:ss)</jelly-checkbox>
    <div class="form-field">
      <label class="form-label">Counter buttons</label>
      <jelly-input class="form-input" id="gd-countersteps" type="text" value="${esc(draft.counterSteps || '')}" placeholder="1, 5"></jelly-input>
      <p class="field-help muted">Quick +N buttons for tallying. Comma-separated, like 1, 5. Leave blank to type scores.</p>
    </div>
  `;
}

function extrasHTML(draft) {
  const hasTimer = !!draft.timer;
  return `
    <jelly-checkbox class="checkbox-field" id="gd-timer-on" size="small" ${hasTimer ? 'checked' : ''}>Countdown timer</jelly-checkbox>
    ${hasTimer ? `
      <div class="form-field">
        <label class="form-label">Label</label>
        <jelly-input class="form-input" id="gd-timer-label" type="text" value="${esc(draft.timer.label || '')}"></jelly-input>
      </div>
      <div class="form-field">
        <label class="form-label">Presets (minutes, comma-separated)</label>
        <jelly-input class="form-input" id="gd-timer-presets" type="text" value="${esc(draft.timer.presets || '')}" placeholder="10, 8, 5"></jelly-input>
      </div>
    ` : ''}
    <div class="form-field">
      <label class="form-label">Drawing prompts (one per line — adds the photo/stopwatch drawing round)</label>
      <jelly-textarea class="form-textarea" id="gd-prompts" rows="4" placeholder="Pumpkin&#10;Scarecrow" value="${esc(draft.prompts || '')}"></jelly-textarea>
    </div>
    <jelly-checkbox class="checkbox-field" id="gd-double" size="small" ${draft.messtival ? 'checked' : ''}>🎉 Messtival game (medals count DOUBLE points in the standings)</jelly-checkbox>
  `;
}

function rulesEditorHTML(draft) {
  if (!draft.rules.length) return '<p class="muted">No sections yet.</p>';
  return draft.rules.map((sec, i) => `
    <div class="rules-section-editor">
      <div class="builder-row">
        <jelly-icon-button class="reorder-btn" label="Move up" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
        <jelly-icon-button class="reorder-btn" label="Move down" data-idx="${i}" data-dir="1" ${i === draft.rules.length - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
        <jelly-input class="form-input rules-h-input" data-idx="${i}" type="text" value="${esc(sec.h)}" placeholder="Section heading"></jelly-input>
      </div>
      <jelly-textarea class="form-textarea rules-items-input" data-idx="${i}" rows="3" placeholder="One bullet per line" value="${esc(sec.items)}"></jelly-textarea>
      <button type="button" class="link-btn danger-link rules-remove-btn" data-idx="${i}">Remove section</button>
    </div>
  `).join('');
}

function wireGameEditor(card) {
  const draft = gameDraft;
  const isNew = state.ui.editGameId === 'new';

  document.getElementById('editor-back-btn').addEventListener('click', leaveGameEditor);
  document.getElementById('gd-cancel-btn').addEventListener('click', leaveGameEditor);

  document.getElementById('gd-name').addEventListener('input', (e) => { draft.name = e.target.value; });
  document.getElementById('gd-emoji').addEventListener('input', (e) => { draft.emoji = e.target.value; });
  document.getElementById('gd-location').addEventListener('input', (e) => { draft.location = e.target.value; });
  document.getElementById('gd-headline').addEventListener('input', (e) => { draft.headline = e.target.value; });
  document.getElementById('gd-day').addEventListener('change', (e) => { draft.dayId = e.target.value; });

  card.querySelectorAll('.segmented .team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.session = btn.dataset.session;
      renderGameEditor(card);
    });
  });

  card.querySelectorAll('.format-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.format = btn.dataset.format;
      renderGameEditor(card);
    });
  });

  if (draft.format === 'tally') {
    document.getElementById('gd-unit').addEventListener('input', (e) => { draft.unit = e.target.value; });
    document.getElementById('gd-lowerwins').addEventListener('change', (e) => { draft.lowerWins = e.target.checked; });
    document.getElementById('gd-timeinput').addEventListener('change', (e) => { draft.timeInput = e.target.checked; });
    document.getElementById('gd-countersteps').addEventListener('input', (e) => { draft.counterSteps = e.target.value; });
  }

  const extrasDetails = document.getElementById('gd-extras');
  extrasDetails.addEventListener('toggle', () => { extrasOpen = extrasDetails.open; });

  document.getElementById('gd-timer-on').addEventListener('change', (e) => {
    if (e.target.checked) {
      draft.timer = draft.timer || { label: '', presets: '5' };
    } else {
      delete draft.timer;
    }
    extrasOpen = true;
    renderGameEditor(card);
  });
  const timerLabelInput = document.getElementById('gd-timer-label');
  if (timerLabelInput) timerLabelInput.addEventListener('input', (e) => { draft.timer.label = e.target.value; });
  const timerPresetsInput = document.getElementById('gd-timer-presets');
  if (timerPresetsInput) timerPresetsInput.addEventListener('input', (e) => { draft.timer.presets = e.target.value; });

  document.getElementById('gd-prompts').addEventListener('input', (e) => { draft.prompts = e.target.value; });
  document.getElementById('gd-double').addEventListener('change', (e) => {
    if (e.target.checked) draft.messtival = true;
    else delete draft.messtival;
  });

  card.querySelectorAll('.rules-h-input').forEach((input) => {
    input.addEventListener('input', (e) => { draft.rules[parseInt(e.target.dataset.idx, 10)].h = e.target.value; });
  });
  card.querySelectorAll('.rules-items-input').forEach((ta) => {
    ta.addEventListener('input', (e) => { draft.rules[parseInt(e.target.dataset.idx, 10)].items = e.target.value; });
  });
  card.querySelectorAll('.rules-section-editor .reorder-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveItem(draft.rules, parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.dir, 10));
      renderGameEditor(card);
    });
  });
  card.querySelectorAll('.rules-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.rules.splice(parseInt(btn.dataset.idx, 10), 1);
      renderGameEditor(card);
    });
  });
  document.getElementById('gd-add-rule').addEventListener('click', () => {
    draft.rules.push({ h: '', items: '' });
    renderGameEditor(card);
  });

  document.getElementById('gd-save-btn').addEventListener('click', saveGameDraft);

  if (!isNew) {
    document.getElementById('gd-duplicate-btn').addEventListener('click', duplicateGame);
    document.getElementById('gd-delete-btn').addEventListener('click', () => deleteGame(draft.id));
  }
}

function leaveGameEditor() {
  if (JSON.stringify(gameDraft) !== gameDraftSnapshot) {
    if (!confirm('Discard your changes to this game?')) return;
  }
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  saveState();
  renderAll();
}

function validateGameDraft(draft) {
  if (!draft.name || !draft.name.trim()) return 'Give the game a name.';
  if (!draft.format) return 'Pick a format.';
  // The drawing-round machinery (picRounds, photo keys, picSetup words) is
  // keyed by team only, not by game — two prompt games would share and
  // corrupt each other's rounds. Hard limit: one drawing game per week.
  if (String(draft.prompts || '').trim()) {
    const other = state.config.games.find((g) => g.id !== draft.id && Array.isArray(g.prompts) && g.prompts.length);
    if (other) return 'Only one game can have drawing prompts — remove them from "' + other.name + '" first.';
  }
  if (draft.format === 'tally' && draft.counterSteps && draft.counterSteps.trim()) {
    const tokens = draft.counterSteps.split(',').map((t) => t.trim());
    const bad = tokens.some((t) => !t || isNaN(parseFloat(t)) || parseFloat(t) <= 0);
    if (bad) return 'Counter buttons must be positive numbers, like 1, 5.';
  }
  if (draft.timer) {
    const tokens = String(draft.timer.presets || '').split(',').map((t) => t.trim()).filter(Boolean);
    const bad = !tokens.length || tokens.some((t) => isNaN(parseFloat(t)) || parseFloat(t) <= 0);
    if (bad) return 'Timer presets must be numbers of minutes, like 5, 3.';
  }
  return null;
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
  }

  if (out.timer) {
    const presets = String(out.timer.presets || '').split(',').map((t) => t.trim()).filter(Boolean)
      .map((t) => Math.round(parseFloat(t) * 60));
    out.timer.presets = presets;
    out.timer.label = (out.timer.label || '').trim();
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

function duplicateGame() {
  // Duplicates the SAVED game — warn if the open editor has unsaved edits,
  // otherwise they'd silently be left out of the copy.
  if (JSON.stringify(gameDraft) !== gameDraftSnapshot &&
      !confirm('You have unsaved edits — the duplicate is made from the last saved version. Continue?')) {
    return;
  }
  const original = gameById(gameDraft.id);
  if (!original) return;
  const copy = JSON.parse(JSON.stringify(original));
  copy.name = copy.name + ' (copy)';
  delete copy.prompts; // only one drawing-prompts game is supported per week
  const taken = new Set([...(state.config.games || []).map((g) => g.id), ...Object.keys(state.results || {})]);
  copy.id = makeId(copy.name, taken);
  const idx = state.config.games.findIndex((g) => g.id === original.id);
  state.config.games.splice(idx + 1, 0, copy);
  saveConfig();
  state.ui.editGameId = copy.id;
  gameDraft = null;
  gameDraftFor = null;
  saveState();
  renderAll();
}

function deleteGame(gameId) {
  const g = gameById(gameId);
  if (!g) return;
  const result = state.results[gameId];
  const day = dayById(g.dayId);
  const inProgress = !!state.brackets[gameId] || !!state.drafts[gameId];

  let msg;
  if (result) {
    msg = 'Delete "' + g.name + '"? Its saved result (gold: ' + teamName(result.medals.gold) + ') comes off the week medal count. This can\'t be undone.';
  } else {
    msg = 'Delete "' + g.name + '"? This removes it from ' + (day ? day.name + "'s lineup" : 'the lineup') + ". This can't be undone.";
  }
  if (inProgress) msg += ' A bracket is in progress — it will be thrown away.';

  if (!confirm(msg)) return;

  const idx = state.config.games.findIndex((x) => x.id === gameId);
  if (idx > -1) state.config.games.splice(idx, 1);
  delete state.results[gameId];
  delete state.brackets[gameId];
  delete state.drafts[gameId];
  if (state.picSetup) delete state.picSetup[gameId];
  if (state.live) delete state.live[gameId];
  if (state.ui.gameId === gameId) state.ui.gameId = null;
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  saveConfig();
  saveState();
  renderAll();
}

// ── Days tab ──────────────────────────────────────────────────────

function renderDaysTab(card) {
  const days = state.config.days || [];
  card.innerHTML = `
    <h3>Days (${days.length})</h3>
    ${days.length ? days.map((day, i) => dayRowHTML(day, i, days.length)).join('') : '<p class="muted">No days yet — add your first day.</p>'}
    <jelly-button class="secondary-btn" variant="platinum" id="add-day-btn">+ Add day</jelly-button>
  `;
  wireDaysTab(card);
}

function dayRowHTML(day, i, total) {
  const blockingGames = (state.config.games || []).filter((g) => g.dayId === day.id);
  return `
    <div class="rules-section-editor">
      <div class="builder-row">
        <jelly-icon-button class="reorder-btn" label="Move up" data-day-id="${esc(day.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
        <jelly-icon-button class="reorder-btn" label="Move down" data-day-id="${esc(day.id)}" data-dir="1" ${i === total - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
        <span class="day-index-label">Day ${i + 1}</span>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Name</label>
          <jelly-input class="form-input day-name-input" data-day-id="${esc(day.id)}" type="text" value="${esc(day.name)}"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Day of week</label>
          <jelly-select class="form-input day-dow-input" data-day-id="${esc(day.id)}" label="Day of week" placeholder="— none —" value="${day.dow == null ? '' : day.dow}">
            <jelly-option value="">— none —</jelly-option>
            ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n, dow) =>
              `<jelly-option value="${dow}">${n}</jelly-option>`).join('')}
          </jelly-select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Note</label>
        <jelly-textarea class="form-textarea day-note-input" data-day-id="${esc(day.id)}" rows="2" placeholder="e.g. 🎉 Messtival — double points! (shows as a banner)" value="${esc(day.note || '')}"></jelly-textarea>
      </div>
      <button type="button" class="link-btn danger-link day-delete-btn" data-day-id="${esc(day.id)}">Delete day</button>
      ${blockingGames.length ? `<p class="entry-error day-delete-error" data-day-id="${esc(day.id)}" hidden>${esc(day.name)} still has ${blockingGames.length} game${blockingGames.length === 1 ? '' : 's'}. Move or delete them first (Games tab).</p>` : ''}
    </div>
  `;
}

function wireDaysTab(card) {
  card.querySelectorAll('.reorder-btn[data-day-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = state.config.days;
      const idx = days.findIndex((d) => d.id === btn.dataset.dayId);
      moveItem(days, idx, parseInt(btn.dataset.dir, 10));
      saveConfig();
      renderAll();
    });
  });

  card.querySelectorAll('.day-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const day = dayById(input.dataset.dayId);
      if (!day) return;
      const val = input.value.trim();
      if (val) day.name = val;
      else input.value = day.name;
      saveConfig();
      renderAll();
    });
  });

  card.querySelectorAll('.day-dow-input').forEach((sel) => {
    sel.addEventListener('change', () => {
      const day = dayById(sel.dataset.dayId);
      if (!day) return;
      day.dow = sel.value === '' ? null : parseInt(sel.value, 10);
      saveConfig();
      renderAll();
    });
  });

  card.querySelectorAll('.day-note-input').forEach((ta) => {
    ta.addEventListener('change', () => {
      const day = dayById(ta.dataset.dayId);
      if (!day) return;
      day.note = ta.value;
      saveConfig();
      renderAll();
    });
  });

  card.querySelectorAll('.day-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteDay(btn.dataset.dayId));
  });

  const addBtn = document.getElementById('add-day-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      state.config.days.push({ id: 'd-' + Date.now().toString(36), name: 'New day', dow: null, note: '' });
      saveConfig();
      renderAll();
    });
  }
}

function deleteDay(dayId) {
  const day = dayById(dayId);
  if (!day) return;
  const blockingGames = (state.config.games || []).filter((g) => g.dayId === dayId);
  if (blockingGames.length) {
    // Blocked: reveal the inline error rendered (hidden) in this day's row.
    const errEl = document.querySelector(`.day-delete-error[data-day-id="${dayId}"]`);
    if (errEl) errEl.hidden = false;
    return;
  }

  if (!confirm('Delete "' + day.name + '"? It has no games.')) return;

  const idx = state.config.days.findIndex((d) => d.id === dayId);
  if (idx > -1) state.config.days.splice(idx, 1);
  if (state.ui.day === dayId) {
    state.ui.day = state.config.days[0] ? state.config.days[0].id : null;
  }
  saveConfig();
  saveState();
  renderAll();
}

// ── Teams tab ─────────────────────────────────────────────────────

function renderTeamsTab(card) {
  const teams = state.teams || [];
  const warn = teams.length !== 6
    ? `<p class="warn-note">⚠️ The bracket wizard is designed for 6 teams — you have ${teams.length}. Bracket games may need improvising.</p>`
    : '';
  card.innerHTML = `
    <h3>Teams (${teams.length})</h3>
    ${teams.length ? teams.map((t, i) => teamRowHTML(t, i, teams.length)).join('') : '<p class="muted">No teams yet. Add at least two to run games.</p>'}
    <jelly-button class="secondary-btn" variant="platinum" id="add-team-btn">+ Add team</jelly-button>
    ${warn}
  `;
  wireTeamsTab(card);
}

function teamRowHTML(team, i, total) {
  const disableDelete = total <= 2;
  return `
    <div class="builder-row team-builder-row">
      <jelly-icon-button class="reorder-btn" label="Move up" data-team-id="${esc(team.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
      <jelly-icon-button class="reorder-btn" label="Move down" data-team-id="${esc(team.id)}" data-dir="1" ${i === total - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
      <span class="team-builder-fields">
        <jelly-input class="form-input team-name-input" data-team-id="${esc(team.id)}" type="text" value="${esc(team.name)}" label="Team name"></jelly-input>
        <jelly-input class="form-input team-counselor-input" data-team-id="${esc(team.id)}" type="text" value="${esc(team.counselor || '')}" placeholder="Counselor(s)" label="Counselors"></jelly-input>
      </span>
      <jelly-icon-button class="row-delete-btn" variant="rose" label="Delete team" data-team-id="${esc(team.id)}" ${disableDelete ? 'disabled title="Keep at least 2 teams"' : ''}>✕</jelly-icon-button>
    </div>
  `;
}

function wireTeamsTab(card) {
  card.querySelectorAll('.reorder-btn[data-team-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = state.teams.findIndex((t) => t.id === btn.dataset.teamId);
      moveItem(state.teams, idx, parseInt(btn.dataset.dir, 10));
      saveState();
      renderAll();
    });
  });

  card.querySelectorAll('.team-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const team = state.teams.find((t) => t.id === input.dataset.teamId);
      if (!team) return;
      const val = input.value.trim();
      if (val) team.name = val;
      else input.value = team.name;
      saveState();
      renderAll();
    });
  });

  card.querySelectorAll('.team-counselor-input').forEach((input) => {
    input.addEventListener('change', () => {
      const team = state.teams.find((t) => t.id === input.dataset.teamId);
      if (!team) return;
      team.counselor = input.value.trim();
      saveState();
      renderAll();
    });
  });

  card.querySelectorAll('.row-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      deleteTeam(btn.dataset.teamId);
    });
  });

  const addBtn = document.getElementById('add-team-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      state.teams.push({ id: 't-' + Date.now().toString(36), name: 'Team ' + (state.teams.length + 1), counselor: '' });
      saveState();
      renderAll();
    });
  }
}

function deleteTeam(teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return;
  const refs = teamRefs(teamId);

  if (refs.medalCount > 0) {
    const plural = refs.medalCount === 1 ? '' : 's';
    alert('"' + team.name + '" has ' + refs.medalCount + ' medal' + plural + ' in saved results (' + refs.resultGames.join(', ') + '). Rename the team instead, or clear those results first.');
    return;
  }
  const bonusCount = Object.values(state.bonuses || {}).filter((b) => b && b.teamId === teamId).length;
  if (bonusCount > 0) {
    alert('"' + team.name + '" has ' + bonusCount + ' bonus point entr' + (bonusCount === 1 ? 'y' : 'ies') + ' (verse/cleanup/bonus). Rename the team instead, or remove those points first.');
    return;
  }

  const inProgressList = refs.inProgressGames.slice();
  if (refs.hasPicRound) inProgressList.push('Pumpkin Pictionary round');

  if (inProgressList.length) {
    if (!confirm('Remove "' + team.name + '"? They\'re in the middle of: ' + inProgressList.join(', ') + '. That progress will be thrown away.')) return;
  } else if (!confirm('Remove "' + team.name + '"? They\'ll disappear from every game and picker.')) {
    return;
  }

  removeTeamEverywhere(teamId);
  const idx = state.teams.findIndex((t) => t.id === teamId);
  if (idx > -1) state.teams.splice(idx, 1);
  saveState();
  renderAll();
}

function removeTeamEverywhere(teamId) {
  Object.keys(state.brackets || {}).forEach((gid) => {
    if (bracketRefsTeam(state.brackets[gid], teamId)) delete state.brackets[gid];
  });
  Object.values(state.drafts || {}).forEach((d) => {
    if (!d) return;
    if (d.scores) delete d.scores[teamId];
    if (d.medals) {
      Object.keys(d.medals).forEach((k) => { if (d.medals[k] === teamId) delete d.medals[k]; });
    }
  });
  if (state.picRounds) delete state.picRounds[teamId];
}

// ── Data tab ──────────────────────────────────────────────────────

function backupJSON() {
  const payload = {
    app: 'campScoreboardV2',
    exportedAt: new Date().toISOString(),
    config: state.config,
    teams: state.teams,
    results: state.results,
    brackets: state.brackets,
    drafts: state.drafts,
    picRounds: state.picRounds,
    picSetup: state.picSetup,
    bonuses: state.bonuses,
    live: state.live,
    announcements: state.announcements,
  };
  return JSON.stringify(payload, null, 2);
}

function renderDataTab(card) {
  card.innerHTML = `
    <div class="data-block">
      <h3>Back up</h3>
      <p class="muted">Your whole setup — teams, days, games, and saved scores.</p>
      <jelly-button class="secondary-btn" variant="platinum" id="copy-backup-btn">📋 Copy backup</jelly-button>
      <jelly-button class="secondary-btn" variant="platinum" id="download-backup-btn">⬇ Download backup</jelly-button>
    </div>
    <div class="data-block">
      <h3>Restore</h3>
      <jelly-textarea class="form-textarea" id="restore-textarea" rows="4" placeholder="Paste a backup here…"></jelly-textarea>
      <jelly-button class="secondary-btn" variant="platinum" id="import-text-btn">Import from text</jelly-button>
      <input type="file" id="restore-file-input" accept="application/json,.json" hidden>
      <jelly-button class="secondary-btn" variant="platinum" id="import-file-btn">📂 Import from file</jelly-button>
      <p class="entry-error" id="restore-error" hidden></p>
    </div>
    <div class="danger-zone">
      <h3>Danger zone</h3>
      <button type="button" class="link-btn danger-link" id="restore-defaults-btn">Restore default games &amp; days</button>
      <p class="muted">Week score reset lives on the scoreboard page.</p>
    </div>
  `;
  wireDataTab(card);
}

function wireDataTab(card) {
  const copyBtn = document.getElementById('copy-backup-btn');
  copyBtn.addEventListener('click', () => copyTextToClipboard(backupJSON(), copyBtn));

  document.getElementById('download-backup-btn').addEventListener('click', () => {
    const blob = new Blob([backupJSON()], { type: 'application/json' });
    downloadBlob(blob, 'camp-scoreboard-backup-' + new Date().toISOString().slice(0, 10) + '.json');
  });

  document.getElementById('import-text-btn').addEventListener('click', () => {
    tryImport(document.getElementById('restore-textarea').value);
  });

  const fileInput = document.getElementById('restore-file-input');
  document.getElementById('import-file-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => tryImport(String(reader.result || ''));
    reader.readAsText(file);
  });

  document.getElementById('restore-defaults-btn').addEventListener('click', restoreDefaults);
}

function tryImport(text) {
  const errEl = document.getElementById('restore-error');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    errEl.textContent = "That doesn't look like a Camp Scoreboard backup. Copy it fresh and paste the whole thing.";
    errEl.hidden = false;
    return;
  }

  let config = null;
  if (parsed && parsed.config && Array.isArray(parsed.config.games)) {
    config = parsed.config;
  } else if (parsed && Array.isArray(parsed.games)) {
    config = parsed; // legacy backup: the whole object IS the config
  }

  if (!config) {
    errEl.textContent = "That doesn't look like a Camp Scoreboard backup. Copy it fresh and paste the whole thing.";
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;

  if (!confirm("Replace this device's entire setup (teams, days, games) AND saved scores? This syncs to every device. Consider downloading a backup first.")) return;

  state.config = config;
  migrateState(state);
  // Only accept correctly-typed sections — a hand-edited backup with e.g.
  // "results": null would crash every render after it had already synced.
  if (Array.isArray(parsed.teams) && parsed.teams.length) state.teams = parsed.teams;
  ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live'].forEach((key) => {
    const v = parsed[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) state[key] = v;
  });
  pruneOrphanedGameData();

  saveConfig();
  saveState();
  renderAll();
}

// Drop results/brackets/drafts for game ids that no longer exist in the
// config — otherwise their medals keep counting in standings forever with
// no UI left to clear them.
function pruneOrphanedGameData() {
  const ids = new Set((state.config.games || []).map((g) => g.id));
  ['results', 'brackets', 'drafts', 'picSetup', 'live'].forEach((key) => {
    Object.keys(state[key] || {}).forEach((gid) => {
      if (!ids.has(gid)) delete state[key][gid];
    });
  });
  if (state.ui.gameId && !ids.has(state.ui.gameId)) state.ui.gameId = null;
}

function restoreDefaults() {
  const def = defaultConfig();
  if (!confirm('Put back the original ' + def.games.length + ' games and 5 days? Your custom games and days are thrown away. Team names and saved results are kept.')) return;

  state.config = defaultConfig();
  if (!state.config.days.some((d) => d.id === state.ui.day)) {
    state.ui.day = state.config.days[0] ? state.config.days[0].id : null;
  }
  pruneOrphanedGameData(); // custom games' results would otherwise haunt the standings
  saveConfig();
  saveState();
  renderAll();
}
