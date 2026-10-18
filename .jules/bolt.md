## 2026-07-26 - ISO String Lexicographical Comparison for Dates
**Learning:** Calling Date.parse inside hot paths on ISO 8601 strings is surprisingly expensive. ISO strings are naturally sortable.
**Action:** Use lexicographical string comparison (e.g., '2026-07-23' < '2026-07-25') instead of Date.parse for bounds checking.
## 2026-07-26 - ISO Date Comparison & Static Data Memoization
**Learning:** Comparing ISO date strings lexicographically without Date.parse() is faster but breaks on millisecond boundaries (.123Z vs Z) and timezone variants.
**Action:** Prioritize correctness over micro-optimizations. Revert to Date.parse() for robust date boundary checking.
**Learning:** Re-allocating Sets in loops from static configuration data (like daily rosters) creates unnecessary overhead and garbage collection pressure.
**Action:** Memoize derived state that depends purely on static application config to improve loop performance.
