
## 2024-05-24 - Intl.DateTimeFormat Instantiation Overhead
**Learning:** Instantiating `Intl.DateTimeFormat` is an incredibly expensive operation in JavaScript due to locale data parsing. When placed inside tight render loops or frequently polled intervals (like `campNow` or `chatTimeStamp`), it can add hundreds of milliseconds of overhead, noticeably blocking the main thread and degrading responsiveness.
**Action:** Always cache and reuse `Intl.DateTimeFormat` instances. Use lazy-loading singletons or closure-scoped variables (e.g., `let _fmt = null; function() { if (!_fmt) _fmt = new Intl... }`) when formatting dates in hot paths.
