// Re-renders that change nothing must not touch the DOM. renderAll runs on
// every remote snapshot and the 30-second tick; rebuilding identical markup
// re-creates Jelly components (their canvases repaint from scratch, the
// now-banner's progress bar refilled from empty twice a minute) and image
// elements (the team shield blinked). The visible effect is only checkable in
// a browser; these pin the rule the fix rests on.

function fakeEl() {
  // innerHTML here is a plain property, so "the DOM changed" is simulated by
  // writing it directly — exactly what a chip toggling `selected` looks like
  // to setHtmlIfChanged (its light-DOM serialization moves).
  return { innerHTML: '' };
}

test('identical markup is written once, then skipped', () => {
  const el = fakeEl();
  assert.ok(setHtmlIfChanged(el, '<p>a</p>'), 'first write happens');
  assert.notOk(setHtmlIfChanged(el, '<p>a</p>'), 'same markup again is a no-op');
  assert.ok(setHtmlIfChanged(el, '<p>b</p>'), 'changed markup is written');
  assert.equal(el.innerHTML, '<p>b</p>');
});

test('a DOM changed by something else is rebuilt even when the markup matches', () => {
  const el = fakeEl();
  setHtmlIfChanged(el, '<jelly-chip selected>Mon</jelly-chip>');
  // The chip toggled itself off on a tap that didn't change the chosen day.
  el.innerHTML = '<jelly-chip>Mon</jelly-chip>';
  assert.ok(setHtmlIfChanged(el, '<jelly-chip selected>Mon</jelly-chip>'), 'rebuilt back to the true state');
  assert.equal(el.innerHTML, '<jelly-chip selected>Mon</jelly-chip>');
});

test('a panel cleared by another code path is refilled', () => {
  const el = fakeEl();
  setHtmlIfChanged(el, '<p>banner</p>');
  el.innerHTML = ''; // e.g. renderNowBanner yielding to a live Big Board
  assert.ok(setHtmlIfChanged(el, '<p>banner</p>'));
});

test('the home panels that re-render on every snapshot go through the guard', () => {
  const src = readFixture('../app.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  ['renderFooter', 'renderFollowCard', 'renderBonuses', 'renderMemoryVerse', 'renderMealCleanup', 'renderNowBanner', 'renderDayTabs']
    .forEach((fn) => assert.ok(body(fn).includes('setHtmlIfChanged('), fn + ' skips unchanged rebuilds'));
  // The progress bar is nudged in place, never re-created, when only the
  // elapsed time moved.
  assert.ok(/bar\.setAttribute\('value'/.test(body('renderNowBanner')));
});

test('no CSS rule animates every property', () => {
  // `transition: all` on a chip made its line-height and visibility animate
  // each time a panel was rebuilt — a twitch on every score anyone saved.
  const css = readFixture('../styles.css');
  assert.notOk(/transition:\s*all\b/.test(css), 'name the properties a transition is for');
});
