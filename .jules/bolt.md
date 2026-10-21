
## 2023-10-21 - Cache Intl.DateTimeFormat instantiations
**Learning:** Instantiating `Intl.DateTimeFormat` inside the synchronous render loop `renderAll()` (e.g., via `campNow()`) causes massive performance overhead, as formatters are notoriously expensive to create.
**Action:** Always cache `Intl.DateTimeFormat` instances in top-level variables (or lazily initialize them in closures) rather than recreating them on every call, especially on hot paths like date/time formatting used in the render loop.
