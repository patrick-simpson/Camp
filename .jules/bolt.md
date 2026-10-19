## 2026-10-19 - Avoid Intl.DateTimeFormat instantiation overhead in render paths
**Learning:** `new Intl.DateTimeFormat()` is surprisingly expensive in JavaScript and was being instantiated repeatedly on hot paths (e.g. `campNow` running on interval, `formatEasternStamp` rendering history).
**Action:** Extract `Intl.DateTimeFormat` instantiations into top-level constants or lazily-instantiated closures to reuse the formatter instance.
