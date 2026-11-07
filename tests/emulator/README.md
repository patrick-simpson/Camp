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
npm install                             # ~1 min, downloads the emulator jar
npx firebase emulators:start --only database --project camp-test &
npm test                                # the 2026 suites: run.mjs, rate.mjs
npm run test:r1                         # the R1 release suites (below)
npm run test:all                        # both
```

Every suite reads `../../database.rules.json` itself and hands it to its own emulator namespace, so there is no copy to
make and nothing that can go stale. (`firebase.json` names no rules file on purpose: the Firebase CLI refuses one outside
this folder, and a copy beside it would be a second file to keep true; the emulator starts without one.) Point any of the
R1 suites at a candidate file with `R1_RULES=/path/to/file.json node setup.mjs` — that is how they are mutation-checked:
weaken one clause, expect a red suite.

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
| `setup.mjs` | the seeded week of BOTH camps is accepted (built from `camps.js` by `camp-data.mjs`, junior's team patches included; and the all-sections seed of Step 20: meals, verses, cleanup, junior's electives); a non-owner can't seed (`meta/on`), but edits a section that is on; anchors: a field write into a deleted block / day / camper / patch target, or a `{start,end}` move, is refused; a patch on a day that doesn't use the typical day is refused; stamps need server time and the writer's key; scalars and 100,000-char strings at containers, unknown children, bad ids and ranges are refused |
| `restore.mjs` | create / retire an auto point; nothing editable in place; `pinned` is write-once; an `archive`, a `pre-wizard` or a pinned point can't be deleted (index, body, or both); `archive` / `pre-wizard` are the owner's to create |
| `campers.mjs` | editor-only read at the root, per team and per leaf; whole-camper create; a name write into a deleted camper refused; scalars and unknown children refused |
| `access-requests.mjs` | closed until `setup/meta/joinOpen`; own row only, server time, 60 s throttle (a leaf write to `note` and delete-and-recreate refused); a blocked identity, a member and an unverified email can't ask; editor read / delete |
| `editors-here.mjs` | editor-only both ways, own key, fresh `at`, one write a second; `presence {at}` unchanged under both rulesets |
| `teams-fields.mjs` | a v183 whole-`teams` array still passes; hostile `emoji` / `short` / `color` refused; a team photo takes a 100,000-char PNG (the regex at its cap) and refuses a quote, a space, a prefix-only forgery |
| `teams-client.mjs` | the REAL client's Teams-screen writes (Step 25): a rename taking the suggested short name and emoji (per-field `teams/0/*` paths), a colour from the sheet and from "Pick colours for the flagged teams", a photo at the 100,000-char cap (one `set()` of `{v, data}`, then `photoV`; a counselor reads it), Remove photo and Undo, hostile branding refused in the client and cleaned out of a backup before it is pushed, a counselor's phone writing nothing |
| `people-client.mjs` | the REAL client's People and Ask-to-join writes (Step 25, session 2): a walk-up's ask refused while asking is closed (said in the closed words), accepted once a director's phone has switched `setup/meta/joinOpen` on through the real setup commit; a director's phone seeing it through its real editor-only query (a counselor's attaches nothing); Let in (member created, then the request deleted) and the walk-up's own `once()` poll opening the camp by itself; Link (a Director row needs the typed address), Not now, Block (accessBlocked first) and the identical refusal for a blocked identity, Unblock; the requester's withdraw after the rules' minute; Put people on teams one row at a time and Add people as one multi-path update; a counselor's phone and the owner row writing nothing; a director of both camps hearing about the other camp's requests once |
| `campers-client.mjs` | the REAL client's Campers writes (Step 25, session 3): the real editor-only listener reads the list; Add is ONE multi-path update of whole `{ name, ord }` records (`c-` + ten base36 ids, a 40-character name, markup typed as a name and 300 names at once all accepted); Rename (one leaf), Move (one update: delete + create, same id) and Remove, and the screen's Undo (the same record put back), accepted; a rename sent from a stale view of a camper another director moved is REFUSED by the anchor pair and said in words; names typed with no signal are held in memory (nothing sent, nothing in storage) and go in one update per team when the connection is back; a counselor's phone and a director in a counselor preview attach nothing, write nothing and the rules refuse the same reads and writes by hand; a demotion drops the list from memory; the client writes only under the camper node. Mutation-checked: weakening the read clause, or both halves of the name / ord anchor pair, turns it red |
| `games-client.mjs` | the REAL client's Games writes (Step 21, session 2) on both camps, through a seeded phone's real sheet and engine and the real config listener / transaction: a game added through the sheet is ONE transaction storing the whole record on its item with a random-tail id, each later field (where, counter buttons, double points, a scoreboard) its own, a switch turned off removes the field; Matchups (fixed pairs as arrays of this camp's team ids, back to the standings removes them) and a change of how it is scored; When (`blockId` + `dayId` + `session` + `ord`, then off the schedule removes two fields), Earlier / Later, a copy and a delete, with the phone's catalog equal to the server's afterwards; a weekday made a games day with its note and taken off with its games moved; the ⚡ quick game; two directors at once (different fields of one game BOTH land, two "Rain bowling"s are two games, a game one deleted is not resurrected by the other's open sheet); a counselor's phone sends nothing and the rules refuse the same writes by hand. It found the config engine's late-completion race (see CLAUDE.md, "A push is a TRANSACTION"). Mutation-checked: letting any member write `config`, or a `.validate` on `games/$i/ord`, turns it red. `EMULATOR_PORT=9150 node games-client.mjs` runs it against an emulator on another port |
| `wizard-client.mjs` | the REAL client's new-year setup (Step 28, session 1) on both camps: the owner's phone claims the wizard (a transaction on `setup/meta/wizard`), saves last year (a `pre-wizard` and a pinned `archive` point, read back), clears with ONE atomic root update (the epoch pair, the scoreboard, the week's settings, campers, both reveal nodes, every open request; no `members/*`) and Undoes it in one more, every path accepted by the published rules; the counselors' teams follow as per-member updates (the owner row skipped, a hand-seeded incomplete row refused and listed on its own); then a NON-OWNER director's and a counselor's phones send nothing, and the exact payloads the owner's phone sent (the claim, the archive and pre-wizard points, the clear, an undo to a year's epoch) are replayed by hand from their connections: refused, the clear and the undo as a whole (the camp is byte-for-byte what it was). **Recorded, not a bug:** a director can still send the undo of a LEGACY-epoch archive by hand, because it only deletes the epoch pair and `.validate` is not evaluated for a delete (§1.4 limit b); the app refuses it first. Mutation-checked: weakening the claim's owner clauses, or `state|setup/meta/epoch`'s, turns it red |
| `brackets4.mjs` | `state/brackets4` refused before R1, accepted after, a scalar refused |
| `brackets4-client.mjs` | the REAL client's four-team bracket writes (Step 22, sessions 1 and 2) on the senior camp (and the junior refusal): Start is one write of `brackets4/<gid>`, a recorded match is ONE path `brackets4/<gid>/m/<match>` beside the data stamp, Undo is that match's deletion; two phones' writes to DIFFERENT matches both land and the same match is last-write-wins with nothing else moved; Save Result is ONE update carrying `results/<gid>` (medals + the finished bracket as `path`) and `brackets4/<gid>: null`, a counselor reads the podium, another director's standings take the medals; a late tap on a finished game sends nothing; Reopen the final is ONE update (the result deleted, the bracket back without its final) and the final can be played and saved again, a stray bracket under a saved result is listed and Discard is one deletion that leaves the result alone, and Change the result → Start over deletes the result AND that stray in one update, so the next Start is a fresh one; a semifinal changed from a stale phone after the 3rd-place match lands, every phone reads a RE-CHECK, no result can be saved from it, and Re-check settles it; a counselor's phone sends nothing and the rules refuse the same writes by hand; six teams cannot start one. Mutation-checked: `state/brackets4/.validate: false` turns four of six red. `EMULATOR_PORT=9150 node brackets4-client.mjs` runs it against an emulator on another port |
| `owner-only.mjs` | the owner can do A1's transaction, flip `on`, claim and update the wizard, commit the epoch pair atomically, create an archive; a non-owner director can't (as a whole); an unchanged value carried in a whole-node write is accepted; a phone sign-in is never the owner. **Records** what a non-owner's *delete* does (ALLOWED — see CLAUDE.md "R1") |
| `reveal.mjs` | the public path, run for the first time: anonymous read of `revealPublic` and nothing else, no anonymous write or delete anywhere; Start, compare-and-set races, `shown` +1 at a time, `sa` moves only when a place is shown, no unrevealed place in the public node, no rewrite of a published place, a new Start replaces (and a Start written as `ctl` alone, carrying the old places, is refused); no scalar or 2 MB string at `revealPublic`, `pub`, a Start's `pub`, `revealFull` or its `g`; shape (no `by` / `startedBy` / `name`, `t6`, `g6`, `place` 7, `teams` 7, a 31-char name, `until` over 48 h / 3 h); a real reveal can't be deleted before `until` (directly, as a whole-node delete, or in a multi-path update), a practice any time, the owner any time; `revealFull` editor-only with `r` = ctl id and `startedBy` = the writer; a practice leaves `real` byte-identical; the recorded limit that a director can still delete one shown place is pinned |
| `reveal-client.mjs` | the REAL client against these rules: reveal.js (the shipped scripts, through the unit tests' vm and DOM stub) talks to the emulator through a thin adapter from the SDK's modular API to the compat shape the app calls. A director's phone's Start (ctl + `pub: null` + the private order), every command of the state machine (each place, Back, the replay, the final table, End; the Friday crowning and an early End), a practice (only its own nodes, `real` byte-identical, End deletes both), two remotes pressing at once (one wins, the other is refused, says so and follows), a stale-`ca` Start refused, a counselor's mirror (three seconds behind a new place, no practice, no `revealFull`, the grid kept after End) and `retireExpiredReveal` (refused by the server before `until`, accepted after). **Mutation-checked:** a stale `sa`, a Start written as `ctl` alone, a `seq` that does not advance, a place published one early and a member key in the public ctl each turn it red |
| `ancestor-validate.mjs` | prints what the emulator says to the one-line ancestor-validate probe, and proves the design doesn't depend on the answer: with every record-level and `teams`-node `.validate` stripped, the leaf anchors alone still refuse the field writes, a team flag included |
| `director-tools-client.mjs` | Step 24: the REAL client's Tell everyone and Award points writes (a banner and a pinned notice, Take down, a verse slot, a cleanup slot, a custom bonus filed under a day, a 0 and a removal) accepted by the published rules on both camps, and a counselor's phone writes nothing while a raw counselor write of any of the three is refused. No rules change belongs to Step 24: this proves none is needed. A director in a counselor preview (Step 24, build session 2) writes nothing: every director act refused, the write log empty, the server untouched, and the same writer lands after Exit. Step 17 (Now's renderers) adds two cases per camp: a key in Now's cleanup moment (the Award points slot writer), Still on this (the one per-field path `state/meta/overrun`, accepted because `state/meta` only has to be a branch) and Take down of the notice are accepted for a director; a counselor's Now writes nothing and a raw counselor write of `state/meta/overrun` is refused. |

`reveal-e2e.cjs` is the same reveal in real browsers (BUILD-PLAN Step 23's live check, run locally; needs Playwright and the **auth**
emulator as well: `npx firebase emulators:start --only auth,database --project camp-89cea`, then `node reveal-e2e.cjs`, or
`npm run test:e2e`; `playwright` must resolve from here — `npm i -D playwright`, or a global one with `NODE_PATH=$(npm root -g)`; the pinned
SDK builds are fetched once with `curl` into the temp folder, or point `SDK_DIR` at them). It serves the worktree itself, signs two director
phones and a counselor phone in through the Auth emulator (a fake Google credential), opens the signed-out big screen, and holds the pages'
own CSP except for the emulator hosts it adds for the run; `firebase-config.js` is never edited. 34 checks: Start, three places (the
counselor three seconds behind), both remotes pressing at once, Back, End early, an anonymous read of `revealPublic` showing only the places
shown, a practice that never reaches the counselor, a real Start taking the big screen over from a practice, and the big screen never
loading an Auth SDK or talking to anything but the database. `E2E_SHOTS=<dir>` writes screenshots when a check fails, `E2E_DEBUG=1` prints
the pages' console errors.

`camp-data.mjs` builds the `setup` seed the suites use. `buildSeed(id, sections)` is now the REAL seed (Step 15's `buildSeed`, run
through the unit-test harness's vm; the schedule alone by default, `ALL_SECTIONS` for Step 20's switches). `buildSeedFixture(id)` is
the hand-written copy (junior: 26 typical blocks, patches Tue 2 / Wed 1 / Thu 2 / Fri 8, one-offs 26; senior: 20 typical, no
patches, 6 stub blocks) kept so a divergence from the real one is visible; `node camp-data.mjs` prints the counts.

## Export replay — the readiness gate for Edit the week here (BUILD-PLAN Steps 16 and 20)

`export-replay.mjs` answers one question before the owner presses **Edit the week here**: *on this camp's real data, does
everything the buttons do work under the published rules, and does the camp read the same afterwards?* One command, one
verdict per camp.

**One-time (the owner).** In the Firebase console: Realtime Database → **Data** → the ⋮ menu at the top of the data →
**Export JSON**. Do it at the database root, so both camps are in one file. The console saves it as
`<project>-default-rtdb-export.json` (for this project `camp-89cea-default-rtdb-export.json`). Save it **outside the repo**
(the Downloads folder is fine). It contains members' emails and phone numbers and the chat: it never belongs in git. The
replay prints no email, phone number or chat (a path or a count mostly; a difference it cannot explain is printed as the
text the camp reads, scrubbed of anything that looks like an email or a phone, so it can name a game, a dish, a verse, an
elective station or a counselor). As a net, the repo's root `.gitignore` and `tests/emulator/.gitignore` ignore every
`*export*.json` (and an `exports/` folder), so `git add -A` skips an export dropped into the repo by mistake; do not rely
on that, and delete the file afterwards.

**Every time:**

```sh
cd tests/emulator
npm install                                                           # once (nothing else to set up: no rules file to copy)
npx firebase emulators:start --only database --project camp-test &   # once per sitting
CAMP_EXPORT=/path/to/camp-89cea-default-rtdb-export.json node export-replay.mjs
```

`CAMP_EXPORT` has no default (where the file lives is up to you; with it unset the script says so and exits 2). An
export taken at ONE camp's root (no `campScoreboard` wrapper) is detected as well; say which camp with
`CAMP_EXPORT_CAMP=junior|senior` if the team count can't tell. `CAMP_ONLY=junior|senior` runs one camp. It takes about
ten seconds per camp. Exit code 0 only when every check of every camp passes (2 = it could not start: no emulator, no
file, not JSON). **When you are done, delete the export** (and `tests/emulator/*.log`, which hold paths only).

**What it does, per camp.** It loads that camp's data into the emulator with the rules bypassed, then drives the REAL client
(the shipped scripts through `tests/harness.js`, over `tests/fake-rtdb.js` holding the same data), signed in as the owner,
through what the owner's taps run: `setupTurnOn(['schedule'])` (the `pre-seed` restore point, the seed, `meta/on/schedule`,
A2's attachments of the games), the hub's "Put games on the schedule", the alert publisher (forced on: `PUSH_SERVICE_URL` is
blank until phone alerts go live), then meals, verses, cleanup and electives. Every database call the client makes is recorded.

| Check | What it proves |
|---|---|
| every write **accepted** | each recorded write (set, update, transaction, remove), replayed in order against the emulator under the REAL `database.rules.json` as the owner, is accepted. A refusal is printed with its path, never its value |
| owner-only writes **refused** | the writes that flip `meta/on/*` (the turn-ons, Use the original week again) are replayed as a non-owner director against the same state and must be refused |
| a faithful replay | a transaction ran in the emulator on the same value the client saw; the emulator's tree afterwards equals the client database's; no write carried a value the real SDK would throw on (`undefined`, `NaN`, a bad key: the fake silently prunes them) |
| reads | the paths the client reads are readable under the real rules (the three engines' paths also by a director and a counselor) |
| **seeded fidelity** | a fresh client loaded from the emulator before and after is compared on ~11,000 things: the schedule (all 7 days), the Happening-now banner for every minute of the week, the schedule sheet, the calendar files (the dated week, per day, and the undated legacy day), the games each block lists, the alert publisher's blocks and catalog, meals, `mealStart`, verses, cleanup, electives and slot starts, staff names. Only the documented intended differences (below) are allowed; anything else is printed as a readable diff |
| the rollback | after **Use the original week again** for every section, the same ~11,000 things equal the "before" set exactly; turning it on again equals the first "after" exactly, writing only the switches |
| **director edits** | a second phone signed in as a non-owner director makes 9–12 real edits with the app's own mutators (rename an item, Just Tuesday, skip a day, a one-off, the camp dates, a dish, cleanup teams, a verse, the theme verse, an elective station, a person) and every write must be accepted as that director, stamps and all |
| teams | `state/teams` ids are exactly `t0…t5` (junior) or `t0…t3` (senior): BUILD-PLAN Step 25's pre-ship check |
| placement (a report) | games the seed would leave on **no** schedule item, and cleanup slots that read TBA, listed by name |

**The documented intended differences** (`replay-fidelity.mjs`, one named matcher each, narrow by camp, weekday and shape,
so none can excuse unrelated drift): the schedule switch; senior's Afternoon games moving to their own blocks (3:00 PM Team
competitions, 4:50 PM Legacy Game) and no longer showing the Evening pair; junior Friday's Team Skits item listing the Team
Skits game; a game listed on the item that carries its name (A2's name rule), and no longer on the block its session used
to put it on; calendar UIDs switching to block ids (and a description naming the placed games); the alert publisher's block
ids changing format; senior's lunch `mealStart` becoming 12:30; junior's elective rows gaining their member-key list; staff
names gaining the elective stations' typed game-leader names. The run also fails if it did not see the schedule switch, the
UIDs and the ids change: a comparison that explains nothing means the "after" client never saw the edited week. If the
printed schedule in `camps.js` changes, change the matchers with it. **How to read a finding:** a `block-games` / `sheet` /
`ics` finding on a weekday you recognise is a game whose home moved; decide whether the new home is right (the hub's Put
games on the schedule and the Schedule screen move it) and, if so, add a matcher for it. Anything with `banner`, `meal`,
`cleanup`, `verse` or `schedule` in the key is a difference in what people read and should be understood first.

**Proof it can go red** (`REPLAY_MUTATE`, each breaks one thing and the run must fail): `refused-write` replays one write
the rules refuse; `seed-block` moves one seeded block in the emulator; `rollback-leak` leaves the schedule on in the
rollback. A rules mutation is `R1_RULES=/path/to/weakened.json` (as for the R1 suites): with the `meta/on/$s` owner clause
removed, "owner-only writes refused" goes red.

**Before the real export exists:** `node make-synthetic-export.mjs [dir]` writes console-shaped exports of the shipped default
weeks (fake people, example.com) into `camp-synthetic-exports` in the system temp directory (or the directory you give it): `synthetic-clean`
(a quiet week: results, a bracket, chat, presence, members), `synthetic-junk` (RTDB-pruned empties, an old build's whole
`teams` array, a result whose game left the week, a TBA game and one that cannot be placed, a game named for a schedule
item, a pending member, a legacy presence row, an older published schedule, a private `pushServer` node that must be
ignored) and the two single-camp-root forms. Run them first to see what a green run looks like.

`replay-client.mjs` (the real client over the recording fake database), `replay-page.js` (the code that runs inside the
app's vm context: boot, the taps, the snapshot, the director's edits) and `replay-fidelity.mjs` (the matchers) are the parts.

## The thing to remember

These run against the file. The console is what enforces. After every paste,
still run the unauthenticated probes from the runbook against the live database
(`docs/build-notes/setup-rebuild-spec.md`, Appendix E) — and the one thing none
of this can see is the LIVE evaluator: the ancestor-validate probe and the
100,000-char regex write are checked on the real database at Step 11.
