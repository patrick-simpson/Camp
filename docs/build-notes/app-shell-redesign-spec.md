# App shell redesign: Now · Games · Chat · More, the standings reveal, and jelly motion

Spec, 2026-10-27 (revised the same day after three design reviews: see the Review log at the
end). Builds on v184 (live). Phones only. Both camps.

Inputs: today's screenshots, the four-lens layout review (`glitch-sweep-2026-10-27.json` →
`layout`), the owner-approved reveal remote mockups (`mockups/remote/`), the Project 2 setup
spec (`setup-rebuild-spec.md`, "P2" below), the two code maps of v184, and the owner's fixed
decisions (§1.2). Final mockups and the motion demo are listed in Appendix A.

---------------------------------------------------------------------------------

## Plain-English summary (for the owner)

**What changes when you open the app.** Four tabs along the bottom: **Now · Games · Chat ·
More**. Same tabs for everyone. The first screen, **Now**, follows the camp day by itself:

- During a games block it lists **this block's games** with **Not started / Live / Done**. Live
  games show their live score. Finished games show the three medal winners with their shields.
  Directors get a **Score** button on every row, and **Next game →** after saving. Scoring a
  podium game is three taps on team shields (gold, silver, bronze) and Save. If the games run
  late, the card stays up and says **Running over** until the last game is done.
- During electives a counselor sees **their own station first** (now and next), and
  **Who's where ›** for everyone else. Directors see the full list.
- Right after a meal it shows **whose cleanup it is**, and directors get the 0–3 award buttons
  right there. At Bible study it shows **today's memory verse**.
- Everything else (worship, campfire, free time, arrival Sunday, send-off Saturday, lights out)
  gets a clean "now and next" card, and a short **Later today** list that is personal ("1:15
  Elective 1 · you're at Crafts").

**The standings are secret now.** Counselors see no points, places or gaps anywhere in the app
(no team place on their card, no "+7" pop-ups, no catch-up hint), only the medal winners of each
finished game. Directors still see live standings at the top of their Games tab, marked
"Counselors can't see this".

**The reveal.** A director opens **More → Run the reveal** on their phone. It works like a
TV remote, in the light colours you picked: a live mini copy of the big screen at the top, a
ladder of places that fills in, a private "up next, only on this phone" preview (covered until
you press and hold it, so nobody reads it over your shoulder), and one huge **Reveal 3rd place**
button under your thumb. While the big screen shows a place, the button says so ("Showing the
score… 2") and Back waits too, so a nervous tap can't skip or rewind in front of everyone. The
phone's screen stays on while you run it. Every big screen and every counselor's phone keeps
pace place by place. Counselors' phones lag the big screen by three seconds, so the room hears
it first. After a place is revealed, counselors can see the full revealed score grid (frozen,
never live) until **8 AM the next morning**, then it hides again. Friday's reveal ends with the
champion celebration. The big-screen page just says "Waiting for the directors…" until a
director starts. Practice runs use made-up points, never buzz anyone, and never touch what
counselors can see.

**One "Tell everyone".** Directors write one message and choose how it goes out: a banner at
the top of the app (1 hour, 3 hours or all day), a buzz on phones (everyone, a team or
directors, with an Urgent switch; off unless you tick it, and then the button itself says
"Send + buzz 38 phones"), and/or pinned as the big notice. Three quick alerts ("Come inside
now", "All to the Dining Hall", "Stay where you are") are one tap each. Whatever is showing
can be taken down from the same screen.

**It moves like jelly, but can be calm.** Every change on screen (switching tabs, a game turning
Done, medals landing, a place being revealed, sheets, toasts, the remote's buttons) uses the
same springs the Jelly buttons already use: a little squash when pressed, a little overshoot,
then it settles. The sparkles, confetti and celebrations stay. **Calm motion** switches all of
that to quiet fades. It turns on by itself when the phone asks for less motion or is saving
battery, and there's a switch in More → Appearance (Auto / On / Off). If the phone itself is set
to reduce motion, Camp always stays calm.

**How it gets built.** Eight stages (D0–D7), each one shippable on its own and tested, slotted
between Project 2's stages from December to May, with a full rehearsal of both camps before
June 2027. The reveal needs one database-rules update, which can go in the same Cloud Shell
paste as Project 2's.

**Where I went further than the brief** (details in §17): the answer is always the biggest text
on screen; only one card per screen looks "physical" so the eye knows where to land; a blue
header means "what you press goes to everyone"; the remote's big button recharges until the TV
has finished showing a place, so a double-tap can't skip one; a pre-start check makes sure no
score is missing from the freeze; practice runs with made-up points; a "Still to do today" list
for directors; "Preview as a counselor"; three-tap podium scoring; and text that stays readable
in direct sun (7:1 contrast for anything smaller than 16px).

**Four questions only you can answer** are at the end (§18).

---------------------------------------------------------------------------------

## Contents

1. Scope, decisions, how to read this
2. Information architecture (the shell and the four tabs)
3. The Now tab, block by block
4. The standings reveal, end to end (data, rules, remote, TV, counselor phones)
5. The Games tab
6. The Chat tab
7. The More tab and the Director section
8. Visual system
9. The jelly motion system
10. Calm motion
11. Dark mode
12. Mapping onto today's code and P2's accessors
13. Render stability, scroll, history, keyboard, safe areas
14. Staged build plan
15. Test plan
16. Risks
17. Improvements beyond the brief
18. Questions for the owner
Appendix A. Mockups and the motion demo · Appendix B. Copy glossary · Review log

---------------------------------------------------------------------------------

## 1. Scope, decisions, how to read this

### 1.1 Scope

In scope: the app shell (header, tab bar, takeovers, sheets), all four tabs for both roles and
both camps, the standings secrecy rule everywhere in the app, the reveal (director remote, TV
page, counselor mirror, data and rules), the visual system, the motion system and calm motion,
and the staged build. Out of scope: anything P2 already specifies (setup screens, schedule
editing, the 4-team bracket engine, new-year wizard). This spec reads P2's data through P2's
accessors (§12) and only adds the reveal nodes to its rules publish.

### 1.2 Owner decisions this spec treats as fixed

1. Now answers "what's happening now" and follows the camp day.
2. Standings secrecy, exactly as stated: counselors see no points/places/gaps/standings except
   what a director has revealed; medal winners stay visible; the reveal mirror keeps pace place
   by place (6th → 1st, unrevealed = "still to come"); the full revealed grid (frozen) stays
   until 8 AM camp time the next day; directors always see everything; the TV waits unless a
   director runs a reveal; Back steps the TV back one place (phones keep what was shown); End
   early keeps what was shown until 8 AM; a new reveal replaces the previous one; any director
   can run it; Friday ends with the champion celebration; counselors' UI renders only the
   published reveal snapshot.
3. Director remote: mockup B's layout in mockup A's light colours, reached from More → Director
   → Run the reveal.
4. Tabs exactly Now · Games · Chat · More. During a reveal Now becomes the live reveal and the
   other tabs make it obvious. More holds the listed items, with a Director section on top.
5. Same tabs for everyone; Score on game rows for directors; "Next game →" after saving.
6. Games block on Now: this block's games with status, place, live score; medal winners on done
   rows; Score for directors.
7. Electives: my station first, "Who's where ›"; directors see the full list.
8. Cleanup / verse / quick points at their moment on Now and always under More.
9. One Tell everyone composer.
10. Emoji only for teams without a shield, elective stations and schedule blocks.
11. Jelly motion everywhere, one shared system, joy layer kept, never re-animate on no change.
12. Calm motion: OS reduce-motion, detected battery saver, or a user switch (Auto / On / Off).
13. Phones only. 14. Senior: same layout, empty sections hidden, flag colours (+ optional photo).

**Owner answers to this spec's §17 questions (2026-10-27, after approving the mockups and the
motion demo with "Yes, this is it") — these OVERRIDE anything below that disagrees:**
- Quick points: NO extra moment on Now; two taps from the Games standings is enough.
- ★ The big-screen page is **PUBLIC** — no sign-in on the TV. It reads ONLY a public,
  anonymous-readable node that carries what has been revealed (places shown so far, then the
  frozen grid until 8 AM) and nothing else (no counselor names, no unrevealed places, no live
  standings). Everything else stays member-only.
- ★ Practice runs use the **REAL standings** and play on the real big screen "much like the real
  thing", tagged "Practice". No pairing: the owner accepts that anyone who opens the public page
  during a practice can see it. Counselor phones still never mirror a practice, and a practice
  still never buzzes phones and never replaces the real reveal's grid.
- The bracket bye rule (fewest points this week among the Round 1 winners) stays, accepting the
  small hint about who is behind.

Project 2 decisions honoured here: no camp before June 2027; both camps roll out together;
new-year setup and the "edited here / original week" switch are owner-only; double points as
2026; champion celebration Friday; senior Legacy Game is a 4-team bracket with 3rd place before
the final; counselor spellings merged (Sofia, Lily, Alyssa).

### 1.3 Conventions

File cites are v184 (`app.js:LINE` unless another file is named). "Viewer" = counselor role,
"editor" = director role. Camp time = America/New_York via `campNow()`. `serverNow()` is the
server-corrected clock. New code names are proposals; where P2 already names a function, this
spec uses P2's name.

---------------------------------------------------------------------------------

## 2. Information architecture

### 2.1 One navigation model

Today there are four ways to go deeper (accordion, sheets, takeovers, a game appended under the
page). The new shell has exactly three, each with one job:

| Container | Used for | Back means |
|---|---|---|
| **Tab** (Now, Games, Chat, More) | the four places you live | switching tabs never loses your place (scroll is remembered per tab) |
| **Takeover** (full screen, labelled back: "‹ Now", "‹ Games", "‹ More") | anything you *do*: a game (scoring or watching), the reveal remote, Tell everyone, Award points, Set up the week | closes the takeover and returns to exactly where you were |
| **Sheet** (bottom; drag its grab strip down to close, its list scrolls normally) | short reference you *read*: full schedule, Who's where, your team, a team's day | closes the sheet |

Nothing folds open in place. The accordion, `applyCardDefaults` and the 5-minute idle collapse
are retired. Rule of thumb for future features: if you act on it, it's a takeover; if you read
it and leave, it's a sheet; if you come back to it all day, it's a tab.

### 2.2 The frame

```
┌──────────────────────────────────────┐  status bar (safe-area-inset-top)
│ [shield] Ferocious Foxes      (sync) │  header, 56px, sticky
│          Sam · Junior camp · Wed     │
├──────────────────────────────────────┤
│ (live reveal strip, other tabs only) │  40px, only while a reveal is live (not in table phase)
│ (messages strip, Now only, ≤ 1/3)    │
│                                      │
│   tab content (document scroll)      │
│                                      │
├──────────────────────────────────────┤
│  Now    Games    Chat(3)    More     │  tab bar 56px + safe-area-inset-bottom
└──────────────────────────────────────┘  home indicator
```

**Header** (all tabs). Left: who you are. A counselor sees their team's shield (senior: the
team's flag mark or photo, §8.4) and team name, with "Sam · Junior camp · Wednesday" under it.
A director without a team sees a camp mark and "Jenn · Director · Wednesday". Tapping the left
side opens the **Your team** sheet (counselors on the team, next matchup, cleanup turns this
week; never points; a "Not you? Change" row that re-asks "Which counselor are you?"). Right: a
status pill that appears **only when something is wrong**: "Offline · saved on this phone",
"Reconnecting…", "Update ready", "Couldn't save · tap" (mockup 16). This is the new home of
`#sync-status` (today hidden inside the Standings card, so counselors would never see it). The
pill is its **own node, patched in place**; the shield `<img>` lives in a root that only changes
on identity/role/camp (§13.1), so a connection flicker never re-creates the shield.

On Games, Chat and More the header becomes a plain title ("Games", "Chat", "More") with the
identity line on the right, because there the tab name is useful orientation and the block name
isn't (mockups 08, 15, 16).

**Tab bar**. Four buttons, each 44px+ high, icon over label (12.5px, ink-2; the active label
ink), from one line-icon family (§8.6), `role="tablist"` with `aria-current="page"` (§8.9).
The active tab has a soft blue pill ("blob") behind the icon that slides between tabs with a
jelly stretch (§9). Badges: Chat shows the unread total (`unreadTotal()`, chat.js:688); Now
shows a red dot while a reveal is live and you're on another tab; More shows a gold dot for
directors when someone is asking to join (P2 `renderJoinBadge()` moves here from the gear).
Re-tapping the active tab scrolls it to the top. The bar is not a `jelly-tabs` (text-only
labels, vendor/jelly.js:4650) and not a `jelly-segmented` (pill-before-upgrade snap,
`settleDayTabPill`); it is plain buttons plus the shared spring helper (§9.4).

**During a live reveal** (phases intro, live, champion) every tab other than Now shows a 40px red
strip under the header: "● Live on the big screen · 3 of 6 shown ›". Tapping it switches to Now.
The strip goes away the moment the final table is on screen (§4.9), so "Live" always means
something is still being revealed. It is fixed under the header and, when it appears on a page
that is scrolled down, the page is shifted by the same 40px in the same frame (WebKit has no
scroll anchoring), so nothing under the reader's eyes moves (§13.6).

### 2.3 Tab contents at a glance

| Tab | Counselor | Director (adds) |
|---|---|---|
| **Now** | messages strip; the Now card for the current block (§3); Up next; Later today; during a reveal the live mirror; until 8 AM after a reveal, last night's revealed standings | Score buttons on game rows; award buttons at meal/verse moments; "Still to do today"; during a reveal, "Open the remote" |
| **Games** | day picker; the revealed standings (only while revealed) or one line "Standings stay secret until the directors reveal them"; each day's games grouped by block with status and medal winners | live standings on top (shared places, movement arrows, gap sentence, "Counselors can't see this"); Score on every row; Next game; Add games on an empty day (P2) |
| **Chat** | four channels, unread counts, composer above the tab bar | clear channel (as today) |
| **More** | Camp: Full schedule, Memory verse, Meal cleanup. This phone: **Alerts** (one row: phone alerts that work with Camp closed + pop-ups and sound while it's open), Appearance inline (theme, calm motion), Your team. Camp switcher (dual-camp only). Stalling with Patrick. Account + Sign out. Footer: version, data updated, phones online | a **Director** section at the top: Run the reveal, Tell everyone, Award points, What counselors see, Set up the week, Change history (and Who can sign in until P2's People screen replaces it) |

### 2.4 Where every piece of today's page goes

| Today (v184) | New home |
|---|---|
| Notice board `#notice-board` | Now, messages strip: headline + your team's line, capped; tap opens the full card in a sheet. Send-off Saturday makes it the Now card itself (§3.3) |
| What's new `#whats-new` (dormant) | deleted with its `renderAll`/tick calls (CHANGES stays empty per CLAUDE.md) |
| Announcements `#announcements` | Now, messages strip (newest + "2 more"). The inline editor composer is removed; directors use Tell everyone |
| Follow card `#follow-team-card` | header identity + Your team sheet. Rank/points removed (secrecy). "Next matchup" and "next cleanup" lines move into Now/Later today where they're timely |
| My electives `#my-electives-card` | Now during electives (my station first) and Later today ("you're at Crafts") |
| Notify me `#notify-toggle-btn` | More → Alerts, "While Camp is open" section (the same `state.notify`), plus a one-time prompt after the team picker |
| Happening now `#now-banner` | the Now card (§3), all variants |
| Live home / Big Board `#live-home` | the Live row on Now (sized to content) and the game takeover |
| Chat card `#chat-card` | the Chat tab (badge on the tab, preview line dropped) |
| Competitions card (day tabs) | Games tab |
| Standings card | Games tab, directors only. Viewers: reveal grid only |
| Meal cleanup card | Now after meals; More → Meal cleanup; Director → Award points |
| Memory verse card | Now at Bible study; More → Memory verse; Director → Award points |
| Quick points card | Director → Award points (counselors only ever see quick points inside a revealed grid) |
| Six "Hide from viewers" switches | Director → What counselors see (standings switch retired: secrecy is now the rule) |
| `#game-view` (appended under the page) | game takeover |
| Footer (presence, camp chip, data stamp, version, Settings) | More footer; camp chip becomes More → Camp; Settings rows are spread into More |
| Settings drawer rows | More (theme, camp switcher, phone alerts, sound, Stalling link, sign out); Director section (Set up the week, Change history, Who can sign in) |
| Schedule sheet `#schedule-overlay` | kept as a sheet, opened from "Whole day ›" on Now and More → Full schedule. P2's "Change today's plan" and week `.ics` entries stay inside it |
| `#sdk-banner`, update banner | header status pill ("Update ready · tap"), the auto-reload rules unchanged |

---------------------------------------------------------------------------------

## 3. The Now tab, block by block

### 3.1 How Now decides what to show: `nowModel()`

One pure function computes the whole tab from data and the clock, so it can be unit-tested for
every minute of every day in both camps (as `week.test.js` already fuzzes the banner):

```
nowModel({ now, dow, role, myTeam, identity, reveal }) → {
  reveal:   revealView(...) | null,        // §4.9; wins the top of the tab when live
  messages: [notice?, ...banners],         // §3.2
  block:    { id, kind, label, emoji, start, end, minsLeft, progress, overrun } | null,
  moment:   { kind: 'cleanup'|'verse', meal?, teams?, dow } | null,
  body:     kind-specific data (games rows, my station, verse, notice …),
  next:     first block starting at/after block.end (existing rule, keeps overlaps right),
  later:    up to 3 blocks after next, personalised,
  todo:     directors only, §3.5
}
```

Block kind comes from a new SEAM accessor `blockKind(b)` (§12), which reads explicit fields
where P2 has them (`type`, `meal`) and falls back to today's label rules for the rest:

| kind | Rule (fallback in brackets) |
|---|---|
| `games` | `type === 'games'` |
| `elective` | `type === 'elective'` |
| `meal` | `blockMeal(b)` non-null (P2 `meal` tag; [label head Breakfast/Lunch/Supper, `blockMealName` 563]) |
| `bible` | [label contains "Bible study"] (junior 9:00, senior 8:45) |
| `meeting` | [label starts "Rising bell" / "Wake up"] |
| `worship` | [label contains "service" / "worship"] |
| `bedtime` | `noTime` or label "Lights out" / "Prepare for bed" / "devotional" |
| `arrival` | dow 0 and before the first worship block |
| `sendoff` | dow 6 |
| `activity` | everything else (free time, team time, campfire, prep blocks) |

P2 can later add an optional `kind` field to blocks; `blockKind()` would read it first, and no
renderer changes.

**Running over.** Now follows the clock, but the clock is not always right: a games block whose
end has passed stays the Now card while any game in it is **Live** (§5.3) or a director has
said **"Still on this"**, for at most 45 minutes past its end and never past the start of the
next games block. The kicker reads **"Running over · 10:00–11:45"** with "7 min over" on the
right, the hairline turns live red, and the subline says what's being held up ("Still going ·
Lunch at 12:00"); the next block shows as Up next as usual (mockup 01b). Directors get a
**"Still on this · +10 min"** button in the card footer when the block has ended and nothing is
detectably live (a placement game being judged on paper): it writes
`state.meta.overrun = { key: '<dow>:<blockId>', until: <server ms> }` (per-field meta diff, so two
directors can't clobber anything else; each tap adds 10 minutes, capped as above). Display
only: no other block moves. `nowModel` treats the block as current while
`now < overrun.until` or a game in it is live. The existing `?now=` override tests it.

**Precedence on the tab** (top to bottom): live reveal mirror (§4.9, phases intro, live,
champion) → messages strip → the Now card (block + moment) → Up next → Later today → "Still to
do today" (directors) → tonight's / last night's revealed standings (from the final-table
phase until 8 AM).

### 3.2 Messages strip

Holds, in order: a posted notice (headline + your team's assignment line, "See all ›" opens
the full card in a sheet), then banners (synced announcements + Announcements-channel chat
messages < 15 min, `chatAnnouncementBanners`), newest first. **Cap: one third of the viewport**
(about 280px on a 390×844 phone); anything beyond collapses to "2 more ›", which opens a sheet.
Each banner keeps per-device dismissal (`ANNOUNCE_DISMISS_KEY`) and TTL; its dismiss "×" draws
small but has a 44×44 hit area. Directors see "Remove for everyone" on synced banners (not on
chat-sourced ones, as today) and **"Take down"** on the notice strip (it calls
`setNoticeStatus('draft')`, editor-gated, with a 10-second Undo), so a pinned notice comes down
from where it is seen, not from Set up the week. Editors also see the P2 "Taylor is asking to
join · See" bar here (`renderJoinRequestBar()`). A banner arriving while the page is scrolled
down shifts the page by its height in the same frame (§13.6), so nothing moves under a thumb.

### 3.3 Every kind of block, counselor vs director, junior vs senior

At a glance (details follow):

| Block kind | Counselor sees | Director adds | Senior difference |
|---|---|---|---|
| Games | this block's games: Live with live score, Done with medal winners, Not started; own team outlined; "Running over" while a game is still live after the block ends | Score on every row (or the reason it's missing), "N still to score", Next game after saving, "Still on this +10 min" | 4 blocks a day (9:45, 3:00, Legacy Game, 6:50); Legacy Game as a 4-team bracket |
| Elective | my station now + next two slots, Who's where › | full station list inline | no electives: block never occurs |
| Meal (during) | the dish, whose cleanup it is after | — | empty menu/rota: plain label, no cleanup line |
| After a meal (30 min) | the next block + "X are on lunch cleanup" | 0–3 award buttons per assigned team | empty rota: no panel |
| Bible study | today's verse, reference, theme, verse song | 0–5 verse points per team | placeholder verses; none ⇒ generic card |
| Morning meeting | today's team group, "your team meets today" | — | "Wake up" block: generic card |
| Worship, campfire, devotional, team/free time, prep | generic card (title, time, note) | Still to do today (all generic blocks) | same |
| Arrival Sunday | countdown, welcome to your team, Sunday run sheet | join requests during Registration | sample Sunday until P2 replaces it |
| Send-off Saturday | the posted notice as the Now card, your team's area first | notice can be edited from Tell everyone | sample Saturday |
| Between blocks / before / after the day | "Up next in 12 min" / "Good morning" / "Lights out" + tomorrow | — | same |
| Live reveal (intro, live, champion) | the mirror (§4.9) | + Open the remote | 4 teams, flag marks |
| From the final table until 8 AM | the normal Now card, with the revealed grid under it | (directors keep live standings in Games) | same |

Every Now card has the same top: **"Now · 10:00–11:45"** on the left, **"63 min left"** on the
right, a 3px progress hairline, then the block title (emoji + label) as the biggest text on the
screen. Under the card: **Up next** (one row) and **Later today** (up to three rows, with
"Whole day ›" opening the schedule sheet on today).

**Games block** (junior 10:00 and 6:00; senior 9:45, 3:00, Legacy Game 4:50, 6:50).
Mockups 01 (counselor), 02 (director), 13 (senior Legacy Game).

- Rows = `gamesForBlock(dow, blockId)` (P2 accessor; fallback today's Morning/Evening
  heuristic, `session === (start < 12:00 ? 'Morning' : 'Evening')`, senior adds Afternoon). Order:
  live first, then not started in config order, then done.
- Row anatomy: status mark (✓ green Done · red dot Live · hollow ring Not started), game name
  (17/750), location + one live line ("round 2 of 3", "finished 10:31"), and a chevron. The
  first not-started game says "up next".
- **Live row** grows a compact live board sized to its content (never the old 55vh board): for
  tally games a two-column ranked list with shields and scores; for brackets the current match
  ("Maples vs Turkey · round 1", with outs/score when a ladder or match tracker is running) and
  "Next: Foxes vs Pilgrims"; for placement games nothing until saved ("Being scored").
  Counselors' own team is outlined in its team colour.
- **Done row** shows the three medal winners as a **3-up podium strip** under the game name:
  three equal cells, each a medal disc (the place won: 1/2/3, 22px with a 13px numeral) and a
  24px shield on top, the short name under them, wrapping to two lines and then ellipsising,
  never overflowing. Your team's cell gets a 2px outline in the team colour. It is never one
  `nowrap` line: with the real junior short names a one-line row overflows in 102 of the 120
  possible podiums at 390px and all 120 at 360px. Pinned at 360px with the widest podium
  (Pumpkins, John Deersz, Pilgrims) and a 20-character P2 short name (mockup 01b).
- Tapping any row opens the game takeover (§5.5). Directors see **Score** (44px high) on every
  not-done row (gold for the live/next one, outlined for the rest) and nothing on done rows (tap
  to fix). A director whose own team is in the current round sees, in place of Score, a short
  reason on the row: "Your team plays · another director scores"; the takeover keeps the
  own-team note (`canScoreRound`, `ownTeamNoteHTML`).
- Under the title, directors see "2 of 3 games still to score".
- Double points (Thu 5 PM → end of Fri) adds one line under the title for everyone: "Double
  points until the end of Friday". It's a rule, not standings, so counselors keep it.
- Senior Legacy Game: the bracket shows as four small boxes (Semifinal 1, Semifinal 2, 3rd
  place, Final), with "Red plays in the final next · 3rd place match first" for the counselor's
  team (copy derived from the bracket's own order, never "the last game today", which the
  6:50 block would contradict).
  P2's 4-team bracket supplies the data; until it ships senior's Legacy Game is a placement
  row like any other.

**Elective block** (junior only; hidden when `CAMP.features.electives` is false).
Mockup 03.

- Counselor with a known identity: **Your station** as the headline (station emoji +
  "Crafts with Eileen"), "with William · Pumpkins" (co-counselors and their team), the rain hint
  (`upcomingRainHint`) when relevant, as a plain line with a cloud icon (not a tinted callout),
  then **Then**: the next two slots of their own day ("2:00
  Snack Shack break", "3:00 Board Games · Elective 2 · with Patrick and Josh", "4:00 Break").
  A **Who's where ›** row ("5 stations · 8 counselors on break") opens a sheet with every
  station and the break list, your name highlighted.
- On break: headline "You're on break", the Snack Shack note if that block is the Snack Shack
  break, then Then.
- No identity yet: "Which counselor are you?" with the team's counselor names as buttons (the
  existing identity step, `TEAM_COUNSELORS` spellings). One tap, not asked again on this phone,
  and correctable: the station card's kicker carries **"Not Sam? Change"** (44px hit area) and
  the Your team sheet has a "Not you? Change" row, both re-opening the same step (mockups 03,
  16). A wrong tap between similar names (Eileen / Eli, the merged Sofia / Lily / Alyssa) costs
  two taps, not a week of someone else's stations.
- Directors (and counselors not on the elective sheet): the full station list inline, two
  columns of "station · names", break list last.
- Senior has no electives; its free-time blocks render as `activity`.

**Meal block** (Breakfast, Lunch, Supper).

- During the meal: title "Lunch", subline the dish with its emoji ("🌭 Hot Dogs") when MEALS has
  it (`mealFor`), and "Runaway John Deersz on cleanup after lunch" with the shield.
- **After the meal (the cleanup moment)**: from the meal's end for `CLEANUP_WINDOW_MIN = 30`
  minutes (junior: exactly the following "Team time", "Cabin time & clean up" and "Prepare for
  competitions" blocks). The Now card shows the following block's title as usual, plus a gold
  **Lunch cleanup** panel inside the card: the assigned team(s) (`cleanupTeams(dow, meal)`),
  big shield, team name, its counselors. Mockup 04.
  - Directors get four chunky buttons **0 1 2 3** ("3 = spotless") per assigned team, writing
    through `setCleanupPoints` (deterministic id `cleanup-<team>-<dow>-<meal>`, own-team locked,
    `touchData`, celebrate). After saving the panel says "Saved · 2" for directors only and the
    moment stays until the window ends. The tag "Points stay with directors" sits in the panel
    header.
  - Counselors see only whose turn it is ("Runaway John Deersz are on lunch cleanup"), never a
    number.
  - Friday's two-team cleanups show two rows.
  - Senior's empty rota: no panel at all (empty sections hidden).

**Bible study** (junior 9:00–9:45, senior 8:45–9:45). Mockup 12 (dark).

- The day's verse (`verseFor(dow)`) as the content: serif, 23px, generous leading, the
  reference in bold, a "Watch the verse song" button when the day has a video, and the week
  theme line under a hairline.
- Directors get a compact 0–5 row per team under the verse ("Verse points"), writing through
  `setVersePoints` (own-team locked; displayed doubled in the double window, stored raw).
- Senior uses its placeholder verses; if a day has none, the block renders as `activity`.

**Morning meeting** (7:30–8:00). Title "Rising bell & morning meeting", subline "Laura's cottage
· Foxes, Pumpkins and Pilgrims" (the day's team group). If the viewer's team is in today's group
it says "Your team meets today". Up next shows breakfast with the dish and the cleanup team.
Until 8 AM, last night's revealed standings sit under it (mockup 05b).

**Worship / evening service, campfire, devotional, team time, free time, prep blocks**
(`worship`, `activity`). The generic card: title, time, minutes left, any note in the label tail
("Snack and campfire — Ella" shows "with Ella"). No filler. Up next and Later today do the work.
Senior's long "Free time below the tracks & EXILE — Snack Shack open" splits at the `' — '`
(today's rule) into the title "Free time below the tracks & EXILE" and the subline "Snack Shack
open".

**Arrival Sunday** (`arrival`).

- Before registration (Sunday before the first block): "Camp starts today" with a countdown to
  the first block ("Registration at 2:00 · in 3 h 10 min") and Sunday's full run sheet below.
- Counselors on a team see a welcome card with their team's shield large and "Meet your team at
  Team assignments, 5:30, Chapel Lawn" (block lookup by label "Team assignments").
- Directors additionally see the join requests bar (P2) and "Registration · people asking to
  join" during Registration.
- Before the camp week exists (P2 `campWeek().phase` before week) the tab shows "Camp starts
  Sunday, June 21" when a date is set, otherwise "No camp week is set up yet" (directors: "Set
  up the week ›").

**Send-off Saturday** (`sendoff`). If a notice is posted, it becomes the Now card itself (not a
strip), your team's assignment first (the 2026 cleanup plan is exactly this). Otherwise the
generic card. After "Camp's over" the tab shows a calm end card: "See you next year" and the
week's champion, **by name and shield only**. The grid's 8 AM rule doesn't cover this line on
purpose: `revealView` returns `champion: [teamId…]` (no points, no other places) from a
**finale** reveal whose 1st-place group was shown, and keeps returning it until the camp week
ends (P2 `campWeek().phase` after the week), while everything else in the view expires at
8 AM. The champion was crowned in front of the whole camp; the numbers stay secret. A test pins
that this path never reads `p/g/s/b/v/m/c`.

**Between blocks** (a gap with no block): the card shows "Up next in 12 min" as its title with
the next block under it.

**Before the day** (before the first block): "Good morning" card with the first three blocks.
**After the day** (`bedtime` / lights out): a dimmed card "Lights out" with "Tomorrow: 7:30
Rising bell · 8:00 Breakfast · French Toast". (`?now=` URL override, `campNow` 717, stays the
way to test each of these.)

**Live reveal**: see §4.9. **Revealed grid until 8 AM**: see §4.10.

### 3.4 Up next and Later today

- Up next = first block starting at or after the current block's end (today's rule, which
  resolves Tuesday's overlapping movie night correctly).
- Later today = the next three after that, each personalised where data allows: meals show the
  dish and the cleanup team ("John Deersz on cleanup", or "Your team is on cleanup" in bold for
  that team's counselors); elective blocks show your station; games blocks list their games
  ("Color Call Chaos and 2 more") and "Foxes play first" when a matchup is known
  (`findNextMatchupFor`).
- Rows are flat (time · emoji · label), never cards.

### 3.5 "Still to do today" (directors)

A flat list under Up next, only for editors, only when non-empty, max three rows plus "N more":
unscored games whose block has ended, meals whose cleanup window ended with no award, Bible
study with fewer than all teams awarded, and (P2) join requests. Each row opens the right
takeover (game, Award points on that day). This is the safety net for the "at its moment" design:
if a director missed the lunch moment, it's still one tap away.

---------------------------------------------------------------------------------

## 4. The standings reveal, end to end

### 4.1 What each screen does

| Screen | Before a reveal | During | After (until 8 AM next day) |
|---|---|---|---|
| **Director remote** (More → Run the reveal) | ready state: mini TV "Waiting…", pre-start checks, Practice switch, Buzz switch, **Start the reveal** (mockup 06) | mini TV mirrors the big screen; ladder; masked private up-next; Back; huge Reveal button; End reveal (mockups 07, 07b, 07c) | "Last reveal ended 7:52 PM" + Start a new reveal (07c) |
| **Big screen** (current-standings.html, any signed-in member) | "Waiting for the directors…" (mockup 11) | mirrors the reveal (or a practice run, tagged "Practice"): intro, each place's hero, the docked board, champion (Friday), final table | back to waiting the moment it ends |
| **Counselor phone** | no standings anywhere | Now becomes the live mirror; other tabs show the red strip (mockup 05). At the final table both go: Now is the normal Now with the full grid under it | Now and Games show the frozen revealed grid until 8 AM (mockup 05b) |
| **Director phone** (not running it) | live standings in Games | same mirror as counselors + "Open the remote" | live standings as always |

### 4.2 State machine and the big button

```
           Start                    Next (×n)                 Next              Next          End
 (none) ─────────▶ intro (cur −1) ─────────▶ live (cur 0…n−1) ───▶ champion* ───▶ table ───▶ ended
                     ▲   Back                 │ Back: cur−1 (floor 0)  │ Back         │ Back
                     └────────────────────────┘                        ▼              ▼
                                                               live (cur n−1)   champion*/live
 * champion only when ctl.finale (Friday). Any phase ─ End reveal early ─▶ ended (endKind 'early').
 A new Start from any phase replaces everything (new id).
```

| State | Big button face (small line / big line) | Back (secondary) |
|---|---|---|
| ready | "Freezes the standings at 7:31 PM" / **Start the reveal** | — |
| intro | "Reveal" / **6th place** (junior) · **4th place** (senior) | "nothing before" (disabled) |
| live, cur = k, ready | "Reveal" / **3rd place** (a tie reads **2nd place (tie)**) | "show 5th again" |
| live, recharging | "Showing the name… 3" → "Showing the score… 1" / **3rd place next** | locked: "after the score" |
| after 1st, Friday | "Friday finale" / **Crown the champions** | "show 1st again" |
| champion | "Next" / **Show the final table** | "show 1st again" |
| after 1st, other days | "Next" / **Show the final table** | "show 1st again" |
| table | "All places shown" / **End the reveal** (confirm dialog, mockup 07c) | "champions" / "show 1st again" |
| ended | "Replaces tonight's" / **Start a new reveal** (confirm) | — |

Labels are sentence case (no letter-spaced capitals). Every state is drawn in mockup 07c.

**The button recharges, and says so.** After every command the gold fill grows left to right
while the big screen plays that place's beat (name 0–3 s, score 3–4.5 s), and the button can't
be pressed until the server has acknowledged the command *and* the TV has shown the score
(4.5 s). **The wait is written on the button face** in full-ink text ("Showing the name… 3",
"Showing the score… 1", counting down), not on a faint label or a status line elsewhere. A tap
during the wait sends nothing, gives the button one short sideways wobble and shows one toast:
"Wait 2 s. The big screen is still showing 4th place." **Back is locked for the same beat**
(dimmed, lock glyph, "after the score"), because it is the button most likely to be hit by
accident next to a dimmed gold one, and it rewinds the room's screen. End is never locked (it
always confirms). This stops a nervous double tap from skipping or rewinding a place, on top of
the server-side check (§4.5). Haptics: Android gets an 8 ms tick when the button is ready again;
iPhones have no `navigator.vibrate` (vendor/jelly.js:120 guards it, no fallback), so on iOS the
"ready" signal is the label swap and the pop, never a buzz.

### 4.3 Data: exact RTDB shape

Four sibling nodes per camp root (`<root>` = `campScoreboard` | `seniorScoreboard`), beside
`state`, `chat` and `push`, never inside `state` (which is sealed to `SYNC_KEYS`, diffed, cached
and three-way merged):

```
<root>/reveal                                  member-read, editor-write
  ctl:
    v          1                               schema version
    id         "r1kz9fxq-4hd2"                 /^r[a-z0-9]{6,12}-[a-z0-9]{4}$/, new per Start
    seq        7                               +1 per command (compare-and-set)
    phase      "intro"|"live"|"champion"|"table"|"ended"
    cur        2                               group on the big screen, −1 = intro
    shown      3                               groups published to phones (never decreases)
    teams      6                               team count at the freeze ("N still to come")
    finale     false                           decided at Start: camp day == finaleDow()
    at         1793055360123                   server time of this command (TV animation anchor)
    sa         1793055360123                   "shown at": server time when `shown` last GREW
                                               (phones' 3 s lag keys off this, never off `at`)
    ca         1793055059870                   the director's serverNow() at the Start tap;
                                               the rules refuse a Start whose ca is > 60 s old
    startedAt  1793055060123                   server time of Start
    startedBy  "jenn,doe@gmail,com"            member key
    by         "patricksimpson,fx@gmail,com"   member key of this command
    until      1793098800000                   08:00 camp time the day after startedAt's camp date
    endedAt?   …                               set with phase "ended"
    endKind?   "done"|"early"
    epoch?     "w20270621"                     P2 epoch; clients ignore a mismatch
  pub:
    g0: { place: 6, e: { t5: { p:15, g:1, s:1, b:1, v:1, m:1, c:0 } } }
    g1: { place: 5, e: { t4: { p:18, g:1, s:1, b:2, v:2, m:0, c:0 } } }
    g2: { place: 4, e: { t0: { p:22, g:2, s:1, b:1, v:1, m:3, c:0 } } }
    …                                          only groups < shown; a tie is one group with 2+ entries

<root>/revealFull                              editor-read, editor-write
  r          "r1kz9fxq-4hd2"                   must equal reveal/ctl/id
  n          6                                 number of groups (places) in this freeze
  frozenAt   1793055060123
  lastScoreAt 1793054940000                    newest touchData stamp at the freeze
  g: { g0: {…}, g1: {…}, … g5: {…} }           the complete frozen order, same group shape

<root>/revealScreens/<memberKey>/<slot>        editor-read; each device writes only its own row
  slot  "tv1"…"tv9" | "remote1"…"remote9"       fixed slots: at most 18 rows per member; the device
                                                keeps its slot in localStorage, takes the first
                                                free one when new
  at    server now                              re-written on reconnect and every 60 s; onDisconnect().remove()
  name? "Dining Hall TV"                         ≤ 40 chars, typed once on the TV page

<root>/revealPractice                          member-read, editor-write
  ctl   same shape as reveal/ctl                (its own id/seq/shown/sa; no `until`, no `ca` check)
  pub   same shape as reveal/pub
  full  { n, g: {…} }                           the made-up order: practice has nothing to hide,
                                                so the remote's up-next reads it from here
```

Why four nodes:

- **`reveal` is everything a counselor phone or a TV may know**, in one listener, so one
  multi-path update arrives as one snapshot.
- **`revealFull` keeps unrevealed places out of counselors' memory and cache altogether.**
  Secrecy is UI-only by the owner's choice, but this costs nothing and means the phones that
  shouldn't know 1st place never receive it. It also gives every director's remote the same
  private "up next" preview.
- **`revealScreens`** gives the remote "2 screens online" (it counts `tv*` slots whose `at` is
  under 3 minutes old, and lists them by name and account: "Dining Hall TV (Jenn)", so a counselor
  with the TV page open on a phone shows up as exactly that, not as an anonymous screen); phones
  online comes from the existing presence count.
- **`revealPractice`** keeps rehearsals away from the real reveal. A practice Start can never
  replace last night's reveal, so counselors keep their grid until 8 AM even if directors
  rehearse at 7:30 in the morning. Counselor phones never attach to it; the TV page subscribes to
  both nodes and shows a live real reveal in preference to a practice one.
- Group *count* `n` is only in `revealFull`: putting it in `ctl` would tell counselors a tie
  exists before it's revealed.
- Names, emoji and crests are **not** frozen; every screen resolves them live from
  `state/teams` (+ P2 team photos), so a rename mid-week shows correctly.
- Sizes: ctl ≈ 330 B, a group ≈ 120 B, revealFull ≈ 1 KB. 40 listeners × ~12 commands ≈ 0.2 MB
  per reveal. Spark-plan safe.

### 4.4 Rules (one publish, combined with P2's R1)

Written with P2's macros (§8.1 there: `MEMBER(R)`, `EDITOR(R)`, `SELF(x)`, `SELFKEEP`,
`NOWKEEP`, `INT(a,b)`, `STR(n)`); the real `database.rules.json` spells them out and
`tests/rules.test.js` re-expands and compares, junior and senior identical modulo the root name.

```jsonc
"reveal": {
  ".read": "MEMBER(R)",
  ".write": "EDITOR(R)",
  ".validate": "newData.hasChildren(['ctl'])",
  "ctl": {
    ".validate": "newData.hasChildren(['v','id','seq','phase','cur','shown','teams','finale','at','sa','ca','startedAt','startedBy','by','until'])
      && newData.child('cur').val() < newData.child('shown').val()
      && ( (data.exists() && newData.child('id').val() === data.child('id').val())
           ? ( newData.child('seq').val() === data.child('seq').val() + 1
               && data.child('phase').val() !== 'ended'
               && newData.child('shown').val() >= data.child('shown').val()
               && newData.child('shown').val() <= data.child('shown').val() + 1
               && ( newData.child('shown').val() > data.child('shown').val()
                      ? newData.child('sa').val() === now
                      : newData.child('sa').val() === data.child('sa').val() )
               && newData.child('ca').val() === data.child('ca').val()
               && newData.child('startedAt').val() === data.child('startedAt').val()
               && newData.child('until').val() === data.child('until').val()
               && newData.child('finale').val() === data.child('finale').val() )
           : ( newData.child('seq').val() === 1 && newData.child('shown').val() === 0
               && newData.child('phase').val() === 'intro' && newData.child('startedAt').val() === now
               && newData.child('sa').val() === now
               && newData.child('ca').val() > now - 60000 && newData.child('ca').val() <= now + 60000 ) )",
    "v":         { ".validate": "INT(1,9)" },
    "id":        { ".validate": "newData.isString() && newData.val().matches(/^r[a-z0-9]{6,12}-[a-z0-9]{4}$/)" },
    "seq":       { ".validate": "INT(1,9999)" },
    "phase":     { ".validate": "newData.isString() && newData.val().matches(/^(intro|live|champion|table|ended)$/)" },
    "cur":       { ".validate": "INT(-1,9)" },
    "shown":     { ".validate": "INT(0,10)" },
    "teams":     { ".validate": "INT(2,10)" },
    "finale":    { ".validate": "newData.isBoolean()" },
    "at":        { ".validate": "newData.isNumber() && newData.val() === now" },
    "sa":        { ".validate": "newData.isNumber() && newData.val() <= now" },
    "ca":        { ".validate": "newData.isNumber()" },
    "startedAt": { ".validate": "NOWKEEP" },
    "startedBy": { ".validate": "SELFKEEP" },
    "by":        { ".validate": "SELF(newData.val())" },
    "until":     { ".validate": "newData.isNumber() && (newData.val() === data.val() || (newData.val() > now && newData.val() <= now + 172800000))" },
    "endedAt":   { ".validate": "NOWKEEP" },
    "endKind":   { ".validate": "newData.isString() && newData.val().matches(/^(done|early)$/)" },
    "epoch":     { ".validate": "STR(24)" },
    "$other":    { ".validate": false }
  },
  "pub": {
    "$g": {
      ".validate": "$g.matches(/^g[0-9]$/) && newData.hasChildren(['place','e'])
        && (!data.exists() || newData.parent().parent().child('ctl').child('id').val() !== data.parent().parent().child('ctl').child('id').val())
        && ( ($g === 'g0' && SHOWN >= 1) || ($g === 'g1' && SHOWN >= 2) || ($g === 'g2' && SHOWN >= 3)
          || ($g === 'g3' && SHOWN >= 4) || ($g === 'g4' && SHOWN >= 5) || ($g === 'g5' && SHOWN >= 6)
          || ($g === 'g6' && SHOWN >= 7) || ($g === 'g7' && SHOWN >= 8) || ($g === 'g8' && SHOWN >= 9)
          || ($g === 'g9' && SHOWN >= 10) )",
        // SHOWN = newData.parent().parent().child('ctl').child('shown').val()  (spelled out in the file;
        // rules have no parseInt, hence the enumeration). A group can only be published once its
        // place has been shown, so even a buggy director client can't push 1st place to phones early.
      "place": { ".validate": "INT(1,10)" },
      "e": {
        ".validate": "newData.hasChildren()",
        "$tid": {
          ".validate": "$tid.matches(/^t[0-9]$/) && newData.hasChildren(['p','g','s','b'])",
          "p": { ".validate": "INT(-9999,99999)" },
          "g": { ".validate": "INT(0,99)" }, "s": { ".validate": "INT(0,99)" }, "b": { ".validate": "INT(0,99)" },
          "v": { ".validate": "INT(-9999,99999)" }, "m": { ".validate": "INT(-9999,99999)" }, "c": { ".validate": "INT(-9999,99999)" },
          "$other": { ".validate": false }
        }
      },
      "$other": { ".validate": false }
    }
  },
  "$other": { ".validate": false }
},
"revealFull": {
  ".read": "EDITOR(R)",
  ".write": "EDITOR(R)",
  ".validate": "newData.hasChildren(['r','n','frozenAt','g']) && newData.child('r').val() === newData.parent().child('reveal').child('ctl').child('id').val()",
  "r":           { ".validate": "newData.isString() && newData.val().matches(/^r[a-z0-9]{6,12}-[a-z0-9]{4}$/)" },
  "n":           { ".validate": "INT(1,10)" },
  "frozenAt":    { ".validate": "NOWKEEP" },
  "lastScoreAt": { ".validate": "newData.isNumber() && newData.val() <= now" },
  "g":           { "$g": { /* same group shape as reveal/pub/$g, without the id clause */ } },
  "$other":      { ".validate": false }
},
"revealScreens": {
  ".read": "EDITOR(R)",
  "$memberKey": {
    ".write": "SELF($memberKey) && (!newData.exists() || MEMBER(R))",
    ".validate": "newData.hasChildren()",               // as presence: no strings or booleans here
    "$slot": {
      ".validate": "$slot.matches(/^(tv|remote)[1-9]$/) && newData.hasChildren(['at'])",
      "at":   { ".validate": "newData.isNumber() && newData.val() === now" },
      "name": { ".validate": "STR(40)" },
      "$other": { ".validate": false }
    }
  }
},
"revealPractice": {
  ".read": "MEMBER(R)",
  ".write": "EDITOR(R)",
  // ctl: the reveal/ctl block minus `until` and the `ca` window (same seq/shown/sa CAS);
  // pub: the reveal/pub block; full: { n: INT(1,10), g: { $g: group } }; $other false.
}
```

What the rules guarantee: only directors can start or drive a reveal; two remotes pressing at
once can't both succeed (`seq` must be exactly one more, `shown` can only grow by one); an
ended reveal can't be revived (Start makes a new one); a published place can't be quietly
rewritten inside the same reveal, and can't be published before its place is shown; a Start
that sat in an offline queue for more than a minute can't land and wipe a live reveal; phones'
lag anchor (`sa`) moves only when a new place is shown; counselors can never read `revealFull`
or the screens list, and can't flood the screens list; nobody can write a stamp that isn't
server time.

**Checked in the emulator during review** (probes in the session scratchpad,
`critique/secrecy-stability/`): the `revealFull.r === reveal/ctl/id` cross-check inside one
multi-path update holds; the `pub/$g` id clause refuses rewriting g0 inside the same reveal;
the `sa` clause (grows only with `shown`) and the `ca` window (a Start replayed 150 s later is
refused, a fresh one accepted) work; the group-vs-`shown` clause refuses publishing g5 while
`shown` is 3 and still allows Next with g0/g1. They are written into `tests/emulator/reveal.mjs`
(opt-in): Start as editor; Start as viewer refused; viewer reads `reveal` OK and `revealFull`
refused; stale `seq` refused; `shown` +2 refused; command after `ended` refused; replace with a
new id accepted; `at` ≠ now refused; Back/phase commands keep `sa`, Next refreshes it; stale
`ca` Start refused; early group refused; screens row for another member refused; a string or
boolean at `revealScreens/<me>` refused; a 19th slot refused; practice writes never touch
`reveal`.

Publish order: the rules go out in P2's R1 PUT (same runbook, Appendix E there), before any
client that writes them. Until then the client is fail-closed (§4.12).

### 4.5 Writes

All from a director's phone, through one module (`reveal.js`, loaded after push.js, every hook
`typeof`-guarded like chat.js/push.js):

- **Start**: compute the freeze (§4.6), then **one** root-level `update()`:
  `{ 'reveal': { ctl: {v:1, id, seq:1, phase:'intro', cur:-1, shown:0, teams, finale, at:TS,
  sa:TS, ca:serverNow(), startedAt:TS, startedBy:me, by:me, until, epoch}, pub: null },
  'revealFull': {r:id, n, frozenAt:TS, lastScoreAt, g} }`. Writing `reveal` whole removes the
  previous reveal's places, which is "a new reveal replaces the previous one". Start is
  disabled while `pendingWrites > 0` or when `.info/connected` changed less than 10 s ago (a
  socket that only looks alive), and the rules refuse a Start whose `ca` is over a minute old
  (an offline-queued tap replayed later).
- **Next / Back / End**: `update({ 'reveal/ctl': newCtl, 'reveal/pub/g<k>': group })`, the `pub`
  path only when `shown` grows. `newCtl` is the whole ctl with `seq+1`, `at:TS`, `by:me`, and
  `sa:TS` only when `shown` grows (otherwise the old `sa`).
- **Practice** writes the same shapes to `revealPractice` (made-up `full` order included) and
  never touches `reveal`, `revealFull` or push.
- **On refusal** (`PERMISSION_DENIED`): re-read `reveal` once, then toast "Jenn already showed
  4th place" (name from `ctl.by` through the member directory, never free text), and the remote
  follows the server's ctl.
- **Every reveal consumer reads acknowledged state only.** The SDK echoes a write locally before
  the server answers and reverts it if the rules refuse it (the two-remotes race). On a
  director's phone ALL consumers (the remote, the Now mirror, the red strip, the tab dot and the
  motion ledger, so no confetti for a place that never happened) read one `confirmedReveal`
  store, updated only from a server snapshot taken while no local reveal write is in flight, or
  from the write's completion callback followed by a `once('value')` re-read. Counselor phones
  never write, so for them the listener snapshot is already confirmed. While a command is in
  flight the button shows its recharge state.
- **`revealFull` and `revealScreens` are fetched, not listened to**: `once('value')` when the
  remote opens, after each acknowledged command, and (screens only) every 20 s while the remote
  is open. No long-lived editor-only listener exists, so the terminal-read rule (CLAUDE.md) can't
  bite: a counselor promoted to director mid-camp gets the up-next preview the first time they
  open the remote, with no reload. Nothing from `revealFull` is persisted; on demotion the
  in-memory copy is dropped with the remote.
- **Offline / reconnecting**: the big button (and Back) turn into a dashed, grey face:
  "Reconnecting… 2 s" over "Your taps would not reach the big screens" when `.info/connected` is
  false (07c state 3). No queued commands.
- **The screen stays on.** While this device is an editor and a non-practice reveal is live, or
  the remote is open, it holds a Screen Wake Lock (`navigator.wakeLock.request('screen')`),
  re-requests it on `visibilitychange` (the OS drops it when the page hides), and releases it at
  End or when the remote closes; `acquireWakeLock()`'s gate (3668, today `anyTimerRunning()`
  only) becomes `anyTimerRunning() || revealBusy()`. The status line under the mini TV says
  "Screen stays on", or "Screen may sleep" if the lock was refused, so the director knows to tap
  it awake between speeches (iOS Low Power Mode sets Auto-Lock to 30 s). Check the Home Screen
  app on a real iPhone in D5.
- `revealBusy()` is true for **any editor while a non-practice reveal is live** (not only with
  the remote open) and joins `reloadBlocked()` (8459-8466), so the auto-update can't reload a
  director's phone mid-reveal.

### 4.6 The freeze (Start)

Computed on the director's phone with the app's own code: `medalCounts()` →
`rankTeamsByPoints()` → `groupPlaces()` (ported from current-standings.html:467-476 into
`reveal-core.js`: equal **points** share a place; inside a tie, entries are ordered by
gold/silver/bronze then name). Each entry carries the whole row (`p` total, `g/s/b` medals, `v`
verse, `m` meals, `c` quick points), which is "the full revealed score grid".

**Start is gated**; the ready screen shows each check as a row (mockup 06):

| Check | Source | If not met |
|---|---|---|
| This phone is up to date | `fbConnected`, `remoteReady`, `pendingWrites === 0`, `!dataEditPending`, `!remoteRefetchPending`, not `editorMidEntry()` | Start disabled: "Waiting for this phone to catch up…" |
| Every game today is scored | today's games via `gamesForDay` with no result | warning only: "Pumpkin Pictionary has no score yet. Start anyway?" |
| Last score saved | newest `touchData` stamp + who | shown as text: "Last score saved 7:29 PM by Patrick" |
| Big screens ready | `revealScreens` `tv*` slots seen in the last 3 minutes, listed by name and account | warning only: "No big screen is connected" |

Scores saved after the freeze are not in tonight's reveal, by design. If live standings differ
from the freeze while a reveal is still at `intro`, the remote offers "Scores changed since you
started · Start again".

**Practice run** (switch on the ready screen, off by default): the remote freezes **made-up
points** (the real teams in a shuffled order with invented totals) into `revealPractice`, and the
big screens show a small "Practice" tag. Counselor phones never listen to `revealPractice`, and a
practice run can't replace the real reveal, so last night's grid stays on counselors' phones
until 8 AM whatever directors rehearse. Directors can rehearse on the real TV the afternoon
before without leaking anything.

**Buzz all 38 counselors** (switch; the count is the counselors on the members list; phones
with alerts off get nothing): Start also sends the existing director alert "The standings
reveal is starting" through `pushSendAlert` (push.js 1716). On by default for a real reveal when
phone alerts are live (calling everyone to the big screen is the point). **Practice forces it
off**: while Practice is on, the Buzz switch is greyed and reads "Practice runs never buzz
phones", and `startPractice()` has no path to `pushSendAlert` (a unit test spies on it). No
Worker change.

### 4.7 Timing: one clock for every screen

Every screen renders the reveal as a pure function of `(ctl, pub, teams, serverNow())`:

- **The TV beat** (unchanged from today's page): for a new `cur`, name only for 0–3 s, place and
  score at 3 s, medal/bonus breakdown at 4.5 s, docks to the board at 8 s, measured from
  `ctl.at`. Animations key off `seq`, not `cur`, so Back-then-Next replays the place.
- **Counselor phones lag 3 s, and only for a NEW place**: the newest published group
  (`shown − 1`) is withheld while `serverNow() < ctl.sa + 3000`. During those 3 seconds the phone
  shows the "On the big screen now" tag on a row that says **"Look at the big screen"**. The room
  hears it first; the phone confirms it. `sa` moves only when `shown` grows, so Back, "Crown the
  champions", "Show the final table", End and a reload never hide a place that phones already
  showed (keying off `at`, which every command rewrites, would have hidden 1st place again at the
  climax).
- **Late join or reload** (TV or phone): renders the current frame statically. No replay of
  earlier places, no confetti unless the current place is still inside its first 3 seconds.
- **Auto-end**: any screen treats a reveal whose phase isn't `ended` as ended (display only) when
  its last command is more than **15 minutes** old in phase `champion` or `table`, or more than
  **60 minutes** old in `intro` or `live`. The ceremony ends in celebration, and "End the reveal"
  is the step most likely to be forgotten; this keeps "Live" honest without cutting a slow
  ceremony short. The grid still follows `until` (8 AM).

### 4.8 The remote (B layout, A colours)

Full-screen takeover (`body.reveal-open`, `state.ui.revealOpen`, device-local), opened from More
→ Director → Run the reveal, from the Games tab's "Reveal these on the big screen ›" link, and
from "Open the remote" on Now while a reveal is live. Mockups 06, 07 (and 07-dark), 07b (small
phones) and 07c (every other state).

- **Blue roof** (`--roof` camp blue in both themes, 5px darker bottom edge): "‹ More" (labelled
  back, 44px high; the only left chevron on the screen), title "Reveal", status chip "● Live · 2
  screens" / "2 screens" / "No screens".
- **Mini TV** (16:9: 352×198 inside a 3px frame with a 5px edge): the same renderer and frame
  function the TV page uses (`reveal-core.js` → `tvFrame()`), scaled, always in the TV's light
  colours (the TV is always light). Not an iframe (index.html's CSP has no `frame-src 'self'`
  and the boot guard refuses framing). Under it, one line: "2 screens · 11 phones" and "Screen
  stays on" (§4.5). The beat status lives on the big button, not here.
- **Ladder**: ONE grouped list with hairlines (1st at the top, filling from the bottom up), 44px
  rows, not a stack of bordered boxes. Hidden rows sit on the paper-2 well with a lock: "Hidden
  until you reveal it". The next place is the one hatched row (gold hatch, 2px ink outline,
  54px): **masked** by default, "Up next · only on this phone · Press and hold to peek"; holding
  it for 350 ms shows the team, shield and points until the finger lifts (or 3 s pass), and it
  re-masks during every TV beat, so a counselor beside the director can't read 1st place off
  the phone held up in a crowded room. The on-screen row has a 6px gold inner edge and a second
  line "● On the big screen now". Shown rows: shield, name, points. Long names ellipsise; points
  never do.
- **End reveal**: an outlined button (44px) at the ladder header, far from the thumb zone,
  confirmed by a dialog (07c): "End the reveal? Counselors keep tonight's standings until 8 AM
  tomorrow. The big screens go back to waiting." [Keep showing] [End the reveal].
- **Dock** (thumb zone, above the home indicator): **Back** is a secondary button (106px wide,
  2px outline, 4px edge, rewind glyph, "Back / show 5th again") with a **24px gap** to the gold
  button (92px tall, 7px edge), and is locked during each TV beat (§4.2). The two never share a
  chevron: "‹ More" leaves the remote, the rewind glyph moves the TV. Labels per §4.2.
- **Small phones** (viewport under 700pt tall: iPhone SE 375×667, Android 360×640): the mini
  TV collapses to a 150×84 thumbnail beside a two-line status ("4th place on the big screen",
  "2 big screens · 11 phones"), the dock loses its home-indicator padding where there is none,
  and the whole six-row ladder fits above the dock (mockup 07b, shot at 375×667 and 360×640).
  With more than six groups the ladder scrolls inside its own box and keeps the on-screen and
  up-next rows in view after every command (`scrollIntoView({block:'nearest'})` on the
  confirmed state).
- **Someone else is driving**: no ownership. A second director opening the remote sees "Started
  by Jenn at 7:31" and the same controls; both work; the server serialises them. Start becomes
  "Start a new reveal" with a confirm when a reveal is live or showing.

### 4.9 Counselor phones: the mirror

- One listener on `<root>/reveal` attached in `initSync` after approval (beside presence and
  chat). Its error callback sets `revealDenied` and degrades the reveal only, never
  `fbRef`/`syncDenied`. It is member-readable, so it never needs re-attaching on a role change.
- `{ctl, pub}` cached under `lsKey('campScoreboardRevealCache')` for instant paint and offline,
  added to `clearLocalData`'s wipe list (auth.test.js pin updated).
- **`revealView(ctl, pub, serverNow, role)`** (pure, in `reveal-core.js`) is the only thing any
  viewer renderer reads. It returns `{live, phase, startedBy, rows:[{place, tie, entries:[…]}],
  onScreen, looking (the 3 s window after `sa`), remaining (teams not yet shown, from ctl.teams
  minus revealed entries, never from group count), until, expired, champion}`. It returns
  nothing (champion aside, §3.3) for a missing/denied/epoch-mismatched/`v`-too-new/expired
  reveal: **fail closed**. `expired` is computed from `serverNow()` at **paint time** in every
  renderer, never cached.
- Now during a live reveal (phases intro, live, champion; mockup 05): red strip "● Live on the
  big screen · Started 7:31 by Jenn", title "Tonight's standings · 3 of 6 shown", then the
  ladder as ONE grouped list with hairlines: **"Still to come"** rows on the paper-2 well (one per
  remaining team, no place numbers, so a tie can't be inferred), then revealed rows with the
  place, shield, full name, medal line in words ("2 gold · 1 silver · 1 bronze"), points. The
  on-screen row has the gold inner edge and the "On the big screen now" tag inside it; the
  counselor's own row carries a "Your team" tag outlined in the team colour. A note: "Places
  appear here a few seconds after the big screen shows them, and stay until 8 AM tomorrow." The
  current block shrinks to a "Happening now" row at the bottom.
- **The final table ends the takeover of Now.** From phase `table` (or an auto-ended or ended
  reveal), Now is the normal Now (the evening block's card, campfire, cleanup moment…) with
  "Tonight's standings" as an ordinary section under it, and the red strip is gone from every
  tab. A forgotten "End the reveal" therefore costs nothing on counselors' phones.
- **Back** moves the "On the big screen now" tag to the earlier row; nothing is hidden again
  (§4.7: the lag keys off `sa`).
- **Champion** (Friday): the 1st row gets a crown and the team's confetti (calm: a gold ring).
- Directors' phones show the same mirror on Now plus "Open the remote", from `confirmedReveal`
  (§4.5).

### 4.10 After the reveal: the frozen grid until 8 AM

- Shown while `!expired` (`serverNow() < ctl.until`) for the last reveal, whether it ended
  normally, early, or by auto-end. `serverNow()` uses the last known `.info/serverTimeOffset`,
  which is now kept in `localStorage.campScoreboardServerOffset` (device-local, not camp data,
  not wiped) so a phone that starts offline at 7:58 still knows what time the server thinks it
  is.
- On **Now** under the current block, and at the top of **Games**, titled "Last night's
  standings" (or "Tonight's standings" before midnight) with "Revealed 7:44 PM · hides at 8 AM".
- **The grid without a table** (mockup 05b): one row per revealed team: place, shield, short
  name (+ "Your team"), then two short lines in words, "2 gold · 1 silver · 1 bronze" and
  "verse 4 · cleanup 3 · quick 2"; points big on the right. Medal discs are never used for
  counts (a disc always means a place won, §8.4). Unrevealed places (ended early) read "Not
  revealed". No horizontal scroll at 360px.
- **Hiding at 8 AM is one time-driven action, not a render side effect.** `expireReveal()` runs
  from the 30-second tick, `visibilitychange` → visible, `pageshow` (iOS restores a frozen page
  without a tick) and the `.info/serverTimeOffset` handler (app.js 2895-2903, which today only
  repaints board clocks). It empties every grid root directly (Now's, Games', any open sheet's)
  instead of relying on dirty-tab marking, because a quiet 8:00 brings no snapshot and so no
  `renderAll` (applyRemoteState 2848 renders only when `syncSignature()` changed). And every
  renderer that can draw the grid computes `expired` itself at paint time (above), so even a
  missed call can't show points after 8 AM. Never recomputed from `state`.
- `until` = `etWallToEpoch(nextDay(campDateStr(startedAt)), 8 * 60)` using the DST-safe helper
  ported from push-worker/worker.js:456-466 into `camp-core.js` (P2 plans the same file). A
  reveal started after midnight still runs to 8 AM the next calendar day.

### 4.11 The big screen (current-standings.html)

Rewritten as a subscriber; it no longer computes standings (P2 Stage T's `computeStandingsCore`
parity work is dropped; T's hardening stays and lands first: `?camp=`, CSP, script moved to
`current-standings.js`, sanitised DOM via `camp-core.js`, null-safe crests, 3-reloads/hour cap,
identityKey parity so phone-number accounts can sign in).

- **Who can open it**: any signed-in member of the camp (counselor or director), as today. It
  shows nothing but "Waiting for the directors…" unless a director runs a reveal (mockup 11).
- **Reads**: `reveal` and `revealPractice` (on; a live real reveal wins), `state/teams` (on; a
  child read under state's member `.read`; no results, bonuses or config), team photos (P2),
  `.info/serverTimeOffset`, `.info/connected`, the member self-read. **Writes**: its own
  `revealScreens` slot (`tv1`…`tv9`, optional name typed once and kept in localStorage).
- **Waiting** when: no ctl, phase `ended`, auto-ended, rules denied, listener error, schema too
  new, or offline with nothing cached. The waiting screen: camp mark, "Waiting for the
  directors…", the teams' shields (senior: flag marks) bobbing gently (still and static when
  `prefers-reduced-motion` is set; the remote's mini TV uses the same renderer and follows the
  phone's `calmMotion()`), "Connected · this screen is ready", and one line telling directors
  where the remote is.
- **Mirroring**: `tvFrame()` → `{mode: waiting|intro|hero|board|champion|table, heroIdx, beat,
  docked}`. Ties keep the shield "fight" for 2-way ties; 3-way ties show side by side. A
  "Practice" tag in the corner when it is showing `revealPractice`. "Reconnecting…" chip when offline; jumps to
  the current frame on return.
- **No keyboard/click advancing** (the old 1087-1104 handlers are removed). If the signed-in
  account is a director, arrow keys send the same commands as the remote (optional, D5b).
- **Self-update** reloads only while waiting.
- Calm motion: the TV page loads `jelly-motion.js` and honours `prefers-reduced-motion` (no
  battery or switch on a TV; the TV has no More tab).

### 4.12 Secrecy: every leak path, closed

All gating is in code paths, never CSS (`html.view-only` leaves nodes in the DOM).

| # | Surface today | Change |
|---|---|---|
| 1 | Standings card (renderStandings 4582) | viewers: not rendered at all; Games shows the reveal grid or one line |
| 2 | Movement arrows / start-of-day baseline | editors only; baseline write skipped for viewers |
| 3 | Podium tint, following-row, points pulse | editors only |
| 4 | Catch-up sentence (4655) | editors only (Games standings) |
| 5 | Follow card rank pill + points (4873-4877) | removed; header identity has no numbers |
| 6 | Point toasts / OS notifications / chimes (notifyPointChanges 3537) | editors only. Viewers get **result alerts**: "Inflatable Bowling: Pumpkins gold, Foxes silver, Maples bronze", "Foxes won silver in Inflatable Bowling!", from a diff of `prevRefs.results` against the new `results` **inside `applyRemoteState`** (not a lazily seeded module variable: v184's `detectMatchupChanges` seeds `lastBracketSlots` on its first call, 3193-3201, so the first live change after a quiet boot alerts nobody). The matchup baseline is seeded at `startApp()` from local state for the same reason |
| 7 | Copy/Share standings (4410) | gated in JS by `canEdit()`; the "Medals so far" list stays allowed |
| 8 | Quick points subtotals/ledger (renderBonuses) | Director → Award points only |
| 9 | Verse "+N" per team | viewers: verse text only |
| 10 | Cleanup "+pts" badges and ledger | viewers: rota only |
| 11 | "+7 / +5 / +3 pts" chips on results (renderResult 6401, bracket summary 7794, bronze note 7762) | viewers: medal winners and game scores only; directors keep the chips |
| 12 | "Suggested: gold/silver/bronze" in live watch (6321) | removed for viewers (it showed winners before a director saved) |
| 13 | TV page live standings for any member | subscriber-only (§4.11) |
| 14 | Hint-painted first frame from cached state (boot 9506-9516) | the viewer render path is the same code from the first frame; it reads only `revealView()` (cached reveal) and never `medalCounts()` |
| 15 | Live role flip (setMemberRole 88-97) | a demoted editor's next `renderAll` drops every editor-only node (the Games standings root is emptied, not hidden) |
| 16 | Team picker / notify copy promising point alerts (3516, 5062, ~5095) | rewritten: "You'll get alerts when your team plays and wins medals" |
| 17 | Bracket bye (renderBracketBye 7687: "goes to the Round 1 winner with the fewest points this week") | the "fewest points" hint and suggestion stay editor-only (as today). Who HOLDS the bye is visible to everyone and lets a counselor infer which of three teams trails: a known game-rule leak, put to the owner (§18 Q4) |

**One guard inside every points reader.** Secrecy is enforced where points are produced, not
only where they are drawn: `standingsVisible()` (true for editors outside "Preview as a
counselor") is checked at the top of `medalCounts`, `rankTeamsByPoints`, `bonusBreakdown`,
`versePointsByDay` (5357), `cleanupMealPoints` (5526), `bonusCountsDouble` (294), the bonus
ledger, `tallyRankLive` totals, `standingsSummaryText` and the direct `state.bonuses` reads (5234,
5244, 5433, 5559, 5593, 7692). Under test it throws for a viewer; in production it returns zeros
/ empty, so a forgotten caller shows nothing rather than the truth. Medal winners per game are
read from `results` directly and stay allowed.

Enforced by tests (§15): (1) a full viewer `renderAll` with the guard throwing; (2) a **sink
recorder** in the harness that wraps every way text leaves the app (`showToast`,
`maybeNativeNotification`, `Notification`, `jellyToast`, `navigator.share`,
`copyTextToClipboard`, `insertAdjacentHTML`, `setAttribute` (`title`, `aria-label`),
`appendChild`/`textContent`, `playAlertChime`), because the stub DOM records none of them today
(a v184 viewer's "+7 pts (now 23)" toast is invisible to the current harness); (3) remote-change
scenarios driven as a viewer (a result saved, a bonus, a verse award, a cleanup award, a result
cleared, a role flip, a hint-painted first frame) asserting that no points, place or gap pattern
(`/\bpts?\b/`, `/[+−-]\d+/`, ordinals outside the reveal roots, "trail", "behind", "ahead") reaches
any sink.

**Old builds** ignore `reveal` and keep their old standings. The first new editor build seeds
`meta.hiddenCards.standings = true` and `meta.hiddenCards.bonus = true` once, so a not-yet-updated
viewer phone at least hides the table and the ledger; the rest closes when it auto-updates (2
minutes online). Ship D1 weeks before any reveal (there is no camp before June).

### 4.13 Edge cases

| Case | What happens |
|---|---|
| Two directors press Reveal at once | the first `update` wins; the second is refused atomically (its `pub` rides in the same update, so no place is skipped); the loser's remote re-reads and toasts who did it |
| Two directors press Start at once | both writes are whole-node; last writer wins; the other remote sees a new `ctl.id` and follows it |
| A Start tapped on a silently dead socket, delivered minutes later | refused by the `ca` window (> 60 s old); the remote says "That Start didn't reach the server. Start again?" |
| Director's phone loses signal mid-reveal | big button and Back show "Reconnecting…"; any other director can carry on; on return the remote follows the server |
| Director's phone dims or locks between places | prevented by the wake lock while the reveal is live; if the OS refuses it, the status line says "Screen may sleep" and, on wake, the button reads "Reconnecting… 2 s" until `.info/connected` |
| A counselor promoted to director mid-camp | the role flips in place; the remote fetches `revealFull`/`revealScreens` with `once()` when opened, so the up-next preview works without a reload |
| TV drops Wi-Fi | "Reconnecting…" chip, then jumps to the current frame; the remote's screen count lags by the SDK disconnect timeout (~1 min) |
| TV opened late / reloaded | static frame, no replay |
| Back at the first place | Back disabled ("Already at 6th place") |
| Back during champion/table | returns to champion or the 1st-place hero |
| End reveal early at 4th | phones keep 6th–4th until 8 AM; grid shows "Not revealed" for the rest |
| New reveal while a grid is showing | the old grid vanishes at once (new id, `pub` cleared) |
| Reveal forgotten (never ended) | phones stop showing the mirror at the final table anyway; any screen treats it as ended 15 min after the last command in champion/table (60 min in intro/live); grid still until 8 AM |
| Rules not yet published | Start refused → the remote shows "The reveal isn't switched on yet (the database rules need updating)" and never a button that leads to a refusal; phones fail closed |
| Listener denied / errors | `revealDenied`; phones show no standings; the rest of the app is untouched |
| A team renamed mid-reveal | names resolve live from `state/teams`; the frozen numbers don't change |
| Ties | one group, several entries, one shared place ("2nd · tie"); counselors' "still to come" counts teams, so no hint before it's revealed |
| Scores entered after Start | not in this reveal; the remote offers "Start again" while still at intro |
| New camp year (P2 wizard / epoch) | the wizard's atomic update deletes `reveal`, `revealFull`, `revealScreens`; clients ignore a reveal whose `epoch` differs; excluded from backups, restore points and the archive |
| Senior | 4 teams, flag marks (or team photos) instead of shields, the same remote; the button starts at "Reveal 4th place" |
| Practice run | lives in `revealPractice`; phones never see it; nobody is buzzed; the TV shows "Practice" |
| Practice while last night's grid is still up (before 8 AM) | nothing happens to the grid: practice can't replace the real reveal |

---------------------------------------------------------------------------------

## 5. The Games tab

Mockup 08 (director).

### 5.1 Day picker

Five equal segments (Mon–Fri, from `competitionDays()`), 48px high, each with a short status
under the day name (12px, 800): "Done" in green for finished days, "Today" in link blue for
today, blank otherwise. It opens on
today (`defaultDay` 2087). The selected segment is a sheet-coloured pill with an ink edge that
slides with the `snap` spring. Not a `jelly-segmented` (pill-before-upgrade snap; this is plain
buttons). Viewing another day adds a one-line note "Wednesday · not today" under the picker
(`dayNoteHTML`).

### 5.2 Directors' live standings

Top of the tab, directors only, one flat panel:

- Header: "Live standings" and a quiet tag "◌ Counselors can't see this" (eye-off icon), a
  constant reminder that this screen is private.
- One line under the header, said once: "Arrows: places moved since this morning · tap a team
  to give quick points".
- One 46px two-line row per team: **shared place numeral** (the TV's rule: equal points share a
  place, "2 · tie"), movement arrow vs this morning (green ▲1 / red ▼1 / –,
  `startOfDayRanks`), shield, short name over its medal counts **in words** ("2 gold · 2 silver ·
  2 bronze", 13px ink-2; never bare "2 · 2 · 2"), points big on the right.
- **Tapping a team row gives quick points** (the spontaneous award, two taps from where
  directors already look): a small sheet with the team preselected, **+1 +2 +3 +5** as 52px
  chunky buttons, reason chips ("Sportsmanship", "Team spirit", "Helping out", "Other…"), and
  Add. Same `bindBonusEntry` write and own-team lock as Award points; the 10-second Undo toast
  covers a wrong tap. Award points (§7.3) stays the place for corrections and the ledger.
- The **gap sentence** under it (`renderCatchupHint`, moved up, not out): "Turkey trail Maples by
  3. One gold for Turkey would put them in front." For a director on a team, the sentence is
  about their own team.
- **"Reveal these on the big screen ›"** link to the remote.
- No horizontal scroll, no emoji column headers. Copy/Share ("Medals so far" for anyone, the
  full table for directors) moves to a "…" button on the panel header.

### 5.3 Game rows and status

The same row component as Now (§3.3), grouped by block: "Morning · Team competitions ·
10:00–11:45", "Evening · Evening competition · 6:00–6:45" (P2 keeps the Morning/Afternoon/Evening
grouping via `blockSession`; this spec uses the block's own label when P2's `gamesForDay`
returns blocks-with-games, else the session name). Unattached games (P2 `unscheduledGames`)
appear last under "Not on the schedule".

Status model (extends `gameStatus` 5771, which returns `done | in-progress | ready`):

| Status | Rule | Row shows |
|---|---|---|
| **Done** | a result exists | medal winners as the 3-up podium strip (§3.3) |
| **Live** | a bracket exists, or a draft has any score/medal, or `state.clocks[gid]` is running | live line per format (§3.3); red mark |
| **Not started** | otherwise | location; "up next" on the first one in the current block |

Counselors see the same rows (no Score). Placement drafts never show a counselor which teams
were picked ("Being scored" only).

### 5.4 Score and Next game

- **Score** on every not-done row for directors (gold for the live/next game). It opens the game
  takeover straight on the entry area. A done row is tappable to fix.
- After any save (placement 6710-6724, tally ~6600, bracket final ~7812, all ending in
  `touchData` → `saveState` → `renderAll` → `celebrate`), the takeover's bottom bar shows **Next
  game: Color Call Chaos →** (gold) and **‹ Back to Now** / **‹ Back to Wednesday games**
  (outlined, the same place the header's labelled back goes), with "2 games left today that you
  can score" above them (mockup 14b). "Next" = the next not-done game in the same block, then
  the rest of today in block order, skipping games where the director's own team plays the next
  round. When nothing is left that this director can score, it says exactly that: "Nothing left
  that you can score. 1 game needs another director: Color Call Chaos (your team plays)", with
  the game named; only when every game is really done: "Every game today is scored ✓". "Next
  game" **replaces** the history entry (§13.5), so Back after three Next games goes to Now, not
  through three finished games.
- "Quick game" and "Add games" (P2) open P2's game sheet, not the old builder takeover.

### 5.5 The game takeover

Replaces `#game-view` under the page. Full screen, own scroll container, opened from Now, Games
or a notification (`game:<id>` deep link).

- Header: labelled back ("‹ Now" or "‹ Wednesday games", whichever opened it), game name,
  location; "How to play" disclosure under it (stays open across syncs: v184's head-string
  compare is kept).
- Body: the existing renderers inside the new frame: `renderLiveWatch`, `renderTournament`,
  `renderTally`, `renderPlacement`, `renderResult`, clocks and tools, each through
  `setLiveHtmlIfChanged` with holds `[g]` as in v184. **One entry change**: `renderPlacement`'s
  three `jelly-select`s (`medalPickerHTML` 6420: open + choose ×3, then Save, about 9 taps per
  game from Now) become **three rows of team shields** (mockup 14): "Gold · 7 points", "Silver ·
  5 points", "Bronze · 3 points", each a 3×2 grid of 64px chunky buttons (shield over short
  name). A team picked for one medal shows dashed and disabled in the later rows with "Gold" /
  "Silver" on it, so a podium is three taps plus Save (5 taps from Now including Score). Tapping
  a picked team again clears it. Points shown per medal follow Messtival doubling as today. The
  draft still writes `drafts` per medal leaf, so two directors and the counselors' "Being scored"
  line behave as today. Tally and bracket entry are unchanged in this project.
- Bottom bar (directors): "Pick bronze, then save" (dashed, disabled) until the podium is
  complete, then **Save result**; after a save, Next game / Back as §5.4. While a score field
  is focused the bar hides (nothing in it is needed mid-typing; the tab bar is already hidden
  under takeovers).
- No accordion folding or positional scroll restore is needed (`setCardOpenNow`,
  `rememberGameOpener`, `restoreGameOpener` retire): the tab underneath never moved.
- `state.ui.gameId` stays device-local but is stored with a timestamp and camp date; a reload
  restores it only within 10 minutes on the same camp day (no more Monday's game on Wednesday).

### 5.6 Counselors on Games

Same day picker and rows, no Score, no standings panel. In its place: the revealed grid while
it's showing (§4.10), otherwise one quiet line: "Standings stay secret until the directors
reveal them on the big screen."

---------------------------------------------------------------------------------

## 6. The Chat tab

The existing chat.js view, re-hosted:

- **Container**: a fixed panel between the header ("Chat", plain title) and the tab bar with its
  own scroll (chat lists anchor to the bottom; document scroll would fight that). The channel
  switcher (four 44px segments sized to their labels, unread counts inline: Announcements ·
  General 2 · Memes · Photos) sits under the header; the bell (subscribe) stays in the channel
  header. Mockup 15.
- **Composer**: sticky at the bottom of the panel, directly above the tab bar: a 44px rounded
  field and a gold Send. When the composer is focused the tab bar slides away (§13.6) and the
  composer rides on the keyboard (mockup 15 draws exactly that).
- **Build once**: `buildChatShell` runs once per channel (`chatViewBuiltFor`) and messages
  append incrementally, as today. Switching tabs never rebuilds it; `renderAll` only updates
  badges.
- **History**: chat no longer pushes its own `{campChat:1}` entry or listens to `popstate`
  (chat.js 817-876, 1324-1343, and `renderChatCard`'s stale-entry pop 889-895 are removed); the
  shell's history rules (§13.5) cover it.
- **Kill switch**: when Chat is hidden from counselors (What counselors see), their Chat tab shows
  "Chat is turned off right now" (and an open chat closes for them, as today). The tab itself
  stays, so the four tabs never change shape.
- **Deep link** `chat:<channel>` switches to the Chat tab on that channel (cross-camp
  sessionStorage handoff unchanged).
- `navigator.setAppBadge` (chat.js 925-935) keeps the Home Screen icon badge.

---------------------------------------------------------------------------------

## 7. The More tab and the Director section

Mockup 09 (director).

### 7.1 Layout

Title "More", identity on the right ("Jenn · Director"), the header status pill when something
is wrong (mockup 16). Grouped lists (one rounded sheet per group, hairline-divided rows, 54px+
rows, icon + title + one-line description + chevron), never a card per row.

1. **Director** (editors only), with the tag "◌ Only directors see this":
   - **Run the reveal**: the one gold, physical row on the page (ink TV icon tile, "Ready · 2 big
     screens online" / "● Live · 3 of 6 shown" / "Rules not published yet"). Opens the remote.
   - Tell everyone · Award points · What counselors see · **Set up the week** (gold count pill
     "1 asking to join") · Change history · Who can sign in (until P2's People screen absorbs it).
   - Owner-only items (new-year setup, edited here / original week) live inside Set up the week
     and render only for the owner key (P2 decision).
2. **Camp**: Full schedule (sheet) · Memory verse · Meal cleanup.
3. **This phone** (mockup 16):
   - **Alerts**: ONE row with a state line in plain words ("On · reaches you even with Camp
     closed", "Only while Camp is open", "Off"). It opens one sheet with two sections, "When Camp
     is closed" (the push drawer: Announcements, mentions, reminders) and "While Camp is open"
     (`state.notify` pop-ups + `state.sound`). Two near-identical rows were too easy to misread:
     a counselor who turned on only the in-app one would get nothing in their pocket and never be
     told.
   - **Appearance**, inline in the group (no extra screen): Theme Light / Auto / Dark and Calm
     motion Auto / On / Off as 44px segmented controls, with one line under them saying what Auto
     is doing ("Calm right now: your phone is saving battery").
   - **Your team** · Ferocious Foxes, "You're Sam · Not you? Change".
4. **Camp switcher** (dual-camp accounts only): "Junior camp · Senior camp" segmented, calls
   `switchCamp()` (set-key-then-reload, unchanged).
5. **Fun**: Stalling with Patrick (presenter page).
6. **Account**: "Signed in as … · Counselor/Director" and **Sign out** (`signOutAndClear`).
7. Footer: "v185 · data updated 10:38 AM · 11 phones have Camp open".

Counselors see 2–7. Every row that existed in the Settings drawer keeps its id/handler or is
re-wired in the same commit (`#builder-row`, `#history-row`, `#members-row`, `#alerts-row`,
`#camp-switch`, `#signout-btn`, `#theme-toggle`, `#sound-toggle`).

### 7.2 Tell everyone (one composer)

Takeover with the blue roof (it changes what everyone sees). Mockup 10 (and 10-dark).

- **Showing now** (only when something is): the live banner(s) and the posted notice, each a row
  with a **Take down** button (banner: removed for everyone; notice: back to draft), so
  un-pinning is one tap from where directors already are.
- **Quick alerts** (a fast path for the moment that matters): three 58px buttons, **Come inside
  now**, **All to the Dining Hall**, **Stay where you are**. A tap fills the message and ticks
  Banner (all day) + Buzz Everyone + **Urgent**; Send is the next tap. More → Tell everyone → a
  quick alert → Send: four taps, no typing. The wording is a constant the owner can change.
- **Message** (one textarea, 280 chars, counter). Drafts are kept on the device until sent;
  `composerBusy()` joins `reloadBlocked()` and `editorMidEntry()` so auto-reload and remote
  adoption can't eat a half-typed message.
- **How it reaches people** (combinable, each a chunky checkbox with a 44px hit area):
  1. **Banner at the top of the app** · 1 hour / 3 hours / All day → `postAnnouncement(text,
     ttl)` (synced `state.announcements`, TTL stamps as today). Default on, 1 hour.
  2. **Buzz phones** · **off by default** ("Off unless you tick it · can't be taken back") ·
     Everyone / A team (team picker) / Directors, **Urgent** switch ("Rings even if someone muted
     director alerts") → `pushSendAlert({text, audience, team, urgent})`. Shown disabled with the
     reason when phone alerts aren't live ("Phone alerts aren't switched on yet") or the phone
     is offline.
  3. **Pin as the big notice** → a posted `state.notice` with the first sentence as the title
     and the rest as the intro (`setNoticeStatus`, editor-gated). `state.notice` is one card
     written whole, so pinning asks first whenever the current notice has **any** content,
     draft or posted: "Replace the notice 'Where your team cleans'? (Jenn's draft)". The Undo
     keeps the previous notice object and restores it, but only if the notice still equals what
     Tell everyone wrote (another director's later edit is never overwritten). Under it: "Write a
     full notice with team areas and steps ›" opens the structured notice composer (P2
     `builderScreen: 'notice'`); its Back returns to this draft.
- **Preview**: "On a counselor's phone" shows the banner exactly as it will render.
- **Send**: one gold dock button whose label says what will happen: "Send to everyone" (banner
  only), **"Send + buzz everyone"** / "Send + buzz the Foxes" / "Send + buzz directors" when Buzz
  is ticked. Each channel reports separately ("Banner posted · Buzz didn't go: offline · Try
  again"). A 10-second "Undo" toast removes the banner / restores the notice; a buzz can't be
  undone, which the Buzz row says before anything is sent.
- **Keyboard**: while the message is being typed the tab bar is already hidden (takeover) and the
  dock rides the keyboard (`bottom: var(--kb-h)`) with a small **Done** button beside Send that
  blurs the field (iOS multi-line fields have no Done key), revealing the options.
- The Announcements chat channel stays a chat channel (with its 15-minute banner); it is not
  part of this composer. The old inline announcement composer and its keyboard-preserving
  node-swap logic (8190-8212) go away; the banner list keeps the node-swap for banners only.

### 7.3 Award points

One takeover with one day picker (Mon–Fri, opens on today) and three sections, all reusing
today's functions and guards:

- **Memory verse**: the verse in one line (tap to expand), 0–5 per team (`setVersePoints`,
  deterministic `verse-<team>-<dow>`, own-team locked, doubled display in the double window).
- **Meal cleanup**: Breakfast / Lunch / Supper rows, each with its assigned team(s) and 0–3
  (`setCleanupPoints`). Zero is an outlined button, not a solid blue one (today's zeros look like
  awards).
- **Quick points**: team chips (own-team locked), ± toggle, points, reason, **Add points**
  (`bindBonusEntry`, `bonusDraft`), the day's ledger below with remove. (The everyday path is
  tapping a team in the Games standings, §5.2; this section is for corrections and minus
  points.)

Game scoring is not here (it's on Games and Now).

### 7.4 What counselors see

- Switches for **Chat**, **Games**, **Memory verse**, **Meal cleanup** writing the existing
  `state.meta.hiddenCards` keys (`chat`, `competitions`, `verse`, `cleanup`), so old builds and
  the tests keep the same contract (`HIDEABLE_CARDS`, `cardHiddenFromViewers`).
- A locked row "Standings · secret until you reveal them" explains the new rule (the old
  `standings` switch retires; the key stays seeded true for old builds, §4.12).
- **Preview as a counselor**: renders the whole app with `role = viewer` for this device only
  (a render override, never `memberRole`, never the auth hint, never persisted), with a sticky
  bar "Previewing what counselors see · Exit". `canEdit()` returns false during the preview, so
  nothing can be written by mistake.

### 7.5 Set up the week

Opens P2's hub (`openBuilder` with `state.ui.builderScreen`). Its badge (join requests) shows on
the row and as the gold dot on the More tab.

---------------------------------------------------------------------------------

## 8. Visual system

### 8.1 Principles

1. **The answer is the headline.** The biggest text on a screen is the thing you came for (the
   block, your station, the verse, the place), not a section label or the tab's name.
2. **One physical object per screen.** Only the Now card (and on the remote, the mini TV) has
   the ink border and the 4–5px bottom edge. Everything else is flat rows on paper divided by
   hairlines, like the printed run sheet (P2's "director's clipboard", §11.0 there). Lists that
   need a surface (the reveal ladder, the grid, the More groups) are ONE grouped sheet with
   hairline rows, never a stack of bordered boxes; only the row that matters gets an accent
   (the on-screen place's gold edge, the up-next hatch). This replaces the stack of identical
   rounded cards with a single place for the eye to land.
3. **Chunky means pressable.** Buttons have a 2–3px border and a 3–7px darker bottom edge and
   squash when pressed. Rows that navigate have a chevron. Static information has neither.
4. **Blue roof means broadcast.** The camp-blue header appears only on screens whose buttons
   change what everyone sees (the remote, Tell everyone). Everywhere else the header is paper.
5. **Team colour is identity, never decoration.** It marks your team's row, outlines your team
   in a live board, and colours flag marks. It's never a background wash or a left stripe.
6. **Sunlight first.** Text under 16px is **7:1 or more** on its background; 16px and up at
   least 4.5:1 (nearly all of it is 8:1+). Non-text boundaries a reader must see (a switch's
   OFF track, dashed "hidden" rows, outlines) are 3:1 or more. Every mockup passes an automated
   audit of both rules in light and dark (Review log). Glare washes contrast out roughly in
   proportion, so the small text gets the biggest margin.
7. **One tint per meaning.** Tinted fills are reserved for exactly two things: a message
   (blue-tint banner with its icon tile) and a moment (the gold cleanup panel). Notes such as
   "Rain likely around 4 PM" or "Red plays in the final next" are plain lines with an icon, never
   another tinted callout.

### 8.2 Type

Inter (UI) and Inter Display (headlines ≥ 22px), system stack fallback; tabular numerals
everywhere; a serif (New York / Iowan / Georgia) only for scripture.

| Token | Size / line / weight | Used for |
|---|---|---|
| `--t-display` | 34/36 · 850 Display | remote button labels, TV-sized numbers in the mini TV |
| `--t-title` | 27/29 · 800 Display | the Now card's block title, tab titles ("Games", "More" at 28) |
| `--t-head` | 21–24/26 · 800 Display | the station headline (30), "Tonight's standings", team names in moments |
| `--t-row` | 17/20 · 750 | game names, row titles, list titles (16.5) |
| `--t-body` | 15–16/21 · 600 | descriptions, schedule labels |
| `--t-meta` | 14/18 · 550 | sublines under rows (ink-2) |
| `--t-label` | 13/16 · 700–750 | section labels in sentence case ("Later today"), the Now kicker |
| `--t-tag` | 12.5/15 · 800 | status tags (Live, Done, Your team, On the big screen now) |
| `--t-num` | 18–27 · 850 Display | points, places, scores |
| `--t-scripture` | 23/33 · 500 serif | the memory verse |

Rules: section labels and button kickers are sentence case, never letter-spaced capitals ("4th
place", "Reveal", "Freezes the standings at 7:31 PM"); **12px is the floor for anything**, 12.5px
for tags and tab labels, 13px for any digit inside a medal disc (the disc grows to 22px); numbers
are never smaller than the word they count.

### 8.3 Colour roles

Light (paper) and dark (navy) themes share roles; contrast measured with the WCAG formula.

| Role | Light | Dark | Notes (contrast on page / on sheet) |
|---|---|---|---|
| `--paper` page | `#f5efe2` | `#0c1030` | warm paper: less glare than white, and the white sheet separates from it |
| `--paper-2` wells, segmented tracks | `#ebe2cf` | `#151a45` | |
| `--sheet` raised surfaces | `#fffdf8` | `#161c4b` | |
| `--ink` text | `#141a48` | `#f3f4ff` | 14.4 / 16.3 · 17.0 / 14.7 |
| `--ink-2` secondary | `#373d72` | `#c5caf3` | 8.8 / 10.0 · 11.6 / 10.1; 7.9 on paper-2 |
| `--ink-3` tertiary (min) | `#43497a` | `#a3aade` | 7.4 / 8.4 · 8.3 / 7.2; also the 2px OFF outline of switches and the dashes of hidden rows |
| `--line` hairline | ink 13% | white 12% | |
| `--blue` camp blue (active-tab blob, focus, non-text) | `#2c47ee` / edge `#18299c` | `#9aabff` / edge `#5a6ee6` | |
| `--link` blue text (links, "Today", badges) | `#2234c4` | `#aab8ff` | 7.8 on paper; white on it 8.9 (badges); dark 8.5 on sheet, navy text on dark badges |
| `--roof` broadcast header (remote, Tell everyone) | `#2c47ee` / edge `#18299c` | **same** (does not flip) | white on roof 6.5, all roof text ≥ 16px |
| `--gold` primary action | `#f7b928` / edge `#986409` | same | ink on gold 9.4 |
| `--live` live state, the reveal strip | `#8f1a13` | `#ff8a7f` (tint `#33121a`) | 7.9 on paper, 7.4 on its tint; white on it 9+; dark 8.1 / 7.4 |
| `--done` done state | `#0d542d` | `#62d890` | 7.9 on paper, 7.5 on its tint; dark 10.4 |
| medal discs | gold `#f2b632`, silver `#c9d0da`, bronze `#e0a36a`, always with an ink outline; ink numerals 7.6:1 or more | | a disc means a PLACE won (1/2/3), never a count; never a row fill |

Team colours: P2's measured 12-colour palette (Appendix A there) with light and dark values,
through `teamAccentVars(id)`. Junior's mapping (until directors pick in P2's Teams screen):
Foxes pumpkin, Turkey brown, Maples red, Pumpkins gold, Pilgrims blue, John Deersz green
(all ≥ 4.5:1 on paper; today's fox and pumpkin oranges are 3.0 and 2.6). Senior: red, blue,
green, gold. Team colours are used for outlines, tags' outlines and flag fills, never as a fill
behind small text: the "Your team" tag is ink text in a 2px team-coloured outline (white on the
fox orange was 5.4:1).

### 8.4 Team identity

`teamMark(id, size)` is the one helper every team appearance goes through:

1. P2 team photo (cached data URL) if set;
2. else junior's shipped shield (`teamCrestSrc`);
3. else a **flag mark**: a small SVG pennant on a pole (senior today; mockup 13). Hue alone is
   not enough (under deuteranopia senior Red and Gold differ by ΔE 1.8), so each team also
   gets a **shape**: plain pennant, swallowtail, white stripe, dark chevron, assigned in team
   order. The fill uses a brighter mark token (Gold `#e0a100`, Red `#d92d20`, Blue `#2f6fd0`,
   Green `#2f8a35`) with a 1.4px ink outline for its edge; the text-safe dark value (Gold
   `#8a6100`) is for outlines and text only, never a fill (it read as brown);
4. else the team emoji (only if no colour exists either).

Sizes: 20–24 (inline chips, live boards), 28–34 (rows, header), 52 (moments), 100+ (TV, mini
TV). Shields keep their soft drop shadow; flags don't. "Your team" is a 2px outline in the team
colour (rows, podium cells) or a team-outlined tag; never a fill.

`teamMark()` emits a small, stable, keyed element (`<img class="tm" data-team="t0"
data-v="<photo version>">`); the `src` is set once per photo version from a cached `blob:` URL
(CSP `img-src` already allows `blob:`). Markup strings never carry a P2 team photo as an inline
data URL: up to 100 000 characters per photo made every no-op render of a root with twenty
crests cost 40–60 ms on a throttled phone, on every snapshot and every tick.

### 8.5 Space, shape, targets

4px grid; 16px side gutter; 8/12/16/24 vertical rhythm. Radii: 18 (Now card), 16 (grouped
lists), 12–13 (buttons, rows), 22 (remote buttons). Edges: Now card 4px, buttons 3px, remote
7px. **Every target ≥ 44×44**: Score buttons 44 high (`.btn.sm` is 44, not 40), award buttons
52, podium picks 64, the remote's 92, segmented controls and switch rows 44, the roof's "‹ More"
44, End reveal 44. Where the look must stay small (a banner's ×, "Whole day ›", "Not you?
Change", a checkbox) the glyph stays small and the **hit area** is padded to 44×44. A Playwright
check measures every button, link and `[role=tab]` in every mockup screen at 360 and 390 and
fails under 44 in either dimension (all mockups pass). Bottom dock and tab bar sit above
`env(safe-area-inset-bottom)`. Switches always show their state in words beside them ("On" /
"Off"), and OFF has a 2px `--ink-3` outline and an ink-3 thumb, so an off "Urgent" or "Practice
run" is visible in sunlight (the old OFF track was 1.7:1).

### 8.6 Icons and emoji

- **Icons** (UI chrome only): one hand-drawn line family on a 24 grid, 2.2 stroke, round caps
  (clock, trophy, bubble, dots, chevrons, lock, eye-off, TV, megaphone, star, eye, calendar,
  book, broom, history, bell). Inline SVG, `currentColor`.
- **Emoji** only for: schedule blocks (🏅 📖 🌟 🍳…), elective stations (🎨 🎲 🏊…), meals' dish
  (🌭), and a team with neither crest nor colour. Never in headings, buttons, tab labels, table
  headers or status. The 59-emoji home page becomes ~6 on a typical Now screen.

### 8.7 Copy

Plain English, sentence case, verbs on buttons ("Score", "Reveal 3rd place", "Send to everyone",
"Start again"), no "Submit/OK/Oops", no exclamation marks except the champion. Times as "10:00–
11:45", "63 min left". Names over pronouns ("Jenn already showed 4th place"). Every refusal says
what to do next. Glossary in Appendix B.

### 8.8 Generic-app habits this design refuses

Stacks of identical rounded white cards; everything collapsible; emoji as the icon set;
pills around every label; letter-spaced uppercase eyebrows; coloured left-border "callouts";
gradients and glows as decoration; centred everything; explanation paragraphs above content;
grey-on-white low contrast; vertical centring in fixed-height boxes; skeleton shimmer for cached
data; sparkles on every tap with no meaning (sparkles stay, but only on Score, Reveal and award
buttons, and calm-aware, §9.7); a second, third and fourth tinted callout (rule 7).

### 8.9 Accessibility

- **Text scaling**: no fixed heights on anything that holds text: rows, buttons and the tab bar
  use `min-height` plus padding, so they grow at Android's 130% font scale and iOS larger text.
  Playwright pass at 130% and 200% text on Now, Games, the remote and Tell everyone: nothing
  clipped, nothing overlapping; long names wrap or ellipsise as specified.
- **Screen readers**: the tab bar is `role="tablist"` with `aria-current="page"` on the active
  tab and the unread count in its label ("Chat, 3 unread"). The reveal mirror and the remote's
  status line are `aria-live="polite"` and announce each place once ("4th place: Ferocious
  Foxes, 22 points") when it lands, never on a re-render. Opening a takeover moves focus to its
  labelled back; closing returns focus to the row that opened it. Sheets trap focus and close
  on Escape. Toasts use Jelly's existing `role="status"` rail.
- **Colour-independent cues**: status is never colour alone (Done has a check, Live a dot plus
  the word, Not started a ring); teams always carry a name or a shield/flag shape beside their
  colour (§8.4); medal discs carry their numeral.
- **Contrast preferences**: `prefers-contrast: more` swaps `--line` hairlines for `--ink-3` and
  thickens the Now card's border; the 7:1 small-text rule already covers the rest.
- **Motion**: calm motion (§10) and the OS setting, which always wins.

### 8.10 Jelly components inside the new shell

Decided once, so the shell doesn't end up half chunky, half blob:

| Stays Jelly (themed) | Becomes shell markup |
|---|---|
| `jelly-toaster` (every toast, mockup 07c state 2), `jelly-dialog` (confirms: End the reveal, Replace the notice), `jelly-drawer` (the Alerts sheet's push section, P2 builder screens), form fields inside existing game renderers and P2 screens (`jelly-input`, `jelly-textarea`, `jelly-switch`, `jelly-checkbox`) | buttons (`.btn` chunky, with the shared press), the tab bar, segmented controls (Theme, Calm motion, day picker, chat channels), the remote's buttons, the podium picker (replaces `jelly-select` there) |

Jelly's tokens are mapped onto the app's in ONE place at the top of styles.css, replacing today's
`--jelly-color-background-accent: #3355ff / #6b85ff` (styles.css:117-127):
`--jelly-color-background-surface: var(--sheet)`, `-border-default: var(--line-2)`,
`-foreground-default: var(--ink)`, `-foreground-muted: var(--ink-2)`, `-background-accent:
var(--roof)`, `-foreground-on-accent: #fff`, `-background-azure: var(--roof)`, `-background-mint:
var(--done)`, `-background-amber: var(--gold)`, `-background-rose: var(--live)`, plus
`--jelly-toast-radius: 14px` and the toaster's bottom offset (§13.7). The motion demo now
embeds the real `vendor/jelly.js`: its toasts are the shipped `jelly-toaster` in these colours,
and a real `jelly-button` sits beside a chunky button so the two presses can be compared.

---------------------------------------------------------------------------------

## 9. The jelly motion system

### 9.1 Principles

1. **One system.** Every state change in the app uses one of six named springs, integrated the
   way vendor/jelly.js integrates (semi-implicit Euler, mass 1, `E(x, v, target, k, c, dt)`,
   jelly.js:108-112, ONE step per frame at the frame's dt). Presets are sampled at dt = 1/60 s,
   which is exactly what a Jelly component computes on a 60 Hz phone (the first draft sampled
   at 1/240 s, which made `snap` overshoot 7.3% where Jelly's own thumbs do 4.9%). The real
   follower uses the real frame dt, clamped to 33 ms like Jelly.
2. **Motion only for real change.** An animation is started by the code that knows a change
   happened (a diff), never by a render. Re-rendering unchanged data animates nothing (§9.8).
3. **Squash and settle, not fade.** Things arrive with a little overshoot and a volume-keeping
   squash (wider when shorter), then settle. Fades exist only in calm motion.
4. **Local joy, remote calm.** The phone that saved a result throws confetti; the other 40
   phones see the medals land quietly. Celebrations are earned (a medal, your team revealed, the
   champion), not attached to every tap.
5. **Calm is a first-class variant**, designed per motion (§10.4), not "duration 0". Exits and
   replacements go through the same system, so they are calm too.
6. **Visible, not theoretical.** A spring with 1% overshoot reads as an ease-out. Every arrival
   shows a deformation you can see (§9.2's minimums), and `motion.test.js` fails if a row of
   §9.5 drops under its minimum.
7. **Motion leaves no trace in the DOM.** Animations are WAAPI only: no inline `style`, no
   `commitStyles()`, no leftover `class=""`. `fill:'forwards'` is allowed only for the press hold
   (always cancelled by the release) and for exits whose element is removed or hidden on finish.
   A residue would make `setHtmlIfChanged` (3304-3311: it skips only when
   `el.__dom === el.innerHTML`) rewrite the whole root on the next render, re-creating Jelly
   components and shields and cutting the spring off (a Chromium probe showed `style=""` left by
   a set-then-cleared transform triggers exactly that).

### 9.2 The six springs

| Name | k | c | ζ | Overshoot at 60 Hz | Matches jelly.js | Used for |
|---|---|---|---|---|---|---|
| `press` | 260 | 17 | 0.53 | 11.4% | button/checkbox pop (jelly.js:1935, 2045) | check marks, numbers changing, label swaps, the tab icon pop |
| `arrive` | 240 | 16 | 0.52 | 12.4% | toast/springIn feel (new name) | **anything arriving**: tab panels, sheets, banners, the reveal strip, the moment panel, the "Look at the big screen" row, the TV name |
| `snap` | 310 | 22 | 0.62 | 4.9% | slider/segment thumbs (2533, 2841) | tab blob, the "on screen now" tag, day picker pill, switches |
| `settle` | 300 | 26 | 0.75 | 0.6% | toggle thumb (2313) | **full-screen takeovers only** (a whole screen must not bounce) |
| `glide` | 260 | 32 | 0.99 | 0% | segmented pill (3509) | things moving out of the way (keyed FLIP), progress hairline, the remote's recharge fill |
| `wobble` | 170 | 9 | 0.35 | 30% | the ring-down of a pressed jelly-button | **chunky-button release**, medal landing, reveal rows unwrapping, the crown, a refused tap's shake |

Mass is 1; `x` runs 0 → 1; one step per frame, dt = 1/60 s for sampled presets.

**Minimum visible deformation** (asserted per §9.5 row by `motion.test.js`, from the sampled
keyframes): arrivals peak at ≥ 4% scale deformation or ≥ 3px of overshoot past rest; a chunky
press dents ≥ 10% and its release stretches past rest by ≥ 3%; reveal rows and medals by ≥ 8%.
Overshoot is turned into volume-keeping squash at the landing (wider when shorter), which is
where the eye reads "jelly". The demo's legend prints each preset's overshoot live.

### 9.3 CSS tokens

For CSS transitions that don't need JS (hover/press states, small toggles), styles.css gets
tokens that approximate the springs with jelly.js's own curves, plus `linear()` versions sampled
from the springs where supported:

```css
:root{
  --jm-press:   cubic-bezier(.34,1.7,.5,1);   --jm-press-ms: 180ms;   /* jelly tap overshoot */
  --jm-arrive:  cubic-bezier(.3,1.6,.45,1);   --jm-arrive-ms: 460ms;  /* arrive: overshoot + settle */
  --jm-enter:   cubic-bezier(.16,.82,.28,1);  --jm-enter-ms: 420ms;   /* jelly springIn */
  --jm-toggle:  cubic-bezier(.3,1.8,.45,1);   --jm-toggle-ms: 360ms;  /* jelly toggles */
  --jm-row:     cubic-bezier(.28,1.35,.5,1);  --jm-row-ms: 360ms;     /* jelly collapsible rows */
  --jm-std:     cubic-bezier(.4,0,.2,1);      --jm-exit-ms: 150ms;    /* exits, calm */
}
@supports (animation-timing-function: linear(0, 1)) {
  :root{ --jm-press: linear(0, .22 4%, .62 11%, 1.08 22%, 1.13 28%, 1.04 40%, .98 52%, 1); }  /* illustrative; the real stops are generated */
}
```

The `linear()` stop lists are generated once by `JellyMotion.cssLinear(preset)` and pasted
(there is no build step); `motion.test.js` regenerates them and fails if styles.css drifts. The
seven hand-written beziers in styles.css today are replaced by these tokens. `transition: all`
stays banned.

### 9.4 The helper: `jelly-motion.js`

A classic script (~3 KB), loaded after camps.js and before app.js, **no dependency on the Jelly
module** (iOS < 16.4 can't parse it; boot-guard's `jelly-failed` path must still move). Global
`JellyMotion`:

```js
JellyMotion.presets                       // the table in §9.2
JellyMotion.calm()                        // === calmMotion() (§10)
JellyMotion.sample(preset, v0) → {xs, vs} // memoised spring samples, one step per 1/60 s (jelly's integrator)
JellyMotion.play(el, preset, frame, opts) → Animation | null
    // frame(x, v) → keyframe ({transform, transformOrigin, opacity, clipPath, …}); x runs 0→1.
    // WAAPI keyframes from the samples, easing 'linear', fill 'backwards': compositor-friendly,
    // cancellable, no rAF loop, no DOM residue. Cancels the element's previous motion.
    // opts: { v0, delay, layer (don't cancel others), calm: keyframes | false, calmMs }
JellyMotion.playOut(el, frame, ms, done)  // exits and replacements: short, accelerating out,
    // calm = opacity only; fill 'forwards' only until done() removes/hides el, then cancelled
JellyMotion.follow(preset, x0, onFrame) → { to(target, v), set(x) }
    // a tiny interruptible rAF spring for things that chase a moving target. ONLY on nodes that
    // no string renderer ever rewrites (the tab blob, a sheet), because it writes style.
JellyMotion.morph(root, html) → addedNodes
    // keyed, identity-preserving update: children with the same data-key survive (only their
    // className/innerHTML change); new keys are inserted, missing ones removed, order fixed.
JellyMotion.flipKeyed(root, html, preset='glide')
    // snapshot rects BY KEY, morph, then spring every surviving node back from its old place.
    // This is how the ladder, live boards and game rows glide: rewriting a root through
    // innerHTML replaces the nodes a plain FLIP measured, so neighbours just jumped.
JellyMotion.whenHandsOff(fn)              // run a reflow only when no pointer is down on the list
    // and 400 ms have passed since the last touch (never move a row under a thumb)
JellyMotion.press(el, point) / JellyMotion.release(el)
    // the press dent (§9.6); wired once at document level for chunky controls.
JellyMotion.cssLinear(preset) → 'linear(…)'   // for the tokens in §9.3
JellyMotion.busy()                        // true while any motion runs (the calm sampler waits)
JellyMotion.restamp(root)                 // root.__dom = root.innerHTML, for the rare unavoidable
                                          // in-place change inside a setHtmlIfChanged root
```

Everything is no-op-safe: no `Element.animate` (very old WebKit) → instant state change; tests'
stub DOM (`tests/harness.js` has no WAAPI) → `play` returns null. Roots written by
`setHtmlIfChanged`/`setLiveHtmlIfChanged` carry `data-key` on every row that can move, and their
renderers call `morph` for the row list (the root's own string compare still decides whether
anything is written at all). `motion.test.js` asserts that `outerHTML` is unchanged after
press, release, play, playOut-with-removal and flipKeyed on a stable root.

### 9.5 Which change uses which motion

| State change | Motion | Spring | What moves | Calm variant |
|---|---|---|---|---|
| Tab switch | blob travels; icon pops; panel arrives | snap / press / arrive | blob `translateX` with stretch `scale(1+s, 1−0.4s)`, `s = min(.5, |v|/1600)`; icon `scale(.78→1)`; panel `translateY(22→0)` from its top edge, overshoot turned into squash `scale(1+.12o, 1−.3o)` (≈ 4% at peak) + opacity | blob jumps; panel 120 ms fade |
| Panel appears (moment, live board, "Still to do") | unfold + neighbours glide | arrive + glide (keyed FLIP) | panel `scaleY(.6→1)` from its top with landing squash; siblings by key from their old position, only once hands are off the list | 160 ms fade; siblings jump |
| Number changes (score, points, count) | roll and pop | press | new value `translateY(10→0) scale(1.12→1)` | 120 ms crossfade |
| Status Live → Done | dot collapses, check pops, tag pops | snap, press | dot `scale(1→0)`; check `scale(.3→1) rotate(−14°→0)`; tag `scale(.6→1)` | swap with 160 ms fade |
| Live board → medal winners | board collapses (FLIP), medals drop bronze → silver → gold, 120 ms apart, squash on landing. **The collapse waits** while a finger is on the list and for 400 ms after the last touch (`whenHandsOff`): when another director saves, the row a director is about to tap never slides 75px under the thumb | glide, wobble | podium cells fall 22px; on overshoot `scale(1+.6q, 1−q)`; local save: confetti from the gold cell | medals fade in together; a gold ring pulse instead of confetti |
| Reveal on a phone: the 3 s lag | a "Look at the big screen" row arrives where the place will land | arrive | `scaleY(.5→1)` with squash | fade |
| Reveal: a place lands (mirror and remote ladder) | the SAME keyed row becomes the full row and unwraps from flat, the shield drops, the points roll up, neighbours glide by key | wobble, press, glide | row `scale(1.05→1, .55→1)`; shield `translateY(−26→0)` with landing squash; points `translateY(16→0)` | 200 ms fade |
| "On the big screen now" tag moves | slides with stretch | snap | `translateY(old→0)` with vertical stretch from velocity | jumps |
| Your team revealed | team-colour sparkle burst (16) | joy | particles | gold ring pulse |
| Champion | crown drops and wobbles, confetti | wobble + joy | crown `translateY(−30→0) rotate(−20°→0)` | crown fades in |
| Remote big button press | dents toward the finger, edge compresses, rings back | press dent / wobble | down: 70 ms to `translateY(6px) skewX(±3°) scale(1.06,.88)` around the touch point, edge 7→2px; up: `wobble` back, stretching ~4% past rest | opacity .82 while pressed |
| Remote label swap | old label up and out, new label rises | playOut / press | old `translateY(0→−26)` 130 ms; new `translateY(28→0) scale(.9→1)` | crossfade |
| Remote recharge | fill grows left to right; the face counts down in words; ready pop (+ haptic on Android) | glide / press | `scaleX(0→1)` over the TV beat (a progress bar: kept under calm) | same fill and words, no pop |
| A refused tap (remote too early, Back locked) | one short sideways wobble + a toast saying why | wobble | `translateX(9·(1−x)·cos 9x)` | a 200 ms dim |
| Up-next peek | the masked row turns into the team row while held | press | content crossfade, row `scaleY(.96→1)` | swap |
| Mini TV place change | old hero out, name arrives, shield drops, score pops at the beat | playOut, arrive, wobble, press | as TV | crossfade |
| Sheet open | thrown up, overshoots and squashes against the top of its travel | arrive (follower) | `translateY(100%→0)`, overshoot as `scaleY` from the bottom edge | 160 ms fade |
| Sheet drag / throw | follows the finger from the **grab strip** (or from the list only when it is scrolled to the top and moving down); release springs back or is thrown away by velocity | arrive (back), follow (throw) | `translateY` | drag works; release snaps without bounce |
| Takeover open / close | slides in from the right and settles / slides out | settle / playOut 220 ms | `translateX(100%→0)` | 140 ms fade |
| Toast | the real `jelly-toaster` (its own `toastIn`/`toastOut` springs, which follow `data-jelly-motion`) in the app's colours (§8.10) | Jelly | — | Jelly's reduced variant |
| Banner arrives | drops from the top, squashes on landing | arrive | `translateY(−56→0)`, overshoot as `scale(1+.5o, 1−1.4o)` (≈ 6% squash) | fades |
| Banner dismissed | squash out, the rest glide up | playOut + keyed FLIP | `scale(.96)` + opacity; siblings by key | fade; siblings jump |
| Day picker | pill slides | snap | `translateX` with stretch | jumps |
| Progress hairline | value nudged (never refilled) | glide | `scaleX` | instant |
| Tab bar hides for the keyboard | slides down | glide | `translateY(100%)` | instant |

### 9.6 Press squash

One document-level handler (it replaces v184's `joy-pressed` / `joy-pop` classes and keeps
their good parts: the 80 ms delay before a press shows, the 8px slop cancel, quick-tap pop from
rest). For chunky controls (`.btn`, remote buttons, award buttons, podium picks, tab buttons,
list rows): pointerdown → in 70 ms the control **dents toward the finger**: `transform-origin` at
the touch point, `translateY(4px)` (6px for the remote), `scale(1.06, .88)` and a skew of up to
3° toward the side that was pressed, with the bottom edge compressing; pointerup → the
**`wobble`** spring brings it back, ringing ~30% past the pressed state (a visible stretch past
rest), the way a pressed jelly-button bulges and rings for ~0.8 s. The first draft's
`scale(1.03,.93)` + `press` release measured under 1% of stretch next to a Jelly button's
47%: chunky buttons felt dead beside the components that remain. Whole cards and scroll
containers are never press-scaled. Jelly components keep their own canvas press physics; the
motion demo puts a real `jelly-button` beside a chunky one to tune by eye. All of it is WAAPI
(no residue, §9.1 rule 7).

### 9.7 The joy layer (kept, retuned)

- **Sparkles on taps**: 6 small particles only where a press means something (Score, Save
  result, the remote's Reveal, award buttons, podium picks), never on tabs, back buttons or
  links; throttled 90 ms, capped at 70 in `#joy-layer`; off in calm.
- **Confetti on saves**: `celebrate()` stays for result saves on the saving phone; a remote
  result landing on other phones gets the medal drop instead (rule 4).
- **Celebrations**: board goal cannons and score-pop stay in the game takeover (still held across
  rebuilds by `holdBoardCelebrations`); your team revealed (burst in team colour); champion
  (crown + confetti on TV and phones).
- `touchData()`'s automatic big burst (`joyCelebrate`) is limited to real saves and keeps its
  800 ms throttle.
- All of it reads `calmMotion()` live (today `JOY_REDUCED` is a const read once at load).

### 9.8 Never re-animate when nothing changed

- Renderers never put animation classes or `@keyframes` triggers in markup. Markup is stable
  strings (`setHtmlIfChanged` / `setLiveHtmlIfChanged`); motion is started afterwards by diff
  hooks: `onGameStatusChange(gid, from, to)`, `onRevealAdvance(prev, next)`,
  `onScoreChange(gid, team, from, to)`, `onMomentStart(kind)`, `onBannerAdded(id)`.
- **Motion ledger**: each animated thing has a key (`game:axe:status`, `reveal:r1k…:g2`,
  `banner:<id>`); the ledger stores the last value it animated to. A hook animates only when the
  new value differs, so a re-render, a tab switch, an un-hide, a takeover closing or a reload
  never replays anything. The ledger is in memory: after a reload nothing replays (late-join rule).
- Inactive tabs never animate. Animations started for an element that is about to be replaced
  are cancelled (`play` cancels the element's previous motion).
- **No residue** (§9.1 rule 7): motion inside any `setHtmlIfChanged` / `setLiveHtmlIfChanged`
  root is WAAPI-only, and rows that move are keyed so `flipKeyed` moves the real nodes.
  `motion.test.js` drives press, release, play, playOut and flipKeyed against a stable root and
  asserts the root's `outerHTML` and `__dom` are unchanged, so the next render writes nothing.
- The v184 `.card-opening` transient-class gate retires with the accordion; its principle (a
  transient trigger, never an always-on animation rule) is the ledger's.

---------------------------------------------------------------------------------

## 10. Calm motion

### 10.1 One source of truth

```js
calmMotion() → boolean     // jelly-motion.js; app code never reads matchMedia for motion again
calmReason() → 'switch-on' | 'switch-off' | 'os' | 'battery-saver' | 'battery-low' | null
```

```
OS prefers-reduced-motion → calm, whatever the switch says (it is an accessibility setting;
                             "Off" must not override it)
pref = 'on'   → calm
pref = 'off'  → not calm (overrides the battery signals only)
pref = 'auto' → calm if  the frame-rate sampler says ≤ 36 Hz (battery saver)
                      or navigator.getBattery(): level ≤ 20% and not charging
```

When the result changes: toggle `html.calm-motion`, set `html[data-jelly-motion]` to `reduce` /
`no-preference` and dispatch `window` event `jelly-motion-change` (vendor/jelly.js:905-912
already listens; nothing dispatches it today), so Jelly's canvas components, springIn/springOut,
toasts, tabs and collapsibles follow the same switch.

### 10.2 Detection

- **Frame-rate sampler** (iOS Low Power Mode and Chrome Energy Saver cap `requestAnimationFrame`
  at ~30 Hz): sample 24 consecutive rAF intervals and take the median. Runs 2 s after boot when
  idle, 1.5 s after `visibilitychange` → visible, and every 5 minutes while visible. **Never
  during motion**: it waits while `JellyMotion.busy()`, while confetti runs, while a Pictionary
  stopwatch (100 ms tick) or a board clock heartbeat is active, and abandons a sample if an
  animation starts mid-way. ≤ 36 Hz twice in a row → saver on; ≥ 50 Hz twice in a row → off.
  120 Hz phones read ~120.
- **Battery** (Android Chrome only): `navigator.getBattery()` with `levelchange` /
  `chargingchange` listeners. Absent everywhere else; never polled.
- **OS**: `matchMedia('(prefers-reduced-motion: reduce)')` with a change listener.
- **Hysteresis**: calm turns on immediately; turns off only after 60 s without a signal, so a
  phone near the threshold doesn't flap.
- Tests' harness has no `getBattery` and a stub `matchMedia` (tests/harness.js:108-129); all
  three inputs are optional.

### 10.3 The switch

More → Appearance → **Calm motion: Auto · On · Off** (a three-part segmented, the owner's
labels), with one line under it that says what is happening right now: "Calm right now: your
phone is saving battery", or, with Off chosen on a phone set to reduce motion, "Your phone asks
for less motion, so Camp stays calm. Change it in your phone's Settings." (mockup 16). Device-local, `localStorage.campScoreboardCalmMotion` (`auto|on|off`), plus
`campScoreboardCalmLast` (the last computed result) so **boot-guard.js paints the first frame
calm** when the last session was calm (same pattern as the theme key). Both keys follow the theme
precedent: wiped by `clearLocalData` on sign-out (auth.test.js wipe-list pin updated).

### 10.4 What calm changes

| Thing | Full | Calm |
|---|---|---|
| Springs | overshoot, squash, stretch | no overshoot, no squash: 120–200 ms opacity with `--jm-std`; positions jump |
| Press | squash + edge compress + pop | opacity .85 while pressed, edge compress kept (it's feedback, not motion) |
| Sheets / takeovers | slide + settle | fade 140–160 ms; dragging still follows the finger |
| Joy layer | sparkles, confetti, cannons | off; a single soft gold ring pulse marks a save or a revealed team |
| Live pulse / clock heartbeat / board glow | infinite animations | static (a solid red dot) |
| Exits and replacements (old TV hero, old button label, toasts, takeovers closing) | short transform out | opacity only (`playOut`'s calm path; a test asserts no transform keyframes are created while calm) |
| TV page | full show | honours the OS setting only (it has no switch); the waiting shields stop bobbing |
| The remote's mini TV | full show, bobbing shields while waiting | follows this phone's `calmMotion()`: static shields, crossfades |
| The recharge fill | grows | still grows (it is a progress bar, it carries information) |
| Haptics | on | on (not motion) |

### 10.5 Retiring today's four reduced-motion paths

`JOY_REDUCED` (8715) and the raw `matchMedia` reads at 928, 3582, 7134 call `calmMotion()`. The
nine `@media (prefers-reduced-motion)` blocks in styles.css become `html.calm-motion` blocks
(boot-guard and `calmMotion()` add the class for the OS case too), including the unguarded
`lock-shake`. `shell.test.js` pins that styles.css has no motion media query left.

---------------------------------------------------------------------------------

## 11. Dark mode

Mockups 12, 05-dark, 07-dark, 08-dark, 10-dark, 13-dark, 14b-dark (all generated from the same
markup with `body.dark`, and all passing the contrast audit). Same roles, navy paper
(`#0c1030`), navy sheets (`#161c4b`), white-ish ink; contrast in §8.3. Differences beyond the
token swap:

- The Now card's border becomes white 22% with a near-black edge, so the "physical" card still
  reads without glowing.
- Gold stays gold (it already passes on navy). `--blue` and `--link` lighten (`#9aabff`,
  `#aab8ff`) and text on them becomes navy (badges included).
- Shields get a darker shadow; team colours use the palette's dark values (`--team-accent-d`).
- The remote and Tell everyone keep the camp-blue roof in dark mode (it's the broadcast signal):
  it is its own token, `--roof: #2c47ee` with white text (6.5:1, all roof text ≥ 16px), which
  does NOT flip with `--blue`. The first draft painted the roof with `--blue`, which would have
  put white text on `#9aabff` at 2.2:1. The page under it is navy; the Back button, ladder
  hatch, hidden rows and tags all take theme tokens (no hard-coded white or ink), and the mini
  TV stays in the TV's light colours inside a lighter frame.
- The TV page is always light (projectors wash out navy).
- Theme switching keeps v184's two-frame transition suspend (`html.theme-switching`); the theme
  key and pre-paint are unchanged.

---------------------------------------------------------------------------------

## 12. Mapping onto today's code and P2's accessors

No renderer reads `DAY_SCHEDULE`, `CAMP.*` week fields or the old constants directly (P2
`seam.test.js`). Until P2's S1 lands, the redesign defines the same accessor names inside the
SEAM block with the built-in fallbacks P2 specifies, so S1 later replaces bodies, not callers.

| Region | Today | New code | Reads through (P2 §9.2) | Fallback before P2 lands |
|---|---|---|---|---|
| Header identity | `renderFollowCard` 4835 | `renderHeader()` + `renderTeamSheet()` | `teamName`, `teamShort`, `teamMark` (new, over `teamCrestSrc` + `teamAccentVars`), `counselorName` | `TEAM_SHIELD`, `TEAM_ACCENT` via the same helper |
| Now card | `nowBannerHtml` 751, `renderNowBanner` 816, `splitNowBanner` 863 | `nowModel()` + `renderNow()` (kind renderers) | `scheduleForDow`, `planForDow`, `blockKind` (new), `blockMeal`, `mealFor`, `cleanupTeams`, `verseFor`, `verseTheme`, `electivesFor`, `stationEmoji`, `electiveSlotStart`, `campWeek` | today's label rules, moved into `blockKind` |
| Games block rows | `liveHomeGames` 6084, `homeBoardGame` 6100, `dayGamesHTML` 5780 | `gameRowModel(g)` + `renderGameRows()` | `gamesForBlock`, `gamesForDay`, `unscheduledGames`, `gameStatus` (extended), `currentMatchupOf`, `nextMatchupOf`, `tallyRankLive` 6065 | Morning/Evening heuristic (schedule sheet 996-1005) |
| My station | `renderMyElectives` 4916, `myElectivesToday` 375, `myStationFor` 361 | `stationModel(identity)` | `electivesFor` | `ELECTIVES` via the same accessor |
| Cleanup moment | `renderMealCleanup` 5536, `setCleanupPoints` 5661 | `cleanupMoment()` + shared award row | `mealStart`, `cleanupTeams`, `competitionDows` | `MEAL_START_MINUTES` |
| Verse moment | `renderMemoryVerse` 5370, `setVersePoints` 5464 | `verseMoment()` + shared award row | `verseFor`, `verseTheme` | `MEMORY_VERSES` |
| Messages strip | `renderNoticeBoard` 691, `renderAnnouncements` 8136 | `renderMessages()` | `state.notice`, `state.announcements`, `chatAnnouncementBanners` | — |
| Directors' standings | `renderStandings` 4582, `renderCatchupHint` 4655 | `renderDirectorStandings()` (editor only) | `medalCounts`, `rankTeamsByPoints`, `groupPlaces` (reveal-core) | — |
| Side effects inside renderStandings | 4556-4645 | `runStandingsSideEffects()` from `renderAll`, any tab | — | — |
| Game takeover | `renderGameView` 5942 | same renderers, new frame + Next bar; `renderPlacement` 6682 / `medalPickerHTML` 6420 swap the three `jelly-select`s for the podium picker | `gameById`, `allGames` | — |
| Running over | — | `blockOverrun()` in `nowModel` + "Still on this" (`state.meta.overrun`) | `gamesForBlock`, `gameStatus` | — |
| Quick points from standings | `renderBonuses` + `bindBonusEntry` | `openQuickPoints(teamId)` sheet | — | — |
| Reveal mirror / grid | — | `renderRevealMirror()`, `renderRevealGrid()` | `revealView()` only | fail closed |
| Remote | — | `reveal.js` (`confirmedReveal` store, `revealPractice` writer, wake lock) | `revealView`, `revealFull` (once), `tvFrame` | — |
| TV page | current-standings.html inline script | `current-standings.js` (P2 T) + `reveal-core.js` | `revealView`, `tvFrame`, `camp-core.js` sanitisers | — |
| Chat tab | `renderChatCard` 889, `renderChatView` | same chat.js, re-hosted | `CHAT_CHANNELS`, `unreadTotal` | — |
| More | settings drawer rows, `renderFooter` 2029 | `renderMore()` | `campWeek`, `hasBothCamps` | — |
| Tell everyone | `postAnnouncement` 8263, push composer 1410/1716, `setNoticeStatus` 703 | `tell.js` section in app.js (or settings.js) | — | — |
| Award points | verse/cleanup/bonus renderers | `renderAwardPoints(dow)` | `competitionDows`, `verseFor`, `cleanupTeams` | — |
| Calm + motion | `JOY_REDUCED` 8715, joy layer 8710-8896 | `jelly-motion.js` | — | — |

New files: `jelly-motion.js` (D0), `reveal-core.js` (D1, also loaded by the TV page and the test
harness), `reveal.js` (D5). The `?v=` list in index.html grows by these three (P2 adds its own);
CLAUDE.md's deploy step is updated in the same commit.

---------------------------------------------------------------------------------

## 13. Render stability, scroll, history, keyboard, safe areas

### 13.1 Stable roots

Static sections in index.html, never re-created:

```
#app
  header#app-header
    #hdr-id                    renderHeader()          setHtmlIfChanged (shield, names: identity/role/camp only)
    #hdr-pill                  renderSyncPill()        patched in place (textContent/hidden), never re-written
  div#reveal-strip             renderRevealStrip()     (non-Now tabs)
  main#tab-now      [data-tab] #now-messages, #now-card, #now-next, #now-later, #now-todo, #now-grid
  main#tab-games    [data-tab] #games-days, #games-standings, #games-rows
  main#tab-chat     [data-tab] #chat-view (chat.js owns it)
  main#tab-more     [data-tab] #more-director, #more-camp, #more-phone, #more-account
                               (#more-phone's Theme / Calm segmented controls are static;
                                "#alerts-state" and "#calm-reason" are text nodes patched in place)
nav#tabbar                     badges only; buttons static
section#takeover-game | #takeover-remote | #takeover-tell | #takeover-award (+ P2 builder)
#schedule-overlay, sheets, jelly-drawer/dialogs, jelly-toaster, #joy-layer (unchanged)
```

Each sub-root is written through `setHtmlIfChanged` (or `setLiveHtmlIfChanged` with holds for
live boards and clocks); listeners are wired only when the write returns true. The Now card
keeps the shape-vs-value split from `splitNowBanner`: the progress hairline and minutes-left are
nudged in place, never re-rendered, so nothing refills. **Roots are split by volatility, not
only by section**: anything that flips often (the sync pill, "Alerts: On · 2 reminders", "Calm
right now because…", minutes left) is its own node patched in place, so a connection flicker
can't re-create the header shield (the blink render-stability.test.js exists for) and a push
state change can't rebuild the segmented control under a finger. Row lists inside a root carry
`data-key` and are updated with `JellyMotion.morph` (§9.4), so rows keep their identity and can
glide.

### 13.2 Render paths

- `renderAll()` stays the one entry. Order: secrecy role resolve → `applyCardVisibility()` (now
  per section) → `runStandingsSideEffects()` (always) → `renderHeader()` → tab bar badges →
  `renderRevealStrip()` → **the active tab's renderer** → mark the other three tabs dirty →
  open takeover renderer → open sheets → `paintBoardClocks()`.
- A dirty tab renders right before it is shown (cheap: unchanged sub-roots skip the write).
- **The 30-second tick** re-runs: `renderHeader`, `renderNow` (the whole time-driven model:
  block, running over, moment windows, Later today, reveal auto-end; the 3 s phone lag is a
  one-shot timer, not the tick), `refreshOpenSchedule`, `renderMessages` (announcement expiry),
  Games' "up next" marker **and Games' grid root**, tab badges, and `expireReveal()`. Today's tick
  list (8681) misses most of these.
- **Waking up**: `visibilitychange` → visible and `pageshow` run the same time-driven set
  (including `expireReveal()`), because iOS restores a frozen page without firing the interval,
  and a quiet 8:00 brings no snapshot. The `.info/serverTimeOffset` handler (2895-2903) re-runs it
  too, since a corrected clock can cross 8 AM.
- `renderAllWhenIdle` / `fieldFocused` deferral and `deferRemoteSnapshot` are unchanged; the new
  composers (Tell everyone, award reason field, remote has none) are covered by `fieldFocused`'s
  allowlist (native textarea/input).

### 13.3 Per-tab rules

- **Now**: rows keyed by game id; a status change re-renders that row's string and the ledger
  fires the motion. The live board writes through `setLiveHtmlIfChanged` with holds `[g]`. The
  reveal mirror is its own sub-root keyed by `ctl.id`; a new `seq` updates only the affected rows.
- **Games**: the day picker is built once per `competitionDays()` signature; switching day swaps
  only `#games-rows`. Director standings re-render only when the medalCounts signature changes;
  the revealed-grid root is cleared by `expireReveal()` directly (never left to dirty-marking).
- **Chat**: untouched by `renderAll` beyond badges.
- **More**: rebuilt only on role/camp/push-state changes.
- **Takeovers** own their scroll and their render; closing one doesn't re-render the tab under
  it (nothing changed there), so nothing replays.

### 13.4 Scroll memory

Tabs use the document scroll (keeps iOS status-bar tap-to-top and the toolbar behaviour);
`scrollY` is saved per tab on switch-away and restored before paint on switch-in. Re-tapping the
active tab glides to the top. Takeovers and the Chat tab are fixed containers with their own
scroll, so the tab underneath never moves; `builderReturnY`, `chatSavedScrollY` and
`gameOpener`'s positional restore retire.

**Coming back later**: if the app was hidden for more than 10 minutes, it reopens on Now at the
top, with any takeover closed unless it's editor mid-entry or an unsent composer (replaces the
5-minute idle collapse). `state.ui.tab` is device-local and restored only within that window.

### 13.5 History, Back and deep links

- Tabs don't stack history. Leaving Now for another tab pushes one entry, so Android/gesture
  Back returns to Now; Back on Now leaves the app.
- Each takeover pushes an entry; Back closes the top-most takeover first (game → remote →
  Tell everyone …). Sheets close on Back too.
- **"Next game →" replaces** the game takeover's entry (`history.replaceState`) instead of
  pushing, so Back after scoring three games in a row lands on Now (or Games), not on three
  finished games.
- **The labelled back always lands on a fixed place.** A takeover opened cold (a deep link, a
  notification tap, a reload restoring `state.ui.gameId`) has no entry under it; the shell
  first `replaceState`s the tab it names ("‹ Now", "‹ Wednesday games") and then pushes the
  takeover, so the label and the gesture agree.
- Takeover → takeover (Tell everyone → "Write a full notice…" → P2's notice builder) pushes; the
  builder's back returns to the Tell everyone draft, which was kept on the device.
- Deep links (`pushHandleOpen`, push.js 1106-1124; `?open=`; service-worker `camp-open`):
  `schedule` → the schedule sheet over Now; `chat:<ch>` → Chat tab, channel; new: `reveal` → Now
  (live mirror), `game:<id>` → game takeover, `alert:<id>` → Now. The cross-camp handoff via
  sessionStorage is unchanged.

### 13.6 The keyboard and the fixed tab bar (iOS)

- `body.kb-open` is set on `focusin` of a text-entry element by a new **`textEntryFocused()`**
  (a tag-only allowlist: INPUT, TEXTAREA, contentEditable, `JELLY-(INPUT|TEXTAREA|OTP)`) and
  cleared on `focusout` after 100 ms (so moving between fields doesn't flicker). It is NOT
  `fieldFocused()`: that one deliberately returns false inside `#chat-view` (8333, so chatting
  doesn't defer scoreboard updates), which would leave the chat composer, the main reason for
  this rule, without `kb-open`. The two functions keep their two meanings.
- While open, **only the tab bar** glides down out of view. Docks that carry the action stay: the
  chat composer and the Tell everyone dock ride the keyboard (`bottom: var(--kb-h)`), and the
  Tell everyone dock gains a small **Done** button that blurs the field (iOS multi-line fields
  have no Done key and don't blur on an outside tap). The game takeover's Next bar hides while a
  score field is focused (nothing in it is needed mid-typing).
- `visualViewport` `resize`/`scroll` sets `--kb-h` (`innerHeight − vv.height − vv.offsetTop`) on
  iOS, where fixed elements don't move with the keyboard. Checked on a real iPhone Home Screen
  app in D2 (mockup 15 draws the target).
- **Things inserted above the reader** (the 40px reveal strip, a new banner) shift the document
  by their height in the same frame when `scrollY > 0` (`scrollBy(0, delta)` after measuring),
  because WebKit has no CSS scroll anchoring; nothing under the reader's eyes or thumb moves.
- Calm: the bar disappears without sliding.

### 13.7 The bottom stack, recomputed

| Layer | Position | z-index |
|---|---|---|
| tab bar | fixed, bottom 0, height `--tabbar-h: calc(56px + env(safe-area-inset-bottom))` | 50 |
| takeover docks (remote, Tell, game Next bar) | fixed bottom 0 inside the takeover; the tab bar is hidden under takeovers | 55 (takeover 54) |
| update / SDK pill | moves into the header status pill; no bottom layer | — |
| toasts (`jelly-toaster position=bottom`) | `bottom: calc(var(--tabbar-h) + 12px)`; over a takeover, above its dock | 10002 |
| schedule sheet, drawers, dialogs | unchanged | 1100 / 10001 |
| joy layer | unchanged, pointer-events none | 3000 |

The v184 lift rules (styles.css 4555-4610: update bar 1rem/5.5rem, SDK pill 6.5rem/12rem, toasts
8rem/5rem/12rem, footer padding) are replaced by this table; `overlays.test.js:221-225` pins move
to it in the same commit. Tab content gets `padding-bottom: calc(var(--tabbar-h) + 24px)`.

### 13.8 Safe areas and the Home Screen app

- `viewport-fit=cover` stays. Header: `padding-top: env(safe-area-inset-top)`. Tab bar and docks:
  `padding-bottom: env(safe-area-inset-bottom)`.
- Add `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` ("Camp"), and
  `apple-mobile-web-app-status-bar-style` `default`. Align `manifest.json` `theme_color` /
  `background_color` with `--paper` (today #3355ff/#f4f6f9 disagree with the meta theme-color).
  `applyTheme` keeps writing the dynamic theme-color meta; takeovers with the blue roof set it to
  camp blue while open.
- **Verify on a real iPhone (Home Screen app) in D2**: status-bar colour under the blue roof,
  the tab bar above the home indicator, keyboard + composer, Back gestures. The mockups draw the
  blue roof under the status bar; if `default` paints a light status strip above it on device,
  the roof starts below the status bar instead (no layout change needed).

### 13.9 Hidden couplings lifted out of `renderStandings`

`runStandingsSideEffects()` runs on every `renderAll`, for both roles, regardless of tab:
`lastPointsByTeam` / points-pulse bookkeeping (editor display only), `notifyPointChanges`
(editors only now), viewers' result alerts (new), `recordPointHistory` (editor-only change
history), and the start-of-day rank baseline (editors only). `renderFollowCard`'s call moves to
`renderHeader`. Without this lift, removing the standings card would silently stop the change
history and the alerts.

---------------------------------------------------------------------------------

## 14. Staged build plan

Every stage ships on its own, follows the CLAUDE.md deploy checklist (all `?v=` values,
`APP_VERSION`, `CODE_UPDATED_AT`, `node tests/run.js`, `node --check`, CSP for any new host,
live `curl` verification), and leaves both camps working. No camp before June 2027, so every
stage is "off-season". Suggested calendar interleaves with P2 (S0 → T → S1 → … ).

| Stage | Ships | Depends on | Tests added/changed | Rollback |
|---|---|---|---|---|
| **D0 Motion & calm** (Dec) | `jelly-motion.js` (six presets sampled at 1/60 s; `play`, `playOut`, `morph`, `flipKeyed`, `whenHandsOff`, `restamp`, the press dent); tokens in styles.css; `calmMotion()` + sampler + battery + OS (OS beats Off); Appearance switch (in today's Settings drawer for now); boot-guard pre-paint calm; `JOY_REDUCED` and the 3 raw reads replaced; 9 media blocks → `html.calm-motion`; `jelly-motion-change` dispatched; Jelly token mapping (§8.10) | — | `motion.test.js` (sampler matches jelly's one-step integrator at 1/60; presets' ζ and overshoot; **minimum visible deformation per §9.5 row**; `cssLinear` matches styles.css; calm truth table incl. OS-beats-Off; hysteresis; sampler never runs while busy; **no transform keyframes while calm**; **outerHTML/`__dom` unchanged after press, release, play, playOut, flipKeyed**), `shell.test.js` (no motion media queries; pre-paint calm), `auth.test.js` wipe list | revert |
| **D1 Secrecy (fail closed)** (Dec) | `reveal-core.js` (`groupPlaces`, `revealView` incl. paint-time `expired` and the champion line, `tvFrame`, `untilFor`, normalisers); **`standingsVisible()` inside every points reader** (§4.12); every viewer path in §4.12 gated; result alerts from the `applyRemoteState` results diff, baselines seeded at `startApp()`; copy rewritten; seed `hiddenCards.standings/bonus` for old builds; TV page: editors-only live view, viewers get "Waiting" (interim until D5) | — | `secrecy.test.js` (viewer `renderAll` with the guard throwing; **sink recorder** over toasts, notifications, share/copy, insertAdjacentHTML, setAttribute, appendChild/textContent, chimes; remote-change scenarios as a viewer; hint-paint; role flip), `sync.test.js` (identical first snapshot then a result → exactly one viewer alert), `reveal-core.test.js` (+ `.senior`) | revert (seeded keys are harmless) |
| **D2 Shell** (Jan) | header (identity root + patched pill), tab bar (`tablist`), four roots split by volatility, sheets/takeovers model (sheet drag from the grab strip only), game takeover (labelled back), More tab absorbing the drawer (one Alerts row, Appearance inline, "Not you? Change"), Chat as a tab, sync pill, bottom stack, keyboard handling (`textEntryFocused`, tab bar only, Done on docks), scroll memory and scroll compensation for inserts, history/Back (replaceState rules), deep links, What counselors see (switches), `teamMark` keyed `<img>` with blob URLs, accordion and idle-collapse removed. Now hosts today's banner + live home unchanged inside the new frame. Home Screen metas; **real-iPhone check** (status bar, keyboard + composer, Back gestures, wake lock in a Home Screen app) | D0 | `tabs.test.js` (switching, dirty render, scroll memory, history incl. Next-replaces and cold deep links, deep links), updated pins in `shell`, `overlays`, `home`, `render-stability` (pill flip doesn't touch the shield; More's volatile lines don't rebuild the segmented controls), `game-view`, `chat`, `chat-view`, `sync`; Playwright: every target ≥ 44×44 at 360/390, 130% and 200% text | revert |
| **D3 Now, block by block** (Feb) | `blockKind`, `nowModel`, all kind renderers (§3.3), running over + "Still on this", moments with director awards, Later today, Still to do, 30 s tick + wake-up list, messages cap, notice "Take down", podium strip | D2; P2 S1 (else SEAM-shaped fallbacks) | `now-model.test.js` + `.senior` (every minute of every day: no throw, a block or a defined empty state, correct kind, moment windows, personalisation, **a live game past the block end keeps the card, capped at 45 min / the next games block**); podium strip at 360 with the widest podium and a 20-character name (Playwright); render-stability for each kind; award writes keep own-team guard | revert |
| **D4 Games** (Feb) | day picker, directors' standings (shared places, arrows labelled once, medal counts in words, gap, privacy tag, reveal link, **tap a team for quick points**), status model, Score + Next game (own-team wording, replaceState), **podium picker** in `renderPlacement`, live line per format | D2 | `games-tab.test.js` (status truth table incl. clocks; Next game order skipping own-team and its "another director" message; shared places = TV grouping; podium picker: picked teams disabled in later rows, re-tap clears, drafts per leaf), game-view pins | revert |
| **D5 The reveal** (Mar) | rules (in P2's R1 PUT, owner runs it: `sa`, `ca`, pub-vs-shown, screens slots, `revealPractice`) → `reveal.js` remote (16:9 mini TV, small-phone layout, grouped ladder, masked up-next, locked Back, wait on the button face, refused-tap shake + toast, screen wake lock, `confirmedReveal` for every consumer, `once()` fetches), counselor mirror (ends at the final table), red strip, 8 AM grid with `expireReveal()`, champion line, Friday finale, practice in its own node, Buzz on start (never for practice); TV page subscriber rewrite (needs P2 T); `revealBusy` for any editor in `reloadBlocked` and the wake-lock gate | D1, D2, P2 T, rules published | `tests/emulator/reveal.mjs` (opt-in, §4.4 list), `rules.test.js` (both camps), `reveal.test.js` (command builders incl. `sa`; CAS refusal handling; confirmed-state rendering; **phone lag keys off `sa`: Back, table, End and a reload at +1 s leave rows unchanged**; auto-end 15/60 min; DST `until`; **fake clock across 07:59:59 → 08:00:01 for the active tab, an inactive Games tab and a wake-from-sleep resume**; practice never calls `pushSendAlert`; champion path reads no points), `tv.test.js` (frames, waiting, late join, real beats practice) | rules stay (inert); revert client |
| **D6 Director tools** (Apr) | Tell everyone (Showing now with Take down, quick alerts, Buzz off by default, Send label says it buzzes, notice replace/undo rules, Done above the keyboard), Award points, Preview as a counselor, Set up the week entry + join badge (P2) | D2; push live for Buzz (else disabled with reason) | `tell.test.js` (channel combos, partial failure, undo restores the previous notice only if unchanged, replace asks for any non-empty notice, draft survives re-render, reloadBlocked, quick alert presets tick Urgent), `award.test.js` (guards, deterministic ids) | revert |
| **D7 Senior, polish, rehearsal** (May) | senior pass (flags with shapes, empty sections, 4-team bracket on Now), copy pass, CLAUDE.md (new nodes, TV no longer computes, `?v=` count, motion rules incl. no-residue), then a **joint rehearsal of both camps** on real phones and a real TV: a full games day on `?now=` including a block running over, a reveal with two remotes, a practice run before 8 AM with last night's grid still up, the director's phone left alone for a minute mid-reveal, calm on/off, Low Power Mode | all | Playwright pass of every mockup screen at 360/390, both themes, both camps, plus the contrast audit (7:1 under 16px) | — |

---------------------------------------------------------------------------------

## 15. Test plan

Unit (node, zero dependencies, existing harness): everything in the stage table. Additions to
the harness: load `jelly-motion.js` and `reveal-core.js`; a WAAPI-less DOM stub (motion must be
no-op safe); a controllable `serverNow`.

Invariants pinned:

- No viewer code path reaches a points reader (`standingsVisible()` throws under test) and no
  viewer **sink** (markup, toast, notification, share/copy, attribute, chime) carries
  points/places/gaps outside the reveal roots.
- `revealView` fails closed for: no ctl, denied, epoch mismatch, `v` > 1, expired; it never reads
  `revealPractice`; the champion line carries no numbers.
- Counselor "still to come" count = teams − revealed entries (never group count).
- Phones withhold only group `shown − 1`, only until `sa + 3000`; Back, phase changes, End and a
  reload never re-hide a row.
- The grid is gone at 08:00:01 on the active tab, an inactive tab and after a wake from sleep.
- `until` = 08:00 camp time next day across both DST changes.
- Practice never calls `pushSendAlert` and never writes `reveal`.
- `nowModel` never throws for any minute of any day in either camp, with and without identity,
  for both roles.
- Re-rendering unchanged state writes nothing and starts no motion (ledger); motion leaves no
  residue (`outerHTML`/`__dom` unchanged).
- Each §9.5 row meets its minimum visible deformation; presets sampled at 1/60.
- Calm: every `play` has a calm path or returns null; no transform keyframes while calm; the OS
  setting beats Off; no `prefers-reduced-motion` left in CSS.
- Bottom stack: toaster offset = tab bar height + 12px; content padding clears the tab bar.
- "Next game" replaces history; a cold deep link's labelled back lands on its tab.
- Running over: a live game keeps its block on Now past the end, capped.

Emulator (opt-in): `reveal.mjs` as §4.4. Playwright (manual pass per stage): the mockup screens
at 360 and 390 widths (the remote also at 375×667 and 360×640), light and dark, both camps,
`?now=` for each block kind; every target ≥ 44×44; text at 130% and 200%; the contrast audit
(7:1 under 16px, 4.5:1 above, 3:1 for control boundaries); **a tall sheet containing a button**
(the list scrolls, the button gets its tap, only the grab strip drags); a list reflow while a
pointer is down (nothing moves until it lifts). On a real iPhone: Low Power Mode for the
sampler, the wake lock in a Home Screen app, keyboard + composer + Done.

---------------------------------------------------------------------------------

## 16. Risks

| Risk | Mitigation |
|---|---|
| Secrecy regressions through a forgotten path | one accessor (`revealView`) for viewers + `standingsVisible()` inside every points reader + the sink recorder over every way text leaves the app, all in CI-less `tests/run.js` |
| Rules details (cross-path checks) behave differently than expected | emulator suite before publishing; the client never depends on the two unverified clauses |
| A director starts the reveal on a stale phone | gated Start + visible pre-start checks + "Start again" while at intro |
| Old cached builds leak standings | seeded `hiddenCards` keys; ship D1 months before June |
| iOS Home Screen specifics (status bar, keyboard) | real-device check in D2; layout doesn't depend on the status-bar outcome |
| Motion cost on old phones | WAAPI on transform/opacity only; sampled springs (no per-frame JS) except the blob and sheet drag; battery-saver auto-calm |
| False battery-saver detection from jank | median of 24 frames, sampled only when idle, twice in a row, 60 s hysteresis; the switch overrides |
| Tests that pin today's shell turn red | expected; pins updated in the same commit per stage (§14 lists them) |
| P2 timing (accessors, bracket, photos) | every consumer reads accessor names now, with built-in fallbacks |
| Too many stages before June | D0–D2 are the base; D3–D6 are independent of each other after D2 and can reorder |
| The OS refuses the wake lock (older iOS in a Home Screen app, Low Power Mode) | the remote says "Screen may sleep" so the director knows; on wake the button shows "Reconnecting… 2 s" rather than a dead face; checked on a real iPhone in D5 |
| Changing the podium entry (`renderPlacement`) touches scoring | it writes the same `drafts` leaves and the same save path; D4 ships it with the game-view pins and a two-director draft test |
| Motion residue silently defeats render stability | WAAPI-only rule + the residue test in `motion.test.js` + `restamp` for the rare in-place change |

---------------------------------------------------------------------------------

## 17. Improvements beyond the brief

1. **The answer is the headline.** No big tab-name title on Now; the block, your station, the
   verse or the place is the largest text. Identity moved into a slim header, saving ~60px.
2. **One physical object per screen.** Only the Now card (and the remote's mini TV) has the ink
   edge; everything else is flat run-sheet rows. It ends the "stack of identical cards" and gives
   the eye one landing spot in sunlight.
3. **Warm paper and navy ink with measured contrast** (7:1 for anything under 16px; most 8:1+) instead of
   white-on-white; it also carries the remote's approved colours across the whole app.
4. **Blue roof = broadcast.** The camp-blue header appears only where a tap changes what
   everyone sees (remote, Tell everyone).
5. **Ties can't leak.** Counselors' "still to come" rows have no place numbers and count teams,
   not places; `n` lives only in the editor-only node.
6. **"Look at the big screen."** Phones lag the TV's name-first beat by 3 s and say so, so the
   room reacts together.
7. **The big button recharges** until the TV has shown the score, on top of the server's
   compare-and-set: a double tap can't skip a place, and the next action is always written on the
   button.
8. **Pre-start checks** on the remote (phone in sync, games scored, screens ready, last score
   and who saved it) so the freeze can't silently miss a score.
9. **Practice runs with made-up points**, TV only, so directors can rehearse on the real screen.
10. **The full revealed grid without a table**: two-line rows with medal discs, no 8-column
    table, no horizontal scroll.
11. **Directors' standings use the TV's shared places**, carry a "Counselors can't see this"
    tag and a "Reveal these on the big screen" shortcut.
12. **"Still to do today"** for directors: missed scores and awards are one tap away, the safety
    net for the at-its-moment design.
13. **Preview as a counselor** in What counselors see.
14. **Local joy, remote calm**: confetti on the saving phone, a quiet medal landing on the other
    forty.
15. **Springs sampled into compositor animations** using jelly.js's exact constants, plus a
    motion ledger so nothing ever replays on a re-render, tab switch or reload.
16. **Calm motion that also calms the Jelly components** (via `data-jelly-motion` + the event
    nothing dispatches today), with hysteresis and a calm first frame.
17. **Sync and offline status in the header for everyone** (it was hidden inside Standings).
18. **Personal "Later today"** ("you're at Crafts", "Your team is on cleanup").
19. **Back to Now after 10 minutes away**, and stale takeovers expire (no Monday game on
    Wednesday), instead of folding cards on a timer.
20. **The tab bar steps aside while typing**, so the composer sits on the keyboard.
21. **Senior teams get flag marks with a shape per team**, not emoji circles and not hue alone.
22. **One rules publish** for P2 and the reveal.
23. **Three-tap podium scoring** with shields instead of three dropdowns (about 9 taps → 5 from
    Now), and "Next game" that tells a director exactly what is left that they can score.
24. **Running over**: the games card stays up while a game is still live after its block, and
    directors can say "Still on this · +10 min".
25. **A remote that can't embarrass anyone**: the wait written on the button, Back locked for the
    same beat with its own rewind glyph, a refused tap that explains itself, the up-next preview
    masked until held, the screen kept awake, and every state drawn (07c).
26. **Practice in its own node**: rehearsals can't wipe counselors' grid or buzz anyone.
27. **Rules that make the client's promises true**: no group published before its place,
    no stale Start, the phones' lag anchored to the moment a place was first shown.
28. **Quick alerts** in Tell everyone (Come inside now, All to the Dining Hall, Stay where you
    are): four taps to an urgent buzz, no typing; and "Showing now" with Take down.
29. **Sunlight contrast as a rule (7:1 under 16px)**, 44px hit areas everywhere, and an
    accessibility section (text scaling, screen readers, focus, colour-independent cues).
30. **Keyed rendering + keyed FLIP**, and "never move a row under a thumb".
31. **The real Jelly toaster and dialog in the app's colours**, and a press that dents toward
    the finger and rings back like a jelly-button.

---------------------------------------------------------------------------------

## 18. Questions for the owner

1. **Quick points "at their moment": when do directors usually give quick points?** Cleanup and
   the verse have a clear moment in the schedule; quick points don't. They are now two taps
   from the Games standings (tap a team, tap +2), wherever you are. *(Recommended: that, plus
   Director → Award points for corrections, with no extra moment on Now. Alternatives: a
   "Quick points" row during cabin time after breakfast, or at the evening campfire.)*
2. **Is it OK that the big screen still needs someone signed in?** Any counselor or director
   account works. *(Recommended: yes. The alternative, a page anyone on the internet can open,
   would make the revealed standings public data.)*
3. **Practice runs: made-up points, or the real standings?** *(Recommended: made-up points, so
   a rehearsal in the afternoon can't spoil the evening.)*
4. **The bracket bye gives away who's behind.** The bye goes to "the Round 1 winner with the
   fewest points this week", and everyone can see who got it, so a counselor can tell which of
   three teams is trailing. *(Recommended: keep the rule and accept the small leak; the
   "fewest points" reason stays director-only. Alternatives: a coin toss on the remote, or a
   seed fixed at setup, so the bye says nothing about the standings.)*

---------------------------------------------------------------------------------

## Appendix A. Mockups and the motion demo

All in `/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad/mockups/final/`
(HTML + PNG at 390×844, @2x; the TV at 1280×720; session scratchpad, so copy them into
`docs/build-notes/mockups/final/` if they should be kept). `_build.js` regenerates them;
`_motion-demo.src.html` is the demo's source before the shield thumbnails are inlined.

| # | File | Shows |
|---|---|---|
| 01 | `01-now-games-counselor` | Now during Team competitions, counselor (Foxes): done row with the podium strip, live row with live board, not started, Later today |
| 01b | `01b-now-running-over-360` | 360 wide, 11:52: the block is **running over** (a game still live), the widest podium and a 20-character short name wrapping in the strip |
| 02 | `02-now-games-director` | the same block for a director: 44px Score buttons (gold for the live game), "2 of 3 still to score", Still to do today |
| 03 | `03-now-elective-counselor` | Elective 1 for Sam: Your station with "Not Sam? Change", rain note as a plain line, Then, Who's where |
| 04 | `04-now-after-lunch-director` | Team time with the Lunch cleanup moment and 0–3 award buttons |
| 05 | `05-now-reveal-counselor` (+ `-dark`) | the live mirror as one grouped list: still to come ×3, 4th Foxes on the big screen (Your team), 5th, 6th |
| 05b | `05b-now-revealed-grid-morning` | next morning before 8 AM: the frozen grid, counts in words |
| 06 | `06-remote-ready` | the remote before Start: 16:9 mini TV waiting, "Screen stays on", pre-start checks with screen owners, Practice (off), Buzz all 38 counselors (on), Start |
| 07 | `07-remote-mid-reveal` (+ `-dark`) | mid-reveal: 16:9 mini TV on 4th, grouped ladder, masked up-next, secondary Back "show 5th again" 24px from Reveal 3rd place |
| 07b | `07b-remote-small` (+ `-360x640.png`) | the remote on an iPhone SE (375×667) and a 360×640 Android: thumbnail TV, whole ladder above the dock |
| 07c | `07c-remote-states` (full page) | every other dock state: recharging (wait on the face, Back locked), tapped too soon (shake + toast), not connected, Friday crown, champions, final table + the End dialog, ended, rules not published |
| 08 | `08-games-director` (+ `-dark`) | Games: day picker, live standings (arrows labelled once, medals in words, tap for quick points), gap sentence, reveal link, rows with the podium strip and Score |
| 09 | `09-more-director` | More with the Director section and Run the reveal |
| 10 | `10-tell-everyone` (+ `-dark`) | Showing now with Take down, quick alerts, the message, banner + buzz (ticked) + urgent + pin, "Send + buzz everyone" |
| 11 | `11-tv-waiting` | the big screen waiting |
| 12 | `12-now-bible-study-dark` | dark mode: Bible study with the day's verse |
| 13 | `13-senior-now-legacy-game` (+ `-dark`) | senior: the Legacy Game 4-team bracket, flag marks with a shape per team, "Red plays in the final next" |
| 14 | `14-game-takeover-scoring` | a director scoring a podium game: three rows of shields, picked teams disabled in later rows, "Pick bronze, then save" |
| 14b | `14b-game-takeover-next` (+ `-dark`) | after saving: the result, "Change the result", "2 games left today that you can score", Back to Now / Next game: Color Call Chaos |
| 15 | `15-chat-keyboard` | Chat with the keyboard open: plain title, channel switcher, a mention, the composer riding the keyboard, tab bar gone |
| 16 | `16-more-counselor` | More for a counselor: the offline pill, one Alerts row, Appearance inline (Theme, Calm motion with its reason line), Your team with "Not you? Change" |
| — | `motion-demo.html` | interactive, with the REAL vendor/jelly.js inlined: tab switch (arrive), Live → Done with medals landing and the reflow held while a finger is down, a place revealed on the counselor mirror (the "Look at the big screen" lag, keyed rows gliding), the remote (dent press, wait on the face, refused tap, locked Back, press-and-hold peek, screen wake lock), a tall sheet that scrolls, whose buttons work and that drags only from its strip, the real `jelly-toaster` in the app's colours, a real `jelly-button` beside a chunky one; Calm motion Auto/On/Off (the OS setting beats Off) with pretend battery saver and OS setting; slow motion; live `calmMotion()` readout; the six springs with their measured overshoot |

`_build.js` regenerates every mockup (`node _build.js [prefix]`); `_build-demo.js` builds the demo
from `_motion-demo.src.html`; `_test-demo.js` checks the demo's behaviour (peek, refusal, sheet
scroll and button tap, strip drag, calm creates no transform keyframes, OS beats Off). `_audit-contrast.cjs <dir>` runs the
sunlight contrast rule over every frame (light and dark) and `_audit-targets.cjs <dir>` the
44×44 rule; both report 0 failures on this set (the three "small targets" it lists in 05 are
lock glyphs, not targets).

## Appendix B. Copy glossary

| Say | Not |
|---|---|
| Not started · Live · Done | Ready · In progress · ✅ |
| Score | Enter result · Edit |
| Next game: Pumpkin Pictionary | Continue |
| Standings stay secret until the directors reveal them on the big screen | Standings hidden |
| Still to come | Locked · TBA · ??? |
| Look at the big screen | Revealing… |
| On the big screen now | Current |
| Reveal 3rd place | Next › |
| End reveal · Counselors keep what's been shown until 8 AM tomorrow | Stop |
| Points stay with directors | (hidden) |
| Counselors can't see this | Admin only |
| Tell everyone · Send to everyone | Post · Broadcast · Submit |
| Calm motion: Auto · On · Off | Reduce animations |
| Running over · 7 min over | Overtime · Late |
| Still on this · +10 min | Extend block |
| Showing the name… 3 · Showing the score… 1 | Charging · Please wait |
| Back · show 5th again | Previous · Undo |
| Up next · only on this phone · Press and hold to peek | Preview (private) |
| Send + buzz everyone | Send (with a summary line) |
| Take down | Unpin · Delete |
| Nothing left that you can score. 1 game needs another director | Every game is scored (when it isn't) |
| Pick bronze, then save | (a disabled Save with no reason) |
| Screen stays on · Screen may sleep | Wake lock active |
| Offline · saved on this phone | Sync error |
| Which counselor are you? | Tell us who you are |

---------------------------------------------------------------------------------

## Review log

### Round 2, 2026-10-27: three critics (people, secrecy & stability, visual & motion)

56 findings. Every factual claim about v184 was checked against the code before deciding:
`vendor/jelly.js:119-124` (vibrate guarded, no iOS fallback), `app.js:3304-3311`
(`setHtmlIfChanged` skips only when `__dom` matches), `2848-2853` (renderAll and
`detectMatchupChanges` only when `syncSignature()` changed), `3193-3201` (lazy seed: first
change swallowed), `8319-8335` (`fieldFocused` excludes `#chat-view`), `3668-3669` (wake lock
gated on `anyTimerRunning()`), `6420-6434` (three `jelly-select`s), `7687-7699` (bye to the
fewest points), `294 / 5357 / 5526` (points readers outside the spied functions),
`styles.css:117-127` (Jelly accent `#3355ff`), index.html CSP (`img-src` allows `blob:`). The
spring overshoots at 60 Hz vs 240 Hz were recomputed (press 11.4 / 13.6%, snap 4.9 / 7.3%,
settle 0.6 / 2.2%). The critics' emulator probes for the rules were not re-run here; the
clauses are written into `tests/emulator/reveal.mjs` so D5 re-proves them.

**Accepted (fixed in the spec, mockups and demo)**

| Id | Decision and where |
|---|---|
| U1, SS-16 | Accept. Practice moves to its own `revealPractice` node (can't replace the real reveal, can't wipe the 8 AM grid) and forces Buzz off ("Practice runs never buzz phones"; unit test that practice never calls `pushSendAlert`). The switch names its audience ("Buzz all 38 counselors"; the number is counselors on the list, which is what the client can know). §4.3, §4.6, §4.13, mockup 06 |
| U2, V12 | Accept in part. Back becomes a secondary outlined button with a rewind glyph, "show 5th again", 24px from Reveal, and is **locked for the TV beat**; "‹ More" is the only left chevron. **Rejected: moving Back out of the dock**: Back in the dock beside the big button is the owner-approved layout B. The two tags no longer collide (the up-next label is inside its row), and the charging label is full ink. §4.2, §4.8, mockups 07, 07c |
| U3, SS-13 | Accept. Screen Wake Lock for any editor while a non-practice reveal is live (re-requested on visibilitychange; the acquire gate widened to `revealBusy()`), "Screen stays on / may sleep" under the mini TV, "Reconnecting… 2 s" on the button face, haptics treated as Android-only. `revealBusy()` covers any editor during a live reveal. §4.2, §4.5, §4.13 |
| U4 | Accept. Buzz off by default; the Send button says "Send + buzz everyone"; three quick alerts pre-tick Buzz + Urgent (4 taps, no typing). §7.2, mockup 10 |
| U5 | Accept. Sheets drag only from the grab strip, or from the list when it is at the top and moving down; `touch-action: pan-y`; pointer capture only on the strip. Demo rebuilt with a tall scrolling sheet whose buttons work (checked headless: scrollTop 192, button tap toasts, strip drag closes); test plan adds it. §2.1, §9.5, §15 |
| U6 | Accept. "Running over": the games card stays while a game is live after the block (capped at 45 min / the next games block); directors' "Still on this · +10 min" writes `meta.overrun`. §3.1, mockup 01b |
| U7 | Accept. The podium picker replaces the three `jelly-select`s: three rows of shields, picked teams disabled later, 3 taps + Save (about 9 → 5 from Now). Takeover and Next bar mocked. §5.5, mockups 14, 14b |
| U8, SS-08 | Accept. Phones leave the mirror at the final table (normal Now + the grid; no red strip); auto-end 15 min after the last command in champion/table, 60 min in intro/live. §4.7, §4.9 |
| U9 | Accept. "Take down" on the notice strip and a "Showing now" list in Tell everyone. §3.2, §7.2, mockup 10 |
| U10, V5 | Accept. `.btn.sm` 44, hit areas padded to 44 (×, Whole day, Not you? Change, roof back, End reveal, segments, switch rows); a Playwright 44×44 check; every mockup now passes it. §8.5 |
| U11 | Accept. "Nothing left that you can score. 1 game needs another director: …" and a reason on rows without Score. §3.3, §5.4 |
| U12 | Accept. Next replaces history; cold deep links get their tab underneath; the notice builder returns to the Tell everyone draft. §13.5 |
| U13 | Accept. Only the tab bar hides; the Tell everyone dock rides the keyboard with a Done button. §7.2, §13.6 |
| U14 | Accept. Discs mean a place won, always; counts are words ("2 gold · 2 silver · 2 bronze") in the grid and the directors' standings; arrows labelled once ("since this morning"). §4.10, §5.2, mockups 05b, 08 |
| U15 | Accept. Up-next masked by default, press and hold to peek, re-masked during each beat. §4.8, mockup 07, demo |
| U16 | Accept. "Not Sam? Change" on the station card, "Not you? Change" in Your team. §3.3, mockups 03, 16 |
| U17 | Accept in part. The two-tap path is "tap a team in the Games standings"; Award points stays for corrections. The "moment on Now" question stays with the owner (Q1), now with this path in the recommendation. §5.2 |
| U18 | Accept. One "Alerts" row with a plain state line; one sheet with "When Camp is closed" and "While Camp is open". §7.1, mockup 16 |
| U19, SS-17 | Accept. Legacy copy derived from the bracket ("Red plays in the final next · 3rd place match first"); the Saturday champion line is kept, by name only, from a finale reveal, outliving 8 AM until the week ends, with a test that it reads no points. §3.3, mockup 13 |
| U20, V8 | Accept. Mini TV is true 16:9; under 700pt tall it collapses to a thumbnail row and the whole ladder fits above the dock; longer ladders auto-scroll. §4.8, mockup 07b at 375×667 and 360×640 |
| U21 | Accept. `whenHandsOff`: a reflow waits while a finger is on the list and 400 ms after. §9.4, §9.5, demo |
| U22 | Accept. The wait is on the button face, a blocked tap shakes and toasts why, and every remaining remote state is drawn. §4.2, mockup 07c, demo |
| SS-01 | Accept. `expireReveal()` from the tick, visibilitychange, pageshow and the offset handler; `expired` computed at paint in every renderer; the offset persisted for cold offline starts; fake-clock test across 08:00 for active, inactive and resumed tabs. §4.10, §13.2, §14 |
| SS-02 | Accept. `ctl.sa` ("shown at"): rules let it change only when `shown` grows; phones lag only the newest group against `sa`. §4.3, §4.4, §4.7 |
| SS-03 | Accept. `standingsVisible()` inside every points reader (throws for viewers under test, zeros in production); a harness sink recorder over toasts, notifications, share/copy, insertAdjacentHTML, setAttribute, appendChild/textContent and chimes; viewer remote-change scenarios. §4.12, §14 D1, §15 |
| SS-04 | Accept. "Motion leaves no trace": WAAPI only, `follow` only on never-rewritten nodes, keyed FLIP (`morph` + `flipKeyed`), `restamp`, and a residue test. §9.1, §9.4, §9.8 |
| SS-05 | Accept. `ctl.ca` within ±60 s of server time, Start only; Start disabled with pending writes or a just-changed connection. §4.3–4.5 |
| SS-06 | Accept. A `pub` group can only be written once its place is shown (enumerated, rules have no parseInt). §4.4 |
| SS-07 | Accept. `hasChildren()` at `$memberKey`; fixed slots `tv1-9 / remote1-9` (18 rows max per member); only fresh rows count, listed by name and account. §4.3, §4.4 |
| SS-09 | Accept. Result alerts diff `prevRefs.results` inside `applyRemoteState`; matchup baseline seeded at `startApp()`; sync test. §4.12 row 6 |
| SS-10 | Accept. Replacing asks for any non-empty notice (draft too); Undo restores the previous object only if the notice is still what was written. §7.2 |
| SS-11 | Accept. One `confirmedReveal` store for every reveal consumer on a director's phone, motion ledger included. §4.5 |
| SS-12 | Accept. `revealFull` / `revealScreens` fetched with `once()` (remote open, after each command, screens every 20 s); nothing persisted; promotion and demotion just work. §4.5 |
| SS-14 | Accept. Roots split by volatility (header pill and More's state lines patched in place); `teamMark` emits a keyed `<img>` with a cached `blob:` URL instead of inline data URLs. §2.2, §8.4, §13.1 |
| SS-15 | Accept. `textEntryFocused()` for `kb-open`, separate from `fieldFocused()`; scroll compensation for anything inserted above the reader. §13.6 |
| SS-18 | Accept as an owner decision (§18 Q4), with a recommendation; the "fewest points" hint stays editor-only. §4.12 row 17 |
| V1 | Accept. The 3-up podium strip everywhere winners appear; pinned at 360 with the widest podium and a 20-character name. §3.3, mockups 01, 01b, 08 |
| V2 | Accept. New `arrive` spring (12.4% at 60 Hz) for every arrival; `settle` only for full-screen takeovers; minimum visible deformation asserted per row. §9.2, §9.5 |
| V3 | Accept. Presets sampled at 1/60 (Jelly's step); the press dents toward the finger (origin + tilt, 12% squash) and rings back on `wobble`; a real `jelly-button` beside a chunky one in the demo. §9.1, §9.6 |
| V4 | Accept. Keyed morph + keyed FLIP; the demo's mirror and remote ladders now keep their nodes (a surviving row is seen gliding in the headless check). §9.4, §13.3 |
| V6 | Accept in part. Exits through `playOut` (calm = opacity; headless check: zero transform keyframes while calm); TV and mini-TV bobbing static under calm; **the OS setting now beats Off**. **Rejected: renaming Auto / On / Off** (the owner's labels); the line under the switch explains when the phone's setting wins. §10 |
| V7 | Accept. `--roof` does not flip (white on `#2c47ee`, 6.5:1); Back, hatch, tags on theme tokens; dark twins of 05, 07, 08, 10, 13, 14b drawn and audited. §11 |
| V9 | Accept. 7:1 for text under 16px; 12px floor; 13px disc digits on 22px discs; `--ink-3`, `--live`, `--done` darkened and a `--link` token added; tab labels and tallies on ink-2. An automated audit of every mockup in both themes reports 0 failures. §8.1, §8.2, §8.3 |
| V10 | Accept. Switch OFF has a 2px ink-3 outline, an ink-3 thumb and the word "Off"; dashed rows use ink-3. §8.5 |
| V11 | Accept. A shape per senior team (plain, swallowtail, stripe, chevron) and bright mark fills with an ink outline. §8.4, mockup 13 |
| V13 | Accept. §8.10 decides what stays Jelly (toaster, dialogs, drawers, fields) and maps Jelly's tokens once; the End dialog and the toast are drawn in 07c; the demo's toasts are the real `jelly-toaster`. |
| V14 | Accept in part. Drawn now: 01b, 07b, 07c, 14, 14b, 15 (Chat + keyboard), 16 (More for a counselor with Appearance, Alerts and the offline pill), dark twins. Still not drawn: Award points, Who's where, the Your team sheet, Full schedule, the counselor's champion moment; they reuse drawn patterns and are listed for D3/D6. |
| V15 | Accept. §8.9 Accessibility. |
| V16 | Accept. Ladders as one grouped list; sentence-case kickers; sparkles only on Score, Reveal and awards; one tint per meaning (rain and bracket notes are plain lines). §8.1 rule 7, §9.7 |

**Rejected outright**: none. Two parts were declined because they would undo owner decisions:
moving Back away from the big button (layout B) and renaming the calm switch.

**Further improvements made while fixing** (not asked for by any critic)

- Chat gets the plain "Chat" title header like Games and More (mockup 15).
- The Next bar's back label always names where it goes ("‹ Back to Now"), matching the header.
- The remote's status line moved from "beat" text to a single "2 screens · 11 phones · Screen
  stays on" line; the beat lives on the button.
- Screens are listed with their account ("Dining Hall TV (Jenn)") in the pre-start check.
- My own contrast audit caught three things the critics didn't: the "Your team" tag (white on
  fox orange, 5.4:1, now ink in a team-coloured outline), the bronze disc numeral (5.9:1, disc
  lightened to `#e0a36a`, 7.6:1) and the Live tag sitting exactly on 7.0 (now 7.4).
- Mockups are reproducible with audits: `_build.js` (all frames, dark twins, per-screen
  viewports, the full-page state sheet), `_build-demo.js` (inlines the real jelly.js), and
  `_test-demo.js` (behaviour checks).

**Still open** (for the owner or the build, not for the spec): Q1–Q4 in §18; the wake lock and
keyboard behaviour in an iPhone Home Screen app must be checked on a device (D2/D5); the
critics' emulator results are re-proved by `tests/emulator/reveal.mjs` in D5.

