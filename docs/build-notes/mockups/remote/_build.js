// Generates the static remote mockups (HTML + PNG). Scratch tooling, not shipped.
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const SH = 'file:///home/user/Camp/images/team-shields/';

const T = {
  t0: { name: 'Ferocious Foxes', abbr: 'Foxes', img: 'ferocious-foxes.webp', accent: '#e2672b' },
  t1: { name: 'Turkey Dinner', abbr: 'Turkey', img: 'turkey-dinner.webp', accent: '#9c6420' },
  t2: { name: 'Methodic Mediocre Maples', abbr: 'Maples', img: 'methodic-mediocre-maples.webp', accent: '#c23b22' },
  t3: { name: 'Particularly Perilous Pumpkins', abbr: 'Pumpkins', img: 'particularly-perilous-pumpkins.webp', accent: '#e07d10' },
  t4: { name: 'Patriotic Pilgrims', abbr: 'Pilgrims', img: 'patriotic-pilgrims.webp', accent: '#345b96' },
  t5: { name: 'Runaway John Deersz', abbr: 'John Deersz', img: 'runaway-john-deeres.webp', accent: '#3a7d34' },
};
// place -> team, points, medals (gold 7 / silver 5 / bronze 3)
const P = {
  1: { t: 't2', pts: 30, m: [2, 2, 2] },
  2: { t: 't1', pts: 27, m: [3, 0, 2] },
  3: { t: 't3', pts: 23, m: [2, 0, 3] },
  4: { t: 't0', pts: 22, m: [2, 1, 1] },
  5: { t: 't4', pts: 18, m: [1, 1, 2] },
  6: { t: 't5', pts: 15, m: [1, 1, 1] },
};
const ORD = { 1: ['1', 'st'], 2: ['2', 'nd'], 3: ['3', 'rd'], 4: ['4', 'th'], 5: ['5', 'th'], 6: ['6', 'th'] };
const ordTxt = (n) => ORD[n][0] + ORD[n][1];
const shield = (tid, w, cls = '') => `<img class="sh ${cls}" src="${SH}${T[tid].img}" style="width:${w}px" alt="">`;

// ---------- shared chrome ----------
const sys = (c) => `
<svg width="18" height="12" viewBox="0 0 18 12" fill="${c}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
<svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><path d="M1.5 4.2a10 10 0 0 1 14 0"/><path d="M4 7a6.4 6.4 0 0 1 9 0"/><circle cx="8.5" cy="10" r="1.2" fill="${c}" stroke="none"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.7" y="0.7" width="22.6" height="11.6" rx="3.6" stroke="${c}" stroke-opacity=".5" stroke-width="1.4"/><rect x="2.4" y="2.4" width="19.2" height="8.2" rx="2.2" fill="${c}"/><path d="M25 4.4v4.2c.9-.3 1.6-1.2 1.6-2.1S25.900 4.700 25 4.400z" fill="${c}" fill-opacity=".55"/></svg>`;
const statusBar = (time, c) => `<div class="sb" style="color:${c}"><span class="tm">${time}</span><i class="notch"></i><span class="sy">${sys(c)}</span></div>`;
const homeBar = (c) => `<i class="hi" style="background:${c}"></i>`;

const ICON = {
  eyeoff: (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c5.5 0 9 6 9 6a16.7 16.7 0 0 1-3.2 3.8M6.5 7.6C4 9.3 3 12 3 12s3.5 6 9 6a9.4 9.4 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`,
  lock: (s = 15) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  chev: (s = 20, w = 3) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevR: (s = 20, w = 3) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  crown: (s = 40, c = '#f7b928') => `<svg width="${s}" height="${s * 0.78}" viewBox="0 0 40 31" fill="${c}" stroke="#111" stroke-width="2.4" stroke-linejoin="round"><path d="M3 9l8 8 9-13 9 13 8-8-3 20H6z"/><circle cx="3" cy="8" r="2.6"/><circle cx="20" cy="3.6" r="2.6"/><circle cx="37" cy="8" r="2.6"/></svg>`,
  tv: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/></svg>`,
};
const medals = (m, cls = '') => {
  const names = ['gold', 'silver', 'bronze'];
  return `<span class="meds ${cls}">` + m.map((n, i) => n ? `<span class="med"><i class="md ${'gsb'[i]}">${n}</i>${names[i]}</span>` : '').join('') + `</span>`;
};

// ---------- direction A + shared screen styles ("Classic remote") ----------
const BASE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:390px;height:844px;overflow:hidden}
body{position:relative;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:'tnum' 1,'cv11' 1}
.d{font-family:'Inter Display','Inter',system-ui,sans-serif;letter-spacing:-.022em}
.sb{position:absolute;top:0;left:0;right:0;height:47px;z-index:30;display:flex;align-items:flex-start;justify-content:space-between;padding:15px 30px 0 38px;font-weight:700;font-size:16px;letter-spacing:-.01em}
.sb .sy{display:flex;gap:6px;align-items:center;height:20px;margin-top:2px}
.sb .tm{font-feature-settings:'tnum' 1}
.notch{position:absolute;left:50%;top:0;width:158px;height:30px;margin-left:-79px;background:#000;border-radius:0 0 20px 20px}
.hi{position:absolute;left:50%;bottom:8px;margin-left:-67px;width:134px;height:5px;border-radius:3px;z-index:30}
img.sh{display:block;height:auto;filter:drop-shadow(0 3px 5px rgba(0,0,0,.28))}
.md{display:inline-block;width:19px;height:19px;border-radius:50%;border:1.6px solid #121847;font-style:normal;font-size:11px;font-weight:900;line-height:16px;text-align:center;color:#121847;margin-right:5px;vertical-align:-4px}
.md.g{background:#f2b632}.md.s{background:#c9d0da}.md.b{background:#cd8444}
.meds{display:inline-flex;gap:11px;flex-wrap:nowrap;font-size:13px;font-weight:700;white-space:nowrap}
.med{display:inline-flex;align-items:center}
`;

const A_CSS = BASE + `
:root{--paper:#f6f0e4;--paper-2:#ebe3d1;--ink:#121847;--ink-2:#363d73;--ink-3:#6d7298;--blue:#3355ff;--blue-edge:#1c33b5;--blue-tint:#dfe5ff;--gold:#f7b928;--gold-edge:#96620a;--gold-tint:#fff1c7;--green:#1b8a4a;--live:#e0352b}
body.A{background:var(--paper);color:var(--ink)}
.hdr{height:109px;background:var(--blue);border-bottom:6px solid var(--blue-edge);padding:47px 16px 0;display:flex;align-items:center;gap:10px;color:#fff}
.back{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;color:#fff;flex:none}
.brand{display:flex;align-items:baseline;gap:7px;flex:1}
.brand b{font-size:22px;font-weight:900;letter-spacing:.015em}
.brand span{font-size:19px;font-weight:800;color:#ffd965;letter-spacing:-.01em}
.pill{display:flex;align-items:center;gap:7px;background:#fff;color:var(--ink);font-size:14px;font-weight:800;border-radius:999px;padding:7px 13px 7px 11px;letter-spacing:-.005em}
.dot{width:10px;height:10px;border-radius:50%;background:var(--green);display:inline-block;flex:none}
.dot.live{background:var(--live);box-shadow:0 0 0 3px rgba(224,53,43,.22)}
.page{padding:12px 16px 0}
.strip{background:var(--blue-tint);border-radius:16px;padding:11px 14px;font-size:14.5px;line-height:1.36;font-weight:600;color:var(--ink)}
.strip b{font-weight:900}
.card{background:#fff;border:3px solid var(--ink);border-radius:22px;box-shadow:0 6px 0 var(--ink)}
.lbl{font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-2)}
.now{margin-top:14px;padding:13px 15px 15px}
.now .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}
.livetag{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--live)}
.now .body{display:flex;gap:14px;align-items:center}
.now .tx{flex:1;min-width:0}
.now .pl{font-size:38px;font-weight:900;line-height:1}
.now .tn{font-size:19.5px;font-weight:800;margin-top:5px;line-height:1.12;letter-spacing:-.012em}
.now .ln{display:flex;align-items:center;justify-content:space-between;margin-top:9px;gap:8px}
.now .pts{font-size:30px;font-weight:900;line-height:1}
.now .pts small{font-size:14px;font-weight:800;margin-left:3px;color:var(--ink-2)}
.btn{display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--ink);border-radius:24px;font-weight:900;text-align:center}
.btn small{font-size:14px;font-weight:700;letter-spacing:0;margin-top:3px}
.btn.gold{background:var(--gold);border-color:var(--gold-edge);box-shadow:0 8px 0 var(--gold-edge);color:#1d1300}
.btn.white{background:#fff;box-shadow:0 8px 0 var(--ink);color:var(--ink)}
.btn.ink{background:var(--ink);border-color:var(--ink);box-shadow:0 8px 0 #060a2a;color:#fff}
.btn.off{background:var(--paper-2);border-color:#b9b09b;box-shadow:0 8px 0 #b9b09b;color:#8b8573}
.pair{display:grid;grid-template-columns:116px 1fr;gap:14px;margin-top:15px}
.pair .btn{height:100px}
.pair .btn .big{font-size:25px;line-height:1.05}
.pair .btn.gold .big{font-size:40px}
.trk{display:flex;gap:6px;margin-top:20px}
.trk i{flex:1;height:34px;border-radius:10px;border:2.5px solid var(--ink);display:grid;place-items:center;font-style:normal;font-size:16px;font-weight:900}
.trk i.done{background:var(--ink);color:#fff}
.trk i.cur{background:var(--gold);border-color:var(--gold-edge);color:#1d1300;box-shadow:0 4px 0 var(--gold-edge)}
.trk i.todo{border-style:dashed;border-color:var(--ink-3);color:var(--ink-3)}
.trkcap{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:var(--ink-2);margin-top:7px}
.priv{margin-top:16px;border:2.5px dashed var(--ink);border-radius:20px;padding:11px 13px 12px;background:repeating-linear-gradient(135deg,#fff6d9 0 9px,#ffeeb8 9px 18px)}
.priv .top{display:flex;justify-content:space-between;align-items:center}
.only{display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:#fff;border-radius:999px;padding:4px 10px 4px 8px;font-size:12px;font-weight:800;letter-spacing:.01em}
.priv .body{display:flex;align-items:center;gap:12px;margin-top:9px}
.priv .nm{font-size:18.5px;font-weight:850;line-height:1.1;letter-spacing:-.012em}
.priv .pl{font-size:13px;font-weight:800;color:var(--ink-2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.priv .pp{font-size:24px;font-weight:900;margin-left:auto;text-align:right;line-height:1}
.priv .pp small{display:block;font-size:12px;font-weight:800;color:var(--ink-2);margin-top:2px}
.list{margin-top:15px;display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 18px;font-size:19px;font-weight:900}
.foot{position:absolute;left:0;right:0;bottom:48px;text-align:center;font-size:15px;font-weight:800;color:var(--ink-2);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:2px}
`;

const aHead = (pill, dotCls = '') => `
<header class="hdr"><span class="back">${ICON.chev(22, 3)}</span>
<div class="brand d"><b>CAMP</b><span>Remote</span></div>
<div class="pill"><i class="dot ${dotCls}"></i>${pill}</div></header>`;

const aTrack = (cur, done) => {
  let s = '';
  for (let p = 6; p >= 1; p--) {
    const c = p === cur ? 'cur' : p > cur ? 'done' : 'todo';
    s += `<i class="${c}">${p}</i>`;
  }
  return `<div class="trk">${s}</div>`;
};

function pageA(name, body, time) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390,initial-scale=1,viewport-fit=cover"><title>${name}</title><style>${A_CSS}</style></head>
<body class="A">${statusBar(time, '#fff')}${body}${homeBar('#121847')}</body></html>`;
}

// ---- A1 ready
const A1 = pageA('Remote A - ready', `
${aHead('Connected')}
<main class="page">
<div class="strip">Everything you press goes to every big screen (<b>2 online</b>) and to <b>11</b> counselor phones.</div>
<section class="card now" style="margin-top:14px">
  <div class="top"><span class="lbl">On the screen now</span></div>
  <div class="d" style="font-size:27px;font-weight:900;line-height:1.05">Waiting for the directors…</div>
  <p style="font-size:14px;line-height:1.38;font-weight:600;color:var(--ink-2);margin-top:6px">No standings are showing. Counselor phones can't see them either.</p>
</section>
<div class="btn gold" style="height:112px;margin-top:18px"><span class="d" style="font-size:36px;line-height:1">Start the reveal</span><small style="font-size:15px">Freezes the standings right now</small></div>
<div style="margin-top:22px">
  <div class="lbl" style="margin-bottom:9px">What happens next</div>
  <ol style="list-style:none;display:grid;gap:9px;font-size:15px;line-height:1.36;font-weight:600">
    <li style="display:flex;gap:11px"><b class="d" style="flex:none;width:26px;height:26px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:900;margin-top:1px">1</b><span><b style="font-weight:900">Standings freeze.</b> Points entered after this won't change tonight's reveal.</span></li>
    <li style="display:flex;gap:11px"><b class="d" style="flex:none;width:26px;height:26px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:900;margin-top:1px">2</b><span><b style="font-weight:900">You press Next</b> to show one place at a time, 6th down to 1st. Friday ends with the champion celebration.</span></li>
    <li style="display:flex;gap:11px"><b class="d" style="flex:none;width:26px;height:26px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:900;margin-top:1px">3</b><span><b style="font-weight:900">Counselor phones follow along,</b> place by place. Places still to come stay hidden.</span></li>
  </ol>
</div>
<section class="card" style="margin-top:20px;padding:12px 16px 13px">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:19px;font-weight:900"><span class="d">Screens (2)</span><span style="color:var(--ink-2)">${ICON.chev(18, 3).replace('M15 5l-7 7 7 7', 'M5 9l7 7 7-7')}</span></div>
  <div style="display:grid;gap:6px;margin-top:8px;font-size:14.5px;font-weight:700">
    <div style="display:flex;justify-content:space-between"><span>Screen 1</span><span style="display:flex;gap:7px;align-items:center;color:var(--green)"><i class="dot"></i>Connected</span></div>
    <div style="display:flex;justify-content:space-between"><span>Screen 2</span><span style="display:flex;gap:7px;align-items:center;color:var(--green)"><i class="dot"></i>Connected</span></div>
  </div>
</section>
</main>`, '7:31');

// ---- A2 mid-reveal
const f = P[4], nx = P[3];
const A2 = pageA('Remote A - mid reveal', `
${aHead('Live', 'live')}
<main class="page">
<div class="strip">Everything you press goes to every big screen (<b>2 online</b>) and to <b>11</b> counselor phones.</div>
<section class="card now">
  <div class="top"><span class="lbl">On the screen now</span><span class="livetag"><i class="dot live"></i>Live</span></div>
  <div class="body">${shield('t0', 88)}
    <div class="tx"><div class="pl d">4th place</div><div class="tn">${T.t0.name}</div>
    <div class="ln"><span class="pts d">22<small>pts</small></span></div>
    <div style="margin-top:7px">${medals(f.m)}</div></div></div>
</section>
<section class="priv">
  <div class="top"><span class="lbl" style="color:var(--ink)">Up next</span><span class="only">${ICON.eyeoff(15)}Only on this phone</span></div>
  <div class="body">${shield('t3', 54)}
    <div><div class="pl">3rd place</div><div class="nm">Particularly Perilous Pumpkins</div></div>
    <div class="pp d">23<small>pts</small></div></div>
</section>
<div class="pair">
  <div class="btn white"><span class="big d">‹ Back</span><small>To 5th place</small></div>
  <div class="btn gold"><span class="big d">Next ›</span><small>Show 3rd place</small></div>
</div>
${aTrack(4)}
<div class="trkcap"><span>3 of 6 places shown</span><span style="color:var(--ink);font-weight:800;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:2px">End reveal early</span></div>
<section class="card list"><span class="d">Screens (2)</span><span style="color:var(--ink-2)">${ICON.chevR(20, 3)}</span></section>
</main>`, '7:36');

// ---- A3 finale
const A3 = pageA('Remote A - finale', `
${aHead('Live', 'live')}
<main class="page">
<div class="strip">Everything you press goes to every big screen (<b>2 online</b>) and to <b>11</b> counselor phones.</div>
<section class="card now" style="background:var(--gold-tint);border-color:var(--ink);position:relative;overflow:hidden">
  ${[[244,152,'#e2672b',22],[276,170,'#3355ff',-30],[306,150,'#3a7d34',50],[330,172,'#c23b22',12],[262,184,'#f7b928',-12],[339,70,'#345b96',35],[340,104,'#e07d10',-40],[6,166,'#3355ff',28],[28,184,'#f7b928',-35]].map(c => `<i style="position:absolute;left:${c[0]}px;top:${c[1]}px;width:9px;height:14px;background:${c[2]};border-radius:2px;transform:rotate(${c[3]}deg)"></i>`).join('')}
  <div class="top"><span class="lbl" style="color:var(--ink)">On the screen now</span><span class="livetag"><i class="dot live"></i>Live</span></div>
  <div class="body">${shield('t2', 92)}
    <div class="tx"><div class="pl d" style="font-size:33px">1st place</div><div style="display:inline-block;margin-top:6px;background:var(--ink);color:#fff;border-radius:8px;padding:3px 9px;font-size:13px;font-weight:900;letter-spacing:.09em;text-transform:uppercase">Camp Champions</div>
    <div class="tn" style="margin-top:7px">${T.t2.name}</div>
    <div class="ln"><span class="pts d">30<small>pts</small></span></div></div></div>
</section>
<section class="priv" style="margin-top:14px;padding-bottom:11px">
  <div class="top"><span class="lbl" style="color:var(--ink)">Up next</span><span class="only">${ICON.eyeoff(15)}Only on this phone</span></div>
  <div class="body" style="margin-top:6px;gap:10px"><div class="nm" style="font-size:18.5px">The full final table, all six places</div></div>
</section>
<div class="pair" style="margin-top:14px">
  <div class="btn white"><span class="big d">‹ Back</span><small>To 2nd place</small></div>
  <div class="btn gold"><span class="big d">Next ›</span><small>Show the final table</small></div>
</div>
${aTrack(1)}
<div class="btn ink" style="height:92px;margin-top:24px;flex-direction:row;gap:14px;padding:0 20px;justify-content:space-between;text-align:left">
  <span><span class="d" style="font-size:25px;display:block;line-height:1.05">End reveal</span><small style="display:block;margin-top:3px;font-size:13.5px;font-weight:600;line-height:1.25;color:#d5d9f5">Counselors keep the standings 5 more minutes, then they hide.</small></span>
  <span class="d" style="flex:none;background:var(--gold);color:#1d1300;border-radius:14px;padding:7px 10px;font-size:21px;font-weight:900;line-height:1">5:00</span>
</div>
</main>`, '7:44');

// ---------- direction B "Stage remote" ----------
const B_CSS = BASE + `
:root{--st:#0b1036;--st2:#141a4d;--st3:#2a3382;--tx:#f5f6ff;--tx2:#b4bbf0;--gold:#f7b928;--gold-edge:#96620a;--live:#ff5a4d}
body.B{background:var(--st);color:var(--tx)}
.bt{height:90px;padding:47px 16px 0;display:flex;align-items:center;gap:10px}
.bt .back{width:36px;height:36px;border-radius:50%;border:2px solid var(--st3);display:grid;place-items:center;color:var(--tx);flex:none}
.bt .ttl{flex:1;font-size:19px;font-weight:900}
.bt .ttl span{color:var(--gold)}
.bpill{display:flex;align-items:center;gap:7px;border:2px solid var(--st3);border-radius:999px;padding:6px 12px 6px 10px;font-size:13.5px;font-weight:800;color:var(--tx)}
.bpill i{width:9px;height:9px;border-radius:50%;background:var(--live);box-shadow:0 0 0 3px rgba(255,90,77,.25)}
.bpill i.ok{background:#3ddc84;box-shadow:0 0 0 3px rgba(61,220,132,.22)}
.page{padding:0 16px}
.tvw{width:358px;padding:6px 6px 0;border-radius:16px;background:#03051b;border:2px solid var(--st3)}
.tvclip{width:342px;height:192.4px;overflow:hidden;border-radius:7px;position:relative}
.tv{width:1280px;height:720px;transform:scale(.26719);transform-origin:0 0;background:#fff;color:#000;position:relative;font-family:'Inter Display','Inter',system-ui,sans-serif;letter-spacing:-.02em;overflow:hidden}
.tvcap{display:flex;justify-content:space-between;align-items:center;height:24px;white-space:nowrap;font-size:11.5px;font-weight:800;color:var(--tx2);letter-spacing:.02em}
.tvcap b{display:flex;gap:6px;align-items:center;color:var(--tx);letter-spacing:.09em;font-size:11px;font-weight:900;text-transform:uppercase}
.tvcap b i{width:8px;height:8px;border-radius:50%;background:var(--live)}
.tvcap b i.idle{background:#7d86d6}
.tv .place{position:absolute;top:34px;left:0;right:0;text-align:center;font-size:62px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}
.tv .shd{position:absolute;filter:drop-shadow(0 12px 20px rgba(0,0,0,.28))}
.tv .nmb{position:absolute;font-weight:900;line-height:1}
.tv .md{width:50px;height:50px;font-size:28px;line-height:44px;border-width:3px;margin-right:12px;vertical-align:-10px}
.tv .tm{position:absolute;font-size:38px;font-weight:900;white-space:nowrap;letter-spacing:-.01em}
.tv .tm .med{display:inline-flex;margin-right:0}
.tv .meds{font-size:36px;gap:34px}
.lh{display:flex;justify-content:space-between;align-items:baseline;margin:9px 2px 5px;font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:var(--tx2)}
.lh span:last-child{letter-spacing:0;text-transform:none;font-weight:700;font-size:13px}
.lh span:only-child{letter-spacing:.11em;text-transform:uppercase;font-weight:900;font-size:12px}
.lad.cmp .rung{grid-template-columns:34px 34px 1fr auto;gap:8px;padding:3px 12px 3px 9px}
.lad.cmp .rung .nm{font-size:15px}
.lad.cmp .rung .pt{display:flex;align-items:baseline;justify-content:flex-end;gap:3px;font-size:25px}
.lad.cmp .rung .pt small{display:inline;margin:0;font-size:11px}
.lad.cmp .rung .rk{font-size:25px}
.lad{display:flex;flex-direction:column;gap:6px}
.rung{display:grid;grid-template-columns:36px 40px 1fr auto;align-items:center;gap:10px;min-height:var(--rh,48px);padding:3px 13px 3px 9px;border-radius:14px}
.rung .rk{font-size:27px;font-weight:900;line-height:1;text-align:center;letter-spacing:-.04em}
.rung .rk sup{font-size:11px;font-weight:900;vertical-align:top;position:relative;top:-1px;margin-left:1px;letter-spacing:0}
.rung .nm{font-size:15.5px;font-weight:850;line-height:1.08;letter-spacing:-.012em}
.rung .sb2{font-size:11.5px;font-weight:800;margin-top:2px;letter-spacing:.01em}
.rung .pt{font-size:27px;font-weight:900;line-height:1;text-align:right;letter-spacing:-.03em}
.rung .pt small{display:block;font-size:11px;font-weight:800;letter-spacing:.03em;margin-top:1px}
.rung{position:relative}
.badge{position:absolute;top:-13px;left:88px;display:flex;align-items:center;gap:5px;background:var(--gold);color:#1d1300;border-radius:7px;padding:2px 8px;font-size:10.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;line-height:14px}
.badge i{width:7px;height:7px;border-radius:50%;background:#d6322a}
.rung.done{background:#fff;color:#111;border:2px solid #111}
.rung.done .pt small{color:#444}
.rung.now{background:#fff;color:#111;border:3.5px solid var(--gold);box-shadow:0 0 0 3px rgba(247,185,40,.28);margin-top:7px}
.rung.p1{background:#fff4cc;border-color:#b8860b}
.rung.p2{background:#edeef1;border-color:#7d8894}
.rung.p3{background:#f6e3d0;border-color:#a9682f}
.rung.hid{border:2px dashed var(--st3);color:var(--tx2);grid-template-columns:36px 1fr;--rh:38px}
.rung.hid .rk{color:#6b74c6}
.rung.hid .h{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}
.rung.prev{border:2.5px dashed var(--gold);background:repeating-linear-gradient(135deg,rgba(247,185,40,.16) 0 8px,rgba(247,185,40,.05) 8px 16px);color:var(--tx);min-height:64px}
.rung.prev .rk{color:var(--gold)}
.rung.prev .sb2{display:flex;align-items:center;gap:5px;color:var(--gold);text-transform:uppercase;letter-spacing:.07em;font-size:11px;font-weight:900}
.tag{display:inline-flex;align-items:center;gap:5px;background:var(--gold);color:#1d1300;border-radius:6px;padding:1px 6px;font-size:10.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-top:3px}
.tag i{width:7px;height:7px;border-radius:50%;background:var(--live)}
.dock{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 0;background:var(--st);border-top:2px solid var(--st3);height:var(--dh,142px)}
.drow{display:grid;grid-template-columns:84px 1fr;gap:10px}
.bb{display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:22px;font-weight:900;border:3px solid var(--st3);background:var(--st2);color:var(--tx);box-shadow:0 7px 0 #060a24}
.bb .d{font-size:16px;margin-top:1px}
.bb.gold{background:var(--gold);border-color:var(--gold-edge);box-shadow:0 8px 0 var(--gold-edge);color:#1d1300}
.bb.gold .k{font-size:12.5px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
.bb.gold .m{font-size:37px;line-height:1.02;letter-spacing:-.03em}
.endb{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;height:46px;border:2.5px solid var(--tx2);border-radius:16px;padding:0 16px;font-size:17px;font-weight:900;color:var(--tx);white-space:nowrap}
.endb span:last-child{font-size:12px;font-weight:700;color:var(--tx2);white-space:normal;text-align:right;line-height:1.22}
`;

function pageB(name, body, time) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390,initial-scale=1,viewport-fit=cover"><title>${name}</title><style>${B_CSS}</style></head>
<body class="B">${statusBar(time, '#fff')}${body}${homeBar('#f5f6ff')}</body></html>`;
}
const bTop = (pill, ok) => `<div class="bt"><span class="back">${ICON.chev(20, 3)}</span><div class="ttl d">Camp <span>Remote</span></div><div class="bpill"><i class="${ok ? 'ok' : ''}"></i>${pill}</div></div>`;
const tvCap = (txt, live = true) => `<div class="tvcap"><b><i class="${live ? '' : 'idle'}"></i>On the big screen</b><span>${txt}</span></div>`;

const confetti = (() => {
  const cols = ['#e2672b', '#3355ff', '#f7b928', '#3a7d34', '#c23b22', '#345b96', '#e07d10'];
  let s = '', seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 1250, y = rnd() * 690;
    if (x > 250 && x < 1030) continue; // keep the centre column readable
    if (y > 470 && x > 200 && x < 1100) continue;
    s += `<i style="position:absolute;left:${x | 0}px;top:${y | 0}px;width:${16 + rnd() * 10 | 0}px;height:${28 + rnd() * 14 | 0}px;background:${cols[i % 7]};border-radius:4px;transform:rotate(${(rnd() * 180 - 90) | 0}deg)"></i>`;
  }
  return s;
})();

const tvWaiting = `<div class="tv"><div style="position:absolute;left:0;right:0;top:215px;text-align:center;font-size:78px;font-weight:900;line-height:1">Waiting for the directors…</div>
<div style="position:absolute;left:0;right:0;top:430px;display:flex;gap:34px;justify-content:center;opacity:.5">${['t0', 't1', 't2', 't3', 't4', 't5'].map(t => shield(t, 118)).join('')}</div></div>`;
const tvFour = `<div class="tv"><div class="place">4th place</div>
${`<img class="shd" src="${SH}${T.t0.img}" style="left:150px;top:150px;width:395px">`}
<div class="nmb" style="left:590px;top:158px;font-size:100px;width:640px">Ferocious<br>Foxes</div>
<div class="nmb" style="left:590px;top:372px;font-size:176px;line-height:.9">22<span style="font-size:38px;letter-spacing:.12em;margin-left:16px;text-transform:uppercase">pts</span></div>
<div class="tm" style="left:590px;top:566px">${medals(P[4].m)}</div></div>`;
const tvChamp = `<div class="tv">${confetti}
<div style="position:absolute;left:0;right:0;top:26px;text-align:center">${ICON.crown(86)}</div>
<div style="position:absolute;left:0;right:0;top:128px;text-align:center;font-size:40px;font-weight:900;letter-spacing:.2em;text-transform:uppercase">Camp Champions</div>
<img class="shd" src="${SH}${T.t2.img}" style="left:495px;top:184px;width:290px">
<div style="position:absolute;left:0;right:0;top:530px;text-align:center;font-size:68px;font-weight:900;line-height:1">${T.t2.name}</div>
<div style="position:absolute;left:0;right:0;top:620px;text-align:center;font-size:46px;font-weight:900">30 points</div></div>`;
const tvBlock = (tv, cap, live = true) => `<div class="tvw"><div class="tvclip">${tv}</div>${tvCap(cap, live)}</div>`;

const done = (p, extra = '', cls = '', sw = 34) => {
  const d = P[p];
  return `<div class="rung done ${cls} ${extra}">${extra === 'now' ? '<span class="badge"><i></i>On screen now</span>' : ''}
<div class="rk d">${ORD[p][0]}<sup>${ORD[p][1]}</sup></div>${shield(d.t, sw)}
<div><div class="nm">${T[d.t].name}</div></div>
<div class="pt d">${d.pts}<small>pts</small></div></div>`;
};
const hid = (p) => `<div class="rung hid"><div class="rk d">${ORD[p][0]}<sup>${ORD[p][1]}</sup></div><div class="h">${ICON.lock(15)}Hidden until you reveal it</div></div>`;

// ---- B1 ready
const B1 = pageB('Remote B - ready', `
${bTop('2 screens online', true)}
<main class="page">
${tvBlock(tvWaiting, '2 screens · 11 counselor phones', false)}
<div class="lh"><span>Before you start</span></div>
<div style="display:grid;gap:11px;font-size:15.5px;line-height:1.35;font-weight:600">
  <div style="display:flex;gap:12px"><i class="d" style="flex:none;width:28px;height:28px;border-radius:9px;background:var(--gold);color:#1d1300;display:grid;place-items:center;font-style:normal;font-size:15px;font-weight:900">1</i><span><b style="font-weight:900">The standings freeze right now.</b> Points entered after this won't change tonight's reveal.</span></div>
  <div style="display:flex;gap:12px"><i class="d" style="flex:none;width:28px;height:28px;border-radius:9px;background:var(--gold);color:#1d1300;display:grid;place-items:center;font-style:normal;font-size:15px;font-weight:900">2</i><span><b style="font-weight:900">You reveal one place at a time,</b> 6th down to 1st. Friday finishes with the champion celebration.</span></div>
  <div style="display:flex;gap:12px"><i class="d" style="flex:none;width:28px;height:28px;border-radius:9px;background:var(--gold);color:#1d1300;display:grid;place-items:center;font-style:normal;font-size:15px;font-weight:900">3</i><span><b style="font-weight:900">Counselor phones follow along.</b> Places still to come stay hidden for them.</span></div>
</div>
<div class="lh" style="margin-top:18px"><span>Places to reveal</span><span>0 of 6 shown</span></div>
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">${[6, 5, 4, 3, 2, 1].map(p => `<div style="height:46px;border:2px dashed var(--st3);border-radius:12px;display:grid;place-items:center;color:#7d86d6;font-size:20px;font-weight:900" class="d">${p}</div>`).join('')}</div>
</main>
<div class="dock" style="--dh:142px"><div class="bb gold" style="height:92px"><span class="k">Freezes the standings now</span><span class="m d" style="font-size:35px">Start the reveal</span></div></div>`, '7:31');

// ---- B2 mid-reveal
const B2 = pageB('Remote B - mid reveal', `
${bTop('Live · 2 screens', false)}
<main class="page">
${tvBlock(tvFour, '2 screens · 11 counselor phones')}
<div class="lh"><span>Places</span><span>3 of 6 shown</span></div>
<div class="lad">
${hid(1)}${hid(2)}
<div class="rung prev"><div class="rk d">3<sup>rd</sup></div>${shield('t3', 36)}
<div><div class="nm">${T.t3.name}</div><div class="sb2">${ICON.eyeoff(14)}Only on this phone</div></div>
<div class="pt d">23<small style="color:var(--tx2)">pts</small></div></div>
${done(4, 'now')}${done(5)}${done(6)}
</div>
</main>
<div class="dock" style="--dh:136px"><div class="drow" style="height:90px"><div class="bb"><span style="line-height:0">${ICON.chev(26, 3.2)}</span><span class="d">Back</span></div><div class="bb gold"><span class="k">Reveal</span><span class="m d">3rd place</span></div></div></div>`, '7:36');

// ---- B3 finale
const B3 = pageB('Remote B - finale', `
${bTop('Live · 2 screens', false)}
<main class="page">
${tvBlock(tvChamp, 'Champion celebration playing')}
<div class="lh"><span>Places</span><span>All 6 shown</span></div>
<div class="lad cmp" style="--rh:41px;gap:4px">
${done(1, 'now', 'p1', 32)}${done(2, '', 'p2', 32)}${done(3, '', 'p3', 32)}${done(4, '', '', 32)}${done(5, '', '', 32)}${done(6, '', '', 32)}
</div>
</main>
<div class="dock" style="--dh:184px"><div class="drow" style="height:84px"><div class="bb"><span style="line-height:0">${ICON.chev(26, 3.2)}</span><span class="d">Back</span></div><div class="bb gold"><span class="k">Show the</span><span class="m d" style="font-size:33px">Final table</span></div></div>
<div class="endb"><span class="d">End reveal</span><span>Counselors keep the standings<br>5 more minutes</span></div></div>`, '7:44');

// ---------- shared screens (direction A styling) ----------
const S_CSS = A_CSS + `
body.S{background:var(--paper);color:var(--ink)}
.tabs{position:absolute;left:0;right:0;bottom:0;height:90px;background:#fff;border-top:3px solid var(--ink);display:grid;grid-template-columns:repeat(4,1fr);padding:7px 8px 0;z-index:20}
.tab{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12.5px;font-weight:800;color:var(--ink-3);position:relative}
.tab .ic{width:54px;height:34px;border-radius:17px;display:grid;place-items:center}
.tab.on{color:var(--ink);font-weight:900}
.tab.on .ic{background:var(--blue);color:#fff}
.tab .bdg{position:absolute;top:-2px;left:50%;margin-left:7px;min-width:19px;height:19px;border-radius:10px;background:var(--gold);color:#1d1300;border:2px solid #fff;font-size:11px;font-weight:900;display:grid;place-items:center;padding:0 4px}
.stitle{padding:55px 16px 0;display:flex;align-items:baseline;justify-content:space-between}
.stitle h1{font-size:34px;font-weight:900;line-height:1}
.stitle span{font-size:14px;font-weight:700;color:var(--ink-2)}
.liveh{display:flex;align-items:center;justify-content:space-between;margin:14px 16px 0;background:var(--ink);color:#fff;border-radius:16px;padding:10px 14px}
.liveh .l{display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}
.liveh .l i{width:11px;height:11px;border-radius:50%;background:#ff5a4d;box-shadow:0 0 0 4px rgba(255,90,77,.3)}
.liveh span:last-child{font-size:13px;font-weight:700;color:#cbd0f3}
.tbl{margin:14px 16px 0;padding:0;overflow:hidden}
.rrow{display:grid;grid-template-columns:38px 44px 1fr auto;align-items:center;gap:10px;padding:9px 14px 9px 12px;min-height:64px;border-bottom:2px solid var(--paper-2)}
.rrow:last-child{border-bottom:0}
.rrow .rk{font-size:29px;font-weight:900;text-align:center;line-height:1}
.rrow .rk sup{font-size:11px;font-weight:900;vertical-align:top;margin-left:1px;letter-spacing:0}
.rrow .nm{font-size:16.5px;font-weight:850;line-height:1.1;letter-spacing:-.012em}
.rrow .sub{margin-top:3px}
.rrow .meds{font-size:12px;gap:2px}
.meds.nolbl .med{font-size:0}
.meds.nolbl .md{margin-right:3px;font-size:10px}
.rrow .md{width:17px;height:17px;font-size:10px;line-height:14px;margin-right:4px;vertical-align:-3px}
.rrow .pt{font-size:26px;font-weight:900;text-align:right;line-height:1}
.rrow .pt small{display:block;font-size:11.5px;font-weight:800;color:var(--ink-2);margin-top:1px}
.rrow.cur{background:var(--gold-tint)}
.cap{grid-column:1/-1;margin:-9px -14px 0 -12px;background:var(--ink);color:#fff;height:24px;display:flex;align-items:center;justify-content:space-between;padding:0 14px 0 12px;font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
.cap span:first-child{display:flex;align-items:center;gap:7px}
.cap i{width:9px;height:9px;border-radius:50%;background:#ff5a4d;box-shadow:0 0 0 3px rgba(255,90,77,.3)}
.cap em{font-style:normal;color:var(--gold)}
.chip{display:inline-block;border-radius:6px;padding:1px 7px;font-size:10.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-left:6px;vertical-align:1px}
.chip.you{background:var(--ink);color:#fff}
.chip.scr{background:var(--live);color:#fff}
.soon{margin:14px 16px 0;display:grid;gap:7px}
.soon .h{font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-2);display:flex;justify-content:space-between}
.slot{display:grid;grid-template-columns:38px 1fr;align-items:center;gap:10px;height:46px;border:2.5px dashed var(--ink-3);border-radius:16px;padding:0 14px 0 12px;color:var(--ink-3)}
.slot .rk{font-size:25px;font-weight:900;text-align:center}
.slot .rk sup{font-size:10.5px;font-weight:900;vertical-align:top;margin-left:1px}
.slot span{font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px}
.note{margin:14px 18px 0;font-size:13.5px;line-height:1.4;font-weight:600;color:var(--ink-2)}
.hap{margin:16px 16px 0;padding:12px 15px;border-left:7px solid var(--blue);border-radius:6px 20px 20px 6px;background:#fff;border-top:3px solid var(--ink);border-right:3px solid var(--ink);border-bottom:3px solid var(--ink);box-shadow:0 5px 0 var(--ink)}
.sec{margin:20px 16px 0}
.sec .h{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-2);margin-bottom:9px}
.run{display:flex;align-items:center;gap:13px;background:var(--gold);border:3px solid var(--gold-edge);box-shadow:0 7px 0 var(--gold-edge);border-radius:22px;padding:14px 16px 14px 16px;color:#1d1300}
.run .t{font-size:23px;font-weight:900;line-height:1.05}
.run .s{font-size:13.5px;font-weight:700;margin-top:4px;display:flex;align-items:center;gap:7px;white-space:nowrap}
.run .ico{width:48px;height:48px;border-radius:14px;background:#1d1300;color:var(--gold);display:grid;place-items:center;flex:none}
.rows{margin-top:16px;background:#fff;border:3px solid var(--ink);border-radius:20px;box-shadow:0 5px 0 var(--ink);overflow:hidden}
.mr{display:flex;align-items:center;justify-content:space-between;padding:9px 16px;min-height:56px;border-bottom:2px solid var(--paper-2);gap:10px}
.mr:last-child{border-bottom:0}
.mr .t{font-size:17.5px;font-weight:850;letter-spacing:-.01em;line-height:1.1}
.mr .s{font-size:13.5px;font-weight:600;color:var(--ink-2);margin-top:2px;line-height:1.25}
.mr .c{color:var(--ink-2);flex:none;display:flex}
.mr.sm{min-height:48px;padding:8px 16px}
.mr.sm .t{font-size:16.5px}
`;

const tabIcons = {
  now: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>`,
  games: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.500 3.500 0 0 0 7.500 11M17 6h3v1.5a3.500 3.500 0 0 1-3.500 3.500M12 14v4M8.500 20h7"/></svg>`,
  chat: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H11l-5 4v-4H4z"/></svg>`,
  more: `<svg width="25" height="25" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.500" cy="12" r="2.200"/><circle cx="12" cy="12" r="2.200"/><circle cx="18.500" cy="12" r="2.200"/></svg>`,
};
const tabBar = (on) => `<nav class="tabs">${[['now', 'Now'], ['games', 'Games'], ['chat', 'Chat'], ['more', 'More']].map(([k, l]) =>
  `<div class="tab ${on === k ? 'on' : ''}"><span class="ic">${tabIcons[k]}</span>${l}${k === 'chat' ? '<b class="bdg">3</b>' : ''}</div>`).join('')}</nav>`;
function pageS(name, body, time) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390,initial-scale=1,viewport-fit=cover"><title>${name}</title><style>${S_CSS}</style></head>
<body class="S">${statusBar(time, '#121847')}${body}${homeBar('#121847')}</body></html>`;
}

const crow = (p, extra = '') => {
  const d = P[p];
  return `<div class="rrow ${extra === 'cur' ? 'cur' : ''}">${extra === 'cur' ? '<div class="cap"><span><i></i>On the screen now</span><em>Your team</em></div>' : ''}<div class="rk d">${ORD[p][0]}<sup>${ORD[p][1]}</sup></div>${shield(d.t, 40)}
<div><div class="nm">${T[d.t].name}</div><div class="sub">${medals(d.m, 'nolbl')}</div></div>
<div class="pt d">${d.pts}<small>pts</small></div></div>`;
};
const slot = (p) => `<div class="slot"><div class="rk d">${ORD[p][0]}<sup>${ORD[p][1]}</sup></div><span>${ICON.lock(15)}Still to come</span></div>`;

const S4 = pageS('Counselor Now tab - reveal', `
<div class="stitle"><h1 class="d">Now</h1><span>Friday · 7:36 PM</span></div>
<div class="liveh"><span class="l"><i></i>Live on the big screen</span><span>Standings reveal</span></div>
<section class="card tbl">${crow(6)}${crow(5)}${crow(4, 'cur')}</section>
<div class="soon" style="margin-top:12px">${slot(3)}${slot(2)}${slot(1)}</div>
<p class="note" style="margin-top:12px">Places show up here as the directors reveal them. The standings stay for 5 minutes after the reveal ends, then hide again.</p>
<section class="hap"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:11.5px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--blue)">Happening now</span><span style="font-size:13px;font-weight:700;color:var(--ink-2)">7:00 to 8:30 PM</span></div><div style="font-size:19px;font-weight:900;margin-top:4px;letter-spacing:-.01em">\u{1F319} Evening program</div></section>
${tabBar('now')}`, '7:36');

const mrow = (t, s, sm = false) => `<div class="mr ${sm ? 'sm' : ''}"><div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div><span class="c">${ICON.chevR(19, 2.8)}</span></div>`;
const S5 = pageS('Director More tab', `
<div class="stitle"><h1 class="d">More</h1><span>Signed in as a director</span></div>
<div class="sec" style="margin-top:16px">
  <div class="h"><span>Director</span><span style="letter-spacing:0;text-transform:none;font-weight:700;font-size:13px">Only directors see this</span></div>
  <div class="run"><span class="ico">${ICON.tv(26)}</span><div style="flex:1"><div class="t d">Run the reveal</div><div class="s"><i class="dot"></i>Ready · 2 screens online</div></div><span style="color:#1d1300">${ICON.chevR(22, 3.2)}</span></div>
  <div class="rows">
    ${mrow('Tell everyone', 'Announcements and phone alerts')}
    ${mrow('Award points', 'Enter or fix scores for any game')}
    ${mrow('What counselors see', 'Choose which cards counselors can open')}
    ${mrow('Set up the week', 'Days, games, teams and who can sign in')}
  </div>
</div>
<div class="sec" style="margin-top:20px">
  <div class="h"><span>Everyone</span></div>
  <div class="rows" style="margin-top:0">
    ${mrow('Full schedule', '', true)}
    ${mrow('Phone alerts', '', true)}
    ${mrow('Appearance', '', true)}
    ${mrow('Sign out', '', true)}
  </div>
</div>
${tabBar('more')}`, '7:29');

// ---------- write + shoot ----------
const FILES = [
  ['01-A-ready', A1], ['02-A-mid-reveal', A2], ['03-A-finale', A3],
  ['04-B-ready', B1], ['05-B-mid-reveal', B2], ['06-B-finale', B3],
  ['07-counselor-now', S4], ['08-director-more', S5],
];
(async () => {
  const { chromium } = require('playwright');
  const only = process.argv[2];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    for (const [n, html] of FILES) {
      if (only && !n.includes(only)) continue;
      fs.writeFileSync(path.join(OUT, n + '.html'), html);
      const p = await ctx.newPage();
      await p.goto('file://' + path.join(OUT, n + '.html'));
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(OUT, n + '.png') });
      await p.close();
      console.log('wrote', n);
    }
  } finally { await b.close(); }
})();
