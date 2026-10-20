// Test runner context includes test(), assert, and the app's global state

test('campDateStr returns a date string in YYYY-MM-DD format', () => {
  const result = campDateStr();
  assert.ok(result.match(/^\d{4}-\d{2}-\d{2}$/), `expected YYYY-MM-DD, got ${result}`);
});

test('campDateStr handles Intl.DateTimeFormat errors safely', () => {
  const OriginalDTF = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function() { throw new Error('Simulated failure'); };
    const result = campDateStr();
    assert.equal(result, '', 'expected empty string on error');
  } finally {
    Intl.DateTimeFormat = OriginalDTF;
  }
});
