// Builds motion-demo.html from _motion-demo.src.html: inlines the shield thumbnails and the
// REAL vendor/jelly.js (so the toaster and the comparison jelly-button are the shipped components).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '_motion-demo.src.html'), 'utf8');
const SH = JSON.parse(fs.readFileSync(path.join(__dirname, '_shields.json'), 'utf8'));
const jelly = fs.readFileSync('/home/user/Camp/vendor/jelly.js', 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
let out = src.replace('__SHIELDS__', JSON.stringify(SH));
for (const k of Object.keys(SH)) out = out.split(`__${k}__`).join(SH[k]);
out = out.replace('</body>', `<script type="module">\n${jelly}\n</script>\n</body>`);
fs.writeFileSync(path.join(__dirname, 'motion-demo.html'), out);
console.log('motion-demo.html', Math.round(out.length / 1024), 'KB');
