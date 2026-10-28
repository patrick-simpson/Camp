// ── current-standings.js — the TV page's script ────────────────────────
// The big-screen reveal for both camps. It used to be one inline <script> in
// current-standings.html; it is a file now because the page carries a CSP that
// refuses inline script. Load order (see the page): firebase-config.js,
// defaults.js, camp-core.js, reveal-core.js, tv-camp.js, camps.js, then this. It reads the
// camp profile (`CAMP`, `dbPath`, `lsKey`) and the shared helpers (the
// double-points window, `liveGameIdSet`, the sanitizers) as globals from those
// files, and keeps everything of its own inside this one IIFE.
(function () {
  'use strict';

  // The page is typically opened once and left up on a TV for the whole reveal,
  // so it polls itself for a newer build (checkForUpdate below). The build stamp
  // lives in the HTML, not here: <meta name="tv-build"> is what this page reads,
  // and the very same stamp sits in an HTML comment as `var TV_BUILD = '…'` for
  // pages from before this script moved out of the HTML, which read that text to
  // decide to reload. Bump BOTH on every edit to the page (CLAUDE.md, deploy step 2).
  var buildMeta = document.querySelector('meta[name="tv-build"]');
  var myBuild = (buildMeta && buildMeta.getAttribute('content')) || '';

  // ── Shared with the app, not copied ────────────────────────────
  // The camp (teams, emoji, crests, database root, storage namespace) comes from
  // camps.js's CAMP — tv-camp.js picked it from ?camp= before camps.js ran — and
  // the double-points window, the orphan filter and every sanitizer from
  // camp-core.js. Only the medal values are still mirrored from app.js.
  var MEDAL_POINTS = { gold: 7, silver: 5, bronze: 3 }; // mirrors app.js MEDAL_POINTS — keep in sync
  // Verse recitals and custom bonuses count double inside the week's window
  // (meal cleanup exempt). This week is the legacy one; a new-year week will
  // resolve its own window through doubleWindowFor.
  function bonusCountsDouble(b) { return bonusIsDouble(b, DOUBLE_WINDOW_LEGACY); }
  // Games count double by their own `messtival` flag, read from the live week
  // config — the same source the scoreboard uses (a hardcoded list can't know
  // about games added in the week builder; that is how lauras-drinking-game was
  // paid single here while the app doubled it, 2026-07-23). Until a config
  // arrives the camp's built-in catalog stands in, and nothing is filtered.
  var liveConfig = null;
  var builtInDoubled = null;
  function doubledGameIds() {
    if (liveConfig && liveConfig.games) {
      var arr = Array.isArray(liveConfig.games)
        ? liveConfig.games
        : Object.keys(liveConfig.games).sort().map(function (k) { return liveConfig.games[k]; });
      var ids = [];
      arr.forEach(function (g) { if (g && g.messtival && g.id) ids.push(g.id); });
      return ids;
    }
    if (!builtInDoubled) {
      builtInDoubled = [];
      try {
        CAMP.defaultConfig().games.forEach(function (g) { if (g && g.messtival && g.id) builtInDoubled.push(g.id); });
      } catch (e) { /* no built-in catalog: nothing doubles until the live config lands */ }
    }
    return builtInDoubled;
  }

  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo');
  var FORCE_FINALE = params.has('finale');

  // ── Helpers ────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function isFridayEastern() {
    if (FORCE_FINALE) return true;
    try {
      var wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(new Date());
      return wd === 'Fri';
    } catch (e) { return new Date().getDay() === 5; }
  }
  // A team slot's own mascot (camps.js), used when its record carries none.
  function defaultEmoji(id) { return (CAMP.teamEmoji && CAMP.teamEmoji[id]) || '🏕️'; }

  // Coerce a synced teams value (array, or RTDB object) into an array of
  // {id, name, emoji}. RTDB can prune/normalize; fall back to the camp's default roster.
  function normalizeTeams(raw) {
    var arr = [];
    if (Array.isArray(raw)) arr = raw.slice();
    else if (raw && typeof raw === 'object') arr = Object.keys(raw).sort().map(function (k) { return raw[k]; });
    arr = arr.filter(Boolean);
    if (!arr.length) {
      arr = CAMP.defaultTeamNames.map(function (name, i) { return { id: 't' + i, name: name }; });
    }
    return arr.map(function (t, i) {
      var id = String(t.id || ('t' + i));
      return {
        id: id,
        name: String(t.name || CAMP.defaultTeamNames[i] || ('Team ' + (i + 1))),
        // Anything a team record says about its emoji is laundered here, once, so
        // every screen of the reveal can use it without a second thought.
        emoji: safeEmoji(t.emoji, defaultEmoji(id))
      };
    });
  }

  // Replicates app.js medalCounts + bonusBreakdown + rankTeamsByPoints (until the
  // public big screen replaces this page, it only ever shows what the app would).
  function computeStandings(state) {
    if (!directorStandings) return []; // secrecy: a counselor's page computes no points
    state = state || {};
    var teams = normalizeTeams(state.teams);
    var results = state.results || {};
    var bonuses = state.bonuses || {};
    var counts = {};
    teams.forEach(function (t) {
      counts[t.id] = { gold: 0, silver: 0, bronze: 0, medalPts: 0, verse: 0, meals: 0, custom: 0, bonus: 0, points: 0 };
    });
    var doubled = doubledGameIds();
    // A result whose game is no longer in the week (an import or restore can
    // leave one behind) has no game to clear it from; the app skips it, so
    // must this. null = no config yet: count everything.
    var live = liveGameIdSet(liveConfig);
    Object.keys(results).forEach(function (id) {
      var r = results[id];
      if (!r || !r.medals) return;
      if (live && !live.has(id)) return;
      var mult = doubled.indexOf(id) >= 0 ? 2 : 1;
      var m = r.medals;
      if (counts[m.gold]) { counts[m.gold].gold += 1; counts[m.gold].medalPts += MEDAL_POINTS.gold * mult; }
      if (counts[m.silver]) { counts[m.silver].silver += 1; counts[m.silver].medalPts += MEDAL_POINTS.silver * mult; }
      if (counts[m.bronze]) { counts[m.bronze].bronze += 1; counts[m.bronze].medalPts += MEDAL_POINTS.bronze * mult; }
    });
    Object.keys(bonuses).forEach(function (k) {
      var b = bonuses[k];
      if (!b || !counts[b.teamId]) return;
      var p = Number(b.points);
      if (isNaN(p)) return;
      var bucket = b.category === 'verse' ? 'verse' : b.category === 'cleanup' ? 'meals' : 'custom';
      counts[b.teamId][bucket] += p * (bonusCountsDouble(b) ? 2 : 1);
    });
    teams.forEach(function (t) {
      var c = counts[t.id];
      c.bonus = c.verse + c.meals + c.custom;
      c.points = c.medalPts + c.bonus;
    });
    var ranked = teams.slice().sort(function (a, b) {
      var sa = counts[a.id], sb = counts[b.id];
      if (sb.points !== sa.points) return sb.points - sa.points;
      if (sb.gold !== sa.gold) return sb.gold - sa.gold;
      if (sb.silver !== sa.silver) return sb.silver - sa.silver;
      return sb.bronze - sa.bronze;
    });
    return ranked.map(function (t) { return { team: t, stats: counts[t.id] }; });
  }

  // Places come from reveal-core.js, loaded before this page: the one rule the
  // phone, the remote and this screen share. Equal points share a place, and a tie
  // is ordered by golds, then silvers, then bronzes, then name. The rows go in rank
  // order, as computeStandings returns them.
  function placesOf(ranked) {
    var rows = ranked.map(function (r) {
      return { id: r.team.id, nm: r.team.name, p: r.stats.points, g: r.stats.gold, s: r.stats.silver, b: r.stats.bronze, row: r };
    });
    return groupPlaces(rows).map(function (gr) {
      return { place: gr.place, entries: gr.entries.map(function (e) { return e.row; }) };
    });
  }

  // ── Confetti (hand-rolled emoji cannons — no external lib) ──────
  var cvs = document.getElementById('confetti');
  var ctx = cvs.getContext('2d');
  var parts = [];
  var streamEmojis = null; // active light stream while a hero is shown
  var lastStream = 0;
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
  }
  // Impact burst at mid-stage for the tie fight — 💥 and sparks radiating
  // from where the two shields collide.
  function clashBurst() {
    var W = cvs.width, H = cvs.height;
    var mix = ['💥', '⚔️', '✨'];
    for (var i = 0; i < 14; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (4 + Math.random() * 7) * dpr;
      launch(mix[i % mix.length], W / 2, H * 0.42, Math.cos(a) * sp, Math.sin(a) * sp - 4 * dpr, (30 + Math.random() * 40) * dpr);
    }
    sfxBreak();
  }
  // ── Visible corner cannons (the 🎉 the bursts fire out of) ──────
  var cannonEls = [document.getElementById('cannon-l'), document.getElementById('cannon-r')];
  var cannonHideTimer = null;
  // Pops the cannons in (if hidden), kicks their recoil, and schedules
  // them to slip away after the last shot. Returns the delay the caller
  // should wait before actually launching particles: when the cannons had
  // to pop in first, the shot holds ~230ms so "appear joyfully, THEN fire"
  // reads in the right order; if they're already up, fire instantly.
  function showCornerCannons() {
    var wasHidden = !cannonEls[0].classList.contains('show');
    cannonEls.forEach(function (el) {
      el.classList.add('show');
      el.classList.remove('fire-anim');
      void el.offsetWidth; // restart the recoil animation
      if (!wasHidden) el.classList.add('fire-anim');
    });
    if (wasHidden) {
      // Kick only once they're visible, in sync with the delayed shot.
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

  // Fire from both bottom corners toward the upper-middle. Real bursts
  // (count > 1) summon the visible corner cannons; the per-220ms hero
  // stream (count 1) stays cannon-less so they remain a moment, not
  // permanent furniture.
  function cannon(emojis, count, power) {
    if (!emojis || !emojis.length) return;
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
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── Sound — disabled by request; kept as no-ops so calls are harmless. ──
  var audio = null, muted = true;
  function ensureAudio() {
    if (audio || muted) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  function beep(freq, dur, when, type, vol) {
    if (!audio || muted) return;
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    var t = audio.currentTime + (when || 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function sfxReveal() { ensureAudio(); beep(523, 0.14, 0); beep(784, 0.18, 0.09); }
  function sfxBreak() { ensureAudio(); beep(988, 0.16, 0, 'sine', 0.2); }
  function sfxFanfare() {
    ensureAudio();
    [523, 659, 784, 1047].forEach(function (f, i) { beep(f, 0.28, i * 0.13, 'triangle', 0.28); });
  }
  // ── Data loading ───────────────────────────────────────────────
  var liveGroups = null;       // latest live standings (used on intro)
  var haveData = false;

  function demoState() {
    var names = CAMP.defaultTeamNames;
    // Slot i of the printed demo, wrapped onto however many teams this camp has
    // (identity for junior's six).
    function T(i) { return 't' + (i % names.length); }
    return {
      teams: names.map(function (n, i) { return { id: 't' + i, name: n }; }),
      results: {
        'demo-a': { medals: { gold: T(0), silver: T(1), bronze: T(2) } },
        'demo-b': { medals: { gold: T(0), silver: T(2), bronze: T(3) } },
        'demo-c': { medals: { gold: T(4), silver: T(0), bronze: T(1) } },
        'demo-d': { medals: { gold: T(3), silver: T(4), bronze: T(5) } },
        'demo-e': { medals: { gold: T(1), silver: T(5), bronze: T(4) } }
      },
      bonuses: {
        b1: { teamId: T(0), points: 5, category: 'verse' },
        b2: { teamId: T(2), points: 5, category: 'cleanup' },
        b3: { teamId: T(5), points: -3, category: 'custom' }
      }
    };
  }
  function readLocal() {
    // the app's per-camp cache key
    try { var raw = localStorage.getItem(lsKey('campScoreboardV2')); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  // ── Secrecy: live standings are for directors only ─────────────
  // Counselors don't see points, places or gaps until the directors reveal them
  // (redesign §4.12), and this page computes them live from `state`. So until
  // the public reveal page replaces it (Step 23), it answers only a signed-in
  // DIRECTOR with standings, and says "Waiting for the directors…" to a
  // counselor's account. None of that is CSS. It rests on three things:
  //   1. `directorStandings` is set only by the paths that have proven a director
  //      (the demo, a device whose cached role is editor, and an approved editor's
  //      member record). ingest() and computeStandings() compute nothing without it.
  //   2. A counselor's account never attaches the state or config listener, so
  //      nothing is in memory to compute from.
  //   3. The member record is read LIVE. A role change, a removal or a second
  //      account reloads the page (leavePage), so no listener or reveal from the
  //      previous state survives into the new one.
  // A signed-out visitor is asked to sign in, and an account that is not on this
  // camp's list gets the "isn't on the list" panel. Neither reads `state`, and
  // neither shows a number.
  var directorStandings = false; // the one switch that lets standings compute (see above)
  var directorAttached = false;  // attachData ran: this page is reading a director's standings
  var pageLeaving = false;       // a reload is under way: nothing more may paint
  // The per-camp ledger decides for this camp alone: a camp with no entry in it is
  // not a director's here, even when another camp's hint says editor. The single
  // hint is only the fallback for a device that has no ledger at all.
  function cachedRoleIsEditor() {
    try {
      var ledger = JSON.parse(localStorage.getItem('campScoreboardCampsHint') || 'null');
      if (ledger && typeof ledger === 'object') return ledger[CAMP.id] === 'editor';
      return localStorage.getItem('campScoreboardAuthHint') === 'editor';
    } catch (e) { return false; }
  }
  var waitingEl = document.getElementById('waiting');
  function showWaiting() {
    var ov = document.getElementById('auth-overlay');
    if (ov) ov.style.display = 'none';
    loadingEl.style.display = 'none';
    // The reveal screen has its own `hidden` attribute, which the page's CSS
    // overrides unless #screen[hidden] says otherwise. Hiding it here as well means
    // a waiting page shows no intro frame whatever the stylesheet does.
    if (screenEl) screenEl.hidden = true;
    if (waitingEl) waitingEl.hidden = false;
  }
  var lastRawState = null; // last ingested state — recomputed when the config lands
  function ingest(state) {
    if (!directorStandings || pageLeaving) return; // not a director: nothing is computed
    lastRawState = state;
    // The localStorage fallback state embeds the week config; the remote
    // state node doesn't (config is a sibling ref, handled in attachData).
    if (state && state.config && state.config.games) liveConfig = state.config;
    liveGroups = placesOf(computeStandings(state));
    if (!haveData) { haveData = true; onDataReady(); }
  }
  // Reloads the page now, for a change of account or of role. The reload starts
  // clean, and nothing still in flight may paint in the meantime.
  function leavePage() {
    if (pageLeaving) return;
    pageLeaving = true;
    reloadNow();
  }
  // ── Sign-in gate ───────────────────────────────────────────────
  // The database only answers approved, signed-in members (see the rules
  // notes in CLAUDE.md), so this page signs in too: sign in ONCE on the
  // TV/presenter machine with any approved account and it works like
  // before. The old behavior — silently falling back to fake demo data
  // when the database didn't answer — is gone for the non-?demo path; a
  // signed-out TV now says so on screen instead of showing wrong numbers.
  // (Safari note: ~7 days without a visit purges site storage, signing
  // the TV out. The overlay reappearing with a button IS the design.)
  // 'checking' is the one state a healthy TV passes through on EVERY load
  // (and every auto-reload after a TV_BUILD bump): the sign-in is restored
  // and approved within a moment. Painting the near-black overlay for that
  // moment was a white -> black -> white flash before the intro, so while
  // nothing is covering the page 'checking' waits CHECK_OVERLAY_DELAY_MS and
  // only shows if the check is genuinely slow or offline — the page's own
  // "Loading standings…" line covers the wait until then. Any other mode
  // cancels it, so an approval inside the delay never shows the overlay at
  // all; 'signin' and 'denied' stay immediate. If the overlay is already up
  // (a presenter who just tapped Continue with Google), 'checking' is shown
  // straight away as feedback.
  var CHECK_OVERLAY_DELAY_MS = 1500;
  var checkTimer = null;
  function setAuthOverlay(mode, email) {
    var el = document.getElementById('auth-overlay');
    if (!el) return;
    if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
    if (mode === 'checking' && el.style.display === 'none') {
      checkTimer = setTimeout(function () { checkTimer = null; paintAuthOverlay('checking'); }, CHECK_OVERLAY_DELAY_MS);
      return;
    }
    paintAuthOverlay(mode, email);
  }
  function paintAuthOverlay(mode, email) {
    var el = document.getElementById('auth-overlay');
    if (!el) return;
    el.style.display = mode === 'hidden' ? 'none' : 'flex';
    document.getElementById('auth-ov-checking').style.display = mode === 'checking' ? 'block' : 'none';
    document.getElementById('auth-ov-signin').style.display = mode === 'signin' ? 'block' : 'none';
    document.getElementById('auth-ov-denied').style.display = mode === 'denied' ? 'block' : 'none';
    if (email) document.getElementById('auth-ov-email').textContent = email;
  }

  // Attached once a director's approval is confirmed. Nothing else in this file
  // attaches a listener to `state` or `config`.
  function attachData() {
    directorAttached = true;
    directorStandings = true;
    if (waitingEl) waitingEl.hidden = true; // a promoted viewer's Waiting screen gives way
    loadingEl.style.display = '';
    // Week config first (sibling ref): it carries each game's
    // double-points flag, the same source the main scoreboard uses.
    // If it lands (or changes) after the state did, recompute so the
    // totals here can never disagree with the main site's.
    var gotRemote = false;
    firebase.database().ref(dbPath('config')).on('value', function (snap) {
      var remoteCfg = snap.val();
      if (remoteCfg && remoteCfg.games) {
        liveConfig = remoteCfg;
        if (lastRawState) ingest(lastRawState);
      }
    });
    firebase.database().ref(dbPath('state')).on('value', function (snap) {
      var remote = snap.val();
      if (remote) { gotRemote = true; ingest(remote); }
    });
    // Offline resilience for an APPROVED machine only: if the network is
    // down, fall back to this device's cached snapshot (never demo data).
    setTimeout(function () {
      if (!gotRemote && !haveData) {
        var local = readLocal();
        if (local) ingest(local);
      }
    }, 3500);
  }

  // The approval read. Only an editor's record leads to standings. Anything else
  // ends on the Waiting or the denied panel, and a director who loses the role
  // (demoted, removed, or refused) is reloaded into the right panel, so nothing of
  // the old role stays attached.
  function onApproval(rec, email, refused) {
    if (pageLeaving) return;
    var editor = !refused && !!rec && rec.role === 'editor';
    if (directorAttached) {
      if (!editor) leavePage();
      return;
    }
    if (refused || !rec || !rec.role) { setAuthOverlay('denied', email); return; }
    setAuthOverlay('hidden');
    // A counselor's account is approved but may not see the standings: wait.
    if (!editor) { showWaiting(); return; }
    attachData();
  }

  function startData() {
    if (DEMO) { directorStandings = true; ingest(demoState()); return; }
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.databaseURL || typeof firebase === 'undefined' || !firebase.auth) {
      // No Firebase — the best this page can do is the local snapshot, and only
      // on a device that was a director's (see the secrecy note above).
      var local = cachedRoleIsEditor() ? readLocal() : null;
      if (local) { directorStandings = true; ingest(local); } else showWaiting();
      return;
    }
    try { if (!firebase.apps.length) firebase.initializeApp(cfg); } catch (e) { return; }
    setAuthOverlay('checking');
    var btn = document.getElementById('auth-ov-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        // Synchronously in the click handler — an await first and the
        // browser blocks the popup.
        // select_account: always show Google's chooser. A presenter laptop
        // is often already signed into some other (non-camp) Google account,
        // which would otherwise be re-picked silently every time.
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        firebase.auth().signInWithPopup(provider).catch(function (err) {
          var msgEl = document.getElementById('auth-ov-error');
          if (msgEl) msgEl.textContent = 'Sign-in didn\'t work (' + ((err && err.code) || 'error') + ') — try again.';
        });
      });
    }
    // The way out of the denied state: signing out ends this page's account, and
    // the auth change below reloads the page into the sign-in panel.
    var switchBtn = document.getElementById('auth-ov-switch');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        try { firebase.auth().signOut().catch(function () {}); } catch (e) { /* ignore */ }
      });
    }
    // The one account this page runs for, set by the first signed-in account it sees.
    var pageAccount = null;
    firebase.auth().onAuthStateChanged(function (user) {
      // Key = lowercased email, ALL dots → commas: the same contract as app.js's
      // emailKey (keep in sync). The camp's own members list: a director of one camp
      // isn't automatically on the other's.
      var who = user && user.email ? String(user.email).trim().toLowerCase().replaceAll('.', ',') : '';
      // One account per page life. A sign-out, or another account, after this page
      // has been running for an account reloads it, so nothing the old account
      // attached or painted survives into the new one (or the sign-in panel).
      if (pageAccount !== null && who !== pageAccount) { leavePage(); return; }
      if (!user || !user.email) { setAuthOverlay('signin'); return; }
      if (pageAccount !== null) return; // the same account again: its member listener is already on
      pageAccount = who;
      setAuthOverlay('checking');
      // A LIVE read of this account's member record, not a one-shot: a role change
      // or a removal takes effect at once (app.js's self-read works the same way).
      firebase.database().ref(dbPath('members/' + who)).on('value', function (snap) {
        onApproval(snap.val(), user.email, false);
      }, function () {
        onApproval(null, user.email, true);
      });
    });
  }

  // ── UI: intro ──────────────────────────────────────────────────
  var loadingEl = document.getElementById('loading');
  var screenEl = document.getElementById('screen');
  var introEl = document.getElementById('intro');
  var heroWrap = document.getElementById('hero-wrap');
  var boardEl = document.getElementById('board');
  var hintEl = document.getElementById('hint');
  var finaleEl = document.getElementById('finale');

  function buildIntro() {
    var words = ['CURRENT', 'STANDINGS'];
    var i = 0;
    // Wrap each word so it never splits mid-word when the line wraps;
    // letters still drop in one by one.
    introEl.querySelector('#intro-title').innerHTML = words.map(function (word) {
      var letters = word.split('').map(function (ch) {
        return '<span style="animation-delay:' + (0.15 + (i++) * 0.045).toFixed(2) + 's">' + esc(ch) + '</span>';
      }).join('');
      return '<span class="word">' + letters + '</span>';
    }).join(' ');
    // One crest per REAL team (a camp may have four or six), each built as a DOM
    // node so a crest address is only ever assigned to img.src.
    var sh = introEl.querySelector('#intro-shields');
    sh.innerHTML = '';
    currentTeams().forEach(function (t, i) {
      var node = crestNode(t, 'intro-crest');
      node.style.animationDelay = (0.5 + i * 0.12).toFixed(2) + 's, ' + (1.2 + i * 0.2).toFixed(2) + 's';
      sh.appendChild(node);
    });
  }

  // The teams the page is showing right now, in slot order (always at least the
  // camp's default roster).
  function currentTeams() { return normalizeTeams(lastRawState && lastRawState.teams); }

  // A team's crest as a DOM node: its shipped shield when it has one that passes
  // safeCrestSrc, else an emoji tile — never an <img> with no usable source.
  // `cls` is the slot's own class (intro-crest, hero-shield, champ-crest), which
  // carries the size and motion; the tile adds .crest-tile on top.
  function crestNode(team, cls) {
    var src = safeCrestSrc(CAMP.teamCrest && CAMP.teamCrest[team.id]);
    var node;
    if (src) {
      node = document.createElement('img');
      node.className = cls;
      node.alt = '';
      node.src = src; // a DOM property, never concatenated into markup
    } else {
      node = document.createElement('div');
      node.className = cls + ' crest-tile';
      node.setAttribute('aria-hidden', 'true');
      node.textContent = team.emoji;
    }
    return node;
  }
  // A <div> with a class and (optionally) markup that is already escaped.
  function box(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  var introBlastIv = null;
  function onDataReady() {
    loadingEl.style.display = 'none';
    screenEl.hidden = false;
    buildIntro();
    // Celebratory emoji blast on the title screen — an opening burst, then a
    // fresh blast every 10s for as long as the intro is up.
    var mix = currentTeams().map(function (t) { return t.emoji; });
    setTimeout(function () { cannon(mix, 6, 11 * dpr); }, 700);
    if (introBlastIv) clearInterval(introBlastIv);
    introBlastIv = setInterval(function () {
      if (phase !== 'intro') { clearInterval(introBlastIv); introBlastIv = null; return; }
      cannon(mix, 6, 11 * dpr);
    }, 10000);
  }

  var hintTimer = null;
  // On-screen instruction hints removed by request — no-op.
  function showHint() {}

  // ── Reveal state machine ───────────────────────────────────────
  var phase = 'intro';   // 'intro' | 'reveal' | 'done'
  var order = [];        // reveal order: lowest place first (6th → 1st)
  var bigIndex = -1;     // index in `order` currently shown big, or -1
  var dockedCount = 0;   // number of groups already docked into the board
  var autoTimer = null, beatTimer = null, soloTimer = null;

  function medalStr(s) {
    return '🥇 ' + s.gold + '   🥈 ' + s.silver + '   🥉 ' + s.bronze;
  }
  function bonusStr(s) {
    if (!s.bonus) return '';
    var bits = [];
    if (s.verse) bits.push((s.verse > 0 ? '+' : '') + s.verse + ' verse');
    if (s.meals) bits.push((s.meals > 0 ? '+' : '') + s.meals + ' meals');
    if (s.custom) bits.push((s.custom > 0 ? '+' : '') + s.custom + ' bonus');
    return (s.bonus > 0 ? '+' : '') + s.bonus + ' pts' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
  }

  function clearTimers() { clearTimeout(autoTimer); clearTimeout(beatTimer); clearTimeout(soloTimer); }

  function showBig(orderIdx) {
    clearTimers();
    bigIndex = orderIdx;
    var group = order[orderIdx];
    var tie = group.entries.length > 1;
    // Built from DOM nodes: the crest is created, not concatenated, and every
    // string that came from the database is esc()'d (names) or already laundered
    // (emoji) before it lands in the few markup fragments below.
    var hero = box('hero');
    hero.appendChild(box('hero-place', esc(ordinal(group.place)) + (tie ? '<span class="tie">TIE</span>' : '')));
    var entriesEl = box('hero-entries');
    group.entries.forEach(function (en) {
      var s = en.stats;
      var entry = box('hero-entry');
      entry.appendChild(crestNode(en.team, 'hero-shield'));
      entry.appendChild(box('hero-info',
        '  <div class="hero-name"><span class="hero-emoji">' + esc(en.team.emoji) + '</span> ' + esc(en.team.name) + '</div>' +
        '  <div class="hero-stats">' +
        '    <div class="hero-points"><span class="num">' + s.points + '</span><span class="lbl">points</span></div>' +
        '    <div class="hero-break"><div class="medals">' + medalStr(s) + '</div>' +
        (bonusStr(s) ? '<div class="bonus">' + esc(bonusStr(s)) + '</div>' : '') + '</div>' +
        '  </div>'));
      entriesEl.appendChild(entry);
    });
    hero.appendChild(entriesEl);
    heroWrap.innerHTML = '';
    heroWrap.appendChild(hero);
    hero.classList.add('enter');
    // Ties get the compact side-by-side layout (see .hero.tied CSS).
    if (tie) hero.classList.add('tied');
    // First 3s: only the shield + a super-large team name (place/score hidden).
    hero.classList.add('solo');
    // Two-way tie: the shields FIGHT for the spot during the solo
    // spotlight — two charge-and-clash cycles with a 💥 burst at each
    // contact (52% of each 1.5s cycle). Skipped for 3-way ties (no clean
    // head-to-head geometry) and for reduced-motion viewers.
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (tie && group.entries.length === 2 && !reduceMotion) {
      hero.classList.add('fight');
      [780, 2280].forEach(function (t) {
        setTimeout(function () {
          if (hero.isConnected && hero.classList.contains('fight')) clashBurst();
        }, t);
      });
      setTimeout(function () { if (hero.isConnected) hero.classList.remove('fight'); }, 3050);
    }
    // Drop the board off-screen so the team spotlight is the only thing shown.
    boardEl.classList.add('dropped');

    // confetti: fire the team mascot(s), then keep a light stream.
    var emojis = group.entries.map(function (en) { return en.team.emoji; });
    cannon(emojis, 8, 11 * dpr);
    streamEmojis = emojis;
    sfxReveal();

    // At 3s: shrink the name and let the place + score appear.
    soloTimer = setTimeout(function () { hero.classList.remove('solo'); sfxBreak(); }, 3000);
    // A beat later, slide the medal/bonus breakdown in.
    beatTimer = setTimeout(function () { hero.classList.add('beat2'); }, 4500);
    // Hold the solo spotlight for 8s, then shrink the team into the table
    // (presenter can skip with →). If this was the last place, waiting it
    // out rolls into the finale too.
    var wasLast = orderIdx === order.length - 1;
    autoTimer = setTimeout(function () { dockCurrent(); if (wasLast) finish(); }, 8000);

    showHint(orderIdx === 0 ? 'Press → for the next place' : (orderIdx === order.length - 1 ? 'Press → to finish' : 'Press → next  ·  ← back'));
  }

  function dockCurrent() {
    if (bigIndex < 0) return;
    clearTimers();
    streamEmojis = null;
    var hero = heroWrap.querySelector('.hero');
    var idx = bigIndex;
    bigIndex = -1;
    if (hero) {
      hero.classList.add('dock');
      setTimeout(function () {
        if (heroWrap.querySelector('.hero') === hero) heroWrap.innerHTML = '';
      }, 460);
    }
    dockedCount = idx + 1;
    renderBoardRows();
    // Slide the table back up into view (now holding the just-docked team).
    boardEl.classList.remove('dropped');
  }

  // Board holds docked groups; higher place on top (prepend as we go up).
  function renderBoardRows() {
    var rows = [];
    // order[] is lowest-place-first, so walk it from the docked top place down:
    // 1st on top, and a tie keeps its reveal-core order from the top of the tie.
    for (var i = dockedCount - 1; i >= 0; i--) {
      var group = order[i];
      group.entries.forEach(function (en) {
        var s = en.stats, id = en.team.id;
        var pcls = group.place <= 3 ? ' p' + group.place : '';
        rows.push(
          '<div class="row' + pcls + '">' +
            '<div class="rank">' + esc(ordinal(group.place)) + '</div>' +
            '<div class="who"><span class="em">' + esc(en.team.emoji) + '</span><span class="nm">' + esc(en.team.name) + '</span></div>' +
            '<div class="score"><span class="pts">' + s.points + '<small>pts</small></span>' +
              '<span class="med">' + medalStr(s) + '</span></div>' +
          '</div>'
        );
      });
    }
    boardEl.innerHTML = rows.join('');
  }

  function beginReveal() {
    if (phase !== 'intro') return;
    // Nothing to reveal yet (signed out / still loading): stay on the intro.
    // Starting anyway froze order = [] and threw in showBig, leaving a blank
    // stage even after the data arrived.
    if (!liveGroups || !liveGroups.length) return;
    phase = 'reveal';
    if (introBlastIv) { clearInterval(introBlastIv); introBlastIv = null; }
    // Freeze the standings at the moment the reveal starts.
    order = (liveGroups || []).slice().reverse(); // lowest place first
    introEl.classList.add('hide');
    setTimeout(function () { introEl.style.display = 'none'; }, 520);
    dockedCount = 0;
    showBig(0);
  }

  function advance() {
    if (phase === 'intro') { beginReveal(); return; }
    if (phase === 'done') {
      // Friday lands here with only the champion celebration showing —
      // one more advance reveals the full standings table behind it.
      // Harmless no-op if the table is already showing (non-Friday, or a
      // second tap after Friday's transition).
      showFinalStandingsTable();
      return;
    }
    if (phase !== 'reveal') return;
    if (bigIndex >= 0) {
      var wasLast = bigIndex === order.length - 1;
      dockCurrent();
      if (wasLast) { finish(); return; }
      showBig(dockedCount);
    } else {
      if (dockedCount < order.length) showBig(dockedCount);
      else finish();
    }
  }

  function back() {
    if (phase === 'done') {
      // Re-enter the reveal at 1st place to review the countdown backwards.
      phase = 'reveal';
      boardEl.classList.remove('final');
      boardEl.style.display = '';
      heroWrap.style.display = '';
      finaleEl.classList.remove('show');
      if (finaleIv) { clearInterval(finaleIv); finaleIv = null; }
      var last = order.length - 1;
      dockedCount = last;
      renderBoardRows();
      showBig(last);
      return;
    }
    if (phase !== 'reveal') return;
    var target;
    if (bigIndex >= 0) target = bigIndex - 1;
    else target = dockedCount - 1;
    if (target < 0) return; // already at the first-revealed place
    clearTimers();
    dockedCount = target;
    renderBoardRows();
    showBig(target);
  }

  function finish() {
    if (phase === 'done') return;
    phase = 'done';
    clearTimers();
    streamEmojis = null;
    bigIndex = -1;
    dockedCount = order.length;
    renderBoardRows();
    boardEl.classList.remove('dropped');
    var champGroup = order[order.length - 1]; // first place
    if (isFridayEastern() && champGroup) {
      // Friday: go all out — a full-screen champion celebration first (the
      // table was already walked through on the way up). The full final
      // standings table still follows on the next advance (tap / → /
      // Enter) — showFinalStandingsTable(), same table the quiet branch
      // below shows immediately.
      heroWrap.innerHTML = '';
      heroWrap.style.display = 'none';
      boardEl.style.display = 'none';
      boardEl.classList.remove('final');
      runFinale(champGroup);
      showHint('🎉 Champions! Press → for the full standings  ·  ← to review');
    } else {
      // Quiet end: center the full standings table on screen right away.
      showFinalStandingsTable();
    }
  }

  // The centered full-standings screen — shown immediately on a non-Friday
  // finish(), and reachable on Friday via advance() after the champion
  // celebration has had its moment. Idempotent: safe to call again (e.g. a
  // stray extra tap) with no visible change.
  function showFinalStandingsTable() {
    if (finaleIv) { clearInterval(finaleIv); finaleIv = null; }
    finaleEl.classList.remove('show');
    heroWrap.innerHTML = '';
    heroWrap.style.display = 'none';
    boardEl.style.display = '';
    boardEl.classList.add('final');
    showHint('Final standings  ·  Press ← to review');
  }

  var finaleIv = null;
  function runFinale(group) {
    var names = group.entries.map(function (en) { return esc(en.team.name); }).join(' & ');
    var pts = group.entries[0].stats.points;
    var emojis = group.entries.map(function (en) { return en.team.emoji; });
    var champ = document.getElementById('champ');
    champ.innerHTML = '<div class="crown">👑</div><div class="lead">Camp Champions</div>';
    var crests = box('champ-shields');
    group.entries.forEach(function (en) { crests.appendChild(crestNode(en.team, 'champ-crest')); });
    champ.appendChild(crests);
    champ.insertAdjacentHTML('beforeend',
      '<div class="name">' + emojis.map(esc).join(' ') + ' ' + names + '</div>' +
      '<div class="pts">' + pts + ' points</div>');
    finaleEl.classList.add('show');
    sfxFanfare();
    // Sustained confetti barrage.
    if (finaleIv) clearInterval(finaleIv);
    var bursts = 0;
    finaleIv = setInterval(function () {
      cannon(emojis, 10, 12 * dpr);
      if (++bursts > 24) { clearInterval(finaleIv); finaleIv = null; }
    }, 350);
  }

  // ── Input ──────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    // No data yet, or the sign-in overlay is up: leave the key alone (before
    // preventDefault, so Space/Enter still activates the focused sign-in
    // button instead of being swallowed and starting an empty reveal).
    if (pageLeaving || !haveData || document.getElementById('auth-overlay').style.display !== 'none') return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') {
      e.preventDefault(); ensureAudio(); advance();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault(); ensureAudio(); back();
    }
  });
  // Tap / click anywhere (except the top-bar controls) advances. Not before
  // there is data, and never from inside the sign-in overlay — a click on
  // "Continue with Google" bubbles here and used to start the reveal.
  document.addEventListener('click', function (e) {
    if (pageLeaving || !haveData || e.target.closest('.topbar, #auth-overlay')) return;
    ensureAudio(); advance();
  });

  // ── Self-update check ────────────────────────────────────────────
  // No fetch/service-worker interception, same network-only pattern the
  // main scoreboard uses (see app.js checkForUpdate). A code fix (like
  // tonight's double-points one) is invisible to an already-open tab
  // otherwise. Auto-reload is free ONLY on the 'intro' screen (nothing to
  // lose — the presenter hasn't pressed start yet); once a reveal is under
  // way or finished, force-reloading would wipe the presenter's manual
  // click-through progress, so we surface a small tappable chip instead
  // and let a human pick the moment.
  var updateSeen = false;
  function checkForUpdate() {
    if (updateSeen) return;
    fetch('current-standings.html?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (html) {
        if (!html) return;
        // The stamp as the page itself publishes it (see the top of this file).
        var m = html.match(/<meta\s+name="tv-build"\s+content="([^"]*)"/) || html.match(/var TV_BUILD = '([^']+)'/);
        if (m && myBuild && m[1] !== myBuild) {
          updateSeen = true;
          if (phase === 'intro') { reloadNow(); return; }
          var chip = document.getElementById('update-chip');
          if (chip) chip.hidden = false;
        }
      })
      .catch(function () { /* offline / blocked — try again next tick */ });
  }
  function reloadNow() {
    var u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    location.replace(u.toString());
  }
  var updateChipEl = document.getElementById('update-chip');
  if (updateChipEl) updateChipEl.addEventListener('click', reloadNow);
  setInterval(checkForUpdate, 90000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();

  // ── Go ─────────────────────────────────────────────────────────
  // The tab says which camp it is showing (two camps, one page).
  document.title = 'Current Standings — ' + CAMP.label;
  startData();
})();
