## 2024-05-24 - Caching array length in loops
**Learning:** Checking an array's length (`list.length`) in every iteration of a loop adds minor overhead, which can be optimized.
**Action:** When a loop iterates over an array that doesn't change size, cache the length into a variable before the loop (`const len = list.length`).
