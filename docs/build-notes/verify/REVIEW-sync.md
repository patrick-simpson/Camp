# Adversarial review of the new sync merge (Opus reviewer, ~7:15 PM ET Mon)

| # | sev | finding | status |
|---|---|---|---|
| 1 | CRITICAL | Merge compared the normalized cache with the RAW snapshot: RTDB-pruned empties looked like someone else's edit ⇒ offline bracket/live/lap/notice edits dropped with a false conflict toast | fixed — syncCanon/syncCanonTree on all three sides |
| 2 | HIGH | Merged-but-unconfirmed tree saved as the confirmed baseline ⇒ scores lost if the app died before the ack | fixed — applyRemoteState(merged, serverNorm) |
| 3 | MED | settleExpiredClocks treated "sync not attached yet" as local mode ⇒ a fast-clock editor stopped the shared clock for everyone | fixed — mayWrite requires the first snapshot whenever Firebase is configured |
| 4 | MED | Key-order false conflicts (RTDB sorts keys; ack-composed baseline doesn't) | fixed — canonical (sorted) comparison |
| 5 | MED | Pictionary words for a setup created offline wiped by the merge | fixed — words carried across the merge |
| 6 | MED | Sign-out didn't know about an earlier session's never-uploaded scores | fixed — hasUnconfirmedLocalWork() in the sign-out warning |
| 7 | LOW | Offline-session points reached the server but never the change history | fixed — merged apply is logged as a local edit |
| 8 | LOW | An empty state node (deliberate console wipe) got re-seeded from an old cache | fixed — bootHadConfirmedBase ⇒ adopt empty, push only own unconfirmed edits (+ roster) |
| 9 | LOW | Unconfirmed work had no age limit | fixed — > 36 h since last confirmation ⇒ confirm() before sending |
| 10 | LOW | Two tabs of one camp: either tab's cache write can erase the other tab's unconfirmed delta | NOT fixed — documented limitation (one tab per camp per phone) |
| 11 | LOW | Chat spacing on Date.now() stalls after a backward clock correction | fixed — performance.now(), clamped |

Regression tests: tests/sync-offline.test.js (the reviewer's scenarios, with an RTDB-style prune + sorted keys).
