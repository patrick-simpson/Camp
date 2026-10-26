# Reliability verification results (Sonnet adversarial verifiers)

Each batch = one verifier. "real" = confirmed against the current tree with a
reproduction. Fix = the verifier's recommended change. Status column tracks
what we did with it.

## G4 — auth / members / rules (reported 6:15 PM ET Mon)

| id | real | sev | fix (short) | status |
|---|---|---|---|---|
| auth#1 | ✅ | med | Clear `sessionStorage[CAMP_SWITCH_TRIED_KEY]` in onMemberSnapshot's APPROVED branch (and finishSignOut). NOT in clearLocalData (denyMemberFinal calls it). Test: bounce → approve → sign out → deny ⇒ bounces again. | todo |
| auth#2 | ✅ | med | Members add handler: refuse own key; write only camps where the key is ABSENT ("already on the list — change access on their row" if none). convertPendingMember: refuse if newKey exists in active camp or is self. | todo |
| auth#4 | ✅ | low | startAuth: treat `typeof firebase.database !== 'function'` as no-Firebase → setMemberRole(null) + visible "Couldn't load sync — tap to reload". handleAuthUser catch: never denyMemberFinal/clearLocalData on an exception; show a reload-able error instead. | todo |
| auth#5 | ✅ | low | auth-email-link.js mount(): on iOS standalone (`navigator.standalone === true`) show "Email links open in Safari, not this Home Screen app — use Google or phone sign-in here." Soften success text. | todo |
| auth#6 | ✅ | low | TV page denied overlay: "Use a different account" button → firebase.auth().signOut(); Google provider `setCustomParameters({prompt:'select_account'})` (main app too, app.js ~7617). Bump TV_BUILD. | todo |
| rules#4 | ✅ | low | recordPointHistory: clamp reason ≤ 500 ("; … +N more"), team ≤ 60, by ≤ 80. | todo |
| rules#5 | ✅ | low | Owner row controls the rules always refuse → DEFER to Project 2 (members rebuild): treat OWNER key like self in the drawer. | deferred → Project 2 |
| rules#2 = scoring#5 | ✅ | med | applyRemoteConfig: set `remoteJustApplied = true` right before its renderAll() so a remote config change doesn't log changelog entries under every online editor's name. Test in sync.test.js. | todo |

## G6 — TV page / shell (reported ~6:17 PM ET Mon)

| id | real | sev | fix (short) | status |
|---|---|---|---|---|
| pages#1 | ✅ | med | If vendor/jelly.js fails (always on iOS < 16.4: static blocks + attachInternals), every jelly-button incl. Google sign-in stays `visibility:hidden`. (1) styles.css:130 → `:where(html:not(.jelly-failed)) :not(:defined){visibility:hidden}` (MUST be :where — plain form breaks pre-upgrade fallbacks) + `html.jelly-failed jelly-button:not(:defined){display:inline-block;padding:.7em 1.2em;border:1px solid currentColor;border-radius:12px;cursor:pointer;text-align:center}` (+ [block] variant, + collapsible body display:block). (2) boot-guard.js, SEPARATE IIFE: script error listener on vendor/jelly.js, window error listener matching /jelly\.js/, ~4 s timer checking customElements.get('jelly-button') → add `jelly-failed` class (remove on define). Do NOT rewrite jelly.js for iOS 15. | todo |
| pages#2 | ✅ | med | TV page: click on sign-in button starts the reveal with no data → blank. Guards: click handler `if (!haveData \|\| e.target.closest('.topbar, #auth-overlay')) return;`; keydown `if (!haveData \|\| overlay visible) return;` BEFORE preventDefault; beginReveal `if (!liveGroups \|\| !liveGroups.length) return;`. Bump TV_BUILD. | todo |
| pages#3 | ✅ | low | TV .on() listeners have no cancel callback → frozen standings after revocation. Add cancel cb → denied overlay + reload in 5 s. | deferred → Project 2 (TV both camps) unless trivial |
| pages#5 | ✅ | low | TV counts orphaned results the app ignores. liveGameIds filter in computeStandings (null-guarded). | deferred → Project 2 |
| pages#6 | ✅ | low | TV treats phone accounts as signed out; mirror identityKey. | deferred → Project 2 |
| pages#7 | ❌ | — | Already fixed by the push merge (sw.js isApp filter). | n/a |
