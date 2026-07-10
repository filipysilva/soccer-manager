"use strict";
/* Rodada ao vivo: todos os jogos do campeonato ao mesmo tempo, com painel do
   seu time sempre visível (táticas em um clique, substituições e trocas de posição),
   pênalti com escolha de batedor e lesão com substituição na hora. */
(function () {
  const U = window.TF.util;
  const UI = () => window.TF.ui;
  const G = () => window.TF.game;
  const M = () => window.TF.match;

  function esc(s) { return U.esc(s); }

  window.TF.ui.screens.match = function (el, params) {
    const { matches: entries, label } = params;
    const games = entries.map(e => ({
      entry: e,
      match: M().createMatch(e.home, e.away, {
        grass: e.grass,
        interactiveSide: e.isUser ? (e.isHome ? "h" : "a") : null
      }),
      shown: 0
    }));
    const userIdx = Math.max(0, games.findIndex(g => g.entry.isUser));
    const userGame = games[userIdx];
    const userTeam = userGame.entry.isHome ? userGame.entry.home : userGame.entry.away;
    const userSideKey = userGame.entry.isHome ? "h" : "a";

    let selectedIdx = userIdx;
    let timer = null;
    let speed = 220;
    let panelSelected = null; // jogador selecionado no painel do time

    el.innerHTML =
      '<div class="content" style="height:100vh;overflow-y:auto"><div class="round-screen">' +
        '<div class="round-head"><h2 style="margin:0;font-size:1.15rem">' + esc(label) + '</h2><div class="round-controls" id="controls"></div></div>' +
        '<div class="round-grid" id="grid"></div>' +
        '<div class="round-body"><div class="round-detail" id="detail"></div><div class="card my-panel" id="my-panel"></div></div>' +
      "</div></div>";

    const $grid = el.querySelector("#grid");
    const $controls = el.querySelector("#controls");
    const $detail = el.querySelector("#detail");
    const $panel = el.querySelector("#my-panel");

    // ---------- grade de placares ----------
    function buildGrid() {
      $grid.innerHTML = games.map((g, i) => {
        const e = g.entry;
        return '<div class="match-card' + (e.isUser ? " user" : "") + (i === selectedIdx ? " selected" : "") + '" data-i="' + i + '">' +
          '<div class="mc-side">' + UI().crestImg(e.home.club, 22) + '<span class="mc-name">' + esc(e.home.club.shortName) + "</span></div>" +
          '<div class="mc-mid"><span class="mc-score" data-score>0 x 0</span><span class="mc-min" data-min>0\'</span></div>' +
          '<div class="mc-side right"><span class="mc-name">' + esc(e.away.club.shortName) + "</span>" + UI().crestImg(e.away.club, 22) + "</div>" +
        "</div>";
      }).join("");
      $grid.querySelectorAll(".match-card").forEach(card => card.addEventListener("click", () => {
        selectedIdx = parseInt(card.dataset.i, 10);
        $grid.querySelectorAll(".match-card").forEach(c => c.classList.toggle("selected", c === card));
        buildDetail();
      }));
    }

    function updateGrid() {
      const cards = $grid.querySelectorAll(".match-card");
      games.forEach((g, i) => {
        const card = cards[i];
        card.querySelector("[data-score]").textContent = g.match.state.gh + " x " + g.match.state.ga;
        card.querySelector("[data-min]").textContent = g.match.finished ? "Fim" : g.match.phase === "halftime" ? "Int" : g.match.minute + "'";
        card.classList.toggle("done", g.match.finished);
      });
    }

    // ---------- detalhe do jogo selecionado ----------
    function buildDetail() {
      const g = games[selectedIdx];
      const e = g.entry;
      $detail.innerHTML =
        '<div class="scoreboard">' +
          '<div class="team">' + UI().crestImg(e.home.club, 40) + "<span>" + esc(e.home.club.name) + "</span></div>" +
          '<div><div class="score" id="d-score"></div><div class="minute" id="d-min"></div></div>' +
          '<div class="team right">' + UI().crestImg(e.away.club, 40) + "<span>" + esc(e.away.club.name) + "</span></div>" +
        "</div>" +
        '<div class="match-events" id="d-events" style="height:260px"></div>' +
        '<div class="match-stats" id="d-stats"></div>';
      const $ev = $detail.querySelector("#d-events");
      for (const ev of g.match.events) $ev.appendChild(evNode(ev));
      $ev.scrollTop = $ev.scrollHeight;
      updateDetail();
    }

    function evNode(ev) {
      const div = document.createElement("div");
      div.className = "ev " + ev.type;
      div.innerHTML = '<span class="min">' + ev.min + "'</span><span>" + esc(ev.text) + "</span>";
      return div;
    }

    function updateDetail() {
      const g = games[selectedIdx];
      $detail.querySelector("#d-score").textContent = g.match.state.gh + " x " + g.match.state.ga;
      $detail.querySelector("#d-min").textContent = g.match.finished ? "Fim de jogo" : g.match.phase === "halftime" ? "Intervalo" : g.match.minute + "'";
      const $ev = $detail.querySelector("#d-events");
      while ($ev.children.length < g.match.events.length) {
        $ev.appendChild(evNode(g.match.events[$ev.children.length]));
        $ev.scrollTop = $ev.scrollHeight;
      }
      const st = g.match.result().stats;
      $detail.querySelector("#d-stats").innerHTML =
        row(st.h.poss + "%", "Posse", st.a.poss + "%") +
        row(st.h.shots, "Finalizações", st.a.shots) +
        row(st.h.target, "No gol", st.a.target) +
        row(st.h.corners, "Escanteios", st.a.corners) +
        row(st.h.fouls, "Faltas", st.a.fouls);
      function row(a, n, b) { return '<div class="sh">' + a + '</div><div class="sname">' + n + '</div><div class="sa">' + b + "</div>"; }
    }

    // ---------- painel do meu time ----------
    function buildPanel() {
      const t = userTeam.tactics;
      const subsLeft = 5 - (userTeam.subsUsed || 0);
      const seg = (name, current, opts2) =>
        '<div class="seg-row"><span class="muted" style="min-width:70px;font-size:.78rem">' + name + "</span>" +
        opts2.map(([v, l]) => '<button class="btn small seg' + (current === v ? " primary" : "") + '" data-' + (name === "Estilo" ? "style" : "mark") + '="' + v + '">' + l + "</button>").join("") + "</div>";

      const xi = userTeam.lineup.filter(s => s.player);
      const capId = userTeam.captainId;
      $panel.innerHTML =
        "<h3 style='margin-top:0'>Meu time <span class='muted' style='text-transform:none'>· " + subsLeft + " substituições restantes</span></h3>" +
        seg("Estilo", t.style, [["equilibrado", "Equilibrado"], ["ataque", "Ataque"], ["retranca", "Retranca"]]) +
        seg("Marcação", t.marking, [["leve", "Leve"], ["pesada", "Pesada"], ["muito pesada", "M. pesada"]]) +
        '<div class="xi-list">' +
        xi.map(s => {
          const p = s.player;
          const sel = panelSelected === p.id;
          let row = '<div class="xi-row' + (sel ? " sel" : "") + '" data-xi="' + p.id + '">' +
            UI().posBadge(s.slotPos) + "<span class='xi-name'>" + (capId === p.id ? "© " : "") + esc(p.name.split(" ").slice(-1)[0]) + (p.pos !== s.slotPos ? " <span class='muted'>*</span>" : "") + "</span>" +
            '<span class="bar" style="width:44px"><i style="width:' + Math.round(p.energy) + "%;background:" + (p.energy > 60 ? "var(--green)" : p.energy > 35 ? "var(--yellow)" : "var(--red)") + '"></i></span>' +
            "</div>";
          if (sel) {
            const bench = userTeam.bench.filter(b => !b.injuryWeeks);
            row += '<div class="xi-actions">' +
              (subsLeft > 0 && bench.length ?
                "<div class='muted' style='font-size:.75rem;margin-bottom:3px'>⬆ Substituir por:</div>" +
                bench.map(b => '<button class="btn small" data-subin="' + b.id + '">' + esc(b.name.split(" ").slice(-1)[0]) + " (" + b.pos + " " + Math.round(b.rating) + ")</button>").join("") : "") +
              "<div class='muted' style='font-size:.75rem;margin:5px 0 3px'>⇄ Trocar posição com:</div>" +
              xi.filter(o => o.player.id !== p.id && o.slotPos !== "GOL" && s.slotPos !== "GOL").slice(0, 10)
                .map(o => '<button class="btn small" data-swap="' + o.player.id + '">' + esc(o.player.name.split(" ").slice(-1)[0]) + " (" + o.slotPos + ")</button>").join("") +
              "</div>";
          }
          return row;
        }).join("") +
        "</div>" +
        "<p class='muted' style='font-size:.72rem;margin-top:6px'>Clique num jogador para substituir ou trocar de posição. * = improvisado.</p>";

      $panel.querySelectorAll("[data-style]").forEach(b => b.addEventListener("click", () => {
        userTeam.tactics.style = b.dataset.style;
        buildPanel();
      }));
      $panel.querySelectorAll("[data-mark]").forEach(b => b.addEventListener("click", () => {
        userTeam.tactics.marking = b.dataset.mark;
        buildPanel();
      }));
      $panel.querySelectorAll("[data-xi]").forEach(r => r.addEventListener("click", () => {
        panelSelected = panelSelected === r.dataset.xi ? null : r.dataset.xi;
        buildPanel();
      }));
      $panel.querySelectorAll("[data-subin]").forEach(b => b.addEventListener("click", ev => {
        ev.stopPropagation();
        const r = userGame.match.substitute(userSideKey, panelSelected, b.dataset.subin);
        if (r.ok) { window.TF.sounds.play("sub"); panelSelected = null; syncAll(); }
        else UI().toast(r.reason);
      }));
      $panel.querySelectorAll("[data-swap]").forEach(b => b.addEventListener("click", ev => {
        ev.stopPropagation();
        const r = userGame.match.swapPositions(userSideKey, panelSelected, b.dataset.swap);
        if (r.ok) { panelSelected = null; syncAll(); }
        else UI().toast(r.reason);
      }));
    }

    // ---------- controles ----------
    function renderControls() {
      const allDone = games.every(g => g.match.finished);
      const userHalf = userGame.match.phase === "halftime";
      let html = "";
      if (allDone) {
        html = '<button class="btn primary" id="c-done">Continuar ▶</button>' +
          '<button class="btn" id="c-ratings">Notas</button>';
      } else if (userHalf && !timer) {
        html = '<button class="btn primary" id="c-2half">▶ Iniciar 2º tempo</button>' +
          '<button class="btn" id="c-skip">⏩ Simular restante</button>';
      } else {
        html = (timer ? '<button class="btn" id="c-pause">⏸ Pausar</button>' : '<button class="btn primary" id="c-resume">▶ Continuar</button>') +
          '<select id="c-speed">' +
            '<option value="220"' + (speed === 220 ? " selected" : "") + ">Normal</option>" +
            '<option value="110"' + (speed === 110 ? " selected" : "") + ">Rápida</option>" +
            '<option value="40"' + (speed === 40 ? " selected" : "") + ">Muito rápida</option>" +
          "</select>" +
          '<button class="btn" id="c-skip">⏩ Simular restante</button>';
      }
      $controls.innerHTML = html;
      bind("#c-skip", skipAll);
      bind("#c-pause", pause);
      bind("#c-resume", play);
      bind("#c-2half", () => { userGame.match.resumeSecondHalf(); window.TF.sounds.play("kickoff"); play(); });
      bind("#c-done", finishAndContinue);
      bind("#c-ratings", ratingsModal);
      const sp = $controls.querySelector("#c-speed");
      if (sp) sp.addEventListener("change", ev => { speed = parseInt(ev.target.value, 10); if (timer) { stopTimer(); startTimer(); } });
    }

    function bind(sel, fn) {
      const b = $controls.querySelector(sel);
      if (b) b.addEventListener("click", fn);
    }

    function startTimer() { timer = setInterval(tick, speed); }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function play() { stopTimer(); startTimer(); renderControls(); }
    function pause() { stopTimer(); renderControls(); }

    function syncAll() {
      playSounds();
      updateGrid();
      updateDetail();
      buildPanel();
    }

    function tick() {
      let userHitHalftime = false;
      for (const g of games) {
        if (g.match.finished) continue;
        if (g === userGame && g.match.phase === "halftime") continue;
        g.match.playMinute();
        if (g === userGame && g.match.phase === "halftime") userHitHalftime = true;
      }
      playSounds();
      updateGrid();
      updateDetail();

      // decisões do técnico: pênalti e lesão pausam o jogo
      if (userGame.match.pendingPenalty) {
        pause();
        penaltyModal();
        return;
      }
      if (userGame.match.pendingInjury) {
        pause();
        injuryModal();
        return;
      }

      const allDone = games.every(g => g.match.finished);
      if (userHitHalftime || allDone) {
        stopTimer();
        if (allDone) window.TF.sounds.stopAmbience();
        renderControls();
        buildPanel();
      }
    }

    function playSounds() {
      for (const g of games) {
        while (g.shown < g.match.events.length) {
          const ev = g.match.events[g.shown++];
          if (g === userGame) window.TF.sounds.play(ev.type);
          else if (ev.type === "goal") window.TF.sounds.play("goalOther");
        }
      }
    }

    function skipAll() {
      stopTimer();
      window.TF.sounds.stopAmbience();
      for (const g of games) { g.match.finishNow(); g.shown = g.match.events.length; }
      updateGrid();
      updateDetail();
      renderControls();
      buildPanel();
    }

    // ---------- decisões na hora ----------
    function penaltyModal() {
      const cands = userTeam.lineup.filter(s => s.player && s.slotPos !== "GOL")
        .sort((a, b) => b.player.skills.finishing - a.player.skills.finishing);
      UI().modal(
        "<h3>⚽ PÊNALTI! Quem vai bater?</h3>" +
        '<table class="data"><tbody>' +
        cands.map(s => {
          const p = s.player;
          return '<tr data-taker="' + p.id + '" style="cursor:pointer"><td>' + UI().posBadge(s.slotPos) + "</td><td><b>" + esc(p.name) + "</b>" +
            (p.traits.includes("Finalização") ? ' <span class="trait">Finalização</span>' : "") + "</td>" +
            "<td class='num'>Finalização " + Math.round(p.skills.finishing) + "</td><td class='num'>Energia " + Math.round(p.energy) + "%</td></tr>";
        }).join("") +
        "</tbody></table>",
        ov => {
          ov.addEventListener("click", e => e.stopPropagation());
          ov.querySelectorAll("[data-taker]").forEach(tr => tr.addEventListener("click", () => {
            userGame.match.resolvePenalty(tr.dataset.taker);
            ov.remove();
            syncAll();
            play();
          }));
        });
    }

    function injuryModal() {
      const pend = userGame.match.pendingInjury;
      const bench = userTeam.bench.filter(b => !b.injuryWeeks);
      const subsLeft = 5 - (userTeam.subsUsed || 0);
      UI().modal(
        "<h3>🚑 " + esc(pend.outName || "Jogador") + " se machucou!</h3>" +
        (subsLeft > 0 && bench.length ?
          "<p class='muted'>Escolha quem entra (" + subsLeft + " substituições restantes):</p>" +
          '<table class="data"><tbody>' +
          bench.map(p => '<tr data-in="' + p.id + '" style="cursor:pointer"><td>' + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td><td class='num'>" + UI().ratingBadge(p.rating) + "</td></tr>").join("") +
          "</tbody></table>"
          : "<p class='muted'>Sem substituições disponíveis.</p>") +
        '<div class="actions"><button class="btn danger" data-none>Jogar com um a menos</button></div>',
        ov => {
          ov.querySelectorAll("[data-in]").forEach(tr => tr.addEventListener("click", () => {
            userGame.match.resolveInjury(tr.dataset.in);
            window.TF.sounds.play("sub");
            ov.remove();
            syncAll();
            play();
          }));
          ov.querySelector("[data-none]").addEventListener("click", () => {
            userGame.match.resolveInjury(null);
            ov.remove();
            syncAll();
            play();
          });
        });
    }

    function ratingsModal() {
      const g = games[selectedIdx];
      function list(team) {
        return '<table class="data"><tbody>' + team.lineup.filter(s => s.player).map(s => {
          const p = s.player;
          return "<tr><td>" + UI().posBadge(s.slotPos) + "</td><td>" + esc(p.name) + (p.matchGoals ? " ⚽".repeat(Math.min(p.matchGoals, 4)) : "") + "</td><td class='num'><b>" + (p.lastNota != null ? p.lastNota.toFixed(1) : "—") + "</b></td></tr>";
        }).join("") + "</tbody></table>";
      }
      UI().modal(
        '<h3>Notas da partida</h3><div class="grid2"><div><h3 style="margin-top:0">' + esc(g.entry.home.club.name) + "</h3>" + list(g.entry.home) + "</div>" +
        '<div><h3 style="margin-top:0">' + esc(g.entry.away.club.name) + "</h3>" + list(g.entry.away) + "</div></div>" +
        '<div class="actions"><button class="btn" data-x>Fechar</button></div>',
        ov => ov.querySelector("[data-x]").addEventListener("click", () => ov.remove()));
    }

    function finishAndContinue() {
      window.TF.sounds.stopAmbience();
      const results = games.map(g => ({ fixture: g.entry.fixture, result: g.match.result() }));
      G().completeLiveRound(results);
      G().save(1);
      UI().goto("calendar");
      const r = userGame.match.result();
      const gf = userGame.entry.isHome ? r.gh : r.ga;
      const ga = userGame.entry.isHome ? r.ga : r.gh;
      UI().toast(gf > ga ? "Vitória! 🎉" : gf < ga ? "Derrota." : "Empate.");
    }

    // a partida começa imediatamente ao entrar na tela
    buildGrid();
    buildDetail();
    buildPanel();
    renderControls();
    updateGrid();
    window.TF.sounds.startAmbience();
    window.TF.sounds.play("kickoff");
    play();
  };
})();
