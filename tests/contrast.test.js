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
