## 2024-03-24 - Intl.DateTimeFormat instantiation in hot paths
**Learning:** `campNow()` is a hot path for evaluating the current state (like blocks or schedule) based on "camp time". Instantiating `new Intl.DateTimeFormat` inside this function is extremely slow compared to caching it. Caching the formatter improves execution time by ~30x in micro-benchmarks.
**Action:** Extract and lazily instantiate `Intl.DateTimeFormat` instances inside performance-critical functions, ensuring we preserve fallback behavior (within try-catch block).
