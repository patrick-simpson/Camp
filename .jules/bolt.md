## 2026-10-28 - Cache Intl.DateTimeFormat instantiations
**Learning:** Instantiating `Intl.DateTimeFormat` inside synchronous render loops or frequently called functions (like `tickBoardClocks` or `campNow`) causes a significant performance bottleneck due to the high cost of native object creation in JavaScript engines.
**Action:** Cache top-level formatter instances or use lazily-instantiated closures instead. Ensure these lazy initializations remain inside `try...catch` blocks to preserve fallback behavior.
