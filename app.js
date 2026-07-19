// ── Camp Scoreboard ─────────────────────────────────────────────
// The week's games, day by day. Three formats:
//  - tournament: 2 teams at a time, 3 first-round matches, winners go
//    to the medal round. The bye goes to whichever winner is lowest in
//    the OVERALL standings coming into today — the app asks you, since
//    the official scoreboard lives on paper.
//  - tally: every team posts a score; top 3 auto-earn medals.
//  - placement: no numbers, you just pick who took gold/silver/bronze.

const STORAGE_KEY = 'campScoreboardV2';

const DEFAULT_TEAM_NAMES = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

// ── Game catalog ────────────────────────────────────────────────

const GAMES = [
  {
    id: 'shields', name: 'Shields', emoji: '🛡️', day: 1, session: 'Morning',
    location: 'Dining Hall', format: 'placement',
    headline: 'Every team designs a shield — judged at Monday evening service.',
    rules: [
      { h: 'Must include', items: ['Team name', 'Team crest', 'The year', "Everyone's signature"] },
      { h: 'How it works', items: [
        'Everyone on the team participates somehow — design, tracing, or coloring.',
        'Shields must be finished and ready to judge at the START of Monday evening service.',
      ] },
      { h: 'Winning', items: ['Top 3 shields take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'kangaroo-kickball', name: 'Kangaroo Kickball', emoji: '🦘', day: 1, session: 'Morning',
    location: 'Chapel Lawn', format: 'tournament',
    headline: 'Kickball, but everyone is three-legged with a partner.',
    rules: [
      { h: 'How to play', items: [
        'Two teams at a time — one kicks, one fields.',
        'The pitcher rolls the ball to home plate; the kicker kicks into fair territory and runs the bases.',
        '3 outs per side, 3 innings. Most runs wins the match.',
      ] },
      { h: 'Ways to get out', items: [
        'Ball caught in the air before it touches the ground.',
        'A fielder touches the base with the ball before the runner gets there.',
        'A fielder tags the runner while holding the ball (no throwing at runners!).',
      ] },
      { h: 'The twist', items: [
        'Everyone plays 3-legged-race style with a partner.',
        'The KICKER must always be 3-legged — that part is not optional.',
        "If pairing everyone leaves positions short, use your judgment on who's partnered in the field.",
      ] },
    ],
  },
  {
    id: 'human-battleship', name: 'Human Battleship', emoji: '🚢', day: 1, session: 'Evening',
    location: 'Basketball Court', format: 'placement',
    headline: 'Wet sponges over the barrier — last 3 teams standing medal.',
    rules: [
      { h: 'Setup', items: [
        'ALL teams play at once — same number of players per team.',
        'Barrier down the middle of the court; each team splits evenly across both sides.',
        'Players sit scattered around their side.',
      ] },
      { h: 'How to play', items: [
        'Sides take turns launching water-filled sponges over the barrier (rotate sides and teams).',
        'Hit by a sponge? You are "hit and sunk" — you must lay down.',
      ] },
      { h: 'Winning', items: ['The last 3 teams with players still up take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'musical-chairs', name: 'Musical Chairs Everywhere', emoji: '🎵', day: 2, session: 'Morning',
    location: 'Chapel Lawn', format: 'tournament',
    headline: 'Field-wide musical chairs, team vs team.',
    rules: [
      { h: 'Setup', items: [
        'Two teams at a time, same number of players each.',
        'Chairs scattered all over the field — one FEWER chair than total players.',
        'Prep: Jen has the music/speaker. Use the orange tab chairs.',
      ] },
      { h: 'How to play', items: [
        'Music plays → everyone walks around among the chairs.',
        'Music stops → find a chair and sit.',
        'The camper left standing is out.',
        'In medal rounds, start pulling extra chairs each round if time is running long.',
      ] },
      { h: 'Winning', items: ['Last team with a player seated wins the match.'] },
    ],
  },
  {
    id: 'ladder-ball', name: 'Ladder Ball', emoji: '🪜', day: 2, session: 'Morning',
    location: 'Basketball Court', format: 'tournament',
    headline: 'Toss bolas onto the ladder — first to exactly 21.',
    rules: [
      { h: 'Setup', items: [
        '1 ladder ball set, 6 bolas (3 per team by color).',
        'Ladders about 15 feet apart — closer if kids are struggling.',
        'Split each team in half; half at each ladder.',
      ] },
      { h: 'Scoring', items: [
        'Top rung: 3 points · Middle: 2 · Bottom: 1.',
        'A bola only counts if it is still hanging at the end of the round.',
        'Cancellation scoring: round points cancel out — if Team A scores 5 and Team B scores 2, Team A earns 3.',
      ] },
      { h: 'How to play', items: [
        'Teams alternate turns; each team throws all 3 bolas, underhand.',
        'Score the round after both teams have thrown.',
      ] },
      { h: 'Winning', items: [
        'First team to reach EXACTLY 21 wins.',
        'Go over 21? You stay at your previous score until you land exactly on 21.',
      ] },
    ],
  },
  {
    id: 'scatterball', name: 'Scatterball', emoji: '🎯', day: 2, session: 'Evening',
    location: 'Chapel Lawn', format: 'placement',
    headline: 'Free-for-all dodgeball — last 3 teams standing medal.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams at once, spread out over the field; 4 scatterballs in the middle.',
        'On "GO", everyone races for the balls.',
        'With a ball: up to 3 giant steps plus a pivot — otherwise you cannot move.',
        'Throw at opposing players, aiming BELOW the shoulders.',
      ] },
      { h: 'Getting out (and staying in it)', items: [
        'Hit? Sit down where you are — but you can still catch, throw, and roll from your seat.',
        'Your throw gets caught out of the air? YOU are out.',
        'Your throw hits above the shoulders? YOU are out.',
      ] },
      { h: 'Winning', items: ['Last 3 teams with players standing take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'axe-throwing', name: 'Axe Throwing', emoji: '🪓', day: 3, session: 'Morning',
    location: 'Basketball Court', format: 'tally', unit: 'points', counterSteps: [1, 5],
    headline: 'Every player throws; the team totals decide the medals.',
    rules: [
      { h: 'How to play', items: [
        'One team plays at a time, same number of players per team.',
        'Each player gets 3 turns, with 4 throws per turn.',
        'Tally every turn into one grand team total.',
      ] },
      { h: 'Winning', items: ['The 3 highest team totals take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'inflatable-bowling', name: 'Inflatable Bowling', emoji: '🎳', day: 3, session: 'Morning',
    location: 'Slip and Slide', format: 'tally', unit: 'points', counterSteps: [1, 10],
    headline: 'Four rolls each — pins are 1, strikes are 10.',
    rules: [
      { h: 'Setup', items: [
        'One team at a time, same number of players per team.',
        'Set the pins a fair distance from the ball — your call, keep it consistent.',
      ] },
      { h: 'How to play', items: [
        'Each player gets 4 rolls at the pins.',
        'Each pin knocked down = 1 point. A strike = 10 points.',
        'Add up everything for a single team total.',
      ] },
      { h: 'Winning', items: ['The 3 highest team scores take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'pumpkin-pictionary', name: 'Pumpkin Pictionary', emoji: '🎃', day: 3, session: 'Morning',
    location: 'Chapel Lawn', format: 'tally', unit: 'total time', lowerWins: true, timeInput: true,
    stopwatch: { targetLaps: 10 },
    headline: 'Draw with your nose in pumpkin puree — fastest total time wins.',
    rules: [
      { h: 'Prep', items: ['Have a list of 10 items ready for each team to draw.'] },
      { h: 'How to play', items: [
        'One team plays at a time; each team draws 10 items.',
        'The drawer dips their NOSE in pumpkin puree and draws with it on the board.',
        'New drawer every item — everyone must play.',
        'Clock starts when nose touches paper, stops when the team guesses the word.',
        'Add the 10 lap times into one team time.',
      ] },
      { h: 'Winning', items: ['The 3 FASTEST team times take gold, silver, and bronze.'] },
      { h: 'Entering times here', items: ['Type times as minutes:seconds (like 4:35) or plain seconds (like 275).'] },
    ],
  },
  {
    id: 'color-call-chaos', name: 'Color Call Chaos', emoji: '🌈', day: 3, session: 'Evening',
    location: 'Chapel Lawn', format: 'tally', unit: 'balls collected', counterSteps: [1],
    headline: 'Hungry-hungry-hippos with color calls — every ball is a point.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams play, same number of players per team.',
        'Multicolored balls scattered across the field.',
        'Leader calls a color → everyone races to collect ONLY that color, one ball at a time, back to the team bucket.',
        'New color every round; keep going until every ball is collected.',
      ] },
      { h: 'Winning', items: [
        'Every ball collected = 1 point.',
        'The 3 teams with the most balls take gold, silver, and bronze.',
      ] },
    ],
  },
  {
    id: 'jeb-ball', name: 'Jeb Ball', emoji: '🧎', day: 4, session: 'Morning',
    location: 'Chapel Lawn', format: 'tournament',
    timer: { label: 'Half clock', presets: [600, 480, 300] },
    headline: 'Soccer on your knees, batting the ball with your hands. MUST WEAR PANTS.',
    rules: [
      { h: 'Wear pants!', items: ['Everyone plays on their knees all game — long pants required.'] },
      { h: 'How to play', items: [
        'Two teams, same number of players; a net on either side of the field.',
        'Like soccer, but on your knees, batting the ball along with your hands.',
        'Score by getting the ball past the opposing goaltender — who is ALSO on their knees.',
        'Two 10-minute halves. Shorten if needed, just keep it consistent between matches.',
      ] },
      { h: 'Winning', items: ['Most goals wins the match.'] },
    ],
  },
  {
    id: 'waiter-water-chain', name: 'Waiter Water Chain', emoji: '💧', day: 4, session: 'Morning',
    location: 'Bathroom Lawn', format: 'tournament',
    headline: 'Pass the tray of water cups down the human chain until the bucket overflows.',
    rules: [
      { h: 'Setup', items: [
        'Two teams, same number of players.',
        'Full bucket on the start line, empty bucket on the finish line, one tray of cups per team.',
        'Each team lies down in a horizontal line, side by side.',
      ] },
      { h: 'How to play', items: [
        'Pass the tray of FULL water cups down the line toward the finish bucket.',
        'After you pass the tray, jump up and lie back down at the END of the line to keep the chain moving.',
        'One player (or a counselor) stands at each end to fill cups and dump them.',
        'Repeat until the finish bucket is full to overflowing.',
      ] },
      { h: 'Winning', items: ['First team to overflow their finish bucket wins — opposing counselors judge in real time.'] },
    ],
  },
  {
    id: 'counselor-hide-seek', name: 'Counselor Hide and Seek', emoji: '🔔', day: 4, session: 'Evening',
    location: 'Campground-wide', format: 'tally', unit: 'points',
    counterSteps: [5, 10], counterStepLabels: { 5: 'counselor', 10: 'staff' }, counterAllowNegative: true,
    timer: { label: 'Game clock (ring the bell at the alarm!)', presets: [900, 600, 1200] },
    headline: 'Hunt down hidden staff and march them to the bell for points.',
    rules: [
      { h: 'Setup', items: [
        '1–2 counselors from each team hide (at least 1 counselor stays with the team).',
        'Ancillary staff may hide too.',
        'Boundaries: waterfront and within the road — NO ballfield, NO girls/boys cabin areas.',
      ] },
      { h: 'Scoring', items: [
        'Counselor found = 5 points.',
        'Ancillary staff found = 10 points.',
        'Some staff are worth NEGATIVE points — campers never know who is worth what.',
      ] },
      { h: 'How to play', items: [
        'Find a hider, bring them to the bell, then head out for the next one.',
        'Teams must stay together the whole time.',
        'Points are tallied as the game goes; it ends when the bell rings.',
      ] },
      { h: 'Winning', items: ['The 3 teams with the most points take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'bushel-bustle', name: 'Bushel Bustle', emoji: '🌽', day: 5, session: 'Morning',
    location: 'Chapel Lawn', format: 'placement', messtival: true,
    headline: 'Shuck 20 ears of corn clean enough to eat.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams play, same number of players per team.',
        'Each team gets 20 ears of corn and an empty kettle.',
        'Together, shuck every ear until it is clean enough to eat — opposing counselors judge in real time.',
      ] },
      { h: 'Winning', items: ['First 3 teams with all 20 ears shucked clean take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'pumpkin-patch-plunder', name: 'Pumpkin Patch Plunder', emoji: '🍬', day: 5, session: 'Morning',
    location: 'Chapel Lawn', format: 'tally', unit: 'candy corn', messtival: true,
    counterSteps: [1], timer: { label: 'Round timer', presets: [60], rounds: 6 },
    headline: 'Fish candy corn out of pumpkin puree — with your mouth.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams play, 6 players per team.',
        'Each player gets a pie plate of pumpkin puree with candy corn hidden inside.',
        '6 rounds, 1 minute each: mouths only, fish out candy corn and drop it in the empty bowl.',
      ] },
      { h: 'Winning', items: ['The 3 teams with the most candy corn after 6 rounds take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'bob-drop-roll', name: 'Bob, Drop, and Roll', emoji: '🍎', day: 5, session: 'Morning',
    location: 'Chapel Lawn', format: 'placement', messtival: true,
    headline: 'Bob an apple, sprint it across the field, barrel roll home.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams play, 6 players per team, relay style.',
        'Each player: bob for your apple, then run it — apple in mouth — across the field and drop it in the bucket.',
        'Drop the apple anywhere else? Run it back, dunk it back in the water, start your leg over.',
        'After the bucket drop, barrel roll back to the start line and tag the next teammate.',
      ] },
      { h: 'Winning', items: ['First 3 teams to get all 6 players through take gold, silver, and bronze.'] },
    ],
  },
  {
    id: 'cider-survivor', name: 'Cider Survivor', emoji: '🥤', day: 5, session: 'Morning',
    location: 'Chapel Lawn', format: 'placement', messtival: true,
    headline: 'Relay chug — six cups of cider, six flavors, sit when done.',
    rules: [
      { h: 'How to play', items: [
        'ALL teams play at once, 6 players per team, each with a cup of cider (6 flavors!).',
        'First player drinks as fast as they can, then tags the next in line.',
        'When YOUR cup is done: SIT DOWN.',
      ] },
      { h: 'Winning', items: ['First 3 teams with all 6 cups finished and the whole team seated take gold, silver, and bronze.'] },
    ],
  },
];

// ── State ────────────────────────────────────────────────────────

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
    results: {},   // gameId -> { medals: {gold, silver, bronze}, scores?, savedAt }
    brackets: {},  // gameId -> in-progress tournament
    drafts: {},    // gameId -> in-progress tally/placement entry
    ui: { day: defaultDay(), gameId: null },
    theme: null,
  };
}

function defaultDay() {
  const d = new Date().getDay(); // 0 Sun .. 6 Sat
  return d >= 1 && d <= 5 ? d : 1;
}

let state = loadState() || makeFreshState();
if (!state.teams || !state.results) state = makeFreshState();
if (!state.ui) state.ui = { day: defaultDay(), gameId: null };

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function gameById(id) {
  return GAMES.find((g) => g.id === id);
}

// ── Sound effects (Web Audio — no files needed) ──────────────────

let audioCtx = null;
let masterGain = null;

function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, startOffset, dur, type, peak) {
  const ac = getAudio();
  if (!ac) return;
  const t0 = ac.currentTime + startOffset;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function soundOn() {
  return state.sound !== false;
}

function playAlarm() {
  if (!soundOn() || !getAudio()) return;
  cutAllSound();
  for (let i = 0; i < 8; i++) { // ~6.5 seconds of hard two-tone beeping
    tone(880, i * 0.8, 0.3, 'square', 0.8);
    tone(660, i * 0.8 + 0.38, 0.3, 'square', 0.8);
  }
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400]);
}

// Drop every scheduled beep by orphaning the master gain node.
function cutAllSound() {
  if (audioCtx && masterGain) {
    masterGain.disconnect();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

function playHighScore() {
  if (!soundOn() || !getAudio()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.5));
  tone(1568, 0.4, 0.35, 'sine', 0.3); // sparkle on top
}

// ── Timers & stopwatches ─────────────────────────────────────────
// Kept in memory so they keep running while you browse other games.

const liveTimers = {};  // gameId -> countdown state
const liveWatches = {}; // gameId -> stopwatch state
let tickHandle = null;

function ensureTicking() {
  if (!tickHandle) tickHandle = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  let anyRunning = false;
  Object.entries(liveTimers).forEach(([gid, t]) => {
    if (!t.running) return;
    anyRunning = true;
    const remaining = Math.max(0, t.endAt - now);
    t.remaining = remaining;
    if (remaining === 0) {
      t.running = false;
      t.alarming = true;
      playAlarm();
      renderToolsIfCurrent(gid);
    } else {
      const el = document.getElementById('cd-display-' + gid);
      if (el) el.textContent = fmtClock(remaining);
    }
  });
  Object.entries(liveWatches).forEach(([gid, w]) => {
    if (!w.running) return;
    anyRunning = true;
    const lapMs = now - w.startAt;
    const el = document.getElementById('sw-display-' + gid);
    if (el) el.textContent = fmtWatch(lapMs);
    const tot = document.getElementById('sw-total-' + gid);
    if (tot) tot.textContent = fmtWatch(w.lapsTotal + lapMs);
  });
  if (!anyRunning) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function fmtClock(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function fmtWatch(ms) {
  const ds = Math.floor(ms / 100);
  const s = Math.floor(ds / 10);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + (ds % 10);
}

function renderToolsIfCurrent(gid) {
  if (state.ui.gameId !== gid) return;
  const wrap = document.getElementById('tools-area');
  const g = gameById(gid);
  if (wrap && g) renderTools(wrap, g);
}

function renderTools(wrap, g) {
  let html = '';
  if (g.timer) html += countdownHTML(g);
  if (g.stopwatch) html += stopwatchHTML(g);
  wrap.innerHTML = html;
  if (g.timer) bindCountdown(wrap, g);
  if (g.stopwatch) bindStopwatch(wrap, g);
}

// ── Countdown ──

function countdownHTML(g) {
  let t = liveTimers[g.id];
  if (!t) {
    const dur = g.timer.presets[0] * 1000;
    t = liveTimers[g.id] = { duration: dur, remaining: dur, running: false, alarming: false, round: 1 };
  }
  const roundLabel = g.timer.rounds ? `<div class="round-label">Round ${t.round} of ${g.timer.rounds}</div>` : '';
  const presets = g.timer.presets.length > 1
    ? `<div class="preset-row">${g.timer.presets.map((p) =>
        `<button class="preset-chip ${t.duration === p * 1000 ? 'selected' : ''}" data-preset="${p}" ${t.running ? 'disabled' : ''}>${fmtClock(p * 1000)}</button>`).join('')}</div>`
    : '';

  let mainBtn;
  if (t.alarming) {
    mainBtn = `<button class="timer-main-btn alarm-btn" data-action="silence">🔕 Silence</button>`;
  } else if (t.running) {
    mainBtn = `<button class="timer-main-btn" data-action="pause">⏸ Pause</button>`;
  } else if (t.remaining === 0) {
    mainBtn = g.timer.rounds && t.round < g.timer.rounds
      ? `<button class="timer-main-btn" data-action="next-round">Next round →</button>`
      : `<button class="timer-main-btn" data-action="reset">↺ Reset</button>`;
  } else if (t.remaining < t.duration) {
    mainBtn = `<button class="timer-main-btn" data-action="start">▶ Resume</button>`;
  } else {
    mainBtn = `<button class="timer-main-btn" data-action="start">▶ Start</button>`;
  }

  return `<div class="tool-box ${t.alarming ? 'alarming' : ''}" data-tool="countdown">
    <div class="tool-label">⏱️ ${esc(g.timer.label)}</div>
    ${roundLabel}
    <div class="big-clock" id="cd-display-${g.id}">${fmtClock(t.remaining)}</div>
    ${presets}
    <div class="timer-btn-row">
      ${mainBtn}
      ${!t.alarming && t.remaining !== t.duration ? `<button class="timer-side-btn" data-action="reset">↺ Reset</button>` : ''}
    </div>
  </div>`;
}

function bindCountdown(wrap, g) {
  const box = wrap.querySelector('[data-tool="countdown"]');
  if (!box) return;
  const t = liveTimers[g.id];

  box.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      t.duration = parseInt(chip.dataset.preset, 10) * 1000;
      t.remaining = t.duration;
      renderTools(wrap, g);
    });
  });

  box.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'start') {
        getAudio(); // unlock audio while we have a user gesture
        t.endAt = Date.now() + t.remaining;
        t.running = true;
        ensureTicking();
      } else if (a === 'pause') {
        t.running = false;
        t.remaining = Math.max(0, t.endAt - Date.now());
      } else if (a === 'silence') {
        cutAllSound();
        t.alarming = false;
      } else if (a === 'reset') {
        cutAllSound();
        t.alarming = false;
        t.running = false;
        t.remaining = t.duration;
      } else if (a === 'next-round') {
        cutAllSound();
        t.alarming = false;
        t.running = false;
        t.round += 1;
        t.remaining = t.duration;
      }
      renderTools(wrap, g);
    });
  });
}

// ── Stopwatch (lap-based, e.g. Pumpkin Pictionary) ──

function stopwatchHTML(g) {
  let w = liveWatches[g.id];
  if (!w) {
    w = liveWatches[g.id] = { running: false, startAt: 0, laps: [], lapsTotal: 0 };
  }
  const lapNum = w.laps.length + 1;
  const target = g.stopwatch.targetLaps;
  const mainBtn = w.running
    ? `<button class="timer-main-btn stop-lap-btn" data-action="stop-lap">⏹ Stop — record item ${w.laps.length + 1}</button>`
    : `<button class="timer-main-btn" data-action="start-lap">▶ Start item ${lapNum}${target ? ' of ' + target : ''}</button>`;

  return `<div class="tool-box" data-tool="stopwatch">
    <div class="tool-label">⏱️ Drawing stopwatch</div>
    <div class="big-clock" id="sw-display-${g.id}">${fmtWatch(w.running ? Date.now() - w.startAt : 0)}</div>
    <div class="sw-total-line">Team total: <strong id="sw-total-${g.id}">${fmtWatch(w.lapsTotal + (w.running ? Date.now() - w.startAt : 0))}</strong> · ${w.laps.length}${target ? '/' + target : ''} items</div>
    <div class="timer-btn-row">${mainBtn}</div>
    ${w.laps.length ? `
      <div class="sw-laps">${w.laps.map((ms, i) => `<span class="rank-pill">${i + 1}: ${fmtWatch(ms)}</span>`).join('')}</div>
      <div class="sw-actions">
        <button class="link-btn" data-action="undo-lap">Undo last item</button>
        <button class="link-btn danger-link" data-action="reset-watch">Reset stopwatch</button>
      </div>
      <div class="sw-save-row">
        <select id="sw-team-${g.id}">${state.teams.map((tm) => `<option value="${tm.id}">${esc(tm.name)}</option>`).join('')}</select>
        <button class="secondary-btn" data-action="save-time">Fill team's time</button>
      </div>` : ''}
  </div>`;
}

function bindStopwatch(wrap, g) {
  const box = wrap.querySelector('[data-tool="stopwatch"]');
  if (!box) return;
  const w = liveWatches[g.id];

  box.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'start-lap') {
        getAudio();
        w.startAt = Date.now();
        w.running = true;
        ensureTicking();
      } else if (a === 'stop-lap') {
        const lapMs = Date.now() - w.startAt;
        w.running = false;
        w.laps.push(lapMs);
        w.lapsTotal += lapMs;
      } else if (a === 'undo-lap') {
        const last = w.laps.pop();
        if (last) w.lapsTotal -= last;
      } else if (a === 'reset-watch') {
        if (!confirm('Reset the stopwatch and clear all recorded items?')) return;
        w.running = false;
        w.laps = [];
        w.lapsTotal = 0;
      } else if (a === 'save-time') {
        const sel = document.getElementById('sw-team-' + g.id);
        const teamId = sel.value;
        const draft = state.drafts[g.id] || (state.drafts[g.id] = { scores: {}, medals: {} });
        const prevLeader = leaderOf(g, draft);
        const totalSec = w.lapsTotal / 1000;
        const m = Math.floor(totalSec / 60);
        const s = totalSec - m * 60;
        draft.scores[teamId] = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
        draft.medals = {};
        saveState();
        checkHighScore(g, draft, teamId, prevLeader);
        renderAll();
        return;
      }
      renderTools(wrap, g);
    });
  });
}

// ── High-score chime ──

function leaderOf(g, draft) {
  const ranked = autoRank(g, draft);
  return ranked.length ? ranked[0] : null;
}

function checkHighScore(g, draft, teamId, prevLeader) {
  const newLeader = leaderOf(g, draft);
  if (!newLeader || newLeader.id !== teamId) return;
  if (prevLeader && prevLeader.id !== teamId &&
      (g.lowerWins ? newLeader.v < prevLeader.v : newLeader.v > prevLeader.v)) {
    playHighScore();
  }
}

// ── Time helpers (Pumpkin Pictionary) ────────────────────────────

function parseScoreInput(game, raw) {
  const str = String(raw).trim();
  if (!str) return null;
  if (game.timeInput && str.includes(':')) {
    const [m, s] = str.split(':');
    const mm = parseInt(m, 10);
    const ss = parseFloat(s);
    if (isNaN(mm) || isNaN(ss) || ss >= 60) return null;
    return mm * 60 + ss;
  }
  const v = parseFloat(str);
  return isNaN(v) ? null : v;
}

function formatScore(game, val) {
  if (game.timeInput) {
    const m = Math.floor(val / 60);
    const s = Math.round((val - m * 60) * 10) / 10;
    return m + ':' + (s < 10 ? '0' : '') + (Number.isInteger(s) ? s : s.toFixed(1));
  }
  return String(val);
}

// ── Standings (derived from saved results) ───────────────────────

function medalCounts() {
  const counts = {};
  state.teams.forEach((t) => (counts[t.id] = { gold: 0, silver: 0, bronze: 0 }));
  Object.values(state.results).forEach((r) => {
    if (!r || !r.medals) return;
    if (counts[r.medals.gold]) counts[r.medals.gold].gold += 1;
    if (counts[r.medals.silver]) counts[r.medals.silver].silver += 1;
    if (counts[r.medals.bronze]) counts[r.medals.bronze].bronze += 1;
  });
  return counts;
}

function renderStandings() {
  const tbody = document.getElementById('standings-tbody');
  const counts = medalCounts();
  const ranked = [...state.teams].sort((a, b) => {
    const sa = counts[a.id], sb = counts[b.id];
    if (sb.gold !== sa.gold) return sb.gold - sa.gold;
    if (sb.silver !== sa.silver) return sb.silver - sa.silver;
    return sb.bronze - sa.bronze;
  });

  tbody.innerHTML = '';
  ranked.forEach((team, i) => {
    const s = counts[team.id];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-col">${i + 1}</td>
      <td><input type="text" class="team-name-input" data-team-id="${team.id}" value="${esc(team.name)}" /></td>
      <td class="medal-col">${s.gold}</td>
      <td class="medal-col">${s.silver}</td>
      <td class="medal-col">${s.bronze}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.team-name-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const team = state.teams.find((t) => t.id === e.target.dataset.teamId);
      const val = e.target.value.trim();
      if (team && val) team.name = val;
      saveState();
      renderAll();
    });
  });
}

// ── Day tabs + game list ─────────────────────────────────────────

function renderDayTabs() {
  const nav = document.getElementById('day-tabs');
  const todayDow = new Date().getDay();
  nav.innerHTML = [1, 2, 3, 4, 5].map((d) => {
    const isToday = d === todayDow;
    return `<button class="day-tab ${state.ui.day === d ? 'active' : ''}" data-day="${d}">
      ${DAY_NAMES[d].slice(0, 3)}${isToday ? '<span class="today-dot" title="Today"></span>' : ''}
    </button>`;
  }).join('');

  nav.querySelectorAll('.day-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.day = parseInt(btn.dataset.day, 10);
      state.ui.gameId = null;
      saveState();
      renderAll();
    });
  });

  const note = document.getElementById('day-note');
  if (todayDow === 0 || todayDow === 6) {
    note.hidden = false;
    note.textContent = 'No games today — showing ' + DAY_NAMES[state.ui.day] + "'s lineup.";
  } else if (todayDow !== state.ui.day) {
    note.hidden = false;
    note.textContent = 'Heads up: today is ' + DAY_NAMES[todayDow] + ' — you are viewing ' + DAY_NAMES[state.ui.day] + '.';
  } else {
    note.hidden = true;
  }
}

const FORMAT_BADGES = {
  tournament: { label: 'Bracket', cls: 'badge-bracket' },
  tally: { label: 'Score entry', cls: 'badge-tally' },
  placement: { label: 'Podium pick', cls: 'badge-podium' },
};

function gameStatus(g) {
  if (state.results[g.id]) return 'done';
  if (state.brackets[g.id]) return 'in-progress';
  const d = state.drafts[g.id];
  if (d && ((d.scores && Object.values(d.scores).some((v) => String(v).trim() !== '')) || (d.medals && Object.values(d.medals).some(Boolean)))) return 'in-progress';
  return 'ready';
}

function renderGameList() {
  const wrap = document.getElementById('game-list');
  const day = state.ui.day;
  const dayGames = GAMES.filter((g) => g.day === day);
  const sessions = ['Morning', 'Evening'];

  let html = '';
  const isMesstival = dayGames.some((g) => g.messtival);
  if (isMesstival) {
    html += `<div class="messtival-banner">🎉 Messtival day — all games are worth DOUBLE points on the big scoreboard! (Track that on paper.)</div>`;
  }

  sessions.forEach((session) => {
    const games = dayGames.filter((g) => g.session === session);
    if (!games.length) {
      if (session === 'Evening' && day === 5) {
        html += `<h2 class="session-heading">Evening</h2>
          <p class="muted session-empty">No evening competition Friday — it's Team Skits night. 🎭</p>`;
      }
      return;
    }
    html += `<h2 class="session-heading">${session}</h2>`;
    games.forEach((g) => {
      const status = gameStatus(g);
      const badge = FORMAT_BADGES[g.format];
      const res = state.results[g.id];
      html += `<button class="game-card ${status}" data-game-id="${g.id}">
        <div class="game-card-top">
          <span class="game-emoji">${g.emoji}</span>
          <div class="game-card-titles">
            <span class="game-name">${esc(g.name)}</span>
            <span class="game-loc">📍 ${esc(g.location)}</span>
          </div>
          <span class="format-badge ${badge.cls}">${badge.label}</span>
        </div>
        <p class="game-headline">${esc(g.headline)}</p>
        ${res ? `<div class="game-result-line">🥇 ${esc(teamName(res.medals.gold))} · 🥈 ${esc(teamName(res.medals.silver))} · 🥉 ${esc(teamName(res.medals.bronze))}</div>`
          : status === 'in-progress' ? `<div class="game-progress-line">⏱️ In progress — tap to continue</div>` : ''}
      </button>`;
    });
  });

  wrap.innerHTML = html;
  wrap.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.ui.gameId = card.dataset.gameId;
      saveState();
      renderAll();
      document.getElementById('game-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── Game view ────────────────────────────────────────────────────

function renderGameView() {
  const view = document.getElementById('game-view');
  const list = document.getElementById('game-list');
  const g = state.ui.gameId ? gameById(state.ui.gameId) : null;

  if (!g) {
    view.hidden = true;
    list.hidden = false;
    return;
  }
  view.hidden = false;
  list.hidden = true;

  const badge = FORMAT_BADGES[g.format];
  let html = `
    <button id="back-btn" class="link-btn back-btn">← ${DAY_NAMES[g.day]} games</button>
    <div class="game-view-header">
      <span class="game-emoji-lg">${g.emoji}</span>
      <div>
        <h2>${esc(g.name)}</h2>
        <p class="muted">📍 ${esc(g.location)} · ${g.session} · <span class="format-badge ${badge.cls}">${badge.label}</span></p>
      </div>
    </div>
    ${g.messtival ? '<p class="messtival-tag">🎉 Messtival — double points on the paper scoreboard!</p>' : ''}
    <details class="rules-details" ${state.results[g.id] ? '' : 'open'}>
      <summary>How to play</summary>
      ${g.rules.map((sec) => `
        <h4>${esc(sec.h)}</h4>
        <ul>${sec.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      `).join('')}
    </details>
    <div id="tools-area"></div>
    <div id="entry-area"></div>
  `;
  view.innerHTML = html;

  document.getElementById('back-btn').addEventListener('click', () => {
    state.ui.gameId = null;
    saveState();
    renderAll();
  });

  if ((g.timer || g.stopwatch) && !state.results[g.id]) {
    renderTools(document.getElementById('tools-area'), g);
  }

  const entry = document.getElementById('entry-area');
  const result = state.results[g.id];
  if (result) {
    renderResult(entry, g, result);
  } else if (g.format === 'tournament') {
    renderTournament(entry, g);
  } else if (g.format === 'tally') {
    renderTally(entry, g);
  } else {
    renderPlacement(entry, g);
  }
}

function renderResult(container, g, result) {
  let extra = '';
  if (result.scores) {
    const rows = Object.entries(result.scores)
      .sort((a, b) => (g.lowerWins ? a[1] - b[1] : b[1] - a[1]))
      .map(([id, v]) => `<li>${esc(teamName(id))}: ${formatScore(g, v)}</li>`).join('');
    extra = `<p class="muted">Scores (${esc(g.unit || 'points')}):</p><ul class="score-recap">${rows}</ul>`;
  }
  container.innerHTML = `
    <h3>Final results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(result.medals.gold))}</strong></div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(result.medals.silver))}</strong></div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(result.medals.bronze))}</strong></div>
    </div>
    ${extra}
    <button id="clear-result-btn" class="link-btn danger-link">Clear result &amp; re-enter</button>
  `;
  document.getElementById('clear-result-btn').addEventListener('click', () => {
    if (!confirm('Clear the saved result for ' + g.name + '? Its medals come off the week count.')) return;
    delete state.results[g.id];
    saveState();
    renderAll();
  });
}

// ── Medal picker (shared by tally + placement) ───────────────────

function medalPickerHTML(picks) {
  const slots = [
    { key: 'gold', label: '🥇 Gold' },
    { key: 'silver', label: '🥈 Silver' },
    { key: 'bronze', label: '🥉 Bronze' },
  ];
  return `<div class="medal-picker">
    ${slots.map((s) => `
      <label class="medal-slot medal-slot-${s.key}">
        <span>${s.label}</span>
        <select data-medal="${s.key}">
          <option value="">— pick team —</option>
          ${state.teams.map((t) =>
            `<option value="${t.id}" ${picks[s.key] === t.id ? 'selected' : ''}>${esc(t.name)}</option>`
          ).join('')}
        </select>
      </label>
    `).join('')}
  </div>`;
}

function readMedalPicks(container) {
  const picks = {};
  container.querySelectorAll('select[data-medal]').forEach((sel) => {
    picks[sel.dataset.medal] = sel.value || null;
  });
  return picks;
}

function validateMedals(picks) {
  if (!picks.gold || !picks.silver || !picks.bronze) return 'Pick a team for every medal.';
  if (picks.gold === picks.silver || picks.gold === picks.bronze || picks.silver === picks.bronze) {
    return 'Each medal needs a different team.';
  }
  return null;
}

// ── Tally format ─────────────────────────────────────────────────

function renderTally(container, g) {
  if (!state.drafts[g.id]) state.drafts[g.id] = { scores: {}, medals: {} };
  const draft = state.drafts[g.id];
  const steps = g.counterSteps;

  container.innerHTML = `
    <h3>Enter team scores <span class="unit-tag">(${esc(g.unit || 'points')}${g.lowerWins ? ' — lowest wins' : ''})</span></h3>
    <div class="score-input-grid">
      ${state.teams.map((t) => `
        <div class="score-input-row ${steps ? 'with-counter' : ''}">
          <div class="score-row-top">
            <span class="score-team">${esc(t.name)}</span>
            <input type="text" inputmode="${g.timeInput ? 'numeric' : 'decimal'}" placeholder="${g.timeInput ? 'm:ss' : '0'}"
              data-team-id="${t.id}" value="${esc(draft.scores[t.id] || '')}" />
          </div>
          ${steps ? `<div class="counter-btn-row" data-team-id="${t.id}">
            <button class="counter-btn minus" data-delta="${-steps[0]}">−${steps[0]}</button>
            ${steps.map((s) => {
              const lbl = g.counterStepLabels && g.counterStepLabels[s] ? `<span class="counter-btn-sub">${esc(g.counterStepLabels[s])}</span>` : '';
              return `<button class="counter-btn plus" data-delta="${s}">+${s}${lbl}</button>`;
            }).join('')}
          </div>` : ''}
        </div>
      `).join('')}
    </div>
    <div id="tally-medals"></div>
    <p id="entry-error" class="entry-error" hidden></p>
    <button id="save-result-btn" class="primary-btn">Save Result</button>
  `;

  container.querySelectorAll('.score-input-row input').forEach((input) => {
    let leaderBefore = null;
    input.addEventListener('focus', () => {
      leaderBefore = leaderOf(g, draft);
    });
    input.addEventListener('input', () => {
      draft.scores[input.dataset.teamId] = input.value;
      draft.medals = {}; // re-auto-rank when scores change
      saveState();
      updateTallyMedals(g);
    });
    input.addEventListener('change', () => {
      checkHighScore(g, draft, input.dataset.teamId, leaderBefore);
      leaderBefore = leaderOf(g, draft);
    });
  });

  container.querySelectorAll('.counter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      getAudio(); // unlock audio on a user gesture
      const teamId = btn.closest('.counter-btn-row').dataset.teamId;
      const delta = parseInt(btn.dataset.delta, 10);
      const prevLeader = leaderOf(g, draft);
      const current = parseScoreInput(g, draft.scores[teamId] || '') || 0;
      let next = current + delta;
      if (next < 0 && !g.counterAllowNegative) next = 0;
      draft.scores[teamId] = String(next);
      draft.medals = {};
      const input = container.querySelector(`input[data-team-id="${teamId}"]`);
      if (input) input.value = String(next);
      saveState();
      checkHighScore(g, draft, teamId, prevLeader);
      updateTallyMedals(g);
    });
  });

  updateTallyMedals(g);

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('tally-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    const scores = {};
    state.teams.forEach((t) => {
      const v = parseScoreInput(g, draft.scores[t.id] || '');
      if (v !== null) scores[t.id] = v;
    });
    state.results[g.id] = { medals: picks, scores, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    saveState();
    renderAll();
  });
}

function autoRank(g, draft) {
  const entries = [];
  state.teams.forEach((t) => {
    const v = parseScoreInput(g, draft.scores[t.id] || '');
    if (v !== null) entries.push({ id: t.id, v });
  });
  entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  return entries;
}

function updateTallyMedals(g) {
  const draft = state.drafts[g.id];
  const wrap = document.getElementById('tally-medals');
  if (!wrap) return;
  const ranked = autoRank(g, draft);

  const auto = {
    gold: ranked[0] ? ranked[0].id : null,
    silver: ranked[1] ? ranked[1].id : null,
    bronze: ranked[2] ? ranked[2].id : null,
  };
  const picks = {
    gold: draft.medals.gold || auto.gold,
    silver: draft.medals.silver || auto.silver,
    bronze: draft.medals.bronze || auto.bronze,
  };

  // Tie warning: a team just outside the podium with the same score as one on it.
  let tieNote = '';
  if (ranked.length >= 4 && ranked[3].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the bronze line — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 2 && ranked[0].v === ranked[1].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the top — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 3 && ranked[1].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie for silver/bronze — adjust the medals below if needed.</p>';
  }

  wrap.innerHTML = `
    ${ranked.length ? `<div class="live-ranking">${ranked.map((e, i) =>
      `<span class="rank-pill">${i + 1}. ${esc(teamName(e.id))} · ${formatScore(g, e.v)}</span>`).join('')}</div>` : ''}
    ${tieNote}
    <h3 class="medal-picker-heading">Medals ${ranked.length >= 3 ? '<span class="unit-tag">(auto-filled from scores)</span>' : ''}</h3>
    ${medalPickerHTML(picks)}
  `;

  wrap.querySelectorAll('select[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      draft.medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });
}

// ── Placement format ─────────────────────────────────────────────

function renderPlacement(container, g) {
  if (!state.drafts[g.id]) state.drafts[g.id] = { medals: {} };
  const draft = state.drafts[g.id];

  container.innerHTML = `
    <h3>Podium</h3>
    <p class="muted">No score-keeping needed — just record who placed.</p>
    <div id="placement-medals">${medalPickerHTML(draft.medals)}</div>
    <p id="entry-error" class="entry-error" hidden></p>
    <button id="save-result-btn" class="primary-btn">Save Result</button>
  `;

  container.querySelectorAll('select[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      draft.medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('placement-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    state.results[g.id] = { medals: picks, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    saveState();
    renderAll();
  });
}

// ── Tournament format ────────────────────────────────────────────

function freshBracket() {
  return {
    phase: 'round1', // round1 -> bye -> semifinal -> championship -> summary
    pool: state.teams.map((t) => t.id),
    selectedPair: [],
    matches: [],
    byeTeamId: null,
    semifinal: null,
    championship: null,
  };
}

function renderTournament(container, g) {
  if (!state.brackets[g.id]) {
    container.innerHTML = `
      <h3>Run the bracket</h3>
      <p class="muted">Three first-round matches, then the medal round. The bye goes to the Round&nbsp;1 winner who's LOWEST in the overall standings coming into today — the app will ask you to check.</p>
      <button id="start-bracket-btn" class="primary-btn">Start Bracket</button>
    `;
    document.getElementById('start-bracket-btn').addEventListener('click', () => {
      state.brackets[g.id] = freshBracket();
      saveState();
      renderAll();
    });
    return;
  }

  const b = state.brackets[g.id];
  let html = `<div class="bracket-steps">
    ${['round1', 'bye', 'semifinal', 'championship', 'summary'].map((p, i) => {
      const labels = { round1: 'Round 1', bye: 'Bye', semifinal: 'Semifinal', championship: 'Championship', summary: 'Results' };
      const order = ['round1', 'bye', 'semifinal', 'championship', 'summary'];
      const cls = p === b.phase ? 'active' : order.indexOf(p) < order.indexOf(b.phase) ? 'done' : '';
      return `<span class="wizard-step ${cls}">${labels[p]}</span>${i < 4 ? '<span class="wizard-step-arrow">→</span>' : ''}`;
    }).join('')}
  </div><div id="bracket-body"></div>
  <div class="wizard-footer"><button id="cancel-bracket-btn" class="link-btn danger-link">Cancel this bracket</button></div>`;
  container.innerHTML = html;

  document.getElementById('cancel-bracket-btn').addEventListener('click', () => {
    if (!confirm('Cancel this bracket? Nothing will be saved.')) return;
    delete state.brackets[g.id];
    saveState();
    renderAll();
  });

  const body = document.getElementById('bracket-body');
  if (b.phase === 'round1') renderBracketRound1(body, g, b);
  else if (b.phase === 'bye') renderBracketBye(body, g, b);
  else if (b.phase === 'semifinal') renderBracketSemifinal(body, g, b);
  else if (b.phase === 'championship') renderBracketChampionship(body, g, b);
  else renderBracketSummary(body, g, b);
}

function renderBracketRound1(body, g, b) {
  if (b.pool.length === 0) {
    b.phase = 'bye';
    saveState();
    renderAll();
    return;
  }

  let html = `<h3>Round 1 — Match ${b.matches.length + 1} of 3</h3>
    <p class="muted">Pick the two teams to call up next.</p>
    <div class="team-chip-grid">
      ${b.pool.map((id) => `<button class="team-chip ${b.selectedPair.includes(id) ? 'selected' : ''}" data-team-id="${id}">${esc(teamName(id))}</button>`).join('')}
    </div>`;

  if (b.selectedPair.length === 2) {
    const [a, c] = b.selectedPair;
    html += `<div class="matchup-callout">
      <p class="call-next-label">Call up next:</p>
      <p class="call-next-teams">${esc(teamName(a))} <span class="vs">vs</span> ${esc(teamName(c))}</p>
      <div class="winner-btn-row">
        <button class="secondary-btn winner-btn" data-winner="${a}">${esc(teamName(a))} won</button>
        <button class="secondary-btn winner-btn" data-winner="${c}">${esc(teamName(c))} won</button>
      </div>
    </div>`;
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches">
      <p class="muted">Completed:</p>
      <ul>${b.matches.map((m) => `<li>${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('')}</ul>
      <button id="undo-match-btn" class="link-btn">Undo last match</button>
    </div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll('.team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId;
      const idx = b.selectedPair.indexOf(id);
      if (idx > -1) b.selectedPair.splice(idx, 1);
      else if (b.selectedPair.length < 2) b.selectedPair.push(id);
      saveState();
      renderAll();
    });
  });

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const [a, c] = b.selectedPair;
      const loser = winner === a ? c : a;
      b.matches.push({ a, b: c, winner, loser });
      b.pool = b.pool.filter((id) => id !== a && id !== c);
      b.selectedPair = [];
      saveState();
      renderAll();
    });
  });

  const undoBtn = document.getElementById('undo-match-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const last = b.matches.pop();
      if (last) b.pool.push(last.a, last.b);
      saveState();
      renderAll();
    });
  }
}

function renderBracketBye(body, g, b) {
  const winners = b.matches.map((m) => m.winner);
  body.innerHTML = `
    <h3>Who gets the bye?</h3>
    <p class="muted">Check the overall team standings (the official paper one). Whichever of these three Round&nbsp;1 winners has the <strong>lowest points coming into today</strong> skips straight to the Championship.</p>
    <div class="team-chip-grid">
      ${winners.map((id) => `<button class="team-chip tiebreak-chip" data-team-id="${id}">${esc(teamName(id))}</button>`).join('')}
    </div>
    <button id="undo-to-round1-btn" class="link-btn">← Back to Round 1</button>
  `;

  body.querySelectorAll('.tiebreak-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const byeId = btn.dataset.teamId;
      const others = winners.filter((id) => id !== byeId);
      b.byeTeamId = byeId;
      b.semifinal = { a: others[0], b: others[1], winner: null, loser: null };
      b.phase = 'semifinal';
      saveState();
      renderAll();
    });
  });

  document.getElementById('undo-to-round1-btn').addEventListener('click', () => {
    const last = b.matches.pop();
    if (last) b.pool.push(last.a, last.b);
    b.phase = 'round1';
    saveState();
    renderAll();
  });
}

function renderBracketSemifinal(body, g, b) {
  body.innerHTML = `
    <h3>Semifinal</h3>
    <p class="bye-note">🎟️ <strong>${esc(teamName(b.byeTeamId))}</strong> has the bye — straight to the Championship.</p>
    <div class="matchup-callout">
      <p class="call-next-label">Call up next:</p>
      <p class="call-next-teams">${esc(teamName(b.semifinal.a))} <span class="vs">vs</span> ${esc(teamName(b.semifinal.b))}</p>
      <div class="winner-btn-row">
        <button class="secondary-btn winner-btn" data-winner="${b.semifinal.a}">${esc(teamName(b.semifinal.a))} won</button>
        <button class="secondary-btn winner-btn" data-winner="${b.semifinal.b}">${esc(teamName(b.semifinal.b))} won</button>
      </div>
    </div>
  `;

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.semifinal.a ? b.semifinal.b : b.semifinal.a;
      b.semifinal.winner = winner;
      b.semifinal.loser = loser;
      b.championship = { a: b.byeTeamId, b: winner, winner: null, loser: null };
      b.phase = 'championship';
      saveState();
      renderAll();
    });
  });
}

function renderBracketChampionship(body, g, b) {
  body.innerHTML = `
    <h3>Championship</h3>
    <p class="bronze-note">🥉 <strong>${esc(teamName(b.semifinal.loser))}</strong> takes the bronze medal.</p>
    <div class="matchup-callout">
      <p class="call-next-label">Call up next:</p>
      <p class="call-next-teams">${esc(teamName(b.championship.a))} <span class="vs">vs</span> ${esc(teamName(b.championship.b))}</p>
      <div class="winner-btn-row">
        <button class="secondary-btn winner-btn" data-winner="${b.championship.a}">${esc(teamName(b.championship.a))} won</button>
        <button class="secondary-btn winner-btn" data-winner="${b.championship.b}">${esc(teamName(b.championship.b))} won</button>
      </div>
    </div>
  `;

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.championship.a ? b.championship.b : b.championship.a;
      b.championship.winner = winner;
      b.championship.loser = loser;
      b.phase = 'summary';
      saveState();
      renderAll();
    });
  });
}

function renderBracketSummary(body, g, b) {
  const goldId = b.championship.winner;
  const silverId = b.championship.loser;
  const bronzeId = b.semifinal.loser;
  const eliminated = b.matches.map((m) => m.loser);

  body.innerHTML = `
    <h3>Game results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(goldId))}</strong></div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(silverId))}</strong></div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(bronzeId))}</strong></div>
    </div>
    <p class="muted">Eliminated in Round 1: ${eliminated.map((id) => esc(teamName(id))).join(', ')}</p>
    <button id="save-bracket-btn" class="primary-btn">Save Result</button>
  `;

  document.getElementById('save-bracket-btn').addEventListener('click', () => {
    state.results[g.id] = {
      medals: { gold: goldId, silver: silverId, bronze: bronzeId },
      savedAt: new Date().toISOString(),
    };
    delete state.brackets[g.id];
    saveState();
    renderAll();
  });
}

// ── Reset week ───────────────────────────────────────────────────

function resetWeek() {
  if (!confirm('Start a new week? This clears every saved game result (team names are kept).')) return;
  state.results = {};
  state.brackets = {};
  state.drafts = {};
  state.ui.gameId = null;
  saveState();
  renderAll();
}

// ── Theme ────────────────────────────────────────────────────────

function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = state.theme === 'dark' || (state.theme === null && prefersDark);
  document.body.classList.toggle('dark-theme', dark);
  document.getElementById('theme-toggle').textContent = dark ? '☀️' : '🌙';
}

function toggleTheme() {
  state.theme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
  saveState();
  applyTheme();
}

function applySoundIcon() {
  document.getElementById('sound-toggle').textContent = soundOn() ? '🔊' : '🔇';
}

function toggleSound() {
  state.sound = !soundOn();
  if (!soundOn()) cutAllSound();
  else playHighScore(); // quick confirmation blip
  saveState();
  applySoundIcon();
}

// ── Init ─────────────────────────────────────────────────────────

function renderAll() {
  renderDayTabs();
  renderGameList();
  renderGameView();
  renderStandings();
}

function init() {
  applyTheme();
  applySoundIcon();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sound-toggle').addEventListener('click', toggleSound);
  document.getElementById('reset-week-btn').addEventListener('click', resetWeek);
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
