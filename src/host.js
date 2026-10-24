/* ---- celular (controle remoto): o console é o anfitrião; o celular só envia comandos ---- */
RM = { peer: null, conns: new Map(), pin: '', on: false, status: 'off', err: '', tries: 0, seq: 0, retryT: null };
const RMK = 'pulselab:host:phone';
const rmLoad = () => { try { return JSON.parse(localStorage.getItem(RMK) || 'null') || {}; } catch (e) { return {}; } };
const rmSave = o => { try { localStorage.setItem(RMK, JSON.stringify(o)); } catch (e) {} };
const newPin = () => String(100000 + Math.floor(Math.random() * 900000));
const rmSend = (c, m) => { try { c.send(m); } catch (e) {} };
function rmBroadcast(m) { RM.conns.forEach(o => rmSend(o.c, m)); }

function alarmList() {
  const all = [...displays.values()], proj = all.filter(d => !d.embed);
  const al = [].concat(...proj.map(d => d.alarms)).concat(proj.length ? [] : (all[0] || { alarms: [] }).alarms), seen = new Set();
  return al.filter(a => !seen.has(a.text) && seen.add(a.text)).sort((a, b) => b.prio - a.prio);
}
function rmHb() { if (RM.conns.size) rmBroadcast({ t: 'rhb', P: curP(), run: S.clock.running, al: alarmList().slice(0, 3) }); }

function rmStop(keepOn) {
  clearTimeout(RM.retryT); const p = RM.peer; RM.peer = null;
  RM.conns.forEach(o => { try { o.c.close(); } catch (e) {} }); RM.conns.clear();
  try { p && p.destroy(); } catch (e) {}
  if (!keepOn) { RM.on = false; RM.status = 'off'; rmSave({ on: false, pin: RM.pin }); }
  rmRender();
}
function rmStart(pin) {
  if (RM.peer) rmStop(true);
  let P; try { P = PeerClass(); } catch (e) { RM.on = true; RM.status = 'err'; RM.err = 'Não foi possível carregar o módulo de conexão.'; rmRender(); return; }
  RM.on = true; RM.pin = pin || RM.pin || newPin(); RM.status = 'connecting'; RM.err = ''; rmSave({ on: true, pin: RM.pin }); rmRender();
  const p = new P(peerId(RM.pin), peerOpts()); RM.peer = p;
  const later = (fn, ms) => { clearTimeout(RM.retryT); RM.retryT = setTimeout(() => { if (RM.on && RM.peer === p) fn(); }, ms); };
  p.on('open', () => { if (RM.peer !== p) return; RM.status = 'on'; RM.err = ''; RM.tries = 0; rmRender(); });
  p.on('error', e => {
    if (RM.peer !== p) return; const t = e && e.type;
    if (t === 'unavailable-id') { RM.tries++; RM.status = 'connecting'; rmRender(); later(() => { if (RM.tries > 3) { RM.tries = 0; rmStart(newPin()); } else rmStart(RM.pin); }, 3000); }
    else if (t === 'peer-unavailable') return;
    else { RM.status = 'err'; RM.err = (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') ? 'Sem internet ou servidor de pareamento indisponível. Tentando de novo…' : 'Falha na conexão (' + (t || 'erro') + '). Tentando de novo…'; rmRender(); later(() => rmStart(RM.pin), 6000); }
  });
  p.on('disconnected', () => { if (RM.peer !== p || p.destroyed) return; RM.status = 'connecting'; rmRender(); try { p.reconnect(); } catch (e) {} });
  p.on('connection', c => {
    if (RM.peer !== p) return;
    if (RM.conns.size >= 6) { c.on('open', () => { try { c.close(); } catch (e) {} }); return; }
    c.on('open', () => { RM.conns.set(c.peer, { c, last: now(), n: 'Celular ' + (++RM.seq) }); rmSend(c, { t: 'state', s: S }); rmHb(); rmRender(); toast('Celular conectado'); logEv('Celular conectado'); });
    c.on('data', d => rmData(c, d));
    const gone = () => { if (RM.conns.get(c.peer) && RM.conns.get(c.peer).c === c) { RM.conns.delete(c.peer); rmRender(); logEv('Celular desconectado'); } };
    c.on('close', gone); c.on('error', gone);
  });
}
function rmData(c, m) {
  const o = RM.conns.get(c.peer); if (!o || !m || typeof m !== 'object') return; o.last = now();
  if (m.t === 'ping') { rmSend(c, { t: 'pong' }); return; }
  if (m.t === 'hello') { rmSend(c, { t: 'state', s: S }); rmHb(); return; }
  if (m.t !== 'cmd') return;
  if (readOnly) { rmSend(c, { t: 'ro' }); return; }
  try { rmCmd(m); } catch (e) {}
}
function rmCmd(m) {
  switch (m.c) {
    case 'scenario': if (SC[m.id]) applyScenario(m.id); break;
    case 'basal': applyScenario('basal'); break;
    case 'phase': goPhase(S.scen.phase + 1); break;
    case 'pause': commit(n => reanchor(n, false)); break;
    case 'resume': commit(n => reanchor(n, true)); break;
    case 'rate': if ([1, 2, 5, 10].includes(Number(m.v))) commit(n => reanchor(n, n.clock.running, Number(m.v))); break;
    case 'nibp': startNibp(); break;
    case 'silence': commit(n => { n.alarm.silencedUntil = n.alarm.silencedUntil > now() ? 0 : now() + 120000; }); break;
    case 'mute': commit(n => { n.audio.mute = !!m.v; }); break;
    case 'rhythm': if (RH[m.r]) { setRhythm(m.r); applyDraft(); } break;
    case 'params': {
      const d = m.d || {}; draft.ectopy = clamp(Math.round(Number(d.ectopy) || 0), 0, 30); draft.vf = d.vf === 'fine' ? 'fine' : 'coarse'; draft.dur = DURS.some(x => x[0] === Number(d.dur)) ? Number(d.dur) : 0;
      PAR.forEach(p => { const v = Number(d[p[0]]); if (Number.isFinite(v)) draft[p[0]] = Math.round(clamp(v, p[3], p[4]) * 10) / 10; });
      applyDraft(); break;
    }
    case 'shock': { const so = $('shock-out'); if (so && ['none', 'asys', 'pea', 'rce'].includes(m.out)) so.value = m.out; if (['vf', 'vtp', 'vt', 'tdp'].includes(S.rhythm)) shock(); break; }
    case 'cpr': if (PULSELESS.has(S.rhythm)) toggleCpr(); break;
    case 'rce': if (PULSELESS.has(S.rhythm)) rce(); break;
    case 'losepulse': if (S.rhythm === 'vt') { draft.rhythm = 'vt'; setRhythm('vtp'); applyDraft(); } break;
  }
}
setInterval(() => { rmHb(); const t = now(); RM.conns.forEach((o, k) => { if (t - o.last > 16000) { try { o.c.close(); } catch (e) {} RM.conns.delete(k); rmRender(); } }); }, 1000);

/* ---- janela «Celular» ---- */
const mod = document.createElement('div'); mod.className = 'modal hide'; mod.id = 'phmodal'; mod.setAttribute('role', 'dialog'); mod.setAttribute('aria-modal', 'true'); mod.setAttribute('aria-label', 'Controlar pelo celular'); document.body.appendChild(mod);
const phOpen = () => { mod.classList.remove('hide'); rmRender(); }, phClose = () => mod.classList.add('hide');
mod.addEventListener('click', e => { if (e.target === mod) phClose(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !mod.classList.contains('hide')) phClose(); });
$('phone').onclick = phOpen;
function qrSvg(text) { loadLib('vend-qr'); const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
function rmRender() {
  const n = RM.conns.size, b = $('phone'); if (b) { b.textContent = '📱 Celular' + (n ? ' · ' + n : ''); b.classList.toggle('pri', n > 0); }
  if (mod.classList.contains('hide')) return;
  const url = remoteUrl(RM.pin), local = /^(file:|about:)/.test(location.protocol), pinTxt = RM.pin ? RM.pin.slice(0, 3) + ' ' + RM.pin.slice(3) : '--- ---';
  let body;
  if (!RM.on) body = `<p style="margin:0;color:var(--mut)">Transforma o celular em controle remoto: o professor escolhe cenários, ajusta sinais vitais, congela, silencia e restaura o basal <b style="color:var(--fg)">sem encostar no computador</b>. O celular <b style="color:var(--fg)">não mostra o monitor</b>, apenas os controles.</p><button class="btn pri" id="ph-on" style="align-self:flex-start;padding:10px 18px">Ativar conexão com celular</button><div class="hint">Usa a internet apenas para o pareamento (servidor público do PeerJS); depois os aparelhos conversam direto. Nada é salvo em servidor.</div>`;
  else {
    let qr = ''; try { qr = qrSvg(url); } catch (e) { qr = '<div style="color:#000;padding:10px;font-size:12px">QR indisponível</div>'; }
    const st = RM.status === 'on' ? (n ? `<b style="color:var(--acc)">${n} celular${n > 1 ? 'es' : ''} conectado${n > 1 ? 's' : ''}</b>` : '<span style="color:var(--amb)">Aguardando celular…</span>') : RM.status === 'err' ? `<span style="color:#ff9aa0">${RM.err}</span>` : '<span style="color:var(--amb)">Conectando ao servidor de pareamento…</span>';
    body = `<div class="phgrid"><div class="qrbox" role="img" aria-label="QR Code para conectar o celular">${qr}</div><div><div class="hint">PIN</div><div class="pinbig" id="ph-pin">${pinTxt}</div><ol class="phsteps"><li>Aponte a <b>câmera do celular</b> para o QR Code, <b>ou</b></li><li>abra <span class="phurl">${remoteUrl('').split('?')[0]}?mode=remote</span> e digite o <b>PIN</b>.</li></ol></div></div>
<div id="ph-st">${st}</div>${local ? '<div class="hint" style="color:var(--amb)">Você abriu o arquivo direto do computador (file://). O QR só funciona quando o monitor está publicado em um endereço da internet (por exemplo, GitHub Pages).</div>' : ''}
<div class="phdev">${[...RM.conns.entries()].map(([k, o]) => `<div class="row"><span>📱 ${o.n}</span><button class="btn sm" data-kick="${k}">Desconectar</button></div>`).join('')}</div>
<div class="row"><button class="btn" id="ph-new">Gerar novo PIN</button><span class="sp"></span><button class="btn dan" id="ph-off">Desativar celular</button></div>
<div class="hint">Celular e computador precisam estar online. Em alguns Wi‑Fi de escolas (que isolam os aparelhos), use os dados móveis no celular.</div>`;
  }
  mod.innerHTML = `<div class="mbox"><div class="mh"><b>📱 Controlar pelo celular</b><button class="btn sm" id="ph-x" aria-label="Fechar">✕</button></div><div class="mb">${body}</div></div>`;
  $('ph-x').onclick = phClose; const on = $('ph-on'); if (on) on.onclick = () => rmStart(rmLoad().pin);
  const nw = $('ph-new'); if (nw) nw.onclick = () => { rmStop(true); rmStart(newPin()); };
  const off = $('ph-off'); if (off) off.onclick = () => rmStop(false);
  mod.querySelectorAll('[data-kick]').forEach(k => k.onclick = () => { const o = RM.conns.get(k.dataset.kick); if (o) { try { o.c.close(); } catch (e) {} RM.conns.delete(k.dataset.kick); rmRender(); } });
}
$('mutebtn').onclick = () => commit(n => { n.audio.mute = !n.audio.mute; });
{ const sv = rmLoad(); if (sv.on && /^\d{6}$/.test(sv.pin || '')) { RM.pin = sv.pin; setTimeout(() => { if (!RM.on) rmStart(sv.pin); }, 700); } else rmRender(); }
