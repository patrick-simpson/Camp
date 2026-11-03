// ── now-ui.js — THE NOW TAB'S RENDERERS (redesign §3; BUILD-PLAN Step 17, build session 2) ───────────────────
// app.js's nowModel() is the whole Now tab as PLAIN DATA (a block, a moment, the rows under the card, the messages); this
// file paints it onto the static markup in index.html (`#now-card` and the sections after it: the comment at #now-card
// documents every hook and row template) and wires the taps. Same contract as tell.js / award.js / reveal-ui.js: a classic
// script loaded after app.js, every hook in app.js typeof-guarded, static markup, change-only writes. Hooks app.js calls:
// renderNow(model) for a full paint, renderNowClock(model) when only model.clock moved (the 30 s tick),
// renderNowMessages(model) for the strip, renderNowSheet(id) for Now's three reading sheets.
//
// THE RULES THIS FILE LIVES BY
//  - IT DRAWS WHAT THE MODEL HOLDS AND NOTHING ELSE. The model already left every director-only field out of a counselor's
//    picture (no point, no place), so no builder here asks "may this person see it": a field is there or it is not. The one
//    exception is a TAP that writes (a key in a moment, Still on this, Take down): it re-checks the role at call time.
//  - POINTS ARE NEVER A SECOND WRITE PATH. A key in the cleanup / verse moment calls app.js's setCleanupPoints /
//    setVersePoints, the very functions Award points and the Meal cleanup / Memory verse sheets call (the deterministic id
//    `cleanup-<team>-<dow>-<meal>` / `verse-<team>-<dow>`), behind canScoreRound (the own-team guard).
//  - RENDER STABILITY (§13.1). Every part is split by volatility: the minutes left and the hairline change on every tick and
//    are patched alone (renderNowClock); everything else changes at a wake-up or with the data and goes through
//    setHtmlIfChanged / setTextIfChanged / setHiddenIfChanged / setDataIfChanged, so an idle renderAll writes nothing and a
//    Jelly component, an <img> or a focused key is never re-created for no reason.
//  - EVERY DATABASE STRING IS ESCAPED (esc) and every emoji, link and colour passes its camp-core.js sanitizer on the way
//    in (safeEmoji, safeVideoUrl, teamMarkHtml / teamAccentAttr). Markup never carries an animation class.
//  - MOTION (§9.5, jelly-motion.js presets, calm-aware): a block changing over arrives (the card on `arrive`; calm fades), a
//    moment unfolds, a game going Live → Done pops its check and drops the medals bronze → silver → gold, the hairline is
//    nudged (never refilled from empty), a notice arrives and squashes out. Motion starts from DIFFS made here, never from
//    a render: the first paint, the paint that brings Now back into view (its whole panel arrives then) and a paint under a
//    takeover are plain writes.
//  - Names are all `now…` / `renderNow…` (one global scope). The week's data is read only through the model and the SEAM
//    accessors (tests/seam.test.js scans this file).

const nowUi = {
  wired: false,
  arriveKey: null,   // the picture the card last showed (kind + block): a different one arrives
  painted: false,    // a full paint has happened: from the second on, a change is one the person can see
  p: null,           // the hairline's last fill (0–1), so a tick nudges instead of refilling
  momentShown: false,
  noticeShown: null, // the strip's last state (null before the first paint)
  statuses: {},      // game id → last status painted, to see Live → Done
  flip: new Set(),   // games that went Live → Done and are waiting for their medals to be on screen
  shell: '',         // the shape `#now-card-body` last had, for the kinds that keep a persistent child
};

function nowEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
function nowMark(id, size) { return teamMarkHtml(id, { size }); }
// A team row's accent: ` style="--team-accent-l:…;--team-accent-d:…"` (laundered in teamAccentVars) or ''.
function nowAccent(id) { return typeof teamAccentAttr === 'function' ? teamAccentAttr(id) : ''; }
function nowIcon(id, cls) { return `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${id}"/></svg>`; }
const NOW_CHEV = nowIcon('i-chev-r');

// Is Now what the person is looking at right now, with nothing stacked over it, and was it already showing (so a change
// is a change they can SEE, not the panel arriving)? Motion starts only then.
function nowOnScreen() {
  return typeof activeTab === 'function' && activeTab() === 'now' && !shell.dirty.now && !shellTakeoverOpen() && !builderOpen();
}

// ════════════════════════════════════════════════════════════════════
// PURE PIECES — markup from the model's plain data (tests/now-ui.test.js reads these)
// ════════════════════════════════════════════════════════════════════
// A run row (Up next, Later today, Then, Tomorrow, a morning's first three): flat, time · emoji · title, a sub only when it
// says something personal. The meal's dish rides its title ("Lunch · Hot Dogs").
function nowRunRowHtml(r) {
  const emo = safeEmoji(r.emoji, '');
  const title = esc(r.title) + (r.dish && r.dish.text ? ' · ' + esc(r.dish.text) : '');
  const sub = r.sub && r.sub.text ? `<span class="nr-sub">${r.sub.mine ? '<b>' + esc(r.sub.text) + '</b>' : esc(r.sub.text)}</span>` : '';
  return `<div class="nr" role="listitem" data-key="${esc(r.key)}"${r.mine ? ' data-mine' : ''}><span class="nr-time">${esc(r.time)}</span>` +
    `<span class="nr-main"><span class="nr-title">${emo ? `<span class="nr-emo" aria-hidden="true">${emo}</span>` : ''}<span>${title}</span></span>${sub}</span></div>`;
}
function nowRunListHtml(rows) { return (rows || []).map(nowRunRowHtml).join(''); }

// Still to do today: a button that opens the right takeover.
const NOW_TODO_ICONS = { game: 'i-trophy', cleanup: 'i-broom', verse: 'i-book', join: 'i-people' };
function nowTodoRowHtml(r) {
  return `<button type="button" class="nr nr-act" role="listitem" data-key="${esc(r.key)}" data-todo="${esc(r.todo)}" data-ref="${esc(r.ref)}">` +
    `<span class="nr-ico" aria-hidden="true">${nowIcon(NOW_TODO_ICONS[r.todo] || 'i-chev-r')}</span>` +
    `<span class="nr-main"><span class="nr-title">${esc(r.title)}</span><span class="nr-sub">${esc(r.sub)}</span></span>${nowIcon('i-chev-r', 'nr-chev')}</button>`;
}

// The medal winners of a finished game (public: names only).
function nowPodiumHtml(podium) {
  if (!podium || !podium.length) return '';
  const word = { 1: 'Gold: ', 2: 'Silver: ', 3: 'Bronze: ' };
  return `<ol class="pd" aria-label="Medal winners">${podium.map((c) =>
    `<li class="pd-c" data-place="${c.place}" data-team="${esc(c.team)}"${nowAccent(c.team)}${c.mine ? ' data-mine' : ''}>` +
    `<span class="pd-top"><i class="pd-disc" aria-hidden="true">${c.place}</i>${nowMark(c.team, 24)}</span>` +
    `<span class="pd-nm"><span class="visually-hidden">${word[c.place] || ''}</span>${esc(nowTeamWord(c.team))}</span></li>`).join('')}</ol>`;
}

// A live game's board: a tally (roster order and no numerals for a counselor; a director's order carries `place`) or a match.
function nowBoardHtml(b) {
  if (!b) return '';
  if (b.kind === 'tally') {
    const cap = 'Scores so far · ' + (b.ranked ? b.cap : 'team order');
    const rows = (b.rows || []).map((r) =>
      `<li class="lb-r" data-team="${esc(r.team)}"${nowAccent(r.team)}${r.mine ? ' data-mine' : ''}>${b.ranked && r.place ? `<span class="lb-pl">${r.place}</span>` : ''}` +
      `${nowMark(r.team, 20)}<span class="lb-nm">${esc(nowTeamWord(r.team))}</span><b class="lb-v">${esc(r.v)}</b></li>`).join('');
    return `<div class="lb" data-kind="tally"${b.ranked ? ' data-ranked' : ''}><p class="lb-cap">${esc(cap)}</p><ol class="lb-rows">${rows}</ol></div>`;
  }
  if (b.kind === 'match') {
    const side = (s) => `<p class="lb-side" data-team="${esc(s.team)}"${nowAccent(s.team)}${s.mine ? ' data-mine' : ''}>${nowMark(s.team, 28)}` +
      `<span class="lb-nm">${esc(nowTeamWord(s.team))}</span>${s.v != null ? `<b class="lb-v">${esc(s.v)}</b>` : ''}</p>`;
    const vs = b.sides && b.sides.length === 2 ? `<div class="lb-vs">${side(b.sides[0])}<span class="lb-x" aria-hidden="true">vs</span>${side(b.sides[1])}</div>` : '';
    const next = b.next && b.next.length === 2 ? `<p class="lb-next">Next: <b>${esc(nowTeamWord(b.next[0]))}</b> vs <b>${esc(nowTeamWord(b.next[1]))}</b></p>` : '';
    return `<div class="lb" data-kind="match"><p class="lb-cap">${esc(b.cap)}</p>${vs}${next}</div>`;
  }
  return '';
}

// One game of the block: the status mark, ONE open target over the row, Score beside it (a director) or the own-team reason.
function nowGameRowHtml(r) {
  const word = { done: 'Done: ', live: 'Live: ', todo: 'Not started: ' }[r.status] || '';
  const bits = [r.where, r.line].filter(Boolean).map(esc);
  if (r.next) bits.push('<b>up next</b>');
  const id = esc(r.id);
  let end = nowIcon('i-chev-r', 'gr-chev');
  let why = '';
  if (r.score && r.score.why) why = `<p class="gr-why">${nowIcon('i-lock')}<span>${esc(r.score.why)}</span></p>`;
  else if (r.score) end = `<button type="button" class="btn btn-sm gr-score${r.score.gold ? ' btn-gold' : ''}" data-score-game="${id}">Score</button>`;
  const extra = r.status === 'done' ? nowPodiumHtml(r.podium) : r.status === 'live' ? nowBoardHtml(r.board) : '';
  return `<div class="gr" role="listitem" data-key="${esc(r.key)}" data-status="${esc(r.status)}"${r.next ? ' data-next' : ''}${r.mine ? ' data-mine' : ''}>` +
    `<span class="gr-st" aria-hidden="true"></span>` +
    `<button type="button" class="gr-hit" data-open-game="${id}"><span class="visually-hidden">${word}</span><span class="gr-name">${esc(r.name)}</span>` +
    `${r.status === 'live' ? '<span class="gr-tag" data-tag="live">Live</span>' : ''}${bits.length ? `<span class="gr-sub">${bits.join(' · ')}</span>` : ''}</button>` +
    `${end}${why}${extra}</div>`;
}

// The four-team bracket (Step 22's data), in the order of play.
function nowBracket4Html(b4) {
  if (!b4 || !b4.cells) return '';
  const tag = { done: 'Done', live: 'Live', todo: 'Next' };
  const cells = b4.cells.map((c) => {
    const mine = c.teams.some((t) => t.mine);
    const t = c.teams.map((x) => (x.team
      ? `<p class="b4-t" data-team="${esc(x.team)}"${nowAccent(x.team)}${x.mine ? ' data-mine' : ''}${x.lost ? ' data-lost' : ''}>${nowMark(x.team, 22)}<span class="b4-nm">${esc(nowTeamWord(x.team))}</span>${x.won ? '<span class="b4-won">won</span>' : ''}</p>`
      : `<p class="b4-t" data-tbd><i class="b4-tbd" aria-hidden="true"></i><span class="b4-nm">${esc(x.tbd || 'To be decided')}</span></p>`)).join('');
    const tg = c.status === 'todo' && !c.next ? '' : `<span class="gr-tag" data-tag="${c.status === 'todo' ? 'next' : c.status}">${tag[c.status]}</span>`;
    return `<div class="b4-m" role="listitem" data-key="${esc(c.key)}" data-slot="${esc(c.slot)}" data-status="${esc(c.status)}"${mine ? ' data-mine' : ''}>` +
      `<p class="b4-h"><span class="b4-name">${esc(c.name)}</span>${tg}</p>${t}</div>`;
  }).join('');
  return `<div class="b4" role="list" aria-label="Four-team bracket">${cells}</div>`;
}

// Every station of one elective (the director's card body, and the "Who's where" sheet).
function nowStationsHtml(body) {
  if (!body) return '';
  const names = (people) => people.map((p) => (p.mine ? `<b class="es-me">${esc(p.name)}</b>` : esc(p.name))).join(', ');
  const st = (body.stations || []).map((s) =>
    `<div class="es-st" role="listitem" data-key="${esc(s.key)}"${s.mine ? ' data-mine' : ''}><p class="es-st-h"><span class="es-st-emo" aria-hidden="true">${safeEmoji(s.emoji, '🌟')}</span>` +
    `<b class="es-st-name">${esc(s.station)}</b></p><p class="es-st-who">${names(s.people)}</p></div>`).join('');
  const brk = (body.onBreak || []).length
    ? `<div class="es-st" role="listitem" data-key="break" data-break><p class="es-st-h"><b class="es-st-name">On break</b></p><p class="es-st-who">${names(body.onBreak)}</p></div>` : '';
  return st || brk ? `<div class="es-all" role="list">${st}${brk}</div>` : '';
}

function nowElectiveBodyHtml(body) {
  if (!body) return '';
  if (body.mode === 'ask' && body.ask) {
    return `<div class="es-ask"><p class="es-ask-q">Which counselor are you?</p><p class="es-ask-s">Tap your name to see your station. This phone remembers it.</p>` +
      `<div class="es-ask-names">${body.ask.names.map((n) => `<button type="button" class="btn es-name" data-identity="${esc(n)}">${esc(n)}</button>`).join('')}</div>` +
      `<button type="button" class="nw-link es-skip" data-identity="">I’m just cheering${NOW_CHEV}</button></div>`;
  }
  if (body.mode === 'all') return nowStationsHtml(body);
  const then = body.then && body.then.length ? `<h3 class="nw-h">Then</h3><div class="nr-list nw-then" role="list">${nowRunListHtml(body.then)}</div>` : '';
  const c = body.count || { stations: 0, onBreak: 0 };
  const sub = c.stations + ' station' + (c.stations === 1 ? '' : 's') + (c.onBreak ? ' · ' + c.onBreak + ' on break' : '');
  return then + `<button type="button" class="nw-row" data-whos-where aria-haspopup="dialog" aria-controls="sheet-whos-where"><span class="nw-row-text">` +
    `<span class="nw-row-t">Who’s where</span><span class="nw-row-s">${esc(sub)}</span></span>${NOW_CHEV}</button>`;
}

// Bible study: the day's memory verse. The song is a link only when it passes safeVideoUrl.
function nowVerseHtml(v) {
  if (!v) return '';
  const video = safeVideoUrl(v.video);
  const th = v.theme;
  const theme = th && (th.title || th.ref) ? `<p class="vs-theme"><span class="vs-theme-k">Week theme</span> · ${[th.title, th.ref].filter(Boolean).map(esc).join(' · ')}</p>` : '';
  return `<div class="vs"><p class="vs-k">Today’s memory verse</p>${v.text ? `<blockquote class="vs-text"><p>${esc(v.text)}</p></blockquote>` : ''}` +
    `${v.ref ? `<p class="vs-ref">${esc(v.ref)}</p>` : ''}` +
    `${video ? `<a class="btn vs-song" href="${esc(video)}" target="_blank" rel="noopener noreferrer">${nowIcon('i-play')}Watch the verse song</a>` : ''}${theme}</div>`;
}

// The posted notice (the send-off card's body and #sheet-notice's), the viewer's own team first.
function nowNoticeHtml(n) {
  if (!n) return '';
  const yours = n.yours && n.yours.place
    ? `<div class="nb-yours" data-team="${esc(n.yours.team)}"${nowAccent(n.yours.team)}><p class="nb-yours-k">Your team</p><p class="nb-yours-p">${nowMark(n.yours.team, 34)}` +
      `<span><b>${esc(n.yours.place)}</b>${n.yours.note ? `<small>${esc(n.yours.note)}</small>` : ''}</span></p></div>` : '';
  const zones = (n.zones || []).filter((z) => z.place);
  const zhtml = zones.length ? `<h3 class="nw-h">Every team</h3><ul class="nb-zones" role="list">${zones.map((z) =>
    `<li class="nb-zone" data-key="${esc(z.key)}"${z.mine ? ' data-mine' : ''}>${nowMark(z.team, 24)}<span class="nb-team">${esc(teamName(z.team))}</span>` +
    `<span class="nb-place">${esc(z.place)}${z.note ? `<small>${esc(z.note)}</small>` : ''}</span></li>`).join('')}</ul>` : '';
  const steps = (n.steps || []).length ? `<ol class="nb-steps">${n.steps.map((s) =>
    `<li class="nb-step"><p class="nb-when">${safeEmoji(s.emoji, '') ? `<span class="nb-emo" aria-hidden="true">${safeEmoji(s.emoji, '')}</span>` : ''}${esc(s.when)}</p>` +
    `${s.items.length ? `<ul class="nb-items">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>` : '';
  return `<div class="nb">${yours}${zhtml}${steps}${n.signoff ? `<p class="nb-signoff">${esc(n.signoff)}</p>` : ''}</div>`;
}

// The strip on Now as markup (index.html's static #now-notice, which renderNowMessages patches in place, has the same parts: a test
// compares their class lists), for the two previews that draw a notice that is not on the page: Tell everyone's "On a counselor's
// phone" and the builder's Notice tab. A picture: the See all in it answers nothing (the previews' CSS turns pointer events off).
function nowNoticeStripHtml(n) {
  if (!n) return '';
  const y = n.yours && n.yours.place ? n.yours : null;
  const yours = y ? `<p class="nn-yours"><span class="nn-mark">${nowMark(y.team, 24)}</span><span class="nn-words"><b>${esc(nowTeamWord(y.team))}</b> · ${esc(y.place)}${y.note ? `<small>${esc(y.note)}</small>` : ''}</span></p>` : '';
  return `<section class="msg nn" data-kind="notice"><span class="msg-ico" aria-hidden="true">${nowIcon('i-pin')}</span><div class="msg-body">` +
    `<h2 class="nn-title">${esc(n.title || n.eyebrow || 'Notice')}</h2>${n.sub ? `<p class="msg-text nn-sub">${esc(n.sub)}</p>` : ''}${yours}` +
    `<p class="msg-meta nn-acts"><button type="button" class="nn-all" tabindex="-1">See all${NOW_CHEV}</button></p></div></section>`;
}
// A notice as a counselor's phone shows it: the strip, then (`opts.strip` leaves it out: Tell everyone's preview) what See all opens.
function nowNoticePreviewHtml(n, opts) {
  const strip = nowNoticeStripHtml(n);
  if (opts && opts.strip) return strip;
  return strip + `<div class="nb-preview"><h3 class="nw-h">Tap See all, and they read</h3>${nowNoticeHtml(n)}</div>`;
}

// Notes under the title: plain lines with an icon or a team mark, never a tinted callout.
function nowNotesHtml(notes) {
  return (notes || []).map((n) => {
    if (n.kind === 'double') return `<p class="nw-note" data-note="double">${nowIcon('i-bolt')}<span>${esc(n.text)}</span></p>`;
    if (n.kind === 'rain') return `<p class="nw-note" data-note="rain">${nowIcon('i-rain')}<span>${esc(n.text)}</span></p>`;
    if (n.kind === 'team' && n.team) {
      return `<p class="nw-note" data-note="team" data-team="${esc(n.team)}"${nowAccent(n.team)}${n.mine ? ' data-mine' : ''}><span class="nw-note-mark">${nowMark(n.team, 22)}</span>` +
        `<span><b>${esc(n.lead)}</b>${esc(n.rest)}</span></p>`;
    }
    return '';
  }).join('');
}

// The words under the title. A meal's dish is its answer; a station reads "with William · Pumpkins".
function nowSubHtml(model) {
  const c = model.card;
  const b = model.body || {};
  if (c.kind === 'meal') return b.dish && b.dish.text ? `<span class="nw-dish">${b.dish.emoji ? `<span class="nw-dish-emo" aria-hidden="true">${safeEmoji(b.dish.emoji, '')}</span>` : ''}${esc(b.dish.text)}</span>` : '';
  if (c.kind === 'elective' && b.mode === 'station' && b.station && b.station.with && b.station.with.length) {
    const w = b.station.with;
    const names = nowJoinNames(w.map((x) => '<b>' + esc(x.name) + '</b>'));
    const team = w.length === 1 && w[0].team ? ' · ' + esc(nowTeamWord(w[0].team)) : '';
    return 'with ' + names + team;
  }
  if (c.kind === 'between') {
    const r = b.rows && b.rows[0];
    if (!r) return '';
    const dish = r.dish && r.dish.text ? ' · ' + esc(r.dish.text) : '';
    return `${r.emoji ? `<span aria-hidden="true">${safeEmoji(r.emoji, '')}</span> ` : ''}${esc(r.title)}${r.time ? ' at ' + esc(r.time) : ''}${dish}`;
  }
  if (c.kind === 'morning') { const r = b.rows && b.rows[0]; return r && r.time ? 'The day starts at ' + esc(r.time) : ''; }
  if (c.kind === 'arrival' && !model.block) {
    const left = model.clock && model.clock.untilNext != null ? ' · in ' + nowSpanText(model.clock.untilNext) : '';
    return esc(c.sub || '') + esc(left);
  }
  if (c.kind === 'notice' && b.notice) return esc(b.notice.sub || '');
  if (c.kind === 'none') return b.cta === 'setup' ? 'Pick the camp’s Sunday and the schedule follows.' : '';
  if (c.kind === 'over') return 'Thank you for a wonderful week of camp.';
  return c.sub ? esc(c.sub) : '';
}

// The kind's own content under the title.
function nowBodyHtml(model) {
  const c = model.card;
  const b = model.body || {};
  switch (c.kind) {
    case 'games': {
      const rows = (b.rows || []).map(nowGameRowHtml).join('');
      return (rows ? `<div class="gr-list" role="list">${rows}</div>` : '') + nowBracket4Html(b.bracket4);
    }
    case 'elective': return nowElectiveBodyHtml(b);
    case 'bible': return nowVerseHtml(b.verse);
    case 'meeting': return b.youMeet && nowMyTeam()
      ? `<p class="nw-you" data-team="${esc(nowMyTeam())}"${nowAccent(nowMyTeam())}>${nowMark(nowMyTeam(), 22)}<span>Your team meets today</span></p>` : '';
    case 'arrival': {
      const w = b.welcome;
      if (!w) return '';
      const m = w.meet;
      return `<div class="nw-welcome" data-team="${esc(w.team)}"${nowAccent(w.team)}><span class="nw-welcome-mark">${nowMark(w.team, 56)}</span>` +
        `<p class="nw-welcome-t">Welcome to the <b>${esc(w.name)}</b></p>` +
        `${m ? `<p class="nw-welcome-s">Meet your team at ${esc(m.title)} · ${esc(m.time)}${m.place ? ' · ' + esc(m.place) : ''}</p>` : ''}</div>`;
    }
    case 'night': {
      const head = b.heading === 'Tomorrow' ? 'Tomorrow · ' + dayLabel((model.at.dow + 1) % 7) : b.heading === 'Today' ? 'Today · ' + dayLabel(model.at.dow) : '';
      return b.rows && b.rows.length ? (head ? `<h3 class="nw-h">${esc(head)}</h3>` : '') + `<div class="nr-list" role="list">${nowRunListHtml(b.rows)}</div>` : '';
    }
    case 'morning': return b.rows && b.rows.length ? `<div class="nr-list" role="list">${nowRunListHtml(b.rows)}</div>` : '';
    case 'notice': return nowNoticeHtml(b.notice);
    case 'none': return b.cta === 'setup' ? `<button type="button" class="nw-link" data-now-setup>Set up the week${NOW_CHEV}</button>` : '';
    default: return '';
  }
}

// ── the moment (the gold panel at the card's foot) ──────────────────
// Cleanup: one `.nm-team` per team on the rota, for everyone; a CONFIRMED director also gets the 0–3 keys (the model carries
// `pts` / `locked` only for one), or the own-team lock. Verse: Award points' own rows (six keys, the lock) for directors.
function nowMomentTeamHtml(m, t) {
  const word = (m.meal || '').toLowerCase();
  const who = 'On cleanup after ' + word + (t.who ? ' · ' + esc(t.who) : '');
  let tail = '';
  if (t.pts !== undefined) {
    const keys = typeof awardKeysHtml === 'function' ? awardKeysHtml({ n: 4, pts: t.pts, mult: 1, cls: 'nm-pts', label: t.name + ' · ' + word + ' cleanup points' }) : '';
    if (t.locked) {
      tail = `<p class="aw-lock">${nowIcon('i-lock')}<span>Your team · another director gives these</span>${t.pts > 0 ? `<b class="aw-given">+${t.pts}</b>` : ''}</p>`;
    } else {
      tail = `<p class="nm-label">Cleanup points</p>${keys}` + (t.pts > 0 ? `<p class="nm-saved">${nowIcon('i-check')}Saved · ${t.pts}</p>` : '');
    }
  }
  return `<div class="nm-team" data-key="${esc(t.key)}" data-team="${esc(t.team)}"${nowAccent(t.team)}${t.mine ? ' data-mine' : ''}${t.locked ? ' data-locked' : ''}>` +
    `<span class="nm-mark">${nowMark(t.team, 52)}</span><p class="nm-name">${esc(t.name)}</p>` +
    `<p class="nm-who">${who}${t.mine ? '<span class="nm-you">Your team</span>' : ''}</p>${tail}</div>`;
}
function nowMomentBodyHtml(m) {
  if (!m) return '';
  if (m.kind === 'cleanup') return m.teams.map((t) => nowMomentTeamHtml(m, t)).join('');
  if (m.kind === 'verse' && typeof awardRowHtml === 'function') {
    return `<div class="aw-list nm-list">${m.teams.map((t) => awardRowHtml({
      key: t.key, team: t.team, name: t.name, pts: t.pts, n: 6, mult: m.mult || 1,
      label: t.name + ' · ' + dayLabel(m.dow) + ' verse', locked: t.locked, given: t.given,
    })).join('')}</div>`;
  }
  return '';
}

// ════════════════════════════════════════════════════════════════════
// PAINTERS (change-only writes)
// ════════════════════════════════════════════════════════════════════
function nowWhenText(model) {
  const c = model.card;
  let when = c.when;
  if (!when) {
    if (c.kind === 'between') { const r = model.body.rows && model.body.rows[0]; when = r && r.time ? 'free until ' + r.time : ''; }
    else if (c.kind === 'morning' || c.kind === 'arrival' || c.kind === 'none' || c.kind === 'over') when = dayLabel(model.at.dow);
  }
  const parts = [c.tag, when].filter(Boolean);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

// The title: the model's, except "Up next in 12 min" (between two blocks), which moves with the clock.
function nowTitleText(model) {
  const c = model.card;
  if (c.kind === 'between' && model.clock && model.clock.untilNext != null) return 'Up next in ' + nowSpanText(model.clock.untilNext);
  return c.title;
}

// The hairline. A tick on the same block nudges the fill from where it was (glide, never refilled from empty; calm: it jumps).
function nowPaintBar(model, animate) {
  const bar = nowEl('now-card-bar');
  const fill = nowEl('now-card-fill');
  const p = model.clock ? model.clock.progress : null;
  setHiddenIfChanged(bar, p == null);
  if (p == null || !fill) { nowUi.p = null; return; }
  const v = Math.round(p * 1000) / 1000;
  if (nowUi.p === v) return;
  const from = nowUi.p;
  nowUi.p = v;
  fill.style.setProperty('--p', String(v));
  if (animate && from != null && typeof JellyMotion !== 'undefined' && !calmMotion()) {
    JellyMotion.play(fill, 'glide', (x) => ({ transform: 'scaleX(' + (from + (v - from) * x) + ')' }), { calm: false });
  }
}

// What the tick moves: the minutes left, the hairline, and the two lines that count down to something.
function nowPaintClock(model, animate) {
  const c = model.card;
  setTextIfChanged(nowEl('now-card-left'), nowLeftText(model.clock));
  nowPaintBar(model, animate && !c.over);
  if (c.kind === 'between') setTextIfChanged(nowEl('now-card-label'), nowTitleText(model));
  if (c.kind === 'arrival' && !model.block) {
    const sub = nowEl('now-card-sub');
    const html = nowSubHtml(model);
    setHtmlIfChanged(sub, html);
    setHiddenIfChanged(sub, !html);
  }
}

function nowPaintHead(model) {
  const c = model.card;
  setTextIfChanged(nowEl('now-card-k'), c.k);
  setTextIfChanged(nowEl('now-card-when'), nowWhenText(model));
  const over = nowEl('now-card-over');
  setHiddenIfChanged(over, !c.lead);
  if (c.lead) {
    setTextIfChanged(nowEl('now-card-over-text'), c.lead.text);
    const change = nowEl('now-card-change');
    setHiddenIfChanged(change, !c.lead.change);
    if (c.lead.change) setTextIfChanged(nowEl('now-card-change-text'), 'Not ' + String(c.lead.change).split(/\s+/)[0] + '? Change');
  }
  setTextIfChanged(nowEl('now-card-emoji'), safeEmoji(c.emoji, ''));
  setTextIfChanged(nowEl('now-card-label'), nowTitleText(model));
}

function nowPaintFoot(model) {
  const c = model.card;
  const h = c.hold;
  const foot = nowEl('now-card-foot');
  const hold = nowEl('now-card-hold');
  const note = nowEl('now-card-hold-note');
  const down = nowEl('now-card-down');
  setHiddenIfChanged(hold, !(h && h.can));
  setHiddenIfChanged(note, !h);
  // A foot nobody may see holds no words either (the same rule as the moment's keys).
  setTextIfChanged(nowEl('now-card-hold-text'), h ? (h.held ? 'Still on this · +10 min' : 'Still on ' + h.name + ' · +10 min') : '');
  setTextIfChanged(note, h ? (h.can ? (h.held ? 'Keeps this on every phone’s Now. Nothing else moves.' : 'Keeps ' + h.name + ' on every phone’s Now. Nothing else moves.') : 'This is the longest it can stay on Now.') : '');
  setHiddenIfChanged(down, !c.down);
  setHiddenIfChanged(foot, !(h || c.down));
}

// The moment: shown for the model's window only. Cleanup's rows are keyed children of the body (a change glides, and waits for
// a finger to lift); the verse's wrapper is rewritten as a piece.
function nowPaintMoment(model) {
  const m = model.moment;
  const sec = nowEl('now-moment');
  if (!sec) return;
  if (!m) {
    setHiddenIfChanged(sec, true);
    // A hidden panel must not keep a director's keys or words (a demotion, a preview): its title and body are emptied too.
    setHtmlIfChanged(nowEl('now-moment-body'), '');
    setTextIfChanged(nowEl('now-moment-title'), '');
    nowUi.momentShown = false;
    return;
  }
  const was = nowUi.momentShown;
  setHiddenIfChanged(sec, false);
  setDataIfChanged(sec, 'moment', m.kind);
  setTextIfChanged(nowEl('now-moment-title'), m.title);
  setHiddenIfChanged(nowEl('now-moment-secret'), !m.secret);
  setHiddenIfChanged(nowEl('now-moment-key'), !(m.kind === 'cleanup' && m.max));
  const body = nowEl('now-moment-body');
  const html = nowMomentBodyHtml(m);
  if (m.kind === 'cleanup') paintKeyedList(body, html, { view: m.kind + ':' + m.dow + ':' + m.meal });
  else setHtmlIfChanged(body, html);
  nowUi.momentShown = true;
  if (!was && nowUi.painted && nowOnScreen()) nowUnfold(sec);
}

// Up next, Later today and Still to do today. "Whole day" rides the last list head that is shown.
function nowPaintRuns(model) {
  const next = nowEl('now-next');
  const later = nowEl('now-later');
  setHiddenIfChanged(next, !model.next);
  if (model.next) setHtmlIfChanged(nowEl('now-next-list'), nowRunRowHtml(model.next));
  const hasLater = (model.later || []).length > 0;
  setHiddenIfChanged(later, !hasLater);
  if (hasLater) {
    setTextIfChanged(nowEl('now-later-h'), model.laterHeading);
    setHtmlIfChanged(nowEl('now-later-list'), nowRunListHtml(model.later));
  }
  setHiddenIfChanged(nowEl('now-later-day'), !hasLater || !model.wholeDay);
  setHiddenIfChanged(nowEl('now-next-day'), hasLater || !model.next || !model.wholeDay);
  // Still to do today (directors): a row done leaves and the rest glide up.
  const todo = nowEl('now-todo');
  const rows = model.todo || [];
  setHiddenIfChanged(todo, !rows.length);
  paintKeyedList(nowEl('now-todo-list'), rows.map(nowTodoRowHtml).join(''), { view: model.at.dow });
  setHiddenIfChanged(nowEl('now-todo-more'), !model.todoMore);
  if (model.todoMore) setTextIfChanged(nowEl('now-todo-more-text'), model.todoMore + ' more');
}

// ── the full paint ───────────────────────────────────────────────────
function renderNow(model) {
  const card = nowEl('now-card');
  if (!model || !model.card || !card) return;
  nowWire();
  const c = model.card;
  const key = model.at.dow + ':' + c.kind + ':' + (model.block ? model.block.key : '');
  const changed = nowUi.painted && nowUi.arriveKey !== key;
  const live = nowOnScreen();
  nowUi.arriveKey = key;
  if (changed) nowUi.p = null; // another block: its hairline starts there, not from the last one's end
  setHiddenIfChanged(card, false);
  setDataIfChanged(card, 'kind', c.kind);
  setDataIfChanged(card, 'over', c.over);
  nowPaintHead(model);
  nowPaintClock(model, live && !changed);
  const sub = nowEl('now-card-sub');
  const subHtml = nowSubHtml(model);
  setHtmlIfChanged(sub, subHtml);
  setHiddenIfChanged(sub, !subHtml);
  const notes = nowEl('now-card-notes');
  const notesHtml = nowNotesHtml(c.notes);
  setHtmlIfChanged(notes, notesHtml);
  setHiddenIfChanged(notes, !notesHtml);
  setHtmlIfChanged(nowEl('now-card-body'), nowBodyHtml(model));
  nowPaintFoot(model);
  nowPaintMoment(model);
  nowPaintRuns(model);
  renderNowMessages(model);
  if (changed && live) nowArrive(card);
  nowAfterGames(model, live);
  nowUi.painted = true;
}

// The 30 s tick between wake-ups: the clock part only (app.js's nowTick recomputed model.clock).
function renderNowClock(model) {
  if (!model || !model.card || !nowEl('now-card')) return;
  nowPaintClock(model, nowOnScreen());
}

// The messages strip: the posted notice (the banners and the join bar are renderAnnouncements', which also writes the "more"
// row). The notice arrives from above like a banner and leaves squashed (Take down).
function renderNowMessages(model) {
  if (!model) return;
  const notice = (model.messages || []).find((m) => m.kind === 'notice') || null;
  const el = nowEl('now-notice');
  if (el) {
    const live = nowOnScreen() && nowUi.noticeShown !== null;
    setHiddenIfChanged(el, !notice);
    if (notice) {
      setTextIfChanged(nowEl('now-notice-title'), notice.title);
      const sub = nowEl('now-notice-sub');
      setTextIfChanged(sub, notice.sub || '');
      setHiddenIfChanged(sub, !notice.sub);
      const yours = nowEl('now-notice-yours');
      const y = notice.yours;
      const html = y && y.place
        ? `<span class="nn-mark">${nowMark(y.team, 24)}</span><span class="nn-words"><b>${esc(nowTeamWord(y.team))}</b> · ${esc(y.place)}${y.note ? `<small>${esc(y.note)}</small>` : ''}</span>` : '';
      setHtmlIfChanged(yours, html);
      setHiddenIfChanged(yours, !html);
      setHiddenIfChanged(nowEl('now-notice-down'), !notice.canTakeDown);
      if (live && nowUi.noticeShown === false && typeof annArrive === 'function' && typeof JellyMotion !== 'undefined') annArrive(el);
    }
    nowUi.noticeShown = !!notice;
  }
  if (typeof renderAnnouncements === 'function') renderAnnouncements();
}

// ════════════════════════════════════════════════════════════════════
// SHEETS (Now's three reading sheets; the shell opens and closes them, app.js's shellSheetFill calls this)
// ════════════════════════════════════════════════════════════════════
function renderNowSheet(id) {
  if (id === 'notice') {
    if (!noticePosted()) { shellSheetClose('notice'); return; }
    const n = nowNoticeData(nowCtx());
    setTextIfChanged(nowEl('sheet-notice-title'), n.title || n.eyebrow || 'Notice');
    setTextIfChanged(nowEl('sheet-notice-sub'), n.sub || '');
    setHiddenIfChanged(nowEl('sheet-notice-sub'), !n.sub);
    setHtmlIfChanged(nowEl('sheet-notice-body'), nowNoticeHtml(n));
  } else if (id === 'messages') {
    if (!annOverflow.n) { shellSheetClose('messages'); return; }
    setHtmlIfChanged(nowEl('sheet-messages-body'), annOverflow.html);
    nowWireSheetMessages();
  } else if (id === 'whos-where') {
    const m = typeof nowLast !== 'undefined' ? nowLast : null;
    if (!m || m.card.kind !== 'elective' || !m.body || !m.body.stations) { shellSheetClose('whos-where'); return; }
    setTextIfChanged(nowEl('whos-where-when'), [m.card.tag, m.card.when].filter(Boolean).join(' · '));
    setHtmlIfChanged(nowEl('whos-where-body'), nowStationsHtml(m.body));
  }
}
// May a deep link, a Forward or a stale history entry open this sheet right now?
function nowSheetAllowed(id) {
  if (id === 'notice') return noticePosted();
  if (id === 'messages') return annOverflow.n > 0;
  if (id === 'whos-where') return typeof nowLast !== 'undefined' && !!nowLast && nowLast.card.kind === 'elective' && !!nowLast.body.stations;
  return true;
}

// ════════════════════════════════════════════════════════════════════
// MOTION (JellyMotion, calm-aware; every one starts from a diff made above)
// ════════════════════════════════════════════════════════════════════
// A block changing over: the card arrives (calm: a fade).
function nowArrive(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateY(' + 14 * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.6) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 140 });
}
// The moment unfolds from the card's foot.
function nowUnfold(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'arrive', (x) => ({ transform: 'translateY(' + 10 * (1 - Math.min(1, x)) + 'px)', opacity: Math.min(1, x * 1.6) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 140 });
}
function nowPop(el) {
  if (!el || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(el, 'press', (x) => ({ transform: 'scale(' + (0.82 + 0.18 * x) + ')' }), { calm: false });
}
// Live → Done: the check pops and the medals drop bronze → silver → gold. Waits (in `nowUi.flip`) until the row with its
// podium is really on screen, which a repaint that had to wait for a finger to lift is not yet.
function nowAfterGames(model, live) {
  if (model.card.kind !== 'games') { nowUi.statuses = {}; nowUi.flip.clear(); return; }
  const rows = (model.body && model.body.rows) || [];
  const body = nowEl('now-card-body');
  rows.forEach((r) => {
    if (nowUi.statuses[r.id] === 'live' && r.status === 'done') nowUi.flip.add(r.id);
    nowUi.statuses[r.id] = r.status;
  });
  if (!live || !body || typeof body.querySelector !== 'function') { nowUi.flip.clear(); return; }
  nowUi.flip.forEach((id) => {
    const row = body.querySelector('[data-key="g-' + id + '"]');
    if (!row || !row.dataset || row.dataset.status !== 'done') return;
    const medals = row.querySelectorAll ? Array.prototype.slice.call(row.querySelectorAll('.pd-c')) : [];
    nowUi.flip.delete(id);
    nowPop(row.querySelector('.gr-st'));
    medals.reverse().forEach((m, i) => {
      if (typeof JellyMotion === 'undefined') return;
      JellyMotion.play(m, 'arrive', (x) => ({ transform: 'translateY(' + (-12 * (1 - Math.min(1, x))) + 'px)', opacity: Math.min(1, x * 1.8) }), { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 140, delay: i * 90 });
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// TAPS (wired once; every handler reads the model and the state AT CALL TIME)
// ════════════════════════════════════════════════════════════════════
// A key in the moment: the slot is set to exactly that value through the same functions Award points and the Memory verse /
// Meal cleanup sheets call. Only a CONFIRMED director (standingsVisible), only a team the model drew a row for, only a value the
// section has a key for (cleanup 0–3, verse 0–5), never the director's own team (canScoreRound): a stale or forged tap writes nothing.
function nowTapKey(btn) {
  if (!standingsVisible()) return;
  const m = typeof nowLast !== 'undefined' ? nowLast && nowLast.moment : null;
  const row = btn.closest ? btn.closest('.nm-team, .aw-row') : null;
  if (!m || !row || !m.max) return;
  const team = row.dataset.team;
  const pts = Number(btn.dataset.pts);
  if (!m.teams.some((t) => t.team === team)) return;
  if (!Number.isInteger(pts) || pts < 0 || pts > m.max || !competitionDows().includes(m.dow)) return;
  if (!canScoreRound(team)) { showToast("Your own team's points are given by another director."); return; }
  const key = row.dataset.key;
  const had = focusWas(btn); // the render below replaces this key: a keyboard user keeps their place
  // The person's own act: the rows (and Still to do today) glide at once instead of waiting for a finger to lift.
  if (m.kind === 'verse') glideNow(() => setVersePoints(team, m.dow, pts));
  else if (m.kind === 'cleanup' && MEAL_CLEANUP_MEALS.includes(m.meal)) glideNow(() => setCleanupPoints(team, m.dow, m.meal, pts));
  else return;
  const fresh = document.querySelector('#now-moment [data-key="' + key + '"] .aw-pt[data-pts="' + pts + '"]');
  nowPop(fresh);
  focusBack(had, fresh);
}

// "Which counselor are you?": this phone remembers the name (a blank is "just cheering", which asks no more).
function nowSetIdentity(name) {
  state.identity = name ? name : null;
  saveState();
  renderAll();
}

// The send-off notice (or the strip's): back to a draft with Tell everyone's own 10-second Undo; its strip squashes out first.
function nowTakeDownNotice() {
  if (!canEdit() || !noticePosted()) return;
  const strip = nowEl('now-notice');
  const go = () => {
    if (!canEdit() || !noticePosted()) return;
    if (typeof tellNoticeDown === 'function' && typeof tellMayUse === 'function' && tellMayUse()) tellNoticeDown();
    else setNoticeStatus('draft', { celebrate: false });
  };
  if (strip && !strip.hidden) playRowOut(strip, go); else go();
}

// A row of Still to do today opens the right takeover: the game, Award points, or Who can sign in.
function nowOpenTodo(btn) {
  const kind = btn.dataset.todo;
  if (kind === 'game') { openGame(btn.dataset.ref, { from: 'now' }); return; }
  if (kind === 'join') { if (typeof setupOpenPeople === 'function') setupOpenPeople(); return; }
  if (kind === 'cleanup' || kind === 'verse') {
    if (!openTool('award', { from: 'now' })) return;
    if (typeof awardJump === 'function') requestAnimationFrame(() => awardJump(kind === 'verse' ? 'award-verse' : 'award-cleanup'));
  }
}
// "N more": Award points when the rows shown were its kind, else the Games tab.
function nowOpenTodoMore() {
  const rows = (nowLast && nowLast.todo) || [];
  const last = rows[rows.length - 1];
  if (last && (last.todo === 'cleanup' || last.todo === 'verse') && openTool('award', { from: 'now' })) return;
  showTab('games');
}

function nowWire() {
  if (nowUi.wired) return;
  const tab = nowEl('tab-now');
  if (!tab || typeof tab.addEventListener !== 'function') return;
  nowUi.wired = true;
  tab.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    let b;
    if ((b = t.closest('.aw-pt'))) { if (t.closest('#now-moment')) nowTapKey(b); return; }
    if ((b = t.closest('[data-score-game]'))) { openGame(b.dataset.scoreGame, { from: 'now' }); return; }
    if ((b = t.closest('[data-open-game]'))) { openGame(b.dataset.openGame, { from: 'now' }); return; }
    if ((b = t.closest('[data-identity]'))) { nowSetIdentity(b.dataset.identity); return; }
    if (t.closest('#now-card-change')) { if (typeof openIdentityPicker === 'function') openIdentityPicker(); return; }
    if ((b = t.closest('[data-whos-where]'))) { shellSheetOpen('whos-where', b); return; }
    if (t.closest('[data-now-day]')) { openSchedule(); return; }
    if (t.closest('[data-now-setup]')) { openBuilder(); return; }
    if (t.closest('#now-card-hold')) { nowHoldOverrun(); return; }
    if (t.closest('#now-card-down') || t.closest('#now-notice-down')) { nowTakeDownNotice(); return; }
    if ((b = t.closest('#now-notice-all'))) { shellSheetOpen('notice', b); return; }
    if ((b = t.closest('#now-msgs-more'))) { shellSheetOpen('messages', b); return; }
    if (t.closest('#now-todo-more')) { nowOpenTodoMore(); return; }
    if ((b = t.closest('[data-todo]'))) { nowOpenTodo(b); }
  });
}
// The messages sheet's rows answer to the strip's own handler (dismiss, Remove for everyone, See who's asking).
let nowSheetMsgsWired = false;
function nowWireSheetMessages() {
  if (nowSheetMsgsWired) return;
  const body = nowEl('sheet-messages-body');
  if (!body || typeof body.addEventListener !== 'function' || typeof annStripClick !== 'function') return;
  nowSheetMsgsWired = true;
  body.addEventListener('click', annStripClick);
}
