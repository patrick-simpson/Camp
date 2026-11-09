// What the config engine v2 sets aside instead of dropping (a record somebody removed while an edit of mine was on its way, an
// offline change that lost to a colleague's on the same field) is shown as notes at the top of the Games screen (setup-ui.js
// configNotesHtml; Step 30 moved the strip there from the classic builder's tabs): Put it back / Use mine / Dismiss. The engine
// is tests/config-sync.test.js; the undo entries are tests/undo.test.js; the game sheet's own field saves are games-screen.test.js.
// Run under the senior profile too (config-builder.senior.test.js evals this file).

function cbSetup() {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  undoClear();
}

test('Put it back / Use mine render as notes at the top of the Games screen, escaped, and their buttons act', () => {
  cbSetup();
  try {
    cfgSetNotes([
      { id: 'n1', kind: 'putback', section: 'games', key: 'zz', name: '<b>Zed</b>', record: { id: 'zz', name: '<b>Zed</b>', _o: 0 }, at: '' },
      { id: 'n2', kind: 'clash', path: 'games/x/location', mine: 'Field 2', theirs: '<i>Gym</i>', what: 'game “X” · location', at: '' },
    ]);
    const html = configNotesHtml();
    assert.ok(html.includes('&lt;b&gt;Zed&lt;/b&gt;') && !html.includes('<b>Zed</b>'), 'typed names are escaped');
    assert.ok(html.includes('&lt;i&gt;Gym&lt;/i&gt;'));
    assert.ok(html.includes('data-note-act="putback"') && html.includes('data-note-act="usemine"') && html.includes('data-note-act="drop"'));
    cfgSetNotes([]);
    assert.equal(configNotesHtml(), '', 'nothing to say ⇒ zero markup');
  } finally { setMemberRole(null); }
});

test('the Games screen draws the notes strip and wires its buttons once', () => {
  cbSetup();
  try {
    state.ui.builderScreen = 'games';
    cfgSetNotes([{ id: 'n1', kind: 'putback', section: 'games', key: 'zz', name: 'Zed', record: { id: 'zz', name: 'Zed', _o: 0 }, at: '' }]);
    renderGamesScreen();
    assert.ok(document.getElementById('sg-notes').innerHTML.includes('Put it back with my changes'));
    cfgSetNotes([]);
    renderGamesScreen();
    assert.equal(document.getElementById('sg-notes').innerHTML, '');
    const src = readFixture('../setup-ui.js');
    assert.ok(/data-note-act\]/.test(src) && /cfgPutBack\(btn\.dataset\.noteId\)/.test(src) && /cfgUseMine/.test(src) && /cfgDropNote/.test(src));
    assert.ok(/id="sg-notes"/.test(readFixture('../index.html')), 'the strip is in the Games screen\'s markup');
  } finally { setMemberRole(null); state.ui.builderScreen = undefined; }
});
