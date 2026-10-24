# PulseLab Monitor Simulator

Simulador multiparamétrico de UTI para aulas de enfermagem, em português. Uso **educacional**: não monitora pacientes e não orienta conduta clínica.

## Como usar em aula
1. Abra `index.html` no Chrome ou Edge. Esta é a **tela do professor**.
2. Clique em **Abrir projeção** (ou **Projeção em tela cheia**). Arraste a janela para o projetor.
3. **Clique uma vez na tela da projeção** («Toque para iniciar»). Isso libera o som: o navegador só permite áudio depois de um clique. A partir daí os alarmes e o bip tocam sozinhos; mudar parâmetros, cenário ou ritmo nunca desliga o som.
4. Escolha um cenário à esquerda. Ajuste FC, PA, FR, SpO₂, EtCO₂ e temperatura nos controles do centro. Use **Ao vivo** (vai direto) ou **Preparar** (edita e só aplica no botão).

Atalhos no console: **Espaço** congela/retoma · **1–9** cenários · **A** silencia alarmes por 2 min · **B** liga/desliga o bip. Na projeção: **F** tela cheia.

## O que o monitor faz
- **Varredura de monitor real.** O traçado já desenhado fica parado; um ponto de varredura avança da esquerda para a direita e apaga só uma pequena janela à frente. Nada rola, nada se alonga. A tela já abre cheia (26 s de histórico). Pausar congela; retomar continua do mesmo ponto; mudar de cenário não apaga o que já está na tela.
- **Calibração real.** ECG a 25 mm/s e 10 mm/mV, grade de 1 e 5 mm; respiração e CO₂ a 6,25 mm/s.
- **Os números vêm das ondas.** FC dos QRS, FC de pulso da pleth, FR e EtCO₂ do capnograma, SpO₂ com média e atraso, PNI em ciclo de 32 s com manguito.
- **Ritmos:** sinusal (taqui/bradi), FA com R-R irregular, flutter atrial 2:1, TSV, BAV total, supra de ST, TV, torsades de pointes, TV sem pulso, FV (grossa/fina), assistolia, AESP, eletrodo solto, extrassístoles. RCP, RCE e **choque 200 J** (artefato de descarga, depois o ritmo que o professor escolher).
- **Alarmes** por prioridade (alta vermelho, média amarelo, baixa ciano), com atraso, limites editáveis, apneia, eletrodo solto e som próprio de cada prioridade, automáticos. Silenciar 2 min com contagem.
- **Som da bomba do manguito** durante a PNI (motor enchendo, estalos da válvula, escape final), ligável na aba Som.
- **Bip de FC** ligável: tom fixo no QRS ou pelo pulso da SpO₂ (o tom acompanha a saturação). Não toca em FV, assistolia ou eletrodo solto.
- **31 cenários** (v5), vários com evolução em fases (hemorragia, sepse, hipoxemia), tempo de aula ×1/×2/×5/×10, acoplamento fisiológico opcional e **registro dos eventos da aula**.

Console e projeção são páginas separadas e sincronizam no mesmo navegador (BroadcastChannel + localStorage). Entre aparelhos diferentes não.

## Publicar no GitHub Pages (substituindo o repositório atual)
1. No repositório, apague os arquivos antigos (`index.html`, `monitor.html`, `js/`, `scripts/`, `tests/`, `.github/workflows/*`, `README.md`).
2. Envie o conteúdo desta pasta (inclusive a pasta oculta `.github`).
3. Em **Settings → Pages**, deixe a origem em **GitHub Actions**.
4. O workflow roda os testes, injeta o SHA do commit no site e confere se a versão publicada é a do commit.

Se preferir só testar, abra o `index.html` com duplo clique: ele é um arquivo único e funciona offline.

## Desenvolvimento
```
npm test        # testes do motor (node --test), sem navegador
npm run build   # gera index.html (arquivo único) a partir de src/
npm run e2e     # testes no navegador (precisa de playwright-core e Chromium)
```
`src/engine.js` (motor, sem DOM) e `src/template.html` (interface) geram o `index.html`. Depois de mexer em `src/`, rode `npm run build` e envie o `index.html` junto.

## Limites conhecidos
- Valores didáticos de adulto, com fonte/justificativa em cada cenário. Não validados clinicamente nem equivalentes a um equipamento real.
- O som exige um clique por carga da página (regra do navegador).
- Sem sincronização entre dispositivos, sem pressão invasiva, ventilador ou pediatria.

## Novidades da v4
- **Arrastar para trocar:** na miniatura da projeção, arraste um painel sobre outro (ex.: FC ↔ SpO₂, ECG ↔ CO₂).
- **× em cada painel:** oculta o painel; os demais se expandem e ocupam todo o espaço. «Restaurar painéis e ordem» (aba Tela) devolve o padrão.
- **Parâmetros aplicam na hora** (sem botão «Aplicar»).
- **Restaurar basal:** botão fixo na barra superior.
- Removido o quadrado de calibração no início do ECG; rodapé: «Criado por Enf. Rubens Diniz».

## Novidades da v5
- **18 cenários novos**, agrupados no console: anafilaxia, tamponamento, pneumotórax hipertensivo, asma/DPOC, embolia pulmonar, edema agudo de pulmão, intoxicação por opioide, cetoacidose, TSV, flutter, BAV total, ESV frequentes, IAM com supra de ST (evolui para TV/FV), crise hipertensiva, hipertermia maligna, hipotermia, pós-parada (RCE) e torsades de pointes. Cada cenário tem a fonte/justificativa na aba de fases.
- **Favicon** novo (SVG + PNG + ícone de tela inicial do celular), embutido no arquivo.
- **Controle pelo celular (PIN ou QR Code).** No console: botão **📱 Celular → Ativar**. O celular lê o QR (ou abre o endereço do site e digita o PIN de 6 dígitos) e vira um controle remoto **sem monitor**: busca e escolhe cenários, avança fases, ajusta ritmo e sinais vitais (com acoplamento fisiológico), congela/retoma, mede PNI, silencia alarmes, muda a velocidade, comanda choque/RCP/RCE e restaura o basal. No cabeçalho só há o ícone de som (mudo/ligado) – a projeção respeita o mudo.
  - Como funciona: WebRTC via PeerJS (embutido no arquivo). O servidor público do PeerJS só faz o pareamento; os comandos vão direto entre os aparelhos. Nada é gravado em servidor. A conexão só é iniciada quando você ativa «Celular»; antes disso o monitor continua 100% offline.
  - Limitações: precisa de internet nos dois aparelhos; Wi‑Fi com isolamento de clientes (comum em escolas) pode bloquear a conexão direta – use os dados móveis no celular. O QR só funciona com o site publicado (GitHub Pages), não com o arquivo aberto do disco.
  - Servidor próprio (opcional): `?ph=host&pp=porta&ps=1` na URL do console e do celular apontam para um PeerServer seu.
- Testes: `npm test` (motor), `npm run e2e` (monitor), `npm run e2e:remote` (console + celular, com PeerServer local).

## Novidades da v6
- **Som da bomba da PNI:** ao medir a pressão, a projeção reproduz o compressor do manguito (enche ~10 s, esvazia em degraus com estalos, escape no final). Respeita o volume dos alarmes e o mudo; checkbox e botão de teste na aba **Som**.
- **FC até 300 bpm** (console e celular).
- **Console redesenhado (visual premium):** cartões de vidro com sombras e animações, cenários com ícones e cores por categoria (com busca), parâmetros com cores iguais às do monitor, painel de KPIs ao vivo com os valores medidos, ícones novos em todo o sistema e abas em estilo segmentado. Respeita «reduzir movimento» do sistema.
- **Novo favicon** a partir da logo PulseLab (versão vetorial nítida para a aba + ícone da tela inicial).
- Celular com o mesmo visual (ícones, cartões coloridos, logo).

## Novidades da v7
- **Barra superior que sempre cabe:** «Abrir projeção» e tela cheia ficam sempre visíveis (testado de 1100 a 1920 px, sem rolagem lateral). Iniciar/Congelar viraram ícones agrupados num único quadro discreto; «Som» virou só o ícone.
- **Projeção em janela:** «Abrir projeção» abre uma janela do navegador (popup), não uma nova aba. Se o navegador bloquear, aparece um aviso para permitir pop-ups.
- **Som que persiste em segundo plano:** bipes, alarmes, som da PNI e batimentos agora são gerados por um Web Worker (não pausado em abas ocultas) e a aba/janela é mantida como «tocando áudio». Funciona mesmo com a projeção atrás de outra janela.
- **Variação natural da FC:** com «variabilidade» ligada, a FC oscila suavemente cerca de ±2–3 bpm (ex.: 89 → 86–92), sem ficar parada. Vale para ritmos com pulso (sinusal, FA, flutter, TSV, BAV, AESP).
