# Rules tests (opt-in — needs npm and Java)

`node tests/run.js` stays zero-dependency and checks the *shape* of
`database.rules.json`. These check what the rules actually **do**, by running
them in Firebase's Realtime Database emulator. They caught nothing the day they
were written — they exist so that the next rules edit can't quietly open a door.

Nothing here is part of `node tests/run.js`, nothing is loaded by the browser,
and the repo root still has no `package.json`.

## Running

```sh
cd tests/emulator
cp ../../database.rules.json .          # run.mjs / rate.mjs / fallback.mjs read ./database.rules.json
npm install                             # ~1 min, downloads the emulator jar
npx firebase emulators:start --only database --project camp-test &
npm test                                # the 2026 suites: run.mjs, rate.mjs
npm run test:r1                         # the R1 release suites (below)
npm run test:all                        # both
```

The R1 suites read `../../database.rules.json` directly (no copy needed). Point
any of them at a candidate file with `R1_RULES=/path/to/file.json node setup.mjs`
— that is how they are mutation-checked: weaken one clause, expect a red suite.

## The 2026 suites

`run.mjs` — the boundary as documented: strangers and non-members get nothing,
viewers read but can't write, unverified emails don't count, the owner record
is untouchable, the two camps can't reach each other, chat is identity-bound
and create-or-delete only, images must be inline `data:` URLs, timestamps are
bounded (the app-freeze fix), the changelog is sealed.

`rate.mjs` — the per-writer rate limit: a flood is refused, a second member is
unaffected, the stamp can't be backdated or written for someone else, deletes
are never throttled, and a photo send still works as one atomic update.

`fallback.mjs` — deploy-order safety for the chat rate limit, a ONE-TIME check
that needs `old.rules.json` = the ruleset published BEFORE `chatRate` existed.
That ruleset is long gone from the console, so it is kept only as a record.

## The R1 suites (BUILD-PLAN Step 10 — a gate for the Step 11 paste)

R1 is one combined, additive rules release: P2's `setup` / `campers` /
`teamPhotos` / `accessRequests` / `accessBlocked` / `restoreIndex` /
`restoreBody` / `editorsHere`, the standings reveal's `revealPublic` (the ONE
path anyone may read with no sign-in) and `revealFull`, the owner-only clauses
(decision Q8) and a few amendments to `state` and `pushSchedule`. It is
written once in `../rules-macros.js` and proven here. Every suite prints
`SAFE` or `UNSAFE` and sets its exit code. `pre-r1.rules.json` is a frozen copy
of the ruleset published before R1 (the repo file at v196), so the two-way
suites keep working after R1 is live.

| Suite | Proves |
|---|---|
| `compat-old-client.mjs` | a v183–v196 client's real write set (26 operations, both camps: state per path and multi-path, the whole default `config`, members, presence, changelog, chat + stamp, a push device, the published week) behaves identically under the pre-R1 file and R1, and is accepted |
| `compat-new-client-old-rules.mjs` | the code can deploy before the paste: every new node is refused cleanly under the published rules (so the client shows "not available yet") and works under R1; everyday traffic is identical; a denied `setup` listener never hurts the `state` listener |
| `setup.mjs` | the seeded week of BOTH camps is accepted (built from `camps.js` by `camp-data.mjs`, junior's team patches included); a non-owner can't seed (`meta/on`), but edits a section that is on; anchors: a field write into a deleted block / day / camper / patch target, or a `{start,end}` move, is refused; a patch on a day that doesn't use the typical day is refused; stamps need server time and the writer's key; scalars and 100,000-char strings at containers, unknown children, bad ids and ranges are refused |
| `restore.mjs` | create / retire an auto point; nothing editable in place; `pinned` is write-once; an `archive`, a `pre-wizard` or a pinned point can't be deleted (index, body, or both); `archive` / `pre-wizard` are the owner's to create |
| `campers.mjs` | editor-only read at the root, per team and per leaf; whole-camper create; a name write into a deleted camper refused; scalars and unknown children refused |
| `access-requests.mjs` | closed until `setup/meta/joinOpen`; own row only, server time, 60 s throttle (a leaf write to `note` and delete-and-recreate refused); a blocked identity, a member and an unverified email can't ask; editor read / delete |
| `editors-here.mjs` | editor-only both ways, own key, fresh `at`, one write a second; `presence {at}` unchanged under both rulesets |
| `teams-fields.mjs` | a v183 whole-`teams` array still passes; hostile `emoji` / `short` / `color` refused; a team photo takes a 100,000-char PNG (the regex at its cap) and refuses a quote, a space, a prefix-only forgery |
| `brackets4.mjs` | `state/brackets4` refused before R1, accepted after, a scalar refused |
| `owner-only.mjs` | the owner can do A1's transaction, flip `on`, claim and update the wizard, commit the epoch pair atomically, create an archive; a non-owner director can't (as a whole); an unchanged value carried in a whole-node write is accepted; a phone sign-in is never the owner. **Records** what a non-owner's *delete* does (ALLOWED — see CLAUDE.md "R1") |
| `reveal.mjs` | the public path, run for the first time: anonymous read of `revealPublic` and nothing else, no anonymous write or delete anywhere; Start, compare-and-set races, `shown` +1 at a time, `sa` moves only when a place is shown, no unrevealed place in the public node, no rewrite of a published place, a new Start replaces (and a Start written as `ctl` alone, carrying the old places, is refused); no scalar or 2 MB string at `revealPublic`, `pub`, a Start's `pub`, `revealFull` or its `g`; shape (no `by` / `startedBy` / `name`, `t6`, `g6`, `place` 7, `teams` 7, a 31-char name, `until` over 48 h / 3 h); a real reveal can't be deleted before `until` (directly, as a whole-node delete, or in a multi-path update), a practice any time, the owner any time; `revealFull` editor-only with `r` = ctl id and `startedBy` = the writer; a practice leaves `real` byte-identical; the recorded limit that a director can still delete one shown place is pinned |
| `ancestor-validate.mjs` | prints what the emulator says to the one-line ancestor-validate probe, and proves the design doesn't depend on the answer: with every record-level and `teams`-node `.validate` stripped, the leaf anchors alone still refuse the field writes, a team flag included |

`camp-data.mjs` loads `defaults.js` + `camp-core.js` + `camps.js` into a vm for
either camp and builds a `setup` seed by setup-rebuild-spec §10.2 (junior: 26
typical blocks, patches Tue 2 / Wed 1 / Thu 2 / Fri 8, one-offs 26; senior: 20
typical, no patches, 6 stub blocks). It is a FIXTURE until Step 15's real
`buildSeed`; `node camp-data.mjs` prints the counts.

## The thing to remember

These run against the file. The console is what enforces. After every paste,
still run the unauthenticated probes from the runbook against the live database
(`docs/build-notes/setup-rebuild-spec.md`, Appendix E) — and the one thing none
of this can see is the LIVE evaluator: the ancestor-validate probe and the
100,000-char regex write are checked on the real database at Step 11.
