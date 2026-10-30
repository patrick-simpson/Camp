
## 2025-02-12 - Avoid repetitive Intl.DateTimeFormat instantiation in hot paths
**Learning:** Instantiating `new Intl.DateTimeFormat` is an expensive operation that can cause performance bottlenecks when done inside synchronous render loops or frequently called functions (e.g. `campNow()` in `app.js` runs every 30 seconds and on every render tick, and formatting is used heavily in `current-standings.js` when rendering).
**Action:** Lazily instantiate `Intl.DateTimeFormat` inside the functions that use them and attach the instance to the function object or closure to reuse it on subsequent calls. This preserves lazy loading (to avoid `RangeError` on load in unsupported environments) while significantly reducing CPU overhead during normal execution.
