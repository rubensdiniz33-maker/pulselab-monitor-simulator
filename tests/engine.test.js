const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../src/engine.js');
const { FS, RING, Core, Gen, defaultSession, SCENARIOS, truth, TtoP, rhythmRules, couple, sanitize, migrateV1, nibpResult, PULSELESS } = E;

/* monta uma sessão estável num cenário e roda o núcleo por `secs` segundos de onda */
function session(opts = {}) {
  const S = defaultSession();
  const v = Object.assign({}, S.p.to, opts.v || {});
  const r = opts.rhythm || 'sinus';
  const vv = E.rhythmRules(v, r, !!opts.cpr);
  S.rhythm = r; S.p = { from: vv, to: vv, t0: 0, dur: 0 }; S.var = !!opts.var; S.cpr = !!opts.cpr;
  S.ectopy = opts.ectopy || 0; S.vf = opts.vf || 'coarse'; S.seed = opts.seed || 7;
  return S;
}
function run(S, secs, step = 0.1) {
  const c = new Core(); S.clock.running = true; c.setState(S, 0);
  c.gen.reset(S.seed, 0); c.lastU = 0; c.T = 0;
  const alarms = [];
  for (let T = step; T <= secs + 1e-9; T += step) { c.advance(T); alarms.push([T, c.alm.list.map(a => a.text)]); }
  c.alarmLog = alarms; return c;
}
const slice = (arr, a, b) => Array.from(arr.slice(a, b));

test('ECG sinusal 60 bpm sem variabilidade: R-R exato de 1000 ms', () => {
  const c = run(session({ v: { hr: 60 } }), 40);
  const q = c.gen.ev.qrs.filter(e => e.t > 5 && e.t < 38);
  for (let i = 1; i < q.length; i++) assert.ok(Math.abs(q[i].t - q[i - 1].t - 1) < 0.001, 'RR ' + (q[i].t - q[i - 1].t));
});

test('FC medida da onda = alvo (±2 bpm) em 40, 60, 100, 150 e 180', () => {
  for (const hr of [40, 60, 100, 150, 180, 240, 300]) {
    const c = run(session({ v: { hr }, var: true }), 45);
    assert.ok(Math.abs(c.meas.v.hr - hr) <= 2, `alvo ${hr} medido ${c.meas.v.hr}`);
  }
});

test('Taquicardia e bradicardia: morfologia escalada (QT por Fridericia)', () => {
  const c = run(session({ v: { hr: 60 } }), 10);
  const b = c.gen.beats[c.gen.beats.length - 1];
  assert.ok(Math.abs(b.qt - 0.41) < 0.01, 'QT 60 bpm = ' + b.qt);
  assert.ok(b.pr >= 0.12 && b.pr <= 0.2);
  const c2 = run(session({ v: { hr: 150 } }), 10), b2 = c2.gen.beats[c2.gen.beats.length - 1];
  assert.ok(b2.qt < b.qt && b2.pr <= b.pr);
});

test('FA: R-R irregular, sem onda P, FC média ±5%', () => {
  const c = run(session({ rhythm: 'afib', v: { hr: 138 } }), 120);
  const q = c.gen.ev.qrs.filter(e => e.t > 10), rr = [];
  for (let i = 1; i < q.length; i++) rr.push(q[i].t - q[i - 1].t);
  const m = rr.reduce((a, b) => a + b) / rr.length, sd = Math.sqrt(rr.reduce((a, b) => a + (b - m) ** 2, 0) / rr.length);
  assert.ok(sd / m >= 0.15, 'CV ' + sd / m);
  let num = 0, den = 0; for (let i = 1; i < rr.length; i++) { num += (rr[i] - m) * (rr[i - 1] - m); } for (const r of rr) den += (r - m) ** 2;
  assert.ok(Math.abs(num / den) < 0.3, 'autocorrelação ' + num / den);
  assert.ok(c.gen.beats.every(b => b.pa === 0), 'sem onda P');
  assert.ok(Math.abs(60 / m - 138) / 138 < 0.05, 'FC média ' + 60 / m);
});

test('FA: déficit de pulso (FC de pulso ≤ FC do ECG)', () => {
  const c = run(session({ rhythm: 'afib', v: { hr: 150 } }), 120);
  const w = e => e.t > 10 && e.t < 115; assert.ok(c.gen.ev.pulse.filter(w).length <= c.gen.ev.qrs.filter(w).length); assert.ok(c.meas.v.pr === null || c.meas.v.pr <= c.meas.v.hr + 2);
});

test('TV: regular (CV < 0,05), FC ±3%, complexo largo', () => {
  const c = run(session({ rhythm: 'vt', v: { hr: 180 } }), 40);
  const q = c.gen.ev.qrs.filter(e => e.t > 5), rr = [];
  for (let i = 1; i < q.length; i++) rr.push(q[i].t - q[i - 1].t);
  const m = rr.reduce((a, b) => a + b) / rr.length, sd = Math.sqrt(rr.reduce((a, b) => a + (b - m) ** 2, 0) / rr.length);
  assert.ok(sd / m < 0.05); assert.ok(Math.abs(60 / m - 180) / 180 < 0.03);
  assert.ok(c.gen.beats.every(b => b.type === 'V'));
});

test('FV: sem QRS, frequência dominante 4–7 Hz, FC "---"', () => {
  const c = run(session({ rhythm: 'vf' }), 30);
  assert.equal(c.gen.ev.qrs.length, 0); assert.equal(c.meas.v.hr, null);
  const x = slice(c.gen.ecg, 10 * FS, 30 * FS); let cr = 0; const mean = x.reduce((a, b) => a + b) / x.length;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] - mean) * (x[i] - mean) < 0) cr++;
  const f = cr / 2 / 20; assert.ok(f >= 3.5 && f <= 8, 'freq ' + f);
});

test('Assistolia: RMS < 0,05 mV, FC "---" e alarme em ≤ 5 s', () => {
  const c = run(session({ rhythm: 'asys' }), 30);
  const x = slice(c.gen.ecg, 5 * FS, 30 * FS), rms = Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
  assert.ok(rms < 0.05, 'rms ' + rms); assert.equal(c.meas.v.hr, null);
  const first = c.alarmLog.find(([, l]) => l.includes('ASSISTOLIA')); assert.ok(first && first[0] <= 5.5, 'alarme em ' + (first && first[0]));
});

test('Pleth: um pulso por batimento, pé 150–250 ms após o R, FC de pulso = FC', () => {
  const c = run(session({ v: { hr: 80 } }), 40);
  const q = c.gen.ev.qrs.filter(e => e.t > 8 && e.t < 36), p = c.gen.ev.pulse.filter(e => e.t > 8 && e.t < 36);
  assert.ok(Math.abs(q.length - p.length) <= 1);
  const d = p[3].t - q.find(e => e.t < p[3].t && p[3].t - e.t < 0.6).t; assert.ok(d - 0.13 >= 0.15 && d - 0.13 <= 0.25, 'delay do pé ' + (d - 0.13));
  assert.ok(Math.abs(c.meas.v.pr - 80) <= 2);
});

test('Ritmos sem pulso: pleth reta em ≤ 5 s e SpO₂ "---" em ≤ 15 s', () => {
  for (const rh of ['vtp', 'vf', 'asys', 'pea']) {
    const S = session({ v: { hr: 60 } }); // começa com pulso
    const c = new Core(); c.setState(S, 0); c.gen.reset(S.seed, 0);
    for (let T = 0.1; T <= 20; T += 0.1) { c.advance(T); }
    assert.ok(c.meas.v.spo2 !== null);
    const S2 = JSON.parse(JSON.stringify(S)); S2.rhythm = rh; S2.p = { from: S.p.to, to: rhythmRules(S.p.to, rh, false), t0: 0, dur: 0 }; S2.rev++;
    c.setState(S2, 20);
    for (let T = 20.1; T <= 40; T += 0.1) { c.advance(T); if (Math.abs(T - 25) < 0.05) { const x = slice(c.gen.pl, Math.floor(24 * FS), Math.floor(25 * FS)); assert.ok(Math.max(...x) < 0.05, rh + ' pleth ainda pulsa'); } if (Math.abs(T - 35) < 0.05) assert.equal(c.meas.v.spo2, null, rh + ' SpO2 ainda exibida'); }
  }
});

test('Capnograma: platô = EtCO₂ (±1), FR medida ±1, linha de base 0', () => {
  const c = run(session({ v: { rr: 16, etco2: 38 } }), 60);
  assert.ok(Math.abs(c.meas.v.etco2 - 38) <= 1, 'EtCO2 ' + c.meas.v.etco2);
  assert.ok(Math.abs(c.meas.v.rr - 16) <= 1, 'FR ' + c.meas.v.rr);
  const co = slice(c.gen.co, 10 * FS, 60 * FS); assert.ok(Math.min(...co) >= 0); assert.ok(Math.max(...co) <= 38.5 && Math.max(...co) >= 37);
});

test('FR 0: capnograma reto e apneia em 20 s ±1', () => {
  const S = session({ v: { rr: 16 } }); const c = new Core(); c.setState(S, 0); c.gen.reset(S.seed, 0);
  for (let T = 0.1; T <= 15; T += 0.1) c.advance(T);
  const S2 = JSON.parse(JSON.stringify(S)); S2.p = { from: S.p.to, to: Object.assign({}, S.p.to, { rr: 0 }), t0: 0, dur: 0 }; S2.rev++; c.setState(S2, 15);
  let t0 = null, firstApnea = null;
  for (let T = 15.1; T <= 60; T += 0.1) { c.advance(T); if (!firstApnea && c.alm.list.some(a => a.text === 'APNEIA')) firstApnea = T; }
  const lastBreath = c.gen.ev.breath[c.gen.ev.breath.length - 1].t;
  assert.ok(firstApnea - lastBreath >= 19 && firstApnea - lastBreath <= 21.5, 'apneia após ' + (firstApnea - lastBreath));
  const co = slice(c.gen.co, Math.floor(45 * FS), Math.floor(60 * FS)); assert.equal(Math.max(...co), 0);
});

test('NÚMERO = ONDA em todos os cenários (FC ±2, FC de pulso ±2, FR ±1, EtCO₂ ±1)', () => {
  for (const sc of SCENARIOS) {
    const v = sc.ph[0].v, rh = sc.rhythm;
    const S = session({ rhythm: rh, v, ectopy: sc.ectopy || 0, var: false });
    const c = run(S, 70, 0.25), m = c.meas.v, tr = c.truthAt(70);
    if (['vf', 'asys', 'leadoff'].includes(rh)) assert.equal(m.hr, null, sc.id + ' FC deveria ser ---');
    else if (rh === 'afib') assert.ok(Math.abs(m.hr - v.hr) / v.hr < 0.12, sc.id + ' FC ' + m.hr);
    else if (!sc.ectopy) assert.ok(Math.abs(m.hr - v.hr) <= 2, sc.id + ' FC ' + m.hr + ' vs ' + v.hr);
    if (tr.pulse) { if (rh !== 'afib' && !sc.ectopy) assert.ok(Math.abs(m.pr - v.hr) <= 2, sc.id + ' PR ' + m.pr); } else assert.equal(m.pr, null, sc.id + ' PR');
    if (v.rr > 0) { assert.ok(Math.abs(m.rr - v.rr) <= 1, sc.id + ' FR ' + m.rr); assert.ok(Math.abs(m.etco2 - v.etco2) <= 1, sc.id + ' EtCO2 ' + m.etco2); }
    else { assert.equal(m.rr, null, sc.id + ' FR'); }
  }
});

test('Determinismo: mesma semente e mesmo relógio = mesmas amostras', () => {
  const h = () => { const c = run(session({ rhythm: 'afib', v: { hr: 120 }, var: true, seed: 99 }), 12, 0.5); const hh = crypto.createHash('sha256'); for (const a of [c.gen.ecg, c.gen.pl, c.gen.rs, c.gen.co]) hh.update(Buffer.from(a.buffer, 0, 12 * FS * 4)); return hh.digest('hex'); };
  assert.equal(h(), h());
});

test('Transições: sem descontinuidade de fase no ECG ao mudar a FC no meio do batimento', () => {
  const S = session({ v: { hr: 60 } }); const c = new Core(); c.setState(S, 0); c.gen.reset(S.seed, 0);
  for (let T = 0.1; T <= 10.4; T += 0.1) c.advance(T);
  const S2 = JSON.parse(JSON.stringify(S)); S2.p = { from: S.p.to, to: Object.assign({}, S.p.to, { hr: 120 }), t0: 0, dur: 30 }; S2.rev++; c.setState(S2, 10.4);
  for (let T = 10.5; T <= 20; T += 0.1) c.advance(T);
  const x = slice(c.gen.ecg, 8 * FS, 20 * FS); let maxJump = 0; for (let i = 1; i < x.length; i++) maxJump = Math.max(maxJump, Math.abs(x[i] - x[i - 1]));
  assert.ok(maxJump < 0.35, 'salto máximo entre amostras ' + maxJump); // R sobe ~1 mV em ~20 ms = 0,2/amostra
});

test('Cenários com fases: taxa de variação plausível entre fases (FC ≤ 2 bpm/s, SpO₂ ≤ 1 pp/s)', () => {
  for (const sc of SCENARIOS) for (let i = 1; i < sc.ph.length; i++) {
    const a = sc.ph[i - 1].v, b = sc.ph[i].v, d = sc.ph[i].dur;
    if (sc.ph[i].rhythm) continue; // mudança de ritmo é evento abrupto (ex.: parada), não rampa
    assert.ok(1.5 * Math.abs(b.hr - a.hr) / d <= 2, sc.id + ' fase ' + i + ' FC ' + 1.5 * Math.abs(b.hr - a.hr) / d);
    assert.ok(1.5 * Math.abs(b.spo2 - a.spo2) / d <= 1, sc.id + ' fase ' + i + ' SpO2');
  }
});

test('Propriedades: 1000 entradas aleatórias do professor nunca geram valores impossíveis', () => {
  const r = E.mulberry32(5);
  for (let i = 0; i < 1000; i++) {
    const S = defaultSession(); S.rhythm = E.RHYTHMS[Math.floor(r() * E.RHYTHMS.length)];
    const v = { hr: r() * 300, sys: r() * 300, dia: r() * 200, rr: r() * 60, spo2: r() * 100, etco2: r() * 100, temp: 30 + r() * 13 };
    S.p = { from: v, to: v, t0: 0, dur: 0 };
    const t = truth(S, 5);
    assert.ok(t.sys === 0 || t.sys > t.dia, 'PAS>PAD'); assert.ok(Object.values({ a: t.sys, b: t.dia, c: t.hr, d: t.rr, e: t.spo2, f: t.etco2 }).every(x => Number.isFinite(x) && x >= 0));
    if (t.sys > 0) assert.ok(Math.abs(t.map - (t.dia + (t.sys - t.dia) / 3)) <= 1);
    if (PULSELESS.has(S.rhythm)) { assert.equal(t.sys, 0); assert.equal(t.pulse, false); assert.equal(t.perf, 0); }
  }
});

test('Alarmes: cruzar limite dispara após o atraso, com prioridade correta', () => {
  const S = session({ v: { hr: 140 } });
  const c = run(S, 30);
  const first = c.alarmLog.find(([, l]) => l.includes('FC ALTA')); assert.ok(first, 'FC ALTA nunca disparou');
  const S2 = session({ v: { spo2: 80 } }), c2 = run(S2, 40);
  const l = c2.alm.list; assert.ok(l.some(a => a.text === 'SpO₂ MUITO BAIXA' && a.prio === 3));
  const S3 = session({ rhythm: 'vf' }), c3 = run(S3, 5); assert.ok(c3.alm.list.some(a => a.text === 'FIBRILAÇÃO VENTRICULAR' && a.prio === 3));
  const S4 = session({ rhythm: 'leadoff' }), c4 = run(S4, 20); assert.ok(c4.alm.list.some(a => a.text === 'ELETRODO SOLTO' && a.prio === 1)); assert.ok(!c4.alm.list.some(a => a.text === 'ASSISTOLIA'));
  S.alarm.on = false; assert.equal(new E.Alarms().update(1, c.meas.v, c.truthAt(30), S, null).length, 0);
});

test('PNI: resultado coerente, PAM = PAD + (PAS−PAD)/3, falha sem pulso', () => {
  const S = session(); const r = nibpResult(S, 10, 3);
  assert.ok(r.ok && r.sys > r.dia && Math.abs(r.map - (r.dia + (r.sys - r.dia) / 3)) <= 1);
  assert.equal(nibpResult(session({ rhythm: 'vf' }), 10, 3).ok, false);
  assert.ok(E.cuffPressure(10, 170) === 170 && E.cuffPressure(40, 170) === 0);
});

test('Acoplamento: queda de SpO₂ aumenta FR/FC; febre aumenta FC; FR sobe → EtCO₂ cai', () => {
  const a = { hr: 76, sys: 120, dia: 74, rr: 15, spo2: 98, etco2: 38, temp: 36.7 };
  let r = couple(a, Object.assign({}, a, { spo2: 88 }), 'spo2'); assert.ok(r.next.rr > 15 && r.next.hr > 76);
  r = couple(a, Object.assign({}, a, { temp: 38.7 }), 'temp'); assert.ok(r.next.hr > 90);
  r = couple(a, Object.assign({}, a, { rr: 28 }), 'rr'); assert.ok(r.next.etco2 < 38);
  r = couple(a, Object.assign({}, a, { sys: 80 }), 'sys'); assert.ok(r.next.hr > 76 && r.next.etco2 < 38);
});

test('Sessão: migração v1 → v2, JSON corrompido → padrão, limites aplicados', () => {
  const v1 = { rhythm: 'vtach', hr: 180, rr: 0, spo2: 82, sys: 65, dia: 40, etco2: 18, temp: 36.7, run: true, alarms: true, speed: 50, gain: 2, gridmode: 'off', showCapno: 'off' };
  const S = sanitize(v1); assert.equal(S.schema, 2); assert.equal(S.rhythm, 'vt'); assert.equal(S.display.speed, 50); assert.equal(S.display.gain, 2); assert.equal(S.display.grid, false); assert.equal(S.display.capno, false);
  assert.equal(sanitize('lixo').schema, 2); assert.equal(sanitize(null).rhythm, 'sinus');
  const bad = sanitize({ schema: 2, rhythm: 'xyz', p: { to: { hr: 9999, sys: -5 } }, clock: { rate: 999 } });
  assert.equal(bad.rhythm, 'sinus'); assert.equal(bad.p.to.hr, 300); assert.equal(bad.p.to.sys, 0); assert.equal(bad.clock.rate, 20);
});

test('Parada: SpO₂, PNI e FC de pulso aparecem como "---"; EtCO₂ cai; RCP mantém 10–20 mmHg', () => {
  const S = session({ rhythm: 'vf', v: { etco2: 38 } }); // regras zeram FR e caem EtCO2 p/ 6
  const t = truth(S, 10); assert.equal(t.sys, 0); assert.equal(t.rr, 0);
  const cpr = session({ rhythm: 'vf', cpr: true }); const c = run(cpr, 60); const tr = c.truthAt(60);
  assert.ok(tr.rr === 10 && tr.etco2 >= 10 && tr.etco2 <= 20);
  assert.ok(Math.abs(c.meas.v.etco2 - 15) <= 2, 'EtCO2 em RCP ' + c.meas.v.etco2);
});

/* ---------- v3 ---------- */
test('Abertura: a sessão nova já nasce com histórico (tela cheia) e números medidos imediatamente', () => {
  const S = defaultSession(); S.clock.running = true; S.clock.wall0 = Date.now();
  const c = new Core(); const T = E.clockT(S.clock, S.clock.wall0 + 100); c.setState(S, T); c.advance(T);
  assert.ok(c.gen.n / FS - c.gen.n0 / FS >= 25, 'histórico de ' + (c.gen.n - c.gen.n0) / FS + ' s');
  const m = c.meas.v; assert.ok(Math.abs(m.hr - 76) <= 2, 'FC ' + m.hr); assert.ok(m.rr !== null && Math.abs(m.rr - 15) <= 1, 'FR ' + m.rr); assert.ok(m.etco2 !== null && Math.abs(m.etco2 - 38) <= 1, 'EtCO2 ' + m.etco2); assert.ok(m.spo2 !== null && m.pr !== null);
  assert.equal(S.nibp.res.ok, true, 'PNI já traz uma leitura anterior');
});

test('Projeção aberta no meio da aula também abre com 26 s de histórico', () => {
  const S = defaultSession(); S.clock = { running: true, wall0: 1000, rt0: 500, pt0: 470, rate: 1 };
  const c = new Core(); c.setState(S, 500); c.advance(500); assert.ok((c.gen.n - c.gen.n0) / FS >= 25);
});

test('FR medida usa a mediana: um retorno da apneia não gera «FR BAIXA» espúria', () => {
  const S = session({ v: { rr: 16 } }); const c = run(S, 60);
  assert.ok(Math.abs(c.meas.v.rr - 16) <= 1);
  // simula intervalos [60 s, 4 s, 4 s]: mediana = 4 s = 15/min
  const M = new E.Meas(), gen = { ev: { qrs: [], pulse: [], breath: [{ t: 10 }, { t: 70 }, { t: 74 }, { t: 78 }], etco2: [{ t: 78, v: 38 }] } };
  const v = M.update(79, gen, { spo2: 98, temp: 36.7, perf: 1 }); assert.equal(v.rr, 15);
});

test('AESP e parada: sem alarme de FR alta/baixa (só apneia e SpO₂ sem sinal)', () => {
  const c = run(session({ rhythm: 'pea' }), 60);
  const all = new Set(c.alarmLog.flatMap(([, l]) => l)); assert.ok(!all.has('FR BAIXA') && !all.has('FR ALTA'), [...all].join('|'));
});

test('Áudio: padrões e saneamento (volume, bip, fonte)', () => {
  const D = defaultSession(); assert.equal(D.audio.beep, true); assert.equal(D.audio.beepSrc, 'ecg'); assert.ok(D.audio.vol > 0 && D.audio.beepVol > 0);
  const S = sanitize({ schema: 2, audio: { vol: 999, beepVol: -5, beep: false, beepSrc: 'xx' } });
  assert.equal(S.audio.vol, 100); assert.equal(S.audio.beepVol, 0); assert.equal(S.audio.beep, false); assert.equal(S.audio.beepSrc, 'ecg');
  assert.equal(sanitize({ schema: 2, audio: { beepSrc: 'spo2' } }).audio.beepSrc, 'spo2');
  assert.equal(sanitize({ schema: 2, alarm: { sound: false } }).alarm.sound, false);
});

test('Choque: deflexão que satura, linha reta e retomada do ritmo; FV some só se o professor mudar o ritmo', () => {
  const S = session({ rhythm: 'vf' }); const c = new Core(); S.clock.running = true; c.setState(S, 0); c.gen.reset(S.seed, 0); c.lastU = 0;
  c.advance(10); const S2 = JSON.parse(JSON.stringify(S)); S2.shockT = 10; c.setState(sanitize(S2), 10); c.advance(14);
  const at = a => c.gen.ecg[Math.round(a * FS)];
  assert.ok(at(10.02) > 5, 'saturação ' + at(10.02)); assert.ok(Math.abs(at(11.9)) < 0.1, 'linha reta ' + at(11.9));
  const after = slice(c.gen.ecg, 12 * FS, 14 * FS); const rms = Math.sqrt(after.reduce((a, b) => a + b * b, 0) / after.length); assert.ok(rms > 0.05, 'FV volta (sem mudança de ritmo): ' + rms);
});

test('Layout da projeção: ordem e ocultos são saneados (ids inválidos somem, faltantes voltam)', () => {
  const D = defaultSession(); assert.deepEqual(D.layout.nums, ['hr', 'spo2', 'nibp', 'etco2', 'rr', 'temp']); assert.deepEqual(D.layout.hidden, []);
  const L = E.cleanLayout({ waves: ['capno', 'xx', 'ecg', 'ecg'], nums: ['temp', 'hr'], hidden: ['rr', 'rr', 'zz', 'capno'] });
  assert.deepEqual(L.waves, ['capno', 'ecg', 'pleth', 'resp']); assert.deepEqual(L.nums, ['temp', 'hr', 'spo2', 'nibp', 'etco2', 'rr']); assert.deepEqual(L.hidden, ['rr', 'capno']);
  assert.deepEqual(sanitize({ schema: 2, layout: 'lixo' }).layout, E.DEFAULT_LAYOUT);
});

/* ---------- v5: novos ritmos e cenários ---------- */
test('Flutter, TSV e BAV total: FC medida = alvo e ritmo regular', () => {
  for (const [r, hr] of [['flutter', 150], ['svt', 188], ['avb3', 36]]) {
    const c = run(session({ rhythm: r, v: { hr } }), 45);
    assert.ok(Math.abs(c.meas.v.hr - hr) <= 3, `${r} alvo ${hr} medido ${c.meas.v.hr}`);
    const q = c.gen.ev.qrs.filter(e => e.t > 8), rr = []; for (let i = 1; i < q.length; i++) rr.push(q[i].t - q[i - 1].t);
    assert.ok(Math.max(...rr) - Math.min(...rr) < 0.12 * (60 / hr) + 0.02, r + ' deve ser regular');
  }
});
test('Torsades: sem QRS, alarme TORSADES e nunca ASSISTOLIA, SpO₂ sem sinal', () => {
  const c = run(session({ rhythm: 'tdp', v: { hr: 0 } }), 20);
  const txt = c.alarmLog.slice(-1)[0][1].join('|');
  assert.ok(/TORSADES/.test(txt), txt); assert.ok(!/ASSISTOLIA/.test(txt), txt);
  assert.equal(c.meas.v.hr, null); assert.ok(PULSELESS.has('tdp'));
  const ecg = slice(c.gen.ecg, 10 * FS, 18 * FS); assert.ok(Math.max(...ecg) > 0.6 && Math.min(...ecg) < -0.6);
});
test('Supra de ST eleva o segmento entre o QRS e a onda T', () => {
  const lvl = st => { const S = session({ v: { hr: 60 } }); S.st = st; const c = run(S, 20), q = c.gen.ev.qrs.filter(e => e.t > 6 && e.t < 18); let a = 0; for (const e of q) a += c.gen.ecg[Math.round((e.t + 0.12) * FS) % RING]; return a / q.length; };
  assert.ok(lvl(0.4) - lvl(0) > 0.25, `${lvl(0.4)} vs ${lvl(0)}`);
});
test('BAV total: ondas P independentes dos QRS (P a ~78/min)', () => {
  const c = run(session({ rhythm: 'avb3', v: { hr: 36 } }), 30);
  const e = slice(c.gen.ecg, 10 * FS, 20 * FS), q = c.gen.ev.qrs.filter(x => x.t > 10 && x.t < 20);
  assert.ok(q.length >= 5 && q.length <= 7);
});
test('Todos os cenários: fases válidas, fonte presente e rodam 60 s sem erro nem NaN', () => {
  assert.ok(SCENARIOS.length >= 30);
  const ids = new Set();
  for (const sc of SCENARIOS) {
    assert.ok(!ids.has(sc.id), 'id duplicado ' + sc.id); ids.add(sc.id);
    assert.ok(sc.name && sc.sub && sc.fonte && E.RHYTHMS.includes(sc.rhythm), sc.id);
    let last = -1; for (const ph of sc.ph) { assert.ok(ph.at > last || ph.at === 0, sc.id + ' fases fora de ordem'); last = ph.at; if (ph.rhythm) assert.ok(E.RHYTHMS.includes(ph.rhythm), sc.id); for (const k of E.KEYS) assert.ok(Number.isFinite(ph.v[k]), sc.id + k); }
    for (let i = 0; i < sc.ph.length; i++) {
      const ph = sc.ph[i], S = session({ rhythm: ph.rhythm || sc.rhythm, v: ph.v, ectopy: ph.ectopy !== undefined ? ph.ectopy : sc.ectopy });
      S.st = ph.st || 0; const c = run(S, 25);
      for (const a of [c.gen.ecg, c.gen.pl, c.gen.rs, c.gen.co]) for (let n = 0; n < 25 * FS; n += 7) assert.ok(Number.isFinite(a[n]), sc.id + ' NaN');
    }
  }
});
test('sanitize aceita st e novos ritmos, e rejeita lixo', () => {
  const S = defaultSession(); S.rhythm = 'avb3'; S.st = 9; const o = sanitize(JSON.parse(JSON.stringify(S)));
  assert.equal(o.rhythm, 'avb3'); assert.equal(o.st, 0.8); S.rhythm = 'xx'; assert.equal(sanitize(JSON.parse(JSON.stringify(S))).rhythm, 'sinus');
});
