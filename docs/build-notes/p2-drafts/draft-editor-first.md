# Project 2 — Setup rebuild: the editor-first spec (draft)

Status: one of three competing drafts. Angle: **start from the camp director**,
design every screen for a laptop the week before camp and a phone on a rainy
Wednesday, then derive the smallest data model and sync machinery that makes
those screens honest. Written against commit `63005d9` (APP_VERSION 183).
`CLAUDE.md` is authoritative wherever this draft is silent.

Two claims in here were **measured, not assumed** (probe scripts ran the real
`camps.js`/`app.js` through `tests/harness.js`; output in Appendix C):

1. Both camps' hard-coded weeks can be stored as **one typical day + per-day
   changes + per-day one-offs** and resolved back to `DAY_SCHEDULE`
   **byte-for-byte** (junior 13.2 KB of blocks becomes 6.6 KB of data; senior
   9.5 KB becomes 3.1 KB). That is what lets junior stay identical until it
   switches, and makes the switch invisible on every screen.
2. A deterministic rule attaches **all 47 seeded games** (22 junior, 25
   senior) to the schedule block a director would expect. Today's Morning/
   Evening heuristic gets 21 of 22 and 15 of 25. One naive "name contains"
   rule I tried first put senior's Legacy Game on "Cool down & prepare for
   the Legacy Game". So the backfill rule here is the strict one, and it is
   pinned by a test.

---------------------------------------------------------------------

## 0. Contents

1. Goals, non-goals, how we'll know it worked
2. The people, and six moments the design must survive
3. Design language for the builder (and what it refuses to look like)
4. Screens, one by one
5. The data model those screens need
6. Sync and multi-editor behaviour
7. Undo and restore points
8. Security rules
9. Consumers and the accessor layer (the home-screen seam)
10. Phone alerts: stable blocks, and alerts when the schedule changes
11. Outputs: the TV page for both camps, and a full-week calendar
12. Migration: seeding from camps.js, junior identical until it switches
13. Staged build plan (each stage ships on its own)
14. The deferred Project-1 items, and where each lands
15. Tests
16. Risks
17. Decisions only the owner can make
- Appendix A: the team colour palette, with measured contrast
- Appendix B: checklist status rules (the pure function)
- Appendix C: probe output
- Appendix D: UI copy glossary

---------------------------------------------------------------------

## 1. Goals, non-goals, how we'll know it worked

### Goals
- **G1 One place to set up a camp week.** Everything a director sets up before
  or during a week is in one screen, "Set up the week": the dates, schedule,
  teams, counselors, campers, games, meals, verses, cleanup rota and
  electives. Nothing needs a code change or a Firebase console visit.
- **G2 A new year takes about twenty minutes.** A five-step wizard copies last
  year, saves it, and clears the scores. A checklist then says what's left,
  with ✅ or ⚠️ per section.
- **G3 Rain plans work from a phone with one hand.** Moving, swapping,
  cancelling and adding schedule items for **just today** takes one tap per
  item. Games move with their items. If the phone-alert service is live, the
  people who follow those items can be told.
- **G4 Two directors can work at the same time without losing each other's
  work.** Edits merge per field. Each editor can see who else is in the builder
  and what they're on ("Jenn is also here, on Tuesday").
- **G5 Bad Wi-Fi is normal, not an emergency.** Schedule, team, game, meal,
  verse, rota and elective edits are saved on the phone straight away. They
  survive a reload, a force-quit or an iOS eviction, and merge when the phone
  is back online, the same way scores already do.
- **G6 Nothing is a one-way door.** There is an undo for the last 50 setup
  changes on each device. Automatic shared restore points are taken before
  anything big. Last year is archived before it is cleared.
- **G7 Campers' first names are private to directors,** enforced by the
  database rules and never cached on a phone.
- **G8 Junior keeps behaving exactly as it does today** until someone turns on
  shared setup, and turning it on changes nothing anyone can see.
- **G9 Every output reads the new data:** the home screen, Happening Now, the
  schedule sheet, chat mentions, phone reminders, the TV page (both camps) and
  a full-week calendar file.

### Non-goals
- **The home-screen layout redesign.** A separate owner interview is pending.
  This spec only guarantees the seam (section 9): every home consumer reads
  through named accessor functions, so a new layout can sit on top.
- Changing team counts (junior 6, senior 4 stay fixed, per the owner). Brackets
  for other counts are out of scope.
- A live calendar subscription feed (webcal), which would need a public URL.
- Camper-facing features (camper accounts, attendance, parent contacts).
- A server-side audit log of every setup edit. Per-section "last changed by"
  stamps, undo and restore points cover the stated needs (owner decision 17.9).

### How we'll know it worked (acceptance, checked during the stages)
- A director with no instructions sets up a full senior week on a laptop: dates,
  4 teams with colours, a typical day, Sunday and Saturday, and games on blocks.
- On a phone in airplane mode, swap two items on today's schedule, force-quit,
  reconnect. The swap reaches a second device and nothing else is lost.
- Two browsers edit different fields of the same game at the same moment.
  Both edits survive (today the later Save wipes the other: scoring#3).
- Every test in `tests/` still passes, including `camps.test.js` against the
  untouched `fixtures-junior-week.json`.
- Unauthenticated probes against every new node return `Permission denied`.
  A signed-in **viewer** gets `Permission denied` on `campers`.

---------------------------------------------------------------------

## 2. The people, and six moments the design must survive

**Who edits:** every member with role `editor` (directors and game leaders).
No new role. Viewers (counselors) never see the builder, but they read
everything it publishes.

| # | Moment | Device | What must be true |
|---|---|---|---|
| M1 | **The week before camp.** Jenn sits down on Sunday night with coffee to set up 2027 junior camp. | Laptop, good Wi-Fi, maybe two tabs open | A wizard gets her from "last year's data" to "ready" with no dead ends. A checklist shows what's left. A wide screen shows the week and the item she's editing side by side. |
| M2 | **Rainy Wednesday, 9:40 am.** Patrick stands in the dining hall doorway. It's pouring and outdoor games start at 10:00. | Phone, one hand, spotty signal | He opens "Change today's plan" from the home screen and swaps Team competitions with Elective 1. Axe Throwing moves to Thursday. He taps Done and chooses whether to alert people. Under ten taps, no typing. |
| M3 | **Two directors at once.** Jenn fixes Tuesday's supper time on her laptop while Patrick adds a rain game on his phone. | Laptop + phone | Both changes land. Each sees a small "Patrick is also here, on Games" tag. If they touch the very same field, the second person is asked, not overwritten. |
| M4 | **Sunday registration.** A counselor who wasn't on the list signs in with Google, and a camper arrives late. | Counselor's phone, director's phone | The counselor taps "Ask to join" on the denied screen and gets in on their own phone once a director approves. The director adds the camper's first name to a team in two taps. Counselors can never see camper names. |
| M5 | **Senior camp, Thursday.** The Legacy Game is a 4-team bracket. | Phone | Two semifinals, a third-place match, then the final. Undo works at every step, and a double-tap by two refs can't skip a match. |
| M6 | **Dead zone at the waterfront.** A director edits Friday's menu and then the phone dies. | Phone | When it comes back, the edit is still there and goes up once there's signal. If someone changed the same dish meanwhile, a toast says so and offers "Use mine". |

These six moments drive the acceptance tests in section 15.

---------------------------------------------------------------------

## 3. Design language for the builder

The app already has a voice: a printed camp schedule turned into a live board.
The builder should feel like the **director's clipboard** that produced that
board, and not like a generic SaaS settings panel.

**What it looks like**
- **One column of rows, divided by hairlines,** like a printed run sheet. Times
  are left-aligned in tabular numerals (`font-variant-numeric: tabular-nums`).
  Labels are medium weight. Section names are short all-caps labels with
  letter-spacing. No cards inside cards, no shadows on rows, no gradients,
  no hero banners, no illustrations.
- **Emoji are content, not decoration.** A block's emoji and a team's emoji
  appear because they are data. There are no sparkles on buttons, no "🎉 Done!"
  screens and no confetti in the builder (confetti stays on medals).
- **Status is a quiet mark at the end of a row:** `✅ Ready` or `⚠️ 3 to check`.
  Both marks are owner-requested. The text beside them is muted and specific
  ("Saturday is empty", not "Incomplete"). There are no progress bars or
  percent rings. The hub's top line is a sentence: "7 of 10 ready · next:
  Teams".
- **Verbs, sentence case, no exclamation marks.** Buttons read "Copy to
  Mon–Fri", "Move to…", "Tell people", "Put it back". Never "Submit", "OK",
  "Awesome" or "Oops".
- **Colour is reserved for meaning.** Primary blue is for the single main
  action on a screen. Danger red uses `--color-danger-text` for text (see
  section 14, `.danger-link`). Team colours appear only on team rows and
  previews.
- **Density follows the device.** On a phone, rows are 48 px minimum, every
  target is at least 44 px, and editing happens in bottom sheets
  (`jelly-drawer`, bottom placement, max 90vh) with a sticky footer. On a
  laptop (≥ 900 px), the builder is two-pane: the hub on the left (300 px,
  sticky) and the selected screen on the right. The Schedule screen adds a
  "Whole week" view of seven narrow columns.
- **Destructive actions use hold-to-confirm,** not a modal. Clearing scores and
  resetting a day use a button that fills over 1.2 s while pressed. A short
  tap shows "Hold to clear". Keyboard and screen-reader users get the
  accessible alternative: press, then a second explicit "Yes, clear" button
  appears inline. A restore point is always taken first, and the confirmation
  line says so.
- **Native controls where phones do them better.** Times use
  `<input type="time" step="300">` (wheel pickers on iOS and Android), dates
  use `<input type="date">`, and photos use `<input type="file"
  accept="image/*">`. Jelly components are used for everything else, as
  today.
- **Never `transition: all`; never re-create Jelly components on a refresh**
  (render-stability rule). The builder patches rows in place (section 6.4).

**What it refuses to do:** auto-advancing carousels, onboarding tooltips that
block the screen, "AI suggestions", skeleton shimmer for data that is already
cached, modal stacks, and toasts that pile up. At most one undo snackbar is on
screen at a time, and a new one replaces it.

---------------------------------------------------------------------

## 4. Screens, one by one

### 4.0 Getting in, and the frame around every screen

**Entry points (editors only; viewers never see any of them):**
- Settings sheet → **Set up the week** (the existing `#builder-row`, same
  place, same name) → the hub.
- The home schedule sheet → **Change today's plan** (new, editor-only) → opens
  the Schedule screen on today, with Rain plan on (4.5).
- The home Competitions card on an empty day → **Add games** (existing button,
  now opens Games on that day).
- The ⚡ quick-game button (existing) → the game sheet, pre-attached to the
  schedule block happening now, or the next one.
- On a hub-level ⚠️ for people asking to join, the Settings gear shows a small
  count badge for editors only.

**Takeover:** the builder keeps today's `state.ui.view === 'settings'` /
`body.builder-open` takeover (app.js `openBuilder`, `renderAll`). Only one
takeover is open at a time, and chat closes the builder as it does today.
`state.ui.builderScreen` (device-local) replaces `state.ui.settingsTab`. A
reload reopens the same screen. An open sheet's unsaved draft is lost on
reload, which is acceptable because the reload is blocked while a sheet is
dirty (6.3).

**The header on every builder screen** has three parts, left to right:
1. **Back** ("Scoreboard" from the hub; the hub from a screen). If a sheet is
   dirty, Back asks "Discard your changes to Team competitions?" (Keep editing
   / Discard). This kills the zombie-draft bug B1: no draft outlives its sheet.
2. **The sync line**, one short sentence that is always truthful:
   - `Saved` (nothing pending)
   - `Saving…` (a write is in flight)
   - `Saved on this phone · will sync when you're back online` (offline, or the
     first snapshot hasn't arrived)
   - `Couldn't save Teams · tap for details` (a refused write. The detail
     sheet explains in plain words and offers "Try again" and "Download my
     changes".)
3. **Who's here**: a row of up to three initial circles (neutral surface
   colour, with the person's initial) for other editors currently in the
   builder. On a phone it collapses to one line, "Jenn is also here". Tapping
   it lists who is where ("Jenn · Tuesday's schedule · just now").

Below the header, an **undo pill** appears after any setup change, for example
`↶ Undo: moved Swim to 3:00 PM`. Tapping it undoes the change, and a
long-press (or the ⋯ menu) opens the last 50 changes on this device (7.1).

### 4.1 The checklist hub ("Set up the week")

The first thing an editor sees. It's a list, top to bottom, in the order a
director naturally works:

```
SET UP JUNIOR CAMP                             [⋯]
Week of Sun, Jul 18 – Sat, Jul 24, 2027
7 of 10 ready · next: Teams
Jenn is also here

  Camp week        Sun Jul 18 – Sat Jul 24        ✅
  Schedule         Typical day · Mon–Fri · 3 one-offs   ✅
  Games            22 games on 10 schedule items  ⚠️ 1 not on the schedule
  Teams            6 teams                        ⚠️ Foxes needs a colour
  People           18 counselors · 4 directors    ⚠️ 2 asking to join
  Campers          64 campers                     ✅
  Meals            Mon–Fri                        ⚠️ 3 meals have no dish
  Memory verses    Theme + 5 days                 ✅
  Cleanup rota     Each team cleans 2–3 times     ✅
  Electives        3 slots · 6 stations           ✅
  ─────────────
  Phone alerts     Schedule sent to phones        ✅
  Notice board     Draft
  Restore points   Last saved 12 min ago
```

- Each row shows the status mark, a muted one-line summary, and (laptop only)
  "changed by Patrick · 20 min ago" from `setup/meta/edited/<section>`.
- A row someone else is on shows their initial at the row's start.
- The **status rules are a pure function** (`hubStatus(section, view)`,
  Appendix B), unit-tested, and the same function feeds the "next:" pointer.
- Optional sections (Campers, Meals, Memory verses, Cleanup rota, Electives)
  have **"Not using this year"** in their screen's ⋯ menu. That writes
  `setup/meta/skip/<section> = true`, and the row shows `— Not used` instead
  of ⚠️.
- Electives appear only when `CAMP.features.electives` is on (junior).
- **When shared setup is not on yet** (from stage 3a on; section 13),
  the hub opens with one quiet paragraph above the list:
  > This camp's schedule, teams and menus are still the built-in copy. Turn
  > on shared setup to edit them here. Nothing will look different to anyone
  > until someone changes something.
  > **[Turn on shared setup]**

  Until then, rows for sections still on the built-in copy open a read-only
  preview with the same button. Games, Days, Teams, Notice and Data keep
  working through the classic tabs, reachable as "Classic editor" in the ⋯
  menu, until their section is on.
- **When a new year is due** (no week dates, or the week ended more than 7
  days ago), a line sits above the list: "Getting ready for a new camp week?
  **Start the new-year setup**". It opens the wizard (4.2).

### 4.2 The new-year wizard

Five steps, one per screen, with a step counter ("2 of 5"). Back is always
allowed until step 4 runs, and the wizard can be resumed. Progress is stored in
`setup/meta/wizard = {season, step, byKey, at}`. Starting the wizard claims it
through a `transaction()`. A second editor who opens it while it's claimed sees:

> Jenn is setting up 2027 (step 3 of 5, 4 min ago). **[Watch]** · **[Take
> over]** (offered only if her last activity is over 15 minutes old).

**Step 1 · When is camp?**
- "Camp starts on Sunday" uses a date input. If a non-Sunday is picked, it
  snaps and says why: "Camp weeks start on a Sunday. Did you mean **Sun, Jul
  18**?" (Use that / Pick again).
- Below it, the week appears as seven small labels: `Sun 18 · Mon 19 … Sat
  24`. Each day carries last year's tag ("Arrival day", "Competition day 1",
  …), editable later in Camp week.
- **Double points:** "Last year: Thursday 5:00 PM until the end of Friday.
  Same this year?" (Yes / Change…). This replaces the hard-coded July-2026
  timestamps (`doubleWindow()`, sections 9.1 and 11.1).

**Step 2 · What carries over from 2026?** A checklist with sensible defaults.
Each line says what it means in plain words.

| Item | Default | Note shown |
|---|---|---|
| Schedule (typical day, arrival day, send-off day) | ✅ | "You can change anything after." |
| Games (22), on the same schedule items | ✅ | |
| Team names, short names, emoji and colours | ✅ | "Rename them in a minute if the teams are new." |
| Team photos (shields/flags) | ☐ | "Last year's shields belong to last year's teams." |
| Cleanup rota | ✅ | |
| Meal menus | ☐ | |
| Memory verses and theme | ☐ | |
| Elective stations | ✅ | |
| Who's at each elective station | ☐ | |
| Counselors stay on their teams | ☐ | "Everyone keeps their sign-in. You'll put them on teams again." |
| Campers | never | "Camper names are never kept between years." |

**Step 3 · Save 2026.** This needs a connection. Without one the step says so
and waits. It writes:
1. a restore point of kind `pre-new-year`, and
2. an archive entry `archive/a-<old weekStart>` holding the full setup, the
   synced state and a standings summary,

then reads both back to check them. It shows: "Saved 2026: 22 game results ·
Ferocious Foxes won with 211 points. You can look back at it any time in
Restore points." There is nothing to confirm.

**Step 4 · Clear the scoreboard.** It lists exactly what will be cleared, with
counts ("22 game results · 61 bonus points · 3 announcements · notice board
back to a draft · 4 brackets in progress"). The **[Hold to clear]** button is
the only control. One action then:
- clears `state/results, brackets, drafts, picRounds, picSetup, bonuses, live,
  clocks, announcements` and resets `notice` to a draft of
  `CAMP.defaultNotice()`, all in one per-path `update()` through the normal
  state diff;
- writes the new `state/meta/epoch` and `setup/meta/epoch` (6.9) in the same
  pass;
- applies the step-2 choices to the setup tree as one `commitSetup` (6.1.2);
- if "Counselors stay on their teams" was off, clears `members/*/teamId` in one
  multi-path `update()` that **skips the owner key** (the rules refuse the
  whole batch otherwise; rules#5);
- tells every device through the snapshot listeners; nobody needs to reload.

**Step 5 · Next steps.** The hub opens with every section showing its honest
status. "Next: Teams" (new names are the usual first job).

### 4.3 Camp week

One screen with three groups.

- **Dates.** "Camp starts on" (a Sunday) followed by a read-only line
  "Sun Jul 18 – Sat Jul 24, 2027". This is `setup/meta/weekStart`, the **single
  source of truth**. The Phone alerts drawer stops asking for it and shows a
  read-only line with a link here (section 10). Before shared setup is on, the
  drawer keeps today's behaviour.
- **Days.** Seven rows, Sun to Sat. Each has a name tag ("Arrival day",
  "Competition day 3", "Messtival & Team Skits") and two switches:
  - **Uses the typical day** (`days/dN/typical`), on by default for Mon–Fri.
  - **Competition day** (`days/dN/competition`). Competition days get a tab on
    the home Competitions card, a memory verse and a cleanup rota row.
  - An optional **note** (`days/dN/note`) becomes banners on that day's games
    panel, same as today's Days-tab note.
  - `competition` and `note` belong to the **games** section (5.3), because
    games are what hang off competition days. Until games are on shared setup
    (stage 5), these two rows don't appear here, and competition days and
    notes keep living in `config.days`, edited in the classic Days tab. When
    games turn on, both are seeded from the live `config.days` at that moment
    and the classic Days tab disappears.
- **Double points and the big finish.** "Double points from [Thursday ▾]
  [5:00 PM] until [end of Friday ▾]" sets `setup/meta/double`. Saving offers:
  "Also mark the 6 games in that window as double points?" (Mark them / Leave
  games as they are). "Champion celebration on the TV page: [Friday ▾]" sets
  `setup/meta/finaleDow` (default: the last competition day).

### 4.4 Schedule

The heart of the builder. Three views share one list component.

**Day strip** (sticky under the header): `Typical · Sun · Mon · Tue · Wed · Thu
· Fri · Sat`. Days that use the typical day show a small dot under their
label. Days with any one-offs or changes show a second, filled dot. Today's
chip is outlined.

**A. Typical day view**
```
TYPICAL DAY · used by Mon, Tue, Wed, Thu, Fri
 7:30–8:00   ⏰ Rising bell, shower & morning meeting…   ›
 8:00–8:30   🍳 Breakfast                    Meal       ›
 9:00–9:45   📖 Bible study                             ›
10:00–11:45  🏅 Team competitions            Games · 2–4 games  ›
 …
22:00        🛏️ Lights out                  no time shown ›
                                    [+ Add to the typical day]
```
- Each row shows the time range, emoji, label, a kind tag (Meal / Games /
  Elective 1–3) and, for games items, how many games are attached across the
  week.
- `+` appears in every gap between rows on hover (laptop) or as a "+ here"
  row when a gap is 15 minutes or more (phone). It adds an item that fills the
  gap.
- Tapping a row opens the **item sheet** (below). Saving from the typical-day
  view needs no scope question. The footer note says "Changes Mon–Fri, except
  days that have their own version of this". If a day has its own version of
  a field being changed, an inline line appears before Save: "Wednesday has
  its own start time (10:30)." (Keep Wednesday's / Change Wednesday too).

**B. A day view (e.g. Tuesday)**
- Shows the resolved day: the typical items with Tuesday's changes, plus
  Tuesday's one-offs, sorted by time.
- Tags make the source visible without a legend:
  - `Tue only` on one-offs;
  - `Changed for Tue` on typical items Tuesday overrides, with a **Reset to
    typical** action in the sheet;
  - typical items Tuesday skips appear as one collapsed muted line at the
    bottom: "Skipped on Tuesday: Evening competition · **Bring back**".
- **Saving an item from a day view asks the scope question,** but only when
  the item comes from the typical day. The sheet's sticky footer has two equal
  buttons:
  **[Just Tuesday]** **[Every typical day]**
  "Every typical day" lists the days in a caption under the button ("Mon, Tue,
  Wed, Thu, Fri"). A one-off has a single [Save].
- Adding from a day view asks the same question: [Add to just Tuesday] / [Add
  to every typical day].
- Removing asks it too: [Skip just Tuesday] / [Remove from every typical day].
- **Arrival (Sun) and send-off (Sat)** are their own days (`typical: false`).
  Their view has no scope question. An empty arrival or send-off day shows
  "Start from last year's Sunday" when an archive exists, and "Copy from
  another day…" always.
- A day can be turned into its own day: ⋯ → "Make Friday its own day". This
  copies Friday's resolved items into Friday-only items **with the same ids**,
  so attached games and phone-alert keys don't move. The reverse, ⋯ → "Go back
  to the typical day", needs a restore point and a hold-to-confirm, and
  detaches Friday-only games to "Not on the schedule" with a prompt.

**C. Whole week (laptop only)**: seven columns, one per day, each a compact
list (time + emoji + label, no kind tags). Changed and one-off items are
marked with the same tags. Clicking opens the item sheet in the right pane.
It is a reading view, not a drag surface.

**The item sheet** (bottom sheet on a phone, right pane on a laptop):

| Field | Control | Maps to |
|---|---|---|
| What happens | text input | `label` (1–120 chars) |
| Emoji | text input + a 4×8 grid of camp emoji (🍳🥪🍽️🏅📖⛪🔥🛏️🎭🎬🧹🤝🎒🌟🍫🧼📣⏰👋📝🎽🙏🪥🧊🎈🎤🏆🌙🍲🥧🏊) | `emoji` |
| Starts / Ends | two native time inputs, 5-minute steps | `start`, `end` (minutes; ends ≤ 24:00) |
| This is… | segmented: **Activity · Meal · Games · Elective** | `type` (+ `meal` / `slot`) |
| Which meal | Breakfast · Lunch · Supper (shown for Meal) | `meal` |
| Which elective | 1 · 2 · 3 (shown for Elective) | `slot` 0/1/2 |
| Show the time | switch, on by default; off for "Lights out" | `noTime` |
| Games here | the attached games for this day (Games kind), each with "Move…", plus "+ Add a game here" | games' `blockId` |
| Phone reminders | read-only: "People who follow *Team competitions* get reminded before this." | `alertKey` |
| Remove… | `.danger-link` at the bottom | |

- **Overlap check, live in the sheet:** "Overlaps *Prepare for bed* (9:15–9:30
  PM)." (Push later items back 15 min / That's on purpose). "That's on purpose"
  sets `overlapOk: true` on this item, which the seed sets for the Tue/Thu
  movie nights. Junior's movie-night trick (it wins Happening Now because it
  sorts first) is preserved by the `ord` tie-break (5.4).
- **End before start** is refused inline: "Ends before it starts".
- **Renaming keeps the reminder key.** Phones that follow "Team competitions"
  still get reminded after a rename. If the head of the label changes
  completely, the sheet asks: "Is this still the same thing for reminders?"
  (Yes, same / No, start fresh). "Start fresh" mints a new `alertKey`.
- **Meal tagging makes menus and cleanup work.** Today they only work when a
  label is literally "Breakfast", "Lunch" or "Supper" (`mealInfo`). With the
  tag, senior's "Supper and free time" can be a supper (Appendix B flags
  untagged meal-looking items).

**Guided first build** (new camp, or an empty typical day): the typical-day
view shows one instruction line instead of an empty state: "Start with the
first thing in the morning, usually breakfast. **[Add the first item]**".
Once it has three or more items, a single line appears above the list: "Use
this for Monday to Friday? **[Copy to Mon–Fri]**". That sets `typical: true`
on the chosen days, via a checkbox row defaulting to Mon–Fri.

### 4.5 Rain plan (moving things around on one day)

Reached from a day view's ⋯ → **Rain plan for Tuesday**, or from the home
screen's **Change today's plan** (editors only). It's the same Schedule
screen in a mode where every change is **for this day only**, so there is no
scope question. Rows grow a toolbar:

```
RAIN PLAN · TUESDAY · changes are for Tuesday only          [Done]
10:00–11:45  🏅 Team competitions  · Axe Throwing, Bowling
             [↑ Earlier] [↓ Later] [⏱ Time] [✕ Cancel today] [Games…]
```

| Action | What it does | Writes (all "just this day") |
|---|---|---|
| ↑ Earlier / ↓ Later | Swaps this item with the previous/next **timed** item. Each keeps its own length, and the pair occupies the same span. Items in between shift by the length difference. | `patches/dN/<id>/{start,end}` for each moved typical item; `dayBlocks/dN/<id>/{start,end}` for one-offs |
| ⏱ Time | Pick a new start. A switch, "Move everything after it too", ripples later items by the same amount. | as above |
| ✕ Cancel today | Skips the item today. If games are attached, asks: "Axe Throwing and Bowling are on this. Move them to… (another item today / another day / Not on the schedule)". | `patches/dN/<id>/off: true` + games' `dow`/`blockId` |
| Games… | Lists the games on this item, each with "Move to…" (a picker of every item, on every day, that is Games-kind or already has games, nearest first). | games' `dow`, `blockId`, `ord` |
| + Add for today | A one-off item ("Indoor movie"). | `dayBlocks/dN/<new id>` |

- Each tap is **one atomic `commitSetup`** with one undo entry (7.1). If the
  phone is offline, it's saved on the phone (6.6).
- **Done** shows a summary sheet with one line per change:
  > 4 changes to Tuesday
  > • Team competitions now 1:15–3:00 PM (was 10:00 AM)
  > • Elective 1 now 10:00–10:45 AM (was 1:15 PM)
  > • Axe Throwing moved to Thursday · Team competitions
  > • Evening competition cancelled today
  >
  > ☑ Send a phone alert to people who get reminders for these
  > **[Done]**

  The alert checkbox appears only when the phone-alert service is live
  (`PUSH_SERVICE_URL` set), the day is today or later within camp week, and
  at least one changed item has an `alertKey`. It defaults to checked when the
  changes are for today. If the phone is offline at Done, it says "We'll ask
  again when you're back online", and the intent is kept locally (section 10).
- **Reset Tuesday to the typical day** (⋯) takes a restore point, then removes
  `patches/d2` and `dayBlocks/d2` with hold-to-confirm. Games on removed
  one-offs are offered a new home first.

### 4.6 Teams

A fixed list: 6 rows for junior, 4 for senior (`CAMP.teamCount`). There is no
Add or Delete. The rows are the slots `t0…tN`, whose ids stay fixed forever
(they key results, rota, alerts and the rules).

```
TEAMS · 6
 🦊  Ferocious Foxes          Foxes      ●  🛡      ⚠️ hard to read in dark mode
 🦃  Turkey Dinner            Turkey     ●  🛡      ✅
```

**The team sheet:**
- **Team name** (1–60 chars) and **Short name** (1–20 chars). The short name
  has a caption: "Used where space is tight, and when people mention the team
  in chat (e.g. *Foxes*)."
- **Emoji**: an input plus a grid of about 40 mascot-friendly emoji. Taken
  emoji are dimmed and carry the other team's short name.
- **Colour**: 12 swatches from the palette (Appendix A). Each swatch is a pill
  that shows the team name in that colour on a light chip and a dark chip at
  once, so the director sees both themes without switching. A swatch another
  team uses shows that team's emoji and stays pickable, but the hub warns
  "Two teams are Blue". A team still on last year's single hex colour shows
  "Last year's colour", with the contrast warning when it fails a theme.
- **Shield or flag photo**: "Add a photo" opens the camera or library. The
  image is cropped to the shield aspect (480×667) with a draggable frame and
  previewed on the "Your team" card in light and dark. "Remove photo" is
  available. Photos need a connection (section 6.6).
- **Live preview** at the top of the sheet: the real `renderFollowCard` markup
  for this team, rendered twice (light and dark) at 60% scale.
- **Renaming ripple:** after a name or short-name change, if any schedule label
  mentions the old short name (e.g. the morning meeting "— 🦊 Foxes, 🎃
  Pumpkins…"), one line offers: "3 schedule items mention *Foxes*. Update them
  too?" (Update / Leave them). Update is one `commitSetup` with its own undo.

### 4.7 People (counselors, directors, trickle-in, walk-ups)

One list organised by team, which replaces three places today: the Members
drawer, the "pending" rows, and `SEED_COUNSELORS`. It is the same data
(`<root>/members`); only the screen is new.

```
PEOPLE
  ASKING TO JOIN · 2
  ┌ Taylor Reed · taylor.reed@gmail.com · 4 min ago
  │ "I'm with the Foxes"
  │ [Let in ▾ Counselor · Foxes]  [Not now]
  └ Looks like "Taylor (Foxes, no sign-in yet)". [Link them]

  🦊 FEROCIOUS FOXES · 3 counselors
    Alysa          ✅ signed in
    Cam            ✅ signed in
    Sam            ⏳ no sign-in yet          [Add sign-in]
  …
  NOT ON A TEAM
    Jenn           Director · ✅
    Patrick        Owner · managed in the Firebase console
                                    [+ Add people]
```

- **Status words, not icons alone:** ✅ signed in · ⏳ no sign-in yet (a
  pending row) · 🙋 asking to join.
- **The person sheet** has fields for name, team (a select of this camp's
  teams, or "Not on a team"), **Role** (Counselor = `viewer` / Director =
  `editor`) and sign-in (email or phone, auto-detected as today). It also has
  **Camps** (Junior / Senior access with None · Counselor · Director, the
  existing per-camp switch logic from `bindMemberList`, shown only to editors
  of both camps), "Copy invite text" and **Remove from this camp**.
- **Your own row** and **the owner's row** are read-only. Your row says "Ask
  another director to change your access". The owner row says "Owner ·
  managed in the Firebase console" (this fixes rules#5). The client gets
  `OWNER_MEMBER_KEY`, pinned to the rules string by a test.
- **+ Add people** offers two tabs:
  - **Type a list**: a textarea, "One person per line. Add a team after a
    comma if you know it: *Cam, Foxes*". A live preview resolves each line
    ("Cam → 🦊 Foxes", "Sam → no team matched, will be Not on a team").
    Matching is case-insensitive on team name or short name, and dedupes
    against existing names on that team (the `missingSeedCounselors` rule).
    [Add 6 people] writes pending rows (`pending-<slug>-<rand>`) in one
    multi-path `update()`.
  - **One person with a sign-in**: today's add form (email or phone, role,
    team).
- **Asking to join** (walk-ups, section 4.17 for the requester's side):
  - "Let in" offers role and team pickers.
  - If a pending row on this camp matches the requested name
    (case-insensitive), it offers "Link them". That runs the existing
    create-then-delete of `convertPendingMember`: the real key is written
    first, then the pending row and the request are removed.
  - "Not now" deletes the request.
- **Offline**: People actions need a connection (members writes have no offline
  persistence today, and this spec does not add any). Buttons show "Needs a
  connection" while `.info/connected` is false.

### 4.8 Campers (directors only)

A privacy line opens the screen: "Only directors can see camper names.
Counselors never see this list, and it isn't saved on any phone."

```
CAMPERS · 64                                    [🔍 Find a camper]
  🦊 FEROCIOUS FOXES · 11
    Maya   Eli   Grace   Owen   Ava R.   Ava T.   …     [+ Add]
```
- **+ Add** opens a textarea, "First names, one per line or separated by
  commas". It creates the campers in one multi-path `update()`. Duplicates
  within a team are allowed. The caption suggests "add a last initial to tell
  two apart".
- Tapping a name chip gives **Move to ▾ team** (one atomic update: delete under
  the old team, create under the new), **Rename** and **Remove**.
- **Find a camper** filters across teams ("Where's Maya?").
- The **Teams** screen shows camper counts per team, for editors only.
- The **People** screen header shows "11 campers" per team, editors only.
- **Offline**: read-only, with "Changing campers needs a connection. Camper
  names aren't stored on phones." This is deliberate (section 6.6).
- No other surface shows camper names in this project. A printable team sheet
  is a possible later feature, flagged in section 17.

### 4.9 Meals

A grid with days as rows (only days that have Meal-tagged items) and
Breakfast, Lunch and Supper as columns (only meals that exist that day).
Each cell has a dish (≤ 80 chars) and an optional emoji. On a phone the grid
becomes one day at a time with the day strip. Inline editing commits on blur,
like today's Days tab. Each commit is a per-field `commitSetup`, and the undo
entries for one cell batch together. Empty cells are allowed; the Happening
Now banner just shows the plain label, as today.

### 4.10 Memory verses

The **theme** (title, verse text up to 600 chars, reference) followed by one
row per **competition day**: verse text, reference, and an optional video
link. The video link is accepted only if it is `https://` on youtube.com,
youtu.be or vimeo.com, so a typed URL can't become an arbitrary link; the
accessor re-checks it on render (section 9). There is also "Copy verse text
from last year" when an archive exists.

### 4.11 Cleanup rota

A grid of competition days by meals. Each cell holds team chips (one or two
teams; tap to pick from the team list). Two helpers sit above the grid:
- **Fill evenly**: assigns teams so each team gets an equal count (±1), no team
  twice in a day, and no team on the same meal two days running. It's a pure
  function with tests, offered as a preview with Apply / Cancel.
- **Fairness line**: "Each team cleans 2–3 times. Maples clean twice on
  Thursday."

It writes `setup/cleanup/dN/<Meal>/<tid>: true`.

### 4.12 Electives (junior; `CAMP.features.electives`)

For each competition day there are three slot columns (Elective 1/2/3, whose
times come from the Elective-kind schedule items). Each slot lists
**stations**: emoji + name, picked from a station list or created inline. Each
station lists the **people** there, as chips picked from the People list (a
counselor search), with "+ Someone not on the list" for game leaders without
accounts.

Two helpers: **"Same as Monday"** (a per-day ⋯ action that copies the slot
setup) and a **Break** line computed automatically ("On break: Lydia, Zac")
from today's `electiveBreakKids` logic. ("Kids" in that code means counselors;
the UI says "On break".)

People are stored by **member key** when chosen from the list. A name-only
person (the seed's game leaders, or anyone typed) is stored as `n-<slug>`.
This ends the Sofia/Sofie spelling-join problem going forward. A signed-in
counselor's own electives match on their member key, with the name as a
fallback.

### 4.13 Games, attached to the schedule

The Games screen is organised **by the schedule**, not by Morning/Evening.

```
GAMES · 22 on 10 schedule items
  MONDAY
    10:00  🏅 Team competitions
           🛡️ Shields            Podium        [›]
           🦘 Kangaroo Kickball   Bracket       [›]
           + Add a game here
    18:00  🏅 Evening competition
           🚢 Human Battleship    Podium
  …
  NOT ON THE SCHEDULE · 1
           🎳 Rain bowling        Scores   [Put on the schedule…]
                                         [+ New game]
```
- Rows can be reordered within an item with "Move up/down" in the ⋯ menu
  (`ord`), or moved anywhere with **Move to…**. This is the same picker the
  Rain plan uses.
- **The game sheet** keeps today's fields and validation (`validateGameDraft`)
  but discloses them progressively:
  1. **Name, emoji, where** (location, defaulting to the item's last-used
     location).
  2. **How is it scored?** Three choice rows with a sentence each:
     *Bracket*: "Teams play head-to-head; winners move on." *Scores*: "Type a
     number for each team; the app ranks them." *Podium*: "Just pick 1st, 2nd
     and 3rd." On senior (4 teams), Bracket says "2 semifinals → 3rd-place
     match → final".
  3. The format's own options (unchanged from today: unit, lower wins, m:ss,
     counter buttons, live leaderboard; live scoreboard periods/outs).
     **New for brackets:** "Matchups" with three choices: *Pick them when you
     start* (default; the start screen suggests pairs from the standings),
     *Set them now* (two pair pickers on senior, three pairs on junior, which
     replaces the JSON-only `roundOneMatchups`), and *By standings* (1st v 4th,
     2nd v 3rd).
  4. **Extras** (collapsed): countdown timer, drawing prompts, **Double
     points**.
  5. **How to play** (rule sections), unchanged.
  6. **When:** a read-only line, "Tuesday · Team competitions 10:00–11:45", with
     "Move…".
- **Saving writes only the fields that changed** (section 6.3). If another
  editor changed a different field meanwhile, both survive (scoring#3). If
  they changed the same field, a choice appears inline. If they **deleted the
  game**, the sheet says "Patrick deleted this game 2 min ago" (Put it back
  with my changes / Close).
- **Changing the format of a game that has started** says exactly what will be
  discarded ("the saved podium, the bracket in progress, the live
  scoreboard") and removes all of it: result, bracket, draft, live, clock.
  This finishes scoring#6.
- **Deleting a game** removes its results, bracket, draft, picSetup, live
  **and clock** (today's `deleteGame` leaks `clocks`). It is preceded by an
  automatic restore point when the game has a result.

### 4.14 The 4-team bracket (game day, not setup)

This is what refs see when a senior tournament game starts. It reuses
`matchupCalloutHTML`, `matchTrackerHTML`/`bindMatchTracker` and the live
tracker unchanged.

- **Start screen**: "Suggested by points right now: 🔴 Red v 🟡 Gold · 🔵 Blue
  v 🟢 Green" with [Start with these] [Choose different]. If the game has fixed
  matchups, those show instead, with no choice. Ties in the standings break by
  `rankTeamsByPoints` order, then team id.
- **Step bar**: `Semifinal 1 → Semifinal 2 → 3rd place → Final → Results`.
- **Semifinals**: a two-row "match order" list (the existing `.matchup-order`
  look): ✓ done with the winner, NOW, then up next.
- **3rd place**: the two semifinal losers. The **Final**: the two winners.
  Order: 3rd place first, the final last.
- **Summary**: 🥇 final winner, 🥈 final loser, 🥉 3rd-place winner. Saving
  stores the medals **and the bracket path** in the result
  (`results[gid].path`), so "Clear result & re-enter" can offer "Reopen the
  final" instead of starting over.
- **Undo the last match** exists at every step, not just round 1.
- **Stale double-tap guard**: a winner tap re-reads `state.brackets[gid]` and
  is ignored, with a toast "Already recorded by Jenn", if that match is
  already decided.
- **Own-team guard** (`canScoreRound`) applies to every match, as in 6-team.
- **No render-time writes.** The phase is derived from which matches have
  winners, never advanced inside a render function (contrast today's
  `renderBracketRound1`).

The 6-team wizard keeps its flow. It gets the same Undo-at-every-step and the
stale-tap guard, because both come from the same extracted pure helpers
(5.10).

### 4.15 Notice board, Backups & restore points

- **Notice board**: today's Notice tab editor (`renderNoticeTab`), moved under
  the hub unchanged. Its form keeps the `nb-` prefixes.
- **Restore points & backups**:
  - "Restore points" lists rows like "Before the new-year setup · Jenn · Jul 11,
    9:12 PM", "Auto-save while Patrick edited the schedule · 2:03 PM" and
    "Before restoring 'Tuesday 9 AM' · …", newest first, with automatic and
    named points mixed. ⋯ on a row offers **Name and keep** (pin) and
    **Delete**.
  - Tapping a point shows **what would change** (e.g. "Tuesday's schedule (4
    items), 2 games, team names") with **[Restore setup]** and, behind a
    switch, **[Also restore scores]**. Restore takes a "Before restoring" point
    first and is undoable through it.
  - "Save a restore point now" (named).
  - "Past years" lists archive entries, each with its winner line and
    "Download".
  - "Download a backup file" (today's `backupJSON`, now including `notice`,
    `meta`, `clocks` and a `camp` id) and "Restore from a file" (today's
    `tryImport`, which now refuses a backup from the other camp: "This backup
    is from Senior camp").
  - **Advanced** (collapsed, editor-only, with a warning line): per-section
    "Use the built-in copy instead" switches. This is the emergency rollback
    of section 12.4.

### 4.16 Things outside the builder that change

- **Denied screen** (the "ask a director to add you" panel in index.html,
  shown by `denyMemberFinal`) gains **Ask to join** (4.17).
- **Schedule sheet** (home): adds **Add the whole week to my calendar**
  (section 11.2) and, for editors, **Change today's plan** (4.5). Games appear
  under the item they're attached to.
- **Happening Now**: unchanged in look. It reads `blocksForDow()`. During a
  Games-kind item it can name the attached games: "🏅 Team competitions · Axe
  Throwing, Bowling" (owner decision 17.10; default on).
- **Phone alerts drawer**: in data mode, "Starts on (a Sunday)" becomes a
  read-only line. The block list comes from the resolved week, using stable
  keys (section 10).
- **Footer chip** "👥 N here": unchanged for everyone.

### 4.17 Walk-up "Ask to join" (requester's side)

On the denied screen, under today's text:

```
You're signed in as taylor.reed@gmail.com, but you're not on the list yet.
Your name        [Taylor Reed          ]
Which camp       (•) Junior  ( ) Senior
Anything to add  [I'm with the Foxes   ]   (optional, 200 chars)
                 [Ask to join]
```
- Submitting writes `accessRequests/<myKey>` on the chosen camp's root (one
  write, no listener) and shows: "Sent. A director will let you in. **This
  page will open by itself** once they do. You can close it and come back."
- While that screen is visible, it **polls** `members/<myKey>` with `once()`
  every 30 seconds and on focus. A refused `once()` is harmless, which keeps
  THE INVARIANT: no listener attaches before approval. It polls the camp the
  person picked. When the read succeeds, it sets
  `localStorage.campScoreboardActiveCamp` to that camp and reloads, with the
  one-shot lifecycle.
- If they're denied in the camp they picked but approved in the other, the
  existing `denyMember` bounce still applies.
- Abuse limits come from the rules: one row per identity per camp, capped
  sizes, at most one update a minute (section 8).

---------------------------------------------------------------------
## 5. The data model those screens need

### 5.1 Where everything lives (per camp root R = `campScoreboard` | `seniorScoreboard`)

| Node | Holds | Read | Write | Listener | Cached on device? | Size (junior) |
|---|---|---|---|---|---|---|
| `R/state` (existing) | scores, brackets, live, clocks, bonuses, announcements, notice, meta, **`teams` mirror** | member | editor | every device (existing) | yes (`STORAGE_KEY`) | ~13 KB in camp week |
| `R/config` (existing) | **legacy mirror** of days/games for old builds after games move | member | editor | every device (existing) | yes | ~17 KB |
| **`R/setup`** (new) | week dates, days, typical day, per-day changes/one-offs, teams' identity, meals, verses, cleanup rota, electives, games | member | editor | every device, after approval | yes (`campScoreboardSetupV1`) | ~32 KB |
| **`R/campers`** (new) | camper first names per team | **editor** | editor | editors, only while Campers/People/Teams screens are open | **never** | ~3 KB |
| **`R/teamPhotos`** (new) | one compressed image per team | member | editor | none: `once()` when `setup/teams/tN/photoV` changes | IndexedDB (existing photo store) | ≤ 150 KB each |
| **`R/editing`** (new) | who is in the builder, and where | editor | own row | editors, only while the builder is open | no | < 1 KB |
| **`R/accessRequests`** (new) | walk-up "ask to join" rows | editor | the requester's own key (non-member) / editor delete | editors (small) | no | < 1 KB |
| **`R/restoreIndex`** (new) | restore-point list entries | editor | editor | none: `once()` when the Restore screen opens | no | ~150 B each |
| **`R/restorePoints`** (new) | restore-point bodies (one JSON string each) | editor | editor create / delete | none | no | ~50 KB each |
| **`R/archive`** (new) | past years (one entry per camp week) | editor | editor create / delete | none | no | ~50 KB/yr |
| **`R/pushChanges`** (new) | schedule-change alerts handed to the Worker | editor | editor create-only | none (Worker reads as admin) | no | < 1 KB each |
| `R/members`, `presence`, `pushSchedule`, … (existing) | unchanged shapes; `presence` gains an optional `v`; `pushSchedule` later gains `rev` | | | | | |

**Why a new sibling `setup` node, not `config` or `state`:**
- `config` is written by every **old cached build** as a whole-node `set()` of
  exactly five keys (`pushConfig`, `CONFIG_KEYS`). Anything new in it gets
  pruned, and its arrays can't change shape in place: old builds reset a
  non-array `games` to `[]`.
- `state` is sealed to `SYNC_KEYS` and pushed as one atomic multi-path
  `update()`. A new key written before the rules allow it would wedge **score**
  sync, the poison-path hazard.
- A sibling node with its own listener degrades alone, as chat and push already
  do. Old builds never touch it.
- Per-path writes into a listened node send **only the changed paths** to other
  devices, not the whole node. Today's whole-node `config` `set()` re-sends 17
  KB to every device on every edit. Per-field writes are also cheaper.

### 5.2 The `setup` tree, exactly

All maps are keyed by **non-numeric** ids, so RTDB never turns them into
arrays. Day keys are `d0`…`d6` (Sun…Sat), the same `'d'+dow` scheme
`config.days` already uses (`d1`…`d5`).

```js
R/setup = {
  meta: {
    v: 1,                                   // schema version of this node
    on: { schedule: true, meals: true, verses: true, cleanup: true,
          electives: true, teams: true, games: true },   // section switches (5.3)
    season: '2027',                         // display label
    epoch: 'e-lx3k9a2b',                    // changes on every new-year clear (6.9)
    weekStart: '2027-07-18',                // the Sunday, camp time
    double: { from: { dow: 4, min: 1020 }, to: { dow: 6, min: 0 } },   // optional
    finaleDow: 5,                           // optional; TV champion celebration day
    skip: { campers: true },                // "Not using this year" (hub)
    edited: { schedule: { at: <server ms>, byKey: '<memberKey>' }, … },  // per-section stamp
    wizard: { season: '2027', step: 3, byKey: '…', at: <server ms> },     // resumable lock
    seeded: { at: <ms>, byKey: '…', from: 'code' | 'archive:a-2026-07-19' | 'restore:<id>' },
  },

  days: {
    d0: { tag: 'Arrival day', typical: false, competition: false },
    d1: { tag: 'Competition day 1', typical: true, competition: true },   // note?: '…' (omitted when empty)
    …
    d5: { tag: 'Messtival & Team Skits', typical: true, competition: true },
    d6: { tag: 'Send-off', typical: false, competition: false, stub: true },  // senior seed marks stubs
  },

  typical: {                                // THE typical day
    'b-team-competitions-600': {
      start: 600, end: 705, label: 'Team competitions', emoji: '🏅',
      type: 'games',                        // 'activity' | 'games' | 'elective'  (legacy field, kept verbatim)
      ord: 50,                              // tie-break for equal starts (5.4)
      alertKey: 'team-competitions',        // phone-reminder key; never changes on rename
      // optional: slot (0|1|2, elective), meal ('breakfast'|'lunch'|'supper'),
      //           noTime: true, overlapOk: true
    },
    …
  },

  dayBlocks: {                              // one-offs on a typical day, and ALL items of a non-typical day
    d2: { 'b-d2-boys-cabin-movie-night-1275': { start: 1275, end: 1320, …, overlapOk: true } },
    d0: { 'b-d0-registration-840': { … }, … },
  },

  patches: {                                // per-day changes to typical items
    d2: {
      'b-snack-and-campfire-1200':        { label: 'Snack and campfire — Cam' },
      'b-rising-bell-shower-morning-450': { label: "Rising bell, shower & morning meeting (Laura's cottage) — …" },
    },
    d5: { 'b-evening-competition-1080': { off: true }, … },
  },

  teams: {
    t0: { name: 'Ferocious Foxes', short: 'Foxes', emoji: '🦊',
          accent: '#e2672b',                // legacy single colour (seeded); OR
          // color: 'pumpkin',               // a palette id (Appendix A) — wins over accent
          crest: 'images/team-shields/ferocious-foxes.webp?v=5',   // repo crest (junior seed)
          photoV: 1784012345678 },           // present ⇒ teamPhotos/t0 holds an uploaded photo
    …
  },

  meals:   { d1: { breakfast: { dish: 'Eggs and Bacon', emoji: '🥓' }, lunch: {…}, supper: {…} }, … },
  verses:  { theme: { title, text, ref }, d1: { text, ref }, d4: { text, ref, video: 'https://youtu.be/…' }, … },
  cleanup: { d1: { Breakfast: { t5: true }, Lunch: { t4: true }, Supper: { t0: true } },
             d5: { Breakfast: { t3: true, t4: true }, … } },       // keys keep today's capitalised meal names
  electives: {
    stations: { 's-crafts-with-eileen': { name: 'Crafts with Eileen', emoji: '🎨' }, … },
    d1: { e0: { 's-crafts-with-eileen': { ord: 10,
                  people: { 'alysa,x@gmail,com': { name: 'Alysa', ord: 10 },   // member key
                            'n-lilly':            { name: 'Lilly', ord: 20 } } } },  // name-only
          e1: {…}, e2: {…} },
  },

  games: {
    'axe-throwing': {                       // id unchanged from config.games
      name, emoji, location, headline, format, rules: [{ h, items: [] }], messtival?,
      unit?, lowerWins?, timeInput?, counterSteps?, counterStepLabels?, counterAllowNegative?,
      liveRankings?, prompts?, timer?, liveTracker?, ladderScoring?, roundOneMatchups?,
      dow: 3, blockId: 'b-team-competitions-600', ord: 10,      // NEW: attachment
      bracket4?: { seed: 'pick' | 'fixed' | 'standings', m1?: { a, b }, m2?: { a, b } },  // NEW
    },
    …
  },
}
```

**Field notes**
- `type` keeps today's three values exactly, so the **legacy block shape**
  `{start,end,label,emoji,type[,slot][,noTime]}` comes out of the resolver
  unchanged (5.5). Meals are `type:'activity'` plus a `meal` tag, which is why
  "Meal" in the item sheet sets the tag rather than a new type.
- Game arrays that are **leaf values** (`rules`, `counterSteps`,
  `timer.presets`, `prompts`, `roundOneMatchups`) are written whole by the
  diff (6.1). Two editors editing two different rule sections of one game is
  rare enough to accept last-writer-wins on that one field.
- `teams` holds identity only. `counselor` free text is retired in data mode:
  counselors come from `members` (`counselorName` already prefers the
  directory). Team **ids are the slots** `t0…t(N-1)` and never change.
- The `cleanup` keys keep `Breakfast|Lunch|Supper`, because existing bonus ids
  are `cleanup-<team>-<dow>-<Meal>` (`setCleanupPoints`). The `meals` keys keep
  lowercase because `MEALS` does. Each section keeps its predecessor's
  conventions, so seeding is lossless and consumers change as little as
  possible.

### 5.3 Section switches, and "absence means empty"

`meta.on.<section>` decides, **per section**, whether consumers read the
setup tree or the built-in copy (camps.js / live config):

| Section | Covers | Built-in source when off |
|---|---|---|
| `schedule` | `days/*/{tag,typical,stub}`, `typical`, `dayBlocks`, `patches`, `meta.weekStart/double/finaleDow` | `DAY_SCHEDULE`, `SCHED_DAYS`, `pushSchedule/weekStart`, `DOUBLE_BONUS_*` |
| `meals` | `meals` | `MEALS` |
| `verses` | `verses` | `MEMORY_VERSE_THEME`, `MEMORY_VERSES` |
| `cleanup` | `cleanup` | `MEAL_CLEANUP_SCHEDULE` |
| `electives` | `electives` | `ELECTIVES`, `STATION_EMOJI`, `ELECTIVE_SLOT_MIN` |
| `teams` | `teams` | `state.teams` + `TEAM_EMOJI/SHIELD/ACCENT/ABBREV` |
| `games` | `games`, `days/*/{competition,note}` | `config.games`, `config.days` |

- **When a section is on, its subtree is the whole truth:** a missing key means
  empty. This sidesteps the RTDB "can't store empty" problem without
  sentinels. An empty rota is simply no `cleanup` key, and a day with no items
  is no `dayBlocks/dN` and no typical day. There is no fallback to camps.js
  *within* a section that is on.
- **Turning a section on** is one `commitSetup` that writes the seeded subtree
  **and** `meta/on/<section>: true` in the same atomic `update()`. Readers never
  see a half-seeded section.
- **Turning a section off** (the Advanced rollback in 4.15) writes only
  `meta/on/<section>: false`. The data stays, and consumers go back to the
  built-in copy at once on every device. Off is an emergency valve, not a
  workflow.
- The section switches let each stage of section 13 cut over one area at a
  time, and let junior and senior switch independently.

### 5.4 Ids, and making them deterministic

| Thing | Id | Minted |
|---|---|---|
| Seeded block | `b-` + slug(head label, ≤ 24) + `-` + start, e.g. `b-team-competitions-600`; one-offs and standalone days add the day: `b-d2-boys-cabin-movie-night-1275` | by `seedSetupFromCamp`, **deterministic** (two devices seeding at once write identical values) |
| New block | `b-` + 8 random base36 | on create |
| Game | unchanged (existing slug ids; new ones via today's `makeId`, still avoiding ids present in `results`) | |
| Camper | `c-` + 8 random base36 | on create |
| Station | `s-` + slug(name, ≤ 30) | on create / seed |
| Elective person | the member key, or `n-` + slug(name) | |
| Restore point / archive | RTDB push id / `a-<weekStart>` | |
| Epoch | `e-` + base36(ms) + 2 random | wizard step 4 |

- **`head label`** is `pushHeadLabel()` (push.js): the text before " — " or
  " (". It's the same function today's phone-alert keys use, so the seeded
  `alertKey` equals today's `pushBlockKey(label)` for every block. **Every
  existing phone subscription keeps working after the switch.**
- **`ord`** is a number. The resolved day sorts by `(start, ord)`. Seeding sets
  each typical block's `ord` to 10 × its index in Monday's array. An inserted
  one-off gets the `ord` of the next typical block that day minus 5, which is
  how Tuesday's movie night (21:15) sorts before "Prepare for bed" (21:15) and
  keeps winning Happening Now. New blocks get the midpoint of their
  neighbours. When two neighbours are less than 1e-6 apart, that day's ords
  are renumbered (rare; one update).
- Block ids are unique **within a day's resolved plan**: typical ids and that
  day's own ids never collide, because own ids carry the day prefix or are
  random. The identity of "this item on this day" is `(dN, blockId)`. Games
  and push records use that pair.

### 5.5 Resolving a day (the one function every consumer goes through)

```js
// pure; in setup.js
function resolveDay(tree, dow) {
  const key = 'd' + dow;
  const day = (tree.days || {})[key] || {};
  const out = [];
  if (day.typical) {
    const patches = (tree.patches || {})[key] || {};
    Object.keys(tree.typical || {}).forEach((id) => {
      const p = patches[id] || {};
      if (p.off) return;
      out.push(Object.assign({ id, oneOff: false, changed: !!Object.keys(p).length },
                             tree.typical[id], p));
    });
  }
  const own = (tree.dayBlocks || {})[key] || {};
  Object.keys(own).forEach((id) => out.push(Object.assign({ id, oneOff: !!day.typical, changed: false }, own[id])));
  out.sort((a, b) => a.start - b.start || (a.ord || 0) - (b.ord || 0) || (a.id < b.id ? -1 : 1));
  return out;   // "rich" blocks
}
function legacyBlock(b) {             // exactly today's DAY_SCHEDULE entry shape and key order
  const o = { start: b.start, end: b.end, label: b.label, emoji: b.emoji, type: b.type };
  if (b.slot !== undefined) o.slot = b.slot;
  if (b.noTime) o.noTime = true;
  return o;
}
```
- A patch may set `start`, `end`, `label`, `emoji`, `type`, `slot`, `meal`,
  `noTime`, `overlapOk`, `off`. A patch field equal to the typical value is
  removed on write (`commitSetup` normalizes), so patches stay minimal and
  "Changed for Tue" is honest.
- The sort is stable and total (the id is the last tie-break), so two devices
  always agree on the order. First-match-wins in `nowBannerHtml` therefore
  behaves the same everywhere.
- **Verified lossless** (Appendix C): `resolveDay(seedSetupFromCamp(CAMP), d)
  .map(legacyBlock)` deep-equals `DAY_SCHEDULE[d]` for d = 0…6 in both camps.
  This is pinned by tests.

### 5.6 Seeding (`seedSetupFromCamp`), and the junior-identical guarantee

`seedSetupFromCamp(camp, live)` is pure. `camp` is the `CAMP` profile; `live`
is `{config, teams, weekStart}` read from the device's current synced state:
- **schedule**: the typical day = Monday's array (dow 1). For each other day
  1…5, each block is matched to an unused typical block with the same
  `start, end, type, slot, noTime` **and the same head label**. A label or emoji
  difference becomes a patch. An unmatched typical block becomes `off: true`.
  An unmatched day block becomes a one-off, with `ord` as in 5.4. Sunday and
  Saturday become standalone days (`typical: false`). Days with no
  `DAY_SCHEDULE` entry get no blocks. `days.dN.tag` comes from `SCHED_DAYS`.
  (`competition` and `note` are seeded later, by the **games** seed below.)
  - The head-label rule matters. Without it, junior Friday's "Team Skits"
    (19:00–20:00) would be stored as a patch of Monday's "Evening service"
    (same shape) and inherit its reminder key. With it, Friday ends up with 8
    `off` patches and 10 one-offs (its whole evening), and every reminder key
    stays what it is today.
- **meals / verses / cleanup / electives**: straight copies with the
  conventions in 5.2. Electives: stations from `STATION_EMOJI` + station
  names; people as `n-<slug>` unless a directory member with that exact name
  and that camp is on file (then the member key). `ord` keeps the seed order.
- **teams**: for i < `teamCount`, `tI` takes `name` from the live
  `state.teams[i]` (not the default list, since a running week may have
  renamed teams), `short` from `TEAM_ABBREV`, `emoji` from `TEAM_EMOJI`,
  `accent` from `TEAM_ACCENT` (a legacy hex, so the colour doesn't change at
  the switch), and `crest` from `TEAM_SHIELD`.
- **games**: from the live `config.games` (not `defaultConfig()`), with every
  field kept, plus `dow` (from the game's config day, looked up by id, so a
  builder-added day id like `d-lx3k` still resolves), `blockId` (5.7) and
  `ord` (its index in `config.games`, × 10). The same seed writes
  `days/dN/competition: true` and `days/dN/note` for every live `config.days`
  entry with a `dow`. A config day with no `dow`, or two config days sharing
  one, leaves its games unscheduled with a hub ⚠️ naming the day. A game whose id fails
  `^[a-z0-9-]{1,40}$` is skipped and reported as ⚠️ "1 game couldn't be moved:
  *X*". (None of today's ids fail.)
- **meta**: `weekStart` from `pushSchedule/weekStart` if present. `double`
  for junior is `{from:{dow:4,min:1020}, to:{dow:6,min:0}}`, which equals
  today's `DOUBLE_BONUS_START/END` (Thu 17:00 EDT → Sat 00:00 EDT); senior
  gets none. `finaleDow: 5`. `epoch` is minted. `season` is the year of
  `weekStart`, or the current year.
- The camps.js constants are **not edited or removed**. They stay the seed,
  the built-in copy, and what `tests/camps.test.js` pins against
  `fixtures-junior-week.json`. Junior is byte-identical until an editor turns
  a section on. Because seeding is lossless, it stays visually identical
  after.

### 5.7 Attaching existing games to blocks (the backfill rule)

For each game with a known `dow`, pick the first that applies:
1. a **timed** block that day whose head label equals the game name
   (case-insensitive): junior "Team Skits" → Friday's 19:00 "Team Skits";
2. a **`type:'games'`** block whose head label contains the game name: senior
   "Legacy Game" → 16:50 "Legacy Game" (never the 16:40 "Cool down & prepare
   for the Legacy Game", which is `activity`);
3. by `session`: **Morning** → the first games block before 12:00;
   **Afternoon** → games blocks 12:00–16:59 whose label contains the game
   name's first word, else the first of them; **Evening** → the first games
   block from 17:00;
4. otherwise no `blockId` (shows under "Not on the schedule", hub ⚠️).

`CAMP.gameBlockOverrides` (`{gameId: blockId}`, empty in both profiles today)
lets a profile pin an exception without code changes to the rule.

**Verified:** 22/22 junior and 25/25 senior games land on the intended block
(Appendix C). That includes the two today's heuristic gets wrong: senior
Afternoon games, and junior Team Skits.

### 5.8 Teams: identity in `setup`, a mirror in `state.teams`, photos beside

- **Readers** (data mode) use `setup/teams` through accessors (section 9).
- **The mirror:** `state/teams` stays `[{id, name, short, counselor}]`, written
  whole like today (a `SYNC_SINGLETON`). Three readers still need it: old
  cached builds, the Worker (`campTeams` reads `state/teams`; it gains `short`
  for the "Red" fix in section 14), and the TV page until stage 7. The mirror
  is **derived**. Any editor device in data mode, once both
  `setupReady && remoteReady`, not mid-entry, and finding that the derived
  array differs from `state.teams` (compared in canonical form), assigns it
  and calls `saveState()`. Two editors converge, because both derive from the
  same merged setup. Old builds only write `teams` from the classic Teams tab,
  which is hidden in data mode once they reload.
  - `counselor` in the mirror is the directory's staff names joined with "/",
    or "—" when there are none. It is never left undefined, because an old
    build's `normalizeSyncedState` refills an undefined counselor with 2026
    text.
- **Photos:** `teamPhotos/tN = {v, data}`, where `data` is a
  `data:image/png;base64,` or `data:image/jpeg;base64,` string of at most 200 000
  chars. The client exports **PNG when the source has transparency** and
  JPEG otherwise. If a PNG is over the cap, it is re-exported as JPEG painted
  on the team's light tint. Long edge 480 px. It reuses `shrinkToDataUrl` /
  `loadImage` / `canvasToJpeg`, adding a `canvasToPng` sibling. An upload is
  one multi-path `update()` at the camp root: `teamPhotos/tN = {v, data}` +
  `setup/teams/tN/photoV = v` (v = `Date.now()`). Devices fetch with `once()`
  only when `photoV` differs from the version cached in IndexedDB (the
  existing `photoDB` store, key `team:tN`, wiped by `clearPhotos`).
- **Precedence** for the crest shown on the follow card and the TV page: the
  uploaded photo, then the repo `crest` (junior's shipped shields), then
  nothing (emoji only). Every image source passes `chatSafeImageSrc`-style
  laundering inside the accessor (`data:image/(png|jpeg)` or the
  `images/team-shields/` pattern only).

### 5.9 Campers

```js
R/campers = {
  t0: { 'c-k3j9x0aa': { name: 'Maya', ord: 10 }, … },
  t1: { … },
}
```
In memory only: `camperTree`, attached with `.on('value')` only while a
screen that shows campers is open, and only when `canEdit()`. Detached on
close. Its error callback sets `campersDenied` and degrades **campers only**,
never `fbRef`/`syncDenied`. It is never written to localStorage, `STORAGE_KEY`,
backups, restore points or archives (owner decision 17.5 could allow
editor-only archives). Moving a camper is one atomic update (delete + create).

### 5.10 The other new nodes

```js
R/editing/<memberKey>/<deviceId> = { at: <server ms>, where: 'schedule:d2' }   // ≤ 60 chars
R/accessRequests/<identityKey>   = { name: 'Taylor Reed', note?: 'Foxes', at: <server ms> }
R/restoreIndex/<id>  = { at, byKey, kind: 'auto'|'named'|'pre-new-year'|'pre-restore'|'pre-import'|'pre-delete',
                         label: 'Before deleting Axe Throwing', bytes: 48211, pinned?: true, season?: '2027' }
R/restorePoints/<id> = "<JSON string: {v:1, camp, at, setup, state, config}>"
R/archive/<a-2026-07-19> = { at, byKey, label: '2026', body: "<JSON string>",
                             summary: { winner: 't0', teams: { t0: { name, points }, … } } }
R/pushChanges/<id>   = { at, byKey, date: '2027-07-21', dow: 3,
                         items: { 'b-team-competitions-600': { key: 'team-competitions', emoji: '🏅',
                                    was: { start: 600, label: 'Team competitions' },
                                    now: { start: 795, label: 'Team competitions' } },   // or skipped: true
                                  … } }
```
**Pure bracket helpers** (in app.js, no DOM, tested): `bracketKindFor(n)` →
`'six'|'four'|null`; `freshBracket4(pairs)`; `bracket4Phase(b)`;
`bracket4Current(b)`; `bracket4Next(b)`; `bracket4Record(b, matchKey, winnerId)`
→ new object or `null` if stale; `bracket4Undo(b)`; `bracket4Medals(b)`;
`normalizeBracket4(b)`, called from `normalizeBracket` when `b.kind === 'four'`.
The bracket shape is `{kind:'four', semis:{m1:{a,b,winner?,loser?},
m2:{…}}, third:{a,b,winner?,loser?}?, final:{…}?}`. There is **no stored
`phase`**: it is derived, so an RTDB-pruned null can't desynchronise it. It
lives under the existing `state/brackets/<gid>` item map, so it needs **no
rules change** and merges per game like today.

### 5.11 Healing what RTDB prunes (`normalizeSetup`)

Runs after load, after every remote apply, and before the first render. In
place, the same pattern as `normalizeBracket`/`normalizeNotice`:
- ensures `meta, days, typical, dayBlocks, patches, teams, meals, verses,
  cleanup, electives, games` are objects, and `meta.on`/`skip`/`edited` are
  objects;
- **structure only.** It adds missing containers. It never rewrites a stored
  value, because a value "repair" in the tree would show up in the next diff
  and be pushed as an edit nobody made. Bad values are handled where they are
  read: `resolveDay` and the accessors skip an item whose `start`/`end` aren't
  integers in 0…1440 with `end > start`, or that is missing `label`/`type` (a
  partial item from a race); show "Untitled" for an empty label; treat an
  unknown `type` as `'activity'`; and sanitize `emoji` (else 🕒). The hub lists
  every skipped item as ⚠️ "1 broken item on Tuesday (Fix / Remove)";
- days `d0…d6` always present (`typical`/`competition` default false);
- teams `t0…t(N-1)` always present (missing names fall back to "Team N" **for
  display only**);
- games: `rules`/`rules[i].items` read as arrays when missing (the existing
  `migrateState` heals, applied in the accessor for setup games);
- leaves unknown keys alone (a newer build's field survives an older build's
  round trip within `setup`, because diffs are per path and nothing is ever
  written whole).

### 5.12 Device storage

| Key | Holds | Wiped by |
|---|---|---|
| `lsKey('campScoreboardSetupV1')` | `{v:1, tree, base, baseAt, epoch, clashes}`, written in **one** `setItem`, so the tree and its confirmed baseline can never disagree (the `_syncBase` rule) | `clearLocalData` (add to its list) |
| `lsKey('campSetupUndo')` | the undo stack (≤ 50 entries, ≤ 20 KB each) | `clearLocalData`, and on role change from editor |
| `lsKey('campSetupPendingAlert')` | a "tell people" intent made while offline | `clearLocalData` |
| IndexedDB `photoDB` `team:tN` | cached team photo + version | `clearPhotos` (existing) |
| (none) | campers | n/a |

`setMemberRole(…)` gains: when the role drops from `editor`, wipe the undo
stack and pending alert. (There is no camper cache to wipe, by design.)

---------------------------------------------------------------------

## 6. Sync and multi-editor behaviour

### 6.1 The setup engine (new file `setup.js`, loaded after app.js)

It is a **parallel engine** that copies the state engine's proven rules and
reuses its pure helpers (`syncCanon`, `syncValueAt`, `applySyncPaths`,
`syncPathsOverlap`). It is not a refactor of the state engine: the sync tests
poke the state engine's globals directly, and they are the safety net for
every CLAUDE.md invariant.

```js
// setup.js — module state
let setupRef = null, setupReady = false, setupDenied = false;
let setupTree = null;        // what this device shows/edits (normalized)
let setupLast = null;        // last tree believed on the server (optimistic, like lastSyncedTree)
let setupBase = null;        // last tree the server CONFIRMED (persisted with setupTree)
let setupBootBase = null, setupBootHadBase = false;   // captured at load
let setupPending = 0, setupPushTimer = null, setupRefetchOwed = false;
let setupFocus = new Set();  // paths bound to the focused input (6.2)
let setupRefused = {};       // section → message, after a refused write (6.1.4)

// pure
function diffTree(prev, cur, prefix)  // objects recurse; arrays/scalars are leaves; absent ⇒ null;
                                      // compares syncCanon forms, so a healed empty container never writes
function seedSetupFromCamp(camp, live)
function resolveDay(tree, dow), legacyBlock(b)
function normalizeSetup(tree)
function hubStatus(section, view)     // Appendix B

// engine
function initSetupSync()              // called from initSync() — i.e. ONLY after approval
function onSetupSnapshot(remote)
function commitSetup(mutate, opts)    // THE write path for every builder edit
function pushSetup()
function persistSetup()
function setupOn(section)             // meta.on[section] from the local tree (cached, so first paint agrees)
```

**6.1.1 Pull.** `initSetupSync()` attaches
`firebase.database().ref(dbPath('setup')).on('value', ok, err)`. It is called
from `initSync()`, so it only runs post-approval. `err` sets `setupDenied =
true` and `setupRef = null` and degrades setup only. Consumers keep the cached
tree or the built-in copy, and the sync line says "Setup can't sync". It never
touches `fbRef` or `syncDenied`.

- **First snapshot:** `setupReady = true`.
  - Server `null` → nothing on the server yet. Consumers stay on the built-in
    copy, the builder offers "Turn on shared setup", and nothing is pushed.
    There is no automatic seed: unlike `config`'s "first client seeds" branch,
    turning on is a deliberate act. If this device **had** a confirmed base,
    the empty node is a deliberate console wipe (the state engine's
    `bootHadConfirmedBase` rule): adopt empty, so consumers go back to the
    built-in copy, keep the local tree only as a "Download my setup" offer,
    and never re-seed from the cache.
  - **Epoch differs** from the cached base's epoch → a new year happened while
    this device was away. Adopt the server, keep nothing local, and if local
    had unconfirmed paths, show a toast: "Setup changed for the new year. Your
    unsent changes weren't applied. **Download them**".
  - Local unconfirmed paths exist (`diffTree(bootBase, local)` non-empty) →
    **three-way merge, per path** (same algorithm as `firstSnapshotMerge`):
    `mine = diff(base, local)`, `theirs = diff(base, server)`. Keep mine
    unless a path overlaps theirs (server wins). Conflicts are **kept, not
    dropped**: each `{path, mine, theirs}` goes into `clashes` (persisted)
    and the toast says "1 change you made offline clashed with Patrick's;
    kept his. **See mine**". "See mine" opens a sheet listing each clash in
    words ("Tuesday · Swim · starts: yours 3:00 PM, Patrick's 2:30 PM"), each
    with **Use mine**, which applies it as a normal `commitSetup` with undo. The
    `meta/edited/*` stamps are always "newest wins", like
    `meta/lastDataChangeAt`. The 36-hour rule applies: work unconfirmed for
    over 36 h asks before sending.
  - Otherwise, plain adopt.
- **Later snapshots:** `canAdoptSetup()` = `setupPending === 0`. If false →
  `setupRefetchOwed = true`, and `idleRetryTick` (existing, 1 s) re-reads with
  `setupRef.once('value')` when quiet. That's the existing re-read rule: never
  replay a stashed payload.
  - Adopt = `remoteNorm = normalizeSetup(clone(remote))`. If
    `canon(remoteNorm)` equals `canon(setupLast)`, it's an echo: **keep the
    live objects** and don't re-render (the identity-preserving rule). Else
    `setupTree = remoteNorm` **with the focused paths overlaid from the local
    tree** (6.2), `setupLast = remoteNorm`, `setupBase = remoteNorm`. Then
    persist, then `onSetupChanged(changedPaths)` → builder patches + home
    `renderAll()`.
  - A remote change to a focused path is remembered in `setupFocusOwed[path] =
    remoteValue`, and the field shows a small inline line: "Patrick just
    changed this to 2:30 PM (Use his / Keep yours)". On blur without a choice,
    keeping yours is a later write, so yours wins, and an undo entry records
    his value.

**6.1.2 Push.** All writes go through `commitSetup(mutate, {label, section,
undo = true})`:
1. If `!canEdit()` → refuse. If `setupOn(section)` is false and this isn't the
   turn-on commit → refuse.
2. `before = clone(setupTree)`; `mutate(draftTree)`; `normalizeSetup`; drop
   patch fields equal to the typical value.
3. `paths = diffTree(before, after)`. If empty → return.
4. (Stamps are added at push time, not here: `pushSetup` appends
   `meta/edited/<section>/at = ServerValue.TIMESTAMP` and `…/byKey = myKey`
   for each section its updates touch. The local tree holds a `serverNow()`
   estimate until the echo replaces it.)
5. Record the undo entry `{label, node:'setup', paths: {p: [before@p,
   after@p]}}` (7.1). `meta/edited/*` paths are never part of an undo entry.
6. `setupTree = after`; **`persistSetup()` immediately**. This is what makes a
   force-quit right after a tap safe: the tree is saved, and the base is
   still the last server-confirmed one, so on next load the diff is "mine".
7. `schedulePushSetup()` (300 ms debounce; `setupPushTimer`). Then patch the
   builder in place and `renderAll()` for home consumers.

`pushSetup()`: gate `setupRef && setupReady && !setupDenied && canEdit()`
(**never push before the first pull**). `updates = diffTree(setupLast,
setupTree)` (so several quick commits coalesce into one write), set
`setupLast = clone(setupTree)` optimistically, `setupPending++`, then
`setupRef.update(updates)`.
- On ack: `setupBase = applySyncPaths(setupBase, updates)` (the only way the
  persisted base advances, apart from adopt), then persist and
  `setupPending--`.
- On failure: `setupLast = prev` (the same diff is retried next time),
  `setupPending--`, then 6.1.4.

**6.1.3 Accounting (so the rest of the app knows).**
- `editorMidEntry()` adds `setupPushTimer != null`.
- `canAdoptRemote()` is unchanged for state. Setup has its own
  `canAdoptSetup()`.
- `reloadBlocked()` adds `setupPending > 0 || setupPushTimer != null ||
  builderSheetDirty()`, so a deploy auto-reload never throws away an
  unacknowledged setup write or an open dirty sheet.
- `hasUnsyncedWork()` and `hasUnconfirmedLocalWork()` add "setup has
  unconfirmed paths" (`diffTree(setupBase, setupTree)` non-empty), so the
  sign-out and camp-switch warnings cover setup.
- `flushPendingPush()` (pagehide/visibilitychange) also flushes
  `setupPushTimer`.

**6.1.4 A refused write never wedges silently.** On a refusal
(PERMISSION_DENIED or a validation failure), `pushSetup` **bisects by top-level
section**: it retries each section's paths separately. Sections that succeed
advance the base. A section that is still refused goes into
`setupRefused[section]` with a plain message ("Couldn't save Teams: the
database refused it. If the rules were just updated, tell Patrick."). The sync
line turns red, the hub row shows ⚠️, and the refused paths stay unconfirmed
locally, so nothing is lost. There is a manual "Try again", plus an automatic
retry once a minute. The same bisect-and-surface pattern is recommended for
`pushState` (a low-risk wrapper, stage 1; section 14).

### 6.2 Per-field merge: the conflict table

Granularity is **the leaf path**: `setup/typical/b-x/start`,
`setup/games/axe-throwing/headline`, `setup/teams/t3/color`, and so on.

| Situation | What happens |
|---|---|
| Two editors, different fields (even of the same item or game) | Both land. Each device applies the other's path live. |
| Two editors, same field, both online | Last writer wins at the server. The earlier writer's device sees the new value appear (or, if they're still focused in that field, the inline "Patrick just changed this" line). Undo is available to both. |
| Same field, one offline | First-snapshot merge: server wins. The offline value goes to "See mine" (6.1.1). |
| A edits an item, B deletes it | B's delete is a `null` at the item path; A's field writes then re-create a partial item. **Prevented:** `commitSetup` checks that the item still exists in `setupTree` before writing fields into it, and if not, the sheet says "Patrick removed this item" (Put it back / Discard). For a race inside the 300 ms window, `resolveDay` skips partial items missing required fields (5.11), and the hub ⚠️ lists "1 broken item on Tuesday (Fix / Remove)". |
| A moves a game (`blockId`), B deletes that block | The game keeps a dangling `blockId`. Readers resolve it to "Not on the schedule (was on Tue · Team competitions)" and the hub ⚠️ lists it. Nothing is lost. |
| A and B both "Turn on shared setup" at once | The seed is deterministic, so both write the same values. Only `meta/seeded/byKey` differs, and the later one wins. Harmless. |
| Two editors start the wizard | A `transaction()` on `setup/meta/wizard` claims it. The second sees "Jenn is setting up 2027" (4.2). |
| Rain plan on Tue (A) while B edits the typical day | A writes `patches/d2/…`; B writes `typical/…`. They are different paths, so both land. Tuesday shows B's typical change except on fields A patched for Tuesday, which is the intended meaning of "just this day". |

### 6.3 Sheets: draft lifetime, and three-way save

- **A sheet's draft lives exactly as long as the sheet is open.** Closing the
  sheet (Back, swipe down, opening another sheet, leaving the builder) asks if
  dirty, then discards. There is no module-level draft that outlives its UI,
  which fixes B1. `builderSheetDirty()` reports an open dirty sheet. It feeds
  `reloadBlocked()` only, **not** `canAdoptSetup()`: remote changes keep
  flowing while a sheet is open.
- On open, the sheet snapshots the item: `sheetBase = clone(item)`. Edits go to
  `sheetDraft`. **Save** computes `mine = diffTree(sheetBase, sheetDraft)` and
  `theirs = diffTree(sheetBase, currentItem)`:
  - paths only in `mine` → written;
  - paths in both with different values → shown inline before writing: "While
    you were editing, Patrick changed **Starts** to 10:30 (you have 10:15).
    [Keep mine] [Use his]";
  - paths only in `theirs` → already applied; the sheet's fields refresh
    in place on each snapshot for fields the user hasn't touched.
- The **game sheet** works this way over its text-mode draft
  (`toEditableDraft`): it converts the draft back with today's
  `saveGameDraft` parsing into a full game object, then diffs it against the
  `sheetBase` game. Only changed fields are written. This is the per-field
  config merge that scoring#3 asks for.

### 6.4 Rendering without wiping the editor's focus

`renderAll()` still ends with the builder render when it is open, but
**builder screens patch in place**:
- Each screen renders into stable section containers through
  `setHtmlIfChanged`. Lists use a small keyed reconciler, `patchRows(container,
  items, keyFn, rowHtml)`: it reuses an existing row element when its HTML is
  unchanged, replaces only changed rows, and moves rows to match order. It
  never touches the row that contains `document.activeElement`.
- The `<jelly-tabs>` rebuild-on-every-render in today's `renderSettings` goes
  away. The day strip is plain buttons updated with `setHtmlIfChanged`.
- Sheets re-render only their read-only parts (attached games, presence line)
  on remote changes.
- **Test:** a remote snapshot that changes an unrelated item does not replace
  the focused row's element (render-stability test with the DOM stub's
  memoized elements).

### 6.5 Presence: "Jenn is also here"

- **Write:** when the builder opens, on every screen or sheet change, and every
  4 minutes while it's open and visible, the device writes
  `editing/<myKey>/<presenceId>` = `{at: TIMESTAMP, where}`, with
  `onDisconnect().remove()` set first. On builder close, the row is removed.
  Only editors write, and only while in the builder. At about 4 editors × 15
  writes an hour, the cost is negligible.
- **Read:** an `.on('value')` on `editing` while the builder is open (editors
  only), detached on close. Rows with `at < serverNow() - 10 min` are ignored
  as ghosts. The device's own `presenceId` is excluded. Another device of the
  same member shows as "You (another device)".
- **Names come from `memberDirectory`**, never from the row. The rule fails
  closed: if the directory isn't loaded, the label is the identity
  (email/phone), as `chatAuthorName` does.
- **`where` grammar:** `hub`, `week`, `schedule:typical`, `schedule:d2`,
  `item:d2:b-x`, `rain:d2`, `games`, `game:<gid>`, `teams`, `team:t3`,
  `people`, `campers`, `meals`, `verses`, `cleanup`, `electives`, `wizard`,
  `restore`.
- **Shown:** initials in the header (4.0), one initial on the hub row for the
  section, "Patrick is also on Tuesday" on a screen, and "Patrick is editing
  this item too" in a sheet when the `where` strings match.
- **Viewers are untouched:** they keep the footer's "👥 N here" count from the
  existing `presence` node. `presence/<key>/<device>` gains an optional `v`
  (APP_VERSION) written on connect. The hub's ⋯ shows "2 devices are on an
  older version" (fleet evidence, used to decide when a fence is safe;
  section 13 stage 8).

### 6.6 Bad Wi-Fi: what is offline-safe, and what honestly isn't

| Area | Offline edit? | Survives force-quit? | Notes |
|---|---|---|---|
| Schedule, rain plan, days, week dates, double points | ✅ | ✅ | setup engine (persisted tree + base, three-way merge) |
| Teams' names, short, emoji, colour | ✅ | ✅ | setup engine |
| Games (create, edit, move, delete) | ✅ | ✅ | setup engine; the state cleanup on delete (results etc.) rides the state engine's own offline path |
| Meals, verses, cleanup rota, electives | ✅ | ✅ | setup engine |
| Team photos | ❌ needs a connection | n/a | a 150 KB string isn't worth queueing |
| People (members) | ❌ needs a connection | n/a | as today; buttons say so |
| Campers | ❌ needs a connection | n/a | deliberately never stored on a phone (privacy over offline) |
| Wizard steps 3–4, restore, archive | ❌ needs a connection | n/a | each verifies by reading back |
| "Tell people" alert | queued as an *intent*, asked again on reconnect | ✅ (intent only) | never auto-sent late: stale alerts are worse than none |

The sync line always says which state the device is in (4.0).

### 6.7 Derived mirrors, and how they converge

The setup tree is the source. Four derived copies exist for old builds and
outside readers:
1. `state/teams` from `setup/teams` + the directory (5.8);
2. `config` (days/games/sessions) from setup days + games, in the legacy shape:
   `dayId = 'd'+dow`, `session` from the block start (< 12:00 Morning, < 17:00
   Afternoon if the camp has it, else Evening);
3. `pushSchedule` from the resolved week (section 10);
4. `pushSchedule/weekStart` from `setup/meta/weekStart`.

**One rule for all four:** any editor device that is in data mode for that
section, has `setupReady` (and `remoteReady` for state), is not mid-entry, and
finds that its derived copy differs (canonical compare) from the server's,
writes it. A 10-second quiet window after the last setup commit avoids
churn. It's idempotent; two devices with the same setup derive the same copy.
An old build's write to `config` gets corrected by the next new editor device.
`pushSchedule` additionally gets the `rev` fence (section 8, stage 3b) because
old builds re-publish the **code** schedule on every load
(`pushMaybeRepublishSchedule`).

### 6.8 Two tabs of the same camp on one device (the documented limit, now closed)

Both tabs share `STORAGE_KEY` and the setup key, so either tab's cache write
can erase the other's unconfirmed delta (REVIEW-sync #10). The fix uses
**Web Locks**:
- At startup, call `navigator.locks.request('camp-writer:' + CAMP.id,
  {ifAvailable: true}, holdForever)`. The tab that gets the lock is the
  **writer**.
- A tab that doesn't get it opens as a **reader**. It shows a bar: "This camp
  is already open in another tab. Changes here are turned off. **Use this tab
  instead**". In reader mode, `saveState`/`persistSetup` don't write
  localStorage and `canEdit()` returns false.
- "Use this tab instead" requests with `{steal: true}`. The other tab's lock
  promise rejects (AbortError) → it flushes pending pushes, switches to reader
  mode, and shows the same bar.
- Where Web Locks are missing (old iOS), a `BroadcastChannel('camp-tabs:' +
  CAMP.id)` ping at startup offers the same choice. With neither API,
  behaviour is today's.

This covers both nodes' caches at once. It is mostly a laptop concern: iOS
Home Screen apps have their own storage.

### 6.9 New year vs. stale devices (the epoch)

- The wizard's step 4 writes a new `setup/meta/epoch` **and**
  `state/meta/epoch`. `state/meta` is per-field merged and its rules only
  require a branch, so no rules change is needed, and old builds carry the
  field through untouched.
- **The state engine gains one check** in `firstSnapshotMerge`: if the boot
  baseline's `meta.epoch` differs from the server's, skip the merge, adopt the
  server, and offer "Download my unsent changes" (they belong to last year).
  This closes the "phone from last July resurrects old results" hole that only
  the 36-hour `confirm()` guards today. It is small and pinned by a new
  `sync-epoch.test.js`. It must ship **before** the wizard's clear is
  possible (stage 7 ordering).
- The setup engine has the same check (6.1.1).

### 6.10 Every CLAUDE.md sync invariant, and how it survives

| Invariant | State engine | Setup engine |
|---|---|---|
| RTDB prunes empties → heal | `normalizeSyncedState` (unchanged; plus new bracket kind) | `normalizeSetup`; "absence means empty" per section (5.3) |
| Never push before first pull | `remoteReady` (unchanged) | `setupReady` gate in `pushSetup` |
| First snapshot is a three-way per-path merge with a persisted baseline | unchanged + epoch check | same algorithm; base persisted in the same `setItem` as the tree |
| Identical snapshot keeps live objects | unchanged | canonical echo check keeps `setupTree` refs |
| Concurrent editors don't clobber | unchanged (`teams` now a derived mirror) | per-leaf paths |
| `editorMidEntry` is an allowlist | unchanged + `setupPushTimer` | focused-field allowlist only; sheets don't block adoption |
| Missing snapshot key means empty | unchanged | per section, when on |
| Snapshot you can't adopt is re-fetched | unchanged | `setupRefetchOwed` + `once()` in `idleRetryTick` |
| Clock on server time | unchanged | `meta.edited.at` and presence use `ServerValue.TIMESTAMP` / `serverNow()` |
| `reloadBlocked` safety | unchanged | + setup pending / timer / dirty sheet |
| THE INVARIANT (no ref before approval) | unchanged | `initSetupSync`, campers, editing, accessRequests listeners all attach from post-approval paths; the walk-up form writes once and polls with `once()` |
| Terminal read / one-shot lifecycle | unchanged | setup/campers/editing errors degrade only themselves; role or camp changes still reload |

---------------------------------------------------------------------

## 7. Undo and restore points

### 7.1 Undo (per device, immediate, conflict-aware)

- **What's undoable:** every `commitSetup` (schedule, rain plan, teams,
  games, meals, verses, rota, electives, week dates); People actions (role,
  team, add, remove), as `node:'members'` entries with inverse writes; camper
  actions (`node:'campers'`, **in memory only**, never persisted, for
  privacy).
- **Entry:** `{id, label, at, node, paths: {path: [before, after]}}`. The
  label is human ("Moved Axe Throwing to Thursday"). Entries over 20 KB (a
  turn-on seed, a restore) aren't put on the stack; those operations are
  covered by restore points instead.
- **Undo applies `before` only where the current value still equals `after`**
  (canonical compare), the same three-way test as the first-snapshot merge.
  Paths someone else has changed since are left alone. The result is told in
  plain words:
  - all applied → snackbar "Undone";
  - some → "Undid 3 of 4 changes. Patrick has changed *Starts* since; left
    his.";
  - none → "Can't undo: Patrick has changed this since."
- **Undoing an undo** is just a new entry ("Undo: moved Axe Throwing…") on top
  of the stack. There is no separate redo.
- **Where:** in memory plus `lsKey('campSetupUndo')` (survives reload), capped
  at 50 entries. The pill shows the newest; long-press lists them, and any
  entry can be undone on its own if it doesn't conflict.

### 7.2 Restore points (shared, any editor, survive everything)

- **Contents:** `{v:1, camp, at, setup, state (SYNC_KEYS minus Pictionary
  words), config}`, stored as one JSON **string** at `restorePoints/<id>`. A
  string round-trips exactly, with no RTDB array or empty pruning. An index
  row at `restoreIndex/<id>` (5.10) goes in the same multi-path `update()`.
  Campers and members are **not** included (owner decisions 17.5 and 17.6).
- **Taken automatically before:** the new-year wizard (kind `pre-new-year`);
  restoring (`pre-restore`); importing a file (`pre-import`); deleting a game
  that has a result, deleting a schedule item that has games, resetting a day,
  or making a day stop using the typical day (`pre-delete`); turning a section
  on or off; and **"auto"**: the first setup commit after 20 minutes without a
  restore point (checked against the newest `restoreIndex.at`, read once when
  the builder opens and cached).
- **Retention:** keep every pinned (named) point, plus the newest 30 automatic
  ones. Creating a point deletes the oldest automatic point beyond 30 (body +
  index) in the same update. At ~50 KB a point, 30 points come to ~1.5 MB.
- **Restoring:** read the body once. Compute the setup diff (current →
  point) and apply it as one `commitSetup` with `undo:false`. The
  `pre-restore` point taken first *is* the undo. If "Also restore scores" is
  on, assign the point's state keys and `saveState()`; the state engine
  writes per-path deltas and `normalizeSyncedState` + `pruneOrphanedGameData`
  run first (today's `tryImport` path). Live viewers see the change arrive
  like any remote edit. A restore **never changes `meta/epoch`** (in either
  node): the current season's epoch is kept, so restoring last year's
  scores after a new-year clear can't make phones mistake the new year for
  the old one.
- **Cost:** nothing listens to `restorePoints` or `archive`. The list reads
  only `restoreIndex` (≈150 B a row), and a restore reads one body once.

### 7.3 Archive (past years)

Written by wizard step 3, one per camp week: `archive/a-<weekStart>` = `{at,
byKey, label, body (JSON string: setup + state + standings), summary}`. Bodies
are create/delete only. **Editor-read only** by default (owner decision 17.7
covers whether viewers get a "last year's winner" line). The changelog stays
append-only and is not archived or cleared. The History drawer gains a
"since this camp week started" filter (`at >= weekStart`), so a new year
starts with an empty-looking history without deleting anything.

---------------------------------------------------------------------
## 8. Security rules

### 8.1 Conventions used below

The real `database.rules.json` spells every expression out in full, and
`tests/rules.test.js` pins that style. Below, for readability only:

- `MEMBER` = `auth != null && ((auth.token.email != null && auth.token.email_verified == true && root.child('R').child('members').child(auth.token.email.toLowerCase().replace('.', ',')).exists()) || (auth.token.phone_number != null && root.child('R').child('members').child(auth.token.phone_number).exists()))`
- `EDITOR` = the same, with `.exists()` replaced by `.child('role').val() == 'editor'`
- `SELF(x)` = `auth != null && ((auth.token.email != null && auth.token.email_verified == true && x === auth.token.email.toLowerCase().replace('.', ',')) || (auth.token.phone_number != null && x === auth.token.phone_number))`
- `BRANCH` = `!newData.isString() && !newData.isNumber() && !newData.isBoolean()`
- `STR(n)` = `newData.isString() && newData.val().length <= n`; `NESTR(n)` adds `&& newData.val().length >= 1`
- `EMOJI` = `NESTR(16) && !newData.val().contains('<') && !newData.val().contains('>') && !newData.val().contains('&') && !newData.val().contains('"')`. Emoji are interpolated **raw** at about 60 call sites (`teamEmoji(...)`, `${b.emoji}` in `nowBannerHtml`). The accessor sanitizes too (section 9), so this is belt and braces.
- `INT(a,b)` = `newData.isNumber() && newData.val() >= a && newData.val() <= b`
- `R` = `campScoreboard`, and identically `seniorScoreboard` (both blocks identical modulo the root; the existing "both camps expose the same gated paths" test enforces it).

### 8.2 New and changed nodes (exact shapes)

**`R/setup`** (stage 2's rules step; inert until a client writes it)
```json
"setup": {
  ".read": "MEMBER",
  ".write": "EDITOR",
  "meta": {
    "v": { ".validate": "newData.isNumber()" },
    "on": { "$section": { ".validate": "newData.isBoolean() && $section.matches(/^(schedule|meals|verses|cleanup|electives|teams|games)$/)" } },
    "season": { ".validate": "STR(20)" },
    "epoch": { ".validate": "newData.isString() && newData.val().matches(/^e-[a-z0-9]{4,24}$/)" },
    "weekStart": { ".validate": "newData.isString() && newData.val().matches(/^20[0-9][0-9]-[01][0-9]-[0-3][0-9]$/)" },
    "double": {
      "from": { "dow": { ".validate": "INT(0,6)" }, "min": { ".validate": "INT(0,1440)" }, "$other": { ".validate": false } },
      "to":   { "dow": { ".validate": "INT(0,6)" }, "min": { ".validate": "INT(0,1440)" }, "$other": { ".validate": false } },
      "$other": { ".validate": false }
    },
    "finaleDow": { ".validate": "INT(0,6)" },
    "skip": { "$section": { ".validate": "newData.isBoolean() && $section.matches(/^[a-z]{1,20}$/)" } },
    "edited": { "$section": {
      ".validate": "newData.hasChildren(['at','byKey']) && $section.matches(/^[a-z]{1,20}$/)",
      "at": { ".validate": "newData.isNumber() && newData.val() === now" },
      "byKey": { ".validate": "SELF(newData.val())" },
      "$other": { ".validate": false } } },
    "wizard": {
      "season": { ".validate": "STR(20)" }, "step": { ".validate": "INT(1,5)" },
      "byKey": { ".validate": "SELF(newData.val())" },
      "at": { ".validate": "newData.isNumber() && newData.val() === now" },
      "$other": { ".validate": false } },
    "seeded": {
      "at": { ".validate": "newData.isNumber()" }, "byKey": { ".validate": "STR(200)" }, "from": { ".validate": "STR(80)" },
      "$other": { ".validate": false } },
    "$other": { ".validate": false }
  },
  "days": { "$d": {
    ".validate": "$d.matches(/^d[0-6]$/)",
    "tag": { ".validate": "STR(40)" }, "note": { ".validate": "STR(500)" },
    "typical": { ".validate": "newData.isBoolean()" }, "competition": { ".validate": "newData.isBoolean()" },
    "stub": { ".validate": "newData.isBoolean()" },
    "$other": { ".validate": false } } },
  "typical": { "$b": BLOCK },
  "dayBlocks": { "$d": { ".validate": "$d.matches(/^d[0-6]$/)", "$b": BLOCK } },
  "patches": { "$d": { ".validate": "$d.matches(/^d[0-6]$/)", "$b": PATCH } },
  "teams": { "$t": {
    ".validate": "$t.matches(/^t[0-9]$/) && newData.hasChildren(['name'])",
    "name": { ".validate": "NESTR(60)" }, "short": { ".validate": "NESTR(20)" }, "emoji": { ".validate": "EMOJI" },
    "color": { ".validate": "newData.isString() && newData.val().matches(/^(red|pumpkin|gold|green|forest|teal|blue|indigo|purple|berry|brown|slate)$/)" },
    "accent": { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-f]{6}$/)" },
    "crest": { ".validate": "newData.isString() && newData.val().matches(/^images\\/team-shields\\/[a-z0-9-]{1,60}\\.webp(\\?v=[0-9]{1,3})?$/)" },
    "photoV": { ".validate": "newData.isNumber()" },
    "$other": { ".validate": false } } },
  "meals": { "$d": { ".validate": "$d.matches(/^d[0-6]$/)", "$meal": {
    ".validate": "$meal.matches(/^(breakfast|lunch|supper)$/) && newData.hasChildren(['dish'])",
    "dish": { ".validate": "NESTR(80)" }, "emoji": { ".validate": "EMOJI" }, "$other": { ".validate": false } } } },
  "verses": { "$k": {
    ".validate": "$k.matches(/^(theme|d[0-6])$/) && newData.hasChildren(['text','ref'])",
    "title": { ".validate": "STR(80)" }, "text": { ".validate": "NESTR(600)" }, "ref": { ".validate": "NESTR(80)" },
    "video": { ".validate": "newData.isString() && newData.val().length <= 200 && newData.val().matches(/^https:\\/\\/(www\\.)?(youtube\\.com|youtu\\.be|vimeo\\.com)\\//)" },
    "$other": { ".validate": false } } },
  "cleanup": { "$d": { ".validate": "$d.matches(/^d[0-6]$/)", "$meal": {
    ".validate": "$meal.matches(/^(Breakfast|Lunch|Supper)$/)",
    "$t": { ".validate": "$t.matches(/^t[0-9]$/) && newData.isBoolean()" } } } },
  "electives": {
    "stations": { "$s": {
      ".validate": "$s.matches(/^s-[a-z0-9-]{1,30}$/) && newData.hasChildren(['name'])",
      "name": { ".validate": "NESTR(60)" }, "emoji": { ".validate": "EMOJI" }, "$other": { ".validate": false } } },
    "$d": { ".validate": "$d.matches(/^d[0-6]$/)", "$slot": {
      ".validate": "$slot.matches(/^e[0-2]$/)",
      "$s": { ".validate": "$s.matches(/^s-[a-z0-9-]{1,30}$/)",
        "ord": { ".validate": "newData.isNumber()" },
        "people": { "$p": { ".validate": "$p.length <= 200 && newData.hasChildren(['name'])",
          "name": { ".validate": "NESTR(60)" }, "ord": { ".validate": "newData.isNumber()" }, "$other": { ".validate": false } } },
        "$other": { ".validate": false } } } }
  },
  "games": { "$g": GAME },
  "$other": { ".validate": false }
}
```
`BLOCK`:
```json
{
  ".validate": "$b.matches(/^b-[a-z0-9-]{1,36}$/) && newData.hasChildren(['start','end','label','type'])",
  "start": { ".validate": "INT(0,1439)" }, "end": { ".validate": "INT(1,1440)" },
  "label": { ".validate": "NESTR(120)" }, "emoji": { ".validate": "EMOJI" },
  "type": { ".validate": "newData.val() === 'activity' || newData.val() === 'games' || newData.val() === 'elective'" },
  "slot": { ".validate": "newData.val() === 0 || newData.val() === 1 || newData.val() === 2" },
  "meal": { ".validate": "newData.val() === 'breakfast' || newData.val() === 'lunch' || newData.val() === 'supper'" },
  "noTime": { ".validate": "newData.isBoolean()" }, "overlapOk": { ".validate": "newData.isBoolean()" },
  "ord": { ".validate": "newData.isNumber()" },
  "alertKey": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/)" },
  "$other": { ".validate": false }
}
```
`PATCH` is `BLOCK` without the `hasChildren` requirement, without `alertKey`,
and with `"off": {".validate": "newData.isBoolean()"}`.

`GAME`:
```json
{
  ".validate": "$g.matches(/^[a-z0-9-]{1,40}$/) && newData.hasChildren(['name','format'])",
  "name": { ".validate": "NESTR(80)" }, "emoji": { ".validate": "EMOJI" },
  "location": { ".validate": "STR(80)" }, "headline": { ".validate": "STR(240)" },
  "format": { ".validate": "newData.val() === 'placement' || newData.val() === 'tally' || newData.val() === 'tournament'" },
  "dow": { ".validate": "INT(0,6)" },
  "blockId": { ".validate": "newData.isString() && newData.val().matches(/^b-[a-z0-9-]{1,36}$/)" },
  "ord": { ".validate": "newData.isNumber()" },
  "messtival": { ".validate": "newData.isBoolean()" },
  "unit": { ".validate": "STR(24)" }, "lowerWins": { ".validate": "newData.isBoolean()" },
  "timeInput": { ".validate": "newData.isBoolean()" }, "counterAllowNegative": { ".validate": "newData.isBoolean()" },
  "liveRankings": { ".validate": "newData.isBoolean()" },
  "counterSteps": { "$i": { ".validate": "newData.isNumber()" } },
  "counterStepLabels": { "$k": { ".validate": "STR(24)" } },
  "prompts": { "$i": { ".validate": "STR(80)" } },
  "rules": { "$i": { "h": { ".validate": "STR(80)" }, "items": { "$j": { ".validate": "STR(400)" } }, "$other": { ".validate": false } } },
  "timer": { "label": { ".validate": "STR(40)" }, "presets": { "$i": { ".validate": "newData.isNumber()" } },
             "rounds": { ".validate": "newData.isNumber()" }, "$other": { ".validate": false } },
  "liveTracker": { "unit": { ".validate": "STR(24)" }, "periodLabel": { ".validate": "STR(24)" }, "sideLabel": { ".validate": "STR(24)" },
                   "innings": { ".validate": "newData.isNumber() || newData.isString()" },
                   "outs": { ".validate": "newData.isNumber() || newData.isString()" }, "$other": { ".validate": false } },
  "ladderScoring": { "$k": { ".validate": "$k.matches(/^(top|mid|bottom|target)$/) && newData.isNumber()" } },
  "roundOneMatchups": { "$i": { "$j": { ".validate": "newData.isString() && newData.val().matches(/^t[0-9]$/)" } } },
  "bracket4": { "seed": { ".validate": "newData.val() === 'pick' || newData.val() === 'fixed' || newData.val() === 'standings'" },
                "$m": { ".validate": "$m.matches(/^m[12]$/)",
                        "a": { ".validate": "newData.isString() && newData.val().matches(/^t[0-9]$/)" },
                        "b": { ".validate": "newData.isString() && newData.val().matches(/^t[0-9]$/)" },
                        "$other": { ".validate": false } } },
  "$other": { ".validate": false }
}
```
Before the games rule is published, the stage-5 implementer dumps the **live**
`config/games` from both camps (REST GET) and checks every field against this
list. A live game with an unlisted field would make its seed write refused
(bisect would show it as "Couldn't save Games"). The game-field list is pinned
by a new test that walks `defaultConfig()`, `seniorDefaultConfig()` and the
builder's `saveGameDraft` output.

**How these validations behave for per-field writes.** RTDB evaluates
`.validate` only at the written location and below, never on ancestors (the
same fact behind the known `state/<unknown>/<child>` hole in CLAUDE.md). So the
key-pattern and `hasChildren` checks on `$b`/`$t`/`$g` run when an item is
**created** (the diff writes a new item whole), while later per-field writes
(`typical/b-x/start`) are checked field by field. A deep write could create a
partial item under a malformed key. Only an editor can write here, and
`resolveDay` and the accessors skip items with an invalid id or missing
required fields (and the hub flags them), so this is accepted, as it is for
`state`.

**`R/campers`**: editor-only, so the minors' names are protected by the rules
and not just by the UI.
```json
"campers": {
  ".read": "EDITOR",
  ".write": "EDITOR",
  "$t": { ".validate": "$t.matches(/^t[0-9]$/)",
    "$c": { ".validate": "$c.matches(/^c-[a-z0-9]{4,20}$/) && newData.hasChildren(['name'])",
      "name": { ".validate": "NESTR(40)" }, "ord": { ".validate": "newData.isNumber()" },
      "$other": { ".validate": false } } }
}
```
(The existing test "unused PII paths don't exist" changes deliberately: it now
asserts that `campers` exists in both roots with `.read` **equal to the
editor expression**, and still forbids `roster`/`contacts`.)

**`R/teamPhotos`**
```json
"teamPhotos": {
  ".read": "MEMBER",
  "$t": {
    ".write": "EDITOR",
    ".validate": "$t.matches(/^t[0-9]$/) && newData.hasChildren(['v','data'])",
    "v": { ".validate": "newData.isNumber()" },
    "data": { ".validate": "newData.isString() && (newData.val().beginsWith('data:image/png;base64,') || newData.val().beginsWith('data:image/jpeg;base64,')) && newData.val().length <= 200000" },
    "$other": { ".validate": false }
  }
}
```

**`R/editing`** (builder presence)
```json
"editing": {
  ".read": "EDITOR",
  "$memberKey": {
    ".write": "SELF($memberKey) && (!newData.exists() || EDITOR)",
    "$deviceId": {
      ".validate": "newData.hasChildren(['at','where']) && $deviceId.length <= 64",
      "at": { ".validate": "newData.isNumber() && newData.val() === now" },
      "where": { ".validate": "STR(60)" },
      "$other": { ".validate": false }
    }
  }
}
```

**`R/accessRequests`** (the first rule ever granted to a **non-member**; kept tiny)
```json
"accessRequests": {
  ".read": "EDITOR",
  "$reqKey": {
    ".write": "(SELF($reqKey) && newData.exists() && !(MEMBER) && (!data.exists() || data.child('at').val() < now - 60000)) || (!newData.exists() && (SELF($reqKey) || EDITOR))",
    ".validate": "($reqKey.contains('@') || $reqKey.beginsWith('+')) && $reqKey.length <= 200 && newData.hasChildren(['name','at'])",
    "name": { ".validate": "NESTR(60)" },
    "note": { ".validate": "STR(200)" },
    "at": { ".validate": "newData.isNumber() && newData.val() === now" },
    "$other": { ".validate": false }
  }
}
```
One row per identity per camp, at most one write a minute, about 300 bytes a
row. Editors (and the requester) can delete. A spammer can only ever occupy
their own verified Google or phone identity's row.

**`R/restoreIndex`, `R/restorePoints`, `R/archive`**
```json
"restorePoints": {
  ".read": "EDITOR",
  "$id": { ".write": "EDITOR && (!data.exists() || !newData.exists())",
           ".validate": "newData.isString() && newData.val().length <= 1500000" } },
"restoreIndex": {
  ".read": "EDITOR",
  "$id": {
    ".write": "EDITOR",
    ".validate": "newData.hasChildren(['at','byKey','kind','label','bytes'])",
    "at": { ".validate": "newData.isNumber() && (newData.val() === now || newData.val() === data.val())" },
    "byKey": { ".validate": "newData.val() === data.val() || SELF(newData.val())" },
    "kind": { ".validate": "newData.isString() && newData.val().matches(/^(auto|named|pre-new-year|pre-restore|pre-import|pre-delete|pre-switch)$/)" },
    "label": { ".validate": "NESTR(80)" }, "bytes": { ".validate": "newData.isNumber()" },
    "pinned": { ".validate": "newData.isBoolean()" }, "season": { ".validate": "STR(20)" },
    "$other": { ".validate": false } } },
"archive": {
  ".read": "EDITOR",
  "$id": {
    ".write": "EDITOR && (!data.exists() || !newData.exists())",
    ".validate": "$id.matches(/^a-20[0-9][0-9]-[01][0-9]-[0-3][0-9]$/) && newData.hasChildren(['at','byKey','label','body'])",
    "at": { ".validate": "newData.isNumber() && newData.val() === now" },
    "byKey": { ".validate": "SELF(newData.val())" },
    "label": { ".validate": "NESTR(40)" },
    "body": { ".validate": "newData.isString() && newData.val().length <= 2000000" },
    "summary": { ".validate": "BRANCH" },
    "$other": { ".validate": false } } }
```

**`R/pushChanges`** (read by the Worker as admin)
```json
"pushChanges": {
  ".read": "EDITOR",
  "$id": {
    ".write": "EDITOR && !data.exists() && newData.exists()",
    ".validate": "newData.hasChildren(['at','byKey','date','dow','items'])",
    "at": { ".validate": "newData.isNumber() && newData.val() === now" },
    "byKey": { ".validate": "SELF(newData.val())" },
    "date": { ".validate": "newData.isString() && newData.val().matches(/^20[0-9][0-9]-[01][0-9]-[0-3][0-9]$/)" },
    "dow": { ".validate": "INT(0,6)" },
    "items": { "$b": {
      ".validate": "$b.matches(/^b-[a-z0-9-]{1,36}$/) && newData.hasChildren(['key'])",
      "key": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/)" },
      "emoji": { ".validate": "EMOJI" },
      "skipped": { ".validate": "newData.isBoolean()" },
      "was": { "start": { ".validate": "INT(0,1439)" }, "label": { ".validate": "NESTR(120)" }, "$other": { ".validate": false } },
      "now": { "start": { ".validate": "INT(0,1439)" }, "label": { ".validate": "NESTR(120)" }, "$other": { ".validate": false } },
      "$other": { ".validate": false } } },
    "$other": { ".validate": false }
  }
}
```

**Changes to existing nodes**
- `presence/$memberKey/$deviceId`: add `"v": {".validate": "newData.isNumber()"}`
  (optional). Old builds write `{at}` and stay valid.
- `pushSchedule`: add `rev`, then require it.
  1. **Step A** (additive, published with stage 3a's rules, **before** its
     code, because the node is sealed with `$other:false` and a data-mode
     publish carrying `rev` would otherwise be refused): `"rev":
     {".validate": "newData.isNumber() && (!data.exists() || newData.val() >
     data.val())"}`.
  2. **Step B** (the fence, published with stage 3b, once stage 3a has been live for a day):
     the node's `.validate` becomes `newData.hasChildren(['weekStart','at',
     'by','blocks','rev'])`. Old builds' `pushMaybeRepublishSchedule` is then
     refused, which is exactly the point: it can no longer revert the edited
     schedule to the code copy. It is backward-**in**compatible on purpose,
     and only for a write old builds should no longer make.
- `config`, `state`, `members`, `changelog`, `chat*`, `push`, `pushAlerts`:
  **unchanged.** `state/meta/epoch` needs no rule (only `meta` itself is
  validated).

### 8.3 Publish order and backward compatibility

- **Rules ride with their stage, and go first.** For each stage that adds a
  node: commit `database.rules.json` + `tests/rules.test.js` → the owner runs
  the Cloud Shell PUT (`.settings/rules.json`, after a GET backup) → re-run the
  unauthenticated probes (plus the new ones below) → only then deploy the
  code. CLAUDE.md's "don't re-add a path before its feature" holds, because
  each node is published in the same stage as its feature.
- **Every new client feature degrades if its rules aren't live yet**, chat
  style. `setup` denied → built-in copy + "Setup can't sync". `campers` denied
  → "Campers aren't available yet". `editing` denied → no presence tags.
  `accessRequests` denied → the old "ask a director" text. `restore*` denied →
  "Restore points aren't available yet", and **destructive actions that
  require a restore point are disabled** (the wizard won't clear without one).
  None of these touch `fbRef`/`syncDenied`.
- **Old builds under the new rules:** every write an old build makes (state
  paths, the config whole-set, members, presence `{at}`, chat, push) is valid
  under the new rules. That is proven by an emulator test in the style of
  `tests/emulator/fallback.mjs`, replaying the v183 write set. The only
  deliberate exception is the stage-3b `pushSchedule` fence.
- **New probes to add to the runbook** (unauthenticated, all must return
  `Permission denied`): GET `setup`, `campers`, `teamPhotos`, `editing`,
  `accessRequests`, `restoreIndex`, `restorePoints`, `archive`,
  `pushChanges`; PUT `accessRequests/x` without a token. Signed-in probes run
  from the browser console of a test **viewer** account: GET `campers` →
  denied; GET `setup` → allowed.

---------------------------------------------------------------------

## 9. Consumers and the accessor layer (the home-screen seam)

### 9.1 The seam

A block in app.js, between `// ── SEAM: week data accessors ──` markers,
defines the **only** functions that read week data. Everything outside it
(home cards, schedule sheet, banner, chat, push, settings/builder, a future
home layout) calls these, and never `DAY_SCHEDULE`, `SCHED_DAYS`, `MEALS`,
`ELECTIVES`, `STATION_EMOJI`, `ELECTIVE_SLOT_MIN`, `MEMORY_VERSE*`,
`MEAL_CLEANUP_SCHEDULE`, `TEAM_*`, `DEFAULT_*`, `DAY_NAMES`,
`MEAL_START_MINUTES`, `DOUBLE_BONUS_*`, `CAMP.*` week fields, or
`state.config.days|games|sessions` directly. A new test,
`tests/seam.test.js`, greps app.js, chat.js, push.js and settings.js for those
names outside the marked block and fails with the line number. The existing
`const` aliases (`DAY_SCHEDULE = CAMP.daySchedule`, …) move **inside** the
block unchanged; `tests/camps.test.js` reads them by global name, which still
works. That is how the seam stays a seam after this project, and what the
pending home-layout redesign builds on.

Each accessor is two lines of logic: `setupOn(section)` (guarded `typeof
setupOn === 'function'`, so deleting `setup.js`'s script tag falls back
cleanly) → read the setup view; else → the built-in source, exactly as today.

| Accessor | Returns | Data mode source | Built-in source |
|---|---|---|---|
| `campWeek()` | `{start:'YYYY-MM-DD'|null, dates:[7], phase:'before'|'during'|'after'|'unknown'}` | `meta.weekStart` | `pushSchedule/weekStart` once push.js has read it, else null (then `phase:'unknown'` and every consumer behaves exactly as today: date-blind) |
| `weekDays()` | `[{dow, key:'dN', short, full, tag, competition, typical, date}]` ×7 | `days` | `SCHED_DAYS` + `config.days` |
| `competitionDays()` | the subset with `competition`, as `{id:'dN', name, dow, note}` (the old `config.days` shape) | `days` (games section) | `state.config.days` |
| `competitionDows()` | the dows that get a verse and a cleanup row | `days` (games section) | `[1,2,3,4,5]`, exactly today's literal loops |
| `blocksForDow(dow)` | legacy-shape array (exactly `DAY_SCHEDULE[dow]`) | `resolveDay().map(legacyBlock)` | `DAY_SCHEDULE[dow]` |
| `planForDow(dow)` | rich blocks: `{id, start, end, label, emoji(sanitized), type, slot?, meal?, noTime?, alertKey, oneOff, changed}` | `resolveDay` | seed resolve of `DAY_SCHEDULE` (same function, built-in tree) |
| `allGames()` | array of games (legacy fields + `dow`, `blockId`) | `games` sorted by `(dow, block start, ord)` | `state.config.games` |
| `gameById(id)` (existing) | one game | via `allGames` | as today |
| `gamesForBlock(dow, blockId)` | games attached, by `ord` | `games` (`blockId`) | schedule on, games off: `config.games` attached **at read time** by the 5.7 rule (already right for senior Afternoon and junior Team Skits); everything off: today's Morning/Evening heuristic, unchanged, so the built-in mode stays identical |
| `gamesForDay(dow)` | `[{block|null, games}]` grouped for the Competitions card | | session grouping as today |
| `electiveSlotStart(dow, slot)` | minutes | the elective block for that slot that day | `ELECTIVE_SLOT_MIN[slot]` |
| `electiveStations(dow, slot)` | `[[stationName, [names]]]` (today's shape) | `electives` + directory names | `ELECTIVES[dow][slot]` |
| `stationEmoji(name)` | emoji | `electives.stations` | `STATION_EMOJI[name]` |
| `mealFor(dow, block)` | `{dish, emoji}|null` | `meals[dN][block.meal]` | `MEALS[dow][label.toLowerCase()]` (today's `mealInfo`) |
| `mealStart(dow, Meal)` | minutes | the Meal-tagged block that day | `MEAL_START_MINUTES` |
| `verseTheme()`, `verseFor(dow)` | as today's objects (`video` re-checked against the https allowlist) | `verses` | `MEMORY_VERSE_*` |
| `cleanupTeams(dow, Meal)` | `[teamId]` | `cleanup` | `MEAL_CLEANUP_SCHEDULE` (today's `cleanupAssigned`, normalized to an array) |
| `teamIds()` | `['t0',…]` | `teams` keys | `state.teams` ids |
| `teamName(id)` (existing) | string | `teams[id].name` | `state.teams` |
| `teamShort(id)` | string | `teams[id].short` | `TEAM_ABBREV[id]` |
| `teamEmoji(id)` (existing) | sanitized emoji | `teams[id].emoji` | `TEAM_EMOJI[id]` |
| `teamShield(id)` (existing) | laundered src or null | photo (IndexedDB) → `crest` | `TEAM_SHIELD[id]` |
| `teamAccent(id)` (existing) / `teamAccentStyle(id)` | hex / `--team-accent-l:#…;--team-accent-d:#…` (6.4, Appendix A) | `color` palette or `accent` | `TEAM_ACCENT[id]` |
| `counselorName(id)` (existing), `teamStaffNames(id)` (existing) | as today | directory | as today (+ `team.counselor` fallback only in built-in mode) |
| `staffNames()` | every known staff first name (for mentions/identity) | directory + elective people | `TEAM_COUNSELORS` + directory |
| `doubleWindow()` | `{from:ms, to:ms}|null` | `meta.double` + `meta.weekStart` (DST-safe `etWallToEpoch`, ported from the Worker) | `DOUBLE_BONUS_START/END` |
| `finaleDow()` | 0–6 | `meta.finaleDow` or last competition day | 5 |

### 9.2 What each consumer switches to

| Consumer (today) | Reads today | Switches to |
|---|---|---|
| `nowBannerHtml` / `renderNowBanner` | `DAY_SCHEDULE[dow]`, `mealInfo`, `ELECTIVES`, `STATION_EMOJI` | `blocksForDow`, `mealFor`, `electiveStations`, `stationEmoji`; games line via `gamesForBlock` (17.10). Every-minute fuzz runs in **both** modes. |
| `renderScheduleDays` / `renderScheduleBody` | `SCHED_DAYS`, `DAY_SCHEDULE`, the 720 heuristic, `ELECTIVES` | `weekDays`, `planForDow`, `gamesForBlock`, `electiveStations` |
| `buildDayIcs` → `buildWeekIcs` | `DAY_SCHEDULE`, `campDateForDow` (today-relative), heuristic | `planForDow`, `campWeek`, `gamesForBlock` (section 11.2) |
| `myElectivesToday`, `renderMyElectives`, `electiveWxHtml`, `upcomingRainHint` | `ELECTIVES`, `ELECTIVE_SLOT_MIN` | `electiveStations`, `electiveSlotStart`; identity by member key, then name |
| `mealInfo`, `decorateMealBlock`, `mealCleanupNote`, `blockMealName` | label sniffing | the `meal` tag in data mode (`mealFor`); `blockMealName` returns the tag's Meal name |
| `renderMealCleanup`, `findNextCleanupFor`, `cleanupAssigned`, `setCleanupPoints` | `MEAL_CLEANUP_SCHEDULE`, `[1..5]` loops, `MEAL_START_MINUTES`, `DAY_NAMES` | `cleanupTeams`, `competitionDows()`, `mealStart`, `weekDays()` names; bonus ids unchanged |
| `renderMemoryVerse`, `setVersePoints` | `MEMORY_VERSE_*`, `[1..5]`, `DAY_NAMES` | `verseTheme`, `verseFor`, `competitionDows()`, `weekDays()` names |
| `renderFollowCard`, pickers, `adoptMemberTeam` | `teamShield`, `teamAccent`, `TEAM_COUNSELORS` | accessors; in data mode `adoptMemberTeam` adopts the member's name as identity unconditionally |
| Board rows (`TEAM_ACCENT[...]` at the three raw sites) | raw hex into `style=` | `teamAccentStyle(id)` |
| `renderDayTabs`, `dayGamesHTML`, `defaultDay` | `state.config.days/games/sessions` | `competitionDays`, `gamesForDay` (headings become "Team competitions · 10:00", not "Morning") |
| `liveHomeGames`, `homeBoardGame`, `upcomingMatchups`, `findNextMatchupFor`, `describeCauses`, `standingsSummaryText`, `medalCounts` | `state.config.games` | `allGames` / `gameById` |
| `bonusCountsDouble`, `inDoubleBonusWindow`, banner copy "tonight & Friday" | `DOUBLE_BONUS_*` | `doubleWindow()`; copy generated ("Double points until the end of Friday") |
| `makeFreshState`, `normalizeSyncedState` team/counselor migrations | `DEFAULT_*`, `OLD_PLACEHOLDER_*` | **gated off** when `setupOn('teams')`, so a new year's "Team 1" isn't renamed to a 2026 name, and blank counselors aren't refilled |
| chat `chatMentionTargets` | `TEAM_COUNSELORS`, `TEAM_ABBREV` | `staffNames()`, `teamShort()` |
| push.js `pushScheduleBlocks`, `pushBlockCatalog`, `pushMaybeRepublishSchedule`, week-start UI | `DAY_SCHEDULE`, own `weekStart` | `planForDow`, `campWeek()` (section 10) |
| settings.js (classic tabs, kept until each section is on) | `state.config` | classic tabs hidden per section when on |
| `current-standings.html` | its own copies | section 11.1 |

### 9.3 Flag for the home-layout redesign

The pending home redesign should treat the table in 9.1 as its data API. What
it can rely on:
- every function returns plain data (no HTML), never throws on missing data,
  and is cheap enough to call per render (the setup view is resolved once per
  snapshot and memoized by `setupRev`);
- the accessors behave identically in built-in and data mode, so a redesign
  doesn't need to know which mode a camp is in;
- render functions on the `renderAll` path must keep writing through
  `setHtmlIfChanged` (render-stability).

**What this project deliberately does not decide:** which cards exist, their
order, the Happening Now layout, and whether "Competitions" stays a day-tab
card. `gamesForDay(dow)` returns blocks-with-games precisely so a redesign can
choose a different grouping.

---------------------------------------------------------------------

## 10. Phone alerts: stable blocks, and alerts when the schedule changes

(The whole push layer stays dormant until the owner finishes Project 1's
go-live steps. Everything here degrades to "nothing happens" while
`PUSH_SERVICE_URL` is blank, and the UI hides the alert checkbox.)

### 10.1 Publishing the week (`pushSchedule`)

- **Built-in mode:** unchanged. Ids are `d<dow>-<start>-<index>`, keys are
  `pushBlockKey(label)`, and weekStart is saved from the drawer. The one
  difference: from stage 3a on, **every** publish (both modes) carries `rev`,
  so a camp still on the built-in schedule keeps publishing after the step-B
  fence.
- **Data mode (schedule on):**
  - ids become `d<dow>-<blockId>`. They are **stable** under moves, inserts and
    renames, and fit the rules' `^[a-z0-9-]{1,40}$` (seeded ids are ≤ 31
    chars, random ones 10).
  - `key` = the block's `alertKey`, seeded to today's `pushBlockKey(label)`,
    so **existing phone subscriptions keep working**.
  - `weekStart` = `setup/meta/weekStart`.
  - `rev = max(Date.now(), lastRev + 1)`, as in built-in mode.
  - Publishing is the derived-mirror rule (6.7): any editor device whose
    resolved week differs from the published one republishes after a
    10-second quiet window.
- **The Worker needs no change for reminders:** it already reads
  `{dow, start, label, emoji, key}` per block. Stable ids also make its
  notification tags (`block-<id>-<date>`) stable, so a rain move no longer
  creates a "new" block from the tag's point of view. The cron walks a time
  window (`pushServer/cron/<camp>/upTo`), not per-block markers. A block moved
  later gets its reminder at the new time (even if the old-time reminder
  already went out, which is what people want after a move); a block moved
  into the already-walked window gets none, and the change alert (10.2) covers
  it. Switching a camp to data mode mid-week therefore can't double-send.
- The **drawer** in data mode shows "Camp week: Jul 18–24 (change in Set up
  the week)" instead of the date input, and builds its "remind me about…"
  list from `planForDow` (one row per `alertKey`, the same as today's
  catalog).

### 10.2 Telling people when a block changes (new)

1. **Client.** When the Rain plan's Done (or any day-view save that moves,
   renames or cancels an item dated today or later within camp week) has the
   checkbox on, the device:
   - builds `items` from the changed blocks of that day: `{key, emoji,
     was:{start,label}, now:{start,label}}` or `skipped:true`;
   - writes `pushChanges/<pushId>` (rules-validated, `byKey` = self);
   - calls `POST <PUSH_SERVICE_URL>/notify` with `{kind:'schedule', camp,
     changeId}` and the ID token, the same transport as director alerts;
   - shows the Worker's tally ("Sent to 23 phones") or the failure text.

   Offline → the intent is stored (`campSetupPendingAlert`). On reconnect the
   device asks "Send the alert about Tuesday's changes now?" It is never sent
   automatically.
2. **Worker** (`push-worker/worker.js`; the owner pastes it into Cloudflare,
   then runs `tests/push-e2e`): `routeNotify` accepts `'schedule'` and runs
   `notifySchedule(ictx, caller, camp, body)`:
   - checks `caller.member.role === 'editor'`;
   - reads `R/pushChanges/<changeId>`, and refuses unless `byKey ===
     caller.key`, `at` is within 10 minutes, and the dedupe marker
     `pushServer/sent/<camp>/sched-<changeId>` is absent (it is written
     first, like chat);
   - `takeRateSlot(RATE_ALERT_MS)`;
   - reads `pushSchedule/weekStart` and refuses outside the cron window;
   - **recipients** = devices whose prefs have `blocksAll` or `blocks[key]`
     for any changed item's key. `lead` is ignored. The "director alerts"
     mute does not apply, because this is a block they asked to follow;
   - **payload per device** lists only the items that device follows:
     title `📅 Tuesday's schedule changed`; body up to 3 lines such as
     "🏅 Team competitions → 1:15 PM (was 10:00 AM)" or "Elective 1 is
     cancelled today", then "+2 more"; `tag: 'sched-<changeId>'`,
     `open: 'schedule'`; TTL until the end of that camp day;
   - writes an audit row to `pushAlerts/<id>` with `kind:'schedule'`, so
     directors see it in the existing alert log.

   It fits the free-plan budget: the same recipient math as a director alert,
   at most 20 encryptions per invocation, with the rest going to the outbox
   (`PUSH_BATCH` unchanged).
3. **sw.js**: add `'schedule'` to `CAMP_PUSH_KINDS` and bump
   `PUSH_SW_VERSION`. sw.js still shows a notification for every push and
   still has no fetch handler.
4. **Cron maintenance** deletes `pushChanges` rows older than 2 days (admin).
   Clients can't delete them.

### 10.3 Things deliberately not alerted

Edits to past blocks; edits more than 8 days before camp (the cron window
already says "not camp week"); typical-day edits outside camp week; meal and
verse text. The checkbox is not shown for those.

---------------------------------------------------------------------

## 11. Outputs

### 11.1 The TV page for both camps (`current-standings.html`)

- **Camp choice:** `?camp=junior|senior`, else
  `localStorage.campScoreboardActiveCamp` (same origin, the presenter's own
  app choice), else junior. It sets the root, the storage key
  (`campScoreboardV2` + `:senior`), and the members check path.
  `stalling.html`'s link to the page passes `?camp=<active camp>`, and its
  "count 'em down from 6th" copy becomes "from last place".
- **Team identity:** from `R/setup/teams` (`.on('value')` on `R/setup`, member
  read) when `meta.on.teams`. Otherwise an embedded **per-camp seed table**
  (junior: today's constants; senior: names, emoji, accents; no crests), each
  marked "keep in sync with camps.js", as today. Crests use the uploaded photo
  (`teamPhotos/tN` once) → `crest` → an emoji tile. There is **no `<img
  src="undefined">`**: the intro loop iterates real team ids, not literal
  `t0…t5`.
- **Standings:** `computeStandings` skips results whose game id is not in the
  live catalog (setup games when on, else config) (pages#5). The ×2 flag comes
  from the same catalog. `MESSTIVAL_GAME_IDS` stays only as a last-resort
  fallback.
- **Double window and finale:** `doubleWindow()` / `finaleDow()` equivalents
  computed from `setup/meta` + `weekStart` (fallback: today's constants and
  Friday).
- **Auth lifecycle:** phone accounts are accepted (identity mirrors
  `identityKey`) (pages#6). Both `.on()` listeners get cancel callbacks →
  denied overlay → reload in 5 s, and an auth change after start reloads
  (pages#3). This is the main app's one-shot lifecycle, and it can't loop.
- Bump `TV_BUILD`, and the `?v=` of `firebase-config.js`/`vendor/jelly.js` as
  usual.
- **Optional (owner decision 17.12):** move the standings maths into a tiny
  shared `standings-core.js` (pure functions: medal points, ×2, orphan skip,
  bonus doubling) loaded by both pages, ending the duplication that caused
  pages#5.

### 11.2 A full-week calendar file

- **Where:** the schedule sheet's new **Add the whole week to my calendar**
  (the per-day button stays). It is disabled with "Ask a director to set the
  camp dates" until `campWeek().start` exists.
- **`buildWeekIcs()`:** iterates `weekDays()` and each day's timed
  `planForDow` blocks. Dates come from `weekStart + dow` (never
  "today's week"). The output contains:
  ```
  BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//camp.patricksimpson.info//Camp Scoreboard//EN
  CALSCALE:GREGORIAN / METHOD:PUBLISH
  X-WR-CALNAME:Junior Camp · Jul 18–24, 2027 / X-WR-TIMEZONE:America/New_York
  (VTIMEZONE America/New_York — the existing block)
  BEGIN:VEVENT
  UID:junior-2027-07-18-d2-b-team-competitions-600@camp.patricksimpson.info
  SEQUENCE:<minutes between Jan 1 of the season and meta.edited.schedule.at>
  DTSTAMP:<now, UTC> / LAST-MODIFIED:<meta.edited.schedule.at, UTC>
  DTSTART;TZID=America/New_York:20270720T100000 / DTEND;TZID=…:20270720T114500
  SUMMARY:🏅 Team competitions
  DESCRIPTION:Games: Shields\, Kangaroo Kickball\nCleanup: 🚜 John Deersz (in meal blocks)\nOn the menu: … (meal blocks)
  END:VEVENT
  ```
  - UIDs are **unique and stable** (camp + week + day + block id). This fixes
    today's duplicate `campday-2-1275` on junior Tue/Thu and the
    junior/senior collision.
  - Lines are folded at 75 octets (UTF-8 aware; today's code doesn't fold).
  - The filename is `junior-camp-2027-07-18.ics`.
  - The per-day button uses the same builder and UIDs.
- **Honest limit:** re-importing the file **updates** events in Apple
  Calendar (same UID, higher SEQUENCE). Google Calendar's file import may
  duplicate them, and neither removes deleted blocks. A live subscription
  (webcal) would fix that but needs a public URL (a Worker route), so it's out
  of scope (owner decision 17.13).

---------------------------------------------------------------------

## 12. Migration: seeding from camps.js, junior identical until it switches

### 12.1 What "switching" is

Nothing changes for anyone until an editor taps **Turn on shared setup** on
the hub. That one action (on a device with `setupReady`, online):
1. takes a restore point (`pre-switch`);
2. runs `seedSetupFromCamp(CAMP, {config: state.config, teams: state.teams,
   weekStart})` (5.6);
3. writes the seeded sections **available in the current stage** plus
   `meta/on/<those sections>: true` plus `meta/v`, `meta/seeded`, `meta/epoch`
   in **one atomic `update()`**;
4. if the push layer is live, republishes `pushSchedule` with stable ids
   (10.1).

Because seeding is lossless (Appendix C), every screen on every device renders
the same after the switch as before. **This is tested** in both camps: render
outputs of `nowBannerHtml` for every minute of every day, the schedule body,
the cleanup card and the verse card are compared before and after the switch.

### 12.2 Junior byte-identity, precisely

- `tests/camps.test.js` and `fixtures-junior-week.json` **do not change**. The
  constants stay in camps.js under the same names, since they are the seed and
  the built-in copy.
- New: `seedSetupFromCamp(CAMPS.junior)` → `resolveDay(…).map(legacyBlock)`
  deep-equals `DAY_SCHEDULE[d]` for d = 0…6, and the other accessors in data
  mode return values deep-equal to the constants (meals, verses, rota as
  arrays, elective tuples, slot starts, team identity, double window).
- Dbroot and storage keys are unchanged for junior; new keys go through
  `lsKey()`/`dbPath()` like everything else.

### 12.3 Stage-by-stage switching

Sections are turned on in the stage that ships their editor (13): schedule +
meals + verses + cleanup + electives in stage 3, teams in stage 4, games in
stage 5. The hub's "Turn on shared setup" turns on everything the running
build supports. A camp that turned on schedule in stage 3 gets a one-line
prompt in stage 4: "Teams can now be edited here too. **Turn on**".

### 12.4 Rollback

| Level | How | Effect |
|---|---|---|
| A section misbehaves | Backups → Advanced → "Use the built-in copy instead" (`meta/on/<section>: false`) | Every device returns to the camps.js/config source within one snapshot. Setup data is kept for later. |
| A whole stage's code misbehaves | `git revert` the stage commit + bump `?v=` (deploy) | Older code ignores `setup` entirely (it never read it). Section switches stay on in the database but nothing reads them. |
| The setup layer itself | Remove `setup.js`'s `<script>` tag | Every accessor's `typeof setupOn` guard falls back to the built-in sources. |
| Rules | Restore the GET backup taken before the PUT | Each stage's rules are additive, so rolling back the rules only disables that stage's feature (which degrades). |

---------------------------------------------------------------------

## 13. Staged build plan

**Every stage:**
- Bump all `?v=` (twelve today, **fourteen** once `setup.js` and `builder.js`
  exist; CLAUDE.md's list gets the two new names), `APP_VERSION` and
  `CODE_UPDATED_AT`.
- Run `node tests/run.js` + `node --check` on every changed JS file.
- Add new files to `tests/harness.js` `APP_FILES` in load order:
  `defaults, camps, app, setup, settings, builder, chat, push`.
- Push to `main`, then `curl` the live site for a string unique to the change.
- Rules (when the stage has them) are published and probed **before** the
  code.
- No banners (the `CHANGES` array stays empty).

**Live-camp rule:** every stage below is safe to deploy during a camp week
**unless marked otherwise**, because nothing changes until an editor turns
something on. The wizard (stage 7) and the section switches are the only
things that change live data, and they are deliberate acts.

### Stage 0 — Housekeeping rules (owner PUT; no code)
- `presence` optional `v`.
- **Tests:** rules.test.js presence shape; the emulator fallback replays old
  presence writes.
- **Rollback:** previous rules backup.

### Stage 1 — Safety fixes that need no new data (ships independently, piece by piece)
Each bullet is its own commit, test and deploy:
1. **B1 zombie draft:** Back confirms and clears `gameDraft`;
   `builderDirty()` is false when the builder is closed. Test:
   `editorMidEntry()` is false after Back.
2. **Config safety (interim, before games move):**
   - a `configReady` gate (no `pushConfig` before the first config snapshot,
     including the empty-node seed branch);
   - `pendingConfigWrites` counted in `reloadBlocked`, `hasUnsyncedWork` and
     `hasUnconfirmedLocalWork`;
   - `.catch` surfaces "Couldn't save the week setup" in the sync indicator.

   Tests: `sync.test.js`-style config gate; reload blocked while a config
   write is unacked. (The `rebaseOnPendingConfig` interim for scoring#3 stays
   an owner call, 17.14. Recommendation: ship it if a camp week will run
   before stage 5, since it is ~30 lines and stage 5 deletes it.)
3. **scoring#6:** a format change clears result + bracket + draft + live +
   clock, with confirm text listing them. `deleteGame` and
   `pruneOrphanedGameData` also delete `clocks`. Tests: new
   `games-builder.test.js` for `saveGameDraft`/`deleteGame` cleanup.
4. **rules#5:** `OWNER_MEMBER_KEY`. The owner row is read-only in the
   drawer, and bulk member updates skip it. Test pins the constant to the
   rules string.
5. **`.danger-link` + danger text:** `.danger-link` and every
   `color: var(--color-danger)` used *as text* switch to
   `var(--color-danger-text)`. The light theme sets `--color-danger-text:
   #b42318` (6.57:1 on white, 6.07:1 on the `#f4f6f9` background; today's
   `#d63b3b` is 4.26:1 on the background). Dark stays `#ff8a8a` (7.16:1).
6. **TV page pages#3/#5/#6 + `?camp=`** with per-camp seed tables and null-safe
   crests (11.1, minus reading `setup`). Bump `TV_BUILD`.
7. **.ics:** unique per-day UIDs (block index + camp), 75-octet folding,
   `X-WR-CALNAME`.
8. **Old-build defense for 4-team brackets:** `renderTournament` treats any
   bracket with an unknown `kind` as "This bracket needs the newest version.
   Pull down to reload." (no throw). This ships long before stage 6, so the
   fleet has it by then.
9. **Two tabs, one camp:** the Web Locks writer/reader mode (6.8). Test with a
   stubbed `navigator.locks`.
10. **pushState bisect-and-surface:** on a refused multi-path update, retry
    per top-level key once, then surface "Couldn't save <thing>" instead of
    looping silently. Test with a stub `fbRef.update` that rejects one path.
11. **Presence `v`** written on connect (rules from stage 0). The hub ⋯ shows
    "N devices on older versions" once the builder exists.

### Stage 2 — The setup layer, invisible (no UI, no switch)
- **New `setup.js`:** pure functions (seed, resolve, legacyBlock, normalize,
  diffTree, hubStatus), the engine (6.1) and persistence (5.12). Attached from
  `initSync` post-approval.
- **app.js:** the SEAM accessor block (9.1), and **every consumer switched to
  accessors** (9.2). With no section on, the output is identical, which is
  what this stage's tests prove.
- **Rules:** `setup` (8.2), published first.
- **Tests:** `setup.test.js` + `setup.senior.test.js` (lossless round trip,
  accessors equal constants in both modes, normalize heals every pruned
  shape, diffTree paths, three-way merge incl. RTDB-prune + key-order fuzz,
  epoch discard, bisect); `seam.test.js`; `week.test.js` and
  `week.senior.test.js` re-run the every-minute banner fuzz in data mode
  too; `render-stability` for accessor-backed panels.
- **Rollback:** revert, or drop the script tag. Nothing in the database
  changes in this stage.
- **Prefer outside a camp week.** Every consumer is rewired. The tests prove
  the output identical, but it is the largest code change in the project.

### Stage 3a — Builder shell + Schedule + Camp week
- **New `builder.js`:** the takeover frame (4.0), hub (4.1, with only the
  available sections), sync line, undo pill + stack (7.1), restore points
  (7.2) + Backups screen (4.15), presence (6.5), Camp week (4.3), Schedule
  (4.4) including Whole week, Rain plan (4.5) **without** games moves (games
  still live in config until stage 5; the rain plan's "Games…" button is
  hidden), and "Turn on shared setup" for `schedule`. The classic tabs move to
  "Classic editor".
- **Consumers:** banner, sheet, per-day + **full-week .ics** (11.2), push
  publish with stable ids + weekStart from setup (10.1), and `doubleWindow`.
- **Rules:** `editing`, `restoreIndex`, `restorePoints`; `pushSchedule` step
  A (`rev` optional).
- **Tests:** `builder-schedule.test.js` (scope "just this day" vs "every
  typical day" → exact paths; reset-to-typical; make-own-day keeps ids;
  overlap detection; ripple; ord insertion), `undo.test.js` (conflict-aware
  partial undo), `restore.test.js` (round trip, retention, pre-restore
  point), `push.test.js` additions (stable ids, `alertKey` = old key for
  every seeded block, republish rule), and the .ics tests (UID uniqueness
  across days/camps, folding, dates from weekStart).
- **Not during a camp week** unless the owner wants it: the switch is safe,
  but a new builder mid-week is new UI for directors under pressure.

### Stage 3b — Meals, verses, cleanup rota, electives + pushSchedule fence
- Screens 4.9–4.12, their consumers (9.2), and sections `meals`, `verses`,
  `cleanup`, `electives`.
- `pushSchedule` **step B fence** once 3a has been live for a day.
- **Tests:** `fill evenly` rota function; elective identity by member key;
  meal-tag decoration (senior "Supper and free time" tagged → dish shows);
  verse video allowlist.

### Stage 4 — Teams, People, Campers, walk-ups
- **Screens** 4.6–4.8 and 4.17. Section `teams`. The `state.teams` mirror
  carries `short` (5.8). Palette + `teamAccentStyle` + CSS for
  `--team-accent-l/-d` per theme. Team photos (`teamPhotos`). People replaces
  the Members drawer (the drawer's row opens People). Campers. "Ask to join"
  on the denied screen + polling.
- **Chat:** `teamShort`/`staffNames` in mention targets.
- **Worker (owner paste, optional in this stage):** `campTeams` reads
  `short`; `teamNamedIn` accepts the short name as a whole word when it is ≥ 3
  letters and not "team" (fixes the senior "Red" gap; `push-worker.test.js` +
  `push-e2e`).
- **Rules:** `campers`, `teamPhotos`, `accessRequests`.
- **Tests:** `teams.test.js` (mirror convergence, palette contrast table,
  emoji/accent sanitizing in accessors, photo laundering), `people.test.js`
  (paste parsing + dedupe, approve-links-pending, owner row read-only),
  `campers.test.js` (never touches localStorage; move is atomic; listener
  only for editors; cancel degrades only campers), rules tests (campers
  editor-only read).

### Stage 5 — Games on the schedule
- Section `games`; backfill (5.7); Games screen (4.13); the field-level game
  sheet (6.3); the `config` legacy mirror (6.7); the Rain plan's game moves;
  `gamesForDay` grouping on the home card; and **schedule-change alerts**
  (10.2: `pushChanges` rules, client, Worker `notifySchedule`, sw.js kind +
  `PUSH_SW_VERSION`).
- **Tests:** `games-setup.test.js` (backfill 22/22 + 25/25, field-level save
  merges two editors, deleted-elsewhere handling, dangling `blockId`
  tolerated, config mirror shape matches what v183 reads), `push-worker`
  schedule-kind tests, and `push-e2e` with a schedule change.
- **Rules:** the `games` sub-block of `setup` was published in stage 2. The
  stage checks the live catalog against it first (8.2). `pushChanges`.

### Stage 6 — The 4-team bracket (can move earlier; independent of 2–5)
- Pure helpers (5.10) and new phase renderers (4.14). The 6-team flow gets the
  same Undo-at-every-step and stale-tap guard via its own extracted helpers.
  Builder bracket options are "Matchups" (needs stage 5's game sheet; before
  that, the default "Pick them when you start" needs no builder change).
  Senior seed: the owner says which seeded games become brackets (17.15).
- **Tests:** `bracket.test.js` (6-team regression), `bracket.senior.test.js`
  (full 4-team path, medals, ×2, undo at each step, stale tap, own-team
  guard, RTDB-prune fuzz, `currentMatchupOf`/`nextMatchupOf`). Update
  `week.senior.test.js` (the old "refuses 4 teams" pin).

### Stage 7 — New-year wizard, archive, epoch; TV reads setup
- The state-engine epoch check (6.9) ships **first**, as its own commit, then
  the wizard (4.2), `archive` rules + writer, history "since this week"
  filter, and the TV page reading `setup` (11.1).
- **Tests:** `sync-epoch.test.js`, `wizard.test.js` (clears exactly the listed
  paths, owner key skipped, restore point + archive verified before clear,
  wizard lock), TV page logic extracted far enough to test the standings
  maths (or `standings-core.js`, 17.12).
- **Never deploy during a camp week** (it's harmless, but there's no reason
  to).

### Stage 8 — Retirement and fences (after presence `v` shows no build older than stage 5 for 2 weeks)
- Stop writing the `config` mirror and the `state.teams` `counselor` text.
- Delete the classic tabs from settings.js, keeping Notice and Data, which now
  live in builder.js.
- Remove the `OLD_PLACEHOLDER_*` migrations and the session heuristic code
  paths (the built-in mode keeps using seed resolve).
- Optionally, once no old build is left, make `config` read-only to clients
  (`.write: false`): nothing current writes or needs it.

---------------------------------------------------------------------

## 14. The deferred Project-1 items, and where each lands

| Item | Where | Fix |
|---|---|---|
| **scoring#3** (stale whole-config set) | Stage 1 (gate + accounting; optional rebase) → **Stage 5** (root fix) | Games move to `setup/games` with per-field writes and a three-way sheet save (6.3). Config becomes a derived mirror. |
| **scoring#6** (saveGameDraft half) | Stage 1 #3 | Format change clears result, bracket, draft, live and clock; deleteGame/prune also clear clocks. |
| **rules#5** (owner row) | Stage 1 #4 | `OWNER_MEMBER_KEY`, read-only owner row, owner skipped in bulk member updates (wizard). |
| **pages#3/#5/#6** (TV) | Stage 1 #6, completed in stage 7 | Cancel callbacks + reload, orphan filter, phone identity, `?camp=`. |
| **Two tabs, same camp** | Stage 1 #9 | Web Locks writer/reader (6.8). |
| **`.danger-link` dark-mode contrast** (and other danger text) | Stage 1 #5 | `--color-danger-text` everywhere danger is text; light value `#b42318`. |
| **Senior "Red" short-name mention gap** | Stage 4 | Short names become data in `setup/teams` → mirrored to `state/teams/short`; the Worker accepts a whole-word short name ≥ 3 letters (excluding "team"); chat uses `teamShort`. |

---------------------------------------------------------------------

## 15. Tests

New files (all zero-dependency, in the existing harness):

| File | Pins |
|---|---|
| `setup.test.js` / `setup.senior.test.js` | lossless seed↔resolve; accessors equal constants in data mode; normalize heals pruned shapes; diffTree; first-snapshot three-way merge (prune + key order + clash capture); epoch discard; bisect on refusal; never push before first pull; echo keeps refs; persistence pair written in one `setItem` |
| `seam.test.js` | no direct week-data reads outside the SEAM block |
| `builder-schedule.test.js` | scope paths, patch minimization, reset/make-own-day, ord insertion and renumbering, overlap + ripple, rain swap math (durations preserved, gaps preserved) |
| `undo.test.js`, `restore.test.js` | conflict-aware undo; restore round trip; retention; pre-restore point; campers undo never persisted |
| `teams.test.js` | mirror convergence (two simulated editors), palette table contrast ≥ 4.5 both themes, accessor sanitizing (emoji with `<`, bad hex, `javascript:` crest) |
| `people.test.js` | paste parsing, dedupe, approve-links-pending, owner row, accessRequests polling uses `once()` only |
| `campers.test.js` | no localStorage write ever contains a camper name (scan every `setItem` in the stub), editor-only attach, move atomicity |
| `games-setup.test.js` | backfill 47/47, field-level merge, deleted-elsewhere, dangling blockId, config mirror shape |
| `bracket.test.js` / `bracket.senior.test.js` | section 13 stage 6 |
| `sync-epoch.test.js` | old-epoch baseline discarded, offer to download |
| `wizard.test.js` | exact clear set, owner skip, ordering (restore point → archive → verify → clear), lock |
| `ics.test.js` (or week.test additions) | UID uniqueness/stability, folding, weekStart dates, both camps |
| `hub.test.js` | Appendix B status rules, one case per ⚠️ reason |

Updated deliberately: `rules.test.js` (gated-path list for both camps; campers
editor-read; `$other:false` seals on every new named record; accessRequests
non-member self-write; restore bodies create/delete only; pushSchedule `rev`);
`week.senior.test.js` (4-team refusal pin → 4-team start); `push.test.js`
(stable ids in data mode); `sync.test.js` (`teams` written whole stays true:
the mirror is still a singleton). `camps.test.js` + fixture: **unchanged**.

Opt-in suites: `tests/emulator/` gains `setup.mjs` (old-client write set under
new rules; new client under old rules degrades; campers viewer read denied;
accessRequests non-member write allowed once a minute) and `tests/push-e2e/` a
schedule-change scenario.

Playwright pass (manual, against the deployed site with a seeded editor hint):
phone-width hub, item sheet scope buttons, rain plan one-handed flow, team
colour previews in both themes, hold-to-confirm.

---------------------------------------------------------------------

## 16. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | A rules typo in the large `setup` block refuses a legitimate write (e.g. a live game field not in the list) | med / med | Bisect-and-surface (6.1.4) names the section; stage 5 checks the live catalog against the rule before turning games on; the emulator suite replays seeded trees for both camps. |
| R2 | Old cached builds keep showing the code schedule after a camp switches | high / low | Auto-reload on deploy reaches open phones within minutes; the switch is lossless, so they agree until the first edit; presence `v` shows stragglers. |
| R3 | An old editor build re-publishes the code schedule to `pushSchedule` | med / med (wrong reminders) | Derived-mirror self-heal + the `rev` fence (stage 3b step B). |
| R4 | Two-editor races inside the 300 ms push window on the same item (edit vs delete) | low / low | Existence check in `commitSetup`; `resolveDay` skips partial items; hub ⚠️ to fix or remove. |
| R5 | The setup engine diverges from the state engine's hard-won rules | med / high | It's a deliberate copy, with the same test scenarios ported from `sync-offline.test.js`; the invariant table (6.10) becomes a review checklist. |
| R6 | Camper names leak (cache, backup, archive, screenshot) | low / high | Rules editor-only; never cached; excluded from backups, restore points and archive; a test scans every `setItem`. Screenshots are a human matter: the screen's privacy line says so. |
| R7 | localStorage quota on a heavy phone | low / med | Setup is its own ~70 KB key (tree + base). A failed write keeps the previous consistent pair (same as `_syncBase`). |
| R8 | The wizard clears scores on the wrong camp, or mid-week | low / high | The camp name is in the hold button ("Hold to clear Junior Camp's scoreboard"); restore point + verified archive first; the wizard is offered only when the week is over or absent; the lock. |
| R9 | Free-plan bandwidth | low / low | Setup ~32 KB per page load per device; per-path deltas after; photos fetched once per change; no listener on restore/archive; presence for editors only. |
| R10 | Director confusion between "Just Tuesday" and "Every typical day" | med / med | Two equal buttons with the day list under the second; tags on rows ("Changed for Tue"); undo; restore points. Observe in the Playwright pass and an owner walkthrough before stage 3a ships. |
| R11 | Web Locks reader mode surprises a director who opened two tabs on purpose | low / low | "Use this tab instead" in one tap; only same-camp tabs are affected. |
| R12 | The Worker change (schedule kind, short names) depends on the owner's manual paste | high / low | The client degrades: the checkbox reports "Phone alerts couldn't be sent" with the Worker's error; reminders still work from the republished schedule. |
| R13 | Junior label text that names teams (morning meeting) drifts after renames | med / low | Rename ripple offer (4.6). |
| R14 | A 4-team bracket reaches an editor build older than stage 1 #8 | low / med (blank game screen on that device) | Stage 1 #8 ships months earlier; senior-only; auto-reload. |

---------------------------------------------------------------------

## 17. Decisions only the owner can make

Each has a recommended default, so building isn't blocked.

1. **Order of stages.** If senior camp runs before the setup UI is done, should
   the 4-team bracket (stage 6) jump ahead? *Default: yes, right after stage 1.*
2. **Who may turn sections on/off and run the new-year wizard:** any editor,
   or only the owner (a client-side check against `OWNER_MEMBER_KEY`)? *Default:
   any editor for the switch and the wizard; the per-section "use the built-in
   copy" valve owner-only.*
3. **Date-aware home screen.** Once `weekStart` exists: before camp, show
   "Camp starts Sunday, Jul 18"; after camp, hide Happening Now? *Default: yes
   to both; during the week unchanged.*
4. **Team photos:** may an uploaded photo replace junior's shipped shields?
   Is PNG-with-transparency at up to ~150 KB each acceptable? *Default: yes;
   yes.*
5. **Campers:** offline editing is disabled so names never live on a phone.
   OK? Are campers ever shown outside the Campers screen (a printable team
   sheet for directors)? Are they kept in the editor-only archive? *Default:
   offline disabled; no other surface now; never archived.*
6. **Restore points include scores** (so "restore" can roll back a wrong
   clear) but **not** members or campers. OK? *Default: yes.*
7. **Past years:** editors only, or a "Last year's champion" line for
   everyone? *Default: editors only.*
8. **Walk-ups:** which camp does someone pick when unsure, and should a
   request also buzz directors' phones (a Worker "access" kind)? *Default:
   they pick; no push; badge on the Settings gear.*
9. **No server-side setup history beyond per-section "last changed by".**
   OK? *Default: yes.*
10. **Happening Now names the games** during a games item ("Team competitions
    · Axe Throwing, Bowling"). *Default: yes.*
11. **Team counts stay fixed (6/4) in code.** A year with 5 teams would need a
    code change. OK? *Default: yes (as stated).*
12. **Shared `standings-core.js`** for the app and TV page (removes the
    duplication behind pages#5)? *Default: yes, in stage 7.*
13. **Live calendar subscription** (webcal via the Worker) instead of a file?
    *Default: no; file only.*
14. **scoring#3 interim rebase** in stage 1 (~30 lines, deleted in stage 5)?
    *Default: ship it if any camp week runs before stage 5.*
15. **Senior brackets:** which seeded games become 4-team brackets, and does
    the 3rd-place match always come before the final? *Default: Legacy Game
    each day; 3rd place first.*
16. **Spellings Sofie/Sofia, Lilly/Lily, Alysa/Alyssa** (IMPROVEMENTS.md):
    same people? The seed keeps the electives' spellings as name-only people
    until a director links them in Electives. *Default: the director links
    them; no automatic merge.*
17. **Schedule-change alerts:** opt-in per change (default checked for today)
    vs automatic. *Default: as specified (explicit checkbox).*
18. **Fixed colour palette** (12 swatches) vs "any colour". *Default: palette
    only; last year's hex colours stay until changed, with a ⚠️ where they fail
    contrast.*

---------------------------------------------------------------------

## Appendix A — Team colour palette (measured)

One id per swatch; a **light** value (text and fills on light surfaces; white
text on it) and a **dark** value (text on dark surfaces; dark `#181b1d` text
on it). Contrast was computed with the WCAG formula against the app's actual
tokens: light surface `#ffffff`, light background `#f4f6f9`, dark surface
`#1a2030`, dark background `#10141c`. Every value clears 4.5:1 in its theme.

| id | light | on white | on light bg | dark | on dark surface | on dark bg | dark text on it |
|---|---|---|---|---|---|---|---|
| red | `#b42318` | 6.57 | 6.07 | `#ff8a80` | 7.11 | 8.08 | 7.58 |
| pumpkin | `#b54708` | 5.43 | 5.01 | `#ffab5e` | 8.69 | 9.87 | 9.26 |
| gold | `#8a6100` | 5.54 | 5.12 | `#f2c24b` | 9.74 | 11.06 | 10.38 |
| green | `#2f7d32` | 5.12 | 4.73 | `#7fd88a` | 9.35 | 10.62 | 9.97 |
| forest | `#1f5e3a` | 7.72 | 7.13 | `#8ee0b0` | 10.39 | 11.80 | 11.08 |
| teal | `#0b7570` | 5.54 | 5.11 | `#5fd6cf` | 9.28 | 10.54 | 9.90 |
| blue | `#1f5fb8` | 6.20 | 5.73 | `#86b6ff` | 7.85 | 8.91 | 8.36 |
| indigo | `#4338ca` | 7.90 | 7.30 | `#aab4ff` | 8.26 | 9.38 | 8.80 |
| purple | `#7b3fb5` | 6.52 | 6.02 | `#cfa8ff` | 8.27 | 9.39 | 8.82 |
| berry | `#b0306a` | 6.04 | 5.58 | `#ff93c3` | 7.90 | 8.97 | 8.42 |
| brown | `#7a4a22` | 7.42 | 6.85 | `#dfae82` | 8.13 | 9.23 | 8.67 |
| slate | `#4b5563` | 7.56 | 6.98 | `#c3c9d6` | 9.78 | 11.10 | 10.42 |

**CSS:** `teamAccentStyle(id)` emits `--team-accent-l:<light>;--team-accent-d:<dark>`.
`styles.css` adds `--team-accent: var(--team-accent-l)` on the team
surfaces, and the same rule with `-d` under `body.dark-theme` and
`@media (prefers-color-scheme: dark) body:not(.light-theme):not(.dark-theme)`.
The existing `--team-accent` consumers are unchanged. The "white text on
accent fill" sites use `--color-on-primary`-style logic: white on the light
value, `#181b1d` on the dark value. The TV page (always light) uses the light
value. A legacy `accent` hex is emitted for both, and the hub ⚠️ flags it when
it fails either theme (e.g. today's `#345b96` is 2.38:1 on the dark surface).

## Appendix B — Checklist status rules (`hubStatus`)

Each returns `{mark:'ok'|'warn'|'skip'|'info', summary, problems:[string]}`.
`warn` if any problem, else `ok`. `skip` if `meta.skip[section]`.

| Section | Problems (each a plain sentence) | Summary when ok |
|---|---|---|
| Camp week | no `weekStart` ("Pick the Sunday camp starts"); not a Sunday; week ended > 7 days ago ("These are last year's dates") | "Sun Jul 18 – Sat Jul 24" |
| Schedule | typical day empty; a day used by camp has no items ("Saturday is empty"); `stub` day ("Arrival and send-off days are placeholders"); an item with `end ≤ start`; unacknowledged overlap ("2 items overlap on Tuesday at 9:15 PM"); a Breakfast/Lunch/Supper-looking label without the Meal tag; partial (broken) items | "Typical day · Mon–Fri · 3 one-offs" |
| Games | a Games item on a competition day with no games; games not on the schedule; a dangling `blockId`; a bracket game on a camp whose team count has no bracket kind; location "TBA" (senior seed) | "22 games on 10 items" |
| Teams | missing name/short/emoji; two teams share a colour; a legacy colour failing a theme | "6 teams" |
| People | requests waiting; a team with no counselor; pending rows ("3 people have no sign-in yet") | "18 counselors · 4 directors" |
| Campers | a team with no campers | "64 campers" |
| Meals | Meal-tagged items without a dish | "Mon–Fri" |
| Memory verses | no theme; a competition day without a verse | "Theme + 5 days" |
| Cleanup rota | a competition-day meal without a team; a team with no duty | "Each team cleans 2–3 times" |
| Electives | an Elective item whose slot has no stations; a station with nobody | "3 slots · 6 stations" |
| Phone alerts (only when push is live) | published week ≠ resolved week for > 2 min | "Schedule sent to phones" |
| Notice board | — (`info`: Draft/Posted) | |
| Restore points | — (`info`: last point age; `warn` if restore nodes are denied) | |

## Appendix C — Probe output (run against commit 63005d9)

Seeding round trip (Monday as the typical day; shape + head-label matching; `ord` tie-break).
A first run with shape-only matching also round-tripped, but turned Friday's "Team Skits" into a
relabelled "Evening service" (wrong reminder key), which is why 5.6 requires the head label to match:
```
junior day 0 ok blocks 9  own 9 patches 0
junior day 1 ok blocks 26 own 0 patches 0
junior day 2 ok blocks 27 own 1 patches 2     (movie night one-off; campfire + morning-meeting labels)
junior day 3 ok blocks 26 own 0 patches 1
junior day 4 ok blocks 27 own 1 patches 2
junior day 5 ok blocks 28 own 10 patches 8    (whole Friday evening is one-offs; the 8 typical evening items are skipped)
junior day 6 ok blocks 5  own 5 patches 0
junior roundtrip true · template blocks 26 · 6,610 bytes (vs 13,193 for DAY_SCHEDULE)
senior days 0–6 ok · roundtrip true · template blocks 20 · 3,147 bytes (vs 9,486)
```
Every `DAY_SCHEDULE` day in both camps is already sorted by `start`; the only
equal-start pair is junior Tue/Thu movie night vs "Prepare for bed", resolved
by `ord`.

Game backfill (rule 5.7), every game on its intended block:
```
junior: d1 10:00 Team competitions [shields, kangaroo-kickball] · d1 18:00 Evening competition [human-battleship]
        … d5 10:00 [bushel-bustle, pumpkin-patch-plunder, bob-drop-roll, cider-survivor] · d5 19:00 Team Skits [team-skits]
        unscheduled: none (22/22)
senior: each day 9:45 [team-comp-am] · 15:00 [team-comp-pm] · 16:50 Legacy Game [legacy-game]
        · 18:50 Hot Seat & Let's Make a Deal [hot-seat, lets-make-a-deal]   unscheduled: none (25/25)
```
(A looser "label contains game name" rule put `legacy-game-*` on 16:40 "Cool
down & prepare for the Legacy Game". That's why rule 2 only considers
`type:'games'` blocks.)

## Appendix D — UI copy glossary

| Code | On screen |
|---|---|
| block | "item" ("Add an item", "This item is a meal") |
| typical day / `typical: true` | "Typical day" / "Uses the typical day" |
| patch | "Changed for Tue" |
| one-off (`dayBlocks` on a typical day) | "Tue only" |
| `off: true` | "Skipped on Tuesday" / "Cancel today" (rain plan) |
| non-typical day | "its own day" |
| `alertKey` | "Phone reminders follow …" |
| viewer / editor | Counselor / Director |
| pending member | "no sign-in yet" |
| access request | "asking to join" |
| restore point | "restore point" (auto ones: "Auto-save while Patrick edited the schedule") |
| epoch / season | "this camp week" / "2027" |
| `messtival` | "Double points" |
