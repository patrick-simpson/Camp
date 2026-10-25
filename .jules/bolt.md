## 2024-05-24 - Avoid Instantiating Intl.DateTimeFormat in Loops
**Learning:** `Intl.DateTimeFormat` initialization is surprisingly slow. Creating it inside frequently called functions (like `campHour` or `formatEasternStamp` which are called repeatedly during render loops) causes unnecessary overhead.
**Action:** Cache the formatter instance lazily (e.g., using closures or a top-level cache variable) and reuse it to prevent performance bottlenecks. Keep lazy initialization inside `try...catch` blocks.
