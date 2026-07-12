# Técnico 26 — Resumo completo do projeto (handoff)

> Documento para dar contexto a outra IA (ex.: ChatGPT) ou a um novo colaborador.
> Explica de onde partimos, o que o jogo é hoje, como está organizado e o que falta.
> Última atualização: julho/2026.

---

## 1. Visão geral

**Técnico 26** é um jogo de gerência de futebol (*football manager*) inspirado no **Brasfoot**, com interface web moderna, que roda **no navegador**. Tem dois modos:

- **Carreira (offline):** um jogador comanda um clube, joga temporadas, faz transferências, treina, etc. Salva no `localStorage` do navegador.
- **Online com salas (multiplayer):** um servidor Node hospeda **salas**; amigos entram com um **código de 5 letras**, cada um assume um clube do mesmo país e jogam a mesma temporada, com as rodadas rodando **ao vivo e sincronizadas** para todos.

O jogo está **publicado e jogável** em `https://tecnico26.onrender.com` (offline em `/`, online em `/online.html`), com deploy automático a cada push no GitHub (`filipysilva/soccer-manager`).

**Objetivo do dono do projeto:** recriar “tudo o que o Brasfoot tem”, com visual moderno e forte foco no **modo online com salas**. O dono não é programador; conduz por feedback em português.

---

## 2. De onde partimos

Existiam duas pastas no desktop:

- `Brasfoot22-23/` — instalação original do Brasfoot (usada só como **referência**; o manual em PDF foi extraído para entender as regras: habilidades, características, sistemas de campeonato, ranking de técnicos, finanças, etc.).
- `Tecnico de futebol online/` — uma tentativa anterior, com código que **não seguia a estrutura do Brasfoot** e não estava boa. Dela **reaproveitamos apenas os dados**: a base de jogadores 2026 (`world-db-2026.js`, derivada de Transfermarkt + atributos EA SPORTS FC 26), os **200 escudos** (`assets/crests`) e os **13 sons** (`assets/sounds`).

**Decisão inicial (confirmada com o dono):** **reconstruir do zero** numa pasta nova (`Tecnico26/`), com arquitetura pensada desde o início para o modelo Brasfoot e para o online; e **fazer o jogo completo primeiro, o online depois** (embora, na prática, o online tenha sido entregue cedo por já haver base sólida).

---

## 3. Estado atual (o que já existe e funciona)

### Núcleo de jogo (compartilhado offline/online)
- **Mundo:** 6 países jogáveis (Brasil, Inglaterra, Espanha, Itália, Portugal, Alemanha), cada um com **Série A e Série B**, montados a partir da base real 2026. Clubes sem elenco completo na base recebem jogadores **gerados deterministicamente**.
- **Jogadores (estilo Brasfoot):** 7 habilidades numéricas (goleiro, velocidade, passe, armação, desarme, finalização, técnica), 2 **características inatas** (ex.: Finalização, Velocidade, Cabeceio, Cruzamento…), **pé preferido** realista (~27% canhotos, ambidestro raríssimo), moral, energia, forma, potencial, contrato, valor de mercado, salário.
- **Motor de partida** minuto a minuto (setores defesa/meio/ataque + habilidades + características + tática + moral + energia). Construído como **stepper** (`createMatch` avança 1 minuto por vez) justamente para permitir o modo online e a partida ao vivo.
- **Temporada:** calendário com turno e returno das ligas A/B + copa nacional (mata-mata; 1ª fase empate classifica visitante, depois pênaltis).
- **Fim de temporada:** Bola de Ouro, artilheiro, **acesso e rebaixamento**, envelhecimento/declínio, aposentadorias com regeneração de jovens da base, patrocínio da nova temporada.
- **Finanças:** ingressos (público depende de moral da torcida, adversário, preço), patrocínio anual, salários por rodada, **ampliação de estádio**, gramado.
- **Mercado:** buscar jogadores, comprar (negociação com pedida e salário), vender com **preço definido pelo usuário** (IA sensível a preço), propostas da IA, jogadores livres, renovação, multa por dispensa.
- **Treino** semanal, evolução por potencial/idade, lesões, cartões, suspensões.

### Interface (offline)
- Barra superior (caixa, torcida, temporada, próximo compromisso, tema, som, **Avançar**), menu lateral com telas: Elenco, Escalação, Classificação, Clubes, Copa, Jogos, Transferências, Finanças, Notícias, Técnico, Opções.
- **Escalação por campo** (arrastar/clicar), com capitão e cobradores (falta, escanteio esq./dir.), energia visível, banco (11+7=18; excedentes “fora da lista” treinam mas não jogam).
- **Rodada ao vivo:** todos os jogos do campeonato correm ao mesmo tempo; clicar no **seu** jogo abre a **tela de gestão** (pausa o jogo) para trocar posição, substituir, mudar formação/tática, capitão/cobradores; clicar em **outro** jogo só mostra as estatísticas (sem pausar). Pênalti = você escolhe o batedor; lesão = você escolhe o substituto (se houver banco).
- **Som** sintetizado em tempo real (Web Audio, sem arquivos): torcida de fundo, rugido no gol, apito, vaias, aplausos; eventos menores silenciados por padrão; **controle de volume/mudo**.
- **Tema claro/escuro** persistente.

### Modo online (multiplayer com salas)
- Servidor `server.js` **sem dependências externas** (HTTP + Server-Sent Events). Salas com código, até 12 técnicos, chat, reconexão, persistência em disco por sala.
- **Paridade quase total com o offline**: mesmas telas (Elenco com coluna Pé, Escalação com lista lateral e destaque por posição, Classificação e Clubes de **todos os países**, Copa, **Finanças**, Transferências), som/volume.
- **Lobby:** dono escolhe país; cada um escolhe clube; botão **Iniciar** só libera quando todos derem **Pronto**.
- **Rodada:** começa quando **todos clicam em Pronto** e roda ao vivo sincronizada; **gerir o time pausa a rodada de todos** (decisão de projeto); intervalo aguarda os técnicos.
- **Transferências entre humanos:** proposta por jogador de outro técnico fica pendente para **ele decidir**; proposta a clube da IA é **respondida na próxima rodada** (ver abaixo).
- **Entrar no meio do jogo:** alguém com o código entra com o jogo em andamento, vê a **tela de escolher um clube livre**, e **enquanto não escolhe, a sala inteira congela**.

### Sistema de estrelas
- Craques (força ≥ 88) recebem **⭐ ao lado do nome** em todas as listas (offline e online); rendem +5% em campo; ganham/perdem a estrela conforme a força evolui.

---

## 4. Arquitetura e organização do código

Tudo é **JavaScript puro no navegador** (sem framework, sem build). O **mesmo motor** (`js/core/`) roda no navegador (carreira) e no Node (servidor online), o que garante regras idênticas.

```
Tecnico26/
├── index.html            # entrada do modo carreira (offline)
├── online.html           # entrada do modo online
├── server.js             # servidor de salas (HTTP + SSE), reusa js/core no Node
├── package.json          # start: node server.js
├── render.yaml           # deploy no Render (Blueprint)
├── css/style.css         # tema claro/escuro, todos os estilos
├── assets/crests/        # 200 escudos PNG
├── assets/sounds/        # sons antigos (não usados; som atual é sintetizado)
├── js/db/
│   ├── world-db-2026.js  # base real: clubes + jogadores (Transfermarkt + FC26) — ~3MB
│   └── world-leagues.js  # configuração das ligas (nomes, clubes A/B por país)
├── js/core/              # MOTOR (compartilhado navegador + Node)
│   ├── util.js           # RNG com semente, formatação, helpers
│   ├── names.js          # gerador de nomes por nacionalidade
│   ├── world.js          # constrói o mundo; valor de mercado (valueFor/computeValue); isStar
│   ├── competitions.js   # calendário, tabelas, round-robin, copa
│   ├── match.js          # motor de partida minuto a minuto (createMatch/simulate)
│   ├── finance.js        # ingressos, patrocínio, estádio, salários
│   ├── transfers.js      # avaliação/efetivação de propostas, valor justo
│   ├── game.js           # estado da CARREIRA offline (avançar, treino, fim de temporada, save/load)
│   └── room-game.js      # estado de uma SALA online (vários humanos no mesmo mundo)
└── js/ui/                # INTERFACE
    ├── app.js            # shell offline (barra, menu, navegação, tema)
    ├── screens.js        # telas do modo carreira
    ├── match-ui.js       # rodada ao vivo + tela de gestão (offline)
    ├── sounds.js         # som sintetizado (Web Audio)
    └── online.js         # cliente do modo online (lobby, telas, rodada ao vivo, gestão)
```

### Pontos importantes de design
- **`js/core/match.js` — `createMatch(home, away, opts)`**: cria uma partida controlável (`playMinute()`, `substitute`, `swapPositions`, `reformTeam`, `resolvePenalty`, `resolveInjury`, `result()`, `finishNow()`). `simulate()` é só `createMatch().finishNow()`. `opts.interactiveSide` faz pênaltis/lesões do time humano “pausarem” esperando decisão.
- **Valor de mercado realista:** o campo `value` da base **É o valor real (Transfermarkt)**. `valueFor(rating, age)` é uma fórmula exponencial calibrada; `computeValue(p)` **escala a partir da âncora real** (`_mv0/_mvR/_mvA`) em vez de recalcular do zero — foi assim que corrigimos valores “na casa dos bilhões”.
- **Online = servidor autoritativo.** O servidor roda o motor; os clientes recebem **snapshots** via SSE. Elenco completo só do país da sala; dos outros países, versão **leve** (`lightPlayer`) para caber (~2,1MB por snapshot).
- **Protocolo online:** ações via `POST /api/room/:code/action` (o campo do jogador-alvo numa proposta é **`targetId`**, pois `playerId` é reservado para autenticação); eventos em tempo real via SSE (`snapshot`, `roundStart`, `tick`, `roundPaused/Resumed`, `joinFreeze/joinDone`, etc.).
- **Propostas a clubes da IA são diferidas:** `submitBid` (offline) / `sentBids` (online) guardam a proposta; a resposta chega no `weeklyTick` (virada da rodada) como notícia — “gastar um dia de negociação”.

---

## 5. Como rodar e publicar

- **Carreira:** abrir `index.html` no navegador, ou dois cliques em `INICIAR-JOGO.bat` (precisa de Node) → `http://localhost:3026`.
- **Online local:** `INICIAR-ONLINE.bat` → `http://localhost:3026/online.html`; amigos na mesma rede usam o IP do PC.
- **Online na internet:** repositório `filipysilva/soccer-manager` no GitHub → Render (Blueprint lê `render.yaml`). Push = deploy automático. Guia completo em `COMO-JOGAR-ONLINE.md`. Limitação do plano grátis: servidor dorme após ~15 min sem uso e salas não sobrevivem a reinícios (bom para uma temporada com amigos, não para persistência longa).

Testes: cada mudança é validada com `node --check`, simulações **headless** do motor (temporadas inteiras via `node -e`) e verificação no navegador; o online é testado subindo o `server.js` numa porta de teste com um script que simula 2 jogadores por SSE.

---

## 6. Histórico do que foi feito (em ordem)

1. **Base (commit inicial):** reconstrução do zero — mundo, motor de partida, competições, finanças, mercado, carreira completa, e o **modo online com salas** já funcionando (lobby, rodada sincronizada, transferências entre humanos, chat).
2. **Partida interativa:** pênalti com escolha de batedor, lesão com substituição na hora, capitão e cobradores, **cansaço por idade**, **pé realista**, próximos compromissos mostrando a competição.
3. **Fase 1 — Experiência da partida (offline + paridade online):** fim do botão pausar (só pausa ao gerir), energia nas camisas, mudar formação no jogo, destaque por posição, confirmação de troca/substituição, capitão/cobradores ao vivo, **controle de som/volume**, lesão sem banco não trava, **limite de banco**; e a mesma coisa no online (com **pausa global** ao gerir, coluna Pé, aba Clubes com proposta, escalação com lista lateral, **lobby-ready**).
4. **Rebalanceamento da economia:** valores realistas ancorados no valor real (fim dos bilhões), caixa e patrocínio realistas por porte do clube.
5. **Paridade online — Finanças + multi-país:** aba Finanças no online; **tabelas e clubes de todos os países** no snapshot.
6. **Entrar no meio do jogo (online):** join com jogo em andamento, escolha de clube livre, congelamento da sala até escolher.
7. **Propostas à IA respondidas na próxima rodada** (offline e online).
8. **Sistema de estrelas:** ⭐ nos craques em todas as telas, +5% de rendimento.

---

## 7. Roadmap — o que falta (plano aprovado, 6 fases)

A Fase 1 está concluída. As demais são o roteiro combinado:

- **Fase 2 — Fluxo da rodada/UX:** ordem das ligas na rodada (a divisão do técnico em velocidade normal, as outras aceleradas), fim da rodada mostrando resultados de todas as divisões com humanos + navegador de resultados de qualquer liga, **tela de Calendário** completa, **chaveamento visual** da copa.
- **Fase 3 — Pênaltis e emoção:** tela de pênalti travada com **narração de tensão** (3–5 frases) antes da cobrança; **disputa de pênaltis** nos mata-matas (ordem dos batedores + suspense); tirar assistência de gol de pênalti e de falta; gols de falta mais raros/difíceis.
- **Fase 4 — Progressão e força:** **recalibrar as forças com dados reais da web** (decisão do dono); cansaço/moral influenciando mais o jogo; **curva de idade** completa (evolui até ~30, declina a partir de 32, aposenta 34–42, obrigatório aos 42, volta como jovem); **academia de juniores**; **sistema de estrelas completo** (evoluem mais rápido, produzem mais, valorizam salário/mercado ao longo dos anos — a base visual já existe).
- **Fase 5 — Rankings e recompensas:** ranking de artilheiros (liga/copa/temporada), assistências, notas; **recompensa em dinheiro** por artilharia/títulos e jogador destaque pedindo aumento; **ranking de técnicos** por títulos/colocações (IA com nomes famosos + humanos).
- **Fase 6 — Competições:** estaduais, **Libertadores/Champions**, Sul-Americana/Liga Europa, copas de outros países, **Mundial de Clubes**, **Copa do Mundo**; correção do fim de temporada e **2 janelas de transferência** (início e meio; a lógica de janela já existe em `transferWindowInfo`).

**Decisões de projeto já tomadas para as próximas fases:**
1. Recalibrar forças buscando **dados reais na web** (Fase 4).
2. No online, **pausar a rodada inteira** quando um técnico gerencia o time ou quando há pênalti.

---

## 8. Convenções e cuidados (para quem continuar)

- **Não voltar aos sons `.wav`** — o dono não gostou; o som atual é sintetizado em `js/ui/sounds.js`.
- **Manter offline e online com as mesmas funcionalidades** — é um pedido recorrente do dono. Sempre que mudar o offline (`screens.js`), espelhar no online (`online.js` + `server.js`/`room-game.js`).
- **Valores de mercado:** preservar a âncora real (`computeValue`), não recalcular do zero.
- **Protocolo online:** alvo de proposta = `targetId` (não `playerId`).
- **Cache do navegador:** ao testar mudanças de JS, forçar **Ctrl+F5** (o navegador cacheia os arquivos).
- **Saves antigos** (localStorage) migram automaticamente em `game.js load()` (pé, estrela); ao adicionar campos novos, incluir migração ali.
- **Deploy:** basta `git push` no `filipysilva/soccer-manager` que o Render republica.
