// ── Built-in default week ───────────────────────────────────────
// This file holds the built-in default week — the day list and the full
// game catalog. `defaultConfig()` is called by app.js to seed
// `state.config` on first run and whenever the user chooses "Restore
// defaults". After that point, live data lives in state, not here —
// editing this file only changes what a fresh/restored week starts with,
// not any trip that has already been configured.

function defaultConfig() {
  return {
    version: 4,
    updatedAt: new Date().toISOString(),
    sessions: ['Morning', 'Evening'],
    days: [
      { id: 'd1', name: 'Monday', dow: 1, note: '' },
      { id: 'd2', name: 'Tuesday', dow: 2, note: '' },
      { id: 'd3', name: 'Wednesday', dow: 3, note: '' },
      { id: 'd4', name: 'Thursday', dow: 4, note: '' },
      { id: 'd5', name: 'Friday', dow: 5, note: '' },
    ],
    games: [
      {
        id: 'shields', name: 'Shields', emoji: '🛡️', dayId: 'd1', session: 'Morning',
        location: 'Dining Hall', format: 'placement',
        headline: 'Every team designs a shield — judged at Monday evening service.',
        rules: [
          { h: 'Must include', items: ['Team name', 'Team crest', 'The year', "Everyone's signature"] },
          { h: 'How it works', items: [
            'Everyone on the team participates somehow — design, tracing, or coloring.',
            'Shields must be finished and ready to judge at the START of Monday evening service.',
          ] },
          { h: 'Winning', items: ['Top 3 shields take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'kangaroo-kickball', name: 'Kangaroo Kickball', emoji: '🦘', dayId: 'd1', session: 'Morning',
        location: 'Chapel Lawn', format: 'tournament',
        // Fixed Round 1 order set by the game leaders (by team id): Foxes vs
        // Pumpkins, then Turkey vs Pilgrims, then Maples vs John Deeres. When a
        // tournament game has this, Round 1 walks these matchups in order instead
        // of asking you to pick two teams each time.
        roundOneMatchups: [['t0', 't3'], ['t1', 't4'], ['t2', 't5']],
        // Live scorekeeping aid shown on each matchup (synced so everyone can
        // watch): innings, the kicking team, outs (3 per side — the first team
        // kicks, 3 outs, the second team kicks, 3 outs, then the next inning),
        // and home runs per team.
        liveTracker: { unit: 'Home runs', innings: 3, outs: 3, sideLabel: 'kicking' },
        headline: 'Kickball, but everyone is three-legged with a partner.',
        rules: [
          { h: 'How to play', items: [
            'Two teams at a time — one kicks, one fields.',
            'The pitcher rolls the ball to home plate; the kicker kicks into fair territory and runs the bases.',
            '3 outs per side, 3 innings. Most runs wins the match.',
          ] },
          { h: 'Ways to get out', items: [
            'Ball caught in the air before it touches the ground.',
            'A fielder touches the base with the ball before the runner gets there.',
            'A fielder tags the runner while holding the ball (no throwing at runners!).',
          ] },
          { h: 'The twist', items: [
            'Everyone plays 3-legged-race style with a partner.',
            'The KICKER must always be 3-legged — that part is not optional.',
            "If pairing everyone leaves positions short, use your judgment on who's partnered in the field.",
          ] },
        ],
      },
      {
        id: 'human-battleship', name: 'Human Battleship', emoji: '🚢', dayId: 'd1', session: 'Evening',
        location: 'Basketball Court', format: 'placement',
        headline: 'Wet sponges over the barrier — last 3 teams standing medal.',
        rules: [
          { h: 'Setup', items: [
            'ALL teams play at once — same number of players per team.',
            'Barrier down the middle of the court; each team splits evenly across both sides.',
            'Players sit scattered around their side.',
          ] },
          { h: 'How to play', items: [
            'Sides take turns launching water-filled sponges over the barrier (rotate sides and teams).',
            'Hit by a sponge? You are "hit and sunk" — you must lay down.',
          ] },
          { h: 'Winning', items: ['The last 3 teams with players still up take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'musical-chairs', name: 'Musical Chairs Everywhere', emoji: '🎵', dayId: 'd2', session: 'Morning',
        location: 'Chapel Lawn', format: 'tournament',
        headline: 'Field-wide musical chairs, team vs team.',
        rules: [
          { h: 'Setup', items: [
            'Two teams at a time, same number of players each.',
            'Chairs scattered all over the field — one FEWER chair than total players.',
            'Prep: Jen has the music/speaker. Use the orange tab chairs.',
          ] },
          { h: 'How to play', items: [
            'Music plays → everyone walks around among the chairs.',
            'Music stops → find a chair and sit.',
            'The camper left standing is out.',
            'In medal rounds, start pulling extra chairs each round if time is running long.',
          ] },
          { h: 'Winning', items: ['Last team with a player seated wins the match.'] },
        ],
      },
      {
        id: 'ladder-ball', name: 'Ladder Ball', emoji: '🪜', dayId: 'd2', session: 'Morning',
        location: 'Basketball Court', format: 'tournament',
        // Per-round cancellation scorer (see ladderMatchHTML): each round both
        // teams' rung points are entered, the higher cancels the lower, and the
        // winner banks the difference — first to EXACTLY 21 (overshoot holds).
        // Synced live via state.live so spectators watch each total climb.
        ladderScoring: { top: 3, mid: 2, bottom: 1, target: 21 },
        headline: 'Toss bolas onto the ladder — first to exactly 21.',
        rules: [
          { h: 'Setup', items: [
            '1 ladder ball set, 6 bolas (3 per team by color).',
            'Ladders about 15 feet apart — closer if kids are struggling.',
            'Split each team in half; half at each ladder.',
          ] },
          { h: 'Scoring', items: [
            'Top rung: 3 points · Middle: 2 · Bottom: 1.',
            'A bola only counts if it is still hanging at the end of the round.',
            'Cancellation scoring: round points cancel out — if Team A scores 5 and Team B scores 2, Team A earns 3.',
          ] },
          { h: 'How to play', items: [
            'Teams alternate turns; each team throws all 3 bolas, underhand.',
            'Score the round after both teams have thrown.',
          ] },
          { h: 'Winning', items: [
            'First team to reach EXACTLY 21 wins.',
            'Go over 21? You stay at your previous score until you land exactly on 21.',
          ] },
        ],
      },
      {
        id: 'scatterball', name: 'Scatterball', emoji: '🎯', dayId: 'd2', session: 'Evening',
        location: 'Chapel Lawn', format: 'placement',
        headline: 'Free-for-all dodgeball — last 3 teams standing medal.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams at once, spread out over the field; 4 scatterballs in the middle.',
            'On "GO", everyone races for the balls.',
            'With a ball: up to 3 giant steps plus a pivot — otherwise you cannot move.',
            'Throw at opposing players, aiming BELOW the shoulders.',
          ] },
          { h: 'Getting out (and staying in it)', items: [
            'Hit? Sit down where you are — but you can still catch, throw, and roll from your seat.',
            'Your throw gets caught out of the air? YOU are out.',
            'Your throw hits above the shoulders? YOU are out.',
          ] },
          { h: 'Winning', items: ['Last 3 teams with players standing take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'counselor-musical-chairs', name: 'Counselor Musical Chairs', emoji: '🪑', dayId: 'd2', session: 'Evening',
        location: 'Chapel Lawn', format: 'placement',
        headline: 'The counselors play musical chairs — last ones seated win their team the medals.',
        rules: [
          { h: 'Setup', items: [
            "Each team's counselor(s) play on the team's behalf.",
            'Chairs in a circle — one FEWER chair than counselors playing.',
            'Prep: Jen has the music/speaker. Use the orange tab chairs.',
          ] },
          { h: 'How to play', items: [
            'Music plays → counselors walk around the chairs.',
            'Music stops → grab a seat.',
            'The counselor left standing is out, and a chair comes out each round.',
          ] },
          { h: 'Winning', items: ['The last 3 teams with a counselor still seated take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'gross-food-eating', name: 'Gross Food Eating Competition', emoji: '🤢', dayId: 'd2', session: 'Evening',
        location: 'Dining Hall', format: 'placement',
        headline: 'Choke down the gross-food gauntlet — first teams to clear their plates medal.',
        rules: [
          { h: 'Setup', items: [
            'ALL teams play, same number of eaters per team.',
            'Each team gets an identical plate of gross foods to get through.',
            'Opposing counselors judge — a plate only counts when it is truly finished.',
          ] },
          { h: 'How to play', items: [
            'On "GO", the team works through every item on the plate.',
            'No spitting it back out — it has to go down and stay down.',
            'Water is allowed, but the clock keeps running.',
          ] },
          { h: 'Winning', items: ['The first 3 teams to finish their whole plate take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'axe-throwing', name: 'Axe Throwing', emoji: '🪓', dayId: 'd3', session: 'Morning',
        location: 'Basketball Court', format: 'tally', unit: 'points', counterSteps: [1, 5],
        headline: 'Every player throws; the team totals decide the medals.',
        rules: [
          { h: 'How to play', items: [
            'One team plays at a time, same number of players per team.',
            'Each player gets 3 turns, with 4 throws per turn.',
            'Tally every turn into one grand team total.',
          ] },
          { h: 'Winning', items: ['The 3 highest team totals take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'inflatable-bowling', name: 'Inflatable Bowling', emoji: '🎳', dayId: 'd3', session: 'Morning',
        location: 'Slip and Slide', format: 'tally', unit: 'points', counterSteps: [1, 10], liveRankings: true,
        headline: 'Four rolls each — pins are 1, strikes are 10.',
        rules: [
          { h: 'Setup', items: [
            'One team at a time, same number of players per team.',
            'Set the pins a fair distance from the ball — your call, keep it consistent.',
          ] },
          { h: 'How to play', items: [
            'Each player gets 4 rolls at the pins.',
            'Each pin knocked down = 1 point. A strike = 10 points.',
            'Add up everything for a single team total.',
          ] },
          { h: 'Winning', items: ['The 3 highest team scores take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'pumpkin-pictionary', name: 'Pumpkin Pictionary', emoji: '🎃', dayId: 'd3', session: 'Morning',
        location: 'Chapel Lawn', format: 'tally', unit: 'total time', lowerWins: true, timeInput: true, liveRankings: true,
        prompts: ['Pumpkin', 'Scarecrow', 'Ear of Corn', 'Falling Leaf', 'Apple Pie', 'Hay Bale', 'Turkey', 'Acorn', 'Sunflower', 'Tractor'],
        headline: 'Draw with your nose in pumpkin puree — fastest total time wins.',
        rules: [
          { h: 'Prep', items: ['The 10 drawing prompts are built in below — pick a team and run their round right from this page, snapping a photo of each masterpiece as you go.'] },
          { h: 'How to play', items: [
            'One team plays at a time; each team draws 10 items.',
            'The drawer dips their NOSE in pumpkin puree and draws with it on the board.',
            'New drawer every item — everyone must play.',
            'Clock starts when nose touches paper, stops when the team guesses the word.',
            'Add the 10 lap times into one team time.',
          ] },
          { h: 'Winning', items: ['The 3 FASTEST team times take gold, silver, and bronze.'] },
          { h: 'Entering times here', items: ['Type times as minutes:seconds (like 4:35) or plain seconds (like 275).'] },
        ],
      },
      {
        id: 'color-call-chaos', name: 'Color Call Chaos', emoji: '🌈', dayId: 'd3', session: 'Evening',
        location: 'Chapel Lawn', format: 'tally', unit: 'balls collected', counterSteps: [1],
        headline: 'Hungry-hungry-hippos with color calls — every ball is a point.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams play, same number of players per team.',
            'Multicolored balls scattered across the field.',
            'Leader calls a color → everyone races to collect ONLY that color, one ball at a time, back to the team bucket.',
            'New color every round; keep going until every ball is collected.',
          ] },
          { h: 'Winning', items: [
            'Every ball collected = 1 point.',
            'The 3 teams with the most balls take gold, silver, and bronze.',
          ] },
        ],
      },
      {
        id: 'color-run-cleanup', name: 'Color Run: Cleanup Edition', emoji: '🏃', dayId: 'd3', session: 'Evening',
        location: 'Campground-wide', format: 'placement',
        headline: 'Run the color course and clean up as you go — top 3 teams medal.',
        rules: [
          { h: 'Winning', items: ['The top 3 teams take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'pumpkin-painting', name: 'Pumpkin Painting', emoji: '🎃', dayId: 'd3', session: 'Evening',
        location: 'Chapel Lawn', format: 'placement',
        headline: 'Each team paints a pumpkin — judged live, top 3 take medals.',
        rules: [
          { h: 'Winning', items: ['The top 3 painted pumpkins take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'jeb-ball', name: 'Jeb Ball', emoji: '🧎', dayId: 'd4', session: 'Morning',
        location: 'Chapel Lawn', format: 'tournament',
        timer: { label: 'Half clock', presets: [600, 480, 300] },
        // Live per-team goal counter, synced for spectators. outs:0 suppresses the
        // outs/kicking rows in liveTrackerHTML, leaving just a goal stepper per team
        // and a half stepper (periodLabel renames "Inning" → "Half").
        liveTracker: { unit: 'Goals', innings: 2, outs: 0, periodLabel: 'Half' },
        headline: 'Soccer on your knees, batting the ball with your hands. MUST WEAR PANTS.',
        rules: [
          { h: 'Wear pants!', items: ['Everyone plays on their knees all game — long pants required.'] },
          { h: 'How to play', items: [
            'Two teams, same number of players; a net on either side of the field.',
            'Like soccer, but on your knees, batting the ball along with your hands.',
            'Score by getting the ball past the opposing goaltender — who is ALSO on their knees.',
            'Two 10-minute halves. Shorten if needed, just keep it consistent between matches.',
          ] },
          { h: 'Winning', items: ['Most goals wins the match.'] },
        ],
      },
      {
        id: 'waiter-water-chain', name: 'Waiter Water Chain', emoji: '💧', dayId: 'd4', session: 'Morning',
        location: 'Bathroom Lawn', format: 'tournament',
        timer: { label: 'Game clock', presets: [600] },
        headline: 'Pass the tray of water cups down the human chain until the bucket overflows.',
        rules: [
          { h: 'Setup', items: [
            'Two teams, same number of players.',
            'Full bucket on the start line, empty bucket on the finish line, one tray of cups per team.',
            'Each team lies down in a horizontal line, side by side.',
          ] },
          { h: 'How to play', items: [
            'Pass the tray of FULL water cups down the line toward the finish bucket.',
            'After you pass the tray, jump up and lie back down at the END of the line to keep the chain moving.',
            'One player (or a counselor) stands at each end to fill cups and dump them.',
            'Repeat until the finish bucket is full to overflowing.',
          ] },
          { h: 'Winning', items: ['First team to overflow their finish bucket wins — opposing counselors judge in real time.'] },
        ],
      },
      {
        id: 'counselor-hide-seek', name: 'Counselor Hide and Seek', emoji: '🔔', dayId: 'd4', session: 'Evening',
        location: 'Campground-wide', format: 'tally', unit: 'points', messtival: true,
        counterSteps: [1, 5], counterStepLabels: { 5: 'counselor' }, counterAllowNegative: true, liveRankings: true,
        timer: { label: 'Game clock (ring the bell at the alarm!)', presets: [900, 600, 1200] },
        headline: 'Hunt down hidden staff and march them to the bell for points.',
        rules: [
          { h: 'Setup', items: [
            '1–2 counselors from each team hide (at least 1 counselor stays with the team).',
            'Ancillary staff may hide too.',
            'Boundaries: waterfront and within the road — NO ballfield, NO girls/boys cabin areas.',
          ] },
          { h: 'Scoring', items: [
            'Counselor found = 5 points.',
            'Ancillary staff found = 10 points.',
            'Some staff are worth NEGATIVE points — campers never know who is worth what.',
          ] },
          { h: 'How to play', items: [
            'Find a hider, bring them to the bell, then head out for the next one.',
            'Teams must stay together the whole time.',
            'Points are tallied as the game goes; it ends when the bell rings.',
          ] },
          { h: 'Winning', items: ['The 3 teams with the most points take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'bushel-bustle', name: 'Bushel Bustle', emoji: '🌽', dayId: 'd5', session: 'Morning',
        location: 'Chapel Lawn', format: 'placement', messtival: true,
        headline: 'Shuck 20 ears of corn clean enough to eat.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams play, same number of players per team.',
            'Each team gets 20 ears of corn and an empty kettle.',
            'Together, shuck every ear until it is clean enough to eat — opposing counselors judge in real time.',
          ] },
          { h: 'Winning', items: ['First 3 teams with all 20 ears shucked clean take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'pumpkin-patch-plunder', name: 'Pumpkin Patch Plunder', emoji: '🍬', dayId: 'd5', session: 'Morning',
        location: 'Chapel Lawn', format: 'tally', unit: 'candy corn', messtival: true,
        counterSteps: [1], timer: { label: 'Round timer', presets: [60], rounds: 6 },
        headline: 'Fish candy corn out of pumpkin puree — with your mouth.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams play, 6 players per team.',
            'Each player gets a pie plate of pumpkin puree with candy corn hidden inside.',
            '6 rounds, 1 minute each: mouths only, fish out candy corn and drop it in the empty bowl.',
          ] },
          { h: 'Winning', items: ['The 3 teams with the most candy corn after 6 rounds take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'bob-drop-roll', name: 'Bob, Drop, and Roll', emoji: '🍎', dayId: 'd5', session: 'Morning',
        location: 'Chapel Lawn', format: 'placement', messtival: true,
        headline: 'Bob an apple, sprint it across the field, barrel roll home.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams play, 6 players per team, relay style.',
            'Each player: bob for your apple, then run it — apple in mouth — across the field and drop it in the bucket.',
            'Drop the apple anywhere else? Run it back, dunk it back in the water, start your leg over.',
            'After the bucket drop, barrel roll back to the start line and tag the next teammate.',
          ] },
          { h: 'Winning', items: ['First 3 teams to get all 6 players through take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'cider-survivor', name: 'Cider Survivor', emoji: '🥤', dayId: 'd5', session: 'Morning',
        location: 'Chapel Lawn', format: 'placement', messtival: true,
        headline: 'Relay chug — six cups of cider, six flavors, sit when done.',
        rules: [
          { h: 'How to play', items: [
            'ALL teams play at once, 6 players per team, each with a cup of cider (6 flavors!).',
            'First player drinks as fast as they can, then tags the next in line.',
            'When YOUR cup is done: SIT DOWN.',
          ] },
          { h: 'Winning', items: ['First 3 teams with all 6 cups finished and the whole team seated take gold, silver, and bronze.'] },
        ],
      },
      {
        id: 'team-skits', name: 'Team Skits', emoji: '🎭', dayId: 'd5', session: 'Evening',
        location: 'Tabernacle', format: 'placement', messtival: true,
        headline: 'Each team performs their skit — judged live, top 3 take medals.',
        rules: [
          { h: 'How it works', items: [
            'Each team performs the skit they prepared during the week.',
            'Everyone on the team takes part somehow.',
            'Judges score each skit right after it finishes.',
          ] },
          { h: 'Winning', items: ['The top 3 skits take gold, silver, and bronze — counted in the week standings like every other game.'] },
        ],
      },
    ],
  };
}
