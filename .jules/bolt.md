## 2026-07-26 - Caching Intl.DateTimeFormat instances
**Learning:** Instantiating `Intl.DateTimeFormat` inside frequently called functions (like formatters in render loops or chat message rendering) creates a significant performance bottleneck due to the cost of parsing options and allocating the formatter.
**Action:** Cache top-level formatter instances or lazily-instantiated closures to reuse them, ensuring lazy initialization remains inside `try...catch` blocks to preserve fallback behavior.
