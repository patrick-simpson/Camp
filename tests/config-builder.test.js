// The builder side of the config engine v2 (build step 9): what settings.js does with
// it. The game editor writes only the fields it changed onto the game as it is NOW
// (setup-rebuild-spec §6.3.5 — a colleague's other field survives, a field both changed is
// asked about, a game removed meanwhile is offered back), the notes strip lists what the
// engine set aside (Put it back / Use mine), and an Undo makes the builder repaint. The
// engine itself is tests/config-sync.test.js; the undo entries are tests/undo.test.js.
// Run under the senior profile too (config-builder.senior.test.js evals this file).

const csClone = (v) => JSON.parse(JSON.stringify(v));

function csToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  try { return fn(toasts); } finally { showToast = real; }
}

async function csToastsAsync(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  try { return await fn(toasts); } finally { showToast = real; }
}

// ── The game editor writes only what it changed (spec §6.3.5) ────────

function gdSetup() {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  undoClear();
  state.ui.view = 'settings';
  state.ui.builderScreen = 'classic'; // the classic builder is a screen of the Set up the week frame (setup-ui.js)
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  gameDraftOrigin = null;
}

function gdOpen(id) {
  state.ui.editGameId = id;
  gameDraft = null;
  gameDraftFor = null;
  ensureGameDraft();
  return gameDraft;
}

function gdConfirm(answer, fn) {
  const real = globalThis.confirm;
  const asked = [];
  globalThis.confirm = (msg) => { asked.push(msg); return answer; };
  try { fn(asked); } finally { globalThis.confirm = real; }
  return asked;
}

// Another director's edit reaching this phone while its editor is open.
function gdColleague(fn) {
  const remote = csClone(state.config);
  fn(remote);
  applyRemoteConfig(remote);
}

function gdTeardown() {
  state.ui.view = 'home';
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  gameDraftOrigin = null;
  undoClear();
  setMemberRole(null);
}

test('Save writes only the fields this editor changed, onto the game as it is NOW; a colleague\'s other field is kept without a question', () => {
  gdSetup();
  try {
    csToasts((toasts) => {
      const id = state.config.games[0].id;
      const draft = gdOpen(id);
      assert.ok(gameDraftOrigin && gameDraftOrigin.id === id, 'the sheet remembers the game as it opened');
      draft.name = 'My new name';
      gdColleague((c) => { const g = c.games.find((x) => x.id === id); g.location = 'Their gym'; g.headline = 'Their tagline'; });
      assert.equal(gameDraft.name, 'My new name', 'a dirty draft survives their snapshot');
      const asked = gdConfirm(true, () => { saveGameDraft(); });
      assert.equal(asked.length, 0, 'nothing of theirs is in question');
      const g = gameById(id);
      assert.equal(g.name, 'My new name', 'my field');
      assert.equal(g.location, 'Their gym', 'their field survived my save');
      assert.equal(g.headline, 'Their tagline');
      const e = undoRecent()[0];
      assert.deepEqual(e.ops.map((op) => op[1]), ['games/' + id + '/name'], 'the undo entry holds only what I changed');
      assert.ok(/^Renamed /.test(e.label), e.label);
      assert.equal(state.ui.editGameId, null, 'the sheet closed');
    });
  } finally { gdTeardown(); }
});

test('a field BOTH of us changed is asked about INLINE (Keep mine / Use theirs), nothing is written until each has a pick, and my other edits are saved either way', () => {
  ['mine', 'theirs'].forEach((pick) => {
    gdSetup();
    try {
      csToasts(() => {
        const id = state.config.games[0].id;
        const draft = gdOpen(id);
        draft.location = 'Field 2';
        draft.headline = 'My tagline';
        gdColleague((c) => { c.games.find((x) => x.id === id).location = 'Their gym'; });
        const asked = gdConfirm(true, () => { saveGameDraft(); });
        assert.deepEqual(asked, [], 'no native confirm any more');
        assert.equal(gameById(id).location, 'Their gym', 'nothing was written by the first tap');
        assert.equal(gameById(id).headline, state.config.games[0].headline, 'not even the field nobody else touched');
        assert.ok(gameClash && gameClash.gid === id && gameClash.items.length === 1, 'the inline question is up');
        const item = gameClash.items[0];
        assert.deepEqual([item.f, item.label, item.mine, item.theirs, item.pick], ['location', 'Location', 'Field 2', 'Their gym', null]);
        const view = gameClashView(draft);
        assert.deepEqual(view.waiting, ['Location']);
        assert.ok(/While you were editing, someone changed <b>Location<\/b>/.test(view.html), 'the config has no authorship: someone');
        assert.ok(/role="radiogroup"/.test(view.html) && /data-clash-pick="mine"/.test(view.html) && /data-clash-pick="theirs"/.test(view.html));
        assert.ok(/Keep mine<\/span><span class="clash-val">Field 2</.test(view.html) && /Use theirs<\/span><span class="clash-val">Their gym</.test(view.html), 'the two actual answers');
        assert.ok(/aria-checked="false"/.test(view.html) && !/aria-checked="true"/.test(view.html));
        // Save is a dashed well until there is a pick: tapping it again writes nothing and asks again.
        saveGameDraft();
        assert.equal(gameById(id).location, 'Their gym');
        gameClash.items[0].pick = pick;
        assert.deepEqual(gameClashView(draft).waiting, []);
        assert.ok(new RegExp('aria-checked="true" data-clash-pick="' + pick + '"').test(gameClashView(draft).html));
        saveGameDraft();
        assert.equal(gameById(id).location, pick === 'mine' ? 'Field 2' : 'Their gym');
        assert.equal(gameById(id).headline, 'My tagline', 'the field nobody else touched is saved either way');
        assert.equal(gameClash, null, 'settled');
        assert.equal(state.ui.editGameId, null, 'the sheet closed');
      });
    } finally { gdTeardown(); }
  });
});

test('a pick is about the values it was made on: a colleague changing the field again asks again; their reverting it removes the question', () => {
  gdSetup();
  try {
    csToasts(() => {
      const id = state.config.games[0].id;
      const draft = gdOpen(id);
      draft.location = 'Field 2';
      gdColleague((c) => { c.games.find((x) => x.id === id).location = 'Their gym'; });
      saveGameDraft();
      gameClash.items[0].pick = 'mine';
      gdColleague((c) => { c.games.find((x) => x.id === id).location = 'Another place'; });
      saveGameDraft();
      assert.equal(gameById(id).location, 'Another place', 'not saved: the answer changed under the pick');
      assert.equal(gameClash.items[0].pick, null);
      assert.equal(gameClash.items[0].theirs, 'Another place');
      // They put it back to what it was when I opened the sheet: nothing left to ask.
      const origin = gameDraftOrigin.location;
      gdColleague((c) => { c.games.find((x) => x.id === id).location = origin; });
      saveGameDraft();
      assert.equal(gameById(id).location, 'Field 2', 'no clash: just my edit');
      assert.equal(gameClash, null);
    });
  } finally { gdTeardown(); }
});

test('the editor markup: the inline question sits above Save, Save is a dashed well naming what to pick, and values are escaped', () => {
  gdSetup();
  try {
    csToasts(() => {
      const id = state.config.games[0].id;
      const draft = gdOpen(id);
      draft.location = '<img src=x onerror=alert(1)>';
      gdColleague((c) => { c.games.find((x) => x.id === id).location = 'Gym'; });
      saveGameDraft();
      const card = document.getElementById('gd-card-test');
      renderGameEditor(card);
      const html = card.innerHTML;
      assert.ok(html.indexOf('id="gd-clashes"') !== -1 && html.indexOf('id="gd-clashes"') < html.indexOf('id="gd-save-btn"'), 'above Save');
      assert.ok(/<button type="button" class="btn btn-block" id="gd-save-btn" aria-disabled="true">Pick one for Location, then save<\/button>/.test(html), 'a dashed well, not a greyed-out Save');
      assert.ok(html.indexOf('<img src=x') === -1 && html.indexOf('&lt;img src=x') !== -1, 'a typed value never becomes markup');
      gameClash.items[0].pick = 'theirs';
      renderGameEditor(card);
      assert.ok(/<jelly-button class="primary-btn" id="gd-save-btn">Save game<\/jelly-button>/.test(card.innerHTML), 'with a pick, Save is Save');
    });
  } finally { gdTeardown(); }
});

test('a game removed while its editor was open: asked in a dialog (Put it back with my changes / Discard my changes); dismissing it changes nothing', async () => {
  for (const choice of ['back', 'discard', null]) {
    gdSetup();
    const realAsk = globalThis.askDialog;
    const asked = [];
    globalThis.askDialog = async (o) => { asked.push(o); return choice; };
    try {
      await csToastsAsync(async () => {
        const id = state.config.games[0].id;
        const draft = gdOpen(id);
        draft.location = 'My edit';
        gdColleague((c) => { c.games = c.games.filter((x) => x.id !== id); });
        assert.equal(gameById(id), undefined);
        await saveGameDraft();
        assert.equal(asked.length, 1);
        assert.ok(/^Someone deleted “.*” while you were editing it$/.test(asked[0].title), asked[0].title);
        assert.deepEqual(asked[0].actions.map((a) => a.label), ['Discard my changes', 'Put it back with my changes'], 'a verb on each');
        assert.equal(asked[0].actions[1].kind, 'gold');
        if (choice === 'back') {
          assert.equal(gameById(id).location, 'My edit', 'back, with my change');
          assert.equal(state.ui.editGameId, null);
        } else if (choice === 'discard') {
          assert.equal(gameById(id), undefined, 'discarded');
          assert.equal(state.ui.editGameId, null);
          assert.equal(gameDraft, null);
        } else {
          assert.equal(gameById(id), undefined);
          assert.equal(state.ui.editGameId, id, 'dismissed: still editing, the draft is the only copy');
          assert.ok(gameDraft && gameDraft.location === 'My edit');
        }
      });
    } finally { globalThis.askDialog = realAsk; gdTeardown(); }
  }
});

test('saving without a change commits nothing and says nothing', () => {
  gdSetup();
  try {
    csToasts((toasts) => {
      const id = state.config.games[0].id;
      gdOpen(id);
      const stamp = state.config.updatedAt;
      saveGameDraft();
      assert.equal(undoRecent().length, 0);
      assert.equal(toasts.length, 0);
      assert.equal(state.config.updatedAt, stamp, 'no false "Last edited"');
      assert.deepEqual(cfgUnconfirmed(), {});
    });
  } finally { gdTeardown(); }
});

test('a new game is one create op (the whole record), and undoing it removes it', () => {
  gdSetup();
  try {
    csToasts(() => {
      state.ui.editGameId = 'new';
      gameDraft = null;
      gameDraftFor = null;
      ensureGameDraft();
      gameDraft.name = 'Rain bowling';
      gameDraft.format = 'placement';
      saveGameDraft();
      const g = state.config.games.find((x) => x.name === 'Rain bowling');
      assert.ok(g);
      const e = undoRecent()[0];
      assert.deepEqual(e.ops.map((op) => op[1]), ['games/' + g.id], 'one whole-record op');
      assert.equal(e.ops[0][2], null, 'before: it did not exist');
      undoEntry(e.id);
      assert.equal(gameById(g.id), undefined);
    });
  } finally { gdTeardown(); }
});

test('Put it back / Use mine render as notes above the builder tabs, escaped, and their buttons act', () => {
  gdSetup();
  try {
    csToasts(() => {
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
    });
  } finally { gdTeardown(); }
});

test('an Undo makes the builder forget its markup memo, so a text field that kept what was typed is repainted', () => {
  gdSetup();
  const realGet = document.getElementById;
  const cards = [{ __html: '<p>old</p>' }, { __html: '<p>old</p>' }];
  document.getElementById = (id) => (id === 'settings-view' ? { querySelectorAll: () => cards } : realGet(id));
  try {
    csToasts(() => {
      const g = state.config.games[0];
      configEdit('Renamed', () => { gameById(g.id).name = 'Typed'; });
      assert.equal(cards[0].__html, '<p>old</p>', 'a plain commit leaves the cards alone (no blur-time rebuild)');
      undoEntry(undoRecent()[0].id);
      assert.ok(cards.every((c) => c.__html === null), 'the memo is forgotten, so setHtmlIfChanged cannot call the restored value "unchanged"');
    });
  } finally { document.getElementById = realGet; gdTeardown(); }
});
