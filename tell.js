// ── tell.js — TELL EVERYONE (redesign §7.2, mockup 10; build plan Step 24) ─────────────────────────────
// The one composer a director uses to reach every phone: a banner at the top of Now, a buzz on phones (push.js's
// director alert), and/or the big pinned notice, with "Showing now" and Take down above it, three quick alerts for
// the moment that matters and ONE gold Send whose words say what will happen. Same contract as chat.js / push.js /
// reveal-ui.js: a classic script loaded after app.js, every hook into it from app.js is typeof-guarded (delete its
// <script> and More shows no Tell everyone row), and it paints static markup the design pass put in index.html (the
// comments there name every hook) through only-if-changed writes, so an idle renderAll writes nothing here.
//
// THE RULES THIS FILE LIVES BY
//  - ONE WRITE PATH per channel. A banner is app.js's postBanner / takeDownBanner, the notice is state.notice written
//    whole (and put back to draft by setNoticeStatus), a buzz is push.js's pushSendAlert in its DIRECT mode. Nothing
//    here talks to the database itself, so every guard those carry (director only, the first-pull gate, the sender's
//    own checks) holds. The tool opens only for a director (toolMayOpen) and the pin / take down paths re-check.
//  - A SEND NEVER LIES. Each channel reports on its own ("Banner posted · Buzz didn't go: …"). A send that fully worked
//    closes the composer and leaves a 10-second Undo toast; one that did not leaves "Last send" with Try again on the
//    channel that failed, and un-ticks the channels that already went so a second Send cannot post the banner twice.
//  - A BUZZ CAN'T BE TAKEN BACK and is never armed by accident: off by default, disarmed whenever it becomes
//    unavailable (phone alerts not live, offline), never restored from a saved draft, and the Send label names it.
//  - THE NOTICE IS ONE CARD WRITTEN WHOLE, so pinning asks first when the current notice has any content, and the Undo
//    puts the previous one back ONLY if the notice still equals what this send wrote (a colleague's later edit is
//    never overwritten).
//  - A DRAFT SURVIVES: a re-render, a tab trip, a closed and reopened composer (in memory) and a reload (the text and the
//    two safe ticks, in localStorage, wiped at sign-out). tellComposerBusy() — a send still going out, or the composer
//    open with words in it — joins reloadBlocked() and editorMidEntry(), so the auto-update cannot eat a half-typed alert.
//  - Every database string is escaped (esc) before markup; the preview is written by the SAME functions the real strip
//    uses (messageHtml, noticeCardHtml), so it cannot drift from what counselors get.
//  - Everything that moves is a JellyMotion preset and honours calm motion (opacity only, no transform).
//  - Names are all `tell…` / `renderTell…` so they cannot collide with the other scripts (one global scope).

const TELL_MAX = BANNER_MAX;            // characters in the message (app.js: the banner limit; the sender clips at 300)
const TELL_UNDO_MS = 10000;             // how long the Undo toast stays
const TELL_DRAFT_KEY = lsKey('campScoreboardTellDraft');
// The three quick alerts (§7.2: "the wording is a constant the owner can change"). The buttons in index.html carry the
// same words; the one whose words are still in the message wears aria-pressed.
const TELL_QUICK = {
  inside: { text: 'Come inside now' },
  dining: { text: 'All to the Dining Hall' },
  stay: { text: 'Stay where you are' },
};
const TELL_BUZZ_SUB = "Off unless you tick it · can't be taken back";
const TELL_TEAM_RE = /^t[0-9]$/;

function tellFreshDraft() {
  return { text: '', banner: true, ttl: '1h', pin: false, buzz: false, aud: 'everyone', team: '', urgent: false };
}

const tell = {
  d: tellFreshDraft(),
  loaded: false,        // the saved draft has been read (once per page: never at load, a TDZ rule)
  wired: false,
  sending: 0,           // channels still going out (a buzz is the slow one)
  result: null,         // the last send that did not fully work: { items: [{way, ok, text}], text, plan }
  returnToDraft: false, // "Write a full notice" sent the director to the builder: Back comes home to the composer
  wasBuilder: false,
  wasOpen: false,
};

function tellEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }

// ════════════════════════════════════════════════════════════════════
// THE DRAFT (kept on this device until sent)
// ════════════════════════════════════════════════════════════════════
function tellLoadDraft() {
  if (tell.loaded) return;
  tell.loaded = true;
  try {
    const o = JSON.parse(localStorage.getItem(TELL_DRAFT_KEY) || 'null');
    if (!o || typeof o !== 'object') return;
    const d = tell.d;
    if (typeof o.text === 'string' && !d.text) d.text = o.text.slice(0, TELL_MAX);
    if (typeof o.banner === 'boolean') d.banner = o.banner;
    if (ANNOUNCE_TTL_CHOICES.some((c) => c.key === o.ttl)) d.ttl = o.ttl;
    if (typeof o.pin === 'boolean') d.pin = o.pin;
    // Buzz, its audience and Urgent are never restored: a half-forgotten draft must not be one tap from ringing every phone.
  } catch (e) { /* storage blocked or junk: start fresh */ }
}

function tellSaveDraft() {
  const d = tell.d;
  try {
    if (!d.text.trim()) localStorage.removeItem(TELL_DRAFT_KEY);
    else localStorage.setItem(TELL_DRAFT_KEY, JSON.stringify({ v: 1, text: d.text, banner: d.banner, ttl: d.ttl, pin: d.pin }));
  } catch (e) { /* the draft just lives in memory */ }
}

function tellResetDraft() {
  tell.d = tellFreshDraft();
  tellSaveDraft();
}

// Is a message being typed (the composer open with words in it, or the box focused), or is a send still going out?
// reloadBlocked() / editorMidEntry() / shellHasUnsentWork() ask. A closed composer's leftover draft does not block a
// reload: it is kept on the device and comes back.
function tellComposerBusy() {
  if (tell.sending > 0) return true;
  if (typeof toolIsOpen !== 'function' || !toolIsOpen('tell')) return false;
  if (tell.d.text.trim()) return true;
  const ae = typeof document !== 'undefined' ? document.activeElement : null;
  return !!(ae && ae.id === 'tell-text');
}

// ════════════════════════════════════════════════════════════════════
// PURE PIECES (what the model, the labels and the notice are made of)
// ════════════════════════════════════════════════════════════════════
// The first sentence is the notice's title and the rest the line under it (§7.2). A line break ends the title too. A
// trailing full stop is dropped from the title (a headline), "!" and "?" stay.
function tellSplit(text) {
  const t = String(text || '').trim();
  if (!t) return { title: '', rest: '' };
  const nl = t.indexOf('\n');
  const m = /[.!?]+(?=\s|$)/.exec(t);
  let cut = m ? m.index + m[0].length : -1;
  if (nl >= 0 && (cut < 0 || nl < cut)) cut = nl;
  const title = (cut < 0 ? t : t.slice(0, cut)).trim().replace(/\.$/, '');
  const rest = cut < 0 ? '' : t.slice(cut).trim();
  return { title, rest };
}

// The notice a pin would post: a whole card (the notice is always written whole).
function tellPinnedNotice(text) {
  const s = tellSplit(text);
  return { status: 'posted', eyebrow: '', title: s.title, sub: s.rest, signoff: '', zones: [], steps: [] };
}

function tellNoticeHasContent(n) {
  return !!(n && (n.title || n.sub || n.eyebrow || n.signoff || (n.zones && n.zones.length) || (n.steps && n.steps.length)));
}

// What to call the notice in a sentence: its title, else its line, else the plain words.
function tellNoticeName(n) {
  return String((n && (n.title || n.sub || n.eyebrow || n.signoff)) || 'the notice').trim().slice(0, 60);
}

// A stable string of a value in RTDB-canonical form (empties pruned, keys sorted): what "the notice still equals what
// this send wrote" is measured on, so a snapshot's pruning is no difference.
function tellCanon(v) {
  return JSON.stringify(syncCanon(v) === undefined ? null : syncCanon(v));
}
function tellClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// Can this phone buzz right now? Dark until PUSH_SERVICE_URL is set (Step 27), and a buzz needs a connection.
function tellBuzzState() {
  const live = typeof pushConfigured === 'function' && pushConfigured() && typeof pushSendAlert === 'function';
  if (!live) return { available: false, reason: "Phone alerts aren't switched on yet" };
  if (!fbConnected) return { available: false, reason: 'No signal: buzzing needs a connection' };
  return { available: true, reason: '' };
}

// True while sync is set up and this phone is not connected: what a banner or a pin writes then waits in this phone's
// queue, and nobody else has it yet. A send must say so (the takeover covers the header's status pill), never "posted".
function tellOffline() {
  return typeof syncEnabled === 'function' && syncEnabled() && !fbConnected;
}

function tellTeamWord(id) {
  const t = (state.teams || []).find((x) => x.id === id);
  return t ? (teamShort(id) || t.name) : '';
}

// Who a buzz goes to, in words ("everyone", "Foxes", "directors"), and the sender's audience for it. A team is its
// short name with NO article, the word on the chip just tapped: "the" in front made "Send + buzz the Turkey" and, in
// senior, "the Red" (a short name is often an adjective or a singular, never safe to put "the" before).
function tellWho(d) {
  if (d.aud === 'directors') return 'directors';
  if (d.aud === 'team') return tellTeamWord(d.team) || 'a team';
  return 'everyone';
}
// The no-phones report, one sentence per audience (a team by its whole name: this is a sentence, not a label).
function tellNobody(d) {
  if (d.aud === 'directors') return 'no director has phone alerts on yet';
  if (d.aud === 'team') {
    const t = (state.teams || []).find((x) => x.id === d.team);
    return t ? 'nobody on ' + (t.name || tellTeamWord(t.id)) + ' has phone alerts on yet' : 'nobody on that team has phone alerts on yet';
  }
  return 'nobody has phone alerts on yet';
}
function tellAudience(d) {
  if (d.aud === 'directors') return 'editors';
  if (d.aud === 'team') return TELL_TEAM_RE.test(d.team) ? d.team : '';
  return 'all';
}

// The one model the screen is painted from: what is ticked FOR REAL (a buzz that cannot go is not ticked), why Send
// cannot be pressed yet, and the words on it.
function tellModel() {
  const d = tell.d;
  const bz = tellBuzzState();
  const text = d.text.trim();
  const buzz = d.buzz && bz.available;
  let missing = '';
  if (!text) missing = 'Type a message first';
  else if (!d.banner && !d.pin && !buzz) missing = 'Tick a way to reach people';
  else if (buzz && d.aud === 'team' && !tellTeamWord(d.team)) missing = 'Pick a team to buzz';
  const ways = [];
  if (d.banner) ways.push('banner');
  if (d.pin) ways.push('pin');
  if (buzz) ways.push('buzz');
  return {
    text, count: d.text.length, bz, buzz, ways, missing,
    ready: !missing && !tell.sending,
    label: tell.sending ? 'Sending…' : missing || tellSendLabel(d, buzz),
  };
}

// "Send to everyone" (banner only) · "Pin the notice" · "Send + pin the notice" · "Send + buzz everyone" · "Send + buzz
// Foxes" · "Send + buzz directors" · "Buzz everyone" · "Pin + buzz everyone" · "Send + pin + buzz everyone".
function tellSendLabel(d, buzz) {
  const parts = [];
  if (d.banner) parts.push('send');
  if (d.pin) parts.push(buzz ? 'pin' : 'pin the notice');
  if (buzz) parts.push('buzz ' + tellWho(d));
  if (parts.length === 1 && d.banner) return 'Send to everyone';
  const s = parts.join(' + ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "ends in 38 min" · "ends in 2 h 10 min" · "ends in 1 day".
function tellLeft(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  if (m < 1) return 'ending now';
  if (m < 60) return 'ends in ' + m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return 'ends in ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  return 'ends in ' + Math.round(h / 24) + (Math.round(h / 24) === 1 ? ' day' : ' days');
}

// What everyone sees right now, newest banner first and the notice (when it is posted) after: [{key, kind, id, title, sub}].
function tellShowingNow(now) {
  const t = typeof now === 'number' ? now : Date.now();
  const rows = liveAnnouncements().map((a) => ({
    key: 'ann-' + a.id, kind: 'banner', id: a.id, title: a.text,
    sub: 'Banner · ' + tellLeft(announcementExpiresAt(a) - t),
  }));
  if (noticePosted()) rows.push({ key: 'notice', kind: 'notice', id: '', title: tellNoticeName(noticeBoard()), sub: 'Big notice · on every phone' });
  return rows;
}

// The words under More's row: "Up now: a banner and the notice" · "Up now: 2 banners" · the plain line.
function tellRowSub(rows) {
  const banners = rows.filter((r) => r.kind === 'banner').length;
  const notice = rows.some((r) => r.kind === 'notice');
  if (!banners && !notice) return '';
  const b = banners === 1 ? 'a banner' : banners + ' banners';
  return 'Up now: ' + (banners && notice ? b + ' and the notice' : banners ? b : 'the notice');
}

function tellShowingHtml(rows) {
  return rows.map((r) => `<div class="tell-live" data-key="${esc(r.key)}" data-kind="${r.kind}">` +
    `<span class="tell-live-ico" aria-hidden="true"><svg class="ico"><use href="#${r.kind === 'notice' ? 'i-pin' : 'i-megaphone'}"/></svg></span>` +
    `<span class="tell-live-text"><span class="tell-live-title">${esc(r.title)}</span><span class="tell-live-sub">${esc(r.sub)}</span></span>` +
    `<button type="button" class="btn btn-sm tell-down" data-tell-down="${r.kind}" data-id="${esc(r.id)}">Take down</button></div>`).join('');
}

function tellTeamsHtml(d) {
  return (state.teams || []).map((t) => `<button type="button" class="tell-team" role="radio" aria-checked="${d.team === t.id}" data-team="${esc(t.id)}">` +
    `<span class="tell-team-mark">${teamMarkHtml(t.id, { size: 24 })}</span><span class="tell-team-name">${esc(tellTeamWord(t.id) || t.name)}</span></button>`).join('');
}

function tellResultHtml(items) {
  return items.map((it) => `<li class="tell-res" data-tone="${it.ok ? 'ok' : 'warn'}"><i class="tell-res-mark" aria-hidden="true"></i>` +
    `<span class="tell-res-text">${esc(it.text)}</span>` +
    (it.ok ? '' : `<button type="button" class="btn btn-sm" data-tell-retry="${it.way}">Try again</button>`) + '</li>').join('');
}

// "On a counselor's phone": the notice strip this would post, then the banner, in Now's order — written by the same
// functions the real strip uses. '' while there is nothing to show.
function tellPreviewHtml() {
  const d = tell.d;
  const text = d.text.trim();
  if (!text || (!d.banner && !d.pin)) return '';
  const notice = d.pin ? noticeCardHtml(true, tellPinnedNotice(text), { strip: true }) : ''; // Now shows the strip; See all is the builder's preview
  const banner = d.banner ? messageHtml({ id: 'preview', text, at: new Date().toISOString(), by: frameMyName() }, { preview: true }) : '';
  return (notice || '') + banner;
}

// ════════════════════════════════════════════════════════════════════
// PAINTING
// ════════════════════════════════════════════════════════════════════
function tellRoofSync() {
  if (typeof shell === 'undefined' || typeof roofUp !== 'function') return;
  if (shell.roof !== roofUp()) { shell.roof = roofUp(); applyChromeColor(); }
}

// Fits the box to its words where the browser has no field-sizing (iOS Safari before 26): measured, never stored.
function tellFitText(ta) {
  if (!ta || !ta.style || typeof CSS === 'undefined' || (CSS.supports && CSS.supports('field-sizing', 'content'))) return;
  ta.style.height = 'auto';
  if (ta.scrollHeight) ta.style.height = ta.scrollHeight + 'px';
}

function tellPaintWay(id, on) {
  const box = tellEl(id);
  if (box) setAttrIfChanged(box, 'aria-checked', on ? 'true' : 'false');
}

function tellPaintSeg(segId, attr, value) {
  const seg = tellEl(segId);
  if (!seg || !seg.querySelectorAll) return;
  seg.querySelectorAll('.seg-btn').forEach((b) => setAttrIfChanged(b, 'aria-checked', b.dataset[attr] === value ? 'true' : 'false'));
}

// Every part of the open composer, each writing only what differs. Runs on every renderAll while it is open.
function tellPaint() {
  const d = tell.d;
  const m = tellModel();
  // Buzz that cannot go is disarmed, not just greyed: when it comes back it is still off (nothing arms by accident).
  if (d.buzz && !m.bz.available) d.buzz = false;
  setTextIfChanged(tellEl('takeover-tell-back-label'), shellToolBackLabel());

  // The last send's report.
  const res = tellEl('tell-result');
  const items = tell.result ? tell.result.items : [];
  setHiddenIfChanged(res, !items.length);
  setHtmlIfChanged(tellEl('tell-result-list'), items.length ? tellResultHtml(items) : '');

  // Showing now.
  const rows = tellShowingNow();
  setHiddenIfChanged(tellEl('tell-showing'), !rows.length);
  // Keyed: after a Take down (or a banner that expired, or another director's) the rows left glide up, never jump.
  paintKeyedList(tellEl('tell-showing-list'), tellShowingHtml(rows), { arrive: tellArrive });

  // Quick alerts.
  const q = tellEl('tell-quick-what');
  setTextIfChanged(q, m.bz.available ? 'Banner all day · buzz everyone · urgent' : 'Banner all day');
  document.querySelectorAll('#takeover-tell .tell-q').forEach((b) => {
    const k = b.dataset.quick;
    setAttrIfChanged(b, 'aria-pressed', TELL_QUICK[k] && d.text.trim() === TELL_QUICK[k].text ? 'true' : 'false');
  });

  // The message.
  const ta = tellEl('tell-text');
  if (ta && document.activeElement !== ta && ta.value !== d.text) { ta.value = d.text; tellFitText(ta); }
  const count = tellEl('tell-count');
  setTextIfChanged(count, d.text.length + ' / ' + TELL_MAX);
  setDataIfChanged(count, 'near', d.text.length >= 250 ? 'true' : null);

  // How it reaches people.
  tellPaintWay('tell-banner', d.banner);
  setHiddenIfChanged(tellEl('tell-banner-more'), !d.banner);
  tellPaintSeg('tell-ttl', 'ttl', d.ttl);
  const way = tellEl('tell-way-buzz');
  setDataIfChanged(way, 'off', m.bz.available ? null : 'true');
  const buzzTick = tellEl('tell-buzz');
  setAttrIfChanged(buzzTick, 'aria-disabled', m.bz.available ? null : 'true');
  tellPaintWay('tell-buzz', m.buzz);
  setTextIfChanged(tellEl('tell-buzz-sub'), m.bz.available ? TELL_BUZZ_SUB : m.bz.reason);
  setHiddenIfChanged(tellEl('tell-buzz-more'), !m.buzz);
  tellPaintSeg('tell-aud', 'aud', d.aud);
  const teams = tellEl('tell-teams');
  setHiddenIfChanged(teams, !(m.buzz && d.aud === 'team'));
  if (m.buzz && d.aud === 'team') setHtmlIfChanged(teams, tellTeamsHtml(d));
  const sw = tellEl('tell-urgent');
  if (sw && sw.hasAttribute('checked') !== d.urgent) sw.toggleAttribute('checked', d.urgent);
  setTextIfChanged(tellEl('tell-urgent-state'), d.urgent ? 'On' : 'Off');

  // Pin: which notice it would replace, and how the message is cut.
  tellPaintWay('tell-pin', d.pin);
  setHiddenIfChanged(tellEl('tell-pin-more'), !d.pin);
  const cur = noticeBoard();
  const replaces = d.pin && tellNoticeHasContent(cur);
  setHiddenIfChanged(tellEl('tell-pin-replace'), !replaces);
  if (replaces) setTextIfChanged(tellEl('tell-pin-replace-text'), (cur.status === 'posted' ? 'Replaces the notice everyone sees now: “' : 'Replaces the draft notice: “') + tellNoticeName(cur) + '”');
  const split = tellSplit(d.text);
  setHiddenIfChanged(tellEl('tell-pin-split'), !(d.pin && split.title));
  setTextIfChanged(tellEl('tell-pin-title'), split.title);
  setTextIfChanged(tellEl('tell-pin-rest'), split.rest || '—');

  // The preview and the dock.
  const prev = tellPreviewHtml();
  setHiddenIfChanged(tellEl('tell-preview'), !prev);
  setHtmlIfChanged(tellEl('tell-preview-body'), prev);
  const send = tellEl('tell-send');
  setAttrIfChanged(send, 'aria-disabled', m.ready ? null : 'true');
  setTextIfChanged(tellEl('tell-send-label'), m.label);
}

// More's row: hidden for anyone who may not open it (and without this file there is no row at all), and "Up now: …" while
// something is showing.
function tellPaintMoreRow() {
  const row = tellEl('tell-row');
  if (!row) return;
  const may = toolMayOpen('tell');
  setHiddenIfChanged(row, !may);
  if (!may) return;
  const sub = tellRowSub(tellShowingNow());
  setDataIfChanged(row, 'live', sub ? 'true' : null);
  setTextIfChanged(tellEl('tell-row-sub'), sub || 'Banner, buzz phones or the big notice');
}

function tellCloseScreen(tk) {
  if (tk.__open) {
    tk.__open = false;
    tell.result = null;
    const o = shell.opener;
    shell.opener = null;
    if (o && o.isConnected !== false && typeof o.focus === 'function') { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    // Slides back out to the right (220 ms; calm: a 140 ms fade), taking no taps on the way, hidden at the end unless it
    // was reopened meanwhile.
    if (!tk.hidden && typeof JellyMotion !== 'undefined') {
      if (tk.style) tk.style.pointerEvents = 'none';
      JellyMotion.playOut(tk, (x) => ({ transform: 'translateX(' + x * 100 + '%)' }), 220, () => {
        if (tk.__open) return;
        tk.hidden = true;
        if (tk.style) tk.style.pointerEvents = '';
        tellRoofSync();
      });
    } else tk.hidden = true;
    tellRoofSync();
  } else if (!tk.hidden && !(tk.style && tk.style.pointerEvents)) { tk.hidden = true; tellRoofSync(); }
}

// Called from renderAll: More's row always, the composer only while it is open.
function renderTellEveryone() {
  tellPaintMoreRow();
  const tk = tellEl('takeover-tell');
  if (!tk) return;
  const open = typeof toolIsOpen === 'function' && toolIsOpen('tell');
  // Back from "Write a full notice" lands here: the builder closed, so come home to the draft.
  const builder = builderOpen();
  if (tell.wasBuilder && !builder && tell.returnToDraft) {
    tell.returnToDraft = false;
    // Next turn, not inside this render: openTool renders again.
    setTimeout(() => { if (toolMayOpen('tell') && !toolIsOpen('tell') && !builderOpen()) openTool('tell', { from: 'more' }); }, 0);
  }
  tell.wasBuilder = builder;
  if (!open) { tell.wasOpen = false; tellCloseScreen(tk); return; }
  const opening = tk.hidden || !tk.__open;
  if (tk.hidden) tk.hidden = false;
  if (tk.style && tk.style.pointerEvents) tk.style.pointerEvents = '';
  tk.__open = true;
  if (opening) tellLoadDraft();
  tellWire(tk);
  tellPaint();
  if (opening) {
    tellRoofSync();
    // A whole screen arrives with the full-screen spring; the page behind it is inert, so focus moves in with it.
    if (typeof JellyMotion !== 'undefined') JellyMotion.play(tk, 'settle', (x) => ({ transform: 'translateX(' + (1 - x) * 100 + '%)' }));
    const back = tk.querySelector('[data-takeover-back]');
    if (back && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
    tellFitText(tellEl('tell-text'));
  }
  tell.wasOpen = true;
}

// The minute-by-minute words ("ends in 38 min") and an expired banner leaving: only while the composer is open.
function tellTick() {
  if (typeof toolIsOpen === 'function' && toolIsOpen('tell')) tellPaint();
}

// ════════════════════════════════════════════════════════════════════
// MOTION (calm-aware: JellyMotion strips every transform keyframe while calm)
// ════════════════════════════════════════════════════════════════════
function tellPop(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'press', (x) => ({ transform: 'scale(' + (0.86 + 0.14 * x) + ')' }), { calm: false });
}
function tellArrive(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateY(' + 8 * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.6) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 });
}
function tellSnapField(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'snap', (x) => ({ transform: 'scale(' + (1 + 0.025 * (1 - x)) + ')', transformOrigin: '50% 50%' }), { calm: false });
}
// A refused tap: one short sideways wobble (calm: nothing; the toast says why).
function tellWobble(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'wobble', (x) => ({ transform: 'translateX(' + 9 * (1 - Math.min(1, x)) * Math.cos(9 * x) + 'px)' }), { calm: false });
}

// ════════════════════════════════════════════════════════════════════
// TAPS
// ════════════════════════════════════════════════════════════════════
function tellMayUse() {
  return typeof toolMayOpen === 'function' && toolMayOpen('tell');
}

// A tap that changes the draft: save it and repaint the composer (no renderAll: nothing else changed).
function tellChanged() {
  tellSaveDraft();
  tellPaint();
}

function tellToggle(way) {
  const d = tell.d;
  const m = tellModel();
  if (way === 'buzz') {
    if (!m.bz.available) { showToast(m.bz.reason); tellWobble(tellEl('tell-buzz')); return; }
    d.buzz = !d.buzz;
    tellChanged();
    tellPop(tellEl('tell-buzz'));
    if (d.buzz) tellArrive(tellEl('tell-buzz-more'));
    return;
  }
  if (way !== 'banner' && way !== 'pin') return;
  d[way] = !d[way];
  tellChanged();
  tellPop(tellEl('tell-' + way));
  if (d[way]) tellArrive(tellEl('tell-' + way + '-more'));
}

function tellSetTtl(key) {
  if (!ANNOUNCE_TTL_CHOICES.some((c) => c.key === key)) return;
  tell.d.ttl = key;
  tellChanged();
}

function tellSetAudience(aud) {
  if (aud !== 'everyone' && aud !== 'team' && aud !== 'directors') return;
  tell.d.aud = aud;
  tellChanged();
  if (aud === 'team') tellArrive(tellEl('tell-teams'));
}

function tellSetTeam(id, btn) {
  if (!tellTeamWord(id)) return;
  const had = focusWas(btn); // tellChanged repaints the chips: a keyboard user keeps their place (focusBack)
  tell.d.team = id;
  tellChanged();
  if (had) focusBack(had, document.querySelector('#tell-teams .tell-team[data-team="' + id + '"]'));
}

// The fast path (§7.2): the words go in the message and the ways are ticked — Banner all day, and when phone alerts are
// live Buzz everyone + Urgent — one after another; Send is the next tap. Replaces what was typed (the director chose a
// canned alert over their own words); a quick alert is never a pin.
function tellQuick(key) {
  const q = TELL_QUICK[key];
  if (!q) return;
  const d = tell.d;
  const bz = tellBuzzState();
  d.text = q.text;
  d.banner = true;
  d.ttl = 'day';
  d.pin = false;
  d.buzz = bz.available;
  d.aud = 'everyone';
  d.team = '';
  d.urgent = bz.available;
  tellChanged();
  const ta = tellEl('tell-text');
  tellSnapField(ta);
  tellFitText(ta);
  ['tell-banner', 'tell-buzz'].forEach((id, i) => {
    const box = tellEl(id);
    if (!box || (id === 'tell-buzz' && !bz.available)) return;
    if (typeof setTimeout === 'function') setTimeout(() => tellPop(box), 40 * (i + 1));
  });
}

function tellOnInput(ta) {
  tell.d.text = String(ta.value || '').slice(0, TELL_MAX);
  tellSaveDraft();
  tellFitText(ta);
  tellPaint();
}

// "Write a full notice with team areas and steps": the notice builder, and Back comes home to this draft.
function tellOpenFullNotice() {
  if (!tellMayUse()) return;
  tell.returnToDraft = true;
  tellSaveDraft();
  openBuilder('notice');
}

// ════════════════════════════════════════════════════════════════════
// SENDING
// ════════════════════════════════════════════════════════════════════
// What a Send will do, from the draft as it stands: the words and one entry per way that is ticked FOR REAL.
function tellPlan(m) {
  const d = tell.d;
  const ttl = ANNOUNCE_TTL_CHOICES.find((c) => c.key === d.ttl) || ANNOUNCE_TTL_CHOICES[0];
  return {
    text: m.text.slice(0, TELL_MAX),
    banner: d.banner ? { ttlMs: ttl.ms } : null,
    pin: d.pin ? { notice: tellPinnedNotice(m.text) } : null,
    buzz: m.buzz ? { audience: tellAudience(d), urgent: !!d.urgent, who: tellWho(d), nobody: tellNobody(d) } : null,
  };
}

// The question before a pin replaces a notice that says something (draft or posted): resolves true to go on.
async function tellAskReplace(n) {
  const posted = n.status === 'posted';
  const name = tellNoticeName(n);
  const opts = {
    title: 'Replace the notice “' + name + '”?',
    body: posted ? 'It is on every phone right now. Pinning this message puts it in its place.' : 'It is a draft nobody else sees. Pinning this message puts it in its place.',
    actions: [{ label: 'Replace it', value: 'replace', kind: 'gold' }, { label: 'Not now', value: 'cancel', cancel: true }],
  };
  if (typeof askDialog === 'function') return (await askDialog(opts)) === 'replace';
  return confirm(opts.title + '\n\n' + opts.body);
}

function tellBuzzWhy(r) {
  if (!r) return 'no answer';
  if (r.error === 'not-configured') return "phone alerts aren't switched on yet";
  if (r.error === 'not-editor') return 'only directors can buzz';
  return String(r.error || 'it did not go through').replace(/\.$/, '');
}

// One buzz through push.js's direct sender; always resolves a report line, never throws.
async function tellRunBuzz(buzz, text) {
  let r = null;
  try { r = await pushSendAlert({ text, audience: buzz.audience, urgent: buzz.urgent }); } catch (e) { r = { ok: false, error: 'it did not go through' }; }
  if (!r || !r.ok) return { way: 'buzz', ok: false, text: "Buzz didn't go: " + tellBuzzWhy(r) };
  const n = (Number(r.sent) || 0) + (Number(r.queued) || 0);
  if (!n) return { way: 'buzz', ok: false, text: 'Buzz reached no phones: ' + (buzz.nobody || 'nobody has phone alerts on yet') };
  return { way: 'buzz', ok: true, text: 'Buzz sent to ' + n + ' phone' + (n === 1 ? '' : 's') };
}

// The report line for a local way (banner, pin) once it was written. Written while offline it says where it is, and
// carries `offline` so the toast can say when it goes out.
function tellLocalItem(way, ok) {
  if (!ok) return { way, ok: false, text: way === 'banner' ? "Banner didn't post" : "Notice didn't pin" };
  const off = tellOffline();
  const text = off ? (way === 'banner' ? 'Banner' : 'Notice') + ' saved on this phone' : way === 'banner' ? 'Banner posted' : 'Notice pinned';
  return off ? { way, ok: true, text, offline: true } : { way, ok: true, text };
}

// What the toast after a send says: every report line, and, for what was only saved on this phone, when it goes out.
function tellSaid(items) {
  return items.map((it) => it.text).join(' · ') + (items.some((it) => it.offline) ? '. It goes out when you’re back online.' : '');
}

// The two local ways (banner, pin): plain state edits, saved ONCE. Returns what an Undo needs.
function tellApplyLocal(plan) {
  const rec = { bannerId: '', banner: null, notice: null };
  if (plan.banner) {
    rec.bannerId = postBanner(plan.text, plan.banner.ttlMs) || '';
    rec.banner = !!rec.bannerId;
  }
  if (plan.pin) {
    const prev = tellClone(noticeBoard());
    const wrote = tellClone(plan.pin.notice);
    state.notice = wrote;
    normalizeNotice();
    rec.notice = { prev, wrote: tellCanon(state.notice) };
  }
  if (rec.banner || rec.notice) { touchData({ celebrate: false }); saveState(); }
  renderAll();
  return rec;
}

async function tellSend() {
  if (tell.sending) return;
  if (!tellMayUse()) return;
  const m = tellModel();
  if (!m.ready) { if (m.missing) showToast(m.missing); tellWobble(tellEl('tell-send')); return; }
  const plan = tellPlan(m);
  // A pin replaces the whole notice: ask first when the one there says anything. Nothing has gone out yet, so "Not now"
  // is a clean stop.
  if (plan.pin && tellNoticeHasContent(noticeBoard()) && !(await tellAskReplace(noticeBoard()))) return;
  if (!tellMayUse() || tell.sending) return; // the answer took time: the person or the role may have changed
  tell.sending += 1;
  tell.result = null;
  tellPaint();
  const items = [];
  let rec = { bannerId: '', banner: null, notice: null };
  try {
    rec = tellApplyLocal(plan);
    if (plan.banner) items.push(tellLocalItem('banner', !!rec.banner));
    if (plan.pin) items.push(tellLocalItem('pin', !!rec.notice));
    if (plan.buzz) items.push(await tellRunBuzz(plan.buzz, plan.text));
  } finally {
    tell.sending = Math.max(0, tell.sending - 1);
  }
  tellFinishSend(plan, items, rec);
}

// After every channel answered: all fine → close, clear, one Undo toast. Otherwise stay, say which, and un-tick the ways
// that already went (a second Send must not post the banner again; Try again re-sends only the one that failed).
function tellFinishSend(plan, items, rec) {
  const failed = items.filter((it) => !it.ok);
  const said = tellSaid(items);
  const undoable = !!(rec.banner || rec.notice);
  if (undoable) {
    showToast(said, {
      mine: true, duration: TELL_UNDO_MS,
      action: { label: 'Undo', run: () => tellUndo(rec) },
    });
  } else if (!failed.length) showToast(said, { mine: true });
  if (!failed.length) {
    tell.result = null;
    tellResetDraft();
    if (toolIsOpen('tell')) closeTool(); else tellPaint();
    return;
  }
  const d = tell.d;
  items.forEach((it) => { if (it.ok && (it.way === 'banner' || it.way === 'pin')) d[it.way] = false; });
  tell.result = { items, text: plan.text, plan };
  tellSaveDraft();
  tellPaint();
}

// "Try again" on one failed channel: re-sends just that one, with the words it was sent with (the box may have been edited).
async function tellRetry(way) {
  const r = tell.result;
  if (!r || tell.sending || !tellMayUse()) return;
  const i = r.items.findIndex((it) => it.way === way && !it.ok);
  if (i < 0) return;
  tell.sending += 1;
  tellPaint();
  let item;
  let rec = { bannerId: '', banner: null, notice: null };
  try {
    if (way === 'buzz' && r.plan.buzz) {
      if (!tellBuzzState().available) item = { way: 'buzz', ok: false, text: "Buzz didn't go: " + tellBuzzState().reason.toLowerCase() };
      else item = await tellRunBuzz(r.plan.buzz, r.text);
    } else if (way === 'banner' && r.plan.banner) {
      rec = tellApplyLocal({ text: r.text, banner: r.plan.banner, pin: null, buzz: null });
      item = tellLocalItem('banner', !!rec.banner);
    } else if (way === 'pin' && r.plan.pin) {
      rec = tellApplyLocal({ text: r.text, banner: null, pin: r.plan.pin, buzz: null });
      item = tellLocalItem('pin', !!rec.notice);
    }
  } finally {
    tell.sending = Math.max(0, tell.sending - 1);
  }
  if (!item) return;
  r.items[i] = item;
  if (rec.banner || rec.notice) showToast(tellSaid([item]), { mine: true, duration: TELL_UNDO_MS, action: { label: 'Undo', run: () => tellUndo(rec) } });
  if (r.items.every((it) => it.ok)) {
    tell.result = null;
    tellResetDraft();
    if (toolIsOpen('tell')) closeTool(); else tellPaint();
    return;
  }
  tellPaint();
}

// The Undo toast: the banner comes down (if it is still up) and the notice goes back to what it was — but only if it
// still equals what this send wrote. A buzz can't be taken back, which is why the Buzz row says so first.
function tellUndo(rec) {
  if (!canEdit()) return;
  const left = [];
  let did = false;
  if (rec.bannerId && state.announcements && state.announcements[rec.bannerId]) { takeDownBanner(rec.bannerId); did = true; }
  if (rec.notice) {
    normalizeNotice();
    if (tellCanon(state.notice) === rec.notice.wrote) { state.notice = tellClone(rec.notice.prev); normalizeNotice(); did = true; }
    else left.push('Someone changed the notice since, so it stays as it is.');
  }
  if (did) { touchData({ celebrate: false }); saveState(); renderAll(); }
  showToast(left.length ? (did ? 'Undone, except: ' : '') + left.join(' ') : 'Undone');
}

// "Take down" on a Showing now row (and Now's "Remove for everyone", which passes its own banner as `rowEl`): a banner
// leaves every phone; the notice goes back to a draft. Both with the same 10-second Undo (a banner back only if it is
// still absent and unexpired; the notice back to posted only if nobody changed it since). The row squashes out
// (playRowOut) and the rest of its list glide up at once (glideNow: the person's own act).
function tellTakeDown(kind, id, rowEl) {
  if (!tellMayUse()) return;
  if (kind === 'banner') {
    const a = state.announcements && state.announcements[id];
    if (!a) return;
    const copy = tellClone(a);
    const row = rowEl || document.querySelector('#tell-showing-list [data-key="ann-' + id + '"]');
    const go = () => {
      if (!takeDownBanner(id)) return;
      touchData({ celebrate: false });
      saveState();
      glideNow(renderAll);
      showToast('Banner taken down', {
        duration: TELL_UNDO_MS,
        action: {
          label: 'Undo',
          run: () => {
            if (!canEdit() || (state.announcements && state.announcements[copy.id]) || announcementExpired(copy)) return;
            state.announcements = state.announcements || {};
            state.announcements[copy.id] = copy;
            touchData({ celebrate: false });
            saveState();
            renderAll();
          },
        },
      });
    };
    playRowOut(row, go);
    return;
  }
  if (kind === 'notice') {
    if (!noticePosted()) return;
    // setNoticeStatus renders: the row's exit first, then the list closes up at once.
    const row = document.querySelector('#tell-showing-list [data-key="notice"]');
    if (row && typeof JellyMotion !== 'undefined' && typeof row.animate === 'function' && !row.__leaving) {
      playRowOut(row, () => { if (noticePosted() && tellMayUse()) tellNoticeDown(); });
      return;
    }
    tellNoticeDown();
  }
}

function tellNoticeDown() {
  glideNow(() => setNoticeStatus('draft', { celebrate: false }));
  const after = tellCanon(noticeBoard());
  showToast('Notice taken down', {
    duration: TELL_UNDO_MS,
    action: {
      label: 'Undo',
      run: () => { if (canEdit() && tellCanon(noticeBoard()) === after) setNoticeStatus('posted', { celebrate: false }); },
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// WIRING (once; every handler reads the draft and the state AT CALL TIME)
// ════════════════════════════════════════════════════════════════════
function tellWire(tk) {
  if (tell.wired) return;
  tell.wired = true;
  tk.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    let b;
    if ((b = t.closest('[data-tell-down]'))) { tellTakeDown(b.dataset.tellDown, b.dataset.id || ''); return; }
    if ((b = t.closest('[data-tell-retry]'))) { tellRetry(b.dataset.tellRetry); return; }
    if ((b = t.closest('.tell-q'))) { tellQuick(b.dataset.quick); return; }
    if ((b = t.closest('.tell-tick'))) { tellToggle(b.id.replace(/^tell-/, '')); return; }
    if ((b = t.closest('#tell-ttl .seg-btn'))) { tellSetTtl(b.dataset.ttl); return; }
    if ((b = t.closest('#tell-aud .seg-btn'))) { tellSetAudience(b.dataset.aud); return; }
    if ((b = t.closest('.tell-team'))) { tellSetTeam(b.dataset.team, b); return; }
    if (t.closest('#tell-notice-full')) { tellOpenFullNotice(); return; }
    if (t.closest('#tell-done')) { const ta = tellEl('tell-text'); if (ta && typeof ta.blur === 'function') ta.blur(); return; }
    if (t.closest('#tell-send')) { tellSend(); }
  });
  const ta = tellEl('tell-text');
  if (ta) ta.addEventListener('input', () => tellOnInput(ta));
  const sw = tellEl('tell-urgent');
  // A change event is the person's own tap (a programmatic `checked` never fires one).
  if (sw) sw.addEventListener('change', () => { tell.d.urgent = sw.hasAttribute('checked'); tellPaint(); });
  [['tell-ttl', 'ttl', tellSetTtl], ['tell-aud', 'aud', tellSetAudience]].forEach(([id, k, fn]) => {
    const seg = tellEl(id);
    if (seg && typeof segArrowKeys === 'function') segArrowKeys(seg, (btn) => fn(btn.dataset[k]));
  });
}

// More's row opens the composer (wired once, the row is static markup).
(function tellWireRow() {
  if (typeof document === 'undefined') return;
  const row = document.getElementById('tell-row');
  if (row && row.addEventListener) row.addEventListener('click', () => openTool('tell', { from: 'more' }));
})();
