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
cp ../../database.rules.json .          # test the real ruleset
npm install                             # ~1 min, downloads the emulator jar
npx firebase emulators:start --only database --project camp-test &
npm test
```

`run.mjs` — the boundary as documented: strangers and non-members get nothing,
viewers read but can't write, unverified emails don't count, the owner record
is untouchable, the two camps can't reach each other, chat is identity-bound
and create-or-delete only, images must be inline `data:` URLs, timestamps are
bounded (the app-freeze fix), the changelog is sealed.

`rate.mjs` — the per-writer rate limit: a flood is refused, a second member is
unaffected, the stamp can't be backdated or written for someone else, deletes
are never throttled, and a photo send still works as one atomic update.

`fallback.mjs` — deploy-order safety. Compares the published ruleset against
the repo one and proves chat works under **both**, which is what lets the
client ship before the console paste.

## The thing to remember

These run against the file. The console is what enforces. After every paste,
still run the unauthenticated probes from the runbook against the live database.
