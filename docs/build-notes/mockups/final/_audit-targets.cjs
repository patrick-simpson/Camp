const {chromium}=require('/opt/node22/lib/node_modules/playwright');const fs=require('fs');const DIR=process.argv[2];
const files=fs.readdirSync(DIR).filter(f=>/^\d.*\.html$/.test(f)&&!f.startsWith('11')&&!f.includes('-dark'));
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'});let n=0;
for(const f of files){const p=await b.newPage({viewport:{width:390,height:844}});await p.goto('file://'+DIR+f);
const r=await p.evaluate(()=>[...document.querySelectorAll('.btn,.endb,.rback,.tab,.seg span,.msg .x,.sec-h a,.pk,.bk,.big,.li,.chs span,.send,.tback,.swr,.days span,.revl,.howto,.save,.sr,.rr.nx,.lk')].map(e=>{const r=e.getBoundingClientRect();return [e.className+':'+e.textContent.trim().slice(0,18),Math.round(r.width),Math.round(r.height)]}).filter(x=>x[1]<44||x[2]<44));
if(r.length){n+=r.length;console.log(f,JSON.stringify(r))}await p.close()}console.log('small targets',n);await b.close()})();
