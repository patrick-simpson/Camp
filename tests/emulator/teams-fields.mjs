// state/teams branding fields and `<root>/teamPhotos` under R1 (setup-rebuild-spec §8.8 teams-fields.mjs).
// The rule that matters most is the one that ISN'T there: a v183 client's whole-`teams` array (id, name,
// counselor — none of the new fields) must keep being accepted. The new optional fields are validated so
// a hostile value can never reach markup or an <img src> (sec-F3).
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, ED, VW, NOBODY, ref, set, get, remove, assertFails, assertSucceeds, outcome, bigPng } from './lib.mjs';
import { loadCamp } from './camp-data.mjs';

const s = suite('teams — branding fields and team photos');
const h = await harness('teams', NEW_RULES);
await h.members();
const ed = () => h.as(ED), vw = () => h.as(VW);
const teamsOf = (id) => {
  const { camp } = loadCamp(id);
  return camp.defaultTeamNames.map((name, i) => ({ id: 't' + i, name, counselor: 'Someone' }));
};

for (const R of ROOTS) {
  const T = (p) => `${R}/state/teams/${p}`;
  const arr = teamsOf(R === 'campScoreboard' ? 'junior' : 'senior');

  await s.t(`${R}: a v183 whole-teams array (id, name, counselor) is accepted — under the new rules, as before`, async () => {
    await assertSucceeds(set(ref(ed(), `${R}/state/teams`), arr));
    await assertSucceeds(set(ref(ed(), T('0/name')), 'Renamed Team'));                  // per-field, as the client writes it
    await assertSucceeds(set(ref(ed(), T('0/counselor')), 'Brody & Cam'));
  });

  await s.t(`${R}: the new optional fields accept honest values (emoji, short, color, photoV) — and a whole array carrying them`, async () => {
    await assertSucceeds(set(ref(ed(), T('0/emoji')), '🦊'));
    await assertSucceeds(set(ref(ed(), T('0/short')), 'Foxes'));
    await assertSucceeds(set(ref(ed(), T('0/color')), 'tangerine'));
    await assertSucceeds(set(ref(ed(), T('0/photoV')), 3));
    await assertSucceeds(set(ref(ed(), `${R}/state/teams`), arr.map((t, i) => Object.assign({}, t, { emoji: '🍁', short: 'Team ' + i, color: 'red', photoV: 0 }))));
  });

  await s.t(`${R}: markup in emoji, a quote, an oversized short, and a quote-breakout color are refused`, async () => {
    await assertFails(set(ref(ed(), T('0/emoji')), '<img src=x onerror=alert(1)>'));
    await assertFails(set(ref(ed(), T('0/emoji')), '"onmouseover="x'));
    await assertFails(set(ref(ed(), T('0/emoji')), "'onfocus='x"));
    await assertFails(set(ref(ed(), T('0/emoji')), '&amp;'));
    await assertFails(set(ref(ed(), T('0/emoji')), ''));
    await assertFails(set(ref(ed(), T('0/short')), 'x'.repeat(5000)));
    await assertFails(set(ref(ed(), T('0/short')), '<b>Foxes</b>'));
    await assertFails(set(ref(ed(), T('0/color')), 'red" onerror="x'));
    await assertFails(set(ref(ed(), T('0/color')), 'RED'));
    await assertFails(set(ref(ed(), T('0/color')), 'x'));
    await assertFails(set(ref(ed(), T('0/photoV')), -1));
    await assertFails(set(ref(ed(), T('0/photoV')), 'one'));
    await assertFails(set(ref(ed(), `${R}/state/teams`), arr.map((t) => Object.assign({}, t, { emoji: '<script>' }))));
  });

  await s.t(`${R}: a viewer can't write a team field`, async () => {
    await assertFails(set(ref(vw(), T('0/emoji')), '🦊'));
    await assertFails(set(ref(vw(), T('0/name')), 'x'));
  });

  // ── photos ──
  await s.t(`${R}: a team photo accepts a 100,000-char valid PNG data URL (the regex at its cap) and a JPEG`, async () => {
    await assertSucceeds(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 1, data: bigPng(100000) }));
    await assertSucceeds(set(ref(ed(), `${R}/teamPhotos/t1`), { v: 1, data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD==' }));
    await assertSucceeds(get(ref(vw(), `${R}/teamPhotos/t0/v`)));                       // counselors read crests
    await assertFails(get(ref(h.as(NOBODY), `${R}/teamPhotos/t0`)));
    await assertFails(get(ref(h.anon(), `${R}/teamPhotos`)));
  });

  await s.t(`${R}: a team photo with a quote, a space, a bad charset, a wrong type, or over 100,000 chars is refused`, async () => {
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: 'data:image/png;base64,AAAA"onerror="x' }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: 'data:image/png;base64,AAAA AAAA' }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: "data:image/png;base64,AAAA')x" }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: 'data:image/svg+xml;base64,AAAA' }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: 'https://tracker.example/pixel.png' }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: bigPng(100001) }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2 }));                    // data is required
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: -1, data: bigPng(50) }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/t0`), { v: 2, data: bigPng(50), surprise: 1 }));
    await assertFails(set(ref(ed(), `${R}/teamPhotos/team0`), { v: 2, data: bigPng(50) }));
  });

  await s.t(`${R}: a viewer can't write a team photo`, async () => {
    await assertFails(set(ref(vw(), `${R}/teamPhotos/t2`), { v: 1, data: bigPng(50) }));
  });
}

// Under the PRE-R1 rules the same hostile values go straight in — that is the hole R1 closes — while the
// honest v183 write is accepted by both: SAFE in both directions.
const old = await harness('teams-old', OLD_RULES);
await old.members();
await s.t('under the pre-R1 rules a v183 whole-teams array is accepted (the same write the new rules accept)', async () => {
  const arr = teamsOf('junior');
  await assertSucceeds(set(ref(old.as(ED), 'campScoreboard/state/teams'), arr));
});
await s.t('...and teamPhotos does not exist yet (denied), so a new client degrades to "not available yet"', async () => {
  if ((await outcome(() => set(ref(old.as(ED), 'campScoreboard/teamPhotos/t0'), { v: 1, data: bigPng(50) }))) !== 'denied') throw new Error('allowed');
});
await old.done();
await h.done();
s.finish();
