# R2 rules publish runbook (big-screen branding, owner's decisions item 7)

Who: the owner, from Google Cloud Shell (gcloud already signed in). What: replace the live rules (R1) with the file
in the repo, `database.rules.json`, which adds ONE thing: three optional fields (`em`, `pl`, `ph`) in a SHOWN
place's entry under `revealPublic`. Nothing else changes. Nothing anonymous becomes writable.

Until the switch (`REVEAL_BRANDING_LIVE` in reveal.js) is flipped by a later deploy, no phone writes any of the new
fields, so publishing early or late changes nothing anyone sees. A phone with the switch on that meets the old rules
sends its place plain after one refusal (proved in `tests/emulator/reveal-client.mjs`), so the order does not matter.

The file's hash prefix is in the commit message that carries it. Recompute it any time:
`sha256sum database.rules.json | cut -c1-8`. The R1 file that is live now has the prefix `ccf2e5d3`
(kept as `tests/emulator/r1.rules.json`).

## 1. Back up the live rules, and look at what is live

```sh
cd ~
curl -s -o rules-before-r2.json "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json?access_token=$(gcloud auth print-access-token)"
sha256sum rules-before-r2.json | cut -c1-8      # not the file's hash: the console re-formats; compare in step 3
wc -c rules-before-r2.json
```

Keep `rules-before-r2.json`: it is the rollback.

## 2. Fetch the new file and check it, then publish

```sh
curl -s -o rules-r2.json https://camp.patricksimpson.info/database.rules.json
sha256sum rules-r2.json | cut -c1-8             # must equal the prefix in the commit message
wc -c rules-r2.json                             # about 163,000 bytes (the limit is 262,144)
curl -X PUT -H "Authorization: Bearer $(gcloud auth print-access-token)" --data-binary @rules-r2.json \
  "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json"
```

A refusal for size leaves the old rules live (nothing breaks): stop and say so.

## 3. Read back and compare

```sh
curl -s "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json?access_token=$(gcloud auth print-access-token)" > rules-live.json
python3 - <<'PY'
import json
a=json.load(open('rules-r2.json')); b=json.load(open('rules-live.json'))
print('RULES MATCH' if a==b else 'DIFFERENT - do not trust it; roll back (step 5)')
PY
```

## 4. The probes (no sign-in needed; every line is expected)

```sh
for R in campScoreboard seniorScoreboard; do
  echo "$R revealPublic (expect null):"; curl -s "https://camp-89cea-default-rtdb.firebaseio.com/$R/revealPublic.json"; echo
  for p in revealFull state config members chat setup campers; do
    printf "%s/%s (expect Permission denied): " $R $p; curl -s "https://camp-89cea-default-rtdb.firebaseio.com/$R/$p.json"; echo
  done
  printf "%s anonymous write (expect Permission denied): " $R
  curl -s -X PUT -d '"x"' "https://camp-89cea-default-rtdb.firebaseio.com/$R/revealPublic/real/pub/g0/e/t0/em.json"; echo
done
```

Expected: `null` for both `revealPublic` reads, `Permission denied` for everything else including the write.

## 5. Roll back (only if something is wrong)

```sh
curl -X PUT -H "Authorization: Bearer $(gcloud auth print-access-token)" --data-binary @rules-before-r2.json \
  "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json"
```

R2 is additive, so a rollback loses nothing; the client then sends places plain.

## 6. Tell the agent

Say "R2 is published and read back". The next deploy flips `REVEAL_BRANDING_LIVE = true` and adds the What's new
note. Then run a Practice on the real big screen and check a team's picked colour, emoji and photo, and a cleared
team's number tile, appear as each place is shown.

## The kill switch (unchanged)

If the connections or download graph ever shows polling, change `revealPublic/.read` from `true` to the member
expression (`setup/.read` spells it out) and publish the same way. The big screen then shows Waiting; phones and
remotes carry on. A script reading the public node once a second all night with six photos would use about 5 GB of
Spark's 10 GB a month; that is the case to watch for.
