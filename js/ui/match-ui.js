"use strict";
/* Rodada ao vivo estilo Brasfoot: todos os jogos do campeonato correm ao mesmo tempo.
   Clique em qualquer jogo para ver narração e estatísticas; no seu jogo é possível
   fazer substituições e mudar a tática. */
(function () {
  const U = window.TF.util;
  const UI = () => window.TF.ui;
  const G = () => window.TF.game;
  const M = () => window.TF.match;

  function esc(s) { return U.esc(s); }

  window.TF.ui.screens.match = function (el, params) {
    const { matches: entries, label } = params;
    // cria todas as partidas da rodada
    const games = entries.map(e => ({
      entry: e,
      match: M().createMatch(e.home, e.away, { grass: e.grass }),
      shown: 0 // eventos já exibidos/sonorizados
    }));
    const userIdx = Math.max(0, games.findIndex(g => g.entry.isUser));
    const userGame = games[userIdx];
    const userTeam = userGame.entry.isHome ? userGame.entry.home : userGame.entry.away;
    const userSideKey = userGame.entry.isHome ? "h" : "a";

    let selectedIdx = userIdx;
    let timer = null;
    let speed = 220;
    let started = false;

    el.innerHTML =
      '<div class="content" style="height:100vh;overflow-y:auto"><div class="round-screen">' +
        '<div class="round-head"><h2 style="margin:0;font-size:1.15rem">' + esc(label) + '</h2><div class="round-controls" id="controls"></div></div>' +
        '<div class="round-grid" id="grid"></div>' +
        '<div class="round-detail" id="detail"></div>' +
      "</div></div>";

    const $grid = el.querySelector("#grid");
    const $controls = el.querySelector("#controls");
    const $detail = el.querySelector("#detail");

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
        const st = g.match.finished ? "Fim" : g.match.phase === "halftime" ? "Int" : g.match.minute + "'";
        card.querySelector("[data-min]").textContent = st;
        card.classList.toggle("done", g.match.finished);
      });
    }

    // ---------- detalhe do jogo selecionado ----------
    function buildDetail() {
      const g = games[selectedIdx];
      const e = g.entry;
      $detail.innerHTML =
        '<div class="scoreboard" style="margin-top:14px">' +
          '<div class="team">' + UI().crestImg(e.home.club, 40) + "<span>" + esc(e.home.club.name) + "</span></div>" +
          '<div><div class="score" id="d-score"></div><div class="minute" id="d-min"></div></div>' +
          '<div class="team right">' + UI().crestImg(e.away.club, 40) + "<span>" + esc(e.away.club.name) + "</span></div>" +
        "</div>" +
        '<div class="match-events" id="d-events" style="height:240px"></div>' +
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

    let detailShown = 0;
    function updateDetail() {
      const g = games[selectedIdx];
      $detail.querySelector("#d-score").textContent = g.match.state.gh + " x " + g.match.state.ga;
      $detail.querySelector("#d-min").textContent = g.match.finished ? "Fim de jogo" : g.match.phase === "halftime" ? "Intervalo" : g.match.minute + "'";
      const $ev = $detail.querySelector("#d-events");
      // acrescenta eventos novos do jogo selecionado
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

    // ---------- controles ----------
    function renderControls() {
      const allDone = games.every(g => g.match.finished);
      const userHalf = userGame.match.phase === "halftime";
      let html = "";
      if (!started) {
        html = '<button class="btn primary" id="c-start">▶ Iniciar rodada</button>' +
          '<button class="btn" id="c-skip">⏩ Simular tudo</button>';
      } else if (allDone) {
        html = '<button class="btn primary" id="c-done">Continuar ▶</button>' +
          '<button class="btn" id="c-ratings">Notas</button>';
      } else if (userHalf && !timer) {
        html = '<button class="btn primary" id="c-2half">▶ Iniciar 2º tempo</button>' +
          '<button class="btn" id="c-subs">Substituições (' + (5 - (userTeam.subsUsed || 0)) + ")</button>" +
          '<button class="btn" id="c-tactics">Táticas</button>';
      } else {
        html = (timer ? '<button class="btn" id="c-pause">⏸ Pausar</button>' : '<button class="btn primary" id="c-resume">▶ Continuar</button>') +
          '<button class="btn" id="c-subs">Substituições (' + (5 - (userTeam.subsUsed || 0)) + ")</button>" +
          '<button class="btn" id="c-tactics">Táticas</button>' +
          '<select id="c-speed">' +
            '<option value="220"' + (speed === 220 ? " selected" : "") + ">Normal</option>" +
            '<option value="110"' + (speed === 110 ? " selected" : "") + ">Rápida</option>" +
            '<option value="40"' + (speed === 40 ? " selected" : "") + ">Muito rápida</option>" +
          "</select>" +
          '<button class="btn" id="c-skip">⏩ Simular restante</button>';
      }
      $controls.innerHTML = html;
      bind("#c-start", () => { started = true; window.TF.sounds.play("kickoff"); window.TF.sounds.startAmbience(); play(); });
      bind("#c-skip", skipAll);
      bind("#c-pause", pause);
      bind("#c-resume", play);
      bind("#c-2half", () => { userGame.match.resumeSecondHalf(); window.TF.sounds.play("kickoff"); play(); });
      bind("#c-subs", subsModal);
      bind("#c-tactics", tacticsModal);
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

    function tick() {
      let userHitHalftime = false;
      for (const g of games) {
        if (g.match.finished) continue;
        if (g === userGame && g.match.phase === "halftime") continue; // espera o técnico
        const wasHalf = g.match.phase === "halftime";
        g.match.playMinute();
        if (g === userGame && g.match.phase === "halftime") userHitHalftime = true;
      }
      playSounds();
      updateGrid();
      updateDetail();
      const allDone = games.every(g => g.match.finished);
      if (userHitHalftime || allDone) {
        stopTimer();
        if (allDone) window.TF.sounds.stopAmbience();
        renderControls();
      }
    }

    /* Sons: jogo do usuário com som completo; gols dos outros jogos com rugido distante. */
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
      started = true;
      stopTimer();
      window.TF.sounds.stopAmbience();
      for (const g of games) { g.match.finishNow(); g.shown = g.match.events.length; }
      updateGrid();
      updateDetail();
      renderControls();
    }

    // ---------- modais ----------
    function subsModal() {
      const starters = userTeam.lineup.filter(s => s.player);
      const bench = userTeam.bench;
      let outSel = null;
      UI().modal(
        "<h3>Substituições — restam " + (5 - (userTeam.subsUsed || 0)) + "</h3>" +
        "<h3 style='margin-top:8px'>Em campo (clique em quem sai)</h3>" +
        '<table class="data"><tbody>' +
        starters.map(s => '<tr data-out="' + s.player.id + '" style="cursor:pointer"><td>' + UI().posBadge(s.slotPos) + "</td><td>" + esc(s.player.name) + "</td><td class='num'>" + UI().ratingBadge(s.player.rating) + "</td><td>Energia " + Math.round(s.player.energy) + "%</td></tr>").join("") +
        "</tbody></table>" +
        "<h3>Banco (clique em quem entra)</h3>" +
        '<table class="data"><tbody>' +
        (bench.length ? bench.map(p => '<tr data-in="' + p.id + '" style="cursor:pointer"><td>' + UI().posBadge(p.pos) + "</td><td>" + esc(p.name) + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td></tr>").join("") : "<tr><td class='muted'>Banco vazio</td></tr>") +
        "</tbody></table>" +
        '<div class="actions"><button class="btn" data-x>Fechar</button></div>',
        overlay => {
          overlay.querySelector("[data-x]").addEventListener("click", () => overlay.remove());
          overlay.querySelectorAll("[data-out]").forEach(tr => tr.addEventListener("click", () => {
            overlay.querySelectorAll("[data-out]").forEach(t => t.style.background = "");
            tr.style.background = "#14324a";
            outSel = tr.dataset.out;
          }));
          overlay.querySelectorAll("[data-in]").forEach(tr => tr.addEventListener("click", () => {
            if (!outSel) { UI().toast("Primeiro escolha quem sai."); return; }
            const r = userGame.match.substitute(userSideKey, outSel, tr.dataset.in);
            if (r.ok) {
              window.TF.sounds.play("sub");
              overlay.remove();
              playSounds(); updateGrid(); updateDetail(); renderControls();
            } else UI().toast(r.reason);
          }));
        });
    }

    function tacticsModal() {
      const t = userTeam.tactics;
      UI().modal(
        "<h3>Táticas durante o jogo</h3>" +
        '<div class="row">' +
          '<label>Estilo: <select id="t-style">' +
            '<option value="equilibrado"' + (t.style === "equilibrado" ? " selected" : "") + ">Equilibrado</option>" +
            '<option value="ataque"' + (t.style === "ataque" ? " selected" : "") + ">Ataque total</option>" +
            '<option value="retranca"' + (t.style === "retranca" ? " selected" : "") + ">Retranca</option>" +
          "</select></label>" +
          '<label>Marcação: <select id="t-mark">' +
            '<option value="leve"' + (t.marking === "leve" ? " selected" : "") + ">Leve</option>" +
            '<option value="pesada"' + (t.marking === "pesada" ? " selected" : "") + ">Pesada</option>" +
            '<option value="muito pesada"' + (t.marking === "muito pesada" ? " selected" : "") + ">Muito pesada</option>" +
          "</select></label>" +
        "</div>" +
        '<div class="actions"><button class="btn primary" data-ok>Aplicar</button></div>',
        ov => {
          ov.querySelector("[data-ok]").addEventListener("click", () => {
            t.style = ov.querySelector("#t-style").value;
            t.marking = ov.querySelector("#t-mark").value;
            ov.remove();
            UI().toast("Táticas aplicadas.");
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

    buildGrid();
    buildDetail();
    renderControls();
    updateGrid();
  };
})();
