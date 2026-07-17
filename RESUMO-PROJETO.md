# Técnico 26 — Resumo completo do projeto (handoff)

> Documento para dar contexto a outra IA (ex.: ChatGPT) ou a um novo colaborador.
> Explica de onde partimos, o que o jogo é hoje, como está organizado e o que falta.
> Última atualização: julho/2026 (após o overhaul de 43 seções / 7 etapas + ajustes de mercado e ranking).

---

## 1. Visão geral

**Técnico 26** é um jogo de gerência de futebol (*football manager*) inspirado no **Brasfoot**, com interface web moderna, que roda **no navegador**. Tem dois modos:

- **Carreira (offline):** um jogador comanda um clube, joga temporadas, faz transferências, treina, etc. Salva no `localStorage` do navegador.
- **Online com salas (multiplayer):** um servidor Node hospeda **salas**; amigos entram com um **código de 5 letras**, cada um assume um clube do mesmo país e jogam a mesma temporada, com as rodadas rodando **ao vivo e sincronizadas** para todos.

O jogo está **publicado e jogável** em `https://tecnico26.onrender.com` (carreira em `/`, online em `/online.html`), com deploy automático a cada push no GitHub (`filipysilva/soccer-manager`).

**Objetivo do dono do projeto:** recriar “tudo o que o Brasfoot tem”, com visual moderno e forte foco no **modo online com salas**. O dono (Filipe) não é programador; conduz por feedback em português. **Regra de ouro:** offline e online devem ter as **mesmas funcionalidades**.

---

## 2. De onde partimos

- `Brasfoot22-23/` — instalação original do Brasfoot, usada só como **referência** (o manual em PDF foi extraído para entender as regras).
- `Tecnico de futebol online/` — tentativa anterior, descartada; dela reaproveitamos **apenas os dados**: base de jogadores 2026 (`world-db-2026.js`, derivada de Transfermarkt + atributos EA SPORTS FC 26), os **200 escudos** e os sons antigos (hoje não usados).

**Decisão inicial:** reconstruir do zero em `Tecnico26/`, com arquitetura pensada para o modelo Brasfoot e para o online desde o começo.

---

## 3. Estado atual (o que já existe e funciona)

### Núcleo de jogo (compartilhado offline/online)
- **Mundo:** 6 países jogáveis (Brasil, Inglaterra, Espanha, Itália, Portugal, Alemanha), cada um com **Série A e Série B**. Clubes sem elenco completo na base recebem jogadores gerados deterministicamente.
- **Jogadores (estilo Brasfoot):** 7 habilidades numéricas, características inatas, **pé preferido** realista (~27% canhotos), moral, energia, forma, potencial, contrato, valor de mercado, salário. **Craques (força ≥ 88)** ganham **⭐** e +5% em campo.
- **Motor de partida** minuto a minuto (setores defesa/meio/ataque + habilidades + características + tática + moral + energia). É um **stepper** (`createMatch` avança 1 minuto por vez) — base do modo ao vivo e do online.
- **Temporada:** turno e returno das ligas A/B + copa nacional (mata-mata). Fim de temporada com Bola de Ouro, artilheiro, acesso/rebaixamento, envelhecimento, aposentadorias com regeneração de jovens, patrocínio.
- **Finanças:** ingressos, patrocínio anual, salários por rodada, ampliação de estádio.
- **Mercado:** buscar/comprar/vender (preço definido pelo usuário, IA sensível a preço), propostas da IA, livres, renovação. **Craques não ficam todos à venda** (ver §3.4).

### 3.1. Sistema tático orientado a dados (`js/core/tactics.js`)
Cada tática vira **“alavancas” numéricas** que o motor lê para produzir efeitos **reais** (posse, setores de ataque, cruzamentos, contra-ataques, desgaste, faltas, vulnerabilidades). **Nenhuma opção é decorativa.** 15 formações. As **8 dimensões** (agrupadas na UI em *Estratégia / Sem a bola / Dinâmica*):

- **Foco ofensivo:** Equilibrado, Pelo meio, Pelas laterais, Contra-ataques.
- **Construção:** Troca de passes, Jogo misto, Ataque rápido, **Bola longa**.
- **Mentalidade:** muito defensiva → muito ofensiva (a “linha defensiva” é derivada disso).
- **Pressão:** baixa / média / alta.
- **Marcação:** **Por zona** (bloco mais sólido) ou **Homem a homem** (mais faltas/cartões, mais desgaste, mais espaço nas costas, mas **sufoca os criadores adversários**).
- **Ritmo, Laterais, Pontas.**

Foram **removidas** as antigas dimensões Cruzamentos, Largura e Linha defensiva (o tipo de cruzamento agora emerge da força aérea do elenco). A IA usa o mesmo sistema (perfis de técnico + reação a placar/expulsão/cansaço). `normalize()` **migra saves antigos** (esquerda/direita → Pelas laterais; bolas longas → Equilibrado + Bola longa; etc.).

### 3.2. Pênaltis e disputa de pênaltis (com tensão)
- **Pênalti durante o jogo:** quando há humano envolvido, abre uma **tela dedicada** — o técnico atacante **escolhe o batedor** (jogadores em campo), há **frases de suspense**, botão **Acelerar**, e a revelação mostra **Gol / Defesa / Trave / Pra fora**. **Sem assistência** em gol de pênalti. No online, isso **pausa a rodada inteira** enquanto acontece.
- **Disputa de pênaltis (§28):** empate em mata-mata é decidido por uma disputa **real, ponderada pela qualidade** dos batedores/goleiros (acabou a moeda). Melhor de 5 + morte súbita. Há **tela interativa lance a lance** (placar, marcadores, veredito), offline e online.

### 3.3. Interface (redesenhada — carreira e online)
Barra superior limpa (sem quebras, só a competição do usuário), **menu lateral agrupado** (Meu time / Competição / Gestão / Sala), e as telas:

- **Visão geral (Dashboard):** hero do próximo jogo, **próximos 10 jogos**, situação na tabela, finanças rápidas, notícias recentes. É a tela inicial.
- **Elenco / Escalação por campo** (capitão e cobradores, energia visível, banco 11+7=18, excedentes “fora da lista” treinam).
- **Classificação** (com zonas), **Clubes** de todos os países.
- **Copa:** **chaveamento visual** em colunas por fase (clube do usuário destacado, pênaltis, campeão).
- **Ranking de técnicos:** classifica os técnicos do país por prestígio, mostrando **J/V/E/D da temporada** e **troféus da carreira por tipo** (🏆 ligas · 🏅 copas · 🎖️ outros). Técnicos da IA têm nomes determinísticos; humanos aparecem marcados.
- **Calendário anual:** **Resultados** (com placar, disputa de pênaltis e badge **V/E/D** pela ótica do usuário) + **Próximos jogos** da temporada inteira.
- **Transferências / Finanças.**
- **Notícias como inbox** (ícone por tipo, data, filtros por categoria).
- **Partida ao vivo com abas:** **Lance a lance / Estatísticas / Escalações**. Estatísticas mostra Posse, Finalizações, No gol, Escanteios, Faltas.
- **Chat como drawer lateral** (online), com botão flutuante e badge de mensagens não lidas.
- **Responsividade** (barra compacta no mobile), **tema claro/escuro** persistente, **som sintetizado** (Web Audio; nunca voltar aos `.wav`).

### 3.4. Mercado de transferências realista
- **Valor de mercado** ancorado no valor real (Transfermarkt) via `computeValue` (nada de bilhões).
- **`TF.transfers.isSellable(player, club, seasonYear)`:** **não faz sentido todos os craques estarem à venda** — craques (⭐) de clubes fortes (rating ≥ 74) são **retidos**; só ~8% deterministicamente ficam disponíveis por temporada. Jogadores livres e não-craques sempre negociáveis; clubes de humanos são decididos pelo dono. A UI mostra **“Não à venda”** e o servidor/offerModal rejeitam a proposta.
- **Propostas a clubes da IA são diferidas:** a resposta chega na **virada da rodada** (“gastar um dia de negociação”).

### 3.5. Modo online (multiplayer com salas)
- Servidor `server.js` **sem dependências externas** (HTTP + Server-Sent Events). Salas com código, até 12 técnicos, chat, reconexão, persistência em disco por sala.
- **Paridade com o offline:** todas as telas acima existem no online (Visão geral, Elenco/Pé, Escalação, Classificação e Clubes de todos os países, Copa/chaveamento, Ranking, Calendário, Transferências, Finanças, Notícias inbox, partida com abas, chat drawer).
- **Lobby:** dono escolhe país; cada um escolhe clube; **Iniciar** só libera quando todos derem **Pronto**.
- **Pausa global da rodada (§10):** controlador **`pauseReasons`** (Sets por motivo: gestão / intervalo / pênalti), não um booleano. Gerir o time **pausa a rodada de todos** (vários podem gerir ao mesmo tempo, relógio congelado). **Intervalo** pausa e **espera o “Estou pronto” de todos os humanos, sem timeout**. **Pênalti/disputa** pausam tudo. **Reconexão** reconstrói a rodada em andamento (placares, eventos, minuto, estado de pausa).
- **Transferências entre humanos:** proposta por jogador de outro técnico fica pendente para **ele decidir**.
- **Entrar no meio do jogo:** quem entra com o jogo em andamento vê a tela de escolher um clube livre; **enquanto não escolhe, a sala congela**.

---

## 4. Arquitetura e organização do código

Tudo é **JavaScript puro no navegador** (sem framework, sem build). O **mesmo motor** (`js/core/`) roda no navegador (carreira) e no Node (servidor online), garantindo regras idênticas.

```
Tecnico26/
├── index.html            # entrada do modo carreira (offline)
├── online.html           # entrada do modo online (carrega util, names, tactics, match, competitions, finance, transfers, sounds, online)
├── server.js             # servidor de salas (HTTP + SSE), reusa js/core no Node
├── package.json          # start: node server.js  (porta via env PORT, padrão 3026)
├── render.yaml           # deploy no Render (Blueprint)
├── css/style.css         # tema claro/escuro + todos os estilos (dashboard, bracket, inbox, abas, chat drawer, pênalti, etc.)
├── assets/crests/        # 200 escudos PNG
├── js/db/
│   ├── world-db-2026.js  # base real: clubes + jogadores (Transfermarkt + FC26) — ~3MB
│   └── world-leagues.js  # configuração das ligas por país
├── js/core/              # MOTOR (compartilhado navegador + Node)
│   ├── util.js           # RNG com semente, formatação (formatSeasonLabel/RoundLabel/CompetitionName/MatchSubtitle/DateLabel/joinDot)
│   ├── names.js          # gerador de nomes por nacionalidade
│   ├── world.js          # constrói o mundo; valor de mercado; isStar
│   ├── competitions.js   # calendário, tabelas, round-robin, copa
│   ├── tactics.js        # sistema tático orientado a dados (8 dimensões → alavancas); IA; migração de saves
│   ├── match.js          # motor minuto a minuto; pênalti com fases; disputa de pênaltis (penaltyShootout); fase "shootout"
│   ├── finance.js        # ingressos, patrocínio, estádio, salários
│   ├── transfers.js      # avaliação/efetivação de propostas; askingPrice; isSellable
│   ├── game.js           # estado da CARREIRA offline (avançar, treino, fim de temporada, save/load, matchLog)
│   └── room-game.js      # estado de uma SALA online (vários humanos; snapshot/personal; matchLog; upcomingForHuman)
└── js/ui/
    ├── app.js            # shell offline (barra, menu agrupado, navegação, tema)
    ├── screens.js        # telas do modo carreira (dashboard, ranking, chaveamento, calendário, inbox, transferências, etc.)
    ├── match-ui.js       # rodada ao vivo + gestão + telas de pênalti/disputa (offline); abas da partida
    ├── sounds.js         # som sintetizado (Web Audio)
    └── online.js         # cliente do modo online (lobby, telas, rodada ao vivo, gestão, pênalti/disputa, chat drawer)
```

### Pontos importantes de design
- **`match.js — createMatch(home, away, opts)`**: partida controlável (`playMinute`, `substitute`, `swapPositions`, `reformTeam`, `setPenaltyTaker`/`finishPenalty`, `finishShootout`, `resolveInjury`, `result()`, `finishNow()`). `opts.interactiveSide` (offline) e `opts.humanSides` (online) fazem pênaltis com humano abrir a tela de tensão. `opts.knockout` faz um empate no fim do tempo normal entrar na **fase `shootout`** (disputa de pênaltis apresentada pela UI). `result().shootout` carrega o resultado da disputa. `TF.match.penaltyShootout(homeTeam, awayTeam, rng)` é o resolvedor independente.
- **Online = servidor autoritativo.** O servidor roda o motor; clientes recebem **snapshots** via SSE. Elenco completo só do país da sala; dos outros, versão leve.
- **Protocolo online (SSE):** `snapshot`, `roundStart`, `roundSnapshot` (reconexão), `tick` (agora com `stats` por jogo), `pauseState` (unificado: gestão/intervalo/pênalti + lista de quem falta no intervalo), `penalty`/`penaltyEnd`, `shootout`/`shootoutEnd`, `lobby`, `chat`, `joinFreeze/joinDone`. Ações via `POST /api/room/:code/action` (alvo de proposta = **`targetId`**; `penaltyTaker`/`penaltyAccelerate`/`shootoutAccelerate`/`ready2h`/`manageOpen`/`manageClose`).
- **`personal` do técnico (online):** inclui `upcoming` (próximos jogos), `matchLog` (histórico da temporada) e `news`, para as telas de Visão geral e Calendário. `serializeClub` envia `titles` e `nation` (para o Ranking).
- **Migração de saves:** offline em `game.js load()` (pé, estrela, `matchLog || []`) e `tactics.normalize()`; online em `room-game.hydrate()` (garante `matchLog`).

---

## 5. Como rodar e publicar

- **Carreira:** abrir `index.html`, ou `INICIAR-JOGO.bat` (precisa de Node) → `http://localhost:3026`.
- **Online local:** `INICIAR-ONLINE.bat` → `http://localhost:3026/online.html`; amigos na mesma rede usam o IP do PC.
- **Online na internet:** push no `filipysilva/soccer-manager` → Render (lê `render.yaml`) republica. Guia em `COMO-JOGAR-ONLINE.md`. Plano grátis: o servidor dorme após ~15 min sem uso e salas não sobrevivem a reinícios.

**Testes:** cada mudança é validada com `node --check`, simulações **headless** do motor (temporadas inteiras) e verificação no **navegador**; o online é testado subindo o `server.js` e dirigindo 1–2 clientes por SSE (ou criando uma sala real no navegador).

---

## 6. Status do overhaul (43 seções / 7 etapas) — CONCLUÍDO

Todas as 7 etapas do grande pedido foram entregues e estão no ar:

1. **Etapa 1 — Táticas + Marcação:** simplificação das táticas e a nova dimensão **Marcação** (zona/homem) com efeito real; migração de saves.
2. **Etapa 2 — Pausa global online:** controlador `pauseReasons`; intervalo esperando todos os humanos sem timeout; reconexão.
3. **Etapa 3 — Pênalti com tensão + disputa:** tela dedicada de pênalti, disputa de pênaltis por qualidade com tela lance a lance; sem assistência em gol de pênalti.
4. a **7. Etapas 4–7 — Redesign completo da UI:** design system + funções de formatação, barra superior, menu em grupos, **Dashboard**, **Perfil/Sala de troféus**, **Ranking de técnicos**, **Chaveamento**, **Calendário anual**, **Notícias inbox**, **abas na partida**, **chat drawer**, **responsividade** — tudo **nos dois modos** (carreira e online).

**Ajustes pós-feedback:** craques retidos no mercado (`isSellable`) e ranking de técnicos detalhado (J/V/E/D + troféus por tipo).

---

## 7. O que ainda pode evoluir (não bloqueante)

O overhaul está completo; o que resta são melhorias futuras / conteúdo novo:

- **Polimento visual fino** de escalação/tática, transferências (painel lateral), finanças.
- **Competições continentais e seleções:** estaduais, Libertadores/Champions, Sul-Americana/Liga Europa, Mundial de Clubes, **Copa do Mundo** (ainda não existem — hoje há liga A/B + copa nacional por país).
- **Progressão de elenco mais rica:** academia de juniores, curva de idade mais detalhada, moral influenciando mais.
- **Rankings de jogadores** (artilheiros, assistências) e recompensas por artilharia/títulos.
- **Persistência online robusta** (hoje é em disco por sala; ideal seria banco de dados).

---

## 8. Convenções e cuidados (para quem continuar)

- **Manter offline e online idênticos:** ao mudar o offline (`screens.js`/`match-ui.js`/`app.js`), espelhar no online (`online.js` + `server.js`/`room-game.js`). É pedido recorrente do dono.
- **Não voltar aos sons `.wav`** — o som atual é sintetizado em `js/ui/sounds.js`.
- **Nenhuma opção tática pode ser só visual** — tudo deve afetar o motor.
- **Valores de mercado:** preservar a âncora real (`computeValue`), não recalcular do zero.
- **Protocolo online:** alvo de proposta = `targetId` (não `playerId`).
- **Cache do navegador:** ao testar/ver mudanças de JS, forçar **Ctrl+Shift+R** (o navegador cacheia os arquivos — foi o motivo de o dono “não ver” telas já implementadas).
- **Saves antigos** migram automaticamente; ao adicionar campos, incluir a migração (`game.js load()`, `tactics.normalize()`, `room-game.hydrate()`).
- **Este RESUMO deve ser atualizado a cada mudança do projeto** (o dono usa para alimentar o ChatGPT).
- **Deploy:** `git push` no `filipysilva/soccer-manager` → Render republica.
