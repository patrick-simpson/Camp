// The Now engine — blockKind and nowModel() (redesign §3.1–3.5; BUILD-PLAN Step 17, build session 1). Runs under both camp
// profiles (now-model.senior.test.js evals this file) and, through tests/run.js, against a camp whose schedule is already
// edited here (the seeded pass). What these cases pin: that a block's KIND comes from the data (type, the Meal tag) and falls
// back to the label rules; that every minute of every day is a block or a named empty state, with no throw; the moment
// windows; the running-over rules (a live game, a director's "Still on this", the 45-minute cap, never past the next games
// block); the personalisation (my team, my station first, my cleanup duty); that a counselor's model carries no point and no
// place; and that the wake-up list names every minute at which the picture changes.

var DOWS = [0, 1, 2, 3, 4, 5, 6];
var KINDS = ['games', 'elective', 'meal', 'bible', 'meeting', 'worship', 'bedtime', 'arrival', 'sendoff', 'activity'];

function kindsOf(dow) {
  return scheduleForDow(dow).map((b) => [b.label, blockKind(b, dow)]);
}
function kindOf(dow, headStart) {
  const hit = scheduleForDow(dow).find((b) => String(b.label).toLowerCase().indexOf(headStart.toLowerCase()) === 0);
  assert.ok(hit, 'no block "' + headStart + '" on day ' + dow);
  return blockKind(hit, dow);
}

test('blockKind: every block of every day has one of the ten kinds', () => {
  DOWS.forEach((dow) => kindsOf(dow).forEach(([label, k]) => assert.ok(KINDS.includes(k), `dow ${dow} "${label}" -> ${k}`)));
});

test('blockKind: junior reads the explicit fields first and the label rules after', () => {
  if (CAMP.id !== 'junior') return;
  assert.equal(kindOf(1, 'Team competitions'), 'games');
  assert.equal(kindOf(1, 'Evening competition'), 'games');
  assert.equal(kindOf(1, 'Elective 1'), 'elective');
  assert.equal(kindOf(1, 'Breakfast'), 'meal');
  assert.equal(kindOf(1, 'Lunch'), 'meal');
  assert.equal(kindOf(1, 'Supper'), 'meal');
  assert.equal(kindOf(1, 'Bible study'), 'bible');
  assert.equal(kindOf(1, 'Rising bell'), 'meeting');
  assert.equal(kindOf(1, 'Evening service'), 'worship');
  assert.equal(kindOf(1, 'Prepare for evening service'), 'activity', 'preparing for a service is not the service');
  assert.equal(kindOf(1, 'Prepare for Elective 1'), 'activity');
  assert.equal(kindOf(1, 'Team time'), 'activity');
  assert.equal(kindOf(1, 'Cabin time & clean up'), 'activity');
  assert.equal(kindOf(1, 'Snack Shack break'), 'activity');
  assert.equal(kindOf(1, 'Snack and campfire'), 'activity');
  assert.equal(kindOf(1, 'Prepare for bed'), 'bedtime');
  assert.equal(kindOf(1, 'Cabin devotional'), 'bedtime');
  assert.equal(kindOf(1, 'Lights out'), 'bedtime');
  assert.equal(kindOf(5, 'Team Skits'), 'activity');
  assert.equal(kindOf(5, 'Boys cabin pillow fight'), 'activity');
});

test('blockKind: junior Sunday is the arrival up to the worship service, Saturday is the send-off', () => {
  if (CAMP.id !== 'junior') return;
  assert.equal(kindOf(0, 'Registration'), 'arrival');
  assert.equal(kindOf(0, 'Welcome to camp'), 'arrival');
  assert.equal(kindOf(0, 'Supper'), 'meal', 'a meal stays a meal');
  assert.equal(kindOf(0, 'Team assignments'), 'arrival');
  assert.equal(kindOf(0, 'Prepare for worship service'), 'arrival', 'still before the first worship block');
  assert.equal(kindOf(0, 'Worship service'), 'worship');
  assert.equal(kindOf(0, 'Snack and campfire'), 'activity', 'after the worship it is an ordinary evening');
  assert.equal(kindOf(0, 'Cabin devotional'), 'bedtime');
  assert.equal(kindOf(0, 'Lights out'), 'bedtime');
  assert.equal(kindOf(6, 'Rising bell'), 'meeting', 'a label rule beats the weekday');
  assert.equal(kindOf(6, 'Breakfast'), 'meal');
  assert.equal(kindOf(6, 'Cabin time & campground cleanup'), 'sendoff');
  assert.equal(kindOf(6, 'Meet in Tabernacle'), 'sendoff');
  assert.equal(kindOf(6, "Camp's over"), 'sendoff');
});

test('blockKind: senior has no electives and a Sunday with no worship block', () => {
  if (CAMP.id !== 'senior') return;
  assert.equal(kindOf(1, 'Team competitions'), 'games');
  assert.equal(kindOf(1, 'Legacy Game'), 'games');
  assert.equal(kindOf(1, 'Wake up'), 'meeting');
  assert.equal(kindOf(1, 'Morning Bible study'), 'bible');
  assert.equal(kindOf(1, 'Lunch'), 'meal');
  assert.equal(kindOf(1, 'Evening worship'), 'worship');
  assert.equal(kindOf(1, 'Campfire / waterfront worship'), 'worship');
  assert.equal(kindOf(1, 'Cabin devotions'), 'bedtime');
  assert.equal(kindOf(1, 'Lights out'), 'bedtime');
  assert.equal(kindOf(1, 'Free time below the tracks'), 'activity', 'free time is an activity');
  assert.equal(kindOf(1, 'Cool down'), 'activity');
  assert.equal(kindOf(0, 'Arrival & registration'), 'arrival');
  assert.equal(kindOf(0, 'Welcome night'), 'arrival', 'no worship block on Sunday: all of it is the arrival');
  assert.equal(kindOf(6, 'Wake up'), 'meeting');
  // an elective type that somehow reached a camp without electives is an ordinary block
  assert.equal(blockKind({ start: 700, end: 740, label: 'Elective 1', type: 'elective', slot: 0 }, 1), 'activity');
});

test('blockKind: the Meal tag makes a meal of a block the label does not, and junk never throws', () => {
  const real = blockMeal;
  blockMeal = (b) => (b && b.label === 'Zed' ? 'Supper' : real(b));
  assert.equal(blockKind({ label: 'Zed', start: 1065, end: 1130 }, 2), 'meal', 'the item\'s own tag decides, whatever its label says');
  blockMeal = real;
  assert.equal(blockKind({ label: 'Zed', start: 1065, end: 1130 }, 2), 'activity');
  if (CAMP.id === 'senior') assert.equal(kindOf(1, 'Supper and free time'), 'activity', 'untagged, senior\'s supper reads as an ordinary block');
  assert.equal(blockKind(null, 1), 'activity');
  assert.equal(blockKind(undefined, 99), 'activity');
  assert.equal(blockKind({}, 'x'), 'activity');
  assert.equal(blockKind({ label: 'Bible study — with Sam', start: 540, end: 585 }, 3), 'bible', 'the tail is not read');
  assert.equal(blockKind({ label: 'Whatever', start: 0, end: 5, noTime: true }, 2), 'bedtime', 'a block with no time is the end of the day');
});
