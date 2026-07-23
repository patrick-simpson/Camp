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
const CODE_UPDATED_AT = '2026-07-23T11:34:18Z';
// Shown in the footer; bump together with the ?v= cache-busters in index.html.
const APP_VERSION = 112;

// "What's new" banners. Each entry advertises a user-visible change at the top
// of the page for TWO HOURS after its `at` time, then auto-expires. Every time
// you ship something worth telling people about, add an entry here (newest
// first) — same manual discipline as bumping CODE_UPDATED_AT and the ?v=
// cache-bust. `at` is UTC ISO (`date -u +%Y-%m-%dT%H:%M:%SZ`); `id` is a stable
// slug so a viewer's dismissal sticks; `text` is the short announcement.
// Multiple recent changes stack as separate banners, each expiring on its own
// two-hour clock. Old entries can be pruned once they're well past two hours.
// "What's new" banners are discontinued — leave this list EMPTY and do not add
// entries going forward (owner's call, 2026-07-21). With it empty, activeChanges()
// returns nothing and no banner ever renders. The queue machinery below is left
// dormant but harmless.
const CHANGES = [];

// Light PIN gate — keeps casual visitors out of a public page. Not real
// security (the code is viewable), just a "you need the number" door.
// Two tiers: the view PIN can look but not touch; the edit PIN can enter
// scores. The PINs are NEVER stored here as plaintext — only salted SHA-256
// hashes, so reading the page source never reveals the codes. (This is a
// static site with no server, so the check runs in the browser; a 4-digit
// code can still be brute-forced from a hash by someone determined. The hash
// defeats casual view-source snooping and rainbow-table lookups — it is not a
// guarantee against a motivated attacker.) To change a PIN, hash
// PIN_SALT + newpin with SHA-256 and paste the hex below.
const PIN_SALT = 'camp-scoreboard::pin::v1::';
const VIEW_PIN_HASH = 'a67ed87a9e977e4d169ef173bc360a0f9c3484b644b506c7265877e92afd30ea';
const EDIT_PIN_HASH = '387feebde8ade150608242b3d3e75d023a23f5342c71578c438e5bde3952b178';
const UNLOCK_KEY = 'campScoreboardUnlocked';
const ROLE_KEY = 'campScoreboardRole';
// Bump EDIT_PIN_EPOCH to force every editor to re-enter the current edit PIN
// on their next load — used to kick out sessions unlocked with a retired PIN.
// The same two literals live in index.html's pre-paint guard; keep them in sync.
const EDIT_PIN_EPOCH_KEY = 'campScoreboardEditEpoch';
const EDIT_PIN_EPOCH = 'r1'; // opaque marker — deliberately NOT the PIN, so no code leaks into source

function currentRole() {
  try { return localStorage.getItem(ROLE_KEY) || 'view'; } catch (e) { return 'view'; }
}

function canEdit() {
  return currentRole() === 'edit';
}

// Team names from the printed roster, paired to their counselor group
// by position (t0..t5). The names are fixed for the week, so the
// standings show them as static text (with the emoji below) rather than
// editable fields.
const DEFAULT_TEAM_NAMES = [
  'Ferocious Foxes',                // Alyssa, Cam, Sam
  'Turkey Dinner',                  // Bria, Lydia, Zac
  'Methodic Mediocre Maples',       // Jovi, Brody, Josh
  'Particularly Perilous Pumpkins', // Sofie, William
  'Patriotic Pilgrims',             // Abby, TJ, Ella
  'Runaway John Deersz',            // Lily, Jacob (deliberate spelling)
];
// One emoji mascot per team slot (by id, which is stable at t0..t5), so a
// long name can be represented compactly wherever space is tight.
const TEAM_EMOJI = {
  t0: '🦊', // Ferocious Foxes
  t1: '🦃', // Turkey Dinner
  t2: '🍁', // Methodic Mediocre Maples
  t3: '🎃', // Particularly Perilous Pumpkins
  t4: '🦅', // Patriotic Pilgrims
  t5: '🚜', // Runaway John Deersz
};
// Camper-drawn team shield artwork (cropped, transparent WebP crests under
// images/team-shields/), keyed by team slot id. Shown as a hero crest on the
// "Your team" card once a viewer picks a team. Missing here === no crest,
// just the emoji (see images/team-shields/README.md for provenance notes).
// The ?v= suffix cache-busts the image itself (bump it when a crest file is
// re-exported, since the <img> URL is otherwise cached indefinitely).
const TEAM_SHIELD = {
  t0: 'images/team-shields/ferocious-foxes.webp?v=5',
  t1: 'images/team-shields/turkey-dinner.webp?v=5',
  t2: 'images/team-shields/methodic-mediocre-maples.webp?v=5',
  t3: 'images/team-shields/particularly-perilous-pumpkins.webp?v=5',
  t4: 'images/team-shields/patriotic-pilgrims.webp?v=5',
  t5: 'images/team-shields/runaway-john-deeres.webp?v=5',
};
// Per-team accent color, tuned to each team's shield/emoji. Drives the "Your
// team" card's tint, border, and rank pill via the --team-accent CSS custom
// property (see renderFollowCard / .follow-team-card). Only one team's card
// shows at a time, so these never sit side by side.
const TEAM_ACCENT = {
  t0: '#e2672b', // Ferocious Foxes — fox orange
  t1: '#9c6420', // Turkey Dinner — roast brown
  t2: '#c23b22', // Methodic Mediocre Maples — maple red
  t3: '#e07d10', // Particularly Perilous Pumpkins — pumpkin orange
  t4: '#345b96', // Patriotic Pilgrims — pilgrim navy
  t5: '#3a7d34', // Runaway John Deersz — Deere green
};
function teamAccent(id) { return TEAM_ACCENT[id] || null; }
// Short-form team names for tight spaces (e.g. the morning meeting banner) —
// same slots as TEAM_EMOJI, independent of whatever a team gets renamed to.
const TEAM_ABBREV = {
  t0: 'Foxes',
  t1: 'Turkey',
  t2: 'Maples',
  t3: 'Pumpkins',
  t4: 'Pilgrims',
  t5: 'John Deersz',
};
// Game-leader team groups (see DEFAULT_COUNSELORS' (A)/(B) tags below):
// Stephen runs the A teams, Patrick runs the B teams.
const TEAM_GROUP_A = ['t1', 't2', 't5'];
const TEAM_GROUP_B = ['t0', 't3', 't4'];
// Older auto-assigned names to migrate off, per team index — the generic
// "Team N" seeds plus any earlier name we've since corrected (e.g. the
// "Portidatory" misread), so devices already carrying one update to the
// name above. Hand-edited names (not in these lists) are left untouched.
const OLD_PLACEHOLDER_TEAM_NAMES = [
  ['Team 1'],
  ['Team 2'],
  ['Team 3'],
  ['Team 4', 'Portidatory Perilous Pumpkins'],
  ['Team 5'],
  ['Team 6', "Runaway John Deere's"],
];
// Counselor groups per team, from the printed camp sheet. The (A)/(B)
// tag is the game-leader assignment: Stephen runs the A teams,
// Patrick runs the B teams. Editable per-team in the standings table.
const DEFAULT_COUNSELORS = [
  'Alysa/Cam/Sam (B)',
  'Bria/Lydia/Zac (A)',
  'Jovi/Brody/Josh (A)',
  'Sofie/William (B)',
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
// The week's games and days now live in editable, synced state
// (state.config) — built out by editors in Settings → Set up the week.
// The built-in defaults are in defaults.js (defaultConfig()); the
// builder UI is in settings.js. DAY_NAMES above stays: the memory-verse,
// meal-cleanup, and daily-schedule features are keyed by real day of
// week, independent of the editable competition days.

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
// Rising bell & shower now shares its 7:30–8:00 slot with the morning meeting,
// so it's folded into morningMeetingBlock rather than living here.
function weekdayDaytime() {
  return [
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
    { start: hm(22, 0), end: hm(24, 0), label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true },
  ];
}

// e.g. ['t1','t2','t5'] -> "🦃 Turkey, 🍁 Maples & 🚜 John Deeres"
function joinTeamAbbrevs(ids) {
  const items = ids.map((id) => TEAM_EMOJI[id] + ' ' + TEAM_ABBREV[id]);
  if (items.length < 2) return items.join('');
  return items.slice(0, -1).join(', ') + ' & ' + items[items.length - 1];
}

// The 7:30–8:00 start to every camp day: rising bell, shower, and the morning
// meeting at Laura's cottage (that day's team group — A: Mon/Wed/Fri, B:
// Tue/Thu/Sat) all happen together in this one block.
function morningMeetingBlock(dow) {
  const isATeamDay = dow === 1 || dow === 3 || dow === 5;
  const group = isATeamDay ? TEAM_GROUP_A : TEAM_GROUP_B;
  return {
    start: hm(7, 30), end: hm(8, 0),
    label: "Rising bell, shower & morning meeting (Laura's cottage) — " + joinTeamAbbrevs(group),
    emoji: '⏰', type: 'activity',
  };
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
    { start: hm(22, 0), end: hm(24, 0), label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true },
  ],
  1: [morningMeetingBlock(1)].concat(weekdayDaytime()).concat(weekdayEvening('TJ')),
  2: (function () {
    // Tonight only: Boys cabin movie night (9:15–10pm), slotted in just before
    // the normal wind-down. It intentionally overlaps "Prepare for bed" and
    // "Cabin devotional" — added on request, overlap and all. Placing it ahead
    // of those two in the array lets it win the "Happening Now" banner for the
    // whole 9:15–10 window while both still appear in the full schedule sheet.
    const evening = weekdayEvening('Cam');
    const idx = evening.findIndex((b) => b.start === hm(21, 15));
    const movie = { start: hm(21, 15), end: hm(22, 0), label: 'Boys cabin movie night', emoji: '🎬', type: 'activity' };
    evening.splice(idx === -1 ? evening.length : idx, 0, movie);
    return [morningMeetingBlock(2)].concat(weekdayDaytime()).concat(evening);
  })(),
  3: [morningMeetingBlock(3)].concat(weekdayDaytime()).concat(weekdayEvening('Sofie')),
  4: [morningMeetingBlock(4)].concat(weekdayDaytime()).concat(weekdayEvening('Jovi')),
  5: [morningMeetingBlock(5)].concat(weekdayDaytime()).concat([ // Friday evening — Team Skits night, later lights out
    { start: hm(17, 30), end: hm(18, 0), label: 'Team huddle', emoji: '📣', type: 'activity' },
    { start: hm(18, 0), end: hm(19, 0), label: 'Final preparations for skits', emoji: '🎭', type: 'activity' },
    { start: hm(19, 0), end: hm(20, 0), label: 'Team Skits', emoji: '🎭', type: 'activity' },
    { start: hm(20, 0), end: hm(21, 0), label: 'Evening service', emoji: '⛪', type: 'activity' },
    { start: hm(21, 0), end: hm(22, 0), label: 'Snack and campfire — Ella', emoji: '🔥', type: 'activity' },
    { start: hm(22, 0), end: hm(22, 15), label: 'Prepare for bed', emoji: '🪥', type: 'activity' },
    { start: hm(22, 15), end: hm(22, 30), label: 'Cabin devotional', emoji: '🙏', type: 'activity' },
    { start: hm(22, 30), end: hm(24, 0), label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true },
  ]),
  6: [ // Saturday — send-off morning
    morningMeetingBlock(6), // rising bell + shower folded into this 7:30 block
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
  'Slime with Kimberly': '🧪',
};

const ELECTIVES = {
  1: [
    [['Swimming', ['Bria', 'Abby']], ['Nerf War', ['Zac', 'Cam']], ['Crafts with Eileen', ['William', 'Jovi']], ['Lawn Games', ['TJ', 'Patrick', 'Sam']], ['Board Games', ['Brody', 'Lydia']]],
    [['Swimming', ['Alysa', 'Brody']], ['Crafts with Eileen', ['Bria', 'Lilly']], ['Whiffle Ball', ['TJ', 'Cam']], ['Board Games', ['Jovi', 'Josh', 'Patrick']], ['Slime with Joann', ['Sofie', 'Abby']], ['Laser Tag', ['Zac', 'William']]],
    [['Swimming', ['Sam', 'TJ', 'Lilly']], ['Slime with Joann', ['Lydia', 'Alysa']], ['Crafts with Eileen', ['Ella', 'Stephen']], ['Lawn Games', ['Josh', 'Sofie']], ['Board Games', ['Patrick']], ['Slip and Slide', ['Zac', 'Jacob']]],
  ],
  2: [
    [['Swimming', ['Ella', 'Lydia']], ['Nerf War', ['William', 'Zac']], ['Crafts with Eileen', ['Alysa', 'Josh']], ['Lawn Games', ['Brody', 'Cam']], ['Board Games', ['Bria', 'Jovi']]],
    [['Swimming', ['Sam', 'Sofie']], ['Crafts with Eileen', ['Lilly', 'Abby']], ['Whiffle Ball', ['Jacob']], ['Board Games', ['Ella', 'Stephen']], ['Laser Tag', ['Zac', 'Patrick']], ['Slime with Kimberly', ['TJ']]],
    [['Swimming', ['William', 'Alysa', 'Lilly']], ['Crafts with Eileen', ['Sofie', 'Lydia']], ['Lawn Games', ['Josh', 'Stephen', 'Cam']], ['Board Games', ['Patrick', 'TJ']], ['Slip and Slide', ['Zac', 'Sam', 'Bria']], ['Slime with Kimberly', ['Abby']]],
  ],
  3: [
    [['Swimming', ['Abby', 'Lilly']], ['Nerf War', ['Zac', 'Brody', 'TJ']], ['Crafts with Eileen', ['William', 'Sam']], ['Lawn Games', ['Sofie', 'Bria']], ['Board Games', ['Cam', 'Jovi']]],
    [['Swimming', ['Ella', 'Bria']], ['Crafts with Eileen', ['Lydia', 'Jovi']], ['Whiffle Ball', ['Sofie', 'TJ']], ['Board Games', ['Patrick', 'Josh', 'Sam']], ['Slime with Joann', ['Brody', 'Stephen']], ['Laser Tag', ['Zac', 'Jacob']]],
    [['Swimming', ['William', 'Cam']], ['Slime with Joann', ['Alysa', 'Ella']], ['Crafts with Eileen', ['Lilly', 'Josh']], ['Lawn Games', ['Patrick', 'Stephen']], ['Board Games', ['TJ', 'Abby']], ['Slip and Slide', ['Zac', 'Lydia', 'Jacob']]],
  ],
  4: [
    [['Swimming', ['Jovi', 'Bria', 'Cam']], ['Nerf War', ['William', 'Zac', 'Lilly']], ['Crafts with Eileen', ['Brody', 'Ella']], ['Lawn Games', ['Patrick', 'Jacob']], ['Board Games', ['Stephen', 'Alysa']]],
    [['Swimming', ['Lilly', 'TJ']], ['Crafts with Eileen', ['Abby', 'Jovi']], ['Whiffle Ball', ['Cam', 'Sam', 'Bria']], ['Board Games', ['Patrick', 'Stephen']], ['Slime with Joann', ['Lydia', 'Sofie', 'William']], ['Laser Tag', ['Zac', 'Brody']]],
    [['Swimming', ['Alysa', 'Abby', 'Josh']], ['Slime with Joann', ['Ella', 'Bria']], ['Crafts with Eileen', ['Lydia']], ['Lawn Games', ['Brody', 'Sam']], ['Board Games', ['Sofie', 'TJ']], ['Slip and Slide', ['Zac', 'Stephen']]],
  ],
  5: [
    [['Swimming', ['Brody', 'Ella', 'TJ']], ['Nerf War', ['Zac', 'Cam', 'Sam']], ['Crafts with Eileen', ['Patrick', 'Alysa', 'William']], ['Lawn Games', ['Bria', 'Abby']], ['Board Games', ['Lydia', 'Jovi']]],
    [['Swimming', ['Sam', 'Ella']], ['Crafts with Eileen', ['Lilly', 'Jacob']], ['Whiffle Ball', ['Jovi', 'Cam', 'TJ']], ['Board Games', ['Josh', 'Patrick']], ['Slime with Joann', ['Brody', 'Stephen']], ['Laser Tag', ['Zac', 'Bria']]],
    [['Swimming', ['Cam', 'TJ', 'Lilly']], ['Slime with Joann', ['Abby', 'Sofie']], ['Crafts with Eileen', ['Lydia']], ['Lawn Games', ['Josh', 'Sam']], ['Board Games', ['Stephen']], ['Slip and Slide', ['Zac', 'Alysa']]],
  ],
};

// Device-identity → team. Keyed to the ELECTIVES spellings above ("Lilly",
// not the standings' "Lily") so a stored identity can look up its own elective
// assignments directly. Patrick and Stephen appear in ELECTIVES as game-leaders
// with no team — they're intentionally excluded and never offered as an
// identity choice. Not editable and not synced (device-local, like state.notify).
const TEAM_COUNSELORS = {
  t0: ['Alysa', 'Cam', 'Sam'],   // 🦊 Ferocious Foxes
  t1: ['Bria', 'Lydia', 'Zac'],  // 🦃 Turkey Dinner
  t2: ['Jovi', 'Brody', 'Josh'], // 🍁 Methodic Mediocre Maples
  t3: ['Sofie', 'William'],      // 🎃 Particularly Perilous Pumpkins
  t4: ['Abby', 'TJ', 'Ella'],    // 🦅 Patriotic Pilgrims
  t5: ['Lilly', 'Jacob'],        // 🚜 Runaway John Deere's
};

// Minutes-since-midnight each elective slot starts (Elective 1 / 2 / 3),
// matching the weekday DAY_SCHEDULE blocks (1:15pm / 3:00pm / 4:00pm).
const ELECTIVE_SLOT_MIN = [hm(13, 15), hm(15, 0), hm(16, 0)];

// The full set of kids at camp on a given day = everyone assigned to any
// station across that day's elective slots. A kid missing from a particular
// slot is on break for it (see electiveBreakKids).
function electiveDayRoster(dow) {
  const set = new Set();
  (ELECTIVES[dow] || []).forEach((slot) => {
    (slot || []).forEach(([, kids]) => (kids || []).forEach((k) => set.add(k)));
  });
  return set;
}

// Kids with no station in this elective slot — they're on "Break".
function electiveBreakKids(dow, slot) {
  const assigned = new Set();
  (((ELECTIVES[dow] || [])[slot]) || []).forEach(([, kids]) => (kids || []).forEach((k) => assigned.add(k)));
  return [...electiveDayRoster(dow)].filter((k) => !assigned.has(k)).sort();
}

// The team id (t0..t5) a stored identity belongs to, or null if unknown.
function teamOfCounselor(name) {
  if (!name) return null;
  return Object.keys(TEAM_COUNSELORS).find((id) => TEAM_COUNSELORS[id].includes(name)) || null;
}

// Today's three elective slots for the stored identity (state.identity), as
// [{ slot, time, station, emoji, onBreak }], or null when there's nothing to
// show — no identity set, a weekend / no-elective day, or the identity isn't on
// today's elective sheet at all. Reused by renderMyElectives.
function myElectivesToday() {
  const name = state.identity;
  if (!name) return null;
  const { dow } = campNow();
  const day = ELECTIVES[dow];
  if (!day) return null;                               // dow 0/6 — no electives
  if (!electiveDayRoster(dow).has(name)) return null;  // not on today's sheet
  return [0, 1, 2].map((slot) => {
    const stations = day[slot] || [];
    const found = stations.find(([, kids]) => kids.includes(name));
    const station = found ? found[0] : null;
    return {
      slot,
      time: schedClock(ELECTIVE_SLOT_MIN[slot], true),
      station,
      emoji: station ? (STATION_EMOJI[station] || '🌟') : '☕',
      onBreak: !station,
    };
  });
}

// ── Elective weather forecast ─────────────────────────────────────
// Shows the forecast next to FUTURE electives (schedule sheet + "My electives
// today" card). Source: Open-Meteo — free, no API key, CORS-friendly, so it
// works from a static GitHub Pages site. Coordinates are Campground Rd,
// Belgrade ME (weather is regional, so town-level precision is plenty).
// Fails silent when offline/blocked, exactly like the optional Firebase sync.
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=44.5055&longitude=-69.7791'
  + '&hourly=temperature_2m,weather_code,precipitation_probability'
  + '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=7';
const WEATHER_CACHE_KEY = 'campWeatherCache';
const WEATHER_TTL_MS = 30 * 60 * 1000; // refetch at most every 30 min
const WEATHER_RAIN_MIN = 40;           // only surface rain % at/above this

// WMO weather_code → { emoji, label }.
const WEATHER_CODES = {
  0: { emoji: '☀️', label: 'Clear' }, 1: { emoji: '🌤️', label: 'Mainly clear' },
  2: { emoji: '⛅', label: 'Partly cloudy' }, 3: { emoji: '☁️', label: 'Overcast' },
  45: { emoji: '🌫️', label: 'Fog' }, 48: { emoji: '🌫️', label: 'Fog' },
  51: { emoji: '🌦️', label: 'Light drizzle' }, 53: { emoji: '🌦️', label: 'Drizzle' }, 55: { emoji: '🌦️', label: 'Heavy drizzle' },
  56: { emoji: '🌧️', label: 'Freezing drizzle' }, 57: { emoji: '🌧️', label: 'Freezing drizzle' },
  61: { emoji: '🌧️', label: 'Light rain' }, 63: { emoji: '🌧️', label: 'Rain' }, 65: { emoji: '🌧️', label: 'Heavy rain' },
  66: { emoji: '🌧️', label: 'Freezing rain' }, 67: { emoji: '🌧️', label: 'Freezing rain' },
  71: { emoji: '🌨️', label: 'Light snow' }, 73: { emoji: '🌨️', label: 'Snow' }, 75: { emoji: '🌨️', label: 'Heavy snow' },
  77: { emoji: '🌨️', label: 'Snow grains' },
  80: { emoji: '🌦️', label: 'Rain showers' }, 81: { emoji: '🌦️', label: 'Rain showers' }, 82: { emoji: '⛈️', label: 'Violent showers' },
  85: { emoji: '🌨️', label: 'Snow showers' }, 86: { emoji: '🌨️', label: 'Snow showers' },
  95: { emoji: '⛈️', label: 'Thunderstorm' }, 96: { emoji: '⛈️', label: 'Thunderstorm w/ hail' }, 99: { emoji: '⛈️', label: 'Thunderstorm w/ hail' },
};

// { dates: ['YYYY-MM-DD', …], byTime: { 'YYYY-MM-DDTHH:00': {temp, code, precip} }, at }
let weatherData = null;

// Today's date in camp time as 'YYYY-MM-DD' (en-CA renders ISO order), used to
// tell whether a cached forecast is still keyed to the right "today".
function campDateStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CAMP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (e) { return ''; }
}

function processWeather(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  const byTime = {};
  const dates = [];
  h.time.forEach((t, i) => {
    byTime[t] = { temp: h.temperature_2m[i], code: h.weather_code[i], precip: h.precipitation_probability[i] };
    const d = t.slice(0, 10);
    if (dates[dates.length - 1] !== d) dates.push(d);
  });
  return { dates, byTime, at: Date.now() };
}

// Paint badges in-place once weather lands (schedule sheet + my-electives card).
function repaintWeather() {
  renderMyElectives();
  refreshOpenSchedule();
}

function loadWeatherCache() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    // Discard a forecast whose day 0 isn't today — the day-offset mapping in
    // electiveWxHtml assumes dates[0] === today.
    if (cached && cached.dates && cached.dates[0] === campDateStr()) weatherData = cached;
  } catch (e) { /* ignore corrupt/absent cache */ }
}

async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = processWeather(await res.json());
    if (!data) return;
    weatherData = data;
    try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* quota / private mode */ }
    repaintWeather();
  } catch (e) { /* offline / blocked — try again next tick */ }
}

function weatherFresh() {
  return weatherData && weatherData.dates[0] === campDateStr() && (Date.now() - weatherData.at) < WEATHER_TTL_MS;
}

function startWeatherUpdates() {
  loadWeatherCache();
  if (!weatherFresh()) fetchWeather();
  setInterval(() => { if (!weatherFresh()) fetchWeather(); }, WEATHER_TTL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !weatherFresh()) fetchWeather(); });
}

// Forecast badge HTML for one elective slot, or '' when it shouldn't show:
// no data, a past day, a today-slot that already started, beyond the forecast
// range, or a missing hour. dow is the schedule day being rendered (0–6).
function electiveWxHtml(dow, slot) {
  if (!weatherData) return '';
  const now = campNow();
  const dayOffset = dow - now.dow;
  if (dayOffset < 0) return '';                                            // earlier this week
  if (dayOffset === 0 && ELECTIVE_SLOT_MIN[slot] <= now.minutes) return ''; // today, already started
  if (dayOffset >= weatherData.dates.length) return '';                    // past the 7-day window
  const hour = Math.floor(ELECTIVE_SLOT_MIN[slot] / 60);
  const w = weatherData.byTime[`${weatherData.dates[dayOffset]}T${String(hour).padStart(2, '0')}:00`];
  if (!w || w.temp == null) return '';
  const info = WEATHER_CODES[w.code] || { emoji: '🌡️', label: 'Forecast' };
  const rain = (w.precip != null && w.precip >= WEATHER_RAIN_MIN) ? ` · ${w.precip}%` : '';
  return `<span class="wx-badge" title="${esc(info.label)} · forecast">${info.emoji} ${Math.round(w.temp)}°${rain}</span>`;
}

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
  2: {
    breakfast: { dish: 'Pancakes and Sausage', emoji: '🥞' },
    lunch: { dish: 'Tacos', emoji: '🌮' },
    supper: { dish: 'Chicken Nuggets and Smiley Fries', emoji: '🍗' },
  },
  3: {
    breakfast: { dish: 'Egg Bake and Muffins', emoji: '🍳' },
    lunch: { dish: 'Hot Dogs', emoji: '🌭' },
    supper: { dish: 'Mystery Meat', emoji: '🍖' },
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

// The meal a schedule block represents (Breakfast/Lunch/Supper), or null.
// Handles decorated labels like "Supper — Shepherd's Pie".
function blockMealName(label) {
  const base = String(label || '').split(' — ')[0].trim();
  return MEAL_CLEANUP_MEALS.includes(base) ? base : null;
}

// A "🧽 <team>" note naming who's on cleanup for the meal a block represents,
// shown next to the meal wherever it appears. '' when the block isn't a meal or
// the day isn't on the cleanup rota; "TBA" for a tracked day not yet assigned.
function mealCleanupNote(dow, label) {
  const meal = blockMealName(label);
  if (!meal || !MEAL_CLEANUP_SCHEDULE[dow]) return '';
  const teamIds = cleanupAssigned(dow, meal);
  if (!teamIds) return ` <span class="meal-cleanup-note">🧽 TBA</span>`;
  const teams = Array.isArray(teamIds) ? teamIds : [teamIds];
  const who = teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ');
  return ` <span class="meal-cleanup-note">🧽 ${who}</span>`;
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
  // progress is the elapsed fraction of the current timed block (0–1), or null
  // to omit the bar (untimed blocks, or before the day's first block).
  const progressBar = (progress) => progress == null ? '' :
    `<jelly-progress class="now-progress" size="small" value="${Math.round(Math.max(0, Math.min(1, progress)) * 100)}" max="100" aria-hidden="true"></jelly-progress>`;
  const main = (emoji, label, time, next, progress) => eyebrow +
    `<div class="now-main"><span class="now-emoji">${emoji}</span><div class="now-body">
      <div class="now-label">${esc(label)}${time ? ` <span class="now-time">${time}</span>` : ''}${mealCleanupNote(dow, label)}</div>
      ${next ? `<div class="now-next">Up next: ${next.emoji} ${esc(next.label)} at ${schedClock(next.start, true)}${mealCleanupNote(dow, next.label)}</div>` : ''}
    </div></div>` + progressBar(progress);

  // Early morning, before the first block of the day.
  if (minutes < blocks[0].start) {
    const first = decorateMealBlock(dow, blocks[0]);
    if (dow === 0) return main('🚌', 'Camp starts today!', null, first, null);
    return main('🛏️', "Lights out — everyone's sleeping", null, first, null);
  }

  const found = blocks.find((x) => minutes >= x.start && minutes < x.end);
  if (!found) return null;

  // During competition blocks the scoreboard is the main event — keep the
  // banner to a slim, tappable one-liner rather than hiding it entirely, so the
  // schedule sheet stays reachable.
  if (found.type === 'games') {
    return `<div class="now-slim"><span class="now-slim-label">🏅 Team competitions</span><span class="now-open-hint">📅 Full schedule ›</span></div>`;
  }

  const b = decorateMealBlock(dow, found);
  const time = b.noTime ? null : schedRange(b.start, b.end);
  const progress = b.noTime ? null : (minutes - b.start) / (b.end - b.start);
  if (b.type === 'elective') {
    const me = state.identity;
    const chip = (k) => `<span class="kid-chip${k === me ? ' kid-chip-you' : ''}">${esc(k)}${k === me ? ' ⭐' : ''}</span>`;
    const stations = (ELECTIVES[dow] || [])[b.slot] || [];
    let rows = stations.map(([station, kids]) =>
      `<div class="now-station${kids.includes(me) ? ' now-station-you' : ''}"><span class="now-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
        <span class="now-kids">${kids.map(chip).join('')}</span></div>`).join('');
    const breakKids = electiveBreakKids(dow, b.slot);
    if (breakKids.length) {
      rows += `<div class="now-station now-break${breakKids.includes(me) ? ' now-station-you' : ''}"><span class="now-station-name">☕ Break</span>
        <span class="now-kids">${breakKids.map(chip).join('')}</span></div>`;
    }
    return main(b.emoji, b.label, time, null, progress) + `<div class="now-stations">${rows}</div>`;
  }

  // "Up next" = the next block that starts at or after this one ends. Using
  // the end time (not just index+1) keeps it correct when blocks overlap
  // (e.g. tonight's movie night sitting over the wind-down) — for a normal,
  // non-overlapping day this is the very next block, exactly as before.
  const after = blocks.find((x) => x.start >= found.end);
  const next = decorateMealBlock(dow, after || null);
  return main(b.emoji, b.label, time, next, progress);
}

function renderNowBanner() {
  const el = document.getElementById('now-banner');
  if (!el) return;
  // While a live match's Big Board owns the top of the home screen, the
  // schedule banner yields — the game IS what's happening now.
  if (typeof homeBoardGame === 'function' && homeBoardGame()) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
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
  const overlay = scheduleOverlayEl();
  overlay.classList.remove('closing');
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true; // background isn't reachable by tab/AT while the sheet is up
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
  const overlay = scheduleOverlayEl();
  const sheet = overlay.querySelector('.schedule-sheet');
  if (sheet) sheet.style.transform = ''; // clear any swipe offset
  const finish = () => {
    overlay.hidden = true;
    overlay.classList.remove('closing');
    document.body.classList.remove('no-scroll');
    const app = document.getElementById('app');
    if (app) app.inert = false;
    const banner = document.getElementById('now-banner');
    if (banner && !banner.hidden) banner.focus({ preventScroll: true });
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { finish(); return; }
  overlay.classList.add('closing'); // play the slide-down, then hide
  setTimeout(finish, 200);
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
    <button class="sched-day-chip ${d.dow === scheduleDay ? 'active' : ''}" data-dow="${d.dow}" aria-pressed="${d.dow === scheduleDay}">
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
    let labelBadge = ''; // forecast badge next to the label (future electives only)
    if (raw.type === 'games') {
      const session = raw.start < 720 ? 'Morning' : 'Evening';
      // Competition days are editable; map this block's real day-of-week to
      // whichever configured day(s) carry that dow.
      const dowDayIds = state.config.days.filter((d) => d.dow === dow).map((d) => d.id);
      const games = state.config.games.filter((g) => dowDayIds.includes(g.dayId) && g.session === session);
      if (games.length) {
        extra = `<div class="sched-games">${games.map((g) =>
          `<span class="sched-game-chip ${state.results[g.id] ? 'played' : ''}">${esc(g.emoji)} ${esc(g.name)}${state.results[g.id] ? ' ✓' : ''}</span>`).join('')}</div>`;
      }
    } else if (raw.type === 'elective') {
      labelBadge = electiveWxHtml(dow, raw.slot);
      const me = state.identity;
      const kidText = (kids) => kids.map((k) => k === me ? `<span class="sched-you">⭐ ${esc(k)}</span>` : esc(k)).join(' · ');
      const stations = (ELECTIVES[dow] || [])[raw.slot] || [];
      if (stations.length) {
        let stationRows = stations.map(([station, kids]) =>
          `<div class="sched-station${kids.includes(me) ? ' sched-station-you' : ''}"><span class="sched-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
            <span class="sched-station-kids">${kidText(kids)}</span></div>`).join('');
        const breakKids = electiveBreakKids(dow, raw.slot);
        if (breakKids.length) {
          stationRows += `<div class="sched-station sched-break${breakKids.includes(me) ? ' sched-station-you' : ''}"><span class="sched-station-name">☕ Break</span>
            <span class="sched-station-kids">${kidText(breakKids)}</span></div>`;
        }
        extra = `<div class="sched-stations">${stationRows}</div>`;
      }
    }

    return `<div class="sched-block ${status} ${meal ? 'meal' : ''}">
      <div class="sched-rail"><span class="sched-dot"></span></div>
      <div class="sched-card">
        <div class="sched-time">${raw.noTime ? '' : schedRange(raw.start, raw.end)}${status === 'now' ? '<span class="sched-now-pill">Now</span>' : ''}</div>
        <div class="sched-label"><span class="sched-emoji">${b.emoji}</span> ${esc(b.label)}${mealCleanupNote(dow, b.label)}${labelBadge}</div>
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

  // Swipe-to-dismiss — only from the header (grabber). The scrollable body
  // keeps its own scroll; we never hijack it.
  const header = scheduleOverlayEl().querySelector('.schedule-header');
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  if (header && sheet) {
    let startY = null;
    let dy = 0;
    header.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      dy = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    header.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY); // downward only
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    header.addEventListener('touchend', () => {
      if (startY == null) return;
      sheet.style.transition = '';
      startY = null;
      if (dy > 90) { closeSchedule(); }
      else { sheet.style.transform = ''; } // spring back
    });
  }
}

// ── Settings sheet (gear overlay) ────────────────────────────────
// A bottom sheet holding appearance, sound, and score-entry access —
// controls that used to sit loose in the header — plus the "Stalling
// with Patrick" presenter link (formerly a hidden corner dot). Mirrors
// the schedule sheet's open/close/inert/Escape behavior.
function settingsOverlayEl() {
  return document.getElementById('settings-overlay');
}

function openSettings() {
  const overlay = settingsOverlayEl();
  if (!overlay) return;
  overlay.classList.remove('closing');
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true;
  requestAnimationFrame(() => {
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  });
}

function closeSettings() {
  const overlay = settingsOverlayEl();
  if (!overlay) return;
  const finish = () => {
    overlay.hidden = true;
    overlay.classList.remove('closing');
    document.body.classList.remove('no-scroll');
    const app = document.getElementById('app');
    if (app) app.inert = false;
    const btn = document.getElementById('settings-btn');
    if (btn) btn.focus({ preventScroll: true });
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { finish(); return; }
  overlay.classList.add('closing');
  setTimeout(finish, 200);
}

function wireSettings() {
  const btn = document.getElementById('settings-btn');
  if (btn) btn.addEventListener('click', openSettings);
  const closeBtn = document.getElementById('settings-close');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  const overlay = settingsOverlayEl();
  if (overlay) {
    const backdrop = overlay.querySelector('.settings-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSettings);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeSettings();
  });
}

// ── Change-history sheet (editor-only) ───────────────────────────
// Opened from the Settings sheet; reuses the same overlay/sheet CSS. Manages
// its own open/close state (it does NOT call closeSettings, whose delayed
// finish would clear `inert` out from under this sheet) — it hands off from
// Settings by hiding it instantly, then restores the app on close.
function historyOverlayEl() {
  return document.getElementById('history-overlay');
}

function openHistory() {
  const s = settingsOverlayEl();
  if (s) { s.hidden = true; s.classList.remove('closing'); } // instant hand-off from Settings
  const overlay = historyOverlayEl();
  if (!overlay) return;
  overlay.classList.remove('closing');
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true;
  renderHistory();
  requestAnimationFrame(() => {
    const closeBtn = document.getElementById('history-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  });
}

function closeHistory() {
  const overlay = historyOverlayEl();
  if (!overlay) return;
  const finish = () => {
    overlay.hidden = true;
    overlay.classList.remove('closing');
    document.body.classList.remove('no-scroll');
    const app = document.getElementById('app');
    if (app) app.inert = false;
    const btn = document.getElementById('settings-btn');
    if (btn) btn.focus({ preventScroll: true });
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { finish(); return; }
  overlay.classList.add('closing');
  setTimeout(finish, 200);
}

function renderHistory() {
  const body = document.getElementById('history-body');
  if (!body) return;
  if (!fbRef) {
    body.innerHTML = '<p class="muted">Live sync is off on this device, so there\'s no shared change history to show.</p>';
    return;
  }
  body.innerHTML = '<p class="muted">Loading…</p>';
  firebase.database().ref('campScoreboard/changelog').limitToLast(500).once('value')
    .then((snap) => {
      const val = snap.val() || {};
      const rows = Object.keys(val).map((k) => val[k]).filter(Boolean);
      rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      body.innerHTML = rows.length
        ? renderHistoryRows(rows)
        : '<p class="muted">No point changes recorded yet.</p>';
    })
    .catch(() => {
      body.innerHTML = '<p class="muted">Couldn\'t load the history (offline?). Close and reopen to try again.</p>';
    });
}

function renderHistoryRows(rows) {
  let html = '';
  let lastDay = null;
  rows.forEach((r) => {
    const stamp = formatEasternStamp(r.at) || '';
    const comma = stamp.indexOf(',');
    const day = comma > -1 ? stamp.slice(0, comma) : stamp;
    const time = comma > -1 ? stamp.slice(comma + 2) : '';
    if (day !== lastDay) { html += `<div class="cl-day">${esc(day || '—')}</div>`; lastDay = day; }
    const delta = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    const cls = r.delta > 0 ? 'cl-pos' : 'cl-neg';
    const who = r.by ? ` · ${esc(String(r.by))}` : '';
    const emoji = r.teamId ? teamEmoji(r.teamId) : '';
    html += `
      <div class="cl-entry">
        <div class="cl-entry-top">
          <span class="cl-team">${emoji ? emoji + ' ' : ''}${esc(String(r.team || r.teamId || '?'))}</span>
          <span class="cl-delta ${cls}">${esc(delta)} pts</span>
        </div>
        <div class="cl-entry-sub">${esc(String(r.reason || 'Points updated'))} · ${esc(String(r.before))}→${esc(String(r.after))}</div>
        <div class="cl-entry-meta">${esc(time)}${who}</div>
      </div>`;
  });
  return html;
}

function wireHistory() {
  const row = document.getElementById('history-row');
  if (row) row.addEventListener('click', openHistory);
  const closeBtn = document.getElementById('history-close');
  if (closeBtn) closeBtn.addEventListener('click', closeHistory);
  const backdrop = document.getElementById('history-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeHistory);
  document.addEventListener('keydown', (e) => {
    const overlay = historyOverlayEl();
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeHistory();
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

// One line: who's here now, when data last changed, what build this is,
// and the Settings link (the header is gone — this is the gear now). The
// presence count lives here and renderPresence just re-renders the footer.
function renderFooter() {
  const el = document.getElementById('app-footer');
  if (!el) return;
  const dataStamp = formatEasternStamp(state.meta && state.meta.lastDataChangeAt);
  const bits = [];
  if (syncEnabled() && presenceCount > 0) {
    bits.push(`<span title="${presenceCount} device${presenceCount === 1 ? '' : 's'} here now">👥 ${presenceCount} here</span>`);
  }
  bits.push(`📋 Data: ${dataStamp ? esc(dataStamp) : 'no scores yet'}`);
  bits.push(`<span title="Code last updated: ${esc(formatEasternStamp(CODE_UPDATED_AT) || 'unknown')}">🛠️ v${APP_VERSION}</span>`);
  bits.push(`<button id="settings-btn" class="footer-link" aria-label="Settings">⚙️ Settings</button>`);
  el.innerHTML = `<p class="footer-line">${bits.join(' · ')}</p>`;
  // The line is rebuilt on every render, so rebind here (wireSettings runs
  // once at init, before the first footer render).
  const btn = document.getElementById('settings-btn');
  if (btn) btn.addEventListener('click', openSettings);
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
    config: defaultConfig(), // editable days/games catalog (Settings → Set up the week)
    teams: DEFAULT_TEAM_NAMES.map((name, i) => ({ id: 't' + i, name, counselor: DEFAULT_COUNSELORS[i] })),
    results: {},   // gameId -> { medals: {gold, silver, bronze}, scores?, savedAt }
    brackets: {},  // gameId -> in-progress tournament
    drafts: {},    // gameId -> in-progress tally/placement entry
    bonuses: {},   // bonusId -> { teamId, category, label, points, at }
    brownie: {},   // teamId -> brownie point count — just for fun, not scoring
    picSetup: {},  // gameId -> { source: 'pregenerated'|'own'|'numbered', words: [] } (Pictionary item source)
    live: {},      // gameId -> { key, inning, hr } live match tally (synced so everyone can watch)
    ui: { day: null, gameId: null }, // day is filled in by migrateState (needs config)
    theme: null,
  };
}

// The selected day is a config day id ('d1'...). Prefer the config day whose
// dow matches today in camp time; otherwise the first configured day.
function defaultDay(config) {
  const days = (config && config.days) || [];
  const todayDow = campNow().dow; // camp time (America/New_York), 0 Sun .. 6 Sat
  const today = days.find((d) => d.dow === todayDow);
  if (today) return today.id;
  return days.length ? days[0].id : null;
}

// Upgrades older-shaped state (or an imported backup) in place so the rest
// of the app only ever sees the current shape. Game ids never change here —
// saved results/brackets/picSetup stay keyed correctly. Also heals RTDB's
// empty-array pruning on config (games, days, rules), mirroring what
// normalizeSyncedState() does for the score state.
function migrateState(s) {
  let changed = false;
  if (!s.config || typeof s.config !== 'object') {
    s.config = defaultConfig();
    changed = true;
  }
  const c = s.config;
  if (!c.version) { c.version = 1; changed = true; }
  if (!Array.isArray(c.games)) { c.games = []; changed = true; }
  if (!Array.isArray(c.days)) { c.days = []; changed = true; }
  if (!Array.isArray(c.sessions) || !c.sessions.length) {
    c.sessions = ['Morning', 'Evening'];
    changed = true;
  }
  c.games.forEach((g) => {
    if (g.day !== undefined) {
      if (!g.dayId) g.dayId = 'd' + g.day;
      delete g.day;
      changed = true;
    }
    if (!Array.isArray(g.rules)) { g.rules = []; changed = true; }
    g.rules.forEach((sec) => {
      if (!Array.isArray(sec.items)) { sec.items = []; changed = true; }
    });
  });
  if (!s.ui) { s.ui = { day: null, gameId: null }; changed = true; }
  if (typeof s.ui.day === 'number') { s.ui.day = 'd' + s.ui.day; changed = true; }
  if (!s.ui.day || !c.days.some((d) => d.id === s.ui.day)) {
    s.ui.day = defaultDay(c);
    changed = true;
  }
  return changed;
}

let state = loadState() || makeFreshState();
if (!state.teams || !state.results) state = makeFreshState();
if (!state.ui) state.ui = { day: null, gameId: null };
if (!state.meta) state.meta = {};
if (!state.bonuses) state.bonuses = {}; // extra/bonus points ledger
if (!state.brownie) state.brownie = {}; // brownie point tallies (just for fun)
if (!state.live) state.live = {}; // live match tallies (synced; see liveTracker)
if (state.theme === undefined) state.theme = null; // pre-theme saves: follow the device
if (state.notify === undefined) state.notify = false; // device-local, not synced (see SYNC_KEYS)
// state.followTeam stays `undefined` until the picker is answered (a team id,
// or null for "neutral/no team") — device-local, not synced.
// state.identity is the counselor this device belongs to, and is deliberately
// left tri-state (device-local, not synced): `undefined` = never asked (so we
// can proactively prompt on next launch), `null` = asked and skipped ("just
// cheering"), or a name string. JSON.stringify drops undefined, so "never
// asked" round-trips through localStorage naturally — same as followTeam.
if (migrateState(state)) {
  // Persist the upgraded shape right away (saveState() isn't safe yet —
  // the sync globals below haven't been initialized at this point).
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
normalizeSyncedState();

function counselorName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t && t.counselor ? t.counselor : '';
}

function saveState() {
  // A save made before the first server snapshot lands is "unsynced local
  // work" — track it so the first snapshot can defend it instead of blindly
  // adopting a stale remote copy (see the initSync merge). Set before the
  // write so a quota/private-mode throw doesn't skip the flag.
  if (!remoteReady) dirtySinceLoad = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Private mode / quota exceeded: cloud + in-memory state still work, so
    // the Save button shouldn't appear dead. Just warn and keep going.
    console.warn('localStorage write failed (private mode or quota?)', e);
  }
  if (!applyingRemote) schedulePush();
}

// Stamps "when real scoreboard data last changed" for the footer — a
// result saved, a bracket match recorded, or a team renamed. Deliberately
// NOT called for view-only actions (day tab, theme, PIN) so it reflects
// actual camp activity, not just page traffic.
function touchData() {
  if (!state.meta) state.meta = {};
  state.meta.lastDataChangeAt = new Date().toISOString();
  dataEditPending = true; // real edit queued — guard it until it's pushed
}

// ── Cloud sync (Firebase Realtime Database) ──────────────────────
// Optional. If window.FIREBASE_CONFIG is filled in (firebase-config.js)
// and the SDK loaded, scores sync across every device in real time.
// Otherwise the app runs exactly as before, local-only.

const SYNC_KEYS = ['teams', 'results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'brownie'];
let fbRef = null;
// Per-tab id for the "who's here" presence chip — minted once per page load
// (not persisted) so each open tab counts, and cleans up, independently.
const presenceId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : newBonusId();
let presenceCount = 0;
let applyingRemote = false;
let pushTimer = null;
// No pushes until the first server snapshot has landed. Without this, a
// device on slow camp wifi that saves anything (even a day-tab tap) before
// its first sync queues a set() of its stale local state — and the SDK
// delivers that on connect, wiping everyone's newer scores.
let remoteReady = false;
// True once anything has been saved locally before the first snapshot landed.
// Lets the first-snapshot merge defend offline-entered results instead of
// silently replacing them with a stale server copy.
let dirtySinceLoad = false;
// True while a *data* edit (touchData) is queued but not yet pushed. The merge
// uses this — not the raw pushTimer — to decide whether to hold off adopting a
// snapshot, so view-only saves (day tab, theme, notify, follow-team) never
// block an incoming update or its notification.
let dataEditPending = false;
// Count of local writes handed to the server (fbRef.set) that it hasn't
// confirmed committed yet. While offline, a queued set()'s promise stays
// pending, so this stays > 0 — and the merge uses it to refuse to adopt the
// server's PREVIOUS value (the snapshot that re-fires on reconnect) until our
// cached edit has actually uploaded. This is what stops scores being typed /
// saved offline from getting reverted by a stale reconnect snapshot.
let pendingWrites = 0;
// The synced state as we last knew it on the server — the baseline the next
// push diffs against so it writes ONLY the items this device changed (per-path
// update), instead of overwriting the whole tree and clobbering edits another
// device made to other items. null means "resync the whole tree next push"
// (before the first push, or to recover after a failed one). Updated on every
// adopt (in the value handler) and every push.
let lastSyncedTree = null;
// The editable week config (days/games catalog) syncs on its own sibling ref
// (campScoreboard/config) — deliberately OUTSIDE campScoreboard/state so older
// cached clients, and the state node's own key-list bookkeeping (SYNC_KEYS /
// SYNC_ITEM_MAPS / the merge's replace list), never have to know about it.
// Whole-object last-write-wins: with one or two editors that's acceptable, and
// builder inputs commit on change/blur so the write window stays small.
let fbConfigRef = null;
let pushConfigTimer = null;
let applyingRemoteConfig = false;
// A remote config that arrived while the builder had a focused input — applied
// on focusout instead of mid-typing (see the flush wiring in init()).
let pendingRemoteConfig = null;

function syncEnabled() {
  return !!fbRef;
}

function applyRemoteConfig(remote) {
  const beforeJson = JSON.stringify(state.config);
  applyingRemoteConfig = true;
  state.config = remote;
  const upgraded = migrateState(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  applyingRemoteConfig = false;
  if (upgraded) schedulePushConfig();
  if (appStarted && JSON.stringify(state.config) !== beforeJson) renderAll();
}

// Settings code calls this after mutating state.config.
function saveConfig() {
  state.config.updatedAt = new Date().toISOString();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  if (!applyingRemoteConfig) schedulePushConfig();
}

function schedulePushConfig() {
  if (!fbConfigRef) return;
  clearTimeout(pushConfigTimer);
  // Null the handle when it fires (mirrors schedulePush) — its non-null-ness
  // means "a config edit is queued but unsent", which defers remote applies.
  pushConfigTimer = setTimeout(() => { pushConfigTimer = null; pushConfig(); }, 400);
}

function pushConfig() {
  if (!fbConfigRef || applyingRemoteConfig) return;
  // JSON round-trip strips any `undefined` (which Realtime DB rejects).
  fbConfigRef.set(JSON.parse(JSON.stringify(state.config))).catch((e) => console.warn('config push failed', e));
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
      const firstSnapshot = !remoteReady;
      remoteReady = true; // server truth received — pushes may flow now
      if (!remote) { pushState(); return; } // seed an empty database
      // Defend offline-entered work: if this is the very first snapshot and we
      // saved something locally before it arrived, and our data is strictly
      // newer than the server's, push local instead of adopting remote — which
      // would otherwise wipe a result entered on dead wifi. Timestamps use the
      // synced meta.lastDataChangeAt (touchData) so only real data edits win.
      if (firstSnapshot && dirtySinceLoad) {
        const localAt = state.meta && state.meta.lastDataChangeAt;
        const remoteAt = remote.meta && remote.meta.lastDataChangeAt;
        if (localAt && (!remoteAt || localAt > remoteAt)) {
          pushState();
          return;
        }
      }
      // Never let a snapshot overwrite an edit in progress. Defer adopting it
      // while EITHER:
      //   • the editor is mid-entry — a score/name input is focused, or a data
      //     edit is typed/queued but not yet pushed (editorMidEntry), or
      //   • we have a local write the server hasn't confirmed yet
      //     (pendingWrites > 0) — e.g. scores entered offline, still queued.
      // Without this, a reconnect re-fires the server's PREVIOUS value and the
      // merge below replaces state.drafts/results with it, reverting the scores
      // being typed (and a later Save then persists the reverted values —
      // teams lose points). Deferring is safe: our own write echoes back once
      // it commits, and any genuinely newer remote change re-fires a snapshot
      // the moment we're idle again. View-only saves (day tab, theme, notify,
      // follow-team) don't trip editorMidEntry, so they never block updates.
      // The first snapshot is handled by dirtySinceLoad above.
      if (!firstSnapshot && (editorMidEntry() || pendingWrites > 0)) return;
      applyingRemote = true;
      // Signature of the synced slice before applying this snapshot. RTDB fires
      // a local `value` event for our own set(), so most snapshots are pure
      // echoes — re-rendering on those blurs the tally/bonus inputs and
      // dismisses the iOS keyboard mid-entry. Skip renderAll when nothing
      // actually changed (below).
      const beforeSig = syncSignature();
      // The snapshot is the entire synced tree, so a key missing from it
      // means "empty" — RTDB prunes empty objects on write. Treating
      // missing as keep-local made "New week (reset)" un-syncable: other
      // devices kept their old results and re-pushed them later. Teams
      // stay guarded — a snapshot without a roster is malformed.
      if (remote.teams) state.teams = remote.teams;
      // Pictionary prompt words are never synced (see pushState) — the incoming
      // snapshot carries only each game's mode. Stash this device's own words so
      // the ref's list survives adopting a remote update, then re-attach them to
      // any setup the snapshot still has (a remotely-reset mode drops them too).
      const localPicWords = {};
      Object.keys(state.picSetup || {}).forEach((gid) => {
        const s = state.picSetup[gid];
        if (s && s.words && s.words.length) localPicWords[gid] = s.words;
      });
      ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'brownie'].forEach((k) => {
        state[k] = remote[k] !== undefined ? remote[k] : {};
      });
      Object.keys(localPicWords).forEach((gid) => {
        if (state.picSetup[gid]) state.picSetup[gid].words = localPicWords[gid];
      });
      // Realtime Database silently drops empty arrays/nulls on write, so a
      // freshly-started bracket or Pictionary round can come back missing
      // its empty fields. Heal everything the instant remote data lands,
      // before any render sees it.
      normalizeSyncedState();
      // We now match the server, so this snapshot becomes the diff baseline —
      // otherwise the next push would re-send data we just received.
      lastSyncedTree = syncedSnapshot();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      applyingRemote = false;
      if (appStarted && syncSignature() !== beforeSig) {
        remoteJustApplied = true; // let renderStandings pulse rows that changed
        const matchupChanges = detectMatchupChanges();
        renderAll();
        notifyMatchupChanges(matchupChanges);
      }
    }, (err) => {
      // A cancelled read (e.g. security rules) is terminal — drop to local-only
      // and tell the truth in the indicator rather than claiming "Synced".
      console.warn('Firebase read failed, staying local', err);
      fbRef = null;
      fbConnected = false;
      updateSyncIndicator();
    });
    // Honest connection state: RTDB's .info/connected flips as wifi comes and
    // goes, so the indicator can say "Offline — will sync when back" instead of
    // a permanent "Synced".
    firebase.database().ref('.info/connected').on('value', (s) => {
      fbConnected = !!s.val();
      updateSyncIndicator();
      // Re-register presence on every (re)connect — onDisconnect handlers
      // don't survive a dropped socket, so a reconnect after wifi drops or
      // the phone waking up needs a fresh one each time.
      if (fbConnected) {
        try {
          const presenceRef = firebase.database().ref('campScoreboard/presence/' + presenceId);
          presenceRef.onDisconnect().remove();
          presenceRef.set({ role: currentRole(), at: firebase.database.ServerValue.TIMESTAMP });
        } catch (e) { /* rules may deny this — presence chip just stays hidden */ }
      }
    });
    // Count listener lives here (not inside the connected handler above) so
    // it's registered exactly once — putting it there would re-subscribe on
    // every reconnect and stack up duplicate listeners.
    try {
      firebase.database().ref('campScoreboard/presence').on('value', (snap) => {
        presenceCount = snap.numChildren();
        renderPresence();
      });
    } catch (e) { /* ignore — chip just stays hidden */ }
    // Week-config catalog listener (sibling ref — see the fbConfigRef comment).
    fbConfigRef = firebase.database().ref('campScoreboard/config');
    fbConfigRef.on('value', (snap) => {
      const remote = snap.val();
      if (!remote) { pushConfig(); return; } // first upgraded client seeds the catalog
      if (editorMidEntry()) { pendingRemoteConfig = remote; return; } // applied on focusout
      pendingRemoteConfig = null;
      applyRemoteConfig(remote);
    }, (err) => {
      console.warn('Firebase config read failed, staying local', err);
      fbConfigRef = null;
    });
    // (Auto-reload is handled by startUpdatePolling — a same-origin poll of the
    // deployed index.html — so it works on a single device and doesn't depend on
    // Firebase or another client announcing the build.)
    // Flush a pending debounced push before the page is hidden/suspended. iOS
    // suspends setTimeout when the phone locks, so a result saved right before
    // locking would otherwise strand its 400ms push and never reach the server.
    window.addEventListener('pagehide', flushPendingPush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPendingPush();
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
  // Null the handle when it fires so `pushTimer !== null` is an accurate
  // "a local write is queued but not yet sent" signal — the remote merge
  // uses it to avoid clobbering an un-pushed edit (see initSync).
  pushTimer = setTimeout(() => { pushTimer = null; pushState(); }, 400); // coalesce rapid edits
}

// The synced form of picSetup: each game's MODE (source) travels so ref
// devices agree on labeling, but the actual Pictionary prompt words never
// leave the device that typed them — they're a surprise and must not be
// broadcast over the shared database. (The built-in list and viewer display
// are handled separately; this keeps custom 'own' words off the wire.)
function picSetupForSync(picSetup) {
  if (!picSetup || typeof picSetup !== 'object') return picSetup;
  const out = {};
  Object.keys(picSetup).forEach((gid) => {
    const s = picSetup[gid];
    out[gid] = (s && typeof s === 'object') ? { source: s.source } : s;
  });
  return out;
}

// Maps written per-child (one path per game/team/bonus) so concurrent edits to
// DIFFERENT items on different devices never overwrite each other. teams/meta
// are small singletons written whole.
const SYNC_ITEM_MAPS = ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'brownie'];
const SYNC_SINGLETONS = ['teams', 'meta'];

// The synced portion of state as it should exist on the server: a deep copy
// with Pictionary words stripped (never synced). Serves as both the push
// source and the diff baseline, so both sides compare like-for-like.
function syncedSnapshot() {
  const snap = {};
  SYNC_KEYS.forEach((k) => { snap[k] = state[k] === undefined ? null : state[k]; });
  snap.picSetup = picSetupForSync(state.picSetup);
  return JSON.parse(JSON.stringify(snap)); // also strips any `undefined` RTDB rejects
}

// Flat RTDB multi-location update (path -> value, or null to delete) covering
// exactly what changed between two synced snapshots. Item maps diff per child;
// singletons diff whole.
function computeSyncUpdates(prev, cur) {
  const up = {};
  SYNC_ITEM_MAPS.forEach((k) => {
    const p = (prev && prev[k]) || {};
    const c = (cur && cur[k]) || {};
    Object.keys(c).forEach((id) => {
      if (JSON.stringify(c[id]) !== JSON.stringify(p[id])) up[k + '/' + id] = c[id];
    });
    Object.keys(p).forEach((id) => {
      if (!(id in c)) up[k + '/' + id] = null; // item deleted (cleared result, removed bonus, …)
    });
  });
  SYNC_SINGLETONS.forEach((k) => {
    const pv = prev ? prev[k] : undefined;
    const cv = cur ? cur[k] : undefined;
    if (JSON.stringify(cv) !== JSON.stringify(pv)) up[k] = (cv === undefined ? null : cv);
  });
  return up;
}

function pushState() {
  if (!fbRef || applyingRemote || !remoteReady) return;
  const cur = syncedSnapshot();
  const prevBaseline = lastSyncedTree;
  // First push (or recovering from a failed one): write every top-level key so
  // the server is brought fully in step. Afterwards only changed items go up.
  const updates = prevBaseline
    ? computeSyncUpdates(prevBaseline, cur)
    : SYNC_KEYS.reduce((u, k) => { u[k] = cur[k]; return u; }, {});
  // Adopt `cur` as the new baseline optimistically; restore it on failure so
  // the same changes are re-diffed (and re-sent per-path) next time rather than
  // stranded.
  lastSyncedTree = cur;
  dataEditPending = false; // current state (incl. any edit) is going to the server
  if (!Object.keys(updates).length) return; // nothing actually changed
  // Track the write until the server confirms it. Offline, the promise stays
  // pending (the SDK queues the write and flushes on reconnect), so
  // pendingWrites stays > 0 and the merge won't adopt the stale reconnect
  // snapshot until our cached edit has uploaded. Settle on success AND failure
  // so a rejected write can't wedge sync closed.
  pendingWrites++;
  const settle = () => { pendingWrites = Math.max(0, pendingWrites - 1); };
  fbRef.update(updates).then(settle, (e) => {
    console.warn('sync push failed', e);
    lastSyncedTree = prevBaseline; // re-send these changes (still per-path) next push
    settle();
  });
}

// Cheap content signature of the synced state, used to skip re-rendering on
// snapshot echoes (including our own set()). JSON order is stable because the
// keys come from a fixed array.
function syncSignature() {
  return JSON.stringify(SYNC_KEYS.map((k) => state[k]));
}

// A matchup "slot" — a stable key for one pairing, so a genuinely NEW matchup
// can be told apart from an undo/clear across syncs.
function matchupSlot(aId, bId) {
  if (!aId || !bId) return null;
  return { aId, bId, key: [aId, bId].sort().join('|') };
}

// The upcoming matchups of a game's bracket that are KNOWN right now: the
// current (being called up / played) matchup plus the on-deck matchup when it
// can be determined (a fixed-order Round 1). Works for both fixed-order and
// free-pick brackets — it reads the same currentMatchupOf/nextMatchupOf the
// bracket screens use, so it stays correct now that fixed-order Round 1 no
// longer sets selectedPair.
function upcomingMatchups(g) {
  const raw = state.brackets && state.brackets[g.id];
  if (!raw || g.format !== 'tournament') return [];
  const b = normalizeBracket(raw);
  const out = [];
  const cur = currentMatchupOf(g, b);
  if (cur) out.push(matchupSlot(cur[0], cur[1]));
  const nxt = nextMatchupOf(g, b);
  if (nxt) out.push(matchupSlot(nxt[0], nxt[1]));
  return out.filter(Boolean);
}

// gameId -> [slot,...] snapshot of known upcoming matchups, so a genuinely NEW
// matchup can be told apart from an undo/clear across remote syncs — even for
// a bracket nobody currently has open.
let lastBracketSlots = null;

function detectMatchupChanges() {
  const prev = lastBracketSlots;
  const next = {};
  const changes = [];
  state.config.games.forEach((g) => {
    if (g.format !== 'tournament') return;
    const ups = upcomingMatchups(g);
    next[g.id] = ups;
    if (prev === null) return; // first time: seed, don't fire
    const prevKeys = new Set((prev[g.id] || []).map((s) => s.key));
    ups.forEach((s) => {
      if (!prevKeys.has(s.key)) changes.push({ game: g, aId: s.aId, bId: s.bId });
    });
  });
  lastBracketSlots = next;
  return changes;
}

// The soonest known matchup involving `teamId` (current preferred, then on
// deck) — used by the "Your team" summary card's "Up next" line.
function findNextMatchupFor(teamId) {
  if (!teamId) return null;
  for (const g of state.config.games) {
    if (g.format !== 'tournament' || state.results[g.id]) continue;
    for (const s of upcomingMatchups(g)) {
      if (s.aId === teamId || s.bId === teamId) {
        return { game: g, opponentId: s.aId === teamId ? s.bId : s.aId };
      }
    }
  }
  return null;
}

let fbConnected = false; // live RTDB connection state (.info/connected)

function updateSyncIndicator() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!syncEnabled()) {
    el.textContent = '📱 This device only';
    el.classList.remove('synced');
  } else if (fbConnected) {
    el.textContent = '☁️ Synced';
    el.classList.add('synced');
  } else {
    el.textContent = '⚠️ Offline — will sync when back';
    el.classList.remove('synced');
  }
}

function renderPresence() {
  renderFooter(); // the live "who's here" count renders inside the footer line
}

function teamEmoji(id) {
  return TEAM_EMOJI[id] || '🏳️';
}

// Path to a team's shield crest image, or null if we don't have one for that
// slot (see TEAM_SHIELD) — callers fall back to the emoji.
function teamShield(id) {
  return TEAM_SHIELD[id] || null;
}

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gameById(id) {
  return state.config.games.find((g) => g.id === id);
}

function dayById(id) {
  return state.config.days.find((d) => d.id === id);
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

// Quiet two-note chime for a point-change alert about a team you're not following.
function playAlertChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.35);
  tone(1174.66, 0.12, 0.25, 'sine', 0.3);
}

// Brighter three-note chime for an alert about the team you're following.
function playMineChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.4);
  tone(1174.66, 0.11, 0.15, 'sine', 0.4);
  tone(1567.98, 0.22, 0.3, 'sine', 0.4);
}

// ── In-app toasts + subscribe-to-notifications ───────────────────
// No service worker / push infra: this only fires while the tab is open on
// a device, but needs neither billing nor a server deploy. "Mine" alerts
// (about the followed team) get a fuller toast + OS Notification (only
// when the tab isn't focused, so it isn't a redundant second alert) and a
// brighter chime; everyone else's events still show, just quieter.

function notifyOn() {
  return !!state.notify;
}

function showToast(message, opts) {
  const mine = !!(opts && opts.mine);
  // Jelly toaster (the <jelly-toaster position="bottom"> rail in index.html).
  // Falls back to the legacy #toast-container pill if the module hasn't
  // loaded/failed — toasts carry sync errors and must always surface.
  if (window.jellyToast) {
    window.jellyToast(message, { tone: mine ? 'success' : 'info', duration: mine ? 5500 : 4000 });
    return;
  }
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (mine ? ' toast-mine' : '');
  el.textContent = message;
  container.appendChild(el);
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(remove, 250);
  }, mine ? 5500 : 4000);
}

function maybeNativeNotification(title, body, tag) {
  if (!window.Notification || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(title, { body, icon: 'apple-touch-icon.png', tag });
  } catch (e) { /* unsupported in this context — the toast already showed */ }
}

// Turn notifications on (idempotent). Must be called from a user gesture so
// the OS permission prompt + audio unlock are allowed. Caller persists.
function enableNotify() {
  getAudio(); // unlock sound from the triggering user gesture
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  state.notify = true;
  updateNotifyButton();
}

function toggleNotify() {
  if (!state.notify) {
    enableNotify();
    showToast("🔔 You'll get an alert here whenever a team's points change or is called up next — as long as this tab stays open.");
  } else {
    state.notify = false;
    updateNotifyButton();
  }
  saveState();
}

function updateNotifyButton() {
  const btn = document.getElementById('notify-toggle-btn');
  if (!btn) return;
  btn.hidden = !!state.notify;
  btn.textContent = '🔕 Notify me';
  btn.classList.toggle('active', !!state.notify);
  btn.setAttribute('aria-pressed', String(!!state.notify));
}

// changes: [{ team, delta, total }]
function notifyPointChanges(changes) {
  if (!state.notify || !changes.length) return;
  let anyMine = false;
  changes.forEach(({ team, delta, total }) => {
    const mine = team.id === state.followTeam;
    if (mine) anyMine = true;
    const sign = delta > 0 ? '+' : '';
    const msg = `${teamEmoji(team.id)} ${esc(team.name)} ${sign}${delta} pts (now ${total})`;
    showToast(mine ? "Your team scored! " + msg : msg, { mine });
    if (mine) maybeNativeNotification('🏅 Your team scored!', msg, 'camp-points-' + team.id);
  });
  if (anyMine) playMineChime(); else playAlertChime();
}

// changes: [{ game, stage, aId, bId }]
function notifyMatchupChanges(changes) {
  if (!state.notify || !changes.length) return;
  let anyMine = false;
  changes.forEach(({ game, aId, bId }) => {
    const mine = aId === state.followTeam || bId === state.followTeam;
    if (mine) anyMine = true;
    const msg = `${teamEmoji(aId)} ${esc(teamName(aId))} vs ${teamEmoji(bId)} ${esc(teamName(bId))} — ${esc(game.name)}`;
    showToast(mine ? "You're up next! " + msg : "Up next: " + msg, { mine });
    if (mine) maybeNativeNotification('🏅 Your team is up next!', msg, 'camp-matchup-' + game.id);
  });
  if (anyMine) playMineChime(); else playAlertChime();
}

// Dependency-free confetti burst on "it's official" moments. The winning
// team's mascot rains down among token-colored bits. Respects reduced motion.
function celebrate(goldTeamId) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const emoji = goldTeamId != null ? teamEmoji(goldTeamId) : '🎉';
  const colors = ['#3355ff', '#96690a', '#d63b3b', '#6b7280', '#a15c2a', '#e8c15a'];
  const parts = [];
  for (let i = 0; i < 80; i++) {
    const useEmoji = i % 4 === 0;
    parts.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      g: 0.28 + Math.random() * 0.12,
      size: useEmoji ? 20 + Math.random() * 10 : 6 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length], emoji: useEmoji,
    });
  }
  const start = performance.now();
  const DURATION = 1600;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    parts.forEach((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.emoji) {
        ctx.font = p.size + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 0, 0);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    });
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ── Timers & stopwatches ─────────────────────────────────────────
// Kept in memory so they keep running while you browse other games.

const liveTimers = {};  // gameId -> countdown state
const liveWatches = {}; // gameId -> stopwatch state
let tickHandle = null;

// Countdowns are DEVICE-LOCAL (never synced) — each phone runs its own clock.
// Persist so a mid-round reload or an iOS timer-suspend on lock doesn't lose
// the running countdown; on return we recompute from the wall-clock endAt.
const TIMER_KEY = 'campScoreboardTimers';

function saveTimers() {
  try {
    const out = {};
    Object.entries(liveTimers).forEach(([gid, t]) => {
      out[gid] = { endAt: t.endAt || 0, duration: t.duration, remaining: t.remaining, round: t.round, running: t.running, alarming: t.alarming };
    });
    localStorage.setItem(TIMER_KEY, JSON.stringify(out));
  } catch (e) { /* device-local convenience only */ }
}

function rehydrateTimers() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(TIMER_KEY) || '{}'); } catch (e) { saved = {}; }
  const now = Date.now();
  Object.entries(saved).forEach(([gid, t]) => {
    if (!t || typeof t.duration !== 'number') return;
    if (t.running && t.endAt) {
      const remaining = Math.max(0, t.endAt - now);
      if (remaining === 0) {
        // Expired while the app was closed/backgrounded — surface it.
        liveTimers[gid] = { ...t, running: false, remaining: 0, alarming: true };
      } else {
        liveTimers[gid] = { ...t, remaining };
      }
    } else {
      liveTimers[gid] = { ...t };
    }
  });
  if (Object.values(liveTimers).some((t) => t.running)) { ensureTicking(); requestWakeLock(); }
}

// Keep the screen awake while a countdown runs (guarded — not on all browsers).
let wakeLockSentinel = null;
function anyTimerRunning() { return Object.values(liveTimers).some((t) => t.running); }
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLockSentinel && anyTimerRunning()) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    }
  } catch (e) { /* user gesture / permission not available — ignore */ }
}
function releaseWakeLock() {
  if (wakeLockSentinel) { try { wakeLockSentinel.release(); } catch (e) { /* ignore */ } wakeLockSentinel = null; }
}

// When the phone comes back to the foreground: fire alarms for any countdown
// that expired while we were away, resume ticking, and re-acquire the wake lock
// (the browser drops it when the page is hidden).
function onTimersVisible() {
  if (document.hidden) return;
  const now = Date.now();
  let changed = false;
  Object.entries(liveTimers).forEach(([gid, t]) => {
    if (t.running && t.endAt && t.endAt <= now && !t.alarming) {
      t.running = false;
      t.remaining = 0;
      t.alarming = true;
      changed = true;
      playAlarm();
      renderToolsIfCurrent(gid);
    }
  });
  if (changed) saveTimers();
  if (anyTimerRunning()) { ensureTicking(); requestWakeLock(); }
}

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
      saveTimers();
      if (!anyTimerRunning()) releaseWakeLock();
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
  // Live-tracked matches carry their clock ON the Big Board (synced, next to
  // the score) — the separate top-of-page countdown would duplicate it a
  // full screen away from where the ref is scoring.
  const timerHere = g.timer && !g.liveTracker;
  if (timerHere) html += countdownHTML(g);
  if (g.prompts) html += picRoundHTML(g);
  wrap.innerHTML = html;
  if (timerHere) bindCountdown(wrap, g);
  if (g.prompts) bindPicRound(wrap, g);
}

// ── Big Board clock ticker ───────────────────────────────────────
// Updates every visible board clock from the synced clock state. Runs on a
// cheap global interval (see init) so spectators' clocks tick without any
// network traffic; the editor's device sounds the alarm at zero.
function tickBoardClocks() {
  const els = document.querySelectorAll('[data-board-clock]');
  if (!els.length) return;
  els.forEach((el) => {
    const g = gameById(el.dataset.gameId);
    if (!g) return;
    const l = getLiveMatch(g, el.dataset.a, el.dataset.b);
    if (!l.clock) return;
    const rem = clockRemaining(l.clock);
    const prev = Number(el.dataset.prev) || 0;
    el.dataset.prev = rem;
    el.textContent = fmtBoardClock(rem);
    el.classList.toggle('board-clock-zero', rem === 0);
    // Anticipation: amber pulse inside the last minute, heartbeat + board
    // glow inside the last ten seconds (only while actually running).
    const running = !!l.clock.running;
    el.classList.toggle('clock-final-min', running && rem > 10000 && rem <= 60000);
    el.classList.toggle('clock-final-ten', running && rem > 0 && rem <= 10000);
    const board = el.closest('.big-board');
    if (board) board.classList.toggle('board-final-ten', running && rem > 0 && rem <= 10000);
    if (l.clock.running && rem === 0 && prev > 0) {
      // Just hit zero. Editors get the buzzer and stop the synced clock so
      // every device settles on 0:00; viewers only see the pulse.
      if (canEdit()) {
        playAlarm();
        setMatchClock(g, el.dataset.a, el.dataset.b, (c) => { c.running = false; c.remaining = 0; });
        renderAll();
      }
    }
  });
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
      saveTimers();
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
        requestWakeLock();
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
      if (!anyTimerRunning()) releaseWakeLock();
      saveTimers();
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

// Pictionary item source, chosen by the ref before the first team runs:
// 'pregenerated' (the built-in word list), 'own' (ref's own words), or
// 'numbered' (just "Item N", no words). Synced so every ref device agrees.
function picSetupFor(gid) {
  if (!state.picSetup) state.picSetup = {};
  return state.picSetup[gid] || null;
}

// The label to show/caption for drawing item i. Words are only ever shown in
// the ref tools (canEdit) — never to viewers — and in 'numbered' mode there is
// no secret word at all.
function promptLabel(g, i) {
  const s = picSetupFor(g.id);
  const src = s && s.source;
  if (src === 'numbered') return `Item ${i + 1}`;
  if (src === 'own') {
    const w = s.words && s.words[i];
    return (w && String(w).trim()) ? String(w).trim() : `Item ${i + 1}`;
  }
  return (g.prompts && g.prompts[i]) || `Item ${i + 1}`; // pregenerated default
}

function picRoundHTML(g) {
  let w = liveWatches[g.id];
  if (!w) w = liveWatches[g.id] = { running: false, startAt: 0, lapsTotal: 0 };
  const teamId = state.ui.picTeam;
  const round = teamId ? picRound(teamId) : null;
  // Always derive the total from the saved laps — the in-memory copy dies
  // on reload, and a stale 0 here would fill a short total into the score.
  w.lapsTotal = picLapsSum(round);

  const setup = picSetupFor(g.id);
  const anyLaps = state.teams.some((t) => { const r = picRounds()[t.id]; return r && r.laps && r.laps.length; });

  // Ask the ref how the items should be shown, before the first team runs.
  if (!setup) {
    return `<div class="tool-box" data-tool="pic-round">
      <div class="tool-label">🎨 Drawing round</div>
      <div class="pic-setup">
        <p class="pic-setup-q">How should the ${g.prompts.length} drawing items be shown to the ref?</p>
        <div class="pic-setup-opts">
          <button class="secondary-btn" data-pic-source="pregenerated">🎃 Use the built-in list</button>
          <button class="secondary-btn" data-pic-source="own">✏️ Enter our own</button>
          <button class="secondary-btn" data-pic-source="numbered">🔢 Just numbered items</button>
        </div>
        <p class="muted pic-setup-hint">Viewers never see the words either way — only the live times. This locks once a team has started.</p>
      </div>
    </div>`;
  }

  const modeLabel = { pregenerated: 'Built-in list', own: 'Your own items', numbered: 'Numbered items' }[setup.source] || '';
  const modeStrip = `<div class="pic-mode-strip">Items: <strong>${esc(modeLabel)}</strong>${anyLaps ? '' : ' · <button class="link-btn" data-pic-source="reset">change</button>'}</div>`;

  const wordsEditor = setup.source === 'own' ? `
    <details class="pic-words-editor" ${anyLaps ? '' : 'open'}>
      <summary>✏️ Your ${g.prompts.length} items${anyLaps ? '' : ' — type them in'}</summary>
      <div class="pic-words-grid">
        ${Array.from({ length: g.prompts.length }, (_, i) => `
          <label class="pic-word-row"><span class="pic-word-num">${i + 1}.</span>
            <input type="text" data-pic-word="${i}" value="${esc((setup.words && setup.words[i]) || '')}" placeholder="Item ${i + 1}" ${anyLaps ? 'disabled' : ''} />
          </label>`).join('')}
      </div>
    </details>` : '';

  const chips = `<div class="pic-team-chips">${state.teams.map((t) => {
    const r = picRounds()[t.id];
    const status = r && r.done ? ' ✓' : r && r.laps.length ? ` ${r.laps.length}/10` : '';
    return `<button class="team-chip pic-team-chip ${teamId === t.id ? 'selected' : ''}" data-team-id="${t.id}" ${w.running ? 'disabled' : ''}>${esc(t.name)}${status}<span class="chip-sub">${esc(counselorName(t.id))}</span></button>`;
  }).join('')}</div>`;

  let panel = '';
  if (round) {
    const n = round.laps.length;
    if (!round.done) {
      const prompt = promptLabel(g, n);
      const hasWord = prompt !== `Item ${n + 1}`; // numbered / blank-own has no secret word
      panel = `
        <div class="pic-prompt-card">
          <div class="pic-prompt-label">Item ${n + 1} of ${g.prompts.length}</div>
          ${hasWord ? `<div class="pic-prompt-word">${esc(prompt)}</div>` : ''}
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
        <p class="muted pic-export-hint" id="pic-export-status">Each photo gets a harvest banner with the team, the prompt, and their time. Photos live on the phone that took them.</p>`;
    }

    if (round.laps.length) {
      panel += `<div class="pic-items">${round.laps.map((lap, i) => {
        const lbl = promptLabel(g, i);
        const text = lbl === `Item ${i + 1}` ? lbl : `${i + 1}. ${lbl}`;
        return `
        <div class="pic-item-row">
          <span class="pic-item-text">${esc(text)} — ${fmtWatch(lap.ms)}</span>
          <button class="pic-photo-btn ${lap.photo ? 'has-photo' : ''}" data-action="photo" data-lap="${i}">${lap.photo ? '📷 Retake' : '📷 Add photo'}</button>
        </div>`;
      }).join('')}</div>
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
    ${modeStrip}
    ${wordsEditor}
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

  // Item-source chooser (asked before the first team) + custom-word entry.
  box.querySelectorAll('[data-pic-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.picSource;
      if (!state.picSetup) state.picSetup = {};
      if (src === 'reset') {
        delete state.picSetup[g.id];
      } else {
        const prev = state.picSetup[g.id] || {};
        state.picSetup[g.id] = { source: src, words: Array.isArray(prev.words) ? prev.words : [] };
      }
      saveState();
      renderTools(wrap, g);
    });
  });

  box.querySelectorAll('input[data-pic-word]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const s = state.picSetup && state.picSetup[g.id];
      if (!s) return;
      if (!Array.isArray(s.words)) s.words = [];
      s.words[parseInt(inp.dataset.picWord, 10)] = inp.value;
      saveState(); // no full re-render — keep input focus while typing
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

  // The item-source chooser view has no photo input (no team is running yet).
  if (photoInput) {
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
      const out = await composeCaptioned(blob, team, promptLabel(g, i), round.laps[i].ms);
      files.push(new File([out], `${safeFileName(team)}-${safeFileName(promptLabel(g, i))}.jpg`, { type: 'image/jpeg' }));
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
    <div class="matchup-mascots" aria-hidden="true">
      <span class="matchup-mascot">${teamEmoji(aId)}</span>
      <span class="matchup-vs-emoji">⚔️</span>
      <span class="matchup-mascot">${teamEmoji(bId)}</span>
    </div>
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

  const campDate = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  const lines = ['🏅 Camp — ' + campDate];
  lines.push('');
  lines.push(`Standings (🥇 ${MEDAL_POINTS.gold} · 🥈 ${MEDAL_POINTS.silver} · 🥉 ${MEDAL_POINTS.bronze} pts):`);
  ranked.forEach((t, i) => {
    const s = counts[t.id];
    const parts = [`🥇${s.gold} 🥈${s.silver} 🥉${s.bronze}`];
    if (s.verse) parts.push(`📖${s.verse > 0 ? '+' : ''}${s.verse}`);
    if (s.meals) parts.push(`🧽${s.meals > 0 ? '+' : ''}${s.meals}`);
    if (s.custom) parts.push(`✨${s.custom > 0 ? '+' : ''}${s.custom}`);
    lines.push(`${i + 1}) ${teamEmoji(t.id)} ${t.name} · ${s.points} pts (${parts.join(' ')})`);
  });

  const played = state.config.games.filter((g) => state.results[g.id]);
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
    if (isNaN(mm) || isNaN(ss) || ss >= 60 || mm < 0 || ss < 0) return null;
    return mm * 60 + ss;
  }
  const v = parseFloat(str);
  if (isNaN(v) || v < 0) return null; // scores/times are never negative
  return v;
}

function formatScore(game, val) {
  if (game.timeInput) {
    let m = Math.floor(val / 60);
    let s = Math.round((val - m * 60) * 10) / 10;
    if (s >= 60) { m += 1; s -= 60; } // rounding can carry (e.g. 119.97s → 2:00, not 1:60)
    return m + ':' + (s < 10 ? '0' : '') + (Number.isInteger(s) ? s : s.toFixed(1));
  }
  return String(val);
}

// ── Standings (derived from saved results) ───────────────────────

// Extra points per team from the bonus ledger, split by source. Bible
// memorization ('verse') and meal cleanup ('cleanup') each get their own
// standings column, so they're totaled separately rather than lumped into a
// single "bonus" figure; any free-form entry falls in 'custom'.
function bonusBreakdown() {
  const totals = {};
  state.teams.forEach((t) => (totals[t.id] = { verse: 0, meals: 0, custom: 0 }));
  Object.values(state.bonuses || {}).forEach((b) => {
    if (!b || !totals[b.teamId]) return;
    const p = Number(b.points);
    if (isNaN(p)) return;
    const bucket = b.category === 'verse' ? 'verse'
      : b.category === 'cleanup' ? 'meals'
      : 'custom';
    totals[b.teamId][bucket] += p;
  });
  return totals;
}

function medalCounts() {
  const counts = {};
  const extra = bonusBreakdown();
  state.teams.forEach((t) => (counts[t.id] = { gold: 0, silver: 0, bronze: 0, medalPts: 0, verse: 0, meals: 0, custom: 0, bonus: 0, points: 0 }));
  // Iterate entries so we can weight points per game: Messtival games are
  // worth DOUBLE on the scoreboard. Medal *counts* stay raw; only the point
  // value doubles. Results for games no longer in the (editable) catalog are
  // skipped — deleting a game removes its result, but an import/restore can
  // still leave an orphan behind, and a phantom medal with no game to clear
  // it from would corrupt the standings forever.
  Object.entries(state.results).forEach(([id, r]) => {
    if (!r || !r.medals) return;
    const g = gameById(id);
    if (!g) return;
    const mult = g.messtival ? 2 : 1;
    if (counts[r.medals.gold]) { counts[r.medals.gold].gold += 1; counts[r.medals.gold].medalPts += MEDAL_POINTS.gold * mult; }
    if (counts[r.medals.silver]) { counts[r.medals.silver].silver += 1; counts[r.medals.silver].medalPts += MEDAL_POINTS.silver * mult; }
    if (counts[r.medals.bronze]) { counts[r.medals.bronze].bronze += 1; counts[r.medals.bronze].medalPts += MEDAL_POINTS.bronze * mult; }
  });
  state.teams.forEach((t) => {
    const c = counts[t.id];
    const e = extra[t.id] || { verse: 0, meals: 0, custom: 0 };
    c.verse = e.verse;
    c.meals = e.meals;
    c.custom = e.custom;
    c.bonus = e.verse + e.meals + e.custom; // all extras, for the grand total
    c.points = c.medalPts + c.bonus; // grand total drives the leaderboard
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

let lastPointsByTeam = null; // for the remote-change pulse
let remoteJustApplied = false;

function renderStandings() {
  const tbody = document.getElementById('standings-tbody');
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  // Pulse rows whose points changed because of a remote sync (invisible
  // otherwise). Skip the very first render and local edits (those already
  // get confetti / direct feedback).
  const remoteOrigin = remoteJustApplied; // capture before reset — drives change-history logging
  const pulseFromRemote = remoteOrigin && lastPointsByTeam !== null;
  remoteJustApplied = false;
  const changedTeams = []; // {team, delta, total} — for the notify option

  tbody.innerHTML = '';
  ranked.forEach((team, i) => {
    const s = counts[team.id];
    const tr = document.createElement('tr');
    // Podium tint for the top 3 — but only once real points exist, so
    // Monday's all-zero table stays neutral.
    tr.className = i < 3 && s.points > 0 ? 'podium-row podium-' + (i + 1) : '';
    if (team.id === state.followTeam) tr.className += ' following-row';
    if (pulseFromRemote && lastPointsByTeam[team.id] !== undefined && lastPointsByTeam[team.id] !== s.points) {
      tr.className += ' points-pulse';
      changedTeams.push({ team, delta: s.points - lastPointsByTeam[team.id], total: s.points });
    }
    const medalCell = (n) => `<td class="medal-col">${n ? n : '<span class="zero">0</span>'}</td>`;
    // Signed cell for the point-source columns (verse / meals): dim a zero,
    // show a leading + only for positive tallies (deductions keep their −).
    const extraCell = (n) => `<td class="extra-col">${n ? (n > 0 ? '+' + n : n) : '<span class="zero">0</span>'}</td>`;
    tr.innerHTML = `
      <td class="rank-col">${i + 1}</td>
      <td class="team-cell">
        <div class="team-name-line"><span class="team-emoji">${teamEmoji(team.id)}</span> <span class="team-name-text">${esc(team.name)}</span>${team.id === state.followTeam ? ' <span class="following-star" title="You\'re following this team">⭐</span>' : ''}</div>
        ${team.counselor ? `<div class="team-counselor-text">${esc(team.counselor)}</div>` : ''}
      </td>
      <td class="points-col">${s.points}${s.custom ? `<span class="bonus-hint">${s.custom > 0 ? '+' : ''}${s.custom} bonus</span>` : ''}</td>
      ${medalCell(s.gold)}
      ${medalCell(s.silver)}
      ${medalCell(s.bronze)}
      ${extraCell(s.verse)}
      ${extraCell(s.meals)}
    `;
    tbody.appendChild(tr);
  });
  lastPointsByTeam = {};
  ranked.forEach((team) => { lastPointsByTeam[team.id] = counts[team.id].points; });
  renderFollowCard(ranked, counts);
  if (changedTeams.length) notifyPointChanges(changedTeams);
  // Append any local point-total changes to the change-history log. Best-effort:
  // wrapped so a logging failure can never break the standings render.
  try { recordPointHistory(counts, remoteOrigin); } catch (e) { /* never break rendering */ }
}

// ── Change history (append-only log at a SEPARATE Firebase path) ──────────────
// A timestamped record of every point-total change, written to
// campScoreboard/changelog — NOT campScoreboard/state, so it never touches the
// synced scoreboard and can't interfere with the merge/push logic. Only the
// editor device that originates a change logs it (remote merges are skipped —
// the originating device already logged), so there are no duplicates. Writes
// are append-only (push()), so there's no read-modify-write to clobber. Every
// path guards on fbRef and is wrapped in try/catch, so with sync off or on an
// error this is a silent no-op.
let clPrevSnap = null; // last-seen { points, results, bonuses } for diffing

function snapshotForLog(counts) {
  const points = {};
  (state.teams || []).forEach((t) => { points[t.id] = counts[t.id] ? counts[t.id].points : 0; });
  const results = {};
  Object.keys(state.results || {}).forEach((gid) => {
    const r = state.results[gid];
    if (r) results[gid] = r.savedAt || '1';
  });
  const bonuses = {};
  Object.keys(state.bonuses || {}).forEach((id) => {
    const b = state.bonuses[id];
    if (b) bonuses[id] = { category: b.category, label: b.label, points: b.points };
  });
  return { points, results, bonuses };
}

function bonusCauseLabel(b) {
  if (!b) return 'Bonus';
  if (b.label) return b.label;
  if (b.category === 'verse') return 'Memory verse';
  if (b.category === 'cleanup') return 'Meal cleanup';
  return 'Bonus';
}

// Human-readable causes for what changed between two snapshots.
function describeCauses(prev, snap) {
  const causes = [];
  Object.keys(snap.results).forEach((gid) => {
    if (prev.results[gid] !== snap.results[gid]) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result saved');
    }
  });
  Object.keys(prev.results).forEach((gid) => {
    if (!(gid in snap.results)) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result cleared');
    }
  });
  Object.keys(snap.bonuses).forEach((id) => {
    if (!(id in prev.bonuses)) causes.push(bonusCauseLabel(snap.bonuses[id]) + ' — added');
  });
  Object.keys(prev.bonuses).forEach((id) => {
    if (!(id in snap.bonuses)) causes.push(bonusCauseLabel(prev.bonuses[id]) + ' — removed');
  });
  return causes;
}

function recordPointHistory(counts, isRemote) {
  const snap = snapshotForLog(counts);
  const prev = clPrevSnap;
  clPrevSnap = snap;        // always advance the baseline
  if (!prev) return;        // first render is the baseline — never logged
  if (isRemote) return;     // remote merge: the originating device already logged
  if (!canEdit()) return;   // only editors change points (defensive)
  if (!fbRef) return;       // sync off — nowhere to log

  const changed = [];
  Object.keys(snap.points).forEach((tid) => {
    const before = prev.points[tid];
    const after = snap.points[tid];
    if (before !== undefined && before !== after) changed.push({ tid, before, after });
  });
  if (!changed.length) return;

  const causes = describeCauses(prev, snap);
  const reason = causes.length ? causes.join('; ') : 'Points updated';
  const at = new Date().toISOString();
  const by = state.identity || null;
  const logRef = firebase.database().ref('campScoreboard/changelog');
  changed.forEach(({ tid, before, after }) => {
    logRef.push({ at, teamId: tid, team: teamName(tid), delta: after - before, before, after, reason, by })
      .catch(() => { /* offline / rules — the log entry is best-effort */ });
  });
}

// "Your team" summary card — rank, points, and next matchup if one's queued.
function renderFollowCard() {
  const card = document.getElementById('follow-team-card');
  if (!card) return;
  if (state.followTeam === undefined) { card.hidden = true; return; }
  if (state.followTeam === null) {
    card.className = 'follow-team-card';
    card.style.removeProperty('--team-accent');
    card.hidden = false;
    card.innerHTML = `<p class="muted follow-neutral-line">🏳️ Not following a team — <button id="pick-team-link" class="link-btn">pick one</button></p>`;
    const link = document.getElementById('pick-team-link');
    if (link) link.addEventListener('click', openTeamPicker);
    return;
  }
  const team = state.teams.find((t) => t.id === state.followTeam);
  if (!team) { card.hidden = true; return; }
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  const rank = ranked.findIndex((t) => t.id === team.id) + 1;
  const s = counts[team.id];
  const next = findNextMatchupFor(team.id);
  const nextLine = next
    ? `<p class="follow-next-line">⏭️ Up next: vs ${teamEmoji(next.opponentId)} ${esc(teamName(next.opponentId))} in ${esc(next.game.name)}</p>`
    : '';
  const nextCleanup = findNextCleanupFor(team.id);
  const cleanupLine = nextCleanup
    ? `<p class="follow-next-line">🧽 Next meal cleanup:<br>${esc(DAY_NAMES[nextCleanup.day])} ${esc(nextCleanup.meal)}</p>`
    : '';
  const you = state.identity;
  const youLine = you
    ? `<p class="follow-you-line">${esc(you)} <button id="change-identity-link" class="link-btn">Change</button></p>`
    : `<p class="follow-you-line follow-you-empty"><button id="set-identity-link" class="link-btn">🙋 Tell us who you are</button> to see your electives</p>`;
  const shield = teamShield(team.id);
  const crestHtml = shield
    ? `<div class="follow-team-crest"><img class="follow-team-shield" src="${shield}" alt="${esc(team.name)} team shield" width="480" height="667" loading="lazy" decoding="async"></div>`
    : '';
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  const statsLine = `<div class="follow-team-stats">
    <span class="follow-rank-pill">${medal ? medal + ' ' : ''}${ordinal(rank)} place</span>
    <span class="follow-points">${s.points} pts</span>
  </div>`;
  const accent = teamAccent(team.id);
  card.className = 'follow-team-card' + (shield ? ' has-shield' : '');
  if (accent) card.style.setProperty('--team-accent', accent);
  else card.style.removeProperty('--team-accent');
  card.hidden = false;
  card.innerHTML = `
    ${crestHtml}
    <div class="follow-team-body">
      <div class="follow-team-head">
        ${shield ? '' : `<span class="follow-team-emoji">${teamEmoji(team.id)}</span>`}
        <div class="follow-team-headings">
          <div class="follow-team-name">${esc(team.name)}</div>
          ${statsLine}
        </div>
        <button id="change-team-link" class="link-btn follow-change-btn">Change</button>
      </div>
      ${nextLine}
      ${cleanupLine}
      ${youLine}
    </div>
  `;
  const changeBtn = document.getElementById('change-team-link');
  if (changeBtn) changeBtn.addEventListener('click', openTeamPicker);
  const idBtn = document.getElementById('change-identity-link') || document.getElementById('set-identity-link');
  if (idBtn) idBtn.addEventListener('click', openIdentityPicker);
}

// Compact "My electives today" card in the top strip — the stored identity's
// three slots (time · emoji · station, or Break). Hidden when there's nothing
// to show (see myElectivesToday). Rendered from renderAll AND the 30s interval
// so it follows the camp day across a midnight rollover.
function renderMyElectives() {
  const card = document.getElementById('my-electives-card');
  if (!card) return;
  const rows = myElectivesToday();
  if (!rows) { card.hidden = true; card.innerHTML = ''; return; }
  card.hidden = false;
  card.innerHTML = `
    <div class="my-el-head"><span class="my-el-title">⭐ My electives today</span></div>
    <div class="my-el-rows">
      ${rows.map((r) => `
        <div class="my-el-row ${r.onBreak ? 'is-break' : ''}">
          <span class="my-el-time">${r.time}</span>
          <span class="my-el-emoji">${r.emoji}</span>
          <span class="my-el-station">${r.onBreak ? 'Break' : esc(r.station)}</span>
          <span class="my-el-wx">${electiveWxHtml(campNow().dow, r.slot)}</span>
        </div>`).join('')}
    </div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Team + identity picker ────────────────────────────────────────
// A tiny two-step flow in one overlay: first "which team are you rooting
// for?", then (for a real team) "which one are you?" so a counselor's own
// electives can be surfaced. Device-local — shown once after unlocking until
// answered, and reachable again later via the follow-team card. Existing
// followers from before identity shipped get only the name step on next launch.

// Picker step machine (module-local, not persisted).
let pickerStep = 'team';       // 'team' | 'identity'
let pickerTeamId = null;       // team whose counselors the identity step lists
let pickerNotifyToast = null;  // "following…" toast deferred to the final close

function teamPickerOverlayEl() {
  return document.getElementById('team-picker-overlay');
}

function maybeShowTeamPicker() {
  if (state.followTeam === undefined) { openTeamPicker(); return; }
  // Already following a real team but never answered "which one are you?"
  // (a fresh install skips this; existing followers get just the name step).
  if (state.followTeam && state.identity === undefined) openIdentityPicker();
}

function openTeamPicker() {
  pickerStep = 'team';
  pickerNotifyToast = null;
  showPickerOverlay();
}

// Jump straight to the identity step (from the follow card, or the launch
// migration). Only meaningful when a real team is being followed.
function openIdentityPicker() {
  if (!state.followTeam) return;
  pickerStep = 'identity';
  pickerTeamId = state.followTeam;
  pickerNotifyToast = null;
  showPickerOverlay();
}

function showPickerOverlay() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  renderPickerStep();
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true;
}

function closeTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = false;
}

function renderPickerStep() {
  const title = document.querySelector('.team-picker-title');
  const hint = document.querySelector('.team-picker-hint');
  if (pickerStep === 'identity') {
    if (title) title.textContent = '🙋 Which one are you?';
    if (hint) hint.textContent = "So we can show your electives whenever you check in. Just cheering? Skip it.";
    renderIdentityOptions();
  } else {
    if (title) title.textContent = '👋 Which team are you rooting for?';
    if (hint) hint.textContent = "You'll get a heads-up here when they score or get called up next.";
    renderTeamPickerOptions();
  }
}

function renderTeamPickerOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  wrap.innerHTML = state.teams.map((t) =>
    `<button class="team-picker-option ${state.followTeam === t.id ? 'selected' : ''}" data-team-id="${t.id}">
      <span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.followTeam === null ? 'selected' : ''}" data-team-id="">🙅 Neutral / no team</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId || null;
      const turnedOnNotify = id && !state.notify;
      // Switching to a different team invalidates a prior identity — re-ask it.
      if (id !== state.followTeam) state.identity = null;
      state.followTeam = id;
      // Following a team opts you into its alerts — the picker promises a
      // "heads-up when they score or are up next," which only fires when
      // notifications are on. (Neutral leaves the notify setting alone.)
      if (id && !state.notify) enableNotify();
      saveState();
      if (!id) {                       // neutral — no team, so no identity step
        state.identity = null;
        saveState();
        closePickerAndRender(null);
        return;
      }
      if (turnedOnNotify) {
        pickerNotifyToast = `🔔 Following ${teamEmoji(id)} ${teamName(id)} — you'll get alerts here when they score or are up next.`;
      }
      // Advance to the identity step (don't close yet).
      pickerTeamId = id;
      pickerStep = 'identity';
      renderPickerStep();
    });
  });
}

function renderIdentityOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  const names = TEAM_COUNSELORS[pickerTeamId] || [];
  wrap.innerHTML = names.map((n) =>
    `<button class="team-picker-option ${state.identity === n ? 'selected' : ''}" data-counselor="${esc(n)}">
      <span class="chip-emoji">${teamEmoji(pickerTeamId)}</span> ${esc(n)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.identity === null ? 'selected' : ''}" data-counselor="">🙌 Skip — I'm just cheering</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.identity = btn.dataset.counselor || null;
      saveState();
      closePickerAndRender(pickerNotifyToast);
    });
  });
}

function closePickerAndRender(toast) {
  closeTeamPicker();
  renderAll();
  if (toast) showToast(toast);
  pickerNotifyToast = null;
}

function wireTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  const backdrop = overlay.querySelector('.team-picker-backdrop');
  // Only lets the user dismiss without choosing if they've already answered
  // the team question once (skip-by-accident shouldn't leave followTeam
  // unanswered). At the identity step followTeam is already set, so a dismiss
  // there just leaves identity as-is — effectively "skip".
  const dismiss = () => { if (state.followTeam !== undefined) closeTeamPicker(); };
  if (backdrop) backdrop.addEventListener('click', dismiss);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) dismiss();
  });
}

// ── Bonus points (extra points, entered + viewed here) ───────────

const BONUS_CATEGORIES = {
  verse:   { icon: '📖', label: 'Memory verse' },
  cleanup: { icon: '🧽', label: 'Meal cleanup' },
  custom:  { icon: '✨', label: 'Bonus' },
};
// Categories offered in the bonus entry row. 'verse' and 'cleanup' are
// intentionally excluded — they have their own cards (Memory Verse, Meal
// Cleanup) — but stay in BONUS_CATEGORIES so any legacy entry still resolves
// an icon/label. Only free-form 'custom' bonuses are entered here now.
const BONUS_ENTRY_CATEGORIES = ['custom'];

// Form state for the entry row — lives outside state so it isn't synced
// or persisted; the fields persist across adds for fast nightly entry.
let bonusDraft = { category: 'custom', meal: 'Breakfast', teams: [], points: '', custom: '', sign: 1 };

function bonusLabelFor(d) {
  if (d.category === 'verse') return 'Verse memorization';
  if (d.category === 'cleanup') return `${d.meal} cleanup`;
  return (d.custom || '').trim() || 'Bonus';
}

function newBonusId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function renderBonuses() {
  const wrap = document.getElementById('bonus-body');
  if (!wrap) return;
  const d = bonusDraft;

  let entryHTML = '';
  if (canEdit()) {
    const mealRow = d.category === 'cleanup'
      ? `<div class="bonus-meal-row">${['Breakfast', 'Lunch', 'Supper'].map((m) =>
          `<button class="bonus-meal-chip ${d.meal === m ? 'selected' : ''}" data-meal="${m}" aria-pressed="${d.meal === m}">${esc(m)}</button>`).join('')}</div>`
      : '';
    const customRow = d.category === 'custom'
      ? `<input type="text" id="bonus-custom" class="bonus-custom-input" placeholder="What for?" value="${esc(d.custom)}" maxlength="40" />`
      : '';
    // Only show the category chooser if there's more than one category.
    const catRow = BONUS_ENTRY_CATEGORIES.length > 1
      ? `<div class="bonus-cat-row">${BONUS_ENTRY_CATEGORIES.map((key) => { const c = BONUS_CATEGORIES[key]; return `<button class="bonus-cat-chip ${d.category === key ? 'selected' : ''}" data-cat="${key}" aria-pressed="${d.category === key}">${c.icon} ${esc(c.label)}</button>`; }).join('')}</div>`
      : '';
    entryHTML = `
      <div class="bonus-entry">
        ${catRow}
        ${mealRow}
        ${customRow}
        <p class="bonus-entry-hint muted">Pick the team(s) that earned it:</p>
        <div class="bonus-team-chips">
          ${state.teams.map((t) =>
            `<button class="team-chip bonus-team-chip ${d.teams.includes(t.id) ? 'selected' : ''}" data-team-id="${t.id}" aria-pressed="${d.teams.includes(t.id)}"><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}</button>`).join('')}
        </div>
        <div class="bonus-add-row">
          <button id="bonus-sign" type="button" class="bonus-sign-btn ${d.sign < 0 ? 'neg' : ''}" aria-label="${d.sign < 0 ? 'Subtracting points — tap to add' : 'Adding points — tap to subtract'}">${d.sign < 0 ? '−' : '+'}</button>
          <input type="number" id="bonus-points" class="bonus-points-input" inputmode="numeric" placeholder="Points" value="${esc(d.points)}" />
          <button id="bonus-add-btn" class="primary-btn">${d.sign < 0 ? 'Subtract points' : 'Add points'}</button>
        </div>
        <p id="bonus-error" class="entry-error" role="alert" hidden></p>
      </div>`;
  }

  // Verse and cleanup points have their own cards, so this card shows only
  // the free-form 'custom' bonuses in its subtotals and ledger.
  const extra = {};
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category === 'verse' || b.category === 'cleanup') return;
    extra[b.teamId] = (extra[b.teamId] || 0) + (Number(b.points) || 0);
  });
  const withBonus = state.teams.filter((t) => extra[t.id]).sort((a, b) => extra[b.id] - extra[a.id]);
  const subtotalsHTML = withBonus.length
    ? `<div class="bonus-subtotals">${withBonus.map((t) =>
        `<span class="bonus-subtotal-chip">${teamEmoji(t.id)} ${esc(t.name)} <strong>${extra[t.id] > 0 ? '+' : ''}${extra[t.id]}</strong></span>`).join('')}</div>`
    : '';

  const entries = Object.entries(state.bonuses || {})
    .filter(([, b]) => b.category !== 'verse' && b.category !== 'cleanup')
    .sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const ledgerHTML = entries.length
    ? `<ul class="bonus-ledger">${entries.map(([id, b]) => {
        const cat = BONUS_CATEGORIES[b.category] || BONUS_CATEGORIES.custom;
        const when = formatEasternStamp(b.at);
        // Guard against a partially-synced entry (RTDB can prune a field).
        const pts = Number(b.points) || 0;
        return `<li class="bonus-item">
          <span class="bonus-item-main">
            <span class="bonus-item-team">${teamEmoji(b.teamId)} ${esc(teamName(b.teamId))}</span>
            <span class="bonus-item-label">${cat.icon} ${esc(b.label || 'Bonus')}${when ? ` · ${esc(when)}` : ''}</span>
          </span>
          <span class="bonus-item-pts ${pts < 0 ? 'neg' : ''}">${pts > 0 ? '+' : ''}${esc(String(pts))}</span>
          ${canEdit() ? `<button class="bonus-remove-btn" data-bonus-id="${esc(id)}" aria-label="Remove this bonus">✕</button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : `<p class="muted bonus-empty">No bonus points yet.</p>`;

  wrap.innerHTML = entryHTML + subtotalsHTML + ledgerHTML;

  if (canEdit()) bindBonusEntry(wrap);
  wrap.querySelectorAll('.bonus-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bonusId;
      const b = state.bonuses[id];
      if (!b) return;
      const label = b.label || 'Bonus';
      const pts = Number(b.points) || 0;
      // Removals sync everywhere; every other destructive action confirms.
      if (!confirm(`Remove "${label}" (${pts > 0 ? '+' : ''}${pts} pts) for ${teamName(b.teamId)}?`)) return;
      delete state.bonuses[id];
      touchData();
      saveState();
      renderAll();
    });
  });
}

function bindBonusEntry(wrap) {
  const d = bonusDraft;

  wrap.querySelectorAll('.bonus-cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => { d.category = btn.dataset.cat; renderBonuses(); });
  });
  wrap.querySelectorAll('.bonus-meal-chip').forEach((btn) => {
    btn.addEventListener('click', () => { d.meal = btn.dataset.meal; renderBonuses(); });
  });
  wrap.querySelectorAll('.bonus-team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId;
      const i = d.teams.indexOf(id);
      if (i > -1) d.teams.splice(i, 1); else d.teams.push(id);
      renderBonuses();
    });
  });
  const customInput = wrap.querySelector('#bonus-custom');
  if (customInput) customInput.addEventListener('input', () => { d.custom = customInput.value; });
  const ptsInput = wrap.querySelector('#bonus-points');
  if (ptsInput) ptsInput.addEventListener('input', () => { d.points = ptsInput.value; });
  // The iOS numeric keypad has no minus key, so the sign is a toggle button
  // (points can be deducted, e.g. penalties).
  const signBtn = wrap.querySelector('#bonus-sign');
  if (signBtn) signBtn.addEventListener('click', () => { d.sign = d.sign < 0 ? 1 : -1; renderBonuses(); });

  const addBtn = wrap.querySelector('#bonus-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const errEl = wrap.querySelector('#bonus-error');
    const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
    const mag = Math.abs(Number(d.points));
    const pts = d.sign * mag;
    if (!d.teams.length) return showErr('Pick at least one team.');
    if (d.points === '' || isNaN(mag) || mag === 0) return showErr('Enter a non-zero point value.');
    if (!Number.isInteger(pts) || Math.abs(pts) > 100) return showErr('Points must be a whole number from 1 to 100.');
    const label = bonusLabelFor(d);
    const at = new Date().toISOString();
    d.teams.forEach((teamId) => {
      state.bonuses[newBonusId()] = { teamId, category: d.category, label, points: pts, at };
    });
    d.teams = [];
    d.points = '';
    d.sign = 1; // back to the default (+) for the next entry
    if (d.category === 'custom') d.custom = '';
    touchData();
    saveState();
    renderAll();
  });
}

// ── Brownie Points ───────────────────────────────────────────────
// A just-for-fun tally, deliberately unrelated to any game or the
// standings above. Anyone — viewer or editor — can hand one out, but only
// once per page load: this flag lives only in memory, so a refresh quietly
// resets it. Intentionally not disclosed in the UI.
let brownieGivenThisLoad = false;

function renderBrownie() {
  const wrap = document.getElementById('brownie-body');
  if (!wrap) return;
  const usedUp = brownieGivenThisLoad;
  const rowsHTML = state.teams.map((t) => {
    const count = Number((state.brownie || {})[t.id]) || 0;
    return `<button class="brownie-team-btn" data-team-id="${t.id}" ${usedUp ? 'disabled' : ''}>
      <span class="brownie-team-name"><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}</span>
      <span class="brownie-count">🍪 ${count}</span>
    </button>`;
  }).join('');
  wrap.innerHTML = `<div class="brownie-team-list">${rowsHTML}</div>`;
  bindBrownieEntry(wrap);
}

function bindBrownieEntry(wrap) {
  wrap.querySelectorAll('.brownie-team-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (brownieGivenThisLoad) return;
      const teamId = btn.dataset.teamId;
      if (!state.brownie) state.brownie = {};
      state.brownie[teamId] = (Number(state.brownie[teamId]) || 0) + 1;
      brownieGivenThisLoad = true;
      // Deliberately NOT touchData(): a brownie point is just-for-fun, not
      // real scoreboard activity, so it shouldn't bump the footer's "Data
      // last updated" — and not arming the offline-defense path keeps a
      // stale viewer's brownie click from ever pushing stale state over
      // newer remote scores. It still syncs via the normal save→push.
      saveState();
      renderAll();
    });
  });
}

// ── Memory verses ────────────────────────────────────────────────
// The week's theme verse + one memory verse per camp day (Mon–Fri),
// transcribed from the printed "Harvest of the Heart" sheet. Counselors
// read the day's verse here and award points to teams that recite it;
// those points are stored in the bonus ledger under the 'verse' category,
// tagged with the day, so they still flow into the week standings.
const MEMORY_VERSE_THEME = {
  title: 'Harvest of the Heart',
  text: 'I have been crucified with Christ. It is no longer I who live, but Christ who lives in me. And the life I now live in the flesh I live by faith in the Son of God, who loved me and gave himself for me.',
  ref: 'Galatians 2:20 ESV',
};
const MEMORY_VERSES = {
  1: { text: 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God, not a result of works, so that no one may boast.', ref: 'Ephesians 2:8–9 ESV' },
  2: { text: 'We were buried therefore with him by baptism into death, in order that, just as Christ was raised from the dead by the glory of the Father, we too might walk in newness of life.', ref: 'Romans 6:4 ESV' },
  3: { text: 'There is therefore now no condemnation for those who are in Christ Jesus.', ref: 'Romans 8:1 ESV' },
  4: { text: 'And I will give you a new heart, and a new spirit I will put within you. And I will remove the heart of stone from your flesh and give you a heart of flesh. And I will put my Spirit within you, and cause you to walk in my statutes and be careful to obey my rules.', ref: 'Ezekiel 36:26–27 ESV' },
  5: { text: 'If we live by the Spirit, let us also keep in step with the Spirit.', ref: 'Galatians 5:25 ESV' },
};

// Which day's verse the card is showing, and the point-entry draft. Both
// live outside state so they aren't synced or persisted (verseDay defaults
// to today each load).
let verseDay = null;

// dow -> { teamId -> total verse points } from the 'verse' ledger entries.
function versePointsByDay() {
  const map = {};
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category !== 'verse') return;
    const day = Number(b.day) || 0;
    if (!map[day]) map[day] = {};
    map[day][b.teamId] = (map[day][b.teamId] || 0) + (Number(b.points) || 0);
  });
  return map;
}

function renderMemoryVerse() {
  const wrap = document.getElementById('verse-body');
  if (!wrap) return;
  // Default to today's verse (Mon–Fri); fall back to Monday on the weekend.
  if (verseDay == null) {
    const dow = campNow().dow;
    verseDay = (dow >= 1 && dow <= 5) ? dow : 1;
  }
  const verse = MEMORY_VERSES[verseDay];
  const todayDow = campNow().dow;

  const themeHTML = `
    <div class="verse-theme">
      <span class="verse-theme-label">📖 Theme Verse · ${esc(MEMORY_VERSE_THEME.title)}</span>
      <p class="verse-theme-text">“${esc(MEMORY_VERSE_THEME.text)}”</p>
      <p class="verse-theme-ref">${esc(MEMORY_VERSE_THEME.ref)}</p>
    </div>`;

  const dayChips = `<div class="verse-day-row">${[1, 2, 3, 4, 5].map((dow) =>
    `<button class="verse-day-chip ${dow === verseDay ? 'selected' : ''}" data-verse-day="${dow}" aria-pressed="${dow === verseDay}">${DAY_NAMES[dow].slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</button>`).join('')}</div>`;

  const verseBox = `
    <div class="verse-day-card">
      <span class="verse-day-name">${esc(DAY_NAMES[verseDay])}</span>
      <p class="verse-day-text">“${esc(verse.text)}”</p>
      <p class="verse-day-ref">${esc(verse.ref)}</p>
    </div>`;

  // One row per team: the day's verse points, shown exactly once. Editors
  // set a team's points by tapping 0–5 directly (0 clears); no separate
  // pick-teams-then-type flow, no duplicate summary chips + ledger.
  const earned = versePointsByDay()[verseDay] || {};
  const editing = canEdit();
  const hint = editing
    ? `<p class="bonus-entry-hint muted">Tap a team's points for ${esc(DAY_NAMES[verseDay])}'s verse — 0 clears them.</p>`
    : '';
  const rowsHTML = `<div class="pts-grid">${state.teams.map((t) => {
    const pts = earned[t.id] || 0;
    const btns = editing
      ? `<div class="pts-btn-row" data-team-id="${t.id}" role="group" aria-label="${esc(t.name)} verse points">
          ${[0, 1, 2, 3, 4, 5].map((n) =>
            `<button class="pts-btn ${pts === n ? 'selected' : ''}" data-pts="${n}" aria-pressed="${pts === n}">${n}</button>`).join('')}
        </div>`
      : '';
    return `<div class="pts-row">
      <span class="pts-row-team">${teamEmoji(t.id)} ${esc(t.name)}${pts > 5 ? ` <span class="pts-row-total">+${pts}</span>` : (!editing && pts > 0 ? ` <span class="pts-row-total">+${pts}</span>` : '')}</span>
      ${btns}
    </div>`;
  }).join('')}</div>`;
  const anyEarned = state.teams.some((t) => earned[t.id]);
  const emptyHTML = (!editing && !anyEarned)
    ? `<p class="muted bonus-empty">No verse points recorded for ${esc(DAY_NAMES[verseDay])} yet.</p>`
    : '';

  wrap.innerHTML = themeHTML + dayChips + verseBox + hint + (editing || anyEarned ? rowsHTML : '') + emptyHTML;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => { verseDay = parseInt(btn.dataset.verseDay, 10); renderMemoryVerse(); });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.pts-btn-row').dataset.teamId;
      setVersePoints(teamId, verseDay, parseInt(btn.dataset.pts, 10));
    });
  });
}

// Sets a team's verse points for a day to exactly `pts` — replaces any
// existing entries for that (team, day) so the ledger holds one truth.
function setVersePoints(teamId, dow, pts) {
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'verse' && b.teamId === teamId && (Number(b.day) || 0) === dow) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[newBonusId()] = {
      teamId, category: 'verse', label: `${DAY_NAMES[dow]} memory verse`,
      points: pts, at: new Date().toISOString(), day: dow,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Meal cleanup ─────────────────────────────────────────────────
// Each meal, a team is on cleanup. The rota (who cleans which meal each day)
// is fixed data below; points earned are stored in the bonus ledger under the
// 'cleanup' category, tagged with day + meal, so they flow into the week
// standings — same pattern as Memory Verse. A missing meal key = TBA.
const MEAL_CLEANUP_MEALS = ['Breakfast', 'Lunch', 'Supper'];
const MEAL_ICONS = { Breakfast: '🍳', Lunch: '🥪', Supper: '🍲' };
const MEAL_CLEANUP_SCHEDULE = {
  1: { Breakfast: 't5', Lunch: 't4', Supper: 't0' }, // Mon: John Deere's / Pilgrims / Foxes
  2: { Breakfast: 't2', Lunch: 't3', Supper: 't1' }, // Tue: Maples / Pumpkins / Turkey
  3: { Breakfast: 't0', Lunch: 't5', Supper: 't4' }, // Wed: Foxes / John Deere's / Pilgrims
  4: { Breakfast: 't1', Lunch: 't2', Supper: 't3' }, // Thu: Turkey / Maples / Pumpkins
  5: { Breakfast: ['t3', 't4'], Lunch: ['t0', 't1'], Supper: ['t2', 't5'] }, // Fri: (Pumpkin+Pilgrim) / (Foxes+Turkey) / (Maple+John Deere's)
};

// The team assigned to a given day + meal, or null (TBA).
function cleanupAssigned(day, meal) {
  const d = MEAL_CLEANUP_SCHEDULE[day];
  return (d && d[meal]) || null;
}

// Start time of each meal (same across Mon–Fri, per weekdayDaytime above) —
// lets findNextCleanupFor skip a meal that's already started today.
const MEAL_START_MINUTES = { Breakfast: hm(8, 0), Lunch: hm(12, 0), Supper: hm(17, 0) };

// The soonest known meal-cleanup duty for `teamId` (today's remaining meals,
// then the rest of the week) — used by the "Your team" summary card's
// "Next meal cleanup" line. null if nothing's assigned yet (still TBA) or
// the week's meals are done.
function findNextCleanupFor(teamId) {
  if (!teamId) return null;
  const { dow: todayDow, minutes: nowMinutes } = campNow();
  for (let day = Math.max(todayDow, 1); day <= 5; day++) {
    for (const meal of MEAL_CLEANUP_MEALS) {
      if (day === todayDow && MEAL_START_MINUTES[meal] <= nowMinutes) continue;
      const assigned = cleanupAssigned(day, meal);
      const teams = assigned ? (Array.isArray(assigned) ? assigned : [assigned]) : [];
      if (teams.includes(teamId)) return { day, meal };
    }
  }
  return null;
}

// Which day's rota the card is showing + the entry draft (not synced).
let cleanupDay = null;

// day -> { teamId -> total cleanup points } from the 'cleanup' ledger entries.
function cleanupPointsByDay() {
  const map = {};
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category !== 'cleanup') return;
    const day = Number(b.day) || 0;
    if (!map[day]) map[day] = {};
    map[day][b.teamId] = (map[day][b.teamId] || 0) + (Number(b.points) || 0);
  });
  return map;
}

// Total cleanup points recorded for one day + meal.
function cleanupMealPoints(day, meal) {
  let sum = 0;
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category === 'cleanup' && (Number(b.day) || 0) === day && b.meal === meal) {
      sum += Number(b.points) || 0;
    }
  });
  return sum;
}

function renderMealCleanup() {
  const wrap = document.getElementById('cleanup-body');
  if (!wrap) return;
  // Default to today (Mon–Fri, else Monday).
  if (cleanupDay == null) {
    const dow = campNow().dow;
    cleanupDay = (dow >= 1 && dow <= 5) ? dow : 1;
  }
  const todayDow = campNow().dow;

  const dayChips = `<div class="verse-day-row">${[1, 2, 3, 4, 5].map((dow) =>
    `<button class="verse-day-chip ${dow === cleanupDay ? 'selected' : ''}" data-cleanup-day="${dow}" aria-pressed="${dow === cleanupDay}">${DAY_NAMES[dow].slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</button>`).join('')}</div>`;

  const rotaHTML = `<div class="cleanup-rota">${MEAL_CLEANUP_MEALS.map((meal) => {
    const teamIds = cleanupAssigned(cleanupDay, meal);
    const pts = cleanupMealPoints(cleanupDay, meal);
    const teams = teamIds ? (Array.isArray(teamIds) ? teamIds : [teamIds]) : [];
    const teamStr = teams.length > 0
      ? teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ')
      : '<span class="cleanup-tba">TBA</span>';
    return `<div class="cleanup-meal-row">
      <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
      <span class="cleanup-meal-team">${teamStr}</span>
      ${pts ? `<span class="cleanup-meal-pts">+${pts}</span>` : ''}
    </div>`;
  }).join('')}</div>`;

  // The rota IS the interface: one block per meal showing the assigned team,
  // and (for editors) the 0–3 point buttons right on it — no separate meal
  // chips or repeated team list. Viewers see the same rota with +N badges.
  const editing = canEdit();
  const earnedFor = (meal) => {
    const out = {};
    Object.values(state.bonuses || {}).forEach((b) => {
      if (b && b.category === 'cleanup' && (Number(b.day) || 0) === cleanupDay && (b.meal || 'Breakfast') === meal) {
        out[b.teamId] = (out[b.teamId] || 0) + (Number(b.points) || 0);
      }
    });
    return out;
  };

  let entryHTML = '';
  if (editing) {
    entryHTML = MEAL_CLEANUP_MEALS.map((meal) => {
      const assignedIds = cleanupAssigned(cleanupDay, meal);
      const assigned = assignedIds ? (Array.isArray(assignedIds) ? assignedIds : [assignedIds]) : [];
      const earned = earnedFor(meal);
      // Rota team(s) first; then any team that somehow has points for this
      // meal without being on the rota (rota edits, old data) so it stays
      // clearable rather than invisible.
      const rows = assigned.concat(state.teams.map((t) => t.id).filter((id) => earned[id] && !assigned.includes(id)));
      const body = rows.length
        ? rows.map((id) => {
            const pts = earned[id] || 0;
            return `<div class="pts-row">
              <span class="pts-row-team">${teamEmoji(id)} ${esc(teamName(id))}${assigned.includes(id) ? '' : ' <span class="pts-row-total">not on rota</span>'}${pts > 3 ? ` <span class="pts-row-total">+${pts}</span>` : ''}</span>
              <div class="pts-btn-row" data-team-id="${esc(id)}" data-meal="${esc(meal)}" role="group" aria-label="${esc(teamName(id))} ${esc(meal)} cleanup points">
                ${[0, 1, 2, 3].map((n) =>
                  `<button class="pts-btn ${pts === n ? 'selected' : ''}" data-pts="${n}" aria-pressed="${pts === n}">${n}</button>`).join('')}
              </div>
            </div>`;
          }).join('')
        : '<p class="muted bonus-empty">No team on the rota yet.</p>';
      return `<div class="cleanup-meal-block">
        <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
        ${body}
      </div>`;
    }).join('');
  }

  // Legacy cleanup entries with no day (from the old Bonus card) — surface them
  // so their points aren't invisible even though they still count in totals.
  const legacy = Object.entries(state.bonuses || {})
    .filter(([, b]) => b.category === 'cleanup' && !(Number(b.day) >= 1 && Number(b.day) <= 5))
    .sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const legacyHTML = legacy.length
    ? `<p class="bonus-entry-hint muted">Earlier cleanup points (no day set):</p>
       <ul class="bonus-ledger">${legacy.map(([id, b]) => {
        const pts = Number(b.points) || 0;
        return `<li class="bonus-item">
          <span class="bonus-item-main">
            <span class="bonus-item-team">${teamEmoji(b.teamId)} ${esc(teamName(b.teamId))}</span>
            <span class="bonus-item-label">🧽 ${esc(b.label || 'Cleanup')}</span>
          </span>
          <span class="bonus-item-pts">+${esc(String(pts))}</span>
          ${canEdit() ? `<button class="bonus-remove-btn" data-bonus-id="${esc(id)}" aria-label="Remove this cleanup point">✕</button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : '';

  // Editors get the interactive rota (entryHTML); viewers the read-only one.
  wrap.innerHTML = dayChips + (editing ? entryHTML : rotaHTML) + legacyHTML;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      cleanupDay = parseInt(btn.dataset.cleanupDay, 10);
      renderMealCleanup();
    });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.pts-btn-row');
      setCleanupPoints(row.dataset.teamId, cleanupDay, row.dataset.meal, parseInt(btn.dataset.pts, 10));
    });
  });
  wrap.querySelectorAll('.bonus-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bonusId;
      const b = state.bonuses[id];
      if (!b) return;
      const pts = Number(b.points) || 0;
      if (!confirm(`Remove +${pts} cleanup point${pts === 1 ? '' : 's'} for ${teamName(b.teamId)}?`)) return;
      delete state.bonuses[id];
      touchData();
      saveState();
      renderAll();
    });
  });
}

// Sets a team's cleanup points for a day+meal to exactly `pts` — replaces
// any existing entries for that (team, day, meal).
function setCleanupPoints(teamId, dow, meal, pts) {
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'cleanup' && b.teamId === teamId &&
        (Number(b.day) || 0) === dow && (b.meal || 'Breakfast') === meal) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[newBonusId()] = {
      teamId, category: 'cleanup', label: `${DAY_NAMES[dow]} ${meal} cleanup`,
      points: pts, at: new Date().toISOString(), day: dow, meal,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Day tabs + game list ─────────────────────────────────────────

function renderDayTabs() {
  const nav = document.getElementById('day-tabs');
  const days = state.config.days;
  const todayDow = campNow().dow; // camp time, not device time
  if (!days.some((d) => d.id === state.ui.day)) state.ui.day = defaultDay(state.config);

  nav.innerHTML = days.map((d) => {
    const isToday = d.dow === todayDow;
    return `<button class="day-tab ${state.ui.day === d.id ? 'active' : ''}" data-day="${esc(d.id)}" aria-pressed="${state.ui.day === d.id}">
      ${esc(d.name.slice(0, 3))}${isToday ? '<span class="today-dot" title="Today"></span>' : ''}
    </button>`;
  }).join('');

  nav.querySelectorAll('.day-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.day = btn.dataset.day;
      state.ui.gameId = null;
      saveState();
      renderAll();
    });
  });

  const note = document.getElementById('day-note');
  const selected = dayById(state.ui.day);
  const todayDay = days.find((d) => d.dow === todayDow);
  if (!selected) {
    note.hidden = true;
  } else if (!todayDay) {
    note.hidden = false;
    note.textContent = 'No games today — showing ' + selected.name + "'s lineup.";
  } else if (todayDay.id !== state.ui.day) {
    note.hidden = false;
    note.textContent = 'Heads up: today is ' + todayDay.name + ' — you are viewing ' + selected.name + '.';
  } else {
    note.hidden = true;
  }
}

const FORMAT_BADGES = {
  tournament: { label: 'Bracket', cls: 'badge-bracket', variant: 'azure' },
  tally: { label: 'Score entry', cls: 'badge-tally', variant: 'amber' },
  placement: { label: 'Podium pick', cls: 'badge-podium', variant: 'platinum' },
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
  const day = dayById(state.ui.day);
  const dayGames = state.config.games.filter((g) => g.dayId === state.ui.day);
  const knownSessions = state.config.sessions;
  // Defensive: still show games whose session isn't in the configured list.
  const sessions = knownSessions.concat(
    [...new Set(dayGames.map((g) => g.session))].filter((s) => !knownSessions.includes(s))
  );

  let html = '';
  const isMesstival = dayGames.some((g) => g.messtival);
  if (isMesstival) {
    html += `<div class="messtival-banner">🎉 Messtival day — all games are worth DOUBLE points, counted double right here in the standings!</div>`;
  }
  if (day && day.note) {
    html += day.note.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => `<div class="messtival-banner">${esc(l)}</div>`).join('');
  }
  if (!dayGames.length) {
    html += `<p class="muted session-empty">No games scheduled${day ? ' for ' + esc(day.name) : ''} yet.</p>`;
    if (canEdit()) {
      html += `<button id="empty-day-builder-btn" class="link-btn">🛠️ Set up games in Settings</button>`;
    }
  }

  sessions.forEach((session) => {
    const games = dayGames.filter((g) => g.session === session);
    if (!games.length) return;
    html += `<h2 class="session-heading">${esc(session)}</h2>`;
    games.forEach((g) => {
      const status = gameStatus(g);
      const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
      const res = state.results[g.id];
      html += `<button class="game-card ${status}" data-game-id="${esc(g.id)}">
        <div class="game-card-top">
          <span class="game-emoji">${esc(g.emoji)}</span>
          <div class="game-card-titles">
            <span class="game-name">${esc(g.name)}</span>
            <span class="game-loc">📍 ${esc(g.location)}</span>
          </div>
          <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge>
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

  const builderBtn = document.getElementById('empty-day-builder-btn');
  if (builderBtn) builderBtn.addEventListener('click', () => openBuilder('games'));
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

  const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
  const backDay = dayById(g.dayId);
  let html = `
    <button id="back-btn" class="link-btn back-btn">← ${esc(backDay ? backDay.name : 'All')} games</button>
    <div class="game-view-header">
      <span class="game-emoji-lg">${esc(g.emoji)}</span>
      <div>
        <h2>${esc(g.name)}</h2>
        <p class="muted">📍 ${esc(g.location)} · ${esc(g.session)} · <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge></p>
      </div>
    </div>
    ${g.messtival ? '<p class="messtival-tag">🎉 Messtival — double points, counted double here too!</p>' : ''}
    ${(g.rules || []).length ? `<details class="rules-details">
      <summary>How to play</summary>
      ${g.rules.map((sec) => `
        <h4>${esc(sec.h)}</h4>
        <ul>${(sec.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      `).join('')}
    </details>` : ''}
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
  if (canEdit() && (g.timer || g.prompts) && (g.prompts || !state.results[g.id])) {
    renderTools(document.getElementById('tools-area'), g);
  }

  const entry = document.getElementById('entry-area');
  const result = state.results[g.id];
  if (result) {
    renderResult(entry, g, result);
  } else if (!canEdit()) {
    renderLiveWatch(entry, g);
  } else if (g.format === 'tournament') {
    renderTournament(entry, g);
  } else if (g.format === 'tally') {
    renderTally(entry, g);
  } else {
    renderPlacement(entry, g);
  }
}

// Games with a bracket in progress (started, not yet finalized) — surfaced
// as a highlighted "Live now" card at the top of the home screen.
// Ranked live standings for a `liveRankings` tally game (Inflatable Bowling,
// Pictionary), read straight from the synced draft scores so viewers see the
// board climb in real time. For Pictionary the per-team totals are filled by
// the round runner as each team finishes; only times/points are ever exposed —
// never the drawing words.
function tallyRankLive(g) {
  const d = state.drafts && state.drafts[g.id];
  const entries = [];
  if (d && d.scores) {
    state.teams.forEach((t) => {
      const raw = d.scores[t.id];
      if (raw === undefined || String(raw).trim() === '') return;
      const v = parseScoreInput(g, raw);
      if (v !== null) entries.push({ id: t.id, v });
    });
    entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  }
  return entries;
}

function tallyInProgress(g) {
  return !!g.liveRankings && !state.results[g.id] && tallyRankLive(g).length > 0;
}

function liveHomeGames() {
  return state.config.games.filter((g) => {
    const b = state.brackets && state.brackets[g.id];
    if (b && normalizeBracket(b).phase !== 'summary') return true;
    return tallyInProgress(g);
  });
}

// The live-tracked game whose Big Board should take over the top of the
// home screen: in progress, has a current matchup, and the user isn't
// already watching it in the game view (no double board).
function homeBoardGame() {
  const g = liveHomeGames().find((x) => {
    if (!x.liveTracker) return false;
    const b = state.brackets && state.brackets[x.id];
    return b && currentMatchupOf(x, normalizeBracket(b));
  });
  if (!g || state.ui.gameId === g.id) return null;
  return g;
}

// Renders the highlighted "Live now" card(s) at the top of the home screen so
// spectators (and refs) see the current matchup + live score without opening
// the game. Hidden entirely when nothing is live. Kept current by renderAll,
// which fires on every synced update. When a live-tracked match is running,
// the FULL Big Board takes this slot (and the Happening-now banner yields).
function renderLiveHome() {
  const wrap = document.getElementById('live-home');
  if (!wrap) return;
  let games = liveHomeGames();
  if (!games.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;

  let boardHTML = '';
  const bg = homeBoardGame();
  if (bg) {
    const pair = currentMatchupOf(bg, normalizeBracket(state.brackets[bg.id]));
    boardHTML = `<div class="home-board" data-game-id="${esc(bg.id)}" role="button" tabindex="0" aria-label="Open ${esc(bg.name)}">
      <p class="home-board-title">${esc(bg.emoji)} ${esc(bg.name)} <span class="home-board-open">tap to open ›</span></p>
      ${liveTrackerHTML(bg, pair[0], pair[1], true)}
    </div>`;
    games = games.filter((x) => x.id !== bg.id);
  }

  wrap.innerHTML = boardHTML + games.map((g) => {
    if (!(state.brackets && state.brackets[g.id])) return liveHomeTallyCard(g); // tally live board
    const b = normalizeBracket(state.brackets[g.id]);
    const phaseLabel = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final', summary: 'Results' }[b.phase] || '';
    const pair = currentMatchupOf(g, b);
    let scoreHTML;
    if (pair && g.ladderScoring) {
      const l = getLadderMatch(g, pair[0], pair[1]);
      const target = g.ladderScoring.target || 21;
      scoreHTML = `<span class="live-home-score">
        <span class="lh-team">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))}</span>
        <span class="lh-nums">${l.a}<span class="lh-dash">–</span>${l.b}</span>
        <span class="lh-team">${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>
      </span>
      <span class="live-home-sub">First to ${target}</span>`;
    } else if (pair && g.liveTracker) {
      const l = getLiveMatch(g, pair[0], pair[1]);
      const periodLabel = g.liveTracker.periodLabel || 'Inning';
      scoreHTML = `<span class="live-home-score">
        <span class="lh-team">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))}</span>
        <span class="lh-nums">${l.hr[pair[0]] || 0}<span class="lh-dash">–</span>${l.hr[pair[1]] || 0}</span>
        <span class="lh-team">${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>
      </span>
      <span class="live-home-sub">${esc(periodLabel)} ${l.inning} of ${g.liveTracker.innings || 3}${g.liveTracker.outs ? ` · ${outsLabel(l.outs)} · ${teamEmoji(kickingTeamId(l, pair[0], pair[1]))} ${esc(teamName(kickingTeamId(l, pair[0], pair[1])))} ${esc(g.liveTracker.sideLabel || 'up')}` : ''}</span>`;
    } else if (pair) {
      scoreHTML = `<span class="live-home-matchup">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))} <span class="lh-vs">vs</span> ${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>`;
    } else {
      scoreHTML = `<span class="live-home-sub">${phaseLabel} in progress — tap to watch</span>`;
    }
    const nxt = nextMatchupOf(g, b);
    const onDeckHTML = nxt
      ? `<span class="live-home-ondeck">⏭️ Up next: ${teamEmoji(nxt[0])} ${esc(teamName(nxt[0]))} vs ${teamEmoji(nxt[1])} ${esc(teamName(nxt[1]))}</span>`
      : '';
    return `<button class="live-home-card" data-game-id="${esc(g.id)}">
      <span class="live-home-top"><span class="live-home-badge">🔴 LIVE</span><span class="live-home-game">${esc(g.emoji)} ${esc(g.name)} · ${phaseLabel}</span></span>
      ${scoreHTML}
      ${onDeckHTML}
    </button>`;
  }).join('');

  const openGame = (gid) => {
    const g = gameById(gid);
    if (!g) return;
    state.ui.gameId = g.id;
    state.ui.day = g.dayId;
    saveState();
    renderAll();
    const gv = document.getElementById('game-view');
    if (gv) gv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  wrap.querySelectorAll('.live-home-card').forEach((btn) => {
    btn.addEventListener('click', () => openGame(btn.dataset.gameId));
  });
  const hb = wrap.querySelector('.home-board');
  if (hb) {
    hb.addEventListener('click', () => openGame(hb.dataset.gameId));
    hb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openGame(hb.dataset.gameId); });
    const g = gameById(hb.dataset.gameId);
    const b = g && state.brackets[g.id] && normalizeBracket(state.brackets[g.id]);
    const pair = b && currentMatchupOf(g, b);
    if (pair) boardDiffCelebrate(hb.querySelector('.big-board'), g, getLiveMatch(g, pair[0], pair[1]), pair);
  }
}

// Compact "Live now" card for a tally game being scored (Inflatable Bowling,
// Pictionary): the current leader + how many teams are in. Times/points only.
function liveHomeTallyCard(g) {
  const ranked = tallyRankLive(g);
  const top = ranked[0];
  const complete = ranked.length >= state.teams.length;
  const scoreLine = top
    ? `<span class="live-home-score"><span class="lh-team">${teamEmoji(top.id)} ${esc(teamName(top.id))}</span><span class="lh-nums">${esc(formatScore(g, top.v))}</span></span>`
    : '<span class="live-home-sub">Scoring under way…</span>';
  return `<button class="live-home-card" data-game-id="${esc(g.id)}">
    <span class="live-home-top"><span class="live-home-badge">🔴 LIVE</span><span class="live-home-game">${esc(g.emoji)} ${esc(g.name)}</span></span>
    ${scoreLine}
    <span class="live-home-sub">${g.lowerWins ? 'Fastest so far' : 'Leader'} · ${ranked.length}/${state.teams.length} teams in${complete ? ' · 🏅 medals ready' : ''}</span>
  </button>`;
}

// The matchup a bracket is currently waiting on a winner for — used by the
// read-only live-watch view so spectators see who's playing right now.
function currentMatchupOf(g, b) {
  if (!b) return null;
  if (b.phase === 'round1') {
    if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
      return g.roundOneMatchups[(b.matches || []).length] || null;
    }
    return (b.selectedPair && b.selectedPair.length === 2) ? b.selectedPair : null;
  }
  if (b.phase === 'semifinal' && b.semifinal && b.semifinal.winner == null) return [b.semifinal.a, b.semifinal.b];
  if (b.phase === 'championship' && b.championship && b.championship.winner == null) return [b.championship.a, b.championship.b];
  return null;
}

// The matchup that will be played AFTER the current one, when it's already
// known — i.e. the next pair in a fixed-order Round 1. Returns null when the
// next pairing can't be known yet (free pick, or a later stage whose teams
// aren't decided). Drives the "Up next" line under the live score.
function nextMatchupOf(g, b) {
  if (!b || b.phase !== 'round1') return null;
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    return g.roundOneMatchups[(b.matches || []).length + 1] || null;
  }
  return null;
}

// Read-only live view for spectators (no score PIN): the current matchup,
// its live inning/tally (synced from the ref's device), and completed
// matches. Re-rendered by renderAll whenever a synced update lands.
function renderLiveTallyWatch(container, g) {
  const ranked = tallyRankLive(g);
  if (!ranked.length) {
    container.innerHTML = `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)}</p>
      <p class="muted">Live rankings will appear here as the ref enters scores — no refresh needed.</p>
    </div>`;
    return;
  }
  const complete = ranked.length >= state.teams.length;
  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranked.map((e, i) => `
    <li class="lw-rank-row${i < 3 ? ' lw-podium' : ''}">
      <span class="lw-rank">${complete && i < 3 ? medals[i] : (i + 1) + '.'}</span>
      <span class="lw-rank-team">${teamEmoji(e.id)} ${esc(teamName(e.id))}</span>
      <span class="lw-rank-score">${esc(formatScore(g, e.v))}</span>
    </li>`).join('');
  container.innerHTML = `<div class="live-watch live-watch-board">
    <p class="live-watch-label">🔴 Live now · ${esc(g.name)}</p>
    <p class="live-watch-board-sub">${g.lowerWins ? 'Fastest total time' : 'Team totals'} · ${ranked.length}/${state.teams.length} teams in</p>
    <ol class="lw-rank-list">${rows}</ol>
    ${complete
      ? `<p class="live-watch-suggest">🏅 Suggested: 🥇 ${esc(teamName(ranked[0].id))} · 🥈 ${esc(teamName(ranked[1].id))} · 🥉 ${esc(teamName(ranked[2].id))}</p>`
      : '<p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>'}
  </div>`;
}

function renderLiveWatch(container, g) {
  // Tally games with live rankings (Inflatable Bowling, Pictionary) show a
  // read-only leaderboard rather than a bracket matchup.
  if (g.liveRankings && !(state.brackets && state.brackets[g.id])) {
    renderLiveTallyWatch(container, g);
    return;
  }
  const raw = state.brackets && state.brackets[g.id];
  if (!raw) {
    container.innerHTML = `<p class="view-only-note">👀 View-only. This game hasn't been scored yet. Tap <strong>🔒 View only</strong> at the top and enter the score PIN to run it.</p>`;
    return;
  }
  const b = normalizeBracket(raw);
  const phaseLabel = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final', summary: 'Results' }[b.phase] || '';
  const pair = currentMatchupOf(g, b);

  const done = (b.matches || []).map((m) =>
    `<li>${teamEmoji(m.winner)} ${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('');
  const doneHTML = done ? `<div class="live-watch-done"><p class="muted">Completed:</p><ul>${done}</ul></div>` : '';

  if (!pair) {
    container.innerHTML = `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)} — ${phaseLabel} in progress</p>
      <p class="muted">Waiting for the next matchup…</p>
      ${doneHTML}
    </div>`;
    return;
  }

  let scoreHTML;
  if (g.ladderScoring) {
    const l = getLadderMatch(g, pair[0], pair[1]);
    const target = g.ladderScoring.target || 21;
    scoreHTML = `
      <div class="live-watch-score">
        <div class="lw-team">${teamEmoji(pair[0])}<span class="lw-name">${esc(teamName(pair[0]))}</span></div>
        <div class="lw-nums"><span class="lw-num">${l.a}</span><span class="lw-dash">–</span><span class="lw-num">${l.b}</span></div>
        <div class="lw-team">${teamEmoji(pair[1])}<span class="lw-name">${esc(teamName(pair[1]))}</span></div>
      </div>
      <p class="live-watch-inning">First to exactly ${target}</p>`;
  } else if (g.liveTracker) {
    // Spectators get the full Big Board — giant scores, the live clock, and
    // the goal celebrations — display-only and sized to own the screen.
    scoreHTML = liveTrackerHTML(g, pair[0], pair[1], true);
  } else {
    scoreHTML = `<div class="live-watch-matchup">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))} <span class="lw-vs">vs</span> ${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</div>`;
  }

  const nxt = nextMatchupOf(g, b);
  const onDeckHTML = nxt
    ? `<p class="live-watch-ondeck">⏭️ Up next: ${teamEmoji(nxt[0])} ${esc(teamName(nxt[0]))} vs ${teamEmoji(nxt[1])} ${esc(teamName(nxt[1]))}</p>`
    : '';

  container.innerHTML = `
    <div class="live-watch">
      ${g.liveTracker ? '' : `<p class="live-watch-label">🔴 Live now · ${phaseLabel}</p>`}
      ${scoreHTML}
      ${onDeckHTML}
      <p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>
      ${doneHTML}
    </div>`;

  const boardEl = container.querySelector('.big-board');
  if (boardEl && g.liveTracker) {
    boardDiffCelebrate(boardEl, g, getLiveMatch(g, pair[0], pair[1]), pair);
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

function medalPickerHTML(picks, game) {
  const mult = game && game.messtival ? 2 : 1; // Messtival doubles the points
  const slots = [
    { key: 'gold', label: `🥇 Gold · ${MEDAL_POINTS.gold * mult} pts` },
    { key: 'silver', label: `🥈 Silver · ${MEDAL_POINTS.silver * mult} pts` },
    { key: 'bronze', label: `🥉 Bronze · ${MEDAL_POINTS.bronze * mult} pts` },
  ];
  return `<div class="medal-picker">
    ${slots.map((s) => `
      <label class="medal-slot medal-slot-${s.key}">
        <span>${s.label}</span>
        <select data-medal="${s.key}">
          <option value="">— pick team —</option>
          ${state.teams.map((t) =>
            `<option value="${t.id}" ${picks[s.key] === t.id ? 'selected' : ''}>${teamEmoji(t.id)} ${esc(t.name)}</option>`
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
            <span class="score-team"><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}<span class="chip-sub">${esc(t.counselor || '')}</span></span>
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
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
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
    // Push the moment the field loses focus, so the value lands on the server
    // right away rather than waiting out the debounce.
    input.addEventListener('blur', flushPendingPush);
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
    celebrate(picks.gold);
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
      `<span class="rank-pill">${i + 1}. ${teamEmoji(e.id)} ${esc(teamName(e.id))} · ${formatScore(g, e.v)}</span>`).join('')}</div>` : ''}
    ${tieNote}
    <h3 class="medal-picker-heading">Medals ${ranked.length >= 3 ? '<span class="unit-tag">(auto-filled from scores)</span>' : ''}</h3>
    ${medalPickerHTML(picks, g)}
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
    <div id="placement-medals">${medalPickerHTML(draft.medals, g)}</div>
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
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
    celebrate(picks.gold);
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

// A live match tally: { key, inning, hr: {teamId: n} }. RTDB prunes an
// empty hr map and a 0/absent inning, so heal them after a round-trip.
function normalizeLiveMatch(l) {
  if (l && l.mode === 'ladder') {
    // Ladder Ball match: running totals + this-round raw points + a round log
    // for undo. RTDB prunes zeros/empty arrays, so coerce everything back.
    if (typeof l.a !== 'number' || l.a < 0) l.a = 0;
    if (typeof l.b !== 'number' || l.b < 0) l.b = 0;
    if (typeof l.ra !== 'number' || l.ra < 0) l.ra = 0;
    if (typeof l.rb !== 'number' || l.rb < 0) l.rb = 0;
    if (!Array.isArray(l.log)) l.log = [];
    return l;
  }
  if (!l.hr) l.hr = {};
  if (typeof l.inning !== 'number' || l.inning < 1) l.inning = 1;
  if (typeof l.outs !== 'number' || l.outs < 0) l.outs = 0;
  if (l.half !== 1) l.half = 0; // 0 = first team kicking, 1 = second team
  return l;
}

// One sweep over every synced shape that can carry pruned-empty fields.
// Called after loading from localStorage and after every remote merge.
function normalizeSyncedState() {
  Object.values(state.brackets || {}).forEach(normalizeBracket);
  Object.values(state.picRounds || {}).forEach(normalizePicRound);
  Object.values(state.drafts || {}).forEach(normalizeDraft);
  if (!state.bonuses) state.bonuses = {}; // RTDB prunes an empty ledger to nothing
  if (!state.brownie) state.brownie = {}; // RTDB prunes an empty tally map to nothing
  if (!state.picSetup) state.picSetup = {}; // RTDB prunes an empty map to nothing
  // RTDB can round-trip a sparse `words` array back as an object — re-array it.
  Object.values(state.picSetup).forEach((s) => {
    if (!s) return;
    if (Array.isArray(s.words)) return;
    if (s.words && typeof s.words === 'object') {
      const arr = [];
      Object.keys(s.words).forEach((k) => { arr[+k] = s.words[k]; });
      s.words = arr;
    } else {
      s.words = [];
    }
  });
  if (!state.live) state.live = {}; // RTDB prunes an empty live map to nothing
  Object.values(state.live).forEach(normalizeLiveMatch);
  // Migrate rosters saved before names/counselors were set: swap generic
  // "Team N" names and placeholder counselors for the real roster values.
  // Anything hand-edited (not matching a known placeholder) is left alone.
  (state.teams || []).forEach((t, i) => {
    const oldNames = OLD_PLACEHOLDER_TEAM_NAMES[i];
    if (oldNames && oldNames.indexOf(t.name) !== -1 && DEFAULT_TEAM_NAMES[i]) {
      t.name = DEFAULT_TEAM_NAMES[i];
    }
    if (t.counselor === undefined || t.counselor === OLD_PLACEHOLDER_COUNSELORS[i]) {
      t.counselor = DEFAULT_COUNSELORS[i] || '';
    }
  });
}

function renderTournament(container, g) {
  if (!state.brackets[g.id]) {
    // The bracket wizard's phases (3 first-round matches → bye → semifinal →
    // championship) assume exactly 6 teams; with any other count it saves
    // corrupt results. Block starting rather than corrupting.
    if (state.teams.length !== 6) {
      container.innerHTML = `
        <h3>Run the bracket</h3>
        <p class="tie-note">⚠️ The bracket wizard needs exactly 6 teams — you have ${state.teams.length}. Adjust the roster in Settings → Set up the week, or switch this game to another format.</p>
      `;
      return;
    }
    container.innerHTML = `
      <h3>Run the bracket</h3>
      <p class="muted">Three first-round matches, then the medal round. The bye goes to the Round&nbsp;1 winner with the fewest points this week — the app suggests who, using the live standings.</p>
      <button id="start-bracket-btn" class="primary-btn">Start Bracket</button>
    `;
    document.getElementById('start-bracket-btn').addEventListener('click', () => {
      state.brackets[g.id] = freshBracket();
      clearLiveMatch(g); // a new bracket starts with a clean tally
      saveState();
      renderAll();
    });
    return;
  }

  const b = normalizeBracket(state.brackets[g.id]);
  let html = `<div class="bracket-steps">
    ${['round1', 'bye', 'semifinal', 'championship', 'summary'].map((p, i) => {
      const labels = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship', championship: 'Final', summary: 'Results' };
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
    clearLiveMatch(g);
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

// ── Live match scorekeeper (innings + per-team tally) ────────────
// The ref taps the innings/tally as a match runs; it's synced like the rest
// of the scoreboard (state.live in SYNC_KEYS) so anyone with the app open —
// counselors or spectators — watches it update in real time, with
// localStorage as the offline backup. Keyed by game + matchup, so moving to
// the next matchup starts a fresh tally.

function getLiveMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.key === key) {
    return { key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: Object.assign({}, l.hr), clock: l.clock || null };
  }
  return { key, inning: 1, outs: 0, half: 0, hr: {}, clock: null };
}

function setLiveMatch(g, l) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: l.hr || {}, clock: l.clock || null };
  touchData();
  saveState();
}

// ── Synced match clock ───────────────────────────────────────────
// The half/game clock lives INSIDE the live match state so every device
// (refs and spectators alike) sees it tick. Only the endAt timestamp and
// running flag sync — each device computes the remaining time locally, so
// nothing writes to the network while the clock runs.
//   clock = { running, endAt (epoch ms), remaining (ms, when paused), duration (ms) }

function clockRemaining(clock) {
  if (!clock) return 0;
  if (clock.running) return Math.max(0, (Number(clock.endAt) || 0) - Date.now());
  return Math.max(0, Number(clock.remaining) || 0);
}

function defaultClock(g) {
  const secs = (g.timer && g.timer.presets && g.timer.presets[0]) || 600;
  return { running: false, endAt: 0, remaining: secs * 1000, duration: secs * 1000 };
}

function setMatchClock(g, aId, bId, mutate) {
  const l = getLiveMatch(g, aId, bId);
  const clock = l.clock || defaultClock(g);
  mutate(clock);
  l.clock = clock;
  setLiveMatch(g, l);
}

// ── Ladder Ball match (per-round cancellation, first to exactly 21) ──
// Same live/synced model as the kickball tracker, but a different shape:
// running totals a/b, this-round raw points ra/rb, and a log of scored rounds
// for undo. Keyed by matchup so a new pairing starts fresh.
function getLadderMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.mode === 'ladder' && l.key === key) {
    return { key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log.slice() : [] };
  }
  return { key, mode: 'ladder', a: 0, b: 0, ra: 0, rb: 0, log: [] };
}

function setLadderMatch(g, l) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log : [] };
  touchData();
  saveState();
}

// The team id that has reached the target (won), or null. Overshoot holds, so
// totals never exceed the target, but >= keeps this robust.
function ladderWinnerId(g, l, aId, bId) {
  const target = (g.ladderScoring && g.ladderScoring.target) || 21;
  if (l.a >= target) return aId;
  if (l.b >= target) return bId;
  return null;
}

// The team currently kicking, given the half (0 = first team, 1 = second).
function kickingTeamId(l, aId, bId) {
  return (Number(l.half) || 0) === 1 ? bId : aId;
}

// "2 outs" / "1 out" / "0 outs"
function outsLabel(n) {
  return `${n} out${n === 1 ? '' : 's'}`;
}

// Filled/empty pips for the outs display, e.g. ●●○ for 2 of 3.
function outsPips(n, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '●' : '○';
  return s;
}

function clearLiveMatch(g) {
  if (state.live && state.live[g.id]) {
    delete state.live[g.id];
    saveState();
  }
}

// ── The Big Board ────────────────────────────────────────────────
// One joyful scoreboard for live-tracked matches: giant scores, the match
// clock right beneath them (synced — spectators see it tick), and a burst
// of team-emoji confetti when a goal goes up. Editors get steppers and
// clock controls on the same card; viewers get the same board, display
// only, sized to fill over half the screen.

// Last rendered scores per game+matchup, so a score that went UP —
// whether tapped here or arriving over sync — triggers the celebration.
let lastBoardScores = {};

function fmtBoardClock(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// GOAL! Pop the scoring team's number and fire the emoji cannons: two
// volleys from the board's bottom corners arcing up and across, mixing the
// team's mascot with party emoji.
function boardCelebrate(boardEl, teamId) {
  if (!boardEl) return;
  const col = boardEl.querySelector(`[data-board-col="${teamId}"]`);
  const val = col && col.querySelector('.board-score');
  if (val) {
    val.classList.remove('score-pop');
    void val.offsetWidth; // restart the animation
    val.classList.add('score-pop');
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const mascot = teamEmoji(teamId);
  const extras = ['🎉', '🎊', '✨', '⭐'];
  const H = boardEl.getBoundingClientRect().height || 300;
  for (let i = 0; i < 24; i++) {
    const fromLeft = i % 2 === 0;
    const p = document.createElement('span');
    p.className = 'board-cannon';
    p.textContent = i % 3 === 0 ? extras[(i / 3 | 0) % extras.length] : mascot;
    // Launch angle 50°–85° from the corner, aimed inward; distance scales
    // with the board so the spray fills tall spectator boards too.
    const angle = (50 + Math.random() * 35) * Math.PI / 180;
    const dist = H * (0.55 + Math.random() * 0.55);
    const dx = Math.cos(angle) * dist * (fromLeft ? 1 : -1);
    const dy = -Math.sin(angle) * dist;
    p.style.setProperty('--tx', dx.toFixed(0) + 'px');
    p.style.setProperty('--ty', dy.toFixed(0) + 'px');
    p.style.setProperty('--br', (Math.random() * 480 - 240).toFixed(0) + 'deg');
    p.style.setProperty('--bd', (1.0 + Math.random() * 0.6).toFixed(2) + 's');
    p.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
    p.style[fromLeft ? 'left' : 'right'] = '4px';
    boardEl.appendChild(p);
    setTimeout(() => p.remove(), 2100);
  }
}

// Compare current scores to the last render and celebrate any increase.
function boardDiffCelebrate(boardEl, g, l, pair) {
  const memoKey = g.id + '|' + l.key;
  const prev = lastBoardScores[memoKey] || {};
  pair.forEach((id) => {
    const now = Number(l.hr[id]) || 0;
    if (prev[id] !== undefined && now > prev[id]) {
      boardCelebrate(boardEl, id);
    }
  });
  lastBoardScores = { [memoKey]: { [pair[0]]: Number(l.hr[pair[0]]) || 0, [pair[1]]: Number(l.hr[pair[1]]) || 0 } };
}

function liveTrackerHTML(g, aId, bId, viewer) {
  if (!g.liveTracker) return '';
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;
  const sideLabel = g.liveTracker.sideLabel || 'up';
  const periodLabel = g.liveTracker.periodLabel || 'Inning';
  const l = getLiveMatch(g, aId, bId);
  const clock = g.timer ? (l.clock || defaultClock(g)) : null;
  const remaining = clock ? clockRemaining(clock) : 0;

  const col = (id) => `
    <div class="board-col" data-board-col="${esc(id)}" style="--team-accent: ${TEAM_ACCENT[id] || 'var(--color-primary)'}">
      <span class="board-emoji">${teamEmoji(id)}</span>
      <span class="board-name">${esc(teamName(id))}</span>
      <span class="board-score" data-hr-team="${esc(id)}">${l.hr[id] || 0}</span>
      ${viewer ? '' : `<div class="board-stepper">
        <button class="live-btn" data-live="hr-down" data-team="${esc(id)}" aria-label="Subtract from ${esc(teamName(id))}">−</button>
        <button class="live-btn board-plus" data-live="hr-up" data-team="${esc(id)}" aria-label="Add to ${esc(teamName(id))}">+</button>
      </div>`}
    </div>`;

  const periodRow = viewer
    ? `<span class="board-period">${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}</span>`
    : `<span class="board-period">
        <button class="live-btn" data-live="inning-down" aria-label="Previous ${esc(periodLabel.toLowerCase())}">−</button>
        ${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}
        <button class="live-btn" data-live="inning-up" aria-label="Next ${esc(periodLabel.toLowerCase())}">+</button>
      </span>`;

  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-board-clock data-game-id="${esc(g.id)}" data-a="${esc(aId)}" data-b="${esc(bId)}" data-prev="${remaining}">${fmtBoardClock(remaining)}</span>
      ${viewer ? '' : `
        ${!clock.running && (g.timer.presets || []).length > 1 ? `<div class="preset-row">${g.timer.presets.map((p) =>
          `<button class="preset-chip ${clock.duration === p * 1000 ? 'selected' : ''}" data-clock="preset" data-secs="${p}">${fmtBoardClock(p * 1000)}</button>`).join('')}</div>` : ''}
        <div class="board-clock-btns">
          ${clock.running
            ? `<button class="timer-main-btn" data-clock="pause">⏸ Pause</button>`
            : `<button class="timer-main-btn" data-clock="start">▶ ${remaining === clock.duration ? 'Start' : remaining === 0 ? 'Restart' : 'Resume'}</button>`}
          ${remaining !== clock.duration ? `<button class="timer-side-btn" data-clock="reset">↺ Reset</button>` : ''}
        </div>`}
    </div>` : '';

  const kickingRow = maxOuts ? `
    <div class="board-subrow">
      <span class="live-label">${esc(sideLabel.charAt(0).toUpperCase() + sideLabel.slice(1))}</span>
      <span class="live-kicking-team" id="live-kicking-team">${teamEmoji(kickingTeamId(l, aId, bId))} ${esc(teamName(kickingTeamId(l, aId, bId)))}</span>
      ${viewer ? '' : `<button class="live-btn live-switch-btn" data-live="half-toggle" aria-label="Switch ${esc(sideLabel)} team">⇄</button>`}
    </div>
    <div class="board-subrow">
      <span class="live-label">Outs</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-down" aria-label="Remove an out">−</button>`}
      <span class="live-outs-pips" id="live-outs-pips" aria-label="${outsLabel(l.outs)}">${outsPips(l.outs, maxOuts)}</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-up" aria-label="Add an out">+</button>`}
    </div>` : '';

  return `<div class="big-board ${viewer ? 'viewer' : ''}" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="live-home-badge">🔴 LIVE</span>
      ${periodRow}
    </div>
    <div class="board-cols">
      ${col(aId)}
      <span class="board-dash">–</span>
      ${col(bId)}
    </div>
    ${clockHTML}
    ${kickingRow}
    ${viewer ? '' : '<button class="live-reset link-btn" data-live="reset">Reset tally</button>'}
  </div>`;
}

function bindLiveTracker(container, g, aId, bId) {
  if (!g.liveTracker) return;
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;

  // Celebrate any score increase that arrived since the last render (a
  // remote ref's goal, or a full re-render after a local one).
  const boardEl = container.querySelector('.big-board');
  if (boardEl) boardDiffCelebrate(boardEl, g, getLiveMatch(g, aId, bId), [aId, bId]);

  // Clock controls re-render the whole view (their buttons change shape);
  // the running display itself ticks via the global board-clock interval.
  container.querySelectorAll('[data-clock]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.clock;
      setMatchClock(g, aId, bId, (c) => {
        if (act === 'start') {
          if (clockRemaining(c) === 0) c.remaining = c.duration; // restart from full
          c.endAt = Date.now() + clockRemaining(c);
          c.running = true;
        } else if (act === 'pause') {
          c.remaining = clockRemaining(c);
          c.running = false;
        } else if (act === 'reset') {
          cutAllSound();
          c.running = false;
          c.remaining = c.duration;
        } else if (act === 'preset') {
          c.duration = (Number(btn.dataset.secs) || 600) * 1000;
          c.remaining = c.duration;
          c.running = false;
        }
      });
      renderAll();
    });
  });

  const refresh = () => {
    const l = getLiveMatch(g, aId, bId);
    const iv = container.querySelector('#live-inning-val');
    if (iv) iv.textContent = l.inning;
    const op = container.querySelector('#live-outs-pips');
    if (op) { op.textContent = outsPips(l.outs, maxOuts); op.setAttribute('aria-label', outsLabel(l.outs)); }
    const kt = container.querySelector('#live-kicking-team');
    if (kt) { const kid = kickingTeamId(l, aId, bId); kt.textContent = `${teamEmoji(kid)} ${teamName(kid)}`; }
    container.querySelectorAll('[data-hr-team]').forEach((el) => {
      el.textContent = l.hr[el.dataset.hrTeam] || 0;
    });
    const memoKey = g.id + '|' + l.key;
    lastBoardScores = { [memoKey]: { [aId]: Number(l.hr[aId]) || 0, [bId]: Number(l.hr[bId]) || 0 } };
  };
  container.querySelectorAll('[data-live]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.live;
      const team = btn.dataset.team;
      const l = getLiveMatch(g, aId, bId);
      if (act === 'inning-up') l.inning = Math.min(maxInn, (Number(l.inning) || 1) + 1);
      else if (act === 'inning-down') l.inning = Math.max(1, (Number(l.inning) || 1) - 1);
      else if (act === 'half-toggle') { l.half = (Number(l.half) || 0) === 1 ? 0 : 1; l.outs = 0; }
      else if (act === 'out-up') {
        const o = (Number(l.outs) || 0) + 1;
        if (o >= maxOuts) {
          if ((Number(l.half) || 0) === 0) {
            // First team retired — the second team kicks (same inning).
            l.half = 1;
            l.outs = 0;
          } else if ((Number(l.inning) || 1) < maxInn) {
            // Both teams have kicked — roll to the next inning, first team up.
            l.inning = (Number(l.inning) || 1) + 1;
            l.half = 0;
            l.outs = 0;
          } else {
            l.outs = maxOuts; // final inning, both sides done: hold at the limit
          }
        } else {
          l.outs = o;
        }
      }
      else if (act === 'out-down') l.outs = Math.max(0, (Number(l.outs) || 0) - 1);
      else if (act === 'hr-up') l.hr[team] = (Number(l.hr[team]) || 0) + 1;
      else if (act === 'hr-down') l.hr[team] = Math.max(0, (Number(l.hr[team]) || 0) - 1);
      else if (act === 'reset') { l.inning = 1; l.outs = 0; l.half = 0; l.hr = {}; }
      setLiveMatch(g, l);
      refresh();
      if (act === 'hr-up') {
        boardCelebrate(container.querySelector('.big-board'), team);
      }
    });
  });
}

// Ladder Ball round scorer. Both teams tap the rungs they landed this round
// (Top 3 / Mid 2 / Bottom 1); "Score round" applies cancellation — the higher
// raw total cancels the lower and the winner banks the difference — with the
// exactly-21 rule (a round that would push a team past 21 is a bust and holds
// their score). Totals sync live so spectators watch them climb.
function ladderMatchHTML(g, aId, bId) {
  if (!g.ladderScoring) return '';
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const l = getLadderMatch(g, aId, bId);
  const winner = ladderWinnerId(g, l, aId, bId);
  const teamBlock = (id, side, total, raw) => `
    <div class="ladder-team">
      <div class="ladder-team-head">
        <span class="ladder-team-name">${teamEmoji(id)} ${esc(teamName(id))}</span>
        <span class="ladder-total" data-ladder-total="${side}">${total}</span>
      </div>
      <div class="ladder-round-line">This round: <span class="ladder-round-val" data-ladder-round="${side}">${raw}</span></div>
      <div class="ladder-rungs">
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.top}">Top +${sc.top}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.mid}">Mid +${sc.mid}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.bottom}">Bot +${sc.bottom}</button>
        <button class="live-btn ladder-clear" data-ladder="round-clear" data-side="${side}" aria-label="Clear this round for ${esc(teamName(id))}">↺</button>
      </div>
    </div>`;
  const wonBanner = winner
    ? `<p class="ladder-won">🏆 ${teamEmoji(winner)} ${esc(teamName(winner))} reached ${target}! Tap their <strong>“won”</strong> button above to lock it in.</p>`
    : '';
  return `<div class="ladder-tracker">
    <p class="ladder-target">🪜 First to exactly ${target} · cancellation scoring each round</p>
    <div class="ladder-teams">
      ${teamBlock(aId, 'a', l.a, l.ra)}
      ${teamBlock(bId, 'b', l.b, l.rb)}
    </div>
    <button class="primary-btn ladder-score-round" data-ladder="score-round"${winner ? ' disabled' : ''}>Score this round</button>
    ${l.log.length ? '<button class="link-btn ladder-undo" data-ladder="undo-round">Undo last round</button>' : ''}
    ${wonBanner}
  </div>`;
}

function bindLadderMatch(container, g, aId, bId) {
  if (!g.ladderScoring) return;
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const refresh = () => {
    const l = getLadderMatch(g, aId, bId);
    const set = (sel, v) => { const el = container.querySelector(sel); if (el) el.textContent = v; };
    set('[data-ladder-total="a"]', l.a);
    set('[data-ladder-total="b"]', l.b);
    set('[data-ladder-round="a"]', l.ra);
    set('[data-ladder-round="b"]', l.rb);
  };
  // Pre-highlight the winning team's "won" button once a team hits 21, so the
  // ref knows exactly which one advances the bracket.
  const highlightWinner = () => {
    const w = ladderWinnerId(g, getLadderMatch(g, aId, bId), aId, bId);
    container.querySelectorAll('.winner-btn').forEach((btn) => {
      btn.classList.toggle('winner-ready', w != null && btn.dataset.winner === w);
    });
  };
  container.querySelectorAll('[data-ladder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.ladder;
      const l = getLadderMatch(g, aId, bId);
      if (act === 'rung') {
        const pts = Number(btn.dataset.pts) || 0;
        if (btn.dataset.side === 'a') l.ra += pts; else l.rb += pts;
      } else if (act === 'round-clear') {
        if (btn.dataset.side === 'a') l.ra = 0; else l.rb = 0;
      } else if (act === 'score-round') {
        const delta = Math.abs(l.ra - l.rb);
        const winSide = l.ra > l.rb ? 'a' : l.rb > l.ra ? 'b' : null;
        if (winSide && delta > 0) {
          const cur = winSide === 'a' ? l.a : l.b;
          const next = cur + delta;
          const applied = next <= target; // bust (over 21) holds the score
          if (applied) { if (winSide === 'a') l.a = next; else l.b = next; }
          l.log.push({ ra: l.ra, rb: l.rb, winner: winSide, delta, applied });
        } else {
          l.log.push({ ra: l.ra, rb: l.rb, winner: null, delta: 0, applied: true });
        }
        l.ra = 0; l.rb = 0;
      } else if (act === 'undo-round') {
        const last = l.log.pop();
        if (last && last.winner && last.applied) {
          if (last.winner === 'a') l.a = Math.max(0, l.a - last.delta);
          else l.b = Math.max(0, l.b - last.delta);
        }
      }
      setLadderMatch(g, l);
      // A rung/clear tap only changes numbers — refresh in place to stay snappy
      // and keep scroll position. Scoring or undoing a round can flip the
      // won-banner / disabled state, so re-render the whole view for those.
      if (act === 'rung' || act === 'round-clear') { refresh(); highlightWinner(); }
      else renderAll();
    });
  });
  highlightWinner();
}

// A tournament match shows either the Ladder Ball round scorer or the generic
// live tally, depending on the game. One dispatch point keeps the bracket
// render functions identical across games.
function matchTrackerHTML(g, aId, bId) {
  return g.ladderScoring ? ladderMatchHTML(g, aId, bId) : liveTrackerHTML(g, aId, bId);
}

function bindMatchTracker(container, g, aId, bId) {
  if (g.ladderScoring) bindLadderMatch(container, g, aId, bId);
  else bindLiveTracker(container, g, aId, bId);
}

function renderBracketRound1(body, g, b) {
  if (b.pool.length === 0) {
    b.phase = 'bye';
    saveState();
    renderAll();
    return;
  }

  // Games with a fixed Round 1 order (e.g. Kangaroo Kickball) walk the
  // preset matchups in order instead of the free "pick two teams" flow.
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    renderBracketRound1Fixed(body, g, b, g.roundOneMatchups);
    return;
  }

  let html = `<h3>Round 1 — Match ${b.matches.length + 1} of 3</h3>
    <p class="muted">Pick the two teams to call up next.</p>
    <div class="team-chip-grid">
      ${b.pool.map((id) => `<button class="team-chip ${b.selectedPair.includes(id) ? 'selected' : ''}" data-team-id="${id}">${esc(teamName(id))}<span class="chip-sub">${esc(counselorName(id))}</span></button>`).join('')}
    </div>`;

  if (b.selectedPair.length === 2) {
    html += matchupCalloutHTML(b.selectedPair[0], b.selectedPair[1]);
    html += matchTrackerHTML(g, b.selectedPair[0], b.selectedPair[1]);
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
    bindMatchTracker(body, g, b.selectedPair[0], b.selectedPair[1]);
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

// Round 1 driven by a fixed, pre-set matchup order (game.roundOneMatchups).
// Shows the whole schedule up front — done matches with their winner, the
// current one flagged NOW, the rest upcoming — so counselors always know
// who's on deck. Each match just needs a winner tapped; no team-picking.
function renderBracketRound1Fixed(body, g, b, preset) {
  const currentIndex = b.matches.length; // matches recorded so far == next index
  const current = preset[currentIndex] || null;

  const scheduleHTML = `<div class="matchup-order">
    <p class="matchup-order-label">Match order</p>
    <ol class="matchup-order-list">
      ${preset.map((pair, i) => {
        const [x, y] = pair;
        let status = 'upcoming';
        let detail = '';
        if (i < currentIndex) {
          status = 'done';
          const m = b.matches[i];
          if (m) detail = `<span class="mo-result">✓ ${esc(teamName(m.winner))} won</span>`;
        } else if (i === currentIndex) {
          status = 'current';
          detail = '<span class="mo-now">NOW</span>';
        }
        return `<li class="matchup-order-item mo-${status}">
          <span class="mo-teams">${teamEmoji(x)} ${esc(teamName(x))} <span class="mo-vs">vs</span> ${teamEmoji(y)} ${esc(teamName(y))}</span>
          ${detail}
        </li>`;
      }).join('')}
    </ol>
  </div>`;

  let html = `<h3>Round 1 — Match ${currentIndex + 1} of ${preset.length}</h3>` + scheduleHTML;

  if (current) {
    html += matchupCalloutHTML(current[0], current[1]);
    html += matchTrackerHTML(g, current[0], current[1]);
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches"><button id="undo-match-btn" class="link-btn">Undo last match</button></div>`;
  }

  body.innerHTML = html;

  if (current) {
    bindMatchupCopy(body, g, `Round 1 (match ${currentIndex + 1})`, current[0], current[1]);
    bindMatchTracker(body, g, current[0], current[1]);
  }

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!current) return;
      const winner = btn.dataset.winner;
      const [a, c] = current;
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
  // Suggest the winner with the fewest week points (the trailing team) using
  // the live standings. If two or more tie for the fewest, don't pick — let
  // the ref decide, but still show everyone's points.
  const counts = medalCounts();
  const pointsOf = (id) => (counts[id] && counts[id].points) || 0;
  const lowest = winners.reduce((min, id) => Math.min(min, pointsOf(id)), Infinity);
  const lowCount = winners.filter((id) => pointsOf(id) === lowest).length;
  const suggestedId = lowCount === 1 ? winners.find((id) => pointsOf(id) === lowest) : null;
  body.innerHTML = `
    <h3>Who gets the bye?</h3>
    <p class="muted">The bye (skip straight to the Final) goes to whichever Round&nbsp;1 winner has the <strong>fewest points this week</strong>. ${suggestedId ? `The app suggests <strong>${esc(teamName(suggestedId))}</strong> — but you decide.` : 'These winners are tied for the fewest, so pick whoever you like.'}</p>
    <div class="team-chip-grid">
      ${winners.map((id) => {
        const p = pointsOf(id);
        const sug = id === suggestedId;
        return `<button class="team-chip tiebreak-chip ${sug ? 'suggested-chip' : ''}" data-team-id="${id}">${sug ? '⭐ ' : ''}${esc(teamName(id))}<span class="chip-sub">${p} pt${p === 1 ? '' : 's'} this week${sug ? ' · suggested' : ''}</span></button>`;
      }).join('')}
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
    <h3>Championship Game</h3>
    <p class="bye-note">🎟️ <strong>${esc(teamName(b.byeTeamId))}</strong> has the bye — straight to the Final.</p>
    ${matchupCalloutHTML(b.semifinal.a, b.semifinal.b)}
    ${matchTrackerHTML(g, b.semifinal.a, b.semifinal.b)}
  `;

  bindMatchupCopy(body, g, 'Championship game', b.semifinal.a, b.semifinal.b);
  bindMatchTracker(body, g, b.semifinal.a, b.semifinal.b);

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
    <h3>Final</h3>
    <p class="bronze-note">🥉 <strong>${esc(teamName(b.semifinal.loser))}</strong> takes the bronze medal (+${MEDAL_POINTS.bronze} pts).</p>
    ${matchupCalloutHTML(b.championship.a, b.championship.b)}
    ${matchTrackerHTML(g, b.championship.a, b.championship.b)}
  `;

  bindMatchupCopy(body, g, 'Final', b.championship.a, b.championship.b);
  bindMatchTracker(body, g, b.championship.a, b.championship.b);

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
      <div class="medal-row gold-row">🥇 ${teamEmoji(goldId)} <strong>${esc(teamName(goldId))}</strong> <span class="medal-points">+${MEDAL_POINTS.gold} pts</span></div>
      <div class="medal-row silver-row">🥈 ${teamEmoji(silverId)} <strong>${esc(teamName(silverId))}</strong> <span class="medal-points">+${MEDAL_POINTS.silver} pts</span></div>
      <div class="medal-row bronze-row">🥉 ${teamEmoji(bronzeId)} <strong>${esc(teamName(bronzeId))}</strong> <span class="medal-points">+${MEDAL_POINTS.bronze} pts</span></div>
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
    clearLiveMatch(g);
    touchData();
    saveState();
    renderAll();
    celebrate(goldId);
  });
}

// ── Theme ────────────────────────────────────────────────────────

function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = state.theme === 'dark' || (state.theme === null && prefersDark);
  document.body.classList.toggle('dark-theme', dark);
  document.body.classList.toggle('light-theme', !dark && state.theme === 'light');
  // Drive Jelly UI's document-level tokens the same way: an explicit choice
  // maps 1:1 onto data-jelly-mode; auto removes the attribute so Jelly's own
  // prefers-color-scheme fallback tracks live OS flips (mirroring the app's
  // @media token block). Canvas-painted Jelly components repaint on the
  // jelly-theme-change event.
  if (state.theme === 'dark' || state.theme === 'light') {
    document.documentElement.setAttribute('data-jelly-mode', state.theme);
  } else {
    document.documentElement.removeAttribute('data-jelly-mode');
  }
  window.dispatchEvent(new CustomEvent('jelly-theme-change'));
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.textContent = dark ? '☀️' : '🌙';
  // The app can override the OS theme, so keep the browser chrome color in step.
  // A no-media meta appended last wins over the pre-paint media metas.
  let meta = document.getElementById('dynamic-theme-color');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.id = 'dynamic-theme-color';
    document.head.appendChild(meta);
  }
  // Explicit hexes matching Jelly's background-default (body has a 0.2s
  // background transition, so reading getComputedStyle here would capture
  // the mid-transition color — keep these in sync with the palette).
  meta.content = dark ? '#181b1d' : '#ffffff';
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

// ── "What's new" banners ─────────────────────────────────────────
// Each CHANGES entry shows a dismissible banner at the top for two hours after
// it shipped, then expires on its own. Dismissals are per-device (localStorage)
// and per-change id, so clearing one banner doesn't clear the others.
const CHANGE_TTL_MS = 2 * 60 * 60 * 1000; // advertise a change for two hours
const CHANGE_DISMISS_KEY = 'campScoreboardDismissedChanges';

function dismissedChanges() {
  try { return JSON.parse(localStorage.getItem(CHANGE_DISMISS_KEY) || '[]') || []; }
  catch (e) { return []; }
}

function dismissChange(id) {
  const d = dismissedChanges();
  if (!d.includes(id)) {
    d.push(id);
    try { localStorage.setItem(CHANGE_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* fine */ }
  }
}

// The two-hour window counts only "awake" time — it pauses overnight (9pm–8am
// camp time) so a change that ships late at night isn't spent before anyone
// sees it; it resumes advertising in the morning. Quiet hours are camp-local
// (America/New_York, matching every other timestamp in the app), not device
// time.
const QUIET_START_HOUR = 21; // 9pm — pause the timer
const QUIET_END_HOUR = 7;    // 7am — resume the timer (first notice rolls in at 7am)

function campHour(ms) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: '2-digit', hour12: false }).format(new Date(ms));
  return parseInt(h, 10) % 24; // some engines format midnight as "24"
}

function isAwakeHours(ms) {
  const h = campHour(ms);
  return h >= QUIET_END_HOUR && h < QUIET_START_HOUR; // 7am–9pm
}

// Awake (non-quiet) milliseconds elapsed between two instants. Sampled at a
// coarse step — the spans involved are short (a change is only ever live across
// at most one night, since there are 13 awake hours a day vs a 2-hour budget),
// and minute-level accuracy is plenty for a banner. Stops early once the cap is
// reached.
function awakeElapsedMs(fromMs, toMs, capMs) {
  if (toMs <= fromMs) return 0;
  const STEP = 5 * 60 * 1000;
  let awake = 0;
  for (let t = fromMs; t < toMs; t += STEP) {
    if (isAwakeHours(t)) {
      awake += Math.min(STEP, toMs - t);
      if (capMs != null && awake >= capMs) return awake; // no need to keep counting
    }
  }
  return awake;
}

// The banners are a QUEUE, not a wall: they roll in one at a time, one every
// 15 minutes, and only during awake hours (7am–9pm). A change shipped overnight
// waits for 7am; the rest follow at 15-minute intervals behind it. So the
// batch below, all shipped late at night, starts appearing at 7am and
// advances every 15 minutes.
const CHANGE_SPACING_MS = 15 * 60 * 1000; // at most one new banner per 15 minutes

// The first awake instant at/after t: if t falls in quiet hours, jump forward
// to ~8am; otherwise t itself.
function nextAwakeSlot(t) {
  const STEP = 5 * 60 * 1000;
  let x = t, guard = 0;
  while (!isAwakeHours(x) && guard < 4000) { x += STEP; guard++; }
  return x;
}

// The instant `addMs` of AWAKE time after fromMs (quiet hours don't count).
function addAwakeMs(fromMs, addMs) {
  const STEP = 5 * 60 * 1000;
  let x = fromMs, remaining = addMs, guard = 0;
  while (remaining > 0 && guard < 8000) {
    x += STEP;
    if (isAwakeHours(x)) remaining -= STEP;
    guard++;
  }
  return x;
}

// Release time of each CHANGES entry (in list order): the later of its own
// awake-slotted ship time and 15 minutes (awake) behind the previous
// release, so they queue up one per 15 minutes. Deterministic from the `at`
// values.
function changeReleases() {
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const shipped = Date.parse(list[i] && list[i].at);
    let r = nextAwakeSlot(isNaN(shipped) ? Date.now() : shipped);
    if (prev != null) {
      const spaced = addAwakeMs(prev, CHANGE_SPACING_MS);
      if (spaced > r) r = spaced;
    }
    releases[i] = r;
    prev = r;
  }
  return releases;
}

// One banner at a time: the newest entry that has rolled in, isn't dismissed,
// and is still inside its two-hour awake window. Each is superseded by the next
// as its 15-minute slot arrives.
function activeChanges() {
  const now = Date.now();
  const dismissed = dismissedChanges();
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = changeReleases();
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!c || !c.id || !c.text) continue;
    const r = releases[i];
    if (now < r) continue;                                        // hasn't rolled in yet
    if (dismissed.includes(c.id)) continue;
    if (awakeElapsedMs(r, now, CHANGE_TTL_MS) >= CHANGE_TTL_MS) continue; // past its window
    return [c];
  }
  return [];
}

function renderWhatsNew() {
  const wrap = document.getElementById('whats-new');
  if (!wrap) return;
  const active = activeChanges();
  if (!active.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML = active.map((c) => `
    <div class="whats-new-banner" role="status">
      <button class="whats-new-dismiss" data-change-id="${esc(c.id)}" aria-label="Dismiss this update">✕</button>
      <span class="whats-new-badge">New update</span>
      <span class="whats-new-text">${esc(c.text)}</span>
    </div>`).join('');
  wrap.querySelectorAll('.whats-new-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => { dismissChange(btn.dataset.changeId); renderWhatsNew(); });
  });
}

// ── Auto-reload on new deploy ────────────────────────────────────
// Each client polls the deployed index.html (same-origin, no-store) and compares
// its app.js?v= number to the one THIS page is running. When the deploy is
// newer, it reloads to catch up — immediately for viewers, but only when it's
// safe for an editor (not mid score-entry), with a tap-to-refresh bar in the
// meantime so an in-progress score is never lost. This is deploy-driven, so it
// works on a single device without Firebase or another client announcing it.
// (A client only starts polling once it's running a build that has this code —
// so a given phone auto-reloads from the NEXT deploy after it loads this one.)
let newVersionSeen = false;
const UPDATE_POLL_MS = 2 * 60 * 1000;

function editorMidEntry() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
  // A half-built game in the week builder is unsaved in-memory work — the
  // update-poll auto-reload and remote merges must not wipe it.
  if (typeof builderDirty === 'function' && builderDirty()) return true;
  return dataEditPending || pushTimer != null || pushConfigTimer != null; // a real edit is typed/queued but not yet synced
}

// Send any debounced push right now (e.g. when a score field loses focus, or
// the page is being hidden) so an entered value reaches the server promptly
// instead of waiting out the coalescing timer.
function flushPendingPush() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushState(); }
}

// The app.js build number this page loaded with, read off its own <script> tag.
function myAppVersion() {
  const s = document.querySelector('script[src*="app.js?v="]');
  const m = s && (s.getAttribute('src') || '').match(/app\.js\?v=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function checkForUpdate() {
  if (newVersionSeen) return;
  const mine = myAppVersion();
  if (!mine) return;
  try {
    const res = await fetch('index.html?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/app\.js\?v=(\d+)/);
    const deployed = m ? Number(m[1]) : null;
    if (deployed && deployed > mine) onNewVersion();
  } catch (e) { /* offline / blocked — just try again next tick */ }
}

function startUpdatePolling() {
  setInterval(checkForUpdate, UPDATE_POLL_MS);
  // Phones spend most of camp locked; check the moment the tab comes back too.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}

// Reload with a cache-buster on the page URL so we actually fetch the new
// index.html (and thus the new ?v assets), never a stale cached copy — which
// would otherwise bounce us straight back into "update available" forever.
function doReload() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    location.replace(u.toString());
  } catch (e) {
    location.reload();
  }
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  // Jelly path: an info alert with a Refresh button (whole banner stays
  // tappable, like the old pill). This is auto-reload safety UI, so it must
  // never depend on the module having loaded — legacy pill as fallback.
  if (customElements.get('jelly-alert') && customElements.get('jelly-button')) {
    const bar = document.createElement('jelly-alert');
    bar.id = 'update-banner';
    bar.className = 'update-banner-alert';
    bar.setAttribute('tone', 'info');
    const text = document.createElement('span');
    text.textContent = 'New version available — ';
    const btn = document.createElement('jelly-button');
    btn.setAttribute('size', 'small');
    btn.textContent = 'Refresh';
    bar.append(text, btn);
    bar.addEventListener('click', doReload);
    document.body.appendChild(bar);
    return;
  }
  const bar = document.createElement('button');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.type = 'button';
  bar.textContent = 'New version available — tap to refresh';
  bar.addEventListener('click', doReload);
  document.body.appendChild(bar);
}

function reloadWhenSafe() {
  if (!canEdit() || !editorMidEntry()) { setTimeout(doReload, 1200); return; }
  setTimeout(reloadWhenSafe, 12000); // editor is mid-entry — check back shortly
}

function onNewVersion() {
  if (newVersionSeen) return; // a reload is already scheduled/pending
  newVersionSeen = true;
  showUpdateBanner();
  reloadWhenSafe();
}

// ── Idle auto-collapse ───────────────────────────────────────────
// After a few minutes of no interaction, collapse the expandable cards so a
// returning viewer sees a compact page. Never collapses while an editor is
// mid-entry. Device-local; a manual expand sticks until the next idle stretch.
let idleTimer = null;
const IDLE_COLLAPSE_MS = 5 * 60 * 1000;

function collapseCardsForIdle() {
  if (editorMidEntry()) { resetIdleTimer(); return; } // don't yank a card mid-entry
  document.querySelectorAll('.collapsible-card[open]').forEach((d) => { d.open = false; });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(collapseCardsForIdle, IDLE_COLLAPSE_MS);
}

function startIdleCollapse() {
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, resetIdleTimer, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resetIdleTimer(); });
  resetIdleTimer();
}

// ── Init ─────────────────────────────────────────────────────────

function renderAll() {
  // Builder visibility is derived from state every render — settings.js
  // navigates by mutating state.ui.view, not by calling open/close helpers.
  if (state.ui.view === 'settings' && !canEdit()) state.ui.view = 'home';
  const inBuilder = builderOpen();
  document.body.classList.toggle('builder-open', inBuilder);
  const builderView = document.getElementById('settings-view');
  if (builderView) builderView.hidden = !inBuilder;
  renderWhatsNew();
  renderNowBanner();
  renderLiveHome();
  renderDayTabs();
  renderGameList();
  renderGameView();
  renderStandings();
  renderMyElectives();
  renderMemoryVerse();
  renderMealCleanup();
  renderBonuses();
  renderBrownie();
  renderFooter();
  refreshOpenSchedule();
  if (inBuilder && typeof renderSettings === 'function') renderSettings();
}

// ── Week builder (Settings → Set up the week) ────────────────────
// A full-page editor-only view over the main page: body.builder-open hides
// every other main-wrap section via CSS. settings.js renders the content
// (renderSettings) and signals "back" by setting state.ui.view = 'home'
// before its own renderAll() — visibility is re-derived above either way.

function builderOpen() {
  return state.ui.view === 'settings';
}

function openBuilder(tab) {
  if (!canEdit()) return;
  closeSettings(); // hand off from the settings sheet
  state.ui.view = 'settings';
  if (tab) state.ui.settingsTab = tab;
  if (!state.ui.settingsTab) state.ui.settingsTab = 'games';
  saveState();
  renderAll();
  window.scrollTo({ top: 0 });
}

// Keep an open schedule sheet in step with time and synced results — its
// NOW pill, dimming, and ✓ chips otherwise go stale across a block boundary
// or when a remote result lands.
function refreshOpenSchedule() {
  const overlay = scheduleOverlayEl();
  if (overlay && !overlay.hidden) renderScheduleBody();
}

function init() {
  applyTheme();
  applySoundIcon();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sound-toggle').addEventListener('click', toggleSound);

  const copyBtn = document.getElementById('copy-standings-btn');
  copyBtn.addEventListener('click', () => copyTextToClipboard(standingsSummaryText(), copyBtn));
  const shareBtn = document.getElementById('share-standings-btn');
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => {
      navigator.share({ text: standingsSummaryText() }).catch(() => {});
    });
  }

  // The role button now lives in the settings sheet — close the sheet first
  // so the lock screen isn't left sitting behind the open overlay.
  document.getElementById('role-btn').addEventListener('click', () => {
    closeSettings();
    showLockScreen();
  });
  updateRoleButton();

  document.getElementById('notify-toggle-btn').addEventListener('click', toggleNotify);
  updateNotifyButton();
  wireTeamPicker();

  wireSchedule();
  wireSettings();
  wireHistory();

  // Week builder entry point (Settings sheet → Set up the week).
  const builderRow = document.getElementById('builder-row');
  if (builderRow) builderRow.addEventListener('click', () => openBuilder());
  // A remote config held back while a builder input was focused (see the
  // fbConfigRef listener) is applied once focus leaves the form.
  const builderView = document.getElementById('settings-view');
  if (builderView) {
    builderView.addEventListener('focusout', () => {
      setTimeout(() => {
        if (pendingRemoteConfig && !editorMidEntry()) {
          const rc = pendingRemoteConfig;
          pendingRemoteConfig = null;
          applyRemoteConfig(rc);
        }
      }, 0);
    });
  }

  initSync();
  renderPresence();

  rehydrateTimers();
  document.addEventListener('visibilitychange', onTimersVisible);

  startIdleCollapse();
  startUpdatePolling();
  startWeatherUpdates();

  renderAll();

  // Keep the "happening now" banner (and any open schedule sheet) current
  // without any taps — and expire "what's new" banners once they hit two hours.
  setInterval(() => { renderNowBanner(); refreshOpenSchedule(); renderWhatsNew(); renderMyElectives(); }, 30 * 1000);

  // Tick every visible Big Board clock (no-ops instantly when none is on
  // screen, so the interval is effectively free the rest of the week).
  setInterval(tickBoardClocks, 500);
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

// Every collapsible card starts collapsed on each load — a tidy, quick-to-scan
// home screen for everyone, editors included. Manual expands aren't remembered
// across reloads, and the idle timer re-collapses everything after a few
// minutes of no interaction.
function applyCardDefaults() {
  document.querySelectorAll('.collapsible-card').forEach((d) => {
    d.open = false;
  });
}

function startApp() {
  document.documentElement.classList.remove('locked');
  applyRoleClass();
  applyCardDefaults();
  if (!appStarted) {
    appStarted = true;
    init();
  } else {
    updateRoleButton();
    renderAll();
  }
  maybeShowTeamPicker();
}

function renderPinDots() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((d, i) => d.classList.toggle('filled', i < pinEntry.length));
}

// SHA-256 → lowercase hex, via the Web Crypto API (available in any secure
// context — HTTPS, which the live site always is, and localhost).
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Resolve a typed PIN to its role by comparing the salted hash — the plaintext
// PIN is never in the source. Returns 'edit', 'view', or null (no match /
// crypto unavailable).
async function pinRole(pin) {
  try {
    const h = await sha256Hex(PIN_SALT + pin);
    if (h === EDIT_PIN_HASH) return 'edit';
    if (h === VIEW_PIN_HASH) return 'view';
  } catch (e) { /* crypto.subtle missing (insecure context) — treat as no match */ }
  return null;
}

async function handlePinKey(key) {
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
    const entered = pinEntry;
    const role = await pinRole(entered);
    if (pinEntry !== entered) return; // field changed while the hash resolved
    if (role) {
      try {
        localStorage.setItem(UNLOCK_KEY, '1');
        localStorage.setItem(ROLE_KEY, role);
        // Mark this device as past the current editor epoch so it isn't kicked
        // by the one-time old-PIN revocation on the next load.
        if (role === 'edit') localStorage.setItem(EDIT_PIN_EPOCH_KEY, EDIT_PIN_EPOCH);
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
  applyTheme(); // the lock screen is the first thing everyone sees — theme it too
  wireLockKeypad();
  if (isUnlocked()) {
    startApp();
  } else {
    showLockScreen();
  }
}

document.addEventListener('DOMContentLoaded', boot);
