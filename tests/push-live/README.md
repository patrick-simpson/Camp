# Live phone-alert check with pretend phones (opt-in, touches the LIVE camp)

Run at Step 27 (Sat Nov 7, 2026, about 12:00–1:45 AM ET) with the owner's permission. It is NOT part of
`node tests/run.js` and is never loaded by the browser. Every run writes to the live database and sends real
alerts, so run it only with the owner's yes.

- `device.mjs` — a pretend phone: it gets a REAL alert address from Mozilla's push service (the one Firefox uses,
  over its WebSocket protocol), holds the phone's own keys and decrypts what arrives (RFC 8291 / 8188 aes128gcm).
  Its decryption was checked against the sender's own `encryptPayload`.
- `sim.mjs` — three pretend phones (the owner and two temporary test sign-ins on the owner's Gmail, `+campa` and
  `+campb`, added to junior camp as counselors) enrolled through the REAL app in headless Chromium. Only two things
  are stubbed, because a headless browser cannot do them: `PushManager.subscribe` / `getSubscription` hand the app the
  pretend phone's Mozilla address, and `Notification.permission` reads "granted" (headless Chromium says "denied" even
  after granting; its own `permissions.query` says "granted"). Phases: `send`, `signin` (LINK from the emailed
  sign-in link), `members-add`, `run`, `cleanup`, `signin-delete`.
- `practice.mjs` — a practice reveal must buzz nobody (a control buzz first proves the phone is listening).

Lessons: count from a mark taken BEFORE the trigger (the sender answers after it has already delivered, so an awaited
send can arrive first); a practice Start is `revealStart({ practice: true })` — `revealSetPractice` is only the
remote's switch, and without the option the Start is a REAL reveal (it buzzes everyone and its ended node cannot be
deleted before 8 AM the next day); Firebase's free plan sends only about 5 sign-in emails a day for the whole project.

Result (third run plus the practice check): 10 of 10 — each phone's own test; an Announcements message from a
counselor reached the other two; a team named in General reached only that team; a followed channel reached only its
follower; Tell everyone's buzz reached everyone with director alerts on; an urgent buzz to one team reached that team
even with director alerts off; directors-only reached only the director; a practice reveal buzzed nobody. Each arrived
within about a second.
