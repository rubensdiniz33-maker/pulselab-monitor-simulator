// Gera o index.html (arquivo único) a partir de src/template.html + src/engine.js
// Uso: node build.js [saida]    e   BUILD_ID=<sha> node build.js site/index.html
const fs = require('fs'), path = require('path');
const eng = fs.readFileSync(path.join(__dirname, 'src/engine.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
let t = fs.readFileSync(path.join(__dirname, 'src/template.html'), 'utf8');
t = t.replace('/*ENGINE*/', () => eng.replace("if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;", ''));
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
t = t.replace('/*REMOTE_CSS*/', () => rd('src/remote.css')).replace('/*REMOTE_JS*/', () => rd('src/remote.js')).replace('/*UI_JS*/', () => rd('src/ui.js')).replace('/*THEME_CSS*/', () => rd('src/theme.css')).replace('/*HOST_JS*/', () => rd('src/host.js'));
t = t.replace('/*PEERJS*/', () => rd('vendor/peerjs.min.js').replace(/<\/script/gi, '<\\/script')).replace('/*QRCODE*/', () => rd('vendor/qrcode.min.js').replace(/<\/script/gi, '<\\/script'));
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', f)).toString('base64');
t = t.replace('__ICON_SVG__', () => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, 'src/icon.svg')).toString('base64')).replace('__ICON_32__', () => b64('icon-32.png')).replace('__ICON_180__', () => b64('icon-180.png'));
if (process.env.BUILD_ID) t = t.replace('content="__BUILD__"', 'content="' + process.env.BUILD_ID + '"');
const out = process.argv[2] || path.join(__dirname, 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, t);
console.log('gerado', out, t.length, 'bytes');
for (const f of ['icon.svg']) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(path.dirname(out), 'favicon.svg'));
const mon = path.join(__dirname, 'monitor.html'); if (fs.existsSync(mon)) fs.copyFileSync(mon, path.join(path.dirname(out), 'monitor.html'));
