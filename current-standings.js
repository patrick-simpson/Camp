// ── current-standings.js — the big screen's script ─────────────────────
// A PUBLIC, READ-ONLY subscriber (redesign §4.11). Anyone with the address can
// open this page, so it has no account: no sign-in, no Auth SDK, no members read,
// and it writes NOTHING to the database. It reads exactly three things:
//
//   <root>/revealPublic     one listener, both children (`real` and `practice`)
//   .info/serverTimeOffset  the server's clock (until it arrives nothing is
//                           painted from the node: a TV with a wrong clock must
//                           not show a stale reveal or hide a live one)
//   .info/connected         the status line and the "Reconnecting…" chip
//
// and draws whatever reveal-core's tvFrame() says: a pure function of (ctl, pub,
// server time), so the phone's mini TV, this screen and the tests cannot disagree.
// It never computes a standing: names, points and places arrive already frozen
// into the node, one place at a time, and ONLY places a director has shown are in
// the node at all. With no live reveal it says "Waiting for the directors…".
//
// Load order (see the page): the Firebase app + database SDKs, firebase-config.js,
// defaults.js, camp-core.js, reveal-core.js, tv-camp.js, camps.js, then this. It
// uses the camp profile (`CAMP`, `dbPath`), camp-core's sanitizers and reveal-core
// as globals, and keeps everything of its own inside this one IIFE.
(function () {
  'use strict';

  // The page is opened once and left up on a TV, so it polls itself for a newer
  // build (checkForUpdate below). The build stamp lives in the HTML, not here:
  // <meta name="tv-build"> is what this page reads, and the very same stamp sits in
  // an HTML comment as `var TV_BUILD = '…'` for pages from before the script moved
  // out of the HTML, which read that text to decide to reload. Bump BOTH on every
  // edit to the page (CLAUDE.md, deploy step 2).
  var buildMeta = document.querySelector('meta[name="tv-build"]');
  var myBuild = (buildMeta && buildMeta.getAttribute('content')) || '';

  var HIDDEN_OFFLINE_MS = 60 * 1000;     // a hidden page lets go of its connection after this long (Spark's 100-connection cap)
  var FEED_RETRY_MS = 30 * 1000;         // a refused listener is dead for good in the SDK: attach again this often
  var GIVE_UP_CONNECT_MS = 10 * 1000;    // never connected after this long: say so ("Reconnecting…") instead of "Connecting…"
  var TICK_MS = 30 * 1000;               // a safety re-evaluation; the boundary timer is what normally moves the screen
  var DOCK_MS = 460;                     // the hero's shrink into the board (CSS .hero.dock)
  var SDK_RELOAD_MAX = 3;                // a page whose SDK never loaded reloads itself this many times once the network is back

  // ── Helpers ────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  // A TV has no Calm motion switch (no battery, no More tab): it honours the OS
  // setting itself (redesign §10.4), read at call time.
  function reduceMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  // Only writes when the value changed (a TV repaints on every tick; an idle tick must touch nothing).
  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  function setHidden(el, v) { if (el && el.hidden !== v) el.hidden = v; }
  // A <div> with a class and (optionally) markup that is already escaped.
  function box(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  // ── Teams: the camp's own marks, by id ─────────────────────────
  // Names and points come from the node; pictures come from files that ship with
  // the page, chosen by team id (junior's shields, senior's flags), so no team
  // photo, colour or emoji a director typed ever reaches this public screen.
  var TEAM_FLAG_SHAPES = ['plain', 'swallow', 'stripe', 'chevron']; // mirrors app.js — keep in sync
  var TEAM_FLAG_COLORS = ['red', 'blue', 'green', 'gold'];
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function campTeamIds() {
    var out = [];
    for (var i = 0; i < CAMP.teamCount; i++) out.push('t' + i);
    return out;
  }
  // A team slot's own mascot (camps.js), laundered like every string that becomes markup.
  function teamEmojiOf(id) { return safeEmoji(CAMP.teamEmoji && CAMP.teamEmoji[id], '🏕️'); }

  // A team's mark as a DOM node, in the slot's own class (hero-shield, intro-crest,
  // wait-crest, champ-crest), which carries its size and motion: a shipped shield
  // when one passes safeCrestSrc, else the camp's flag (the SHAPE by the team's
  // order, so two flags stay apart without colour), else an emoji tile. Never an
  // <img> with no usable source, never an address concatenated into markup.
  function teamMark(id, cls) {
    var src = safeCrestSrc(CAMP.teamCrest && CAMP.teamCrest[id]);
    if (src) {
      var img = document.createElement('img');
      img.className = cls;
      img.alt = '';
      img.src = src; // a DOM property, never concatenated into markup
      return img;
    }
    var color = CAMP.teamFlag && CAMP.teamFlag[id];
    if (TEAM_FLAG_COLORS.indexOf(color) >= 0) {
      var slot = parseInt(String(id).slice(1), 10) || 0;
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', cls + ' tv-flag');
      svg.setAttribute('data-flag', color);
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', '#flag-' + TEAM_FLAG_SHAPES[slot % TEAM_FLAG_SHAPES.length]);
      svg.appendChild(use);
      return svg;
    }
    var tile = document.createElement('div');
    tile.className = cls + ' crest-tile';
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = teamEmojiOf(id);
    return tile;
  }

  // The breakdown in words, as on every phone ("2 gold · 1 silver · 1 bronze", then
  // "verse 4 · cleanup 3 · quick 2"): a medal disc means a place won, never a count
  // (redesign §8.4). Every number came through normalizeRevealPub, so these are
  // plain integers.
  function signed(n) { return n < 0 ? '−' + (-n) : String(n); }
  function medalWords(e) { return e.g + ' gold · ' + e.s + ' silver · ' + e.b + ' bronze'; }
  function extraWords(e) {
    if (!e.v && !e.m && !e.c) return '';
    return 'verse ' + signed(e.v) + ' · cleanup ' + signed(e.m) + ' · quick ' + signed(e.c);
  }

  // ── Elements ───────────────────────────────────────────────────
  var waitingEl = $('waiting');
  var screenEl = $('screen');
  var introEl = $('intro');
  var heroWrap = $('hero-wrap');
  var boardEl = $('board');
  var finaleEl = $('finale');
  var practiceTag = $('tv-practice');
  var reconnectChip = $('tv-reconnect');
  var updateChip = $('update-chip');
  var waitStatus = $('wait-status');
  var waitStatusText = $('wait-status-text');
  var waitFeed = $('wait-feed');

  // ── Confetti (hand-rolled emoji cannons — no external lib) ─────
  var cvs = $('confetti');
  var ctx = cvs.getContext('2d');
  var parts = [];
  var streamEmojis = null; // active light stream while a hero is shown
  var lastStream = 0;
  var ticking = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    cvs.width = Math.floor(innerWidth * dpr);
    cvs.height = Math.floor(innerHeight * dpr);
    cvs.style.width = innerWidth + 'px';
    cvs.style.height = innerHeight + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  function launch(emoji, x, y, vx, vy, size) {
    parts.push({ e: emoji, x: x, y: y, vx: vx, vy: vy, size: size,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3 });
    kick();
  }
  // The animation loop runs only while something is in the air (a TV that waits
  // for hours should not redraw a full-screen canvas sixty times a second).
  function kick() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(tick);
  }
  // Impact burst at mid-stage for the tie fight — 💥 and sparks radiating
  // from where the two shields collide.
  function clashBurst() {
    if (reduceMotion()) return;
    var W = cvs.width, H = cvs.height;
    var mix = ['💥', '⚔️', '✨'];
    for (var i = 0; i < 14; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (4 + Math.random() * 7) * dpr;
      launch(mix[i % mix.length], W / 2, H * 0.42, Math.cos(a) * sp, Math.sin(a) * sp - 4 * dpr, (30 + Math.random() * 40) * dpr);
    }
  }
  // Visible corner cannons (the 🎉 the bursts fire out of).
  var cannonEls = [$('cannon-l'), $('cannon-r')];
  var cannonHideTimer = null;
  // Pops the cannons in (if hidden), kicks their recoil, and schedules them to slip
  // away after the last shot. Returns the delay the caller should wait before
  // launching particles: when the cannons had to pop in first, the shot holds
  // ~230ms so "appear joyfully, THEN fire" reads in the right order.
  function showCornerCannons() {
    var wasHidden = !cannonEls[0].classList.contains('show');
    cannonEls.forEach(function (el) {
      el.classList.add('show');
      el.classList.remove('fire-anim');
      void el.offsetWidth; // restart the recoil animation
      if (!wasHidden) el.classList.add('fire-anim');
    });
    if (wasHidden) {
      setTimeout(function () {
        cannonEls.forEach(function (el) { el.classList.add('fire-anim'); });
      }, 230);
    }
    clearTimeout(cannonHideTimer);
    cannonHideTimer = setTimeout(function () {
      cannonEls.forEach(function (el) { el.classList.remove('show', 'fire-anim'); });
    }, 1500);
    return wasHidden ? 230 : 0;
  }
  // Fire from both bottom corners toward the upper-middle. Real bursts (count > 1)
  // summon the visible corner cannons; the per-220ms hero stream (count 1) stays
  // cannon-less so they remain a moment, not permanent furniture.
  function cannon(emojis, count, power) {
    if (!emojis || !emojis.length || reduceMotion()) return;
    var delay = count > 1 ? showCornerCannons() : 0;
    var fire = function () {
      var W = cvs.width, H = cvs.height;
      for (var side = 0; side < 2; side++) {
        var baseX = side === 0 ? W * 0.04 : W * 0.96;
        for (var i = 0; i < count; i++) {
          var e = emojis[i % emojis.length];
          var toCenter = side === 0 ? 1 : -1;
          var vx = toCenter * (0.6 + Math.random() * 0.9) * power;
          var vy = -(1.4 + Math.random() * 0.9) * power;
          var size = (34 + Math.random() * 44) * dpr;
          launch(e, baseX, H * 0.99, vx, vy, size);
        }
      }
    };
    if (delay) setTimeout(fire, delay); else fire();
  }
  function tick() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    var g = 0.16 * dpr;
    // light continuous stream while a hero is up
    if (streamEmojis) {
      var now = performance.now();
      if (now - lastStream > 220) { lastStream = now; cannon(streamEmojis, 1, 9 * dpr); }
    }
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > cvs.height + 80 * dpr || p.x < -120 * dpr || p.x > cvs.width + 120 * dpr) {
        parts.splice(i, 1); continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.font = p.size + 'px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.e, 0, 0);
      ctx.restore();
    }
    if (parts.length || streamEmojis) requestAnimationFrame(tick);
    else { ticking = false; ctx.clearRect(0, 0, cvs.width, cvs.height); }
  }

  // ── The feed: one public path, read-only ───────────────────────
  var nodes = { real: null, practice: null }; // the last snapshot's two children, raw { ctl, pub }
  var offsetKnown = false, serverOffset = 0;
  var gotSnapshot = false;      // the listener has answered at least once
  var feedDenied = false;       // the listener was refused (rules not published, or the read was switched off)
  var sdkFailed = false;        // the Firebase SDK never loaded, or would not start
  var connected = false, everConnected = false, gaveUpConnecting = false;
  var deliberatelyOffline = false; // we let go of the connection ourselves (hidden for a minute)
  var sdkReady = false;
  var feedRetryTimer = null;

  // The server's clock, or NaN until `.info/serverTimeOffset` has answered (tvFrame
  // reads NaN as "no clock": it waits).
  function serverNow() { return offsetKnown ? Date.now() + serverOffset : NaN; }

  // Which reveal is on the screen: a live real reveal always wins; a live practice
  // plays (tagged) only when there is none. null = waiting. A reveal that ended,
  // idled out, expired or is too new for this build is "waiting" inside tvFrame.
  function pick() {
    if (feedDenied) return null;
    var modes = ['real', 'practice'];
    for (var i = 0; i < modes.length; i++) {
      var n = nodes[modes[i]];
      if (!n) continue;
      var f = tvFrame(n.ctl, n.pub, serverNow);
      if (f.mode === 'waiting') continue;
      // A frame with nothing to draw (a half-written command: the board of a reveal that has published
      // no place) is not a frame. Fail closed to Waiting rather than leave a blank stage up.
      if (f.mode === 'board' && !f.groups.length) continue;
      var c = normalizeRevealCtl(n.ctl);
      if (!c) continue;
      return { mode: modes[i], frame: f, id: c.id, seq: c.seq };
    }
    return null;
  }

  // When something changes with time alone: a place's name → score → breakdown →
  // dock beats, an unended reveal timing out, `until`. One timer for the soonest,
  // re-armed after every paint; a quiet 30 s tick and the page coming back to the
  // front are the backstops, so a missed timer costs seconds, never correctness.
  function nextBoundary(now) {
    var best = null;
    function take(t) { if (typeof t === 'number' && t > now && (best === null || t < best)) best = t; }
    ['real', 'practice'].forEach(function (m) {
      var n = nodes[m];
      var c = n && normalizeRevealCtl(n.ctl);
      if (!c) return;
      take(c.until);
      take(c.at + REVEAL_BEAT_SCORE_MS);
      take(c.at + REVEAL_BEAT_BREAKDOWN_MS);
      take(c.at + REVEAL_BEAT_DOCK_MS);
      if (c.phase !== 'ended') take(c.at + (c.phase === 'champion' || c.phase === 'table' ? REVEAL_AUTO_END_SHORT_MS : REVEAL_AUTO_END_LONG_MS) + 1);
    });
    return best;
  }
  var boundaryTimer = null;
  function armTimer() {
    if (boundaryTimer) { clearTimeout(boundaryTimer); boundaryTimer = null; }
    var now = serverNow();
    if (!isFinite(now)) return;
    var t = nextBoundary(now);
    if (t === null) return;
    // a little past the moment (never early: an early fire would only re-arm); capped, because a
    // timer longer than 2^31 ms fires at once — a long wait is simply re-armed by the next tick
    boundaryTimer = setTimeout(function () { boundaryTimer = null; render('timer'); }, Math.min(Math.max(t - now + 25, 25), 2147000000));
  }

  function onFeed(snap) {
    var v = snap && snap.val ? snap.val() : null;
    var ok = v && typeof v === 'object';
    nodes.real = ok && v.real && typeof v.real === 'object' ? v.real : null;
    nodes.practice = ok && v.practice && typeof v.practice === 'object' ? v.practice : null;
    gotSnapshot = true;
    feedDenied = false;
    render('data');
  }
  // A refused read is terminal in the SDK (it will not re-arm a cancelled listener), so the
  // page fails closed (nothing shown, the small "Can't reach" line) and attaches again later:
  // the rules get published, or the read is switched back on, and the screen comes back by itself.
  function onFeedRefused() {
    feedDenied = true;
    nodes.real = null; nodes.practice = null;
    render('denied');
    if (feedRetryTimer) clearTimeout(feedRetryTimer);
    feedRetryTimer = setTimeout(function () { feedRetryTimer = null; attachFeed(); }, FEED_RETRY_MS);
  }
  var feedRef = null;
  function attachFeed() {
    try {
      if (feedRef) { try { feedRef.off('value'); } catch (e) { /* ignore */ } }
      feedRef = firebase.database().ref(dbPath('revealPublic'));
      feedRef.on('value', onFeed, onFeedRefused);
    } catch (e) { onFeedRefused(); }
  }

  function startFeed() {
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.databaseURL || typeof firebase === 'undefined' || !firebase.database) { failSdk(); return; }
    try { if (!firebase.apps.length) firebase.initializeApp(cfg); } catch (e) { failSdk(); return; }
    sdkReady = true;
    var db = firebase.database();
    db.ref('.info/serverTimeOffset').on('value', function (s) {
      var off = Number(s && s.val ? s.val() : NaN);
      if (!isFinite(off)) return;
      serverOffset = off;
      offsetKnown = true;
      render('clock');
    });
    db.ref('.info/connected').on('value', function (s) {
      connected = !!(s && s.val && s.val() === true);
      if (connected) { everConnected = true; deliberatelyOffline = false; }
      render('connection');
    });
    attachFeed();
    setTimeout(function () { if (!everConnected) { gaveUpConnecting = true; render('connection'); } }, GIVE_UP_CONNECT_MS);
  }
  // No SDK (gstatic blocked, offline at load): the page still says what it is, and says it can't reach
  // the feed; the update poll reloads it once the network is demonstrably back.
  function failSdk() { sdkFailed = true; render('sdk'); }

  // ── Paint: the status line, the chip, the waiting screen ───────
  function connectionTone() {
    if (sdkFailed || feedDenied) return 'offline';
    // Connected is only said once the screen really is ready: the socket is up, the server's clock is known and
    // the feed has answered (a reveal already under way would otherwise flash "Waiting" under "Connected").
    if (connected) return gotSnapshot && offsetKnown ? 'ok' : 'connecting';
    if (deliberatelyOffline) return 'connecting'; // we let go of it ourselves; taking it up again
    return everConnected || gaveUpConnecting ? 'offline' : 'connecting';
  }
  var TONE_TEXT = { connecting: 'Connecting…', ok: 'Connected · this screen is ready', offline: 'Reconnecting…' };

  var painted = null; // what the stage shows: { sig, id, mode, kind, heroKey } — null while waiting

  function paintStatus() {
    var tone = connectionTone();
    if (waitStatus && waitStatus.getAttribute('data-tone') !== tone) waitStatus.setAttribute('data-tone', tone);
    setText(waitStatusText, TONE_TEXT[tone]);
    setHidden(waitFeed, !(sdkFailed || feedDenied));
    // On a reveal's frames the status line is not on screen: a chip carries the news instead.
    setHidden(reconnectChip, !(painted && tone === 'offline'));
  }

  function showWaiting() {
    if (painted) {
      painted = null;
      resetStage();
      // A newer page shipped mid-reveal: the reveal is over now, so this is the moment (nobody loses a place).
      if (updateSeen) { reloadNow(); return; }
    }
    setHidden(screenEl, true);
    setHidden(waitingEl, false);
    setHidden(practiceTag, true);
  }

  // ── The stage ──────────────────────────────────────────────────
  var introBuilt = false, introBlastIv = null, introBlastTimer = null;
  var dockTimer = null, introHideTimer = null, finaleIv = null;
  var heroTimers = [];
  var boardHtml = null;

  function clearHeroTimers() { heroTimers.forEach(clearTimeout); heroTimers = []; }
  function stopIntroBlast() {
    if (introBlastIv) { clearInterval(introBlastIv); introBlastIv = null; }
    if (introBlastTimer) { clearTimeout(introBlastTimer); introBlastTimer = null; }
  }
  function stopFinale() {
    if (finaleIv) { clearInterval(finaleIv); finaleIv = null; }
    finaleEl.classList.remove('show');
  }
  // Everything on the stage back to nothing: another reveal (a real Start over a practice, a new Start)
  // or the page returning to Waiting. The next paint builds from scratch.
  function resetStage() {
    clearHeroTimers();
    stopIntroBlast();
    stopFinale();
    if (dockTimer) { clearTimeout(dockTimer); dockTimer = null; }
    if (introHideTimer) { clearTimeout(introHideTimer); introHideTimer = null; }
    streamEmojis = null;
    heroWrap.innerHTML = '';
    boardEl.innerHTML = '';
    boardHtml = null;
    boardEl.className = '';
    introBuilt = false;
  }

  function buildIntro() {
    var words = ['CURRENT', 'STANDINGS'];
    var i = 0;
    // Wrap each word so it never splits mid-word when the line wraps;
    // letters still drop in one by one.
    $('intro-title').innerHTML = words.map(function (word) {
      var letters = word.split('').map(function (ch) {
        return '<span style="animation-delay:' + (0.15 + (i++) * 0.045).toFixed(2) + 's">' + esc(ch) + '</span>';
      }).join('');
      return '<span class="word">' + letters + '</span>';
    }).join(' ');
    // One mark per REAL team (a camp may have four or six), in the camp's fixed order — never
    // standings order, which the room does not know yet.
    var sh = $('intro-shields');
    sh.innerHTML = '';
    campTeamIds().forEach(function (id, n) {
      var node = teamMark(id, 'intro-crest');
      node.style.animationDelay = (0.5 + n * 0.12).toFixed(2) + 's, ' + (1.2 + n * 0.2).toFixed(2) + 's';
      sh.appendChild(node);
    });
  }

  // Intro: an opening emoji burst, then a fresh blast every 10 s for as long as the intro is up.
  function startIntroBlast() {
    stopIntroBlast();
    var mix = campTeamIds().map(teamEmojiOf);
    introBlastTimer = setTimeout(function () { introBlastTimer = null; cannon(mix, 6, 11 * dpr); }, 700);
    introBlastIv = setInterval(function () { cannon(mix, 6, 11 * dpr); }, 10000);
  }

  function setIntroShown(on, fade) {
    if (introHideTimer) { clearTimeout(introHideTimer); introHideTimer = null; }
    if (on) { introEl.classList.remove('hide'); introEl.style.display = ''; return; }
    if (fade && introEl.style.display !== 'none') {
      introEl.classList.add('hide');
      introHideTimer = setTimeout(function () { introHideTimer = null; introEl.style.display = 'none'; }, 520);
    } else {
      introEl.style.display = 'none';
    }
  }

  // The five stage layouts, applied whole so a screen can jump to any of them (a late join, a Back, a
  // replaced reveal) from any other.
  function layout(kind, o) {
    setIntroShown(kind === 'intro', o.fadeIntro);
    heroWrap.style.display = kind === 'hero' || kind === 'board' ? '' : 'none';
    boardEl.style.display = kind === 'intro' || kind === 'champion' ? 'none' : '';
    ['dropped', 'final', 'still'].forEach(function (c) { boardEl.classList.remove(c); });
    if (kind === 'hero') boardEl.classList.add('dropped');
    if (kind === 'table') boardEl.classList.add('final');
    if (o.still) boardEl.classList.add('still');
    if (kind !== 'champion') stopFinale();
    if (kind !== 'intro') stopIntroBlast();
    if (kind !== 'hero') { streamEmojis = null; if (kind !== 'board') { clearHeroTimers(); heroWrap.innerHTML = ''; } }
  }

  // Board holds the docked places; the best on top, and a tie keeps reveal-core's order inside it.
  function paintBoard(groups, docked) {
    var rows = [];
    groups.filter(function (g) { return g.idx < docked; }).sort(function (a, b) { return b.idx - a.idx; }).forEach(function (g) {
      g.entries.forEach(function (e) {
        var pcls = g.place <= 3 ? ' p' + g.place : '';
        rows.push(
          '<div class="row' + pcls + '">' +
            '<div class="rank">' + esc(ordinal(g.place)) + '</div>' +
            '<div class="who"><span class="em">' + esc(teamEmojiOf(e.id)) + '</span><span class="nm">' + esc(e.nm) + '</span></div>' +
            '<div class="score"><span class="pts">' + esc(String(e.p)) + '<small>pts</small></span>' +
              '<span class="med">' + esc(medalWords(e)) + '</span></div>' +
          '</div>'
        );
      });
    });
    var html = rows.join('');
    if (html !== boardHtml) { boardHtml = html; boardEl.innerHTML = html; }
  }

  // The beat inside one place's moment: the name alone, then the place and score, then the breakdown.
  function setBeat(hero, beat) {
    if (beat === 'name') hero.classList.add('solo'); else hero.classList.remove('solo');
    if (beat === 'breakdown') hero.classList.add('beat2'); else hero.classList.remove('beat2');
    if (beat !== 'name') hero.classList.remove('fight');
  }

  // One place on the big screen. `f.fresh` is true only inside the place's first 3 s: the one time a
  // screen that just joined still gets the confetti (a late joiner sees the frame as it stands).
  function buildHero(g, f, animate) {
    clearHeroTimers();
    var tie = g.entries.length > 1;
    // Built from DOM nodes: the mark is created, not concatenated, and every string that came from the
    // database is esc()'d (names) or already laundered (emoji) before it lands in a markup fragment.
    var hero = box('hero');
    hero.appendChild(box('hero-place', esc(ordinal(g.place)) + (tie ? '<span class="tie">TIE</span>' : '')));
    var entriesEl = box('hero-entries');
    g.entries.forEach(function (e) {
      var entry = box('hero-entry');
      entry.appendChild(teamMark(e.id, 'hero-shield'));
      var extra = extraWords(e);
      entry.appendChild(box('hero-info',
        '<div class="hero-name"><span class="hero-emoji">' + esc(teamEmojiOf(e.id)) + '</span> ' + esc(e.nm) + '</div>' +
        '<div class="hero-stats">' +
          '<div class="hero-points"><span class="num">' + esc(String(e.p)) + '</span><span class="lbl">points</span></div>' +
          '<div class="hero-break"><div class="words">' + esc(medalWords(e)) + '</div>' +
          (extra ? '<div class="words">' + esc(extra) + '</div>' : '') + '</div>' +
        '</div>'));
      entriesEl.appendChild(entry);
    });
    hero.appendChild(entriesEl);
    heroWrap.innerHTML = '';
    heroWrap.appendChild(hero);
    if (animate) hero.classList.add('enter');
    // Ties get the compact side-by-side layout (see .hero.tied CSS).
    if (tie) hero.classList.add('tied');
    setBeat(hero, f.beat);
    // Two-way tie: the shields FIGHT for the spot during the name beat — two charge-and-clash cycles
    // with a 💥 burst at each contact (52% of each 1.5 s cycle). Not for 3-way ties (no clean
    // head-to-head geometry), a late joiner, or reduced motion.
    if (tie && g.entries.length === 2 && f.fresh && f.beat === 'name' && !reduceMotion()) {
      hero.classList.add('fight');
      [780, 2280].forEach(function (t) {
        var wait = t - f.elapsed;
        if (wait <= 0) return;
        heroTimers.push(setTimeout(function () {
          if (hero.isConnected && hero.classList.contains('fight')) clashBurst();
        }, wait));
      });
    }
    if (f.fresh) {
      // confetti: fire the team mascot(s), then keep a light stream while the place is up.
      var emojis = g.entries.map(function (e) { return teamEmojiOf(e.id); });
      cannon(emojis, 8, 11 * dpr);
      streamEmojis = reduceMotion() ? null : emojis;
      kick();
    } else {
      streamEmojis = null;
    }
    return hero;
  }

  // The place leaves the spotlight and shrinks into the board.
  function dockHero(animate) {
    var hero = heroWrap.querySelector('.hero');
    clearHeroTimers();
    streamEmojis = null;
    if (hero && animate) {
      hero.classList.add('dock');
      if (dockTimer) clearTimeout(dockTimer);
      dockTimer = setTimeout(function () {
        dockTimer = null;
        if (heroWrap.querySelector('.hero') === hero) heroWrap.innerHTML = '';
      }, DOCK_MS);
    } else {
      heroWrap.innerHTML = '';
    }
  }

  // The champions' celebration (a finale day): a full-screen crowning, a sustained barrage while it is fresh.
  function paintChampion(g, animate) {
    var names = g.entries.map(function (e) { return esc(e.nm); }).join(' &amp; ');
    var emojis = g.entries.map(function (e) { return teamEmojiOf(e.id); });
    var pts = g.entries[0].p;
    var champ = $('champ');
    champ.innerHTML = '<div class="crown">👑</div><div class="lead">Camp Champions</div>';
    var crests = box('champ-shields');
    g.entries.forEach(function (e) { crests.appendChild(teamMark(e.id, 'champ-crest')); });
    champ.appendChild(crests);
    champ.insertAdjacentHTML('beforeend',
      '<div class="name">' + emojis.map(esc).join(' ') + ' ' + names + '</div>' +
      '<div class="pts">' + esc(String(pts)) + ' points</div>');
    finaleEl.classList.add('show');
    if (finaleIv) { clearInterval(finaleIv); finaleIv = null; }
    if (animate && !reduceMotion()) {
      var bursts = 0;
      cannon(emojis, 10, 12 * dpr);
      finaleIv = setInterval(function () {
        cannon(emojis, 10, 12 * dpr);
        if (++bursts > 24) { clearInterval(finaleIv); finaleIv = null; }
      }, 350);
    }
  }

  function groupsSig(groups) {
    return groups.map(function (g) {
      return g.idx + ':' + g.place + ':' + g.entries.map(function (e) {
        return [e.id, e.nm, e.p, e.g, e.s, e.b, e.v, e.m, e.c].join(',');
      }).join(';');
    }).join('/');
  }

  function paintStage(sel) {
    var f = sel.frame;
    var sig = [sel.mode, sel.id, sel.seq, f.mode, f.heroIdx, f.beat, f.docked, groupsSig(f.groups)].join('|');
    if (painted && painted.sig === sig) return;
    var prev = painted;
    var sameReveal = !!prev && prev.id === sel.id && prev.mode === sel.mode;
    // A page that was already showing a reveal has watched this change happen, so it plays it; one that just
    // joined (a reload, a late open) shows the frame as it stands, and only a place still inside its first
    // 3 s gets its moment.
    var animate = !!prev || f.fresh;
    if (!sameReveal) resetStage();
    setHidden(waitingEl, true);
    setHidden(screenEl, false);
    setHidden(practiceTag, sel.mode !== 'practice');
    var kind = f.mode, heroKey = null;
    var g;
    if (kind === 'hero') {
      g = f.groups.filter(function (x) { return x.idx === f.heroIdx; })[0];
      if (!g) kind = 'board'; // tvFrame promises it exists; never a blank stage if it does not
    } else if (kind === 'champion') {
      g = f.groups.filter(function (x) { return x.place === 1; })[0];
      if (!g) kind = 'board';
    }
    var wasKind = sameReveal ? prev.kind : null;
    layout(kind, { fadeIntro: animate && wasKind === 'intro', still: !animate && (kind === 'board' || kind === 'table') });
    if (kind === 'intro') {
      if (!introBuilt) { buildIntro(); introBuilt = true; startIntroBlast(); }
    } else if (kind === 'hero') {
      heroKey = sel.id + ':' + sel.seq + ':' + f.heroIdx;
      paintBoard(f.groups, f.docked);
      var hero = heroWrap.querySelector('.hero');
      if (hero && sameReveal && prev.heroKey === heroKey) setBeat(hero, f.beat);
      else buildHero(g, f, animate);
    } else if (kind === 'board') {
      dockHero(animate && wasKind === 'hero');
      paintBoard(f.groups, f.docked);
    } else if (kind === 'table') {
      paintBoard(f.groups, f.docked);
    } else if (kind === 'champion') {
      paintBoard(f.groups, f.docked); // behind the crowning, ready for Back / the final table
      paintChampion(g, animate && wasKind !== 'champion');
    }
    painted = { sig: sig, id: sel.id, mode: sel.mode, kind: kind, heroKey: heroKey };
  }

  function render(why) {
    try {
      var sel = pick();
      if (!sel) showWaiting(); else paintStage(sel);
      paintStatus();
    } catch (e) {
      // A drawing bug must never leave a wrong frame up: fail closed to Waiting.
      try { console.error('current-standings render (' + why + ')', e); } catch (e2) { /* ignore */ }
      try { painted = null; resetStage(); setHidden(screenEl, true); setHidden(waitingEl, false); setHidden(practiceTag, true); } catch (e3) { /* ignore */ }
    }
    armTimer();
  }

  // ── Holds its connection only while visible ────────────────────
  // Spark allows 100 connections at once across both camps, every phone and every TV page, and a public page
  // makes it easy for a few curious people to open one. A TV never hides; a phone in a pocket does: a minute
  // hidden lets go of the connection, coming back takes it up again (and the page repaints from the node).
  var hiddenTimer = null;
  function goOffline() {
    if (!sdkReady || deliberatelyOffline) return;
    try { firebase.database().goOffline(); deliberatelyOffline = true; render('offline'); } catch (e) { /* ignore */ }
  }
  function goOnline() {
    if (!sdkReady || !deliberatelyOffline) return;
    try { firebase.database().goOnline(); } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(function () { hiddenTimer = null; goOffline(); }, HIDDEN_OFFLINE_MS);
    } else {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      goOnline();
      render('visible');
      checkForUpdate();
    }
  });

  // ── Self-update check ──────────────────────────────────────────
  // No fetch/service-worker interception, same network-only pattern the main scoreboard uses (see app.js
  // checkForUpdate): a code fix is invisible to an already-open tab otherwise. A TV with nothing on the stage
  // reloads at once; mid-reveal a small chip appears instead (a reload would drop the frame), and the page
  // reloads itself the moment the reveal is over.
  var updateSeen = false;
  function checkForUpdate() {
    fetch('current-standings.html?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (html) {
        if (!html) return;
        // The stamp as the page itself publishes it (see the top of this file).
        var m = html.match(/<meta\s+name="tv-build"\s+content="([^"]*)"/) || html.match(/var TV_BUILD = '([^']+)'/);
        if (m && myBuild && m[1] !== myBuild) {
          updateSeen = true;
          if (!painted) { reloadNow(); return; }
          setHidden(updateChip, false);
        } else if (sdkFailed && sdkReloads() < SDK_RELOAD_MAX) {
          // The page loaded without its SDK and the network answers now: try once more (a few times at most,
          // so a firewall that blocks the SDK for good cannot make a TV flash forever).
          noteSdkReload();
          reloadNow();
        }
      })
      .catch(function () { /* offline / blocked — try again next tick */ });
  }
  function sdkReloads() { try { return Number(sessionStorage.getItem('campTvSdkReloads')) || 0; } catch (e) { return 0; } }
  function noteSdkReload() { try { sessionStorage.setItem('campTvSdkReloads', String(sdkReloads() + 1)); } catch (e) { /* ignore */ } }
  function reloadNow() {
    var u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    location.replace(u.toString());
  }
  if (updateChip) updateChip.addEventListener('click', reloadNow);
  setInterval(checkForUpdate, 90000);
  setInterval(function () { render('tick'); }, TICK_MS);
  checkForUpdate();

  // ── Go ─────────────────────────────────────────────────────────
  // The tab and the page say which camp this is (two camps, one page).
  document.title = 'Current Standings — ' + CAMP.label;
  setText($('wait-camp'), CAMP.label + ' · Standings');
  var waitShields = $('wait-shields');
  campTeamIds().forEach(function (id) { waitShields.appendChild(teamMark(id, 'wait-crest')); });
  startFeed();
  render('start');
})();
