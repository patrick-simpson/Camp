# Phone alerts (Web Push) — implementation spec

Owner's requirements (from interview, all confirmed):
- Real notifications that arrive when the app is CLOSED, for counselors + directors (signed-in members only; no parents).
- No app stores. Delivery = the existing site installed to the Home Screen (iPhone needs Home Screen install, iOS 16.4+; Android Chrome works from the browser too).
- Completely free, NO credit card: Firebase stays on the free Spark plan (no Cloud Functions). The sender is a **Cloudflare Worker on the FREE plan** (owner already has a Cloudflare account).
- What can buzz a closed phone (all four):
  1. New message in the Announcements chat channel (default ON for everyone who turns alerts on).
  2. Someone mentioning you or your team in chat.
  3. Every message in chat channels you subscribed to (same subscriptions as the existing 🔔/🔕 bell in the chat header).
  4. Schedule blocks: EVERY schedule block is individually subscribable ("Supper", "Evening service", …) plus an "every block" switch; alert fires N minutes before (5/10/15, default 10).
  5. Director (editor) pushed alerts: audience = Everyone (default) OR one team's counselors OR directors only; an **Urgent** toggle that comes through even for people who turned off non-urgent director alerts.

Hard platform limits that shape the design (Cloudflare Workers FREE plan, verified in official docs):
- **50 subrequests per invocation** (every fetch(): Google, RTDB, each push service POST).
- **10 ms CPU per invocation** (HTTP and cron alike). Network waiting does NOT count. WebCrypto work DOES count.
- 5 cron triggers per account; we use ONE: `* * * * *`.
- 100k requests/day.
- Web Push encryption costs ~0.15–0.8 ms CPU per recipient ⇒ **cap sends per invocation at PUSH_BATCH = 20** (env-overridable) and fan out the rest (see Outbox).
- Inside Workers `Date.now()` only advances across I/O — fine for our purposes, never use it to measure CPU.

## Names, constants

- Worker name / service: `camp-alerts`. URL will be `https://camp-alerts.<account-subdomain>.workers.dev` (unknown until the owner deploys).
- Firebase project `camp-89cea`, RTDB URL `https://camp-89cea-default-rtdb.firebaseio.com`.
- Camps: `junior` → root `campScoreboard`, `senior` → root `seniorScoreboard`. (The Worker hardcodes this map: `{ junior: 'campScoreboard', senior: 'seniorScoreboard' }`.)
- Site origin: `https://camp.patricksimpson.info`.
- Camp time zone: `America/New_York`. All user-facing times are Eastern. Never show UTC to users.

## Identity (must match app.js + database.rules.json exactly)

- emailKey(email) = `email.trim().toLowerCase().replaceAll('.', ',')`.
- A Firebase ID token's identity key = emailKey(token.email) **only if** `token.email_verified === true`; otherwise `token.phone_number` (E.164, as-is) if present; otherwise no identity (401).
- identityFromKey(key) = key starts with '+' ? key : key.replaceAll(',', '.').
- A member is someone with a record at `<root>/members/<key>` (`{role:'viewer'|'editor', name?, teamId?, …}`). Editors have `role === 'editor'`.

## Data model

### Client-visible (per camp root R) — covered by database.rules.json

`R/push/<memberKey>/<deviceId>` — one record per (person, device). Written ONLY by that person (rules), read only by that person; the Worker reads/deletes with admin access.
```
{
  endpoint: "https://…"          // PushSubscription.endpoint, ≤ 1024 chars, must start with https://
  p256dh:   "<base64url>"         // subscription key, 87 chars for a 65-byte P-256 point (allow 80–100, charset [A-Za-z0-9_-])
  auth:     "<base64url>"         // 16-byte auth secret ⇒ 22 chars (allow 16–32, same charset)
  at:       <server timestamp>    // ServerValue.TIMESTAMP on every write (rules: === now)
  label:    "iPhone"              // ≤ 40 chars, human device label for the "your devices" list
  team:     "t2"                  // OPTIONAL: memberTeamId || state.followTeam on this device (/^t[0-9]$/). Used only for team-MENTION matching.
  prefs: {
    ch:       { announcements: true, general: false, memes: false, photos: false }   // every-message channel subs (booleans). Missing key ⇒ default (announcements true, others false)
    mention:  true      // alert when my name/team is mentioned (default true)
    director: true      // non-urgent director alerts (default true). URGENT ignores this.
    blocksAll: false    // every schedule block (default false)
    blocks:   { "supper": true, "evening-service": true }   // OPTIONAL (RTDB prunes empty). keys /^[a-z0-9-]{1,48}$/, values true only
    lead:     10        // minutes before a block: 5 | 10 | 15 (default 10)
  }
}
```
deviceId: `/^[A-Za-z0-9_-]{8,64}$/`, random, minted once per browser and kept in `localStorage['campScoreboardPushDevice']` (NOT per camp, NOT wiped by clearLocalData — it's not camp data; the record itself is deleted on sign-out).

Defaults function (both sides must agree): `normalizePrefs(raw)` → every field typed; ch.announcements default true; others false; mention true; director true; blocksAll false; blocks {} ; lead ∈ {5,10,15} else 10.

`R/pushSchedule` — the week's schedule as published by an editor's device (the schedule is hardcoded JS in camps.js, the Worker can't evaluate JS, so the client publishes plain data):
```
{
  weekStart: "2027-07-18",   // YYYY-MM-DD, the camp week's SUNDAY (dow 0). Set by an editor in the Phone alerts drawer.
  at: <server timestamp>,
  by: "<identity key>",
  blocks: {
    "<blockId>": { dow: 0..6, start: 0..1439 (minutes after midnight, Eastern), label: "Supper" (≤120), emoji: "🍽️" (≤16), key: "supper" }
  }
}
```
- Exclude blocks with `noTime: true` and any block whose start ≥ 1440.
- blockId: `d<dow>-<start>-<i>` where i = index in that day's array (all lowercase/digits/dash; ≤ 40 chars).
- **block key** = `pushBlockKey(label)`: take the label, cut at the first `' — '` and at the first `' ('` (whichever comes first), lowercase, replace every run of non-[a-z0-9] with '-', trim leading/trailing '-', slice to 48, fallback 'block'. E.g. "Snack and campfire — TJ" → "snack-and-campfire"; "Rising bell, shower & morning meeting (Laura's cottage) — 🦃 …" → "rising-bell-shower-morning-meeting"; "Team assignments (Chapel Lawn)" → "team-assignments"; "“Hot Seat” & “Let’s Make a Deal!”" → "hot-seat-let-s-make-a-deal".
- Republish rule: editor devices republish automatically (no tap) when they're approved+synced and the published `blocks` differ from what the current code would publish (compare a stable JSON of blocks), keeping the existing weekStart. They also publish when an editor saves a weekStart. Viewers never write it.

`R/pushAlerts/<pushId>` — audit log of director alerts, WRITTEN BY THE WORKER (admin) only; editors can read (client shows "recent alerts"). Shape:
`{ at: <ms>, byKey, byName, text, audience: 'all'|'editors'|'t0'..'t9', urgent: bool, sent: n, failed: n }`.

### Worker-private (top-level `pushServer`, NOT in any camp root — rules deny all clients by the root default; Worker uses admin)

```
pushServer/
  vapid:  { publicKey: "<base64url 65-byte uncompressed point>", privateJwk: {kty,crv,x,y,d}, createdAt: ms }
  cron:   { junior: { upTo: ms, lastRun: ms }, senior: {…} }
  sent:   { junior: { "c-<msgId>": ms, … }, senior: {…} }   // chat dedupe markers, pruned after 3 days
  rate:   { junior: { "<memberKey>": ms }, … }              // last director-alert / test time per sender
  outbox: { "<batchId>": { camp, due: ms, created: ms, attempts: n, payload: {…}, ttl: s, urgency: 'high'|'normal', targets: [ {k: memberKey, d: deviceId, e: endpoint, p: p256dh, a: auth} … ≤ PUSH_BATCH ] } }
```
batchId: 24+ random url-safe chars (it doubles as a capability for POST /drain).

## Notification payload (JSON inside the encrypted push; ≤ 3000 bytes UTF-8 before encryption)

```
{ v: 1, camp: 'junior'|'senior', kind: 'announcement'|'mention'|'channel'|'alert'|'urgent'|'block'|'test',
  title: "…" (≤ 80), body: "…" (≤ 300), tag: "…", ts: ms, open: 'chat:<channelId>'|'schedule'|'',
  urgent: bool }
```
Tags (also used by the page's own in-app OS notifications so the two collapse into ONE on a device):
- chat (any of announcement/mention/channel): `chat-<msgId>`
- director alert: `alert-<alertId>`
- block: `block-<blockId>-<YYYY-MM-DD>`
- test: `test-<ms>`

Titles/bodies (Eastern times, plain words):
- announcement: title `📣 Announcements`, body `<Name>: <text≤140 | 📷 Photo>`
- mention: title `💬 <Name> mentioned you`, body `<text≤140>` (channel short name suffix optional)
- channel: title `<channel emoji> <channel short>`, body `<Name>: <text≤140 | 📷 Photo>`
- alert: title `📢 <Name>`; urgent: title `🚨 URGENT — <Name>`; body = alert text
- block: title `<emoji> <label>`; body `Starts at 5:00 PM (in 10 min)` (time in Eastern, 12-hour, "PM"/"AM")
- test: title `✅ Phone alerts are working`, body: a short friendly line (keep it a single constant/array the owner can edit; neutral wording for now).
Author <Name> resolution = `members/<byKey>/name` (trimmed) else identityFromKey(byKey). NEVER trust a client-supplied name.

## Cloudflare Worker (`push-worker/worker.js`, single-file ES module, dashboard-pasteable)

Runtime: Workers (workerd). No npm deps, no Node APIs, only Web APIs: fetch, crypto.subtle, crypto.getRandomValues, TextEncoder/Decoder, atob/btoa, Intl, URL, Response. `export default { fetch(request, env, ctx), scheduled(controller, env, ctx) }`. Expose pure internals for tests via a NON-enumerable property: `Object.defineProperty(handler, '_test', { value: {...}, enumerable: false })`.

Env (all optional except the secret):
- `FIREBASE_SERVICE_ACCOUNT` (secret): the service-account JSON downloaded from Firebase console → Project settings → Service accounts → Generate new private key. Fields used: client_email, private_key (PKCS#8 PEM), token_uri (default https://oauth2.googleapis.com/token).
- `FIREBASE_DB_URL` default `https://camp-89cea-default-rtdb.firebaseio.com`
- `FIREBASE_PROJECT_ID` default `camp-89cea`
- `ALLOWED_ORIGINS` default `https://camp.patricksimpson.info` (comma list)
- `VAPID_SUBJECT` default `https://camp.patricksimpson.info` (must be https: or mailto:)
- `PUSH_BATCH` default 20 (clamp 1..40)
- TEST-ONLY overrides, honored ONLY when FIREBASE_DB_URL host is `127.0.0.1` or `localhost`: `DB_ADMIN_TOKEN` (sent as `Authorization: Bearer <token>` instead of minting OAuth — the RTDB emulator accepts "owner"), `JWKS_URL` (alternate signing keys for ID tokens), `ID_TOKEN_ISSUER_PROJECT` not needed. Document that these are ignored in production.

### Google service-account OAuth (RTDB admin)
JWT RS256 `{iss: client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: token_uri, iat, exp: iat+3600}` → POST `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…` → access_token. Cache in isolate memory until `expires_in - 300s`. RTDB REST: `${DB}/${path}.json` with `Authorization: Bearer <token>`; server timestamps `{".sv":"timestamp"}`; shallow reads `?shallow=true`; conditional writes via `X-Firebase-ETag: true` on GET and `if-match: <etag>` on PUT/DELETE (412 = lost the race).

### Firebase ID token verification (caller auth)
`Authorization: Bearer <idToken>` from `firebase.auth().currentUser.getIdToken()`. Verify RS256 with JWKS from `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com` (cache per Cache-Control max-age, default 1h, in isolate memory; refetch once on unknown kid). Checks: alg RS256, kid known, aud === project, iss === `https://securetoken.google.com/<project>`, exp > now, iat ≤ now+300, sub non-empty string, auth_time ≤ now+300. Derive identity key (see Identity). Then `R/members/<key>` must exist (403 `not-member`).

### HTTP API (JSON in/out; CORS for ALLOWED_ORIGINS; OPTIONS preflight 204 with Allow-Methods GET,POST,OPTIONS, Allow-Headers Authorization,Content-Type, Max-Age 86400; reject bodies > 16 KB; every error body `{ ok:false, error:'<code>', message:'<plain English>' }`)

- `GET /` → small human-readable HTML status page (no auth): runs a real check (mint OAuth + read `pushServer/cron` + ensure VAPID) and shows ✅/❌ lines in plain English: "Sender is running", "Connected to Firebase" (or the exact problem: secret missing / JSON unparsable / Google refused the key), "Schedule timer last ran N minutes ago" (from pushServer/cron lastRun; ❌ if > 5 min or never — tells them to add the cron trigger). Never print secrets.
- `GET /health` → `{ ok, version, configured: bool, vapid: bool, cronLastRun: ms|null, time: ms }` (same checks, JSON, for the app's director-only status line).
- `GET /vapid-key` → `{ ok:true, publicKey }`. Creates the VAPID key pair on first need: generate ECDSA P-256, store `pushServer/vapid` with a conditional PUT (ETag of the null location; on 412 re-read and use the winner). Never regenerate once stored.
- `POST /notify` (auth required) body:
  - `{ camp, kind:'chat', ch, msgId, mentionKeys?: string[] (≤ 30), mentionTeams?: string[] (≤ 10) }`
    - ch ∈ {announcements, general, memes, photos}; msgId `/^[A-Za-z0-9_-]{1,64}$/`.
    - Read `R/chat/<ch>/<msgId>`; 404 if missing; 403 unless `msg.byKey === callerKey`.
    - Dedupe: conditional create `pushServer/sent/<camp>/c-<msgId>` (GET+ETag, PUT if-match) → if already present respond `{ok:true, duplicate:true, sent:0}`.
    - Recipients (one delivery per DEVICE, never two): every device record under every memberKey that (a) is still in `R/members`, (b) is NOT the author's key, and (c):
      - ch === 'announcements': `prefs.ch.announcements !== false` → kind 'announcement'
      - else if prefs.mention && (memberKey ∈ mentionKeys || device.team ∈ mentionTeams || member.teamId ∈ mentionTeams) → kind 'mention'
      - else if prefs.ch[ch] === true → kind 'channel'
      (ignore mentionKeys that aren't members; mention beats channel for the same device.)
    - TTL 6h (21600), Urgency high for announcement/mention, normal for channel.
  - `{ camp, kind:'alert', text (1..300 after trim), audience:'all'|'editors'|'t0'..'t9', urgent: bool }`
    - Caller must be an editor (403 `not-editor`). Rate limit: one alert per sender per 10 s (`pushServer/rate`) → 429 `rate`.
    - Recipients: devices of current members in the audience (`editors` ⇒ role editor; `tN` ⇒ member.teamId === tN; `all` ⇒ everyone), INCLUDING the sender's own devices. Non-urgent requires `prefs.director !== false`; urgent ignores it.
    - Write `R/pushAlerts/<id>` (POST/push id via REST `POST R/pushAlerts.json` or generated id) with counts after sending (or before then patch).
    - TTL 12h (urgent: 2h), Urgency high. Payload `urgent:true` for urgent.
  - `{ camp, kind:'test', deviceId? }` → only the CALLER's own devices (or that one device if given and it's theirs). Rate limit 1 per 5 s per sender. TTL 600, Urgency high.
  - Response: `{ ok:true, sent, failed, removed, queued, batches: [batchId…] , errors?: [{status, host}] }`.
- `POST /drain` `{ batch }` (no auth: the random batchId is the capability; also reject unknown/invalid ids with 404) → claim the batch with a conditional DELETE (GET with ETag, DELETE if-match; 412 ⇒ someone else has it ⇒ `{ok:true, claimed:false}`), then send its targets. Response like /notify.
- `POST /resubscribe` `{ oldEndpoint, endpoint, p256dh, auth }` (no auth: knowing the old endpoint is the capability; validate all fields like the rules do) → find device records in BOTH camps whose endpoint === oldEndpoint and replace endpoint/p256dh/auth (keep prefs). Response `{ ok:true, updated:n }`. (Used by the service worker's `pushsubscriptionchange`.)
- Anything else → 404.

### Sending (shared by /notify, /drain, cron)
- Per invocation: count subrequests; HARD cap 45. Send at most PUSH_BATCH deliveries inline; everything beyond is written as outbox batches of ≤ PUSH_BATCH targets each (one multi-path PATCH at `pushServer/outbox`), due = now. /notify returns the batch ids; the CLIENT immediately POSTs /drain for each (in parallel, fire-and-forget); the cron drains anything still left (it's the backstop).
- Web Push request: `POST endpoint` with headers `TTL`, `Urgency`, `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`, `Authorization: vapid t=<JWT>, k=<publicKey>`. VAPID JWT ES256 header `{typ:'JWT',alg:'ES256'}`, claims `{aud: new URL(endpoint).origin, exp: now+12h, sub: VAPID_SUBJECT}`; cache per audience (isolate memory) until exp-1h. Signature is raw r||s (WebCrypto ECDSA output) base64url.
- Encryption RFC 8291 + RFC 8188 aes128gcm, single record: one ephemeral ECDH P-256 key pair per invocation (reused across that invocation's recipients — each recipient's shared secret still differs, and a fresh random 16-byte salt per message keeps every CEK unique); `IKM = HKDF(salt=auth, ikm=ecdh_secret, info="WebPush: info\0" || ua_public || as_public, L=32)`; `CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm\0", 16)`; `NONCE = HKDF(salt, IKM, "Content-Encoding: nonce\0", 12)`; plaintext = payload || 0x02; body = salt(16) || rs uint32 BE (4096) || idlen(1)=65 || as_public(65) || ciphertext. Use crypto.subtle HKDF deriveBits.
- Responses: 201/200/202 ok. 404/410 ⇒ subscription is dead: delete `R/push/<k>/<d>` ONLY if its stored endpoint still equals the failed one (GET endpoint, then DELETE) — if the subrequest budget is short, skip cleanup (the next send retries it). 429/5xx/network error ⇒ transient: re-enqueue those targets as a new outbox batch with attempts+1 and due = now + 60 s × attempts, give up after 3 attempts. 400/403/413 ⇒ permanent for this message; record `{status, host}` in the response `errors` (403 from web.push.apple.com usually means a VAPID problem — surface it on GET /).

### Cron (`scheduled`, every minute)
For each camp (junior, senior):
1. **Outbox**: shallow-read `pushServer/outbox`; for batches whose `camp` matches and `due ≤ now` (needs a full read of only those ids, one at a time within budget), claim + send (same as /drain). Process batches older than 20 s first only if the client hasn't drained them (claim protocol makes double-processing impossible).
2. **Schedule alerts**: read `R/pushSchedule/weekStart` (small). If missing/invalid → skip. If now is outside [weekStart 00:00 ET − 1 day, weekStart + 8 days] → skip (no writes, so the cron costs ~nothing the rest of the year). Else read `R/pushSchedule/blocks` and `pushServer/cron/<camp>`. Window: `from = max(stored upTo || now, now − 5 min)`, `to = now + 60 s` (send up to one minute early — the cron only ticks once a minute). For each block: `startMs = etWallToEpoch(addDays(weekStart, dow), start)`; for each lead L ∈ {5,10,15}: `due = startMs − L·60 s`; if `from < due ≤ to` the block is "due for lead L". If any block is due → read `R/push` + `R/members` and deliver to each device of a current member where `(prefs.blocksAll || prefs.blocks[key]) && normalizedLead === L`. Payload kind 'block', tag `block-<blockId>-<date>`, TTL = max(60, seconds until start), Urgency high. Then PUT `pushServer/cron/<camp>` = `{upTo: to, lastRun: now}`. (Always write lastRun for the heartbeat even when nothing was due; one tiny write a minute per camp is fine, but outside camp week write only `pushServer/cron/<camp>/lastRun`.)
3. **Hourly maintenance** (when the Eastern minute === 17): prune `pushServer/sent/<camp>` markers older than 3 days; prune `pushServer/rate` entries older than 1 day; delete `R/push/<memberKey>` subtrees whose memberKey is no longer in `R/members` (a removed counselor stops getting alerts immediately anyway because sends check membership; this just tidies).
Respect the subrequest/CPU budget across all of it (outbox first, then schedule; anything that doesn't fit waits for the next minute).

`etWallToEpoch(ymd, minutes)`: convert an Eastern wall-clock time to epoch ms using Intl.DateTimeFormat('en-US', {timeZone:'America/New_York', hourCycle:'h23', …}).formatToParts to find the offset; iterate twice to settle across DST. `minutes` may be ≥ 1440 only if the caller passes it (normalize by adding days). Format times with Intl in America/New_York, `h:mm AM/PM`.

### Files to deliver (Worker side)
- `push-worker/worker.js` — the Worker (heavily commented in the repo's style: why, not what).
- `push-worker/wrangler.toml` — for CLI users: name `camp-alerts`, main `worker.js`, a compatibility_date ≥ 2024-09-23, `[triggers] crons = ["* * * * *"]`. No secrets in it.
- `push-worker/README.md` — **plain-English, step-by-step setup guide for a non-programmer** using the Cloudflare DASHBOARD (no CLI needed): create Worker named camp-alerts → paste worker.js → Deploy; Firebase console → Project settings → Service accounts → Generate new private key (explain it's a password-like file: never email it, paste it only into Cloudflare, delete the download afterwards); Worker → Settings → Variables and Secrets → add Secret `FIREBASE_SERVICE_ACCOUNT` = whole JSON; Worker → Settings → Triggers → Cron → `* * * * *`; open the Worker URL in a browser → the status page should show all ✅; send the URL to whoever maintains the site so `PUSH_SERVICE_URL` (push.js) and the CSP get it. Also: how to update the Worker later (paste new worker.js), how to turn alerts off (delete the cron trigger / disable the Worker), what it costs ($0 — free-plan limits explained in one paragraph), troubleshooting table (status page ❌ messages → fixes).
- Tests: `tests/push-worker.test.js` (runs under `node tests/run.js`). The runner evaluates test files inside a vm context; add to tests/run.js a minimal hook `sandbox.nodeRequire = require` and `sandbox.importModule = (rel) => import(require('url').pathToFileURL(require('path').join(__dirname, rel)).href)` so this test can load the Worker module in the MAIN realm (do all crypto/typed-array work in the main realm; pass only plain strings/objects across). Cover: base64url round trips; VAPID JWT verifies with node:crypto (`dsaEncoding:'ieee-p1363'`) and has the right claims; **encryption decrypts correctly with an independent node:crypto implementation of RFC 8291** (createECDH + hkdfSync + aes-128-gcm decipher), including a non-ASCII payload; ID-token verification (sign test tokens with a locally generated RSA key served through a stubbed fetch for JWKS — accept good, reject: wrong aud, wrong iss, expired, unknown kid, bad signature, unverified email without phone, alg none); identity key rules; recipient selection truth table (announcement default-on, explicit off, mention by key/device team/member team, channel sub, author excluded, removed member excluded, one delivery per device, alert audiences all/editors/team, urgent bypasses director:false, non-urgent respects it); etWallToEpoch around DST and in July; block due-window math (from/to edges, leads 5/10/15, outside camp week ⇒ nothing, first-run doesn't backfill); outbox batching (25 recipients with PUSH_BATCH 20 ⇒ 20 inline + 1 batch of 5) and subrequest cap; dead-subscription cleanup only when endpoint unchanged; /notify end-to-end with a fake fetch that emulates RTDB REST + push endpoints (duplicate msgId ⇒ duplicate:true; non-author ⇒ 403; non-editor alert ⇒ 403; rate limit ⇒ 429); CORS preflight; unknown route 404; oversized body 413/400.
  Use a fake `fetch` injected via the handler's env or a module-level setter exposed in `_test` (do not monkey-patch globals in a way that leaks between tests).

## Client (site)

### New file `push.js` (self-contained layer like chat.js; loaded AFTER chat.js, BEFORE auth-*.js; every hook from app.js/chat.js is `typeof`-guarded so deleting the script tag leaves the app exactly as before)
- `const PUSH_SERVICE_URL = '';` at the top with a comment: blank ⇒ feature dormant (drawer explains "not connected yet"). Do NOT invent a URL. Also `const PUSH_SW_VERSION = 2;` used in the registration URL.
- Pure, testable helpers (no DOM): `pushBlockKey(label)`, `pushScheduleBlocks(daySchedule)` → `{ <blockId>: {dow,start,label,emoji,key} }`, `pushBlockCatalog(daySchedule)` → ordered unique `[{key,label,emoji,when:'Mon–Fri 5:00 PM'…}]` (label = the head label, emoji of first occurrence; order by first appearance across Sun..Sat), `normalizePushPrefs(raw)`, `pushDeviceRecord({endpoint,p256dh,auth}, prefs, team, label)` (shape above; `at` = ServerValue.TIMESTAMP when firebase exists), `pushMentionTargets(text)` → `{ keys:[], teams:[] }` using chat.js `mentionScan(text, chatMentionTargets())` (person hits with key ⇒ key; keyless person hits ⇒ any directory member whose name or first name equals the label case-insensitively; team hits ⇒ teamId; dedupe; exclude my own key), `isValidWeekStart('YYYY-MM-DD')` (real date AND a Sunday), `pushEnvironment()` → `'unsupported'|'ios-needs-install'|'ios-too-old'|'denied'|'ready'` (feature-detect: serviceWorker, PushManager, Notification; iOS detection incl. iPadOS-as-Mac via maxTouchPoints; standalone via `navigator.standalone` or `matchMedia('(display-mode: standalone)')`).
- Subscriptions also drive the existing chat bells: the per-channel "every message" prefs ARE `readChatSubs()`/`chatSubscribed()` (one source of truth on the device); when push is on, toggling a bell (toggleChatSub) also rewrites the device record (`pushPrefsChanged()` hook).
- `initPush()` — called from app.js right after `initChatSync()` inside the approved/sync-started path (post-membership, same invariant as every other ref). Does: if PUSH_SERVICE_URL is blank → nothing. Else, if this device previously enabled push (localStorage per camp `lsKey('campScoreboardPushOn')`) and Notification.permission === 'granted': self-heal — ensure the SW registration, `getSubscription()`; if a subscription exists, (re)write the device record if endpoint/keys/team/label changed or the record is missing (read own record once); if the subscription is gone, show a one-tap "Tap to reconnect phone alerts" toast/button (iOS requires a user gesture to subscribe; try silent re-subscribe first on non-iOS and fall back to the tap). If permission is now 'denied' → clear the local flag, delete the device record, and show nothing noisy. Editors: auto-republish `R/pushSchedule/blocks` if they differ (keep weekStart; skip if weekStart was never set — still publish blocks so the drawer can show the catalog? NO: publish blocks only when weekStart exists or is being set).
- Service worker: register `sw.js?v=${PUSH_SW_VERSION}` with `{ updateViaCache: 'none' }` (replace the existing `register('sw.js')` call in app.js boot — same scope './'), and before subscribing make sure the ACTIVE worker is the new one (wait for `installing`/`waiting` → 'activated', with a 10 s timeout and a plain-English failure message).
- Enable flow (must run inside the button's click handler, permission request FIRST, before any other await, for iOS): `Notification.requestPermission()` → registration → fetch `${PUSH_SERVICE_URL}/vapid-key` (cache the key in localStorage `campScoreboardPushVapid`; if the cached key differs from the server's, unsubscribe and resubscribe) → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → write `R/push/<myKey>/<deviceId>` via `.set()` → set the local flag → re-render → toast "Phone alerts are on". Errors → plain-English toasts, never silent.
- Disable: delete the device record, `subscription.unsubscribe()` only if no OTHER camp on this device still has the flag on (the endpoint is shared per browser across camps), clear local flag.
- Sign-out hook: `pushSignOut()` returns a promise (timeout 3 s) that deletes this device's records in the active camp and unsubscribes; `signOutAndClear` must await it (bounded) BEFORE `firebase.auth().signOut()` (after sign-out the rules refuse the delete). Also clear `campScoreboardPushOn` for both camps.
- Chat hook: after `chatAtomicSend` resolves in `sendChatMessage` and `sendChatPhoto`, call `pushNotifyChat(ch, msgId, textOrEmpty)` (typeof-guarded): POST /notify `{camp, kind:'chat', ch, msgId, mentionKeys, mentionTeams}` with `Authorization: Bearer <await firebase.auth().currentUser.getIdToken()>`; for each returned batch id fire `POST /drain {batch}` (no await chain, errors swallowed — the cron is the backstop). Never block or fail the chat send on push errors (log to console only).
- Page-side notification tags: change chat.js's three `maybeNativeNotification(..., 'camp-chat-…-' + msg.id)` tags to the SAME `chat-<msgId>` the push uses, so a backgrounded open app + a push collapse to one notification.
- SW → page messages: listen to `navigator.serviceWorker` 'message': `{type:'camp-push', payload}` → for kind alert/urgent show an in-app toast (urgent styled loud); `{type:'camp-open', open}` → handle open target (`chat:<ch>` ⇒ `openChat(ch)`; `schedule` ⇒ open the schedule sheet if a function exists). Also on boot read `?open=` from the URL (then strip it with history.replaceState) and handle it once the app is painted.
- App badge: when the app becomes visible, `navigator.clearAppBadge && navigator.clearAppBadge()` (guarded, catch).

### Phone alerts drawer (UI)
- index.html: add a Settings row **"📲 Phone alerts"** in the alphabetical list (between "Change history" and "Set up the week"), visible to everyone (viewers too). It opens a new `<jelly-drawer id="alerts-overlay" side="bottom" label="Phone alerts">` with `<h2 class="settings-title">📲 Phone alerts</h2>` and `<div class="settings-body" id="alerts-body"></div>`, same open pattern as `openMembers` (close the settings drawer first, then open).
- Content (rendered by push.js `renderPushDrawer()`):
  1. **Status** — one of: not connected yet (PUSH_SERVICE_URL blank: editors get one line explaining the sender isn't set up; viewers just "Phone alerts are coming soon"); unsupported browser; iPhone not installed (numbered steps: Share ⬆️ → Add to Home Screen → open Camp from the Home Screen icon → come back here); iOS too old (needs iOS 16.4+); permission denied (how to re-allow: iPhone Settings → Notifications → Camp; Android: tap the lock icon by the address → Notifications → Allow); off → big "Turn on phone alerts" button; on → "✅ Alerts are on for this phone" + "Send me a test" + "Turn off on this phone".
  2. **What buzzes this phone** (only when on): Chat — one switch per channel (labels from CHAT_CHANNELS, Announcements first), "When someone mentions me or my team", "Director alerts (🚨 urgent ones always come through)". Schedule — "How early" segmented 5 / 10 / 15 min; "Every schedule block" switch; then the block catalog as compact toggle chips/rows with emoji + label + small "Mon–Fri 5:00 PM" hint (disabled while "every block" is on). If `R/pushSchedule/weekStart` isn't set: a muted note "Schedule alerts start once a director sets the camp week."
  3. **📢 Send an alert** (editors only): textarea (maxlength 300, live count), audience `jelly-select` (Everyone · Directors only · each team by name), "🚨 Urgent" switch with a one-line explanation, Send button (confirm() for urgent, and for Everyone). Result line "Sent to 17 phones" (+ "2 couldn't be reached"). Recent alerts list (last 5 from `R/pushAlerts`, newest first: time in Eastern, audience, urgent badge, counts).
  4. **🗓️ Camp week** (editors only): "Camp week starts (Sunday)" `<input type="date">` + Save; validates it's a Sunday; on save publishes `R/pushSchedule` {weekStart, blocks, at, by}. Shows "Schedule alerts are live for Jul 18–24" / "Not set". Plus a sender status line from GET /health ("Sender: ✅ online · timer ran 1 min ago" / "❌ can't reach the sender").
- Style: reuse existing classes and Jelly components (settings-row, settings-body, muted, jelly-switch, jelly-segmented, jelly-select, jelly-button, chips if vendor/jelly.js has them — check its API). Minimal new CSS in styles.css using the existing `--color-*` tokens, light + dark, 360–414 px wide with no horizontal overflow. Avoid generic AI-design tropes: no gradients, no glassmorphism, no glowing shadows, no oversized hero cards, no centered-everything; it should look like it always belonged to this app.
- All user-typed text escaped with `esc()`.

### Service worker (`sw.js`)
Keep: no fetch handler (CRITICAL — read its header), skipWaiting/claim, kill-switch comment. Add:
- `push` handler: parse `event.data.json()` defensively (missing/invalid ⇒ generic `{title:'Camp', body:'Something new — tap to open.'}`), ALWAYS call `showNotification` (iOS revokes push permission for pushes that show nothing). Options: `{ body, tag, renotify: urgent || kind==='alert', requireInteraction: urgent, icon: 'apple-touch-icon.png', badge: 'apple-touch-icon.png', data: { open, camp, kind }, vibrate: urgent ? [400,150,400,150,400] : [200,100,200], timestamp: ts }`. Also `postMessage({type:'camp-push', payload})` to all window clients, and `self.navigator.setAppBadge && self.navigator.setAppBadge()` (guarded) for chat kinds.
- Put the payload→notification mapping in a pure function `campNotificationFromPayload(payload)` (no globals) so tests can load sw.js in a vm with a stub `self` and assert on it.
- `notificationclick`: close; focus an existing window and `postMessage({type:'camp-open', open})`, else `clients.openWindow('./' + (open ? '?open=' + encodeURIComponent(open) : ''))`.
- `pushsubscriptionchange`: re-subscribe with `event.oldSubscription.options.applicationServerKey` (if available) and POST `${self.location.origin}`-independent: the SW doesn't know PUSH_SERVICE_URL, so pass it in the registration URL query (`sw.js?v=2&push=<encoded url>`) and read it from `self.location.search`; POST `/resubscribe {oldEndpoint, endpoint, p256dh, auth}`. Best-effort.

### Security rules (`database.rules.json`, BOTH camp roots, mirror the existing expression style EXACTLY — same member/editor/identity sub-expressions, own-root members lookups, email_verified)
- `push`: no `.read`/`.write` at the `push` level. `$memberKey`: `.read` = caller is a member AND `$memberKey` is the caller's identity key; `.write` = `$memberKey` is the caller's identity key AND (`!newData.exists()` OR caller is a member). `$deviceId`: `.validate` = `$deviceId.matches(/^[A-Za-z0-9_-]{8,64}$/) && newData.hasChildren(['endpoint','p256dh','auth','at','prefs'])`; children validated as in the data model (endpoint beginsWith 'https://' && length ≤ 1024; p256dh/auth matches the base64url ranges; at === now; label ≤ 40; team matches /^t[0-9]$/; prefs with `ch` {four channel ids boolean, $other false}, mention/director/blocksAll boolean, lead ∈ {5,10,15}, blocks/$key: `$key.matches(/^[a-z0-9-]{1,48}$/) && newData.val() === true`, $other false); `$other: false` on every named-child record.
- `pushSchedule`: `.read` member; `.write` editor; `.validate` hasChildren(['weekStart','at','by','blocks']); weekStart matches /^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/; at === now; by isString ≤ 200; blocks/$blockId (`$blockId.matches(/^[a-z0-9-]{1,40}$/)`) with dow (number 0..6), start (number 0..1439), label (string ≤ 120), emoji (string ≤ 16), key (matches /^[a-z0-9-]{1,48}$/), $other false; $other false.
- `pushAlerts`: `.read` editor; `.write` false (Worker-only via admin).
- Update `tests/rules.test.js`: the expected gated-path list gains `push`, `pushAlerts`, `pushSchedule`; add tests pinning the new invariants (push bound to the owner's key for read+write, removed members can still delete their own record, $other:false everywhere, pushAlerts not client-writable, pushSchedule editor-only write, both camps identical modulo root). Keep every existing test passing.

### Client tests
- `tests/harness.js` APP_FILES gains `push.js` (after chat.js). Add `tests/push.test.js` (+ `tests/push.senior.test.js` for the senior catalog): pushBlockKey cases above; pushScheduleBlocks excludes noTime, ids unique/valid, every key valid per rules regex; catalog merges "Snack and campfire — X" variants and both morning-meeting variants; normalizePushPrefs heals every pruned shape; pushDeviceRecord passes a JS re-implementation of the rules' validate (regexes/lengths); pushMentionTargets (key hit, keyless-name hit via directory, team hit, self excluded, dedupe); isValidWeekStart (Sunday yes, Monday no, Feb 30 no); sw.js `campNotificationFromPayload` (valid, missing, garbage, urgent) loaded via vm with a stub self.
- Do NOT bump any `?v=` numbers, APP_VERSION, or CODE_UPDATED_AT (the integrator does that once at the end). DO add the `<script src="push.js?v=181"></script>` tag using the current number.
- Do NOT add "What's new" entries (CHANGES stays empty).
- Run `node tests/run.js` and `node --check` on every changed JS file; all green before you finish.
