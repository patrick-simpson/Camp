// The frame's pieces under the SENIOR profile: the same checks as frame.test.js
// (which this evals), plus what differs by design — flags instead of shields, and
// no "which one are you?" on a camp without electives.
eval(readFixture('frame.test.js'));

test('senior: four flags, four shapes, four colours; "Not you?" signs out instead of re-asking an identity', () => {
  assert.equal(CAMP.id, 'senior');
  const specs = teamIds().map((id) => teamMarkSpec(id));
  assert.ok(specs.every((s) => s.kind === 'flag'));
  assert.deepEqual(specs.map((s) => s.color), ['red', 'blue', 'green', 'gold']);
  assert.deepEqual(specs.map((s) => s.shape), ['plain', 'swallow', 'stripe', 'chevron']);
  assert.equal(CAMP.features.electives, false);
  const body = readFixture('../app.js');
  assert.ok(/CAMP\.features\.electives \? \(me \? 'Not you\? Change' : 'Pick your name'\) : 'Not you\? Sign out'/.test(body));
});
