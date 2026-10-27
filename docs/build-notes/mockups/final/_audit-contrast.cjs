const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
const DIR=process.argv[2];
const files=fs.readdirSync(DIR).filter(f=>/^\d.*\.html$/.test(f)&&!f.startsWith('11'));
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'});
 let bad=0;
 for(const f of files){
  const p=await b.newPage({viewport:{width:390,height:844}});
  await p.goto('file://'+DIR+f);await p.waitForTimeout(200);
  const res=await p.evaluate(()=>{
   const parse=s=>{const m=s.match(/rgba?\(([^)]+)\)/);if(!m)return null;const a=m[1].split(/[ ,\/]+/).map(Number);return {r:a[0],g:a[1],b:a[2],a:a[3]===undefined?1:a[3]}};
   const lin=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
   const L=c=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);
   const blend=(t,u)=>({r:t.r*t.a+u.r*(1-t.a),g:t.g*t.a+u.g*(1-t.a),b:t.b*t.a+u.b*(1-t.a),a:1});
   const ratio=(f,bg)=>{const a=L(f),b=L(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
   function bgOf(el){const layers=[];let e=el;let img=false;while(e&&e!==document.documentElement){const cs=getComputedStyle(e);const c=parse(cs.backgroundColor);if(cs.backgroundImage&&cs.backgroundImage!=='none')img=true;if(c&&c.a>0)layers.push(c);if(c&&c.a>=1)break;e=e.parentElement}
    let base={r:255,g:255,b:255,a:1};for(let i=layers.length-1;i>=0;i--)base=blend(layers[i],base);return {bg:base,img}}
   function opac(el){let o=1;let e=el;while(e&&e!==document.documentElement){o*=parseFloat(getComputedStyle(e).opacity);e=e.parentElement}return o}
   const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const seen=new Set();
   while(w.nextNode()){const n=w.currentNode;const t=n.textContent.trim();if(!t)continue;const el=n.parentElement;if(seen.has(el))continue;seen.add(el);
    if(el.closest('.sb,.kb,.tvc'))continue;const cs=getComputedStyle(el);if(cs.display==='none')continue;
    const r=el.getBoundingClientRect();if(r.width<1||r.bottom<0||r.top>document.documentElement.scrollHeight)continue;
    const o=opac(el);if(o<0.6)continue; // deliberately disabled
    let fc=parse(cs.color);const {bg,img}=bgOf(el);fc={...fc,a:fc.a*o};const eff=blend(fc,bg);
    const fs=parseFloat(cs.fontSize),fw=+cs.fontWeight;const large=fs>=18.66||(fs>=16);const need=large?4.5:7;
    const rt=ratio(eff,bg);if(rt<need||fs<12)out.push(`${t.slice(0,34)} | ${fs}px/${fw} ${rt.toFixed(2)} need ${need}${img?' (bg image)':''}`)}
   return out});
  if(res.length){bad+=res.length;console.log('\n'+f);res.forEach(x=>console.log('  '+x))}
  await p.close();
 }
 console.log('\nfailures:',bad);await b.close();
})();
