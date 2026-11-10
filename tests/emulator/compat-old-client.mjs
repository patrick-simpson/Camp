// OLD CLIENT x R1 RULES (setup-rebuild-spec §8.5, first row; §8.8 compat-old-client.mjs): every write a
// v183..v196 client makes must still be accepted, unchanged, once R1 is published — a phone that has not
// reloaded yet keeps scoring. The write set below is the client's real traffic, built from the real
// defaults (defaultConfig(), the camps' team lists), and is replayed against BOTH rulesets: the
// published pre-R1 file and the R1 file, for both camps. SAFE only when the two agree, case by case,
// and every write is accepted.
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, ED, VW, ref, set, update, remove, TS, outcome } from './lib.mjs';
import { loadCamp } from './camp-data.mjs';

const clean = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v === undefined ? null : v)));
const PUSH_KEY = 'BNcRdreALRFXTkOOUHEg3pZ9Qs0R5nLwG2jHj0kOxoWQAEXr5XxZpQvK7f4yD8aTfPqRnLwU3kVb2sEoCzMhJxY';

async function replay(label, rules) {
  const h = await harness('old-' + label, rules);
  await h.members();
  const res = {};
  for (const R of ROOTS) {
    const { camp, config } = loadCamp(R === 'campScoreboard' ? 'junior' : 'senior');
    const teams = camp.defaultTeamNames.map((name, i) => ({ id: 't' + i, name, counselor: camp.defaultCounselors[i] || '' }));
    const ed = h.as(ED), vw = h.as(VW);
    const op = async (name, fn) => { res[`${R}: ${name}`] = await outcome(fn); };
    const iso = '2026-11-02T19:00:00.000Z';
    const game = config.games[0].id;

    // state: the synced keys (editors), per path and as one multi-path update, as pushState sends them
    await op('state: whole teams array', () => set(ref(ed, `${R}/state/teams`), teams));
    await op('state: one team field', () => set(ref(ed, `${R}/state/teams/1/name`), 'Renamed'));
    await op('state: one team field cleared (null)', () => set(ref(ed, `${R}/state/teams/1/counselor`), null));
    await op('state: multi-path diff push (results, bonuses, meta, live, clocks, drafts, notice, announcements, picSetup)', () => update(ref(ed, `${R}/state`), clean({
      [`results/${game}`]: { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: iso },
      'bonuses/b1': { teamId: 't0', category: 'verse', label: 'Memorized', points: 5, at: iso },
      'meta/lastDataChangeAt': iso,
      'meta/hiddenCards/chat': true,
      [`live/${game}`]: { key: 'm1', inning: 1, hr: 0 },
      [`clocks/${game}`]: { running: true, endAt: Date.now() + 60000, duration: 60000 },
      [`drafts/${game}/scores/t0`]: 3,
      'notice': { status: 'draft', heading: 'Cleanup', zones: { t0: 'Cabin 1' } },
      'announcements/a1': { id: 'a1', text: 'Lunch is ready', at: iso, by: 'Ed', ttlMs: 3600000 },
      [`picSetup/${game}`]: { source: 'numbered', words: [] },
      [`brackets/${game}`]: { phase: 'round1', round1: [], pool: [], matches: [] },
      [`picRounds/${game}`]: { r1: { winner: 't0' } },
    })));
    await op('state: a viewer cannot write (unchanged)', () => set(ref(vw, `${R}/state/meta/lastDataChangeAt`), iso));

    // config: the whole-node set() the builder pushes
    await op('config: whole-node set of the default week', () => set(ref(ed, `${R}/config`), clean(Object.assign({}, config, { updatedAt: iso }))));

    // members, presence, changelog
    const rec = (role) => ({ role, name: 'Newbie', teamId: 't1', addedBy: 'ed@x.com', addedAt: iso });
    await op('members: an editor adds a viewer, promotes, removes', async () => {
      await set(ref(ed, `${R}/members/newbie@x,com`), rec('viewer'));
      await set(ref(ed, `${R}/members/newbie@x,com/role`), 'editor');
      await remove(ref(ed, `${R}/members/newbie@x,com`));
    });
    await op('members: a pending (no sign-in yet) row', () => set(ref(ed, `${R}/members/pending-jo-k3f9`), { role: 'viewer', name: 'Jo', addedBy: 'ed', addedAt: iso }));
    await op('presence: {at} under my own key', () => set(ref(vw, `${R}/presence/${VW.key}/dev12345abcd`), { at: TS() }));
    await op('changelog: a point-history entry', () => set(ref(ed, `${R}/changelog/e1`), { at: iso, teamId: 't0', team: 'Foxes', delta: 5, before: 10, after: 15, reason: 'Verse', by: 'Ed', byKey: ED.key }));

    // chat: one atomic update carrying the message and the rate stamp (the client's real shape)
    await op('chat: a message + the chatRate stamp, as one update (viewer)', () => update(ref(vw, R), {
      'chat/general/m1': { at: TS(), byKey: VW.key, name: 'Vw', text: 'hello camp' },
      [`chatRate/${VW.key}`]: TS(),
    }));

    // push: a device record and the published week
    await op('push: a device record under my own key', () => set(ref(vw, `${R}/push/${VW.key}/dev12345abcd`), {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: PUSH_KEY.slice(0, 87), auth: 'AbCdEfGhIjKlMnOpQrSt', at: TS(), label: 'My phone', team: 't1',
      prefs: { ch: { announcements: true, general: false, memes: false, photos: false }, mention: true, director: true, blocksAll: false, lead: 10, blocks: { breakfast: true } },
    }));
    await op('pushSchedule: an editor publishes the week (no rev, no src)', () => set(ref(ed, `${R}/pushSchedule`), {
      weekStart: '2027-07-18', at: TS(), by: 'Ed',
      blocks: { 'mon-b1': { dow: 1, start: 480, label: 'Breakfast', emoji: '🍳', key: 'breakfast' } },
    }));
  }
  await h.done();
  return res;
}

const s = suite('compat-old-client — a v183..v196 client against the R1 rules');
const before = await replay('pre', OLD_RULES);
const after = await replay('r1', NEW_RULES);
const names = Object.keys(before);
await s.t(`the write set is non-trivial (${names.length} operations, both camps)`, async () => { if (names.length < 26) throw new Error('replay lost operations'); });
for (const name of names) {
  await s.t(name + `  [pre-R1: ${before[name]}  R1: ${after[name]}]`, async () => {
    if (before[name] !== after[name]) throw new Error(`behaviour changed: pre-R1 ${before[name]} -> R1 ${after[name]}`);
    const want = name.includes('cannot write') ? 'denied' : 'ok';  // the one negative control: a viewer is refused under both
    if (before[name] !== want) throw new Error(`expected ${want} even before R1, got ${before[name]}`);
  });
}
s.finish();
