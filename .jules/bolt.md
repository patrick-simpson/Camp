## 2024-05-19 - Cache Intl.DateTimeFormat Instances
**Learning:** Instantiating `Intl.DateTimeFormat` inside frequently called functions (like `formatEasternStamp` or inside `renderAll` loops) causes measurable performance overhead. The codebase relies heavily on vanilla JS and synchronous loops, making these instantiations a bottleneck.
**Action:** Use an Immediately Invoked Function Expression (IIFE) with a closure variable to lazily instantiate and cache the `Intl.DateTimeFormat` object for reuse in hot code paths.
