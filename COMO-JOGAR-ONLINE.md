# Como jogar o Técnico 26 online com seus amigos

O modo online funciona com **salas**: você cria uma sala, recebe um **código de 5 letras** e passa para seus amigos. Cada um escolhe um clube do mesmo país e todo mundo joga a mesma temporada, com as rodadas rodando ao vivo e sincronizadas para todos.

Existem 3 jeitos de jogar, do mais simples ao mais completo:

---

## Opção 1 — No seu computador (mesma casa / mesma rede Wi-Fi)

1. Dê dois cliques em `INICIAR-ONLINE.bat` (precisa do Node.js instalado — https://nodejs.org).
2. O jogo abre em `http://localhost:3026/online.html`. Crie a sala.
3. Descubra o endereço do seu PC na rede: abra o Prompt de Comando e digite `ipconfig`. Procure "Endereço IPv4", algo como `192.168.0.15`.
4. Seus amigos (na mesma rede Wi-Fi) abrem no navegador: `http://192.168.0.15:3026/online.html`, digitam o código da sala e pronto.

> Se não conectar, o Firewall do Windows pode estar bloqueando: na primeira vez que rodar, o Windows pergunta se permite o Node.js na rede — clique em **Permitir**.

---

## Opção 2 — Na internet de graça (Render) — para jogar com amigos em qualquer lugar

Você vai colocar o jogo num servidor gratuito. Faz uma vez só; depois é só compartilhar o link.

### Passo A — Subir o código para o GitHub

1. Crie uma conta em https://github.com (se não tiver).
2. Clique em **New repository**, dê um nome (ex.: `tecnico26`), deixe **Public**, crie.
3. Na página do repositório, clique em **uploading an existing file** e arraste **todo o conteúdo da pasta `Tecnico26`** (os arquivos e as pastas `js`, `css`, `assets` — não a pasta `Tecnico26` em si, e sim o que tem dentro dela).
   - Importante: `server.js`, `package.json` e `render.yaml` precisam ficar na **raiz** do repositório.
4. Clique em **Commit changes** e espere terminar de enviar (os escudos são muitos arquivos, pode demorar alguns minutos).

### Passo B — Publicar no Render

1. Crie uma conta em https://render.com (pode entrar com a conta do GitHub).
2. Clique em **New +** → **Blueprint**.
3. Conecte sua conta do GitHub e escolha o repositório `tecnico26`.
4. O Render lê o arquivo `render.yaml` sozinho. Clique em **Deploy Blueprint** e aguarde (~2 min).
5. Quando aparecer "Live", o seu jogo está no ar num endereço tipo:
   `https://tecnico26.onrender.com`
6. Mande para os amigos: `https://tecnico26.onrender.com/online.html` — cada um entra, digita o código da sala e joga.

### Avisos do plano gratuito do Render

- O servidor **dorme após ~15 min sem uso**. A primeira pessoa a abrir o link espera ~1 min ele acordar.
- Se o servidor reiniciar, as salas em memória se perdem (o jogo salva a sala em disco após cada rodada, mas o disco gratuito do Render também é apagado em reinícios/deploys). Ou seja: **ótimo para jogar uma temporada com amigos numa sentada ou em poucos dias; não conte com a sala viva para sempre.** Persistência de verdade (banco de dados) fica para uma próxima fase.

---

## Opção 3 — Túnel rápido sem publicar nada (avançado)

Se você só quer jogar hoje à noite sem criar contas: rode `INICIAR-ONLINE.bat` e, em outro terminal, use um túnel como o do Cloudflare:

```
cloudflared tunnel --url http://localhost:3026
```

Ele gera um link `https://...trycloudflare.com` temporário que seus amigos acessam de qualquer lugar enquanto o seu PC estiver ligado.

---

## Como funciona a sala

- **Criar/entrar**: um jogador cria a sala e vira o dono (👑). Os outros entram com o código. Até 12 técnicos por sala.
- **Lobby**: o dono escolhe o país; cada técnico escolhe um clube (Série A ou B). O dono clica em **Iniciar jogo**.
- **Rodada**: cada um ajusta escalação, táticas e mercado no seu tempo. Quando **todos clicam em "Pronto"**, a rodada começa ao vivo para todo mundo, com todos os jogos correndo juntos — dá para clicar em qualquer jogo e assistir.
- **Intervalo**: o seu jogo pausa no intervalo para substituições e mudança de tática. O 2º tempo começa quando você marca "Pronto" (ou sozinho após 45 segundos).
- **Transferências**: proposta por jogador da IA, a IA decide na hora. Proposta por jogador de **outro técnico humano**, ele recebe a proposta e decide aceitar ou recusar. Janela de negócios: até a rodada 6 e entre as rodadas 20–25.
- **Reconexão**: caiu a internet? Entre de novo com o mesmo código e o mesmo nome no mesmo navegador — você volta para o seu clube.
