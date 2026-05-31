'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */

const SPEED_DEFAULTS = { Car: 65, Plane: 500, Train: 80 };
const TRANSPORT_LABELS = { Car: '🚗 Car', Plane: '✈️ Plane', Train: '🚆 Train' };
const FARE_PER_MILE = { Plane: 0.18, Train: 0.22 };
const DRIVE_HOURS_PER_BREAK = 2.5;
const BREAK_MINUTES = 20;
const STORAGE_KEY = 'tripPlanner.v2';

// Improvement 3: encouragement messages shown between steps
const ENCOURAGEMENTS = {
  2: dest => `Great choice! 🎉 Now let's figure out how you're getting to ${dest || 'your destination'}.`,
  3: dest => `You're all set! 🚀 Here's everything you need for your trip to ${dest || 'your destination'}.`,
};

// Improvement 5: destination emoji by keyword
const DEST_EMOJI_MAP = [
  [/beach|coast|key |island|maui|kauai|malibu|cancún|tulum/i, '🏖️'],
  [/canyon|desert|sedona|mesa|monument|moab|arches|death valley/i, '🏜️'],
  [/mountain|aspen|vail|telluride|breckenridge|whistler|banff|jasper/i, '⛰️'],
  [/park|yosemite|glacier|yellowstone|smoky|redwood|olympic|crater/i, '🌲'],
  [/city|york|chicago|angeles|francisco|miami|atlanta|dallas|houston/i, '🏙️'],
  [/orlando|disney|universal/i, '🎢'],
  [/hawaii|honolulu|hilo|kona/i, '🌺'],
  [/lake|tahoe|minnewaska|superior|michigan|baikal/i, '🏞️'],
  [/snow|ski|winter|stowe|vail|aspen/i, '⛷️'],
  [/new orleans|jazz|bourbon/i, '🎷'],
  [/nashville|memphis|country/i, '🎸'],
];

function destEmoji(dest) {
  if (!dest) return '✈️';
  for (const [re, emoji] of DEST_EMOJI_MAP) if (re.test(dest)) return emoji;
  return '🗺️';
}

// Improvement 2: transport context banners
const TRANSPORT_CONTEXT = {
  Car: { icon: '🚗', msg: 'We\'ll calculate your driving time, fuel cost, and rest stops.' },
  Plane: { icon: '✈️', msg: 'We\'ll estimate flight time based on distance. Add 2–3 hours for airport time.' },
  Train: { icon: '🚆', msg: 'We\'ll estimate rail travel time. Check Amtrak or VIA Rail for schedules.' },
};

let currentActivities = {};

/* ============================================================
   STATE
   ============================================================ */

const defaultState = () => ({
  origin: '', destination: '', miles: null, date: '', roundTrip: false, returnDate: '',
  tzOffset: 0, transport: 'Car', speed: 65, mpg: 28, gasPrice: 3.50,
  departureTime: '', targetArrival: '', itinerary: [],
});

let state = defaultState();
let currentStep = 1;
let activeCategory = null;
let activeFilter = 'all';
let searchTerm = '';

/* ============================================================
   DOM REFERENCES
   ============================================================ */

const $ = id => document.getElementById(id);
const stepPanels    = [1, 2, 3].map(n => $(`step-${n}`));
const stepNodes     = document.querySelectorAll('.step-node');
const connector12   = $('connector-1-2');
const connector23   = $('connector-2-3');
const btnNext       = $('btn-next');
const btnBack       = $('btn-back');
const speedGroup    = $('speed-group');
const carCostInputs = $('car-cost-inputs');
const activityList  = $('activity-list');
const activityControls = $('activity-controls');

/* ============================================================
   THEME
   ============================================================ */

function initTheme() {
  const saved = localStorage.getItem('tripPlanner.theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('tripPlanner.theme', next);
}

/* ============================================================
   IMPROVEMENT 3: PROGRESS BAR + ENCOURAGEMENT
   ============================================================ */

function updateProgress(step) {
  const pct = ((step - 1) / 2) * 100;
  $('progress-bar').style.width = pct + '%';

  const banner = $('encourage-banner');
  const text   = $('encourage-text');
  if (step > 1 && ENCOURAGEMENTS[step]) {
    text.textContent = ENCOURAGEMENTS[step](state.destination);
    banner.hidden = false;
    // Auto-hide after 5s
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => { banner.hidden = true; }, 5000);
  } else {
    banner.hidden = true;
  }
}

/* ============================================================
   AUTOCOMPLETE — shared helper
   ============================================================ */

function buildAutoCompleteList(listEl, matches, onSelect) {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  if (!matches.length) { listEl.hidden = true; return; }
  listEl.hidden = false;
  matches.forEach(dest => {
    const li = document.createElement('li');
    li.className = 'autocomplete-item';
    li.textContent = dest;
    li.addEventListener('mousedown', e => { e.preventDefault(); onSelect(dest); });
    listEl.appendChild(li);
  });
}

function filterDestinations(query) {
  if (!query) return [];
  const lower = query.toLowerCase();
  // Start-of-word matches first, then substring
  const starts = DESTINATIONS.filter(d => d.toLowerCase().startsWith(lower));
  const contains = DESTINATIONS.filter(d => !d.toLowerCase().startsWith(lower) && d.toLowerCase().includes(lower));
  return [...starts, ...contains].slice(0, 10);
}

/* ============================================================
   IMPROVEMENT 1: ORIGIN FIELD + AUTO-FILL DISTANCE
   ============================================================ */

function setupOriginAutocomplete() {
  const input = $('origin');
  const list  = $('origin-autocomplete-list');

  input.addEventListener('input', () => {
    buildAutoCompleteList(list, filterDestinations(input.value), selectOrigin);
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

function selectOrigin(city) {
  $('origin').value = city;
  $('origin-autocomplete-list').hidden = true;
  state.origin = city;
  tryAutoFillDistance();
}

function tryAutoFillDistance() {
  const dist = lookupDistance(state.origin, state.destination);
  const hint  = $('origin-hint');
  const milesInput = $('miles');
  if (dist) {
    milesInput.value = dist;
    state.miles = dist;
    hint.textContent = `📏 About ${dist.toLocaleString()} miles from ${state.origin} to ${state.destination}.`;
    markValid('miles', true);
    clearError('miles', 'err-miles');
    updateNextButtonState();
  } else if (state.origin && state.destination) {
    hint.textContent = `We don't have the exact distance saved — enter it manually below.`;
  } else {
    hint.textContent = '';
  }
}

/* ============================================================
   DESTINATION AUTOCOMPLETE
   ============================================================ */

function setupDestinationAutocomplete() {
  const input = $('destination');
  const list  = $('autocomplete-list');

  input.addEventListener('input', () => {
    buildAutoCompleteList(list, filterDestinations(input.value), selectDestination);
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

function selectDestination(dest) {
  $('destination').value = dest;
  $('autocomplete-list').hidden = true;
  state.destination = dest;
  currentActivities = getActivitiesForDestination(dest);
  clearError('destination', 'err-destination');
  markValid('destination', true);
  updateNextButtonState();
  // Try distance after destination known
  tryAutoFillDistance();
  // Update activity section header
  const nameEl = $('activity-dest-name');
  if (nameEl) nameEl.textContent = dest.split(',')[0];
}

/* ============================================================
   STEP NAVIGATION
   ============================================================ */

function transitionPanel(outEl, inEl) {
  if (outEl === inEl) return;
  outEl.classList.remove('step-panel--active');
  outEl.addEventListener('transitionend', () => { outEl.style.display = 'none'; }, { once: true });
  setTimeout(() => { if (!outEl.classList.contains('step-panel--active')) outEl.style.display = 'none'; }, 400);
  inEl.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => inEl.classList.add('step-panel--active')));
}

function updateStepIndicator(n) {
  stepNodes.forEach((node, i) => {
    const step = i + 1;
    node.classList.remove('active', 'complete');
    node.removeAttribute('aria-current');
    if (step < n) node.classList.add('complete');
    else if (step === n) { node.classList.add('active'); node.setAttribute('aria-current', 'step'); }
  });
  connector12.classList.toggle('complete', n > 1);
  connector23.classList.toggle('complete', n > 2);
}

function goToStep(n) {
  transitionPanel(stepPanels[currentStep - 1], stepPanels[n - 1]);
  updateStepIndicator(n);
  updateProgress(n);  // Improvement 3
  currentStep = n;
  btnBack.hidden = n === 1;

  if (n === 3) {
    btnNext.textContent = 'Start Over';
    btnNext.classList.remove('btn--primary');
    btnNext.classList.add('btn--danger');
    renderSummary();
    renderItinerary();
    // Update activity dest name
    const nameEl = $('activity-dest-name');
    if (nameEl) nameEl.textContent = (state.destination || '').split(',')[0] || 'your destination';
  } else {
    btnNext.textContent = 'Next →';
    btnNext.classList.add('btn--primary');
    btnNext.classList.remove('btn--danger');
  }

  // Improvement 2: show transport context when arriving at step 2
  if (n === 2) renderTransportContext();
  // Improvement 3: update subtitle with destination name on step 2
  if (n === 2 && state.destination) {
    const sub = $('step2-subtitle');
    if (sub) sub.textContent = `Pick how you're getting to ${state.destination.split(',')[0]}.`;
  }

  updateNextButtonState();
  renderRecentTrips();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   IMPROVEMENT 2: TRANSPORT CONTEXT BANNER
   ============================================================ */

function renderTransportContext() {
  const el = $('transport-context');
  if (!el) return;
  const ctx = TRANSPORT_CONTEXT[getCheckedTransport()];
  if (!ctx) { el.textContent = ''; return; }
  el.innerHTML = '';
  const icon = document.createElement('span');
  icon.textContent = ctx.icon + '  ';
  const msg = document.createElement('span');
  msg.textContent = ctx.msg;
  el.append(icon, msg);
}

/* ============================================================
   VALIDATION
   ============================================================ */

function setError(inputId, errorId, message) {
  const input = $(inputId), err = $(errorId);
  if (input) input.classList.add('invalid');
  if (err) err.textContent = message;
}
function clearError(inputId, errorId) {
  const input = $(inputId), err = $(errorId);
  if (input) input.classList.remove('invalid');
  if (err) err.textContent = '';
}
function markValid(inputId, isValid) {
  const input = $(inputId);
  if (!input) return;
  const wrap = input.parentElement;
  if (wrap && (wrap.classList.contains('input-wrap') || wrap.classList.contains('autocomplete-wrapper'))) {
    wrap.classList.toggle('valid', isValid);
  }
}

function isStepComplete(n) {
  if (n === 1) {
    const destOk  = $('destination').value.trim() !== '';
    const milesOk = parseFloat($('miles').value) > 0;
    const dateOk  = $('departure-date').value !== '';
    const retOk   = !$('round-trip-toggle').checked || $('return-date').value !== '';
    return destOk && milesOk && dateOk && retOk;
  }
  if (n === 2) {
    const carOk = getCheckedTransport() !== 'Car' || parseFloat($('speed').value) > 0;
    const timeOk = $('departure-time').value !== '';
    return carOk && timeOk;
  }
  return true;
}

function updateNextButtonState() {
  if (currentStep === 3) { btnNext.disabled = false; return; }
  btnNext.disabled = !isStepComplete(currentStep);
}

function validateStep(n) {
  let ok = true;
  if (n === 1) {
    if (!state.destination.trim()) { setError('destination', 'err-destination', '📍 Please enter a destination.'); ok = false; }
    else clearError('destination', 'err-destination');
    if (!state.miles || state.miles <= 0) { setError('miles', 'err-miles', '📏 Please enter the distance in miles.'); ok = false; }
    else clearError('miles', 'err-miles');
    if (!state.date) { setError('departure-date', 'err-date', '📅 Please pick a departure date.'); ok = false; }
    else clearError('departure-date', 'err-date');
    if (state.roundTrip && !state.returnDate) { setError('return-date', 'err-return-date', '📅 Please pick a return date.'); ok = false; }
    else clearError('return-date', 'err-return-date');
  }
  if (n === 2) {
    if (state.transport === 'Car' && (!state.speed || state.speed <= 0)) { setError('speed', 'err-speed', 'Please enter a valid average speed.'); ok = false; }
    else clearError('speed', 'err-speed');
    if (!state.departureTime) { setError('departure-time', 'err-time', '⏰ Please pick a departure time.'); ok = false; }
    else clearError('departure-time', 'err-time');
  }
  return ok;
}

/* ============================================================
   STATE COLLECTION
   ============================================================ */

function getCheckedTransport() {
  const r = document.querySelector('[name=transport]:checked');
  return r ? r.value : 'Car';
}

function collectStep(n) {
  if (n === 1) {
    state.origin      = $('origin').value.trim();
    state.destination = $('destination').value.trim();
    state.miles       = parseFloat($('miles').value) || null;
    state.date        = $('departure-date').value;
    state.roundTrip   = $('round-trip-toggle').checked;
    state.returnDate  = $('return-date').value;
    state.tzOffset    = parseInt($('dest-tz').value, 10) || 0;
    currentActivities = getActivitiesForDestination(state.destination);
  }
  if (n === 2) {
    state.transport     = getCheckedTransport();
    state.speed         = parseFloat($('speed').value) || SPEED_DEFAULTS[state.transport];
    state.mpg           = parseFloat($('mpg').value) || 28;
    state.gasPrice      = parseFloat($('gas-price').value) || 0;
    state.departureTime = $('departure-time').value;
    state.targetArrival = $('target-arrival').value;
  }
}

/* ============================================================
   CALCULATIONS
   ============================================================ */

function calcTravelTime() {
  const speed = state.transport === 'Car' ? state.speed : SPEED_DEFAULTS[state.transport];
  const drivingHours = state.miles / speed;
  let breakMinutes = 0;
  if (state.transport === 'Car') {
    breakMinutes = Math.max(0, Math.floor(drivingHours / DRIVE_HOURS_PER_BREAK)) * BREAK_MINUTES;
  }
  const totalMinutes = Math.round(drivingHours * 60) + breakMinutes;
  return { drivingHours, breakMinutes, totalMinutes };
}

function calcCost() {
  if (state.transport === 'Car') return (state.miles / (state.mpg || 28)) * (state.gasPrice || 0);
  return state.miles * (FARE_PER_MILE[state.transport] || 0);
}

function calcArrival(totalMinutes) {
  const [h, m] = state.departureTime.split(':').map(Number);
  let arrivalMins = h * 60 + m + totalMinutes + state.tzOffset * 60;
  let dayOffset = 0;
  while (arrivalMins >= 1440) { arrivalMins -= 1440; dayOffset++; }
  while (arrivalMins < 0)     { arrivalMins += 1440; dayOffset--; }
  return { minutes: arrivalMins, dayOffset };
}

function calcRecommendedDeparture() {
  if (!$('target-arrival').value) return null;
  const transport = getCheckedTransport();
  const speed = transport === 'Car' ? (parseFloat($('speed').value) || SPEED_DEFAULTS.Car) : SPEED_DEFAULTS[transport];
  const miles = parseFloat($('miles').value);
  if (!miles || !speed) return null;
  const drivingHours = miles / speed;
  const breakMinutes = transport === 'Car' ? Math.max(0, Math.floor(drivingHours / DRIVE_HOURS_PER_BREAK)) * BREAK_MINUTES : 0;
  const totalMinutes = Math.round(drivingHours * 60) + breakMinutes;
  const tz = parseInt($('dest-tz').value, 10) || 0;
  const [th, tm] = $('target-arrival').value.split(':').map(Number);
  let depMins = (th * 60 + tm) - totalMinutes - tz * 60;
  let dayBefore = false;
  while (depMins < 0) { depMins += 1440; dayBefore = true; }
  return { minutes: depMins % 1440, dayBefore };
}

/* ============================================================
   FORMATTERS
   ============================================================ */

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}
function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}
function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function formatDisplayTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  return minutesToTimeStr(h * 60 + m);
}
function formatMoney(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ============================================================
   IMPROVEMENT 5: TRIP HERO CARD
   ============================================================ */

function renderHero(arrivalStr) {
  $('hero-emoji').textContent = destEmoji(state.destination);
  $('hero-dest').textContent  = state.destination;
  const parts = [];
  if (state.date) parts.push(formatDisplayDate(state.date));
  parts.push(TRANSPORT_LABELS[state.transport]);
  $('hero-meta').textContent  = parts.join(' · ');
  $('hero-arrival').textContent = arrivalStr;
}

/* ============================================================
   RENDER SUMMARY
   ============================================================ */

function renderSummary() {
  const { totalMinutes, breakMinutes, drivingHours } = calcTravelTime();
  const arrival = calcArrival(totalMinutes);
  const cost    = calcCost();

  let arrivalStr = minutesToTimeStr(arrival.minutes);
  if (arrival.dayOffset > 0) arrivalStr += ` (+${arrival.dayOffset}d)`;
  if (state.tzOffset !== 0)  arrivalStr += ` (${state.tzOffset > 0 ? '+' : ''}${state.tzOffset}h TZ)`;

  // Improvement 5: hero card
  renderHero(arrivalStr);

  // Detail rows
  $('s-date').textContent          = formatDisplayDate(state.date);
  $('s-departure-time').textContent = formatDisplayTime(state.departureTime);
  $('s-transport').textContent     = TRANSPORT_LABELS[state.transport];
  $('s-distance').textContent      = `${Number(state.miles).toLocaleString()} miles${state.roundTrip ? ' one way' : ''}`;
  $('s-travel-time').textContent   = formatDuration(Math.round(drivingHours * 60));

  const returnRow = $('s-return-row');
  if (state.roundTrip && state.returnDate) {
    returnRow.hidden = false;
    $('s-return').textContent = formatDisplayDate(state.returnDate);
  } else { returnRow.hidden = true; }

  const breaksRow = $('s-breaks-row');
  if (breakMinutes > 0) {
    breaksRow.hidden = false;
    $('s-breaks').textContent = `${formatDuration(totalMinutes)} (includes ${breakMinutes}m stops)`;
  } else { breaksRow.hidden = true; }

  let costStr = formatMoney(cost);
  if (state.roundTrip) costStr = `${formatMoney(cost * 2)} round trip`;
  if (state.transport !== 'Car') costStr += ' (est. fare)';
  $('s-cost').textContent = costStr;
}

/* ============================================================
   IMPROVEMENT 4: VISUAL CATEGORY TILES
   ============================================================ */

function setupCategoryTiles() {
  document.querySelectorAll('.category-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.querySelectorAll('.category-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
      activeCategory = tile.dataset.category;
      activeFilter   = 'all';
      searchTerm     = '';
      $('activity-search').value = '';
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      activityControls.hidden = false;
      renderActivities();
      // Smooth scroll to the activity list
      activityControls.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

/* ============================================================
   ACTIVITIES
   ============================================================ */

function getFilteredActivities() {
  let items = currentActivities[activeCategory] || [];
  if (activeFilter !== 'all') items = items.filter(i => i.price === activeFilter);
  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(t) || i.description.toLowerCase().includes(t));
  }
  return items;
}

function activityId(category, name) { return `${category}::${name}`; }

function renderActivities() {
  while (activityList.firstChild) activityList.removeChild(activityList.firstChild);

  if (!activeCategory) return;

  const items = getFilteredActivities();
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'activity-hint';
    p.style.textAlign = 'center';
    p.style.padding = '16px 0';
    p.textContent = 'No matching activities. Try a different filter.';
    activityList.appendChild(p);
    return;
  }

  items.forEach((item, index) => {
    const id = activityId(activeCategory, item.name);
    const inItinerary = state.itinerary.some(x => x.id === id);

    const card = document.createElement('article');
    card.className = 'activity-card';
    card.style.animationDelay = `${index * 50}ms`;

    const top  = document.createElement('div');
    top.className = 'activity-card-top';
    const name = document.createElement('h4');
    name.className = 'activity-card-name';
    name.textContent = item.name;
    const star = document.createElement('button');
    star.className = 'star-btn' + (inItinerary ? ' starred' : '');
    star.textContent = inItinerary ? '⭐' : '☆';
    star.setAttribute('aria-label', 'Toggle favorite');
    star.addEventListener('click', () => toggleItinerary(item, activeCategory));
    top.append(name, star);

    const meta = document.createElement('div');
    meta.className = 'activity-meta';
    meta.append(
      makePill(item.price, 'meta-pill meta-price'),
      makePill(`★ ${item.rating}`, 'meta-pill meta-rating'),
      makePill(`🕒 ${item.hours}`, 'meta-pill'),
      makePill(`📍 ${item.distance} mi`, 'meta-pill'),
    );

    const desc = document.createElement('p');
    desc.className = 'activity-card-desc';
    desc.textContent = item.description;

    const tip = document.createElement('div');
    tip.className = 'pro-tip';
    const tipLabel = document.createElement('span');
    tipLabel.className = 'pro-tip-label';
    tipLabel.textContent = '💡 Pro tip:';
    tip.append(tipLabel, document.createTextNode(' ' + item.tip));

    const addBtn = document.createElement('button');
    addBtn.className = 'add-itinerary-btn' + (inItinerary ? ' added' : '');
    addBtn.textContent = inItinerary ? '✓ Added to Itinerary' : '+ Add to Itinerary';
    addBtn.addEventListener('click', () => toggleItinerary(item, activeCategory));

    card.append(top, meta, desc, tip, addBtn);
    activityList.appendChild(card);
  });
}

function makePill(text, className) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/* ============================================================
   ITINERARY
   ============================================================ */

function toggleItinerary(item, category) {
  const id = activityId(category, item.name);
  const idx = state.itinerary.findIndex(x => x.id === id);
  if (idx >= 0) state.itinerary.splice(idx, 1);
  else state.itinerary.push({ id, name: item.name, category });
  renderActivities();
  renderItinerary();
  saveSession();
}

function renderItinerary() {
  const list  = $('itinerary-list');
  const empty = $('itinerary-empty');
  const count = $('itinerary-count');
  while (list.firstChild) list.removeChild(list.firstChild);

  count.textContent = `${state.itinerary.length} saved`;
  empty.hidden = state.itinerary.length > 0;

  const catEmoji = { restaurants: '🍔', parks: '🌲', museums: '🏛️', hotels: '🏨' };

  state.itinerary.forEach(entry => {
    const item   = document.createElement('div');
    item.className = 'itinerary-item';

    const info = document.createElement('div');
    info.className = 'itinerary-item-info';

    const nm = document.createElement('div');
    nm.className = 'itinerary-item-name';
    nm.textContent = `${catEmoji[entry.category] || '📌'} ${entry.name}`;

    const cat = document.createElement('div');
    cat.className = 'itinerary-item-cat';
    cat.textContent = entry.category.charAt(0).toUpperCase() + entry.category.slice(1);
    info.append(nm, cat);

    const remove = document.createElement('button');
    remove.className = 'itinerary-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.addEventListener('click', () => {
      state.itinerary = state.itinerary.filter(x => x.id !== entry.id);
      renderActivities();
      renderItinerary();
      saveSession();
    });

    item.append(info, remove);
    list.appendChild(item);
  });
}

/* ============================================================
   PERSISTENCE
   ============================================================ */

function saveSession() {
  try { localStorage.setItem('tripPlanner.session', JSON.stringify(state)); } catch (e) {}
}
function loadSession() {
  try { const r = localStorage.getItem('tripPlanner.session'); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function getSavedTrips() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
}
function saveTrip() {
  const trips = getSavedTrips();
  trips.unshift({ ...state, savedAt: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips.slice(0, 8)));
  renderRecentTrips();
  flashFeedback('Trip saved ✓');
}

function renderRecentTrips() {
  const trips   = getSavedTrips();
  const section = $('recent-trips');
  const list    = $('recent-trips-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  if (!trips.length || currentStep !== 1) { section.hidden = true; return; }
  section.hidden = false;

  trips.forEach((trip, i) => {
    const item = document.createElement('div');
    item.className = 'recent-trip-item';
    const info = document.createElement('div');
    const nm   = document.createElement('div');
    nm.className = 'recent-trip-name';
    nm.textContent = trip.destination || 'Untitled trip';
    const meta = document.createElement('div');
    meta.className = 'recent-trip-meta';
    meta.textContent = `${(trip.miles || '?').toLocaleString()} mi · ${trip.transport} · ${formatDisplayDate(trip.date)}`;
    info.append(nm, meta);
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => loadTrip(trip));

    const del = document.createElement('button');
    del.className = 'recent-trip-del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Delete saved trip');
    del.addEventListener('click', e => {
      e.stopPropagation();
      const remaining = getSavedTrips().filter((_, idx) => idx !== i);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
      renderRecentTrips();
    });
    item.append(info, del);
    list.appendChild(item);
  });
}

function loadTrip(trip) {
  state = { ...defaultState(), ...trip };
  hydrateForm();
  goToStep(3);
  flashFeedback(`Loaded "${trip.destination}"`);
}

/* ============================================================
   SHARE LINK
   ============================================================ */

function buildShareLink() {
  const p = new URLSearchParams();
  p.set('o', state.origin); p.set('d', state.destination); p.set('m', state.miles || '');
  p.set('dt', state.date); p.set('rt', state.roundTrip ? '1' : '0'); p.set('rd', state.returnDate);
  p.set('tz', state.tzOffset); p.set('tr', state.transport); p.set('sp', state.speed);
  p.set('mpg', state.mpg); p.set('gp', state.gasPrice); p.set('tm', state.departureTime);
  if (state.itinerary.length) p.set('it', state.itinerary.map(x => x.id).join('|'));
  return `${location.origin}${location.pathname}?${p}`;
}

function loadFromURL() {
  const p = new URLSearchParams(location.search);
  if (!p.has('d') && !p.has('m')) return false;
  state.origin        = p.get('o') || '';
  state.destination   = p.get('d') || '';
  state.miles         = parseFloat(p.get('m')) || null;
  state.date          = p.get('dt') || '';
  state.roundTrip     = p.get('rt') === '1';
  state.returnDate    = p.get('rd') || '';
  state.tzOffset      = parseInt(p.get('tz'), 10) || 0;
  state.transport     = p.get('tr') || 'Car';
  state.speed         = parseFloat(p.get('sp')) || SPEED_DEFAULTS[state.transport];
  state.mpg           = parseFloat(p.get('mpg')) || 28;
  state.gasPrice      = parseFloat(p.get('gp')) || 3.50;
  state.departureTime = p.get('tm') || '';
  if (p.get('it')) {
    state.itinerary = p.get('it').split('|').filter(Boolean).map(id => {
      const [category, name] = id.split('::');
      return { id, name, category };
    });
  }
  return true;
}

async function shareLink() {
  const url = buildShareLink();
  try {
    if (navigator.share) { await navigator.share({ title: 'My Trip Plan', url }); flashFeedback('Shared ✓'); }
    else { await navigator.clipboard.writeText(url); flashFeedback('Link copied to clipboard ✓'); }
  } catch { window.prompt('Copy your trip link:', url); }
}

/* ============================================================
   CALENDAR .ICS
   ============================================================ */

function pad(n) { return String(n).padStart(2, '0'); }

function downloadICS() {
  const { totalMinutes } = calcTravelTime();
  const [h, m] = state.departureTime.split(':').map(Number);
  const start = new Date(state.date + 'T00:00:00');
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + totalMinutes * 60000);
  const fmt = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const esc = s => String(s).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  let desc = `Travel to ${state.destination} by ${state.transport}. Distance: ${state.miles} miles.`;
  if (state.itinerary.length) desc += ` Planned: ${state.itinerary.map(x => x.name).join(', ')}.`;
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TripPlanner//EN','BEGIN:VEVENT',
    `UID:${Date.now()}@tripplanner`,`DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,`DTEND:${fmt(end)}`,
    `SUMMARY:Trip to ${esc(state.destination)}`,`DESCRIPTION:${esc(desc)}`,
    `LOCATION:${esc(state.destination)}`,'END:VEVENT','END:VCALENDAR',
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })),
    download: `trip-${(state.destination || 'plan').replace(/\s+/g,'-').toLowerCase()}.ics`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  flashFeedback('Calendar file downloaded ✓');
}

/* ============================================================
   WORD EXPORT
   ============================================================ */

function downloadWord() {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const { totalMinutes, breakMinutes, drivingHours } = calcTravelTime();
  const arrival = calcArrival(totalMinutes);
  const cost    = calcCost();
  let arrStr = minutesToTimeStr(arrival.minutes);
  if (arrival.dayOffset) arrStr += ` (+${arrival.dayOffset}d)`;
  let costStr = formatMoney(cost);
  if (state.roundTrip) costStr = `${formatMoney(cost*2)} round trip`;
  if (state.transport !== 'Car') costStr += ' (fare est.)';
  const rows = [
    ['Destination', state.destination],
    ['From', state.origin || '—'],
    ['Date', formatDisplayDate(state.date)],
    ...(state.roundTrip && state.returnDate ? [['Return', formatDisplayDate(state.returnDate)]] : []),
    ['Departure', formatDisplayTime(state.departureTime)],
    ['Transport', state.transport],
    ['Distance', `${Number(state.miles).toLocaleString()} miles`],
    ['Travel Time', formatDuration(Math.round(drivingHours * 60))],
    ...(breakMinutes > 0 ? [['With Stops', formatDuration(totalMinutes)]] : []),
    ['Est. Cost', costStr],
    ['Est. Arrival', arrStr],
  ].map(([l,v]) => `<tr><td class="lbl">${esc(l)}</td><td class="val">${esc(v)}</td></tr>`).join('');

  const catLabels = { restaurants:'Restaurants', parks:'Parks & Nature', museums:'Museums & Sights', hotels:'Hotels & Stays' };
  let itin = '<h2>Planned Itinerary</h2>';
  if (state.itinerary.length) {
    const grouped = {};
    state.itinerary.forEach(x => { (grouped[x.category] = grouped[x.category]||[]).push(x.name); });
    itin += Object.keys(grouped).map(cat =>
      `<p class="cat">${esc(catLabels[cat]||cat)}</p><ul>${grouped[cat].map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`
    ).join('');
  } else { itin += '<p class="muted">No activities added.</p>'; }

  const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Trip – ${esc(state.destination)}</title>
<style>@page{size:A4;margin:1.6cm}body{font-family:Calibri,Arial,sans-serif;color:#1a1a1a;font-size:11pt;line-height:1.35}h1{font-size:20pt;color:#2563eb;margin:0 0 2pt}p.tag{color:#6b7280;font-size:9pt;margin:0 0 14pt}h2{font-size:12pt;border-bottom:1.5pt solid #3b82f6;padding-bottom:2pt;margin:14pt 0 6pt}table{width:100%;border-collapse:collapse}td{padding:3.5pt 4pt;border-bottom:.5pt solid #e5e7eb}td.lbl{color:#6b7280;font-size:9.5pt;width:38%}td.val{font-weight:700;font-size:10.5pt}.cat{font-weight:700;color:#2563eb;font-size:10pt;margin:6pt 0 2pt}ul{margin:0 0 4pt;padding-left:16pt}li{font-size:10pt;margin:1pt 0}.muted{color:#6b7280;font-size:10pt}.foot{margin-top:16pt;color:#9ca3af;font-size:8pt;border-top:.5pt solid #e5e7eb;padding-top:4pt}</style>
</head><body>
<h1>🗺️ ${esc(state.destination)} Trip Plan</h1>
<p class="tag">The Trip Planner · ${esc(formatDisplayDate(state.date))}</p>
<h2>Trip Details</h2><table>${rows}</table>${itin}
<p class="foot">Times and costs are estimates based on your inputs.</p>
</body></html>`;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['﻿', doc], { type: 'application/msword' })),
    download: `trip-${(state.destination||'plan').replace(/\s+/g,'-').toLowerCase()}.doc`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  flashFeedback('Word document downloaded ✓');
}

/* ============================================================
   FEEDBACK
   ============================================================ */

let feedbackTimer = null;
function flashFeedback(msg) {
  const el = $('action-feedback');
  el.textContent = msg;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { el.textContent = ''; }, 3000);
}

/* ============================================================
   HYDRATE FORM FROM STATE
   ============================================================ */

function hydrateForm() {
  $('origin').value        = state.origin || '';
  $('destination').value   = state.destination || '';
  if (state.destination) {
    currentActivities = getActivitiesForDestination(state.destination);
    const nameEl = $('activity-dest-name');
    if (nameEl) nameEl.textContent = state.destination.split(',')[0];
  }
  $('miles').value         = state.miles ?? '';
  $('departure-date').value = state.date || '';
  $('round-trip-toggle').checked = !!state.roundTrip;
  $('return-date-group').hidden  = !state.roundTrip;
  $('return-date').value   = state.returnDate || '';
  $('dest-tz').value       = String(state.tzOffset || 0);
  document.querySelectorAll('[name=transport]').forEach(r => r.checked = r.value === state.transport);
  $('speed').value    = state.speed ?? 65;
  $('mpg').value      = state.mpg ?? 28;
  $('gas-price').value = state.gasPrice ?? 3.50;
  $('departure-time').value = state.departureTime || '';
  speedGroup.hidden        = state.transport !== 'Car';
  carCostInputs.style.display = state.transport === 'Car' ? 'flex' : 'none';
  refreshValidIndicators();
  // Show advanced badge if customized
  updateAdvancedBadge();
}

function refreshValidIndicators() {
  markValid('destination',    $('destination').value.trim() !== '');
  markValid('miles',          parseFloat($('miles').value) > 0);
  markValid('departure-date', $('departure-date').value !== '');
  markValid('departure-time', $('departure-time').value !== '');
}

function updateAdvancedBadge() {
  const badge = $('advanced-badge');
  if (!badge) return;
  const isCustom = parseFloat($('speed').value) !== 65 ||
                   parseFloat($('mpg').value)   !== 28 ||
                   parseFloat($('gas-price').value) !== 3.50;
  badge.hidden = !isCustom;
}

/* ============================================================
   RESET
   ============================================================ */

function resetApp() {
  state = defaultState();
  activeCategory = null; activeFilter = 'all'; searchTerm = '';
  hydrateForm();
  while (activityList.firstChild) activityList.removeChild(activityList.firstChild);
  document.querySelectorAll('.category-tile').forEach(b => b.classList.remove('active'));
  $('activity-search').value = '';
  activityControls.hidden = true;
  document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
  renderItinerary();
  saveSession();
  history.replaceState(null, '', location.pathname);

  const step3 = $('step-3');
  step3.classList.remove('step-panel--active');
  step3.style.display = 'none';
  const step1 = $('step-1');
  step1.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => step1.classList.add('step-panel--active')));

  updateStepIndicator(1);
  updateProgress(1);
  currentStep = 1;
  btnBack.hidden = true;
  btnNext.textContent = 'Next →';
  btnNext.classList.add('btn--primary');
  btnNext.classList.remove('btn--danger');
  updateNextButtonState();
  renderRecentTrips();
}

/* ============================================================
   RECOMMENDATION HINT
   ============================================================ */

function updateRecommendation() {
  const hint = $('recommend-hint');
  const rec  = calcRecommendedDeparture();
  hint.textContent = rec
    ? `💡 Leave by ${minutesToTimeStr(rec.minutes)}${rec.dayBefore ? ' the day before' : ''} to arrive on time.`
    : '';
}

/* ============================================================
   INIT
   ============================================================ */

function init() {
  initTheme();
  setupOriginAutocomplete();
  setupDestinationAutocomplete();
  setupCategoryTiles();

  const fromURL = loadFromURL();
  if (fromURL) { hydrateForm(); setTimeout(() => goToStep(3), 50); }
  else {
    const session = loadSession();
    if (session) { state = { ...defaultState(), ...session }; hydrateForm(); }
  }
  renderRecentTrips();
  renderItinerary();
  updateNextButtonState();
  updateProgress(1);

  $('theme-toggle').addEventListener('click', toggleTheme);

  btnNext.addEventListener('click', () => {
    if (currentStep === 3) { openConfirmModal(); return; }
    collectStep(currentStep);
    if (!validateStep(currentStep)) return;
    saveSession();
    goToStep(currentStep + 1);
  });
  btnBack.addEventListener('click', () => { if (currentStep > 1) goToStep(currentStep - 1); });

  $('round-trip-toggle').addEventListener('change', e => {
    $('return-date-group').hidden = !e.target.checked;
    updateNextButtonState();
  });
  $('target-arrival-toggle').addEventListener('change', e => {
    $('target-arrival-group').hidden = !e.target.checked;
    if (!e.target.checked) $('recommend-hint').textContent = '';
  });
  $('target-arrival').addEventListener('input', updateRecommendation);

  document.querySelectorAll('[name=transport]').forEach(radio => {
    radio.addEventListener('change', e => {
      const isCar = e.target.value === 'Car';
      speedGroup.hidden        = !isCar;
      carCostInputs.style.display = isCar ? 'flex' : 'none';
      $('speed').value = SPEED_DEFAULTS[e.target.value];
      state.transport  = e.target.value;
      state.speed      = SPEED_DEFAULTS[e.target.value];
      renderTransportContext();
      updateRecommendation();
      updateNextButtonState();
    });
  });

  $('activity-search').addEventListener('input', e => { searchTerm = e.target.value; renderActivities(); });
  document.querySelectorAll('.filter-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      activeFilter = tag.dataset.filter;
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t === tag));
      renderActivities();
    });
  });

  $('btn-save').addEventListener('click', saveTrip);
  $('btn-share').addEventListener('click', shareLink);
  $('btn-ics').addEventListener('click', downloadICS);
  $('btn-word').addEventListener('click', downloadWord);
  $('btn-print').addEventListener('click', () => window.print());

  document.querySelectorAll('.summary-row.editable').forEach(row => {
    const jump = () => goToStep(parseInt(row.dataset.editStep, 10));
    row.addEventListener('click', jump);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
  });

  const fieldMap = [
    ['destination','err-destination'],['miles','err-miles'],['departure-date','err-date'],
    ['return-date','err-return-date'],['speed','err-speed'],['departure-time','err-time'],
  ];
  fieldMap.forEach(([id, errId]) => {
    const el = $(id); if (!el) return;
    const h = () => { clearError(id, errId); refreshValidIndicators(); updateNextButtonState(); updateAdvancedBadge(); };
    el.addEventListener('input', h);
    el.addEventListener('change', h);
  });

  $('confirm-cancel').addEventListener('click', closeConfirmModal);
  $('confirm-ok').addEventListener('click', () => { closeConfirmModal(); resetApp(); });
  $('confirm-modal').addEventListener('click', e => { if (e.target === $('confirm-modal')) closeConfirmModal(); });
  $('clear-recent').addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); renderRecentTrips(); });

  document.addEventListener('keydown', e => {
    const inField = ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName);
    if (e.key === 'Enter' && !inField && currentStep < 3 && !btnNext.disabled) btnNext.click();
    if (!$('confirm-modal').hidden && e.key === 'Escape') closeConfirmModal();
    if (currentStep === 2 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inField) {
      const radios = [...document.querySelectorAll('[name=transport]')];
      const idx = radios.findIndex(r => r.checked);
      const next = e.key === 'ArrowRight' ? (idx+1) % radios.length : (idx-1+radios.length) % radios.length;
      radios[next].checked = true;
      radios[next].dispatchEvent(new Event('change'));
    }
  });
}

function openConfirmModal()  { $('confirm-modal').hidden = false; $('confirm-cancel').focus(); }
function closeConfirmModal() { $('confirm-modal').hidden = true; }

document.addEventListener('DOMContentLoaded', init);
