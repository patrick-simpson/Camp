// ── camps.js — the camps this app can run ──────────────────────────
// One static codebase serves BOTH camps. This file is the single source of
// per-camp truth: which Firebase root a camp's data lives under, which
// localStorage namespace it caches into, its team branding, its printed
// daily schedule, and the seed data for a fresh week. app.js reads
// everything through the active profile (`CAMP`), chosen per-device by
// localStorage — switching camps is always a set-key-and-reload, matching
// the app's reload-only listener lifecycle (see CLAUDE.md).
//
// JUNIOR is the original camp: its dbRoot and storage suffix keep the exact
// literals the app has always used, so existing junior devices see zero
// change (tests/camps.test.js pins this). SENIOR is additive: a sibling
// Firebase root (locked by its own copy of the security rules) and a
// ':senior' storage namespace.
//
// Loaded after defaults.js (junior's defaultConfig lives there) and before
// app.js (which consumes CAMP at load time).

// Minutes-since-midnight helper used by every schedule below and by app.js
// (meal times, ics export). Lives here because camps.js loads first.
function hm(h, m) { return h * 60 + (m || 0); }

const CAMPS = {};

// ── Camp chat channels ───────────────────────────────────────────
// Shared by both camps (each camp still gets its OWN chat data — messages
// live under <dbRoot>/chat/<channelId>). The ids are a CONTRACT with the
// security rules, which whitelist exactly these four — adding a channel
// means a rules re-paste, so change labels/emoji freely but treat ids as
// fixed.
const CHAT_CHANNELS = [
  { id: 'announcements', label: 'Announcements & Important Info', short: 'Announcements', emoji: '📣' },
  { id: 'general', label: 'General Chatter', short: 'General', emoji: '💬' },
  { id: 'memes', label: 'Memes', short: 'Memes', emoji: '😂' },
  { id: 'photos', label: 'Photo Dump', short: 'Photos', emoji: '📸' },
];

// ════════════════════════════════════════════════════════════════════
// JUNIOR CAMP — the original. Every block below moved VERBATIM from
// app.js (2026-07-25); the data is the printed junior-camp week.
// ════════════════════════════════════════════════════════════════════
(function () {

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
  4: (function () {
    // Tonight only: Boys cabin movie night (9:15–10pm), same slot/overlap
    // treatment as Tuesday's (see that block's comment) — intentionally
    // overlaps "Prepare for bed" and "Cabin devotional", placed ahead of
    // them so it wins the "Happening Now" banner for the whole window while
    // both still show in the full schedule sheet.
    const evening = weekdayEvening('Jovi');
    const idx = evening.findIndex((b) => b.start === hm(21, 15));
    const movie = { start: hm(21, 15), end: hm(22, 0), label: 'Boys cabin movie night', emoji: '🎬', type: 'activity' };
    evening.splice(idx === -1 ? evening.length : idx, 0, movie);
    return [morningMeetingBlock(4)].concat(weekdayDaytime()).concat(evening);
  })(),
  5: [morningMeetingBlock(5)].concat(weekdayDaytime()).concat([
    { start: hm(17, 30), end: hm(18, 0), label: 'Team huddle', emoji: '📣', type: 'activity' },
    { start: hm(18, 0), end: hm(19, 0), label: 'Final preparations for skits', emoji: '🎭', type: 'activity' },
    { start: hm(19, 0), end: hm(20, 0), label: 'Team Skits', emoji: '🎭', type: 'activity' },
    { start: hm(20, 0), end: hm(21, 0), label: 'Evening service', emoji: '⛪', type: 'activity' },
    { start: hm(21, 0), end: hm(22, 0), label: 'Snack and campfire — Ella', emoji: '🔥', type: 'activity' },
    { start: hm(22, 0), end: hm(22, 15), label: 'Prepare for bed', emoji: '🪥', type: 'activity' },
    { start: hm(22, 15), end: hm(22, 30), label: 'Cabin devotional', emoji: '🙏', type: 'activity' },
    // Lights out at 10:30, a 15min Boys cabin pillow fight breaks out at
    // 10:45–11pm, then lights out resumes for the night. A clean sequential
    // split (not an overlap trick like Tue/Thu's movie) — the pillow fight
    // sits entirely after prepare-for-bed/devotional, mid-way through what
    // would otherwise be one long lights-out block, so there's no ambiguity
    // for "Happening now"/"Up next" to resolve.
    { start: hm(22, 30), end: hm(22, 45), label: 'Lights out', emoji: '🛏️', type: 'activity' },
    { start: hm(22, 45), end: hm(23, 0), label: 'Boys cabin pillow fight', emoji: '🛏️', type: 'activity' },
    { start: hm(23, 0), end: hm(24, 0), label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true },
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
  4: {
    breakfast: { dish: 'French Toast', emoji: '🍞' },
    lunch: { dish: 'Sandwiches', emoji: '🥪' },
    supper: { dish: 'Pizza', emoji: '🍕' },
  },
  5: {
    breakfast: { dish: 'Scrambled Eggs and English Muffins', emoji: '🍳' },
    lunch: { dish: 'Leftovers', emoji: '♻️' },
    supper: { dish: 'Cheesy Chicken and Rice', emoji: '🍗' },
  },
};

const SCHED_DAYS = [
  { dow: 0, short: 'Sun', full: 'Sunday', tag: 'Arrival day' },
  { dow: 1, short: 'Mon', full: 'Monday', tag: 'Competition day 1' },
  { dow: 2, short: 'Tue', full: 'Tuesday', tag: 'Competition day 2' },
  { dow: 3, short: 'Wed', full: 'Wednesday', tag: 'Competition day 3' },
  { dow: 4, short: 'Thu', full: 'Thursday', tag: 'Competition day 4' },
  { dow: 5, short: 'Fri', full: 'Friday', tag: 'Messtival & Team Skits' },
  { dow: 6, short: 'Sat', full: 'Saturday', tag: 'Send-off' },
];

// This week's counselors, per team — the seed list behind "Add this week's
// counselors" in the Members drawer. They start as PENDING members (a name
// and a team, no sign-in yet); an editor fills in each person's email or
// phone later with "Add sign-in", which is what actually lets them in.
// Spellings follow the standings' counselor text, which is what camp prints.
const SEED_COUNSELORS = [
  ['t0', ['Alysa', 'Cam', 'Sam']],
  ['t1', ['Bria', 'Lydia', 'Zac']],
  ['t2', ['Jovi', 'Brody', 'Josh']],
  ['t3', ['Sofia', 'William']],
  ['t4', ['Abby', 'TJ', 'Ella']],
  ['t5', ['Lily', 'Jacob']],
];

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
  4: { text: 'And I will give you a new heart, and a new spirit I will put within you. And I will remove the heart of stone from your flesh and give you a heart of flesh. And I will put my Spirit within you, and cause you to walk in my statutes and be careful to obey my rules.', ref: 'Ezekiel 36:26–27 ESV', video: 'https://youtu.be/yqA3NHjwY0I?is=-sOrEqnoEM3MmJwc' },
  5: { text: 'If we live by the Spirit, let us also keep in step with the Spirit.', ref: 'Galatians 5:25 ESV', video: 'https://youtu.be/u3I2IjLt32M?is=O4fSEQJXtrJUCiXn' },
};

const MEAL_CLEANUP_SCHEDULE = {
  1: { Breakfast: 't5', Lunch: 't4', Supper: 't0' }, // Mon: John Deere's / Pilgrims / Foxes
  2: { Breakfast: 't2', Lunch: 't3', Supper: 't1' }, // Tue: Maples / Pumpkins / Turkey
  3: { Breakfast: 't0', Lunch: 't5', Supper: 't4' }, // Wed: Foxes / John Deere's / Pilgrims
  4: { Breakfast: 't1', Lunch: 't2', Supper: 't3' }, // Thu: Turkey / Maples / Pumpkins
  5: { Breakfast: ['t3', 't4'], Lunch: ['t0', 't1'], Supper: ['t2', 't5'] }, // Fri: (Pumpkin+Pilgrim) / (Foxes+Turkey) / (Maple+John Deere's)
};

// The starting content: the Saturday send-off cleanup plan this was built
// for, seeded as a DRAFT. Kept as a worked example rather than a blank form —
// editing one is far easier than composing from nothing, and it's the exact
// thing most likely to be needed again next year.
function defaultNotice() {
  return {
    status: 'draft',
    eyebrow: '🧹 Campground cleanup · 8:30–9:30am',
    title: 'Where your team cleans',
    sub: "Straight from breakfast to your team's area — no going up to the cabins yet. "
       + 'Finish by 9:30, then meet in the Tabernacle for send-off.',
    zones: [
      { teamId: 't3', place: 'Chapel Lawn', note: '' },
      { teamId: 't1', place: 'Waterfront', note: '' },
      { teamId: 't0', place: 'Linger a While', note: '' },
      { teamId: 't5', place: 'Snack Shack', note: '' },
      { teamId: 't2', place: 'Dining Hall', note: 'breakfast cleanup' },
      { teamId: 't4', place: 'Tabernacle', note: '' },
    ],
    steps: [
      { emoji: '🚶', when: 'Straight after breakfast', items: [
        "Campers go straight to their team's area above — nobody goes up to the cabins yet.",
      ] },
      { emoji: '🗑️', when: 'In your area', items: [
        'All the trash goes — empty the cans and put a fresh bag in.',
        'Put away the games and anything else we used this week.',
        'Lost and found goes to the tables at the Snack Shack.',
      ] },
      { emoji: '⛪', when: 'When your area is done', items: [
        'Head to the Tabernacle and help finish up there.',
      ] },
      { emoji: '🛏️', when: 'Cabins — once the Tabernacle is set', items: [
        'Now campers can go up to pack.',
        'Sweep the floors and clear out the trash before anything gets packed.',
      ] },
      { emoji: '🚿', when: 'Once the campers have gone', items: [
        'Clean the shower houses.',
        'Walk the cabins one last time — nothing left behind.',
      ] },
    ],
    signoff: "Let's leave these grounds looking better than we found them!",
  };
}
CAMPS.junior = {
  id: 'junior',
  label: 'Junior Camp',
  short: 'Jr',
  crestNoun: 'shield',   // junior teams carry shields; senior teams carry flags
  dbRoot: 'campScoreboard',   // the ORIGINAL literal — never change (live data + published rules)
  storageSuffix: '',          // '' ⇒ junior localStorage keys are byte-identical to before camps existed
  teamCount: 6,
  defaultTeamNames: DEFAULT_TEAM_NAMES,
  defaultCounselors: DEFAULT_COUNSELORS,
  oldPlaceholderTeamNames: OLD_PLACEHOLDER_TEAM_NAMES,
  oldPlaceholderCounselors: OLD_PLACEHOLDER_COUNSELORS,
  teamEmoji: TEAM_EMOJI,
  teamCrest: TEAM_SHIELD,
  teamAccent: TEAM_ACCENT,
  teamAbbrev: TEAM_ABBREV,
  teamCounselors: TEAM_COUNSELORS,
  seedCounselors: SEED_COUNSELORS,
  daySchedule: DAY_SCHEDULE,
  schedDays: SCHED_DAYS,
  electives: ELECTIVES,
  stationEmoji: STATION_EMOJI,
  electiveSlotMin: ELECTIVE_SLOT_MIN,
  meals: MEALS,
  mealCleanupSchedule: MEAL_CLEANUP_SCHEDULE,
  memoryVerseTheme: MEMORY_VERSE_THEME,
  memoryVerses: MEMORY_VERSES,
  defaultNotice: defaultNotice,
  chatChannels: CHAT_CHANNELS,
  defaultConfig: defaultConfig,   // defaults.js — loaded before this file
  features: { electives: true },
};
})();

// ════════════════════════════════════════════════════════════════════
// SENIOR CAMP — ages 13–18, four teams with flags, no electives.
// Everything here is a PLACEHOLDER until Patrick fills in the real week
// (teams and games via Settings → Set up the week; schedule/meals/verses/
// cleanup rota by editing this profile). The daily rhythm below is the
// published senior-camp sample day.
// ════════════════════════════════════════════════════════════════════
(function () {

// Four teams, identified by their flag colors until real names exist.
// Same t0..tN id scheme as junior — ids never collide because the two
// camps live under different Firebase roots and storage namespaces.
const DEFAULT_TEAM_NAMES = ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'];
const TEAM_EMOJI = { t0: '🔴', t1: '🔵', t2: '🟢', t3: '🟡' };
const TEAM_ACCENT = {
  t0: '#c0392b', // Red
  t1: '#2e6db4', // Blue
  t2: '#3a7d34', // Green
  t3: '#b8860b', // Gold
};
const TEAM_ABBREV = { t0: 'Red', t1: 'Blue', t2: 'Green', t3: 'Gold' };

// The published senior-camp sample day (identical Mon–Fri until the real
// packet exists). Competition windows and the Legacy Game are type:'games'
// so the Happening Now banner yields to the scoreboard during them.
function seniorDay() {
  return [
    { start: hm(7, 30), end: hm(8, 0), label: 'Wake up', emoji: '⏰', type: 'activity' },
    { start: hm(8, 0), end: hm(8, 45), label: 'Breakfast', emoji: '🍳', type: 'activity' },
    { start: hm(8, 45), end: hm(9, 45), label: 'Morning Bible study & group prayer', emoji: '📖', type: 'activity' },
    { start: hm(9, 45), end: hm(12, 20), label: 'Team competitions', emoji: '🏅', type: 'games' },
    { start: hm(12, 20), end: hm(12, 30), label: 'Cool down, prepare for lunch', emoji: '🧊', type: 'activity' },
    { start: hm(12, 30), end: hm(13, 0), label: 'Lunch', emoji: '🥪', type: 'activity' },
    { start: hm(13, 0), end: hm(14, 50), label: 'Free time below the tracks & EXILE — Snack Shack open', emoji: '🎈', type: 'activity' },
    { start: hm(14, 50), end: hm(15, 0), label: 'Prepare for team competitions', emoji: '📣', type: 'activity' },
    { start: hm(15, 0), end: hm(16, 40), label: 'Team competitions', emoji: '🏅', type: 'games' },
    { start: hm(16, 40), end: hm(16, 50), label: 'Cool down & prepare for the Legacy Game', emoji: '🧊', type: 'activity' },
    { start: hm(16, 50), end: hm(17, 30), label: 'Legacy Game', emoji: '🏆', type: 'games' },
    { start: hm(17, 30), end: hm(17, 45), label: 'Cool down', emoji: '🧊', type: 'activity' },
    { start: hm(17, 45), end: hm(18, 50), label: 'Supper and free time', emoji: '🍲', type: 'activity' },
    { start: hm(18, 50), end: hm(19, 15), label: '“Hot Seat” & “Let’s Make a Deal!”', emoji: '🎤', type: 'games' },
    { start: hm(19, 15), end: hm(20, 30), label: 'Evening worship', emoji: '⛪', type: 'activity' },
    { start: hm(20, 30), end: hm(21, 15), label: 'Snack Shack & free time', emoji: '🍫', type: 'activity' },
    { start: hm(21, 15), end: hm(21, 45), label: 'Campfire / waterfront worship', emoji: '🔥', type: 'activity' },
    { start: hm(21, 45), end: hm(22, 0), label: 'Bathrooms & bunk prep', emoji: '🪥', type: 'activity' },
    { start: hm(22, 0), end: hm(22, 30), label: 'Cabin devotions & lights out', emoji: '🙏', type: 'activity' },
    { start: hm(22, 30), end: hm(24, 0), label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true },
  ];
}

// Sunday arrival / Saturday send-off are STUBS — Patrick confirms the real
// bookend days before a live senior week (senior camp has historically run
// Friday→Saturday; the week builder's days are what actually drive games).
const DAY_SCHEDULE = {
  0: [
    { start: hm(16, 0), end: hm(18, 0), label: 'Arrival & registration', emoji: '👋', type: 'activity' },
    { start: hm(18, 0), end: hm(24, 0), label: 'Welcome night', emoji: '🌙', type: 'activity', noTime: true },
  ],
  1: seniorDay(),
  2: seniorDay(),
  3: seniorDay(),
  4: seniorDay(),
  5: seniorDay(),
  6: [
    { start: hm(7, 30), end: hm(8, 0), label: 'Wake up', emoji: '⏰', type: 'activity' },
    { start: hm(8, 0), end: hm(8, 45), label: 'Breakfast', emoji: '🍳', type: 'activity' },
    { start: hm(8, 45), end: hm(10, 30), label: 'Pack up & campground cleanup', emoji: '🧹', type: 'activity' },
    { start: hm(10, 30), end: hm(24, 0), label: "Camp's over — see you next year!", emoji: '👋', type: 'activity', noTime: true },
  ],
};

const SCHED_DAYS = [
  { dow: 0, short: 'Sun', full: 'Sunday', tag: 'Arrival day' },
  { dow: 1, short: 'Mon', full: 'Monday', tag: 'Competition day 1' },
  { dow: 2, short: 'Tue', full: 'Tuesday', tag: 'Competition day 2' },
  { dow: 3, short: 'Wed', full: 'Wednesday', tag: 'Competition day 3' },
  { dow: 4, short: 'Thu', full: 'Thursday', tag: 'Competition day 4' },
  { dow: 5, short: 'Fri', full: 'Friday', tag: 'Competition day 5' },
  { dow: 6, short: 'Sat', full: 'Saturday', tag: 'Send-off' },
];

// The seeded senior week: five days, and per day the sample-day program —
// two team-competition blocks, the Legacy Game, and the two evening crowd
// games (all SCORED, per Patrick). Every game is a placement placeholder
// (works at any team count) that Patrick renames/retypes in the builder.
function seniorDefaultConfig() {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const games = [];
  names.forEach(function (name, i) {
    const dayId = 'd' + (i + 1);
    function mk(idBase, gname, emoji, session, headline) {
      games.push({
        id: idBase + '-' + dayId, name: gname, emoji: emoji, dayId: dayId, session: session,
        location: 'TBA', format: 'placement', headline: headline,
        rules: [{ h: 'How it works', items: ['Details to come — edit this game in Settings → Set up the week.'] }],
      });
    }
    mk('team-comp-am', 'Team Competition (Morning)', '🏅', 'Morning', 'Morning team-competition block.');
    mk('team-comp-pm', 'Team Competition (Afternoon)', '🎽', 'Afternoon', 'Afternoon team-competition block.');
    mk('legacy-game', 'Legacy Game', '🏆', 'Afternoon', 'The ultimate version of a camp classic.');
    mk('hot-seat', 'Hot Seat', '🎤', 'Evening', 'Evening crowd game — scored.');
    mk('lets-make-a-deal', "Let's Make a Deal", '🤝', 'Evening', 'Evening crowd game — scored.');
  });
  return {
    // version matches the current junior config version so the one-shot
    // junior migrations in migrateState (all gated on version < 5) never
    // fire against senior data.
    version: 5,
    updatedAt: new Date().toISOString(),
    sessions: ['Morning', 'Afternoon', 'Evening'],
    days: names.map(function (name, i) { return { id: 'd' + (i + 1), name: name, dow: i + 1, note: '' }; }),
    games: games,
  };
}

// Placeholder verse program (senior keeps verse points, per Patrick) —
// swap in the real theme + verses when the senior sheet exists.
const MEMORY_VERSE_THEME = {
  title: 'Senior Camp',
  text: 'Theme verse to be announced.',
  ref: '',
};
const MEMORY_VERSES = {
  1: { text: 'Verse to be announced.', ref: '' },
  2: { text: 'Verse to be announced.', ref: '' },
  3: { text: 'Verse to be announced.', ref: '' },
  4: { text: 'Verse to be announced.', ref: '' },
  5: { text: 'Verse to be announced.', ref: '' },
};

// A worked example of the notice board, as a DRAFT (never posts itself) —
// one zone per senior team, places TBA.
function seniorDefaultNotice() {
  return {
    status: 'draft',
    eyebrow: '🧹 Campground cleanup',
    title: 'Where your team cleans',
    sub: 'Assignments to come — edit this notice in Settings → Set up the week → Notice.',
    zones: [
      { teamId: 't0', place: 'TBA', note: '' },
      { teamId: 't1', place: 'TBA', note: '' },
      { teamId: 't2', place: 'TBA', note: '' },
      { teamId: 't3', place: 'TBA', note: '' },
    ],
    steps: [
      { emoji: '🗑️', when: 'In your area', items: ['Trash out, fresh bags in, gear put away.'] },
    ],
    signoff: "Let's leave these grounds looking better than we found them!",
  };
}

CAMPS.senior = {
  id: 'senior',
  label: 'Senior Camp',
  short: 'Sr',
  crestNoun: 'flag',
  dbRoot: 'seniorScoreboard',   // sibling Firebase root; locked by its own copy of the rules
  storageSuffix: ':senior',     // namespaces every per-camp localStorage/IndexedDB key
  teamCount: 4,
  defaultTeamNames: DEFAULT_TEAM_NAMES,
  defaultCounselors: ['', '', '', ''],
  oldPlaceholderTeamNames: [],  // empty ⇒ normalizeSyncedState never auto-renames senior teams
  oldPlaceholderCounselors: [],
  teamEmoji: TEAM_EMOJI,
  teamCrest: {},                // no flag artwork yet — emoji fallback everywhere
  teamAccent: TEAM_ACCENT,
  teamAbbrev: TEAM_ABBREV,
  teamCounselors: {},           // filled by member teamId assignments, not a printed sheet
  seedCounselors: [],           // no printed senior roster yet ⇒ the seed button never shows
  daySchedule: DAY_SCHEDULE,
  schedDays: SCHED_DAYS,
  electives: {},
  stationEmoji: {},
  electiveSlotMin: [],
  meals: {},                    // fill as the senior kitchen announces meals
  mealCleanupSchedule: {},      // empty rota ⇒ every meal shows TBA until filled
  memoryVerseTheme: MEMORY_VERSE_THEME,
  memoryVerses: MEMORY_VERSES,
  defaultNotice: seniorDefaultNotice,
  chatChannels: CHAT_CHANNELS,
  defaultConfig: seniorDefaultConfig,
  features: { electives: false },   // no electives at senior camp; verse/cleanup/meals stay on
};
})();

// ── Active-camp selection ────────────────────────────────────────────
// Device-local, like the theme. Junior is the default, so every device
// from before camps existed keeps behaving exactly as it always has.
// Switching camps is ALWAYS set-key-then-reload: the Firebase listener
// lifecycle is one-shot by design (a cancelled read is terminal), so a
// running page never re-points its refs in place.
const ACTIVE_CAMP_KEY = 'campScoreboardActiveCamp'; // 'junior' | 'senior'

function activeCampId() {
  try { return localStorage.getItem(ACTIVE_CAMP_KEY) === 'senior' ? 'senior' : 'junior'; }
  catch (e) { return 'junior'; }
}

const CAMP = CAMPS[activeCampId()];

function otherCampId() { return CAMP.id === 'senior' ? 'junior' : 'senior'; }

// Every Firebase path and per-camp localStorage key goes through these two.
// For junior both are identity-preserving (dbRoot is the original literal,
// suffix is '') — pinned by tests/camps.test.js.
function dbPath(sub) { return CAMP.dbRoot + '/' + sub; }
function lsKey(base) { return base + CAMP.storageSuffix; }
