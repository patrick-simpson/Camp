## 2024-05-24 - Intl.DateTimeFormat caching in loops
**Learning:** Instantiating `Intl.DateTimeFormat` inside synchronous render loops (like rendering lists of messages or chat bubbles) is extremely slow and can bottleneck the main thread.
**Action:** Always cache and reuse top-level formatter instances or lazily-instantiated closures. Make sure lazy initializations remain inside `try...catch` blocks to preserve fallback behavior.
