// Final app-shell mockups (HTML + PNG). Scratch tooling, not shipped.
// node _build.js            -> writes every *.html and screenshots each to *.png
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const SH = 'file:///home/user/Camp/images/team-shields/';

// ---------- data (junior from camps.js / defaults.js; senior palette from setup spec Appendix A) ----------
const T = {
  t0: { name: 'Ferocious Foxes', short: 'Foxes', img: 'ferocious-foxes.webp', c: '#b54708', cd: '#ffab5e' },
  t1: { name: 'Turkey Dinner', short: 'Turkey', img: 'turkey-dinner.webp', c: '#7a4a22', cd: '#dfae82' },
  t2: { name: 'Methodic Mediocre Maples', short: 'Maples', img: 'methodic-mediocre-maples.webp', c: '#b42318', cd: '#ff8a80' },
  t3: { name: 'Particularly Perilous Pumpkins', short: 'Pumpkins', img: 'particularly-perilous-pumpkins.webp', c: '#8a6100', cd: '#f2c24b' },
  t4: { name: 'Patriotic Pilgrims', short: 'Pilgrims', img: 'patriotic-pilgrims.webp', c: '#1f5fb8', cd: '#86b6ff' },
  t5: { name: 'Runaway John Deersz', short: 'John Deersz', img: 'runaway-john-deeres.webp', c: '#2f7d32', cd: '#7fd88a' },
  // senior: flags in palette colours (no artwork yet)
  // c = text-safe colour (outlines, tags); f = brighter fill for the flag mark (always ink-outlined); shape = colour-blind cue
  s0: { name: 'Red Team', short: 'Red', c: '#b42318', cd: '#ff8a80', f: '#d92d20', shape: 'plain' },
  s1: { name: 'Blue Team', short: 'Blue', c: '#1f5fb8', cd: '#86b6ff', f: '#2f6fd0', shape: 'swallow' },
  s2: { name: 'Green Team', short: 'Green', c: '#2f7d32', cd: '#7fd88a', f: '#2f8a35', shape: 'stripe' },
  s3: { name: 'Gold Team', short: 'Gold', c: '#8a6100', cd: '#f2c24b', f: '#e0a100', shape: 'chevron' },
};
const tv = (t) => `--team:${T[t].c};--teamd:${T[t].cd}`;
const ORD = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

// ---------- icons (one line-icon family: 24 grid, 2.2 stroke, round caps) ----------
const sv = (d, s = 22, w = 2.2, extra = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  now: (s) => sv('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.1"/>', s),
  games: (s) => sv('<path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.8a2.6 2.6 0 0 0 2.9 3.6M16.5 6h2.7a2.6 2.6 0 0 1-2.9 3.6"/><path d="M12 13.8V17M8.6 20.2h6.8M9.6 17h4.8"/>', s),
  chat: (s) => sv('<path d="M4.5 6.2A2.7 2.7 0 0 1 7.2 3.5h9.6a2.7 2.7 0 0 1 2.7 2.7v7.1a2.7 2.7 0 0 1-2.7 2.7H11l-4.4 3.6V16h.6a2.7 2.7 0 0 1-2.7-2.7z"/>', s),
  more: (s) => sv('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>', s, 2.4),
  back: (s = 22) => sv('<path d="M14.5 5.5 8 12l6.5 6.5"/>', s, 2.8),
  chev: (s = 18) => sv('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>', s, 2.6),
  check: (s = 14, w = 3.2) => sv('<path d="m5 12.5 4.3 4.3L19 7"/>', s, w),
  lock: (s = 15) => sv('<rect x="5" y="11" width="14" height="9.5" rx="2.4"/><path d="M8.3 11V8.2a3.7 3.7 0 0 1 7.4 0V11"/>', s, 2.3),
  eyeoff: (s = 15) => sv('<path d="M3.5 3.5l17 17"/><path d="M10.4 6.1A9.6 9.6 0 0 1 12 6c5.3 0 8.5 6 8.5 6a15.6 15.6 0 0 1-3 3.7M6.6 7.6C4.4 9.1 3.5 12 3.5 12s3.2 6 8.5 6a8.6 8.6 0 0 0 3.8-.9"/><path d="M10 10a2.8 2.8 0 0 0 4 4"/>', s, 2.3),
  tv: (s = 22) => sv('<rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2.4"/><path d="M8.4 20.4h7.2M12 16.8v3.6"/>', s, 2.3),
  megaphone: (s = 18) => sv('<path d="M3.8 10v4a1.6 1.6 0 0 0 1.6 1.6h1.8L16 20V4L7.2 8.4H5.4A1.6 1.6 0 0 0 3.8 10z"/><path d="M19.2 9.2a4 4 0 0 1 0 5.6"/>', s),
  x: (s = 16) => sv('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', s, 2.6),
  cloud: (s = 18) => sv('<path d="M7.4 17.5h9.4a3.7 3.7 0 0 0 .4-7.4 5.4 5.4 0 0 0-10.4 1.3 3.1 3.1 0 0 0 .6 6.1z"/><path d="M9 20.4l.6-1M12.4 20.4l.6-1M15.8 20.4l.6-1"/>', s, 2.1),
  bell: (s = 20) => sv('<path d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.5 1.6H4.7z"/><path d="M10 20.4a2.2 2.2 0 0 0 4 0"/>', s),
  pen: (s = 20) => sv('<path d="M5 19l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L9.2 18 5 19z"/>', s),
  star: (s = 20) => sv('<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>', s),
  eye: (s = 20) => sv('<path d="M3.2 12S6.4 6 12 6s8.8 6 8.8 6-3.2 6-8.8 6-8.8-6-8.8-6z"/><circle cx="12" cy="12" r="2.7"/>', s),
  gear: (s = 20) => sv('<circle cx="12" cy="12" r="3"/><path d="M12 3.6v2.2M12 18.2v2.2M3.6 12h2.2M18.2 12h2.2M6.1 6.1l1.5 1.5M16.4 16.4l1.5 1.5M6.1 17.9l1.5-1.5M16.4 7.6l1.5-1.5"/>', s),
  people: (s = 20) => sv('<circle cx="9" cy="8.6" r="3.2"/><path d="M3.6 19c.6-3.2 2.8-5 5.4-5s4.8 1.8 5.4 5"/><path d="M15.6 5.8a3 3 0 0 1 0 5.6M17.6 14.4c1.6.6 2.6 2.2 2.9 4.6"/>', s),
  cal: (s = 20) => sv('<rect x="4" y="5.2" width="16" height="14.8" rx="2.4"/><path d="M4 9.8h16M8.6 3.4v3.6M15.4 3.4v3.6"/>', s),
  book: (s = 20) => sv('<path d="M4.5 5.6c2.6-1 5.2-.8 7.5.8 2.3-1.6 4.9-1.8 7.5-.8v12.6c-2.6-1-5.2-.8-7.5.8-2.3-1.6-4.9-1.8-7.5-.8z"/><path d="M12 6.4v12.4"/>', s),
  broom: (s = 20) => sv('<path d="M14.5 4.2 11 11.4"/><path d="M8.2 10.6l5.2 2.4-1.6 6.6-7.6-3.6z"/><path d="M7.8 17.4l1.4-2.6"/>', s),
  plus: (s = 20) => sv('<circle cx="12" cy="12" r="8.4"/><path d="M12 8.2v7.6M8.2 12h7.6"/>', s),
  phone: (s = 20) => sv('<rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M11 18h2"/>', s),
  sun: (s = 20) => sv('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>', s),
  history: (s = 20) => sv('<path d="M4.4 12a7.6 7.6 0 1 0 2.2-5.4"/><path d="M4 4.4v3.8h3.8"/><path d="M12 8.2V12l2.6 1.6"/>', s),
  door: (s = 20) => sv('<path d="M10 4.5H6.4A1.6 1.6 0 0 0 4.8 6.1v11.8a1.6 1.6 0 0 0 1.6 1.6H10"/><path d="M14.2 8.2 18 12l-3.8 3.8M18 12H9.4"/>', s),
  arrowUp: (s = 12) => sv('<path d="M12 18V6M6.5 11.5 12 6l5.5 5.5"/>', s, 3),
  arrowDn: (s = 12) => sv('<path d="M12 6v12M6.5 12.5 12 18l5.5-5.5"/>', s, 3),
  rewind: (s = 22) => sv('<path d="M11.5 7 6 12l5.5 5M18 7l-5.5 5 5.5 5"/>', s, 2.6),
  plusS: (s = 18) => sv('<path d="M12 5.5v13M5.5 12h13"/>', s, 2.8),
  sun2: (s = 16) => sv('<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2"/>', s, 2.2),
  crown: (s = 26) => sv('<path d="M4 8.5l4 4 4-6.5 4 6.5 4-4-1.6 10H5.6z"/>', s, 2.1),
};

// ---------- team marks ----------
function mark(t, w, cls = '') {
  const tm = T[t];
  if (tm.img) return `<img class="sh ${cls}" src="${SH}${tm.img}" style="width:${w}px" alt="">`;
  // senior: a waving flag. Hue AND shape differ per team (colour-blind safe), bright fill with an ink outline
  const body = { plain: 'M7.6 4.4c5.4-2.6 9.4 2.4 19.4-.6v14c-10 3-14-2-19.4.6z', swallow: 'M7.6 4.4c5.4-2.6 9.4 2.4 19.4-.6l-4.6 7 4.6 7c-10 3-14-2-19.4.6z', stripe: 'M7.6 4.4c5.4-2.6 9.4 2.4 19.4-.6v14c-10 3-14-2-19.4.6z', chevron: 'M7.6 4.4c5.4-2.6 9.4 2.4 19.4-.6v14c-10 3-14-2-19.4.6z' }[tm.shape];
  const deco = tm.shape === 'stripe' ? '<path d="M7.6 9.6c5.4-2.6 9.4 2.4 19.4-.6v3.6c-10 3-14-2-19.4.6z" fill="#fff" opacity=".85"/>' : tm.shape === 'chevron' ? '<path d="M7.6 6.2l8.4 5.4-8.4 5.4z" fill="#141a48" opacity=".85"/>' : '';
  return `<svg class="flag ${cls}" width="${w}" height="${w}" viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="2.5" width="2.6" height="27.5" rx="1.3" fill="var(--pole)"/><path d="${body}" fill="${tm.f}" stroke="var(--flag-line)" stroke-width="1.4" stroke-linejoin="round"/>${deco}</svg>`;
}
const md = (n, k) => `<i class="md ${k}">${n}</i>`;

// ---------- chrome ----------
const sys = (c) => `<svg width="18" height="12" viewBox="0 0 18 12" fill="${c}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><path d="M1.5 4.2a10 10 0 0 1 14 0"/><path d="M4 7a6.4 6.4 0 0 1 9 0"/><circle cx="8.5" cy="10" r="1.2" fill="${c}" stroke="none"/></svg><svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".7" y=".7" width="22.6" height="11.6" rx="3.6" stroke="${c}" stroke-opacity=".5" stroke-width="1.4"/><rect x="2.4" y="2.4" width="15" height="8.2" rx="2.2" fill="${c}"/><path d="M25 4.4v4.2c.9-.3 1.6-1.2 1.6-2.1S25.9 4.7 25 4.4z" fill="${c}" fill-opacity=".55"/></svg>`;
const statusBar = (time, c = 'var(--ink)') => `<div class="sb" style="color:${c}"><span class="tm">${time}</span><i class="island"></i><span class="sy">${sys('currentColor')}</span></div>`;

function tabBar(active, { chat = 0, nowDot = false, moreDot = false } = {}) {
  const tabs = [['now', 'Now'], ['games', 'Games'], ['chat', 'Chat'], ['more', 'More']];
  return `<nav class="tb" role="tablist">${tabs.map(([k, l]) => `<a class="tab ${k === active ? 'on' : ''}" role="tab" aria-selected="${k === active}">
<span class="ti">${k === active ? '<i class="blob"></i>' : ''}${I[k](24)}${k === 'chat' && chat ? `<b class="badge">${chat}</b>` : ''}${k === 'now' && nowDot ? '<b class="ldot"></b>' : ''}${k === 'more' && moreDot ? '<b class="mdot"></b>' : ''}</span><span class="tl">${l}</span></a>`).join('')}</nav><i class="hi"></i>`;
}

// header for the four tabs: who I am + where/when
function appBar({ team, line1, line2, right = '' }) {
  const lead = team ? mark(team, 34, 'ab-mark') : `<span class="campmark">${I.sun(20)}</span>`;
  return `<header class="ab">${lead}<div class="ab-t"><b>${line1}</b><span>${line2}</span></div><div class="ab-r">${right}</div></header>`;
}

// ---------- CSS ----------
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
:root{
 --paper:#f5efe2;--paper-2:#ebe2cf;--sheet:#fffdf8;--ink:#141a48;--ink-2:#373d72;--ink-3:#43497a;
 --line:rgba(20,26,72,.13);--line-2:rgba(20,26,72,.26);--card-b:#141a48;--edge:#141a48;
 --blue:#2c47ee;--blue-edge:#18299c;--blue-tint:#e1e6ff;--on-blue:#fff;--link:#2234c4;
 --roof:#2c47ee;--roof-edge:#18299c;--on-roof:#fff;
 --gold:#f7b928;--gold-edge:#986409;--gold-tint:#fff0c2;--gold-ink:#1f1500;
 --live:#8f1a13;--live-tint:#fde2de;--done:#0d542d;--done-tint:#d8efe0;
 --mg:#f2b632;--ms:#c9d0da;--mb:#e0a36a;--pole:#3b3f58;--flag-line:#141a48;--hatch1:#fff5d6;--hatch2:#ffecb2;--tv-frame:#141a48;--tv-edge:#141a48}
body.dark{
 --paper:#0c1030;--paper-2:#151a45;--sheet:#161c4b;--ink:#f3f4ff;--ink-2:#c5caf3;--ink-3:#a3aade;
 --line:rgba(255,255,255,.12);--line-2:rgba(255,255,255,.24);--card-b:rgba(255,255,255,.22);--edge:#04061a;
 --blue:#9aabff;--blue-edge:#5a6ee6;--blue-tint:#262f74;--on-blue:#0c1030;--link:#aab8ff;
 --gold-tint:#3b3213;--live:#ff8a7f;--live-tint:#33121a;--done:#62d890;--done-tint:#14392a;--pole:#c9cde8;--flag-line:#0c1030;--hatch1:#3a3214;--hatch2:#2e2810;--tv-frame:rgba(255,255,255,.5);--tv-edge:#04061a}
body{position:relative;font-family:'Inter',-apple-system,system-ui,sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;font-feature-settings:'tnum' 1,'cv11' 1;letter-spacing:-.006em}
*{--tc:var(--team)}
body.dark *{--tc:var(--teamd,var(--team))}
.d{font-family:'Inter Display','Inter',system-ui,sans-serif;letter-spacing:-.022em}
.sb{position:absolute;top:0;left:0;right:0;height:47px;z-index:40;display:flex;justify-content:space-between;padding:15px 30px 0 40px;font-weight:700;font-size:16px}
.sb .sy{display:flex;gap:6px;align-items:center;height:20px;margin-top:1px}
.island{position:absolute;left:50%;top:11px;width:124px;height:36px;margin-left:-62px;background:#000;border-radius:20px}
.hi{position:absolute;left:50%;bottom:8px;margin-left:-67px;width:134px;height:5px;border-radius:3px;background:var(--ink);z-index:41}
img.sh{display:block;height:auto;flex:none;filter:drop-shadow(0 1.5px 1.5px rgba(20,26,72,.28))}
body.dark img.sh{filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.6))}
svg.flag{display:block;flex:none}
/* app bar */
.ab{position:absolute;top:47px;left:0;right:0;height:56px;display:flex;align-items:center;gap:10px;padding:0 16px;z-index:5}
.ab-t{display:flex;flex-direction:column;min-width:0;flex:1}
.ab-t b{font-size:17px;font-weight:800;line-height:1.15;letter-spacing:-.015em}
.ab-t span{font-size:13px;font-weight:600;color:var(--ink-2);line-height:1.3}
.ab-r{display:flex;gap:8px;align-items:center}
.campmark{width:34px;height:34px;border-radius:10px;background:var(--blue);color:#fff;display:grid;place-items:center;flex:none}
body.dark .campmark{color:var(--paper)}
.title-ab{font-size:28px;font-weight:800}
/* page */
.pg{position:absolute;top:103px;left:0;right:0;bottom:88px;padding:2px 16px 0;overflow:hidden}
/* tab bar */
.tb{position:absolute;left:0;right:0;bottom:0;height:88px;padding:6px 6px 34px;display:flex;background:var(--sheet);border-top:1px solid var(--line-2);z-index:30}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--ink-3);text-decoration:none}
.ti{position:relative;width:60px;height:30px;display:grid;place-items:center}
.ti svg{position:relative}
.blob{position:absolute;inset:0;border-radius:15px;background:var(--blue-tint);box-shadow:inset 0 0 0 1.5px var(--blue)}
.tab.on{color:var(--ink)}
.tab.on .ti{color:var(--blue)}
.tl{font-size:12.5px;font-weight:700;letter-spacing:0;color:var(--ink-2)}
.tab.on .tl{color:var(--ink)}
.tab.on .tl{font-weight:800}
.badge{position:absolute;top:-4px;left:35px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--link);color:#fff;font-size:12px;font-weight:800;display:grid;place-items:center;box-shadow:0 0 0 2px var(--sheet);font-style:normal}
.ldot,.mdot{position:absolute;top:0;left:38px;width:11px;height:11px;border-radius:50%;background:var(--live);box-shadow:0 0 0 2px var(--sheet)}
.mdot{background:var(--gold);box-shadow:0 0 0 2px var(--sheet),inset 0 0 0 1.5px var(--gold-edge)}
/* the one physical card: Now */
.now{background:var(--sheet);border:2px solid var(--card-b);border-radius:18px;box-shadow:0 4px 0 var(--edge);padding:12px 14px 4px;margin-top:6px}
.now-k{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:700;color:var(--ink-2)}
.now-k .left b{color:var(--ink)}
.bar{height:3px;border-radius:2px;background:var(--line);margin:8px 0 10px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--ink);border-radius:2px}
.now h1{font-size:27px;font-weight:800;line-height:1.08;display:flex;align-items:center;gap:9px}
.now h1 .em{font-size:24px;font-family:system-ui}
.now .sub{font-size:14px;font-weight:600;color:var(--ink-2);margin-top:3px}
/* game rows */
.rows{margin-top:8px}
.gr{display:grid;grid-template-columns:26px 1fr auto;column-gap:10px;padding:11px 0;border-top:1px solid var(--line)}
.gr:first-child{border-top:0}
.gr .nm{font-size:17px;font-weight:750;line-height:1.2;letter-spacing:-.012em}
.gr .ds{font-size:14px;font-weight:550;color:var(--ink-2);margin-top:2px;line-height:1.3}
.gr .ds b{color:var(--ink);font-weight:700}
.gr .rt{align-self:center;display:flex;align-items:center;gap:6px;color:var(--ink-2)}
.gr .full{grid-column:2 / 4}
.st{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;margin-top:-1px}
.st.done{background:var(--done);color:#fff}
body.dark .st.done{color:var(--paper)}
.st.live{background:var(--live-tint);box-shadow:inset 0 0 0 2px var(--live)}
.st.live::after{content:'';width:9px;height:9px;border-radius:50%;background:var(--live)}
.st.todo{box-shadow:inset 0 0 0 2px var(--ink-3)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:800;border-radius:6px;padding:2px 6px;vertical-align:1px}
.tag.live{color:var(--live);background:var(--live-tint)}
.tag.done{color:var(--done);background:var(--done-tint)}
.tag.next{color:var(--ink);background:var(--paper-2)}
.tag.you{color:#fff;background:var(--tc,var(--ink))}
body.dark .tag.you{color:var(--paper)}
body.dark .badge,body.dark .chs span b{color:#0c1030}
.md{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;border:1.6px solid #141a48;font-style:normal;font-size:13px;font-weight:900;color:#141a48;flex:none}
.md.g{background:var(--mg)}.md.s{background:var(--ms)}.md.b{background:var(--mb)}
body.dark .md{border-color:#0c1030}
/* medal winners: a 3-up podium strip. Never one nowrap line: names wrap to 2 lines, cells never overflow */
.pod{grid-column:2 / 4;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:8px 0 0 -6px}
.pc{display:flex;flex-direction:column;gap:3px;padding:5px 6px 6px;border-radius:9px;min-width:0}
.pc .tp{display:flex;align-items:center;gap:4px}
.pc .n2{font-size:14px;font-weight:700;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.pc.me{box-shadow:inset 0 0 0 2px var(--tc)}
.lb{grid-column:1 / 4 !important;display:grid;grid-template-columns:1fr 1fr;gap:0 12px;margin-top:9px;padding:3px 10px;background:var(--paper);border-radius:12px}
.lr{display:flex;align-items:center;gap:5px;height:32px;font-size:14px;font-weight:650;white-space:nowrap}
.lr .n{width:12px;font-size:13px;font-weight:800;color:var(--ink-2);text-align:right}
.lr b{margin-left:auto;font-size:17px;font-weight:800}
.lr.me{outline:2px solid var(--tc);outline-offset:-1px;border-radius:8px;padding:0 6px 0 4px;margin:0 -6px 0 -4px}
/* buttons: chunky = pressable */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:44px;padding:0 16px;border-radius:12px;border:2px solid var(--card-b);background:var(--sheet);box-shadow:0 3px 0 var(--edge);font-size:15px;font-weight:800;color:var(--ink);white-space:nowrap}
.btn.gold{background:var(--gold);border-color:var(--gold-edge);box-shadow:0 3px 0 var(--gold-edge);color:var(--gold-ink)}
.btn.sm{height:44px;padding:0 14px;font-size:15px}
.btn.wide{display:flex;width:100%}
/* flat run-sheet sections */
.sec{margin-top:16px}
.sec-h{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:750;color:var(--ink-2);padding:0 2px 5px}
.sec-h a{color:var(--link);font-size:15px;font-weight:750;text-decoration:none;display:inline-flex;align-items:center;gap:2px;padding:13px 0 13px 16px;margin:-13px 0 -13px -16px}
.rs{display:grid;grid-template-columns:62px 1fr auto;column-gap:8px;align-items:baseline;padding:9px 2px;border-top:1px solid var(--line)}
.rs:first-of-type{border-top:0}
.rs .tm{font-size:15px;font-weight:750}
.rs .lb2{font-size:16px;font-weight:650;line-height:1.3}
.rs .lb2 small{display:block;font-size:14px;font-weight:550;color:var(--ink-2);margin-top:1px}
.rs .em{font-family:system-ui}
/* message strip */
.msg{display:grid;grid-template-columns:28px 1fr 30px;gap:8px;align-items:start;background:var(--blue-tint);border-radius:14px;padding:10px 10px 10px 12px;margin-top:4px}
.msg .ic{width:28px;height:28px;border-radius:8px;background:var(--blue);color:#fff;display:grid;place-items:center}
body.dark .msg .ic{color:var(--paper)}
.msg p{font-size:15px;font-weight:650;line-height:1.32}
.msg small{display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-top:2px}
.msg .x{color:var(--ink-2);display:grid;place-items:center;width:44px;height:44px;margin:-8px -10px 0 -14px}
/* list groups (More) */
.grp{background:var(--sheet);border:1.5px solid var(--line-2);border-radius:16px;overflow:hidden}
.li{display:grid;grid-template-columns:30px 1fr auto;gap:12px;align-items:center;min-height:56px;padding:8px 14px;border-top:1px solid var(--line)}
.li:first-child{border-top:0}
.li .ico{color:var(--ink-2);display:grid;place-items:center}
.li b{display:block;font-size:16.5px;font-weight:750;letter-spacing:-.012em}
.li small{display:block;font-size:13.5px;font-weight:550;color:var(--ink-2);margin-top:1px;line-height:1.3}
.li .end{display:flex;align-items:center;gap:6px;color:var(--ink-3)}
.pillc{font-size:12.5px;font-weight:800;border-radius:7px;padding:3px 7px;background:var(--gold-tint);color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--gold-edge)}
/* switches */
.swr{display:flex;align-items:center;gap:8px;flex:none;min-height:44px}
.swr em{font-style:normal;font-size:14px;font-weight:750;color:var(--ink-2)}
.sw{width:52px;height:32px;border-radius:16px;background:var(--sheet);box-shadow:inset 0 0 0 2px var(--ink-3);position:relative;flex:none}
.sw::after{content:'';position:absolute;top:5px;left:5px;width:22px;height:22px;border-radius:50%;background:var(--ink-3)}
.sw.on{background:var(--done);box-shadow:none}
.sw.on::after{left:25px;top:4px;width:24px;height:24px;background:#fff}
.sw.off-locked{opacity:.55}
/* segmented */
.seg{display:flex;background:var(--paper-2);border-radius:12px;padding:2px;gap:2px}
.seg span{flex:1;height:44px;border-radius:10px;display:grid;place-items:center;font-size:14.5px;font-weight:700;color:var(--ink-2)}
.seg span.on{background:var(--sheet);color:var(--ink);box-shadow:0 0 0 1.5px var(--card-b),0 2px 0 var(--edge);font-weight:800}
`;

function page(name, body, { dark = false, extraCss = '', time = '10:42' , sbColor } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390,initial-scale=1,viewport-fit=cover"><title>${name}</title><style>${CSS}${extraCss}</style></head>
<body class="${dark ? 'dark' : ''}">${statusBar(time, sbColor)}${body}</body></html>`;
}

// ---------- reusable fragments ----------
// medal winners as a 3-up podium strip (disc = the place won; never a count)
const podium = (meds, me) => `<div class="pod">${meds.map(([t, n, k]) => `<span class="pc ${t === me ? 'me' : ''}" style="${tv(t)}"><span class="tp">${md(n, k)}${mark(t, 24)}</span><span class="n2">${T[t].short}</span></span>`).join('')}</div>`;
const gDone = (name, where, meds, me) => `<div class="gr"><span class="st done">${I.check(14)}</span><div><div class="nm">${name}</div><div class="ds">${where}</div></div><span class="rt">${I.chev(18)}</span>
${podium(meds, me)}</div>`;
// a switch always shows its state in words beside it (OFF must be visible in sunlight)
const swh = (on, extra = '') => `<span class="swr"><em>${on ? 'On' : 'Off'}</em><i class="sw ${on ? 'on' : ''} ${extra}"></i></span>`;

const liveBoard = (rows, me) => `<div class="full lb">${rows.map(([t, s], i) => `<div class="lr ${t === me ? 'me' : ''}" style="${tv(t)}"><span class="n">${i + 1}</span>${mark(t, 20)}<span>${T[t].short}</span><b>${s}</b></div>`).join('')}</div>`;

// ================= SCREENS =================
const S = {};

// 01 — Now, games block, counselor
S['01-now-games-counselor'] = page('Now · games · counselor', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Wednesday' })}
<div class="pg">
 <div class="msg"><span class="ic">${I.megaphone(17)}</span><p>Water break at the Snack Shack after Axe Throwing. Bring bottles.<small>Jenn · 10:31</small></p><span class="x">${I.x(16)}</span></div>
 <section class="now">
  <div class="now-k"><span class="left"><b>Now</b> · 10:00–11:45</span><span>63 min left</span></div>
  <div class="bar"><i style="width:40%"></i></div>
  <h1 class="d"><span class="em">🏅</span>Team competitions</h1>
  <div class="rows">
   ${gDone('Axe Throwing', 'Basketball Court · finished 10:31', [['t2', 1, 'g'], ['t0', 2, 's'], ['t1', 3, 'b']], 't0')}
   <div class="gr"><span class="st live"></span><div><div class="nm">Inflatable Bowling <span class="tag live">Live</span></div><div class="ds">Slip and Slide · round 2 of 3</div></div><span class="rt">${I.chev(18)}</span>
   ${liveBoard([['t3', 48], ['t0', 41], ['t2', 36], ['t1', 30], ['t4', 22], ['t5', 19]], 't0')}</div>
   <div class="gr"><span class="st todo"></span><div><div class="nm">Pumpkin Pictionary</div><div class="ds">Chapel Lawn · <b>up next</b></div></div><span class="rt">${I.chev(18)}</span></div>
  </div>
 </section>
 <div class="sec"><div class="sec-h"><span>Later today</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">12:00</span><span class="lb2"><span class="em">🌭</span> Lunch · Hot Dogs<small>John Deersz on cleanup</small></span><span></span></div>
  <div class="rs"><span class="tm">1:15</span><span class="lb2"><span class="em">🎨</span> Elective 1 · you're at Crafts<small>with William</small></span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 3 })}`);

// 02 — Now, games block, director
S['02-now-games-director'] = page('Now · games · director', `
${appBar({ line1: 'Junior camp', line2: 'Jenn · Director · Wednesday' })}
<div class="pg">
 <section class="now" style="margin-top:4px">
  <div class="now-k"><span class="left"><b>Now</b> · 10:00–11:45</span><span>63 min left</span></div>
  <div class="bar"><i style="width:40%"></i></div>
  <h1 class="d"><span class="em">🏅</span>Team competitions</h1>
  <div class="sub">2 of 3 games still to score</div>
  <div class="rows">
   ${gDone('Axe Throwing', 'Basketball Court · saved 10:31', [['t2', 1, 'g'], ['t0', 2, 's'], ['t1', 3, 'b']], '')}
   <div class="gr"><span class="st live"></span><div><div class="nm">Inflatable Bowling <span class="tag live">Live</span></div><div class="ds">Slip and Slide · round 2 of 3</div></div><span class="rt"><span class="btn sm gold">Score</span></span>
   ${liveBoard([['t3', 48], ['t0', 41], ['t2', 36], ['t1', 30], ['t4', 22], ['t5', 19]], '')}</div>
   <div class="gr"><span class="st todo"></span><div><div class="nm">Pumpkin Pictionary</div><div class="ds">Chapel Lawn · <b>up next</b></div></div><span class="rt"><span class="btn sm">Score</span></span></div>
  </div>
 </section>
 <div class="sec"><div class="sec-h"><span>Still to do today</span></div>
  <div class="rs" style="grid-template-columns:28px 1fr auto;align-items:center"><span style="color:var(--ink-2)">${I.broom(20)}</span><span class="lb2">Breakfast cleanup points<small>Foxes · not given yet</small></span><span style="color:var(--ink-3)">${I.chev(18)}</span></div>
  <div class="rs" style="grid-template-columns:28px 1fr auto;align-items:center"><span style="color:var(--ink-2)">${I.book(20)}</span><span class="lb2">Verse points<small>4 of 6 teams done</small></span><span style="color:var(--ink-3)">${I.chev(18)}</span></div>
 </div>
</div>
${tabBar('games' === 'x' ? 'games' : 'now', { chat: 1, moreDot: true })}`);

// 03 — Now, elective, counselor
S['03-now-elective-counselor'] = page('Now · elective · counselor', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Wednesday' })}
<div class="pg">
 <section class="now">
  <div class="now-k"><span class="left"><b>Now</b> · Elective 1 · 1:15–2:00</span><span>28 min left</span></div>
  <div class="bar"><i style="width:38%"></i></div>
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:750;color:var(--ink-2);margin:-10px 0 -10px"><span>Your station</span><a style="color:var(--link);font-weight:800;padding:12px 0 12px 16px">Not Sam? Change</a></div>
  <h1 class="d" style="font-size:30px;margin-top:2px"><span class="em" style="font-size:28px">🎨</span>Crafts with Eileen</h1>
  <div class="sub" style="font-size:15px">with <b style="color:var(--ink)">William</b> · Pumpkins</div>
  <div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:14.5px;font-weight:700;color:var(--ink-2)">${I.cloud(18)}<span>Rain likely around 4 PM · indoor plan: Dining Hall</span></div>
  <div class="rows" style="margin-top:12px">
   <div class="sec-h" style="padding:0 0 2px">Then</div>
   <div class="rs" style="grid-template-columns:52px 1fr"><span class="tm">2:00</span><span class="lb2"><span class="em">🍫</span> Snack Shack break</span></div>
   <div class="rs" style="grid-template-columns:52px 1fr"><span class="tm">3:00</span><span class="lb2"><span class="em">🎲</span> Board Games<small>Elective 2 · with Patrick and Josh</small></span></div>
   <div class="rs" style="grid-template-columns:52px 1fr"><span class="tm">4:00</span><span class="lb2">Break<small>Elective 3 · you're free</small></span></div>
  </div>
  <div class="gr" style="grid-template-columns:1fr auto;padding:13px 0 11px"><div><div class="nm" style="font-size:16px">Who's where</div><div class="ds">5 stations · 8 counselors on break</div></div><span class="rt">${I.chev(18)}</span></div>
 </section>
 <div class="sec"><div class="sec-h"><span>Later today</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">5:00</span><span class="lb2"><span class="em">🍖</span> Supper · Mystery Meat<small>Pilgrims on cleanup</small></span><span></span></div>
  <div class="rs"><span class="tm">6:00</span><span class="lb2"><span class="em">🏅</span> Evening competition<small>Color Call Chaos and 2 more</small></span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 3 })}`, { time: '1:32' });

// 04 — Now, right after lunch, director (cleanup award)
const pts = (sel) => [0, 1, 2, 3].map((n) => `<span class="pt ${n === sel ? 'on' : ''}">${n}</span>`).join('');
S['04-now-after-lunch-director'] = page('Now · after lunch · director', `
${appBar({ line1: 'Junior camp', line2: 'Jenn · Director · Wednesday' })}
<div class="pg">
 <section class="now" style="margin-top:4px">
  <div class="now-k"><span class="left"><b>Now</b> · 12:30–1:00</span><span>22 min left</span></div>
  <div class="bar"><i style="width:27%"></i></div>
  <h1 class="d"><span class="em">🤝</span>Team time</h1>
  <div class="moment">
   <div class="mo-h"><span>Lunch cleanup</span><span class="priv-tag">${I.eyeoff(14)} Points stay with directors</span></div>
   <div class="mo-team">${mark('t5', 52)}<div><b class="d">Runaway John Deersz</b><small>On cleanup after lunch · Lily, Jacob</small></div></div>
   <div class="mo-pts"><span class="lbl">Cleanup points</span><div class="ptrow">${pts(-1)}</div><span class="hint">3 = spotless</span></div>
  </div>
 </section>
 <div class="sec"><div class="sec-h"><span>Still to do today</span></div>
  <div class="rs" style="grid-template-columns:28px 1fr auto;align-items:center"><span style="color:var(--ink-2)">${I.broom(20)}</span><span class="lb2">Breakfast cleanup points<small>Foxes · not given yet</small></span><span style="color:var(--ink-3)">${I.chev(18)}</span></div>
  <div class="rs" style="grid-template-columns:28px 1fr auto;align-items:center"><span style="color:var(--ink-2)">${I.games(20)}</span><span class="lb2">Pumpkin Pictionary<small>No score saved yet</small></span><span style="color:var(--ink-3)">${I.chev(18)}</span></div>
 </div>
 <div class="sec"><div class="sec-h"><span>Up next</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">1:00</span><span class="lb2"><span class="em">🎒</span> Prepare for Elective 1</span><span></span></div>
  <div class="rs"><span class="tm">1:15</span><span class="lb2"><span class="em">🌟</span> Elective 1<small>5 stations · 8 counselors on break</small></span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 1, moreDot: true })}`, {
  time: '12:38', extraCss: `
.moment{margin:12px -14px 0;padding:12px 14px 14px;border-top:1px solid var(--line);background:linear-gradient(var(--gold-tint),var(--gold-tint));border-radius:0 0 16px 16px}
.mo-h{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:800;color:var(--ink)}
.priv-tag{display:inline-flex;gap:5px;align-items:center;font-size:12.5px;font-weight:700;color:var(--ink-2)}
.mo-team{display:flex;gap:12px;align-items:center;margin-top:8px}
.mo-team b{display:block;font-size:21px;font-weight:800;line-height:1.1}
.mo-team small{display:block;font-size:14px;font-weight:600;color:var(--ink-2);margin-top:3px}
.mo-pts{display:grid;grid-template-columns:1fr;gap:6px;margin-top:12px}
.mo-pts .lbl{font-size:13px;font-weight:750;color:var(--ink-2)}
.mo-pts .hint{font-size:13px;font-weight:600;color:var(--ink-2)}
.ptrow{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
.pt{height:52px;border-radius:13px;border:2px solid var(--card-b);background:var(--sheet);box-shadow:0 4px 0 var(--edge);display:grid;place-items:center;font-size:22px;font-weight:850}
.pt.on{background:var(--ink);color:var(--paper)}
` });

// 05 — Now during a reveal, counselor mirror: ONE grouped list with hairlines; the on-screen row is the only accented one
const still = (n) => Array.from({ length: n }, () => `<div class="rv still"><span class="lk">${I.lock(16)}</span><span>Still to come</span></div>`).join('');
const rv = (place, t, p, m, { now = false, me = false } = {}) => `<div class="rv shown ${now ? 'onscreen' : ''}" style="${tv(t)}">
 <span class="pl d">${place}<sup>${ORD(place).slice(-2)}</sup></span>${mark(t, 34)}<span class="nmw"><b>${T[t].name}${me ? ' <span class="yt">Your team</span>' : ''}</b>${now ? '<span class="osn"><i></i>On the big screen now</span>' : ''}<small>${m}</small></span><span class="pp d">${p}<small>points</small></span></div>`;
const REV_CSS = `
.livestrip{position:absolute;top:103px;left:0;right:0;height:40px;background:var(--live);color:#fff;display:flex;align-items:center;gap:9px;padding:0 16px;font-size:15px;font-weight:800;z-index:4}
body.dark .livestrip{color:#1a0505}
.livestrip i{width:10px;height:10px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgba(255,255,255,.28)}
.livestrip span{margin-left:auto;font-weight:700;font-size:14px}
.rvh{margin-top:50px;display:flex;justify-content:space-between;align-items:baseline}
.rvh h2{font-size:24px;font-weight:800;white-space:nowrap}
.rvh span{font-size:15px;font-weight:700;color:var(--ink-2)}
.lad{margin-top:10px;background:var(--sheet);border:1.5px solid var(--line-2);border-radius:16px;overflow:hidden}
.rv{position:relative;display:grid;grid-template-columns:44px 36px 1fr auto;gap:10px;align-items:center;min-height:62px;padding:8px 14px 8px 12px;border-top:1px solid var(--line)}
.rv:first-child{border-top:0}
.rv.still{grid-template-columns:24px 1fr;min-height:44px;color:var(--ink-2);font-size:15px;font-weight:700;background:var(--paper-2);padding-left:16px}
.rv.still .lk{display:grid;place-items:center;color:var(--ink-2)}
.rv.onscreen{box-shadow:inset 6px 0 0 var(--gold)}
.osn{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:850;color:#1f1500;background:var(--gold);padding:2px 8px;border-radius:6px;margin:4px 0 2px}
.osn i{width:7px;height:7px;border-radius:50%;background:#951b14}
.pl{font-size:27px;font-weight:850;line-height:1}
.pl sup{font-size:13px;font-weight:800;vertical-align:11px;margin-left:1px}
.nmw{min-width:0}
.nmw b{display:block;font-size:16.5px;font-weight:800;line-height:1.15;letter-spacing:-.014em}
.nmw small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2);margin-top:2px}
.pp{font-size:26px;font-weight:850;text-align:right;line-height:1}
.pp small{display:block;font-size:12px;font-weight:700;color:var(--ink-2);font-family:Inter;letter-spacing:0;margin-top:3px}
.yt{display:inline-block;font-size:12.5px;font-weight:850;color:var(--ink);box-shadow:inset 0 0 0 2px var(--tc);padding:1px 7px;border-radius:6px;vertical-align:2px;margin-left:4px;font-family:Inter;letter-spacing:0}
.note{font-size:14px;font-weight:600;color:var(--ink-2);margin:12px 2px 0;line-height:1.4}
`;
S['05-now-reveal-counselor'] = page('Now · during the reveal · counselor', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Wednesday' })}
<div class="livestrip"><i></i>Live on the big screen<span>Started 7:31 by Jenn</span></div>
<div class="pg">
 <div class="rvh"><h2 class="d">Tonight's standings</h2><span>3 of 6 shown</span></div>
 <div class="lad">
  ${still(3)}
  ${rv(4, 't0', 22, '2 gold · 1 silver · 1 bronze', { now: true, me: true })}
  ${rv(5, 't4', 18, '1 gold · 1 silver · 2 bronze')}
  ${rv(6, 't5', 15, '1 gold · 1 silver · 1 bronze')}
 </div>
 <p class="note">Places appear here a few seconds after the big screen shows them, and stay until 8 AM tomorrow.</p>
 <div class="sec" style="margin-top:12px"><div class="sec-h"><span>Happening now</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">7:00</span><span class="lb2"><span class="em">⛪</span> Evening service<small>until 8:00 · then snack and campfire</small></span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 3 })}`, { time: '7:36', extraCss: REV_CSS });

// 05b — next morning, the frozen revealed grid until 8 AM: counts in WORDS (discs only ever mean a place won)
const gridRow = (place, t, p, m, v, c, q, me) => `<div class="gx" style="${tv(t)}"><span class="pl d">${place}<sup>${ORD(place).slice(-2)}</sup></span>${mark(t, 30)}<span class="nmw"><b>${T[t].short}${me ? ' <span class="yt">Your team</span>' : ''}</b><small>${m[0]} gold · ${m[1]} silver · ${m[2]} bronze</small><small>verse ${v} · cleanup ${c} · quick ${q}</small></span><span class="pp d">${p}</span></div>`;
S['05b-now-revealed-grid-morning'] = page('Now · morning · revealed grid until 8 AM', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Thursday' })}
<div class="pg">
 <section class="now">
  <div class="now-k"><span class="left"><b>Now</b> · 7:30–8:00</span><span>18 min left</span></div>
  <div class="bar"><i style="width:40%"></i></div>
  <h1 class="d" style="font-size:24px"><span class="em">⏰</span>Rising bell & morning meeting</h1>
  <div class="sub">Laura's cottage · Foxes, Pumpkins and Pilgrims</div>
  <div class="rs" style="grid-template-columns:52px 1fr;margin-top:8px;border-top:1px solid var(--line)"><span class="tm">8:00</span><span class="lb2"><span class="em">🍞</span> Breakfast · French Toast<small>Turkey on cleanup</small></span></div>
 </section>
 <div class="sec"><div class="sec-h" style="display:block"><b style="font-size:17px;color:var(--ink);font-weight:800">Last night's standings</b><span style="display:block;margin-top:1px">Revealed 7:44 PM · hides at 8 AM</span></div>
  <div class="grid">
   ${gridRow(1, 't2', 30, [2, 2, 2], 4, 3, 0)}
   ${gridRow(2, 't1', 27, [3, 0, 2], 3, 2, 1)}
   ${gridRow(3, 't3', 23, [2, 0, 3], 2, 1, 0)}
   ${gridRow(4, 't0', 22, [2, 1, 1], 1, 3, 2, true)}
   ${gridRow(5, 't4', 18, [1, 1, 2], 2, 0, 0)}
   ${gridRow(6, 't5', 15, [1, 1, 1], 1, 1, 0)}
  </div>
 </div>
</div>
${tabBar('now', { chat: 0 })}`, {
  time: '7:42', extraCss: REV_CSS + `
.grid{background:var(--sheet);border:1.5px solid var(--line-2);border-radius:16px;overflow:hidden}
.gx{display:grid;grid-template-columns:40px 32px 1fr auto;gap:9px;align-items:center;padding:7px 14px 7px 10px;border-top:1px solid var(--line)}
.gx:first-child{border-top:0}
.gx .pl{font-size:21px}.gx .pl sup{font-size:12px;vertical-align:8px}
.gx .nmw b{font-size:15.5px}.gx .nmw small{font-size:13px;margin-top:1px}
.gx .pp{font-size:22px}
` });

// ---------- remote (B layout, A light colours) ----------
const REMOTE_CSS = `
.roof{position:absolute;top:0;left:0;right:0;height:103px;background:var(--roof);border-bottom:5px solid var(--roof-edge);color:var(--on-roof);z-index:2}
.roof .row{position:absolute;top:47px;left:0;right:0;height:52px;display:flex;align-items:center;gap:10px;padding:0 14px}
.rback{height:44px;padding:0 12px 0 6px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;gap:2px;font-size:16px;font-weight:750}
.roof h1{font-size:19px;font-weight:800;flex:1}
.chip{display:flex;align-items:center;gap:7px;background:#fff;color:#141a48;font-size:14px;font-weight:800;border-radius:10px;padding:7px 11px 7px 9px}
.chip i{width:9px;height:9px;border-radius:50%;background:#0d542d}
.chip i.live{background:#951b14;box-shadow:0 0 0 3px rgba(149,27,20,.2)}
.rp{position:absolute;top:114px;left:16px;right:16px}
.tvw{border:3px solid var(--tv-frame);border-radius:16px;box-shadow:0 5px 0 var(--tv-edge);overflow:hidden;background:#141a48}
.tvc{width:352px;height:198px;background:#fdfaf2;position:relative;overflow:hidden;color:#141a48}
.tvs{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;color:var(--ink-2);margin:8px 2px 0;white-space:nowrap}
.tvs b{color:var(--ink)}
.awake{display:inline-flex;gap:5px;align-items:center;color:var(--ink-2)}
.ladh{display:flex;justify-content:space-between;align-items:center;margin-top:6px}
.ladh b{font-size:16px;font-weight:800}
.ladh span{font-size:14px;font-weight:700;color:var(--ink-2)}
.endb{height:44px;padding:0 14px;border-radius:12px;border:2px solid var(--card-b);background:var(--sheet);box-shadow:0 3px 0 var(--edge);display:flex;align-items:center;font-size:15px !important;font-weight:800 !important;color:var(--ink) !important}
.rl{margin-top:8px;background:var(--sheet);border:1.5px solid var(--line-2);border-radius:14px;overflow:hidden}
.rr{position:relative;display:grid;grid-template-columns:40px 32px 1fr auto;gap:9px;align-items:center;min-height:44px;padding:0 14px 0 10px;border-top:1px solid var(--line)}
.rr:first-child{border-top:0}
.rr .pl{font-size:22px;font-weight:850}
.rr .pl sup{font-size:12px;vertical-align:9px}
.rr b.n{display:block;font-size:15.5px;font-weight:800;letter-spacing:-.012em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rr .p{font-size:21px;font-weight:850}
.rr .nm2{min-width:0}
.rr.hid{grid-template-columns:40px 1fr;color:var(--ink-2);font-size:15px;font-weight:700;background:var(--paper-2)}
.rr.hid span.h{display:flex;gap:7px;align-items:center}
.rr.nx{grid-template-columns:40px 1fr;min-height:54px;background:repeating-linear-gradient(135deg,var(--hatch1) 0 8px,var(--hatch2) 8px 16px);box-shadow:inset 0 0 0 2px var(--ink)}
.rr.nx .mask{display:flex;gap:10px;align-items:center;color:var(--ink)}
.rr.nx .mask b{display:block;font-size:15px;font-weight:850}
.rr.nx .mask small{display:block;font-size:13px;font-weight:650;color:var(--ink-2)}
.rr.os{min-height:58px;box-shadow:inset 6px 0 0 var(--gold)}
.osl{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:800;color:var(--ink-2);margin-top:1px}
.osl i{width:8px;height:8px;border-radius:50%;background:var(--live)}
.dock{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 40px;background:var(--paper);border-top:1px solid var(--line-2)}
.big{display:flex;flex-direction:column;align-items:center;justify-content:center;height:92px;border-radius:22px;border:3px solid var(--gold-edge);background:var(--gold);box-shadow:0 7px 0 var(--gold-edge);color:#1f1500;position:relative;overflow:hidden}
.big .k{font-size:15px;font-weight:800;position:relative}
.big .m{font-size:38px;font-weight:900;line-height:1.02;letter-spacing:-.03em;position:relative}
.drow{display:grid;grid-template-columns:106px 1fr;gap:24px}
.bk{display:flex;flex-direction:column;align-items:center;justify-content:center;height:92px;border-radius:20px;border:2px solid var(--card-b);background:var(--sheet);box-shadow:0 4px 0 var(--edge);color:var(--ink);font-size:16px;font-weight:850;gap:1px;text-align:center;line-height:1.1}
.bk small{font-size:12.5px;font-weight:700;color:var(--ink-2);line-height:1.15}
.bk.locked{opacity:.5}
`;
const tvHero = `<div class="tvc"><div style="position:absolute;left:18px;top:14px;font-size:14px;font-weight:800;color:#373d72">4th place</div>
<div style="position:absolute;left:18px;top:40px">${mark('t0', 112)}</div>
<div style="position:absolute;left:150px;top:40px;right:12px"><div class="d" style="font-size:27px;font-weight:850;line-height:1.02">Ferocious<br>Foxes</div><div class="d" style="font-size:42px;font-weight:900;margin-top:6px;line-height:1">22 <span style="font-size:15px;font-weight:800">points</span></div>
<div style="font-size:13.5px;font-weight:700;margin-top:10px;color:#373d72">2 gold · 1 silver · 1 bronze</div></div></div>`;
const tvWait = `<div class="tvc" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px"><div class="d" style="font-size:23px;font-weight:850">Waiting for the directors…</div>
<div style="display:flex;gap:10px">${['t0', 't1', 't2', 't3', 't4', 't5'].map((t, i) => `<span style="transform:translateY(${[0, -4, 2, -3, 1, -2][i]}px)">${mark(t, 40)}</span>`).join('')}</div></div>`;

S['06-remote-ready'] = page('Reveal remote · ready', `
<div class="roof"><div class="row"><span class="rback">${I.back(20)}More</span><h1 class="d">Standings reveal</h1><span class="chip"><i></i>2 screens</span></div></div>
<div class="rp">
 <div class="tvw">${tvWait}</div>
 <div class="tvs"><span><b>2 screens</b> · 11 phones open</span><span class="awake">${I.sun(15)}Screen stays on</span></div>
 <div class="ladh"><b>Before you start</b></div>
 <div class="chk">
  <div class="ck"><span class="st done">${I.check(13)}</span><span>Every game today is scored<small>Last score saved 7:29 PM by Patrick</small></span></div>
  <div class="ck"><span class="st done">${I.check(13)}</span><span>This phone is up to date<small>Connected · nothing waiting to send</small></span></div>
  <div class="ck"><span class="st done">${I.check(13)}</span><span>2 big screens are ready<small>Dining Hall TV (Jenn) · Tabernacle projector (Sam)</small></span></div>
 </div>
 <div class="opt"><span><b>Practice run</b><small>Made-up points on the big screens only. Phones never see it and nobody is buzzed.</small></span>${swh(false)}</div>
 <div class="opt"><span><b>Buzz all 38 counselors</b><small>"The standings reveal is starting"</small></span>${swh(true)}</div>
</div>
<div class="dock"><div class="big"><span class="k">Freezes the standings at 7:31 PM</span><span class="m d" style="font-size:34px">Start the reveal</span></div></div>
<i class="hi"></i>`, {
  time: '7:31', sbColor: '#fff', extraCss: REMOTE_CSS + `
.chk{margin-top:6px;background:var(--sheet);border:1.5px solid var(--line-2);border-radius:14px;padding:2px 12px}
.ck{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
.ck:first-child{border-top:0}
.ck span{font-size:15px;font-weight:750;line-height:1.2}
.ck small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2);margin-top:1px}
.opt{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 2px 0}
.opt b{display:block;font-size:16px;font-weight:800}
.opt small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2);margin-top:1px;line-height:1.3}
` });

const ladder07 = `
 <div class="rl">
  <div class="rr hid"><span class="pl d">1<sup>st</sup></span><span class="h">${I.lock(15)}Hidden until you reveal it</span></div>
  <div class="rr hid"><span class="pl d">2<sup>nd</sup></span><span class="h">${I.lock(15)}Hidden until you reveal it</span></div>
  <div class="rr nx"><span class="pl d">3<sup>rd</sup></span><span class="mask">${I.eyeoff(18)}<span><b>Up next · only on this phone</b><small>Press and hold to peek</small></span></span></div>
  <div class="rr os"><span class="pl d">4<sup>th</sup></span>${mark('t0', 30)}<span class="nm2"><b class="n">Ferocious Foxes</b><span class="osl"><i></i>On the big screen now</span></span><span class="p d">22</span></div>
  <div class="rr"><span class="pl d">5<sup>th</sup></span>${mark('t4', 30)}<b class="n">Patriotic Pilgrims</b><span class="p d">18</span></div>
  <div class="rr"><span class="pl d">6<sup>th</sup></span>${mark('t5', 30)}<b class="n">Runaway John Deersz</b><span class="p d">15</span></div>
 </div>`;
const dock07 = `<div class="drow"><div class="bk">${I.rewind(22)}<span>Back</span><small>show 5th again</small></div><div class="big"><span class="k">Reveal</span><span class="m d">3rd place</span></div></div>`;
S['07-remote-mid-reveal'] = page('Reveal remote · mid-reveal', `
<div class="roof"><div class="row"><span class="rback">${I.back(20)}More</span><h1 class="d">Reveal</h1><span class="chip"><i class="live"></i>Live · 2 screens</span></div></div>
<div class="rp">
 <div class="tvw">${tvHero}</div>
 <div class="tvs"><span><b>2 screens</b> · 11 phones</span><span class="awake">${I.sun(15)}Screen stays on</span></div>
 <div class="ladh"><span><b>Places</b> · 3 of 6 shown</span><span class="endb">End reveal</span></div>
 ${ladder07}
</div>
<div class="dock">${dock07}</div>
<i class="hi"></i>`, { time: '7:36', sbColor: '#fff', extraCss: REMOTE_CSS });

// 07b — the remote on a small phone (iPhone SE 375x667; also shot at 360x640): the mini TV collapses to a thumbnail row
const SE_CSS = `
.sb{height:20px;padding:3px 10px 0 12px;font-size:13px}.sb .island{display:none}.sb .sy{height:14px;transform:scale(.8);transform-origin:right top}
.roof{height:76px}.roof .row{top:22px}
.rp{top:86px}
.tvrow{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center}
.tvrow .tvw{width:150px;height:89px;border-width:2px;box-shadow:0 3px 0 var(--tv-edge);border-radius:10px}
.tvrow .tvc{transform:scale(.418);transform-origin:0 0}
.tvrow b{display:block;font-size:15px;font-weight:800;line-height:1.2}
.tvrow small{display:block;font-size:13px;font-weight:650;color:var(--ink-2);margin-top:3px;line-height:1.3}
.dock{padding:10px 16px 14px}
`;
S['07b-remote-small'] = page('Reveal remote · small phone', `
<div class="roof"><div class="row"><span class="rback">${I.back(20)}More</span><h1 class="d">Reveal</h1><span class="chip"><i class="live"></i>Live · 2</span></div></div>
<div class="rp">
 <div class="tvrow"><div class="tvw">${tvHero}</div><div><b>4th place on the big screen</b><small>2 big screens · 11 phones</small><small style="display:flex;gap:4px;align-items:center">${I.sun(13)} Screen stays on</small></div></div>
 <div class="ladh"><span><b>Places</b> · 3 of 6</span><span class="endb">End reveal</span></div>
 ${ladder07}
</div>
<div class="dock">${dock07}</div>`, { time: '7:36', sbColor: '#fff', extraCss: REMOTE_CSS + SE_CSS });

// 07c — every other state of the remote's dock, plus the End confirm (a Jelly dialog in the new palette)
const stateBlock = (cap, note, inner) => `<section class="stb"><h3>${cap}</h3>${note ? `<p>${note}</p>` : ''}<div class="dk">${inner}</div></section>`;
S['07c-remote-states'] = page('Reveal remote · states', `
<div class="roof"><div class="row"><span class="rback">${I.back(20)}More</span><h1 class="d">Reveal · every state</h1></div></div>
<div class="sts">
${stateBlock('1 · Recharging after "Reveal 4th place"', 'The wait is written on the button. Back is locked for the same beat.',
  `<div class="drow"><div class="bk locked">${I.lock(20)}<span>Back</span><small>after the score</small></div><div class="big charging"><i class="fill" style="width:38%"></i><span class="k">Showing the name… 3</span><span class="m d" style="font-size:30px">3rd place next</span></div></div>`)}
${stateBlock('2 · Tapped too soon', 'A short shake and one line. Nothing is sent.',
  `<div class="jt"><i></i>Wait 3 seconds. The big screen is still showing 4th place.</div><div class="drow"><div class="bk locked">${I.lock(20)}<span>Back</span><small>after the score</small></div><div class="big charging shake"><i class="fill" style="width:52%"></i><span class="k">Showing the score… 2</span><span class="m d" style="font-size:30px">3rd place next</span></div></div>`)}
${stateBlock('3 · Not connected', 'Taps would not reach the big screens, so nothing can be pressed.',
  `<div class="drow"><div class="bk off">${I.rewind(20)}<span>Back</span></div><div class="big off"><span class="k">Reconnecting… 2 s</span><span class="m d" style="font-size:22px;letter-spacing:-.01em">Your taps would not reach the big screens</span></div></div>`)}
${stateBlock('4 · Friday, after 1st place', '', `<div class="drow"><div class="bk">${I.rewind(20)}<span>Back</span><small>show 1st again</small></div><div class="big"><span class="k">Friday finale</span><span class="m d" style="font-size:32px">Crown the champions</span></div></div>`)}
${stateBlock('5 · Champions on screen', '', `<div class="drow"><div class="bk">${I.rewind(20)}<span>Back</span><small>show 1st again</small></div><div class="big"><span class="k">Next</span><span class="m d" style="font-size:32px">Show the final table</span></div></div>`)}
${stateBlock('6 · Final table on screen', 'Phones now show the full table under the normal Now screen; the red strip goes away.', `<div class="drow"><div class="bk">${I.rewind(20)}<span>Back</span><small>champions</small></div><div class="big"><span class="k">All places shown</span><span class="m d" style="font-size:32px">End the reveal</span></div></div>
<div class="dlg"><b class="d">End the reveal?</b><p>Counselors keep tonight's standings until 8 AM tomorrow. The big screens go back to waiting.</p><div class="dlgb"><span class="btn">Keep showing</span><span class="btn gold">End the reveal</span></div></div>`)}
${stateBlock('7 · Ended', 'A new reveal replaces tonight\'s on every phone, so it asks first.', `<div class="ended"><span class="st done">${I.check(13)}</span><span>Last reveal ended 7:52 PM<small>Counselors see it until 8 AM tomorrow</small></span></div><div class="big"><span class="k">Replaces tonight's</span><span class="m d" style="font-size:32px">Start a new reveal</span></div>`)}
${stateBlock('8 · Rules not published yet', 'No button that would only lead to a refusal.', `<div class="rules">${I.lock(22)}<span><b>The reveal isn't switched on yet</b><small>The database rules need one update. Patrick runs it from Cloud Shell; until then counselor phones show no standings at all.</small></span></div>`)}
</div>`, {
  time: '7:40', sbColor: '#fff', extraCss: REMOTE_CSS + `
html,body{height:auto;overflow:visible}
.sts{padding:114px 16px 30px}
.stb{margin-bottom:18px}
.stb h3{font-size:16px;font-weight:850;margin:0 2px 2px}
.stb p{font-size:14px;font-weight:600;color:var(--ink-2);margin:0 2px 8px;line-height:1.35}
.dk{padding:12px 14px 16px;background:var(--paper);border:1.5px solid var(--line-2);border-radius:16px}
.dk .big .m{font-size:25px !important;text-align:center;line-height:1.05}
.dk .big .k{font-size:14.5px}
.dk .drow{grid-template-columns:100px 1fr;gap:20px}
.big.charging{background:#f2d27c;border-color:var(--gold-edge)}
.big .fill{position:absolute;left:0;top:0;bottom:0;background:var(--gold);border-right:2px solid var(--gold-edge)}
.big.shake{transform:translateX(-4px) rotate(-.6deg)}
.big.off,.bk.off{background:var(--paper-2);border:2px dashed var(--ink-3);box-shadow:none;color:var(--ink-2)}
.big.off .m{font-size:18px !important;font-weight:800;text-align:center;padding:0 12px;line-height:1.15}
.jt{display:flex;gap:9px;align-items:center;background:var(--sheet);border:1.5px solid var(--line-2);box-shadow:0 6px 18px rgba(20,26,72,.16);border-radius:14px;padding:10px 12px;font-size:14.5px;font-weight:700;margin:0 0 12px}
.jt i{width:10px;height:10px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 2px var(--gold-edge);flex:none}
.dlg{margin-top:14px;background:var(--sheet);border:2px solid var(--card-b);border-radius:20px;box-shadow:0 5px 0 var(--edge);padding:16px}
.dlg b{display:block;font-size:21px;font-weight:850}
.dlg p{font-size:15px;font-weight:600;color:var(--ink-2);margin:6px 0 14px;line-height:1.4}
.dlgb{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ended{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:center;font-size:15px;font-weight:750;margin-bottom:12px}
.ended small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2)}
.rules{display:grid;grid-template-columns:28px 1fr;gap:12px;align-items:start;color:var(--ink)}
.rules b{display:block;font-size:16px;font-weight:850}
.rules small{display:block;font-size:14px;font-weight:600;color:var(--ink-2);margin-top:3px;line-height:1.4}
` });

// 08 — Games tab, director, live standings on top (medal counts in words; arrows labelled once)
const stRow = (n, t, p, mv, m) => `<div class="sr" style="${tv(t)}"><span class="pl d">${n}</span><span class="mv ${mv > 0 ? 'up' : mv < 0 ? 'dn' : ''}">${mv > 0 ? I.arrowUp(12) + mv : mv < 0 ? I.arrowDn(12) + -mv : '–'}</span>${mark(t, 28)}<span class="nmw"><b>${T[t].short}</b><small>${m[0]} gold · ${m[1]} silver · ${m[2]} bronze</small></span><span class="pp d">${p}</span></div>`;
S['08-games-director'] = page('Games · director', `
<header class="ab"><b class="title-ab d">Games</b><div class="ab-r" style="margin-left:auto"><span style="font-size:14px;font-weight:700;color:var(--ink-2)">Junior camp</span></div></header>
<div class="pg">
 <div class="days">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<span class="${i === 2 ? 'on' : ''}">${d}${i === 2 ? '<i>Today</i>' : i < 2 ? '<i class="ok">Done</i>' : '<i>&nbsp;</i>'}</span>`).join('')}</div>
 <div class="stand">
  <div class="sth"><b>Live standings</b><span class="priv">${I.eyeoff(14)} Counselors can't see this</span></div>
  <div class="sts2">Arrows: places moved since this morning · tap a team to give quick points</div>
  ${stRow(1, 't2', 30, 1, [2, 2, 2])}${stRow(2, 't1', 27, -1, [3, 0, 2])}${stRow(3, 't3', 23, 0, [2, 0, 3])}${stRow(4, 't0', 22, 2, [2, 1, 1])}${stRow(5, 't4', 18, -1, [1, 1, 2])}${stRow(6, 't5', 15, -1, [1, 1, 1])}
  <div class="gap">Turkey trail Maples by 3. One gold for Turkey would put them in front.</div>
  <div class="revl">${I.tv(18)}<span>Reveal these on the big screen</span>${I.chev(16)}</div>
 </div>
 <div class="sec"><div class="sec-h"><span>Morning · Team competitions · 10:00–11:45</span></div>
  <div class="rows flat">
   ${gDone('Axe Throwing', 'Basketball Court · saved 10:31', [['t2', 1, 'g'], ['t0', 2, 's'], ['t1', 3, 'b']], '')}
   <div class="gr"><span class="st live"></span><div><div class="nm">Inflatable Bowling <span class="tag live">Live</span></div><div class="ds">Pumpkins lead · 48 to 41</div></div><span class="rt"><span class="btn sm gold">Score</span></span></div>
   <div class="gr"><span class="st todo"></span><div><div class="nm">Pumpkin Pictionary</div><div class="ds">Chapel Lawn · up next</div></div><span class="rt"><span class="btn sm">Score</span></span></div>
  </div>
 </div>
</div>
${tabBar('games', { chat: 1, moreDot: true })}`, {
  extraCss: `
.ab{gap:6px}
.days{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;background:var(--paper-2);border-radius:13px;padding:4px}
.days span{height:48px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:15px;font-weight:750;color:var(--ink-2);line-height:1.1}
.days span i{font-style:normal;font-size:12px;font-weight:800;color:var(--ink-2)}
.days span i.ok{color:var(--done)}
.days span.on{background:var(--sheet);color:var(--ink);box-shadow:0 0 0 2px var(--card-b),0 3px 0 var(--edge);font-weight:850}
.days span.on i{color:var(--link)}
.stand{margin-top:12px;background:var(--sheet);border:1.5px solid var(--line-2);border-radius:16px;padding:10px 12px 6px}
.sth{display:flex;justify-content:space-between;align-items:center;padding-bottom:2px}
.sth b{font-size:16px;font-weight:850}
.priv{display:inline-flex;gap:5px;align-items:center;font-size:13px;font-weight:750;color:var(--ink-2)}
.sts2{font-size:13px;font-weight:600;color:var(--ink-2);padding:0 0 6px;line-height:1.3}
.sr{display:grid;grid-template-columns:20px 30px 28px 1fr auto;gap:8px;align-items:center;min-height:46px;border-top:1px solid var(--line)}
.sr .pl{font-size:19px;font-weight:850}
.mv{display:flex;align-items:center;gap:1px;font-size:13px;font-weight:800;color:var(--ink-2)}
.mv.up{color:var(--done)}.mv.dn{color:var(--live)}
.sr .nmw{min-width:0}
.sr .nmw b,.sr .nmw small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr .nmw b{font-size:16px;font-weight:800;line-height:1.15}
.sr .nmw small{font-size:13px;font-weight:600;color:var(--ink-2);margin:1px 0 0}
.sr .pp{font-size:21px;font-weight:850}
.gap{font-size:14.5px;font-weight:650;line-height:1.35;color:var(--ink);padding:8px 0 6px;border-top:1px solid var(--line)}
.revl{display:flex;align-items:center;gap:8px;color:var(--link);font-size:15px;font-weight:800;min-height:44px;border-top:1px solid var(--line)}
.revl span{flex:1}
.rows.flat .gr{padding:9px 0}
` });

// 09 — More tab, director
S['09-more-director'] = page('More · director', `
<header class="ab"><b class="title-ab d">More</b><div class="ab-r" style="margin-left:auto"><span style="font-size:13px;font-weight:700;color:var(--ink-2)">Jenn · Director</span></div></header>
<div class="pg">
 <div class="sec-h" style="margin-top:2px"><span>Director</span><span style="display:inline-flex;gap:5px;align-items:center">${I.eyeoff(14)} Only directors see this</span></div>
 <div class="runrev"><span class="ri">${I.tv(24)}</span><span class="rt2"><b class="d">Run the reveal</b><small><i></i>Ready · 2 big screens online</small></span>${I.chev(20)}</div>
 <div class="grp" style="margin-top:12px">
  <div class="li"><span class="ico">${I.megaphone(21)}</span><span><b>Tell everyone</b><small>Banner, buzz phones or the big notice</small></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.star(21)}</span><span><b>Award points</b><small>Verse, cleanup and quick points</small></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.eye(21)}</span><span><b>What counselors see</b><small>Sections on or off · preview</small></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.cal(21)}</span><span><b>Set up the week</b><small>Schedule, games, teams</small></span><span class="end"><span class="pillc">1 asking to join</span>${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.history(21)}</span><span><b>Change history</b><small>Who saved what, and when</small></span><span class="end">${I.chev(18)}</span></div>
 </div>
 <div class="sec-h" style="margin-top:16px"><span>Camp</span></div>
 <div class="grp">
  <div class="li"><span class="ico">${I.cal(21)}</span><span><b>Full schedule</b></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.book(21)}</span><span><b>Memory verse</b></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.broom(21)}</span><span><b>Meal cleanup</b></span><span class="end">${I.chev(18)}</span></div>
 </div>
</div>
${tabBar('more', { chat: 1 })}`, {
  extraCss: `
.runrev{display:grid;grid-template-columns:46px 1fr auto;gap:12px;align-items:center;height:76px;padding:0 14px 0 12px;border-radius:18px;background:var(--gold);border:2.5px solid var(--gold-edge);box-shadow:0 5px 0 var(--gold-edge);color:#1f1500}
.ri{width:46px;height:46px;border-radius:13px;background:#141a48;color:#fff;display:grid;place-items:center}
.rt2 b{display:block;font-size:21px;font-weight:850}
.rt2 small{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;margin-top:2px}
.rt2 small i{width:9px;height:9px;border-radius:50%;background:#0d542d;box-shadow:0 0 0 2px rgba(255,255,255,.6)}
.li{min-height:54px}
` });

// 10 — Tell everyone composer: Showing now (take down), quick alerts, buzz OFF by default; the Send button says when it buzzes
S['10-tell-everyone'] = page('Tell everyone', `
<div class="roof"><div class="row"><span class="rback">${I.back(20)}More</span><h1 class="d">Tell everyone</h1></div></div>
<div class="rp" style="top:114px">
 <div class="sec-h"><span>Showing now</span></div>
 <div class="grp"><div class="li sn"><span class="ico">${I.megaphone(20)}</span><span><b>Water break at the Snack Shack…</b><small>Banner · ends in 38 min</small></span><span class="btn sm">Take down</span></div></div>
 <div class="sec-h" style="margin-top:12px"><span>Quick alerts · buzz everyone, urgent</span></div>
 <div class="pre"><span class="btn">Come inside now</span><span class="btn">All to the Dining Hall</span><span class="btn">Stay where you are</span></div>
 <div class="ta"><p>Supper moves to 5:30. The kitchen is running late. Finish your game, then head to the Dining Hall at 5:25.</p><span class="cc">118 / 280</span></div>
 <div class="sec-h" style="margin-top:12px"><span>How it reaches people</span></div>
 <div class="grp">
  <div class="ch"><span class="cb on">${I.check(15)}</span><span><b>Banner at the top of the app</b><small>Everyone sees it on Now until it ends</small></span></div>
  <div class="chx"><div class="seg"><span class="on">1 hour</span><span>3 hours</span><span>All day</span></div></div>
  <div class="ch"><span class="cb on">${I.check(15)}</span><span><b>Buzz phones</b><small>Off unless you tick it · can't be taken back</small></span></div>
  <div class="chx"><div class="seg"><span class="on">Everyone</span><span>A team</span><span>Directors</span></div>
   <div class="urg"><span><b>Urgent</b><small>Rings even if someone muted director alerts</small></span>${swh(false)}</div></div>
  <div class="ch"><span class="cb"></span><span><b>Pin as the big notice</b><small>Stays at the top until someone takes it down</small></span></div>
 </div>
</div>
<div class="dock"><div class="big" style="height:66px;border-radius:18px"><span class="m d" style="font-size:25px">Send + buzz everyone</span></div></div>
<i class="hi"></i>`, {
  time: '4:52', sbColor: '#fff', extraCss: REMOTE_CSS + `
.sn{min-height:60px}
.sn b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15.5px}
.li{grid-template-columns:26px minmax(0,1fr) auto}
.li > span:nth-child(2){min-width:0}
.pre{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pre .btn{height:58px;font-size:14.5px;padding:0 6px;white-space:normal;text-align:center;line-height:1.15}
.ta{margin-top:12px;background:var(--sheet);border:2px solid var(--card-b);border-radius:16px;box-shadow:0 3px 0 var(--edge);padding:12px 14px 10px;min-height:112px;position:relative}
.ta p{font-size:17px;font-weight:600;line-height:1.4}
.ta .cc{position:absolute;right:12px;bottom:8px;font-size:13px;font-weight:700;color:var(--ink-2)}
.ch{display:grid;grid-template-columns:44px 1fr;gap:6px;align-items:center;padding:6px 14px 4px 6px;border-top:1px solid var(--line)}
.ch:first-child{border-top:0}
.ch b{display:block;font-size:16px;font-weight:800}
.ch small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2);margin-top:1px}
.cb{width:30px;height:30px;margin:7px;border-radius:8px;border:2px solid var(--card-b);box-shadow:0 2px 0 var(--edge);display:grid;place-items:center;background:var(--sheet)}
.cb.on{background:var(--ink);color:var(--paper)}
.chx{padding:0 14px 10px 50px}
.urg{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:6px}
.urg b{display:block;font-size:15px;font-weight:800}
.urg small{display:block;font-size:13px;font-weight:600;color:var(--ink-2)}
.dock{padding-top:12px}
` });

// 11 — TV page waiting (1280x720)
const TV_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Big screen · waiting</title><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:720px;overflow:hidden}
body{background:#f5efe2;color:#141a48;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.d{font-family:'Inter Display','Inter',system-ui;letter-spacing:-.025em}
.top{position:absolute;top:40px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:center}
.camp{display:flex;gap:14px;align-items:center;font-size:24px;font-weight:800}
.camp i{width:46px;height:46px;border-radius:13px;background:#2c47ee;color:#fff;display:grid;place-items:center}
.conn{display:flex;gap:10px;align-items:center;font-size:19px;font-weight:700;color:#373d72}
.conn i{width:12px;height:12px;border-radius:50%;background:#17763f;box-shadow:0 0 0 5px rgba(23,118,63,.15)}
h1{position:absolute;top:196px;left:0;right:0;text-align:center;font-size:84px;font-weight:850}
p{position:absolute;top:310px;left:0;right:0;text-align:center;font-size:28px;font-weight:600;color:#373d72}
.row{position:absolute;bottom:92px;left:0;right:0;display:flex;justify-content:center;gap:34px}
.row img{width:128px;filter:drop-shadow(0 4px 5px rgba(20,26,72,.3))}
.foot{position:absolute;bottom:34px;left:0;right:0;text-align:center;font-size:17px;font-weight:650;color:#565c88}
</style></head><body>
<div class="top"><div class="camp"><i>${I.sun(26)}</i>Junior camp · Standings</div><div class="conn"><i></i>Connected · this screen is ready</div></div>
<h1 class="d">Waiting for the directors…</h1>
<p>The standings reveal will start here. Nothing is shown until a director starts it.</p>
<div class="row">${['t0', 't1', 't2', 't3', 't4', 't5'].map((t, i) => `<img src="${SH}${T[t].img}" style="transform:translateY(${[0, -10, 4, -6, 2, -8][i]}px) rotate(${[-3, 2, -1, 3, -2, 1][i]}deg)">`).join('')}</div>
<div class="foot">Directors run the reveal from their phones: More, then Run the reveal.</div>
</body></html>`;

// 12 — dark mode: Now during Bible study (counselor)
S['12-now-bible-study-dark'] = page('Now · Bible study · dark', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Wednesday' })}
<div class="pg">
 <section class="now">
  <div class="now-k"><span class="left"><b>Now</b> · 9:00–9:45</span><span>18 min left</span></div>
  <div class="bar"><i style="width:60%"></i></div>
  <h1 class="d"><span class="em">📖</span>Bible study</h1>
  <div style="font-size:13px;font-weight:750;color:var(--ink-2);margin-top:12px">Today's memory verse</div>
  <blockquote class="vs">There is therefore now no condemnation for those who are in Christ Jesus.</blockquote>
  <div class="ref">Romans 8:1 ESV</div>
  <div class="theme">Week theme · Harvest of the Heart · Galatians 2:20</div>
 </section>
 <div class="sec"><div class="sec-h"><span>Up next</span></div>
  <div class="rs"><span class="tm">9:45</span><span class="lb2"><span class="em">📣</span> Team huddle<small>Get ready for competitions</small></span><span></span></div>
 </div>
 <div class="sec"><div class="sec-h"><span>Later today</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">10:00</span><span class="lb2"><span class="em">🏅</span> Team competitions<small>Axe Throwing, Inflatable Bowling, Pumpkin Pictionary</small></span><span></span></div>
  <div class="rs"><span class="tm">12:00</span><span class="lb2"><span class="em">🌭</span> Lunch · Hot Dogs<small>John Deersz on cleanup</small></span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 3 })}`, {
  dark: true, time: '9:27', sbColor: '#fff', extraCss: `
.vs{font-family:'New York','Iowan Old Style',Georgia,serif;font-size:23px;line-height:1.42;font-weight:500;margin-top:6px;letter-spacing:0}
.ref{font-size:15px;font-weight:800;margin-top:8px}
.theme{font-size:13.5px;font-weight:600;color:var(--ink-2);margin:12px -14px 0;padding:10px 14px 12px;border-top:1px solid var(--line)}
` });

// 13 — senior: Now during the Legacy Game (4-team bracket), counselor
const bm = (label, a, b, state, extra = '') => `<div class="bmx ${state}"><div class="bl">${label}${state === 'live' ? ' <span class="tag live">Live</span>' : state === 'done' ? ' <span class="tag done">Done</span>' : ''}</div>
<div class="bt ${extra === 'a' ? 'win' : ''}">${a[0] ? mark(a[0], 24) : '<i class="tbd"></i>'}<span>${a[1]}</span>${a[2] !== undefined ? `<b>${a[2]}</b>` : ''}</div>
<div class="bt ${extra === 'b' ? 'win' : ''}">${b[0] ? mark(b[0], 24) : '<i class="tbd"></i>'}<span>${b[1]}</span>${b[2] !== undefined ? `<b>${b[2]}</b>` : ''}</div></div>`;
S['13-senior-now-legacy-game'] = page('Senior · Now · Legacy Game', `
${appBar({ team: 's0', line1: 'Red Team', line2: 'Senior camp · Thursday' })}
<div class="pg">
 <section class="now">
  <div class="now-k"><span class="left"><b>Now</b> · 4:50–5:30</span><span>24 min left</span></div>
  <div class="bar"><i style="width:40%"></i></div>
  <h1 class="d"><span class="em">🏆</span>Legacy Game</h1>
  <div class="sub">4-team bracket · Main field</div>
  <div class="you">${mark('s0', 24)}<span>Red plays in the final next · 3rd place match first</span></div>
  <div class="brk">
   ${bm('Semifinal 1', ['s0', 'Red', 2], ['s3', 'Gold', 1], 'done', 'a')}
   ${bm('Semifinal 2', ['s1', 'Blue', 3], ['s2', 'Green', 2], 'live')}
   ${bm('3rd place', ['s3', 'Gold'], ['', 'Semi 2 loser'], 'todo')}
   ${bm('Final', ['s0', 'Red'], ['', 'Semi 2 winner'], 'todo')}
  </div>
 </section>
 <div class="sec"><div class="sec-h"><span>Later today</span><a>Whole day ${I.chev(14)}</a></div>
  <div class="rs"><span class="tm">5:45</span><span class="lb2"><span class="em">🍲</span> Supper and free time</span><span></span></div>
  <div class="rs"><span class="tm">6:50</span><span class="lb2"><span class="em">🎤</span> Hot Seat and Let's Make a Deal</span><span></span></div>
 </div>
</div>
${tabBar('now', { chat: 2 })}`, {
  time: '5:06', extraCss: `
.you{margin-top:10px;font-size:15px;font-weight:750;display:flex;gap:8px;align-items:center}
.brk{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 10px}
.bmx{border:1.5px solid var(--line-2);border-radius:13px;padding:8px 10px 6px}
.bmx.live{border:2px solid var(--live)}
.bmx.todo{border:1.5px dashed var(--ink-3)}
.bl{font-size:13px;font-weight:800;color:var(--ink-2);margin-bottom:4px;display:flex;align-items:center;gap:5px}
.bl .tag{font-size:12px;padding:1px 5px}
.bt{display:flex;align-items:center;gap:7px;height:32px;font-size:15px;font-weight:700}
.bt b{margin-left:auto;font-size:18px;font-weight:850}
.bt.win span{font-weight:850}
.bt.win::after{content:'won';margin-left:4px;font-size:12px;font-weight:800;color:var(--done)}
.bmx.done .bt:not(.win){color:var(--ink-3)}
.tbd{width:24px;height:24px;border-radius:7px;border:2px dashed var(--ink-3);flex:none}
.bmx.todo .bt span{font-size:14px}
` });

// 01b — 360 wide, the block is RUNNING OVER (a game is still live after 11:45), widest podium + a 20-character P2 short name
T.x2 = { ...T.t2, short: 'Methodic Mediocre Ma' };
S['01b-now-running-over-360'] = page('Now · running over · 360 wide', `
${appBar({ team: 't0', line1: 'Ferocious Foxes', line2: 'Sam · Junior camp · Wednesday' })}
<div class="pg">
 <section class="now">
  <div class="now-k"><span class="left"><b>Running over</b> · 10:00–11:45</span><span>7 min over</span></div>
  <div class="bar"><i style="width:100%;background:var(--live)"></i></div>
  <h1 class="d"><span class="em">🏅</span>Team competitions</h1>
  <div class="sub">Still going · Lunch at 12:00</div>
  <div class="rows">
   ${gDone('Axe Throwing', 'Basketball Court · finished 10:31', [['t3', 1, 'g'], ['t5', 2, 's'], ['t4', 3, 'b']], 't0')}
   ${gDone('Pumpkin Pictionary', 'Chapel Lawn · finished 11:20', [['x2', 1, 'g'], ['t0', 2, 's'], ['t5', 3, 'b']], 't0')}
   <div class="gr"><span class="st live"></span><div><div class="nm">Inflatable Bowling <span class="tag live">Live</span></div><div class="ds">Slip and Slide · round 3 of 3</div></div><span class="rt">${I.chev(18)}</span></div>
  </div>
 </section>
</div>
${tabBar('now', { chat: 3 })}`, { time: '11:52' });

// 14 — game takeover, director scoring a podium game: three rows of shields, 3 taps + Save
const pickBtn = (t, st = '') => `<span class="pk ${st}">${mark(t, 26)}<span>${T[t].short}</span>${st === 'on' ? `<i class="ok">${I.check(12)}</i>` : st.startsWith('used') ? `<em>${st === 'used-g' ? 'Gold' : 'Silver'}</em>` : ''}</span>`;
const medalRow = (label, n, k, picks) => `<div class="mrow"><div class="mh">${md(n, k)}<b>${label}</b><span>${{ g: 7, s: 5, b: 3 }[k]} points</span></div><div class="pks">${picks}</div></div>`;
const TK_CSS = `
.tk-h{position:absolute;top:47px;left:0;right:0;height:60px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--line-2);background:var(--paper);z-index:3}
.tback{height:44px;display:flex;align-items:center;gap:1px;font-size:16px;font-weight:750;color:var(--link);padding-right:6px}
.tk-h .tt{min-width:0}
.tk-h .tt b{display:block;font-size:18px;font-weight:850;line-height:1.15}
.tk-h .tt small{display:block;font-size:13.5px;font-weight:600;color:var(--ink-2)}
.tk{position:absolute;top:107px;left:16px;right:16px}
.howto{display:flex;justify-content:space-between;align-items:center;min-height:48px;font-size:15.5px;font-weight:750;border-bottom:1px solid var(--line)}
.mrow{margin-top:10px}
.mh{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.mh b{font-size:17px;font-weight:850}
.mh span{font-size:14px;font-weight:650;color:var(--ink-2)}
.pks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pk{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:64px;padding:0 6px;border-radius:12px;border:2px solid var(--card-b);background:var(--sheet);box-shadow:0 3px 0 var(--edge);font-size:14.5px;font-weight:800;min-width:0}
.pk span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pk.on{background:var(--gold-tint);border:2.5px solid var(--gold-edge);box-shadow:0 3px 0 var(--gold-edge)}
.pk .ok{position:absolute;top:-7px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--done);color:#fff;display:grid;place-items:center;font-style:normal}
.pk.used-g,.pk.used-s{box-shadow:none;border:2px dashed var(--ink-3);background:transparent;color:var(--ink-2)}
.pk.used-g img,.pk.used-s img{opacity:.45}
.pk em{position:absolute;top:4px;right:7px;font-style:normal;font-size:12px;font-weight:800;color:var(--ink-2)}
.tdock{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 40px;background:var(--paper);border-top:1px solid var(--line-2)}
.save{display:flex;align-items:center;justify-content:center;height:62px;border-radius:18px;border:3px solid var(--gold-edge);background:var(--gold);box-shadow:0 6px 0 var(--gold-edge);font-size:22px;font-weight:900;color:#1f1500}
.save.wait{background:var(--paper-2);border:2px dashed var(--ink-3);box-shadow:none;color:var(--ink-2);font-size:17px;font-weight:800}
.ndock{display:grid;grid-template-columns:110px 1fr;gap:12px}
.ndock .btn{height:62px;border-radius:16px;white-space:normal;text-align:center;line-height:1.15}
.ndock .save{font-size:19px;line-height:1.1;text-align:center;padding:0 10px;flex-direction:column}
.ndock .save small{font-size:13.5px;font-weight:750}
.res{margin-top:10px;background:var(--sheet);border:1.5px solid var(--line-2);border-radius:16px;overflow:hidden}
.rz{display:grid;grid-template-columns:24px 34px 1fr auto;gap:10px;align-items:center;min-height:54px;padding:6px 14px;border-top:1px solid var(--line)}
.rz:first-child{border-top:0}
.rz b{font-size:16px;font-weight:800}
.rz span.pt2{font-size:14px;font-weight:750;color:var(--ink-2)}
.saved{display:flex;gap:8px;align-items:center;font-size:15px;font-weight:800;color:var(--done);margin-top:12px}
.left2{font-size:14px;font-weight:650;color:var(--ink-2);text-align:center;margin:-2px 0 9px}
`;
S['14-game-takeover-scoring'] = page('Game takeover · scoring a podium game', `
<header class="tk-h"><span class="tback">${I.back(20)}Now</span><div class="tt"><b class="d">Pumpkin Pictionary</b><small>Chapel Lawn · podium game</small></div></header>
<div class="tk">
 <div class="howto"><span>How to play</span>${I.chev(18)}</div>
 ${medalRow('Gold', 1, 'g', ['t0', 't1', 't2', 't3', 't4', 't5'].map((t) => pickBtn(t, t === 't3' ? 'on' : '')).join(''))}
 ${medalRow('Silver', 2, 's', ['t0', 't1', 't2', 't3', 't4', 't5'].map((t) => pickBtn(t, t === 't0' ? 'on' : t === 't3' ? 'used-g' : '')).join(''))}
 ${medalRow('Bronze', 3, 'b', ['t0', 't1', 't2', 't3', 't4', 't5'].map((t) => pickBtn(t, t === 't3' ? 'used-g' : t === 't0' ? 'used-s' : '')).join(''))}
</div>
<div class="tdock"><div class="save wait">Pick bronze, then save</div></div>
<i class="hi"></i>`, { time: '10:51', extraCss: TK_CSS });

S['14b-game-takeover-next'] = page('Game takeover · saved · next game', `
<header class="tk-h"><span class="tback">${I.back(20)}Now</span><div class="tt"><b class="d">Pumpkin Pictionary</b><small>Chapel Lawn · podium game</small></div></header>
<div class="tk">
 <div class="howto"><span>How to play</span>${I.chev(18)}</div>
 <div class="saved">${I.check(16)} Saved 10:52 · everyone's phone has it</div>
 <div class="res">
  <div class="rz">${md(1, 'g')}${mark('t3', 34)}<b>Particularly Perilous Pumpkins</b><span class="pt2">+7</span></div>
  <div class="rz">${md(2, 's')}${mark('t0', 34)}<b>Ferocious Foxes</b><span class="pt2">+5</span></div>
  <div class="rz">${md(3, 'b')}${mark('t2', 34)}<b>Methodic Mediocre Maples</b><span class="pt2">+3</span></div>
 </div>
 <div style="margin-top:12px"><span class="btn">Change the result</span></div>
</div>
<div class="tdock"><div class="left2">2 games left today that you can score</div><div class="ndock"><span class="btn">‹ Back to Now</span><span class="save">Next game<small>Color Call Chaos →</small></span></div></div>
<i class="hi"></i>`, { time: '10:52', extraCss: TK_CSS });

// 15 — Chat with the keyboard open: tab bar steps aside, composer rides the keyboard
const kbKeys = (row) => `<div class="kr">${row.split('').map((k) => `<span>${k}</span>`).join('')}</div>`;
S['15-chat-keyboard'] = page('Chat · keyboard open', `
<header class="ab"><b class="title-ab d">Chat</b><div class="ab-r" style="margin-left:auto"><span style="font-size:14px;font-weight:700;color:var(--ink-2)">Sam · Foxes</span></div></header>
<div class="chs"><span>Announcements</span><span class="on">General <b>2</b></span><span>Memes</span><span>Photos</span></div>
<div class="cv">
 <div class="m o"><small><b>Jenn</b> · 10:31</small><p>Bowling pins are at the shed. Who can grab them?</p></div>
 <div class="m o"><small><b>William</b> · 10:33</small><p>On it. <mark>Foxes</mark> can help carry after Axe Throwing</p></div>
 <div class="m me"><p>We'll bring them over at 10:45</p><small>10:34 · sent</small></div>
</div>
<div class="comp"><div class="cin">On my way with the second bag of pi|</div><span class="send">Send</span></div>
<div class="kb">${kbKeys('qwertyuiop')}${kbKeys('asdfghjkl')}<div class="kr k3"><span class="w">⇧</span>${'zxcvbnm'.split('').map((k) => `<span>${k}</span>`).join('')}<span class="w">⌫</span></div><div class="kr k4"><span class="w">123</span><span class="sp">space</span><span class="w">return</span></div></div>`, {
  time: '10:35', extraCss: `
.chs{position:absolute;top:103px;left:16px;right:16px;display:flex;gap:2px;background:var(--paper-2);border-radius:12px;padding:2px}
.chs span{flex:auto;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:750;color:var(--ink-2);padding:0 8px;white-space:nowrap}
.chs span b{display:inline-grid;place-items:center;min-width:19px;height:19px;border-radius:10px;background:var(--link);color:#fff;font-size:12px;margin-left:4px}
.chs span.on{background:var(--sheet);color:var(--ink);box-shadow:0 0 0 1.5px var(--card-b),0 2px 0 var(--edge);font-weight:850}
.cv{position:absolute;top:160px;left:16px;right:16px;bottom:372px;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;padding-bottom:8px}
.m{max-width:80%}
.m p{font-size:16px;font-weight:550;line-height:1.35;padding:9px 12px;border-radius:16px;background:var(--sheet);border:1.5px solid var(--line-2)}
.m small{display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:0 4px 3px}
.m small b{color:var(--ink);font-weight:800}
.m.me{align-self:flex-end}.m.me p{background:var(--blue-tint);border-color:transparent}.m.me small{text-align:right;margin:3px 4px 0}
mark{background:var(--gold-tint);color:var(--ink);font-weight:800;border-radius:4px;padding:0 3px;box-shadow:inset 0 0 0 1.5px var(--gold-edge)}
.comp{position:absolute;left:0;right:0;bottom:291px;display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 12px;background:var(--paper);border-top:1px solid var(--line-2)}
.cin{min-height:44px;border-radius:22px;border:2px solid var(--card-b);background:var(--sheet);padding:10px 14px;font-size:16px;font-weight:550}
.send{height:44px;padding:0 16px;border-radius:22px;background:var(--gold);border:2px solid var(--gold-edge);box-shadow:0 3px 0 var(--gold-edge);display:grid;place-items:center;font-size:16px;font-weight:850;color:#1f1500}
.kb{position:absolute;left:0;right:0;bottom:0;height:291px;background:#d1d3d9;padding:8px 3px 0}
body.dark .kb{background:#2b2b2e}
.kr{display:flex;gap:6px;justify-content:center;margin-bottom:11px}
.kr span{width:33px;height:42px;border-radius:5px;background:#fff;box-shadow:0 1px 0 #898a8d;display:grid;place-items:center;font-size:21px;font-weight:400;color:#000}
.kr .w{width:44px;font-size:15px;background:#abb0ba}
.kr .sp{width:184px;font-size:15px}
.k3 .w{width:42px}
.k4 .w{width:88px}
` });

// 16 — More, counselor: one Alerts row; Appearance inline (theme + calm motion); offline pill in the header
S['16-more-counselor'] = page('More · counselor', `
<header class="ab"><b class="title-ab d">More</b><div class="ab-r" style="margin-left:auto"><span class="pill-off"><i></i>Offline · saved on this phone</span></div></header>
<div class="pg">
 <div class="sec-h" style="margin-top:2px"><span>Camp</span></div>
 <div class="grp">
  <div class="li"><span class="ico">${I.cal(21)}</span><span><b>Full schedule</b></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.book(21)}</span><span><b>Memory verse</b></span><span class="end">${I.chev(18)}</span></div>
  <div class="li"><span class="ico">${I.broom(21)}</span><span><b>Meal cleanup</b></span><span class="end">${I.chev(18)}</span></div>
 </div>
 <div class="sec-h" style="margin-top:16px"><span>This phone</span></div>
 <div class="grp">
  <div class="li"><span class="ico">${I.bell(21)}</span><span><b>Alerts</b><small>On · reaches you even with Camp closed</small></span><span class="end">${I.chev(18)}</span></div>
  <div class="ap"><b>Theme</b><div class="seg"><span>Light</span><span class="on">Auto</span><span>Dark</span></div>
   <b style="margin-top:12px">Calm motion</b><div class="seg"><span class="on">Auto</span><span>On</span><span>Off</span></div>
   <small>Calm right now: your phone is saving battery.</small></div>
  <div class="li"><span class="ico">${mark('t0', 26)}</span><span><b>Your team · Ferocious Foxes</b><small>You're Sam · <a class="lk">Not you? Change</a></small></span><span class="end">${I.chev(18)}</span></div>
 </div>
 <div class="sec-h" style="margin-top:16px"><span>Account</span></div>
 <div class="grp"><div class="li"><span class="ico">${I.door(21)}</span><span><b>Sign out</b><small>sam.r@gmail.com · Counselor</small></span><span class="end"></span></div></div>
</div>
${tabBar('more', { chat: 3 })}`, {
  extraCss: `
.pill-off{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:9px;background:var(--gold-tint);box-shadow:inset 0 0 0 1.5px var(--gold-edge);font-size:13px;font-weight:800;color:var(--ink)}
.pill-off i{width:8px;height:8px;border-radius:50%;background:var(--gold-edge)}
.ap{padding:12px 14px 14px;border-top:1px solid var(--line)}
.ap b{display:block;font-size:15.5px;font-weight:800;margin-bottom:6px}
.ap small{display:block;font-size:14px;font-weight:600;color:var(--ink-2);margin-top:7px}
.lk{color:var(--link);font-weight:800;display:inline-block;padding:14px 0;margin:-14px 0}
` });

// ---------- write + shoot ----------
const VIEW = { '01b-now-running-over-360': [360, 780], '07b-remote-small': [375, 667] };
async function main() {
  // dark twins of the director screens + the reveal + senior (same markup, body.dark)
  for (const n of ['05-now-reveal-counselor', '07-remote-mid-reveal', '08-games-director', '10-tell-everyone', '13-senior-now-legacy-game', '14b-game-takeover-next']) S[n + '-dark'] = S[n].replace('<body class="">', '<body class="dark">');
  for (const [name, html] of Object.entries(S)) fs.writeFileSync(path.join(OUT, name + '.html'), html);
  fs.writeFileSync(path.join(OUT, '11-tv-waiting.html'), TV_PAGE);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const only = process.argv[2];
    for (const name of Object.keys(S)) {
      if (only && !name.startsWith(only)) continue;
      const vp = VIEW[name] || [390, 844];
      await p.setViewportSize({ width: vp[0], height: vp[1] });
      await p.goto('file://' + path.join(OUT, name + '.html'));
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: name.startsWith('07c') });
      if (name === '07b-remote-small') { await p.setViewportSize({ width: 360, height: 640 }); await p.waitForTimeout(150); await p.screenshot({ path: path.join(OUT, '07b-remote-small-360x640.png') }); }
    }
    if (!only || '11'.startsWith(only)) {
      const tv = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const tp = await tv.newPage();
      await tp.goto('file://' + path.join(OUT, '11-tv-waiting.html'));
      await tp.waitForTimeout(250);
      await tp.screenshot({ path: path.join(OUT, '11-tv-waiting.png') });
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
