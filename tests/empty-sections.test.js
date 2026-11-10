// Redesign §1.2 #14 (Step 29): a section with nothing real in it is not shown to counselors. Senior's seed is all placeholders
// ("Verse to be announced.", a rota with no team), so its counselors' More has no Memory verse / Meal cleanup row, Now's Bible
// study is a plain activity and the schedule says no "TBA" cleanup; a director still sees every section (the hub's to-do is
// their prompt), and the moment a director fills one day in, counselors get it. Judged through the accessors, so it holds with
// each section's switch on AND off (the seeded passes run this file too).

const EMPTY_SENIOR = () => CAMP.id === 'senior';

test('which camps have nothing real: senior\'s placeholders are empty, junior\'s printed week is not', () => {
  assert.equal(verseSectionEmpty(), EMPTY_SENIOR());
  assert.equal(cleanupSectionEmpty(), EMPTY_SENIOR());
  assert.equal(verseIsReal({ text: 'Verse to be announced.', ref: '' }), false);
  assert.equal(verseIsReal({ text: 'Verse to be announced.', ref: 'John 3:16' }), true, 'a reference makes it a verse');
  assert.equal(verseIsReal({ text: '', ref: '' }), false);
});

test('a counselor (and a preview) gets no Memory verse or Meal cleanup sheet when empty; a director always does', () => {
  setMemberRole('viewer');
  assert.equal(shellSheetAllowed('verse'), !EMPTY_SENIOR());
  assert.equal(shellSheetAllowed('cleanup'), !EMPTY_SENIOR());
  assert.equal(nowHiddenSections().verse, EMPTY_SENIOR());
  assert.equal(nowHiddenSections().cleanup, EMPTY_SENIOR());
  setMemberRole('editor');
  assert.equal(shellSheetAllowed('verse'), true);
  assert.equal(shellSheetAllowed('cleanup'), true);
  assert.equal(nowHiddenSections().verse, false);
  assert.equal(nowHiddenSections().cleanup, false);
  counselorPreviewOn = true;
  try {
    assert.equal(nowHiddenSections().verse, EMPTY_SENIOR(), 'a preview draws what a counselor\'s phone draws');
    assert.equal(nowHiddenSections().cleanup, EMPTY_SENIOR());
  } finally { counselorPreviewOn = false; }
  setMemberRole('viewer');
});

test('no TBA cleanup line in the schedule or the calendar for a meal nobody is on', () => {
  for (let dow = 0; dow <= 6; dow += 1) {
    assert.ok(!/TBA/.test(mealCleanupNote(dow, 'Lunch', 'lunch')), 'mealCleanupNote says nothing instead of TBA');
    assert.ok(!/TBA/.test(icsCleanupText(dow, 'Lunch', 'lunch')), 'the calendar line likewise');
  }
});

test('filling one day in brings the section back for counselors (built-in data only: an edited week is filled in Set up the week)', () => {
  if (sectionIsShared('verses') || sectionIsShared('cleanup')) return;
  const v = MEMORY_VERSES[3]; const c = MEAL_CLEANUP_SCHEDULE[3];
  try {
    MEMORY_VERSES[3] = { text: 'Love one another.', ref: 'John 13:34' };
    MEAL_CLEANUP_SCHEDULE[3] = { Breakfast: ['t0'] };
    setMemberRole('viewer');
    assert.equal(verseSectionEmpty(), false);
    assert.equal(cleanupSectionEmpty(), false);
    assert.equal(shellSheetAllowed('verse'), true);
    assert.equal(shellSheetAllowed('cleanup'), true);
  } finally {
    if (v === undefined) delete MEMORY_VERSES[3]; else MEMORY_VERSES[3] = v;
    if (c === undefined) delete MEAL_CLEANUP_SCHEDULE[3]; else MEAL_CLEANUP_SCHEDULE[3] = c;
  }
});
