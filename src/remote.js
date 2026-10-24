/* =================== CELULAR: bibliotecas e transporte =================== */
/* PeerJS (WebRTC) e gerador de QR ficam embutidos no arquivo e só são executados quando necessário. */
const libDone = {};
function loadLib(id) { if (libDone[id]) return; const el = $(id); if (!el) throw new Error('lib ' + id); (0, eval)(el.textContent); libDone[id] = 1; }
function PeerClass() { loadLib('vend-peer'); const P = (window.peerjs && window.peerjs.Peer) || window.Peer; if (!P) throw new Error('peerjs'); return P; }
function peerOpts() {
  const o = { debug: 0 }, h = qs.get('ph');
  if (h) { o.host = h; o.port = Number(qs.get('pp') || 9000); o.path = qs.get('pq') || '/'; o.secure = qs.get('ps') === '1'; o.config = { iceServers: [] }; }
  return o;
}
const peerId = pin => 'pulselab-' + pin;
function remoteUrl(pin) {
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/(index|monitor)\.html$/, '/');
  u.searchParams.set('mode', 'remote'); if (pin) u.searchParams.set('pin', pin);
  for (const k of ['ph', 'pp', 'pq', 'ps']) if (qs.get(k)) u.searchParams.set(k, qs.get(k));
  return u.href;
}

/* =================== CELULAR: tela de controle =================== */
function startRemote() {
  document.body.classList.add('remote'); document.title = 'PulseLab · Controle';
  const LSP = 'pulselab:remote:pin', ICON = LOGO;
  let S = defaultSession(), hb = null, view = 'sc', status = 'idle', errMsg = '', pin = '', query = '';
  let built = '', peer = null, conn = null, retryT = null, pingT = null, openT = null, lastPong = 0, draft = null, dirtyUntil = 0, sendT = null, everOnline = false;
  const now = () => Date.now(), el = id => document.getElementById(id);
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };
  const rtoast = s => { const t = el('rm-toast'); t.textContent = s; t.classList.add('on'); clearTimeout(rtoast.h); rtoast.h = setTimeout(() => t.classList.remove('on'), 1800); };
  try { pin = (qs.get('pin') || localStorage.getItem(LSP) || '').replace(/\D/g, '').slice(0, 6); } catch (e) { pin = (qs.get('pin') || '').replace(/\D/g, '').slice(0, 6); }

  $('root').innerHTML = `<div class="rm-top"><div class="rm-brand">${ICON ? `<img src="${ICON}" alt="">` : ''}<span>PULSELAB<small>controle remoto</small></span></div><button class="rm-pill" id="rm-st" type="button" aria-label="Estado da conexão"><i></i><span>Desconectado</span></button><div class="sp"></div><button class="rm-mute" id="rm-mute" type="button" aria-label="Silenciar ou ativar o som do monitor">${ic('speaker')}</button></div>
<div class="rm-alert" id="rm-alert" role="status"></div>
<main class="rm-main" id="rm-main"></main>
<nav class="rm-nav" id="rm-nav"><button data-v="sc">${ic('stetho')}Cenários</button><button data-v="pa">${ic('sliders')}Parâmetros</button><button data-v="ac">${ic('bolt')}Ações</button></nav>
<div class="rm-toast" id="rm-toast"></div>`;

  /* ---------- transporte ---------- */
  function setStatus(s, msg) {
    status = s; errMsg = msg || '';
    const p = el('rm-st'), tx = { idle: ['', 'Desconectado'], connecting: ['warn', 'Conectando…'], online: ['ok', 'Conectado'], retry: ['warn', 'Reconectando…'], err: ['bad', 'Sem conexão'] }[s];
    p.className = 'rm-pill ' + tx[0]; p.lastChild.textContent = tx[1];
    document.body.classList.toggle('offline', s !== 'online'); renderAll();
  }
  function cleanup() { clearTimeout(openT); clearInterval(pingT); try { conn && conn.close(); } catch (e) {} try { peer && peer.destroy(); } catch (e) {} conn = null; peer = null; }
  function scheduleRetry(ms) { clearTimeout(retryT); if (!pin) return; retryT = setTimeout(connect, ms || 3000); }
  function connect() {
    clearTimeout(retryT); if (!/^\d{6}$/.test(pin)) { setStatus('idle'); return; }
    cleanup(); setStatus(everOnline ? 'retry' : 'connecting');
    let P; try { P = PeerClass(); } catch (e) { setStatus('err', 'Não foi possível iniciar a conexão neste navegador.'); return; }
    const p = peer = new P(undefined, peerOpts());
    p.on('open', () => {
      if (peer !== p) return; const c = conn = p.connect(peerId(pin), { reliable: true, serialization: 'json' });
      openT = setTimeout(() => { if (conn === c && status !== 'online') { setStatus('err', 'O console não respondeu. Confira o PIN e se a opção «Celular» está ligada no computador.'); scheduleRetry(5000); } }, 14000);
      c.on('open', () => { if (conn !== c) return; clearTimeout(openT); everOnline = true; lastPong = performance.now(); try { localStorage.setItem(LSP, pin); } catch (e) {} setStatus('online'); c.send({ t: 'hello' }); startPing(); keepAwake(); });
      c.on('data', onData);
      c.on('close', () => { if (conn === c) { setStatus('retry'); scheduleRetry(2000); } });
      c.on('error', () => { if (conn === c) { setStatus('retry'); scheduleRetry(3000); } });
    });
    p.on('error', e => {
      if (peer !== p) return; const t = e && e.type;
      if (t === 'peer-unavailable') setStatus('err', 'PIN não encontrado. Confira o número e se a opção «Celular» está ligada no console.');
      else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') setStatus('err', 'Sem internet ou servidor de pareamento indisponível.');
      else setStatus('err', 'Falha na conexão (' + (t || 'erro') + ').');
      scheduleRetry(5000);
    });
    p.on('disconnected', () => { try { if (peer === p && !p.destroyed) p.reconnect(); } catch (e) {} });
  }
  function startPing() {
    clearInterval(pingT);
    pingT = setInterval(() => {
      if (!conn || status !== 'online') return;
      if (performance.now() - lastPong > 10000) { setStatus('retry'); cleanup(); scheduleRetry(1000); return; }
      try { conn.send({ t: 'ping' }); } catch (e) {}
    }, 3000);
  }
  let wl = null; function keepAwake() { try { if (navigator.wakeLock && !wl) navigator.wakeLock.request('screen').then(l => { wl = l; l.addEventListener('release', () => { wl = null; }); }).catch(() => {}); } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { keepAwake(); if (pin && status !== 'online' && status !== 'connecting') scheduleRetry(300); } });
  function send(m) { if (conn && status === 'online') { try { conn.send(m); return true; } catch (e) {} } rtoast('Sem conexão com o console'); return false; }
  const cmd = (c, extra) => { buzz(); return send(Object.assign({ t: 'cmd', c }, extra || {})); };
  function onData(m) {
    if (!m) return;
    if (m.t === 'pong') lastPong = performance.now();
    else if (m.t === 'state' && m.s) { lastPong = performance.now(); S = sanitize(m.s); if (now() > dirtyUntil) draft = mkDraft(); renderAll(); }
    else if (m.t === 'rhb') { lastPong = performance.now(); hb = { P: m.P, run: m.run, al: m.al || [], at: performance.now() }; renderAlert(); if (view === 'sc') renderPhaseBars(); }
    else if (m.t === 'ro') rtoast('O console está em modo somente leitura');
  }
  const curP = () => hb ? hb.P + (hb.run ? (performance.now() - hb.at) / 1000 * S.clock.rate : 0) : 0;

  /* ---------- rascunho de parâmetros ---------- */
  function mkDraft() { const d = { rhythm: S.rhythm, ectopy: S.ectopy, vf: S.vf, dur: draft ? draft.dur : 0, couple: draft ? draft.couple : true }; KEYS.forEach(k => d[k] = Math.round(S.p.to[k] * 10) / 10); return d; }
  draft = mkDraft();
  const locked = () => { const r = draft.rhythm; if (!PULSELESS.has(r)) return {}; const o = { sys: 'sem pulso', dia: 'sem pulso', spo2: 'sem sinal de pleth' }; if (r === 'vf' || r === 'asys' || r === 'tdp') o.hr = 'sem QRS detectável'; return o; };
  function pushParams() {
    dirtyUntil = now() + 1800; clearTimeout(sendT); clearTimeout(pushParams.h); pushParams.h = setTimeout(() => { if (now() >= dirtyUntil) { draft = mkDraft(); syncParams(); } }, 2100);
    sendT = setTimeout(() => { const d = draft, o = { ectopy: d.ectopy, vf: d.vf, dur: d.dur }; KEYS.forEach(k => o[k] = d[k]); send({ t: 'cmd', c: 'params', d: o }); }, 160);
  }
  function edit(key, val) {
    const prev = Object.assign({}, draft), p = PAR.find(x => x[0] === key); draft[key] = Math.round(clamp(val, p[3], p[4]) * 10) / 10;
    if (draft.couple && !PULSELESS.has(draft.rhythm)) { const r = couple(prev, draft, key); Object.assign(draft, r.next); }
    syncParams(); pushParams();
  }

  /* ---------- telas ---------- */
  function renderAll() { renderTop(); if (!el('rm-main')) return; if (!everOnline && status !== 'online') { if (built !== 'pin') renderPin(); else syncPin(); return; } if (built !== view) buildView(); renderView(); }
  function renderTop() {
    const mu = el('rm-mute'); if (mu) { mu.innerHTML = ic(S.audio.mute ? 'mute' : 'speaker'); mu.classList.toggle('on', !!S.audio.mute); mu.title = S.audio.mute ? 'Som desligado. Toque para ligar' : 'Som ligado. Toque para silenciar'; }
    el('rm-nav').style.display = (status === 'idle' || (!everOnline && status !== 'online')) ? 'none' : '';
    el('rm-nav').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    renderAlert();
  }
  function renderAlert() {
    const a = el('rm-alert'); if (!a) return; const top = hb && hb.al && hb.al[0];
    a.className = 'rm-alert' + (top && status === 'online' ? ' p' + top.prio : ''); a.innerHTML = top ? ic('bell') + ' ' + top.text + (hb.al.length > 1 ? '  +' + (hb.al.length - 1) : '') : '';
  }
  function renderPin() {
    built = 'pin'; el('rm-main').innerHTML = `<div class="rm-pin" id="rm-pinbox"><img src="${ICON}" alt="" width="72" height="72" style="border-radius:16px"><h1>Controle do monitor</h1><p>Digite o PIN de 6 dígitos mostrado no computador (botão «📱 Celular») ou aponte a câmera para o QR Code.</p><input id="rm-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="000000" aria-label="PIN de 6 dígitos"><div class="rm-err" id="rm-err"></div><button class="rm-btn pri" id="rm-go" type="button">Conectar</button></div>`;
    const i = el('rm-pin'); i.value = pin;
    i.oninput = () => { pin = i.value.replace(/\D/g, '').slice(0, 6); i.value = pin; if (pin.length === 6) go(); };
    el('rm-go').onclick = go; syncPin();
  }
  function go() { if (!/^\d{6}$/.test(pin)) { el('rm-err').textContent = 'O PIN tem 6 dígitos.'; return; } everOnline = false; connect(); }
  function syncPin() { const e = el('rm-err'); if (e) e.textContent = status === 'err' ? errMsg : (status === 'connecting' ? 'Conectando…' : ''); const g = el('rm-go'); if (g) g.disabled = status === 'connecting'; }

  function buildView() {
    const m = el('rm-main'); built = view;
    if (view === 'sc') m.innerHTML = `<div class="rm-search">${ic('search')}<input id="rm-q" type="search" placeholder="Buscar cenário…" autocomplete="off" aria-label="Buscar cenário"></div><button class="rm-basal" id="rm-basal" type="button">${ic('refresh')} Restaurar ritmo basal</button><div id="rm-list"></div>`;
    else if (view === 'pa') m.innerHTML = `<div class="rm-row"><label for="rm-rh">Ritmo</label><select class="rm-sel" id="rm-rh">${Object.keys(RH).map(k => `<option value="${k}">${RH[k]}</option>`).join('')}</select></div>
<div class="rm-row"><label for="rm-dur">Alcançar em</label><select class="rm-sel" id="rm-dur">${DURS.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('')}</select></div>
<div id="rm-pars">${PAR.map(p => `<div class="rm-par" id="pw-${p[0]}" style="--pc:${PCOL[p[0]]}"><div class="rm-pt"><span>${ic(PICON[p[0]])}${p[6]}</span><small>${p[2]}</small></div><div class="rm-pv"><button class="rm-stp" data-k="${p[0]}" data-d="-1" aria-label="Diminuir ${p[1]}" type="button">−</button><output id="pv-${p[0]}"></output><button class="rm-stp" data-k="${p[0]}" data-d="1" aria-label="Aumentar ${p[1]}" type="button">+</button></div><input type="range" id="pr-${p[0]}" min="${p[3]}" max="${p[4]}" step="${p[5]}" aria-label="${p[1]}"><div class="rm-why" id="pn-${p[0]}"></div></div>`).join('')}</div>
<div class="rm-par" id="pw-ect"><div class="rm-pt"><span>EXTRASSÍSTOLES</span><small>por minuto</small></div><div class="rm-pv"><output id="pv-ect" style="font-size:30px"></output></div><input type="range" id="pr-ect" min="0" max="30" step="1" aria-label="Extrassístoles por minuto"></div>
<label class="rm-chk"><input type="checkbox" id="rm-cpl"> Acoplar parâmetros (um muda os outros de forma fisiológica)</label>`;
    else m.innerHTML = `<div id="rm-act"></div>`;
    if (view === 'sc') {
      const q = el('rm-q'); q.value = query; q.oninput = () => { query = q.value; renderList(); };
      el('rm-basal').onclick = () => { cmd('basal'); rtoast('Voltando ao basal'); };
      el('rm-list').onclick = e => { const b = e.target.closest('[data-id]'); const a = e.target.closest('[data-act]'); if (a) { cmd('phase'); rtoast('Avançando fase'); return; } if (b) { cmd('scenario', { id: b.dataset.id }); rtoast('Cenário: ' + (SC[b.dataset.id] || {}).name); } };
    } else if (view === 'pa') bindParams();
  }
  function renderView() { if (view === 'sc') renderList(); else if (view === 'pa') syncParams(); else renderActions(); }

  /* cenários */
  function renderList() {
    const L = el('rm-list'); if (!L) return; const q = query.trim().toLowerCase(); let h = '';
    for (const g of GROUPS) {
      const items = g[1].map(id => SC[id]).filter(s => s && (!q || (s.name + ' ' + s.sub + ' ' + g[0]).toLowerCase().includes(q)));
      if (!items.length) continue; h += `<div class="rm-h" style="--g:${GCOL[g[0]]}"><i></i>${g[0]}</div>`;
      for (const s of items) {
        const on = S.scen.id === s.id, pl = s.rhythm === 'vtp' || s.rhythm === 'vf' || s.rhythm === 'asys' || s.rhythm === 'pea' || s.rhythm === 'tdp';
        h += `<button class="rm-card${on ? ' on' : ''}${pl ? ' pl' : ''}" data-id="${s.id}" type="button" style="--g:${SGC[s.id]}"><span class="t"><span class="ico">${ic(SCI[s.id] || 'pulse')}</span><span class="tx"><b>${s.name}</b><small>${s.sub}</small></span>${s.ph.length > 1 ? `<span class="badge">${s.ph.length} fases</span>` : ''}</span>${on ? phaseHtml(s) : ''}</button>`;
      }
    }
    L.innerHTML = h || '<div class="rm-why" style="padding:14px;font-size:15px">Nenhum cenário encontrado.</div>';
  }
  function phaseHtml(s) {
    const i = S.scen.phase, n = s.ph.length, nx = s.ph[i + 1]; let h = `<span class="rm-ph"><span>Fase ${i + 1} de ${n}${s.ph[i] && s.ph[i].note ? ' · ' + s.ph[i].note : ''}</span>`;
    if (nx) h += `<span class="rm-bar"><i id="rm-pb" style="width:${phasePct(s)}%"></i></span><span style="display:flex;gap:10px;align-items:center;justify-content:space-between"><span id="rm-pl">${phaseLeft(s)}</span><span class="rm-btn" data-act="phase" role="button" style="min-height:44px;padding:8px 14px">Avançar fase ▸</span></span>`;
    return h + '</span>';
  }
  const phasePct = s => { const i = S.scen.phase, nx = s.ph[i + 1]; if (!nx) return 100; return clamp((curP() - (S.scen.startP + s.ph[i].at)) / (nx.at - s.ph[i].at) * 100, 0, 100).toFixed(1); };
  const phaseLeft = s => { const nx = s.ph[S.scen.phase + 1]; if (!nx) return ''; const l = Math.max(0, S.scen.startP + nx.at - curP()); return 'Próxima em ' + Math.floor(l / 60) + ':' + String(Math.round(l % 60)).padStart(2, '0'); };
  function renderPhaseBars() { const s = SC[S.scen.id], b = el('rm-pb'); if (!s || !b) return; b.style.width = phasePct(s) + '%'; const l = el('rm-pl'); if (l) l.textContent = phaseLeft(s); }

  /* parâmetros */
  function bindParams() {
    el('rm-rh').onchange = e => { draft.rhythm = e.target.value; dirtyUntil = 0; cmd('rhythm', { r: e.target.value }); };
    el('rm-dur').onchange = e => { draft.dur = Number(e.target.value); };
    el('rm-cpl').onchange = e => { draft.couple = e.target.checked; };
    PAR.forEach(p => { const k = p[0], rg = el('pr-' + k); rg.oninput = () => edit(k, Number(rg.value)); });
    el('pr-ect').oninput = e => { draft.ectopy = Number(e.target.value); syncParams(); pushParams(); };
    el('rm-pars').querySelectorAll('.rm-stp').forEach(b => {
      let t1 = null, t2 = null, n = 0; const k = b.dataset.k, p = PAR.find(x => x[0] === k), dir = Number(b.dataset.d);
      const step = () => { n++; const mult = n > 24 ? 10 : n > 10 ? 5 : 1; edit(k, draft[k] + dir * p[5] * (p[5] < 1 ? (n > 10 ? 3 : 1) : mult)); };
      const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (b.setPointerCapture) { try { b.setPointerCapture(e.pointerId); } catch (x) {} } n = 0; if (locked()[k]) return; buzz(); step(); t1 = setTimeout(() => { t2 = setInterval(step, 85); }, 380); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, stop);
    });
  }
  function syncParams() {
    if (view !== 'pa' || !el('rm-rh')) return; const lk = locked(), a = document.activeElement;
    if (a !== el('rm-rh')) el('rm-rh').value = draft.rhythm; if (a !== el('rm-dur')) el('rm-dur').value = String(draft.dur); el('rm-cpl').checked = draft.couple;
    PAR.forEach(p => {
      const k = p[0], v = draft[k], off = !!lk[k]; el('pw-' + k).classList.toggle('lock', off);
      el('pv-' + k).textContent = off ? '---' : (k === 'temp' ? Number(v).toFixed(1).replace('.', ',') : Math.round(v)); if (a !== el('pr-' + k)) el('pr-' + k).value = v; el('pr-' + k).disabled = off;
      el('pn-' + k).textContent = off ? lk[k] : '';
    });
    el('pv-ect').textContent = draft.ectopy + '/min'; el('rm-pars').querySelectorAll('input[type=range]').forEach(x => x.style.setProperty('--p', ((x.value - x.min) / (x.max - x.min) * 100) + '%')); { const x = el('pr-ect'); x.style.setProperty('--p', (x.value / 30 * 100) + '%'); } if (a !== el('pr-ect')) el('pr-ect').value = draft.ectopy; el('pr-ect').disabled = PULSELESS.has(draft.rhythm) && draft.rhythm !== 'pea';
  }

  /* ações */
  function renderActions() {
    const A = el('rm-act'); if (!A) return; const I = (n) => ic(n); const r = S.rhythm, arrest = PULSELESS.has(r) || r === 'vt', run = S.clock.running, sil = S.alarm.silencedUntil > now();
    const chip = (v, lab) => `<button class="rm-btn${S.clock.rate === v ? ' on' : ''}" data-rate="${v}" type="button">${lab}</button>`;
    A.innerHTML = `<div class="rm-h" style="margin-top:2px">Simulação</div><div class="rm-grid"><button class="rm-btn pri full" data-c="basal" type="button">${I('refresh')} Restaurar ritmo basal</button><button class="rm-btn" data-c="${run ? 'pause' : 'resume'}" type="button">${run ? I('pause') + ' Congelar' : I('play') + ' Retomar'}</button><button class="rm-btn" data-c="nibp" type="button">${I('cuff')} Medir PNI</button><button class="rm-btn full" data-c="silence" type="button">${sil ? I('bell') + ' Reativar alarmes' : I('bellOff') + ' Silenciar alarmes por 2 min'}</button></div>
<div class="rm-h">Velocidade da aula</div><div class="rm-seg">${chip(1, '×1')}${chip(2, '×2')}${chip(5, '×5')}${chip(10, '×10')}</div>
${arrest ? `<div class="rm-h">Parada cardíaca</div><div class="rm-grid">${['vf', 'vtp', 'vt', 'tdp'].includes(r) ? `<button class="rm-btn dan full" data-c="shock" type="button">${I('bolt')} ${r === 'vt' ? 'Cardioversão' : 'Choque'} 200 J</button>` : ''}${PULSELESS.has(r) ? `<button class="rm-btn${S.cpr ? ' on' : ''}" data-c="cpr" type="button">${S.cpr ? I('pause') + ' Parar RCP' : I('play') + ' Iniciar RCP'}</button><button class="rm-btn pri" data-c="rce" type="button">${I('heart')} RCE</button>` : ''}${r === 'vt' ? `<button class="rm-btn full" data-c="losepulse" type="button">Perder o pulso (TV → sem pulso)</button>` : ''}</div>
<div class="rm-row" style="margin-top:12px"><label for="rm-so">Após o choque</label><select class="rm-sel" id="rm-so"><option value="none">Mantém o ritmo</option><option value="asys">Assistolia</option><option value="pea">AESP</option><option value="rce">RCE (sinusal)</option></select></div>` : ''}`;
    A.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const c = b.dataset.c; if (c === 'shock') { const o = el('rm-so'); cmd('shock', { out: o ? o.value : 'none' }); } else cmd(c); });
    A.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => cmd('rate', { v: Number(b.dataset.rate) }));
    if (rmShockOut && el('rm-so')) el('rm-so').value = rmShockOut; const so = el('rm-so'); if (so) so.onchange = () => { rmShockOut = so.value; };
  }
  let rmShockOut = '';

  /* ---------- eventos globais ---------- */
  el('rm-nav').querySelectorAll('button').forEach(b => b.onclick = () => { view = b.dataset.v; buildView(); renderTop(); renderView(); el('rm-main').scrollTop = 0; });
  el('rm-mute').onclick = () => cmd('mute', { v: !S.audio.mute });
  el('rm-st').onclick = () => { if (status === 'online' || status === 'retry' || status === 'err') { if (confirm('Desconectar deste console e trocar o PIN?')) { try { localStorage.removeItem(LSP); } catch (e) {} pin = ''; everOnline = false; cleanup(); clearTimeout(retryT); hb = null; built = ''; setStatus('idle'); } } };
  window.addEventListener('beforeunload', cleanup);
  window.__rm = { get S() { return S; }, get status() { return status; }, get draft() { return draft; }, edit };

  if (/^\d{6}$/.test(pin)) connect(); else setStatus('idle');
}
