// tell.js under the SENIOR profile: the same checks as tell.test.js (which this evals), sized to senior's four teams (flag
// marks in the team picker), plus the things that differ by design.
eval(readFixture('tell.test.js'));

test('senior: four teams in the buzz team picker, each a flag mark and its short name', () => {
  assert.equal(CAMP.id, 'senior');
  boot();
  tell.d.aud = 'team';
  const html = tellTeamsHtml(tell.d);
  assert.equal((html.match(/class="tell-team"/g) || []).length, 4);
  assert.ok(/<svg class="tm flag"/.test(html), 'a flag, not a shield image');
  assert.ok(!/<img/.test(html));
  tell.d.team = 't3';
  assert.ok(/aria-checked="true" data-team="t3"/.test(tellTeamsHtml(tell.d)), 'the picked team is the checked radio');
  done();
});
