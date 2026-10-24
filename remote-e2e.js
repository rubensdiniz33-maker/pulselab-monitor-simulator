/* Teste do controle remoto: console + celular (contexto separado) falando por WebRTC via um PeerServer local */
const { chromium } = require('playwright-core'); const http = require('http'), fs = require('fs'), path = require('path');
const { PeerServer } = require('peer');
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0]; fs.readFile(path.join(__dirname, f === '/' ? 'index.html' : f), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end(d); } }); }).listen(0);
const ps = PeerServer({ port: 9187, host: '127.0.0.1', path: '/', allow_discovery: false });
let ok = 0, bad = 0; const check = (n, c, x) => { if (c) ok++; else bad++; console.log((c ? 'PASSOU  ' : 'FALHOU  ') + n + (x !== undefined ? '  → ' + x : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await wait(120); } return false; }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const base = 'http://127.0.0.1:' + srv.address().port + '/', dev = '&ph=127.0.0.1&pp=9187';
  const errs = [], ext = [];
  const c1 = await b.newContext({ viewport: { width: 1920, height: 1080 } }), con = await c1.newPage();
  con.on('pageerror', e => errs.push('con ' + e)); con.on('request', r => { if (!/127\.0\.0\.1|^data:/.test(r.url())) ext.push(r.url()); });
  await con.goto(base + '?ph=127.0.0.1&pp=9187'); await wait(1200);
  check('Sem rede externa antes de ativar o celular', ext.length === 0, JSON.stringify(ext));
  await con.click('#phone'); check('Janela do celular abre', await con.locator('#phmodal:not(.hide)').count() === 1);
  await con.click('#ph-on');
  check('Console registra o PIN no servidor de pareamento', await until(() => con.evaluate(() => window.__pl.RM.status === 'on')));
  const pin = await con.evaluate(() => window.__pl.RM.pin);
  check('PIN de 6 dígitos', /^\d{6}$/.test(pin), pin);
  check('QR Code desenhado (SVG)', await con.locator('#phmodal .qrbox svg').count() === 1);
  await con.screenshot({ path: 'r-console-modal.png' });
  await con.click('#ph-x');

  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), ph = await c2.newPage();
  ph.on('pageerror', e => errs.push('phone ' + e)); ph.on('console', m => { if (m.type() === 'error') errs.push('phonelog ' + m.text()); });
  await ph.goto(base + '?mode=remote&pin=' + pin + dev);
  check('Celular conecta pelo PIN do QR', await until(() => ph.evaluate(() => window.__rm.status === 'online'), 15000));
  check('Console mostra 1 celular conectado', await until(() => con.evaluate(() => window.__pl.RM.conns.size === 1)));
  check('Celular NÃO tem monitor (sem canvas de onda, sem valores)', await ph.evaluate(() => document.querySelectorAll('canvas,.mon,#v-hr,.wave').length === 0));
  check('Cabeçalho do celular: só o ícone de som (sem configurações)', await ph.evaluate(() => document.querySelectorAll('.rm-top button').length === 2 && !!document.getElementById('rm-mute')));
  await ph.waitForTimeout(500); await ph.screenshot({ path: 'r-phone-sc.png' });

  await ph.click('.rm-card[data-id=sepse]');
  check('Tocar num cenário aplica no console (choque séptico)', await until(() => con.evaluate(() => window.__pl.S.scen.id === 'sepse')));
  check('Card do cenário fica destacado com fase e botão avançar', await until(() => ph.evaluate(() => !!document.querySelector('.rm-card.on[data-id=sepse] [data-act=phase]'))));
  await ph.click('[data-act=phase]');
  check('Avançar fase pelo celular', await until(() => con.evaluate(() => window.__pl.S.scen.phase === 1)));
  await ph.fill('#rm-q', 'torsades'); check('Busca filtra cenários', await ph.evaluate(() => document.querySelectorAll('.rm-card').length === 1));
  await ph.fill('#rm-q', ''); await ph.click('.rm-card[data-id=tsv]');
  check('Cenário TSV aplicado', await until(() => con.evaluate(() => window.__pl.S.scen.id === 'tsv' && window.__pl.S.rhythm === 'svt')));
  await ph.click('.rm-basal'); check('Botão basal no celular', await until(() => con.evaluate(() => window.__pl.S.scen.id === 'basal')));

  await ph.click('.rm-nav [data-v=pa]'); await ph.waitForTimeout(300); await ph.screenshot({ path: 'r-phone-pa.png' });
  const hr0 = await con.evaluate(() => window.__pl.S.p.to.hr);
  const plus = ph.locator('.rm-stp[data-k=hr][data-d="1"]'); for (let i = 0; i < 5; i++) await plus.tap();
  check('+ da FC no celular altera o alvo no console (aplica sozinho)', await until(() => con.evaluate(h => window.__pl.S.p.to.hr >= h + 5 && window.__pl.S.scen.id === 'custom', hr0)), hr0 + ' → ' + await con.evaluate(() => window.__pl.S.p.to.hr));
  await ph.selectOption('#rm-rh', 'vf');
  check('Trocar o ritmo no celular (FV)', await until(() => con.evaluate(() => window.__pl.S.rhythm === 'vf')));
  check('Ritmo sem pulso trava PAS/SpO₂ no celular', await until(() => ph.evaluate(() => document.getElementById('pw-sys').classList.contains('lock'))));

  await ph.click('.rm-nav [data-v=ac]'); await ph.waitForTimeout(300); await ph.screenshot({ path: 'r-phone-ac.png' });
  check('Ações de parada aparecem em FV (choque, RCP, RCE)', await ph.evaluate(() => !!document.querySelector('[data-c=shock]') && !!document.querySelector('[data-c=cpr]') && !!document.querySelector('[data-c=rce]')));
  await ph.click('[data-c=cpr]'); check('RCP pelo celular', await until(() => con.evaluate(() => window.__pl.S.cpr === true)));
  await ph.click('[data-c=rce]'); check('RCE pelo celular volta ao sinusal', await until(() => con.evaluate(() => window.__pl.S.rhythm === 'sinus' && !window.__pl.S.cpr)));
  await ph.click('[data-c=pause]'); check('Congelar pelo celular', await until(() => con.evaluate(() => window.__pl.S.clock.running === false)));
  await ph.click('[data-c=resume]'); check('Retomar pelo celular', await until(() => con.evaluate(() => window.__pl.S.clock.running === true)));
  await ph.click('[data-rate="5"]'); check('Velocidade ×5', await until(() => con.evaluate(() => window.__pl.S.clock.rate === 5)));
  await ph.click('[data-rate="1"]');
  await ph.click('[data-c=silence]'); check('Silenciar alarmes 2 min', await until(() => con.evaluate(() => window.__pl.S.alarm.silencedUntil > Date.now())));
  await ph.click('[data-c=nibp]'); check('Medir PNI pelo celular', await until(() => con.evaluate(() => window.__pl.S.nibp.state === 'meas')));

  await ph.click('#rm-mute'); check('Ícone de som silencia a projeção (mudo)', await until(() => con.evaluate(() => window.__pl.S.audio.mute === true)));
  check('Botão de som no console reflete o mudo', await until(() => con.evaluate(() => /Mudo/.test(document.getElementById('mutebtn').textContent))));
  await ph.click('#rm-mute'); check('Ícone de som reativa', await until(() => con.evaluate(() => window.__pl.S.audio.mute === false)));

  /* alarme chega ao celular */
  await con.evaluate(() => window.__pl.applyScenario('vf')); const proj = await c1.newPage(); await proj.goto(base + '?mode=projection&ph=127.0.0.1&pp=9187'); await proj.mouse.click(400, 300);
  check('Alarme ativo aparece no celular', await until(() => ph.evaluate(() => document.getElementById('rm-alert').textContent.length > 3), 20000), await ph.evaluate(() => document.getElementById('rm-alert').textContent));
  await ph.screenshot({ path: 'r-phone-alarm.png' });

  /* desconexão e reconexão automática */
  await con.evaluate(() => { const o = [...window.__pl.RM.conns.values()][0]; o.c.close(); });
  check('Console vê o celular sair', await until(() => con.evaluate(() => window.__pl.RM.conns.size === 0)));
  check('Celular reconecta sozinho', await until(() => ph.evaluate(() => window.__rm.status === 'online'), 20000));
  check('Console volta a mostrar 1 celular', await until(() => con.evaluate(() => window.__pl.RM.conns.size === 1)));
  /* PIN errado */
  const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), bad2 = await c3.newPage();
  await bad2.goto(base + '?mode=remote&pin=000000' + dev); check('PIN inexistente mostra erro claro', await until(() => bad2.evaluate(() => /PIN não encontrado/.test(document.getElementById('rm-err').textContent)), 15000));
  /* celular pequeno sem parâmetro abre direto o controle */
  const c4 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), sm = await c4.newPage(); await sm.goto(base);
  check('Abrir o endereço no celular leva direto à tela de PIN', await sm.evaluate(() => document.body.classList.contains('remote') && !!document.getElementById('rm-pin')));
  await sm.screenshot({ path: 'r-phone-pin.png' });
  /* desativar */
  await con.click('#phone'); await con.click('#ph-off'); check('Desativar celular derruba as conexões', await until(() => con.evaluate(() => window.__pl.RM.conns.size === 0 && !window.__pl.RM.on)));
  check('Sem erros de JavaScript', errs.length === 0, JSON.stringify(errs));
  console.log(`\n${ok}/${ok + bad} verificações passaram`); await b.close(); srv.close(); ps.close ? ps.close() : 0; process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FALHA', e); process.exit(1); });
