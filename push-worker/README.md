# Phone alerts sender — setup guide

This folder is the small program that makes counselors' and directors' phones
buzz with camp alerts **even when the camp app is closed**: Announcements,
someone mentioning you, the chat channels you follow, "Supper starts in 10
minutes", and director alerts.

It runs on **Cloudflare Workers** — a service that runs small programs on the
internet for you. You set it up once, by copying and pasting in a web browser.
No programming, no command line, no credit card.

You will need about 20 minutes, a computer (not a phone), and:

- your **Cloudflare** account (sign-in at <https://dash.cloudflare.com>)
- the **Google account that owns the camp's Firebase project** (the camp
  database, called `camp-89cea`)
- the file **`worker.js`** from this folder

All times on the sender's status page are **Eastern**, like everywhere else in
the camp app.

---

## What it costs: $0

Everything here fits in free plans and none of them asks for a credit card.
Cloudflare's free Workers plan allows 100,000 requests a day; the sender's
once-a-minute timer uses 1,440 of those and each chat message or alert a few
more. Each run may use 10 milliseconds of computer time and make 50 network
calls, which is why the sender alerts at most 20 phones per run and hands the
rest to the next run a moment later — you never need to think about it.
Firebase stays on its free plan, and Apple, Google and Mozilla deliver the
notifications to phones for free.

---

## Setup, step by step

### Step 1 — Create the Worker

1. Go to <https://dash.cloudflare.com> and sign in.
2. In the left-hand menu, click **Compute (Workers)**, then **Workers & Pages**.
   (On some accounts the menu just says **Workers & Pages**.)
3. Click the blue **Create** button (it may say **Create application**).
4. On the **Workers** tab, choose **Start with Hello World!** and click
   **Get started**.
5. In the **Worker name** box, type exactly: `camp-alerts`
6. Click **Deploy**.

✅ **Success looks like:** a "Congratulations" page with an address ending in
`.workers.dev`, something like `https://camp-alerts.yourname.workers.dev`.
That's the sender's address — you'll need it at the end.

### Step 2 — Put the camp's code in it

1. On that page, click **Edit code** (top right).
2. A code editor opens with a few lines of sample code. Click inside the code,
   press **Ctrl + A** (Windows) or **⌘ + A** (Mac) to select all of it, and
   press **Delete**.
3. Open `worker.js` from this folder, select everything in it the same way,
   copy it (**Ctrl + C** / **⌘ + C**), and paste it into the empty editor
   (**Ctrl + V** / **⌘ + V**).
4. Click **Deploy** (top right), and confirm if it asks.

✅ **Success looks like:** a small "Version deployed" message. Errors at this
point almost always mean part of the file didn't get copied — repeat the
step, making sure you copied from the very first line to the very last.

### Step 3 — Download the database key from Firebase

The sender needs a key to read and write the camp database.

> 🔐 **This key works like a master password to the camp database.** Never
> email it, text it, or put it in a shared folder. You will paste it into
> exactly one place (Cloudflare, in step 4) and then delete the file.

1. Go to <https://console.firebase.google.com> and open the camp project
   (**camp-89cea**).
2. Click the **⚙️ gear** next to **Project Overview** (top left), then
   **Project settings**.
3. Click the **Service accounts** tab.
4. Click **Generate new private key**, then **Generate key**.

✅ **Success looks like:** your browser downloads a file with a name like
`camp-89cea-firebase-adminsdk-abc12-1234567890.json`.

### Step 4 — Give the key to the Worker (as a secret)

1. Back in Cloudflare, open the **camp-alerts** Worker (Workers & Pages →
   **camp-alerts**).
2. Click the **Settings** tab, then find **Variables and Secrets**.
3. Click **+ Add**.
4. Set **Type** to **Secret**.
5. In **Variable name**, type exactly: `FIREBASE_SERVICE_ACCOUNT`
6. For **Value**, open the downloaded key file in a plain text editor —
   on Windows: right-click it → **Open with** → **Notepad**; on a Mac:
   right-click it → **Open With** → **TextEdit**. Select everything
   (it starts with `{` and ends with `}`), copy it, and paste it into the
   **Value** box.
7. Click **Deploy**.
8. **Delete the downloaded key file** from your computer, and empty the
   Recycle Bin / Trash.

✅ **Success looks like:** `FIREBASE_SERVICE_ACCOUNT` listed under Variables
and Secrets with its value hidden. (Cloudflare never shows a secret again,
not even to you. That's normal.)

### Step 5 — Turn on the every-minute timer

The timer sends schedule alerts on time and retries anything that didn't get
through the first time.

1. Still in the Worker's **Settings** tab, find **Trigger Events** and click
   **+ Add**, then **Cron Triggers**. (On older dashboards: the **Triggers**
   tab → **Cron Triggers** → **Add Cron Trigger**.)
2. If it offers a choice, pick the option to type a **cron expression**, and
   enter exactly (five stars with spaces between them):

   ```
   * * * * *
   ```

   That means "every minute". If it only offers a form instead, choose
   **Minute** and **every 1 minute**.
3. Click **Add** (or **Deploy**).

✅ **Success looks like:** the trigger listed as `* * * * *`, with a note like
"every minute".

### Step 6 — Check that everything works

1. Open the sender's address from step 1 in your browser (for example
   `https://camp-alerts.yourname.workers.dev`). You can also find it on the
   Worker's overview page under **Domains & Routes**, or with the **Visit**
   link.
2. You'll see the status page. Wait two minutes after step 5, then reload it.

✅ **Success looks like:** "Everything is working." and four ✅ lines:

- ✅ Sender is running
- ✅ Connected to Firebase
- ✅ Sender key ready
- ✅ Schedule timer last ran less than a minute ago

Any ❌ line tells you what's wrong and how to fix it; the
[troubleshooting table](#troubleshooting) below has more detail.

This page is public, but it only shows whether the sender is healthy — never
names, messages, schedule or anything from the key.

### Step 7 — Connect the camp site to the sender

Send the sender's address (from step 1) to whoever maintains the camp site.
They make two small changes to the site:

1. Set `PUSH_SERVICE_URL` at the top of `push.js` to that address.
2. Add that address to the `connect-src` list in the
   `Content-Security-Policy` line of `index.html` (the site's list of places
   it's allowed to talk to — without it, the browser silently blocks the
   sender).

Until then, the app's **📲 Phone alerts** screen says alerts are coming soon,
and nothing else changes.

### Step 8 — Set the camp week (directors, each camp)

Schedule alerts ("Supper starts in 10 min") only run during camp week. In the
app, a director opens **Settings → 📲 Phone alerts → 🗓️ Camp week**, picks the
camp week's **Sunday**, and taps **Save**. Do this once per camp (junior and
senior each have their own). Chat and director alerts don't need it.

---

## Updating the sender later

When someone gives you a newer `worker.js`:

1. Cloudflare → Workers & Pages → **camp-alerts** → **Edit code**.
2. Select all the old code, delete it, paste the new file, click **Deploy**.

The secret and the timer stay as they are. Reload the status page: the
"Sender is running" line shows the new **Version**.

## Turning alerts off

- **Pause schedule alerts and retries only:** Worker → **Settings** →
  **Trigger Events** → delete the `* * * * *` trigger. Chat and director
  alerts still work. (The status page will show ❌ for the timer — expected.)
- **Stop everything:** Worker → **Settings** → **Domains & Routes** → next to
  **workers.dev**, choose **Disable**. Phones stop getting alerts; the app
  says it can't reach the sender. Re-enable the same way.
- **Remove it for good:** Worker → **Settings** → **Delete** (at the bottom),
  and ask the site maintainer to set `PUSH_SERVICE_URL` back to `''` so the
  Phone alerts screen goes back to "coming soon".

## Replacing the database key

If the key may have leaked, or you deleted it in Google:

1. Do **step 3** again to download a new key.
2. Cloudflare → camp-alerts → **Settings** → **Variables and Secrets** → click
   **Edit** (pencil) next to `FIREBASE_SERVICE_ACCOUNT`, paste the new file's
   contents, **Deploy**. Delete the downloaded file.
3. To cancel the old key: Firebase → **Project settings** → **Service
   accounts** → **Manage service account permissions** (opens Google Cloud) →
   click the **firebase-adminsdk** account → **Keys** tab → delete the older
   key (check its date).
4. Reload the status page — it should be all ✅.

---

## Troubleshooting

Find the line the status page shows, then do what the right-hand column says.

| What you see | What it means | What to do |
|---|---|---|
| The page won't load, or Cloudflare says there's nothing here | The Worker isn't deployed, or its address is switched off | Do **step 2** again (paste + **Deploy**). If that doesn't help: Worker → Settings → Domains & Routes → **workers.dev** → **Enable**. |
| "Error 1101" or "Worker threw exception" | Part of the code is missing | Do **step 2** again, copying the *whole* `worker.js`. |
| ❌ Not connected to Firebase — the key secret is missing | Step 4 hasn't been done (or the name is misspelled) | Do **step 4**. The name must be exactly `FIREBASE_SERVICE_ACCOUNT`. |
| ❌ … the key secret isn't a complete key file | Only part of the file was pasted | Edit the secret and paste the **entire** file, from the first `{` to the last `}`. |
| ❌ … the key secret isn't a Firebase service-account key | A different file was pasted | Do **step 3** again and paste *that* file. |
| ❌ … that key is for a different project ("…") | The key came from another Firebase project | Do **step 3** inside the **camp-89cea** project. |
| ❌ … Google refused the key (…) | The key was deleted, disabled, or replaced by a newer one | Do **step 3** and **step 4** again with a fresh key. |
| ❌ Firebase refused the sender (HTTP 401 / 403) | The key has no access to the camp database | Make sure the key came from the **camp-89cea** project's **Service accounts** tab, then step 4 again. |
| ❌ The Firebase database address is wrong | Someone added a `FIREBASE_DB_URL` setting | Remove the `FIREBASE_DB_URL` variable (the built-in address is correct). |
| ❌ The saved sender key in Firebase is damaged | `pushServer/vapid` in the database was edited by hand | Firebase → **Realtime Database** → **Data** → delete **pushServer → vapid**. A new one is made automatically, but **everyone must turn phone alerts on again** in the app. |
| ❌ Couldn't reach Google just now · ❌ Couldn't reach the Firebase database · ❌ The sender was too busy to finish the check | A temporary hiccup somewhere on the internet | Reload the page in a minute. Nothing to fix unless it stays that way for an hour. |
| ❌ Something unexpected went wrong | A problem the page doesn't recognize | Reload in a minute; if it stays, send a screenshot of the page to the site maintainer. |
| ❌ The schedule timer has never run | Step 5 is missing | Do **step 5**, wait two minutes, reload. |
| ❌ Schedule timer last ran *N* minutes ago | The timer was removed or the Worker was disabled | Check **Trigger Events** still lists `* * * * *` (step 5). |
| ⚠️ … web.push.apple.com refused a notification (HTTP 403) | Apple didn't accept the sender's signature | If you added a `VAPID_SUBJECT` setting, it must start with `https://` or `mailto:` — or remove it. Otherwise send a screenshot to the site maintainer. |
| ⚠️ … refused a notification (HTTP 400 / 413) | One message couldn't be delivered | Usually a one-off. If it keeps appearing, send a screenshot to the site maintainer. |
| Everything is ✅ but a phone gets nothing | The phone itself isn't set up | On an **iPhone**: it needs iOS 16.4 or newer, and the camp site must be opened from its **Home Screen icon** (Share ⬆️ → **Add to Home Screen**), with notifications allowed. On any phone: open **📲 Phone alerts** in the app and tap **Send me a test**. |
| Alerts arrive, but some phones only get them a minute or two late on busy moments | Many phones at once — the sender works through them 20 at a time | Normal. Nothing to fix. |
| One person's older phone stopped getting alerts after they set up several | Each person's **four most recently set-up** phones get alerts; older ones are tidied away within the hour | On that phone: **📲 Phone alerts** → turn them on again. |
| Someone was mentioned in chat but their phone didn't say "mentioned you" | The sender only treats it as a mention if the message itself contains their name (or first name) or their team's name (or a distinctive word of it, like "Maples") | Nothing to fix — spell the name the way it appears in the Members list. |
| Cloudflare's **Logs** mention "Exceeded CPU" | Runs are doing too much at once | Worker → Settings → Variables and Secrets → **+ Add** → Type **Text**, name `PUSH_BATCH`, value `10` → **Deploy**. |

---

## Settings you can change (optional)

All of these have sensible built-in values. Add one only if you need to:
Worker → **Settings** → **Variables and Secrets** → **+ Add** → Type **Text**.

| Name | Built-in value | What it's for |
|---|---|---|
| `FIREBASE_DB_URL` | `https://camp-89cea-default-rtdb.firebaseio.com` | The camp database's address. |
| `FIREBASE_PROJECT_ID` | `camp-89cea` | The Firebase project people sign in to. |
| `ALLOWED_ORIGINS` | `https://camp.patricksimpson.info` | Which website may talk to the sender (comma-separated). |
| `VAPID_SUBJECT` | `https://camp.patricksimpson.info` | A contact address push services may use. Must start with `https://` or `mailto:`. |
| `PUSH_BATCH` | `20` | Phones alerted per run (1–40). Lower it if logs say "Exceeded CPU". |

**For developers only:** `DB_ADMIN_TOKEN` and `JWKS_URL` exist for testing
against the Firebase emulator on your own computer. They are **ignored** unless
`FIREBASE_DB_URL` is a plain `http://` address on `127.0.0.1` or `localhost`
(the check is made on the database address the Worker actually ends up using,
so a malformed value can't switch them on), and setting them on the real
Worker does nothing.

---

## For the site maintainer

- **Where things live.** The sender keeps its private state in the database
  under `pushServer/` (outside both camp roots; the security rules give clients
  no access, and the Worker uses admin access). `pushServer/vapid` is the
  sender's signing key — **never delete it** casually: every phone would have
  to turn alerts on again. Per-camp data the app reads/writes: `push/`,
  `pushSchedule`, `pushAlerts`.
- **Endpoints.** `GET /` status page · `GET /health` (JSON, for the app's
  director status line) · `GET /vapid-key` · `POST /notify` (Firebase ID token
  required) · `POST /drain` · `POST /resubscribe`. Errors are always
  `{ ok: false, error, message }` with a plain-English `message`.
- **Free-plan budget.** Every network call goes through one counter capped at
  45 per run (the plan allows 50), and each run sends at most `PUSH_BATCH`
  notifications; the rest go to `pushServer/outbox` and are sent by
  `POST /drain` (the app calls it right away) or by the timer.
- **Abuse limits** (each exists because a signed-in member — or, for
  `/resubscribe`, anyone — could otherwise burn the free plan's budget):
  - A phone is only ever sent to if its address is on a real push service
    (`google.com`, `googleapis.com`, `push.services.mozilla.com`,
    `push.apple.com`, `notify.windows.com`; loopback only in the developer
    test mode above). Anything else is skipped, never contacted. A new push
    service would need adding to `PUSH_HOST_SUFFIXES` in `worker.js`.
  - Redirects are never followed (a 3xx is a failed delivery), a push service
    that doesn't answer is given up on after 8 seconds (treated as a temporary
    failure and retried), and nothing a push service says is shown on the
    status page.
  - Only each person's **four newest phones** are alerted; the hourly tidy-up
    deletes older ones (200 records at most per pass).
  - `/resubscribe` (no sign-in) does one scan of the phone lists per minute for
    the whole Worker; a phone that loses its turn repairs itself the next time
    the app is opened.
  - Who a chat message mentions is re-checked against the message's own text,
    at most 10 people and 3 teams; whatever the page claimed is only a hint.
  - If Google refuses the key, the Worker asks once per run (and not again for
    a minute) instead of on every database call.
- **Deploying from a terminal instead** (optional): `cd push-worker`,
  `npx wrangler deploy`, then
  `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < key.json`. See
  `wrangler.toml`.
- **Tests:** `node tests/run.js push-worker` (no network, no dependencies).
  When you change `worker.js`, bump `VERSION` at its top so the status page
  shows which copy is deployed.
