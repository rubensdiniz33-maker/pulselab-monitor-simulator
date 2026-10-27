/* PulseLab engine: puro, sem DOM. Usado pelo monitor (navegador) e pelos testes (node). */
const FS = 250, RING = FS * 80;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = x => x * x * (3 - 2 * x);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (!u) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const g = (x, c, s, a) => a * Math.exp(-((x - c) * (x - c)) / (2 * s * s));

const HR_DRIFT = new Set(['sinus', 'afib', 'flutter', 'svt', 'avb3', 'pea']);
const PULSELESS = new Set(['vtp', 'vf', 'asys', 'pea', 'tdp']);
const KEYS = ['hr', 'sys', 'dia', 'rr', 'spo2', 'etco2', 'temp'];
const RHYTHMS = ['sinus', 'afib', 'flutter', 'svt', 'avb3', 'vt', 'tdp', 'vtp', 'vf', 'asys', 'pea', 'leadoff'];
const LIMITS = { hrLo: 50, hrHi: 120, spo2Lo: 90, sysLo: 90, sysHi: 160, mapLo: 65, rrLo: 8, rrHi: 25, etLo: 30, etHi: 50, tLo: 36, tHi: 38 };

/* ---------- relógios ----------
   T = tempo de onda (segundos reais de simulação rodando; as ondas andam sempre em tempo real)
   P = tempo fisiológico (T x velocidade da aula; faz a evolução clínica andar mais rápido) */
function clockT(c, now) { return c.running ? c.rt0 + (now - c.wall0) / 1000 : c.rt0; }
function TtoP(c, T) { return c.pt0 + (T - c.rt0) * c.rate; }
function clockP(c, now) { return TtoP(c, clockT(c, now)); }

/* ---------- fisiologia: estado verdadeiro em função do tempo ---------- */
function truth(S, P) {
  const p = S.p, k = p.dur > 0 ? smooth(clamp((P - p.t0) / p.dur, 0, 1)) : 1, v = {};
  for (const key of KEYS) v[key] = p.from[key] + (p.to[key] - p.from[key]) * k;
  const pl = PULSELESS.has(S.rhythm);
  if (pl) { v.sys = 0; v.dia = 0; }
  else if (v.sys > 0) { v.sys = Math.max(v.sys, 20); v.dia = clamp(v.dia, 0, v.sys - 8); } else { v.sys = 0; v.dia = 0; }
  v.map = v.sys > 0 ? v.dia + (v.sys - v.dia) / 3 : 0;
  const pp = v.sys - v.dia;
  v.pulse = !pl && v.sys > 0;
  v.perf = v.pulse ? clamp(Math.pow(Math.max(pp, 0) / 42, 0.8) * clamp(v.map / 70, 0.25, 1.15), 0.04, 1.3) : 0;
  v.st = S.st || 0; v.rhythm = S.rhythm; v.cpr = !!S.cpr; v.ectopy = S.ectopy || 0; v.vf = S.vf || 'coarse';
  return v;
}

/* ---------- gerador de ondas ---------- */
class Gen {
  constructor(truthAt, seed, t0) { this.truthAt = truthAt; this.reset(seed || 1, t0 || 0); }
  reset(seed, t0) {
    const dr = mulberry32((seed ^ 0x9e3779b9) >>> 0); this.dph = [dr() * 6.2832, dr() * 6.2832, dr() * 6.2832];
    this.rng = mulberry32(seed); this.n0 = Math.floor(t0 * FS); this.n = this.n0;
    this.ecg = new Float32Array(RING); this.pl = new Float32Array(RING); this.rs = new Float32Array(RING); this.co = new Float32Array(RING);
    this.beats = []; this.pulses = []; this.next = t0 + 0.35; this.nextType = 'N'; this.afterV = 0; this.lastR = t0;
    this.ev = { qrs: [], pulse: [], breath: [], etco2: [] };
    this.br = null; this.bph = 0; this.bvar = 1; this.prevE = 0; this.peak = 0; this.rcls = '';
    this.vfph = [0, 0, 0]; this.fib = [0, 0, 0]; this.lastE = 0; this.shockAt = null;
  }
  /* oscilação lenta e natural da FC (±2–3 bpm): soma de três ondas lentas com fases próprias da sessão */
  hrDrift(t, hr) { const p = this.dph, A = hr > 170 ? 1.6 : 2.6, w = 2 * Math.PI * t; return A * (0.55 * Math.sin(w / 19 + p[0]) + 0.3 * Math.sin(w / 43 + p[1]) + 0.15 * Math.sin(w / 11 + p[2])); }
  advanceTo(T) { const N = Math.floor(T * FS); while (this.n < N) this.step(); }
  breathSin(t) { return this.br ? Math.sin(2 * Math.PI * this.bph) : 0; }
  sched(t, tr) {
    const cls = tr.rhythm === 'leadoff' ? 'sinus' : tr.rhythm;
    if (cls !== this.rcls) { this.rcls = cls; this.beats = []; this.pulses = []; this.nextType = 'N'; this.next = Math.max(t + 0.25, Math.min(this.next, t + 0.9)); }
    if (!['sinus', 'afib', 'flutter', 'svt', 'avb3', 'vt', 'vtp', 'pea'].includes(cls)) return;
    const hr0 = clamp(tr.hr || 60, 20, 300), hr = (tr.var && HR_DRIFT.has(cls)) ? clamp(hr0 + this.hrDrift(t, hr0), 20, 300) : hr0, vis = tr.rhythm !== 'leadoff';
    while (this.next <= t + 0.45) {
      const tR = this.next; let rr = 60 / hr, type = this.nextType, pf = 1, mean = rr;
      if (cls === 'sinus' || cls === 'pea') {
        const amp = (tr.var ? 3.5 : 0) * clamp((125 - hr) / 55, 0, 1) * (tr.perf > 0.3 || cls === 'pea' ? 1 : 0.3);
        rr = 60 / Math.max(hr + amp * this.breathSin(tR), 15);
        if (type === 'V') { this.nextType = 'N'; rr = this.afterV; pf = 0.55; }
        else if (tr.ectopy > 0 && this.rng() < tr.ectopy / hr) { this.nextType = 'V'; this.afterV = 1.42 * rr; rr = 0.58 * rr; }
        if (this.nextType === 'N' && type === 'V') type = 'V';
      } else if (cls === 'afib') {
        rr = Math.max(0.28, mean * Math.exp(0.26 * gauss(this.rng) - 0.0338));
        pf = clamp(Math.pow(Math.max(tR - this.lastR, 0.05) / mean, 0.7), 0.3, 1.4);
      } else if (cls === 'flutter' || cls === 'svt' || cls === 'avb3') {
        rr = 60 / hr * (1 + (cls === 'avb3' ? 0.012 : 0.006) * gauss(this.rng));
      } else { rr = 60 / hr * (1 + 0.004 * gauss(this.rng)); type = 'V'; pf = 0.7; }
      const RRs = clamp(tR - this.lastR, 0.3, 2.0);
      const b = { tR, type, pr: clamp(0.16 - (hr - 70) * 0.0008, 0.12, 0.2), qt: 0.41 * Math.cbrt(RRs), pa: (cls === 'afib' || cls === 'flutter' || cls === 'svt' || cls === 'avb3') ? 0 : 1, esc: cls === 'avb3', st: tr.st || 0, vt: cls === 'vt' || cls === 'vtp' };
      this.beats.push(b);
      if (vis) this.ev.qrs.push({ t: tR });
      if (tr.pulse && pf >= 0.45 && cls !== 'pea') {
        const amp = tr.perf * (type === 'V' ? Math.min(pf, 0.7) : pf);
        this.pulses.push({ tf: tR + 0.2, amp });
        if (amp >= 0.12) this.ev.pulse.push({ t: tR + 0.2 + 0.13, amp });
      }
      this.lastR = tR; this.next = tR + rr;
    }
    while (this.beats.length && this.beats[0].tR < t - 1.2) this.beats.shift();
    while (this.pulses.length && this.pulses[0].tf < t - 1.5) this.pulses.shift();
  }
  ecgAt(t, tr) {
    const cls = tr.rhythm; let y = 0;
    if (this.shockAt !== null && t >= this.shockAt && t < this.shockAt + 1.8) {
      // descarga: deflexão que satura, decaimento da linha de base e linha reta até o monitor se recuperar
      const d = t - this.shockAt; return d < 0.07 ? 6 : 2.6 * Math.exp(-(d - 0.07) / 0.45) * (d < 1.5 ? 1 : (1.8 - d) / 0.3) + (this.rng() - 0.5) * 0.01;
    }
    if (cls === 'tdp') {
      this.vfph[0] += 2 * Math.PI * (3.9 + 0.5 * Math.sin(t * 0.8)) / FS;
      const env = 0.18 + 0.82 * Math.abs(Math.sin(Math.PI * t / 2.4)); y = 1.1 * env * Math.sin(this.vfph[0]) + 0.15 * env * Math.sin(2 * this.vfph[0] + 1);
    } else if (cls === 'vf') {
      const A = tr.vf === 'fine' ? 0.12 : 0.55, f = [4.6, 5.8, 6.7];
      for (let i = 0; i < 3; i++) this.vfph[i] += 2 * Math.PI * (f[i] + 0.7 * Math.sin(t * (0.31 + 0.17 * i) + i)) / FS;
      const env = 0.65 + 0.35 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
      y = A * env * (0.6 * Math.sin(this.vfph[0]) + 0.45 * Math.sin(this.vfph[1]) + 0.3 * Math.sin(this.vfph[2]));
    } else if (cls === 'asys') { y = 0.02 * Math.sin(t * 1.7) + (this.rng() - 0.5) * 0.012; }
    else if (cls === 'leadoff') { y = (this.rng() - 0.5) * 0.16 + 0.06 * Math.sin(2 * Math.PI * 49 * t); }
    else {
      for (const b of this.beats) {
        const dt = t - b.tR; if (dt < -0.45 || dt > 0.7) continue;
        if (b.type === 'V' || b.esc) y += g(dt, 0, 0.042, 0.95) + g(dt, 0.10, 0.055, -0.55) + g(dt, 0.2, 0.07, 0.2);
        else y += g(dt, 0.01 - b.pr, 0.022, 0.14 * b.pa) + g(dt, -0.024, 0.008, -0.11) + g(dt, 0, 0.011, 1.0) + g(dt, 0.024, 0.010, -0.22) + g(dt, -0.12 + b.qt, 0.045, 0.3);
      }
      if (cls === 'avb3') { const Tp = 60 / 78, k = Math.round(t / Tp), dp = t - k * Tp; y += g(dp, 0, 0.024, 0.16); }
      if (cls === 'flutter') { const u = (t * 5) % 1; y += 0.24 * (u < 0.85 ? 0.5 - u / 0.85 : -0.5 + (u - 0.85) / 0.15); }
      if (tr.st) for (const b of this.beats) { const dt = t - b.tR; if (b.type === 'V' || b.esc || dt < 0.02 || dt > 0.6) continue; const e = Math.min(1, Math.max(0, (dt - 0.03) / 0.05)), x = Math.min(1, Math.max(0, (dt - (b.qt - 0.12)) / 0.2)); y += tr.st * (e * e * (3 - 2 * e)) * (1 - x * x * (3 - 2 * x)) + tr.st * 0.45 * g(dt, b.qt - 0.12, 0.06, 1); }
      if (cls === 'afib') { const f = [4.3, 6.1, 8.2]; for (let i = 0; i < 3; i++) { this.fib[i] += 2 * Math.PI * (f[i] + 0.5 * Math.sin(t * (0.4 + 0.2 * i))) / FS; } y += 0.07 * (0.5 * Math.sin(this.fib[0]) + 0.35 * Math.sin(this.fib[1]) + 0.25 * Math.sin(this.fib[2])) * (0.7 + 0.3 * Math.sin(t * 1.3)); }
      y += 0.025 * Math.sin(2 * Math.PI * 0.22 * t) + (this.rng() - 0.5) * 0.012;
    }
    if (tr.cpr) y += 0.8 * this.cprShape(t);
    return y;
  }
  cprShape(t) { const c = (t * 110 / 60) % 1; return Math.sin(2 * Math.PI * c) + 0.3 * Math.sin(4 * Math.PI * c); }
  plAt(t, tr) {
    let y = 0;
    for (const p of this.pulses) {
      const tau = t - p.tf; if (tau < 0 || tau > 1.3) continue;
      const s = tau < 0.13 ? 0.06 : 0.11;
      y += p.amp * (Math.exp(-((tau - 0.13) * (tau - 0.13)) / (2 * s * s)) + g(tau, 0.36, 0.06, 0.28));
    }
    y += 0.04 * Math.min(tr.perf, 1) * this.breathSin(t);
    if (tr.cpr) y += 0.3 * this.cprShape(t);
    return y + (this.rng() - 0.5) * 0.004;
  }
  breath(t, tr) {
    // acumulador de fase respiratória: acompanha rampas de FR sem períodos absurdos
    const inB = !!this.br;
    if (!inB && tr.rr > 0.5) this.bph = 1;
    if (this.bph < 1 || inB) this.bph += (tr.rr > 0.5 ? tr.rr : (inB ? 8 : 0)) / 60 / FS * this.bvar;
    if (this.bph >= 1) {
      if (tr.rr > 0.5) {
        if (this.br) this.prevE = this.br.E;
        if (this.n > this.n0 + 1) this.ev.etco2.push({ t, v: this.peak });
        this.peak = 0; this.bph -= 1; if (this.bph >= 1) this.bph = 0;
        this.bvar = 1 + (tr.var ? 0.035 : 0) * clamp(gauss(this.rng), -2, 2);
        this.br = { t0: t, E: Math.max(0, tr.etco2), amp: clamp(1.2 - tr.rr / 40, 0.5, 1) };
        this.ev.breath.push({ t, Tb: 60 / Math.max(tr.rr, 1) });
      } else { this.br = null; this.bph = 0; }
    }
    let rs = 0, co = 0; const b = this.br;
    if (b) {
      const ph = this.bph;
      rs = b.amp * (ph < 0.33 ? 0.5 - 0.5 * Math.cos(Math.PI * ph / 0.33) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - 0.33) / 0.67));
      if (ph < 0.04) co = this.prevE * (1 - ph / 0.04);
      else if (ph >= 0.33) {
        const u = (ph - 0.33) / 0.67;
        if (u < 0.12) co = 0;
        else if (u < 0.27) co = b.E * 0.9 * smooth((u - 0.12) / 0.15);
        else co = b.E * (0.9 + 0.1 * (u - 0.27) / 0.73);
      }
    }
    if (tr.cpr) { co += 0.6 * this.cprShape(t) * (co > 0 ? 1 : 0.3); rs += 0.05 * this.cprShape(t); }
    if (co > this.peak) this.peak = co;
    return [rs, Math.max(co, 0)];
  }
  step() {
    const t = this.n / FS, tr = this.truthAt(t);
    this.sched(t, tr);
    const [rs, co] = this.breath(t, tr), i = this.n % RING;
    this.ecg[i] = this.ecgAt(t, tr); this.pl[i] = this.plAt(t, tr); this.rs[i] = rs; this.co[i] = co;
    this.n++;
    if (this.n % FS === 0) this.trim(t);
  }
  trim(t) { for (const k in this.ev) { const a = this.ev[k]; while (a.length && a[0].t < t - 130) a.shift(); } }
}

/* ---------- medidas: o monitor mede das ondas, como um monitor real ---------- */
class Meas {
  constructor() { this.last = -99; this.hist = []; this.v = { hr: null, pr: null, spo2: null, rr: null, etco2: null, temp: null, noQrsFor: 0, noBreathFor: 0, perf: 0 }; this.start = null; }
  rate(arr, T, maxAge, stale, maxN) {
    const q = arr.filter(e => e.t <= T && e.t > T - maxAge);
    if (q.length < 2 || T - q[q.length - 1].t > stale) return null;
    const u = q.slice(-maxN);
    return Math.round(60 * (u.length - 1) / (u[u.length - 1].t - u[0].t));
  }
  update(T, gen, tr) {
    if (this.start === null) this.start = T;
    if (T - this.last < 1) return this.v;
    this.last = T;
    const v = this.v, ev = gen.ev;
    v.hr = this.rate(ev.qrs, T, 16, 4.5, 9);
    v.pr = this.rate(ev.pulse, T, 16, 6, 9);
    const lq = ev.qrs.filter(e => e.t <= T); v.noQrsFor = lq.length ? T - lq[lq.length - 1].t : T - this.start;
    const br = ev.breath.filter(e => e.t <= T);
    v.noBreathFor = br.length ? T - br[br.length - 1].t : T - this.start;
    if (br.length >= 2) { const u = br.slice(-4), iv = []; for (let i = 1; i < u.length; i++) iv.push(u[i].t - u[i - 1].t); iv.sort((a, b) => a - b); const per = iv.length % 2 ? iv[(iv.length - 1) / 2] : (iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2; v.rr = (T - u[u.length - 1].t < Math.max(8, 2 * per)) ? Math.round(60 / per) : null; } else v.rr = null;
    const pk = ev.etco2.filter(e => e.t <= T); v.etco2 = (pk.length && v.rr !== null) ? Math.round(pk[pk.length - 1].v) : null;
    this.hist.push([T, tr.spo2]); while (this.hist.length > 20) this.hist.shift();
    const win = this.hist.filter(h => h[0] <= T - 4 && h[0] >= T - 12), src = win.length ? win : this.hist.slice(-1);
    const sp = src.reduce((a, h) => a + h[1], 0) / src.length;
    v.spo2 = (v.pr !== null && sp > 0) ? Math.round(clamp(sp, 0, 100)) : null;
    v.temp = tr.temp; v.perf = tr.perf;
    return v;
  }
}

/* ---------- alarmes (inspirados na IEC 60601-1-8, simplificados) ---------- */
class Alarms {
  constructor() { this.t = {}; this.list = []; }
  update(dt, m, tr, S, nibpRes) {
    const A = S.alarm, L = Object.assign({}, LIMITS, A.limits), act = [];
    if (!A.on) { this.list = []; return this.list; }
    const chk = (key, cond, delay, prio, text, param) => { if (cond) { this.t[key] = (this.t[key] || 0) + dt; if (this.t[key] >= delay) act.push({ key, prio, text, param }); } else this.t[key] = 0; };
    const rh = tr.rhythm, pl = PULSELESS.has(rh);
    chk('vf', rh === 'vf', 1, 3, 'FIBRILAÇÃO VENTRICULAR', 'hr');
    chk('vt', rh === 'vt' || rh === 'vtp', 1, 3, 'TAQUICARDIA VENTRICULAR', 'hr');
    chk('tdp', rh === 'tdp', 1, 3, 'TORSADES DE POINTES', 'hr');
    chk('asys', rh !== 'vf' && rh !== 'tdp' && rh !== 'leadoff' && m.noQrsFor >= 4, 0, 3, 'ASSISTOLIA', 'hr');
    const vt = rh === 'vt' || rh === 'vtp';
    chk('hrx', m.hr !== null && !vt && (m.hr > 150 || m.hr < 40), 3, 3, 'FC EXTREMA', 'hr');
    chk('hrh', m.hr !== null && !vt && m.hr > L.hrHi && m.hr <= 150, 5, 2, 'FC ALTA', 'hr');
    chk('hrl', m.hr !== null && m.hr < L.hrLo && m.hr >= 40, 5, 2, 'FC BAIXA', 'hr');
    chk('spx', m.spo2 !== null && m.spo2 < 85, 5, 3, 'SpO₂ MUITO BAIXA', 'spo2');
    chk('spl', m.spo2 !== null && m.spo2 < L.spo2Lo && m.spo2 >= 85, 7, 2, 'SpO₂ BAIXA', 'spo2');
    chk('sp0', m.spo2 === null && pl, 3, 1, 'SpO₂ SEM SINAL', 'spo2');
    if (nibpRes && nibpRes.ok && !pl) {
      chk('sl', nibpRes.sys < L.sysLo, 0, 2, 'PNI: PAS BAIXA', 'nibp');
      chk('sh', nibpRes.sys > L.sysHi, 0, 2, 'PNI: PAS ALTA', 'nibp');
      chk('ml', nibpRes.map < L.mapLo, 0, 2, 'PNI: PAM BAIXA', 'nibp');
    }
    chk('rrh', !pl && m.rr !== null && m.rr > L.rrHi, 8, 2, 'FR ALTA', 'rr');
    chk('rrl', !pl && m.rr !== null && m.rr < L.rrLo, 8, 2, 'FR BAIXA', 'rr');
    chk('apn', !pl && m.noBreathFor >= (A.apneaSec || 20), 0, 3, 'APNEIA', 'rr');
    chk('etl', !pl && m.etco2 !== null && m.etco2 < L.etLo, 8, 2, 'EtCO₂ BAIXO', 'etco2');
    chk('eth', !pl && m.etco2 !== null && m.etco2 > L.etHi, 8, 2, 'EtCO₂ ALTO', 'etco2');
    chk('tl', m.temp !== null && m.temp < L.tLo, 10, 1, 'TEMP BAIXA', 'temp');
    chk('th', m.temp !== null && m.temp > L.tHi, 10, 1, 'TEMP ALTA', 'temp');
    chk('lead', rh === 'leadoff', 2, 1, 'ELETRODO SOLTO', 'hr');
    act.sort((a, b) => b.prio - a.prio);
    this.list = act; return act;
  }
}

/* ---------- NIBP: resultado medido pelo controlador ---------- */
const NIBP_SECONDS = 32;
function nibpResult(S, P, seq) {
  const tr = truth(S, P);
  if (!tr.pulse) return { ok: false, sys: null, dia: null, map: null, wall: Date.now() };
  const r = mulberry32(seq * 7919 + 13), e = S.rhythm === 'afib' ? 8 : 2.5;
  const sys = Math.round(tr.sys + e * gauss(r)), dia = Math.round(Math.min(tr.dia + e * 0.7 * gauss(r), sys - 8));
  return { ok: true, sys, dia, map: Math.round(dia + (sys - dia) / 3), wall: Date.now() };
}
function cuffPressure(elapsed, target) { if (elapsed < 0 || elapsed > NIBP_SECONDS) return 0; return elapsed < 10 ? target * elapsed / 10 : target * (1 - (elapsed - 10) / (NIBP_SECONDS - 10)); }

/* ---------- regras de coerência e acoplamento (didáticos) ---------- */
function rhythmRules(v, rhythm, cpr) {
  const o = Object.assign({}, v);
  if (PULSELESS.has(rhythm)) {
    o.sys = 0; o.dia = 0; o.rr = cpr ? 10 : 0; o.etco2 = cpr ? 15 : Math.min(o.etco2, 6);
    if (rhythm === 'vf' || rhythm === 'asys' || rhythm === 'tdp') o.hr = 0;
  }
  return o;
}
/* alterar um parâmetro altera os acoplados (apenas nas edições manuais) */
function couple(prev, next, key) {
  const n = Object.assign({}, next), notes = [], d = next[key] - prev[key];
  const add = (k, delta, lo, hi) => { const nv = clamp(Math.round((n[k] + delta) * 10) / 10, lo, hi); if (nv !== n[k]) { notes.push(k.toUpperCase() + ' ' + (nv > n[k] ? '+' : '') + Math.round((nv - n[k]) * 10) / 10); n[k] = nv; } };
  if (!d) return { next: n, notes };
  if (key === 'spo2' && next.spo2 < 94) { const dd = Math.min(d, 0); add('rr', -0.6 * dd, 0, 60); add('hr', next.spo2 < 70 ? 0 : -0.8 * dd, 0, 300); if (next.spo2 < 70 && n.hr > 50) { notes.push('FC → bradicardia hipóxica'); n.hr = 50; } }
  if (key === 'sys' && next.sys > 0) { add('hr', -0.5 * d, 0, 300); add('rr', -0.1 * d, 0, 60); add('etco2', 0.2 * d, 0, 100); add('dia', 0.6 * d, 0, 200); }
  if (key === 'temp') { add('hr', 9 * d, 0, 300); add('rr', 1.5 * d, 0, 60); }
  if (key === 'rr') add('etco2', -0.5 * d, 0, 100);
  return { next: n, notes };
}

/* ---------- cenários (adulto, valores didáticos; PAM = PAD + (PAS-PAD)/3) ---------- */
const V = (hr, sys, dia, rr, spo2, etco2, temp) => ({ hr, sys, dia, rr, spo2, etco2, temp });
const SCENARIOS = [
  { id: 'basal', name: 'Basal estável', sub: 'Sinusal 76 · estável', rhythm: 'sinus', ph: [{ at: 0, dur: 8, v: V(76, 120, 74, 15, 98, 38, 36.7) }], fonte: 'Faixas de adulto em repouso (convenção didática).' },
  { id: 'taqui', name: 'Taquicardia sinusal', sub: 'Febre/dor · FC 118', rhythm: 'sinus', ph: [{ at: 0, dur: 20, v: V(118, 136, 80, 22, 97, 33, 38.6) }], fonte: 'FC sobe ~8–10 bpm por °C acima de 37 (regra prática) + dor. Convenção didática.' },
  { id: 'brady', name: 'Bradicardia sintomática', sub: 'FC 38 · hipotensão', rhythm: 'sinus', ph: [{ at: 0, dur: 20, v: V(38, 84, 48, 14, 94, 33, 36.3) }], fonte: 'Bradicardia sintomática com baixo débito (convenção didática).' },
  { id: 'fa', name: 'FA com RVR', sub: 'Irregular · FC 138', rhythm: 'afib', ph: [{ at: 0, dur: 20, v: V(138, 104, 64, 22, 95, 32, 36.8) }], fonte: 'FA: R-R irregularmente irregular, sem onda P; resposta ventricular 100–175 quando não controlada.' },
  { id: 'hemo', name: 'Choque hipovolêmico', sub: 'Hemorragia · 4 fases', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(96, 116, 74, 20, 97, 36, 36.5), note: 'Perda inicial: compensado' },
    { at: 180, dur: 120, v: V(114, 108, 76, 24, 96, 31, 36.3), note: 'Pulso estreito, FR sobe' },
    { at: 360, dur: 120, v: V(130, 88, 58, 30, 95, 25, 36.0), note: 'Hipotensão evidente' },
    { at: 600, dur: 150, v: V(148, 66, 44, 36, 92, 18, 35.6), note: 'Choque descompensado' },
    { at: 840, dur: 90, rhythm: 'pea', v: V(45, 0, 0, 0, 80, 8, 35.4), note: 'Sem tratamento: AESP' }], fonte: 'Quadro clássico de classes de hemorragia do ATLS (confirmar edição vigente): FC↑, pulso estreito, PAS só cai nas classes III–IV, FR↑, EtCO₂↓ por baixo débito.' },
  { id: 'sepse', name: 'Choque séptico', sub: 'Febre · PAM 61 → 50', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(112, 112, 62, 24, 95, 31, 38.9), note: 'Fase quente' },
    { at: 300, dur: 150, v: V(124, 88, 42, 28, 93, 28, 39.2), note: 'Pulso largo, PAM < 65' },
    { at: 720, dur: 180, v: V(136, 74, 38, 32, 91, 24, 39.4), note: 'Refratário' }], fonte: 'Surviving Sepsis Campaign (versão vigente): meta de PAM ≥ 65 mmHg; fase quente com PAD baixa. Convenção didática nos demais valores.' },
  { id: 'cardio', name: 'Choque cardiogênico', sub: 'PAS 78 · ESV · SpO₂ 89', rhythm: 'sinus', ectopy: 8, ph: [{ at: 0, dur: 20, v: V(108, 78, 56, 30, 89, 24, 36.2) }], fonte: 'PAS < 90 mmHg com hipoperfusão e congestão (definição usual); EtCO₂ baixo por baixo débito.' },
  { id: 'hipox', name: 'Hipoxemia progressiva', sub: 'SpO₂ 93 → 66 · 4 fases', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(98, 138, 84, 24, 93, 31, 37.0), note: 'Taquipneia, hiperventilação' },
    { at: 240, dur: 120, v: V(114, 148, 90, 32, 87, 28, 37.0), note: 'Hipoxemia moderada' },
    { at: 480, dur: 120, v: V(128, 152, 92, 36, 78, 34, 37.0), note: 'Fadiga: EtCO₂ sobe' },
    { at: 720, dur: 120, v: V(54, 84, 46, 10, 66, 58, 37.0), note: 'Bradicardia hipóxica, hipoventilação' },
    { at: 900, dur: 60, rhythm: 'pea', v: V(36, 0, 0, 0, 50, 10, 37.0), note: 'Parada hipóxica: AESP' }], fonte: 'Hipoxemia grave leva a bradicardia e parada (AESP/assistolia). Convenção didática nos valores.' },
  { id: 'vt', name: 'TV com pulso', sub: 'FC 176 · instável', rhythm: 'vt', ph: [{ at: 0, dur: 4, v: V(176, 82, 50, 24, 90, 26, 36.7) }], fonte: 'TV monomórfica: regular, QRS largo, 150–250 bpm.' },
  { id: 'vtp', name: 'TV sem pulso', sub: 'Pleth reta · PNI —', rhythm: 'vtp', ph: [{ at: 0, dur: 4, v: V(180, 0, 0, 0, 90, 26, 36.7) }], fonte: 'Ritmo chocável sem pulso. EtCO₂ decai sem RCP.' },
  { id: 'vf', name: 'Fibrilação ventricular', sub: 'Parada · chocável', rhythm: 'vf', ph: [{ at: 0, dur: 4, v: V(0, 0, 0, 0, 90, 38, 36.7) }], fonte: 'FV: caótica, 4–7 Hz dominante, sem QRS. Sem RCP, EtCO₂ cai; com RCP de qualidade 10–20 mmHg.' },
  { id: 'asys', name: 'Assistolia', sub: 'Linha isoelétrica', rhythm: 'asys', ph: [{ at: 0, dur: 4, v: V(0, 0, 0, 0, 90, 38, 36.7) }], fonte: 'Assistolia: ausência de atividade elétrica; confirmar derivações.' },
  { id: 'lead', name: 'Eletrodo solto', sub: 'Ruído no ECG · pulso presente', rhythm: 'leadoff', ph: [{ at: 0, dur: 4, v: V(80, 120, 74, 15, 98, 38, 36.7) }], fonte: 'Ensina a diferença entre assistolia e artefato: pleth e demais sinais seguem normais.' },
  { id: 'pea', name: 'AESP', sub: 'Ritmo organizado sem pulso', rhythm: 'pea', ph: [{ at: 0, dur: 4, v: V(52, 0, 0, 0, 90, 38, 36.7) }], fonte: 'Atividade elétrica sem pulso: ECG organizado, pleth reta, PNI sem leitura.' },
  { id: 'tsv', name: 'Taquicardia supraventricular', sub: 'QRS estreito · FC 188', rhythm: 'svt', ph: [{ at: 0, dur: 6, v: V(188, 102, 64, 22, 97, 34, 36.8) }, { at: 900, dur: 10, rhythm: 'sinus', v: V(90, 120, 74, 16, 98, 38, 36.8), note: 'Reversão ao sinusal (use «Avançar fase» após a intervenção)' }], fonte: 'TSV: ritmo regular, QRS estreito, sem onda P visível, 150–250 bpm. Manobra vagal/adenosina costumam reverter; a reversão fica a seu critério (avançar fase).' },
  { id: 'fl', name: 'Flutter atrial 2:1', sub: 'Dente de serra · FC 150', rhythm: 'flutter', ph: [{ at: 0, dur: 8, v: V(150, 118, 72, 20, 96, 34, 36.8) }], fonte: 'Flutter: atividade atrial ~300/min em «dente de serra»; condução 2:1 dá FC ventricular ~150, regular.' },
  { id: 'bav', name: 'BAV total (3º grau)', sub: 'FC 36 · P dissociada', rhythm: 'avb3', ph: [{ at: 0, dur: 10, v: V(36, 86, 52, 16, 94, 34, 36.5) }], fonte: 'BAV total: ondas P (~78/min) sem relação com os QRS; escape ventricular lento (30–40 bpm), complexos largos.' },
  { id: 'esv', name: 'Extrassístoles ventriculares', sub: 'ESV frequentes · FC 78', rhythm: 'sinus', ectopy: 18, ph: [{ at: 0, dur: 6, v: V(78, 124, 76, 16, 97, 37, 36.7) }], fonte: 'ESV: batimento precoce, QRS largo, pausa compensatória e pulso reduzido no batimento ectópico.' },
  { id: 'tdp', name: 'Torsades de pointes', sub: 'TV polimórfica · sem pulso', rhythm: 'tdp', ph: [{ at: 0, dur: 4, v: V(0, 0, 0, 0, 90, 20, 36.7) }], fonte: 'TV polimórfica com «torção» do eixo (fusiforme), associada a QT longo. Tratada como parada: desfibrilação, Mg²⁺ e correção da causa.' },
  { id: 'iam', name: 'IAM com supra de ST', sub: 'Supra ST · evolui p/ TV/FV', rhythm: 'sinus', ectopy: 3, ph: [
    { at: 0, dur: 10, st: 0.35, v: V(92, 148, 90, 20, 95, 36, 36.8), note: 'Supra de ST, dor torácica' },
    { at: 300, dur: 60, st: 0.45, ectopy: 14, v: V(104, 130, 80, 22, 94, 34, 36.8), note: 'ESV frequentes: instabilidade elétrica' },
    { at: 600, dur: 10, rhythm: 'vt', v: V(172, 84, 50, 24, 90, 26, 36.8), note: 'TV' },
    { at: 780, dur: 4, rhythm: 'vf', v: V(0, 0, 0, 0, 90, 20, 36.8), note: 'Degenera para FV' }], fonte: 'IAMCSST: elevação do segmento ST; sem reperfusão, ESV frequentes e TV/FV são as complicações precoces mais temidas. Valores didáticos.' },
  { id: 'hiper', name: 'Crise hipertensiva', sub: 'PA 218/124 · cefaleia', rhythm: 'sinus', ph: [{ at: 0, dur: 15, v: V(96, 218, 124, 18, 96, 37, 36.8) }], fonte: 'PA muito elevada (≥180/120) com ou sem lesão de órgão-alvo. Reduzir de forma controlada, não abrupta.' },
  { id: 'anafi', name: 'Choque anafilático', sub: 'Hipotensão · FR e FC altas', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(124, 102, 60, 28, 93, 30, 36.8), note: 'Urticária, sibilos' },
    { at: 240, dur: 60, v: V(142, 78, 40, 34, 88, 24, 36.8), note: 'Choque: sem adrenalina' },
    { at: 480, dur: 90, v: V(150, 62, 34, 38, 82, 18, 36.8), note: 'Refratário' }], fonte: 'Anafilaxia: vasodilatação e broncoespasmo; adrenalina IM é a primeira linha. Simule a resposta ajustando os parâmetros (ritmo ×).' },
  { id: 'dpoc', name: 'Asma grave / DPOC', sub: 'SpO₂ 86 · EtCO₂ 52', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(120, 146, 88, 32, 86, 52, 37.1), note: 'Taquipneia, retenção de CO₂' },
    { at: 300, dur: 90, v: V(134, 132, 80, 12, 78, 72, 37.1), note: 'Fadiga: FR cai, EtCO₂ sobe' }], fonte: 'Obstrução ao fluxo: EtCO₂ sobe com a fadiga (hipoventilação). FR em queda com piora clínica é sinal de gravidade.' },
  { id: 'tep', name: 'Embolia pulmonar', sub: 'SpO₂ 88 · EtCO₂ baixo', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(118, 112, 70, 28, 88, 22, 37.2), note: 'Taquicardia, hipoxemia, EtCO₂ baixo (espaço morto)' },
    { at: 360, dur: 90, v: V(132, 84, 52, 32, 82, 16, 37.2), note: 'Instabilidade hemodinâmica' },
    { at: 660, dur: 60, rhythm: 'pea', v: V(48, 0, 0, 0, 70, 8, 37.2), note: 'TEP maciço: AESP' }], fonte: 'TEP: gradiente EtCO₂–PaCO₂ aumenta por espaço morto; instabilidade sugere TEP de alto risco.' },
  { id: 'opioide', name: 'Intoxicação por opioide', sub: 'FR 7 · SpO₂ 91 · EtCO₂ 56', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(58, 104, 62, 7, 91, 56, 36.4), note: 'Sonolento, miose' },
    { at: 240, dur: 90, v: V(48, 88, 50, 4, 80, 70, 36.2), note: 'Hipoventilação' },
    { at: 480, dur: 90, v: V(38, 70, 40, 2, 62, 80, 36.0), note: 'Depressão respiratória grave' },
    { at: 720, dur: 60, rhythm: 'pea', v: V(30, 0, 0, 0, 40, 8, 35.8), note: 'Parada respiratória → AESP' }], fonte: 'Depressão respiratória: FR baixa, EtCO₂ alto. Ventilação e naloxona revertem; a capnografia detecta antes da SpO₂.' },
  { id: 'cad', name: 'Cetoacidose diabética', sub: 'Kussmaul · FR 34', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(118, 98, 58, 34, 98, 18, 36.5), note: 'Respiração de Kussmaul' },
    { at: 600, dur: 180, v: V(100, 112, 70, 24, 98, 28, 36.6), note: 'Resposta ao tratamento' }], fonte: 'Hiperventilação compensatória da acidose metabólica: FR alta e EtCO₂ baixo com SpO₂ normal.' },
  { id: 'hm', name: 'Hipertermia maligna', sub: 'EtCO₂ sobe sem causa', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(110, 128, 76, 18, 98, 52, 37.9), note: 'Primeiro sinal: EtCO₂ sobe' },
    { at: 180, dur: 120, v: V(134, 142, 84, 26, 97, 68, 39.4), note: 'Rigidez, taquicardia' },
    { at: 420, dur: 150, v: V(156, 90, 50, 30, 90, 80, 41.5), note: 'Hipertermia grave' },
    { at: 780, dur: 4, rhythm: 'vf', v: V(0, 0, 0, 0, 90, 30, 41.8), note: 'FV' }], fonte: 'Hipermetabolismo: aumento inexplicado de EtCO₂ e temperatura sobe; tratamento com dantrolene.' },
  { id: 'hipot', name: 'Hipotermia', sub: 'Temp 32,5 · bradicardia', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(44, 100, 62, 9, 94, 44, 32.5), note: 'Hipotermia moderada' },
    { at: 420, dur: 180, v: V(32, 78, 44, 6, 90, 50, 29.5), note: 'Hipotermia grave' },
    { at: 780, dur: 4, rhythm: 'vf', v: V(0, 0, 0, 0, 90, 20, 28.5), note: 'FV' }], fonte: 'Bradicardia, hipoventilação e instabilidade elétrica crescentes com a queda da temperatura central.' },
  { id: 'rosc', name: 'Pós-parada (RCE)', sub: 'Cuidados pós-ressuscitação', rhythm: 'sinus', ectopy: 6, ph: [
    { at: 0, dur: 12, v: V(104, 96, 58, 14, 92, 44, 36.2), note: 'Recém retornou' },
    { at: 300, dur: 120, v: V(90, 112, 68, 14, 96, 38, 34.0), note: 'Controle de temperatura-alvo' }], fonte: 'Pós-RCE: evitar hipoxemia, hiperóxia e hipotensão; EtCO₂ e SpO₂ em faixa-alvo. Valores didáticos.' },
  { id: 'edema', name: 'Edema agudo de pulmão', sub: 'PA 186/104 · SpO₂ 82', rhythm: 'sinus', ectopy: 3, ph: [
    { at: 0, dur: 10, v: V(118, 186, 104, 34, 82, 30, 37.0), note: 'Congestão, hipertensão' },
    { at: 360, dur: 120, v: V(130, 96, 60, 36, 72, 26, 37.0), note: 'Sem tratamento: evolui p/ choque' }], fonte: 'Hipertensão com congestão pulmonar; sem tratamento pode evoluir para choque cardiogênico.' },
  { id: 'tamp', name: 'Tamponamento cardíaco', sub: 'PA convergente · FC 124', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(124, 84, 64, 26, 92, 24, 36.6), note: 'Pressão de pulso estreita' },
    { at: 300, dur: 90, v: V(140, 66, 54, 30, 88, 18, 36.5), note: 'Choque obstrutivo' },
    { at: 540, dur: 60, rhythm: 'pea', v: V(50, 0, 0, 0, 70, 8, 36.4), note: 'AESP' }], fonte: 'Choque obstrutivo: PAS cai e PAD se mantém (pulso estreito), taquicardia, EtCO₂ baixo.' },
  { id: 'pneumo', name: 'Pneumotórax hipertensivo', sub: 'SpO₂ 80 · FR 36', rhythm: 'sinus', ph: [
    { at: 0, dur: 10, v: V(130, 90, 56, 36, 80, 22, 36.8), note: 'Dispneia e hipotensão' },
    { at: 300, dur: 60, v: V(150, 64, 40, 40, 66, 14, 36.8), note: 'Colapso' },
    { at: 480, dur: 60, rhythm: 'pea', v: V(50, 0, 0, 0, 50, 8, 36.8), note: 'AESP' }], fonte: 'Choque obstrutivo: descompressão imediata é o tratamento. Hipoxemia e hipotensão progressivas.' }
];


/* ---------- sessão ---------- */
const SIM0 = 30; // a simulação começa em T=30 s: já nasce com 26 s de histórico (a tela abre cheia)
const DEFAULT_AUDIO = { vol: 70, beep: true, beepVol: 40, beepSrc: 'ecg', mute: false, cuff: true };
const DEFAULT_LAYOUT = { waves: ['ecg', 'pleth', 'resp', 'capno'], nums: ['hr', 'spo2', 'nibp', 'etco2', 'rr', 'temp'], hidden: [] };
function cleanLayout(l) {
  const D = DEFAULT_LAYOUT, o = { waves: [], nums: [], hidden: [] }; l = l && typeof l === 'object' ? l : {};
  for (const k of ['waves', 'nums']) { const a = Array.isArray(l[k]) ? l[k] : []; for (const id of a) if (D[k].includes(id) && !o[k].includes(id)) o[k].push(id); for (const id of D[k]) if (!o[k].includes(id)) o[k].push(id); }
  const all = D.waves.concat(D.nums); if (Array.isArray(l.hidden)) for (const id of l.hidden) if (all.includes(id) && !o.hidden.includes(id)) o.hidden.push(id);
  return o;
}
const DEFAULT_DISPLAY = { speed: 25, speed2: 6.25, gain: 1, capScale: 50, grid: true, pleth: true, resp: true, capno: true, ecgcolor: 'green', bed: 'LEITO 03', name: 'PACIENTE FICTÍCIO' };
function defaultSession() {
  const v = SCENARIOS[0].ph[0].v;
  return {
    schema: 2, rev: 1, epoch: 1, epochT: 0, seed: 20261021, ctrl: '', shockT: 0, simT0: null,
    clock: { running: true, wall0: Date.now(), rt0: SIM0, pt0: 0, rate: 1 },
    rhythm: 'sinus', vf: 'coarse', ectopy: 0, st: 0, cpr: false, var: true,
    p: { from: Object.assign({}, v), to: Object.assign({}, v), t0: 0, dur: 0 },
    scen: { id: 'basal', phase: 0, startP: 0, auto: true },
    nibp: { every: 300, seq: 0, state: 'idle', startT: 0, nextT: SIM0 + 20, res: { ok: true, sys: 121, dia: 75, map: 90, wall: Date.now() - 150000 } },
    alarm: { on: true, limits: Object.assign({}, LIMITS), apneaSec: 20, silencedUntil: 0, sound: true },
    audio: Object.assign({}, DEFAULT_AUDIO),
    layout: cleanLayout(null),
    display: Object.assign({}, DEFAULT_DISPLAY)
  };
}
const num = (x, a, b, d) => { x = Number(x); return Number.isFinite(x) ? clamp(x, a, b) : d; };
function sanitize(raw) {
  const D = defaultSession(); if (!raw || typeof raw !== 'object') return D;
  if (raw.schema !== 2 && raw.hr !== undefined) return migrateV1(raw);
  if (raw.schema !== 2) return D;
  const S = Object.assign({}, D, raw);
  S.shockT = num(raw.shockT, 0, 1e9, 0); S.simT0 = raw.simT0 == null ? null : num(raw.simT0, 0, 1e9, 0); S.rev = num(raw.rev, 1, 1e9, 1); S.epoch = num(raw.epoch, 1, 1e9, 1); S.epochT = num(raw.epochT, 0, 1e9, 0); S.seed = num(raw.seed, 1, 4e9, D.seed);
  S.rhythm = RHYTHMS.includes(raw.rhythm) ? raw.rhythm : 'sinus'; S.vf = raw.vf === 'fine' ? 'fine' : 'coarse';
  S.ectopy = num(raw.ectopy, 0, 30, 0); S.st = num(raw.st, -0.5, 0.8, 0); S.cpr = !!raw.cpr; S.var = raw.var !== false;
  S.clock = Object.assign({}, D.clock, raw.clock); S.clock.rate = clamp(Number(S.clock.rate) || 1, 1, 20); S.clock.running = !!S.clock.running;
  for (const k of ['wall0', 'rt0', 'pt0']) S.clock[k] = num(S.clock[k], 0, 1e15, D.clock[k]);
  const rng = { hr: [0, 300], sys: [0, 300], dia: [0, 200], rr: [0, 60], spo2: [0, 100], etco2: [0, 100], temp: [26, 43] };
  S.p = { from: {}, to: {}, t0: num(raw.p && raw.p.t0, 0, 1e9, 0), dur: num(raw.p && raw.p.dur, 0, 3600, 0) };
  for (const k of KEYS) { S.p.from[k] = num(raw.p && raw.p.from && raw.p.from[k], rng[k][0], rng[k][1], D.p.to[k]); S.p.to[k] = num(raw.p && raw.p.to && raw.p.to[k], rng[k][0], rng[k][1], D.p.to[k]); }
  S.scen = Object.assign({}, D.scen, raw.scen); S.nibp = Object.assign({}, D.nibp, raw.nibp);
  S.alarm = Object.assign({}, D.alarm, raw.alarm); S.alarm.limits = Object.assign({}, LIMITS, raw.alarm && raw.alarm.limits);
  S.display = Object.assign({}, DEFAULT_DISPLAY, raw.display);
  S.layout = cleanLayout(raw.layout);
  S.audio = Object.assign({}, DEFAULT_AUDIO, raw.audio); S.audio.vol = num(S.audio.vol, 0, 100, 70); S.audio.beepVol = num(S.audio.beepVol, 0, 100, 40); S.audio.beep = S.audio.beep !== false; S.audio.mute = S.audio.mute === true; S.audio.cuff = S.audio.cuff !== false; S.audio.beepSrc = S.audio.beepSrc === 'spo2' ? 'spo2' : 'ecg';
  return S;
}
function migrateV1(o) {
  const S = defaultSession(), map = { sinus: 'sinus', tachy: 'sinus', brady: 'sinus', afib: 'afib', vtach: 'vt', vfib: 'vf', asystole: 'asys' };
  S.rhythm = map[o.rhythm] || 'sinus';
  const v = { hr: num(o.hr, 0, 300, 76), sys: num(o.sys, 0, 300, 120), dia: num(o.dia, 0, 200, 74), rr: num(o.rr, 0, 60, 15), spo2: num(o.spo2, 0, 100, 98), etco2: num(o.etco2, 0, 100, 38), temp: num(o.temp, 30, 43, 36.7) };
  const r = rhythmRules(v, S.rhythm, false);
  S.p = { from: Object.assign({}, r), to: Object.assign({}, r), t0: 0, dur: 0 };
  S.clock.running = o.run !== false; S.alarm.on = o.alarms !== false; S.var = o.variability !== false;
  S.display.speed = [6.25, 12.5, 25, 50].includes(Number(o.speed)) ? Number(o.speed) : 25;
  S.display.gain = [0.5, 1, 2, 4].includes(Number(o.gain)) ? Number(o.gain) : 1;
  S.display.ecgcolor = ['green', 'amber', 'white'].includes(o.ecgcolor) ? o.ecgcolor : 'green';
  S.display.grid = o.gridmode !== 'off'; S.display.pleth = o.showPleth !== 'off'; S.display.resp = o.showResp !== 'off'; S.display.capno = o.showCapno !== 'off';
  S.scen = { id: 'custom', phase: 0, startP: 0, auto: false };
  return S;
}

/* ---------- núcleo: gerador + medidas + alarmes ---------- */
class Core {
  constructor() { this.S = null; this.gen = null; this.meas = new Meas(); this.alm = new Alarms(); this.lastU = 0; this.T = 0; }
  truthAt(t) { const v = truth(this.S, TtoP(this.S.clock, t)); v.var = this.S.var; return v; }
  setState(S, T) {
    const re = !this.S || this.S.epoch !== S.epoch || this.S.seed !== S.seed, prevShock = this.S ? this.S.shockT : 0;
    this.S = S;
    if (re) this.reinit(T);
    if (S.shockT && S.shockT !== prevShock && this.gen) this.gen.shockAt = S.shockT;
  }
  reinit(T) {
    const start = Math.max(this.S.epochT || 0, T - 26);
    this.gen = new Gen(t => this.truthAt(t), this.S.seed, start);
    this.meas = new Meas(); this.alm = new Alarms(); this.lastU = start; this.T = start;
    if (this.S.shockT && T - this.S.shockT < 30) this.gen.shockAt = this.S.shockT;
  }
  advance(T) {
    if (!this.gen) return;
    if (T - this.gen.n / FS > 40) this.reinit(T);
    this.gen.advanceTo(T); this.T = T;
    if (T - this.lastU >= 0.25) {
      const dt = T - this.lastU; this.lastU = T;
      const tr = this.truthAt(T), m = this.meas.update(T, this.gen, tr);
      this.alm.update(dt, m, tr, this.S, this.S.nibp.res);
    }
  }
}

const ENGINE = { FS, RING, clamp, smooth, mulberry32, gauss, PULSELESS, KEYS, RHYTHMS, LIMITS, clockT, TtoP, clockP, truth, Gen, Meas, Alarms, Core, nibpResult, cuffPressure, NIBP_SECONDS, rhythmRules, couple, SCENARIOS, defaultSession, sanitize, migrateV1, DEFAULT_DISPLAY, DEFAULT_AUDIO, DEFAULT_LAYOUT, cleanLayout, SIM0 };
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
