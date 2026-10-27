// Testes no navegador (Playwright + Chromium). Uso: node e2e.js   (CHROMIUM_PATH opcional)
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, out = path.join(root, 'shots'); fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0]; fs.readFile(path.join(root, f === '/' ? 'index.html' : f), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end(d); } }); }).listen(0);
const results = []; const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASSOU  ' : 'FALHOU  ') + name + (extra !== undefined ? '  → ' + extra : '')); };
const STUB = () => { const log = []; window.__aud = { log, resumes: 0 };
  class FakeAC { constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; window.__aud.ctx = this; }
    resume() { window.__aud.resumes++; this.state = 'running'; this.onstatechange && this.onstatechange(); return Promise.resolve(); }
    createOscillator() { const o = { frequency: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, type: '', connect() {}, disconnect() {}, start() { if (o.frequency.value >= 200) log.push([performance.now(), o.frequency.value]); }, stop() {} }; return o; }
    createBiquadFilter() { return { frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, Q: { value: 0 }, type: '', connect() {}, disconnect() {} }; }
    createBuffer(c, n) { return { getChannelData() { return new Float32Array(n); } }; }
    createBufferSource() { return { buffer: null, loop: false, connect() {}, disconnect() {}, start() { window.__aud.noise = (window.__aud.noise || 0) + 1; }, stop() {} }; }
    get sampleRate() { return 48000; }
    createGain() { const g = { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { g.gain.value = v; if (window.__aud.cuffOut === g) window.__aud.cuffLevel = v; } }, connect() {}, disconnect() {} }; return g; } }
  window.AudioContext = FakeAC; };
(async () => {
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } }); await ctx.addInitScript(STUB);
  const reqs = [], errs = []; ctx.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) reqs.push(r.url()); });
  const con = await ctx.newPage(); con.on('pageerror', e => errs.push('console: ' + e)); con.on('console', m => { if (m.type() === 'error') errs.push('console.log: ' + m.text()); });
  await con.goto(base); await con.waitForTimeout(1500);
  const disp = await ctx.newPage(); disp.on('pageerror', e => errs.push('display: ' + e)); disp.on('console', m => { if (m.type() === 'error') errs.push('display.log: ' + m.text()); });
  await disp.goto(base + '?mode=projection'); await disp.waitForTimeout(1200);

  // ---- abertura: tela cheia, sem começar vazia ----
  const litCols = (sel) => disp.evaluate(s => { const c = document.querySelector(s + ' canvas.t'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, cols = new Uint8Array(c.width); for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 100) cols[x] = 1; let n = 0; for (const v of cols) n += v; return n / c.width; }, sel);
  const f0 = await litCols('#w-ecg'), f1 = await litCols('#w-resp'), f2 = await litCols('#w-capno');
  check('Abertura: ECG, resp e CO₂ já preenchidos (≥ 90% das colunas) no primeiro segundo', f0 > .9 && f1 > .9 && f2 > .85, [f0, f1, f2].map(v => v.toFixed(2)).join(' / '));
  await disp.screenshot({ path: out + '/01-gate.png' });
  check('Tela inicial «Toque para iniciar» aparece e o som está desligado', await disp.evaluate(() => !document.getElementById('gate').classList.contains('hide') && /CLIQUE/.test(document.getElementById('sndst').textContent)));
  await disp.mouse.click(600, 400); await disp.waitForTimeout(600);
  check('Um clique libera o áudio e some a tela inicial', await disp.evaluate(() => document.getElementById('gate').classList.contains('hide') && document.getElementById('sndst').textContent === 'SOM ATIVO'));
  const nums = await disp.evaluate(() => ['v-hr', 'v-spo2', 'v-pr', 'v-nibp', 'v-rr', 'v-etco2', 'v-temp'].map(i => document.getElementById(i).textContent));
  check('Abertura: nenhum número «---» (FC, SpO₂, pulso, PNI, FR, EtCO₂)', nums.slice(0, 6).every(v => !v.includes('---')), nums.join(' ; '));

  // ---- varredura: traçado parado ----
  const snap = () => disp.evaluate(() => { const c = document.querySelector('#w-ecg canvas.t'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, W = c.width, cols = new Uint8Array(W); for (let y = 0; y < c.height; y++) for (let x = 0; x < W; x++) cols[x] |= d[(y * W + x) * 4 + 3] > 100 ? 1 : 0; const ys = []; for (let x = 0; x < W; x++) { let a = -1, z = -1; for (let y = 0; y < c.height; y++) if (d[(y * W + x) * 4 + 3] > 100) { if (a < 0) a = y; z = y; } ys.push(a * 10000 + z); } return { W, ys }; });
  const s1 = await snap(); await disp.waitForTimeout(1000); const s2 = await snap();
  let changed = 0; for (let i = 0; i < s1.W; i++) if (s1.ys[i] !== s2.ys[i]) changed++;
  check('Varredura: em 1 s só ≤ 25% das colunas do ECG mudam (o traçado não rola)', changed / s1.W < 0.25, (changed / s1.W * 100).toFixed(1) + '%');
  const seq = []; for (let i = 0; i < 10; i++) { await disp.waitForTimeout(1000); seq.push(await litCols('#w-ecg')); }
  check('Varredura: a tela nunca é apagada (mínimo ≥ 80% das colunas acesas em 10 s)', Math.min(...seq) > .8, seq.map(v => v.toFixed(2)).join(','));
  await disp.screenshot({ path: out + '/02-basal.png' });

  // ---- som automático e persistente ----
  const aud = () => disp.evaluate(() => window.__aud.log.map(l => Math.round(l[1])));
  const nBeep = async (ms) => { const a = (await aud()).length; await disp.waitForTimeout(ms); return (await aud()).length - a; };
  const nb = await nBeep(10000); check('Bip de FC: ~76 bpm gera 12 a 14 bips em 10 s', nb >= 11 && nb <= 15, nb);
  check('O bip usa tom fixo de 880 Hz (fonte QRS)', (await aud()).slice(-5).every(f => f === 880));
  for (const k of ['hr', 'spo2', 'sys', 'rr', 'etco2']) await con.evaluate(k => { const S = window.__pl.S; window.__pl.commit(n => { n.p.to[k] = n.p.to[k] + 1; }); }, k);
  await con.evaluate(() => window.__pl.applyScenario('taqui')); await con.waitForTimeout(500); await con.evaluate(() => window.__pl.applyScenario('basal')); await con.waitForTimeout(800);
  check('Mudar parâmetros e cenários NÃO desliga o som nem pede ativação de novo', await disp.evaluate(() => document.getElementById('gate').classList.contains('hide') && document.getElementById('sndst').textContent === 'SOM ATIVO' && window.__aud.ctx.state === 'running'));
  await con.evaluate(() => window.__pl.commit(n => { n.audio.beep = false; })); await disp.waitForTimeout(600); const nb0 = await nBeep(4000); check('Bip desligado: 0 bips', nb0 === 0, nb0);
  await con.evaluate(() => window.__pl.commit(n => { n.audio.beep = true; n.audio.beepSrc = 'spo2'; })); await disp.waitForTimeout(600); const nbs = await nBeep(6000); const f = (await aud()).slice(-3); check('Bip pela SpO₂: toca e a frequência acompanha a saturação (≠ 880)', nbs >= 5 && f.every(x => x > 700 && x < 880), nbs + ' bips, ' + f.join(','));
  await con.evaluate(() => window.__pl.commit(n => { n.audio.beepSrc = 'ecg'; n.audio.beep = false; }));
  // alarme automático
  await con.evaluate(() => window.__pl.applyScenario('taqui')); await con.evaluate(() => window.__pl.commit(n => { n.p = { from: n.p.to, to: Object.assign({}, n.p.to, { hr: 140 }), t0: 0, dur: 0 }; n.scen = { id: 'custom', phase: 0, startP: 0, auto: false }; }));
  const t0 = Date.now(); await disp.waitForFunction(() => /FC ALTA/.test(document.getElementById('bantxt').textContent), null, { timeout: 25000 }); const dt = (Date.now() - t0) / 1000;
  await disp.waitForTimeout(1500); const fa = await aud(); check('Alarme «FC ALTA» (média) aparece sozinho e toca 740 Hz sem nenhum clique extra', fa.includes(740), 'banner em ' + dt.toFixed(1) + ' s');
  await disp.screenshot({ path: out + '/03-fc-alta.png' });
  await con.evaluate(() => window.__pl.applyScenario('vf')); await disp.waitForFunction(() => /FIBRILAÇÃO/.test(document.getElementById('bantxt').textContent), null, { timeout: 15000 }); await disp.waitForTimeout(2500);
  check('FV: alarme alto vermelho + 988 Hz automático', (await aud()).includes(988) && await disp.evaluate(() => document.getElementById('banner').classList.contains('a3')));
  await con.evaluate(() => window.__pl.commit(n => { n.audio.beep = true; })); const nvf = await nBeep(4000); check('FV: sem bip de FC (não há QRS)', nvf === 0 || (await aud()).slice(-nvf).every(f => f !== 880), nvf);
  await disp.screenshot({ path: out + '/04-fv.png' });
  // choque
  await con.waitForTimeout(500); const bef = await con.evaluate(() => window.__pl.S.shockT); await con.click('#shock'); await con.waitForTimeout(400);
  const sat = await disp.evaluate(() => { const g = window.__pl.core.gen, S = window.__pl.S; let mx = 0; for (let i = Math.floor(S.shockT * 250); i < Math.floor(S.shockT * 250) + 250; i++) mx = Math.max(mx, Math.abs(g.ecg[i % g.ecg.length])); return mx; });
  check('Botão Choque: onda satura (artefato) na projeção', (await con.evaluate(() => window.__pl.S.shockT)) > bef && sat > 5, 'pico ' + sat.toFixed(1) + ' mV');
  await disp.screenshot({ path: out + '/05-choque.png' });
  // silenciar
  await con.evaluate(() => window.__pl.applyScenario('basal')); await con.evaluate(() => window.__pl.applyScenario('asys')); await disp.waitForFunction(() => /ASSISTOLIA/.test(document.getElementById('bantxt').textContent), null, { timeout: 20000 });
  await con.evaluate(() => window.__pl.commit(n => { n.alarm.silencedUntil = Date.now() + 120000; })); await disp.waitForTimeout(800); const sil = await nBeep(0); const s0 = (await aud()).length; await disp.waitForTimeout(8000); check('Silenciar 2 min: sem som de alarme e contagem visível', (await aud()).length === s0 && await disp.evaluate(() => /SOM PAUSADO/.test(document.getElementById('mute').textContent)));
  await con.evaluate(() => window.__pl.commit(n => { n.alarm.silencedUntil = 0; })); await con.evaluate(() => window.__pl.applyScenario('basal'));

  // ---- pausa e redimensionar ----
  await con.evaluate(() => window.__pl.commit(n => { n.audio.beep = false; })); await disp.waitForTimeout(8000);
  await con.keyboard.press('Space'); await disp.waitForTimeout(900); const p1 = await snap(); await disp.waitForTimeout(1800); const p2 = await snap();
  check('Pausa: traçado idêntico após 1,8 s e «CONGELADO» visível', JSON.stringify(p1.ys) === JSON.stringify(p2.ys) && await disp.evaluate(() => !document.getElementById('frozen').classList.contains('hide')));
  await con.keyboard.press('Space'); await disp.waitForTimeout(600);
  const geo = async () => disp.evaluate(() => { const d = document.documentElement, st = document.getElementById('stage').getBoundingClientRect(), bad = []; for (const i of ['w-ecg', 'w-pleth', 'w-resp', 'w-capno', 'b-hr', 'b-spo2', 'b-nibp', 'b-etco2', 'b-rr', 'b-temp']) { const r = document.getElementById(i).getBoundingClientRect(); if (!(r.width > 0 && r.left >= st.left - 1 && r.right <= st.right + 1 && r.top >= st.top - 1 && r.bottom <= st.bottom + 1)) bad.push(i); } const clip = ['v-hr', 'v-spo2', 'v-nibp', 'v-etco2', 'v-rr', 'v-temp'].filter(i => { const e = document.getElementById(i); return e.scrollWidth > e.parentElement.clientWidth + 1; }); return { bad, clip, scroll: d.scrollWidth > innerWidth || d.scrollHeight > innerHeight }; });
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768]]) { await disp.setViewportSize({ width: w, height: h }); await disp.waitForTimeout(700); const g = await geo(); const lit = await litCols('#w-ecg'); check(`Projeção ${w}x${h}: nada cortado, sem rolagem, traçado preservado`, !g.bad.length && !g.clip.length && !g.scroll && lit > .6, JSON.stringify(g) + ' lit=' + lit.toFixed(2)); await disp.screenshot({ path: out + `/06-proj-${w}x${h}.png` }); }
  await disp.setViewportSize({ width: 1920, height: 1080 });

  // ---- cenários: números medidos e sem rolagem ----
  const rows = [];
  for (const id of await con.evaluate(() => window.__pl.ids)) {
    await con.evaluate(i => window.__pl.applyScenario(i), id); await disp.waitForTimeout(6500);
    const g = await geo(), n = await disp.evaluate(() => ['v-hr', 'v-spo2', 'v-pr', 'v-nibp', 'v-rr', 'v-etco2', 'v-temp'].map(i => document.getElementById(i).textContent).join(' ; ') + ' || ' + document.getElementById('bantxt').textContent.trim() + ' | ' + document.getElementById('rhy').textContent);
    rows.push(id + ': ' + n); if (g.bad.length || g.clip.length || g.scroll) check('Cenário ' + id + ' sem corte', false, JSON.stringify(g)); await disp.screenshot({ path: out + `/07-sc-${id}.png` });
  }
  console.log(rows.join('\n')); check('Todos os cenários (31) sem corte nem rolagem', !results.some(r => /^Cenário .* sem corte/.test(r[0])));


  // ---- layout: arrastar, trocar de lugar, ocultar (×) e restaurar ----
  await con.evaluate(() => window.__pl.applyScenario('basal')); await con.waitForTimeout(500);
  const pv = con.frameLocator('#prev');
  await pv.locator('#b-hr').dragTo(pv.locator('#b-spo2')); await con.waitForTimeout(500);
  const L1 = await con.evaluate(() => window.__pl.S.layout.nums); check('Arrastar FC sobre SpO₂ troca os painéis de lugar (miniatura → projeção)', L1[0] === 'spo2' && L1[1] === 'hr', L1.join());
  const top = await disp.evaluate(() => ['b-spo2', 'b-hr'].map(i => Math.round(document.getElementById(i).getBoundingClientRect().top))); check('Projeção reflete a nova ordem (SpO₂ acima da FC)', top[0] < top[1], top.join('<'));
  await pv.locator('#w-ecg').dragTo(pv.locator('#w-capno')); await con.waitForTimeout(500);
  const L2 = await con.evaluate(() => window.__pl.S.layout.waves); check('Arrastar ECG sobre CO₂ troca as ondas de lugar', L2[0] === 'capno' && L2[3] === 'ecg', L2.join());
  const hb = await disp.evaluate(() => document.getElementById('b-nibp').getBoundingClientRect().height);
  await pv.locator('#b-etco2 .xbtn').click(); await con.waitForTimeout(600);
  const g2 = await disp.evaluate(() => { const st = document.getElementById('stage').getBoundingClientRect(), rr = document.getElementById('b-rr').getBoundingClientRect(), et = document.getElementById('b-etco2').getBoundingClientRect(); const col = document.getElementById('nums').getBoundingClientRect(); return { etHidden: et.width === 0, rrFull: Math.abs(rr.width - col.width) < 3, fill: Math.abs(Array.from(document.querySelectorAll('#nums .box:not(.hide)')).reduce((a, e) => a + e.getBoundingClientRect().height, 0) - col.height) < 3 }; });
  check('× no EtCO₂: some, FR ocupa a linha inteira e a coluna continua preenchida', g2.etHidden && g2.rrFull && g2.fill, JSON.stringify(g2));
  await pv.locator('#w-pleth .xbtn').click(); await pv.locator('#w-resp .xbtn').click(); await con.waitForTimeout(600);
  const g3 = await disp.evaluate(() => { const ws = Array.from(document.querySelectorAll('.waves .wave:not(.hide)')), box = document.querySelector('.waves').getBoundingClientRect(); return { n: ws.length, filled: Math.abs(ws.reduce((a, e) => a + e.getBoundingClientRect().height, 0) - box.height) < 3 }; });
  check('× em Pleth e Resp: sobram 2 ondas e elas ocupam toda a altura', g3.n === 2 && g3.filled, JSON.stringify(g3));
  await disp.waitForTimeout(500); const litc = await litCols('#w-ecg'); check('Traçado do ECG segue completo depois de reorganizar', litc > .6, litc.toFixed(2));
  await disp.screenshot({ path: out + '/12-layout-editado.png' }); await con.screenshot({ path: out + '/12b-console-layout.png' });
  await con.click('[data-tab=ds]'); await con.click('#lay-reset'); await con.waitForTimeout(600);
  check('«Restaurar painéis e ordem» devolve tudo ao padrão', await con.evaluate(() => { const L = window.__pl.S.layout; return L.hidden.length === 0 && L.nums[0] === 'hr' && L.waves[0] === 'ecg'; }));
  await con.click('[data-tab=al]');
  // ao vivo: sem delay e sem botão Aplicar
  await con.evaluate(() => window.__pl.applyScenario('basal')); await con.waitForTimeout(500); await con.click('.stp[data-k=hr][data-d="1"]'); await con.waitForTimeout(500);
  check('Mudar FC aplica na hora na projeção (alvo imediato, sem botão Aplicar)', await disp.evaluate(() => { const S = window.__pl.S; return S.p.dur === 0 && S.p.to.hr === 77; }) && !(await con.isVisible('#apply')));
  await con.evaluate(() => window.__pl.applyScenario('hemo')); await con.waitForTimeout(400); await con.click('#basal'); await con.waitForTimeout(600);
  check('Botão «Restaurar basal» na barra superior volta ao cenário basal', await con.evaluate(() => window.__pl.S.scen.id === 'basal'));
  check('Rodapé da projeção: «Criado por Enf. Rubens Diniz»', await disp.evaluate(() => /Criado por Enf\. Rubens Diniz/.test(document.querySelector('.foot').textContent) && !/NÃO USAR/.test(document.body.textContent)));
  check('Sem quadrado de calibração no início do ECG (nenhum pixel na coluna inicial acima da linha de base)', await disp.evaluate(() => { const c = document.querySelector('#w-ecg canvas.g'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let bright = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150 && d[i + 3] > 60) bright++; return bright === 0; }));
  // ---- console ----
  await con.setViewportSize({ width: 1920, height: 1080 }); await con.waitForTimeout(500);
  const cs = await con.evaluate(() => { const d = document.documentElement; return { scrollH: d.scrollHeight, h: innerHeight, scrollW: d.scrollWidth, w: innerWidth }; });
  check('Console 1920x1080: sem rolagem da página', cs.scrollH <= cs.h + 2 && cs.scrollW <= cs.w + 1, JSON.stringify(cs));
  await con.screenshot({ path: out + '/08-console.png' });
  for (const t of ['sn', 'ds', 'ss', 'al']) { await con.click(`[data-tab=${t}]`); await con.waitForTimeout(200); await con.screenshot({ path: out + `/09-console-${t}.png` }); }
  await con.setViewportSize({ width: 1366, height: 768 }); await con.waitForTimeout(400); await con.screenshot({ path: out + '/10-console-1366.png' });
  await con.setViewportSize({ width: 1920, height: 1080 });
  // PNI
  await con.evaluate(() => window.__pl.applyScenario('basal')); await con.click('#nibpnow'); await disp.waitForTimeout(3000); await disp.screenshot({ path: out + '/11-pni.png' });
  check('PNI: durante a medição mostra «MEDINDO» e a pressão do manguito', await disp.evaluate(() => /MEDINDO/.test(document.getElementById('s-nibp').textContent)));
  const nz = () => disp.evaluate(() => window.__aud.noise || 0);
  check('Som da bomba do manguito toca durante a medição da PNI', (await nz()) > 0, await nz());
  await con.evaluate(() => window.__pl.commit(n => { n.audio.cuff = false; })); await disp.waitForTimeout(600); const n1 = await nz(); await disp.waitForTimeout(1500);
  check('Desligar «som da bomba» silencia a PNI (sem novas fontes de som)', (await nz()) === n1);
  await con.evaluate(() => window.__pl.commit(n => { n.audio.cuff = true; })); await disp.waitForTimeout(1200);
  check('Religar o som da bomba volta a tocar na mesma medição', (await nz()) > n1);
  await con.evaluate(() => window.__pl.commit(n => { n.audio.mute = true; })); await disp.waitForTimeout(600); const n2 = await nz(); await disp.waitForTimeout(1500);
  check('Mudo geral também silencia a bomba', (await nz()) === n2);
  await con.evaluate(() => window.__pl.commit(n => { n.audio.mute = false; }));
  // ---- v7: barra superior cabe, janela popup, som em segundo plano, FC oscilando ----
  for (const [w, h] of [[1920, 1080], [1536, 864], [1366, 768], [1280, 720], [1100, 700]]) {
    await con.setViewportSize({ width: w, height: h }); await con.waitForTimeout(300);
    const r = await con.evaluate(() => { const q = id => document.getElementById(id).getBoundingClientRect(), o = q('open'), f = q('openfs'), v = document.documentElement; return { sw: v.scrollWidth, iw: innerWidth, open: [Math.round(o.left), Math.round(o.right)], fs: [Math.round(f.left), Math.round(f.right)], ok: o.right <= innerWidth && o.left >= 0 && f.right <= innerWidth && f.width > 20 && o.width > 20 }; });
    check(`Barra superior ${w}px: «Abrir projeção» e tela cheia visíveis, sem rolagem lateral`, r.ok && r.sw <= r.iw, JSON.stringify(r));
  }
  await con.setViewportSize({ width: 1920, height: 1080 });
  check('Retomar/Congelar são só ícones, agrupados num mesmo quadro', await con.evaluate(() => { const g = document.querySelector('.seg'); return !!g && g.contains(document.getElementById('run')) && g.contains(document.getElementById('pause')) && document.getElementById('run').textContent.trim() === '' && document.getElementById('pause').textContent.trim() === ''; }));
  check('Botão de som é só ícone (sem a palavra visível)', await con.evaluate(() => { const b = document.getElementById('mutebtn'); return !!b.querySelector('svg') && !b.querySelector('.lb'); }));
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), con.click('#open')]); await pop.waitForLoadState();
  const pw = await pop.evaluate(() => ({ popupBar: window.toolbar && window.toolbar.visible === false, mode: new URLSearchParams(location.search).get('mode'), w: window.outerWidth }));
  check('«Abrir projeção» abre uma janela (popup) e não uma guia', pw.popupBar && pw.mode === 'projection', JSON.stringify(pw)); await pop.close();
  // som em segundo plano: página sem requestAnimationFrame (como uma janela oculta/coberta) continua tocando e avisando o console
  const bg = await ctx.newPage(); await bg.addInitScript(() => { window.requestAnimationFrame = () => 0; }); await bg.goto(base + '?mode=projection'); await bg.mouse.click(300, 300);
  await con.evaluate(() => { window.__pl.commit(n => { n.audio.beep = true; n.audio.beepSrc = 'ecg'; n.audio.mute = false; n.alarm.silencedUntil = 0; }); window.__pl.applyScenario('basal'); }); await bg.waitForTimeout(1500); const l0 = await bg.evaluate(() => window.__aud.log.length); await bg.waitForTimeout(6000); const l1 = await bg.evaluate(() => window.__aud.log.length);
  check('Som em segundo plano: sem desenho (rAF parado) o bip de FC continua tocando', l1 - l0 >= 6, `${l1 - l0} bips em 6 s`);
  check('Segundo plano: a projeção segue avisando o console (sinal de vida)', await con.evaluate(() => [...document.querySelectorAll('.pill')].some(p => /conectada/i.test(p.textContent))));
  await con.evaluate(() => window.__pl.applyScenario('vf')); await bg.waitForTimeout(9000);
  check('Segundo plano: alarme de FV toca (988 Hz) mesmo sem desenho', await bg.evaluate(() => window.__aud.log.some(x => x[1] === 988)));
  await con.evaluate(() => window.__pl.applyScenario('basal')); await bg.close();
  await con.evaluate(() => window.__pl.commit(n => { n.var = true; n.p.from.hr = 89; n.p.to.hr = 89; n.p.dur = 0; n.rhythm = 'sinus'; n.scen = { id: 'custom', phase: 0, startP: 0, auto: false }; n.epoch++; n.epochT = 0; }));
  const hrs = []; for (let i = 0; i < 40; i++) { await disp.waitForTimeout(1000); hrs.push(await disp.evaluate(() => Number(document.getElementById('v-hr').textContent))); }
  const hv = hrs.filter(Number.isFinite).slice(10); check('FC de 89: o valor na tela oscila ±2–4 bpm e não fica parado', Math.max(...hv) - Math.min(...hv) >= 3 && Math.min(...hv) >= 84 && Math.max(...hv) <= 94 && new Set(hv).size >= 4, hv.join(','));
  // ---- v8: cronômetro da simulação, atalhos de teclado, som da bomba da PNI ----
  const pillT = async () => { await con.waitForTimeout(1300); return con.evaluate(() => document.getElementById('p-t').textContent); };
  await con.keyboard.press('r'); await con.waitForFunction(() => window.__pl.S.scen.id === 'basal', null, { timeout: 3000 });
  let tt = await pillT(); check('Cronômetro «Simulação» recomeça do zero ao aplicar um cenário', /Simulação 0:0\d/.test(tt), tt);
  await con.evaluate(() => window.__pl.commit(n => { n.clock.rt0 += 220000; })); tt = await pillT(); check('Cronômetro longo passa a h:mm:ss (não mostra 3672:37)', /Simulação \d+:\d\d:\d\d/.test(tt) && !/\d{3,}:\d\d$/.test(tt), tt);
  await con.keyboard.press('r'); tt = await pillT(); check('Atalho R restaura o basal e zera o cronômetro', /Simulação 0:0\d/.test(tt), tt);
  await con.keyboard.press('Space'); const tf1 = await pillT(); const tf2 = await pillT(); check('Cronômetro para quando a simulação está congelada', tf1 === tf2, tf1 + ' → ' + tf2); await con.keyboard.press('Space');
  await con.keyboard.press('5'); await con.waitForFunction(() => window.__pl.S.scen.id === 'hemo'); await con.keyboard.press('r'); check('Atalho R volta ao basal a partir de outro cenário', await con.evaluate(() => window.__pl.S.scen.id === 'basal'));
  await con.keyboard.press('5'); await con.keyboard.press('ArrowRight'); check('Seta → avança a fase do cenário', await con.evaluate(() => window.__pl.S.scen.phase >= 1));
  await con.evaluate(() => { window.__pl.applyScenario('basal'); document.dispatchEvent(new Event('x')); window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true })); }); await con.waitForTimeout(200); check('Ctrl+tecla não dispara atalhos (não atrapalha Ctrl+R/C do navegador)', await con.evaluate(() => window.__pl.S.scen.id === 'basal'));
  const m0 = await con.evaluate(() => window.__pl.S.audio.mute); await con.keyboard.press('m'); const m1 = await con.evaluate(() => window.__pl.S.audio.mute); await con.keyboard.press('m'); const m2 = await con.evaluate(() => window.__pl.S.audio.mute); check('Atalho M liga/desliga o som da projeção', m1 === !m0 && m2 === m0);
  const q0 = await con.evaluate(() => window.__pl.S.nibp.seq); await con.keyboard.press('n'); check('Atalho N mede a PNI agora', await con.evaluate(q => window.__pl.S.nibp.seq === q + 1 && window.__pl.S.nibp.state === 'meas', q0));
  await con.evaluate(() => window.__pl.applyScenario('vf')); await con.keyboard.press('c'); const c1 = await con.evaluate(() => window.__pl.S.cpr); await con.keyboard.press('c'); const c2 = await con.evaluate(() => window.__pl.S.cpr); check('Atalho C liga/desliga a RCP (em ritmo de parada)', c1 === true && c2 === false);
  const sh0 = await con.evaluate(() => window.__pl.S.shockT); await con.keyboard.press('d'); check('Atalho D aplica o choque em ritmo chocável', await con.evaluate(s => window.__pl.S.shockT !== s, sh0));
  await con.keyboard.press('e'); check('Atalho E dá o RCE e volta ao ritmo sinusal', await con.evaluate(() => window.__pl.S.rhythm === 'sinus'));
  await con.keyboard.press('c'); check('C fora de ritmo de parada não liga a RCP', await con.evaluate(() => window.__pl.S.cpr === false));
  await con.evaluate(() => document.activeElement && document.activeElement.blur()); await con.keyboard.press('?'); const kb1 = await con.evaluate(() => !document.getElementById('kbmodal').classList.contains('hide')); await con.keyboard.press('Escape'); const kb2 = await con.evaluate(() => document.getElementById('kbmodal').classList.contains('hide')); check('«?» abre a lista de atalhos e Esc fecha', kb1 && kb2);
  await con.evaluate(() => window.__pl.applyScenario('basal')); await con.focus('#sc-q'); await con.keyboard.press('5'); await con.keyboard.press('r'); check('Digitar na busca não dispara atalhos', await con.evaluate(() => window.__pl.S.scen.id === 'basal' && document.getElementById('sc-q').value === '5r')); await con.evaluate(() => { const q = document.getElementById('sc-q'); q.value = ''; q.dispatchEvent(new Event('input')); q.blur(); });
  const tplSrc = require('fs').readFileSync(__dirname + '/src/template.html', 'utf8'), cuffCode = tplSrc.slice(tplSrc.indexOf('let noiseBuf = null'), tplSrc.indexOf('function cuffFrame'));
  const cuffM = await con.evaluate(async code => {
    const SR = 22050, off = new OfflineAudioContext(1, SR * 34, SR); let fakeT = 0; const actx = new Proxy(off, { get(t, p) { if (p === 'currentTime') return fakeT; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
    const { cuffUpdate } = new Function('actx', 'NIBP_SECONDS', code + '; return { cuffUpdate };')(actx, 32); for (let el = 0; el < 32; el += 0.04) { fakeT = el; cuffUpdate(el, 0.315, 1); }
    const d = (await off.startRendering()).getChannelData(0), pk = (a, b) => { let m = 0; for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) m = Math.max(m, Math.abs(d[i])); return m; };
    return { inf: pk(1, 9), def: pk(11, 29), exh: pk(30.7, 32) };
  }, cuffCode);
  check('Som da bomba da PNI: estalos da deflação bem abaixo do motor (sem «tiro»)', cuffM.def < 0.45 * cuffM.inf && cuffM.exh < 0.6 * cuffM.inf && cuffM.inf > 0.05, JSON.stringify(cuffM, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  // sincronização + recarga + JSON corrompido
  const t1 = Date.now(); await con.keyboard.press('5'); await disp.waitForFunction(() => window.__pl.S.scen.id === 'hemo', null, { timeout: 3000 }); check('Sincronização console → projeção < 1 s', Date.now() - t1 < 1000, (Date.now() - t1) + ' ms');
  await disp.reload(); await disp.waitForTimeout(1500); check('Recarregar a projeção restaura o cenário e mostra a tela inicial de som', await disp.evaluate(() => window.__pl.S.scen.id === 'hemo' && !document.getElementById('gate').classList.contains('hide')));
  const bad = await ctx.newPage(); bad.on('pageerror', e => errs.push('bad: ' + e)); await bad.goto(base); await bad.evaluate(() => localStorage.setItem('pulselab:session:v2', '{lixo')); await bad.goto(base + '?mode=projection'); await bad.waitForTimeout(1200); check('localStorage corrompido não quebra a projeção', await bad.evaluate(() => window.__pl.S.schema === 2));
  check('Nenhuma requisição externa (tudo offline)', reqs.length === 0, JSON.stringify(reqs)); check('Nenhum erro de JavaScript', errs.length === 0, JSON.stringify(errs));
  const fail = results.filter(r => !r[1]); console.log(`\n${results.length - fail.length}/${results.length} verificações passaram`); await b.close(); srv.close(); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
