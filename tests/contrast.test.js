// Danger red used AS TEXT (setup-rebuild-spec S0d). --color-danger is a FILL:
// it is tuned to carry white text, so as text it is 4.26:1 on the light page
// grey and follows Jelly's rose around. Text uses --color-danger-text instead. The
// rendered colours need a browser; these pin the token values and that no rule
// colours text with the fill again.

const CSS = readFixture('../styles.css');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// In file order: the light :root, then the explicit-dark block, then the
// prefers-color-scheme: dark block.
const TEXT_TOKENS = [...CSS_NO_COMMENTS.matchAll(/--color-danger-text:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);

test('danger text has a hard-coded colour in the light theme and both dark blocks', () => {
  assert.equal(TEXT_TOKENS.length, 3, 'light :root, body.dark-theme, and the Auto dark media block');
});

test('light danger text passes AA (4.5:1) on white and on the light page grey', () => {
  const light = TEXT_TOKENS[0];
  assert.ok(contrast(light, '#ffffff') >= 4.5, 'white: ' + contrast(light, '#ffffff').toFixed(2));
  assert.ok(contrast(light, '#f4f6f9') >= 4.5, 'light grey: ' + contrast(light, '#f4f6f9').toFixed(2));
});

test('dark danger text passes AA on the dark surface and page', () => {
  TEXT_TOKENS.slice(1).forEach((c) => {
    assert.ok(contrast(c, '#1a2030') >= 4.5, c + ' on the dark surface: ' + contrast(c, '#1a2030').toFixed(2));
    assert.ok(contrast(c, '#181b1d') >= 4.5, c + ' on the dark page: ' + contrast(c, '#181b1d').toFixed(2));
  });
  assert.equal(TEXT_TOKENS[1], TEXT_TOKENS[2], 'explicit Dark and Auto-on-a-dark-OS agree');
});

test('the old fill would have failed: that is why the token exists', () => {
  assert.ok(contrast('#d63b3b', '#f4f6f9') < 4.5, 'the light fill fallback is under AA as text on the page grey');
});

test('no rule colours TEXT with the danger fill — only --color-danger-text', () => {
  // `background`, `border-color` and `box-shadow` may use the fill; a bare
  // `color:` may not. (`(?<![-\w])` keeps `background-color` / `border-color`
  // out of the match.)
  const bad = [...CSS_NO_COMMENTS.matchAll(/(?<![-\w])color:\s*var\(--color-danger\)/g)];
  assert.equal(bad.length, 0, bad.length + ' rule(s) use color: var(--color-danger) — switch them to --color-danger-text');
});

test('.danger-link uses the text token, as does the Remove-style footer link', () => {
  const rule = /\.danger-link\s*\{[^}]*\}/.exec(CSS_NO_COMMENTS);
  assert.ok(rule && rule[0].includes('var(--color-danger-text)'), rule && rule[0]);
});

// ── The Games tab's day picker (Step 18): its status words are 12.5px text, so they owe 7:1 (redesign §8.1 rule 6) on BOTH grounds a
// day button has — the recessed well and the lifted pill of the chosen day — in all three palette blocks (light, explicit Dark,
// Auto on a dark OS). "Today" had been the link blue at 6.9:1 in light; --link-well is the one blue made for these grounds.
function palette(name) {
  return [...CSS_NO_COMMENTS.matchAll(new RegExp('(?<![\\w-])--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g'))].map((m) => m[1]);
}
test('the day picker\'s Today, Done and plain status words reach 7:1 on the well and on the lifted pill, light and both dark blocks', () => {
  const [wells, lifts] = [palette('well'), palette('lift')];
  const ink = { 'Today (--link-well)': palette('link-well'), 'Done (--done)': palette('done'), 'games left (--ink-2)': palette('ink-2') };
  assert.equal(wells.length, 3); assert.equal(lifts.length, 3);
  Object.keys(ink).forEach((what) => {
    assert.equal(ink[what].length, 3, what + ' is defined in light, explicit Dark and the Auto dark block');
    ink[what].forEach((c, i) => {
      const block = ['light', 'dark', 'auto dark'][i];
      assert.ok(contrast(c, wells[i]) >= 7, what + ' on the well, ' + block + ': ' + contrast(c, wells[i]).toFixed(2));
      assert.ok(contrast(c, lifts[i]) >= 7, what + ' on the lifted pill, ' + block + ': ' + contrast(c, lifts[i]).toFixed(2));
    });
  });
  assert.equal(palette('link-well')[1], palette('link-well')[2], 'explicit Dark and Auto-on-a-dark-OS agree');
});
test('the day picker\'s Today word and dot use --link-well, not the thinner link blue', () => {
  assert.ok(/\.gdp-btn\[data-st="today"\] \.gdp-st\s*\{[^}]*color:\s*var\(--link-well\)/.test(CSS_NO_COMMENTS), 'the word');
  assert.ok(/\.gdp-btn\[data-st="today"\] \.gdp-st::before\s*\{[^}]*background:\s*var\(--link-well\)/.test(CSS_NO_COMMENTS), 'the dot at very large text');
});
