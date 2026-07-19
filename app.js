// ── Camp Scoreboard ─────────────────────────────────────────────
// The week's games, day by day. Three formats:
//  - tournament: 2 teams at a time, 3 first-round matches, winners go
//    to the medal round. The bye goes to whichever winner is lowest in
//    the OVERALL standings coming into today — the app asks you, since
//    the official scoreboard lives on paper.
//  - tally: every team posts a score; top 3 auto-earn medals.
//  - placement: no numbers, you just pick who took gold/silver/bronze.

const STORAGE_KEY = 'campScoreboardV2';

// Bump this to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`)
// every time app.js/index.html/styles.css changes and gets deployed — it
// drives the "Code last updated" line in the footer. There's no build
// step here to stamp this automatically, so it's a manual step alongside
// the ?v=N cache-bust bump in index.html.
const CODE_UPDATED_AT = '2026-07-19T22:34:35Z';

// Light PIN gate — keeps casual visitors out of a public page. Not real
// security (the code is viewable), just a "you need the number" door.
// Two tiers: VIEW_PIN can look but not touch; EDIT_PIN can enter scores.
const VIEW_PIN = '1234';
const EDIT_PIN = '1880';
const UNLOCK_KEY = 'campScoreboardUnlocked';
const ROLE_KEY = 'campScoreboardRole';

function currentRole() {
  try { return localStorage.getItem(ROLE_KEY) || 'view'; } catch (e) { return 'view'; }
}

function canEdit() {
  return currentRole() === 'edit';
}

// Team names from the printed roster, paired to their counselor group
// by position (t0..t5). Teams 5 & 6 keep their placeholder names until
// their real names come in. Edit any of these in the standings table.
const DEFAULT_TEAM_NAMES = [
  'Ferocious Foxes',              // Alyssa, Cam, Sam
  'Turkey Dinner',               // Bria, Lydia, Zac
  'Methodic Mediocre Maples',    // Jovi, Brody, Josh
  'Portidatory Perilous Pumpkins', // Sofia, William
  'Team 5',                      // Abby, TJ, Ella
  'Team 6',                      // Lily, Jacob
];
// Older deploys seeded generic "Team N" names; any saved roster still
// carrying one gets migrated to the roster name above. Hand-edited names
// (anything not matching this list) are left untouched.
const OLD_PLACEHOLDER_TEAM_NAMES = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'];
// Counselor groups per team, from the printed camp sheet. The (A)/(B)
// tag is the game-leader assignment: Stephen runs the A teams,
// Patrick runs the B teams. Editable per-team in the standings table.
const DEFAULT_COUNSELORS = [
  'Alysa/Cam/Sam (B)',
  'Bria/Lydia/Zac (A)',
  'Jovi/Brody/Josh (A)',
  'Sofia/William (B)',
  'Abby/TJ/Ella (B)',
  'Lily/Jacob (A)',
];
// Earlier deploys seeded these placeholder names; any saved roster still
// carrying one gets migrated to the real counselor list above.
const OLD_PLACEHOLDER_COUNSELORS = ['Sarah', 'Mike', 'Emily', 'Josh', 'Rachel', 'Dave'];

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

// Everything is points based: each medal is worth a fixed number of
// points, and the week standings rank teams by total points.
const MEDAL_POINTS = { gold: 7, silver: 5, bronze: 3 };

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
    prompts: ['Pumpkin', 'Scarecrow', 'Ear of Corn', 'Falling Leaf', 'Apple Pie', 'Hay Bale', 'Turkey', 'Acorn', 'Sunflower', 'Tractor'],
    headline: 'Draw with your nose in pumpkin puree — fastest total time wins.',
    rules: [
      { h: 'Prep', items: ['The 10 drawing prompts are built in below — pick a team and run their round right from this page, snapping a photo of each masterpiece as you go.'] },
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

// ── Live daily schedule ("Happening now" banner) ─────────────────
// The full week from the printed Junior Camp packet, so the top of the
// page can say what camp is doing at this very moment. Times are minutes
// since midnight in CAMP TIME (US Eastern) — never the phone's timezone,
// so the banner is right even for family checking in from elsewhere.
// During competition blocks the banner hides; the scoreboard below is
// the main event then. Blocks are contiguous — findIndex is enough.

const CAMP_TZ = 'America/New_York';

function hm(h, m) { return h * 60 + (m || 0); }

// Shared Monday–Friday daytime rhythm (identical on the paper schedule).
function weekdayDaytime() {
  return [
    { start: hm(7, 30), end: hm(8, 0), label: 'Rising bell & shower', emoji: '⏰', type: 'activity' },
    { start: hm(8, 0), end: hm(8, 30), label: 'Breakfast', emoji: '🍳', type: 'activity' },
    { start: hm(8, 30), end: hm(9, 0), label: 'Cabin time & clean up', emoji: '🧹', type: 'activity' },
    { start: hm(9, 0), end: hm(9, 45), label: 'Bible study', emoji: '📖', type: 'activity' },
    { start: hm(9, 45), end: hm(10, 0), label: 'Prepare for competitions / team huddle', emoji: '📣', type: 'activity' },
    { start: hm(10, 0), end: hm(11, 45), label: 'Team competitions', emoji: '🏅', type: 'games' },
    { start: hm(11, 45), end: hm(12, 0), label: 'Prepare for lunch', emoji: '🧼', type: 'activity' },
    { start: hm(12, 0), end: hm(12, 30), label: 'Lunch', emoji: '🥪', type: 'activity' },
    { start: hm(12, 30), end: hm(13, 0), label: 'Team time', emoji: '🤝', type: 'activity' },
    { start: hm(13, 0), end: hm(13, 15), label: 'Prepare for Elective 1', emoji: '🎒', type: 'activity' },
    { start: hm(13, 15), end: hm(14, 0), label: 'Elective 1', emoji: '🌟', type: 'elective', slot: 0 },
    { start: hm(14, 0), end: hm(14, 45), label: 'Snack Shack break', emoji: '🍫', type: 'activity' },
    { start: hm(14, 45), end: hm(15, 0), label: 'Prepare for Elective 2', emoji: '🎒', type: 'activity' },
    { start: hm(15, 0), end: hm(15, 45), label: 'Elective 2', emoji: '🌟', type: 'elective', slot: 1 },
    { start: hm(15, 45), end: hm(16, 0), label: 'Prepare for Elective 3', emoji: '🎒', type: 'activity' },
    { start: hm(16, 0), end: hm(16, 45), label: 'Elective 3', emoji: '🌟', type: 'elective', slot: 2 },
    { start: hm(16, 45), end: hm(17, 0), label: 'Prepare for supper', emoji: '🧼', type: 'activity' },
    { start: hm(17, 0), end: hm(17, 30), label: 'Supper', emoji: '🍽️', type: 'activity' },
  ];
}

// Mon–Thu evenings are identical apart from who leads the campfire.
function weekdayEvening(campfireLeader) {
  return [
    { start: hm(17, 30), end: hm(18, 0), label: 'Prepare for competitions / team huddle', emoji: '📣', type: 'activity' },
    { start: hm(18, 0), end: hm(18, 45), label: 'Evening competition', emoji: '🏅', type: 'games' },
    { start: hm(18, 45), end: hm(19, 0), label: 'Prepare for evening service', emoji: '⛪', type: 'activity' },
    { start: hm(19, 0), end: hm(20, 0), label: 'Evening service', emoji: '⛪', type: 'activity' },
    { start: hm(20, 0), end: hm(21, 15), label: 'Snack and campfire — ' + campfireLeader, emoji: '🔥', type: 'activity' },
    { start: hm(21, 15), end: hm(21, 30), label: 'Prepare for bed', emoji: '🪥', type: 'activity' },
    { start: hm(21, 30), end: hm(22, 0), label: 'Cabin devotional', emoji: '🙏', type: 'activity' },
    { start: hm(22, 0), end: hm(24, 0), label: 'Lights out', emoji: '😴', type: 'activity', noTime: true },
  ];
}

const DAY_SCHEDULE = {
  0: [ // Sunday — arrival day
    { start: hm(14, 0), end: hm(16, 0), label: 'Registration', emoji: '📝', type: 'activity' },
    { start: hm(16, 0), end: hm(17, 0), label: 'Welcome to camp / get-to-know-you', emoji: '👋', type: 'activity' },
    { start: hm(17, 0), end: hm(17, 30), label: 'Supper', emoji: '🍽️', type: 'activity' },
    { start: hm(17, 30), end: hm(18, 45), label: 'Team assignments (Chapel Lawn)', emoji: '🎽', type: 'activity' },
    { start: hm(18, 45), end: hm(19, 0), label: 'Prepare for worship service', emoji: '⛪', type: 'activity' },
    { start: hm(19, 0), end: hm(20, 0), label: 'Worship service', emoji: '⛪', type: 'activity' },
    { start: hm(20, 0), end: hm(21, 15), label: 'Snack and campfire — Jenn, Laura, Erica & Patrick', emoji: '🔥', type: 'activity' },
    { start: hm(21, 15), end: hm(22, 0), label: 'Cabin devotional', emoji: '🙏', type: 'activity' },
    { start: hm(22, 0), end: hm(24, 0), label: 'Lights out', emoji: '😴', type: 'activity', noTime: true },
  ],
  1: weekdayDaytime().concat(weekdayEvening('TJ')),
  2: weekdayDaytime().concat(weekdayEvening('Cam')),
  3: weekdayDaytime().concat(weekdayEvening('Sofie')),
  4: weekdayDaytime().concat(weekdayEvening('Jovi')),
  5: weekdayDaytime().concat([ // Friday evening — Team Skits night, later lights out
    { start: hm(17, 30), end: hm(18, 0), label: 'Team huddle', emoji: '📣', type: 'activity' },
    { start: hm(18, 0), end: hm(19, 0), label: 'Final preparations for skits', emoji: '🎭', type: 'activity' },
    { start: hm(19, 0), end: hm(20, 0), label: 'Team Skits', emoji: '🎭', type: 'activity' },
    { start: hm(20, 0), end: hm(21, 0), label: 'Evening service', emoji: '⛪', type: 'activity' },
    { start: hm(21, 0), end: hm(22, 0), label: 'Snack and campfire — Ella', emoji: '🔥', type: 'activity' },
    { start: hm(22, 0), end: hm(22, 15), label: 'Prepare for bed', emoji: '🪥', type: 'activity' },
    { start: hm(22, 15), end: hm(22, 30), label: 'Cabin devotional', emoji: '🙏', type: 'activity' },
    { start: hm(22, 30), end: hm(24, 0), label: 'Lights out', emoji: '😴', type: 'activity', noTime: true },
  ]),
  6: [ // Saturday — send-off morning
    { start: hm(7, 30), end: hm(8, 0), label: 'Rising bell & shower', emoji: '⏰', type: 'activity' },
    { start: hm(8, 0), end: hm(8, 30), label: 'Breakfast', emoji: '🍳', type: 'activity' },
    { start: hm(8, 30), end: hm(9, 30), label: 'Cabin time & campground cleanup', emoji: '🧹', type: 'activity' },
    { start: hm(9, 30), end: hm(10, 0), label: 'Meet in Tabernacle for send-off', emoji: '👋', type: 'activity' },
    { start: hm(10, 0), end: hm(24, 0), label: "Camp's over — see you next year!", emoji: '👋', type: 'activity', noTime: true },
  ],
};

// Who's at which elective station, straight from the handwritten packet.
// Keyed by day (1 Mon .. 5 Fri), one entry per elective slot (1, 2, 3).
const STATION_EMOJI = {
  'Swimming': '🏊', 'Nerf War': '🎯', 'Crafts with Eileen': '🎨',
  'Lawn Games': '🥏', 'Board Games': '🎲', 'Whiffle Ball': '⚾',
  'Slime with Joann': '🧪', 'Laser Tag': '⚡', 'Slip and Slide': '💦',
};

const ELECTIVES = {
  1: [
    [['Swimming', ['Bria', 'Abby']], ['Nerf War', ['Zac', 'Cam']], ['Crafts with Eileen', ['William', 'Jovi']], ['Lawn Games', ['TJ', 'Patrick', 'Sam']], ['Board Games', ['Brody', 'Lydia']]],
    [['Swimming', ['Alysa', 'Brody']], ['Crafts with Eileen', ['Bria', 'Lilly']], ['Whiffle Ball', ['TJ', 'Cam']], ['Board Games', ['Jovi', 'Josh', 'Patrick']], ['Slime with Joann', ['Sofi', 'Abby']], ['Laser Tag', ['Zac', 'William']]],
    [['Swimming', ['Sam', 'TJ', 'Lilly']], ['Slime with Joann', ['Lydia', 'Alysa']], ['Crafts with Eileen', ['Ella', 'Stephen']], ['Lawn Games', ['Josh', 'Sofi']], ['Board Games', ['Patrick']], ['Slip and Slide', ['Zac', 'Jacob']]],
  ],
  2: [
    [['Swimming', ['Ella', 'Lydia']], ['Nerf War', ['William', 'Zac']], ['Crafts with Eileen', ['Alysa', 'Josh']], ['Lawn Games', ['Brody', 'Cam']], ['Board Games', ['Bria', 'Jovi']]],
    [['Swimming', ['Sam', 'Sofi']], ['Crafts with Eileen', ['Lilly', 'Abby']], ['Whiffle Ball', ['Jacob', 'TJ']], ['Board Games', ['Ella', 'Stephen']], ['Laser Tag', ['Zac', 'Patrick']]],
    [['Swimming', ['William', 'Alysa', 'Lilly']], ['Crafts with Eileen', ['Sofi', 'Lydia']], ['Lawn Games', ['Josh', 'Stephen', 'Cam']], ['Board Games', ['Patrick', 'TJ']], ['Slip and Slide', ['Zac', 'Sam', 'Bria']]],
  ],
  3: [
    [['Swimming', ['Abby', 'Lilly']], ['Nerf War', ['Zac', 'Brody', 'TJ']], ['Crafts with Eileen', ['William', 'Sam']], ['Lawn Games', ['Sofi', 'Bria']], ['Board Games', ['Cam', 'Jovi']]],
    [['Swimming', ['Ella', 'Bria']], ['Crafts with Eileen', ['Lydia', 'Jovi']], ['Whiffle Ball', ['Sofi', 'TJ']], ['Board Games', ['Patrick', 'Josh', 'Sam']], ['Slime with Joann', ['Brody', 'Stephen']], ['Laser Tag', ['Zac', 'Jacob']]],
    [['Swimming', ['William', 'Cam']], ['Slime with Joann', ['Alysa', 'Ella']], ['Crafts with Eileen', ['Lilly', 'Josh']], ['Lawn Games', ['Patrick', 'Stephen']], ['Board Games', ['TJ', 'Abby']], ['Slip and Slide', ['Zac', 'Lydia', 'Jacob']]],
  ],
  4: [
    [['Swimming', ['Jovi', 'Bria', 'Cam']], ['Nerf War', ['William', 'Zac', 'Lilly']], ['Crafts with Eileen', ['Brody', 'Ella']], ['Lawn Games', ['Patrick', 'Jacob']], ['Board Games', ['Stephen', 'Alysa']]],
    [['Swimming', ['Lilly', 'TJ']], ['Crafts with Eileen', ['Abby', 'Jovi']], ['Whiffle Ball', ['Cam', 'Sam', 'Bria']], ['Board Games', ['Patrick', 'Stephen']], ['Slime with Joann', ['Lydia', 'Sofi', 'William']], ['Laser Tag', ['Zac', 'Brody']]],
    [['Swimming', ['Alysa', 'Abby', 'Josh']], ['Slime with Joann', ['Ella', 'Bria']], ['Crafts with Eileen', ['Lydia']], ['Lawn Games', ['Brody', 'Sam']], ['Board Games', ['Sofi', 'TJ']], ['Slip and Slide', ['Zac', 'Stephen']]],
  ],
  5: [
    [['Swimming', ['Brody', 'Ella', 'TJ']], ['Nerf War', ['Zac', 'Cam', 'Sam']], ['Crafts with Eileen', ['Patrick', 'Alysa', 'William']], ['Lawn Games', ['Bria', 'Abby']], ['Board Games', ['Lydia', 'Jovi']]],
    [['Swimming', ['Sam', 'Ella']], ['Crafts with Eileen', ['Lilly', 'Jacob']], ['Whiffle Ball', ['Jovi', 'Cam', 'TJ']], ['Board Games', ['Josh', 'Patrick']], ['Slime with Joann', ['Brody', 'Stephen']], ['Laser Tag', ['Zac', 'Bria']]],
    [['Swimming', ['Cam', 'TJ', 'Lilly']], ['Slime with Joann', ['Abby', 'Sofi']], ['Crafts with Eileen', ['Lydia']], ['Lawn Games', ['Josh', 'Sam']], ['Board Games', ['Stephen']], ['Slip and Slide', ['Zac', 'Alysa']]],
  ],
};

// ── Meal menu ────────────────────────────────────────────────────
// What the kitchen is serving, filled in as camp announces each meal.
// Keyed by day-of-week (0 Sun .. 6 Sat), then by meal block name in
// lowercase ('breakfast' / 'lunch' / 'supper'). When a meal is listed
// here, the Happening Now banner names the dish during that block and
// in the "Up next" line leading into it. Unknown meals just show the
// plain block label, so this is always safe to leave sparse.
const MEALS = {
  0: { supper: { dish: "Shepherd's Pie", emoji: '🥧' } },
  1: {
    breakfast: { dish: 'Eggs and Bacon', emoji: '🥓' },
    lunch: { dish: 'Wraps', emoji: '🌯' },
    supper: { dish: 'Mac and Cheese', emoji: '🧀' },
  },
};

function mealInfo(dow, block) {
  const meals = MEALS[dow];
  if (!meals || !block) return null;
  return meals[(block.label || '').toLowerCase()] || null;
}

// Returns the block as-is, or a copy dressed up with tonight's dish —
// e.g. "Supper" becomes "Supper — Shepherd's Pie" with a 🥧 emoji.
function decorateMealBlock(dow, block) {
  const meal = mealInfo(dow, block);
  if (!meal) return block;
  return Object.assign({}, block, {
    emoji: meal.emoji || block.emoji,
    label: block.label + ' — ' + meal.dish,
  });
}

// Current day-of-week + minutes-since-midnight, in camp time.
// Debug/preview override: add ?now=<dow>-<hhmm> to the page URL,
// e.g. ?now=1-1330 previews Monday 1:30pm.
function campNow() {
  const m = /[?&]now=(\d)-(\d{3,4})(?:&|$)/.exec(location.search);
  if (m) {
    const t = m[2].padStart(4, '0');
    return { dow: +m[1], minutes: +t.slice(0, 2) * 60 + +t.slice(2) };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CAMP_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = parseInt(get('hour'), 10) % 24; // hour12:false renders midnight as "24"
    return { dow: dowMap[get('weekday')], minutes: hour * 60 + parseInt(get('minute'), 10) };
  } catch (e) {
    const d = new Date(); // worst case: device time
    return { dow: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

// Named schedClock/schedRange (not fmtClock) — the stopwatch below has
// its own fmtClock(ms) and function declarations share one namespace.
function schedClock(mins, withSuffix) {
  const h = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return h12 + ':' + String(mm).padStart(2, '0') + (withSuffix ? (h < 12 ? 'am' : 'pm') : '');
}

function schedRange(start, end) {
  const sameHalf = (start < 720) === (end < 720 || end === 1440);
  return schedClock(start, !sameHalf) + '–' + schedClock(end, true);
}

function nowBannerHtml(dow, minutes) {
  const blocks = DAY_SCHEDULE[dow] || [];
  if (!blocks.length) return null;

  const eyebrow = `<div class="now-eyebrow-row">
    <span class="now-eyebrow">Happening now</span>
    <span class="now-open-hint">📅 Full schedule ›</span>
  </div>`;
  const main = (emoji, label, time, next) => eyebrow +
    `<div class="now-main"><span class="now-emoji">${emoji}</span><div class="now-body">
      <div class="now-label">${esc(label)}${time ? ` <span class="now-time">${time}</span>` : ''}</div>
      ${next ? `<div class="now-next">Up next: ${next.emoji} ${esc(next.label)} at ${schedClock(next.start, true)}</div>` : ''}
    </div></div>`;

  // Early morning, before the first block of the day.
  if (minutes < blocks[0].start) {
    const first = decorateMealBlock(dow, blocks[0]);
    if (dow === 0) return main('🚌', 'Camp starts today!', null, first);
    return main('😴', "Lights out — everyone's sleeping", null, first);
  }

  const found = blocks.find((x) => minutes >= x.start && minutes < x.end);
  if (!found || found.type === 'games') return null; // game time: the scoreboard says it all

  const b = decorateMealBlock(dow, found);
  const time = b.noTime ? null : schedRange(b.start, b.end);
  if (b.type === 'elective') {
    const stations = (ELECTIVES[dow] || [])[b.slot] || [];
    const rows = stations.map(([station, kids]) =>
      `<div class="now-station"><span class="now-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
        <span class="now-kids">${kids.map((k) => `<span class="kid-chip">${esc(k)}</span>`).join('')}</span></div>`).join('');
    return main(b.emoji, b.label, time, null) + `<div class="now-stations">${rows}</div>`;
  }

  const next = decorateMealBlock(dow, blocks[blocks.indexOf(found) + 1] || null);
  return main(b.emoji, b.label, time, next);
}

function renderNowBanner() {
  const el = document.getElementById('now-banner');
  if (!el) return;
  const { dow, minutes } = campNow();
  const html = nowBannerHtml(dow, minutes);
  el.hidden = !html;
  el.innerHTML = html || '';
}

// ── Full week schedule sheet (tap the Happening Now banner) ──────
// A bottom sheet with the whole printed schedule, day by day: a
// timeline of every block, today's current block highlighted, meals
// showing their dish, electives showing who's at each station, and
// competition blocks listing that day's actual games.

const SCHED_DAYS = [
  { dow: 0, short: 'Sun', full: 'Sunday', tag: 'Arrival day' },
  { dow: 1, short: 'Mon', full: 'Monday', tag: 'Competition day 1' },
  { dow: 2, short: 'Tue', full: 'Tuesday', tag: 'Competition day 2' },
  { dow: 3, short: 'Wed', full: 'Wednesday', tag: 'Competition day 3' },
  { dow: 4, short: 'Thu', full: 'Thursday', tag: 'Competition day 4' },
  { dow: 5, short: 'Fri', full: 'Friday', tag: 'Messtival & Team Skits' },
  { dow: 6, short: 'Sat', full: 'Saturday', tag: 'Send-off' },
];

let scheduleDay = null; // day shown while the sheet is open (not persisted)

function scheduleOverlayEl() {
  return document.getElementById('schedule-overlay');
}

function openSchedule() {
  scheduleDay = campNow().dow;
  scheduleOverlayEl().hidden = false;
  document.body.classList.add('no-scroll');
  renderSchedule();
  // Land the reader on "now" (today only — other days start at the top).
  requestAnimationFrame(() => {
    const nowCard = document.querySelector('.sched-block.now');
    if (nowCard) nowCard.scrollIntoView({ block: 'center' });
    const closeBtn = document.getElementById('schedule-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  });
}

function closeSchedule() {
  scheduleOverlayEl().hidden = true;
  document.body.classList.remove('no-scroll');
  const banner = document.getElementById('now-banner');
  if (banner && !banner.hidden) banner.focus({ preventScroll: true });
}

function renderSchedule() {
  renderScheduleDays();
  renderScheduleBody();
}

function renderScheduleDays() {
  const wrap = document.getElementById('schedule-days');
  if (!wrap) return;
  const todayDow = campNow().dow;
  wrap.innerHTML = SCHED_DAYS.map((d) => `
    <button class="sched-day-chip ${d.dow === scheduleDay ? 'active' : ''}" data-dow="${d.dow}">
      ${d.short}${d.dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}
    </button>`).join('');
  wrap.querySelectorAll('.sched-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      scheduleDay = parseInt(btn.dataset.dow, 10);
      renderSchedule();
      const body = document.getElementById('schedule-body');
      if (body) body.scrollTop = 0;
    });
  });
}

function renderScheduleBody() {
  const wrap = document.getElementById('schedule-body');
  if (!wrap) return;
  const dow = scheduleDay;
  const { dow: nowDow, minutes } = campNow();
  const isToday = dow === nowDow;
  const day = SCHED_DAYS[dow] || SCHED_DAYS[0];
  const blocks = DAY_SCHEDULE[dow] || [];

  const rows = blocks.map((raw) => {
    const b = decorateMealBlock(dow, raw);
    const status = !isToday ? '' : minutes >= raw.end ? 'past' : minutes >= raw.start ? 'now' : '';
    const meal = mealInfo(dow, raw);

    let extra = '';
    if (raw.type === 'games') {
      const session = raw.start < 720 ? 'Morning' : 'Evening';
      const games = GAMES.filter((g) => g.day === dow && g.session === session);
      if (games.length) {
        extra = `<div class="sched-games">${games.map((g) =>
          `<span class="sched-game-chip ${state.results[g.id] ? 'played' : ''}">${g.emoji} ${esc(g.name)}${state.results[g.id] ? ' ✓' : ''}</span>`).join('')}</div>`;
      }
    } else if (raw.type === 'elective') {
      const stations = (ELECTIVES[dow] || [])[raw.slot] || [];
      if (stations.length) {
        extra = `<div class="sched-stations">${stations.map(([station, kids]) =>
          `<div class="sched-station"><span class="sched-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
            <span class="sched-station-kids">${kids.map(esc).join(' · ')}</span></div>`).join('')}</div>`;
      }
    }

    return `<div class="sched-block ${status} ${meal ? 'meal' : ''}">
      <div class="sched-rail"><span class="sched-dot"></span></div>
      <div class="sched-card">
        <div class="sched-time">${raw.noTime ? '' : schedRange(raw.start, raw.end)}${status === 'now' ? '<span class="sched-now-pill">Now</span>' : ''}</div>
        <div class="sched-label"><span class="sched-emoji">${b.emoji}</span> ${esc(b.label)}</div>
        ${extra}
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <h3 class="sched-day-title">${day.full} <span class="sched-day-tag">· ${esc(day.tag)}</span></h3>
    <div class="sched-timeline">${rows || '<p class="muted">Nothing scheduled.</p>'}</div>
  `;
}

function wireSchedule() {
  const banner = document.getElementById('now-banner');
  banner.setAttribute('role', 'button');
  banner.tabIndex = 0;
  banner.setAttribute('aria-label', 'Happening now — tap for the full week schedule');
  banner.addEventListener('click', openSchedule);
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSchedule(); }
  });
  document.getElementById('schedule-close').addEventListener('click', closeSchedule);
  scheduleOverlayEl().querySelector('.schedule-backdrop').addEventListener('click', closeSchedule);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scheduleOverlayEl().hidden) closeSchedule();
  });
}

// Formats an ISO timestamp as camp time, e.g. "Jul 19, 8:47pm ET" —
// same convention as the schedule banner, so the footer always reads in
// camp time regardless of which timezone a visiting parent's phone is in.
function formatEasternStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}${(get('dayPeriod') || '').toLowerCase()} ET`;
}

function renderFooter() {
  const el = document.getElementById('app-footer');
  if (!el) return;
  const dataStamp = formatEasternStamp(state.meta && state.meta.lastDataChangeAt);
  el.innerHTML = `
    <p class="footer-line">🛠️ Code last updated: ${esc(formatEasternStamp(CODE_UPDATED_AT) || 'unknown')}</p>
    <p class="footer-line">📋 Data last updated: ${dataStamp ? esc(dataStamp) : 'No scores entered yet'}</p>
  `;
}

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
    teams: DEFAULT_TEAM_NAMES.map((name, i) => ({ id: 't' + i, name, counselor: DEFAULT_COUNSELORS[i] })),
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
if (!state.meta) state.meta = {};
if (state.theme === undefined) state.theme = null; // pre-theme saves: follow the device
normalizeSyncedState();

function counselorName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t && t.counselor ? t.counselor : '';
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!applyingRemote) schedulePush();
}

// Stamps "when real scoreboard data last changed" for the footer — a
// result saved, a bracket match recorded, or a team renamed. Deliberately
// NOT called for view-only actions (day tab, theme, PIN) so it reflects
// actual camp activity, not just page traffic.
function touchData() {
  if (!state.meta) state.meta = {};
  state.meta.lastDataChangeAt = new Date().toISOString();
}

// ── Cloud sync (Firebase Realtime Database) ──────────────────────
// Optional. If window.FIREBASE_CONFIG is filled in (firebase-config.js)
// and the SDK loaded, scores sync across every device in real time.
// Otherwise the app runs exactly as before, local-only.

const SYNC_KEYS = ['teams', 'results', 'brackets', 'drafts', 'picRounds', 'meta'];
let fbRef = null;
let applyingRemote = false;
let pushTimer = null;
// No pushes until the first server snapshot has landed. Without this, a
// device on slow camp wifi that saves anything (even a day-tab tap) before
// its first sync queues a set() of its stale local state — and the SDK
// delivers that on connect, wiping everyone's newer scores.
let remoteReady = false;

function syncEnabled() {
  return !!fbRef;
}

function initSync() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || typeof firebase === 'undefined') {
    updateSyncIndicator();
    return; // local-only mode
  }
  try {
    firebase.initializeApp(cfg);
    fbRef = firebase.database().ref('campScoreboard/state');
    fbRef.on('value', (snap) => {
      const remote = snap.val();
      remoteReady = true; // server truth received — pushes may flow now
      if (!remote) { pushState(); return; } // seed an empty database
      applyingRemote = true;
      // The snapshot is the entire synced tree, so a key missing from it
      // means "empty" — RTDB prunes empty objects on write. Treating
      // missing as keep-local made "New week (reset)" un-syncable: other
      // devices kept their old results and re-pushed them later. Teams
      // stay guarded — a snapshot without a roster is malformed.
      if (remote.teams) state.teams = remote.teams;
      ['results', 'brackets', 'drafts', 'picRounds', 'meta'].forEach((k) => {
        state[k] = remote[k] !== undefined ? remote[k] : {};
      });
      // Realtime Database silently drops empty arrays/nulls on write, so a
      // freshly-started bracket or Pictionary round can come back missing
      // its empty fields. Heal everything the instant remote data lands,
      // before any render sees it.
      normalizeSyncedState();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      applyingRemote = false;
      if (appStarted) renderAll();
    }, (err) => {
      console.warn('Firebase read failed, staying local', err);
    });
    updateSyncIndicator();
  } catch (e) {
    console.error('Firebase init failed, staying local-only', e);
    fbRef = null;
    updateSyncIndicator();
  }
}

function schedulePush() {
  if (!fbRef) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 400); // coalesce rapid edits
}

function pushState() {
  if (!fbRef || applyingRemote || !remoteReady) return;
  const payload = {};
  SYNC_KEYS.forEach((k) => { payload[k] = state[k] === undefined ? null : state[k]; });
  // JSON round-trip strips any `undefined` (which Realtime DB rejects).
  fbRef.set(JSON.parse(JSON.stringify(payload))).catch((e) => console.warn('sync push failed', e));
}

function updateSyncIndicator() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (syncEnabled()) {
    el.textContent = '☁️ Synced across devices';
    el.classList.add('synced');
  } else {
    el.textContent = '📱 This device only';
    el.classList.remove('synced');
  }
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
  if (g.prompts) html += picRoundHTML(g);
  else if (g.stopwatch) html += stopwatchHTML(g);
  wrap.innerHTML = html;
  if (g.timer) bindCountdown(wrap, g);
  if (g.prompts) bindPicRound(wrap, g);
  else if (g.stopwatch) bindStopwatch(wrap, g);
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

// ── Photo storage (IndexedDB — photos are too big for localStorage) ──

let photoDBPromise = null;

function photoDB() {
  if (!photoDBPromise) {
    photoDBPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('campScoreboardPhotos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return photoDBPromise;
}

function idbOp(mode, fn) {
  return photoDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

const putPhoto = (key, blob) => idbOp('readwrite', (s) => s.put(blob, key));
const getPhoto = (key) => idbOp('readonly', (s) => s.get(key));
const delPhoto = (key) => idbOp('readwrite', (s) => s.delete(key));
const clearPhotos = () => idbOp('readwrite', (s) => s.clear());

function picPhotoKey(teamId, idx) {
  return 'pic:' + teamId + ':' + idx;
}

function loadImage(blob) {
  if (window.createImageBitmap) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => loadImageViaTag(blob));
  }
  return loadImageViaTag(blob);
}

function loadImageViaTag(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Downscale camera shots so 60 photos don't blow up the phone's storage.
async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.85);
}

// ── Pictionary round runner ─────────────────────────────────────

function picRounds() {
  if (!state.picRounds) state.picRounds = {};
  return state.picRounds;
}

function picRound(teamId) {
  const all = picRounds();
  if (!all[teamId]) all[teamId] = { laps: [], done: false };
  return normalizePicRound(all[teamId]);
}

function picLapsSum(round) {
  return round ? round.laps.reduce((a, l) => a + l.ms, 0) : 0;
}

function picRoundHTML(g) {
  let w = liveWatches[g.id];
  if (!w) w = liveWatches[g.id] = { running: false, startAt: 0, lapsTotal: 0 };
  const teamId = state.ui.picTeam;
  const round = teamId ? picRound(teamId) : null;
  // Always derive the total from the saved laps — the in-memory copy dies
  // on reload, and a stale 0 here would fill a short total into the score.
  w.lapsTotal = picLapsSum(round);

  const chips = `<div class="pic-team-chips">${state.teams.map((t) => {
    const r = picRounds()[t.id];
    const status = r && r.done ? ' ✓' : r && r.laps.length ? ` ${r.laps.length}/10` : '';
    return `<button class="team-chip pic-team-chip ${teamId === t.id ? 'selected' : ''}" data-team-id="${t.id}" ${w.running ? 'disabled' : ''}>${esc(t.name)}${status}<span class="chip-sub">${esc(counselorName(t.id))}</span></button>`;
  }).join('')}</div>`;

  let panel = '';
  if (round) {
    const n = round.laps.length;
    if (!round.done) {
      const prompt = g.prompts[n];
      panel = `
        <div class="pic-prompt-card">
          <div class="pic-prompt-label">Item ${n + 1} of ${g.prompts.length}</div>
          <div class="pic-prompt-word">${esc(prompt)}</div>
        </div>
        <div class="big-clock" id="sw-display-${g.id}">${fmtWatch(w.running ? Date.now() - w.startAt : 0)}</div>
        <div class="sw-total-line">Team total: <strong id="sw-total-${g.id}">${fmtWatch(w.lapsTotal + (w.running ? Date.now() - w.startAt : 0))}</strong></div>
        <div class="timer-btn-row">
          ${w.running
            ? `<button class="timer-main-btn stop-lap-btn" data-action="stop-lap">⏹ Guessed it! Stop clock</button>`
            : `<button class="timer-main-btn" data-action="start-lap">▶ Nose down — start</button>`}
        </div>`;
    } else {
      const photoCount = round.laps.filter((l) => l.photo).length;
      panel = `
        <div class="pic-done-banner">🎉 Round complete — total <strong>${fmtWatch(round.laps.reduce((a, l) => a + l.ms, 0))}</strong>. Score filled in below.</div>
        <div class="timer-btn-row">
          <button class="timer-main-btn" data-action="export-photos">⬇ Export ${photoCount} captioned photo${photoCount === 1 ? '' : 's'}</button>
        </div>
        <p class="muted pic-export-hint" id="pic-export-status">Each photo gets a harvest banner with the team, the prompt, and their time.</p>`;
    }

    if (round.laps.length) {
      panel += `<div class="pic-items">${round.laps.map((lap, i) => `
        <div class="pic-item-row">
          <span class="pic-item-text">${i + 1}. ${esc(g.prompts[i])} — ${fmtWatch(lap.ms)}</span>
          <button class="pic-photo-btn ${lap.photo ? 'has-photo' : ''}" data-action="photo" data-lap="${i}">${lap.photo ? '📷 Retake' : '📷 Add photo'}</button>
        </div>`).join('')}</div>
        <div class="sw-actions">
          ${!round.done ? `<button class="link-btn" data-action="undo-lap">Undo last item</button>` : ''}
          <button class="link-btn danger-link" data-action="reset-round">Reset this team's round</button>
        </div>`;
    }
  } else {
    panel = `<p class="muted">Pick a team to run their 10 drawings.</p>`;
  }

  return `<div class="tool-box" data-tool="pic-round">
    <div class="tool-label">🎨 Drawing round</div>
    ${chips}
    ${panel}
  </div>
  <input type="file" id="pic-photo-input" accept="image/*" capture="environment" hidden>`;
}

function bindPicRound(wrap, g) {
  const box = wrap.querySelector('[data-tool="pic-round"]');
  if (!box) return;
  const w = liveWatches[g.id];
  const photoInput = wrap.querySelector('#pic-photo-input');

  box.querySelectorAll('.pic-team-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (w.running) return;
      state.ui.picTeam = chip.dataset.teamId;
      const r = picRound(chip.dataset.teamId);
      w.lapsTotal = r.laps.reduce((a, l) => a + l.ms, 0);
      saveState();
      renderTools(wrap, g);
    });
  });

  box.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      const teamId = state.ui.picTeam;
      const round = teamId ? picRound(teamId) : null;

      if (a === 'start-lap') {
        getAudio();
        w.startAt = Date.now();
        w.running = true;
        ensureTicking();
      } else if (a === 'stop-lap') {
        const ms = Date.now() - w.startAt;
        w.running = false;
        round.laps.push({ ms, photo: false });
        w.lapsTotal = picLapsSum(round);
        touchData();
        if (round.laps.length >= g.prompts.length) {
          round.done = true;
          const draft = state.drafts[g.id] || (state.drafts[g.id] = { scores: {}, medals: {} });
          const prevLeader = leaderOf(g, draft);
          // Total comes straight from the saved laps, floored to the same
          // decisecond the display shows, so the filled score matches it.
          const totalDs = Math.floor(picLapsSum(round) / 100);
          const m = Math.floor(totalDs / 600);
          const s = (totalDs - m * 600) / 10;
          draft.scores[teamId] = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
          draft.medals = {};
          saveState();
          checkHighScore(g, draft, teamId, prevLeader);
          renderAll();
          return;
        }
        saveState();
      } else if (a === 'undo-lap') {
        const last = round.laps.pop();
        if (last) {
          delPhoto(picPhotoKey(teamId, round.laps.length)).catch(() => {});
        }
        round.done = false;
        w.lapsTotal = picLapsSum(round);
        saveState();
      } else if (a === 'reset-round') {
        if (!confirm("Reset this team's round? All their times and photos for this game are cleared.")) return;
        round.laps.forEach((_, i) => delPhoto(picPhotoKey(teamId, i)).catch(() => {}));
        round.laps = [];
        round.done = false;
        w.lapsTotal = 0;
        w.running = false;
        saveState();
      } else if (a === 'photo') {
        photoInput.dataset.teamId = teamId;
        photoInput.dataset.lap = btn.dataset.lap;
        photoInput.click();
        return;
      } else if (a === 'export-photos') {
        exportTeamPhotos(g, teamId, btn);
        return;
      }
      renderTools(wrap, g);
    });
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    const teamId = photoInput.dataset.teamId;
    const lapIdx = parseInt(photoInput.dataset.lap, 10);
    try {
      const blob = await shrinkPhoto(file);
      await putPhoto(picPhotoKey(teamId, lapIdx), blob);
      picRound(teamId).laps[lapIdx].photo = true;
      saveState();
      renderTools(wrap, g);
    } catch (e) {
      alert('Could not save that photo — try again.');
      console.error(e);
    }
  });
}

// ── Captioned photo export ──

function drawBannerLeaf(x, cx, cy, size, rot, color) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(0, -size / 2);
  x.quadraticCurveTo(size * 0.45, -size * 0.1, 0, size / 2);
  x.quadraticCurveTo(-size * 0.45, -size * 0.1, 0, -size / 2);
  x.fill();
  x.strokeStyle = 'rgba(252, 245, 228, 0.65)';
  x.lineWidth = Math.max(1, size * 0.05);
  x.beginPath();
  x.moveTo(0, -size * 0.36);
  x.lineTo(0, size * 0.36);
  x.stroke();
  x.restore();
}

function fitFont(x, text, weightStyle, px, maxWidth, family) {
  let size = px;
  do {
    x.font = `${weightStyle} ${Math.round(size)}px ${family}`;
    if (x.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  } while (size > 10);
  return size;
}

async function composeCaptioned(photoBlob, teamStr, promptStr, ms) {
  const img = await loadImage(photoBlob);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const bannerH = Math.max(130, Math.round(w * 0.17));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + bannerH;
  const x = c.getContext('2d');
  const serif = `Georgia, 'Times New Roman', serif`;

  // Parchment banner
  const grad = x.createLinearGradient(0, 0, 0, bannerH);
  grad.addColorStop(0, '#f9f0da');
  grad.addColorStop(1, '#eeddb8');
  x.fillStyle = grad;
  x.fillRect(0, 0, w, bannerH);

  // Double rule above the photo
  x.strokeStyle = '#b3591c';
  x.lineWidth = Math.max(3, w * 0.005);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - x.lineWidth * 3);
  x.lineTo(w * 0.97, bannerH - x.lineWidth * 3);
  x.stroke();
  x.strokeStyle = '#6d3a10';
  x.lineWidth = Math.max(1.5, w * 0.002);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - w * 0.013);
  x.lineTo(w * 0.97, bannerH - w * 0.013);
  x.stroke();

  // Corner leaves
  drawBannerLeaf(x, w * 0.065, bannerH * 0.42, bannerH * 0.34, -0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.045, bannerH * 0.6, bannerH * 0.24, 0.5, '#8a5a12');
  drawBannerLeaf(x, w * 0.935, bannerH * 0.42, bannerH * 0.34, 0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.955, bannerH * 0.6, bannerH * 0.24, -0.5, '#8a5a12');

  // Text
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const maxText = w * 0.72;

  x.fillStyle = '#4a2c10';
  fitFont(x, teamStr, '700', bannerH * 0.3, maxText, serif);
  x.fillText(teamStr, w / 2, bannerH * 0.33);

  const sub = `drew “${promptStr}” in ${fmtWatch(ms)}`;
  x.fillStyle = '#9c4f0f';
  fitFont(x, sub, 'italic 400', bannerH * 0.18, maxText, serif);
  x.fillText(sub, w / 2, bannerH * 0.64);

  x.drawImage(img, 0, bannerH);
  return canvasToJpeg(c, 0.9);
}

function safeFileName(str) {
  return str.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportTeamPhotos(g, teamId, btn) {
  const round = picRound(teamId);
  const team = teamName(teamId);
  const status = document.getElementById('pic-export-status');
  const say = (msg) => { if (status) status.textContent = msg; };

  btn.disabled = true;
  try {
    const files = [];
    for (let i = 0; i < round.laps.length; i++) {
      if (!round.laps[i].photo) continue;
      say(`Building photo ${files.length + 1}…`);
      const blob = await getPhoto(picPhotoKey(teamId, i));
      if (!blob) continue;
      const out = await composeCaptioned(blob, team, g.prompts[i], round.laps[i].ms);
      files.push(new File([out], `${safeFileName(team)}-${safeFileName(g.prompts[i])}.jpg`, { type: 'image/jpeg' }));
    }
    if (!files.length) {
      say('No photos taken for this team yet — use the Add photo buttons first.');
      return;
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      say(`Sharing ${files.length} photos…`);
      await navigator.share({ files, title: team + ' — Pumpkin Pictionary' }).catch(() => {});
      say(`Shared ${files.length} captioned photos.`);
    } else {
      say(`Downloading ${files.length} photos…`);
      files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 500));
      say(`Downloaded ${files.length} captioned photos.`);
    }
  } catch (e) {
    console.error(e);
    say('Export hit a snag — try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Copy / share helpers ─────────────────────────────────────────

function copyTextToClipboard(text, btn) {
  const done = () => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
  ta.remove();
  done();
}

function matchupText(g, stage, aId, bId) {
  const withC = (id) => counselorName(id) ? `${teamName(id)} (${counselorName(id)})` : teamName(id);
  return `${g.name} ${stage}: ${withC(aId)} vs ${withC(bId)} — head to ${g.location}!`;
}

function matchupCalloutHTML(aId, bId) {
  const counselors = [counselorName(aId), counselorName(bId)].filter(Boolean);
  return `<div class="matchup-callout">
    <p class="call-next-label">Call up next:</p>
    <p class="call-next-teams">${esc(teamName(aId))} <span class="vs">vs</span> ${esc(teamName(bId))}</p>
    ${counselors.length === 2 ? `<p class="call-next-counselors">Counselors: ${esc(counselors[0])} &amp; ${esc(counselors[1])}</p>` : ''}
    <div class="winner-btn-row">
      <button class="secondary-btn winner-btn" data-winner="${aId}">${esc(teamName(aId))} won</button>
      <button class="secondary-btn winner-btn" data-winner="${bId}">${esc(teamName(bId))} won</button>
    </div>
    <button class="copy-matchup-btn">📋 Copy matchup for text</button>
  </div>`;
}

function bindMatchupCopy(body, g, stage, aId, bId) {
  const btn = body.querySelector('.copy-matchup-btn');
  if (btn) btn.addEventListener('click', () => copyTextToClipboard(matchupText(g, stage, aId, bId), btn));
}

function standingsSummaryText() {
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);

  const lines = ['🏅 Camp Scoreboard — ' + new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })];
  lines.push('');
  lines.push(`Standings (🥇 ${MEDAL_POINTS.gold} · 🥈 ${MEDAL_POINTS.silver} · 🥉 ${MEDAL_POINTS.bronze} pts):`);
  ranked.forEach((t, i) => {
    const s = counts[t.id];
    lines.push(`${i + 1}) ${t.name} · ${s.points} pts (🥇${s.gold} 🥈${s.silver} 🥉${s.bronze})`);
  });

  const played = GAMES.filter((g) => state.results[g.id]);
  if (played.length) {
    lines.push('');
    lines.push('Medals so far:');
    played.forEach((g) => {
      const m = state.results[g.id].medals;
      lines.push(`• ${g.name} — 🥇 ${teamName(m.gold)}, 🥈 ${teamName(m.silver)}, 🥉 ${teamName(m.bronze)}`);
    });
  } else {
    lines.push('');
    lines.push('No games saved yet.');
  }
  return lines.join('\n');
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
  state.teams.forEach((t) => (counts[t.id] = { gold: 0, silver: 0, bronze: 0, points: 0 }));
  Object.values(state.results).forEach((r) => {
    if (!r || !r.medals) return;
    if (counts[r.medals.gold]) counts[r.medals.gold].gold += 1;
    if (counts[r.medals.silver]) counts[r.medals.silver].silver += 1;
    if (counts[r.medals.bronze]) counts[r.medals.bronze].bronze += 1;
  });
  Object.values(counts).forEach((c) => {
    c.points = c.gold * MEDAL_POINTS.gold + c.silver * MEDAL_POINTS.silver + c.bronze * MEDAL_POINTS.bronze;
  });
  return counts;
}

// Rank by total points; break point ties by finish quality (golds,
// then silvers, then bronzes).
function rankTeamsByPoints(counts) {
  return [...state.teams].sort((a, b) => {
    const sa = counts[a.id], sb = counts[b.id];
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.gold !== sa.gold) return sb.gold - sa.gold;
    if (sb.silver !== sa.silver) return sb.silver - sa.silver;
    return sb.bronze - sa.bronze;
  });
}

function renderStandings() {
  const tbody = document.getElementById('standings-tbody');
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);

  tbody.innerHTML = '';
  ranked.forEach((team, i) => {
    const s = counts[team.id];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank-col">${i + 1}</td>
      <td>
        <input type="text" class="team-name-input" data-team-id="${team.id}" value="${esc(team.name)}" ${canEdit() ? '' : 'disabled'} />
        <input type="text" class="team-counselor-input" data-team-id="${team.id}" value="${esc(team.counselor || '')}" placeholder="Counselor" ${canEdit() ? '' : 'disabled'} />
      </td>
      <td class="points-col">${s.points}</td>
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
      if (team && val) { team.name = val; touchData(); }
      saveState();
      renderAll();
    });
  });

  tbody.querySelectorAll('.team-counselor-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const team = state.teams.find((t) => t.id === e.target.dataset.teamId);
      if (team) team.counselor = e.target.value.trim();
      touchData();
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

  // Pictionary keeps its tools visible after the result is saved so
  // photos can still be exported; other tools hide once the game is done.
  // Viewers don't get the score-entry tools at all.
  if (canEdit() && (g.timer || g.stopwatch || g.prompts) && (g.prompts || !state.results[g.id])) {
    renderTools(document.getElementById('tools-area'), g);
  }

  const entry = document.getElementById('entry-area');
  const result = state.results[g.id];
  if (result) {
    renderResult(entry, g, result);
  } else if (!canEdit()) {
    entry.innerHTML = `<p class="view-only-note">👀 View-only. This game hasn't been scored yet. Tap <strong>🔒 View only</strong> at the top and enter the score PIN to run it.</p>`;
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
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(result.medals.gold))}</strong> <span class="medal-points">+${MEDAL_POINTS.gold} pts</span></div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(result.medals.silver))}</strong> <span class="medal-points">+${MEDAL_POINTS.silver} pts</span></div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(result.medals.bronze))}</strong> <span class="medal-points">+${MEDAL_POINTS.bronze} pts</span></div>
    </div>
    ${extra}
    ${canEdit() ? '<button id="clear-result-btn" class="link-btn danger-link">Clear result &amp; re-enter</button>' : ''}
  `;
  if (!canEdit()) return;
  document.getElementById('clear-result-btn').addEventListener('click', () => {
    if (!confirm('Clear the saved result for ' + g.name + '? Its points come off the week standings.')) return;
    delete state.results[g.id];
    touchData();
    saveState();
    renderAll();
  });
}

// ── Medal picker (shared by tally + placement) ───────────────────

function medalPickerHTML(picks) {
  const slots = [
    { key: 'gold', label: `🥇 Gold · ${MEDAL_POINTS.gold} pts` },
    { key: 'silver', label: `🥈 Silver · ${MEDAL_POINTS.silver} pts` },
    { key: 'bronze', label: `🥉 Bronze · ${MEDAL_POINTS.bronze} pts` },
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
  const draft = normalizeDraft(state.drafts[g.id]);
  const steps = g.counterSteps;

  container.innerHTML = `
    <h3>Enter team scores <span class="unit-tag">(${esc(g.unit || 'points')}${g.lowerWins ? ' — lowest wins' : ''})</span></h3>
    <div class="score-input-grid">
      ${state.teams.map((t) => `
        <div class="score-input-row ${steps ? 'with-counter' : ''}">
          <div class="score-row-top">
            <span class="score-team">${esc(t.name)}<span class="chip-sub">${esc(t.counselor || '')}</span></span>
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
    touchData();
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
  const draft = normalizeDraft(state.drafts[g.id]);

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
    touchData();
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

// Realtime Database can't represent "present but empty" for arrays/nulls —
// it prunes those keys on write, so a bracket round-tripped through sync
// can come back missing matches/selectedPair/etc. This restores a safe,
// well-formed shape in place, whatever the source (sync, storage, or a
// bug) actually handed us.
function normalizeBracket(b) {
  if (!Array.isArray(b.pool)) b.pool = [];
  if (!Array.isArray(b.selectedPair)) b.selectedPair = [];
  if (!Array.isArray(b.matches)) b.matches = [];
  if (!b.phase) b.phase = 'round1';
  if (b.byeTeamId === undefined) b.byeTeamId = null;
  if (b.semifinal === undefined) b.semifinal = null;
  if (b.championship === undefined) b.championship = null;
  return b;
}

// Same guarantee for a Pictionary drawing round: a fresh round is
// { laps: [], done: false }, and RTDB prunes the empty laps array.
function normalizePicRound(r) {
  if (!Array.isArray(r.laps)) r.laps = [];
  r.done = !!r.done;
  return r;
}

// And for a score-entry draft: { scores: {}, medals: {} } — either side
// can be empty (and thus pruned) while the other has data.
function normalizeDraft(d) {
  if (!d.scores) d.scores = {};
  if (!d.medals) d.medals = {};
  return d;
}

// One sweep over every synced shape that can carry pruned-empty fields.
// Called after loading from localStorage and after every remote merge.
function normalizeSyncedState() {
  Object.values(state.brackets || {}).forEach(normalizeBracket);
  Object.values(state.picRounds || {}).forEach(normalizePicRound);
  Object.values(state.drafts || {}).forEach(normalizeDraft);
  // Migrate rosters saved before names/counselors were set: swap generic
  // "Team N" names and placeholder counselors for the real roster values.
  // Anything hand-edited (not matching a known placeholder) is left alone.
  (state.teams || []).forEach((t, i) => {
    if (t.name === OLD_PLACEHOLDER_TEAM_NAMES[i] && DEFAULT_TEAM_NAMES[i]) {
      t.name = DEFAULT_TEAM_NAMES[i];
    }
    if (t.counselor === undefined || t.counselor === OLD_PLACEHOLDER_COUNSELORS[i]) {
      t.counselor = DEFAULT_COUNSELORS[i] || '';
    }
  });
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

  const b = normalizeBracket(state.brackets[g.id]);
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
      ${b.pool.map((id) => `<button class="team-chip ${b.selectedPair.includes(id) ? 'selected' : ''}" data-team-id="${id}">${esc(teamName(id))}<span class="chip-sub">${esc(counselorName(id))}</span></button>`).join('')}
    </div>`;

  if (b.selectedPair.length === 2) {
    html += matchupCalloutHTML(b.selectedPair[0], b.selectedPair[1]);
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches">
      <p class="muted">Completed:</p>
      <ul>${b.matches.map((m) => `<li>${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('')}</ul>
      <button id="undo-match-btn" class="link-btn">Undo last match</button>
    </div>`;
  }

  body.innerHTML = html;

  if (b.selectedPair.length === 2) {
    bindMatchupCopy(body, g, `Round 1 (match ${b.matches.length + 1})`, b.selectedPair[0], b.selectedPair[1]);
  }

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
      touchData();
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
      ${winners.map((id) => `<button class="team-chip tiebreak-chip" data-team-id="${id}">${esc(teamName(id))}<span class="chip-sub">${esc(counselorName(id))}</span></button>`).join('')}
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
      touchData();
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
    ${matchupCalloutHTML(b.semifinal.a, b.semifinal.b)}
  `;

  bindMatchupCopy(body, g, 'SEMIFINAL', b.semifinal.a, b.semifinal.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.semifinal.a ? b.semifinal.b : b.semifinal.a;
      b.semifinal.winner = winner;
      b.semifinal.loser = loser;
      b.championship = { a: b.byeTeamId, b: winner, winner: null, loser: null };
      b.phase = 'championship';
      touchData();
      saveState();
      renderAll();
    });
  });
}

function renderBracketChampionship(body, g, b) {
  body.innerHTML = `
    <h3>Championship</h3>
    <p class="bronze-note">🥉 <strong>${esc(teamName(b.semifinal.loser))}</strong> takes the bronze medal (+${MEDAL_POINTS.bronze} pts).</p>
    ${matchupCalloutHTML(b.championship.a, b.championship.b)}
  `;

  bindMatchupCopy(body, g, 'CHAMPIONSHIP', b.championship.a, b.championship.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.championship.a ? b.championship.b : b.championship.a;
      b.championship.winner = winner;
      b.championship.loser = loser;
      b.phase = 'summary';
      touchData();
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
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(goldId))}</strong> <span class="medal-points">+${MEDAL_POINTS.gold} pts</span></div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(silverId))}</strong> <span class="medal-points">+${MEDAL_POINTS.silver} pts</span></div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(bronzeId))}</strong> <span class="medal-points">+${MEDAL_POINTS.bronze} pts</span></div>
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
    touchData();
    saveState();
    renderAll();
  });
}

// ── Reset week ───────────────────────────────────────────────────

function resetWeek() {
  if (!confirm('Start a new week? This clears every saved game result and all Pictionary photos (team names are kept).')) return;
  state.results = {};
  state.brackets = {};
  state.drafts = {};
  state.picRounds = {};
  state.ui.gameId = null;
  state.ui.picTeam = null;
  clearPhotos().catch(() => {});
  touchData();
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
  renderNowBanner();
  renderDayTabs();
  renderGameList();
  renderGameView();
  renderStandings();
  renderFooter();
}

function init() {
  applyTheme();
  applySoundIcon();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sound-toggle').addEventListener('click', toggleSound);
  document.getElementById('reset-week-btn').addEventListener('click', resetWeek);

  const copyBtn = document.getElementById('copy-standings-btn');
  copyBtn.addEventListener('click', () => copyTextToClipboard(standingsSummaryText(), copyBtn));
  const shareBtn = document.getElementById('share-standings-btn');
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => {
      navigator.share({ text: standingsSummaryText() }).catch(() => {});
    });
  }

  document.getElementById('role-btn').addEventListener('click', showLockScreen);
  updateRoleButton();

  wireSchedule();

  initSync();

  renderAll();

  // Keep the "happening now" banner current without any taps.
  setInterval(renderNowBanner, 30 * 1000);
}

function updateRoleButton() {
  const btn = document.getElementById('role-btn');
  if (!btn) return;
  if (canEdit()) {
    btn.textContent = '✏️ Editing';
    btn.title = 'You can enter scores. Tap to lock or switch to view-only.';
  } else {
    btn.textContent = '🔒 View only';
    btn.title = 'View-only. Tap and enter the score PIN to edit.';
  }
}

// ── PIN lock gate ────────────────────────────────────────────────

let pinEntry = '';
let appStarted = false;

function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
}

function applyRoleClass() {
  document.documentElement.classList.toggle('view-only', !canEdit());
}

function startApp() {
  document.documentElement.classList.remove('locked');
  applyRoleClass();
  if (!appStarted) {
    appStarted = true;
    init();
  } else {
    updateRoleButton();
    renderAll();
  }
}

function renderPinDots() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((d, i) => d.classList.toggle('filled', i < pinEntry.length));
}

function handlePinKey(key) {
  const errEl = document.getElementById('lock-error');
  errEl.hidden = true;
  if (key === 'del') {
    pinEntry = pinEntry.slice(0, -1);
    renderPinDots();
    return;
  }
  if (pinEntry.length >= 4) return;
  pinEntry += key;
  renderPinDots();

  if (pinEntry.length === 4) {
    if (pinEntry === VIEW_PIN || pinEntry === EDIT_PIN) {
      const role = pinEntry === EDIT_PIN ? 'edit' : 'view';
      try {
        localStorage.setItem(UNLOCK_KEY, '1');
        localStorage.setItem(ROLE_KEY, role);
      } catch (e) { /* fine, just won't remember */ }
      pinEntry = '';
      setTimeout(startApp, 150);
    } else {
      const box = document.querySelector('.lock-box');
      box.classList.add('shake');
      errEl.hidden = false;
      setTimeout(() => {
        pinEntry = '';
        renderPinDots();
        box.classList.remove('shake');
      }, 500);
    }
  }
}

let lockWired = false;

function wireLockKeypad() {
  if (lockWired) return;
  lockWired = true;
  document.getElementById('keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (btn && btn.dataset.key) handlePinKey(btn.dataset.key);
  });
  document.addEventListener('keydown', (e) => {
    if (!document.documentElement.classList.contains('locked')) return;
    if (e.key >= '0' && e.key <= '9') handlePinKey(e.key);
    else if (e.key === 'Backspace') handlePinKey('del');
  });
}

function showLockScreen() {
  pinEntry = '';
  renderPinDots();
  document.getElementById('lock-error').hidden = true;
  document.documentElement.classList.add('locked');
}

function boot() {
  wireLockKeypad();
  if (isUnlocked()) {
    startApp();
  } else {
    showLockScreen();
  }
}

document.addEventListener('DOMContentLoaded', boot);
