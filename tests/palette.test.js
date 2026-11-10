// The team colour palette and the one place a team colour is laundered (BUILD-PLAN Step 25,
// setup-rebuild-spec Appendix A). Three things are pinned here:
//   1. the twelve swatches clear the contrast rule in BOTH themes, recomputed with an independent WCAG
//      implementation against the app's own --paper / --sheet read out of styles.css (so a re-theme that
//      moves a surface is noticed here, not by a counselor squinting at a flag);
//   2. a colour that comes from the database can only ever SELECT a swatch: hostile strings in a team
//      record's `color` never reach a style attribute (teamAccentVars is the one place that launders);
//   3. the board renderers and the emoji tile all take the laundered pair, and
//      styles.css turns the pair into --team-accent for the theme in force.
// palette.senior.test.js evals this file under the senior profile.

const APP_SRC = readFixture('../app.js');
const CSS_SRC = readFixture('../styles.css');

// ── an independent WCAG implementation (the shipped campContrast is checked against it) ──
function relLum(hex) {
  const c = (i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}
function ratio(a, b) {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// The surfaces, read from the stylesheet: the first --paper / --sheet is the light :root, the second the
// explicit dark block, the third the OS-dark block (which must say the same).
function surfaces() {
  const all = (name) => (CSS_SRC.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g')) || []).map((m) => m.slice(m.indexOf('#')));
  const paper = all('paper'), sheet = all('sheet');
  return { lightPaper: paper[0], lightSheet: sheet[0], darkPaper: paper[1], darkSheet: sheet[1], osPaper: paper[2], osSheet: sheet[2] };
}

const SWATCH_IDS = ['red', 'pumpkin', 'gold', 'green', 'forest', 'teal', 'blue', 'indigo', 'purple', 'berry', 'brown', 'slate'];

test('the palette is the twelve swatches of Appendix A, in order, each a hex light/dark pair, frozen', () => {
  assert.deepEqual(Object.keys(CAMP_TEAM_PALETTE), SWATCH_IDS);
  SWATCH_IDS.forEach((id) => {
    const sw = CAMP_TEAM_PALETTE[id];
    assert.ok(/^#[0-9a-f]{6}$/.test(sw.l) && /^#[0-9a-f]{6}$/.test(sw.d), id + ' is a light and a dark hex');
    assert.ok(typeof sw.name === 'string' && sw.name.length >= 3, id + ' has a name to read out');
    assert.ok(Object.isFrozen(sw), id + ' cannot be edited at run time');
    assert.ok(/^[a-z]{2,12}$/.test(id), id + ' fits the rules\' pattern for state/teams/$i/color');
  });
  assert.ok(Object.isFrozen(CAMP_TEAM_PALETTE));
  assert.equal(new Set(SWATCH_IDS.map((id) => CAMP_TEAM_PALETTE[id].l)).size, 12, 'no two swatches share a light value');
  assert.equal(new Set(SWATCH_IDS.map((id) => CAMP_TEAM_PALETTE[id].d)).size, 12, 'no two swatches share a dark value');
});

test('every swatch clears the contrast rule in both themes, recomputed against the app\'s own surfaces', () => {
  const s = surfaces();
  Object.keys(s).forEach((k) => assert.ok(/^#[0-9a-fA-F]{6}$/.test(s[k]), 'found ' + k + ' in styles.css: ' + s[k]));
  assert.equal(s.darkPaper, s.osPaper, 'the OS-dark block keeps in step with the explicit dark one');
  assert.equal(s.darkSheet, s.osSheet);
  SWATCH_IDS.forEach((id) => {
    const { l, d } = CAMP_TEAM_PALETTE[id];
    // Team colour is identity (an outline, a flag, a 16px+ name), never small text: 4.5:1 is the floor (§8.1 rule 6).
    assert.ok(ratio(l, s.lightPaper) >= 4.5, `${id} light on paper ${ratio(l, s.lightPaper).toFixed(2)}`);
    assert.ok(ratio(l, s.lightSheet) >= 4.5, `${id} light on sheet ${ratio(l, s.lightSheet).toFixed(2)}`);
    assert.ok(ratio(d, s.darkPaper) >= 4.5, `${id} dark on paper ${ratio(d, s.darkPaper).toFixed(2)}`);
    assert.ok(ratio(d, s.darkSheet) >= 4.5, `${id} dark on sheet ${ratio(d, s.darkSheet).toFixed(2)}`);
    // And a label on the swatch as a fill: white on the light value, the dark ink on the dark one.
    assert.ok(ratio('#ffffff', l) >= 4.5, `${id}: white on its light value ${ratio('#ffffff', l).toFixed(2)}`);
    assert.ok(ratio('#181b1d', d) >= 4.5, `${id}: dark ink on its dark value ${ratio('#181b1d', d).toFixed(2)}`);
  });
});

test('campContrast is the WCAG ratio, and 0 for anything that is not two hex colours', () => {
  const pairs = [['#000000', '#ffffff'], ['#b42318', '#fffdf8'], ['#ff8a80', '#161c4b'], ['#345b96', '#161c4b'], ['#e2672b', '#f5efe2']];
  pairs.forEach(([a, b]) => {
    assert.ok(Math.abs(campContrast(a, b) - ratio(a, b)) < 1e-9, a + ' vs ' + b);
    assert.ok(Math.abs(campContrast(b, a) - campContrast(a, b)) < 1e-12, 'symmetric');
  });
  assert.ok(Math.abs(campContrast('#000000', '#ffffff') - 21) < 1e-9);
  ['', null, undefined, 'red', '#fff', '#12345g', 12, {}].forEach((bad) => assert.equal(campContrast(bad, '#ffffff'), 0, JSON.stringify(bad)));
});

// ── a team record's colour: a database string only SELECTS a swatch ──
const HOSTILE = [
  'red;background:url(//evil.example/x)', '"><img src=x onerror=alert(1)>', '#fff;}body{display:none}', 'red"', "red'", 'RED', 'Red', ' red',
  'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'a', 'x'.repeat(40), 'var(--x)', 'url(javascript:alert(1))', '#12345', '#1234567',
  123, null, true, {}, ['red'], { l: '#ff0000', d: '#00ff00' },
];
const SAFE_CHARS = /^[-a-z0-9:;#]*$/;

test('teamAccentVars: no colour on the record = the camp\'s own colour for both themes, a swatch = its pair', () => {
  freshState();
  teamIds().forEach((id) => {
    const legacy = TEAM_ACCENT[id];
    assert.equal(teamAccentVars(id), legacy ? `--team-accent-l:${legacy};--team-accent-d:${legacy}` : '', id + ' keeps its older colour');
    assert.equal(teamAccent(id), legacy || null, id + ' light value');
  });
  SWATCH_IDS.forEach((cid) => {
    state.teams[0].color = cid;
    assert.equal(teamAccentVars('t0'), `--team-accent-l:${CAMP_TEAM_PALETTE[cid].l};--team-accent-d:${CAMP_TEAM_PALETTE[cid].d}`, cid);
    assert.equal(teamAccent('t0'), CAMP_TEAM_PALETTE[cid].l, cid + ' light value is the one plain hex');
    assert.equal(teamColorId('t0'), cid);
  });
  assert.equal(teamAccentVars('t99'), '', 'a team the roster has no record of has no colour');
  assert.equal(teamAccent('t99'), null);
  assert.equal(teamColorId('t99'), '');
  freshState();
});

test('teamAccentVars: a hostile colour from the database never reaches a style attribute', () => {
  freshState();
  HOSTILE.forEach((bad) => {
    state.teams[0].color = bad;
    const vars = teamAccentVars('t0');
    const legacy = TEAM_ACCENT.t0;
    assert.equal(vars, legacy ? `--team-accent-l:${legacy};--team-accent-d:${legacy}` : '', 'falls back to the camp colour for ' + JSON.stringify(bad));
    assert.ok(SAFE_CHARS.test(vars), 'only hex digits and fixed names: ' + vars);
    assert.equal(teamColorId('t0'), '', JSON.stringify(bad) + ' selects no swatch');
    const attr = teamAccentAttr('t0');
    assert.ok(attr === '' || /^ style="--team-accent-l:#[0-9a-f]{6};--team-accent-d:#[0-9a-f]{6}"$/.test(attr), 'attribute: ' + attr);
  });
  // A camp with no colour of its own for a team and a hostile string: nothing at all, never the string.
  state.teams.push({ id: 't9', name: 'Extra', counselor: '', color: 'red;x' });
  assert.equal(teamAccentVars('t9'), '');
  assert.equal(teamAccentAttr('t9'), '');
  freshState();
});

test('teamAccentVars: a record whose roster entry is junk, or a state with no roster, never throws', () => {
  freshState();
  const keep = state.teams;
  [undefined, null, [], [null, undefined, 5, 'x', { name: 'no id' }]].forEach((roster) => {
    state.teams = roster;
    ['t0', 't99'].forEach((id) => { assert.doesNotThrow(() => { teamAccentVars(id); teamAccent(id); teamAccentAttr(id); teamColorId(id); }); });
  });
  state.teams = keep;
  freshState();
});

// ── where the pair goes ──
test('the emoji tile takes the pair too: its edge is the team colour for the theme in force', () => {
  freshState();
  state.teams.push({ id: 't9', name: 'Extra', counselor: '', color: 'teal' });
  const spec = teamMarkSpec('t9');
  assert.equal(spec.kind, 'tile');
  assert.equal(spec.accent, `--team-accent-l:${CAMP_TEAM_PALETTE.teal.l};--team-accent-d:${CAMP_TEAM_PALETTE.teal.d}`);
  const html = teamMarkHtml('t9', { size: 20 });
  assert.ok(html.includes('data-team="t9"') && html.includes('--team-accent-l:' + CAMP_TEAM_PALETTE.teal.l) && html.includes('--tm-accent:var(--team)'), html);
  state.teams[state.teams.length - 1].color = '"><script>x</script>';
  assert.equal(teamMarkSpec('t9').accent, '', 'a hostile colour gives a tile with no accent');
  assert.notOk(/script|--tm-accent/.test(teamMarkHtml('t9', { size: 20 })));
  freshState();
});

test('the board renderers and the tile take the laundered pair; nothing interpolates a raw colour', () => {
  assert.notOk(/--team-accent\s*:\s*\$\{/.test(APP_SRC), 'no raw --team-accent: ${…} left in app.js');
  assert.notOk(/setProperty\('--team-accent'/.test(APP_SRC), 'nothing writes a single raw colour');
  assert.notOk(/paintTeamAccent/.test(APP_SRC), 'the follow card (its only caller) is gone');
  assert.equal((APP_SRC.match(/\$\{teamAccentAttr\(/g) || []).length, 2, 'the two board renderers');
  assert.ok(/accent: teamAccentVars\(id\)/.test(APP_SRC), 'the tile');
  // teamAccent() (one plain hex) is for callers that cannot take the pair; it is itself derived from the laundered pair.
  const body = APP_SRC.slice(APP_SRC.indexOf('function teamAccent(id)'), APP_SRC.indexOf('function teamAccent(id)') + 200);
  assert.ok(/teamAccentVars\(id\)/.test(body));
});

test('styles.css turns the pair into --team-accent for the theme in force, on every surface that reads it', () => {
  const sel = '.board-col {\n  --team-accent: var(--team-accent-l);\n}';
  assert.ok(CSS_SRC.includes(sel), 'light: the -l half');
  assert.ok(CSS_SRC.includes(':root[data-jelly-mode="dark"] .board-col {\n  --team-accent: var(--team-accent-d, var(--team-accent-l));'), 'an explicit Dark');
  assert.ok(CSS_SRC.includes(':root:not([data-jelly-mode="light"]) .board-col {\n    --team-accent: var(--team-accent-d, var(--team-accent-l));'), 'Auto on a dark phone');
  // Every consumer keeps its fallback, so a team with no colour is still the app primary.
  const consumers = CSS_SRC.match(/var\(--team-accent[,)][^;]*/g) || [];
  assert.ok(consumers.length > 2);
  consumers.forEach((c) => assert.ok(/^var\(--team-accent, var\(--color-primary\)\)/.test(c) || /^var\(--team-accent-[ld]/.test(c), 'a --team-accent read has a fallback: ' + c));
});
