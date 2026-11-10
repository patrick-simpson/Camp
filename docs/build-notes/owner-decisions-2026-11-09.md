# Owner decisions — Mon Nov 9, 2026 (about 5:40–6:30 AM ET)

The owner answered every open owner question left by Steps 18–30, one at a time, in the build session.
Each answer below is final unless the owner reopens it. "Build" items go into the next runs; the rest are
recorded so no agent asks again or builds against them.

## Build (code changes)

1. **The classic abilities Step 30 removed**: bring back day editing (rename a games day, change its
   weekday, reorder if it still changes anything anyone sees, delete a day with no games), **Copy backup**
   and **paste-in restore**, in the new screens' look. **"Restore default games & days" is NOT wanted** —
   never build it or an equivalent. (Run `wf_8fd143f7-aa7`, started 5:45 AM ET.)
2. **The new-year setup's team-names Clear** (step 2): a cleared team becomes plain **"Team 1" … "Team N"**
   (N = the camp's team count), not the camp's built-in names. Short name, emoji and colour still go. The
   2026 roster migration must not swap "Team N" back (it only runs with no epoch, and the wizard stamps one).
3. **A single day whose memory verse is still "to be announced"** (other days have theirs): counselors (and a
   counselor preview, `viewRole()`) see Bible study as a **plain activity card**, no verse box and no "hasn't
   been added yet" line. Directors keep today's line and their verse keys.
4. **A schedule-alert tick on the item sheet's Remove…** (skip just this day / remove from every day / delete a
   one-off): offered when the sender would tell it (a cancelled item still to come today or tomorrow, camp
   week, phone alerts live), **unticked by default**; ticked, it tells the phones that follow that item (the
   sender already words a cancellation).
5. **The starter notice's copy** (junior `defaultNotice` and senior's): polish both (curly apostrophes, no
   exclamation mark, the app's voice). Regenerate `tests/fixtures-junior-week.json` ONCE more, on purpose,
   with the diff limited to the notice text and the commit saying why (the owner's answer of Nov 9).
6. **"What's new" comes back, redone** (this REVERSES the July 21 rule that `CHANGES` stays empty):
   - **Banners like before**: each note its own banner at the top of Now, released one an hour, waking hours
     only (7 AM–9 PM camp time), **all year including camp week**; dismissed per note on each phone.
   - **Sorted by role**: a note is for counselors, directors, or both; a counselor (and a counselor preview)
     never sees a director note, nobody reads about a screen they can't open.
   - **Written by the agent with each update** people would notice, in plain English; the owner reads them
     like everyone else. CLAUDE.md's deploy checklist step 4 changes from "never add entries" to "add a note".
   - **A short catch-up set**: about 4–6 notes per role on the biggest changes since July (the new tabs,
     scoring a game, the reveal, chat, phone alerts), released one an hour like any other.
   - Drawn in the app's own message-strip language (not the old badge look). A note may carry a "Show me"
     that opens the place it describes (the agent's design call, not an owner ask).
7. **Branding on the big screen**: the public TV page shows the **colour, emoji and shield photo directors
   picked** on the Teams screen. This needs a **database-rules change** (revealPublic carries laundered
   branding for the places shown). The owner publishes it once from Cloud Shell; **the client that writes
   the new fields must not go live before the rules do** (an unknown field would make the reveal's writes
   refused). Its own run, deploy gated on the owner's publish.

## Keep as built (no code change; recorded)

- **Games tab order**: the week's standings first, then the day picker on its games (mockup 08's order is
  not wanted).
- **The old "paper scoreboard is the official one" note**: stays out.
- **Back right after 1st place on the reveal remote**: steps back to 2nd place, as now ("show 2nd again").
  The redesign spec §4.2 table's "show 1st again" rows are corrected to match.
- **Camper counts on the Set up the week checklist**: keep (the hub stays in `CAMPERS_SCREENS`).
- **People: your own row** stays tappable (name and team; never your own access).
- **People: pasting "name, team" lines** lives only under Add people → Type a list.
- **Directors' "Cleanup: TBA" line** on a meal with no team: keep for directors (counselors see nothing).
- **The notice's hidden small label (eyebrow)**: stays hidden; no box for it.
- **"Start from last year's Sunday"** on an empty Schedule day: not wanted; remove any dead control for it.

## Later the same day (Mon Nov 9, about 12:30–1:05 PM ET), after v215 went live

These REPLACE the matching parts of items 2 and 6 above.

8. **A team cleared by the new-year setup** (replaces item 2's look): name **"Team N"**, short name **"Team N"** too, emoji the
   number keycap (1️⃣ … 6️⃣), and **no built-in look at all**: not the camp's shipped shield (junior), not its printed emoji, not
   its flag or printed colour (senior), and no colour (a plain, neutral mark). The owner first answered "no shield or emoji at
   all", then suggested the number emoji instead (accepted). What a director then picks on the Teams screen (a colour, an emoji,
   a photo) shows as usual. The published rules already accept this: `state/teams/$i` validates only `emoji` / `short` /
   `color` / `photoV`, so an extra marker field (for example `plain: true`) needs no rules change.
9. **What's new notes live for ONE HOUR after the update ships, then never again**, whatever the time of year (replaces item
   6's pacing): no one-an-hour release per phone, no catch-up over later weeks, no camp-week rule. A phone not opened during
   that hour never sees that update's notes. (The owner was asked "an hour after it appears on each phone" versus "an hour
   after the update ships" and chose the second.) Everything else in item 6 stands: banners at the top of Now in the
   message-strip look, sorted by role, written by the agent with each update, dismissed per note on each phone, Show me.
   The catch-up set shipped with v215 at 10:50 AM ET is therefore over.

## Evening (Mon Nov 9, about 6:05–6:15 PM ET), after v216 and v217 went live

10. **Team photos on the big screen: yes.** They are each team's LOGO, not pictures of the kids (the owner's words), so a
    small copy riding with a revealed place on the public big screen is fine, as built in v217 (switch still off).
11. **Before the reveal starts** (the big screen's Waiting and "Get ready…" frames, and the intro's confetti): **no team
    marks** — words only, no shields, flags or mascots — because a team's new look may not be public before its place is
    revealed, and the camp's printed art could be last year's. Each team's look appears as its place is revealed.
12. **No "Use the original look" row** on the Teams screen for a cleared team: a cleared team gets a new look only from
    what a director picks (an old shield can be uploaded as a logo); the new-year setup's Undo still brings everything back.
