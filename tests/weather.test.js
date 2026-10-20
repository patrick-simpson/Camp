test('processWeather handles null, empty, and invalid JSON', () => {
  assert.equal(processWeather(null), null);
  assert.equal(processWeather(undefined), null);
  assert.equal(processWeather({}), null);
  assert.equal(processWeather({ hourly: null }), null);
  assert.equal(processWeather({ hourly: { time: null } }), null);
  assert.equal(processWeather({ hourly: { time: 'not an array' } }), null);
});

test('processWeather processes valid JSON correctly', () => {
  const payload = {
    hourly: {
      time: ['2023-08-01T12:00', '2023-08-01T13:00', '2023-08-02T12:00'],
      temperature_2m: [25.5, '26.1', null],
      weather_code: [1, '2', 3],
      precipitation_probability: [10, '20', null]
    }
  };

  const result = processWeather(payload);

  // Dates should be distinct slices
  assert.deepEqual(result.dates, ['2023-08-01', '2023-08-02']);

  // byTime dictionary structure and number coercion
  assert.ok(result.byTime['2023-08-01T12:00']);
  assert.equal(result.byTime['2023-08-01T12:00'].temp, 25.5);
  assert.equal(result.byTime['2023-08-01T12:00'].code, 1);
  assert.equal(result.byTime['2023-08-01T12:00'].precip, 10);

  assert.ok(result.byTime['2023-08-01T13:00']);
  assert.equal(result.byTime['2023-08-01T13:00'].temp, 26.1);
  assert.equal(result.byTime['2023-08-01T13:00'].code, 2);
  assert.equal(result.byTime['2023-08-01T13:00'].precip, 20);

  assert.ok(result.byTime['2023-08-02T12:00']);
  assert.equal(result.byTime['2023-08-02T12:00'].temp, 0); // null coerced to Number
  assert.equal(result.byTime['2023-08-02T12:00'].code, 3);
  assert.equal(result.byTime['2023-08-02T12:00'].precip, 0); // null coerced to Number

  // Timestamp
  assert.ok(typeof result.at === 'number');
  assert.ok(Date.now() - result.at < 1000); // Should be very recent
});
