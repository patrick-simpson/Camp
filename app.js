// ── Camp Scoreboard ─────────────────────────────────────────────
// The week's games, day by day. Three formats:
//  - tournament: 2 teams at a time, 3 first-round matches, winners go
//    to the medal round. The bye goes to whichever winner is lowest in
//    the OVERALL standings coming into today — the app asks you, since
//    the official scoreboard lives on paper.
//  - tally: every team posts a score; top 3 auto-earn medals.
//  - placement: no numbers, you just pick who took gold/silver/bronze.

const STORAGE_KEY = lsKey('campScoreboardV2'); // per-camp; junior stays the bare literal (suffix '')

// Bump this to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`)
// every time a code asset (app.js, settings.js, defaults.js, styles.css,
// index.html) changes and gets deployed — it drives the "Code last
// updated" line in the footer. There's no build step here to stamp this
// automatically, so it's a manual step alongside the ?v=N cache-bust
// bump in index.html (six assets share the number — see CLAUDE.md).
const CODE_UPDATED_AT = '2026-07-26T03:21:30Z';
// Shown in the footer; bump together with the ?v= cache-busters in index.html.
const APP_VERSION = 171;

// "What's new" banners. Each entry advertises a user-visible change at the top
// of the page for TWO HOURS after its `at` time, then auto-expires. Every time
// you ship something worth telling people about, add an entry here (newest
// first) — same manual discipline as bumping CODE_UPDATED_AT and the ?v=
// cache-bust. `at` is UTC ISO (`date -u +%Y-%m-%dT%H:%M:%SZ`); `id` is a stable
// slug so a viewer's dismissal sticks; `text` is the short announcement.
// Multiple recent changes stack as separate banners, each expiring on its own
// two-hour clock. Old entries can be pruned once they're well past two hours.
// "What's new" banners are discontinued — leave this list EMPTY and do not add
// entries going forward (owner's call, 2026-07-21). With it empty, activeChanges()
// returns nothing and no banner ever renders. The queue machinery below is left
// dormant but harmless.
const CHANGES = [];

// ── Sign-in & roles (Firebase Authentication) ────────────────────
// The old 4-digit PIN gate is gone (2026-07-25). It only ever locked the
// PAGE — the database itself answered to anyone on the internet, which was
// verified live before this change. Access is now real: everyone signs in
// (Google, or an emailed link), and the database's own security rules only
// answer to emails listed at campScoreboard/members. The client code below
// shapes the UI; the RULES are the security boundary — nothing here can
// grant data access that the server doesn't independently verify.
//
// Roles, decided by the member record (never by anything on the device):
//   'viewer' — counselors. Can watch everything, can change nothing.
//              (Deliberate: counselors must not bump their own team's points.)
//   'editor' — directors / game leaders. Edit scores AND manage the member
//              list (Settings → Who can sign in).
//
// THE ONE INVARIANT (see also CLAUDE.md → "Auth, members & roles"):
// no database ref may attach until sign-in resolves AND the self-read of
// campScoreboard/members/<emailKey> confirms approval — the state listener's
// error callback treats a cancelled read as terminal (see initSync), so an
// early attach under locked rules would kill sync for the whole session.
// startSync() is therefore called only from the approved branch below.
//
// AUTH_HINT_KEY caches the last confirmed role so a returning, approved
// device paints the app instantly from local state (exactly the pre-auth
// behavior) while sign-in re-confirms in the background. It is convenience
// only: forging it shows an empty shell — the rules still refuse all data.
const AUTH_HINT_KEY = 'campScoreboardAuthHint'; // 'viewer' | 'editor' (same literal in index.html's pre-paint guard)
const EMAIL_SIGNIN_KEY = 'campScoreboardEmailForSignIn'; // email-link flow parks the address here

let authUser = null;       // firebase.auth() user, once signed in
let memberRole = null;     // 'viewer' | 'editor' | null (not resolved / not approved)
let memberName = null;     // display name from the member record, if set
let memberTeamId = null;   // 't0'…'t5' — the team this person is ON, if assigned
let authTornDown = false;  // sign-in was lost mid-session; recovery is a reload

// The whole member list, kept live once sync attaches (members can read the
// list — it's the staff directory). Null until it first loads; readers must
// fall back to the hand-typed counselor text until then.
let memberDirectory = null;

// The single write-path for the role — and the test seam: tests call this
// directly instead of faking a Firebase sign-in (see tests/auth.test.js).
function setMemberRole(role) {
  const next = role === 'editor' || role === 'viewer' ? role : null;
  const changed = memberRole !== next;
  memberRole = next;
  if (appStarted && changed) {
    applyRoleClass();
    updateAccountRow();
    renderAll();
  }
}

// The other half of the test seam: which team this account belongs to. Set
// from the member record; drives both the auto-followed team and the
// own-team scoring guard below.
function setMemberTeam(teamId) {
  const next = isTeamId(teamId) ? teamId : null;
  const changed = memberTeamId !== next;
  memberTeamId = next;
  if (appStarted && changed) {
    adoptMemberTeam();
    renderAll();
  }
}

function isTeamId(id) {
  return typeof id === 'string' && /^t\d+$/.test(id);
}

function canEdit() {
  return memberRole === 'editor';
}

// ── The own-team guard ────────────────────────────────────────────
// Staff assigned to a team (their member record's teamId) are editors
// everywhere EXCEPT the specific rounds their own team is playing or
// earning in: they can run the rest of the game normally — call up other
// matchups, record other teams' scores, finalize the result — but the one
// round with their own team in it is read-only for them, and another editor
// records it.
//
// Deliberately ONE function, so both loosening and tightening this are a
// one-line change: `return canEdit()` opens everything up; adding
// `if (memberTeamId) return false` closes every game to assigned staff.
// It is a fairness affordance, not a security boundary — the database rules
// gate on `role` alone and cannot see which round a write belongs to.
function canScoreRound(...teamIds) {
  if (!canEdit()) return false;
  if (!memberTeamId) return true; // nobody assigned a team is guarded
  return !teamIds.some((id) => id === memberTeamId);
}

// True when the guard above is what's blocking this round (as opposed to
// simply not being an editor) — the cue to explain rather than hide.
function blockedByOwnTeam(...teamIds) {
  return canEdit() && !canScoreRound(...teamIds);
}

// The standard explanation, shown wherever the guard takes controls away.
function ownTeamNoteHTML(what) {
  return `<p class="own-team-note">🛡️ You're on ${teamEmoji(memberTeamId)} <strong>${esc(teamName(memberTeamId))}</strong>, so ${esc(what)} is read-only for you. Another editor records it.</p>`;
}

// The member list is keyed by a person's SIGN-IN IDENTITY: their email (for
// Google / email-link) or their phone number (for phone sign-in). Two shapes:
//
//  - emailKey: lowercased email with EVERY dot turned into a comma. RTDB
//    forbids '.' in keys, and this must mirror the security rules'
//    `.replace('.', ',')`, which in the rules language replaces ALL
//    occurrences — hence replaceAll here, never JS .replace (which would only
//    catch the first dot and silently lock out any multi-dot address, the
//    owner's own included).
//  - phoneKey: the E.164 number (e.g. +15551234567). Phone numbers have no
//    dots to escape, and '+' is a legal RTDB key char, so the number IS the
//    key. This must match what Firebase reports as auth.token.phone_number,
//    which is always E.164 — so we normalize typed input the same way.
function emailKey(email) {
  return String(email || '').trim().toLowerCase().replaceAll('.', ',');
}

// Normalize a phone number to E.164 (+<countrycode><digits>) so a number an
// editor TYPES into the member list matches the one Firebase reports when that
// person signs in. Defaults to US (+1) when no country code is given — this is
// a US camp. Returns '' if there aren't enough digits to be a real number.
function phoneKey(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const hadPlus = s[0] === '+';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7) return ''; // too short to be a real phone number
  if (hadPlus) return '+' + digits;                 // they typed a full +… number
  if (digits.length === 10) return '+1' + digits;   // bare US 10-digit
  if (digits.length === 11 && digits[0] === '1') return '+' + digits; // US with the 1
  return '+' + digits;                               // best effort: assume it's complete
}

// The member-list key for a signed-in user — email first, else phone.
function identityKey(user) {
  if (!user) return '';
  if (user.email) return emailKey(user.email);
  if (user.phoneNumber) return phoneKey(user.phoneNumber);
  return '';
}

// The human-readable identity for a signed-in user (for the account row, the
// not-approved screen, changelog attribution).
function identityLabel(user) {
  if (!user) return '';
  return user.email || user.phoneNumber || '';
}

// A stored member key back to something displayable: a phone key (+…) shows
// as-is; an email key turns its commas back into dots (lossless — real emails
// never contain commas).
function identityFromKey(key) {
  const k = String(key || '');
  return k[0] === '+' ? k : k.replaceAll(',', '.');
}

// A member row for someone who has no sign-in yet — a counselor we know by
// name and team, whose email or phone gets filled in later. The key must be
// something `identityKey()` can NEVER produce, or a stranger could inherit
// the row: no '@' (email keys always have one) and no leading '+' (phone
// keys always do). The random tail keeps two people with the same name apart.
function pendingKey(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 24) || 'staff';
  return 'pending-' + slug + '-' + Math.random().toString(36).slice(2, 7);
}

function isPendingKey(key) {
  return String(key || '').startsWith('pending-');
}

// Shape of one campScoreboard/members entry. `name` and `teamId` are omitted
// (not null) when empty — RTDB drops nulls, and the rules validate each as a
// string when present.
function memberRecord(role, name, teamId) {
  const rec = {
    role: role === 'editor' ? 'editor' : 'viewer',
    addedBy: identityLabel(authUser) || 'unknown',
    addedAt: new Date().toISOString(),
  };
  if (name && String(name).trim()) rec.name = String(name).trim();
  if (isTeamId(teamId)) rec.teamId = teamId;
  return rec;
}

// Everyone in the member directory who is assigned to a team, by display
// name (falling back to their sign-in identity when they have no name yet).
// Empty until the directory loads — callers fall back to team.counselor.
function teamStaffNames(teamId) {
  if (!memberDirectory || !isTeamId(teamId)) return [];
  return Object.keys(memberDirectory)
    .filter((k) => memberDirectory[k] && memberDirectory[k].teamId === teamId)
    .map((k) => String(memberDirectory[k].name || identityFromKey(k)))
    .sort((a, b) => a.localeCompare(b));
}

// Team identity — names, emoji, crests (junior shields / senior flags),
// accent colors — all per-camp data, moved verbatim into camps.js.
// The constant names stay so nothing downstream changes.
const DEFAULT_TEAM_NAMES = CAMP.defaultTeamNames;
const TEAM_EMOJI = CAMP.teamEmoji;
const TEAM_SHIELD = CAMP.teamCrest;
const TEAM_ACCENT = CAMP.teamAccent;
function teamAccent(id) { return TEAM_ACCENT[id] || null; }
// Short-form team names for tight spaces — per-camp (camps.js).
const TEAM_ABBREV = CAMP.teamAbbrev;
// Name/counselor migration lists for older saved rosters — per-camp;
// empty for senior, so senior teams are never auto-renamed.
const OLD_PLACEHOLDER_TEAM_NAMES = CAMP.oldPlaceholderTeamNames;
const DEFAULT_COUNSELORS = CAMP.defaultCounselors;
const OLD_PLACEHOLDER_COUNSELORS = CAMP.oldPlaceholderCounselors;

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

// Everything is points based: each medal is worth a fixed number of
// points, and the week standings rank teams by total points.
const MEDAL_POINTS = { gold: 7, silver: 5, bronze: 3 };

// ── Double-points window (Patrick's call, Thu evening 2026-07-23) ──
// Everything from Thursday 5pm ET through the end of Friday counts DOUBLE,
// except meal cleanup. Games are handled by their `messtival` flag (see the
// config v5 migration); this window doubles the OTHER point sources — verse
// recitals and custom bonuses — by entry timestamp, at computation time, so
// it's retroactive and needs no ledger edits. Mirrored in
// current-standings.html's computeStandings — keep in sync.
const DOUBLE_BONUS_START = Date.parse('2026-07-23T21:00:00Z'); // Thu 5:00pm ET
const DOUBLE_BONUS_END = Date.parse('2026-07-25T04:00:00Z');   // Fri midnight ET (00:00 Sat, ET)

function bonusCountsDouble(b) {
  if (!b || b.category === 'cleanup') return false;
  const t = Date.parse(b.at || '');
  return t >= DOUBLE_BONUS_START && t < DOUBLE_BONUS_END;
}

// True while "now" is inside the double-points window (drives the notices
// on the verse/bonus cards).
function inDoubleBonusWindow() {
  const now = Date.now();
  return now >= DOUBLE_BONUS_START && now < DOUBLE_BONUS_END;
}

// ── Game catalog ────────────────────────────────────────────────
// The week's games and days now live in editable, synced state
// (state.config) — built out by editors in Settings → Set up the week.
// The built-in defaults are in defaults.js (defaultConfig()); the
// builder UI is in settings.js. DAY_NAMES above stays: the memory-verse,
// meal-cleanup, and daily-schedule features are keyed by real day of
// week, independent of the editable competition days.

// ── Live daily schedule ("Happening now" banner) ─────────────────
// The full week from the printed Junior Camp packet, so the top of the
// page can say what camp is doing at this very moment. Times are minutes
// since midnight in CAMP TIME (US Eastern) — never the phone's timezone,
// so the banner is right even for family checking in from elsewhere.
// During competition blocks the banner hides; the scoreboard below is
// the main event then. Blocks are contiguous — findIndex is enough.

const CAMP_TZ = 'America/New_York';

// The full printed week, per camp (camps.js): every block of every day,
// minutes-since-midnight in camp time. (hm() also lives in camps.js now.)
const DAY_SCHEDULE = CAMP.daySchedule;

// Electives — junior-only (CAMP.features.electives). The active profile
// supplies who's at which station (junior: the handwritten packet;
// senior: empty — no electives at senior camp, so these all no-op).
const STATION_EMOJI = CAMP.stationEmoji;
const ELECTIVES = CAMP.electives;
// Device-identity → team, keyed to the ELECTIVES spellings (junior).
// Empty for senior — identities come from member records instead.
const TEAM_COUNSELORS = CAMP.teamCounselors;
const ELECTIVE_SLOT_MIN = CAMP.electiveSlotMin;

// The full set of kids at camp on a given day = everyone assigned to any
// station across that day's elective slots. A kid missing from a particular
// slot is on break for it (see electiveBreakKids).
function electiveDayRoster(dow) {
  const set = new Set();
  (ELECTIVES[dow] || []).forEach((slot) => {
    (slot || []).forEach(([, kids]) => (kids || []).forEach((k) => set.add(k)));
  });
  return set;
}

// Kids with no station in this elective slot — they're on "Break".
function electiveBreakKids(dow, slot) {
  const assigned = new Set();
  (((ELECTIVES[dow] || [])[slot]) || []).forEach(([, kids]) => (kids || []).forEach((k) => assigned.add(k)));
  return [...electiveDayRoster(dow)].filter((k) => !assigned.has(k)).sort();
}

// Where the stored identity is during one elective slot of any day:
// { station, emoji, onBreak }, or null when there's nothing to say (no
// identity, no electives that day, or the identity isn't on that day's
// sheet — counselors and parents). Used by the schedule sheet's "You" chip.
function myStationFor(dow, slot) {
  const name = state.identity;
  if (!name) return null;
  const stations = ((ELECTIVES[dow] || [])[slot]) || [];
  const found = stations.find(([, kids]) => (kids || []).includes(name));
  if (found) return { station: found[0], emoji: STATION_EMOJI[found[0]] || '🌟', onBreak: false };
  if (electiveDayRoster(dow).has(name)) return { station: 'Break', emoji: '☕', onBreak: true };
  return null;
}

// Today's three elective slots for the stored identity (state.identity), as
// [{ slot, time, station, emoji, onBreak }], or null when there's nothing to
// show — no identity set, a weekend / no-elective day, or the identity isn't on
// today's elective sheet at all. Reused by renderMyElectives.
function myElectivesToday() {
  const name = state.identity;
  if (!name) return null;
  const { dow } = campNow();
  const day = ELECTIVES[dow];
  if (!day) return null;                               // dow 0/6 — no electives
  if (!electiveDayRoster(dow).has(name)) return null;  // not on today's sheet
  return [0, 1, 2].map((slot) => {
    const stations = day[slot] || [];
    const found = stations.find(([, kids]) => kids.includes(name));
    const station = found ? found[0] : null;
    return {
      slot,
      time: schedClock(ELECTIVE_SLOT_MIN[slot], true),
      station,
      emoji: station ? (STATION_EMOJI[station] || '🌟') : '☕',
      onBreak: !station,
    };
  });
}

// ── Elective weather forecast ─────────────────────────────────────
// Shows the forecast next to FUTURE electives (schedule sheet + "My electives
// today" card). Source: Open-Meteo — free, no API key, CORS-friendly, so it
// works from a static GitHub Pages site. Coordinates are Campground Rd,
// Belgrade ME (weather is regional, so town-level precision is plenty).
// Fails silent when offline/blocked, exactly like the optional Firebase sync.
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=44.5055&longitude=-69.7791'
  + '&hourly=temperature_2m,weather_code,precipitation_probability'
  + '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=7';
const WEATHER_CACHE_KEY = 'campWeatherCache';
const WEATHER_TTL_MS = 30 * 60 * 1000; // refetch at most every 30 min
const WEATHER_RAIN_MIN = 40;           // only surface rain % at/above this

// WMO weather_code → { emoji, label }.
const WEATHER_CODES = {
  0: { emoji: '☀️', label: 'Clear' }, 1: { emoji: '🌤️', label: 'Mainly clear' },
  2: { emoji: '⛅', label: 'Partly cloudy' }, 3: { emoji: '☁️', label: 'Overcast' },
  45: { emoji: '🌫️', label: 'Fog' }, 48: { emoji: '🌫️', label: 'Fog' },
  51: { emoji: '🌦️', label: 'Light drizzle' }, 53: { emoji: '🌦️', label: 'Drizzle' }, 55: { emoji: '🌦️', label: 'Heavy drizzle' },
  56: { emoji: '🌧️', label: 'Freezing drizzle' }, 57: { emoji: '🌧️', label: 'Freezing drizzle' },
  61: { emoji: '🌧️', label: 'Light rain' }, 63: { emoji: '🌧️', label: 'Rain' }, 65: { emoji: '🌧️', label: 'Heavy rain' },
  66: { emoji: '🌧️', label: 'Freezing rain' }, 67: { emoji: '🌧️', label: 'Freezing rain' },
  71: { emoji: '🌨️', label: 'Light snow' }, 73: { emoji: '🌨️', label: 'Snow' }, 75: { emoji: '🌨️', label: 'Heavy snow' },
  77: { emoji: '🌨️', label: 'Snow grains' },
  80: { emoji: '🌦️', label: 'Rain showers' }, 81: { emoji: '🌦️', label: 'Rain showers' }, 82: { emoji: '⛈️', label: 'Violent showers' },
  85: { emoji: '🌨️', label: 'Snow showers' }, 86: { emoji: '🌨️', label: 'Snow showers' },
  95: { emoji: '⛈️', label: 'Thunderstorm' }, 96: { emoji: '⛈️', label: 'Thunderstorm w/ hail' }, 99: { emoji: '⛈️', label: 'Thunderstorm w/ hail' },
};

// { dates: ['YYYY-MM-DD', …], byTime: { 'YYYY-MM-DDTHH:00': {temp, code, precip} }, at }
let weatherData = null;

// Today's date in camp time as 'YYYY-MM-DD' (en-CA renders ISO order), used to
// tell whether a cached forecast is still keyed to the right "today".
function campDateStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CAMP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (e) { return ''; }
}

function processWeather(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  const byTime = {};
  const dates = [];
  h.time.forEach((t, i) => {
    byTime[t] = { temp: h.temperature_2m[i], code: h.weather_code[i], precip: h.precipitation_probability[i] };
    const d = t.slice(0, 10);
    if (dates[dates.length - 1] !== d) dates.push(d);
  });
  return { dates, byTime, at: Date.now() };
}

// Paint badges in-place once weather lands (schedule sheet + my-electives
// card + the banner's rain hint).
function repaintWeather() {
  renderMyElectives();
  refreshOpenSchedule();
  renderNowBanner();
}

function loadWeatherCache() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    // Discard a forecast whose day 0 isn't today — the day-offset mapping in
    // electiveWxHtml assumes dates[0] === today.
    if (cached && cached.dates && cached.dates[0] === campDateStr()) weatherData = cached;
  } catch (e) { /* ignore corrupt/absent cache */ }
}

async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = processWeather(await res.json());
    if (!data) return;
    weatherData = data;
    try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* quota / private mode */ }
    repaintWeather();
  } catch (e) { /* offline / blocked — try again next tick */ }
}

function weatherFresh() {
  return weatherData && weatherData.dates[0] === campDateStr() && (Date.now() - weatherData.at) < WEATHER_TTL_MS;
}

function startWeatherUpdates() {
  loadWeatherCache();
  if (!weatherFresh()) fetchWeather();
  setInterval(() => { if (!weatherFresh()) fetchWeather(); }, WEATHER_TTL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !weatherFresh()) fetchWeather(); });
}

// Forecast badge HTML for one elective slot, or '' when it shouldn't show:
// no data, a past day, a today-slot that already started, beyond the forecast
// range, or a missing hour. dow is the schedule day being rendered (0–6).
function electiveWxHtml(dow, slot) {
  if (!weatherData) return '';
  const now = campNow();
  const dayOffset = dow - now.dow;
  if (dayOffset < 0) return '';                                            // earlier this week
  if (dayOffset === 0 && ELECTIVE_SLOT_MIN[slot] <= now.minutes) return ''; // today, already started
  if (dayOffset >= weatherData.dates.length) return '';                    // past the 7-day window
  const hour = Math.floor(ELECTIVE_SLOT_MIN[slot] / 60);
  const w = weatherData.byTime[`${weatherData.dates[dayOffset]}T${String(hour).padStart(2, '0')}:00`];
  if (!w || w.temp == null) return '';
  const info = WEATHER_CODES[w.code] || { emoji: '🌡️', label: 'Forecast' };
  const rain = (w.precip != null && w.precip >= WEATHER_RAIN_MIN) ? ` · ${w.precip}%` : '';
  return `<span class="wx-badge" title="${esc(info.label)} · forecast">${info.emoji} ${Math.round(w.temp)}°${rain}</span>`;
}

// Rain warning for the Happening Now banner: the first hour within the next
// three (starting from the current hour, camp time) whose precipitation
// probability crosses WEATHER_RAIN_MIN. '' when dry, no forecast, or the
// rainy hour would fall past midnight (camp's asleep — nobody needs it).
function upcomingRainHint() {
  if (!weatherData) return '';
  const now = campNow();
  const today = weatherData.dates[0];
  if (today !== campDateStr()) return '';
  const startHour = Math.floor(now.minutes / 60);
  for (let h = startHour; h <= startHour + 3 && h <= 23; h++) {
    const w = weatherData.byTime[`${today}T${String(h).padStart(2, '0')}:00`];
    if (w && w.precip != null && w.precip >= WEATHER_RAIN_MIN) {
      const when = h === startHour ? 'this hour' : `near ${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
      return `<div class="now-wx">🌧️ ${w.precip}% chance of rain ${when}</div>`;
    }
  }
  return '';
}

// ── Meal menu ────────────────────────────────────────────────────
// What the kitchen is serving — per-camp data (camps.js), keyed by
// day-of-week (0 Sun .. 6 Sat) then lowercase meal block name. When a
// meal is listed, the Happening Now banner names the dish during that
// block. Unknown meals just show the plain block label, so an empty or
// sparse menu (senior, for now) is always safe.
const MEALS = CAMP.meals;

function mealInfo(dow, block) {
  const meals = MEALS[dow];
  if (!meals || !block) return null;
  return meals[(block.label || '').toLowerCase()] || null;
}

// Returns the block as-is, or a copy dressed up with tonight's dish —
// e.g. "Supper" becomes "Supper — Shepherd's Pie" with a 🥧 emoji.
function decorateMealBlock(dow, block) {
  const meal = mealInfo(dow, block);
  if (!meal) return block;
  return Object.assign({}, block, {
    emoji: meal.emoji || block.emoji,
    label: block.label + ' — ' + meal.dish,
  });
}

// The meal a schedule block represents (Breakfast/Lunch/Supper), or null.
// Handles decorated labels like "Supper — Shepherd's Pie".
function blockMealName(label) {
  const base = String(label || '').split(' — ')[0].trim();
  return MEAL_CLEANUP_MEALS.includes(base) ? base : null;
}

// A "🧽 <team>" note naming who's on cleanup for the meal a block represents,
// shown next to the meal wherever it appears. '' when the block isn't a meal or
// the day isn't on the cleanup rota; "TBA" for a tracked day not yet assigned.
function mealCleanupNote(dow, label) {
  const meal = blockMealName(label);
  if (!meal || !MEAL_CLEANUP_SCHEDULE[dow]) return '';
  const teamIds = cleanupAssigned(dow, meal);
  if (!teamIds) return ` <span class="meal-cleanup-note">🧽 TBA</span>`;
  const teams = Array.isArray(teamIds) ? teamIds : [teamIds];
  const who = teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ');
  return ` <span class="meal-cleanup-note">🧽 ${who}</span>`;
}

// ── Notice board (big, top-of-page, editor-composed) ─────────────
// One large card pinned above every other section, for the message that has
// to be impossible to miss. Built for send-off-morning cleanup: six separate
// announcements filled the whole phone screen and buried the one line each
// camper actually needed.
//
// Unlike an announcement, it isn't typed in a single box and it doesn't
// expire on a timer. It's composed in the week builder (Settings → Set up
// the week → Notice) and lives in synced state, so every device shows the
// same thing, and it is either a DRAFT (nobody sees it; keep editing as long
// as you like) or POSTED (on every device until you put it back to draft).
//
// Shape — state.notice, synced (see SYNC_KEYS):
//   { status: 'draft' | 'posted',
//     eyebrow, title, sub, signoff,          // all optional strings
//     zones: [{ teamId, place, note }],      // per-team assignments, in order
//     steps: [{ emoji, when, items: [] }] }  // the running order
const NOTICE_STATUSES = ['draft', 'posted'];

// The starting content — per-camp (camps.js): junior seeds its Saturday
// send-off cleanup plan (the worked example this feature was built for),
// senior a TBA skeleton. Always a DRAFT — seeding must never post a card.
function defaultNotice() {
  return CAMP.defaultNotice();
}

// Coerce state.notice into a shape every reader can trust. Realtime Database
// prunes empty arrays/strings on write, so a posted notice with no zones (or
// no steps) comes back missing them entirely — see the RTDB note in CLAUDE.md.
// A notice with no `status` at all has never existed on this database, so it
// gets seeded with the worked example above.
function normalizeNotice() {
  let n = state.notice;
  if (!n || typeof n !== 'object' || Array.isArray(n) || !n.status) {
    n = defaultNotice();
  }
  if (!NOTICE_STATUSES.includes(n.status)) n.status = 'draft';
  ['eyebrow', 'title', 'sub', 'signoff'].forEach((k) => {
    n[k] = typeof n[k] === 'string' ? n[k] : '';
  });
  n.zones = (Array.isArray(n.zones) ? n.zones : [])
    .filter((z) => z && typeof z === 'object')
    .map((z) => ({ teamId: String(z.teamId || ''), place: String(z.place || ''), note: String(z.note || '') }));
  n.steps = (Array.isArray(n.steps) ? n.steps : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      emoji: String(s.emoji || ''),
      when: String(s.when || ''),
      items: (Array.isArray(s.items) ? s.items : []).map((i) => String(i)).filter(Boolean),
    }));
  state.notice = n;
  return n;
}

function noticeBoard() {
  return normalizeNotice();
}

// Posted AND actually saying something — an empty posted notice would render
// as a bare box, so it stays hidden until it has content.
function noticePosted() {
  const n = noticeBoard();
  if (n.status !== 'posted') return false;
  return !!(n.title || n.sub || n.signoff || n.zones.length || n.steps.length);
}

// One team's assignment on the current notice, or null.
function noticeZoneFor(teamId) {
  return noticeBoard().zones.find((z) => z.teamId === teamId) || null;
}

// `preview` renders the card regardless of status, for the builder's preview.
function noticeCardHtml(preview) {
  const n = noticeBoard();
  if (!preview && !noticePosted()) return null;

  // Skip any slot whose team no longer exists (roster edited / week reset).
  const zones = n.zones.filter((z) => z.place && state.teams.some((t) => t.id === z.teamId));

  const mine = state.followTeam ? zones.find((z) => z.teamId === state.followTeam) : null;
  // Viewers following a team get their own line spelled out first — it's the
  // only row most people actually need.
  const yours = mine ? `<div class="notice-yours">
      <span class="notice-yours-label">Your team</span>
      <span class="notice-yours-place">${teamEmoji(mine.teamId)} ${esc(teamName(mine.teamId))} → <strong>${esc(mine.place)}</strong></span>
    </div>` : '';

  const rows = zones.map((z) => `
    <li class="notice-row${z.teamId === state.followTeam ? ' notice-row-you' : ''}">
      <span class="notice-team"><span class="notice-emoji" aria-hidden="true">${teamEmoji(z.teamId)}</span> ${esc(teamName(z.teamId))}</span>
      <span class="notice-place">${esc(z.place)}${z.note ? `<span class="notice-note">${esc(z.note)}</span>` : ''}</span>
    </li>`).join('');

  const steps = n.steps.filter((s) => s.when || s.items.length).map((s) => `
    <div class="notice-step">
      <div class="notice-step-when">${s.emoji ? `<span aria-hidden="true">${esc(s.emoji)}</span> ` : ''}${esc(s.when)}</div>
      <ul class="notice-step-items">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('');

  return `<div class="notice-card">
    ${n.eyebrow ? `<div class="notice-eyebrow">${esc(n.eyebrow)}</div>` : ''}
    ${n.title ? `<h2 class="notice-title">${esc(n.title)}</h2>` : ''}
    ${n.sub ? `<p class="notice-sub">${esc(n.sub)}</p>` : ''}
    ${yours}
    ${rows ? `<ul class="notice-list">${rows}</ul>` : ''}
    ${steps}
    ${n.signoff ? `<p class="notice-signoff">${esc(n.signoff)}</p>` : ''}
  </div>`;
}

function renderNoticeBoard() {
  const el = document.getElementById('notice-board');
  if (!el) return;
  const html = noticeCardHtml(false);
  el.hidden = !html;
  el.innerHTML = html || '';
}

// Post / un-post from the builder. Editors only — it shows on every device.
function setNoticeStatus(status) {
  if (!canEdit() || !NOTICE_STATUSES.includes(status)) return;
  noticeBoard().status = status;
  // Posting/taking down is a real broadcast, same as an announcement, so it
  // stamps "Data last updated". Drafting edits deliberately don't — they're
  // invisible to everyone else until posted.
  touchData();
  saveState();
  renderAll();
}

// Current day-of-week + minutes-since-midnight, in camp time.
// Debug/preview override: add ?now=<dow>-<hhmm> to the page URL,
// e.g. ?now=1-1330 previews Monday 1:30pm.
function campNow() {
  const m = /[?&]now=(\d)-(\d{3,4})(?:&|$)/.exec(location.search);
  if (m) {
    const t = m[2].padStart(4, '0');
    return { dow: +m[1], minutes: +t.slice(0, 2) * 60 + +t.slice(2) };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CAMP_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = parseInt(get('hour'), 10) % 24; // hour12:false renders midnight as "24"
    return { dow: dowMap[get('weekday')], minutes: hour * 60 + parseInt(get('minute'), 10) };
  } catch (e) {
    const d = new Date(); // worst case: device time
    return { dow: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

// Named schedClock/schedRange (not fmtClock) — fmtBoardClock/fmtWatch below
// have their own formatters and function declarations share one namespace.
function schedClock(mins, withSuffix) {
  const h = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return h12 + ':' + String(mm).padStart(2, '0') + (withSuffix ? (h < 12 ? 'am' : 'pm') : '');
}

function schedRange(start, end) {
  const sameHalf = (start < 720) === (end < 720 || end === 1440);
  return schedClock(start, !sameHalf) + '–' + schedClock(end, true);
}

function nowBannerHtml(dow, minutes) {
  const blocks = DAY_SCHEDULE[dow] || [];
  if (!blocks.length) return null;

  const eyebrow = `<div class="now-eyebrow-row">
    <span class="now-eyebrow">Happening now</span>
    <span class="now-open-hint">📅 Full schedule ›</span>
  </div>`;
  // progress is the elapsed fraction of the current timed block (0–1), or null
  // to omit the bar (untimed blocks, or before the day's first block).
  const progressBar = (progress) => progress == null ? '' :
    `<jelly-progress class="now-progress" size="small" value="${Math.round(Math.max(0, Math.min(1, progress)) * 100)}" max="100" aria-hidden="true"></jelly-progress>`;
  const main = (emoji, label, time, next, progress) => eyebrow +
    `<div class="now-main"><span class="now-emoji">${emoji}</span><div class="now-body">
      <div class="now-label">${esc(label)}${time ? ` <span class="now-time">${time}</span>` : ''}${mealCleanupNote(dow, label)}</div>
      ${next ? `<div class="now-next">Up next: ${next.emoji} ${esc(next.label)} at ${schedClock(next.start, true)}${mealCleanupNote(dow, next.label)}</div>` : ''}
      ${upcomingRainHint()}
    </div></div>` + progressBar(progress);

  // Early morning, before the first block of the day.
  if (minutes < blocks[0].start) {
    const first = decorateMealBlock(dow, blocks[0]);
    if (dow === 0) return main('🚌', 'Camp starts today!', null, first, null);
    return main('🛏️', "Lights out — everyone's sleeping", null, first, null);
  }

  const found = blocks.find((x) => minutes >= x.start && minutes < x.end);
  if (!found) return null;

  // During competition blocks the scoreboard is the main event — keep the
  // banner to a slim, tappable one-liner rather than hiding it entirely, so the
  // schedule sheet stays reachable.
  if (found.type === 'games') {
    // Named after the actual block — junior's say "Team competitions" /
    // "Evening competition", senior's include the Legacy Game by name.
    return `<div class="now-slim"><span class="now-slim-label">${esc(found.emoji)} ${esc(found.label)}</span><span class="now-open-hint">📅 Full schedule ›</span></div>` + upcomingRainHint();
  }

  const b = decorateMealBlock(dow, found);
  const time = b.noTime ? null : schedRange(b.start, b.end);
  const progress = b.noTime ? null : (minutes - b.start) / (b.end - b.start);
  if (b.type === 'elective') {
    const me = state.identity;
    const chip = (k) => `<span class="kid-chip${k === me ? ' kid-chip-you' : ''}">${esc(k)}${k === me ? ' ⭐' : ''}</span>`;
    const stations = (ELECTIVES[dow] || [])[b.slot] || [];
    let rows = stations.map(([station, kids]) =>
      `<div class="now-station${kids.includes(me) ? ' now-station-you' : ''}"><span class="now-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
        <span class="now-kids">${kids.map(chip).join('')}</span></div>`).join('');
    const breakKids = electiveBreakKids(dow, b.slot);
    if (breakKids.length) {
      rows += `<div class="now-station now-break${breakKids.includes(me) ? ' now-station-you' : ''}"><span class="now-station-name">☕ Break</span>
        <span class="now-kids">${breakKids.map(chip).join('')}</span></div>`;
    }
    return main(b.emoji, b.label, time, null, progress) + `<div class="now-stations">${rows}</div>`;
  }

  // "Up next" = the next block that starts at or after this one ends. Using
  // the end time (not just index+1) keeps it correct when blocks overlap
  // (e.g. tonight's movie night sitting over the wind-down) — for a normal,
  // non-overlapping day this is the very next block, exactly as before.
  const after = blocks.find((x) => x.start >= found.end);
  const next = decorateMealBlock(dow, after || null);
  return main(b.emoji, b.label, time, next, progress);
}

function renderNowBanner() {
  const el = document.getElementById('now-banner');
  if (!el) return;
  // While a live match's Big Board owns the top of the home screen, the
  // schedule banner yields — the game IS what's happening now.
  if (typeof homeBoardGame === 'function' && homeBoardGame()) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const { dow, minutes } = campNow();
  const html = nowBannerHtml(dow, minutes);
  el.hidden = !html;
  el.innerHTML = html || '';
}

// ── Full week schedule sheet (tap the Happening Now banner) ──────
// A bottom sheet with the whole printed schedule, day by day: a
// timeline of every block, today's current block highlighted, meals
// showing their dish, electives showing who's at each station, and
// competition blocks listing that day's actual games.

const SCHED_DAYS = CAMP.schedDays; // per-camp day list + tags (camps.js)

let scheduleDay = null; // day shown while the sheet is open (not persisted)

function scheduleOverlayEl() {
  return document.getElementById('schedule-overlay');
}

function openSchedule() {
  scheduleDay = campNow().dow;
  const overlay = scheduleOverlayEl();
  overlay.classList.remove('closing');
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true; // background isn't reachable by tab/AT while the sheet is up
  renderSchedule();
  // Land the reader on "now" (today only — other days start at the top).
  requestAnimationFrame(() => {
    const nowCard = document.querySelector('.sched-block.now');
    if (nowCard) nowCard.scrollIntoView({ block: 'center' });
    const closeBtn = document.getElementById('schedule-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  });
}

function closeSchedule() {
  const overlay = scheduleOverlayEl();
  const sheet = overlay.querySelector('.schedule-sheet');
  if (sheet) sheet.style.transform = ''; // clear any swipe offset
  const finish = () => {
    overlay.hidden = true;
    overlay.classList.remove('closing');
    document.body.classList.remove('no-scroll');
    const app = document.getElementById('app');
    if (app) app.inert = false;
    const banner = document.getElementById('now-banner');
    if (banner && !banner.hidden) banner.focus({ preventScroll: true });
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { finish(); return; }
  overlay.classList.add('closing'); // play the slide-down, then hide
  setTimeout(finish, 200);
}

function renderSchedule() {
  renderScheduleDays();
  renderScheduleBody();
}

function renderScheduleDays() {
  const wrap = document.getElementById('schedule-days');
  if (!wrap) return;
  const todayDow = campNow().dow;
  wrap.innerHTML = SCHED_DAYS.map((d) => `
    <jelly-chip class="sched-day-chip" selectable size="small" ${d.dow === scheduleDay ? 'selected' : ''} data-dow="${d.dow}">
      ${d.short}${d.dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}
    </jelly-chip>`).join('');
  wrap.querySelectorAll('.sched-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      scheduleDay = parseInt(btn.dataset.dow, 10);
      renderSchedule();
      const body = document.getElementById('schedule-body');
      if (body) body.scrollTop = 0;
      joyStagger(body);
    });
  });
}

function renderScheduleBody() {
  const wrap = document.getElementById('schedule-body');
  if (!wrap) return;
  const dow = scheduleDay;
  const { dow: nowDow, minutes } = campNow();
  const isToday = dow === nowDow;
  const day = SCHED_DAYS[dow] || SCHED_DAYS[0];
  const blocks = DAY_SCHEDULE[dow] || [];

  const rows = blocks.map((raw) => {
    const b = decorateMealBlock(dow, raw);
    const status = !isToday ? '' : minutes >= raw.end ? 'past' : minutes >= raw.start ? 'now' : '';
    const meal = mealInfo(dow, raw);

    let extra = '';
    let labelBadge = ''; // forecast badge next to the label (future electives only)
    if (raw.type === 'games') {
      const session = raw.start < 720 ? 'Morning' : 'Evening';
      // Competition days are editable; map this block's real day-of-week to
      // whichever configured day(s) carry that dow.
      const dowDayIds = state.config.days.filter((d) => d.dow === dow).map((d) => d.id);
      const games = state.config.games.filter((g) => dowDayIds.includes(g.dayId) && g.session === session);
      if (games.length) {
        extra = `<div class="sched-games">${games.map((g) =>
          `<span class="sched-game-chip ${state.results[g.id] ? 'played' : ''}">${esc(g.emoji)} ${esc(g.name)}${state.results[g.id] ? ' ✓' : ''}</span>`).join('')}</div>`;
      }
    } else if (raw.type === 'elective') {
      labelBadge = electiveWxHtml(dow, raw.slot);
      // Pin the viewer's own station at the top of the block so they don't
      // have to scan every roster for their name.
      const mine = myStationFor(dow, raw.slot);
      if (mine) labelBadge += `<span class="sched-you-chip">⭐ You: ${mine.emoji} ${esc(mine.station)}</span>`;
      const me = state.identity;
      const kidText = (kids) => kids.map((k) => k === me ? `<span class="sched-you">⭐ ${esc(k)}</span>` : esc(k)).join(' · ');
      const stations = (ELECTIVES[dow] || [])[raw.slot] || [];
      if (stations.length) {
        let stationRows = stations.map(([station, kids]) =>
          `<div class="sched-station${kids.includes(me) ? ' sched-station-you' : ''}"><span class="sched-station-name">${STATION_EMOJI[station] || '🌟'} ${esc(station)}</span>
            <span class="sched-station-kids">${kidText(kids)}</span></div>`).join('');
        const breakKids = electiveBreakKids(dow, raw.slot);
        if (breakKids.length) {
          stationRows += `<div class="sched-station sched-break${breakKids.includes(me) ? ' sched-station-you' : ''}"><span class="sched-station-name">☕ Break</span>
            <span class="sched-station-kids">${kidText(breakKids)}</span></div>`;
        }
        extra = `<div class="sched-stations">${stationRows}</div>`;
      }
    }

    return `<div class="sched-block ${status} ${meal ? 'meal' : ''}">
      <div class="sched-rail"><span class="sched-dot"></span></div>
      <div class="sched-card">
        <div class="sched-time">${raw.noTime ? '' : schedRange(raw.start, raw.end)}${status === 'now' ? '<span class="sched-now-pill">Now</span>' : ''}</div>
        <div class="sched-label"><span class="sched-emoji">${b.emoji}</span> ${esc(b.label)}${mealCleanupNote(dow, b.label)}${labelBadge}</div>
        ${extra}
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <h3 class="sched-day-title">${day.full} <span class="sched-day-tag">· ${esc(day.tag)}</span></h3>
    <div class="sched-timeline">${rows || '<p class="muted">Nothing scheduled.</p>'}</div>
    ${blocks.some((b) => !b.noTime) ? `<div class="sched-ics-row"><jelly-button id="sched-ics-btn" class="secondary-btn" variant="platinum" size="small">📆 Add ${day.full} to calendar</jelly-button></div>` : ''}
  `;
  const icsBtn = document.getElementById('sched-ics-btn');
  if (icsBtn) {
    icsBtn.addEventListener('click', () => {
      const blob = new Blob([buildDayIcs(dow)], { type: 'text/calendar' });
      downloadBlob(blob, 'camp-' + day.short.toLowerCase() + '.ics');
    });
  }
}

// ── "Add to calendar" (.ics) export of one schedule day ──────────
// Times go out as TZID=America/New_York wall-clock (with a standard US
// eastern VTIMEZONE), so the event is right no matter what timezone the
// parent's phone is in — same convention as everything else camp-time.
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// 'YYYYMMDD' in camp time for the given day-of-week of the current camp week.
function campDateForDow(dow) {
  const [y, m, d] = campDateStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + (dow - campNow().dow)));
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildDayIcs(dow) {
  const date = campDateForDow(dow);
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const fmt = (mins) => {
    const mm = Math.min(mins, hm(23, 59)); // paranoia: keep a stray midnight end in-day
    return `${date}T${String(Math.floor(mm / 60)).padStart(2, '0')}${String(mm % 60).padStart(2, '0')}00`;
  };
  const events = (DAY_SCHEDULE[dow] || []).filter((b) => !b.noTime).map((raw) => {
    const b = decorateMealBlock(dow, raw);
    let desc = '';
    if (raw.type === 'games') {
      // Name the actual games in the event body, like the schedule sheet does.
      const session = raw.start < 720 ? 'Morning' : 'Evening';
      const dowDayIds = state.config.days.filter((d) => d.dow === dow).map((d) => d.id);
      const games = state.config.games.filter((g) => dowDayIds.includes(g.dayId) && g.session === session);
      if (games.length) desc = games.map((g) => `${g.emoji} ${g.name}`).join(', ');
    }
    return [
      'BEGIN:VEVENT',
      `UID:campday-${dow}-${raw.start}@camp.patricksimpson.info`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${fmt(raw.start)}`,
      `DTEND;TZID=America/New_York:${fmt(raw.end)}`,
      `SUMMARY:${icsEscape(b.emoji + ' ' + b.label)}`,
      desc ? `DESCRIPTION:${icsEscape(desc)}` : '',
    ].filter(Boolean).concat('END:VEVENT').join('\r\n');
  });
  const vtimezone = [
    'BEGIN:VTIMEZONE', 'TZID:America/New_York',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
    'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
    'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Camp Scoreboard//camp.patricksimpson.info//EN', 'CALSCALE:GREGORIAN',
    vtimezone, events.join('\r\n'), 'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

function wireSchedule() {
  const banner = document.getElementById('now-banner');
  banner.setAttribute('role', 'button');
  banner.tabIndex = 0;
  banner.setAttribute('aria-label', 'Happening now — tap for the full week schedule');
  banner.addEventListener('click', openSchedule);
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSchedule(); }
  });
  document.getElementById('schedule-close').addEventListener('click', closeSchedule);
  scheduleOverlayEl().querySelector('.schedule-backdrop').addEventListener('click', closeSchedule);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scheduleOverlayEl().hidden) closeSchedule();
  });

  // Swipe-to-dismiss — only from the header (grabber). The scrollable body
  // keeps its own scroll; we never hijack it.
  const header = scheduleOverlayEl().querySelector('.schedule-header');
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  if (header && sheet) {
    let startY = null;
    let dy = 0;
    header.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      dy = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    header.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY); // downward only
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    header.addEventListener('touchend', () => {
      if (startY == null) return;
      sheet.style.transition = '';
      startY = null;
      if (dy > 90) { closeSchedule(); }
      else { sheet.style.transform = ''; } // spring back
    });
  }
}

// ── Settings sheet (gear overlay) ────────────────────────────────
// A bottom sheet holding appearance, sound, and score-entry access —
// controls that used to sit loose in the header — plus the "Stalling
// with Patrick" presenter link (formerly a hidden corner dot). Mirrors
// the schedule sheet's open/close/inert/Escape behavior.
function settingsOverlayEl() {
  return document.getElementById('settings-overlay');
}

// The settings sheet is a jelly-drawer: backdrop, ✕, Escape, focus restore,
// scroll lock, and background inerting are all handled by the component.
// open/close toggle the attribute (works pre-upgrade too — the change is
// buffered and applied when the element registers).
function openSettings() {
  const overlay = settingsOverlayEl();
  if (!overlay) return;
  overlay.setAttribute('open', '');
}

function closeSettings() {
  const overlay = settingsOverlayEl();
  if (!overlay) return;
  overlay.removeAttribute('open');
}

function wireSettings() {
  const btn = document.getElementById('settings-btn');
  if (btn) btn.addEventListener('click', openSettings);
  // Degraded-mode escape hatch: if the Jelly module never loaded, the sheets
  // render via the :not(:defined)[open] fallback CSS and have no ✕/backdrop —
  // let Escape close them. (When the component IS registered it owns Escape.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || customElements.get('jelly-drawer')) return;
    ['settings-overlay', 'history-overlay', 'team-picker-overlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.hasAttribute('open')) el.removeAttribute('open');
    });
  });
}

// ── Change-history sheet (editor-only) ───────────────────────────
// Opened from the Settings sheet; reuses the same overlay/sheet CSS. Manages
// its own open/close state (it does NOT call closeSettings, whose delayed
// finish would clear `inert` out from under this sheet) — it hands off from
// Settings by hiding it instantly, then restores the app on close.
function historyOverlayEl() {
  return document.getElementById('history-overlay');
}

function openHistory() {
  const s = settingsOverlayEl();
  const overlay = historyOverlayEl();
  if (!overlay) return;
  renderHistory();
  const openNow = () => overlay.setAttribute('open', '');
  // Hand off from the Settings drawer: let its teardown finish first so the
  // two drawers' scroll-lock/inert bookkeeping never overlaps. Its 'close'
  // event fires synchronously on a programmatic close, so there's no gap.
  if (s && s.hasAttribute('open') && customElements.get('jelly-drawer')) {
    s.addEventListener('close', openNow, { once: true });
    s.removeAttribute('open');
  } else {
    if (s) s.removeAttribute('open');
    openNow();
  }
}

function renderHistory() {
  const body = document.getElementById('history-body');
  if (!body) return;
  if (!fbRef) {
    body.innerHTML = '<p class="muted">Live sync is off on this device, so there\'s no shared change history to show.</p>';
    return;
  }
  // Skeleton rows while the changelog fetch is in flight — varied widths so
  // the placeholder reads as a list of entries, not a repeated bar.
  body.innerHTML = '<div class="history-skeleton" aria-label="Loading change history">' +
    [92, 68, 84, 58, 76, 88].map((w) =>
      `<jelly-skeleton shape="line" style="width: ${w}%"></jelly-skeleton>`).join('') +
    '</div>';
  firebase.database().ref(dbPath('changelog')).limitToLast(500).once('value')
    .then((snap) => {
      const val = snap.val() || {};
      const rows = Object.keys(val).map((k) => val[k]).filter(Boolean);
      rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      body.innerHTML = rows.length
        ? renderHistoryRows(rows)
        : '<p class="muted">No point changes recorded yet.</p>';
    })
    .catch(() => {
      body.innerHTML = '<p class="muted">Couldn\'t load the history (offline?). Close and reopen to try again.</p>';
    });
}

function renderHistoryRows(rows) {
  let html = '';
  let lastDay = null;
  rows.forEach((r) => {
    const stamp = formatEasternStamp(r.at) || '';
    const comma = stamp.indexOf(',');
    const day = comma > -1 ? stamp.slice(0, comma) : stamp;
    const time = comma > -1 ? stamp.slice(comma + 2) : '';
    if (day !== lastDay) { html += `<div class="cl-day">${esc(day || '—')}</div>`; lastDay = day; }
    const delta = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    const cls = r.delta > 0 ? 'cl-pos' : 'cl-neg';
    const who = r.by ? ` · ${esc(String(r.by))}` : '';
    const emoji = r.teamId ? teamEmoji(r.teamId) : '';
    html += `
      <div class="cl-entry">
        <div class="cl-entry-top">
          <span class="cl-team">${emoji ? emoji + ' ' : ''}${esc(String(r.team || r.teamId || '?'))}</span>
          <span class="cl-delta ${cls}">${esc(delta)} pts</span>
        </div>
        <div class="cl-entry-sub">${esc(String(r.reason || 'Points updated'))} · ${esc(String(r.before))}→${esc(String(r.after))}</div>
        <div class="cl-entry-meta">${esc(time)}${who}</div>
      </div>`;
  });
  return html;
}

// ── Members (Settings → Who can sign in) ─────────────────────────
// Editor-only management of campScoreboard/members — the allowlist the
// security rules check on every read and write. Same drawer pattern as the
// change history. All writes here are themselves rule-checked server-side
// (editors only), so a failure toast means the rules said no, not a bug.

function membersOverlayEl() {
  return document.getElementById('members-overlay');
}

// After adding someone, the app hands the editor a ready-to-send invite to
// paste into their own text/email (the app is a static site and can't send
// mail itself). Set on a successful add, shown at the top of the list until
// dismissed or the next add. Cleared when the drawer is (re)opened so a stale
// invite from earlier doesn't linger.
let lastInvite = null;

// Build the copy-and-send invite for a newly added member. Tailored to how
// they'll sign in (email vs phone) and what their role lets them do.
function inviteText(key, role) {
  const isPhone = String(key)[0] === '+';
  const shown = identityFromKey(key);
  const where = location.origin || 'https://camp.patricksimpson.info';
  const can = role === 'editor'
    ? 'You’ll be able to enter scores and help run the games.'
    : 'You’ll be able to see all the scores, schedule, and standings.';
  const how = isPhone
    ? `Open ${where} on your phone, tap “Alternative sign in” → “Sign in with a phone number”, and enter ${shown}. You’ll get a texted code to finish.`
    : `Open ${where} on your phone and tap “Continue with Google”, then choose your ${shown} account. (No Google account? Tap “Alternative sign in” → “Email me a sign-in link”.)`;
  return `You’re on the Camp scoreboard app! 🏅\n\n${how}\n\n${can}`;
}

function openMembers() {
  if (!canEdit()) return;
  lastInvite = null;
  const s = settingsOverlayEl();
  const overlay = membersOverlayEl();
  if (!overlay) return;
  renderMembers();
  const openNow = () => overlay.setAttribute('open', '');
  if (s && s.hasAttribute('open') && customElements.get('jelly-drawer')) {
    s.addEventListener('close', openNow, { once: true });
    s.removeAttribute('open');
  } else {
    if (s) s.removeAttribute('open');
    openNow();
  }
}

function renderMembers() {
  const body = document.getElementById('members-body');
  if (!body) return;
  if (!fbRef) {
    body.innerHTML = '<p class="muted">Live sync is off on this device, so the member list isn\'t reachable.</p>';
    return;
  }
  body.innerHTML = '<div class="history-skeleton">' +
    [90, 70, 80].map((w) => `<div class="skeleton-row" style="width:${w}%"><jelly-skeleton style="height:2.6rem"></jelly-skeleton></div>`).join('') +
    '</div>';
  // Both camps' lists load side by side. The other camp's read succeeds for
  // anyone who is a member THERE (the list is that camp's staff directory);
  // a refused read simply means "manage this camp only" — the drawer then
  // looks exactly like the single-camp version.
  const other = CAMPS[otherCampId()];
  Promise.all([
    firebase.database().ref(dbPath('members')).once('value').then((s) => s.val() || {}),
    firebase.database().ref(other.dbRoot + '/members').once('value')
      .then((s) => s.val() || {})
      .catch(() => null),
  ])
    .then(([active, others]) => {
      const lists = {};
      lists[CAMP.id] = active;
      lists[other.id] = others; // null ⇒ single-camp view
      renderMemberList(body, lists);
    })
    .catch(() => {
      body.innerHTML = '<p class="muted">Couldn\'t load the member list — check the connection and try again.</p>';
    });
}

// This week's printed counselor roster, per team — per-camp data
// (camps.js); the seed list behind "Add this week's counselors" in the
// Members drawer. They start as PENDING members (a name and a team, no
// sign-in yet). An empty list (senior, for now) hides the button.
const SEED_COUNSELORS = CAMP.seedCounselors;

// Which seed counselors aren't in the member list yet, matched by name
// (case-insensitively) so pressing the button twice doesn't duplicate anyone —
// including someone who has since been given a real email or phone.
function missingSeedCounselors(members) {
  const have = new Set(Object.keys(members || {})
    .map((k) => String((members[k] && members[k].name) || '').trim().toLowerCase())
    .filter(Boolean));
  const out = [];
  SEED_COUNSELORS.forEach(([teamId, names]) => {
    names.forEach((name) => {
      if (!have.has(name.toLowerCase())) out.push({ name, teamId });
    });
  });
  return out;
}

// The team <select> shown on every member row and in the add form.
function memberTeamSelectHTML(cls, teamId, label) {
  return `<jelly-select class="${cls}" placeholder="— no team —" ${isTeamId(teamId) ? `value="${esc(teamId)}"` : ''} label="${esc(label)}" size="small">
    <jelly-option value="">— no team —</jelly-option>
    ${state.teams.map((t) => `<jelly-option value="${t.id}">${teamEmoji(t.id)} ${esc(t.name)}</jelly-option>`).join('')}
  </jelly-select>`;
}

// This account's role at a given camp — the active camp's is live state,
// the other camp's comes from the one-shot probe (or its cached hint).
function campRoleOf(campId) {
  if (campId === CAMP.id) return memberRole;
  if (otherCampRole) return otherCampRole;
  const h = readCampsHint()[campId];
  return h === 'editor' || h === 'viewer' ? h : null;
}

// One person per row, however many camps they're on: fold the per-camp
// member lists into { key, camps: { junior: rec|null, senior: rec|null } },
// sorted by display name. Pure — pinned by tests/camps.test.js.
function mergeMemberLists(lists) {
  const rows = new Map();
  Object.keys(CAMPS).forEach((cid) => {
    Object.keys(lists[cid] || {}).forEach((key) => {
      if (!rows.has(key)) rows.set(key, { key, camps: { junior: null, senior: null } });
      rows.get(key).camps[cid] = lists[cid][key];
    });
  });
  const nameOf = (r) => String((r.camps.junior && r.camps.junior.name) ||
    (r.camps.senior && r.camps.senior.name) || identityFromKey(r.key));
  return [...rows.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

// The path to one camp's record for a key — the ONLY place a cross-camp
// members write is spelled out.
function campMembersPath(campId, key) {
  return CAMPS[campId].dbRoot + '/members/' + key;
}

function renderMemberList(body, lists) {
  const myKey = identityKey(authUser);
  const crossCamp = !!lists[otherCampId()]; // other list readable ⇒ show both columns
  const campIds = crossCamp ? ['junior', 'senior'] : [CAMP.id];
  const merged = mergeMemberLists(crossCamp ? lists : { [CAMP.id]: lists[CAMP.id] });

  const rows = merged.map(({ key, camps }) => {
    const activeRec = camps[CAMP.id];
    const anyRec = activeRec || camps[otherCampId()] || {};
    const self = key === myKey;
    const pending = isPendingKey(key);
    const isPhone = String(key)[0] === '+';
    const displayName = anyRec.name || identityFromKey(key);
    const idLine = pending
      ? `<span class="member-email member-pending">⏳ No sign-in yet — <button type="button" class="link-btn member-add-signin">add email or phone</button></span>`
      : (anyRec.name ? `<span class="member-email">${isPhone ? '📱 ' : ''}${esc(identityFromKey(key))}</span>` : '');

    // Per-camp access. Pending rows live in ONE camp only (their key means
    // nothing to the other camp until a real sign-in exists), so they keep
    // the simple single-camp role control.
    let accessHTML;
    if (pending) {
      accessHTML = `<jelly-segmented class="member-role" size="small" label="Role" value="${anyRec.role === 'editor' ? 'editor' : 'viewer'}" ${self ? 'disabled' : ''}>
          <jelly-segment value="viewer">👀 Viewer</jelly-segment>
          <jelly-segment value="editor">✏️ Editor</jelly-segment>
        </jelly-segmented>
        <button type="button" class="link-btn danger-link member-remove">Remove</button>`;
    } else {
      accessHTML = campIds.map((cid) => {
        const rec = camps[cid];
        const value = rec ? (rec.role === 'editor' ? 'editor' : 'viewer') : 'none';
        // You can only change a camp you're an editor OF; your own access is
        // always someone else's job to change.
        const disabled = self || campRoleOf(cid) !== 'editor';
        const label = crossCamp
          ? `<span class="member-access-camp">${cid === 'senior' ? '🚩 Senior' : '🛡️ Junior'}</span>`
          : '';
        return `<div class="member-access-row">
          ${label}
          <jelly-segmented class="member-access" size="small" label="${esc(CAMPS[cid].label)} access" value="${value}" data-camp-id="${cid}" ${disabled ? 'disabled' : ''}>
            <jelly-segment value="none">None</jelly-segment>
            <jelly-segment value="viewer">Viewer</jelly-segment>
            <jelly-segment value="editor">Editor</jelly-segment>
          </jelly-segmented>
        </div>`;
      }).join('');
    }

    // The team lives on the ACTIVE camp's record (each camp has its own
    // teams) — set the other camp's team from inside that camp.
    const teamHTML = !pending && activeRec
      ? memberTeamSelectHTML('member-team', activeRec.teamId, displayName + ' team')
      : '';

    return `<div class="member-row${pending ? ' member-row-pending' : ''}" data-member-key="${esc(key)}">
      <div class="member-id">
        <span class="member-name">${esc(displayName)}${self ? ' <span class="member-you">(you)</span>' : ''}</span>
        ${idLine}
      </div>
      <div class="member-controls">
        ${accessHTML}
        ${teamHTML}
      </div>
      ${self ? '<p class="muted member-self-note">That\'s you — another editor has to change or remove your access.</p>' : ''}
    </div>`;
  }).join('');

  const inviteBanner = lastInvite ? `
    <div class="member-invite">
      <div class="member-invite-head">
        <span class="member-invite-title">✅ Added — send them this</span>
        <button type="button" class="member-invite-dismiss" aria-label="Dismiss">✕</button>
      </div>
      <p class="muted member-invite-note">The app can't email people itself, so copy this and send it however you like (text, email, group chat).</p>
      <textarea class="member-invite-text" id="member-invite-text" rows="6" readonly>${esc(lastInvite)}</textarea>
      <jelly-button class="secondary-btn" variant="primary" id="member-invite-copy" block>📋 Copy invite</jelly-button>
    </div>` : '';

  const missing = missingSeedCounselors(lists[CAMP.id]);
  const seedBlock = missing.length ? `
    <div class="member-seed">
      <p class="muted">Not everyone's on the list yet. Add this week's ${missing.length} missing counselor${missing.length === 1 ? '' : 's'} by name and team — they'll sit here as “no sign-in yet” until you add each person's email or phone.</p>
      <jelly-button id="member-seed-btn" class="secondary-btn" variant="platinum" block>👥 Add this week's counselors</jelly-button>
    </div>` : '';

  // The add form can grant the other camp too — but only when this editor
  // can actually write there.
  const canAddBoth = crossCamp && campRoleOf(otherCampId()) === 'editor';
  const addCampsHTML = canAddBoth ? `
        <div class="form-field">
          <label class="form-label">Camps</label>
          <jelly-segmented id="member-add-camps" size="small" label="Camps" value="active">
            <jelly-segment value="active">${CAMP.id === 'senior' ? '🚩' : '🛡️'} ${esc(CAMP.label.replace(' Camp', ''))} only</jelly-segment>
            <jelly-segment value="both">⛺ Both camps</jelly-segment>
          </jelly-segmented>
        </div>` : '';

  const crossSub = crossCamp
    ? `<p class="muted members-sub">Each person has a switch per camp: <strong>None</strong> (can't open that camp at all), <strong>Viewer</strong>, or <strong>Editor</strong>. Someone on both camps picks between them in the app.</p>`
    : '';

  body.innerHTML = `
    <p class="muted members-sub">Everyone here can open the app. Viewers can look; editors can change scores and manage this list. Anyone not on the list gets nothing — the database itself refuses them.</p>
    ${crossSub}
    <p class="muted members-sub">Giving someone a <strong>team</strong> does two things: the app opens on that team for them, and — if they're an editor — it keeps them out of scoring the rounds their own team is in. Teams are per-camp; this drawer sets their ${esc(CAMP.label)} team.</p>
    ${inviteBanner}
    <div class="member-list">${rows || '<p class="muted">Nobody yet.</p>'}</div>
    ${seedBlock}
    <div class="member-add">
      <h3>Add someone</h3>
      <div class="form-field">
        <label class="form-label">Email or phone number</label>
        <jelly-input class="form-input" id="member-add-id" type="text" placeholder="name@example.com or 555-123-4567"></jelly-input>
        <p class="muted member-add-hint">Use the email they sign in with — or a phone number if they'll use phone sign-in. Leave it blank to add someone by name now and fill this in later.</p>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Name</label>
          <jelly-input class="form-input" id="member-add-name" type="text" placeholder="First name"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Role</label>
          <jelly-segmented id="member-add-role" size="small" label="Role" value="viewer">
            <jelly-segment value="viewer">👀 Viewer</jelly-segment>
            <jelly-segment value="editor">✏️ Editor</jelly-segment>
          </jelly-segmented>
        </div>
      </div>
      ${addCampsHTML}
      <div class="form-field">
        <label class="form-label">Team (optional)</label>
        ${memberTeamSelectHTML('member-add-team', null, 'Team for the new member')}
      </div>
      <jelly-button id="member-add-btn" class="secondary-btn" variant="primary">+ Add member</jelly-button>
      <p class="entry-error" id="member-add-error" hidden></p>
    </div>`;

  bindMemberList(body, myKey, lists);
}

// Move a pending row (name + team, no sign-in) onto its real email/phone key.
// RTDB keys are immutable, so this is a create-then-delete: write the new key
// first, and only remove the placeholder once that lands — a failure part-way
// leaves the pending row intact rather than losing the person.
function convertPendingMember(key, rec) {
  const raw = (prompt('Email address or phone number for ' + (rec.name || 'this person') + ':', '') || '').trim();
  if (!raw) return;
  let newKey;
  if (raw.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { showToast("That doesn't look like an email address."); return; }
    newKey = emailKey(raw);
  } else {
    newKey = phoneKey(raw);
    if (!newKey) { showToast("That doesn't look like a phone number — include the area code."); return; }
  }
  const role = rec.role === 'editor' ? 'editor' : 'viewer';
  const next = memberRecord(role, rec.name, rec.teamId);
  firebase.database().ref(dbPath('members/' + newKey)).set(next)
    .then(() => firebase.database().ref(dbPath('members/' + key)).remove())
    .then(() => {
      lastInvite = inviteText(newKey, role); // they can sign in now — hand over the invite
      showToast(identityFromKey(newKey) + ' can now sign in', { mine: true });
      renderMembers();
    })
    .catch(() => showToast('Change refused — are you still an editor?'));
}

function bindMemberList(body, myKey, lists) {
  const activeMembers = lists[CAMP.id] || {};
  body.querySelectorAll('.member-row').forEach((row) => {
    const key = row.dataset.memberKey;
    const self = key === myKey;
    const camps = {
      junior: (lists.junior && lists.junior[key]) || null,
      senior: (lists.senior && lists.senior[key]) || null,
    };
    const rec = camps[CAMP.id] || camps[otherCampId()] || {};
    const who = rec.name || identityFromKey(key);

    // Pending rows keep the simple single-camp role control.
    const roleSeg = row.querySelector('.member-role');
    if (roleSeg) {
      roleSeg.addEventListener('change', (e) => {
        const role = e.detail && e.detail.value;
        if (self || !role || (role !== 'viewer' && role !== 'editor')) return;
        firebase.database().ref(dbPath('members/' + key + '/role')).set(role)
          .then(() => showToast(`${who} is now a ${role}`, { mine: true }))
          .catch(() => { showToast('Change refused — are you still an editor?'); renderMembers(); });
      });
    }

    // The per-camp access switches. None ⇒ remove that camp's record (with a
    // confirm); Viewer/Editor on an existing record ⇒ role child write;
    // Viewer/Editor where there is no record ⇒ grant (write a fresh record,
    // carrying the name over from their other-camp record).
    row.querySelectorAll('.member-access').forEach((seg) => {
      seg.addEventListener('change', (e) => {
        const value = e.detail && e.detail.value;
        const cid = seg.dataset.campId;
        if (self || !cid || !CAMPS[cid] || !value) return;
        const existing = camps[cid];
        const label = CAMPS[cid].label;
        const fail = () => { showToast(`Change refused — are you still an editor at ${label}?`); renderMembers(); };
        if (value === 'none') {
          if (!existing) return; // nothing to remove
          if (!confirm(`Remove ${who} from ${label}? They lose access to it the moment this saves.`)) { renderMembers(); return; }
          firebase.database().ref(campMembersPath(cid, key)).remove()
            .then(() => { showToast(`${who} removed from ${label}`, { mine: true }); renderMembers(); })
            .catch(fail);
        } else if (value === 'viewer' || value === 'editor') {
          if (existing) {
            firebase.database().ref(campMembersPath(cid, key) + '/role').set(value)
              .then(() => { showToast(`${who} is now a ${value} at ${label}`, { mine: true }); renderMembers(); })
              .catch(fail);
          } else {
            // teamId deliberately not carried over — teams differ per camp.
            firebase.database().ref(campMembersPath(cid, key)).set(memberRecord(value, rec.name))
              .then(() => { showToast(`${who} can now sign in to ${label}`, { mine: true }); renderMembers(); })
              .catch(fail);
          }
        }
      });
    });

    // Team: a child write, so the parent .validate doesn't re-run. Clearing it
    // is a remove() — RTDB has no "present but empty" for a string.
    const teamSel = row.querySelector('.member-team');
    if (teamSel) {
      teamSel.addEventListener('change', () => {
        const teamId = teamSel.value || '';
        const ref = firebase.database().ref(dbPath('members/' + key + '/teamId'));
        const done = () => {
          showToast(isTeamId(teamId) ? `${who} is with ${teamName(teamId)}` : `${who} has no team`, { mine: true });
          renderMembers();
        };
        (isTeamId(teamId) ? ref.set(teamId) : ref.remove())
          .then(done)
          // A refusal here usually means the database rules predate team
          // assignments and still reject an unknown `teamId` field.
          .catch(() => { showToast("Couldn't save the team — the database rules may need updating."); renderMembers(); });
      });
    }

    const convert = row.querySelector('.member-add-signin');
    if (convert) convert.addEventListener('click', () => convertPendingMember(key, camps[CAMP.id] || rec));

    // Pending rows only (real rows retire via the per-camp None switch).
    const rm = row.querySelector('.member-remove');
    if (rm) {
      rm.addEventListener('click', () => {
        if (self) return;
        if (!confirm(`Remove ${who}? They lose access the moment this saves.`)) return;
        firebase.database().ref(dbPath('members/' + key)).remove()
          .then(() => { showToast('Removed', { mine: true }); renderMembers(); })
          .catch(() => showToast('Remove refused — are you still an editor?'));
      });
    }
  });

  // One write for the whole seed list — a multi-path update, so it either all
  // lands or none of it does.
  const seedBtn = document.getElementById('member-seed-btn');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      const missing = missingSeedCounselors(activeMembers);
      if (!missing.length) { renderMembers(); return; }
      const patch = {};
      missing.forEach((c) => { patch[pendingKey(c.name)] = memberRecord('viewer', c.name, c.teamId); });
      firebase.database().ref(dbPath('members')).update(patch)
        .then(() => { showToast(`Added ${missing.length} counselor${missing.length === 1 ? '' : 's'}`, { mine: true }); renderMembers(); })
        // Same caveat as the team select: pre-team rules reject both the
        // `teamId` field and the `pending-…` keys these rows use.
        .catch(() => showToast("Couldn't add them — the database rules may need updating."));
    });
  }

  const addBtn = document.getElementById('member-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const errEl = document.getElementById('member-add-error');
      const raw = (document.getElementById('member-add-id').value || '').trim();
      const name = (document.getElementById('member-add-name').value || '').trim();
      const roleSeg = document.getElementById('member-add-role');
      const teamSel = document.getElementById('member-add-team') || body.querySelector('.member-add-team');
      const campsSeg = document.getElementById('member-add-camps');
      const teamId = (teamSel && teamSel.value) || '';
      const role = (roleSeg && roleSeg.value) === 'editor' ? 'editor' : 'viewer';
      const bothCamps = !!(campsSeg && campsSeg.value === 'both');
      // Auto-detect: anything with an @ is an email; a blank field means
      // "by name for now" (a pending row); otherwise a phone number.
      let key, shownId, pending = false;
      if (!raw) {
        if (!name) {
          errEl.textContent = 'Give at least a name — or an email/phone to let them sign in.';
          errEl.hidden = false;
          return;
        }
        key = pendingKey(name);
        shownId = name;
        pending = true;
      } else if (raw.includes('@')) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
          errEl.textContent = 'That doesn\'t look like an email address.';
          errEl.hidden = false;
          return;
        }
        key = emailKey(raw);
        shownId = raw;
      } else {
        key = phoneKey(raw);
        if (!key) {
          errEl.textContent = 'That doesn\'t look like a phone number. Include the area code (e.g. 555-123-4567).';
          errEl.hidden = false;
          return;
        }
        shownId = key; // the normalized +E.164 we're about to store — so they can eyeball it
      }
      errEl.hidden = true;
      const writes = [firebase.database().ref(dbPath('members/' + key)).set(memberRecord(role, name, teamId))];
      // "Both camps" also writes the other camp's record (no team — teams
      // are per-camp). A pending row stays single-camp: its random key means
      // nothing to the other camp's list.
      if (bothCamps && !pending) {
        writes.push(firebase.database().ref(campMembersPath(otherCampId(), key)).set(memberRecord(role, name)));
      }
      Promise.all(writes)
        .then(() => {
          showToast(pending ? shownId + ' added — no sign-in yet' : shownId + ' can now sign in', { mine: true });
          // A pending row can't sign in yet, so there's nothing to invite them to.
          lastInvite = pending ? null : inviteText(key, role);
          renderMembers();
        })
        .catch(() => {
          errEl.textContent = 'Add refused — are you still an editor?';
          errEl.hidden = false;
        });
    });
  }

  // Invite banner: copy the ready-made message, or dismiss it.
  const inviteCopy = document.getElementById('member-invite-copy');
  if (inviteCopy) {
    inviteCopy.addEventListener('click', () => {
      copyTextToClipboard(lastInvite || '', inviteCopy);
    });
  }
  const inviteDismiss = body.querySelector('.member-invite-dismiss');
  if (inviteDismiss) {
    inviteDismiss.addEventListener('click', () => { lastInvite = null; renderMembers(); });
  }
}


function wireMembers() {
  const row = document.getElementById('members-row');
  if (row) row.addEventListener('click', openMembers);
}

// The mid-session way to change camps: a Junior/Senior segmented control in
// Settings. Hidden unless this account is on both camps' lists — see
// updateAccountRow. Picking the other camp is the usual set-key-and-reload.
function wireCampSwitcher() {
  const seg = document.getElementById('camp-switch');
  if (seg) {
    seg.addEventListener('change', (e) => {
      const id = e.detail && e.detail.value;
      if (id && id !== CAMP.id) switchCamp(id);
    });
  }
  // However the camp picker closes (choice, backdrop, Escape), the deferred
  // team question gets its turn back.
  const overlay = document.getElementById('camp-picker-overlay');
  if (overlay) overlay.addEventListener('close', () => { maybeShowTeamPicker(); });
}

function wireHistory() {
  const row = document.getElementById('history-row');
  if (row) row.addEventListener('click', openHistory);
  // Backdrop, ✕, and Escape are the drawer's own; no extra wiring needed.
}

// Formats an ISO timestamp as camp time, e.g. "Jul 19, 8:47pm ET" —
// same convention as the schedule banner, so the footer always reads in
// camp time regardless of which timezone a visiting parent's phone is in.
function formatEasternStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}${(get('dayPeriod') || '').toLowerCase()} ET`;
}

// One line: who's here now, when data last changed, what build this is,
// and the Settings link (the header is gone — this is the gear now). The
// presence count lives here and renderPresence just re-renders the footer.
function renderFooter() {
  const el = document.getElementById('app-footer');
  if (!el) return;
  const dataStamp = formatEasternStamp(state.meta && state.meta.lastDataChangeAt);
  const bits = [];
  if (syncEnabled() && presenceCount > 0) {
    bits.push(`<span title="${presenceCount} device${presenceCount === 1 ? '' : 's'} here now">👥 ${presenceCount} here</span>`);
  }
  // Which camp this page is: always shown on senior (so the two apps are
  // never confused), and tappable to switch when the account has both.
  if (hasBothCamps()) {
    bits.push(`<button id="footer-camp-chip" class="footer-link" aria-label="Switch camp">${CAMP.id === 'senior' ? '🚩' : '🛡️'} ${esc(CAMP.label)} ⇄</button>`);
  } else if (CAMP.id === 'senior') {
    bits.push(`<span>🚩 ${esc(CAMP.label)}</span>`);
  }
  bits.push(`📋 Data: ${dataStamp ? esc(dataStamp) : 'no scores yet'}`);
  bits.push(`<span title="Code last updated: ${esc(formatEasternStamp(CODE_UPDATED_AT) || 'unknown')}">🛠️ v${APP_VERSION}</span>`);
  bits.push(`<button id="settings-btn" class="footer-link" aria-label="Settings">⚙️ Settings</button>`);
  el.innerHTML = `<p class="footer-line">${bits.join(' · ')}</p>`;
  // The line is rebuilt on every render, so rebind here (wireSettings runs
  // once at init, before the first footer render).
  const btn = document.getElementById('settings-btn');
  if (btn) btn.addEventListener('click', openSettings);
  const campChip = document.getElementById('footer-camp-chip');
  if (campChip) campChip.addEventListener('click', () => { openCampPicker(); });
}

// ── State ────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Could not load saved state, starting fresh.', e);
  }
  return null;
}

function makeFreshState() {
  return {
    config: CAMP.defaultConfig(), // editable days/games catalog (Settings → Set up the week)
    teams: DEFAULT_TEAM_NAMES.map((name, i) => ({ id: 't' + i, name, counselor: DEFAULT_COUNSELORS[i] })),
    results: {},   // gameId -> { medals: {gold, silver, bronze}, scores?, savedAt }
    brackets: {},  // gameId -> in-progress tournament
    drafts: {},    // gameId -> in-progress tally/placement entry
    bonuses: {},   // bonusId -> { teamId, category, label, points, at }
    picSetup: {},  // gameId -> { source: 'pregenerated'|'own'|'numbered', words: [] } (Pictionary item source)
    live: {},      // gameId -> { key, inning, hr } live match tally (synced so everyone can watch)
    clocks: {},    // gameId -> { running, endAt, remaining, duration } synced game clock
    announcements: {}, // annId -> { id, text, at, by, ttlMs } broadcast messages; expire ttlMs after `at` (1h default)
    ui: { day: null, gameId: null }, // day is filled in by migrateState (needs config)
    theme: null,
  };
}

// The selected day is a config day id ('d1'...). Prefer the config day whose
// dow matches today in camp time; otherwise the first configured day.
function defaultDay(config) {
  const days = (config && config.days) || [];
  const todayDow = campNow().dow; // camp time (America/New_York), 0 Sun .. 6 Sat
  const today = days.find((d) => d.dow === todayDow);
  if (today) return today.id;
  return days.length ? days[0].id : null;
}

// Upgrades older-shaped state (or an imported backup) in place so the rest
// of the app only ever sees the current shape. Game ids never change here —
// saved results/brackets/picSetup stay keyed correctly. Also heals RTDB's
// empty-array pruning on config (games, days, rules), mirroring what
// normalizeSyncedState() does for the score state.
function migrateState(s) {
  let changed = false;
  if (!s.config || typeof s.config !== 'object') {
    s.config = CAMP.defaultConfig();
    changed = true;
  }
  const c = s.config;
  if (!c.version) { c.version = 1; changed = true; }
  if (!Array.isArray(c.games)) { c.games = []; changed = true; }
  if (!Array.isArray(c.days)) { c.days = []; changed = true; }
  if (!Array.isArray(c.sessions) || !c.sessions.length) {
    c.sessions = ['Morning', 'Evening'];
    changed = true;
  }
  c.games.forEach((g) => {
    if (g.day !== undefined) {
      if (!g.dayId) g.dayId = 'd' + g.day;
      delete g.day;
      changed = true;
    }
    if (!Array.isArray(g.rules)) { g.rules = []; changed = true; }
    g.rules.forEach((sec) => {
      if (!Array.isArray(sec.items)) { sec.items = []; changed = true; }
    });
  });
  // One-shot catalog upgrades. The stored/synced config (campScoreboard/config)
  // overrides defaults.js on every device, so editing a game's defaults there
  // never reaches an existing week — these back-fills do, then push themselves
  // up via applyRemoteConfig/saveConfig. Guarded by c.version so a later manual
  // edit (e.g. removing the timer) isn't undone on the next load.
  if ((c.version || 1) < 2) {
    const ww = c.games.find((g) => g.id === 'waiter-water-chain');
    if (ww && !ww.timer) ww.timer = { label: 'Game clock', presets: [600] };
    c.version = 2;
    changed = true;
  }
  if ((c.version || 1) < 3) {
    // Counselor Hide and Seek: score buttons are +5 (counselor) / +1, with a
    // single −1 button (was +5/+10, then briefly +5/+1 with a −5 button — a
    // defaults.js-only edit made before this migration system existed, so it
    // likely never reached the synced config either). Force the final shape
    // directly rather than special-casing the intermediate state.
    const hs = c.games.find((g) => g.id === 'counselor-hide-seek');
    if (hs) {
      hs.counterSteps = [1, 5];
      hs.counterStepLabels = { 5: 'counselor' };
    }
    c.version = 3;
    changed = true;
  }
  if ((c.version || 1) < 4) {
    // Counselor Hide and Seek: all teams play at once (no bracket), so give it
    // the same all-teams liveRankings treatment as Inflatable Bowling/Cider
    // Survivor — it now shows up in "Live Now" (home screen, big board when
    // nothing else is live) with every team's running score, updating in real
    // time as the ref taps points, plus its game clock. Previously it had no
    // live-now presence at all while a game was in progress.
    const hs2 = c.games.find((g) => g.id === 'counselor-hide-seek');
    if (hs2) hs2.liveRankings = true;
    c.version = 4;
    changed = true;
  }
  if ((c.version || 1) < 5) {
    // Patrick's call, Thursday evening 2026-07-23: everything tonight and all
    // of Friday counts DOUBLE (meal cleanup excluded — that's handled in
    // bonusCountsDouble, not here). Flag Thursday-evening games and every
    // Friday game. Because medalCounts() weights at computation time, this
    // retroactively doubles already-saved results (Counselor Hide and Seek).
    // Friday's morning games were already flagged; this catches Team Skits
    // and any games added/moved since.
    const doubleDayIds = { evening: [], all: [] };
    (c.days || []).forEach((d) => {
      if (d.dow === 4) doubleDayIds.evening.push(d.id);
      if (d.dow === 5) doubleDayIds.all.push(d.id);
    });
    c.games.forEach((g) => {
      if (doubleDayIds.all.includes(g.dayId) ||
          (doubleDayIds.evening.includes(g.dayId) && g.session === 'Evening')) {
        g.messtival = true;
      }
    });
    c.version = 5;
    changed = true;
  }
  if (!s.ui) { s.ui = { day: null, gameId: null }; changed = true; }
  if (typeof s.ui.day === 'number') { s.ui.day = 'd' + s.ui.day; changed = true; }
  if (!s.ui.day || !c.days.some((d) => d.id === s.ui.day)) {
    s.ui.day = defaultDay(c);
    changed = true;
  }
  return changed;
}

let state = loadState() || makeFreshState();
if (!state.teams || !state.results) state = makeFreshState();
if (!state.ui) state.ui = { day: null, gameId: null };
if (!state.meta) state.meta = {};
if (!state.bonuses) state.bonuses = {}; // extra/bonus points ledger
if (!state.live) state.live = {}; // live match tallies (synced; see liveTracker)
if (!state.clocks) state.clocks = {}; // per-game synced clocks (see getClock/setClock)
if (!state.announcements) state.announcements = {}; // broadcast messages (see renderAnnouncements)
// state.notice is the big top-of-page notice board (see defaultNotice); it's
// seeded to the example DRAFT by normalizeNotice, so nothing shows until posted.
if (state.theme === undefined) state.theme = null; // pre-theme saves: follow the device
if (state.notify === undefined) state.notify = false; // device-local, not synced (see SYNC_KEYS)
// state.followTeam stays `undefined` until the picker is answered (a team id,
// or null for "neutral/no team") — device-local, not synced.
// state.identity is the counselor this device belongs to, and is deliberately
// left tri-state (device-local, not synced): `undefined` = never asked (so we
// can proactively prompt on next launch), `null` = asked and skipped ("just
// cheering"), or a name string. JSON.stringify drops undefined, so "never
// asked" round-trips through localStorage naturally — same as followTeam.
if (migrateState(state)) {
  // Persist the upgraded shape right away (saveState() isn't safe yet —
  // the sync globals below haven't been initialized at this point).
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
normalizeSyncedState();

// Who's with this team, everywhere the app names a team's counselors. The
// member directory is the live truth once anyone is assigned to a team in
// Settings → Who can sign in; the hand-typed team.counselor text is the
// fallback for teams nobody has been assigned to yet (and for the moment
// before the directory loads).
function counselorName(id) {
  const staff = teamStaffNames(id);
  if (staff.length) return staff.join(', ');
  const t = state.teams.find((t) => t.id === id);
  return t && t.counselor ? t.counselor : '';
}

function saveState() {
  // A save made before the first server snapshot lands is "unsynced local
  // work" — track it so the first snapshot can defend it instead of blindly
  // adopting a stale remote copy (see the initSync merge). Set before the
  // write so a quota/private-mode throw doesn't skip the flag.
  if (!remoteReady) dirtySinceLoad = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Private mode / quota exceeded: cloud + in-memory state still work, so
    // the Save button shouldn't appear dead. Just warn and keep going.
    console.warn('localStorage write failed (private mode or quota?)', e);
  }
  if (!applyingRemote) schedulePush();
}

// Stamps "when real scoreboard data last changed" for the footer — a
// result saved, a bracket match recorded, or a team renamed. Deliberately
// NOT called for view-only actions (day tab, theme, PIN) so it reflects
// actual camp activity, not just page traffic.
function touchData() {
  if (!state.meta) state.meta = {};
  state.meta.lastDataChangeAt = new Date().toISOString();
  dataEditPending = true; // real edit queued — guard it until it's pushed
  joyCelebrate(); // every real data save gets a little celebration
}

// ── Per-card "hide from viewers" (editor-only, synced) ───────────
// state.meta.hiddenCards is a { cardKey: true } map — a card listed there is
// hidden on view-only devices (e.g. suspense before an awards reveal).
// Editors always see every card, each with the switch that governs it. These
// are NOT touchData() moments: a display preference isn't scoreboard
// activity, so they don't bump "Data last updated".
//
// Keys match the data-card attributes in index.html (and the switches'
// data-hide-card). Only cards with a switch can be hidden.
const HIDEABLE_CARDS = ['competitions', 'standings', 'verse', 'cleanup', 'bonus', 'chat'];

function cardHiddenFromViewers(card) {
  const m = state.meta || {};
  if (m.hiddenCards && m.hiddenCards[card]) return true;
  // Legacy single-purpose flag from the standings-only version of this
  // feature. Still honored so a device running the older build that pushes
  // the old shape can't silently un-hide the table mid-camp.
  if (card === 'standings' && m.standingsHidden) return true;
  return false;
}

function toggleCardHidden(card) {
  if (!HIDEABLE_CARDS.includes(card)) return;
  if (!state.meta) state.meta = {};
  const wasHidden = cardHiddenFromViewers(card);
  if (!state.meta.hiddenCards) state.meta.hiddenCards = {};
  if (wasHidden) {
    delete state.meta.hiddenCards[card];
    if (card === 'standings') delete state.meta.standingsHidden; // retire the legacy flag
  } else {
    state.meta.hiddenCards[card] = true;
  }
  saveState();
  renderAll();
}

// Applies every card's hidden state and syncs the switches. Runs from
// renderAll (before renderGameView, which depends on the competitions
// result). Hiding force-closes the card for viewers so a later un-hide
// doesn't surface it already open — matching the closed-by-default rule.
function applyCardVisibility() {
  const editor = canEdit();
  HIDEABLE_CARDS.forEach((key) => {
    const hidden = cardHiddenFromViewers(key);
    const card = document.querySelector(`[data-card="${key}"]`);
    if (card) {
      const hideForMe = hidden && !editor;
      card.hidden = hideForMe;
      if (hideForMe && card.hasAttribute('open')) {
        if (typeof card.toggle === 'function') card.toggle(false);
        else card.removeAttribute('open');
      }
    }
    const sw = document.querySelector(`.hide-card-toggle[data-hide-card="${key}"]`);
    if (sw) sw.toggleAttribute('checked', hidden);
  });
  // A viewer must not keep reading a game detail out of a hidden Competitions
  // card. Cleared here (not saved) so the renderGameView later in this same
  // pass closes the view.
  if (!editor && cardHiddenFromViewers('competitions') && state.ui.gameId) {
    state.ui.gameId = null;
  }
}

// ── Cloud sync (Firebase Realtime Database) ──────────────────────
// Optional. If window.FIREBASE_CONFIG is filled in (firebase-config.js)
// and the SDK loaded, scores sync across every device in real time.
// Otherwise the app runs exactly as before, local-only.

const SYNC_KEYS = ['teams', 'results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'clocks', 'announcements', 'notice'];
let fbRef = null;
// Per-tab id for the "who's here" presence chip — minted once per page load
// (not persisted) so each open tab counts, and cleans up, independently.
const presenceId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : newBonusId();
let presenceCount = 0;
let applyingRemote = false;
let pushTimer = null;
// No pushes until the first server snapshot has landed. Without this, a
// device on slow camp wifi that saves anything (even a day-tab tap) before
// its first sync queues a set() of its stale local state — and the SDK
// delivers that on connect, wiping everyone's newer scores.
let remoteReady = false;
// True once anything has been saved locally before the first snapshot landed.
// Lets the first-snapshot merge defend offline-entered results instead of
// silently replacing them with a stale server copy.
let dirtySinceLoad = false;
// True while a *data* edit (touchData) is queued but not yet pushed. The merge
// uses this — not the raw pushTimer — to decide whether to hold off adopting a
// snapshot, so view-only saves (day tab, theme, notify, follow-team) never
// block an incoming update or its notification.
let dataEditPending = false;
// Count of local writes handed to the server (fbRef.set) that it hasn't
// confirmed committed yet. While offline, a queued set()'s promise stays
// pending, so this stays > 0 — and the merge uses it to refuse to adopt the
// server's PREVIOUS value (the snapshot that re-fires on reconnect) until our
// cached edit has actually uploaded. This is what stops scores being typed /
// saved offline from getting reverted by a stale reconnect snapshot.
let pendingWrites = 0;
// The synced state as we last knew it on the server — the baseline the next
// push diffs against so it writes ONLY the items this device changed (per-path
// update), instead of overwriting the whole tree and clobbering edits another
// device made to other items. null means "resync the whole tree next push"
// (before the first push, or to recover after a failed one). Updated on every
// adopt (in the value handler) and every push.
let lastSyncedTree = null;
// The editable week config (days/games catalog) syncs on its own sibling ref
// (campScoreboard/config) — deliberately OUTSIDE campScoreboard/state so older
// cached clients, and the state node's own key-list bookkeeping (SYNC_KEYS /
// SYNC_ITEM_MAPS / the merge's replace list), never have to know about it.
// Whole-object last-write-wins: with one or two editors that's acceptable, and
// builder inputs commit on change/blur so the write window stays small.
let fbConfigRef = null;
let pushConfigTimer = null;
let applyingRemoteConfig = false;
// A remote config that arrived while the builder had a focused input — applied
// on focusout instead of mid-typing (see the flush wiring in init()).
let pendingRemoteConfig = null;

// ── Shared clock reference ───────────────────────────────────────
// The synced game clock stores an absolute `endAt` and every device counts down
// to it locally (see getClock/clockRemaining) — which silently assumed every
// phone agreed on the current time. They don't: a handset whose clock is a
// couple of minutes off showed a countdown that far wrong on the Big Board, and
// a second EDITOR device with a fast clock would hit zero early, sound the
// buzzer, and stop the synced clock for everyone.
//
// RTDB publishes the difference between the server's clock and this device's at
// `.info/serverTimeOffset`, so serverNow() is the same instant on every device
// that has ever connected. With sync off (or before the first connect) the
// offset is 0 and this is exactly Date.now() — identical to the old behavior.
let serverTimeOffset = 0;

function serverNow() {
  return Date.now() + serverTimeOffset;
}

function syncEnabled() {
  return !!fbRef;
}

function applyRemoteConfig(remote) {
  const beforeJson = JSON.stringify(state.config);
  applyingRemoteConfig = true;
  state.config = remote;
  const upgraded = migrateState(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  applyingRemoteConfig = false;
  if (upgraded) schedulePushConfig();
  if (appStarted && JSON.stringify(state.config) !== beforeJson) renderAll();
}

// Settings code calls this after mutating state.config.
function saveConfig() {
  state.config.updatedAt = new Date().toISOString();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  if (!applyingRemoteConfig) schedulePushConfig();
}

function schedulePushConfig() {
  if (!fbConfigRef) return;
  clearTimeout(pushConfigTimer);
  // Null the handle when it fires (mirrors schedulePush) — its non-null-ness
  // means "a config edit is queued but unsent", which defers remote applies.
  pushConfigTimer = setTimeout(() => { pushConfigTimer = null; pushConfig(); }, 400);
}

function pushConfig() {
  if (!fbConfigRef || applyingRemoteConfig) return;
  // JSON round-trip strips any `undefined` (which Realtime DB rejects).
  fbConfigRef.set(JSON.parse(JSON.stringify(state.config))).catch((e) => console.warn('config push failed', e));
}

// ── Adopting a remote snapshot ───────────────────────────────────
// Split out of the fbRef listener so the merge is one named, testable unit
// (tests/sync.test.js drives it directly) and so a snapshot we had to defer
// can be picked up again later.

// True when it's safe to replace local synced state with the server's copy.
// Adopting is UNSAFE while either:
//   • the editor is mid-entry — a score/name input is focused, or a data edit
//     is typed/queued but not yet pushed (editorMidEntry), or
//   • we have a local write the server hasn't confirmed yet (pendingWrites > 0)
//     — e.g. scores entered offline and still queued.
// Without this guard a reconnect re-fires the server's PREVIOUS value and the
// merge replaces state.drafts/results with it, reverting the scores being typed
// (a later Save then persists the reverted values and teams lose points).
// View-only saves (day tab, theme, notify, follow-team) don't trip
// editorMidEntry, so they never block an incoming update.
function canAdoptRemote() {
  return !editorMidEntry() && pendingWrites === 0;
}

// Set when a snapshot arrived that we couldn't safely adopt. RTDB only fires
// `value` again when the server data CHANGES, so a deferred snapshot used to be
// dropped outright: a phone left sitting with a score input focused could stay
// silently stale for the rest of a game. Instead of stashing the (possibly
// superseded) payload, we remember that we owe ourselves a read and re-fetch
// the current value once this device goes idle — so what lands is always the
// server's latest, never a stale replay.
let syncDenied = false; // a live listener was cancelled by the rules (access revoked)
let remoteRefetchPending = false;
let idleRetryTimer = null;

// Arm (or keep) the once-a-second idle check that drains whatever we deferred.
// The week-config listener arms it too: its pendingRemoteConfig stash was only
// ever flushed by a focusout inside the builder, so a config edit that arrived
// while a *scoreboard* input was focused sat unapplied indefinitely.
function armIdleRetry() {
  if (!idleRetryTimer) idleRetryTimer = setInterval(idleRetryTick, 1000);
}

function deferRemoteSnapshot() {
  remoteRefetchPending = true;
  armIdleRetry();
}

function clearDeferredSnapshot() {
  remoteRefetchPending = false;
}

function idleRetryTick() {
  if (!remoteRefetchPending && !pendingRemoteConfig) {
    clearInterval(idleRetryTimer);
    idleRetryTimer = null;
    return;
  }
  if (!canAdoptRemote()) return; // still mid-entry / mid-push — check again next tick
  if (pendingRemoteConfig) {
    const rc = pendingRemoteConfig;
    pendingRemoteConfig = null;
    applyRemoteConfig(rc);
  }
  if (remoteRefetchPending && fbRef) {
    clearDeferredSnapshot();
    fbRef.once('value')
      .then((snap) => handleRemoteSnapshot(snap.val()))
      .catch(() => { /* offline — the live listener will fire again on reconnect */ });
  } else {
    clearDeferredSnapshot();
  }
}

// Entry point for every snapshot, live or re-fetched.
function handleRemoteSnapshot(remote) {
  const firstSnapshot = !remoteReady;
  remoteReady = true; // server truth received — pushes may flow now
  if (!remote) { pushState(); return; } // seed an empty database
  // Defend offline-entered work: if this is the very first snapshot and we
  // saved something locally before it arrived, and our data is strictly
  // newer than the server's, push local instead of adopting remote — which
  // would otherwise wipe a result entered on dead wifi. Timestamps use the
  // synced meta.lastDataChangeAt (touchData) so only real data edits win.
  if (firstSnapshot && dirtySinceLoad) {
    const localAt = state.meta && state.meta.lastDataChangeAt;
    const remoteAt = remote.meta && remote.meta.lastDataChangeAt;
    if (localAt && (!remoteAt || localAt > remoteAt)) {
      pushState();
      return;
    }
  }
  // The first snapshot is handled by dirtySinceLoad above; any later one waits
  // for this device to be idle (see canAdoptRemote / deferRemoteSnapshot).
  if (!firstSnapshot && !canAdoptRemote()) { deferRemoteSnapshot(); return; }
  applyRemoteState(remote);
}

function applyRemoteState(remote) {
  clearDeferredSnapshot(); // this snapshot supersedes any read we still owed
  applyingRemote = true;
  // Signature of the synced slice before applying this snapshot. RTDB fires
  // a local `value` event for our own set(), so most snapshots are pure
  // echoes — re-rendering on those blurs the tally/bonus inputs and
  // dismisses the iOS keyboard mid-entry. Skip renderAll when nothing
  // actually changed (below).
  const beforeSig = syncSignature();
  // The snapshot is the entire synced tree, so a key missing from it
  // means "empty" — RTDB prunes empty objects on write. Treating
  // missing as keep-local made "New week (reset)" un-syncable: other
  // devices kept their old results and re-pushed them later. Teams
  // stay guarded — a snapshot without a roster is malformed.
  if (remote.teams) state.teams = remote.teams;
  // Announcements as they stood before this snapshot — anything the merge
  // adds beyond these is news worth a toast (see notifyNewAnnouncements).
  const annBefore = state.announcements || {};
  // Pictionary prompt words are never synced (see pushState) — the incoming
  // snapshot carries only each game's mode. Stash this device's own words so
  // the ref's list survives adopting a remote update, then re-attach them to
  // any setup the snapshot still has (a remotely-reset mode drops them too).
  const localPicWords = {};
  Object.keys(state.picSetup || {}).forEach((gid) => {
    const s = state.picSetup[gid];
    if (s && s.words && s.words.length) localPicWords[gid] = s.words;
  });
  ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'clocks', 'announcements', 'notice'].forEach((k) => {
    state[k] = remote[k] !== undefined ? remote[k] : {};
  });
  Object.keys(localPicWords).forEach((gid) => {
    if (state.picSetup[gid]) state.picSetup[gid].words = localPicWords[gid];
  });
  // Realtime Database silently drops empty arrays/nulls on write, so a
  // freshly-started bracket or Pictionary round can come back missing
  // its empty fields. Heal everything the instant remote data lands,
  // before any render sees it.
  normalizeSyncedState();
  // We now match the server, so this snapshot becomes the diff baseline —
  // otherwise the next push would re-send data we just received.
  lastSyncedTree = syncedSnapshot();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  applyingRemote = false;
  if (appStarted && syncSignature() !== beforeSig) {
    remoteJustApplied = true; // let renderStandings pulse rows that changed
    const matchupChanges = detectMatchupChanges();
    renderAll();
    notifyMatchupChanges(matchupChanges);
    notifyNewAnnouncements(annBefore);
  }
}

// One-shot wrapper around initSync — THE only sanctioned way in. Called from
// onMemberSnapshot's approved branch, never earlier: under the locked rules a
// listener attached before approval is cancelled, and a cancelled read is
// terminal (see the fbRef error callback below).
let syncStarted = false;

function startSync() {
  if (syncStarted) return;
  syncStarted = true;
  initSync();
}

function initSync() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || typeof firebase === 'undefined') {
    updateSyncIndicator();
    return; // local-only mode
  }
  try {
    // (firebase.initializeApp happens in startAuth() — auth needs the app
    // object before the database does.)
    fbRef = firebase.database().ref(dbPath('state'));
    updateSyncIndicator(); // sync is on but unconfirmed — show "Connecting…"
    fbRef.on('value', (snap) => {
      handleRemoteSnapshot(snap.val());
    }, (err) => {
      // A cancelled read is terminal — the SDK won't re-arm it. Since refs
      // only ever attach AFTER membership was confirmed, landing here means
      // access was revoked mid-session (the member listener delivers the
      // actual kick); tell the truth in the indicator either way.
      console.warn('Firebase read failed, staying local', err);
      fbRef = null;
      fbConnected = false;
      syncDenied = true;
      updateSyncIndicator();
    });
    // Shared clock reference for the synced game clocks (see serverNow). Fires
    // once shortly after connect and again whenever the estimate is refined.
    firebase.database().ref('.info/serverTimeOffset').on('value', (s) => {
      const off = Number(s.val());
      if (!Number.isFinite(off)) return;
      const changed = Math.abs(off - serverTimeOffset) > 500;
      serverTimeOffset = off;
      // A big correction means every visible countdown was wrong — repaint now
      // rather than waiting for the next 500ms tick to creep it into place.
      if (changed && appStarted) tickBoardClocks();
    }, () => { /* rules/offline — stay on device time */ });
    // Honest connection state: RTDB's .info/connected flips as wifi comes and
    // goes, so the indicator can say "Offline — will sync when back" instead of
    // a permanent "Synced".
    firebase.database().ref('.info/connected').on('value', (s) => {
      fbConnected = !!s.val();
      fbConnKnown = true; // first real answer — retire the "Connecting…" spinner
      updateSyncIndicator();
      // Re-register presence on every (re)connect — onDisconnect handlers
      // don't survive a dropped socket, so a reconnect after wifi drops or
      // the phone waking up needs a fresh one each time.
      if (fbConnected) {
        try {
          const presenceRef = firebase.database().ref(dbPath('presence/' + presenceId));
          presenceRef.onDisconnect().remove();
          // Minimal shape on purpose: presence is writable by every member
          // (keys are per-tab UUIDs), so nothing forgeable-looking goes in.
          presenceRef.set({ role: memberRole || 'viewer', at: firebase.database.ServerValue.TIMESTAMP });
        } catch (e) { /* rules may deny this — presence chip just stays hidden */ }
      }
    });
    // Count listener lives here (not inside the connected handler above) so
    // it's registered exactly once — putting it there would re-subscribe on
    // every reconnect and stack up duplicate listeners.
    try {
      firebase.database().ref(dbPath('presence')).on('value', (snap) => {
        presenceCount = snap.numChildren();
        renderPresence();
      });
    } catch (e) { /* ignore — chip just stays hidden */ }
    // Week-config catalog listener (sibling ref — see the fbConfigRef comment).
    fbConfigRef = firebase.database().ref(dbPath('config'));
    fbConfigRef.on('value', (snap) => {
      const remote = snap.val();
      if (!remote) { pushConfig(); return; } // first upgraded client seeds the catalog
      // Held back mid-entry — applied by the builder's focusout flush, or by the
      // idle retry tick if focus never returns to the builder.
      if (editorMidEntry()) { pendingRemoteConfig = remote; armIdleRetry(); return; }
      pendingRemoteConfig = null;
      applyRemoteConfig(remote);
    }, (err) => {
      console.warn('Firebase config read failed, staying local', err);
      fbConfigRef = null;
      syncDenied = true;
      updateSyncIndicator();
    });
    // Staff directory: who's on the camp list and which team each is with.
    // Members may read the whole list (it's the staff roster), and this is
    // what makes the real counselor names show on each team everywhere. Only
    // attached here — i.e. after membership was confirmed — like every other
    // ref. A denial just leaves the hand-typed counselor text in place.
    try {
      firebase.database().ref(dbPath('members')).on('value', (snap) => {
        memberDirectory = snap.val() || {};
        if (appStarted) renderAll();
      }, () => { memberDirectory = null; });
    } catch (e) { /* ignore — counselor text falls back to state.teams */ }
    // Camp Chat listeners (chat.js — the tenth script; typeof-guarded so a
    // build without it still runs). Chat attaches HERE, i.e. only after
    // membership confirmed, and its own error handlers degrade chat only.
    if (typeof initChatSync === 'function') initChatSync();
    // (Auto-reload is handled by startUpdatePolling — a same-origin poll of the
    // deployed index.html — so it works on a single device and doesn't depend on
    // Firebase or another client announcing the build.)
    // Flush a pending debounced push before the page is hidden/suspended. iOS
    // suspends setTimeout when the phone locks, so a result saved right before
    // locking would otherwise strand its 400ms push and never reach the server.
    window.addEventListener('pagehide', flushPendingPush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPendingPush();
    });
    updateSyncIndicator();
  } catch (e) {
    console.error('Firebase init failed, staying local-only', e);
    fbRef = null;
    updateSyncIndicator();
  }
}

function schedulePush() {
  if (!fbRef) return;
  clearTimeout(pushTimer);
  // Null the handle when it fires so `pushTimer !== null` is an accurate
  // "a local write is queued but not yet sent" signal — the remote merge
  // uses it to avoid clobbering an un-pushed edit (see initSync).
  pushTimer = setTimeout(() => { pushTimer = null; pushState(); }, 400); // coalesce rapid edits
}

// The synced form of picSetup: each game's MODE (source) travels so ref
// devices agree on labeling, but the actual Pictionary prompt words never
// leave the device that typed them — they're a surprise and must not be
// broadcast over the shared database. (The built-in list and viewer display
// are handled separately; this keeps custom 'own' words off the wire.)
function picSetupForSync(picSetup) {
  if (!picSetup || typeof picSetup !== 'object') return picSetup;
  const out = {};
  Object.keys(picSetup).forEach((gid) => {
    const s = picSetup[gid];
    out[gid] = (s && typeof s === 'object') ? { source: s.source } : s;
  });
  return out;
}

// Maps written per-child (one path per game/team/bonus) so concurrent edits to
// DIFFERENT items on different devices never overwrite each other. teams/meta
// are small singletons written whole.
const SYNC_ITEM_MAPS = ['results', 'brackets', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'clocks', 'announcements'];
// `live` is NOT here — it's diffed one level deeper (per match field) in
// computeSyncUpdates so concurrent refs don't clobber each other's fields.
// `notice` is a singleton too — one composed card, always written whole.
const SYNC_SINGLETONS = ['teams', 'meta', 'notice'];

// The synced portion of state as it should exist on the server: a deep copy
// with Pictionary words stripped (never synced). Serves as both the push
// source and the diff baseline, so both sides compare like-for-like.
function syncedSnapshot() {
  const snap = {};
  SYNC_KEYS.forEach((k) => { snap[k] = state[k] === undefined ? null : state[k]; });
  snap.picSetup = picSetupForSync(state.picSetup);
  return JSON.parse(JSON.stringify(snap)); // also strips any `undefined` RTDB rejects
}

// Flat RTDB multi-location update (path -> value, or null to delete) covering
// exactly what changed between two synced snapshots. Item maps diff per child;
// singletons diff whole.
function computeSyncUpdates(prev, cur) {
  const up = {};
  SYNC_ITEM_MAPS.forEach((k) => {
    const p = (prev && prev[k]) || {};
    const c = (cur && cur[k]) || {};
    Object.keys(c).forEach((id) => {
      if (JSON.stringify(c[id]) !== JSON.stringify(p[id])) up[k + '/' + id] = c[id];
    });
    Object.keys(p).forEach((id) => {
      if (!(id in c)) up[k + '/' + id] = null; // item deleted (cleared result, removed bonus, …)
    });
  });
  // `live` is diffed one level deeper — per match FIELD — so two refs editing
  // the SAME match don't clobber each other: one bumping a team's score writes
  // only live/{gid}/hr, leaving another ref's live/{gid}/inning (the half)
  // untouched. Previously the whole match object was written on every action,
  // so a score tap re-sent that device's stale inning/half and reverted it. A
  // brand-new pairing (different key) or a mode switch replaces the whole node.
  {
    const p = (prev && prev.live) || {};
    const c = (cur && cur.live) || {};
    Object.keys(c).forEach((gid) => {
      const cm = c[gid], pm = p[gid];
      if (JSON.stringify(cm) === JSON.stringify(pm)) return;
      if (!pm || pm.key !== cm.key || pm.mode !== cm.mode) { up['live/' + gid] = cm; return; }
      Object.keys(cm).forEach((f) => {
        if (JSON.stringify(cm[f]) !== JSON.stringify(pm[f])) up['live/' + gid + '/' + f] = cm[f];
      });
      Object.keys(pm).forEach((f) => {
        if (!(f in cm)) up['live/' + gid + '/' + f] = null;
      });
    });
    Object.keys(p).forEach((gid) => { if (!(gid in c)) up['live/' + gid] = null; });
  }
  SYNC_SINGLETONS.forEach((k) => {
    const pv = prev ? prev[k] : undefined;
    const cv = cur ? cur[k] : undefined;
    if (JSON.stringify(cv) !== JSON.stringify(pv)) up[k] = (cv === undefined ? null : cv);
  });
  return up;
}

function pushState() {
  if (!fbRef || applyingRemote || !remoteReady) return;
  const cur = syncedSnapshot();
  const prevBaseline = lastSyncedTree;
  // First push (or recovering from a failed one): write every top-level key so
  // the server is brought fully in step. Afterwards only changed items go up.
  const updates = prevBaseline
    ? computeSyncUpdates(prevBaseline, cur)
    : SYNC_KEYS.reduce((u, k) => { u[k] = cur[k]; return u; }, {});
  // Adopt `cur` as the new baseline optimistically; restore it on failure so
  // the same changes are re-diffed (and re-sent per-path) next time rather than
  // stranded.
  lastSyncedTree = cur;
  dataEditPending = false; // current state (incl. any edit) is going to the server
  if (!Object.keys(updates).length) return; // nothing actually changed
  // Track the write until the server confirms it. Offline, the promise stays
  // pending (the SDK queues the write and flushes on reconnect), so
  // pendingWrites stays > 0 and the merge won't adopt the stale reconnect
  // snapshot until our cached edit has uploaded. Settle on success AND failure
  // so a rejected write can't wedge sync closed.
  pendingWrites++;
  const settle = () => { pendingWrites = Math.max(0, pendingWrites - 1); };
  fbRef.update(updates).then(settle, (e) => {
    console.warn('sync push failed', e);
    lastSyncedTree = prevBaseline; // re-send these changes (still per-path) next push
    settle();
  });
}

// Cheap content signature of the synced state, used to skip re-rendering on
// snapshot echoes (including our own set()). JSON order is stable because the
// keys come from a fixed array.
function syncSignature() {
  return JSON.stringify(SYNC_KEYS.map((k) => state[k]));
}

// A matchup "slot" — a stable key for one pairing, so a genuinely NEW matchup
// can be told apart from an undo/clear across syncs.
function matchupSlot(aId, bId) {
  if (!aId || !bId) return null;
  return { aId, bId, key: [aId, bId].sort().join('|') };
}

// The upcoming matchups of a game's bracket that are KNOWN right now: the
// current (being called up / played) matchup plus the on-deck matchup when it
// can be determined (a fixed-order Round 1). Works for both fixed-order and
// free-pick brackets — it reads the same currentMatchupOf/nextMatchupOf the
// bracket screens use, so it stays correct now that fixed-order Round 1 no
// longer sets selectedPair.
function upcomingMatchups(g) {
  const raw = state.brackets && state.brackets[g.id];
  if (!raw || g.format !== 'tournament') return [];
  const b = normalizeBracket(raw);
  const out = [];
  const cur = currentMatchupOf(g, b);
  if (cur) out.push(matchupSlot(cur[0], cur[1]));
  const nxt = nextMatchupOf(g, b);
  if (nxt) out.push(matchupSlot(nxt[0], nxt[1]));
  return out.filter(Boolean);
}

// gameId -> [slot,...] snapshot of known upcoming matchups, so a genuinely NEW
// matchup can be told apart from an undo/clear across remote syncs — even for
// a bracket nobody currently has open.
let lastBracketSlots = null;

function detectMatchupChanges() {
  const prev = lastBracketSlots;
  const next = {};
  const changes = [];
  state.config.games.forEach((g) => {
    if (g.format !== 'tournament') return;
    const ups = upcomingMatchups(g);
    next[g.id] = ups;
    if (prev === null) return; // first time: seed, don't fire
    const prevKeys = new Set((prev[g.id] || []).map((s) => s.key));
    ups.forEach((s) => {
      if (!prevKeys.has(s.key)) changes.push({ game: g, aId: s.aId, bId: s.bId });
    });
  });
  lastBracketSlots = next;
  return changes;
}

// The soonest known matchup involving `teamId` (current preferred, then on
// deck) — used by the "Your team" summary card's "Up next" line.
function findNextMatchupFor(teamId) {
  if (!teamId) return null;
  for (const g of state.config.games) {
    if (g.format !== 'tournament' || state.results[g.id]) continue;
    for (const s of upcomingMatchups(g)) {
      if (s.aId === teamId || s.bId === teamId) {
        return { game: g, opponentId: s.aId === teamId ? s.bId : s.aId };
      }
    }
  }
  return null;
}

let fbConnected = false; // live RTDB connection state (.info/connected)
let fbConnKnown = false; // first .info/connected callback received

function updateSyncIndicator() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (syncDenied) {
    // A live listener was cancelled by the security rules — this device's
    // access changed mid-session. The member listener handles the kick; this
    // just keeps the indicator honest until it lands.
    el.textContent = '🔒 Sync blocked — your access changed';
    el.classList.remove('synced');
  } else if (!syncEnabled() && !syncStarted && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && typeof firebase !== 'undefined' && firebase.auth) {
    // Sync exists but hasn't been allowed to attach yet — sign-in and the
    // membership check are still resolving in the background.
    el.innerHTML = '<jelly-spinner type="dots" size="small" label="Connecting"></jelly-spinner> Connecting…';
    el.classList.remove('synced');
  } else if (!syncEnabled()) {
    el.textContent = '📱 This device only';
    el.classList.remove('synced');
  } else if (!fbConnKnown) {
    // Startup gap before Firebase reports the connection state either way —
    // previously blank; a small jelly spinner reads as "working on it".
    el.innerHTML = '<jelly-spinner type="dots" size="small" label="Connecting"></jelly-spinner> Connecting…';
    el.classList.remove('synced');
  } else if (fbConnected) {
    el.textContent = '☁️ Synced';
    el.classList.add('synced');
  } else {
    el.textContent = '⚠️ Offline — will sync when back';
    el.classList.remove('synced');
  }
}

function renderPresence() {
  renderFooter(); // the live "who's here" count renders inside the footer line
}

function teamEmoji(id) {
  return TEAM_EMOJI[id] || '🏳️';
}

// Path to a team's shield crest image, or null if we don't have one for that
// slot (see TEAM_SHIELD) — callers fall back to the emoji.
function teamShield(id) {
  return TEAM_SHIELD[id] || null;
}

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gameById(id) {
  return state.config.games.find((g) => g.id === id);
}

function dayById(id) {
  return state.config.days.find((d) => d.id === id);
}

// ── Sound effects (Web Audio — no files needed) ──────────────────

let audioCtx = null;
let masterGain = null;

function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, startOffset, dur, type, peak) {
  const ac = getAudio();
  if (!ac) return;
  const t0 = ac.currentTime + startOffset;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function soundOn() {
  return state.sound !== false;
}

function playAlarm() {
  if (!soundOn() || !getAudio()) return;
  cutAllSound();
  for (let i = 0; i < 8; i++) { // ~6.5 seconds of hard two-tone beeping
    tone(880, i * 0.8, 0.3, 'square', 0.8);
    tone(660, i * 0.8 + 0.38, 0.3, 'square', 0.8);
  }
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400]);
}

// Drop every scheduled beep by orphaning the master gain node.
function cutAllSound() {
  if (audioCtx && masterGain) {
    masterGain.disconnect();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

function playHighScore() {
  if (!soundOn() || !getAudio()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.5));
  tone(1568, 0.4, 0.35, 'sine', 0.3); // sparkle on top
}

// Quiet two-note chime for a point-change alert about a team you're not following.
function playAlertChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.35);
  tone(1174.66, 0.12, 0.25, 'sine', 0.3);
}

// Brighter three-note chime for an alert about the team you're following.
function playMineChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.4);
  tone(1174.66, 0.11, 0.15, 'sine', 0.4);
  tone(1567.98, 0.22, 0.3, 'sine', 0.4);
}

// ── In-app toasts + subscribe-to-notifications ───────────────────
// No push infra: alerts only fire while the tab is alive on a device, but
// need neither billing nor a server deploy. OS notifications go through the
// notification-only service worker (sw.js — no fetch handler, see its
// header) because Android Chrome and installed-PWA iOS refuse the plain
// Notification constructor. "Mine" alerts (about the followed team) get a
// fuller toast + OS Notification (only when the tab isn't focused, so it
// isn't a redundant second alert) and a brighter chime; everyone else's
// events still show, just quieter. Announcements notify every subscribed
// phone regardless of team.

function showToast(message, opts) {
  const mine = !!(opts && opts.mine);
  // Jelly toaster (the <jelly-toaster position="bottom"> rail in index.html).
  // Falls back to the legacy #toast-container pill if the module hasn't
  // loaded/failed — toasts carry sync errors and must always surface.
  if (window.jellyToast) {
    window.jellyToast(message, { tone: mine ? 'success' : 'info', duration: mine ? 5500 : 4000 });
    return;
  }
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (mine ? ' toast-mine' : '');
  el.textContent = message;
  container.appendChild(el);
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(remove, 250);
  }, mine ? 5500 : 4000);
}

function maybeNativeNotification(title, body, tag) {
  if (!window.Notification || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body, icon: 'apple-touch-icon.png', badge: 'apple-touch-icon.png', tag };
  // Phones need the service-worker path: Chrome on Android throws on the
  // `new Notification()` constructor, and iOS (installed PWA) only shows
  // notifications through a registration. Desktop falls through to the
  // constructor if the sw.js registration isn't there for some reason.
  const viaConstructor = () => { try { new Notification(title, opts); } catch (e) { /* toast already showed */ } };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.showNotification) reg.showNotification(title, opts);
        else viaConstructor();
      }).catch(viaConstructor);
      return;
    }
    viaConstructor();
  } catch (e) { /* no notification support at all — the toast already showed */ }
}

// Turn notifications on (idempotent). Must be called from a user gesture so
// the OS permission prompt + audio unlock are allowed. Caller persists.
function enableNotify() {
  getAudio(); // unlock sound from the triggering user gesture
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  state.notify = true;
  updateNotifyButton();
}

function toggleNotify() {
  if (!state.notify) {
    enableNotify();
    showToast("🔔 You'll get an alert whenever a team's points change, a team is called up next, an announcement is posted, or someone mentions you or your team in Camp Chat — as long as this tab stays open.");
  } else {
    state.notify = false;
    updateNotifyButton();
  }
  saveState();
}

function updateNotifyButton() {
  const btn = document.getElementById('notify-toggle-btn');
  if (!btn) return;
  btn.hidden = !!state.notify;
  btn.textContent = '🔕 Notify me';
  btn.classList.toggle('active', !!state.notify);
  btn.setAttribute('aria-pressed', String(!!state.notify));
}

// changes: [{ team, delta, total }]
function notifyPointChanges(changes) {
  if (!state.notify || !changes.length) return;
  let anyMine = false;
  changes.forEach(({ team, delta, total }) => {
    const mine = team.id === state.followTeam;
    if (mine) anyMine = true;
    const sign = delta > 0 ? '+' : '';
    const msg = `${teamEmoji(team.id)} ${esc(team.name)} ${sign}${delta} pts (now ${total})`;
    showToast(mine ? "Your team scored! " + msg : msg, { mine });
    if (mine) maybeNativeNotification('🏅 Your team scored!', msg, 'camp-points-' + team.id);
  });
  if (anyMine) playMineChime(); else playAlertChime();
}

// changes: [{ game, stage, aId, bId }]
function notifyMatchupChanges(changes) {
  if (!state.notify || !changes.length) return;
  let anyMine = false;
  changes.forEach(({ game, aId, bId }) => {
    const mine = aId === state.followTeam || bId === state.followTeam;
    if (mine) anyMine = true;
    const msg = `${teamEmoji(aId)} ${esc(teamName(aId))} vs ${teamEmoji(bId)} ${esc(teamName(bId))} — ${esc(game.name)}`;
    showToast(mine ? "You're up next! " + msg : "Up next: " + msg, { mine });
    if (mine) maybeNativeNotification('🏅 Your team is up next!', msg, 'camp-matchup-' + game.id);
  });
  if (anyMine) playMineChime(); else playAlertChime();
}

// Dependency-free confetti burst on "it's official" moments. The winning
// team's mascot rains down among token-colored bits. Respects reduced motion.
function celebrate(goldTeamId) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const emoji = goldTeamId != null ? teamEmoji(goldTeamId) : '🎉';
  const colors = ['#3355ff', '#96690a', '#d63b3b', '#6b7280', '#a15c2a', '#e8c15a'];
  const parts = [];
  for (let i = 0; i < 80; i++) {
    const useEmoji = i % 4 === 0;
    parts.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      g: 0.28 + Math.random() * 0.12,
      size: useEmoji ? 20 + Math.random() * 10 : 6 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length], emoji: useEmoji,
    });
  }
  const start = performance.now();
  const DURATION = 1600;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    parts.forEach((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.emoji) {
        ctx.font = p.size + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 0, 0);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    });
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ── Timers & stopwatches ─────────────────────────────────────────
// Stopwatch state is kept in memory so it keeps running while you browse
// other games. The countdown clock is synced (see getClock/setClock) instead
// of living here — see the "Per-game synced clock" section.

const liveWatches = {}; // gameId -> stopwatch state
let tickHandle = null;

// Keep the screen awake while a countdown or stopwatch runs (guarded — not on
// all browsers).
let wakeLockSentinel = null;
function anyTimerRunning() {
  return Object.values(liveWatches).some((w) => w.running)
    || Object.values(state.clocks || {}).some((c) => c && c.running);
}
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLockSentinel && anyTimerRunning()) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    }
  } catch (e) { /* user gesture / permission not available — ignore */ }
}
function releaseWakeLock() {
  if (wakeLockSentinel) { try { wakeLockSentinel.release(); } catch (e) { /* ignore */ } wakeLockSentinel = null; }
}

function ensureTicking() {
  if (!tickHandle) tickHandle = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  let anyRunning = false;
  Object.entries(liveWatches).forEach(([gid, w]) => {
    if (!w.running) return;
    anyRunning = true;
    const lapMs = now - w.startAt;
    const el = document.getElementById('sw-display-' + gid);
    if (el) el.textContent = fmtWatch(lapMs);
    const tot = document.getElementById('sw-total-' + gid);
    if (tot) tot.textContent = fmtWatch(w.lapsTotal + lapMs);
  });
  if (!anyRunning) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function fmtWatch(ms) {
  const ds = Math.floor(ms / 100);
  const s = Math.floor(ds / 10);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + (ds % 10);
}

function renderTools(wrap, g) {
  // The game clock now renders separately (everyone-facing) in #clock-area via
  // clockBlockHTML / the live tracker's Big Board — see renderGameView. Tools
  // is left for the Pictionary round runner (editor-only prompt/photo flow).
  let html = '';
  if (g.prompts) html += picRoundHTML(g);
  wrap.innerHTML = html;
  if (g.prompts) bindPicRound(wrap, g);
}

// ── Game clock ticker ────────────────────────────────────────────
// Updates every visible clock (the standalone game-clock box AND the Big
// Board's clock — both carry [data-game-clock]) from the per-game synced
// clock. Runs on a cheap global interval (see init) so every device — refs
// and spectators — ticks in lockstep without any network traffic while it
// runs; the editor's device sounds the alarm and stops the clock at zero.
function tickBoardClocks() {
  const els = document.querySelectorAll('[data-game-clock]');
  if (!els.length) return;
  els.forEach((el) => {
    const g = gameById(el.dataset.gameId);
    if (!g || !g.timer) return;
    const clock = getClock(g);
    const rem = clockRemaining(clock);
    const prev = Number(el.dataset.prev) || 0;
    el.dataset.prev = rem;
    el.textContent = fmtBoardClock(rem);
    el.classList.toggle('board-clock-zero', rem === 0);
    // Anticipation: amber pulse inside the last minute, heartbeat + board
    // glow inside the last ten seconds (only while actually running).
    const running = !!clock.running;
    el.classList.toggle('clock-final-min', running && rem > 10000 && rem <= 60000);
    el.classList.toggle('clock-final-ten', running && rem > 0 && rem <= 10000);
    const board = el.closest('.big-board');
    if (board) board.classList.toggle('board-final-ten', running && rem > 0 && rem <= 10000);
    if (running && rem === 0 && prev > 0) {
      // Just hit zero. Editors get the buzzer and stop the synced clock so
      // every device settles on 0:00; viewers only see the pulse.
      if (canEdit()) {
        playAlarm();
        setClock(g, (c) => { c.running = false; c.remaining = 0; });
        renderAll();
      }
    }
  });
}

// ── Photo storage (IndexedDB — photos are too big for localStorage) ──

let photoDBPromise = null;

function photoDB() {
  if (!photoDBPromise) {
    photoDBPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(lsKey('campScoreboardPhotos'), 1); // per-camp photo store
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return photoDBPromise;
}

function idbOp(mode, fn) {
  return photoDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

const putPhoto = (key, blob) => idbOp('readwrite', (s) => s.put(blob, key));
const getPhoto = (key) => idbOp('readonly', (s) => s.get(key));
const delPhoto = (key) => idbOp('readwrite', (s) => s.delete(key));
const clearPhotos = () => idbOp('readwrite', (s) => s.clear());

function picPhotoKey(teamId, idx) {
  return 'pic:' + teamId + ':' + idx;
}

function loadImage(blob) {
  if (window.createImageBitmap) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => loadImageViaTag(blob));
  }
  return loadImageViaTag(blob);
}

function loadImageViaTag(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Downscale camera shots so 60 photos don't blow up the phone's storage.
async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.85);
}

// ── Pictionary round runner ─────────────────────────────────────

function picRounds() {
  if (!state.picRounds) state.picRounds = {};
  return state.picRounds;
}

function picRound(teamId) {
  const all = picRounds();
  if (!all[teamId]) all[teamId] = { laps: [], done: false };
  return normalizePicRound(all[teamId]);
}

function picLapsSum(round) {
  return round ? round.laps.reduce((a, l) => a + l.ms, 0) : 0;
}

// Pictionary item source, chosen by the ref before the first team runs:
// 'pregenerated' (the built-in word list), 'own' (ref's own words), or
// 'numbered' (just "Item N", no words). Synced so every ref device agrees.
function picSetupFor(gid) {
  if (!state.picSetup) state.picSetup = {};
  return state.picSetup[gid] || null;
}

// The label to show/caption for drawing item i. Words are only ever shown in
// the ref tools (canEdit) — never to viewers — and in 'numbered' mode there is
// no secret word at all.
function promptLabel(g, i) {
  const s = picSetupFor(g.id);
  const src = s && s.source;
  if (src === 'numbered') return `Item ${i + 1}`;
  if (src === 'own') {
    const w = s.words && s.words[i];
    return (w && String(w).trim()) ? String(w).trim() : `Item ${i + 1}`;
  }
  return (g.prompts && g.prompts[i]) || `Item ${i + 1}`; // pregenerated default
}

function picRoundHTML(g) {
  let w = liveWatches[g.id];
  if (!w) w = liveWatches[g.id] = { running: false, startAt: 0, lapsTotal: 0 };
  const teamId = state.ui.picTeam;
  const round = teamId ? picRound(teamId) : null;
  // Always derive the total from the saved laps — the in-memory copy dies
  // on reload, and a stale 0 here would fill a short total into the score.
  w.lapsTotal = picLapsSum(round);

  const setup = picSetupFor(g.id);
  const anyLaps = state.teams.some((t) => { const r = picRounds()[t.id]; return r && r.laps && r.laps.length; });

  // Ask the ref how the items should be shown, before the first team runs.
  if (!setup) {
    return `<div class="tool-box" data-tool="pic-round">
      <div class="tool-label">🎨 Drawing round</div>
      <div class="pic-setup">
        <p class="pic-setup-q">How should the ${g.prompts.length} drawing items be shown to the ref?</p>
        <div class="pic-setup-opts">
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="pregenerated">🎃 Use the built-in list</jelly-button>
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="own">✏️ Enter our own</jelly-button>
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="numbered">🔢 Just numbered items</jelly-button>
        </div>
        <p class="muted pic-setup-hint">Viewers never see the words either way — only the live times. This locks once a team has started.</p>
      </div>
    </div>`;
  }

  const modeLabel = { pregenerated: 'Built-in list', own: 'Your own items', numbered: 'Numbered items' }[setup.source] || '';
  const modeStrip = `<div class="pic-mode-strip">Items: <strong>${esc(modeLabel)}</strong>${anyLaps ? '' : ' · <button class="link-btn" data-pic-source="reset">change</button>'}</div>`;

  const wordsEditor = setup.source === 'own' ? `
    <details class="pic-words-editor" ${anyLaps ? '' : 'open'}>
      <summary>✏️ Your ${g.prompts.length} items${anyLaps ? '' : ' — type them in'}</summary>
      <div class="pic-words-grid">
        ${Array.from({ length: g.prompts.length }, (_, i) => `
          <label class="pic-word-row"><span class="pic-word-num">${i + 1}.</span>
            <input type="text" data-pic-word="${i}" value="${esc((setup.words && setup.words[i]) || '')}" placeholder="Item ${i + 1}" ${anyLaps ? 'disabled' : ''} />
          </label>`).join('')}
      </div>
    </details>` : '';

  const chips = `<div class="pic-team-chips">${state.teams.map((t) => {
    const r = picRounds()[t.id];
    const status = r && r.done ? ' ✓' : r && r.laps.length ? ` ${r.laps.length}/10` : '';
    return `<button class="team-chip pic-team-chip ${teamId === t.id ? 'selected' : ''}" data-team-id="${t.id}" ${w.running ? 'disabled' : ''}>${esc(t.name)}${status}<span class="chip-sub">${esc(counselorName(t.id))}</span></button>`;
  }).join('')}</div>`;

  let panel = '';
  if (round) {
    const n = round.laps.length;
    if (!round.done) {
      const prompt = promptLabel(g, n);
      const hasWord = prompt !== `Item ${n + 1}`; // numbered / blank-own has no secret word
      panel = `
        <div class="pic-prompt-card">
          <div class="pic-prompt-label">Item ${n + 1} of ${g.prompts.length}</div>
          ${hasWord ? `<div class="pic-prompt-word">${esc(prompt)}</div>` : ''}
        </div>
        <div class="big-clock" id="sw-display-${g.id}">${fmtWatch(w.running ? Date.now() - w.startAt : 0)}</div>
        <div class="sw-total-line">Team total: <strong id="sw-total-${g.id}">${fmtWatch(w.lapsTotal + (w.running ? Date.now() - w.startAt : 0))}</strong></div>
        <div class="timer-btn-row">
          ${w.running
            ? `<jelly-button class="timer-main-btn stop-lap-btn" variant="amber" block data-action="stop-lap">⏹ Guessed it! Stop clock</jelly-button>`
            : `<jelly-button class="timer-main-btn" block data-action="start-lap">▶ Nose down — start</jelly-button>`}
        </div>`;
    } else {
      const photoCount = round.laps.filter((l) => l.photo).length;
      panel = `
        <div class="pic-done-banner">🎉 Round complete — total <strong>${fmtWatch(round.laps.reduce((a, l) => a + l.ms, 0))}</strong>. Score filled in below.</div>
        <div class="timer-btn-row">
          <jelly-button class="timer-main-btn" variant="platinum" block data-action="export-photos">⬇ Export ${photoCount} captioned photo${photoCount === 1 ? '' : 's'}</jelly-button>
        </div>
        <p class="muted pic-export-hint" id="pic-export-status">Each photo gets a harvest banner with the team, the prompt, and their time. Photos live on the phone that took them.</p>`;
    }

    if (round.laps.length) {
      panel += `<div class="pic-items">${round.laps.map((lap, i) => {
        const lbl = promptLabel(g, i);
        const text = lbl === `Item ${i + 1}` ? lbl : `${i + 1}. ${lbl}`;
        return `
        <div class="pic-item-row">
          <span class="pic-item-text">${esc(text)} — ${fmtWatch(lap.ms)}</span>
          <button class="pic-photo-btn ${lap.photo ? 'has-photo' : ''}" data-action="photo" data-lap="${i}">${lap.photo ? '📷 Retake' : '📷 Add photo'}</button>
        </div>`;
      }).join('')}</div>
        <div class="sw-actions">
          ${!round.done ? `<button class="link-btn" data-action="undo-lap">Undo last item</button>` : ''}
          <button class="link-btn danger-link" data-action="reset-round">Reset this team's round</button>
        </div>`;
    }
  } else {
    panel = `<p class="muted">Pick a team to run their 10 drawings.</p>`;
  }

  return `<div class="tool-box" data-tool="pic-round">
    <div class="tool-label">🎨 Drawing round</div>
    ${modeStrip}
    ${wordsEditor}
    ${chips}
    ${panel}
  </div>
  <input type="file" id="pic-photo-input" accept="image/*" capture="environment" hidden>`;
}

function bindPicRound(wrap, g) {
  const box = wrap.querySelector('[data-tool="pic-round"]');
  if (!box) return;
  const w = liveWatches[g.id];
  const photoInput = wrap.querySelector('#pic-photo-input');

  box.querySelectorAll('.pic-team-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (w.running) return;
      state.ui.picTeam = chip.dataset.teamId;
      const r = picRound(chip.dataset.teamId);
      w.lapsTotal = r.laps.reduce((a, l) => a + l.ms, 0);
      saveState();
      renderTools(wrap, g);
    });
  });

  // Item-source chooser (asked before the first team) + custom-word entry.
  box.querySelectorAll('[data-pic-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.picSource;
      if (!state.picSetup) state.picSetup = {};
      if (src === 'reset') {
        delete state.picSetup[g.id];
      } else {
        const prev = state.picSetup[g.id] || {};
        state.picSetup[g.id] = { source: src, words: Array.isArray(prev.words) ? prev.words : [] };
      }
      saveState();
      renderTools(wrap, g);
    });
  });

  box.querySelectorAll('input[data-pic-word]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const s = state.picSetup && state.picSetup[g.id];
      if (!s) return;
      if (!Array.isArray(s.words)) s.words = [];
      s.words[parseInt(inp.dataset.picWord, 10)] = inp.value;
      saveState(); // no full re-render — keep input focus while typing
    });
  });

  box.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      const teamId = state.ui.picTeam;
      const round = teamId ? picRound(teamId) : null;

      if (a === 'start-lap') {
        getAudio();
        w.startAt = Date.now();
        w.running = true;
        ensureTicking();
      } else if (a === 'stop-lap') {
        const ms = Date.now() - w.startAt;
        w.running = false;
        round.laps.push({ ms, photo: false });
        w.lapsTotal = picLapsSum(round);
        touchData();
        if (round.laps.length >= g.prompts.length) {
          round.done = true;
          const draft = state.drafts[g.id] || (state.drafts[g.id] = { scores: {}, medals: {} });
          const prevLeader = leaderOf(g, draft);
          // Total comes straight from the saved laps, floored to the same
          // decisecond the display shows, so the filled score matches it.
          const totalDs = Math.floor(picLapsSum(round) / 100);
          const m = Math.floor(totalDs / 600);
          const s = (totalDs - m * 600) / 10;
          draft.scores[teamId] = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
          draft.medals = {};
          saveState();
          checkHighScore(g, draft, teamId, prevLeader);
          renderAll();
          return;
        }
        saveState();
      } else if (a === 'undo-lap') {
        const last = round.laps.pop();
        if (last) {
          delPhoto(picPhotoKey(teamId, round.laps.length)).catch(() => {});
        }
        round.done = false;
        w.lapsTotal = picLapsSum(round);
        saveState();
      } else if (a === 'reset-round') {
        if (!confirm("Reset this team's round? All their times and photos for this game are cleared.")) return;
        round.laps.forEach((_, i) => delPhoto(picPhotoKey(teamId, i)).catch(() => {}));
        round.laps = [];
        round.done = false;
        w.lapsTotal = 0;
        w.running = false;
        saveState();
      } else if (a === 'photo') {
        photoInput.dataset.teamId = teamId;
        photoInput.dataset.lap = btn.dataset.lap;
        photoInput.click();
        return;
      } else if (a === 'export-photos') {
        exportTeamPhotos(g, teamId, btn);
        return;
      }
      renderTools(wrap, g);
    });
  });

  // The item-source chooser view has no photo input (no team is running yet).
  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      const teamId = photoInput.dataset.teamId;
      const lapIdx = parseInt(photoInput.dataset.lap, 10);
      try {
        const blob = await shrinkPhoto(file);
        await putPhoto(picPhotoKey(teamId, lapIdx), blob);
        picRound(teamId).laps[lapIdx].photo = true;
        saveState();
        renderTools(wrap, g);
      } catch (e) {
        alert('Could not save that photo — try again.');
        console.error(e);
      }
    });
  }
}

// ── Captioned photo export ──

function drawBannerLeaf(x, cx, cy, size, rot, color) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(0, -size / 2);
  x.quadraticCurveTo(size * 0.45, -size * 0.1, 0, size / 2);
  x.quadraticCurveTo(-size * 0.45, -size * 0.1, 0, -size / 2);
  x.fill();
  x.strokeStyle = 'rgba(252, 245, 228, 0.65)';
  x.lineWidth = Math.max(1, size * 0.05);
  x.beginPath();
  x.moveTo(0, -size * 0.36);
  x.lineTo(0, size * 0.36);
  x.stroke();
  x.restore();
}

function fitFont(x, text, weightStyle, px, maxWidth, family) {
  let size = px;
  do {
    x.font = `${weightStyle} ${Math.round(size)}px ${family}`;
    if (x.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  } while (size > 10);
  return size;
}

async function composeCaptioned(photoBlob, teamStr, promptStr, ms) {
  const img = await loadImage(photoBlob);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const bannerH = Math.max(130, Math.round(w * 0.17));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + bannerH;
  const x = c.getContext('2d');
  const serif = `Georgia, 'Times New Roman', serif`;

  // Parchment banner
  const grad = x.createLinearGradient(0, 0, 0, bannerH);
  grad.addColorStop(0, '#f9f0da');
  grad.addColorStop(1, '#eeddb8');
  x.fillStyle = grad;
  x.fillRect(0, 0, w, bannerH);

  // Double rule above the photo
  x.strokeStyle = '#b3591c';
  x.lineWidth = Math.max(3, w * 0.005);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - x.lineWidth * 3);
  x.lineTo(w * 0.97, bannerH - x.lineWidth * 3);
  x.stroke();
  x.strokeStyle = '#6d3a10';
  x.lineWidth = Math.max(1.5, w * 0.002);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - w * 0.013);
  x.lineTo(w * 0.97, bannerH - w * 0.013);
  x.stroke();

  // Corner leaves
  drawBannerLeaf(x, w * 0.065, bannerH * 0.42, bannerH * 0.34, -0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.045, bannerH * 0.6, bannerH * 0.24, 0.5, '#8a5a12');
  drawBannerLeaf(x, w * 0.935, bannerH * 0.42, bannerH * 0.34, 0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.955, bannerH * 0.6, bannerH * 0.24, -0.5, '#8a5a12');

  // Text
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const maxText = w * 0.72;

  x.fillStyle = '#4a2c10';
  fitFont(x, teamStr, '700', bannerH * 0.3, maxText, serif);
  x.fillText(teamStr, w / 2, bannerH * 0.33);

  const sub = `drew “${promptStr}” in ${fmtWatch(ms)}`;
  x.fillStyle = '#9c4f0f';
  fitFont(x, sub, 'italic 400', bannerH * 0.18, maxText, serif);
  x.fillText(sub, w / 2, bannerH * 0.64);

  x.drawImage(img, 0, bannerH);
  return canvasToJpeg(c, 0.9);
}

function safeFileName(str) {
  return str.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportTeamPhotos(g, teamId, btn) {
  const round = picRound(teamId);
  const team = teamName(teamId);
  const status = document.getElementById('pic-export-status');
  const say = (msg) => { if (status) status.textContent = msg; };

  btn.setAttribute('disabled', '');
  try {
    const files = [];
    for (let i = 0; i < round.laps.length; i++) {
      if (!round.laps[i].photo) continue;
      say(`Building photo ${files.length + 1}…`);
      const blob = await getPhoto(picPhotoKey(teamId, i));
      if (!blob) continue;
      const out = await composeCaptioned(blob, team, promptLabel(g, i), round.laps[i].ms);
      files.push(new File([out], `${safeFileName(team)}-${safeFileName(promptLabel(g, i))}.jpg`, { type: 'image/jpeg' }));
    }
    if (!files.length) {
      say('No photos taken for this team yet — use the Add photo buttons first.');
      return;
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      say(`Sharing ${files.length} photos…`);
      await navigator.share({ files, title: team + ' — Pumpkin Pictionary' }).catch(() => {});
      say(`Shared ${files.length} captioned photos.`);
    } else {
      say(`Downloading ${files.length} photos…`);
      files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 500));
      say(`Downloaded ${files.length} captioned photos.`);
    }
  } catch (e) {
    console.error(e);
    say('Export hit a snag — try again.');
  } finally {
    btn.removeAttribute('disabled');
  }
}

// ── Copy / share helpers ─────────────────────────────────────────

function copyTextToClipboard(text, btn) {
  const done = () => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.setAttribute('disabled', '');
    setTimeout(() => { btn.textContent = orig; btn.removeAttribute('disabled'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
  ta.remove();
  done();
}

function matchupText(g, stage, aId, bId) {
  const withC = (id) => counselorName(id) ? `${teamName(id)} (${counselorName(id)})` : teamName(id);
  return `${g.name} ${stage}: ${withC(aId)} vs ${withC(bId)} — head to ${g.location}!`;
}

function matchupCalloutHTML(aId, bId) {
  const counselors = [counselorName(aId), counselorName(bId)].filter(Boolean);
  return `<div class="matchup-callout">
    <p class="call-next-label">Call up next:</p>
    <div class="matchup-mascots" aria-hidden="true">
      <span class="matchup-mascot">${teamEmoji(aId)}</span>
      <span class="matchup-vs-emoji">⚔️</span>
      <span class="matchup-mascot">${teamEmoji(bId)}</span>
    </div>
    <p class="call-next-teams">${esc(teamName(aId))} <span class="vs">vs</span> ${esc(teamName(bId))}</p>
    ${counselors.length === 2 ? `<p class="call-next-counselors">Counselors: ${esc(counselors[0])} &amp; ${esc(counselors[1])}</p>` : ''}
    ${blockedByOwnTeam(aId, bId) ? '' : `<div class="winner-btn-row">
      <jelly-button class="winner-btn" variant="azure" block data-winner="${aId}">${esc(teamName(aId))} won</jelly-button>
      <jelly-button class="winner-btn" variant="azure" block data-winner="${bId}">${esc(teamName(bId))} won</jelly-button>
    </div>`}
    <jelly-button class="copy-matchup-btn" variant="platinum" block>📋 Copy matchup for text</jelly-button>
  </div>`;
}

function bindMatchupCopy(body, g, stage, aId, bId) {
  const btn = body.querySelector('.copy-matchup-btn');
  if (btn) btn.addEventListener('click', () => copyTextToClipboard(matchupText(g, stage, aId, bId), btn));
}

function standingsSummaryText() {
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);

  const campDate = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  const lines = ['🏅 Camp — ' + campDate];
  lines.push('');
  lines.push(`Standings (🥇 ${MEDAL_POINTS.gold} · 🥈 ${MEDAL_POINTS.silver} · 🥉 ${MEDAL_POINTS.bronze} pts):`);
  ranked.forEach((t, i) => {
    const s = counts[t.id];
    const parts = [`🥇${s.gold} 🥈${s.silver} 🥉${s.bronze}`];
    if (s.verse) parts.push(`📖${s.verse > 0 ? '+' : ''}${s.verse}`);
    if (s.meals) parts.push(`🧽${s.meals > 0 ? '+' : ''}${s.meals}`);
    if (s.custom) parts.push(`✨${s.custom > 0 ? '+' : ''}${s.custom}`);
    lines.push(`${i + 1}) ${teamEmoji(t.id)} ${t.name} · ${s.points} pts (${parts.join(' ')})`);
  });

  const played = state.config.games.filter((g) => state.results[g.id]);
  if (played.length) {
    lines.push('');
    lines.push('Medals so far:');
    played.forEach((g) => {
      const m = state.results[g.id].medals;
      lines.push(`• ${g.name} — 🥇 ${teamName(m.gold)}, 🥈 ${teamName(m.silver)}, 🥉 ${teamName(m.bronze)}`);
    });
  } else {
    lines.push('');
    lines.push('No games saved yet.');
  }
  return lines.join('\n');
}

// ── High-score chime ──

function leaderOf(g, draft) {
  const ranked = autoRank(g, draft);
  return ranked.length ? ranked[0] : null;
}

function checkHighScore(g, draft, teamId, prevLeader) {
  const newLeader = leaderOf(g, draft);
  if (!newLeader || newLeader.id !== teamId) return;
  if (prevLeader && prevLeader.id !== teamId &&
      (g.lowerWins ? newLeader.v < prevLeader.v : newLeader.v > prevLeader.v)) {
    playHighScore();
  }
}

// ── Time helpers (Pumpkin Pictionary) ────────────────────────────

function parseScoreInput(game, raw) {
  const str = String(raw).trim();
  if (!str) return null;
  if (game.timeInput && str.includes(':')) {
    const [m, s] = str.split(':');
    const mm = parseInt(m, 10);
    const ss = parseFloat(s);
    if (isNaN(mm) || isNaN(ss) || ss >= 60 || mm < 0 || ss < 0) return null;
    return mm * 60 + ss;
  }
  const v = parseFloat(str);
  if (isNaN(v) || v < 0) return null; // scores/times are never negative
  return v;
}

function formatScore(game, val) {
  if (game.timeInput) {
    let m = Math.floor(val / 60);
    let s = Math.round((val - m * 60) * 10) / 10;
    if (s >= 60) { m += 1; s -= 60; } // rounding can carry (e.g. 119.97s → 2:00, not 1:60)
    return m + ':' + (s < 10 ? '0' : '') + (Number.isInteger(s) ? s : s.toFixed(1));
  }
  return String(val);
}

// ── Standings (derived from saved results) ───────────────────────

// Extra points per team from the bonus ledger, split by source. Bible
// memorization ('verse') and meal cleanup ('cleanup') each get their own
// standings column, so they're totaled separately rather than lumped into a
// single "bonus" figure; any free-form entry falls in 'custom'.
function bonusBreakdown() {
  const totals = {};
  state.teams.forEach((t) => (totals[t.id] = { verse: 0, meals: 0, custom: 0 }));
  Object.values(state.bonuses || {}).forEach((b) => {
    if (!b || !totals[b.teamId]) return;
    const p = Number(b.points);
    if (isNaN(p)) return;
    const bucket = b.category === 'verse' ? 'verse'
      : b.category === 'cleanup' ? 'meals'
      : 'custom';
    // Thu-evening/Friday double-points window (cleanup exempt) — see
    // bonusCountsDouble. The ledger keeps the raw value; the ×2 chip in
    // renderBonuses explains the difference.
    totals[b.teamId][bucket] += p * (bonusCountsDouble(b) ? 2 : 1);
  });
  return totals;
}

function medalCounts() {
  const counts = {};
  const extra = bonusBreakdown();
  state.teams.forEach((t) => (counts[t.id] = { gold: 0, silver: 0, bronze: 0, medalPts: 0, verse: 0, meals: 0, custom: 0, bonus: 0, points: 0 }));
  // Iterate entries so we can weight points per game: Messtival games are
  // worth DOUBLE on the scoreboard. Medal *counts* stay raw; only the point
  // value doubles. Results for games no longer in the (editable) catalog are
  // skipped — deleting a game removes its result, but an import/restore can
  // still leave an orphan behind, and a phantom medal with no game to clear
  // it from would corrupt the standings forever.
  Object.entries(state.results).forEach(([id, r]) => {
    if (!r || !r.medals) return;
    const g = gameById(id);
    if (!g) return;
    const mult = g.messtival ? 2 : 1;
    if (counts[r.medals.gold]) { counts[r.medals.gold].gold += 1; counts[r.medals.gold].medalPts += MEDAL_POINTS.gold * mult; }
    if (counts[r.medals.silver]) { counts[r.medals.silver].silver += 1; counts[r.medals.silver].medalPts += MEDAL_POINTS.silver * mult; }
    if (counts[r.medals.bronze]) { counts[r.medals.bronze].bronze += 1; counts[r.medals.bronze].medalPts += MEDAL_POINTS.bronze * mult; }
  });
  state.teams.forEach((t) => {
    const c = counts[t.id];
    const e = extra[t.id] || { verse: 0, meals: 0, custom: 0 };
    c.verse = e.verse;
    c.meals = e.meals;
    c.custom = e.custom;
    c.bonus = e.verse + e.meals + e.custom; // all extras, for the grand total
    c.points = c.medalPts + c.bonus; // grand total drives the leaderboard
  });
  return counts;
}

// Rank by total points; break point ties by finish quality (golds,
// then silvers, then bronzes).
function rankTeamsByPoints(counts) {
  return [...state.teams].sort((a, b) => {
    const sa = counts[a.id], sb = counts[b.id];
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.gold !== sa.gold) return sb.gold - sa.gold;
    if (sb.silver !== sa.silver) return sb.silver - sa.silver;
    return sb.bronze - sa.bronze;
  });
}

let lastPointsByTeam = null; // for the remote-change pulse
let remoteJustApplied = false;

// ── Rank-change arrows (vs the start of the camp day) ─────────────
// Each device snapshots the standings order the first time it renders on a
// new camp date, then shows ↑n/↓n per row against that baseline. Deliberately
// device-local (NOT synced): every phone keeps its own morning baseline.
const DAY_RANK_KEY = lsKey('campScoreboardDayRanks');

function startOfDayRanks(ranked) {
  const today = campDateStr();
  let snap = null;
  try {
    snap = JSON.parse(localStorage.getItem(DAY_RANK_KEY) || 'null');
  } catch (e) { /* corrupt — re-snapshot below */ }
  if (!snap || snap.date !== today || !snap.ranks) {
    const ranks = {};
    ranked.forEach((t, i) => { ranks[t.id] = i + 1; });
    snap = { date: today, ranks };
    try { localStorage.setItem(DAY_RANK_KEY, JSON.stringify(snap)); } catch (e) { /* fine */ }
  }
  return snap.ranks;
}

function renderStandings() {
  // (Card visibility + the hide switches are handled centrally by
  // applyCardVisibility, called at the top of renderAll.)
  const tbody = document.getElementById('standings-tbody');
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  // Pulse rows whose points changed because of a remote sync (invisible
  // otherwise). Skip the very first render and local edits (those already
  // get confetti / direct feedback).
  const remoteOrigin = remoteJustApplied; // capture before reset — drives change-history logging
  const pulseFromRemote = remoteOrigin && lastPointsByTeam !== null;
  remoteJustApplied = false;
  const changedTeams = []; // {team, delta, total} — for the notify option
  const dayRanks = startOfDayRanks(ranked);

  tbody.innerHTML = '';
  ranked.forEach((team, i) => {
    const s = counts[team.id];
    // Movement since this device's start-of-day baseline. Zero-point tables
    // stay arrow-free (same gate as the podium tint).
    const moved = s.points > 0 && dayRanks[team.id] ? dayRanks[team.id] - (i + 1) : 0;
    const rankDelta = moved
      ? `<span class="rank-delta ${moved > 0 ? 'up' : 'down'}" title="${moved > 0 ? 'Up' : 'Down'} ${Math.abs(moved)} since this morning">${moved > 0 ? '↑' : '↓'}${Math.abs(moved)}</span>`
      : '';
    const tr = document.createElement('tr');
    // Podium tint for the top 3 — but only once real points exist, so
    // Monday's all-zero table stays neutral.
    tr.className = i < 3 && s.points > 0 ? 'podium-row podium-' + (i + 1) : '';
    if (team.id === state.followTeam) tr.className += ' following-row';
    if (pulseFromRemote && lastPointsByTeam[team.id] !== undefined && lastPointsByTeam[team.id] !== s.points) {
      tr.className += ' points-pulse';
      changedTeams.push({ team, delta: s.points - lastPointsByTeam[team.id], total: s.points });
    }
    const medalCell = (n) => `<td class="medal-col">${n ? n : '<span class="zero">0</span>'}</td>`;
    // Signed cell for the point-source columns (verse / meals): dim a zero,
    // show a leading + only for positive tallies (deductions keep their −).
    const extraCell = (n) => `<td class="extra-col">${n ? (n > 0 ? '+' + n : n) : '<span class="zero">0</span>'}</td>`;
    tr.innerHTML = `
      <td class="rank-col">${i + 1}${rankDelta}</td>
      <td class="team-cell">
        <div class="team-name-line"><span class="team-emoji">${teamEmoji(team.id)}</span> <span class="team-name-text">${esc(team.name)}</span>${team.id === state.followTeam ? ' <span class="following-star" title="You\'re following this team">⭐</span>' : ''}</div>
        ${counselorName(team.id) ? `<div class="team-counselor-text">${esc(counselorName(team.id))}</div>` : ''}
      </td>
      <td class="points-col">${s.points}${s.custom ? `<span class="bonus-hint">${s.custom > 0 ? '+' : ''}${s.custom} bonus</span>` : ''}</td>
      ${medalCell(s.gold)}
      ${medalCell(s.silver)}
      ${medalCell(s.bronze)}
      ${extraCell(s.verse)}
      ${extraCell(s.meals)}
    `;
    tbody.appendChild(tr);
  });
  lastPointsByTeam = {};
  ranked.forEach((team) => { lastPointsByTeam[team.id] = counts[team.id].points; });
  renderCatchupHint(ranked, counts);
  renderFollowCard(ranked, counts);
  if (changedTeams.length) notifyPointChanges(changedTeams);
  // Append any local point-total changes to the change-history log. Best-effort:
  // wrapped so a logging failure can never break the standings render.
  try { recordPointHistory(counts, remoteOrigin); } catch (e) { /* never break rendering */ }
}

// One-line rally cry under the standings table: how far a chasing team is
// from first place, in gold-medal terms. Focuses on the viewer's followed
// team when it's trailing; otherwise the 2nd-place team. Hidden until real
// points exist so Monday's all-zero table stays neutral.
function renderCatchupHint(ranked, counts) {
  const el = document.getElementById('catchup-hint');
  if (!el) return;
  const leader = ranked[0];
  if (!leader || ranked.length < 2 || counts[leader.id].points <= 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  let chaser = null;
  if (state.followTeam && state.followTeam !== leader.id) {
    chaser = ranked.find((t) => t.id === state.followTeam);
  }
  if (!chaser) chaser = ranked[1];
  const gap = counts[leader.id].points - counts[chaser.id].points;
  const pair = `${teamEmoji(chaser.id)} <strong>${esc(chaser.name)}</strong>`;
  const leaderBit = `${teamEmoji(leader.id)} ${esc(leader.name)}`;
  if (gap <= 0) {
    el.innerHTML = `🤝 ${pair} is tied on points with ${leaderBit} — next medal breaks it!`;
  } else {
    // During the double-points window every remaining game is a doubled
    // (messtival) game, so a gold won now is worth 2× — count with that.
    const doubled = inDoubleBonusWindow();
    const golds = Math.ceil(gap / (MEDAL_POINTS.gold * (doubled ? 2 : 1)));
    el.innerHTML = `🥇 ${pair} needs ${golds}${doubled ? ' double-points' : ''} gold${golds === 1 ? '' : 's'} (${gap} pt${gap === 1 ? '' : 's'}) to catch ${leaderBit}.`;
  }
  el.hidden = false;
}

// ── Change history (append-only log at a SEPARATE Firebase path) ──────────────
// A timestamped record of every point-total change, written to
// campScoreboard/changelog — NOT campScoreboard/state, so it never touches the
// synced scoreboard and can't interfere with the merge/push logic. Only the
// editor device that originates a change logs it (remote merges are skipped —
// the originating device already logged), so there are no duplicates. Writes
// are append-only (push()), so there's no read-modify-write to clobber. Every
// path guards on fbRef and is wrapped in try/catch, so with sync off or on an
// error this is a silent no-op.
let clPrevSnap = null; // last-seen { points, results, bonuses } for diffing

function snapshotForLog(counts) {
  const points = {};
  (state.teams || []).forEach((t) => { points[t.id] = counts[t.id] ? counts[t.id].points : 0; });
  const results = {};
  Object.keys(state.results || {}).forEach((gid) => {
    const r = state.results[gid];
    if (r) results[gid] = r.savedAt || '1';
  });
  const bonuses = {};
  Object.keys(state.bonuses || {}).forEach((id) => {
    const b = state.bonuses[id];
    if (b) bonuses[id] = { category: b.category, label: b.label, points: b.points };
  });
  return { points, results, bonuses };
}

function bonusCauseLabel(b) {
  if (!b) return 'Bonus';
  if (b.label) return b.label;
  if (b.category === 'verse') return 'Memory verse';
  if (b.category === 'cleanup') return 'Meal cleanup';
  return 'Bonus';
}

// Human-readable causes for what changed between two snapshots.
function describeCauses(prev, snap) {
  const causes = [];
  Object.keys(snap.results).forEach((gid) => {
    if (prev.results[gid] !== snap.results[gid]) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result saved');
    }
  });
  Object.keys(prev.results).forEach((gid) => {
    if (!(gid in snap.results)) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result cleared');
    }
  });
  Object.keys(snap.bonuses).forEach((id) => {
    if (!(id in prev.bonuses)) causes.push(bonusCauseLabel(snap.bonuses[id]) + ' — added');
  });
  Object.keys(prev.bonuses).forEach((id) => {
    if (!(id in snap.bonuses)) causes.push(bonusCauseLabel(prev.bonuses[id]) + ' — removed');
  });
  return causes;
}

function recordPointHistory(counts, isRemote) {
  const snap = snapshotForLog(counts);
  const prev = clPrevSnap;
  clPrevSnap = snap;        // always advance the baseline
  if (!prev) return;        // first render is the baseline — never logged
  if (isRemote) return;     // remote merge: the originating device already logged
  if (!canEdit()) return;   // only editors change points (defensive)
  if (!fbRef) return;       // sync off — nowhere to log

  const changed = [];
  Object.keys(snap.points).forEach((tid) => {
    const before = prev.points[tid];
    const after = snap.points[tid];
    if (before !== undefined && before !== after) changed.push({ tid, before, after });
  });
  if (!changed.length) return;

  const causes = describeCauses(prev, snap);
  const reason = causes.length ? causes.join('; ') : 'Points updated';
  const at = new Date().toISOString();
  const by = state.identity || memberName || identityLabel(authUser) || null;
  const logRef = firebase.database().ref(dbPath('changelog'));
  changed.forEach(({ tid, before, after }) => {
    logRef.push({ at, teamId: tid, team: teamName(tid), delta: after - before, before, after, reason, by })
      .catch(() => { /* offline / rules — the log entry is best-effort */ });
  });
}

// "Your team" summary card — rank, points, and next matchup if one's queued.
function renderFollowCard() {
  const card = document.getElementById('follow-team-card');
  if (!card) return;
  if (state.followTeam === undefined) { card.hidden = true; return; }
  if (state.followTeam === null) {
    card.className = 'follow-team-card';
    card.style.removeProperty('--team-accent');
    card.hidden = false;
    card.innerHTML = `<p class="muted follow-neutral-line">🏳️ Not following a team — <button id="pick-team-link" class="link-btn">pick one</button></p>`;
    const link = document.getElementById('pick-team-link');
    if (link) link.addEventListener('click', openTeamPicker);
    return;
  }
  const team = state.teams.find((t) => t.id === state.followTeam);
  if (!team) { card.hidden = true; return; }
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  const rank = ranked.findIndex((t) => t.id === team.id) + 1;
  const s = counts[team.id];
  const next = findNextMatchupFor(team.id);
  const nextLine = next
    ? `<p class="follow-next-line">⏭️ Up next: vs ${teamEmoji(next.opponentId)} ${esc(teamName(next.opponentId))} in ${esc(next.game.name)}</p>`
    : '';
  const nextCleanup = findNextCleanupFor(team.id);
  const cleanupLine = nextCleanup
    ? `<p class="follow-next-line">🧽 Next meal cleanup:<br>${esc(DAY_NAMES[nextCleanup.day])} ${esc(nextCleanup.meal)}</p>`
    : '';
  const you = state.identity;
  // The "who are you" line exists to surface YOUR electives — camps without
  // electives (senior) have nothing to show, so the line disappears.
  const youLine = !CAMP.features.electives ? ''
    : you
    ? `<p class="follow-you-line">${esc(you)} <button id="change-identity-link" class="link-btn">Change</button></p>`
    : `<p class="follow-you-line follow-you-empty"><button id="set-identity-link" class="link-btn">🙋 Tell us who you are</button> to see your electives</p>`;
  const shield = teamShield(team.id);
  const crestHtml = shield
    ? `<div class="follow-team-crest"><img class="follow-team-shield" src="${shield}" alt="${esc(team.name)} team shield" width="480" height="667" loading="lazy" decoding="async"></div>`
    : '';
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  const statsLine = `<div class="follow-team-stats">
    <span class="follow-rank-pill">${medal ? medal + ' ' : ''}${ordinal(rank)} place</span>
    <span class="follow-points">${s.points} pts</span>
  </div>`;
  const accent = teamAccent(team.id);
  card.className = 'follow-team-card' + (shield ? ' has-shield' : '');
  if (accent) card.style.setProperty('--team-accent', accent);
  else card.style.removeProperty('--team-accent');
  card.hidden = false;
  card.innerHTML = `
    ${crestHtml}
    <div class="follow-team-body">
      <div class="follow-team-head">
        ${shield ? '' : `<span class="follow-team-emoji">${teamEmoji(team.id)}</span>`}
        <div class="follow-team-headings">
          <div class="follow-team-name">${esc(team.name)}</div>
          ${statsLine}
        </div>
        ${memberTeamId ? '<span class="follow-your-team" title="Set by your account">Your team</span>' : '<button id="change-team-link" class="link-btn follow-change-btn">Change</button>'}
      </div>
      ${nextLine}
      ${cleanupLine}
      ${youLine}
    </div>
  `;
  const changeBtn = document.getElementById('change-team-link');
  if (changeBtn) changeBtn.addEventListener('click', openTeamPicker);
  const idBtn = document.getElementById('change-identity-link') || document.getElementById('set-identity-link');
  if (idBtn) idBtn.addEventListener('click', openIdentityPicker);
}

// Compact "My electives today" card in the top strip — the stored identity's
// three slots (time · emoji · station, or Break). Hidden when there's nothing
// to show (see myElectivesToday). Rendered from renderAll AND the 30s interval
// so it follows the camp day across a midnight rollover.
function renderMyElectives() {
  const card = document.getElementById('my-electives-card');
  if (!card) return;
  const rows = myElectivesToday();
  if (!rows) { card.hidden = true; card.innerHTML = ''; return; }
  card.hidden = false;
  card.innerHTML = `
    <div class="my-el-head"><span class="my-el-title">⭐ My electives today</span></div>
    <div class="my-el-rows">
      ${rows.map((r) => `
        <div class="my-el-row ${r.onBreak ? 'is-break' : ''}">
          <span class="my-el-time">${r.time}</span>
          <span class="my-el-emoji">${r.emoji}</span>
          <span class="my-el-station">${r.onBreak ? 'Break' : esc(r.station)}</span>
          <span class="my-el-wx">${electiveWxHtml(campNow().dow, r.slot)}</span>
        </div>`).join('')}
    </div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Team + identity picker ────────────────────────────────────────
// A tiny two-step flow in one overlay: first "which team are you rooting
// for?", then (for a real team) "which one are you?" so a counselor's own
// electives can be surfaced. Device-local — shown once after unlocking until
// answered, and reachable again later via the follow-team card. Existing
// followers from before identity shipped get only the name step on next launch.

// Picker step machine (module-local, not persisted).
let pickerStep = 'team';       // 'team' | 'identity'
let pickerTeamId = null;       // team whose counselors the identity step lists
let pickerNotifyToast = null;  // "following…" toast deferred to the final close

function teamPickerOverlayEl() {
  return document.getElementById('team-picker-overlay');
}

// Staff whose account says which team they're on don't get asked — the app
// already knows, so it just follows that team (and uses their member name as
// their identity, for the electives view). Returns true when it answered the
// question, so the picker stays shut.
//
// This overrides a hand-picked choice on purpose: the account is the truth,
// and a counselor who tapped a different team during camp week shouldn't
// keep seeing someone else's team as "yours". Un-assign them in Settings →
// Who can sign in and the picker comes back.
function adoptMemberTeam() {
  if (!memberTeamId) return false;
  let changed = false;
  if (state.followTeam !== memberTeamId) { state.followTeam = memberTeamId; changed = true; }
  const known = memberName && TEAM_COUNSELORS[memberTeamId] &&
    TEAM_COUNSELORS[memberTeamId].includes(memberName) ? memberName : null;
  // Only adopt a name the electives data actually knows; otherwise leave the
  // identity answered-as-skipped rather than looking up nothing forever.
  const wanted = known || null;
  if (state.identity === undefined || (known && state.identity !== known)) {
    state.identity = wanted;
    changed = true;
  }
  if (changed) saveState();
  // A device painting from the cached hint runs maybeShowTeamPicker() before
  // the member record has arrived, so the picker may already be up by the
  // time we learn their team — take it back down. (Only the team step: an
  // identity picker they opened themselves is theirs to close.)
  if (pickerStep === 'team') closeTeamPicker();
  return true;
}

function maybeShowTeamPicker() {
  // The "which camp?" question outranks "which team?" — while the camp
  // picker is up, hold this one (its close event re-runs us; see
  // wireCampSwitcher).
  const cp = document.getElementById('camp-picker-overlay');
  if (cp && cp.hasAttribute && cp.hasAttribute('open')) return;
  if (adoptMemberTeam()) return; // their account already says which team they're on
  if (state.followTeam === undefined) { openTeamPicker(); return; }
  // Already following a real team but never answered "which one are you?"
  // (a fresh install skips this; existing followers get just the name step).
  // The question only exists where electives do.
  if (CAMP.features.electives && state.followTeam && state.identity === undefined) openIdentityPicker();
}

function openTeamPicker() {
  pickerStep = 'team';
  pickerNotifyToast = null;
  showPickerOverlay();
}

// Jump straight to the identity step (from the follow card, or the launch
// migration). Only meaningful when a real team is being followed.
function openIdentityPicker() {
  if (!CAMP.features.electives) return; // no electives → no "which one are you?"
  if (!state.followTeam) return;
  pickerStep = 'identity';
  pickerTeamId = state.followTeam;
  pickerNotifyToast = null;
  showPickerOverlay();
}

// The picker is a jelly-dialog: backdrop click, ✕, and Escape dismiss it
// without choosing. Pre-answer that just means "ask again next launch"
// (maybeShowTeamPicker re-opens it until the team question is answered).
function showPickerOverlay() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  renderPickerStep();
  overlay.setAttribute('open', '');
}

function closeTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  overlay.removeAttribute('open');
}

function renderPickerStep() {
  const title = document.querySelector('.team-picker-title');
  const hint = document.querySelector('.team-picker-hint');
  if (pickerStep === 'identity') {
    if (title) title.textContent = '🙋 Which one are you?';
    if (hint) hint.textContent = "So we can show your electives whenever you check in. Just cheering? Skip it.";
    renderIdentityOptions();
  } else {
    if (title) title.textContent = '👋 Which team are you rooting for?';
    if (hint) hint.textContent = "You'll get a heads-up here when they score or get called up next.";
    renderTeamPickerOptions();
  }
}

function renderTeamPickerOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  wrap.innerHTML = state.teams.map((t) =>
    `<button class="team-picker-option ${state.followTeam === t.id ? 'selected' : ''}" data-team-id="${t.id}">
      <span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.followTeam === null ? 'selected' : ''}" data-team-id="">🙅 Neutral / no team</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId || null;
      const turnedOnNotify = id && !state.notify;
      // Switching to a different team invalidates a prior identity — re-ask it.
      if (id !== state.followTeam) state.identity = null;
      state.followTeam = id;
      // Following a team opts you into its alerts — the picker promises a
      // "heads-up when they score or are up next," which only fires when
      // notifications are on. (Neutral leaves the notify setting alone.)
      if (id && !state.notify) enableNotify();
      saveState();
      if (!id) {                       // neutral — no team, so no identity step
        state.identity = null;
        saveState();
        closePickerAndRender();
        return;
      }
      if (turnedOnNotify) {
        pickerNotifyToast = `🔔 Following ${teamEmoji(id)} ${teamName(id)} — you'll get alerts here when they score or are up next.`;
      }
      // The identity step exists to show YOUR electives — a camp without
      // electives (senior) has nothing to ask, so the picker just closes.
      if (!CAMP.features.electives) {
        state.identity = null;
        saveState();
        closePickerAndRender();
        return;
      }
      // Advance to the identity step (don't close yet).
      pickerTeamId = id;
      pickerStep = 'identity';
      renderPickerStep();
    });
  });
}

function renderIdentityOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  // The member directory is the live roster once counselors are assigned to
  // teams; TEAM_COUNSELORS (which the electives data is keyed to) is the
  // fallback for a team nobody's been assigned to yet.
  const staff = teamStaffNames(pickerTeamId);
  const names = staff.length ? staff : (TEAM_COUNSELORS[pickerTeamId] || []);
  wrap.innerHTML = names.map((n) =>
    `<button class="team-picker-option ${state.identity === n ? 'selected' : ''}" data-counselor="${esc(n)}">
      <span class="chip-emoji">${teamEmoji(pickerTeamId)}</span> ${esc(n)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.identity === null ? 'selected' : ''}" data-counselor="">🙌 Skip — I'm just cheering</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.identity = btn.dataset.counselor || null;
      saveState();
      closePickerAndRender();
    });
  });
}

function closePickerAndRender() {
  closeTeamPicker(); // the dialog's close event shows any pending notify toast
  renderAll();
}

function wireTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  // The dialog's own backdrop/✕/Escape can dismiss without choosing. At the
  // identity step that's effectively "skip"; pre-answer it means "ask again
  // next launch" (maybeShowTeamPicker re-opens until answered). A pending
  // "following…" toast still shows so the choice that WAS made is confirmed.
  overlay.addEventListener('close', () => {
    if (pickerNotifyToast) { showToast(pickerNotifyToast); pickerNotifyToast = null; }
  });
}

// ── Bonus points (extra points, entered + viewed here) ───────────

const BONUS_CATEGORIES = {
  verse:   { icon: '📖', label: 'Memory verse' },
  cleanup: { icon: '🧽', label: 'Meal cleanup' },
  custom:  { icon: '✨', label: 'Bonus' },
};
// Categories offered in the bonus entry row. 'verse' and 'cleanup' are
// intentionally excluded — they have their own cards (Memory Verse, Meal
// Cleanup) — but stay in BONUS_CATEGORIES so any legacy entry still resolves
// an icon/label. Only free-form 'custom' bonuses are entered here now.
const BONUS_ENTRY_CATEGORIES = ['custom'];

// Form state for the entry row — lives outside state so it isn't synced
// or persisted; the fields persist across adds for fast nightly entry.
let bonusDraft = { category: 'custom', meal: 'Breakfast', teams: [], points: '', custom: '', sign: 1 };

function bonusLabelFor(d) {
  if (d.category === 'verse') return 'Verse memorization';
  if (d.category === 'cleanup') return `${d.meal} cleanup`;
  return (d.custom || '').trim() || 'Bonus';
}

function newBonusId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function renderBonuses() {
  const wrap = document.getElementById('bonus-body');
  if (!wrap) return;
  const d = bonusDraft;

  let entryHTML = '';
  if (canEdit()) {
    const mealRow = d.category === 'cleanup'
      ? `<div class="bonus-meal-row">${['Breakfast', 'Lunch', 'Supper'].map((m) =>
          `<jelly-chip class="bonus-meal-chip" selectable size="small" ${d.meal === m ? 'selected' : ''} data-meal="${m}">${esc(m)}</jelly-chip>`).join('')}</div>`
      : '';
    const customRow = d.category === 'custom'
      ? `<input type="text" id="bonus-custom" class="bonus-custom-input" placeholder="What for?" value="${esc(d.custom)}" maxlength="40" />`
      : '';
    // Only show the category chooser if there's more than one category.
    const catRow = BONUS_ENTRY_CATEGORIES.length > 1
      ? `<div class="bonus-cat-row">${BONUS_ENTRY_CATEGORIES.map((key) => { const c = BONUS_CATEGORIES[key]; return `<jelly-chip class="bonus-cat-chip" selectable size="small" ${d.category === key ? 'selected' : ''} data-cat="${key}">${c.icon} ${esc(c.label)}</jelly-chip>`; }).join('')}</div>`
      : '';
    entryHTML = `
      <div class="bonus-entry">
        ${catRow}
        ${mealRow}
        ${customRow}
        <p class="bonus-entry-hint muted">Pick the team(s) that earned it:</p>
        <div class="bonus-team-chips">
          ${state.teams.map((t) => {
            // The own-team guard: an assigned editor can award anyone but
            // their own team (see canScoreRound).
            const locked = blockedByOwnTeam(t.id);
            return `<jelly-chip class="bonus-team-chip" selectable ${d.teams.includes(t.id) ? 'selected' : ''} ${locked ? 'disabled' : ''} data-team-id="${t.id}" ${locked ? 'title="Your own team — another editor awards these"' : ''}><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}${locked ? ' 🛡️' : ''}</jelly-chip>`;
          }).join('')}
        </div>
        <div class="bonus-add-row">
          <jelly-icon-button id="bonus-sign" class="bonus-sign-btn ${d.sign < 0 ? 'neg' : ''}" ${d.sign < 0 ? 'variant="rose"' : ''} label="${d.sign < 0 ? 'Subtracting points — tap to add' : 'Adding points — tap to subtract'}">${d.sign < 0 ? '−' : '+'}</jelly-icon-button>
          <input type="number" id="bonus-points" class="bonus-points-input" inputmode="numeric" placeholder="Points" value="${esc(d.points)}" />
          <jelly-button id="bonus-add-btn" class="primary-btn" block>${d.sign < 0 ? 'Subtract points' : 'Add points'}</jelly-button>
        </div>
        <p id="bonus-error" class="entry-error" role="alert" hidden></p>
      </div>`;
  }

  // Verse and cleanup points have their own cards, so this card shows only
  // the free-form 'custom' bonuses in its subtotals and ledger.
  const extra = {};
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category === 'verse' || b.category === 'cleanup') return;
    extra[b.teamId] = (extra[b.teamId] || 0) + (Number(b.points) || 0);
  });
  const withBonus = state.teams.filter((t) => extra[t.id]).sort((a, b) => extra[b.id] - extra[a.id]);
  const subtotalsHTML = withBonus.length
    ? `<div class="bonus-subtotals">${withBonus.map((t) =>
        `<span class="bonus-subtotal-chip">${teamEmoji(t.id)} ${esc(t.name)} <strong>${extra[t.id] > 0 ? '+' : ''}${extra[t.id]}</strong></span>`).join('')}</div>`
    : '';

  const entries = Object.entries(state.bonuses || {})
    .filter(([, b]) => b.category !== 'verse' && b.category !== 'cleanup')
    .sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const ledgerHTML = entries.length
    ? `<ul class="bonus-ledger">${entries.map(([id, b]) => {
        const cat = BONUS_CATEGORIES[b.category] || BONUS_CATEGORIES.custom;
        const when = formatEasternStamp(b.at);
        // Guard against a partially-synced entry (RTDB can prune a field).
        const pts = Number(b.points) || 0;
        return `<li class="bonus-item">
          <span class="bonus-item-main">
            <span class="bonus-item-team">${teamEmoji(b.teamId)} ${esc(teamName(b.teamId))}</span>
            <span class="bonus-item-label">${cat.icon} ${esc(b.label || 'Bonus')}${when ? ` · ${esc(when)}` : ''}</span>
          </span>
          <span class="bonus-item-pts ${pts < 0 ? 'neg' : ''}">${pts > 0 ? '+' : ''}${esc(String(pts))}${bonusCountsDouble(b) ? `<span class="bonus-x2" title="Double-points window — counts as ${pts * 2} in the standings">×2</span>` : ''}</span>
          ${canEdit() ? `<jelly-icon-button class="bonus-remove-btn" variant="rose" label="Remove this bonus" data-bonus-id="${esc(id)}">✕</jelly-icon-button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : `<p class="muted bonus-empty">No bonus points yet.</p>`;

  const doubleNote = inDoubleBonusWindow()
    ? `<div class="messtival-banner">⚡ Double points tonight &amp; Friday — bonus points count double in the standings (meal cleanup stays normal)!</div>`
    : '';
  wrap.innerHTML = doubleNote + entryHTML + subtotalsHTML + ledgerHTML;

  if (canEdit()) bindBonusEntry(wrap);
  wrap.querySelectorAll('.bonus-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bonusId;
      const b = state.bonuses[id];
      if (!b) return;
      const label = b.label || 'Bonus';
      const pts = Number(b.points) || 0;
      // Removals sync everywhere; every other destructive action confirms.
      if (!confirm(`Remove "${label}" (${pts > 0 ? '+' : ''}${pts} pts) for ${teamName(b.teamId)}?`)) return;
      delete state.bonuses[id];
      touchData();
      saveState();
      renderAll();
    });
  });
}

function bindBonusEntry(wrap) {
  const d = bonusDraft;

  wrap.querySelectorAll('.bonus-cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => { d.category = btn.dataset.cat; renderBonuses(); });
  });
  wrap.querySelectorAll('.bonus-meal-chip').forEach((btn) => {
    btn.addEventListener('click', () => { d.meal = btn.dataset.meal; renderBonuses(); });
  });
  wrap.querySelectorAll('.bonus-team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId;
      if (!canScoreRound(id)) return; // own-team guard (the chip is disabled too)
      const i = d.teams.indexOf(id);
      if (i > -1) d.teams.splice(i, 1); else d.teams.push(id);
      renderBonuses();
    });
  });
  const customInput = wrap.querySelector('#bonus-custom');
  if (customInput) customInput.addEventListener('input', () => { d.custom = customInput.value; });
  const ptsInput = wrap.querySelector('#bonus-points');
  if (ptsInput) ptsInput.addEventListener('input', () => { d.points = ptsInput.value; });
  // The iOS numeric keypad has no minus key, so the sign is a toggle button
  // (points can be deducted, e.g. penalties).
  const signBtn = wrap.querySelector('#bonus-sign');
  if (signBtn) signBtn.addEventListener('click', () => { d.sign = d.sign < 0 ? 1 : -1; renderBonuses(); });

  const addBtn = wrap.querySelector('#bonus-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const errEl = wrap.querySelector('#bonus-error');
    const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
    const mag = Math.abs(Number(d.points));
    const pts = d.sign * mag;
    if (!d.teams.length) return showErr('Pick at least one team.');
    if (d.points === '' || isNaN(mag) || mag === 0) return showErr('Enter a non-zero point value.');
    if (!Number.isInteger(pts) || Math.abs(pts) > 100) return showErr('Points must be a whole number from 1 to 100.');
    const label = bonusLabelFor(d);
    const at = new Date().toISOString();
    d.teams.forEach((teamId) => {
      state.bonuses[newBonusId()] = { teamId, category: d.category, label, points: pts, at };
    });
    d.teams = [];
    d.points = '';
    d.sign = 1; // back to the default (+) for the next entry
    if (d.category === 'custom') d.custom = '';
    touchData();
    saveState();
    renderAll();
  });
}

// ── Memory verses ────────────────────────────────────────────────
// The week's theme verse + one memory verse per camp day (Mon–Fri) —
// per-camp data (camps.js): junior's printed "Harvest of the Heart"
// sheet, senior's placeholders until its sheet exists. Counselors read
// the day's verse here and award points to teams that recite it; the
// points live in the bonus ledger under the 'verse' category.
const MEMORY_VERSE_THEME = CAMP.memoryVerseTheme;
const MEMORY_VERSES = CAMP.memoryVerses;

// Which day's verse the card is showing, and the point-entry draft. Both
// live outside state so they aren't synced or persisted (verseDay defaults
// to today each load).
let verseDay = null;

// dow -> { raw: { teamId -> stored points }, effective: { teamId -> what the
// standings count } } from the 'verse' ledger entries. `effective` weights
// each entry by its own timestamp via bonusCountsDouble() — the same rule
// medalCounts() applies — so a pre-window entry stays single even when the
// double-points window is active right now.
function versePointsByDay() {
  const map = {};
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category !== 'verse') return;
    const day = Number(b.day) || 0;
    if (!map[day]) map[day] = { raw: {}, effective: {} };
    const pts = Number(b.points) || 0;
    map[day].raw[b.teamId] = (map[day].raw[b.teamId] || 0) + pts;
    map[day].effective[b.teamId] = (map[day].effective[b.teamId] || 0) + pts * (bonusCountsDouble(b) ? 2 : 1);
  });
  return map;
}

function renderMemoryVerse() {
  const wrap = document.getElementById('verse-body');
  if (!wrap) return;
  // Default to today's verse (Mon–Fri); fall back to Monday on the weekend.
  if (verseDay == null) {
    const dow = campNow().dow;
    verseDay = (dow >= 1 && dow <= 5) ? dow : 1;
  }
  const verse = MEMORY_VERSES[verseDay];
  const todayDow = campNow().dow;

  const themeHTML = `
    <div class="verse-theme">
      <span class="verse-theme-label">📖 Theme Verse · ${esc(MEMORY_VERSE_THEME.title)}</span>
      <p class="verse-theme-text">“${esc(MEMORY_VERSE_THEME.text)}”</p>
      <p class="verse-theme-ref">${esc(MEMORY_VERSE_THEME.ref)}</p>
    </div>`;

  const dayChips = `<div class="verse-day-row">${[1, 2, 3, 4, 5].map((dow) =>
    `<jelly-chip class="verse-day-chip" selectable size="small" ${dow === verseDay ? 'selected' : ''} data-verse-day="${dow}">${DAY_NAMES[dow].slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</jelly-chip>`).join('')}</div>`;

  const verseVideo = verse.video
    ? `<a class="verse-video-link" href="${esc(verse.video)}" target="_blank" rel="noopener noreferrer">▶️ Watch the video</a>`
    : '';
  const verseBox = `
    <div class="verse-day-card">
      <span class="verse-day-name">${esc(DAY_NAMES[verseDay])}</span>
      <p class="verse-day-text">“${esc(verse.text)}”</p>
      <p class="verse-day-ref">${esc(verse.ref)}</p>
      ${verseVideo}
    </div>`;

  // One row per team: the day's verse points, shown exactly once. Editors
  // set a team's points by tapping 0–5 directly (0 clears); no separate
  // pick-teams-then-type flow, no duplicate summary chips + ledger.
  //
  // The stored/tapped scale always stays 0–5 raw (setVersePoints, the
  // selected-chip check, and data-pts below all use the raw number) —
  // bonusCountsDouble() is what actually doubles it in the standings, keyed
  // off each entry's own timestamp. On screen: tap-button labels show what a
  // tap made RIGHT NOW is worth (new entries are stamped "now", so during
  // the window a perfect recitation reads "10", not a "5" that quietly
  // becomes 10 elsewhere), while each team's shown total is the per-entry
  // effective value — a Monday entry viewed on Friday stays single, exactly
  // as the standings count it.
  const earned = versePointsByDay()[verseDay] || { raw: {}, effective: {} };
  const editing = canEdit();
  const doubleWindow = inDoubleBonusWindow();
  const displayMult = doubleWindow ? 2 : 1;
  const hint = editing
    ? `<p class="bonus-entry-hint muted">Tap a team's points for ${esc(DAY_NAMES[verseDay])}'s verse — 0 clears them.${doubleWindow ? ' Double points are on — the tap values already show the doubled worth.' : ''}</p>`
    : '';
  const rowsHTML = `<div class="pts-grid">${state.teams.map((t) => {
    const pts = earned.raw[t.id] || 0; // raw stored value (0–5)
    const displayPts = earned.effective[t.id] || 0; // what it's actually worth in the standings
    // The own-team guard: a team's own verse points are that team's "round".
    const btns = editing && canScoreRound(t.id)
      ? `<div class="pts-btn-row" data-team-id="${t.id}" role="group" aria-label="${esc(t.name)} verse points">
          ${[0, 1, 2, 3, 4, 5].map((n) =>
            `<jelly-chip class="pts-btn" selectable shape="square" ${pts === n ? 'selected' : ''} data-pts="${n}">${n * displayMult}</jelly-chip>`).join('')}
        </div>`
      : '';
    return `<div class="pts-row">
      <span class="pts-row-team">${teamEmoji(t.id)} ${esc(t.name)}${displayPts > 5 ? ` <span class="pts-row-total">+${displayPts}</span>` : ((!editing || !canScoreRound(t.id)) && displayPts > 0 ? ` <span class="pts-row-total">+${displayPts}</span>` : '')}</span>
      ${btns}${editing && blockedByOwnTeam(t.id) ? '<span class="pts-row-locked">🛡️ your team</span>' : ''}
    </div>`;
  }).join('')}</div>`;
  const anyEarned = state.teams.some((t) => earned.raw[t.id]);
  const emptyHTML = (!editing && !anyEarned)
    ? `<p class="muted bonus-empty">No verse points recorded for ${esc(DAY_NAMES[verseDay])} yet.</p>`
    : '';

  const doubleNote = inDoubleBonusWindow()
    ? `<div class="messtival-banner">⚡ Double points tonight &amp; Friday — verse points count double in the standings!</div>`
    : '';
  wrap.innerHTML = doubleNote + themeHTML + dayChips + verseBox + hint + (editing || anyEarned ? rowsHTML : '') + emptyHTML;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      verseDay = parseInt(btn.dataset.verseDay, 10);
      renderMemoryVerse();
      joyStagger(document.querySelector('#verse-body .pts-grid'));
    });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.pts-btn-row').dataset.teamId;
      setVersePoints(teamId, verseDay, parseInt(btn.dataset.pts, 10));
    });
  });
}

// Sets a team's verse points for a day to exactly `pts` — replaces any
// existing entries for that (team, day) so the ledger holds one truth.
function setVersePoints(teamId, dow, pts) {
  if (!canScoreRound(teamId)) return; // own-team guard
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'verse' && b.teamId === teamId && (Number(b.day) || 0) === dow) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[newBonusId()] = {
      teamId, category: 'verse', label: `${DAY_NAMES[dow]} memory verse`,
      points: pts, at: new Date().toISOString(), day: dow,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Meal cleanup ─────────────────────────────────────────────────
// Each meal, a team is on cleanup. The rota (who cleans which meal each day)
// is fixed data below; points earned are stored in the bonus ledger under the
// 'cleanup' category, tagged with day + meal, so they flow into the week
// standings — same pattern as Memory Verse. A missing meal key = TBA.
const MEAL_CLEANUP_MEALS = ['Breakfast', 'Lunch', 'Supper'];
const MEAL_ICONS = { Breakfast: '🍳', Lunch: '🥪', Supper: '🍲' };
// The rota itself is per-camp data (camps.js) — junior's printed 6-team
// rota, senior's still-empty one (every meal TBA until filled in).
const MEAL_CLEANUP_SCHEDULE = CAMP.mealCleanupSchedule;

// The team assigned to a given day + meal, or null (TBA).
function cleanupAssigned(day, meal) {
  const d = MEAL_CLEANUP_SCHEDULE[day];
  return (d && d[meal]) || null;
}

// Start time of each meal (same across Mon–Fri, per the junior weekday schedule) —
// lets findNextCleanupFor skip a meal that's already started today.
const MEAL_START_MINUTES = { Breakfast: hm(8, 0), Lunch: hm(12, 0), Supper: hm(17, 0) };

// The soonest known meal-cleanup duty for `teamId` (today's remaining meals,
// then the rest of the week) — used by the "Your team" summary card's
// "Next meal cleanup" line. null if nothing's assigned yet (still TBA) or
// the week's meals are done.
function findNextCleanupFor(teamId) {
  if (!teamId) return null;
  const { dow: todayDow, minutes: nowMinutes } = campNow();
  for (let day = Math.max(todayDow, 1); day <= 5; day++) {
    for (const meal of MEAL_CLEANUP_MEALS) {
      if (day === todayDow && MEAL_START_MINUTES[meal] <= nowMinutes) continue;
      const assigned = cleanupAssigned(day, meal);
      const teams = assigned ? (Array.isArray(assigned) ? assigned : [assigned]) : [];
      if (teams.includes(teamId)) return { day, meal };
    }
  }
  return null;
}

// Which day's rota the card is showing + the entry draft (not synced).
let cleanupDay = null;

// Total cleanup points recorded for one day + meal.
function cleanupMealPoints(day, meal) {
  let sum = 0;
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category === 'cleanup' && (Number(b.day) || 0) === day && b.meal === meal) {
      sum += Number(b.points) || 0;
    }
  });
  return sum;
}

function renderMealCleanup() {
  const wrap = document.getElementById('cleanup-body');
  if (!wrap) return;
  // Default to today (Mon–Fri, else Monday).
  if (cleanupDay == null) {
    const dow = campNow().dow;
    cleanupDay = (dow >= 1 && dow <= 5) ? dow : 1;
  }
  const todayDow = campNow().dow;

  const dayChips = `<div class="verse-day-row">${[1, 2, 3, 4, 5].map((dow) =>
    `<jelly-chip class="verse-day-chip" selectable size="small" ${dow === cleanupDay ? 'selected' : ''} data-cleanup-day="${dow}">${DAY_NAMES[dow].slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</jelly-chip>`).join('')}</div>`;

  const rotaHTML = `<div class="cleanup-rota">${MEAL_CLEANUP_MEALS.map((meal) => {
    const teamIds = cleanupAssigned(cleanupDay, meal);
    const pts = cleanupMealPoints(cleanupDay, meal);
    const teams = teamIds ? (Array.isArray(teamIds) ? teamIds : [teamIds]) : [];
    const teamStr = teams.length > 0
      ? teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ')
      : '<span class="cleanup-tba">TBA</span>';
    return `<div class="cleanup-meal-row">
      <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
      <span class="cleanup-meal-team">${teamStr}</span>
      ${pts ? `<span class="cleanup-meal-pts">+${pts}</span>` : ''}
    </div>`;
  }).join('')}</div>`;

  // The rota IS the interface: one block per meal showing the assigned team,
  // and (for editors) the 0–3 point buttons right on it — no separate meal
  // chips or repeated team list. Viewers see the same rota with +N badges.
  const editing = canEdit();
  const earnedFor = (meal) => {
    const out = {};
    Object.values(state.bonuses || {}).forEach((b) => {
      if (b && b.category === 'cleanup' && (Number(b.day) || 0) === cleanupDay && (b.meal || 'Breakfast') === meal) {
        out[b.teamId] = (out[b.teamId] || 0) + (Number(b.points) || 0);
      }
    });
    return out;
  };

  let entryHTML = '';
  if (editing) {
    entryHTML = MEAL_CLEANUP_MEALS.map((meal) => {
      const assignedIds = cleanupAssigned(cleanupDay, meal);
      const assigned = assignedIds ? (Array.isArray(assignedIds) ? assignedIds : [assignedIds]) : [];
      const earned = earnedFor(meal);
      // Rota team(s) first; then any team that somehow has points for this
      // meal without being on the rota (rota edits, old data) so it stays
      // clearable rather than invisible.
      const rows = assigned.concat(state.teams.map((t) => t.id).filter((id) => earned[id] && !assigned.includes(id)));
      const body = rows.length
        ? rows.map((id) => {
            const pts = earned[id] || 0;
            // The own-team guard: a team's own cleanup score is its round.
            const locked = blockedByOwnTeam(id);
            return `<div class="pts-row">
              <span class="pts-row-team">${teamEmoji(id)} ${esc(teamName(id))}${assigned.includes(id) ? '' : ' <span class="pts-row-total">not on rota</span>'}${pts > 3 || locked ? ` <span class="pts-row-total">+${pts}</span>` : ''}</span>
              ${locked ? '<span class="pts-row-locked">🛡️ your team</span>' : `<div class="pts-btn-row" data-team-id="${esc(id)}" data-meal="${esc(meal)}" role="group" aria-label="${esc(teamName(id))} ${esc(meal)} cleanup points">
                ${[0, 1, 2, 3].map((n) =>
                  `<jelly-chip class="pts-btn" selectable shape="square" ${pts === n ? 'selected' : ''} data-pts="${n}">${n}</jelly-chip>`).join('')}
              </div>`}
            </div>`;
          }).join('')
        : '<p class="muted bonus-empty">No team on the rota yet.</p>';
      return `<div class="cleanup-meal-block">
        <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
        ${body}
      </div>`;
    }).join('');
  }

  // Legacy cleanup entries with no day (from the old Bonus card) — surface them
  // so their points aren't invisible even though they still count in totals.
  const legacy = Object.entries(state.bonuses || {})
    .filter(([, b]) => b.category === 'cleanup' && !(Number(b.day) >= 1 && Number(b.day) <= 5))
    .sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const legacyHTML = legacy.length
    ? `<p class="bonus-entry-hint muted">Earlier cleanup points (no day set):</p>
       <ul class="bonus-ledger">${legacy.map(([id, b]) => {
        const pts = Number(b.points) || 0;
        return `<li class="bonus-item">
          <span class="bonus-item-main">
            <span class="bonus-item-team">${teamEmoji(b.teamId)} ${esc(teamName(b.teamId))}</span>
            <span class="bonus-item-label">🧽 ${esc(b.label || 'Cleanup')}</span>
          </span>
          <span class="bonus-item-pts">+${esc(String(pts))}</span>
          ${canEdit() ? `<jelly-icon-button class="bonus-remove-btn" variant="rose" label="Remove this cleanup point" data-bonus-id="${esc(id)}">✕</jelly-icon-button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : '';

  // Editors get the interactive rota (entryHTML); viewers the read-only one.
  wrap.innerHTML = dayChips + (editing ? entryHTML : rotaHTML) + legacyHTML;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      cleanupDay = parseInt(btn.dataset.cleanupDay, 10);
      renderMealCleanup();
      joyStagger(document.querySelector('#cleanup-body .cleanup-rota, #cleanup-body .pts-grid'));
    });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.pts-btn-row');
      setCleanupPoints(row.dataset.teamId, cleanupDay, row.dataset.meal, parseInt(btn.dataset.pts, 10));
    });
  });
  wrap.querySelectorAll('.bonus-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bonusId;
      const b = state.bonuses[id];
      if (!b) return;
      const pts = Number(b.points) || 0;
      if (!confirm(`Remove +${pts} cleanup point${pts === 1 ? '' : 's'} for ${teamName(b.teamId)}?`)) return;
      delete state.bonuses[id];
      touchData();
      saveState();
      renderAll();
    });
  });
}

// Sets a team's cleanup points for a day+meal to exactly `pts` — replaces
// any existing entries for that (team, day, meal).
function setCleanupPoints(teamId, dow, meal, pts) {
  if (!canScoreRound(teamId)) return; // own-team guard
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'cleanup' && b.teamId === teamId &&
        (Number(b.day) || 0) === dow && (b.meal || 'Breakfast') === meal) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[newBonusId()] = {
      teamId, category: 'cleanup', label: `${DAY_NAMES[dow]} ${meal} cleanup`,
      points: pts, at: new Date().toISOString(), day: dow, meal,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Day tabs + game list ─────────────────────────────────────────

// The day nav is a jelly-tabs: one jelly-tab-panel per configured day, each
// pre-rendered with that day's full lineup. Switching days is handled
// entirely by the component (panel fade, pill spring) — the change handler
// only records state.ui.day, no renderAll round-trip. jelly-tabs builds its
// tab bar once at connect from the panels present, so this render always
// writes a fresh element (day set edits in the builder are picked up on the
// next render).
function renderDayTabs() {
  const nav = document.getElementById('day-tabs');
  if (!nav) return;
  const days = state.config.days;
  const todayDow = campNow().dow; // camp time, not device time
  if (!days.some((d) => d.id === state.ui.day)) state.ui.day = defaultDay(state.config);
  const todayDay = days.find((d) => d.dow === todayDow);

  nav.innerHTML = `<jelly-tabs class="day-tabs" size="small" value="${esc(state.ui.day)}">` +
    days.map((d) =>
      `<jelly-tab-panel value="${esc(d.id)}" label="${esc(d.name.slice(0, 3))}${d.dow === todayDow ? ' •' : ''}"${d.id === state.ui.day ? ' active' : ''}>
        ${dayNoteHTML(d, todayDay)}
        <div class="day-panel-body">${dayGamesHTML(d)}</div>
      </jelly-tab-panel>`).join('') +
    '</jelly-tabs>';

  const tabs = nav.querySelector('jelly-tabs');
  tabs.addEventListener('change', (e) => {
    const value = e.detail && e.detail.value;
    if (!value || value === state.ui.day) return;
    state.ui.day = value;
    // Leave any open game view — the panels themselves are already rendered,
    // so no renderAll: the component's own panel transition is the animation.
    if (state.ui.gameId) { state.ui.gameId = null; renderGameView(); }
    saveState();
  });

  wireDayPanels(nav);
}

// The "you're not looking at today" note, now rendered per panel.
function dayNoteHTML(day, todayDay) {
  let text = null;
  if (!todayDay) text = 'No games today — showing ' + day.name + "'s lineup.";
  else if (todayDay.id !== day.id) text = 'Heads up: today is ' + todayDay.name + ' — you are viewing ' + day.name + '.';
  return text ? `<p class="day-note">${esc(text)}</p>` : '';
}

const FORMAT_BADGES = {
  tournament: { label: 'Bracket', cls: 'badge-bracket', variant: 'azure' },
  tally: { label: 'Score entry', cls: 'badge-tally', variant: 'amber' },
  placement: { label: 'Podium pick', cls: 'badge-podium', variant: 'platinum' },
};

function gameStatus(g) {
  if (state.results[g.id]) return 'done';
  if (state.brackets[g.id]) return 'in-progress';
  const d = state.drafts[g.id];
  if (d && ((d.scores && Object.values(d.scores).some((v) => String(v).trim() !== '')) || (d.medals && Object.values(d.medals).some(Boolean)))) return 'in-progress';
  return 'ready';
}

// One day's full lineup, rendered into its jelly-tab-panel by renderDayTabs.
function dayGamesHTML(day) {
  const dayGames = state.config.games.filter((g) => g.dayId === day.id);
  const knownSessions = state.config.sessions;
  // Defensive: still show games whose session isn't in the configured list.
  const sessions = knownSessions.concat(
    [...new Set(dayGames.map((g) => g.session))].filter((s) => !knownSessions.includes(s))
  );

  let html = '';
  // Double-points banner — day-agnostic (the flag started as Messtival-only
  // but Thursday evening + all Friday are doubled too). Name the games when
  // only some of the day is doubled.
  const doubledGames = dayGames.filter((g) => g.messtival);
  if (doubledGames.length === dayGames.length && dayGames.length) {
    html += `<div class="messtival-banner">🎉 Double points day — every game counts double right here in the standings!</div>`;
  } else if (doubledGames.length) {
    html += `<div class="messtival-banner">⚡ Double points: ${doubledGames.map((g) => `${esc(g.emoji)} ${esc(g.name)}`).join(', ')} — counted double in the standings!</div>`;
  }
  if (day.note) {
    html += day.note.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => `<div class="messtival-banner">${esc(l)}</div>`).join('');
  }
  if (!dayGames.length) {
    html += `<p class="muted session-empty">No games scheduled for ${esc(day.name)} yet.</p>`;
    if (canEdit()) {
      html += `<button class="link-btn empty-day-builder-btn">🛠️ Set up games in Settings</button>`;
    }
  }

  sessions.forEach((session) => {
    const games = dayGames.filter((g) => g.session === session);
    if (!games.length) return;
    html += `<h2 class="session-heading">${esc(session)}</h2>`;
    games.forEach((g) => {
      const status = gameStatus(g);
      const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
      const res = state.results[g.id];
      html += `<button class="game-card ${status}" data-game-id="${esc(g.id)}">
        <div class="game-card-top">
          <span class="game-emoji">${esc(g.emoji)}</span>
          <div class="game-card-titles">
            <span class="game-name">${esc(g.name)}</span>
            <span class="game-loc">📍 ${esc(g.location)}</span>
          </div>
          <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge>
        </div>
        <p class="game-headline">${esc(g.headline)}</p>
        ${res ? `<div class="game-result-line">🥇 ${esc(teamName(res.medals.gold))} · 🥈 ${esc(teamName(res.medals.silver))} · 🥉 ${esc(teamName(res.medals.bronze))}</div>`
          : status === 'in-progress' ? `<div class="game-progress-line">⏱️ In progress — tap to continue</div>` : ''}
      </button>`;
    });
  });

  // Editors get a one-tap way to slot in an unplanned game (rainy-day pivot,
  // spontaneous rematch) without digging through the week builder.
  if (canEdit() && dayGames.length) {
    html += `<button class="link-btn quick-game-btn">⚡ Quick game — add a one-off to ${esc(day.name)}</button>`;
  }
  return html;
}

// Wire every panel's game cards + editor shortcuts (classes, not ids — the
// same controls now exist once per day panel).
function wireDayPanels(nav) {
  nav.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.ui.gameId = card.dataset.gameId;
      saveState();
      renderAll();
      joySlideIn(document.getElementById('game-view'));
      document.getElementById('game-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  nav.querySelectorAll('.empty-day-builder-btn').forEach((btn) =>
    btn.addEventListener('click', () => openBuilder('games')));
  nav.querySelectorAll('.quick-game-btn').forEach((btn) =>
    btn.addEventListener('click', () => startQuickGame()));
}

// ── Game view ────────────────────────────────────────────────────

// The game id rendered on the previous pass — lets renderGameView act only
// on open/close TRANSITIONS (folding the accordion) instead of every render.
let lastGameViewId = null;

function renderGameView() {
  const view = document.getElementById('game-view');
  const dayNav = document.getElementById('day-tabs'); // tabs + per-day panels
  const g = state.ui.gameId ? gameById(state.ui.gameId) : null;

  // Focus handoff: entering a game folds the home accordion shut (the game
  // card is the whole screen); leaving it re-opens Competitions so you land
  // back on the list you came from. Only on the transition — a re-render
  // while a game is open must not fight a panel someone peeked into.
  if (!!g !== !!lastGameViewId || (g && g.id !== lastGameViewId)) {
    const comp = document.querySelector('.competitions-card');
    if (g) {
      document.querySelectorAll('.collapsible-card[open]').forEach((d) => {
        if (typeof d.toggle === 'function') d.toggle(false);
        else d.removeAttribute('open');
      });
    } else if (comp && !comp.hidden) {
      // Skipped when Competitions is hidden from this viewer — otherwise it
      // would sit open behind the scenes and pop out already-expanded if the
      // editor un-hid it later.
      if (typeof comp.toggle === 'function') comp.toggle(true);
      else comp.setAttribute('open', '');
    }
  }
  lastGameViewId = g ? g.id : null;

  if (!g) {
    view.hidden = true;
    if (dayNav) dayNav.hidden = false;
    return;
  }
  view.hidden = false;
  if (dayNav) dayNav.hidden = true;

  const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
  const backDay = dayById(g.dayId);
  let html = `
    <button id="back-btn" class="link-btn back-btn">← ${esc(backDay ? backDay.name : 'All')} games</button>
    <div class="game-view-header">
      <span class="game-emoji-lg">${esc(g.emoji)}</span>
      <div>
        <h2>${esc(g.name)}</h2>
        <p class="muted">📍 ${esc(g.location)} · ${esc(g.session)} · <jelly-badge class="format-badge" variant="${esc(badge.variant || 'platinum')}" size="small">${esc(badge.label)}</jelly-badge></p>
      </div>
    </div>
    ${g.messtival ? '<p class="messtival-tag">🎉 Double points — counted double in the standings!</p>' : ''}
    ${(g.rules || []).length ? `<details class="rules-details">
      <summary>How to play</summary>
      ${g.rules.map((sec) => `
        <h4>${esc(sec.h)}</h4>
        <ul>${(sec.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      `).join('')}
    </details>` : ''}
    <div id="clock-area"></div>
    <div id="tools-area"></div>
    <div id="entry-area"></div>
  `;
  view.innerHTML = html;

  document.getElementById('back-btn').addEventListener('click', () => {
    state.ui.gameId = null;
    saveState();
    renderAll();
    joyStagger(document.querySelector('#day-tabs jelly-tab-panel[active] .day-panel-body'));
  });

  // Standalone game clock — everyone sees it tick live; only editors get the
  // controls (clockBlockHTML handles that). Live-tracker games show their clock
  // on the Big Board instead, so they're excluded here to avoid a double clock.
  if (g.timer && !g.liveTracker && !state.results[g.id]) {
    const ca = document.getElementById('clock-area');
    if (ca) { ca.innerHTML = clockBlockHTML(g); bindClock(ca, g); }
  }

  // Pictionary keeps its tools visible after the result is saved so
  // photos can still be exported; other tools hide once the game is done.
  // Viewers don't get the score-entry tools at all.
  if (canEdit() && (g.timer || g.prompts) && (g.prompts || !state.results[g.id])) {
    renderTools(document.getElementById('tools-area'), g);
  }

  const entry = document.getElementById('entry-area');
  const result = state.results[g.id];
  if (result) {
    renderResult(entry, g, result);
  } else if (!canEdit()) {
    renderLiveWatch(entry, g);
  } else if (g.format === 'tournament') {
    renderTournament(entry, g);
  } else if (g.format === 'tally') {
    renderTally(entry, g);
  } else {
    renderPlacement(entry, g);
  }
}

// Games with a bracket in progress (started, not yet finalized) — surfaced
// as a highlighted "Live now" card at the top of the home screen.
// Ranked live standings for a `liveRankings` tally game (Inflatable Bowling,
// Pictionary), read straight from the synced draft scores so viewers see the
// board climb in real time. For Pictionary the per-team totals are filled by
// the round runner as each team finishes; only times/points are ever exposed —
// never the drawing words.
function tallyRankLive(g) {
  const d = state.drafts && state.drafts[g.id];
  const entries = [];
  if (d && d.scores) {
    state.teams.forEach((t) => {
      const raw = d.scores[t.id];
      if (raw === undefined || String(raw).trim() === '') return;
      const v = parseScoreInput(g, raw);
      if (v !== null) entries.push({ id: t.id, v });
    });
    entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  }
  return entries;
}

function tallyInProgress(g) {
  return !!g.liveRankings && !state.results[g.id] && tallyRankLive(g).length > 0;
}

function liveHomeGames() {
  return state.config.games.filter((g) => {
    const b = state.brackets && state.brackets[g.id];
    if (b && normalizeBracket(b).phase !== 'summary') return true;
    return tallyInProgress(g);
  });
}

// The game whose Big Board should take over the top of the home screen: a
// live-tracked matchup in progress (preferred), or — if none — an
// all-teams-at-once liveRankings tally game being scored. Either way the user
// mustn't already be watching it in the game view (no double board).
function homeBoardGame() {
  const games = liveHomeGames();
  const g = games.find((x) => {
    if (!x.liveTracker) return false;
    const b = state.brackets && state.brackets[x.id];
    return b && currentMatchupOf(x, normalizeBracket(b));
  }) || games.find((x) => x.liveRankings);
  if (!g || state.ui.gameId === g.id) return null;
  return g;
}

// Renders the highlighted "Live now" card(s) at the top of the home screen so
// spectators (and refs) see the current matchup + live score without opening
// the game. Hidden entirely when nothing is live. Kept current by renderAll,
// which fires on every synced update. When a live-tracked match is running,
// the FULL Big Board takes this slot (and the Happening-now banner yields).
function renderLiveHome() {
  const wrap = document.getElementById('live-home');
  if (!wrap) return;
  let games = liveHomeGames();
  if (!games.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;

  let boardHTML = '';
  const bg = homeBoardGame();
  if (bg) {
    let boardBody;
    if (bg.liveTracker) {
      const pair = currentMatchupOf(bg, normalizeBracket(state.brackets[bg.id]));
      boardBody = liveTrackerHTML(bg, pair[0], pair[1], true);
    } else {
      boardBody = tallyBoardHTML(bg);
    }
    boardHTML = `<div class="home-board" data-game-id="${esc(bg.id)}" role="button" tabindex="0" aria-label="Open ${esc(bg.name)}">
      <p class="home-board-title">${esc(bg.emoji)} ${esc(bg.name)} <span class="home-board-open">tap to open ›</span></p>
      ${boardBody}
    </div>`;
    games = games.filter((x) => x.id !== bg.id);
  }

  wrap.innerHTML = boardHTML + games.map((g) => {
    if (!(state.brackets && state.brackets[g.id])) return liveHomeTallyCard(g); // tally live board
    const b = normalizeBracket(state.brackets[g.id]);
    const phaseLabel = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final', summary: 'Results' }[b.phase] || '';
    const pair = currentMatchupOf(g, b);
    let scoreHTML;
    if (pair && g.ladderScoring) {
      const l = getLadderMatch(g, pair[0], pair[1]);
      const target = g.ladderScoring.target || 21;
      scoreHTML = `<span class="live-home-score">
        <span class="lh-team">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))}</span>
        <span class="lh-nums">${l.a}<span class="lh-dash">–</span>${l.b}</span>
        <span class="lh-team">${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>
      </span>
      <span class="live-home-sub">First to ${target}</span>`;
    } else if (pair && g.liveTracker) {
      const l = getLiveMatch(g, pair[0], pair[1]);
      const periodLabel = g.liveTracker.periodLabel || 'Inning';
      scoreHTML = `<span class="live-home-score">
        <span class="lh-team">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))}</span>
        <span class="lh-nums">${l.hr[pair[0]] || 0}<span class="lh-dash">–</span>${l.hr[pair[1]] || 0}</span>
        <span class="lh-team">${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>
      </span>
      <span class="live-home-sub">${(g.liveTracker.innings || 3) > 1 ? `${esc(periodLabel)} ${l.inning} of ${g.liveTracker.innings || 3}` : esc(g.liveTracker.unit || 'Live score')}${g.liveTracker.outs ? ` · ${outsLabel(l.outs)} · ${teamEmoji(kickingTeamId(l, pair[0], pair[1]))} ${esc(teamName(kickingTeamId(l, pair[0], pair[1])))} ${esc(g.liveTracker.sideLabel || 'up')}` : ''}</span>`;
    } else if (pair) {
      scoreHTML = `<span class="live-home-matchup">${teamEmoji(pair[0])} ${esc(teamName(pair[0]))} <span class="lh-vs">vs</span> ${teamEmoji(pair[1])} ${esc(teamName(pair[1]))}</span>`;
    } else {
      scoreHTML = `<span class="live-home-sub">${phaseLabel} in progress — tap to watch</span>`;
    }
    const nxt = nextMatchupOf(g, b);
    const onDeckHTML = nxt
      ? `<span class="live-home-ondeck">⏭️ Up next: ${teamEmoji(nxt[0])} ${esc(teamName(nxt[0]))} vs ${teamEmoji(nxt[1])} ${esc(teamName(nxt[1]))}</span>`
      : '';
    return `<button class="live-home-card" data-game-id="${esc(g.id)}">
      <span class="live-home-top"><span class="live-home-badge">🔴 LIVE</span><span class="live-home-game">${esc(g.emoji)} ${esc(g.name)} · ${phaseLabel}</span></span>
      ${scoreHTML}
      ${onDeckHTML}
    </button>`;
  }).join('');

  const openGame = (gid) => {
    const g = gameById(gid);
    if (!g) return;
    state.ui.gameId = g.id;
    state.ui.day = g.dayId;
    saveState();
    renderAll();
    const gv = document.getElementById('game-view');
    joySlideIn(gv);
    if (gv) gv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  wrap.querySelectorAll('.live-home-card').forEach((btn) => {
    btn.addEventListener('click', () => openGame(btn.dataset.gameId));
  });
  const hb = wrap.querySelector('.home-board');
  if (hb) {
    hb.addEventListener('click', () => openGame(hb.dataset.gameId));
    hb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openGame(hb.dataset.gameId); });
    const g = gameById(hb.dataset.gameId);
    const b = g && state.brackets[g.id] && normalizeBracket(state.brackets[g.id]);
    const pair = b && currentMatchupOf(g, b);
    if (pair) boardDiffCelebrate(hb.querySelector('.big-board'), g, getLiveMatch(g, pair[0], pair[1]), pair);
  }
}

// Compact "Live now" card for a tally game being scored (Inflatable Bowling,
// Pictionary): the current leader + how many teams are in. Times/points only.
function liveHomeTallyCard(g) {
  const ranked = tallyRankLive(g);
  const top = ranked[0];
  const complete = ranked.length >= state.teams.length;
  const scoreLine = top
    ? `<span class="live-home-score"><span class="lh-team">${teamEmoji(top.id)} ${esc(teamName(top.id))}</span><span class="lh-nums">${esc(formatScore(g, top.v))}</span></span>`
    : '<span class="live-home-sub">Scoring under way…</span>';
  return `<button class="live-home-card" data-game-id="${esc(g.id)}">
    <span class="live-home-top"><span class="live-home-badge">🔴 LIVE</span><span class="live-home-game">${esc(g.emoji)} ${esc(g.name)}</span></span>
    ${scoreLine}
    <span class="live-home-sub">${g.lowerWins ? 'Fastest so far' : 'Leader'} · ${ranked.length}/${state.teams.length} teams in${complete ? ' · 🏅 medals ready' : ''}</span>
  </button>`;
}

// Big-board treatment for an all-teams-at-once tally game (Counselor Hide and
// Seek and any other liveRankings game), used when it's promoted to the top
// of the home screen: every team's running score shown large, ranked live,
// plus the game clock when the game has one (same idea as liveBoardHTML for
// head-to-head games, just shaped for N teams instead of 2). The game's OWN
// page uses the smaller renderLiveTallyWatch instead — its clock already
// comes from #clock-area, so this board's clock would just duplicate it there.
function tallyBoardHTML(g) {
  const ranked = tallyRankLive(g);
  const complete = ranked.length >= state.teams.length;
  const medals = ['🥇', '🥈', '🥉'];
  const clock = g.timer ? getClock(g) : null;
  const remaining = clock ? clockRemaining(clock) : 0;
  const rows = ranked.length ? ranked.map((e, i) => `
    <div class="board-tally-row${i < 3 ? ' board-tally-podium' : ''}" style="--team-accent: ${TEAM_ACCENT[e.id] || 'var(--color-primary)'}">
      <span class="board-tally-rank">${complete && i < 3 ? medals[i] : (i + 1) + '.'}</span>
      <span class="board-tally-team">${teamEmoji(e.id)} ${esc(teamName(e.id))}</span>
      <span class="board-tally-score">${esc(formatScore(g, e.v))}</span>
    </div>`).join('') : '<p class="muted">Scoring under way…</p>';
  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}" data-prev="${remaining}">${fmtBoardClock(remaining)}</span>
    </div>` : '';
  return `<div class="big-board viewer" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="live-home-badge">🔴 LIVE</span>
      <span class="board-period">${g.lowerWins ? 'Fastest so far' : 'Team totals'} · ${ranked.length}/${state.teams.length} in</span>
    </div>
    ${clockHTML}
    <div class="board-tally-rows">${rows}</div>
  </div>`;
}

// The matchup a bracket is currently waiting on a winner for — used by the
// read-only live-watch view so spectators see who's playing right now.
function currentMatchupOf(g, b) {
  if (!b) return null;
  if (b.phase === 'round1') {
    if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
      return g.roundOneMatchups[(b.matches || []).length] || null;
    }
    return (b.selectedPair && b.selectedPair.length === 2) ? b.selectedPair : null;
  }
  if (b.phase === 'semifinal' && b.semifinal && b.semifinal.winner == null) return [b.semifinal.a, b.semifinal.b];
  if (b.phase === 'championship' && b.championship && b.championship.winner == null) return [b.championship.a, b.championship.b];
  return null;
}

// The matchup that will be played AFTER the current one, when it's already
// known — i.e. the next pair in a fixed-order Round 1. Returns null when the
// next pairing can't be known yet (free pick, or a later stage whose teams
// aren't decided). Drives the "Up next" line under the live score.
function nextMatchupOf(g, b) {
  if (!b || b.phase !== 'round1') return null;
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    return g.roundOneMatchups[(b.matches || []).length + 1] || null;
  }
  return null;
}

// Read-only live view for spectators (no score PIN): the current matchup,
// its live inning/tally (synced from the ref's device), and completed
// matches. Re-rendered by renderAll whenever a synced update lands.
// Note: no clock here — for the game's OWN page, #clock-area (renderGameView)
// already shows the standalone game clock above this view; a second one here
// would just duplicate it. tallyBoardHTML's clock is for the home-screen
// promoted board only, a separate spot with no clock of its own.
function renderLiveTallyWatch(container, g) {
  const ranked = tallyRankLive(g);
  if (!ranked.length) {
    container.innerHTML = `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)}</p>
      <p class="muted">Live rankings will appear here as the ref enters scores — no refresh needed.</p>
    </div>`;
    return;
  }
  const complete = ranked.length >= state.teams.length;
  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranked.map((e, i) => `
    <li class="lw-rank-row${i < 3 ? ' lw-podium' : ''}">
      <span class="lw-rank">${complete && i < 3 ? medals[i] : (i + 1) + '.'}</span>
      <span class="lw-rank-team">${teamEmoji(e.id)} ${esc(teamName(e.id))}</span>
      <span class="lw-rank-score">${esc(formatScore(g, e.v))}</span>
    </li>`).join('');
  container.innerHTML = `<div class="live-watch live-watch-board">
    <p class="live-watch-label">🔴 Live now · ${esc(g.name)}</p>
    <p class="live-watch-board-sub">${g.lowerWins ? 'Fastest total time' : 'Team totals'} · ${ranked.length}/${state.teams.length} teams in</p>
    <ol class="lw-rank-list">${rows}</ol>
    ${complete
      ? `<p class="live-watch-suggest">🏅 Suggested: 🥇 ${esc(teamName(ranked[0].id))} · 🥈 ${esc(teamName(ranked[1].id))} · 🥉 ${esc(teamName(ranked[2].id))}</p>`
      : '<p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>'}
  </div>`;
}

function renderLiveWatch(container, g) {
  // Tally games with live rankings (Inflatable Bowling, Pictionary) show a
  // read-only leaderboard rather than a bracket matchup.
  if (g.liveRankings && !(state.brackets && state.brackets[g.id])) {
    renderLiveTallyWatch(container, g);
    return;
  }
  const raw = state.brackets && state.brackets[g.id];
  if (!raw) {
    container.innerHTML = `<p class="view-only-note">👀 View-only. This game hasn't been scored yet. Tap <strong>🔒 View only</strong> at the top and enter the score PIN to run it.</p>`;
    return;
  }
  const b = normalizeBracket(raw);
  const phaseLabel = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final', summary: 'Results' }[b.phase] || '';
  const pair = currentMatchupOf(g, b);

  const done = (b.matches || []).map((m) =>
    `<li>${teamEmoji(m.winner)} ${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('');
  const doneHTML = done ? `<div class="live-watch-done"><p class="muted">Completed:</p><ul>${done}</ul></div>` : '';

  if (!pair) {
    container.innerHTML = `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)} — ${phaseLabel} in progress</p>
      <p class="muted">Waiting for the next matchup…</p>
      ${doneHTML}
    </div>`;
    return;
  }

  // Every live game gets the same big-board treatment now — giant scores, the
  // live clock, and (for goal games) the celebrations — sized to own the screen.
  const scoreHTML = liveBoardHTML(g, pair[0], pair[1]);

  const nxt = nextMatchupOf(g, b);
  const onDeckHTML = nxt
    ? `<p class="live-watch-ondeck">⏭️ Up next: ${teamEmoji(nxt[0])} ${esc(teamName(nxt[0]))} vs ${teamEmoji(nxt[1])} ${esc(teamName(nxt[1]))}</p>`
    : '';

  container.innerHTML = `
    <div class="live-watch">
      ${g.liveTracker ? '' : `<p class="live-watch-label">🔴 Live now · ${phaseLabel}</p>`}
      ${scoreHTML}
      ${onDeckHTML}
      <p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>
      ${doneHTML}
    </div>`;

  const boardEl = container.querySelector('.big-board');
  if (boardEl && g.liveTracker) {
    boardDiffCelebrate(boardEl, g, getLiveMatch(g, pair[0], pair[1]), pair);
  }
}

function renderResult(container, g, result) {
  let extra = '';
  if (result.scores) {
    const rows = Object.entries(result.scores)
      .sort((a, b) => (g.lowerWins ? a[1] - b[1] : b[1] - a[1]))
      .map(([id, v]) => `<li>${esc(teamName(id))}: ${formatScore(g, v)}</li>`).join('');
    extra = `<p class="muted">Scores (${esc(g.unit || 'points')}):</p><ul class="score-recap">${rows}</ul>`;
  }
  // Match medalCounts()'s weighting — a messtival-flagged game (Friday, or
  // Thursday evening/Friday under the double-points window) pays double, and
  // this recap must show the same numbers the standings actually award.
  const mult = g.messtival ? 2 : 1;
  container.innerHTML = `
    <h3>Final results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(result.medals.gold))}</strong> <span class="medal-points">+${MEDAL_POINTS.gold * mult} pts</span></div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(result.medals.silver))}</strong> <span class="medal-points">+${MEDAL_POINTS.silver * mult} pts</span></div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(result.medals.bronze))}</strong> <span class="medal-points">+${MEDAL_POINTS.bronze * mult} pts</span></div>
    </div>
    ${extra}
    ${canEdit() ? '<button id="clear-result-btn" class="link-btn danger-link">Clear result &amp; re-enter</button>' : ''}
  `;
  if (!canEdit()) return;
  document.getElementById('clear-result-btn').addEventListener('click', () => {
    if (!confirm('Clear the saved result for ' + g.name + '? Its points come off the week standings.')) return;
    delete state.results[g.id];
    touchData();
    saveState();
    renderAll();
  });
}

// ── Medal picker (shared by tally + placement) ───────────────────

function medalPickerHTML(picks, game) {
  const mult = game && game.messtival ? 2 : 1; // Messtival doubles the points
  const slots = [
    { key: 'gold', label: `🥇 Gold · ${MEDAL_POINTS.gold * mult} pts` },
    { key: 'silver', label: `🥈 Silver · ${MEDAL_POINTS.silver * mult} pts` },
    { key: 'bronze', label: `🥉 Bronze · ${MEDAL_POINTS.bronze * mult} pts` },
  ];
  return `<div class="medal-picker">
    ${slots.map((s) => `
      <div class="medal-slot medal-slot-${s.key}">
        <span>${s.label}</span>
        <jelly-select data-medal="${s.key}" placeholder="— pick team —" ${picks[s.key] ? `value="${esc(picks[s.key])}"` : ''} label="${s.key} medal team">
          ${state.teams.map((t) =>
            `<jelly-option value="${t.id}">${teamEmoji(t.id)} ${esc(t.name)}</jelly-option>`
          ).join('')}
        </jelly-select>
      </div>
    `).join('')}
  </div>`;
}

function readMedalPicks(container) {
  const picks = {};
  container.querySelectorAll('[data-medal]').forEach((sel) => {
    picks[sel.dataset.medal] = sel.value || null;
  });
  return picks;
}

function validateMedals(picks) {
  if (!picks.gold || !picks.silver || !picks.bronze) return 'Pick a team for every medal.';
  if (picks.gold === picks.silver || picks.gold === picks.bronze || picks.silver === picks.bronze) {
    return 'Each medal needs a different team.';
  }
  return null;
}

// ── Tally format ─────────────────────────────────────────────────

function renderTally(container, g) {
  if (!state.drafts[g.id]) state.drafts[g.id] = { scores: {}, medals: {} };
  const draft = normalizeDraft(state.drafts[g.id]);
  const steps = g.counterSteps;

  // The own-team guard: a tally game's "round" is each team's own score, so
  // an editor assigned to a team gets everyone else's row and a locked one
  // for their own (see canScoreRound). They still finalize the result.
  const blockedTeam = state.teams.find((t) => blockedByOwnTeam(t.id));

  container.innerHTML = `
    <h3>Enter team scores <span class="unit-tag">(${esc(g.unit || 'points')}${g.lowerWins ? ' — lowest wins' : ''})</span></h3>
    ${blockedTeam ? ownTeamNoteHTML('your own team\u2019s score') : ''}
    <div class="score-input-grid">
      ${state.teams.map((t) => {
        const locked = blockedByOwnTeam(t.id);
        return `
        <div class="score-input-row ${steps && !locked ? 'with-counter' : ''}${locked ? ' score-row-locked' : ''}">
          <div class="score-row-top">
            <span class="score-team"><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}<span class="chip-sub">${locked ? 'your team — another editor scores this' : esc(counselorName(t.id))}</span></span>
            <input type="text" inputmode="${g.timeInput ? 'numeric' : 'decimal'}" placeholder="${g.timeInput ? 'm:ss' : '0'}"
              data-team-id="${t.id}" value="${esc(draft.scores[t.id] || '')}" ${locked ? 'readonly disabled' : ''} />
          </div>
          ${steps && !locked ? `<div class="counter-btn-row" data-team-id="${t.id}">
            <jelly-button class="counter-btn minus" shape="square" variant="platinum" block data-delta="${-steps[0]}">−${steps[0]}</jelly-button>
            ${steps.map((s) => {
              const lbl = g.counterStepLabels && g.counterStepLabels[s] ? `<span class="counter-btn-sub">${esc(g.counterStepLabels[s])}</span>` : '';
              return `<jelly-button class="counter-btn plus" shape="square" block data-delta="${s}">+${s}${lbl}</jelly-button>`;
            }).join('')}
          </div>` : ''}
        </div>
      `;
      }).join('')}
    </div>
    ${g.liveRankings ? '<button id="reset-scores-btn" class="link-btn danger-link reset-scores-btn">↺ Reset all scores</button>' : ''}
    <div id="tally-medals"></div>
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
    <jelly-button id="save-result-btn" class="primary-btn" block>Save Result</jelly-button>
  `;

  container.querySelectorAll('.score-input-row input').forEach((input) => {
    let leaderBefore = null;
    input.addEventListener('focus', () => {
      leaderBefore = leaderOf(g, draft);
    });
    input.addEventListener('input', () => {
      draft.scores[input.dataset.teamId] = input.value;
      draft.medals = {}; // re-auto-rank when scores change
      saveState();
      updateTallyMedals(g);
    });
    input.addEventListener('change', () => {
      checkHighScore(g, draft, input.dataset.teamId, leaderBefore);
      leaderBefore = leaderOf(g, draft);
    });
    // Push the moment the field loses focus, so the value lands on the server
    // right away rather than waiting out the debounce.
    input.addEventListener('blur', flushPendingPush);
  });

  container.querySelectorAll('.counter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      getAudio(); // unlock audio on a user gesture
      const teamId = btn.closest('.counter-btn-row').dataset.teamId;
      const delta = parseInt(btn.dataset.delta, 10);
      const prevLeader = leaderOf(g, draft);
      const current = parseScoreInput(g, draft.scores[teamId] || '') || 0;
      let next = current + delta;
      if (next < 0 && !g.counterAllowNegative) next = 0;
      draft.scores[teamId] = String(next);
      draft.medals = {};
      const input = container.querySelector(`input[data-team-id="${teamId}"]`);
      if (input) input.value = String(next);
      saveState();
      checkHighScore(g, draft, teamId, prevLeader);
      updateTallyMedals(g);
    });
  });

  updateTallyMedals(g);

  // Live-ranking games (Counselor Hide and Seek, etc.) accumulate points by
  // tapping counters. Discarding the whole in-progress draft both zeroes every
  // team AND removes the game from the "LIVE" home board — a team scored to 0
  // still counts as live (tallyRankLive keeps 0s), so clearing the draft is the
  // only way to un-start a game begun prematurely. Deleting the key (rather than
  // emptying it) de-lists it on every synced device too. A saved result is
  // untouched — that's the separate "Clear result" control on the result view.
  const resetBtn = document.getElementById('reset-scores-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset ' + g.name + ' back to zero and take it off the live board?')) return;
      delete state.drafts[g.id];
      saveState();
      renderAll();
    });
  }

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('tally-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    const scores = {};
    state.teams.forEach((t) => {
      const v = parseScoreInput(g, draft.scores[t.id] || '');
      if (v !== null) scores[t.id] = v;
    });
    state.results[g.id] = { medals: picks, scores, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    touchData();
    saveState();
    renderAll();
    celebrate(picks.gold);
  });
}

function autoRank(g, draft) {
  const entries = [];
  state.teams.forEach((t) => {
    const v = parseScoreInput(g, draft.scores[t.id] || '');
    if (v !== null) entries.push({ id: t.id, v });
  });
  entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  return entries;
}

function updateTallyMedals(g) {
  const draft = state.drafts[g.id];
  const wrap = document.getElementById('tally-medals');
  if (!wrap) return;
  const ranked = autoRank(g, draft);

  const auto = {
    gold: ranked[0] ? ranked[0].id : null,
    silver: ranked[1] ? ranked[1].id : null,
    bronze: ranked[2] ? ranked[2].id : null,
  };
  const picks = {
    gold: draft.medals.gold || auto.gold,
    silver: draft.medals.silver || auto.silver,
    bronze: draft.medals.bronze || auto.bronze,
  };

  // Tie warning: a team just outside the podium with the same score as one on it.
  let tieNote = '';
  if (ranked.length >= 4 && ranked[3].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the bronze line — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 2 && ranked[0].v === ranked[1].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the top — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 3 && ranked[1].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie for silver/bronze — adjust the medals below if needed.</p>';
  }

  wrap.innerHTML = `
    ${ranked.length ? `<div class="live-ranking">${ranked.map((e, i) =>
      `<span class="rank-pill">${i + 1}. ${teamEmoji(e.id)} ${esc(teamName(e.id))} · ${formatScore(g, e.v)}</span>`).join('')}</div>` : ''}
    ${tieNote}
    <h3 class="medal-picker-heading">Medals ${ranked.length >= 3 ? '<span class="unit-tag">(auto-filled from scores)</span>' : ''}</h3>
    ${medalPickerHTML(picks, g)}
  `;

  wrap.querySelectorAll('[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      draft.medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });
}

// ── Placement format ─────────────────────────────────────────────

function renderPlacement(container, g) {
  if (!state.drafts[g.id]) state.drafts[g.id] = { medals: {} };
  const draft = normalizeDraft(state.drafts[g.id]);

  container.innerHTML = `
    <h3>Podium</h3>
    <p class="muted">No score-keeping needed — just record who placed.</p>
    <div id="placement-medals">${medalPickerHTML(draft.medals, g)}</div>
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
    <jelly-button id="save-result-btn" class="primary-btn" block>Save Result</jelly-button>
  `;

  container.querySelectorAll('[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      draft.medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('placement-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    state.results[g.id] = { medals: picks, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    touchData();
    saveState();
    renderAll();
    celebrate(picks.gold);
  });
}

// ── Tournament format ────────────────────────────────────────────

function freshBracket() {
  return {
    phase: 'round1', // round1 -> bye -> semifinal -> championship -> summary
    pool: state.teams.map((t) => t.id),
    selectedPair: [],
    matches: [],
    byeTeamId: null,
    semifinal: null,
    championship: null,
  };
}

// Realtime Database can't represent "present but empty" for arrays/nulls —
// it prunes those keys on write, so a bracket round-tripped through sync
// can come back missing matches/selectedPair/etc. This restores a safe,
// well-formed shape in place, whatever the source (sync, storage, or a
// bug) actually handed us.
function normalizeBracket(b) {
  if (!Array.isArray(b.pool)) b.pool = [];
  if (!Array.isArray(b.selectedPair)) b.selectedPair = [];
  if (!Array.isArray(b.matches)) b.matches = [];
  if (!b.phase) b.phase = 'round1';
  if (b.byeTeamId === undefined) b.byeTeamId = null;
  if (b.semifinal === undefined) b.semifinal = null;
  if (b.championship === undefined) b.championship = null;
  return b;
}

// Same guarantee for a Pictionary drawing round: a fresh round is
// { laps: [], done: false }, and RTDB prunes the empty laps array.
function normalizePicRound(r) {
  if (!Array.isArray(r.laps)) r.laps = [];
  r.done = !!r.done;
  return r;
}

// And for a score-entry draft: { scores: {}, medals: {} } — either side
// can be empty (and thus pruned) while the other has data.
function normalizeDraft(d) {
  if (!d.scores) d.scores = {};
  if (!d.medals) d.medals = {};
  return d;
}

// A live match tally: { key, inning, hr: {teamId: n} }. RTDB prunes an
// empty hr map and a 0/absent inning, so heal them after a round-trip.
function normalizeLiveMatch(l) {
  if (l && l.mode === 'ladder') {
    // Ladder Ball match: running totals + this-round raw points + a round log
    // for undo. RTDB prunes zeros/empty arrays, so coerce everything back.
    if (typeof l.a !== 'number' || l.a < 0) l.a = 0;
    if (typeof l.b !== 'number' || l.b < 0) l.b = 0;
    if (typeof l.ra !== 'number' || l.ra < 0) l.ra = 0;
    if (typeof l.rb !== 'number' || l.rb < 0) l.rb = 0;
    if (!Array.isArray(l.log)) l.log = [];
    return l;
  }
  if (!l.hr) l.hr = {};
  if (typeof l.inning !== 'number' || l.inning < 1) l.inning = 1;
  if (typeof l.outs !== 'number' || l.outs < 0) l.outs = 0;
  if (l.half !== 1) l.half = 0; // 0 = first team kicking, 1 = second team
  return l;
}

// One sweep over every synced shape that can carry pruned-empty fields.
// Called after loading from localStorage and after every remote merge.
function normalizeSyncedState() {
  Object.values(state.brackets || {}).forEach(normalizeBracket);
  Object.values(state.picRounds || {}).forEach(normalizePicRound);
  Object.values(state.drafts || {}).forEach(normalizeDraft);
  if (!state.bonuses) state.bonuses = {}; // RTDB prunes an empty ledger to nothing
  if (!state.picSetup) state.picSetup = {}; // RTDB prunes an empty map to nothing
  // RTDB can round-trip a sparse `words` array back as an object — re-array it.
  Object.values(state.picSetup).forEach((s) => {
    if (!s) return;
    if (Array.isArray(s.words)) return;
    if (s.words && typeof s.words === 'object') {
      const arr = [];
      Object.keys(s.words).forEach((k) => { arr[+k] = s.words[k]; });
      s.words = arr;
    } else {
      s.words = [];
    }
  });
  if (!state.live) state.live = {}; // RTDB prunes an empty live map to nothing
  Object.values(state.live).forEach(normalizeLiveMatch);
  if (!state.clocks) state.clocks = {}; // RTDB prunes an empty clocks map to nothing
  if (!state.announcements) state.announcements = {}; // RTDB prunes an empty map to nothing
  // The notice board: RTDB prunes its empty arrays/strings, and an absent
  // notice means this database has never had one — normalizeNotice seeds the
  // example draft in that case (never a posted card).
  normalizeNotice();
  if (!state.meta) state.meta = {}; // RTDB prunes an all-defaults meta to nothing
  // Un-hiding every card empties hiddenCards, which RTDB then prunes away —
  // heal it so the switches and applyCardVisibility always read a real map.
  if (!state.meta.hiddenCards || typeof state.meta.hiddenCards !== 'object') state.meta.hiddenCards = {};
  // Migrate rosters saved before names/counselors were set: swap generic
  // "Team N" names and placeholder counselors for the real roster values.
  // Anything hand-edited (not matching a known placeholder) is left alone.
  (state.teams || []).forEach((t, i) => {
    const oldNames = OLD_PLACEHOLDER_TEAM_NAMES[i];
    if (oldNames && oldNames.indexOf(t.name) !== -1 && DEFAULT_TEAM_NAMES[i]) {
      t.name = DEFAULT_TEAM_NAMES[i];
    }
    if (t.counselor === undefined || t.counselor === OLD_PLACEHOLDER_COUNSELORS[i]) {
      t.counselor = DEFAULT_COUNSELORS[i] || '';
    }
  });
}

function renderTournament(container, g) {
  if (!state.brackets[g.id]) {
    // The bracket wizard's phases (3 first-round matches → bye → semifinal →
    // championship) assume exactly 6 teams; with any other count it saves
    // corrupt results. Block starting rather than corrupting.
    if (state.teams.length !== 6) {
      container.innerHTML = `
        <h3>Run the bracket</h3>
        <p class="tie-note">⚠️ The bracket wizard needs exactly 6 teams — you have ${state.teams.length}. Adjust the roster in Settings → Set up the week, or switch this game to another format.</p>
      `;
      return;
    }
    container.innerHTML = `
      <h3>Run the bracket</h3>
      <p class="muted">Three first-round matches, then the medal round. The bye goes to the Round&nbsp;1 winner with the fewest points this week — the app suggests who, using the live standings.</p>
      <jelly-button id="start-bracket-btn" class="primary-btn" block>Start Bracket</jelly-button>
    `;
    document.getElementById('start-bracket-btn').addEventListener('click', () => {
      state.brackets[g.id] = freshBracket();
      clearLiveMatch(g); // a new bracket starts with a clean tally
      saveState();
      renderAll();
    });
    return;
  }

  const b = normalizeBracket(state.brackets[g.id]);
  let html = `<div class="bracket-steps">
    ${['round1', 'bye', 'semifinal', 'championship', 'summary'].map((p, i) => {
      const labels = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship', championship: 'Final', summary: 'Results' };
      const order = ['round1', 'bye', 'semifinal', 'championship', 'summary'];
      const cls = p === b.phase ? 'active' : order.indexOf(p) < order.indexOf(b.phase) ? 'done' : '';
      return `<span class="wizard-step ${cls}">${labels[p]}</span>${i < 4 ? '<span class="wizard-step-arrow">→</span>' : ''}`;
    }).join('')}
  </div><div id="bracket-body"></div>
  <div class="wizard-footer"><button id="cancel-bracket-btn" class="link-btn danger-link">Cancel this bracket</button></div>`;
  container.innerHTML = html;

  document.getElementById('cancel-bracket-btn').addEventListener('click', () => {
    if (!confirm('Cancel this bracket? Nothing will be saved.')) return;
    delete state.brackets[g.id];
    clearLiveMatch(g);
    saveState();
    renderAll();
  });

  const body = document.getElementById('bracket-body');
  if (b.phase === 'round1') renderBracketRound1(body, g, b);
  else if (b.phase === 'bye') renderBracketBye(body, g, b);
  else if (b.phase === 'semifinal') renderBracketSemifinal(body, g, b);
  else if (b.phase === 'championship') renderBracketChampionship(body, g, b);
  else renderBracketSummary(body, g, b);
}

// ── Live match scorekeeper (innings + per-team tally) ────────────
// The ref taps the innings/tally as a match runs; it's synced like the rest
// of the scoreboard (state.live in SYNC_KEYS) so anyone with the app open —
// counselors or spectators — watches it update in real time, with
// localStorage as the offline backup. Keyed by game + matchup, so moving to
// the next matchup starts a fresh tally.

function getLiveMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.key === key) {
    return { key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: Object.assign({}, l.hr) };
  }
  return { key, inning: 1, outs: 0, half: 0, hr: {} };
}

function setLiveMatch(g, l) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: l.hr || {} };
  touchData();
  saveState();
}

function clockRemaining(clock) {
  if (!clock) return 0;
  // serverNow(), not Date.now() — endAt was written against the server's clock
  // by whichever device started the timer (see the serverNow comment).
  if (clock.running) return Math.max(0, (Number(clock.endAt) || 0) - serverNow());
  return Math.max(0, Number(clock.remaining) || 0);
}

function defaultClock(g) {
  const secs = (g.timer && g.timer.presets && g.timer.presets[0]) || 600;
  return { running: false, endAt: 0, remaining: secs * 1000, duration: secs * 1000, round: 1 };
}

// ── Per-game synced clock ────────────────────────────────────────
// One clock per game, stored in the synced `clocks` map (SYNC_KEYS) — so every
// device (refs and spectators) sees the same countdown and it survives bracket
// matchup changes (keyed by game, not by pairing, unlike the old match clock).
// Only endAt + running sync; each device computes remaining locally, so a
// running clock writes nothing to the network. Used by the standalone
// game-clock box AND, for live-tracker games, the Big Board clock.
function getClock(g) {
  const c = state.clocks && state.clocks[g.id];
  if (c && typeof c.duration === 'number') {
    return {
      running: !!c.running,
      endAt: Number(c.endAt) || 0,
      remaining: Number(c.remaining) || 0,
      duration: Number(c.duration) || 0,
      round: Number(c.round) || 1,
    };
  }
  return defaultClock(g);
}

function setClock(g, mutate) {
  if (!state.clocks) state.clocks = {};
  const clock = getClock(g);
  mutate(clock);
  state.clocks[g.id] = clock;
  touchData();
  saveState();
}

// Apply a clock control action (start / pause / reset / preset) and re-render.
// Shared by the standalone game clock and the Big Board clock so both behave
// identically.
function applyClockAction(g, act, secs) {
  if (act === 'start') getAudio(); // unlock audio while we have the user gesture
  setClock(g, (c) => {
    if (act === 'start') {
      if (clockRemaining(c) === 0) c.remaining = c.duration; // restart from full
      c.endAt = serverNow() + clockRemaining(c); // absolute, on the shared clock
      c.running = true;
    } else if (act === 'pause') {
      c.remaining = clockRemaining(c);
      c.running = false;
    } else if (act === 'reset') {
      cutAllSound();
      c.running = false;
      c.remaining = c.duration;
    } else if (act === 'preset') {
      c.duration = (Number(secs) || 600) * 1000;
      c.remaining = c.duration;
      c.running = false;
    } else if (act === 'next-round') {
      cutAllSound();
      c.running = false;
      c.round = (Number(c.round) || 1) + 1;
      c.remaining = c.duration;
    }
  });
  if (act === 'start') requestWakeLock();
  else if (!anyTimerRunning()) releaseWakeLock();
  renderAll();
}

// Standalone game clock for games WITHOUT a live tracker (the tracker games
// show their clock on the Big Board instead). Everyone sees it tick; only
// editors get the Start/Pause/Reset controls and preset chips.
function clockBlockHTML(g) {
  const clock = getClock(g);
  const remaining = clockRemaining(clock);
  const viewer = !canEdit();
  const onLastRound = !g.timer.rounds || clock.round >= g.timer.rounds;
  const roundLabel = g.timer.rounds ? `<div class="round-label">Round ${clock.round} of ${g.timer.rounds}</div>` : '';
  const presets = (!viewer && !clock.running && (g.timer.presets || []).length > 1)
    ? `<div class="preset-row">${g.timer.presets.map((p) =>
        `<button class="preset-chip ${clock.duration === p * 1000 ? 'selected' : ''}" data-clock="preset" data-secs="${p}">${fmtBoardClock(p * 1000)}</button>`).join('')}</div>`
    : '';
  let mainBtn;
  if (clock.running) {
    mainBtn = '<button class="timer-main-btn" data-clock="pause">⏸ Pause</button>';
  } else if (remaining === 0 && !onLastRound) {
    mainBtn = '<button class="timer-main-btn" data-clock="next-round">Next round →</button>';
  } else {
    mainBtn = `<button class="timer-main-btn" data-clock="start">▶ ${remaining === clock.duration ? 'Start' : remaining === 0 ? 'Restart' : 'Resume'}</button>`;
  }
  const controls = viewer ? '' : `
    ${presets}
    <div class="board-clock-btns">
      ${mainBtn}
      ${remaining !== clock.duration ? '<button class="timer-side-btn" data-clock="reset">↺ Reset</button>' : ''}
    </div>`;
  return `<div class="tool-box game-clock-box ${remaining === 0 ? 'alarming' : ''}" data-tool="game-clock">
    <div class="tool-label">⏱️ ${esc(g.timer.label || 'Game clock')}</div>
    ${roundLabel}
    <div class="big-clock board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}" data-prev="${remaining}">${fmtBoardClock(remaining)}</div>
    ${controls}
  </div>`;
}

function bindClock(container, g) {
  container.querySelectorAll('[data-tool="game-clock"] [data-clock]').forEach((btn) => {
    btn.addEventListener('click', () => applyClockAction(g, btn.dataset.clock, btn.dataset.secs));
  });
}

// ── Ladder Ball match (per-round cancellation, first to exactly 21) ──
// Same live/synced model as the kickball tracker, but a different shape:
// running totals a/b, this-round raw points ra/rb, and a log of scored rounds
// for undo. Keyed by matchup so a new pairing starts fresh.
function getLadderMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.mode === 'ladder' && l.key === key) {
    return { key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log.slice() : [] };
  }
  return { key, mode: 'ladder', a: 0, b: 0, ra: 0, rb: 0, log: [] };
}

function setLadderMatch(g, l) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log : [] };
  touchData();
  saveState();
}

// The team id that has reached the target (won), or null. Overshoot holds, so
// totals never exceed the target, but >= keeps this robust.
function ladderWinnerId(g, l, aId, bId) {
  const target = (g.ladderScoring && g.ladderScoring.target) || 21;
  if (l.a >= target) return aId;
  if (l.b >= target) return bId;
  return null;
}

// The team currently kicking, given the half (0 = first team, 1 = second).
function kickingTeamId(l, aId, bId) {
  return (Number(l.half) || 0) === 1 ? bId : aId;
}

// "2 outs" / "1 out" / "0 outs"
function outsLabel(n) {
  return `${n} out${n === 1 ? '' : 's'}`;
}

// Filled/empty pips for the outs display, e.g. ●●○ for 2 of 3.
function outsPips(n, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '●' : '○';
  return s;
}

function clearLiveMatch(g) {
  if (state.live && state.live[g.id]) {
    delete state.live[g.id];
    saveState();
  }
}

// ── The Big Board ────────────────────────────────────────────────
// One joyful scoreboard for live-tracked matches: giant scores, the match
// clock right beneath them (synced — spectators see it tick), and a burst
// of team-emoji confetti when a goal goes up. Editors get steppers and
// clock controls on the same card; viewers get the same board, display
// only, sized to fill over half the screen.

// Last rendered scores per game+matchup, so a score that went UP —
// whether tapped here or arriving over sync — triggers the celebration.
let lastBoardScores = {};

function fmtBoardClock(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// GOAL! Pop the scoring team's number and fire the emoji cannons: two
// volleys from the board's bottom corners arcing up and across, mixing the
// team's mascot with party emoji.
function boardCelebrate(boardEl, teamId) {
  if (!boardEl) return;
  const col = boardEl.querySelector(`[data-board-col="${teamId}"]`);
  const val = col && col.querySelector('.board-score');
  if (val) {
    val.classList.remove('score-pop');
    void val.offsetWidth; // restart the animation
    val.classList.add('score-pop');
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const mascot = teamEmoji(teamId);
  const extras = ['🎉', '🎊', '✨', '⭐'];
  const H = boardEl.getBoundingClientRect().height || 300;
  for (let i = 0; i < 24; i++) {
    const fromLeft = i % 2 === 0;
    const p = document.createElement('span');
    p.className = 'board-cannon';
    p.textContent = i % 3 === 0 ? extras[(i / 3 | 0) % extras.length] : mascot;
    // Launch angle 50°–85° from the corner, aimed inward; distance scales
    // with the board so the spray fills tall spectator boards too.
    const angle = (50 + Math.random() * 35) * Math.PI / 180;
    const dist = H * (0.55 + Math.random() * 0.55);
    const dx = Math.cos(angle) * dist * (fromLeft ? 1 : -1);
    const dy = -Math.sin(angle) * dist;
    p.style.setProperty('--tx', dx.toFixed(0) + 'px');
    p.style.setProperty('--ty', dy.toFixed(0) + 'px');
    p.style.setProperty('--br', (Math.random() * 480 - 240).toFixed(0) + 'deg');
    p.style.setProperty('--bd', (1.0 + Math.random() * 0.6).toFixed(2) + 's');
    p.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
    p.style[fromLeft ? 'left' : 'right'] = '4px';
    boardEl.appendChild(p);
    setTimeout(() => p.remove(), 2100);
  }
}

// Compare current scores to the last render and celebrate any increase.
function boardDiffCelebrate(boardEl, g, l, pair) {
  const memoKey = g.id + '|' + l.key;
  const prev = lastBoardScores[memoKey] || {};
  pair.forEach((id) => {
    const now = Number(l.hr[id]) || 0;
    if (prev[id] !== undefined && now > prev[id]) {
      boardCelebrate(boardEl, id);
    }
  });
  lastBoardScores = { [memoKey]: { [pair[0]]: Number(l.hr[pair[0]]) || 0, [pair[1]]: Number(l.hr[pair[1]]) || 0 } };
}

function liveTrackerHTML(g, aId, bId, viewer) {
  if (!g.liveTracker) return '';
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;
  const sideLabel = g.liveTracker.sideLabel || 'up';
  const periodLabel = g.liveTracker.periodLabel || 'Inning';
  const l = getLiveMatch(g, aId, bId);
  const clock = g.timer ? getClock(g) : null;
  const remaining = clock ? clockRemaining(clock) : 0;

  const col = (id) => `
    <div class="board-col" data-board-col="${esc(id)}" style="--team-accent: ${TEAM_ACCENT[id] || 'var(--color-primary)'}">
      <span class="board-emoji">${teamEmoji(id)}</span>
      <span class="board-name">${esc(teamName(id))}</span>
      <span class="board-score" data-hr-team="${esc(id)}">${l.hr[id] || 0}</span>
      ${viewer ? '' : `<div class="board-stepper">
        <button class="live-btn" data-live="hr-down" data-team="${esc(id)}" aria-label="Subtract from ${esc(teamName(id))}">−</button>
        <button class="live-btn board-plus" data-live="hr-up" data-team="${esc(id)}" aria-label="Add to ${esc(teamName(id))}">+</button>
      </div>`}
    </div>`;

  // A single-period tracker is just a running score — label the numbers with
  // the game's unit instead of a pointless "Round 1 of 1" stepper.
  const periodRow = maxInn <= 1
    ? `<span class="board-period">${esc(g.liveTracker.unit || 'Live score')}</span>`
    : viewer
      ? `<span class="board-period">${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}</span>`
      : `<span class="board-period">
          <button class="live-btn" data-live="inning-down" aria-label="Previous ${esc(periodLabel.toLowerCase())}">−</button>
          ${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}
          <button class="live-btn" data-live="inning-up" aria-label="Next ${esc(periodLabel.toLowerCase())}">+</button>
        </span>`;

  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}" data-prev="${remaining}">${fmtBoardClock(remaining)}</span>
      ${viewer ? '' : `
        ${!clock.running && (g.timer.presets || []).length > 1 ? `<div class="preset-row">${g.timer.presets.map((p) =>
          `<button class="preset-chip ${clock.duration === p * 1000 ? 'selected' : ''}" data-clock="preset" data-secs="${p}">${fmtBoardClock(p * 1000)}</button>`).join('')}</div>` : ''}
        <div class="board-clock-btns">
          ${clock.running
            ? `<button class="timer-main-btn" data-clock="pause">⏸ Pause</button>`
            : `<button class="timer-main-btn" data-clock="start">▶ ${remaining === clock.duration ? 'Start' : remaining === 0 ? 'Restart' : 'Resume'}</button>`}
          ${remaining !== clock.duration ? `<button class="timer-side-btn" data-clock="reset">↺ Reset</button>` : ''}
        </div>`}
    </div>` : '';

  const kickingRow = maxOuts ? `
    <div class="board-subrow">
      <span class="live-label">${esc(sideLabel.charAt(0).toUpperCase() + sideLabel.slice(1))}</span>
      <span class="live-kicking-team" id="live-kicking-team">${teamEmoji(kickingTeamId(l, aId, bId))} ${esc(teamName(kickingTeamId(l, aId, bId)))}</span>
      ${viewer ? '' : `<button class="live-btn live-switch-btn" data-live="half-toggle" aria-label="Switch ${esc(sideLabel)} team">⇄</button>`}
    </div>
    <div class="board-subrow">
      <span class="live-label">Outs</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-down" aria-label="Remove an out">−</button>`}
      <span class="live-outs-pips" id="live-outs-pips" aria-label="${outsLabel(l.outs)}">${outsPips(l.outs, maxOuts)}</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-up" aria-label="Add an out">+</button>`}
    </div>` : '';

  return `<div class="big-board ${viewer ? 'viewer' : ''}" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="live-home-badge">🔴 LIVE</span>
      ${periodRow}
    </div>
    <div class="board-cols">
      ${col(aId)}
      <span class="board-dash">–</span>
      ${col(bId)}
    </div>
    ${clockHTML}
    ${kickingRow}
    ${viewer ? '' : '<button class="live-reset link-btn" data-live="reset">Reset tally</button>'}
  </div>`;
}

// Unified spectator scoresheet — every live game (goal tracker, ladder ball,
// or a plain bracket matchup) shows the SAME big board: giant team scores, the
// live clock when the game has one, and a context sub-line. Display-only (no
// controls). Goal-tracker games delegate to liveTrackerHTML for their
// period/outs extras; the others build the board here.
function liveBoardHTML(g, aId, bId) {
  if (g.liveTracker) return liveTrackerHTML(g, aId, bId, true);
  const clock = g.timer ? getClock(g) : null;
  const remaining = clock ? clockRemaining(clock) : 0;
  let aScore = null, bScore = null, sub = '';
  if (g.ladderScoring) {
    const l = getLadderMatch(g, aId, bId);
    aScore = l.a; bScore = l.b;
    const target = g.ladderScoring.target || 21;
    const w = ladderWinnerId(g, l, aId, bId);
    sub = w ? `🏆 ${teamEmoji(w)} ${esc(teamName(w))} reached ${target}!` : `First to exactly ${target}`;
  }
  const col = (id, score) => `
    <div class="board-col" style="--team-accent: ${TEAM_ACCENT[id] || 'var(--color-primary)'}">
      <span class="board-emoji">${teamEmoji(id)}</span>
      <span class="board-name">${esc(teamName(id))}</span>
      ${score != null ? `<span class="board-score">${score}</span>` : ''}
    </div>`;
  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}" data-prev="${remaining}">${fmtBoardClock(remaining)}</span>
    </div>` : '';
  return `<div class="big-board viewer" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="live-home-badge">🔴 LIVE</span>
      ${sub ? `<span class="board-period">${sub}</span>` : ''}
    </div>
    <div class="board-cols">
      ${col(aId, aScore)}
      <span class="board-dash">–</span>
      ${col(bId, bScore)}
    </div>
    ${clockHTML}
  </div>`;
}

function bindLiveTracker(container, g, aId, bId) {
  if (!g.liveTracker) return;
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;

  // Celebrate any score increase that arrived since the last render (a
  // remote ref's goal, or a full re-render after a local one).
  const boardEl = container.querySelector('.big-board');
  if (boardEl) boardDiffCelebrate(boardEl, g, getLiveMatch(g, aId, bId), [aId, bId]);

  // Clock controls re-render the whole view (their buttons change shape);
  // the running display itself ticks via the global board-clock interval.
  container.querySelectorAll('[data-clock]').forEach((btn) => {
    btn.addEventListener('click', () => applyClockAction(g, btn.dataset.clock, btn.dataset.secs));
  });

  const refresh = () => {
    const l = getLiveMatch(g, aId, bId);
    const iv = container.querySelector('#live-inning-val');
    if (iv) iv.textContent = l.inning;
    const op = container.querySelector('#live-outs-pips');
    if (op) { op.textContent = outsPips(l.outs, maxOuts); op.setAttribute('aria-label', outsLabel(l.outs)); }
    const kt = container.querySelector('#live-kicking-team');
    if (kt) { const kid = kickingTeamId(l, aId, bId); kt.textContent = `${teamEmoji(kid)} ${teamName(kid)}`; }
    container.querySelectorAll('[data-hr-team]').forEach((el) => {
      el.textContent = l.hr[el.dataset.hrTeam] || 0;
    });
    const memoKey = g.id + '|' + l.key;
    lastBoardScores = { [memoKey]: { [aId]: Number(l.hr[aId]) || 0, [bId]: Number(l.hr[bId]) || 0 } };
  };
  container.querySelectorAll('[data-live]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.live;
      const team = btn.dataset.team;
      const l = getLiveMatch(g, aId, bId);
      if (act === 'inning-up') l.inning = Math.min(maxInn, (Number(l.inning) || 1) + 1);
      else if (act === 'inning-down') l.inning = Math.max(1, (Number(l.inning) || 1) - 1);
      else if (act === 'half-toggle') { l.half = (Number(l.half) || 0) === 1 ? 0 : 1; l.outs = 0; }
      else if (act === 'out-up') {
        const o = (Number(l.outs) || 0) + 1;
        if (o >= maxOuts) {
          if ((Number(l.half) || 0) === 0) {
            // First team retired — the second team kicks (same inning).
            l.half = 1;
            l.outs = 0;
          } else if ((Number(l.inning) || 1) < maxInn) {
            // Both teams have kicked — roll to the next inning, first team up.
            l.inning = (Number(l.inning) || 1) + 1;
            l.half = 0;
            l.outs = 0;
          } else {
            l.outs = maxOuts; // final inning, both sides done: hold at the limit
          }
        } else {
          l.outs = o;
        }
      }
      else if (act === 'out-down') l.outs = Math.max(0, (Number(l.outs) || 0) - 1);
      else if (act === 'hr-up') l.hr[team] = (Number(l.hr[team]) || 0) + 1;
      else if (act === 'hr-down') l.hr[team] = Math.max(0, (Number(l.hr[team]) || 0) - 1);
      else if (act === 'reset') { l.inning = 1; l.outs = 0; l.half = 0; l.hr = {}; }
      setLiveMatch(g, l);
      refresh();
      if (act === 'hr-up') {
        boardCelebrate(container.querySelector('.big-board'), team);
      }
    });
  });
}

// Ladder Ball round scorer. Both teams tap the rungs they landed this round
// (Top 3 / Mid 2 / Bottom 1); "Score round" applies cancellation — the higher
// raw total cancels the lower and the winner banks the difference — with the
// exactly-21 rule (a round that would push a team past 21 is a bust and holds
// their score). Totals sync live so spectators watch them climb.
function ladderMatchHTML(g, aId, bId) {
  if (!g.ladderScoring) return '';
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const l = getLadderMatch(g, aId, bId);
  const winner = ladderWinnerId(g, l, aId, bId);
  const teamBlock = (id, side, total, raw) => `
    <div class="ladder-team">
      <div class="ladder-team-head">
        <span class="ladder-team-name">${teamEmoji(id)} ${esc(teamName(id))}</span>
        <span class="ladder-total" data-ladder-total="${side}">${total}</span>
      </div>
      <div class="ladder-round-line">This round: <span class="ladder-round-val" data-ladder-round="${side}">${raw}</span></div>
      <div class="ladder-rungs">
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.top}">Top +${sc.top}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.mid}">Mid +${sc.mid}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${sc.bottom}">Bot +${sc.bottom}</button>
        <button class="live-btn ladder-clear" data-ladder="round-clear" data-side="${side}" aria-label="Clear this round for ${esc(teamName(id))}">↺</button>
      </div>
    </div>`;
  const wonBanner = winner
    ? `<p class="ladder-won">🏆 ${teamEmoji(winner)} ${esc(teamName(winner))} reached ${target}! Tap their <strong>“won”</strong> button above to lock it in.</p>`
    : '';
  return `<div class="ladder-tracker">
    <p class="ladder-target">🪜 First to exactly ${target} · cancellation scoring each round</p>
    <div class="ladder-teams">
      ${teamBlock(aId, 'a', l.a, l.ra)}
      ${teamBlock(bId, 'b', l.b, l.rb)}
    </div>
    <jelly-button class="primary-btn ladder-score-round" block data-ladder="score-round"${winner ? ' disabled' : ''}>Score this round</jelly-button>
    ${l.log.length ? '<button class="link-btn ladder-undo" data-ladder="undo-round">Undo last round</button>' : ''}
    ${wonBanner}
  </div>`;
}

function bindLadderMatch(container, g, aId, bId) {
  if (!g.ladderScoring) return;
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const refresh = () => {
    const l = getLadderMatch(g, aId, bId);
    const set = (sel, v) => { const el = container.querySelector(sel); if (el) el.textContent = v; };
    set('[data-ladder-total="a"]', l.a);
    set('[data-ladder-total="b"]', l.b);
    set('[data-ladder-round="a"]', l.ra);
    set('[data-ladder-round="b"]', l.rb);
  };
  // Pre-highlight the winning team's "won" button once a team hits 21, so the
  // ref knows exactly which one advances the bracket.
  const highlightWinner = () => {
    const w = ladderWinnerId(g, getLadderMatch(g, aId, bId), aId, bId);
    container.querySelectorAll('.winner-btn').forEach((btn) => {
      btn.classList.toggle('winner-ready', w != null && btn.dataset.winner === w);
    });
  };
  container.querySelectorAll('[data-ladder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.ladder;
      const l = getLadderMatch(g, aId, bId);
      if (act === 'rung') {
        const pts = Number(btn.dataset.pts) || 0;
        if (btn.dataset.side === 'a') l.ra += pts; else l.rb += pts;
      } else if (act === 'round-clear') {
        if (btn.dataset.side === 'a') l.ra = 0; else l.rb = 0;
      } else if (act === 'score-round') {
        const delta = Math.abs(l.ra - l.rb);
        const winSide = l.ra > l.rb ? 'a' : l.rb > l.ra ? 'b' : null;
        if (winSide && delta > 0) {
          const cur = winSide === 'a' ? l.a : l.b;
          const next = cur + delta;
          const applied = next <= target; // bust (over 21) holds the score
          if (applied) { if (winSide === 'a') l.a = next; else l.b = next; }
          l.log.push({ ra: l.ra, rb: l.rb, winner: winSide, delta, applied });
        } else {
          l.log.push({ ra: l.ra, rb: l.rb, winner: null, delta: 0, applied: true });
        }
        l.ra = 0; l.rb = 0;
      } else if (act === 'undo-round') {
        const last = l.log.pop();
        if (last && last.winner && last.applied) {
          if (last.winner === 'a') l.a = Math.max(0, l.a - last.delta);
          else l.b = Math.max(0, l.b - last.delta);
        }
      }
      setLadderMatch(g, l);
      // A rung/clear tap only changes numbers — refresh in place to stay snappy
      // and keep scroll position. Scoring or undoing a round can flip the
      // won-banner / disabled state, so re-render the whole view for those.
      if (act === 'rung' || act === 'round-clear') { refresh(); highlightWinner(); }
      else renderAll();
    });
  });
  highlightWinner();
}

// A tournament match shows either the Ladder Ball round scorer or the generic
// live tally, depending on the game. One dispatch point keeps the bracket
// render functions identical across games.
// The read-only stand-in an own-team-guarded editor sees where the live
// tracker would be: the same big board every spectator gets, so they can
// still follow their own team's match — they just can't touch the score.
function liveMatchWatchHTML(g, aId, bId) {
  return `<div class="live-watch">
    ${liveBoardHTML(g, aId, bId)}
    <p class="muted live-watch-note">Updates automatically as another editor scores — no refresh needed.</p>
  </div>`;
}

function matchTrackerHTML(g, aId, bId) {
  // The own-team guard: an editor on one of these two teams doesn't score
  // THIS match (see canScoreRound) — they still run the rest of the game.
  if (blockedByOwnTeam(aId, bId)) {
    return ownTeamNoteHTML('this match') + liveMatchWatchHTML(g, aId, bId);
  }
  return g.ladderScoring ? ladderMatchHTML(g, aId, bId) : liveTrackerHTML(g, aId, bId);
}

function bindMatchTracker(container, g, aId, bId) {
  if (blockedByOwnTeam(aId, bId)) return; // nothing interactive was rendered
  if (g.ladderScoring) bindLadderMatch(container, g, aId, bId);
  else bindLiveTracker(container, g, aId, bId);
}

function renderBracketRound1(body, g, b) {
  if (b.pool.length === 0) {
    b.phase = 'bye';
    saveState();
    renderAll();
    return;
  }

  // Games with a fixed Round 1 order (e.g. Kangaroo Kickball) walk the
  // preset matchups in order instead of the free "pick two teams" flow.
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    renderBracketRound1Fixed(body, g, b, g.roundOneMatchups);
    return;
  }

  let html = `<h3>Round 1 — Match ${b.matches.length + 1} of 3</h3>
    <p class="muted">Pick the two teams to call up next.</p>
    <div class="team-chip-grid">
      ${b.pool.map((id) => `<button class="team-chip ${b.selectedPair.includes(id) ? 'selected' : ''}" data-team-id="${id}">${esc(teamName(id))}<span class="chip-sub">${esc(counselorName(id))}</span></button>`).join('')}
    </div>`;

  if (b.selectedPair.length === 2) {
    html += matchupCalloutHTML(b.selectedPair[0], b.selectedPair[1]);
    html += matchTrackerHTML(g, b.selectedPair[0], b.selectedPair[1]);
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches">
      <p class="muted">Completed:</p>
      <ul>${b.matches.map((m) => `<li>${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('')}</ul>
      <button id="undo-match-btn" class="link-btn">Undo last match</button>
    </div>`;
  }

  body.innerHTML = html;

  if (b.selectedPair.length === 2) {
    bindMatchupCopy(body, g, `Round 1 (match ${b.matches.length + 1})`, b.selectedPair[0], b.selectedPair[1]);
    bindMatchTracker(body, g, b.selectedPair[0], b.selectedPair[1]);
  }

  body.querySelectorAll('.team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId;
      const idx = b.selectedPair.indexOf(id);
      if (idx > -1) b.selectedPair.splice(idx, 1);
      else if (b.selectedPair.length < 2) b.selectedPair.push(id);
      saveState();
      renderAll();
    });
  });

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const [a, c] = b.selectedPair;
      const loser = winner === a ? c : a;
      b.matches.push({ a, b: c, winner, loser });
      b.pool = b.pool.filter((id) => id !== a && id !== c);
      b.selectedPair = [];
      touchData();
      saveState();
      renderAll();
    });
  });

  const undoBtn = document.getElementById('undo-match-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const last = b.matches.pop();
      if (last) b.pool.push(last.a, last.b);
      saveState();
      renderAll();
    });
  }
}

// Round 1 driven by a fixed, pre-set matchup order (game.roundOneMatchups).
// Shows the whole schedule up front — done matches with their winner, the
// current one flagged NOW, the rest upcoming — so counselors always know
// who's on deck. Each match just needs a winner tapped; no team-picking.
function renderBracketRound1Fixed(body, g, b, preset) {
  const currentIndex = b.matches.length; // matches recorded so far == next index
  const current = preset[currentIndex] || null;

  const scheduleHTML = `<div class="matchup-order">
    <p class="matchup-order-label">Match order</p>
    <ol class="matchup-order-list">
      ${preset.map((pair, i) => {
        const [x, y] = pair;
        let status = 'upcoming';
        let detail = '';
        if (i < currentIndex) {
          status = 'done';
          const m = b.matches[i];
          if (m) detail = `<span class="mo-result">✓ ${esc(teamName(m.winner))} won</span>`;
        } else if (i === currentIndex) {
          status = 'current';
          detail = '<span class="mo-now">NOW</span>';
        }
        return `<li class="matchup-order-item mo-${status}">
          <span class="mo-teams">${teamEmoji(x)} ${esc(teamName(x))} <span class="mo-vs">vs</span> ${teamEmoji(y)} ${esc(teamName(y))}</span>
          ${detail}
        </li>`;
      }).join('')}
    </ol>
  </div>`;

  let html = `<h3>Round 1 — Match ${currentIndex + 1} of ${preset.length}</h3>` + scheduleHTML;

  if (current) {
    html += matchupCalloutHTML(current[0], current[1]);
    html += matchTrackerHTML(g, current[0], current[1]);
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches"><button id="undo-match-btn" class="link-btn">Undo last match</button></div>`;
  }

  body.innerHTML = html;

  if (current) {
    bindMatchupCopy(body, g, `Round 1 (match ${currentIndex + 1})`, current[0], current[1]);
    bindMatchTracker(body, g, current[0], current[1]);
  }

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!current) return;
      const winner = btn.dataset.winner;
      const [a, c] = current;
      const loser = winner === a ? c : a;
      b.matches.push({ a, b: c, winner, loser });
      b.pool = b.pool.filter((id) => id !== a && id !== c);
      b.selectedPair = [];
      touchData();
      saveState();
      renderAll();
    });
  });

  const undoBtn = document.getElementById('undo-match-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const last = b.matches.pop();
      if (last) b.pool.push(last.a, last.b);
      saveState();
      renderAll();
    });
  }
}

function renderBracketBye(body, g, b) {
  const winners = b.matches.map((m) => m.winner);
  // Suggest the winner with the fewest week points (the trailing team) using
  // the live standings. If two or more tie for the fewest, don't pick — let
  // the ref decide, but still show everyone's points.
  const counts = medalCounts();
  const pointsOf = (id) => (counts[id] && counts[id].points) || 0;
  const lowest = winners.reduce((min, id) => Math.min(min, pointsOf(id)), Infinity);
  const lowCount = winners.filter((id) => pointsOf(id) === lowest).length;
  const suggestedId = lowCount === 1 ? winners.find((id) => pointsOf(id) === lowest) : null;
  body.innerHTML = `
    <h3>Who gets the bye?</h3>
    <p class="muted">The bye (skip straight to the Final) goes to whichever Round&nbsp;1 winner has the <strong>fewest points this week</strong>. ${suggestedId ? `The app suggests <strong>${esc(teamName(suggestedId))}</strong> — but you decide.` : 'These winners are tied for the fewest, so pick whoever you like.'}</p>
    <div class="team-chip-grid">
      ${winners.map((id) => {
        const p = pointsOf(id);
        const sug = id === suggestedId;
        return `<button class="team-chip tiebreak-chip ${sug ? 'suggested-chip' : ''}" data-team-id="${id}">${sug ? '⭐ ' : ''}${esc(teamName(id))}<span class="chip-sub">${p} pt${p === 1 ? '' : 's'} this week${sug ? ' · suggested' : ''}</span></button>`;
      }).join('')}
    </div>
    <button id="undo-to-round1-btn" class="link-btn">← Back to Round 1</button>
  `;

  body.querySelectorAll('.tiebreak-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const byeId = btn.dataset.teamId;
      const others = winners.filter((id) => id !== byeId);
      b.byeTeamId = byeId;
      b.semifinal = { a: others[0], b: others[1], winner: null, loser: null };
      b.phase = 'semifinal';
      touchData();
      saveState();
      renderAll();
    });
  });

  document.getElementById('undo-to-round1-btn').addEventListener('click', () => {
    const last = b.matches.pop();
    if (last) b.pool.push(last.a, last.b);
    b.phase = 'round1';
    saveState();
    renderAll();
  });
}

function renderBracketSemifinal(body, g, b) {
  body.innerHTML = `
    <h3>Championship Game</h3>
    <p class="bye-note">🎟️ <strong>${esc(teamName(b.byeTeamId))}</strong> has the bye — straight to the Final.</p>
    ${matchupCalloutHTML(b.semifinal.a, b.semifinal.b)}
    ${matchTrackerHTML(g, b.semifinal.a, b.semifinal.b)}
  `;

  bindMatchupCopy(body, g, 'Championship game', b.semifinal.a, b.semifinal.b);
  bindMatchTracker(body, g, b.semifinal.a, b.semifinal.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.semifinal.a ? b.semifinal.b : b.semifinal.a;
      b.semifinal.winner = winner;
      b.semifinal.loser = loser;
      b.championship = { a: b.byeTeamId, b: winner, winner: null, loser: null };
      b.phase = 'championship';
      touchData();
      saveState();
      renderAll();
    });
  });
}

function renderBracketChampionship(body, g, b) {
  const mult = g.messtival ? 2 : 1; // match medalCounts()'s weighting
  body.innerHTML = `
    <h3>Final</h3>
    <p class="bronze-note">🥉 <strong>${esc(teamName(b.semifinal.loser))}</strong> takes the bronze medal (+${MEDAL_POINTS.bronze * mult} pts).</p>
    ${matchupCalloutHTML(b.championship.a, b.championship.b)}
    ${matchTrackerHTML(g, b.championship.a, b.championship.b)}
  `;

  bindMatchupCopy(body, g, 'Final', b.championship.a, b.championship.b);
  bindMatchTracker(body, g, b.championship.a, b.championship.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const winner = btn.dataset.winner;
      const loser = winner === b.championship.a ? b.championship.b : b.championship.a;
      b.championship.winner = winner;
      b.championship.loser = loser;
      b.phase = 'summary';
      touchData();
      saveState();
      renderAll();
    });
  });
}

function renderBracketSummary(body, g, b) {
  const goldId = b.championship.winner;
  const silverId = b.championship.loser;
  const bronzeId = b.semifinal.loser;
  const eliminated = b.matches.map((m) => m.loser);
  const mult = g.messtival ? 2 : 1; // match medalCounts()'s weighting

  body.innerHTML = `
    <h3>Game results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 ${teamEmoji(goldId)} <strong>${esc(teamName(goldId))}</strong> <span class="medal-points">+${MEDAL_POINTS.gold * mult} pts</span></div>
      <div class="medal-row silver-row">🥈 ${teamEmoji(silverId)} <strong>${esc(teamName(silverId))}</strong> <span class="medal-points">+${MEDAL_POINTS.silver * mult} pts</span></div>
      <div class="medal-row bronze-row">🥉 ${teamEmoji(bronzeId)} <strong>${esc(teamName(bronzeId))}</strong> <span class="medal-points">+${MEDAL_POINTS.bronze * mult} pts</span></div>
    </div>
    <p class="muted">Eliminated in Round 1: ${eliminated.map((id) => esc(teamName(id))).join(', ')}</p>
    <jelly-button id="save-bracket-btn" class="primary-btn" block>Save Result</jelly-button>
  `;

  document.getElementById('save-bracket-btn').addEventListener('click', () => {
    state.results[g.id] = {
      medals: { gold: goldId, silver: silverId, bronze: bronzeId },
      savedAt: new Date().toISOString(),
    };
    delete state.brackets[g.id];
    clearLiveMatch(g);
    touchData();
    saveState();
    renderAll();
    celebrate(goldId);
  });
}

// ── Theme ────────────────────────────────────────────────────────

function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = state.theme === 'dark' || (state.theme === null && prefersDark);
  document.body.classList.toggle('dark-theme', dark);
  document.body.classList.toggle('light-theme', !dark && state.theme === 'light');
  // Drive Jelly UI's document-level tokens the same way: an explicit choice
  // maps 1:1 onto data-jelly-mode; auto removes the attribute so Jelly's own
  // prefers-color-scheme fallback tracks live OS flips (mirroring the app's
  // @media token block). Canvas-painted Jelly components repaint on the
  // jelly-theme-change event.
  if (state.theme === 'dark' || state.theme === 'light') {
    document.documentElement.setAttribute('data-jelly-mode', state.theme);
  } else {
    document.documentElement.removeAttribute('data-jelly-mode');
  }
  window.dispatchEvent(new CustomEvent('jelly-theme-change'));
  // Reflect the choice into the Appearance segmented control (attribute
  // set — never fires its change event, so no feedback loop).
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.setAttribute('value', state.theme === 'dark' ? 'dark' : state.theme === 'light' ? 'light' : 'auto');
  // The app can override the OS theme, so keep the browser chrome color in step.
  // A no-media meta appended last wins over the pre-paint media metas.
  let meta = document.getElementById('dynamic-theme-color');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.id = 'dynamic-theme-color';
    document.head.appendChild(meta);
  }
  // Explicit hexes matching Jelly's background-default (body has a 0.2s
  // background transition, so reading getComputedStyle here would capture
  // the mid-transition color — keep these in sync with the palette).
  meta.content = dark ? '#181b1d' : '#ffffff';
}

// Called from the Appearance segmented control: 'light' | 'auto' | 'dark'.
// 'auto' maps to null so applyTheme falls back to the OS preference —
// restoring an option the old two-state toggle couldn't express.
function setTheme(choice) {
  state.theme = choice === 'dark' ? 'dark' : choice === 'light' ? 'light' : null;
  saveState();
  applyTheme();
}

function applySoundIcon() {
  const el = document.getElementById('sound-toggle');
  if (el) el.toggleAttribute('checked', soundOn());
}

function toggleSound() {
  state.sound = !soundOn();
  if (!soundOn()) cutAllSound();
  else playHighScore(); // quick confirmation blip
  saveState();
  applySoundIcon();
}

// ── "What's new" banners ─────────────────────────────────────────
// Each CHANGES entry shows a dismissible banner at the top for two hours after
// it shipped, then expires on its own. Dismissals are per-device (localStorage)
// and per-change id, so clearing one banner doesn't clear the others.
const CHANGE_TTL_MS = 2 * 60 * 60 * 1000; // advertise a change for two hours
const CHANGE_DISMISS_KEY = lsKey('campScoreboardDismissedChanges');

function dismissedChanges() {
  try { return JSON.parse(localStorage.getItem(CHANGE_DISMISS_KEY) || '[]') || []; }
  catch (e) { return []; }
}

function dismissChange(id) {
  const d = dismissedChanges();
  if (!d.includes(id)) {
    d.push(id);
    try { localStorage.setItem(CHANGE_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* fine */ }
  }
}

// The two-hour window counts only "awake" time — it pauses overnight (9pm–8am
// camp time) so a change that ships late at night isn't spent before anyone
// sees it; it resumes advertising in the morning. Quiet hours are camp-local
// (America/New_York, matching every other timestamp in the app), not device
// time.
const QUIET_START_HOUR = 21; // 9pm — pause the timer
const QUIET_END_HOUR = 7;    // 7am — resume the timer (first notice rolls in at 7am)

function campHour(ms) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: '2-digit', hour12: false }).format(new Date(ms));
  return parseInt(h, 10) % 24; // some engines format midnight as "24"
}

function isAwakeHours(ms) {
  const h = campHour(ms);
  return h >= QUIET_END_HOUR && h < QUIET_START_HOUR; // 7am–9pm
}

// Awake (non-quiet) milliseconds elapsed between two instants. Sampled at a
// coarse step — the spans involved are short (a change is only ever live across
// at most one night, since there are 13 awake hours a day vs a 2-hour budget),
// and minute-level accuracy is plenty for a banner. Stops early once the cap is
// reached.
function awakeElapsedMs(fromMs, toMs, capMs) {
  if (toMs <= fromMs) return 0;
  const STEP = 5 * 60 * 1000;
  let awake = 0;
  for (let t = fromMs; t < toMs; t += STEP) {
    if (isAwakeHours(t)) {
      awake += Math.min(STEP, toMs - t);
      if (capMs != null && awake >= capMs) return awake; // no need to keep counting
    }
  }
  return awake;
}

// The banners are a QUEUE, not a wall: they roll in one at a time, one every
// 15 minutes, and only during awake hours (7am–9pm). A change shipped overnight
// waits for 7am; the rest follow at 15-minute intervals behind it. So the
// batch below, all shipped late at night, starts appearing at 7am and
// advances every 15 minutes.
const CHANGE_SPACING_MS = 15 * 60 * 1000; // at most one new banner per 15 minutes

// The first awake instant at/after t: if t falls in quiet hours, jump forward
// to ~8am; otherwise t itself.
function nextAwakeSlot(t) {
  const STEP = 5 * 60 * 1000;
  let x = t, guard = 0;
  while (!isAwakeHours(x) && guard < 4000) { x += STEP; guard++; }
  return x;
}

// The instant `addMs` of AWAKE time after fromMs (quiet hours don't count).
function addAwakeMs(fromMs, addMs) {
  const STEP = 5 * 60 * 1000;
  let x = fromMs, remaining = addMs, guard = 0;
  while (remaining > 0 && guard < 8000) {
    x += STEP;
    if (isAwakeHours(x)) remaining -= STEP;
    guard++;
  }
  return x;
}

// Release time of each CHANGES entry (in list order): the later of its own
// awake-slotted ship time and 15 minutes (awake) behind the previous
// release, so they queue up one per 15 minutes. Deterministic from the `at`
// values.
function changeReleases() {
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const shipped = Date.parse(list[i] && list[i].at);
    let r = nextAwakeSlot(isNaN(shipped) ? Date.now() : shipped);
    if (prev != null) {
      const spaced = addAwakeMs(prev, CHANGE_SPACING_MS);
      if (spaced > r) r = spaced;
    }
    releases[i] = r;
    prev = r;
  }
  return releases;
}

// One banner at a time: the newest entry that has rolled in, isn't dismissed,
// and is still inside its two-hour awake window. Each is superseded by the next
// as its 15-minute slot arrives.
function activeChanges() {
  const now = Date.now();
  const dismissed = dismissedChanges();
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = changeReleases();
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!c || !c.id || !c.text) continue;
    const r = releases[i];
    if (now < r) continue;                                        // hasn't rolled in yet
    if (dismissed.includes(c.id)) continue;
    if (awakeElapsedMs(r, now, CHANGE_TTL_MS) >= CHANGE_TTL_MS) continue; // past its window
    return [c];
  }
  return [];
}

function renderWhatsNew() {
  const wrap = document.getElementById('whats-new');
  if (!wrap) return;
  const active = activeChanges();
  if (!active.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML = active.map((c) => `
    <div class="whats-new-banner" role="status">
      <button class="whats-new-dismiss" data-change-id="${esc(c.id)}" aria-label="Dismiss this update">✕</button>
      <span class="whats-new-badge">New update</span>
      <span class="whats-new-text">${esc(c.text)}</span>
    </div>`).join('');
  wrap.querySelectorAll('.whats-new-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => { dismissChange(btn.dataset.changeId); renderWhatsNew(); });
  });
}

// ── Broadcast announcements (📣) ─────────────────────────────────
// Editor-posted messages that sync to every phone (state.announcements —
// see SYNC_KEYS) and pin at the top of the page until they expire or each
// viewer dismisses them. Dismissal is per-device (like the what's-new
// banners); deleting is editor-only and removes the announcement for
// everyone. Every announcement expires on its own: the composer picks a
// duration (1 hour by default), stamped as `ttlMs` on the entry; expired
// entries stop rendering everywhere immediately and editor devices prune
// them from synced state (per-child null pushes) as housekeeping.
const ANNOUNCE_DISMISS_KEY = lsKey('campScoreboardDismissedAnnouncements');
const ANNOUNCE_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const ANNOUNCE_TTL_CHOICES = [
  { ms: 60 * 60 * 1000, label: '1 hour' },
  { ms: 3 * 60 * 60 * 1000, label: '3 hours' },
  { ms: 24 * 60 * 60 * 1000, label: 'All day' },
];
// Announcements posted before this deploy predate expiry support — treat
// them all as already expired (the one-time "delete everything currently
// up" cleanup, 2026-07-24).
const ANNOUNCE_PURGE_BEFORE = Date.parse('2026-07-24T10:13:24Z');
let announceComposerOpen = false;
let announceTtlChoice = ANNOUNCE_DEFAULT_TTL_MS; // composer draft, not synced

// When an announcement stops showing, as epoch ms. Unparseable `at` or a
// pre-expiry-era post → 0 (already expired). Missing/invalid ttlMs (old
// entries, RTDB-pruned fields) falls back to the 1-hour default.
function announcementExpiresAt(a) {
  const posted = Date.parse((a && a.at) || '');
  if (!Number.isFinite(posted)) return 0;
  if (posted < ANNOUNCE_PURGE_BEFORE) return 0;
  return posted + (Number(a.ttlMs) > 0 ? Number(a.ttlMs) : ANNOUNCE_DEFAULT_TTL_MS);
}

function announcementExpired(a) {
  return Date.now() >= announcementExpiresAt(a);
}

// Editor-side housekeeping: drop expired entries from synced state so the
// database doesn't accumulate dead announcements. Not touchData() — pruning
// isn't scoreboard activity (see "Footer timestamps" in CLAUDE.md).
function pruneExpiredAnnouncements() {
  if (!canEdit()) return;
  let pruned = false;
  Object.entries(state.announcements || {}).forEach(([id, a]) => {
    if (!a || announcementExpired(a)) {
      delete state.announcements[id];
      pruned = true;
    }
  });
  if (pruned) saveState();
}

function dismissedAnnouncements() {
  try { return JSON.parse(localStorage.getItem(ANNOUNCE_DISMISS_KEY) || '[]') || []; } catch (e) { return []; }
}

function dismissAnnouncement(id) {
  const d = dismissedAnnouncements();
  if (d.includes(id)) return;
  d.push(id);
  try { localStorage.setItem(ANNOUNCE_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* fine */ }
}

// Newest first; entries partially pruned by RTDB render-guarded like bonuses.
// Expired announcements never show, on any device, even before the editor
// prune has deleted them from synced state.
function activeAnnouncements() {
  const dismissed = dismissedAnnouncements();
  return Object.values(state.announcements || {})
    .filter((a) => a && a.id && a.text && !dismissed.includes(a.id) && !announcementExpired(a))
    .sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
}

function renderAnnouncements() {
  const wrap = document.getElementById('announcements');
  if (!wrap) return;
  const active = activeAnnouncements();
  const editor = canEdit();
  if (!active.length && !editor) { wrap.hidden = true; wrap.innerHTML = ''; return; }

  const banners = active.map((a) => `
    <div class="announce-banner" role="status">
      <button class="announce-dismiss" data-ann-id="${esc(a.id)}" aria-label="Dismiss this announcement on this phone">✕</button>
      <span class="announce-badge">📣 Announcement</span>
      <span class="announce-text">${esc(a.text)}</span>
      <span class="announce-meta">${esc(formatEasternStamp(a.at) || '')}${a.by ? ` · ${esc(a.by)}` : ''}${editor ? ` · <button class="announce-delete link-btn" data-ann-id="${esc(a.id)}">Remove for everyone</button>` : ''}</span>
    </div>`).join('');

  // Editors get a composer, collapsed behind a one-line link so the top of
  // the page stays quiet. The duration chips pick how long the announcement
  // stays up (stamped as ttlMs at post time; 1 hour is the default).
  const ttlChips = `<div class="announce-ttl-row" role="group" aria-label="How long the announcement stays up">
      <span class="announce-ttl-label">⏳ Disappears after</span>
      ${ANNOUNCE_TTL_CHOICES.map((c) =>
        `<jelly-chip class="announce-ttl-chip" selectable size="small" ${c.ms === announceTtlChoice ? 'selected' : ''} data-ttl-ms="${c.ms}">${esc(c.label)}</jelly-chip>`).join('')}
    </div>`;
  const composer = !editor ? '' : announceComposerOpen ? `
    <form id="announce-form" class="announce-form">
      <input id="announce-input" class="announce-input" type="text" maxlength="200"
        placeholder="Announce to every phone…" autocomplete="off" aria-label="Announcement text">
      <jelly-button id="announce-post-btn" size="small" class="primary-btn">📣 Post</jelly-button>
    </form>${ttlChips}` : `<button id="announce-open-btn" class="link-btn announce-open-btn">📣 Post an announcement</button>`;

  wrap.hidden = false;
  wrap.innerHTML = banners + composer;

  wrap.querySelectorAll('.announce-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => { dismissAnnouncement(btn.dataset.annId); renderAnnouncements(); });
  });
  wrap.querySelectorAll('.announce-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canEdit()) return;
      const a = (state.announcements || {})[btn.dataset.annId];
      if (!a) return;
      if (!confirm(`Remove this announcement from every phone?\n\n"${a.text}"`)) return;
      delete state.announcements[btn.dataset.annId];
      touchData();
      saveState();
      renderAnnouncements();
    });
  });
  // Duration chips flip in place (no re-render — that would wipe the text
  // being typed in the input beside them).
  wrap.querySelectorAll('.announce-ttl-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      announceTtlChoice = parseInt(chip.dataset.ttlMs, 10) || ANNOUNCE_DEFAULT_TTL_MS;
      wrap.querySelectorAll('.announce-ttl-chip').forEach((c) => {
        if (c === chip) c.setAttribute('selected', ''); else c.removeAttribute('selected');
      });
    });
  });
  const openBtn = document.getElementById('announce-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => {
    announceComposerOpen = true;
    announceTtlChoice = ANNOUNCE_DEFAULT_TTL_MS; // fresh composer, fresh default
    renderAnnouncements();
    const input = document.getElementById('announce-input');
    if (input) input.focus();
  });
  const form = document.getElementById('announce-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    postAnnouncement();
  });
  const postBtn = document.getElementById('announce-post-btn');
  if (postBtn) postBtn.addEventListener('click', postAnnouncement);
}

function postAnnouncement() {
  if (!canEdit()) return;
  const input = document.getElementById('announce-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const id = newBonusId();
  state.announcements[id] = { id, text, at: new Date().toISOString(), by: state.identity || '', ttlMs: announceTtlChoice };
  announceComposerOpen = false;
  announceTtlChoice = ANNOUNCE_DEFAULT_TTL_MS;
  touchData();
  saveState();
  renderAnnouncements();
  showToast('📣 Posted to every phone', { mine: true });
}

// Toast (and, with notifications on, a lock-screen notification) for
// announcements that arrived in a remote snapshot. prevMap is the
// announcements map as it stood BEFORE the merge, so echoes of this
// device's own post never re-notify.
function notifyNewAnnouncements(prevMap) {
  const dismissed = dismissedAnnouncements();
  let anyNew = false;
  Object.keys(state.announcements || {}).forEach((id) => {
    if (prevMap && id in prevMap) return;
    const a = state.announcements[id];
    if (!a || !a.text || dismissed.includes(id)) return;
    if (announcementExpired(a)) return; // a stale entry syncing in late shouldn't ping
    anyNew = true;
    showToast('📣 ' + a.text);
    if (state.notify) maybeNativeNotification('📣 Camp announcement', a.text, 'camp-announcement-' + id);
  });
  // Subscribed phones also get the audible/tactile ping — an announcement is
  // for everyone, so it uses the brighter "mine" chime.
  if (anyNew && state.notify) {
    playMineChime();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

// ── Auto-reload on new deploy ────────────────────────────────────
// Each client polls the deployed index.html (same-origin, no-store) and compares
// its app.js?v= number to the one THIS page is running. When the deploy is
// newer, it reloads to catch up — immediately for viewers, but only when it's
// safe for an editor (not mid score-entry), with a tap-to-refresh bar in the
// meantime so an in-progress score is never lost. This is deploy-driven, so it
// works on a single device without Firebase or another client announcing it.
// (A client only starts polling once it's running a build that has this code —
// so a given phone auto-reloads from the NEXT deploy after it loads this one.)
let newVersionSeen = false;
const UPDATE_POLL_MS = 2 * 60 * 1000;

function editorMidEntry() {
  const ae = document.activeElement;
  // Jelly form controls surface as the focused element's HOST (JELLY-INPUT,
  // JELLY-TEXTAREA, JELLY-SELECT, …) — a focused one is mid-entry exactly
  // like a native field; missing this would let a deploy's auto-reload eat
  // a score being typed.
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.tagName.startsWith('JELLY-') || ae.isContentEditable)) return true;
  // A half-built game in the week builder is unsaved in-memory work — the
  // update-poll auto-reload and remote merges must not wipe it.
  if (typeof builderDirty === 'function' && builderDirty()) return true;
  return dataEditPending || pushTimer != null || pushConfigTimer != null; // a real edit is typed/queued but not yet synced
}

// Send any debounced push right now (e.g. when a score field loses focus, or
// the page is being hidden) so an entered value reaches the server promptly
// instead of waiting out the coalescing timer. Covers the week-config push too:
// iOS suspends setTimeout the moment the phone locks, so a game edited in the
// builder right before locking would otherwise strand its 400ms push and never
// reach the other devices.
function flushPendingPush() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushState(); }
  if (pushConfigTimer) { clearTimeout(pushConfigTimer); pushConfigTimer = null; pushConfig(); }
}

// The app.js build number this page loaded with, read off its own <script> tag.
function myAppVersion() {
  const s = document.querySelector('script[src*="app.js?v="]');
  const m = s && (s.getAttribute('src') || '').match(/app\.js\?v=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function checkForUpdate() {
  if (newVersionSeen) return;
  const mine = myAppVersion();
  if (!mine) return;
  try {
    const res = await fetch('index.html?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/app\.js\?v=(\d+)/);
    const deployed = m ? Number(m[1]) : null;
    if (deployed && deployed > mine) onNewVersion();
  } catch (e) { /* offline / blocked — just try again next tick */ }
}

function startUpdatePolling() {
  setInterval(checkForUpdate, UPDATE_POLL_MS);
  // Phones spend most of camp locked; check the moment the tab comes back too.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}

// Reload with a cache-buster on the page URL so we actually fetch the new
// index.html (and thus the new ?v assets), never a stale cached copy — which
// would otherwise bounce us straight back into "update available" forever.
function doReload() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    location.replace(u.toString());
  } catch (e) {
    location.reload();
  }
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  // Jelly path: an info alert with a Refresh button (whole banner stays
  // tappable, like the old pill). This is auto-reload safety UI, so it must
  // never depend on the module having loaded — legacy pill as fallback.
  if (customElements.get('jelly-alert') && customElements.get('jelly-button')) {
    const bar = document.createElement('jelly-alert');
    bar.id = 'update-banner';
    bar.className = 'update-banner-alert';
    bar.setAttribute('tone', 'info');
    const text = document.createElement('span');
    text.textContent = 'New version available — ';
    const btn = document.createElement('jelly-button');
    btn.setAttribute('size', 'small');
    btn.textContent = 'Refresh';
    bar.append(text, btn);
    bar.addEventListener('click', doReload);
    document.body.appendChild(bar);
    return;
  }
  const bar = document.createElement('button');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.type = 'button';
  bar.textContent = 'New version available — tap to refresh';
  bar.addEventListener('click', doReload);
  document.body.appendChild(bar);
}

function reloadWhenSafe() {
  if (!canEdit() || !editorMidEntry()) { setTimeout(doReload, 1200); return; }
  setTimeout(reloadWhenSafe, 12000); // editor is mid-entry — check back shortly
}

function onNewVersion() {
  if (newVersionSeen) return; // a reload is already scheduled/pending
  newVersionSeen = true;
  showUpdateBanner();
  reloadWhenSafe();
}

// ── Idle auto-collapse ───────────────────────────────────────────
// After a few minutes of no interaction, collapse the expandable cards so a
// returning viewer sees a compact page. Never collapses while an editor is
// mid-entry. Device-local; a manual expand sticks until the next idle stretch.
let idleTimer = null;
const IDLE_COLLAPSE_MS = 5 * 60 * 1000;

function collapseCardsForIdle() {
  if (editorMidEntry()) { resetIdleTimer(); return; } // don't yank a card mid-entry
  // jelly-collapsible animates its own collapse (and skips it under reduced
  // motion). toggle(false) when upgraded so the accordion hears the change;
  // plain attribute removal as the pre-upgrade fallback.
  document.querySelectorAll('.collapsible-card[open]').forEach((d) => {
    if (typeof d.toggle === 'function') d.toggle(false);
    else d.removeAttribute('open');
  });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(collapseCardsForIdle, IDLE_COLLAPSE_MS);
}

function startIdleCollapse() {
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, resetIdleTimer, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resetIdleTimer(); });
  resetIdleTimer();
}

// ── Init ─────────────────────────────────────────────────────────

function renderAll() {
  // Builder visibility is derived from state every render — settings.js
  // navigates by mutating state.ui.view, not by calling open/close helpers.
  if (state.ui.view === 'settings' && !canEdit()) state.ui.view = 'home';
  const inBuilder = builderOpen();
  document.body.classList.toggle('builder-open', inBuilder);
  const builderView = document.getElementById('settings-view');
  if (builderView) builderView.hidden = !inBuilder;
  // Chat takeover, same pattern as the builder: derived from state.ui every
  // render, one takeover at a time, and force-closed for a viewer whose
  // editors hid the chat card (mirrors the hidden-Competitions rule below).
  const inChat = !!state.ui.chatOpen && !inBuilder &&
    !(!canEdit() && cardHiddenFromViewers('chat'));
  if (state.ui.chatOpen && !inChat) state.ui.chatOpen = false;
  document.body.classList.toggle('chat-open', inChat);
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.hidden = !inChat;
  applyCardVisibility(); // before renderGameView — may close a hidden card's game
  renderNoticeBoard();
  renderWhatsNew();
  pruneExpiredAnnouncements();
  renderAnnouncements();
  renderNowBanner();
  renderLiveHome();
  renderDayTabs(); // includes every day panel's game list
  renderGameView();
  renderStandings();
  renderMyElectives();
  renderMemoryVerse();
  renderMealCleanup();
  renderBonuses();
  renderFooter();
  refreshOpenSchedule();
  if (inBuilder && typeof renderSettings === 'function') renderSettings();
  if (typeof renderChatCard === 'function') renderChatCard();
  if (inChat && typeof renderChatView === 'function') renderChatView();
}

// ── Week builder (Settings → Set up the week) ────────────────────
// A full-page editor-only view over the main page: body.builder-open hides
// every other main-wrap section via CSS. settings.js renders the content
// (renderSettings) and signals "back" by setting state.ui.view = 'home'
// before its own renderAll() — visibility is re-derived above either way.

function builderOpen() {
  return state.ui.view === 'settings';
}

function openBuilder(tab) {
  if (!canEdit()) return;
  closeSettings(); // hand off from the settings sheet
  state.ui.view = 'settings';
  if (tab) state.ui.settingsTab = tab;
  if (!state.ui.settingsTab) state.ui.settingsTab = 'games';
  saveState();
  renderAll();
  window.scrollTo({ top: 0 });
}

// Keep an open schedule sheet in step with time and synced results — its
// NOW pill, dimming, and ✓ chips otherwise go stale across a block boundary
// or when a remote result lands.
function refreshOpenSchedule() {
  const overlay = scheduleOverlayEl();
  if (overlay && !overlay.hidden) renderScheduleBody();
}

function init() {
  applyTheme();
  applySoundIcon();
  document.getElementById('theme-toggle').addEventListener('change', (e) => {
    setTheme((e.detail && e.detail.value) || e.target.getAttribute('value'));
  });
  document.getElementById('sound-toggle').addEventListener('change', toggleSound);
  // One "Hide from viewers" switch per card (editor-only; hidden by CSS for
  // view-only). The switches are static markup, so wiring them once here is
  // enough — applyCardVisibility keeps their checked state in step.
  document.querySelectorAll('.hide-card-toggle[data-hide-card]').forEach((sw) => {
    sw.addEventListener('change', () => toggleCardHidden(sw.dataset.hideCard));
  });

  const copyBtn = document.getElementById('copy-standings-btn');
  copyBtn.addEventListener('click', () => copyTextToClipboard(standingsSummaryText(), copyBtn));
  const shareBtn = document.getElementById('share-standings-btn');
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => {
      navigator.share({ text: standingsSummaryText() }).catch(() => {});
    });
  }

  // Account row (settings sheet): shows who's signed in; the button signs out.
  const signoutBtn = document.getElementById('signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', signOutAndClear);
  updateAccountRow();
  wireMembers();
  wireCampSwitcher();
  if (typeof wireChat === 'function') wireChat();

  document.getElementById('notify-toggle-btn').addEventListener('click', toggleNotify);
  updateNotifyButton();
  wireTeamPicker();

  wireSchedule();
  wireSettings();
  wireHistory();

  // Week builder entry point (Settings sheet → Set up the week).
  const builderRow = document.getElementById('builder-row');
  if (builderRow) builderRow.addEventListener('click', () => openBuilder());
  // A remote config held back while a builder input was focused (see the
  // fbConfigRef listener) is applied once focus leaves the form.
  const builderView = document.getElementById('settings-view');
  if (builderView) {
    builderView.addEventListener('focusout', () => {
      setTimeout(() => {
        if (pendingRemoteConfig && !editorMidEntry()) {
          const rc = pendingRemoteConfig;
          pendingRemoteConfig = null;
          applyRemoteConfig(rc);
        }
      }, 0);
    });
  }

  // (Sync is NOT started here — startSync() runs from the approved branch
  // of the member listener, the only place allowed to attach database refs.
  // Until then the indicator honestly reads "Connecting…", or "This device
  // only" when there's no Firebase at all.)
  updateSyncIndicator();
  renderPresence();

  startIdleCollapse();
  startUpdatePolling();
  startWeatherUpdates();
  // Notification-only service worker (no fetch handler — see sw.js header).
  // Needed so OS notifications work on phones: Android Chrome and installed
  // iOS PWAs only show them via a registration, never the bare constructor.
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('sw.js').catch(() => { /* fine — toasts still work */ }); } catch (e) { /* ignore */ }
  }

  renderAll();

  // Keep the "happening now" banner (and any open schedule sheet) current
  // without any taps — and expire "what's new" banners once they hit two hours.
  setInterval(() => { renderNowBanner(); refreshOpenSchedule(); renderNoticeBoard(); renderWhatsNew(); renderMyElectives(); pruneExpiredAnnouncements(); renderAnnouncements(); if (typeof renderChatCard === 'function') renderChatCard(); }, 30 * 1000);

  // Tick every visible Big Board clock (no-ops instantly when none is on
  // screen, so the interval is effectively free the rest of the week).
  setInterval(tickBoardClocks, 500);
}

function updateAccountRow() {
  const label = document.getElementById('account-label');
  if (!label) return;
  const who = identityLabel(authUser); // email or phone number
  const camp = hasBothCamps() ? ' · ' + CAMP.label : '';
  label.textContent = (canEdit() ? '✏️ Editor' : '👀 Viewer') + (who ? ' — ' + who : '') + camp;
  // The camp switcher only exists for accounts on both camps' lists. The
  // control just reflects the active camp — the page reloads on change, so
  // it never has to track anything.
  const row = document.getElementById('camp-row');
  if (row) {
    row.hidden = !hasBothCamps();
    const seg = document.getElementById('camp-switch');
    if (seg) {
      seg.setAttribute('value', CAMP.id);
      try { seg.value = CAMP.id; } catch (e) { /* attribute is enough */ }
    }
  }
}

// ── Joy layer ────────────────────────────────────────────────────
// Playful, decorative-only animation glue: springy press feedback on every
// tappable control, a little sparkle burst at the tap point, staggered
// rise-ins when a view re-renders from a tap, and a bigger celebration
// whenever real scoreboard data is saved (hooked from touchData). All of it
// is transform/opacity only, capped, throttled, and fully disabled under
// prefers-reduced-motion — the app works identically with this section gone.
const JOY_REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const JOY_TAPPABLE = 'button, a, summary, jelly-button, jelly-chip, jelly-segment, jelly-icon-button';
const JOY_COLORS = ['var(--color-primary)', 'var(--color-gold)', '#ff6b9d', 'var(--color-bronze)', '#4cc9a4'];
let joyLastTap = { x: null, y: null };
let joyLastBurstAt = 0;

function joyLayerEl() {
  let el = document.getElementById('joy-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'joy-layer';
    document.body.appendChild(el);
  }
  return el;
}

// A burst of sparkles at (x, y). Small for ordinary taps; big (more
// particles, some emoji, longer flight) for save/celebrate moments.
function joyBurst(x, y, big) {
  if (JOY_REDUCED.matches) return;
  if (x == null || y == null) { x = innerWidth / 2; y = innerHeight / 2; }
  const now = Date.now();
  if (!big && now - joyLastBurstAt < 90) return; // throttle rapid taps
  joyLastBurstAt = now;
  const layer = joyLayerEl();
  if (layer.childElementCount > 70) return; // hard cap, keeps the DOM tiny
  const n = big ? 16 : 6;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    if (big && Math.random() < 0.35) {
      p.className = 'joy-p';
      p.textContent = ['✨', '⭐', '🎉', '💫'][Math.floor(Math.random() * 4)];
    } else {
      p.className = 'joy-p dot';
      p.style.setProperty('--c', JOY_COLORS[i % JOY_COLORS.length]);
    }
    const ang = Math.random() * Math.PI * 2;
    const dist = (big ? 55 : 26) + Math.random() * (big ? 85 : 26);
    p.style.setProperty('--x', x + 'px');
    p.style.setProperty('--y', y + 'px');
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + (big ? 30 : 10) + 'px'); // slight fall
    p.style.setProperty('--t', ((big ? 0.75 : 0.5) + Math.random() * 0.3).toFixed(2) + 's');
    p.style.setProperty('--r', Math.round(Math.random() * 360 - 180) + 'deg');
    p.addEventListener('animationend', () => p.remove());
    layer.appendChild(p);
  }
}

// Re-run a container's children through the staggered rise-in. Called right
// after a tap-triggered re-render (day switch, back to list, verse day…) —
// never from sync/background renders, so remote updates stay calm.
function joyStagger(el) {
  if (!el || JOY_REDUCED.matches) return;
  el.classList.remove('joy-stagger');
  void el.offsetWidth; // restart the animation
  el.classList.add('joy-stagger');
  setTimeout(() => el.classList.remove('joy-stagger'), 900);
}

// Slide a view into place (game detail opening).
function joySlideIn(el) {
  if (!el || JOY_REDUCED.matches) return;
  el.classList.remove('joy-slide-in');
  void el.offsetWidth;
  el.classList.add('joy-slide-in');
  setTimeout(() => el.classList.remove('joy-slide-in'), 500);
}

// The big one: called from touchData(), so every action that records real
// scoreboard data (a result saved, points awarded, a bracket win…) throws a
// proper little celebration from wherever the editor's finger last was.
let joyLastCelebrateAt = 0;
function joyCelebrate() {
  const now = Date.now();
  if (now - joyLastCelebrateAt < 800) return;
  joyLastCelebrateAt = now;
  joyBurst(joyLastTap.x, joyLastTap.y, true);
}

// Delegated press feedback: scale down on touch, spring back on release.
document.addEventListener('pointerdown', (e) => {
  joyLastTap = { x: e.clientX, y: e.clientY };
  if (JOY_REDUCED.matches) return;
  const t = e.target.closest && e.target.closest(JOY_TAPPABLE);
  if (t) t.classList.add('joy-pressed');
}, { passive: true });

document.addEventListener('pointerup', () => {
  document.querySelectorAll('.joy-pressed').forEach((el) => {
    el.classList.remove('joy-pressed');
    el.classList.add('joy-pop');
    setTimeout(() => el.classList.remove('joy-pop'), 460);
  });
}, { passive: true });

document.addEventListener('pointercancel', () => {
  document.querySelectorAll('.joy-pressed').forEach((el) => el.classList.remove('joy-pressed'));
}, { passive: true });

// Sparkle on every real button push (not on text fields). Card headers are
// jelly-collapsible shadow buttons — the host is the click target out here,
// so it's included for the sparkle (but deliberately NOT in JOY_TAPPABLE:
// press-scaling a whole card looks heavy-handed).
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest(JOY_TAPPABLE + ', jelly-collapsible');
  if (!t) return;
  joyBurst(e.clientX, e.clientY, false);
}, { passive: true });

// Panel expand/collapse animation now lives inside jelly-collapsible itself
// (springy grid-rows height, bouncy chevron, content pop) — the joy layer
// only adds the tap sparkle on the header (see the click listener above,
// which includes jelly-collapsible in its sparkle targets).

// ── Auth gate ────────────────────────────────────────────────────
// See the "Sign-in & roles" block at the top of this file for the model.
// The flow: boot() → startAuth() → onAuthStateChanged → member self-read →
// approved → startApp() (+ startSync()). Every screen along the way renders
// inside the #lock-screen shell via html.locked.

let appStarted = false;

function applyRoleClass() {
  document.documentElement.classList.toggle('view-only', !canEdit());
}

// Every collapsible card starts collapsed on each load — a tidy, quick-to-scan
// home screen for everyone, editors included. Manual expands aren't remembered
// across reloads, and the idle timer re-collapses everything after a few
// minutes of no interaction.
// Attribute-only on purpose: setting the .open PROPERTY before the jelly
// module upgrades the element would plant an own property that shadows the
// class accessor forever (the classic pre-upgrade gotcha).
function applyCardDefaults() {
  document.querySelectorAll('.collapsible-card').forEach((d) => {
    d.removeAttribute('open');
  });
}

function startApp() {
  document.documentElement.classList.remove('locked');
  document.documentElement.classList.toggle('camp-senior', CAMP.id === 'senior');
  applyRoleClass();
  applyCardDefaults();
  if (!appStarted) {
    appStarted = true;
    init();
  } else {
    updateAccountRow();
    renderAll();
  }
  maybeShowTeamPicker();
}

// Show one of the lock-screen panels: 'checking' | 'signin' | 'denied'.
// opts: { error, email }
function showAuthScreen(mode, opts) {
  document.documentElement.classList.add('locked');
  ['auth-checking', 'auth-signin', 'auth-denied'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== 'auth-' + (mode === 'signin' ? 'signin' : mode);
  });
  const errEl = document.getElementById('lock-error');
  if (errEl) {
    errEl.textContent = (opts && opts.error) || '';
    errEl.hidden = !(opts && opts.error);
  }
  const who = document.getElementById('auth-denied-email');
  if (who && opts && opts.email) who.textContent = opts.email;
  // The alternative sign-in methods mount lazily into their slots inside the
  // "Alternative sign in" disclosure. Both are optional modules (delete the
  // matching <script> tag to remove one); the Google button always remains.
  if (mode === 'signin') {
    if (window.CampPhone) window.CampPhone.mount(document.getElementById('alt-phone-slot'));
    if (window.CampEmailLink) window.CampEmailLink.mount(document.getElementById('alt-email-slot'));
  }
}

function hideLockError() {
  const errEl = document.getElementById('lock-error');
  if (errEl) errEl.hidden = true;
}

// Human messages for the sign-in errors people actually hit.
function showSignInError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return; // they changed their mind
  let msg;
  if (code === 'auth/popup-blocked') {
    msg = 'Your browser blocked the sign-in window — allow pop-ups for this site and try again.';
  } else if (code === 'auth/network-request-failed') {
    msg = 'You look offline — signing in needs an internet connection.';
  } else if (code === 'auth/unauthorized-domain') {
    msg = 'This copy of the site isn\'t authorized for sign-in (unauthorized domain).';
  } else {
    msg = 'Sign-in didn\'t work (' + (code || 'unknown error') + '). Try again.';
  }
  showAuthScreen('signin', { error: msg });
}

function wireAuthScreen() {
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      hideLockError();
      // signInWithPopup must be called synchronously inside the click handler
      // — any await first and Safari/iOS drops the user gesture and blocks
      // the popup. Never signInWithRedirect: it needs cross-site storage that
      // Safari/Firefox block for sites not hosted on the authDomain.
      try {
        firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(showSignInError);
      } catch (e) {
        showSignInError(e);
      }
    });
  }
  const switchBtn = document.getElementById('auth-switch-btn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      try { firebase.auth().signOut().catch(() => {}); } catch (e) { /* ignore */ }
      // onAuthStateChanged(null) takes over and shows the sign-in panel.
    });
  }
  const retryBtn = document.getElementById('auth-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', () => location.reload());
}

// Entry point, from boot(). Initializes Firebase (the auth SDK needs the app
// before the database does) and subscribes to sign-in state.
function startAuth() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || typeof firebase === 'undefined' || !firebase.auth) {
    // No Firebase at all (local dev with the CDN blocked, or the SDK failed
    // to load). There is nothing to sign in TO — run local-only, view-only.
    startApp();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
  } catch (e) {
    showAuthScreen('signin', { error: 'Sign-in couldn\'t start — reload to try again.' });
    return;
  }
  // Returning from an emailed sign-in link? Complete it before (well,
  // alongside) the state subscription — success lands in handleAuthUser.
  if (window.CampEmailLink) window.CampEmailLink.completeSignInIfLink();
  firebase.auth().onAuthStateChanged(handleAuthUser);
}

let memberRef = null; // this account's own campScoreboard/members entry

function handleAuthUser(user) {
  if (memberRef) { try { memberRef.off(); } catch (e) { /* ignore */ } memberRef = null; }
  const key = identityKey(user); // email or phone; '' if neither
  if (!user || !key) {
    authUser = null;
    clearAuthHint();
    if (appStarted) authTornDown = true; // recovery from here is a reload (see onMemberSnapshot)
    showAuthScreen('signin');
    return;
  }
  authUser = user;
  // The approval check: the self-read of this account's member record (keyed
  // by email or phone). Under the locked rules a non-member's read is
  // CANCELLED (not null) — both land on the not-approved screen. Kept attached
  // for live changes: a removal cancels this listener (kick), a role change
  // fires a fresh snapshot.
  if (!appStarted) showAuthScreen('checking');
  memberRef = firebase.database().ref(dbPath('members/' + key));
  memberRef.on('value', onMemberSnapshot, onMemberReadError);
}

function onMemberSnapshot(snap) {
  const rec = snap.val();
  if (!rec || !rec.role) { denyMember(); return; }
  memberName = rec.name || null;
  setMemberRole(rec.role);
  setMemberTeam(rec.teamId); // which team they're ON (auto-follow + own-team guard)
  setAuthHint(memberRole);
  if (authTornDown) {
    // Sign-in was lost and re-established mid-session. The database listeners
    // from before are permanently dead (a cancelled read is terminal — see
    // initSync), so the honest recovery is a clean reload.
    location.reload();
    return;
  }
  startApp();
  startSync(); // attach the database listeners — only ever from here
  probeOtherCamp(); // one-shot: is this account on the OTHER camp's list too?
  maybeShowCampPicker(); // dual-camp accounts choose a camp every launch
}

function onMemberReadError() {
  denyMember(); // read refused by rules: signed in, but not on the list
}

function denyMember() {
  // Not on THIS camp's list — but maybe on the other one. The default camp
  // is junior, so a senior-only counselor's first sign-in lands here; probe
  // the other camp once and switch over instead of turning them away. The
  // sessionStorage flag makes the bounce one-shot (denied in BOTH camps
  // must end at the denial screen, never a reload loop).
  const key = identityKey(authUser);
  let tried = false;
  try { tried = sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY) === '1'; } catch (e) { /* fine */ }
  const canProbe = key && !tried && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length;
  if (canProbe) {
    const other = CAMPS[otherCampId()];
    try {
      firebase.database().ref(other.dbRoot + '/members/' + key).once('value')
        .then((snap) => {
          const rec = snap.val();
          if (rec && (rec.role === 'editor' || rec.role === 'viewer')) {
            try { sessionStorage.setItem(CAMP_SWITCH_TRIED_KEY, '1'); } catch (e) { /* fine */ }
            writeCampsHint(other.id, rec.role);
            writeCampsHint(CAMP.id, null);
            switchCamp(other.id);
          } else {
            denyMemberFinal();
          }
        })
        .catch(denyMemberFinal);
      return;
    } catch (e) { /* fall through */ }
  }
  denyMemberFinal();
}

function denyMemberFinal() {
  const who = identityLabel(authUser); // email or phone number
  setMemberRole(null);
  setMemberTeam(null);
  memberDirectory = null;
  clearAuthHint();
  // A device that isn't approved shouldn't keep camp data around either.
  clearLocalData();
  showAuthScreen('denied', { email: who });
}

// ── Pre-paint hint ───────────────────────────────────────────────
// Approved devices cache their last confirmed role so the NEXT load paints
// the app instantly from local state while sign-in re-confirms in the
// background (index.html's pre-paint guard reads the same key). Purely a
// convenience — the security rules never consult it.
function setAuthHint(role) {
  try { localStorage.setItem(AUTH_HINT_KEY, role); } catch (e) { /* fine */ }
  writeCampsHint(CAMP.id, role); // the per-camp ledger behind the camp picker
}

function clearAuthHint() {
  try { localStorage.removeItem(AUTH_HINT_KEY); } catch (e) { /* fine */ }
}

function authHintRole() {
  try {
    const h = localStorage.getItem(AUTH_HINT_KEY);
    return h === 'editor' || h === 'viewer' ? h : null;
  } catch (e) { return null; }
}

// ── The other camp ───────────────────────────────────────────────
// One account can be on the junior list, the senior list, or both — each
// camp keeps its own members node (campScoreboard/members vs
// seniorScoreboard/members). This device only ever ATTACHES listeners for
// the active camp; the other camp gets a single one-shot once() probe (a
// failed once() is harmless — it's the .on() self-read whose cancellation
// is terminal). CAMPS_HINT_KEY caches what the probes learned —
// {junior: 'editor', senior: 'viewer'} — so the camp picker and switcher
// can paint instantly on later loads. Like the auth hint, it's convenience
// only: the rules never consult it, and a forged entry buys an empty shell.
const CAMPS_HINT_KEY = 'campScoreboardCampsHint';
const CAMP_SWITCH_TRIED_KEY = 'campSwitchTried'; // sessionStorage loop guard
const CAMP_ASKED_KEY = 'campScoreboardCampAsked'; // the one-time "which camp?" ask already happened

let otherCampRole = null;   // 'viewer' | 'editor' | null — this account, other camp
let otherCampProbed = false;
let campPickerAsked = false; // the every-launch ask happens once per page load

function readCampsHint() {
  try {
    const h = JSON.parse(localStorage.getItem(CAMPS_HINT_KEY) || '{}');
    return (h && typeof h === 'object' && !Array.isArray(h)) ? h : {};
  } catch (e) { return {}; }
}

function writeCampsHint(campId, role) {
  const h = readCampsHint();
  if (role === 'editor' || role === 'viewer') h[campId] = role;
  else delete h[campId];
  try { localStorage.setItem(CAMPS_HINT_KEY, JSON.stringify(h)); } catch (e) { /* fine */ }
}

// True when this account is (as far as the hints know) on BOTH camps' lists.
function hasBothCamps() {
  const h = readCampsHint();
  return !!(h.junior && h.senior);
}

// Set-key-and-reload — the ONLY way to change camps. The listener lifecycle
// is one-shot by design (a cancelled read is terminal; there is no teardown
// path), so a running page never re-points its refs in place.
function switchCamp(campId) {
  if (!CAMPS[campId] || campId === CAMP.id) return;
  try { localStorage.setItem(ACTIVE_CAMP_KEY, campId); } catch (e) { return; }
  // Hand the destination camp's cached role to the pre-paint guard so the
  // next load paints with the right chrome immediately.
  const role = readCampsHint()[campId];
  try {
    if (role === 'editor' || role === 'viewer') localStorage.setItem(AUTH_HINT_KEY, role);
    else localStorage.removeItem(AUTH_HINT_KEY);
  } catch (e) { /* fine */ }
  location.reload();
}

// One-shot probe of the other camp's member record, fired after this camp
// approves. Fills otherCampRole + the camps hint, then surfaces the
// dual-camp UI (picker on launch, switcher row) if it just became relevant.
function probeOtherCamp() {
  if (otherCampProbed) return;
  otherCampProbed = true;
  const key = identityKey(authUser);
  if (!key || typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
  const other = CAMPS[otherCampId()];
  const record = (rec) => {
    otherCampRole = rec && (rec.role === 'editor' || rec.role === 'viewer') ? rec.role : null;
    writeCampsHint(other.id, otherCampRole);
    if (appStarted) {
      updateAccountRow();
      maybeShowCampPicker();
    }
  };
  try {
    firebase.database().ref(other.dbRoot + '/members/' + key).once('value')
      .then((snap) => record(snap.val()))
      .catch(() => record(null)); // rules refused the read — not on that list
  } catch (e) { record(null); }
}

// An account with BOTH camps gets asked which one ONCE — the first time
// this device discovers the second camp — and the answer is remembered
// (the active-camp key). After that the app opens straight into the camp
// you used last; switching lives in Settings (the Camp switcher) and the
// footer camp chip. Single-camp accounts never see any of this.
// (Owner's revised call, 2026-07-25 — this replaced ask-every-launch.)
function maybeShowCampPicker() {
  if (campPickerAsked || !hasBothCamps()) return;
  campPickerAsked = true;
  try {
    if (localStorage.getItem(CAMP_ASKED_KEY) === '1') return; // already answered once
    localStorage.setItem(CAMP_ASKED_KEY, '1');
  } catch (e) { /* fine */ }
  openCampPicker();
}

function openCampPicker() {
  const overlay = document.getElementById('camp-picker-overlay');
  const wrap = document.getElementById('camp-picker-options');
  if (!overlay || !wrap) return;
  closeTeamPicker(); // one dialog at a time — the camp question comes first
  const h = readCampsHint();
  wrap.innerHTML = ['junior', 'senior'].map((cid) => {
    const c = CAMPS[cid];
    const here = cid === CAMP.id;
    const role = h[cid] === 'editor' ? '✏️ Editor' : '👀 Viewer';
    return `<button class="team-picker-option camp-picker-option ${here ? 'selected' : ''}" data-camp-id="${cid}">
      <span class="chip-emoji">${cid === 'senior' ? '🚩' : '🛡️'}</span> ${esc(c.label)}
      <span class="chip-sub">${role}${here ? ' · you\u2019re here now' : ''}</span>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.camp-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.campId;
      if (cid === CAMP.id) { overlay.removeAttribute('open'); return; } // staying put
      switchCamp(cid);
    });
  });
  overlay.setAttribute('open', '');
}

// ── Sign out ─────────────────────────────────────────────────────
// Signing out also clears the camp data cached on this device — the whole
// synced state lives in localStorage (and Pictionary photos in IndexedDB),
// and once PII rides along in it, a signed-out device must not keep a copy.
// The theme preference resets to Auto (the boot guards discard partial
// state, so there is deliberately no carry-over mechanism).
function clearLocalData() {
  // Both camps' caches go — sign-out is account-level, and a signed-out
  // device must not keep either camp's data. (The bare base names are the
  // junior keys; the suffixed ones are senior's.)
  const bases = ['campScoreboardV2', 'campScoreboardDayRanks',
    'campScoreboardDismissedChanges', 'campScoreboardDismissedAnnouncements',
    'campScoreboardChatSeen'];
  Object.keys(CAMPS).forEach((cid) => {
    bases.forEach((b) => {
      try { localStorage.removeItem(b + CAMPS[cid].storageSuffix); } catch (e) { /* ignore */ }
    });
  });
  [AUTH_HINT_KEY, EMAIL_SIGNIN_KEY, CAMPS_HINT_KEY, ACTIVE_CAMP_KEY, CAMP_ASKED_KEY].forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  });
}

function signOutAndClear() {
  if (!confirm('Sign out? Camp data stored on this device will be cleared.')) return;
  clearLocalData();
  try { clearPhotos().catch(() => {}); } catch (e) { /* ignore */ }
  // The active camp's photo store is cleared above; delete the other
  // camp's database wholesale (it isn't open, so deleteDatabase is safe).
  try { indexedDB.deleteDatabase('campScoreboardPhotos' + CAMPS[otherCampId()].storageSuffix); } catch (e) { /* ignore */ }
  const done = () => location.reload(); // full teardown: timers, listeners, in-memory state
  try {
    firebase.auth().signOut().then(done, done);
  } catch (e) {
    done();
  }
}

function boot() {
  applyTheme(); // the lock screen is the first thing everyone sees — theme it too
  // Name the page after the active camp so a phone with both camps open in
  // two tabs can tell them apart. Junior keeps the plain "Camp" it always had.
  if (CAMP.id === 'senior') {
    document.title = 'Camp · Senior';
    const logo = document.querySelector('.lock-logo');
    if (logo) logo.innerHTML = '<span>🚩</span> Camp · Senior';
  }
  wireAuthScreen();
  // A device that was approved last time paints the app immediately from
  // local state (exactly the pre-auth behavior) with its cached role, while
  // startAuth() re-confirms in the background — and intervenes only if the
  // server disagrees. A forged hint buys an empty shell: the rules refuse
  // every read, and denyMember() locks the screen again.
  // Prefer the per-camp ledger (a dual-role account paints with the RIGHT
  // role for this camp); fall back to the single-value hint.
  const campsHint = readCampsHint()[CAMP.id];
  const hinted = (campsHint === 'editor' || campsHint === 'viewer') ? campsHint : authHintRole();
  if (hinted) {
    setMemberRole(hinted);
    startApp();
    maybeShowCampPicker(); // dual-camp devices choose a camp every launch
  } else {
    showAuthScreen('checking');
  }
  startAuth();
}

document.addEventListener('DOMContentLoaded', boot);
