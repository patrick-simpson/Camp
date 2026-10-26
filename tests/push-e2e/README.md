# Phone-alerts end-to-end test (opt-in — needs npm, Java, openssl)

Runs the REAL `push-worker/worker.js` inside Cloudflare's runtime (`wrangler dev`,
which is workerd) against the Firebase RTDB emulator loaded with the repo's
`database.rules.json`, with ~30 fake phones on a mock HTTPS push service that
**verifies every VAPID signature and decrypts every message with node:crypto**
(an implementation independent of the Worker's WebCrypto code).

Nothing here is part of `node tests/run.js` or loaded by the browser.

```sh
cd tests/push-e2e
cp ../../database.rules.json .
npm install
# a throwaway CA so workerd trusts the mock push service on https://127.0.0.1:8443
mkdir -p tls && cd tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=e2e CA"
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout srv.key -out srv.csr -subj "/CN=127.0.0.1"
printf "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out srv.crt -days 2 -extfile ext.cnf
cat "${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" ca.crt > bundle.crt; cd ..
npx firebase emulators:start --only database --project camp-89cea &
SSL_CERT_FILE=$PWD/tls/bundle.crt npx wrangler dev --local --port 8787 --test-scheduled &
node mock-e2e.mjs
```

What it proves (2026-10-26 run: all green): announcement fan-out to 27 phones
(20 inline + a drained outbox batch), author / opted-out / removed-member
exclusion, both devices of one person, dead subscription (410) cleanup, mention
vs channel routing, not-author 403, viewer-alert 403, team audience, the test
alert's joke body, and cron schedule alerts at each phone's own lead time with no
repeat on the next tick.

`fcm-e2e.cjs` (needs a display: `xvfb-run -a node fcm-e2e.cjs`) does the same
against a REAL Chromium subscription on Google's push service — it proves FCM
accepts the Worker's VAPID-signed pushes from workerd (201). Delivery back to
the browser needs Google's MCS port, which sandboxes usually block.
