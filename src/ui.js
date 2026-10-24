/* =================== ÍCONES E IDENTIDADE VISUAL =================== */
const LOGO = (document.querySelector('link[rel=icon][type="image/svg+xml"]') || {}).href || '';
const P = d => `<path d="${d}"/>`;
const IC = {
  heart: P('M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z'),
  pulse: P('M2.5 12.5h4.2l2.3-6.5 4 12.5 2.4-6h6.1'),
  drop: P('M12 3s6.2 6.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 3 12 3z') + P('M9.2 14.4a2.9 2.9 0 0 0 2.4 2.5'),
  thermo: P('M10 14.2V5.5a2 2 0 0 1 4 0v8.7a4 4 0 1 1-4 0z') + P('M12 9.5v6'),
  alert: P('M12 3.5l9.5 16.5h-19z') + P('M12 10v4.5') + P('M12 17.4h.01'),
  wind: P('M3 8.5h10.2a2.8 2.8 0 1 0-2.8-2.8') + P('M3 12.5h15a3 3 0 1 1-3 3') + P('M3 16.5h6'),
  lungs: P('M9.2 4.5v7.2c0 3.6-1.8 6.4-5.2 7.8-.3-4.8.6-10.6 5.2-15z') + P('M14.8 4.5v7.2c0 3.6 1.8 6.4 5.2 7.8.3-4.8-.6-10.6-5.2-15z') + P('M12 4v7'),
  pill: P('M8.2 16.2l8-8a3.6 3.6 0 0 0-5.1-5.1l-8 8a3.6 3.6 0 0 0 5.1 5.1z') + P('M8.6 8.6l5.1 5.1'),
  bolt: P('M13.2 2.5L4.5 13.8h6.2l-1 7.7 8.8-11.4h-6.3z'),
  plug: P('M9 3v5M15 3v5') + P('M6.5 8h11v3a5.5 5.5 0 0 1-11 0z') + P('M12 16.5V21'),
  gauge: P('M4 18.5a9 9 0 1 1 16 0') + P('M12 13.5l4-4.5') + P('M12 13.5h.01'),
  flame: P('M12 3c.8 4.2 5.5 5.6 5.5 10.4a5.5 5.5 0 0 1-11 0c0-2.1 1-3.4 2.2-4.4 0 2 .9 3 2 3 .2-3.2-.9-5.2 1.3-9z'),
  snow: P('M12 2.5v19M4 7l16 10M20 7L4 17') + P('M9.5 4L12 6.5 14.5 4M9.5 20L12 17.5 14.5 20'),
  refresh: P('M20 11.5a8 8 0 1 0-2.1 6') + P('M20.5 4.5v7h-7'),
  flat: P('M2.5 12h19') + P('M7 9.5l-1.5 2.5L7 14.5'),
  play: P('M7 4.8l12 7.2-12 7.2z'),
  pause: P('M8.5 5v14M15.5 5v14'),
  phone: P('M8 2.8h8a1.8 1.8 0 0 1 1.8 1.8v14.8A1.8 1.8 0 0 1 16 21.2H8a1.8 1.8 0 0 1-1.8-1.8V4.6A1.8 1.8 0 0 1 8 2.8z') + P('M11 18.2h2'),
  speaker: P('M4 9.5v5h3.8l5 4V5.5l-5 4z') + P('M16.2 9a4.2 4.2 0 0 1 0 6') + P('M18.6 6.4a8 8 0 0 1 0 11.2'),
  mute: P('M4 9.5v5h3.8l5 4V5.5l-5 4z') + P('M17 9.5l4.5 5M21.5 9.5L17 14.5'),
  monitor: P('M3.5 4.5h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z') + P('M8.5 20.5h7M12 16.5v4') + P('M5.5 11h3l1.5-3 2.5 6 1.5-3h4'),
  expand: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  search: P('M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z') + P('M16 16l5 5'),
  x: P('M6 6l12 12M18 6L6 18'),
  sliders: P('M4 7h9M17 7h3M4 17h3M11 17h9') + P('M15 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0') + P('M9 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'),
  bell: P('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z') + P('M10 20.8a2.2 2.2 0 0 0 4 0'),
  bellOff: P('M6 16.5V11a6 6 0 0 1 9-5.2M18 11v5.5l1.5 2H8') + P('M3.5 3.5l17 17'),
  list: P('M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01'),
  scenario: P('M4 5.5h16v13H4z') + P('M4 10h16M9 5.5V10'),
  stetho: P('M6 3.5v6a4 4 0 0 0 8 0v-6') + P('M10 13.5v1.5a4.5 4.5 0 0 0 9 0v-1.5') + P('M19 11.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'),
  cuff: P('M3.5 9h13v6h-13z') + P('M16.5 12h3.5a1.5 1.5 0 0 1 1.5 1.5v4') + P('M7 9v6M11 9v6'),
  restart: P('M4.5 12a7.5 7.5 0 1 0 2.4-5.5') + P('M4.2 4.2v4.6h4.6')
};
const ic = (n, c) => `<svg class="ic${c ? ' ' + c : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
const SCI = { basal: 'heart', taqui: 'pulse', brady: 'heart', hemo: 'drop', sepse: 'thermo', cardio: 'heart', anafi: 'alert', tamp: 'heart', pneumo: 'wind', hipox: 'lungs', dpoc: 'wind', tep: 'drop', edema: 'lungs', opioide: 'pill', cad: 'drop', fa: 'pulse', fl: 'pulse', tsv: 'bolt', bav: 'pulse', esv: 'pulse', vt: 'bolt', lead: 'plug', iam: 'heart', hiper: 'gauge', hm: 'flame', hipot: 'snow', rosc: 'refresh', vtp: 'bolt', vf: 'bolt', tdp: 'bolt', asys: 'flat', pea: 'flat' };
const GCOL = { 'Normal': '#4dff9a', 'Choque e deterioração': '#ff7a5c', 'Respiratório e metabólico': '#3fd8ff', 'Arritmias e artefato': '#ffd23d', 'Outras emergências': '#b99cff', 'Parada cardíaca': '#ff4651' };
const SGC = {}; for (const g of GROUPS) for (const id of g[1]) SGC[id] = GCOL[g[0]] || '#4dff9a';
const PICON = { hr: 'pulse', sys: 'gauge', dia: 'gauge', rr: 'wind', spo2: 'drop', etco2: 'lungs', temp: 'thermo' };
const PCOL = { hr: '#4dff9a', sys: '#f1f4f2', dia: '#f1f4f2', rr: '#ffe14d', spo2: '#3fd8ff', etco2: '#ffe14d', temp: '#c9d3ce' };
