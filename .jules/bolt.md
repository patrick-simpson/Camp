## 2026-10-27 - Caching Intl.DateTimeFormat
**Learning:** Instantiating `Intl.DateTimeFormat` inside frequently called functions (e.g. `campHour`, `formatEasternStamp`) causes severe performance bottlenecks in this vanilla JS app, taking seconds over many iterations compared to milliseconds with caching.
**Action:** Always cache and reuse `Intl.DateTimeFormat` instances (lazily initializing them inside a `try...catch` block to preserve fallback behavior) rather than creating them anew on each render or loop iteration.
