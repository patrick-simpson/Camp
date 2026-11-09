
## 2023-11-13 - Cache Intl.DateTimeFormat
**Learning:** Instantiating `Intl.DateTimeFormat` inside synchronous render loops and string formatters is a significant performance bottleneck due to its initialization cost (sometimes order of milliseconds). It drastically slows down any tight loops parsing and rendering dates in this codebase.
**Action:** Always lazily instantiate and cache `Intl.DateTimeFormat` configurations globally or file-scoped using a pattern like `if (!_fmt) { try { _fmt = new Intl.DateTimeFormat(...); } catch(e){} }` and re-use the format instance.
