'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */

const SPEED_DEFAULTS = { Car: 65, Plane: 500, Train: 80 };
const TRANSPORT_LABELS = { Car: '🚗 Car', Plane: '✈️ Plane', Train: '🚆 Train' };

// Per-transport flat fare estimate ($ per mile) for non-car modes
const FARE_PER_MILE = { Plane: 0.18, Train: 0.22 };

// Rest stop: minutes of break added per this many hours of continuous driving
const DRIVE_HOURS_PER_BREAK = 2.5;
const BREAK_MINUTES = 20;

const STORAGE_KEY = 'tripPlanner.v2';

const ACTIVITIES = {
  restaurants: [
    { name: "The Trail's Edge Grill", price: "$$", rating: 4.6, hours: "11am–10pm", distance: 2.1, description: "Farm-to-table burgers and wood-fired entrees with a sweeping patio view of the valley below.", tip: "Ask the server for the off-menu jalapeño aioli — it pairs perfectly with the elk burger." },
    { name: "Mesa Verde Cantina", price: "$", rating: 4.4, hours: "10am–9pm", distance: 0.8, description: "Authentic Southwestern fare with fresh hand-pressed tortillas made daily and a killer salsa bar.", tip: "Arrive before 6 PM on weekends to avoid a 45-minute wait — no reservations taken." },
    { name: "Summit Smokehouse", price: "$$$", rating: 4.8, hours: "12pm–11pm", distance: 3.5, description: "Low-and-slow BBQ brisket, pulled pork, and craft beers on tap in a rustic lodge atmosphere.", tip: "The half-rack combo platter saves roughly 20% compared to ordering proteins separately." },
    { name: "The Sunrise Diner", price: "$", rating: 4.2, hours: "6am–3pm", distance: 1.2, description: "Beloved local breakfast spot serving classic American plates and strong coffee all day long.", tip: "Cash only — there's an ATM at the front door, but bring small bills to speed up service." },
  ],
  parks: [
    { name: "Ridgeline Overlook Trail", price: "$", rating: 4.9, hours: "Dawn–Dusk", distance: 5.4, description: "A 4.2-mile out-and-back hike through pine forest with a breathtaking 180° panoramic viewpoint at the summit.", tip: "Start before 8 AM in summer to beat the crowds and snag the best photos." },
    { name: "Clearwater Falls State Park", price: "$", rating: 4.7, hours: "8am–8pm", distance: 8.0, description: "Two accessible waterfall loops plus a serene picnic area along a glacier-fed river with emerald pools.", tip: "The upper falls viewpoint (0.3 mi from lot B) is almost always empty and often more scenic." },
    { name: "Valley Botanical Gardens", price: "$$", rating: 4.5, hours: "9am–5pm", distance: 1.9, description: "18 acres of curated native plant collections, a butterfly garden, and shaded walking paths.", tip: "Tuesdays are free admission. The rose garden peaks mid-June." },
    { name: "Sunstone Canyon Reserve", price: "$$", rating: 4.8, hours: "7am–6pm", distance: 12.3, description: "A protected desert canyon with guided geology walks, ancient petroglyphs, and stunning orange cliffs.", tip: "Book a ranger-led petroglyph tour at least 48 hours ahead — spots fill fast." },
  ],
  museums: [
    { name: "Regional History Museum", price: "$$", rating: 4.3, hours: "10am–5pm", distance: 0.6, description: "Three floors covering 10,000 years of local history, from Indigenous cultures through the industrial era.", tip: "The basement archive room has a rotating display of rare maps not listed on the main floor." },
    { name: "Center for Contemporary Art", price: "$$", rating: 4.4, hours: "11am–7pm", distance: 1.1, description: "A dynamic gallery space hosting rotating exhibitions from emerging and established artists.", tip: "First Friday of each month is free entry with live artist talks from 6–9 PM." },
    { name: "Science & Discovery Center", price: "$$$", rating: 4.7, hours: "9am–6pm", distance: 2.8, description: "Hands-on exhibits spanning space, geology, and biology with a working planetarium.", tip: "The 'Deep Space' planetarium show at 2 PM is the most detailed and only runs once daily." },
    { name: "Heritage Railway Museum", price: "$", rating: 4.6, hours: "10am–4pm", distance: 4.2, description: "Restored steam locomotives, a working signal tower, and immersive exhibits on rail travel.", tip: "On the last Sunday of each month, you can ride a restored 1940s steam engine." },
  ],
  hotels: [
    { name: "The Ridgecrest Inn", price: "$$$", rating: 4.7, hours: "24/7", distance: 1.5, description: "A boutique 28-room inn at 4,200 ft with private balconies, a rooftop terrace, and full hot breakfast.", tip: "Request a 'forest-view' room when booking — same price but faces away from the parking structure." },
    { name: "Clearwater Lodge & Cabins", price: "$$", rating: 4.6, hours: "24/7", distance: 7.2, description: "Secluded riverside log cabins with fire pits, kayak rentals, and a morning breakfast basket.", tip: "Cabin 7 and 8 are closest to the river with the best sound of running water." },
    { name: "Downtown Suites Hotel", price: "$$", rating: 4.3, hours: "24/7", distance: 0.4, description: "Modern all-suite property in the heart of the main street district, steps from dining and galleries.", tip: "The rooftop lounge is open to all guests until 11 PM — grab a spot before sunset." },
    { name: "Juniper Valley Ranch Stay", price: "$$$", rating: 4.9, hours: "24/7", distance: 14.0, description: "A working cattle ranch offering 6 guesthouses, horseback riding, stargazing, and farm-fresh dinners.", tip: "The Thursday evening chuck wagon dinner is worth every cent and books out weeks ahead." },
  ],
};

/* ============================================================
   STATE
   ============================================================ */

const defaultState = () => ({
  destination: '', miles: null, date: '', roundTrip: false, returnDate: '',
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
const stepPanels  = [1, 2, 3].map(n => $(`step-${n}`));
const stepNodes   = document.querySelectorAll('.step-node');
const connector12 = $('connector-1-2');
const connector23 = $('connector-2-3');
const btnNext     = $('btn-next');
const btnBack     = $('btn-back');
const speedGroup  = $('speed-group');
const carCostInputs = $('car-cost-inputs');
const activityList = $('activity-list');
const activityEmpty = $('activity-empty');
const activityControls = $('activity-controls');

/* ============================================================
   THEME (Feature 19)
   ============================================================ */

function initTheme() {
  const saved = localStorage.getItem('tripPlanner.theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('tripPlanner.theme', next);
}

/* ============================================================
   STEP NAVIGATION
   ============================================================ */

function transitionPanel(outEl, inEl) {
  if (outEl === inEl) return;
  outEl.classList.remove('step-panel--active');
  outEl.addEventListener('transitionend', () => { outEl.style.display = 'none'; }, { once: true });
  // Fallback in case transitionend doesn't fire (reduced motion)
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
  currentStep = n;
  btnBack.hidden = n === 1;

  if (n === 3) {
    btnNext.textContent = 'Start Over';
    btnNext.classList.remove('btn--primary');
    btnNext.classList.add('btn--danger');
    renderSummary();
    renderItinerary();
  } else {
    btnNext.textContent = 'Next →';
    btnNext.classList.add('btn--primary');
    btnNext.classList.remove('btn--danger');
  }
  updateNextButtonState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   VALIDATION (Features 15, 16, 17)
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
  if (input && input.parentElement.classList.contains('input-wrap')) {
    input.parentElement.classList.toggle('valid', isValid);
  }
}

function isStepComplete(n) {
  if (n === 1) {
    const destOk = $('destination').value.trim() !== '';
    const milesOk = parseFloat($('miles').value) > 0;
    const dateOk = $('departure-date').value !== '';
    const returnOk = !$('round-trip-toggle').checked || $('return-date').value !== '';
    return destOk && milesOk && dateOk && returnOk;
  }
  if (n === 2) {
    const speedOk = $('speed').value === '' || parseFloat($('speed').value) > 0;
    const carSpeedOk = getCheckedTransport() !== 'Car' || parseFloat($('speed').value) > 0;
    const timeOk = $('departure-time').value !== '';
    return carSpeedOk && speedOk && timeOk;
  }
  return true;
}

function updateNextButtonState() {
  if (currentStep === 3) { btnNext.disabled = false; return; }
  btnNext.disabled = !isStepComplete(currentStep);
}

function validateStep(n) {
  let valid = true;
  if (n === 1) {
    if (!state.destination.trim()) { setError('destination', 'err-destination', 'Please enter a destination.'); valid = false; }
    else clearError('destination', 'err-destination');
    if (!state.miles || state.miles <= 0) { setError('miles', 'err-miles', 'Please enter a valid distance.'); valid = false; }
    else clearError('miles', 'err-miles');
    if (!state.date) { setError('departure-date', 'err-date', 'Please select a departure date.'); valid = false; }
    else clearError('departure-date', 'err-date');
    if (state.roundTrip && !state.returnDate) { setError('return-date', 'err-return-date', 'Please select a return date.'); valid = false; }
    else clearError('return-date', 'err-return-date');
  }
  if (n === 2) {
    if (state.transport === 'Car' && (!state.speed || state.speed <= 0)) { setError('speed', 'err-speed', 'Please enter a valid average speed.'); valid = false; }
    else clearError('speed', 'err-speed');
    if (!state.departureTime) { setError('departure-time', 'err-time', 'Please enter a departure time.'); valid = false; }
    else clearError('departure-time', 'err-time');
  }
  return valid;
}

/* ============================================================
   STATE COLLECTION
   ============================================================ */

function getCheckedTransport() {
  const checked = document.querySelector('[name=transport]:checked');
  return checked ? checked.value : 'Car';
}

function collectStep(n) {
  if (n === 1) {
    state.destination = $('destination').value;
    state.miles = parseFloat($('miles').value) || null;
    state.date = $('departure-date').value;
    state.roundTrip = $('round-trip-toggle').checked;
    state.returnDate = $('return-date').value;
    state.tzOffset = parseInt($('dest-tz').value, 10) || 0;
  }
  if (n === 2) {
    state.transport = getCheckedTransport();
    state.speed = parseFloat($('speed').value) || SPEED_DEFAULTS[state.transport];
    state.mpg = parseFloat($('mpg').value) || 28;
    state.gasPrice = parseFloat($('gas-price').value) || 0;
    state.departureTime = $('departure-time').value;
    state.targetArrival = $('target-arrival').value;
  }
}

/* ============================================================
   CALCULATIONS (Features 1, 3, 4, 5)
   ============================================================ */

function calcTravelTime() {
  const speed = state.transport === 'Car' ? state.speed : SPEED_DEFAULTS[state.transport];
  const drivingHours = state.miles / speed;

  // Feature 1: rest stops only for car trips
  let breakMinutes = 0;
  if (state.transport === 'Car') {
    const numBreaks = Math.max(0, Math.floor(drivingHours / DRIVE_HOURS_PER_BREAK));
    breakMinutes = numBreaks * BREAK_MINUTES;
  }

  const baseHours = Math.floor(drivingHours);
  const baseMinutes = Math.round((drivingHours - baseHours) * 60);

  const totalMinutes = Math.round(drivingHours * 60) + breakMinutes;
  return { baseHours, baseMinutes, drivingHours, breakMinutes, totalMinutes };
}

// Feature 3: cost estimate
function calcCost() {
  if (state.transport === 'Car') {
    const gallons = state.miles / (state.mpg || 28);
    return gallons * (state.gasPrice || 0);
  }
  const oneWay = state.miles * (FARE_PER_MILE[state.transport] || 0);
  return oneWay;
}

// Feature 4 + arrival: add travel time, then apply destination tz offset
function calcArrival(totalMinutes) {
  const [h, m] = state.departureTime.split(':').map(Number);
  const depMinutes = h * 60 + m;
  let arrivalMins = depMinutes + totalMinutes + state.tzOffset * 60;
  let dayOffset = 0;
  while (arrivalMins >= 1440) { arrivalMins -= 1440; dayOffset++; }
  while (arrivalMins < 0) { arrivalMins += 1440; dayOffset--; }
  return { minutes: arrivalMins, dayOffset };
}

// Feature 5: recommend a departure time to hit a target arrival
function calcRecommendedDeparture() {
  if (!$('target-arrival').value) return null;
  const transport = getCheckedTransport();
  const speed = transport === 'Car' ? (parseFloat($('speed').value) || SPEED_DEFAULTS.Car) : SPEED_DEFAULTS[transport];
  const miles = parseFloat($('miles').value);
  if (!miles || !speed) return null;

  const drivingHours = miles / speed;
  let breakMinutes = 0;
  if (transport === 'Car') breakMinutes = Math.max(0, Math.floor(drivingHours / DRIVE_HOURS_PER_BREAK)) * BREAK_MINUTES;
  const totalMinutes = Math.round(drivingHours * 60) + breakMinutes;

  const tz = parseInt($('dest-tz').value, 10) || 0;
  const [th, tm] = $('target-arrival').value.split(':').map(Number);
  let depMins = (th * 60 + tm) - totalMinutes - tz * 60;
  let dayBefore = false;
  while (depMins < 0) { depMins += 1440; dayBefore = true; }
  depMins %= 1440;
  return { minutes: depMins, dayBefore };
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
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
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
   RENDER SUMMARY (Features 2, 3, 4)
   ============================================================ */

function renderSummary() {
  const { totalMinutes, breakMinutes, drivingHours } = calcTravelTime();
  const arrival = calcArrival(totalMinutes);
  const cost = calcCost();

  $('s-destination').textContent = state.destination;
  $('s-date').textContent = formatDisplayDate(state.date);
  $('s-departure-time').textContent = formatDisplayTime(state.departureTime);
  $('s-transport').textContent = TRANSPORT_LABELS[state.transport];
  $('s-distance').textContent = `${Number(state.miles).toLocaleString()} miles` + (state.roundTrip ? ' (one way)' : '');
  $('s-travel-time').textContent = formatDuration(Math.round(drivingHours * 60));

  // Feature 2: return date row
  const returnRow = $('s-return-row');
  if (state.roundTrip && state.returnDate) {
    returnRow.hidden = false;
    $('s-return').textContent = formatDisplayDate(state.returnDate);
  } else {
    returnRow.hidden = true;
  }

  // Feature 1: rest stops row
  const breaksRow = $('s-breaks-row');
  if (breakMinutes > 0) {
    breaksRow.hidden = false;
    $('s-breaks').textContent = `${formatDuration(totalMinutes)} (+${breakMinutes}m stops)`;
  } else {
    breaksRow.hidden = true;
  }

  // Feature 3: cost
  let costLabel = formatMoney(cost);
  if (state.roundTrip) costLabel = `${formatMoney(cost * 2)} round trip`;
  if (state.transport !== 'Car') costLabel += state.roundTrip ? '' : ' (fare est.)';
  $('s-cost').textContent = costLabel;

  // Arrival with day offset + tz note
  let arrivalStr = minutesToTimeStr(arrival.minutes);
  if (arrival.dayOffset > 0) arrivalStr += ` (+${arrival.dayOffset} day${arrival.dayOffset > 1 ? 's' : ''})`;
  if (state.tzOffset !== 0) arrivalStr += ` ${state.tzOffset > 0 ? '+' : ''}${state.tzOffset}h TZ`;
  $('s-arrival').textContent = arrivalStr;
}

/* ============================================================
   ACTIVITIES (Features 7, 8, 9, 10, 20)
   ============================================================ */

function getFilteredActivities() {
  let items = ACTIVITIES[activeCategory] || [];
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

  document.querySelectorAll('.category-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.category === activeCategory));

  if (!activeCategory) {
    activityControls.hidden = true;
    activityEmpty.hidden = false;
    return;
  }
  activityControls.hidden = false;
  activityEmpty.hidden = true;

  const items = getFilteredActivities();

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'activity-hint';
    p.style.textAlign = 'center';
    p.textContent = 'No matching activities. Try a different filter or search.';
    activityList.appendChild(p);
    return;
  }

  items.forEach((item, index) => {
    const id = activityId(activeCategory, item.name);
    const inItinerary = state.itinerary.some(x => x.id === id);

    const card = document.createElement('article');
    card.className = 'activity-card';
    card.style.animationDelay = `${index * 50}ms`;

    // Top row: name + star
    const top = document.createElement('div');
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

    // Meta pills (Feature 10)
    const meta = document.createElement('div');
    meta.className = 'activity-meta';
    meta.append(
      makePill(item.price, 'meta-pill meta-price'),
      makePill(`★ ${item.rating}`, 'meta-pill meta-rating'),
      makePill(`🕒 ${item.hours}`, 'meta-pill'),
      makePill(`📍 ${item.distance} mi`, 'meta-pill') // Feature 9
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

    // Feature 6: add to itinerary
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
   ITINERARY (Feature 6)
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
  const list = $('itinerary-list');
  const empty = $('itinerary-empty');
  const count = $('itinerary-count');
  while (list.firstChild) list.removeChild(list.firstChild);

  count.textContent = `${state.itinerary.length} saved`;
  empty.hidden = state.itinerary.length > 0;

  const catEmoji = { restaurants: '🍔', parks: '🌲', museums: '🏛️', hotels: '🏨' };

  state.itinerary.forEach(entry => {
    const item = document.createElement('div');
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
   PERSISTENCE (Features 11, 12)
   ============================================================ */

function saveSession() {
  try { localStorage.setItem('tripPlanner.session', JSON.stringify(state)); } catch (e) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem('tripPlanner.session');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

// Saved trips list (Feature 11)
function getSavedTrips() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
}

function saveTrip() {
  const trips = getSavedTrips();
  const snapshot = { ...state, savedAt: Date.now() };
  trips.unshift(snapshot);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips.slice(0, 8)));
  renderRecentTrips();
  flashFeedback('Trip saved ✓');
}

function renderRecentTrips() {
  const trips = getSavedTrips();
  const section = $('recent-trips');
  const list = $('recent-trips-list');
  while (list.firstChild) list.removeChild(list.firstChild);

  if (trips.length === 0) { section.hidden = true; return; }
  section.hidden = currentStep !== 1;

  trips.forEach((trip, i) => {
    const item = document.createElement('div');
    item.className = 'recent-trip-item';

    const info = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'recent-trip-name';
    nm.textContent = trip.destination || 'Untitled trip';
    const meta = document.createElement('div');
    meta.className = 'recent-trip-meta';
    meta.textContent = `${trip.miles || '?'} mi · ${trip.transport} · ${formatDisplayDate(trip.date)}`;
    info.append(nm, meta);
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => loadTrip(trip));

    const del = document.createElement('button');
    del.className = 'recent-trip-del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Delete saved trip');
    del.addEventListener('click', (e) => {
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
   SHARE LINK (Feature 12)
   ============================================================ */

function buildShareLink() {
  const params = new URLSearchParams();
  params.set('d', state.destination);
  params.set('m', state.miles || '');
  params.set('dt', state.date);
  params.set('rt', state.roundTrip ? '1' : '0');
  params.set('rd', state.returnDate);
  params.set('tz', state.tzOffset);
  params.set('tr', state.transport);
  params.set('sp', state.speed);
  params.set('mpg', state.mpg);
  params.set('gp', state.gasPrice);
  params.set('tm', state.departureTime);
  if (state.itinerary.length) params.set('it', state.itinerary.map(x => x.id).join('|'));
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

function loadFromURL() {
  const p = new URLSearchParams(location.search);
  if (!p.has('d') && !p.has('m')) return false;
  state.destination = p.get('d') || '';
  state.miles = parseFloat(p.get('m')) || null;
  state.date = p.get('dt') || '';
  state.roundTrip = p.get('rt') === '1';
  state.returnDate = p.get('rd') || '';
  state.tzOffset = parseInt(p.get('tz'), 10) || 0;
  state.transport = p.get('tr') || 'Car';
  state.speed = parseFloat(p.get('sp')) || SPEED_DEFAULTS[state.transport];
  state.mpg = parseFloat(p.get('mpg')) || 28;
  state.gasPrice = parseFloat(p.get('gp')) || 3.50;
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
    if (navigator.share) {
      await navigator.share({ title: 'My Trip Plan', url });
      flashFeedback('Shared ✓');
    } else {
      await navigator.clipboard.writeText(url);
      flashFeedback('Link copied to clipboard ✓');
    }
  } catch (e) {
    // Fallback: prompt
    window.prompt('Copy your trip link:', url);
  }
}

/* ============================================================
   CALENDAR .ICS (Feature 14)
   ============================================================ */

function pad(n) { return String(n).padStart(2, '0'); }

function buildICS() {
  const { totalMinutes } = calcTravelTime();
  const [h, m] = state.departureTime.split(':').map(Number);
  const start = new Date(state.date + 'T00:00:00');
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + totalMinutes * 60000);

  const fmt = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

  const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');

  let desc = `Travel to ${state.destination} by ${state.transport}. Distance: ${state.miles} miles.`;
  if (state.itinerary.length) desc += ` Planned: ${state.itinerary.map(x => x.name).join(', ')}.`;

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TripPlanner//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}@tripplanner`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Trip to ${esc(state.destination)}`,
    `DESCRIPTION:${esc(desc)}`,
    `LOCATION:${esc(state.destination)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function downloadICS() {
  const blob = new Blob([buildICS()], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trip-${state.destination.replace(/\s+/g, '-').toLowerCase() || 'plan'}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashFeedback('Calendar file downloaded ✓');
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
  $('destination').value = state.destination || '';
  $('miles').value = state.miles ?? '';
  $('departure-date').value = state.date || '';
  $('round-trip-toggle').checked = !!state.roundTrip;
  $('return-date-group').hidden = !state.roundTrip;
  $('return-date').value = state.returnDate || '';
  $('dest-tz').value = String(state.tzOffset || 0);
  document.querySelectorAll('[name=transport]').forEach(r => r.checked = r.value === state.transport);
  $('speed').value = state.speed ?? 65;
  $('mpg').value = state.mpg ?? 28;
  $('gas-price').value = state.gasPrice ?? 3.50;
  $('departure-time').value = state.departureTime || '';
  speedGroup.hidden = state.transport !== 'Car';
  carCostInputs.style.display = state.transport === 'Car' ? 'flex' : 'none';
  refreshValidIndicators();
}

function refreshValidIndicators() {
  markValid('destination', $('destination').value.trim() !== '');
  markValid('miles', parseFloat($('miles').value) > 0);
  markValid('departure-date', $('departure-date').value !== '');
  markValid('departure-time', $('departure-time').value !== '');
}

/* ============================================================
   RESET (Feature 17)
   ============================================================ */

function resetApp() {
  state = defaultState();
  activeCategory = null;
  activeFilter = 'all';
  searchTerm = '';
  hydrateForm();
  while (activityList.firstChild) activityList.removeChild(activityList.firstChild);
  document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
  $('activity-search').value = '';
  document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
  renderItinerary();
  saveSession();
  // Clear URL params
  history.replaceState(null, '', location.pathname);

  const step3 = $('step-3');
  step3.classList.remove('step-panel--active');
  step3.style.display = 'none';
  const step1 = $('step-1');
  step1.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => step1.classList.add('step-panel--active')));

  updateStepIndicator(1);
  currentStep = 1;
  btnBack.hidden = true;
  btnNext.textContent = 'Next →';
  btnNext.classList.add('btn--primary');
  btnNext.classList.remove('btn--danger');
  updateNextButtonState();
  renderRecentTrips();
}

/* ============================================================
   RECOMMENDATION HINT (Feature 5)
   ============================================================ */

function updateRecommendation() {
  const hint = $('recommend-hint');
  const rec = calcRecommendedDeparture();
  if (!rec) { hint.textContent = ''; return; }
  hint.textContent = `💡 Leave by ${minutesToTimeStr(rec.minutes)}${rec.dayBefore ? ' the day before' : ''} to arrive on time.`;
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

function init() {
  initTheme();

  // Load from URL or session
  const fromURL = loadFromURL();
  if (fromURL) {
    hydrateForm();
    setTimeout(() => goToStep(3), 50);
  } else {
    const session = loadSession();
    if (session) { state = { ...defaultState(), ...session }; hydrateForm(); }
  }
  renderRecentTrips();
  renderItinerary();
  updateNextButtonState();

  // Theme toggle (Feature 19)
  $('theme-toggle').addEventListener('click', toggleTheme);

  // Next / Start Over
  btnNext.addEventListener('click', () => {
    if (currentStep === 3) { openConfirmModal(); return; }
    collectStep(currentStep);
    if (!validateStep(currentStep)) return;
    saveSession();
    goToStep(currentStep + 1);
  });

  btnBack.addEventListener('click', () => { if (currentStep > 1) goToStep(currentStep - 1); });

  // Round trip toggle (Feature 2)
  $('round-trip-toggle').addEventListener('change', e => {
    $('return-date-group').hidden = !e.target.checked;
    updateNextButtonState();
  });

  // Target arrival toggle (Feature 5)
  $('target-arrival-toggle').addEventListener('change', e => {
    $('target-arrival-group').hidden = !e.target.checked;
    if (!e.target.checked) $('recommend-hint').textContent = '';
  });
  $('target-arrival').addEventListener('input', updateRecommendation);

  // Transport radios
  document.querySelectorAll('[name=transport]').forEach(radio => {
    radio.addEventListener('change', e => {
      const isCar = e.target.value === 'Car';
      speedGroup.hidden = !isCar;
      carCostInputs.style.display = isCar ? 'flex' : 'none';
      $('speed').value = SPEED_DEFAULTS[e.target.value];
      state.transport = e.target.value;
      state.speed = SPEED_DEFAULTS[e.target.value];
      updateRecommendation();
      updateNextButtonState();
    });
  });

  // Category buttons (Feature, filter-first)
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      activeFilter = 'all';
      searchTerm = '';
      $('activity-search').value = '';
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      renderActivities();
    });
  });

  // Search (Feature 7)
  $('activity-search').addEventListener('input', e => { searchTerm = e.target.value; renderActivities(); });

  // Filter tags (Feature 7)
  document.querySelectorAll('.filter-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      activeFilter = tag.dataset.filter;
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t === tag));
      renderActivities();
    });
  });

  // Summary actions
  $('btn-save').addEventListener('click', saveTrip);
  $('btn-share').addEventListener('click', shareLink);
  $('btn-ics').addEventListener('click', downloadICS);
  $('btn-print').addEventListener('click', () => window.print());

  // Editable summary rows (Feature 16)
  document.querySelectorAll('.summary-row.editable').forEach(row => {
    const jump = () => goToStep(parseInt(row.dataset.editStep, 10));
    row.addEventListener('click', jump);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
  });

  // Live validation + valid checkmarks (Feature 15)
  const fieldMap = [
    ['destination', 'err-destination'], ['miles', 'err-miles'], ['departure-date', 'err-date'],
    ['return-date', 'err-return-date'], ['speed', 'err-speed'], ['departure-time', 'err-time'],
  ];
  fieldMap.forEach(([inputId, errorId]) => {
    const el = $(inputId);
    if (!el) return;
    const handler = () => {
      clearError(inputId, errorId);
      refreshValidIndicators();
      updateNextButtonState();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  // Confirm modal (Feature 17)
  $('confirm-cancel').addEventListener('click', closeConfirmModal);
  $('confirm-ok').addEventListener('click', () => { closeConfirmModal(); resetApp(); });
  $('confirm-modal').addEventListener('click', e => { if (e.target === $('confirm-modal')) closeConfirmModal(); });

  // Keyboard navigation (Feature 18)
  document.addEventListener('keydown', e => {
    // Don't hijack typing in inputs (except Enter to advance)
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (e.key === 'Enter' && !inField && currentStep < 3) { btnNext.click(); }
    else if (e.key === 'Enter' && inField && document.activeElement.type !== 'time' && currentStep < 3) {
      // Enter inside a normal field advances the wizard
      if (!btnNext.disabled) { e.preventDefault(); btnNext.click(); }
    }
    if (!$('confirm-modal').hidden && e.key === 'Escape') closeConfirmModal();
    // Arrow keys cycle transport on step 2
    if (currentStep === 2 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inField) {
      const radios = [...document.querySelectorAll('[name=transport]')];
      const idx = radios.findIndex(r => r.checked);
      const next = e.key === 'ArrowRight' ? (idx + 1) % radios.length : (idx - 1 + radios.length) % radios.length;
      radios[next].checked = true;
      radios[next].dispatchEvent(new Event('change'));
    }
  });

  // Clear recent trips
  $('clear-recent').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    renderRecentTrips();
  });
}

function openConfirmModal() {
  const modal = $('confirm-modal');
  modal.hidden = false;
  $('confirm-cancel').focus();
}
function closeConfirmModal() { $('confirm-modal').hidden = true; }

/* ============================================================
   BOOT
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);
