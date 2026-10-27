// ── Settings / builder UI ────────────────────────────────────────
// Renders into #settings-view. This file never touches localStorage
// or state directly except through the globals app.js provides:
// saveConfig(), saveState(), renderAll(), canEdit(), esc(), gameById(),
// dayById(), teamName(), medalCounts(), copyTextToClipboard(),
// downloadBlob(), FORMAT_BADGES, defaultConfig(), migrateState(),
// normalizeSyncedState(), noticeBoard(), noticeCardHtml(), defaultNotice(),
// teamEmoji(), teamName().
//
// The game editor stages every edit in a local draft (gameDraft) and
// only writes to state.config on Save — nothing else in the app can
// see a game mid-edit.

const SETTINGS_TABS = [
  { key: 'games', label: 'Games' },
  { key: 'days', label: 'Days' },
  { key: 'teams', label: 'Teams' },
  { key: 'notice', label: 'Notice' },
  { key: 'data', label: 'Data' },
];

let gameDraft = null;
let gameDraftFor = null; // which editGameId gameDraft was built for
let gameDraftSnapshot = '';
let gameDraftSource = ''; // canonical JSON of the saved game the draft was built from
let extrasOpen = false;
let quickGamePrefill = null; // one-shot defaults for the next new-game draft

// True while the game editor holds unsaved edits. app.js's editorMidEntry()
// checks this so the update-poll auto-reload and remote merges never wipe a
// half-built game. Only while the editor is actually open: a draft stranded
// behind a closed builder used to keep editorMidEntry() true forever — that
// phone silently stopped adopting other editors' scores and never reloaded.
function builderDirty() {
  return state.ui.view === 'settings' && !!state.ui.editGameId &&
    !!gameDraft && JSON.stringify(gameDraft) !== gameDraftSnapshot;
}

// Close the game editor and drop its draft. Also called by app.js's renderAll
// when it force-closes the builder for a device that lost editor access.
function discardGameDraft() {
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
}

// ── Entry point ───────────────────────────────────────────────────

// Fill one builder section's card. Called for the ACTIVE card by renderSettings
// and for the newly shown one by the tab-change handler; each tab writes its
// markup through setHtmlIfChanged, so an unchanged card costs nothing.
//
// Rewriting a card briefly collapses the page while its new Jelly elements
// upgrade (their connectedCallbacks force layout), and the browser clamps
// scrollY to that momentary height — every reorder, add, or remote update
// threw the builder back to the top. Put the offset back in the same task,
// before anything paints. Opening a game from the list (or going back to the
// list) is a new view, so that one starts at the top, as it always did.
function renderSettingsSection(key, card) {
  const y = window.scrollY;
  const cardView = key === 'games' && state.ui.editGameId ? 'game:' + state.ui.editGameId : key;
  const newView = card.__view !== undefined && card.__view !== cardView;
  card.__view = cardView;
  if (key === 'games' && state.ui.editGameId) renderGameEditor(card);
  else if (key === 'days') renderDaysTab(card);
  else if (key === 'teams') renderTeamsTab(card);
  else if (key === 'notice') renderNoticeTab(card);
  else if (key === 'data') renderDataTab(card);
  else renderGamesTab(card);
  if (newView) window.scrollTo(0, 0);
  else if (window.scrollY !== y) window.scrollTo(0, y);
}

// A freshly created jelly-tabs places its pill under the FIRST tab (its
// segments haven't upgraded when it first measures), then springs it across
// to the real one — half a second of a wobbling pill over the wrong label.
// Snap it home in the same task. Only for programmatic placement: a user's
// own tap keeps the spring.
function settleBuilderTabPill(tabs) {
  const seg = tabs && tabs.shadowRoot && tabs.shadowRoot.querySelector('jelly-segmented');
  if (!seg || typeof seg.pillTarget !== 'number') return;
  seg.pillX = seg.pillTarget;
  seg.pillXVelocity = 0;
  if (typeof seg.requestFrame === 'function') seg.requestFrame();
}

function renderSettings() {
  const view = document.getElementById('settings-view');
  if (!view) return;
  const tab = state.ui.settingsTab || 'games';
  const updatedStamp = formatEasternStamp(state.config.updatedAt); // camp time, like the footer
  const updatedLine = updatedStamp ? `<p class="muted">Last edited ${esc(updatedStamp)}</p>` : '';

  // A jelly-tabs with one panel per section: switching is handled by the
  // component (pill spring + panel fade), no renderAll round-trip. The shell
  // is built ONCE and kept — re-creating it on every renderAll re-sprang the
  // pill from the Games tab, cost a ~1 s freeze on a phone (all five cards
  // rebuilt, four of them hidden) and threw the page back to the top. Only
  // the active card is refreshed here; a hidden one is refreshed when its tab
  // is shown (the change handler below).
  let tabs = view.querySelector('jelly-tabs.settings-tabs');
  if (!tabs) {
    view.innerHTML = `
      <button class="link-btn back-btn" id="settings-back-btn">← Back to scoreboard</button>
      <h2>Set up the week</h2>
      <div class="settings-updated"></div>
      <jelly-tabs class="settings-tabs" size="small" value="${esc(tab)}">
        ${SETTINGS_TABS.map((t) =>
          `<jelly-tab-panel value="${t.key}" label="${esc(t.label)}"${t.key === tab ? ' active' : ''}>
            ${t.key === 'games' ? '' : '<div class="settings-unsaved"></div>'}
            <div class="card settings-card" data-settings-card="${t.key}"></div>
          </jelly-tab-panel>`).join('')}
      </jelly-tabs>
    `;
    tabs = view.querySelector('jelly-tabs.settings-tabs');

    document.getElementById('settings-back-btn').addEventListener('click', () => {
      // Same guard as "← All games" and Cancel (leaveGameEditor) — the open
      // editor may be on another tab, so name the game.
      if (builderDirty()) {
        const what = gameDraft.name && gameDraft.name.trim() ? '"' + gameDraft.name.trim() + '"' : 'this game';
        if (!confirm('Discard your unsaved changes to ' + what + '?')) {
          if (state.ui.settingsTab !== 'games') { state.ui.settingsTab = 'games'; saveState(); renderAll(); }
          return;
        }
      }
      discardGameDraft();
      state.ui.view = 'home';
      saveState();
      renderAll();
      // The home cards were display:none behind the builder, so the page had
      // collapsed under it — put the scoreboard back where it was.
      if (typeof builderReturnY === 'number') window.scrollTo(0, builderReturnY);
    });

    view.querySelectorAll('.settings-unsaved').forEach((note) => {
      note.addEventListener('click', (e) => {
        if (!e.target.closest || !e.target.closest('[data-act="unsaved-go"]')) return;
        state.ui.settingsTab = 'games';
        saveState();
        renderAll(); // renderSettings moves the tabs and shows the open editor
      });
    });

    tabs.addEventListener('change', (e) => {
      const key = e.detail && e.detail.value;
      if (!key || key === state.ui.settingsTab) return;
      state.ui.settingsTab = key;
      // An open game editor (and its unsaved draft) stays where it is — it's
      // still there when Games is tapped again. This used to throw the draft
      // away with no confirm, unlike "← All games" and Cancel. builderDirty()
      // stays true meanwhile, so remote merges and auto-reload can't wipe it.
      // The component has already swapped the visible panel; bring that card
      // up to date before it paints (a no-op when nothing changed).
      const card = view.querySelector(`[data-settings-card="${key}"]`);
      if (card) renderSettingsSection(key, card);
      syncUnsavedNotes(view);
      saveState();
    });
    settleBuilderTabPill(tabs);
  } else if (tabs.getAttribute('value') !== tab) {
    // Programmatic (openBuilder with a tab): the change handler sees the key
    // already recorded and returns, so the card is refreshed below.
    tabs.setAttribute('value', tab);
    settleBuilderTabPill(tabs);
  }

  setHtmlIfChanged(view.querySelector('.settings-updated'), updatedLine);
  // Without the Jelly module (html.jelly-failed — iOS < 16.4 can't parse it)
  // there is no tab bar to reveal a hidden card and every panel shows, so
  // fill them all, as before.
  const tabbed = typeof customElements !== 'undefined' && !!customElements.get('jelly-tabs');
  SETTINGS_TABS.forEach((t) => {
    if (tabbed && t.key !== tab) return;
    const card = view.querySelector(`[data-settings-card="${t.key}"]`);
    if (card) renderSettingsSection(t.key, card);
  });
  syncUnsavedNotes(view);
  if (tabbed) scheduleBuilderPrefill();
}

// A game draft with edits in it survives a trip to another tab (see the
// change handler) — and while it does, this phone holds off remote merges and
// the update auto-reload. Nothing else says an unsaved game is open, so every
// other tab carries a one-line reminder with a way back. The note sits INSIDE
// the panel, under the tab bar, so showing it never moves the bar itself.
function syncUnsavedNotes(view) {
  const dirty = builderDirty();
  const name = dirty && gameDraft.name && gameDraft.name.trim();
  const what = name ? '"' + name + '"' : 'a game';
  view.querySelectorAll('.settings-unsaved').forEach((note) => {
    setHtmlIfChanged(note, dirty
      ? `<p class="warn-note">Unsaved changes to ${esc(what)} are waiting on the <button type="button" class="link-btn" data-act="unsaved-go">Games tab</button>.</p>`
      : '');
  });
}

// Hidden cards are built in idle time, one per slice, after the active card:
// a card first built inside the tab-change handler stalled the main thread
// (270-680 ms per tab on a 4x-throttled CPU) right as the pill spring began,
// and building them all inside renderAll was the ~1.3 s freeze this replaced.
// Only never-built cards are touched here — a built one is refreshed when its
// tab is shown, as before — so a result snapshot still costs the active card
// alone. (A card that was never filled has no __view; renderSettingsSection
// sets it.)
let builderPrefillTimer = 0;

function nextUnbuiltBuilderCard(view) {
  const active = state.ui.settingsTab || 'games';
  for (const t of SETTINGS_TABS) {
    if (t.key === active) continue;
    const card = view.querySelector(`[data-settings-card="${t.key}"]`);
    if (card && card.__view === undefined) return { key: t.key, card };
  }
  return null;
}

function scheduleBuilderPrefill() {
  if (builderPrefillTimer) return;
  const view = document.getElementById('settings-view');
  if (!view || !nextUnbuiltBuilderCard(view)) return;
  const run = () => { builderPrefillTimer = 0; prefillBuilderCard(); };
  // Safari has no requestIdleCallback; a short timeout is the same idea.
  builderPrefillTimer = typeof requestIdleCallback === 'function'
    ? requestIdleCallback(run, { timeout: 2000 })
    : setTimeout(run, 150);
}

function prefillBuilderCard() {
  const view = document.getElementById('settings-view');
  // Builder closed meanwhile (or never connected): stop; the next open's
  // renderSettings starts it again.
  if (!view || state.ui.view !== 'settings') return;
  const next = nextUnbuiltBuilderCard(view);
  if (!next) return;
  renderSettingsSection(next.key, next.card);
  scheduleBuilderPrefill();
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

  const wrote = setHtmlIfChanged(card, `
    <jelly-button class="primary-btn" id="new-game-btn">+ New game</jelly-button>
    ${groupsHTML}
  `);
  // The result dots are the only thing a score changes here, so they're
  // patched in place instead of being part of the markup: rebuilding ~70
  // Jelly controls froze a phone for most of a second every time anyone
  // saved a score while this list was open. Re-stamp the DOM snapshot so the
  // next setHtmlIfChanged knows the patch was ours.
  let patched = false;
  card.querySelectorAll('.result-dot[data-game-id]').forEach((dot) => {
    const off = !state.results[dot.dataset.gameId];
    if (dot.hidden !== off) { dot.hidden = off; patched = true; }
  });
  if (patched) card.__dom = card.innerHTML;
  if (!wrote) return;

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
  // The dot is always in the markup, hidden; renderGamesTab shows it when the
  // game has a saved result (patched in place — see there).
  return `
    <div class="builder-row game-row">
      <jelly-icon-button class="reorder-btn" label="Move up" data-game-id="${esc(g.id)}" data-dir="-1" ${idx <= 0 ? 'disabled' : ''}>↑</jelly-icon-button>
      <jelly-icon-button class="reorder-btn" label="Move down" data-game-id="${esc(g.id)}" data-dir="1" ${idx >= group.length - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
      <button type="button" class="game-row-main" data-game-id="${esc(g.id)}">
        <span class="game-emoji">${esc(g.emoji || '')}</span>
        <span class="game-row-name">${esc(g.name)}</span>
        <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge>
        <span class="result-dot" data-game-id="${esc(g.id)}" title="Has a saved result" hidden>●</span>
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

// Canonical form (RTDB key order, nulls pruned) so a config echo that only
// re-sorted keys doesn't read as somebody else's edit.
function gameSourceKey(g) {
  return g ? JSON.stringify(syncCanon(g)) : '';
}

function ensureGameDraft() {
  const editId = state.ui.editGameId;
  if (gameDraftFor === editId && gameDraft) {
    // A draft with edits in it (and any new-game draft) is the user's work —
    // keep it. A CLEAN draft of a saved game is refreshed when another editor
    // changes that game: it used to keep showing the old values, and the
    // next Save silently wrote them back over the other editor's change.
    if (editId === 'new' || JSON.stringify(gameDraft) !== gameDraftSnapshot) return;
    const saved = gameById(editId);
    if (!saved || gameSourceKey(saved) === gameDraftSource) return;
  } else {
    extrasOpen = false; // a refresh keeps the user's own disclosure state
  }
  gameDraftFor = editId;
  const g = editId === 'new' ? null : gameById(editId);
  gameDraft = toEditableDraft(g || newGameShape());
  gameDraftSource = gameSourceKey(g);
  gameDraftSnapshot = JSON.stringify(gameDraft);
}

function renderGameEditor(card) {
  ensureGameDraft();
  const draft = gameDraft;
  const isNew = state.ui.editGameId === 'new';
  const hasSavedResult = !isNew && !!state.results[draft.id];

  // wireGameEditor closes over the draft OBJECT, so a rebuilt draft (another
  // game, or a clean one refreshed from a remote edit) must be re-wired even
  // when its markup happens to match — or the inputs would edit the old copy.
  // #gd-error sits BELOW Save on purpose: appearing above it pushed Save down
  // under the finger that had just tapped it.
  if (card.__draft !== draft) card.__html = null;
  if (!setHtmlIfChanged(card, `
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
    ${draft.format === 'tournament' ? tournamentFieldsHTML(draft) : ''}

    <details class="rules-details" id="gd-extras" ${extrasOpen ? 'open' : ''}>
      <summary>Tools &amp; extras</summary>
      ${extrasHTML(draft)}
    </details>

    <h3>How to play</h3>
    <div id="gd-rules">${rulesEditorHTML(draft)}</div>
    <button type="button" class="link-btn" id="gd-add-rule">+ Add section</button>

    <div class="editor-actions">
      <jelly-button class="primary-btn" id="gd-save-btn">Save game</jelly-button>
      <button type="button" class="link-btn" id="gd-cancel-btn">Cancel</button>
    </div>
    <p class="entry-error" id="gd-error" hidden></p>

    ${!isNew ? `
      <div class="editor-footer">
        <jelly-button class="secondary-btn" variant="platinum" id="gd-duplicate-btn">Duplicate game</jelly-button>
        <button type="button" class="link-btn danger-link" id="gd-delete-btn">Delete game</button>
      </div>
    ` : ''}
  `)) return;
  card.__draft = draft;

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
    <jelly-checkbox class="checkbox-field" id="gd-allownegative" size="small" ${draft.counterAllowNegative ? 'checked' : ''}>Totals can go negative</jelly-checkbox>
    <jelly-checkbox class="checkbox-field" id="gd-liverankings" size="small" ${draft.liveRankings ? 'checked' : ''}>🔴 Live leaderboard — spectators watch the totals climb while you score</jelly-checkbox>
  `;
}

// Tournament-only: the live per-match scoreboard (what Jeb Ball uses) — a
// synced score stepper per team, promoted to the home screen's Big Board
// while the match runs. 1 period + 0 outs = a plain running score;
// Kangaroo Kickball uses 3 innings + 3 outs for the full kickball flow.
function tournamentFieldsHTML(draft) {
  // Ladder Ball carries its own bespoke round scorer (ladderScoring), which
  // takes precedence over the generic tracker — offering the toggle here
  // would silently do nothing, so explain instead.
  if (draft.ladderScoring) {
    return '<p class="field-help muted">🔴 This game uses its own Ladder Ball round scorer (cancellation scoring, first to exactly ' +
      esc(draft.ladderScoring.target || 21) + ') — spectators already get a live board for each match.</p>';
  }
  const t = draft.liveTracker;
  return `
    <jelly-checkbox class="checkbox-field" id="gd-tracker-on" size="small" ${t ? 'checked' : ''}>🔴 Live match scoreboard — score steppers spectators watch live (like Jeb Ball)</jelly-checkbox>
    ${t ? `
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">What's counted</label>
          <jelly-input class="form-input" id="gd-tracker-unit" type="text" value="${esc(t.unit || '')}" placeholder="Goals, runs, points…"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Period name</label>
          <jelly-input class="form-input" id="gd-tracker-periodlabel" type="text" value="${esc(t.periodLabel || '')}" placeholder="Half, Inning, Round"></jelly-input>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Periods</label>
          <jelly-input class="form-input" id="gd-tracker-innings" type="text" value="${esc(t.innings || '')}" placeholder="1"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Outs per side</label>
          <jelly-input class="form-input" id="gd-tracker-outs" type="text" value="${esc(t.outs == null ? '' : t.outs)}" placeholder="0"></jelly-input>
        </div>
      </div>
      <p class="field-help muted">1 period and 0 outs gives a plain running score. Outs above 0 adds the kickball-style outs &amp; kicking-team rows.</p>
    ` : ''}
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
      <div class="form-field">
        <label class="form-label">Rounds</label>
        <jelly-input class="form-input" id="gd-timer-rounds" type="text" value="${esc(draft.timer.rounds || '')}" placeholder="e.g. 4"></jelly-input>
        <p class="field-help muted">Optional. Shows "Round X of N" on the clock with a Next-round button between rounds. Blank = a plain one-shot timer.</p>
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

  // A validation message answers the LAST Save tap — the next edit clears it,
  // instead of "Give the game a name." staying up beside a name. Delegated on
  // the card (which outlives each re-render), so it's attached only once.
  if (!card.__clearsGameError) {
    card.__clearsGameError = true;
    const clearError = () => {
      const errEl = document.getElementById('gd-error');
      if (errEl && !errEl.hidden) errEl.hidden = true;
    };
    card.addEventListener('input', clearError);
    card.addEventListener('change', clearError);
  }

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
      // Live scoring is the house default (owner's call, 2026-07-24): a game
      // picking up a scoreable format comes with its live surface switched on.
      if (draft.format === 'tally' && draft.liveRankings === undefined) draft.liveRankings = true;
      if (draft.format === 'tournament' && draft.liveTracker === undefined) {
        draft.liveTracker = { unit: 'Points', periodLabel: 'Round', innings: '1', outs: '0' };
      }
      renderGameEditor(card);
    });
  });

  if (draft.format === 'tally') {
    document.getElementById('gd-unit').addEventListener('input', (e) => { draft.unit = e.target.value; });
    document.getElementById('gd-lowerwins').addEventListener('change', (e) => { draft.lowerWins = e.target.checked; });
    document.getElementById('gd-timeinput').addEventListener('change', (e) => { draft.timeInput = e.target.checked; });
    document.getElementById('gd-countersteps').addEventListener('input', (e) => { draft.counterSteps = e.target.value; });
    document.getElementById('gd-allownegative').addEventListener('change', (e) => {
      if (e.target.checked) draft.counterAllowNegative = true;
      else delete draft.counterAllowNegative;
    });
    document.getElementById('gd-liverankings').addEventListener('change', (e) => {
      if (e.target.checked) draft.liveRankings = true;
      else delete draft.liveRankings;
    });
  }

  if (draft.format === 'tournament') {
    // Absent for ladderScoring games (they get an explanatory note instead).
    const trackerOn = document.getElementById('gd-tracker-on');
    if (trackerOn) trackerOn.addEventListener('change', (e) => {
      if (e.target.checked) {
        draft.liveTracker = draft.liveTracker || { unit: 'Points', periodLabel: 'Round', innings: '1', outs: '0' };
      } else {
        delete draft.liveTracker;
      }
      renderGameEditor(card);
    });
    const trackerUnit = document.getElementById('gd-tracker-unit');
    if (trackerUnit) trackerUnit.addEventListener('input', (e) => { draft.liveTracker.unit = e.target.value; });
    const trackerPeriod = document.getElementById('gd-tracker-periodlabel');
    if (trackerPeriod) trackerPeriod.addEventListener('input', (e) => { draft.liveTracker.periodLabel = e.target.value; });
    const trackerInnings = document.getElementById('gd-tracker-innings');
    if (trackerInnings) trackerInnings.addEventListener('input', (e) => { draft.liveTracker.innings = e.target.value; });
    const trackerOuts = document.getElementById('gd-tracker-outs');
    if (trackerOuts) trackerOuts.addEventListener('input', (e) => { draft.liveTracker.outs = e.target.value; });
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
  const timerRoundsInput = document.getElementById('gd-timer-rounds');
  if (timerRoundsInput) timerRoundsInput.addEventListener('input', (e) => { draft.timer.rounds = e.target.value; });

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
  discardGameDraft();
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
    const rounds = String(draft.timer.rounds || '').trim();
    if (rounds && (!/^\d+$/.test(rounds) || parseInt(rounds, 10) < 1)) {
      return 'Timer rounds must be a whole number like 4, or blank for no rounds.';
    }
  }
  if (draft.format === 'tournament' && draft.liveTracker) {
    const innings = String(draft.liveTracker.innings == null ? '' : draft.liveTracker.innings).trim();
    if (innings && (!/^\d+$/.test(innings) || parseInt(innings, 10) < 1)) {
      return 'Scoreboard periods must be a whole number, like 1 or 2.';
    }
    const outs = String(draft.liveTracker.outs == null ? '' : draft.liveTracker.outs).trim();
    if (outs && !/^\d+$/.test(outs)) {
      return 'Outs per side must be 0 or a whole number.';
    }
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
    // The message sits BELOW Save (so Save never moves under the finger), which
    // on a new game is at the foot of the page — bring it into view.
    if (typeof errEl.scrollIntoView === 'function') errEl.scrollIntoView({ block: 'nearest' });
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
  // Unchanged ⇒ untouched (the wiring re-reads state at tap time, so the
  // existing listeners stay correct).
  if (setHtmlIfChanged(card, `
    <h3>Days (${days.length})</h3>
    ${days.length ? days.map((day, i) => dayRowHTML(day, i, days.length)).join('') : '<p class="muted">No days yet — add your first day.</p>'}
    <jelly-button class="secondary-btn" variant="platinum" id="add-day-btn">+ Add day</jelly-button>
  `)) wireDaysTab(card);
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

  // Text/dow commits deliberately do NOT renderAll: change fires on blur —
  // usually because the user tapped the NEXT field — and a re-render here
  // replaces the whole card's DOM, destroying the field mid-tap (focus and
  // keyboard vanish; every second tap "doesn't work"). The input already
  // shows the committed value, and everything else that renders these
  // values is hidden behind the builder until the next renderAll anyway.
  card.querySelectorAll('.day-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const day = dayById(input.dataset.dayId);
      if (!day) return;
      const val = input.value.trim();
      if (val) day.name = val;
      else input.value = day.name;
      saveConfig();
    });
  });

  card.querySelectorAll('.day-dow-input').forEach((sel) => {
    sel.addEventListener('change', () => {
      const day = dayById(sel.dataset.dayId);
      if (!day) return;
      day.dow = sel.value === '' ? null : parseInt(sel.value, 10);
      saveConfig();
    });
  });

  card.querySelectorAll('.day-note-input').forEach((ta) => {
    ta.addEventListener('change', () => {
      const day = dayById(ta.dataset.dayId);
      if (!day) return;
      day.note = ta.value;
      saveConfig();
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
    ? `<p class="warn-note">⚠️ The bracket wizard is designed for 6 teams — you have ${teams.length}${CAMP.teamCount !== 6 ? ` (this camp normally runs ${CAMP.teamCount})` : ''}. Bracket games may need improvising.</p>`
    : '';
  // Unchanged ⇒ untouched (the wiring re-reads state.teams at tap time).
  if (setHtmlIfChanged(card, `
    <h3>Teams (${teams.length})</h3>
    ${teams.length ? teams.map((t, i) => teamRowHTML(t, i, teams.length)).join('') : '<p class="muted">No teams yet. Add at least two to run games.</p>'}
    <jelly-button class="secondary-btn" variant="platinum" id="add-team-btn">+ Add team</jelly-button>
    ${warn}
  `)) wireTeamsTab(card);
}

// Controls on their own line above full-width inputs (same shape as a day
// row): squeezed between the arrows and ✕ in one row, the name inputs were
// ~160px on a phone and clipped most team names while they were being edited.
function teamRowHTML(team, i, total) {
  const disableDelete = total <= 2;
  return `
    <div class="rules-section-editor team-builder-row">
      <div class="builder-row">
        <jelly-icon-button class="reorder-btn" label="Move up" data-team-id="${esc(team.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
        <jelly-icon-button class="reorder-btn" label="Move down" data-team-id="${esc(team.id)}" data-dir="1" ${i === total - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
        <span class="day-index-label">Team ${i + 1}</span>
        <jelly-icon-button class="row-delete-btn" variant="rose" label="Delete team" data-team-id="${esc(team.id)}" ${disableDelete ? 'disabled title="Keep at least 2 teams"' : ''}>✕</jelly-icon-button>
      </div>
      <span class="team-builder-fields">
        <jelly-input class="form-input team-name-input" data-team-id="${esc(team.id)}" type="text" value="${esc(team.name)}" label="Team name"></jelly-input>
        <jelly-input class="form-input team-counselor-input" data-team-id="${esc(team.id)}" type="text" value="${esc(team.counselor || '')}" placeholder="Counselor(s)" label="Counselors"></jelly-input>
      </span>
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

  // No renderAll on text commits — same focus-steal reasoning as the Days
  // tab (see wireDaysTab): a blur-triggered rebuild eats the tap that
  // caused the blur.
  card.querySelectorAll('.team-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const team = state.teams.find((t) => t.id === input.dataset.teamId);
      if (!team) return;
      const val = input.value.trim();
      if (val) team.name = val;
      else input.value = team.name;
      saveState();
    });
  });

  card.querySelectorAll('.team-counselor-input').forEach((input) => {
    input.addEventListener('change', () => {
      const team = state.teams.find((t) => t.id === input.dataset.teamId);
      if (!team) return;
      team.counselor = input.value.trim();
      saveState();
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

// ── Notice tab ────────────────────────────────────────────────────
// Composes the big top-of-page notice board (state.notice — see the notice
// board block in app.js). Form hooks are prefixed `nb-` so they can never
// collide with the card's own `notice-` classes: the live preview below
// renders the real card, so both sets of markup sit inside this one tab. Everything here edits the live synced object; the
// only thing that decides whether anyone else sees it is Draft vs Posted.
//
// Field commits deliberately do NOT renderAll — `change` fires on blur,
// usually because the user tapped the NEXT field, and re-rendering would
// destroy that field mid-tap (same reasoning as the Days tab). The preview
// is refreshed on its own instead.

function renderNoticeTab(card) {
  const n = noticeBoard();
  const posted = n.status === 'posted';
  const unassigned = (state.teams || []).filter((t) => !n.zones.some((z) => z.teamId === t.id));

  // Unchanged ⇒ untouched. Safe even when a remote snapshot has replaced
  // state.notice: wireNoticeTab's handlers look the notice up when they fire.
  if (!setHtmlIfChanged(card, `
    <div class="notice-status-row ${posted ? 'is-posted' : 'is-draft'}">
      <div>
        <div class="notice-status-label">${posted ? '🟢 Posted to every phone' : '📝 Draft — nobody can see it'}</div>
        <p class="muted notice-status-hint">${posted
          ? 'This card is at the top of the page on every device. Put it back to draft to take it down.'
          : 'Edit as long as you like. Nothing shows until you post it.'}</p>
      </div>
      <jelly-button class="secondary-btn" variant="${posted ? 'platinum' : 'primary'}" id="notice-post-btn">
        ${posted ? 'Take it down' : 'Post it'}
      </jelly-button>
    </div>

    <div class="data-block">
      <h3>Wording</h3>
      <div class="form-field">
        <label class="form-label">Small label (top line)</label>
        <jelly-input class="form-input nb-field" data-nb-field="eyebrow" type="text" value="${esc(n.eyebrow)}" placeholder="🧹 Campground cleanup · 8:30–9:30am"></jelly-input>
      </div>
      <div class="form-field">
        <label class="form-label">Heading</label>
        <jelly-input class="form-input nb-field" data-nb-field="title" type="text" value="${esc(n.title)}" placeholder="Where your team cleans"></jelly-input>
      </div>
      <div class="form-field">
        <label class="form-label">Intro line</label>
        <jelly-textarea class="form-textarea nb-field" data-nb-field="sub" rows="2" placeholder="One or two sentences under the heading." value="${esc(n.sub)}"></jelly-textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Closing line</label>
        <jelly-input class="form-input nb-field" data-nb-field="signoff" type="text" value="${esc(n.signoff)}" placeholder="Let's leave these grounds better than we found them!"></jelly-input>
      </div>
    </div>

    <div class="data-block">
      <h3>Team assignments (${n.zones.length})</h3>
      <p class="muted">Optional. Anyone following a team sees their own line called out at the top of the card.</p>
      ${n.zones.length
        ? n.zones.map((z, i) => noticeZoneRowHTML(z, i, n.zones.length)).join('')
        : '<p class="muted">No teams listed — the card just shows the wording and steps below.</p>'}
      ${unassigned.length ? `
        <div class="form-field">
          <label class="form-label">Add a team</label>
          <jelly-select class="form-input" id="notice-add-zone" label="Add a team" placeholder="— pick a team —" value="">
            <jelly-option value="">— pick a team —</jelly-option>
            ${unassigned.map((t) => `<jelly-option value="${esc(t.id)}">${esc(t.name)}</jelly-option>`).join('')}
          </jelly-select>
        </div>` : ''}
    </div>

    <div class="data-block">
      <h3>Steps (${n.steps.length})</h3>
      <p class="muted">Each step is a heading and a bulleted list — one bullet per line.</p>
      ${n.steps.map((st, i) => noticeStepRowHTML(st, i, n.steps.length)).join('')}
      <jelly-button class="secondary-btn" variant="platinum" id="notice-add-step">+ Add step</jelly-button>
    </div>

    <div class="data-block">
      <h3>Preview</h3>
      <p class="muted">Exactly how it looks at the top of the page${posted ? '' : ' once posted'}.</p>
      <div class="notice-preview" id="notice-preview">${noticeCardHtml(true)}</div>
    </div>

    <div class="danger-zone">
      <h3>Start over</h3>
      <button type="button" class="link-btn danger-link" id="notice-reset-btn">Reset to the cleanup example</button>
      <button type="button" class="link-btn danger-link" id="notice-clear-btn">Clear it out</button>
    </div>
  `)) return;
  wireNoticeTab(card);
}

function noticeZoneRowHTML(z, i, total) {
  const name = state.teams.some((t) => t.id === z.teamId)
    ? `${teamEmoji(z.teamId)} ${esc(teamName(z.teamId))}`
    : `<span class="muted">Unknown team (${esc(z.teamId)})</span>`;
  return `
    <div class="rules-section-editor">
      <div class="builder-row">
        <jelly-icon-button class="nb-zone-move" label="Move up" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
        <jelly-icon-button class="nb-zone-move" label="Move down" data-idx="${i}" data-dir="1" ${i === total - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
        <span class="day-index-label">${name}</span>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Where they go</label>
          <jelly-input class="form-input nb-zone-place" data-idx="${i}" type="text" value="${esc(z.place)}" placeholder="Chapel Lawn"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Small print</label>
          <jelly-input class="form-input nb-zone-note" data-idx="${i}" type="text" value="${esc(z.note)}" placeholder="optional"></jelly-input>
        </div>
      </div>
      <button type="button" class="link-btn danger-link nb-zone-remove" data-idx="${i}">Remove</button>
    </div>
  `;
}

function noticeStepRowHTML(st, i, total) {
  return `
    <div class="rules-section-editor">
      <div class="builder-row">
        <jelly-icon-button class="nb-step-move" label="Move up" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</jelly-icon-button>
        <jelly-icon-button class="nb-step-move" label="Move down" data-idx="${i}" data-dir="1" ${i === total - 1 ? 'disabled' : ''}>↓</jelly-icon-button>
        <span class="day-index-label">Step ${i + 1}</span>
      </div>
      <div class="form-row">
        <div class="form-field notice-emoji-field">
          <label class="form-label">Emoji</label>
          <jelly-input class="form-input nb-step-emoji" data-idx="${i}" type="text" value="${esc(st.emoji)}" placeholder="🧹"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Heading</label>
          <jelly-input class="form-input nb-step-when" data-idx="${i}" type="text" value="${esc(st.when)}" placeholder="Straight after breakfast"></jelly-input>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Bullets (one per line)</label>
        <jelly-textarea class="form-textarea nb-step-items" data-idx="${i}" rows="3" placeholder="One instruction per line." value="${esc(st.items.join('\n'))}"></jelly-textarea>
      </div>
      <button type="button" class="link-btn danger-link nb-step-remove" data-idx="${i}">Remove step</button>
    </div>
  `;
}

// Save + refresh the preview, without re-rendering the form under the user's
// finger. `full` re-renders the whole tab (needed when rows are added/removed
// or reordered, since their indexes change).
function noticeCommit(full) {
  saveState();
  if (full) {
    renderAll();
    return;
  }
  const prev = document.getElementById('notice-preview');
  if (prev) prev.innerHTML = noticeCardHtml(true);
  // Keep the posted card on the scoreboard page in step as it's edited.
  if (typeof renderNoticeBoard === 'function') renderNoticeBoard();
}

function wireNoticeTab(card) {
  // Every handler reads the notice LIVE (noticeBoard()) rather than closing
  // over the object: a remote snapshot replaces state.notice, and renderNoticeTab
  // keeps an unchanged card (and these listeners) rather than rebuilding it, so
  // a captured copy would be an orphan nobody ever saves.
  card.querySelectorAll('.nb-field').forEach((el) => {
    el.addEventListener('change', () => {
      const field = el.dataset.nbField;
      if (!['eyebrow', 'title', 'sub', 'signoff'].includes(field)) return;
      noticeBoard()[field] = el.value;
      noticeCommit(false);
    });
  });

  card.querySelectorAll('.nb-zone-place').forEach((el) => {
    el.addEventListener('change', () => {
      const z = noticeBoard().zones[+el.dataset.idx];
      if (z) { z.place = el.value.trim(); noticeCommit(false); }
    });
  });
  card.querySelectorAll('.nb-zone-note').forEach((el) => {
    el.addEventListener('change', () => {
      const z = noticeBoard().zones[+el.dataset.idx];
      if (z) { z.note = el.value.trim(); noticeCommit(false); }
    });
  });
  card.querySelectorAll('.nb-zone-move').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveItem(noticeBoard().zones, +btn.dataset.idx, parseInt(btn.dataset.dir, 10));
      noticeCommit(true);
    });
  });
  card.querySelectorAll('.nb-zone-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      noticeBoard().zones.splice(+btn.dataset.idx, 1);
      noticeCommit(true);
    });
  });
  const addZone = document.getElementById('notice-add-zone');
  if (addZone) {
    addZone.addEventListener('change', () => {
      if (!addZone.value) return;
      noticeBoard().zones.push({ teamId: addZone.value, place: '', note: '' });
      noticeCommit(true);
    });
  }

  card.querySelectorAll('.nb-step-emoji').forEach((el) => {
    el.addEventListener('change', () => {
      const st = noticeBoard().steps[+el.dataset.idx];
      if (st) { st.emoji = el.value.trim(); noticeCommit(false); }
    });
  });
  card.querySelectorAll('.nb-step-when').forEach((el) => {
    el.addEventListener('change', () => {
      const st = noticeBoard().steps[+el.dataset.idx];
      if (st) { st.when = el.value.trim(); noticeCommit(false); }
    });
  });
  card.querySelectorAll('.nb-step-items').forEach((el) => {
    el.addEventListener('change', () => {
      const st = noticeBoard().steps[+el.dataset.idx];
      if (st) { st.items = splitLines(el.value); noticeCommit(false); }
    });
  });
  card.querySelectorAll('.nb-step-move').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveItem(noticeBoard().steps, +btn.dataset.idx, parseInt(btn.dataset.dir, 10));
      noticeCommit(true);
    });
  });
  card.querySelectorAll('.nb-step-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      noticeBoard().steps.splice(+btn.dataset.idx, 1);
      noticeCommit(true);
    });
  });
  const addStep = document.getElementById('notice-add-step');
  if (addStep) {
    addStep.addEventListener('click', () => {
      noticeBoard().steps.push({ emoji: '', when: '', items: [] });
      noticeCommit(true);
    });
  }

  const postBtn = document.getElementById('notice-post-btn');
  if (postBtn) {
    postBtn.addEventListener('click', () => {
      const posting = noticeBoard().status !== 'posted';
      if (posting && !confirm('Post this to every phone right now?')) return;
      setNoticeStatus(posting ? 'posted' : 'draft');
    });
  }

  const resetBtn = document.getElementById('notice-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Replace this notice with the send-off cleanup example? It goes back to draft.')) return;
      state.notice = defaultNotice();
      noticeCommit(true);
    });
  }
  const clearBtn = document.getElementById('notice-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear the whole notice and start from an empty one? It goes back to draft.')) return;
      state.notice = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
      noticeCommit(true);
    });
  }
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

// What's pasted into Restore, and the last import complaint, are kept here as
// well as in the DOM: a rebuilt card used to come back empty, wiping a pasted
// backup. They are put back AFTER a write rather than baked into the markup —
// typing would then change the markup, and the next unrelated renderAll would
// rebuild the card under the user's fingers (focus and keyboard gone).
let restoreDraft = { text: '', error: '' };

function showRestoreError(msg) {
  restoreDraft.error = msg;
  const errEl = document.getElementById('restore-error');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.hidden = !msg;
  // Our own patch, not a stray DOM change: re-stamp the card's snapshot so
  // setHtmlIfChanged doesn't rebuild the card over it.
  const card = errEl.closest && errEl.closest('.settings-card');
  if (card) card.__dom = card.innerHTML;
}

function renderDataTab(card) {
  if (!setHtmlIfChanged(card, `
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
  `)) return;
  // A freshly written card is empty: put back the paste and the complaint.
  if (restoreDraft.text) document.getElementById('restore-textarea').value = restoreDraft.text;
  if (restoreDraft.error) showRestoreError(restoreDraft.error);
  wireDataTab(card);
}

function wireDataTab(card) {
  const copyBtn = document.getElementById('copy-backup-btn');
  copyBtn.addEventListener('click', () => copyTextToClipboard(backupJSON(), copyBtn));

  document.getElementById('download-backup-btn').addEventListener('click', () => {
    const blob = new Blob([backupJSON()], { type: 'application/json' });
    downloadBlob(blob, 'camp-scoreboard-backup-' + new Date().toISOString().slice(0, 10) + '.json');
  });

  const restoreText = document.getElementById('restore-textarea');
  restoreText.addEventListener('input', () => {
    restoreDraft.text = restoreText.value;
    if (restoreDraft.error) showRestoreError(''); // the complaint was about the old text
  });
  document.getElementById('import-text-btn').addEventListener('click', () => {
    tryImport(restoreText.value);
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
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    showRestoreError("That doesn't look like a Camp Scoreboard backup. Copy it fresh and paste the whole thing.");
    return;
  }

  let config = null;
  if (parsed && parsed.config && Array.isArray(parsed.config.games)) {
    config = parsed.config;
  } else if (parsed && Array.isArray(parsed.games)) {
    config = parsed; // legacy backup: the whole object IS the config
  }

  if (!config) {
    showRestoreError("That doesn't look like a Camp Scoreboard backup. Copy it fresh and paste the whole thing.");
    return;
  }
  showRestoreError('');

  if (!confirm("Replace this device's entire setup (teams, days, games) AND saved scores? This syncs to every device. Consider downloading a backup first.")) return;
  // Imported — the box empties, as it always did. Cleared on the live field
  // too: a card whose markup didn't change is no longer rebuilt.
  restoreDraft.text = '';
  const restoreText = document.getElementById('restore-textarea');
  if (restoreText) restoreText.value = '';

  state.config = config;
  migrateState(state);
  // Only accept correctly-typed sections — a hand-edited backup with e.g.
  // "results": null would crash every render after it had already synced.
  if (Array.isArray(parsed.teams) && parsed.teams.length) state.teams = parsed.teams;
  ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live'].forEach((key) => {
    const v = parsed[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) state[key] = v;
  });
  // A backup is untrusted input with exactly the shape problem CLAUDE.md warns
  // about: anything that round-tripped through Realtime Database has had its
  // empty arrays/objects pruned away, so an imported bracket can arrive with no
  // `matches` and blank-screen renderTournament — on every device, since the
  // import syncs. Heal it before anything renders or pushes.
  normalizeSyncedState();
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
  const def = CAMP.defaultConfig();
  if (!confirm('Put back the original ' + def.games.length + ' games and ' + def.days.length + ' days? Your custom games and days are thrown away. Team names and saved results are kept.')) return;

  state.config = CAMP.defaultConfig();
  if (!state.config.days.some((d) => d.id === state.ui.day)) {
    state.ui.day = state.config.days[0] ? state.config.days[0].id : null;
  }
  pruneOrphanedGameData(); // custom games' results would otherwise haunt the standings
  saveConfig();
  saveState();
  renderAll();
}
