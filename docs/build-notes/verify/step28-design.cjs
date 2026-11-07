// Step 28 design pass: the new-year setup (P2 §11.3), Undo the new-year setup (§7.3), Advanced (§10.1, §11.16), the hub's
// claim door, a past year's restore sheet and the stranded-work bar, drawn into the REAL page with the real styles.css.
// Nothing is wired yet, so this script writes the documented markup itself (index.html: the comment at #setup-wizard and
// its step comments, TALLY ROWS at #nyw-saved-list, the comments at #sheet-nyw-staff, #sheet-nyw-undo,
// #sheet-setup-advanced, #hub-door and #rp-year, and the STRANDED WORK template at #sync-alert). The specimens are a
// reference for the build session: the copy, the states and the row templates, filled from the real week through the
// page's own teamMarkHtml / teamShort / esc.
// For each specimen, camp, width (360 / 390), theme and text size (100 / 130 / 200 %) it reports tap targets under
// 44x44, sideways scroll, clipped boxes and text squeezed into a narrow column; SHOTS=1 writes screenshots (OUT=<dir>,
// default the OS temp dir + /shots/).
//   node step28-design.cjs [baseUrl]   (ONLY=<specimen>[,…], QUICK=1 for 390 light 100% only, CAMPS=junior|senior)
// Serve the worktree first: python3 -m http.server 8961 (Firebase is blocked; the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8961').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

const SPECIMENS = {
  // Step 1 with a Sunday picked: the week as a calendar, double points the same as last year, the schedule turned on first.
  w1: { build: 'wizard', step: 1, date: true, a1: true },
  // Step 1, a Wednesday typed: the nudge to the nearest Sunday; double points changed (the three fields open).
  'w1-snap': { build: 'wizard', step: 1, snap: true, double: 'change' },
  // Step 1 inside a camp week (the freeze as a question), older director devices, no signal.
  'w1-ask': { build: 'wizard', step: 1, ask: 'freeze', older: true, offline: true },
  // Step 2: the tick sheet with its defaults, the schedule's staff line; the counselors kept, to see the other note.
  w2: { build: 'wizard', step: 2, staff: true },
  // Step 2 right after Take over: the answers chosen on the other device.
  'w2-inherit': { build: 'wizard', step: 2, ask: 'inherit' },
  // Step 3 while it saves, once it is checked, and when the read-back failed.
  'w3-saving': { build: 'wizard', step: 3, save: 'saving' },
  w3: { build: 'wizard', step: 3, save: 'saved' },
  'w3-fail': { build: 'wizard', step: 3, save: 'error' },
  // Step 4: what is cleared, what stays, two incomplete sign-ins; the hold; the two-tap alternative; refused.
  w4: { build: 'wizard', step: 4, warn: true },
  'w4-confirm': { build: 'wizard', step: 4, confirm: true },
  'w4-refused': { build: 'wizard', step: 4, clear: 'error' },
  // Step 5: done, two people the follow-up couldn't move, what's next.
  w5: { build: 'wizard', step: 5, left: true },
  // The owner's other device: the claim (Take over offered), and watching step 3.
  'w-other': { build: 'wizard', step: 3, drive: 'other', takeover: true },
  'w-watch': { build: 'wizard', step: 2, drive: 'watch', takeover: true },
  // The hub: the new-year door (owner), the claim door on the owner's other device, and another director's line.
  'hub-newyear': { build: 'hub', door: 'new-year' },
  'hub-claim': { build: 'hub', door: 'wizard' },
  'hub-director': { build: 'hub', door: 'wizard', director: true },
  // The ⋯ menu with the owner's four rows (Undo within its 14 days; Use the original greyed with its reason).
  menu: { build: 'sheet', sheet: 'setup-menu' },
  staff: { build: 'sheet', sheet: 'nyw-staff' },
  undo: { build: 'sheet', sheet: 'nyw-undo' },
  'undo-confirm': { build: 'sheet', sheet: 'nyw-undo', confirm: true },
  advanced: { build: 'sheet', sheet: 'setup-advanced' },
  // A past year's restore sheet: the owner (Download, Undo) and another director (Download, the sentence).
  'year-owner': { build: 'sheet', sheet: 'restore', year: true },
  'year-director': { build: 'sheet', sheet: 'restore', year: true, director: true },
  // Restore points with a past year and the owner's Advanced row.
  backups: { build: 'backups' },
  // A phone back after the new year: the stranded-work bar on Now.
  stranded: { build: 'stranded' },
};

// Runs in the page. Writes the markup for one specimen.
function fill(sp) {
  const $ = (id) => document.getElementById(id);
  const hide = (id, h) => { const el = $(id); if (el) el.hidden = h; };
  const text = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const html = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  const senior = CAMP.id === 'senior';
  const campName = senior ? 'Senior camp' : 'Junior camp';
  const owner = !sp.director;
  authUser = owner ? { email: 'patricksimpson.fx@gmail.com', emailVerified: true } : { email: 'jenn@example.com', emailVerified: true };
  memberDirectory = { 'patricksimpson,fx@gmail,com': { role: 'editor', name: 'Patrick Simpson' } };
  memberDirectoryLoaded = true;
  document.body.classList.toggle('setup-owner', owner);
  const T = (n, what, sub, mark) => `<div class="nyw-t"><span class="nyw-t-n"${mark ? ' data-mark="' + mark + '"' : ''}>${mark ? '' : esc(String(n))}</span>` +
    `<span class="nyw-t-text"><span class="nyw-t-what">${esc(what)}</span>${sub ? '<span class="nyw-t-sub">' + esc(sub) + '</span>' : ''}</span></div>`;
  const ids = teamIds();
  const champ = ids[0];
  const name = (id) => (state.teams.find((t) => t.id === id) || {}).name || id;

  if (sp.build === 'wizard') {
    const s = $('setup-wizard');
    $('setup').setAttribute('data-screen', 'wizard');
    text('setup-back-label', 'Set up the week');
    s.setAttribute('data-step', String(sp.step));
    s.setAttribute('data-drive', sp.drive || 'me');
    text('nyw-title', 'New-year setup · ' + campName);
    for (let i = 1; i <= 5; i++) s.querySelector('[data-nyw-bar="' + i + '"]').setAttribute('data-state', i < sp.step ? 'done' : i === sp.step ? 'now' : 'todo');
    text('nyw-count', 'Step ' + sp.step + ' of 5');
    const H = {
      1: ['When is camp?', sp.date ? 'Sun, Jul 18 to Sat, Jul 24, 2027' : 'Pick the Sunday it starts.'],
      2: ['What carries over from 2026?', 'Keep what still fits. Scores are always cleared.'],
      3: sp.save === 'saved' ? ['2026 is saved', 'You can look back at it any time in Restore points.'] : ['Save 2026', 'A copy of the whole week goes into Restore points before anything is cleared.'],
      4: ['Clear the scoreboard', campName + ' starts 2027 with no results and no points.'],
      5: [campName + ' is set up for 2027', 'Jul 18–24, 2027'],
    }[sp.step];
    if (sp.drive === 'other') { H[0] = 'You’re setting up 2027 on another device'; H[1] = ''; }
    text('nyw-headline', H[0]);
    text('nyw-lede', H[1]);
    // the claim
    hide('nyw-claim', !sp.drive || sp.drive === 'me');
    if (sp.drive) {
      $('nyw-claim').setAttribute('data-claim', sp.drive === 'watch' ? 'watching' : 'other');
      text('nyw-claim-lead', 'Watching your other device · last tap 2 min ago');
      text('nyw-claim-sub', 'Last tap there 18 min ago');
      hide('nyw-takeover', !sp.takeover);
      hide('nyw-takeover-note', !!sp.takeover);
    }
    // the inline question
    hide('nyw-ask', !sp.ask);
    if (sp.ask === 'freeze') {
      text('nyw-ask-q', 'Camp week is running (Jul 19–25). The new-year setup clears its scoreboard.');
      hide('nyw-ask-list', true);
      text('nyw-ask-a', 'Not now'); text('nyw-ask-b', 'Carry on anyway'); $('nyw-ask-b').setAttribute('data-danger', '');
    } else if (sp.ask === 'inherit') {
      text('nyw-ask-q', 'You chose on your other device:');
      html('nyw-ask-list', ['Camp starts Sun, Jul 18', 'Double points the same as 2026', 'Keep the schedule and games, clear the menus and verses'].map((x) => '<li>' + esc(x) + '</li>').join(''));
      hide('nyw-ask-list', false);
      text('nyw-ask-a', 'Use these'); text('nyw-ask-b', 'Start over'); $('nyw-ask-b').removeAttribute('data-danger');
      $('nyw-ask-a').classList.add('btn-gold');
    }
    hide('nyw-older', !sp.older);
    hide('nyw-a1', !sp.a1);
    hide('nyw-offline', !sp.offline);
    // step 1
    if (sp.step === 1) {
      const inp = $('nyw-start');
      inp.value = sp.snap ? '2027-07-21' : sp.date ? '2027-07-18' : '';
      text('nyw-start-sub', sp.date ? 'Sun, Jul 18 to Sat, Jul 24' : 'A Sunday');
      text('nyw-start-was', '2026: Jul 19–25');
      hide('nyw-snap', !sp.snap);
      text('nyw-snap-q', 'Camp weeks start on a Sunday. Did you mean Sun, Jul 18?');
      text('nyw-snap-use', 'Use Sun, Jul 18');
      hide('nyw-sec-week', !sp.date);
      text('nyw-week-month', 'July 2027');
      const tags = (CAMP.schedDays || []).map((d) => d.tag);
      document.querySelectorAll('#nyw-days .nyw-day').forEach((li, i) => {
        li.querySelector('[data-nyw-date]').textContent = String(18 + i);
        li.querySelector('[data-nyw-tag]').textContent = tags[i] || '';
      });
      text('nyw-double-same-sub', 'Thursday 5:00 PM until the end of Friday');
      const dbl = sp.double || 'same';
      document.querySelectorAll('[data-nyw-double]').forEach((b) => b.setAttribute('aria-checked', b.dataset.nywDouble === dbl ? 'true' : 'false'));
      hide('nyw-double-form', dbl !== 'change');
      if (dbl === 'change') {
        html('nyw-double-from', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => '<option' + (d === 'Thursday' ? ' selected' : '') + '>' + d + '</option>').join(''));
        $('nyw-double-at').value = '17:00';
        html('nyw-double-until', '<option>the end of Friday</option><option>the end of Saturday</option>');
      }
    }
    // step 2
    if (sp.step === 2) {
      document.querySelectorAll('#nyw-carry [data-feature="electives"]').forEach((r) => { r.hidden = !(CAMP.features && CAMP.features.electives); });
      hide('nyw-staff', !sp.staff);
      text('nyw-staff-text', senior ? '2 items name people: Devotions — Coach Dave, Pizza with Ms. Kim.' : '4 items name people: Snack and campfire — TJ, Laura’s cottage, and 2 more.');
    }
    // step 3
    if (sp.step === 3) {
      const st = $('nyw-save-state');
      const tone = sp.save || 'saving';
      st.setAttribute('data-tone', tone);
      text('nyw-save-text', tone === 'saved' ? 'Saved and checked: the copy on the server matches' : tone === 'error' ? 'Couldn’t check the saved copy. Nothing is cleared until it matches.' : 'Saving 2026…');
      hide('nyw-save-retry', tone !== 'error');
      hide('nyw-sec-saved', tone !== 'saved' && sp.drive !== 'watch');
      html('nyw-saved-list', `<div class="nyw-t nyw-champ"><span class="nyw-t-n">${teamMarkHtml(champ, { size: 34 })}</span><span class="nyw-t-text"><span class="nyw-t-what">${esc(name(champ))} won 2026</span><span class="nyw-t-sub">211 points</span></span></div>` +
        T(22, 'game results', 'Monday to Friday') + T(61, 'bonus points', 'Verse, cleanup and quick points') + T(senior ? 4 : 6, 'teams', 'Names, emoji, colours and photos') + T('', 'The schedule, games, menus and verses', '', 'item'));
      hide('nyw-save-download', tone !== 'saved');
    }
    // step 4
    if (sp.step === 4) {
      html('nyw-clear-list', T(22, 'game results') + T(61, 'bonus points', 'Verse, cleanup and quick points') + T(2, 'brackets in progress') + T(3, 'announcements') +
        T(senior ? 41 : 64, 'campers', 'First names, by team') + T(2, 'requests to join') + T('', 'Meal menus, memory verses and team photos', 'As you chose', 'item') +
        T('', 'Notice board', 'Back to a draft', 'item') + T(14, 'counselors taken off their teams', 'Right after the clear'));
      text('nyw-kept-text', 'the schedule, games, team names, cleanup rota and every sign-in.');
      hide('nyw-members-warn', !sp.warn);
      text('nyw-members-warn-text', '2 sign-in records are incomplete (Sam R., Jo), so they stay on their teams. Fix them in People.');
      const st = $('nyw-clear-state');
      hide('nyw-clear-state', !sp.clear);
      if (sp.clear) { st.setAttribute('data-tone', 'error'); text('nyw-clear-text', 'Nothing was cleared: the server turned it away (Teams).'); }
      hide('nyw-clear-retry', sp.clear !== 'error');
    }
    // step 5
    if (sp.step === 5) {
      html('nyw-done-list', T('', '2026 saved', 'In Restore points, under Past years', 'check') + T('', 'Scoreboard cleared', '', 'check') + T('', '12 counselors taken off their teams', '', 'check'));
      hide('nyw-left', !sp.left);
      text('nyw-left-q', 'Couldn’t take 2 people off their teams: their sign-in records are incomplete.');
      html('nyw-left-list', '<li>Sam R. · ' + esc(name(ids[1])) + '</li><li>Jo · ' + esc(name(ids[2])) + '</li>');
      text('nyw-done-undo-text', 'Changed your mind? Undo the new-year setup is in the ⋯ menu until Jul 25.');
    }
    // the dock
    const back = $('nyw-back'); const next = $('nyw-next');
    back.hidden = sp.step === 1 || sp.step >= 4;
    next.hidden = sp.step === 4;
    next.removeAttribute('aria-disabled');
    const NEXT = { 1: 'Next: what carries over', 2: 'Next: save 2026', 3: 'Next: clear the scoreboard', 5: 'Go to the checklist' };
    next.textContent = NEXT[sp.step] || '';
    if (sp.step === 1 && !sp.date && !sp.snap) { next.setAttribute('aria-disabled', 'true'); next.textContent = 'Pick the Sunday camp starts'; }
    if (sp.step === 1 && sp.offline) { /* answers are local: Next still works */ }
    if (sp.step === 3 && sp.save !== 'saved') { next.setAttribute('aria-disabled', 'true'); next.textContent = sp.save === 'error' ? 'Check the copy first' : 'Saving 2026…'; }
    const hold = sp.step === 4;
    text('nyw-hold-label', 'Hold to clear ' + campName + '’s scoreboard');
    text('nyw-hold-confirm', 'Yes, clear ' + campName + '’s scoreboard');
    hide('nyw-hold-btn', !hold || !!sp.confirm);
    hide('nyw-hold-confirm', !(hold && sp.confirm));
    hide('nyw-hold-cancel', !(hold && sp.confirm));
    hide('nyw-back-quiet', !hold || !!sp.confirm);
    return;
  }

  if (sp.build === 'hub') {
    $('setup').setAttribute('data-screen', 'hub');
    window.renderSetupUi = () => {};
    const door = $('hub-door');
    door.hidden = false;
    door.setAttribute('data-door', sp.door);
    door.removeAttribute('data-quiet');
    if (sp.door === 'new-year') {
      text('hub-door-lead', 'Getting ready for 2027?');
      text('hub-door-text', 'Five steps, about ten minutes: when camp is, what carries over, saving 2026, then clearing the scoreboard.');
      text('hub-door-btn', 'Start the new-year setup');
      hide('hub-door-btn', !owner); hide('hub-door-pair', true);
      text('hub-door-owner-text', 'Patrick starts the new-year setup.');
      hide('hub-door-owner', owner);
    } else {
      text('hub-door-lead', owner ? 'You’re setting up 2027 on another device' : 'Patrick is setting up 2027 (step 3 of 5).');
      text('hub-door-text', owner ? 'Step 3 of 5 · last tap 18 min ago' : 'Scores saved before Patrick finishes are cleared with the rest.');
      hide('hub-door-btn', true);
      hide('hub-door-pair', !owner); hide('hub-door-takeover', false);
      text('hub-door-owner-text', '');
      hide('hub-door-owner', true);
    }
    return;
  }

  if (sp.build === 'backups') {
    $('setup').setAttribute('data-screen', 'backups');
    window.renderSetupUi = () => {};
    text('backups-title', 'Restore points · ' + campName);
    text('backups-headline', 'Last saved 10 min ago');
    text('backups-lede', 'One is saved for you before every big change.');
    const row = (y, md, title, sub) => `<button type="button" class="cb-row"><span class="cb-time">${esc(y)}<small>${esc(md)}</small></span><span class="cb-main"><span class="cb-title">${esc(title)}</span><span class="cb-sub">${esc(sub)}</span></span><span class="cb-end"><svg class="ico" aria-hidden="true"><use href="#i-pin"/></svg><svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>`;
    html('rp-years', row('2026', 'Jul 26', '2026 week (' + (senior ? 'senior' : 'junior') + ')', 'Past year · ' + name(champ) + ' won with 211 points'));
    hide('rp-sec-years', false);
    html('rp-list', `<button type="button" class="cb-row"><span class="cb-time">9:12<small>PM</small></span><span class="cb-main"><span class="cb-title">Before the new-year setup</span><span class="cb-sub">Before the new-year setup</span></span><span class="cb-end"><svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></span></button>`);
    hide('rp-empty', true);
    hide('setup-advanced', false);
    return;
  }

  if (sp.build === 'stranded') {
    state.ui.view = 'home'; renderAll();
    const bar = $('sync-alert');
    bar.innerHTML = '<span class="sync-alert-ico" aria-hidden="true"><svg class="ico"><use href="#i-download"/></svg></span>' +
      '<span class="sync-alert-text">3 changes from 2026 weren’t added</span><span class="sync-quarantine-actions">' +
      '<button type="button" class="link-btn sync-quarantine-btn" data-stranded="download">Download</button> ' +
      '<button type="button" class="link-btn danger-link sync-quarantine-btn" data-stranded="dismiss">Dismiss</button></span>';
    bar.classList.add('sync-alert-tab');
    bar.hidden = false;
    window.updateSyncAlert = () => {};
    return;
  }

  // sheets
  $('setup').setAttribute('data-screen', 'hub');
  window.renderSetupUi = () => {};
  const ov = $('sheet-' + sp.sheet);
  if (sp.sheet === 'setup-menu') {
    const sec = document.querySelector('.setup-owner-sec'); sec.hidden = false;
    document.querySelectorAll('.setup-owner-sec [data-setup-act]').forEach((r) => { r.hidden = false; });
    const orig = document.querySelector('[data-setup-act="original"]');
    orig.setAttribute('aria-disabled', 'true');
    orig.querySelector('[data-setup-why]').textContent = 'Already using the original week.';
    document.querySelector('[data-setup-act="undo-new-year"] [data-setup-why]').textContent = 'Puts 2026’s scores and dates back · until Jul 25';
  }
  if (sp.sheet === 'nyw-staff') {
    const r = (t, emo, label, sub) => `<div class="cb-row"><span class="cb-time">${esc(t)}</span><span class="cb-main"><span class="cb-title"><span class="sched-emo" aria-hidden="true">${emo}</span><span>${esc(label)}</span></span><span class="cb-sub">${esc(sub)}</span></span></div>`;
    html('nyw-staff-list', r('8:30 PM', '🔥', 'Snack and campfire — TJ', 'Every day · names TJ') + r('9:15 PM', '🏠', 'Laura’s cottage devotions', 'Tue and Thu · names Laura') +
      r('2:00 PM', '🎨', 'Crafts with Ms. Bethany', 'Wednesday · names Bethany') + r('7:00 PM', '🎤', 'Worship led by the Hendersons', 'Every day · names the Hendersons'));
  }
  if (sp.sheet === 'nyw-undo') {
    text('sheet-nyw-undo-title', 'Undo the new-year setup');
    text('nyu-sub', 'Saved Jul 11, 9:12 PM, just before the setup');
    text('nyu-lede', campName + ' goes back to the 2026 week, exactly as it was saved.');
    html('nyu-back', T(22, 'game results') + T(61, 'bonus points', 'Counted double again inside 2026’s window') + T('', 'Camp week', 'Jul 19–25, 2026', 'item') +
      T('', 'The schedule, games, menus and verses', 'As they were in 2026', 'item') + T('', 'History', 'Shows 2026 again', 'item'));
    html('nyu-stay', T('', 'Counselors’ teams', 'As they are now: Undo doesn’t move anyone', 'item') + T('', 'Campers', 'They’re never in a saved copy', 'item') + T('', 'Changes made for 2027', 'Kept in a restore point first', 'item'));
    text('nyu-hold-label', 'Hold to undo ' + campName + '’s new-year setup');
    hide('nyu-hold-btn', !!sp.confirm); hide('nyu-hold-confirm', !sp.confirm); hide('nyu-hold-cancel', !sp.confirm);
  }
  if (sp.sheet === 'setup-advanced') {
    const st = { schedule: 'Edited here · 3 changed items, 2 one-offs', meals: 'Edited here · 14 dishes', verses: 'Showing the original · your edits are kept', cleanup: 'Edited here · every meal has a team', electives: 'Edited here · 10 stations' };
    document.querySelectorAll('.adv-row').forEach((r) => {
      const s = r.dataset.advSection;
      if (s === 'electives') r.hidden = !(CAMP.features && CAMP.features.electives);
      r.querySelector('[data-adv-state]').textContent = st[s];
    });
  }
  if (sp.sheet === 'restore') {
    ov.setAttribute('data-kind', 'archive');
    text('sheet-restore-title', '2026 week (' + (senior ? 'senior' : 'junior') + ')');
    text('rp-meta', 'Saved Jul 26, 2026 · ' + name(champ) + ' won with 211 points');
    hide('rp-epoch-note', false); text('rp-epoch-text', 'This is from the 2026 week.');
    hide('rp-year', false);
    text('rp-year-download-title', 'Download 2026');
    text('rp-year-undo-sub', 'Puts 2026 back: its scores, dates and history');
    hide('rp-year-undo', !owner);
    hide('rp-year-owner', owner);
    text('rp-year-owner-text', 'Only Patrick can undo the new-year setup.');
  }
  ov.hidden = false;
}

const MEASURE = () => {
  const issues = [];
  const sel = 'button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), textarea, select, summary, jelly-switch, jelly-checkbox';
  const roots = [document.getElementById('setup'), document.getElementById('sync-alert'), ...document.querySelectorAll('.sheet-overlay:not([hidden]) .sheet')].filter(Boolean);
  const seen = new Set();
  const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (!shown(el)) return;
    if (el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
    if (el.closest('#tabbar')) return;
    if (el.classList.contains('visually-hidden')) return; // the file input: its label row is the target
    if (!document.body.classList.contains('builder-open') && el.closest('#setup')) return;
    const r = el.getBoundingClientRect();
    if (el.tagName === 'INPUT' && el.closest('label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5 && r.height >= 40) return; }
    if (r.width < 43.5 || r.height < 43.5) issues.push({ el: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) });
  }));
  const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  // (a screen's .setup-dock bleeds 1rem past each side on purpose, as Restore points' always has)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const clip = [...document.querySelectorAll('#setup-wizard, #setup-hub, #setup-backups, .sheet-overlay:not([hidden]) .sheet-body, .nyw-dock .btn')].filter((e) => shown(e) && e.scrollWidth > e.clientWidth + (e.classList.contains('setup-screen') ? 2 * rem + 1 : 1)).map((e) => (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  const narrow = [...document.querySelectorAll('#setup-wizard .gl-title, #setup-wizard .gl-sub, #setup-wizard .wk-day-name, #setup-wizard .nyw-t-what, #setup-wizard .nyw-opt-t, #setup-wizard .nyw-day-tag, .sheet-overlay:not([hidden]) .gl-title, .sheet-overlay:not([hidden]) .gl-sub, .sheet-overlay:not([hidden]) .cb-title, .sheet-overlay:not([hidden]) .nyw-t-what')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < 80).map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  return { issues, sideways, clip, narrow };
};

async function openPage(browser, { camp, w, scheme, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2027-05-12T19:15:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(() => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    setMemberRole('editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupReady = true; configReady = true;
    openBuilder();
    renderAll();
    // Nothing is wired: keep the renderer from putting the hub back while the specimen is up.
    window.renderSetupUi = () => {};
  });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(SPECIMENS);
  const camps = process.env.CAMPS ? process.env.CAMPS.split(',') : ['junior', 'senior'];
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : process.env.SIZE ? [process.env.SIZE.split(',').map((x, i) => (i === 1 ? x : +x))]
    : [[360, 'light', 100], [390, 'dark', 100], [360, 'light', 130], [390, 'light', 130], [360, 'dark', 200], [390, 'light', 200]];
  for (const name of only) {
    for (const camp of camps) {
      const sp = Object.assign({ name }, SPECIMENS[name]);
      for (const [w, scheme, txt] of sizes) {
        const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt });
        try {
          await page.evaluate(`(${fill.toString()})(${JSON.stringify(sp)})`);
          await page.waitForTimeout(350);
          const m = await page.evaluate(MEASURE);
          const tag = [name, camp, w, scheme, txt + '%'].join(' ');
          report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip, narrow: m.narrow });
          if (process.env.SHOTS) {
            const full = sp.build !== 'sheet';
            // The first screen as the phone shows it (the dock pinned), then the whole page with the dock in flow.
            if (full) await page.screenshot({ path: OUT + ['s28', name, camp, w, scheme, txt, 'v'].join('-') + '.png' });
            if (full) await page.addStyleTag({ content: '.setup-dock{position:static!important}' });
            await page.screenshot({ path: OUT + ['s28', name, camp, w, scheme, txt].join('-') + '.png', fullPage: full });
            for (const k of sp.build === 'sheet' ? [1, 2] : []) {
              const moved = await page.evaluate((k) => { const b = document.querySelector('.sheet-overlay:not([hidden]) .sheet-body'); if (!b || b.scrollHeight <= b.clientHeight + 4) return false; const top = Math.min(b.scrollHeight - b.clientHeight, k * (b.clientHeight - 60)); if (top <= b.scrollTop) return false; b.scrollTop = top; return true; }, k);
              if (!moved) break;
              await page.waitForTimeout(120);
              await page.screenshot({ path: OUT + ['s28', name, camp, w, scheme, txt, 'p' + (k + 1)].join('-') + '.png' });
            }
          }
        } catch (e) { report.push({ tag: name + ' ' + camp + ' ' + w, error: String(e).slice(0, 300) }); }
        if (errs.length) report.push({ tag: name + ' ' + camp + ' ' + w + ' page errors', pageErrors: errs });
        await ctx.close();
      }
    }
  }
  await browser.close();
  const bad = report.filter((r) => (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length) || (r.narrow && r.narrow.length) || r.error || r.pageErrors);
  console.log(JSON.stringify(bad, null, 1));
  console.log(report.length + ' checks, ' + bad.length + ' with findings');
})();
