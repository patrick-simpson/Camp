// tv-camp.js — which camp the TV page shows, decided BEFORE camps.js runs.
//
// current-standings.html carries no inline script (its CSP refuses them), so
// this tiny classic file is what sets window.CAMP_FORCE, the one global
// camps.js's activeCampId() honours. `?camp=junior|senior` wins; anything else
// leaves it unset, so camps.js falls back to the camp this device's own app
// last used (same origin, same localStorage), then junior. Must be a plain
// blocking <script> placed before camps.js.
(function () {
  try {
    var c = new URLSearchParams(location.search).get('camp');
    c = c == null ? '' : String(c).toLowerCase();
    if (c === 'junior' || c === 'senior') window.CAMP_FORCE = c;
  } catch (e) { /* an old browser without URLSearchParams: the fallbacks apply */ }
})();
