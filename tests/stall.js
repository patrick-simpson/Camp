'use strict';
// A flake hunter, not a test:   node -r ./tests/stall.js tests/run.js [name-filter]
//
// A test that waits for the clock instead of for the app passes on an idle laptop and fails now and then on a loaded
// machine or a cold container, when the process stalls (a GC pause, CPU starvation, three suites at once) for longer than
// the guess it made. Waiting for that to happen by luck takes dozens of runs. This preload makes it happen on purpose:
// with probability STALL_P a timer's callback first spins for up to STALL_MS before it runs, which is what a stall looks
// like from inside the process, and every other timer that came due meanwhile fires late and in the wrong place.
//
//   STALL_SEED  (default 1)    the pseudo-random sequence; the same seed replays the same stalls, so a failure can be
//                              reproduced and then confirmed fixed
//   STALL_P     (default 0.15) the chance a given timer callback is preceded by a stall
//   STALL_MS    (default 100)  the longest stall, in ms (each one is uniform in 0..STALL_MS)
//
// A good sweep is several seeds over the whole suite:
//   for s in 1 2 3 4 5; do STALL_SEED=$s node -r ./tests/stall.js tests/run.js; done
// A test that fails under it and passes without it is waiting on the clock: wait for the event instead (waitUntil /
// waitQuiet in tests/harness.js). Nothing here is loaded by the runner or served to a browser, and without `-r` it does nothing.

let seed = (parseInt(process.env.STALL_SEED || '1', 10) >>> 0) || 1;
const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const P = parseFloat(process.env.STALL_P || '0.15');
const MS = parseFloat(process.env.STALL_MS || '100');

const realSetTimeout = global.setTimeout;
global.setTimeout = function stalledSetTimeout(fn, ms, ...args) {
  if (typeof fn !== 'function') return realSetTimeout(fn, ms, ...args);
  return realSetTimeout(function () {
    if (next() < P) {
      const until = Date.now() + next() * MS;
      while (Date.now() < until) { /* the stall */ }
    }
    return fn.apply(this, arguments);
  }, ms, ...args);
};
