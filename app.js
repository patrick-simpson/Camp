'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */

const SPEED_DEFAULTS = {
  Car:   65,
  Plane: 500,
  Train: 80,
};

const TRANSPORT_LABELS = {
  Car:   '🚗 Car',
  Plane: '✈️ Plane',
  Train: '🚆 Train',
};

const ACTIVITIES = {
  restaurants: [
    {
      name: "The Trail's Edge Grill",
      description: "Farm-to-table burgers and wood-fired entrees with a sweeping patio view of the valley below.",
      tip: "Ask the server for the off-menu jalapeño aioli — it pairs perfectly with the elk burger.",
    },
    {
      name: "Mesa Verde Cantina",
      description: "Authentic Southwestern fare with fresh hand-pressed tortillas made daily and a killer salsa bar.",
      tip: "Arrive before 6 PM on weekends to avoid a 45-minute wait — no reservations taken.",
    },
    {
      name: "Summit Smokehouse",
      description: "Low-and-slow BBQ brisket, pulled pork, and craft beers on tap in a rustic lodge atmosphere.",
      tip: "The half-rack combo platter saves roughly 20% compared to ordering proteins separately.",
    },
    {
      name: "The Sunrise Diner",
      description: "Beloved local breakfast spot serving classic American plates and strong coffee all day long.",
      tip: "Cash only — there's an ATM at the front door, but bring small bills to speed up service.",
    },
  ],
  parks: [
    {
      name: "Ridgeline Overlook Trail",
      description: "A 4.2-mile out-and-back hike through pine forest with a breathtaking 180° panoramic viewpoint at the summit.",
      tip: "Start before 8 AM in summer to beat the crowds and snag the best photos without other hikers in frame.",
    },
    {
      name: "Clearwater Falls State Park",
      description: "Two accessible waterfall loops plus a serene picnic area along a glacier-fed river with emerald pools.",
      tip: "The upper falls viewpoint (0.3 mi from lot B) is almost always empty and often more scenic than the main falls.",
    },
    {
      name: "Valley Botanical Gardens",
      description: "18 acres of curated native plant collections, a butterfly garden, and shaded walking paths open year-round.",
      tip: "Tuesdays are free admission. The rose garden peaks mid-June — check their website for bloom updates.",
    },
    {
      name: "Sunstone Canyon Reserve",
      description: "A protected desert canyon with guided geology walks, ancient petroglyphs, and stunning orange-hued cliffs.",
      tip: "Book a ranger-led petroglyph tour ($12/person) at least 48 hours ahead — spots fill fast in peak season.",
    },
  ],
  museums: [
    {
      name: "Regional History Museum",
      description: "Three floors covering 10,000 years of local history, from Indigenous cultures through the industrial era.",
      tip: "The basement archive room has a rotating display of rare maps and photographs not listed on the main floor.",
    },
    {
      name: "Center for Contemporary Art",
      description: "A dynamic gallery space hosting rotating exhibitions from emerging and established local and national artists.",
      tip: "First Friday of each month is free entry with live artist talks from 6–9 PM — easily the best evening in town.",
    },
    {
      name: "Science & Discovery Center",
      description: "Hands-on exhibits spanning space, geology, and biology — great for all ages with a working planetarium.",
      tip: "The 'Deep Space' planetarium show at 2 PM is the most detailed and only runs once daily — don't miss it.",
    },
    {
      name: "Heritage Railway Museum",
      description: "Restored steam locomotives, a working signal tower, and immersive exhibits on the golden age of rail travel.",
      tip: "On the last Sunday of each month, you can board and ride a restored 1940s steam engine for $8 per person.",
    },
  ],
  hotels: [
    {
      name: "The Ridgecrest Inn",
      description: "A boutique 28-room inn perched at 4,200 ft with private balconies, a rooftop terrace, and full hot breakfast.",
      tip: "Request a 'forest-view' room when booking — it's the same price but faces away from the parking structure.",
    },
    {
      name: "Clearwater Lodge & Cabins",
      description: "Secluded riverside log cabins with fire pits, kayak rentals, and a morning breakfast basket delivered to your door.",
      tip: "Cabin 7 and 8 are closest to the river and have the best sound of running water — worth asking for specifically.",
    },
    {
      name: "Downtown Suites Hotel",
      description: "Modern all-suite property in the heart of the main street district, steps from dining, galleries, and nightlife.",
      tip: "The rooftop lounge is open to all guests until 11 PM — grab a spot before sunset for the best skyline views.",
    },
    {
      name: "Juniper Valley Ranch Stay",
      description: "A working cattle ranch offering 6 private guesthouses, horseback riding, stargazing tours, and farm-fresh dinners.",
      tip: "The Thursday evening chuck wagon dinner ($35/person) is worth every cent and books out weeks in advance.",
    },
  ],
};

/* ============================================================
   STATE
   ============================================================ */

const state = {
  destination:   '',
  miles:         null,
  date:          '',
  transport:     'Car',
  speed:         65,
  departureTime: '',
};

let currentStep = 1;

/* ============================================================
   DOM REFERENCES
   ============================================================ */

const stepPanels  = [1, 2, 3].map(n => document.getElementById(`step-${n}`));
const stepNodes   = document.querySelectorAll('.step-node');
const connector12 = document.getElementById('connector-1-2');
const connector23 = document.getElementById('connector-2-3');
const btnNext     = document.getElementById('btn-next');
const btnBack     = document.getElementById('btn-back');
const speedGroup  = document.getElementById('speed-group');
const activityList = document.getElementById('activity-list');

/* ============================================================
   STEP NAVIGATION
   ============================================================ */

function transitionPanel(outEl, inEl) {
  outEl.classList.remove('step-panel--active');
  outEl.addEventListener('transitionend', () => {
    outEl.style.display = 'none';
  }, { once: true });

  inEl.style.display = 'block';
  // Double rAF ensures the browser has computed layout before adding the class
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inEl.classList.add('step-panel--active');
    });
  });
}

function updateStepIndicator(n) {
  stepNodes.forEach((node, i) => {
    const step = i + 1;
    node.classList.remove('active', 'complete');
    node.removeAttribute('aria-current');
    if (step < n)       node.classList.add('complete');
    else if (step === n) { node.classList.add('active'); node.setAttribute('aria-current', 'step'); }
  });

  connector12.classList.toggle('complete', n > 1);
  connector23.classList.toggle('complete', n > 2);
}

function goToStep(n) {
  const outPanel = stepPanels[currentStep - 1];
  const inPanel  = stepPanels[n - 1];

  transitionPanel(outPanel, inPanel);
  updateStepIndicator(n);

  currentStep = n;

  // Footer buttons
  btnBack.hidden = n === 1;

  if (n === 3) {
    btnNext.textContent = 'Start Over';
    btnNext.classList.remove('btn--primary');
    btnNext.classList.add('btn--danger');
    renderSummary();
  } else {
    btnNext.textContent = 'Next →';
    btnNext.classList.add('btn--primary');
    btnNext.classList.remove('btn--danger');
  }
}

/* ============================================================
   VALIDATION
   ============================================================ */

function setError(inputId, errorId, message) {
  const input = document.getElementById(inputId);
  const err   = document.getElementById(errorId);
  if (input) input.classList.add('invalid');
  if (err)   err.textContent = message;
}

function clearError(inputId, errorId) {
  const input = document.getElementById(inputId);
  const err   = document.getElementById(errorId);
  if (input) input.classList.remove('invalid');
  if (err)   err.textContent = '';
}

function validateStep(n) {
  let valid = true;

  if (n === 1) {
    if (!state.destination.trim()) {
      setError('destination', 'err-destination', 'Please enter a destination.');
      valid = false;
    } else {
      clearError('destination', 'err-destination');
    }

    if (!state.miles || state.miles <= 0) {
      setError('miles', 'err-miles', 'Please enter a valid distance.');
      valid = false;
    } else {
      clearError('miles', 'err-miles');
    }

    if (!state.date) {
      setError('departure-date', 'err-date', 'Please select a departure date.');
      valid = false;
    } else {
      clearError('departure-date', 'err-date');
    }
  }

  if (n === 2) {
    if (state.transport === 'Car' && (!state.speed || state.speed <= 0)) {
      setError('speed', 'err-speed', 'Please enter a valid average speed.');
      valid = false;
    } else {
      clearError('speed', 'err-speed');
    }

    if (!state.departureTime) {
      setError('departure-time', 'err-time', 'Please enter a departure time.');
      valid = false;
    } else {
      clearError('departure-time', 'err-time');
    }
  }

  return valid;
}

/* ============================================================
   STATE COLLECTION
   ============================================================ */

function collectStep(n) {
  if (n === 1) {
    state.destination = document.getElementById('destination').value;
    state.miles       = parseFloat(document.getElementById('miles').value) || null;
    state.date        = document.getElementById('departure-date').value;
  }

  if (n === 2) {
    const checked = document.querySelector('[name=transport]:checked');
    state.transport    = checked ? checked.value : 'Car';
    state.speed        = parseFloat(document.getElementById('speed').value) || SPEED_DEFAULTS[state.transport];
    state.departureTime = document.getElementById('departure-time').value;
  }
}

/* ============================================================
   CALCULATIONS
   ============================================================ */

function calcTravelTime() {
  const speed      = state.transport === 'Car' ? state.speed : SPEED_DEFAULTS[state.transport];
  const totalHours = state.miles / speed;
  const hours      = Math.floor(totalHours);
  const minutes    = Math.round((totalHours - hours) * 60);
  return { hours, minutes, totalHours };
}

function formatTravelTime(hours, minutes) {
  if (hours === 0)  return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function calcArrivalTime(totalHours) {
  const [h, m]     = state.departureTime.split(':').map(Number);
  const depMinutes = h * 60 + m;
  const travelMins = Math.round(totalHours * 60);
  let arrivalMins  = depMinutes + travelMins;
  const crossesMidnight = arrivalMins >= 1440;
  arrivalMins = arrivalMins % 1440;

  const ah = String(Math.floor(arrivalMins / 60)).padStart(2, '0');
  const am = String(arrivalMins % 60).padStart(2, '0');
  return `${ah}:${am}${crossesMidnight ? ' (+1 day)' : ''}`;
}

function formatDisplayDate(dateStr) {
  // Append T00:00:00 to force local-time interpretation (avoids UTC offset day shift)
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  });
}

function formatDisplayTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/* ============================================================
   RENDER SUMMARY
   ============================================================ */

function renderSummary() {
  const { hours, minutes, totalHours } = calcTravelTime();

  document.getElementById('s-destination').textContent  = state.destination;
  document.getElementById('s-date').textContent         = formatDisplayDate(state.date);
  document.getElementById('s-departure-time').textContent = formatDisplayTime(state.departureTime);
  document.getElementById('s-transport').textContent    = TRANSPORT_LABELS[state.transport];
  document.getElementById('s-distance').textContent     = `${Number(state.miles).toLocaleString()} miles`;
  document.getElementById('s-travel-time').textContent  = formatTravelTime(hours, minutes);
  document.getElementById('s-arrival').textContent      = formatDisplayTime(
    calcArrivalTime(totalHours).replace(' (+1 day)', '')
  ) + (calcArrivalTime(totalHours).includes('+1 day') ? ' (+1 day)' : '');
}

/* ============================================================
   RENDER ACTIVITIES
   ============================================================ */

function renderActivities(category) {
  // Clear previous items safely
  while (activityList.firstChild) {
    activityList.removeChild(activityList.firstChild);
  }

  // Update active button state
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const items = ACTIVITIES[category] || [];

  items.forEach((item, index) => {
    const article = document.createElement('article');
    article.className = 'activity-card';
    article.style.animationDelay = `${index * 60}ms`;

    const name = document.createElement('h4');
    name.className = 'activity-card-name';
    name.textContent = item.name;

    const desc = document.createElement('p');
    desc.className = 'activity-card-desc';
    desc.textContent = item.description;

    const tipWrapper = document.createElement('div');
    tipWrapper.className = 'pro-tip';

    const tipLabel = document.createElement('span');
    tipLabel.className = 'pro-tip-label';
    tipLabel.textContent = '💡 Pro tip:';

    const tipText = document.createTextNode(' ' + item.tip);

    tipWrapper.appendChild(tipLabel);
    tipWrapper.appendChild(tipText);

    article.append(name, desc, tipWrapper);
    activityList.appendChild(article);
  });
}

/* ============================================================
   RESET
   ============================================================ */

function resetApp() {
  // Reset state
  state.destination   = '';
  state.miles         = null;
  state.date          = '';
  state.transport     = 'Car';
  state.speed         = 65;
  state.departureTime = '';

  // Reset form fields
  document.getElementById('destination').value    = '';
  document.getElementById('miles').value          = '';
  document.getElementById('departure-date').value = '';
  document.getElementById('speed').value          = '65';
  document.getElementById('departure-time').value = '';

  // Reset transport radios
  document.querySelectorAll('[name=transport]').forEach(r => {
    r.checked = r.value === 'Car';
  });

  // Restore speed group visibility
  speedGroup.hidden = false;

  // Clear activity list and active buttons
  while (activityList.firstChild) activityList.removeChild(activityList.firstChild);
  document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));

  // Clear any validation errors
  ['destination', 'miles', 'departure-date', 'speed', 'departure-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('invalid');
  });
  ['err-destination', 'err-miles', 'err-date', 'err-speed', 'err-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  // Make sure step-3 panel is properly hidden before navigating away
  const step3 = document.getElementById('step-3');
  step3.classList.remove('step-panel--active');
  step3.style.display = 'none';

  // Navigate to step 1 directly without a fade-out animation from step 3
  const step1 = document.getElementById('step-1');
  step1.style.display = 'block';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      step1.classList.add('step-panel--active');
    });
  });

  updateStepIndicator(1);
  currentStep = 1;

  btnBack.hidden = true;
  btnNext.textContent = 'Next →';
  btnNext.classList.add('btn--primary');
  btnNext.classList.remove('btn--danger');
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

function init() {
  // Next / Start Over button
  btnNext.addEventListener('click', () => {
    if (currentStep === 3) {
      resetApp();
      return;
    }
    collectStep(currentStep);
    if (!validateStep(currentStep)) return;
    goToStep(currentStep + 1);
  });

  // Back button
  btnBack.addEventListener('click', () => {
    if (currentStep > 1) goToStep(currentStep - 1);
  });

  // Transport radio change
  document.querySelectorAll('[name=transport]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.transport  = e.target.value;
      const isCar      = e.target.value === 'Car';
      speedGroup.hidden = !isCar;

      // Update speed input to reflect defaults when switching modes
      const speedInput = document.getElementById('speed');
      speedInput.value = SPEED_DEFAULTS[e.target.value];
      state.speed      = SPEED_DEFAULTS[e.target.value];
    });
  });

  // Activity category buttons
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => renderActivities(btn.dataset.category));
  });

  // Clear validation errors on user input
  const fieldMap = [
    ['destination',    'err-destination'],
    ['miles',          'err-miles'],
    ['departure-date', 'err-date'],
    ['speed',          'err-speed'],
    ['departure-time', 'err-time'],
  ];

  fieldMap.forEach(([inputId, errorId]) => {
    const el = document.getElementById(inputId);
    if (el) {
      el.addEventListener('input', () => clearError(inputId, errorId));
      el.addEventListener('change', () => clearError(inputId, errorId));
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);
