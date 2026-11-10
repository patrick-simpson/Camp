// The director's remote under the SENIOR profile: the same checks as reveal-remote.test.js (which this evals), sized to
// senior's four teams, whose marks are flags, on the sibling database root.
eval(readFixture('reveal-remote.test.js'));

test('senior: the ladder has four places, the first button says 4th place, and the mini TV draws no mark before a place is shown', async () => {
  assert.equal(CAMP.id, 'senior');
  await bootDirector();
  await openRemote();
  await setNode({ phase: 'intro', cur: -1, shown: 0, at: mkCtl().at }, 0);
  renderRevealRemote();
  assert.equal(text('reveal-go-m'), '4th place', 'the button starts at the last of four');
  assert.equal((el('reveal-ladder').innerHTML.match(/data-state="(hidden|next)"/g) || []).length, 4);
  assert.ok(!/mtv-(wait|intro)-marks/.test(readFixture('../reveal-ui.js')), 'no mark slot is painted in the waiting or intro frame (words only)');
  closeReveal();
  afterDirector();
});
