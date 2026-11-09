# R2 rules publish runbook (big-screen branding, owner's decisions item 7)

Who: the owner, in Google Cloud Shell (gcloud already signed in). What: replace the live database rules with the
file in the repo, `database.rules.json`. It adds ONE thing to what is live now (R1): three optional fields
(`em`, `pl`, `ph`) in a place the directors have already SHOWN, under `revealPublic`. Nothing else changes and
nothing anonymous becomes writable.

The file to publish: **sha256 prefix `e0d3edd5`, 163,109 bytes** (limit 262,144). The R1 file that is live now
has prefix `ccf2e5d3` (kept in the repo as `tests/emulator/r1.rules.json`). Paste the blocks below one at a
time. No block contains a token: `gcloud` supplies it.

Nothing changes for anyone until the later deploy that flips `REVEAL_BRANDING_LIVE`, so publishing early or late
is safe. A phone with the switch on that meets the old rules sends its place plain after one refusal.

## Block 1: BACKUP and download

```sh
DB=https://camp-89cea-default-rtdb.firebaseio.com
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" "$DB/.settings/rules.json" > rules-backup-$(date +%F-%H%M).json
ls -l rules-backup-*.json
curl -s -o rules.json "https://camp.patricksimpson.info/database.rules.json?cb=$(date +%s)"
sha256sum rules.json | cut -c1-8
wc -c rules.json
```

Expect: the backup file is about 130,000 to 165,000 bytes (never 0, and its first characters are `{"rules"` or
`{`, not the word `error`); then `e0d3edd5` and `163109 rules.json`. If the prefix differs, STOP: the site has
not finished updating. Wait ten minutes and paste block 1 again. Keep the backup file: it is the rollback.

## Block 2: PUBLISH (only if the prefix was `e0d3edd5`)

```sh
EXPECT=e0d3edd5
[ "$(sha256sum rules.json | cut -c1-8)" = "$EXPECT" ] && \
  curl -s -X PUT -H "Authorization: Bearer $TOKEN" --data-binary @rules.json "$DB/.settings/rules.json"
```

Expect: the rules text printed back (a long JSON block starting `{"rules"`), no word `error`. If it says
"too large" or any error, the old rules stay live and nothing breaks: stop and tell the agent. If nothing is
printed at all, the prefix did not match: go back to block 1.

## Block 3: READ BACK

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$DB/.settings/rules.json" > rules-live.json
python3 -c "import json;print('RULES MATCH' if json.load(open('rules.json'))==json.load(open('rules-live.json')) else 'RULES DIFFER')"
```

Expect `RULES MATCH`. On `RULES DIFFER`, do the ROLLBACK below.

## Block 4: PROBES (no sign-in)

```sh
for r in campScoreboard seniorScoreboard; do
  printf '%s revealPublic (null or data): ' $r; curl -s "$DB/$r/revealPublic.json"; echo
  for p in state config members setup campers revealFull chat; do
    printf '%s/%s (Permission denied): ' $r $p; curl -s "$DB/$r/$p.json"; echo
  done
  printf '%s anonymous PUT to revealPublic (Permission denied): ' $r
  curl -s -X PUT -d '{"ctl":{"v":1}}' "$DB/$r/revealPublic/real.json"; echo
  printf '%s anonymous PUT of a branding field (Permission denied): ' $r
  curl -s -X PUT -d '"x"' "$DB/$r/revealPublic/real/pub/g0/e/t0/em.json"; echo
done
```

Expect, for each of the two camps: the `revealPublic` read says `null` (no reveal is running) or shows reveal
data; every other line says `{"error" : "Permission denied"}`, including both writes. Anything else
(for example data from `state` or `members`): do the ROLLBACK at once and tell the agent.

## ROLLBACK (only if something is wrong)

```sh
curl -s -X PUT -H "Authorization: Bearer $TOKEN" --data-binary @"$(ls -t rules-backup-*.json | head -1)" "$DB/.settings/rules.json"
```

R2 only adds optional fields, so going back loses nothing; the app then sends places plain.

## Then

Tell the agent "R2 is published and read back" and paste the block 3 and block 4 results.

## The kill switch (unchanged)

If the usage graph ever shows polling of `revealPublic`, change `revealPublic/.read` from `true` to the member
expression (`setup/.read` spells it out) in both camps and publish the same way (CLAUDE.md, R1 notes, block 5 of
the old runbook). The big screen then shows Waiting; phones and remotes carry on.
