// ── Camp Scoreboard ─────────────────────────────────────────────
// 6-team elimination format: Round 1 (3 matches) -> Medal Round
// (lowest-standing Round 1 winner gets a bye to the Championship;
// the other two Round 1 winners play a Semifinal for the third spot).

const STORAGE_KEY = 'campScoreboardState';

const DEFAULT_TEAM_NAMES = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Could not load saved state, starting fresh.', e);
  }
  return null;
}

function makeFreshState() {
  return {
    teams: DEFAULT_TEAM_NAMES.map((name, i) => ({ id: 't' + i, name })),
    standings: DEFAULT_TEAM_NAMES.reduce((acc, _, i) => {
      acc['t' + i] = { gold: 0, silver: 0, bronze: 0 };
      return acc;
    }, {}),
    history: [],
    currentGame: null,
    theme: null,
  };
}

let state = loadState() || makeFreshState();

// Backfill in case of older/partial saved state shapes.
if (!state.teams) state = makeFreshState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

// Olympic-style rank: fewest golds first, then fewest silvers, then fewest bronzes.
// Returns a comparator for ascending "lowest standing first" order.
function compareLowestFirst(idA, idB) {
  const a = state.standings[idA];
  const b = state.standings[idB];
  if (a.gold !== b.gold) return a.gold - b.gold;
  if (a.silver !== b.silver) return a.silver - b.silver;
  return a.bronze - b.bronze;
}

function medalTuple(id) {
  const s = state.standings[id];
  return [s.gold, s.silver, s.bronze];
}

function tupleEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// ── Rendering: Standings ────────────────────────────────────────

function renderStandings() {
  const tbody = document.getElementById('standings-tbody');
  const ranked = [...state.teams].sort((a, b) => {
    const sa = state.standings[a.id], sb = state.standings[b.id];
    if (sb.gold !== sa.gold) return sb.gold - sa.gold;
    if (sb.silver !== sa.silver) return sb.silver - sa.silver;
    return sb.bronze - sa.bronze;
  });

  tbody.innerHTML = '';
  ranked.forEach((team, i) => {
    const s = state.standings[team.id];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-col">${i + 1}</td>
      <td>
        <input type="text" class="team-name-input" data-team-id="${team.id}" value="${escapeAttr(team.name)}" />
      </td>
      <td class="medal-col">${s.gold}</td>
      <td class="medal-col">${s.silver}</td>
      <td class="medal-col">${s.bronze}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.team-name-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = e.target.dataset.teamId;
      const val = e.target.value.trim();
      const team = state.teams.find((t) => t.id === id);
      if (team) team.name = val || team.name;
      saveState();
      renderStandings();
      renderWizard();
      renderHistory();
    });
  });
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Game flow ────────────────────────────────────────────────────

function startNewGame() {
  state.currentGame = {
    phase: 'round1',
    pool: state.teams.map((t) => t.id),
    selectedPair: [],
    round1Matches: [], // { a, b, winner, loser }
    byeTeamId: null,
    byeTieCandidates: null,
    semifinal: null, // { a, b, winner, loser }
    championship: null, // { a, b, winner, loser }
  };
  saveState();
  document.getElementById('launch-card').hidden = true;
  document.getElementById('wizard-card').hidden = false;
  renderWizard();
}

function cancelGame() {
  if (!confirm('Cancel this game in progress? Nothing will be saved.')) return;
  state.currentGame = null;
  saveState();
  document.getElementById('launch-card').hidden = false;
  document.getElementById('wizard-card').hidden = true;
}

function updateWizardStepIndicator() {
  const g = state.currentGame;
  if (!g) return;
  document.querySelectorAll('.wizard-step').forEach((el) => {
    el.classList.toggle('active', el.dataset.step === g.phase);
    const order = ['round1', 'semifinal', 'championship', 'summary'];
    el.classList.toggle('done', order.indexOf(el.dataset.step) < order.indexOf(g.phase));
  });
}

function renderWizard() {
  const g = state.currentGame;
  const body = document.getElementById('wizard-body');
  if (!g) return;
  updateWizardStepIndicator();

  if (g.phase === 'round1') {
    renderRound1(body, g);
  } else if (g.phase === 'semifinal') {
    renderSemifinal(body, g);
  } else if (g.phase === 'championship') {
    renderChampionship(body, g);
  } else if (g.phase === 'summary') {
    renderSummary(body, g);
  }
}

function renderRound1(body, g) {
  const matchesDone = g.round1Matches.length;

  if (g.pool.length === 0) {
    // All three matches done, compute the bye.
    computeByeAndAdvance(g);
    renderWizard();
    return;
  }

  let html = `<h3>Round 1 — Match ${matchesDone + 1} of 3</h3>`;
  html += `<p class="muted">Pick the two teams to call up next for this match.</p>`;
  html += `<div class="team-chip-grid">`;
  g.pool.forEach((id) => {
    const selected = g.selectedPair.includes(id);
    html += `<button class="team-chip ${selected ? 'selected' : ''}" data-team-id="${id}">${escapeAttr(teamName(id))}</button>`;
  });
  html += `</div>`;

  if (g.selectedPair.length === 2) {
    const [a, b] = g.selectedPair;
    html += `<div class="matchup-callout">
      <p class="call-next-label">Call up next:</p>
      <p class="call-next-teams">${escapeAttr(teamName(a))} <span class="vs">vs</span> ${escapeAttr(teamName(b))}</p>
      <div class="winner-btn-row">
        <button class="secondary-btn winner-btn" data-winner="${a}">${escapeAttr(teamName(a))} won</button>
        <button class="secondary-btn winner-btn" data-winner="${b}">${escapeAttr(teamName(b))} won</button>
      </div>
    </div>`;
  }

  if (g.round1Matches.length > 0) {
    html += `<div class="completed-matches">
      <p class="muted">Completed:</p>
      <ul>${g.round1Matches.map((m) => `<li>${escapeAttr(teamName(m.winner))} def. ${escapeAttr(teamName(m.loser))}</li>`).join('')}</ul>
      <button id="undo-round1-btn" class="link-btn">Undo last match</button>
    </div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll('.team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId;
      const idx = g.selectedPair.indexOf(id);
      if (idx > -1) {
        g.selectedPair.splice(idx, 1);
      } else if (g.selectedPair.length < 2) {
        g.selectedPair.push(id);
      }
      saveState();
      renderWizard();
    });
  });

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const [a, b] = g.selectedPair;
      const loser = winner === a ? b : a;
      g.round1Matches.push({ a, b, winner, loser });
      g.pool = g.pool.filter((id) => id !== a && id !== b);
      g.selectedPair = [];
      saveState();
      renderWizard();
    });
  });

  const undoBtn = document.getElementById('undo-round1-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const last = g.round1Matches.pop();
      if (last) {
        g.pool.push(last.a, last.b);
      }
      saveState();
      renderWizard();
    });
  }
}

function computeByeAndAdvance(g) {
  const winners = g.round1Matches.map((m) => m.winner);
  const sorted = [...winners].sort(compareLowestFirst);
  const lowestTuple = medalTuple(sorted[0]);
  const tied = sorted.filter((id) => tupleEqual(medalTuple(id), lowestTuple));

  if (tied.length > 1) {
    g.byeTieCandidates = tied;
    g.phase = 'semifinal'; // wizard body will show the tie-break prompt first
    saveState();
    return;
  }

  const byeId = sorted[0];
  const others = winners.filter((id) => id !== byeId);
  g.byeTeamId = byeId;
  g.semifinal = { a: others[0], b: others[1], winner: null, loser: null };
  g.phase = 'semifinal';
  saveState();
}

function renderSemifinal(body, g) {
  if (g.byeTieCandidates && !g.byeTeamId) {
    let html = `<h3>Who gets the bye?</h3>
      <p class="muted">These teams are tied for the lowest standing coming into today. Pick who gets the bye into the Championship.</p>
      <div class="team-chip-grid">`;
    g.byeTieCandidates.forEach((id) => {
      html += `<button class="team-chip tiebreak-chip" data-team-id="${id}">${escapeAttr(teamName(id))}</button>`;
    });
    html += `</div>`;
    body.innerHTML = html;
    body.querySelectorAll('.tiebreak-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const byeId = btn.dataset.teamId;
        const winners = g.round1Matches.map((m) => m.winner);
        const others = winners.filter((id) => id !== byeId);
        g.byeTeamId = byeId;
        g.semifinal = { a: others[0], b: others[1], winner: null, loser: null };
        g.byeTieCandidates = null;
        saveState();
        renderWizard();
      });
    });
    return;
  }

  let html = `<h3>Semifinal</h3>
    <p class="bye-note">🎟️ <strong>${escapeAttr(teamName(g.byeTeamId))}</strong> had the lowest standing coming in — bye straight to the Championship.</p>`;

  if (!g.semifinal.winner) {
    html += `<div class="matchup-callout">
      <p class="call-next-label">Call up next:</p>
      <p class="call-next-teams">${escapeAttr(teamName(g.semifinal.a))} <span class="vs">vs</span> ${escapeAttr(teamName(g.semifinal.b))}</p>
      <div class="winner-btn-row">
        <button class="secondary-btn winner-btn" data-winner="${g.semifinal.a}">${escapeAttr(teamName(g.semifinal.a))} won</button>
        <button class="secondary-btn winner-btn" data-winner="${g.semifinal.b}">${escapeAttr(teamName(g.semifinal.b))} won</button>
      </div>
    </div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === g.semifinal.a ? g.semifinal.b : g.semifinal.a;
      g.semifinal.winner = winner;
      g.semifinal.loser = loser;
      g.championship = { a: g.byeTeamId, b: winner, winner: null, loser: null };
      g.phase = 'championship';
      saveState();
      renderWizard();
    });
  });
}

function renderChampionship(body, g) {
  let html = `<h3>Championship</h3>
    <p class="bronze-note">🥉 <strong>${escapeAttr(teamName(g.semifinal.loser))}</strong> takes the bronze medal.</p>`;

  html += `<div class="matchup-callout">
    <p class="call-next-label">Call up next:</p>
    <p class="call-next-teams">${escapeAttr(teamName(g.championship.a))} <span class="vs">vs</span> ${escapeAttr(teamName(g.championship.b))}</p>
    <div class="winner-btn-row">
      <button class="secondary-btn winner-btn" data-winner="${g.championship.a}">${escapeAttr(teamName(g.championship.a))} won</button>
      <button class="secondary-btn winner-btn" data-winner="${g.championship.b}">${escapeAttr(teamName(g.championship.b))} won</button>
    </div>
  </div>`;

  body.innerHTML = html;

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === g.championship.a ? g.championship.b : g.championship.a;
      g.championship.winner = winner;
      g.championship.loser = loser;
      g.phase = 'summary';
      saveState();
      renderWizard();
    });
  });
}

function renderSummary(body, g) {
  const goldId = g.championship.winner;
  const silverId = g.championship.loser;
  const bronzeId = g.semifinal.loser;
  const eliminatedIds = g.round1Matches.map((m) => m.loser);

  let html = `<h3>Game Results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 <strong>${escapeAttr(teamName(goldId))}</strong></div>
      <div class="medal-row silver-row">🥈 <strong>${escapeAttr(teamName(silverId))}</strong></div>
      <div class="medal-row bronze-row">🥉 <strong>${escapeAttr(teamName(bronzeId))}</strong></div>
    </div>
    <p class="muted">Eliminated in Round 1: ${eliminatedIds.map((id) => escapeAttr(teamName(id))).join(', ')}</p>
    <button id="save-game-btn" class="primary-btn">Save to Week Standings</button>`;

  body.innerHTML = html;

  document.getElementById('save-game-btn').addEventListener('click', () => {
    state.standings[goldId].gold += 1;
    state.standings[silverId].silver += 1;
    state.standings[bronzeId].bronze += 1;

    state.history.unshift({
      playedAt: new Date().toISOString(),
      gold: goldId,
      silver: silverId,
      bronze: bronzeId,
      eliminated: eliminatedIds,
    });

    state.currentGame = null;
    saveState();
    renderStandings();
    renderHistory();
    document.getElementById('launch-card').hidden = false;
    document.getElementById('wizard-card').hidden = true;
  });
}

// ── History ──────────────────────────────────────────────────────

function renderHistory() {
  const list = document.getElementById('history-list');

  if (state.history.length === 0) {
    list.innerHTML = '<p class="muted" id="history-empty">No games played yet this week.</p>';
    return;
  }

  let html = '';
  state.history.forEach((game, i) => {
    const when = new Date(game.playedAt);
    const timeStr = isNaN(when.getTime()) ? '' : when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    html += `<div class="history-item">
      <div class="history-item-header">
        <span class="history-time">${timeStr}</span>
        ${i === 0 ? '<button class="link-btn danger-link undo-game-btn" data-index="' + i + '">Undo</button>' : ''}
      </div>
      <div class="history-medals">
        <span>🥇 ${escapeAttr(teamName(game.gold))}</span>
        <span>🥈 ${escapeAttr(teamName(game.silver))}</span>
        <span>🥉 ${escapeAttr(teamName(game.bronze))}</span>
      </div>
    </div>`;
  });
  list.innerHTML = html;

  const undoBtn = list.querySelector('.undo-game-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (!confirm('Undo the most recent game? This will remove its medals from the standings.')) return;
      const [game] = state.history.splice(0, 1);
      state.standings[game.gold].gold -= 1;
      state.standings[game.silver].silver -= 1;
      state.standings[game.bronze].bronze -= 1;
      saveState();
      renderStandings();
      renderHistory();
    });
  }
}

// ── Reset week ───────────────────────────────────────────────────

function resetWeek() {
  if (!confirm('Start a new week? This clears all medal standings and game history (team names are kept).')) return;
  const teamNames = state.teams.map((t) => t.name);
  state = makeFreshState();
  state.teams.forEach((t, i) => (t.name = teamNames[i] || t.name));
  saveState();
  renderStandings();
  renderHistory();
  document.getElementById('launch-card').hidden = false;
  document.getElementById('wizard-card').hidden = true;
}

// ── Theme ────────────────────────────────────────────────────────

function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = state.theme === 'dark' || (state.theme === null && prefersDark);
  document.body.classList.toggle('dark-theme', dark);
  document.getElementById('theme-toggle').textContent = dark ? '☀️' : '🌙';
}

function toggleTheme() {
  const currentlyDark = document.body.classList.contains('dark-theme');
  state.theme = currentlyDark ? 'light' : 'dark';
  saveState();
  applyTheme();
}

// ── Init ─────────────────────────────────────────────────────────

function init() {
  applyTheme();
  renderStandings();
  renderHistory();

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('start-game-btn').addEventListener('click', startNewGame);
  document.getElementById('cancel-game-btn').addEventListener('click', cancelGame);
  document.getElementById('reset-week-btn').addEventListener('click', resetWeek);

  if (state.currentGame) {
    document.getElementById('launch-card').hidden = true;
    document.getElementById('wizard-card').hidden = false;
    renderWizard();
  }
}

document.addEventListener('DOMContentLoaded', init);
