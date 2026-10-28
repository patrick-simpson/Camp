## 2024-05-18 - Caching `Intl.DateTimeFormat`
**Learning:** `Intl.DateTimeFormat` instantiations are significantly slow (often 1-2ms per call) and can become a bottleneck when called frequently in hot paths or loops.
**Action:** When working with dates, cache the formatter globally (e.g. at the module level) using a lazy-initialization block inside a `try...catch` instead of re-instantiating `new Intl.DateTimeFormat` repeatedly. Ensure to keep the fallbacks in the `catch` blocks.
