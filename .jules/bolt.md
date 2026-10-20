## 2025-02-18 - Avoid repeated Intl.DateTimeFormat instantiations
**Learning:** Instantiating `Intl.DateTimeFormat` inside the synchronous render loops and heavily called functions (e.g. formatEasternStamp, campNow) incurs a significant performance overhead specific to this application's architecture.
**Action:** Always cache and reuse top-level formatter instances or lazily-instantiated closures instead of creating new ones inside frequently called UI rendering or time-checking functions.
