# Técnico 26 — Manager de Futebol

Jogo de técnico de futebol inspirado no Brasfoot, com interface moderna e **modo online com salas**.

## Como jogar

**Modo carreira (sozinho):** dê dois cliques em `INICIAR-JOGO.bat` (precisa do Node.js instalado). O jogo abre em `http://localhost:3026`. Também funciona abrindo `index.html` direto no navegador, sem servidor.

**Modo online (com amigos):** dê dois cliques em `INICIAR-ONLINE.bat` e siga o guia **[COMO-JOGAR-ONLINE.md](COMO-JOGAR-ONLINE.md)** — lá explica como jogar em rede local e como publicar de graça na internet (Render).

O modo carreira salva automaticamente a cada rodada, no próprio navegador. As salas online são salvas no servidor após cada rodada.

## Modo online com salas

- Crie uma sala e compartilhe o **código de 5 letras**; até 12 técnicos por sala
- Todos escolhem clubes do mesmo país (Série A ou B) e jogam a mesma temporada
- A rodada começa quando **todos clicam em Pronto** e roda ao vivo sincronizada para todos, com todos os jogos visíveis ao mesmo tempo
- Substituições e táticas no seu jogo (pausa no intervalo, com timeout de 45 s)
- Transferências entre técnicos: você faz a proposta e **o outro jogador humano decide** aceitar ou recusar; propostas para clubes da IA são decididas na hora
- Chat da sala, reconexão automática e host que controla país e início do jogo

## O que já tem (Fase 1)

- 6 países jogáveis (Brasil, Inglaterra, Espanha, Itália, Alemanha, Portugal), cada um com Série A e Série B
- Elencos reais da base 2026 (atributos derivados do FC 26) + escudos; clubes sem dados na base ganham elencos gerados
- Sistema Brasfoot: 7 habilidades (goleiro, velocidade, passe, armação, desarme, finalização, técnica) + 2 características inatas por jogador
- Campeonato nacional em turno e returno com acesso e rebaixamento
- Copa nacional (empate na 1ª fase classifica o visitante; depois, pênaltis)
- **Rodada ao vivo simultânea**: todos os jogos do seu campeonato correm ao mesmo tempo; clique em qualquer jogo para ver narração e estatísticas; no seu dá para substituir (até 5) e mudar tática
- Sons de estádio sintetizados em tempo real (multidão, explosão no gol, apito, vaias, aplausos) — sem arquivos de áudio
- **Janela de transferências** (início da temporada até a rodada 6 e meio da temporada, rodadas 20–25): proposta por **qualquer jogador de qualquer clube** — pela busca ou entrando no clube na tela Clubes — com negociação (o dono recusa, aceita ou faz contraproposta); jogadores livres podem ser contratados sempre
- Táticas: 6 formações, estilo (equilibrado / ataque total / retranca), marcação (leve / pesada / muito pesada)
- Escalação clicando no campo, com aviso de jogador improvisado
- Transferências: comprar (negociação com pedida e salário), vender, propostas da IA, jogadores livres
- Contratos, renovação, multa por dispensa
- Finanças: ingressos (público depende da torcida/adversário/preço), patrocínio anual, salários por rodada, ampliação de estádio
- Treino semanal (principais / secundárias / auxiliar decide) com evolução por potencial e idade
- Moral individual e da torcida, energia, forma, lesões, cartões e suspensões
- Fim de temporada: Bola de Ouro, artilheiro, acesso/rebaixamento, envelhecimento, aposentadorias com regeneração de jovens
- Ranking de pontos do técnico e sala de troféus
- Notícias do clube (propostas, contratos, finanças, títulos)
- Tema escuro e claro (botão ☀️/🌙 na barra superior, na tela inicial e em Opções; a escolha fica salva)

## Próximas fases planejadas

- **Fase 2:** campeonatos estaduais (Brasil), Libertadores/Champions, Sul-Americana/Liga Europa, Supercopa, academia de juniores com peneiras, empréstimos, amistosos
- **Fase 3:** seleções nacionais, Copa do Mundo e eliminatórias, convites de outros clubes/demissão, editor de times
- **Fase 4:** modo online com salas para jogar com amigos (servidor Node + deploy no Render)

## Estrutura

```
index.html          — entrada do jogo
dev-server.js       — servidor local simples
js/core/            — motor do jogo (mundo, partidas, competições, finanças, mercado, carreira)
js/ui/              — telas e partida ao vivo
js/db/              — base de dados 2026 (clubes, jogadores e ligas)
assets/crests/      — escudos    assets/sounds/ — sons da partida
```

O motor (`js/core`) não depende do navegador — é o mesmo código que vai rodar no servidor no modo online.
