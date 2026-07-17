"use strict";
/* Rodada ao vivo: todos os jogos do campeonato ao mesmo tempo.
   - A partida corre sozinha. Clicar no SEU jogo abre "Gerir meu time" (pausa);
     "Pronto" despausa. Não há botão de pausar/continuar avulso.
   - Clicar em outro jogo só mostra as estatísticas dele, sem pausar.
   - Gestão: energia nas camisas, trocar formação, trocar posição/substituir (com
     confirmação), destaque por posição, mudar capitão e cobradores.
   - Pênalti: você escolhe o batedor. Lesão: escolhe o substituto (só se houver banco). */
(function () {
  const U = window.TF.util;
  const UI = () => window.TF.ui;
  const G = () => window.TF.game;
  const M = () => window.TF.match;
  const S = () => window.TF.sounds;

  function esc(s) { return U.esc(s); }
  function energyColor(e) { return e > 60 ? "var(--green)" : e > 35 ? "var(--yellow)" : "var(--red)"; }

  window.TF.ui.screens.match = function (el, params) {
    const { matches: entries, label } = params;
    const games = entries.map(e => ({
      entry: e,
      match: M().createMatch(e.home, e.away, {
        grass: e.grass,
        interactiveSide: e.isUser ? (e.isHome ? "h" : "a") : null,
        knockout: !!e.knockout // §28 mata-mata: empate vai para os pênaltis
      }),
      shown: 0
    }));
    const userIdx = Math.max(0, games.findIndex(g => g.entry.isUser));
    const userGame = games[userIdx];
    const userTeam = userGame.entry.isHome ? userGame.entry.home : userGame.entry.away;
    const userSideKey = userGame.entry.isHome ? "h" : "a";
    let formationName = (G().state.tactics && G().state.tactics.formationName) || "4-4-2";

    let selectedIdx = userIdx;
    let timer = null;
    let speed = 220;
    let manageOverlay = null;
    let manageSel = null;
    let detailTab = "narracao"; // narracao | stats | lineups

    el.innerHTML =
      '<div class="content" style="height:100vh;overflow-y:auto"><div class="round-screen">' +
        '<div class="round-head"><h2 style="margin:0;font-size:1.15rem">' + esc(label) + '</h2><div class="round-controls" id="controls"></div></div>' +
        '<div class="round-grid" id="grid"></div>' +
        '<div class="round-detail" id="detail"></div>' +
      "</div></div>";

    const $grid = el.querySelector("#grid");
    const $controls = el.querySelector("#controls");
    const $detail = el.querySelector("#detail");

    // ---------- controle de som (reutilizável) ----------
    function soundHtml() {
      const s = S();
      return '<span class="sound-ctl">' +
        '<button class="btn" id="c-mute" title="Som">' + (s.muted ? "🔇" : "🔊") + "</button>" +
        '<input type="range" id="c-vol" min="0" max="100" value="' + Math.round(s.volume * 100) + '" title="Volume">' +
        '</span>';
    }
    function bindSound(root) {
      const mute = root.querySelector("#c-mute");
      if (mute) mute.addEventListener("click", () => { S().toggleMute(); renderControls(); });
      const vol = root.querySelector("#c-vol");
      if (vol) vol.addEventListener("input", e => { S().setVolume(parseInt(e.target.value, 10) / 100); if (S().muted && parseInt(e.target.value, 10) > 0) { S().setMuted(false); } });
    }

    // ---------- grade de placares ----------
    function buildGrid() {
      $grid.innerHTML = games.map((g, i) => {
        const e = g.entry;
        return '<div class="match-card' + (e.isUser ? " user" : "") + (i === selectedIdx ? " selected" : "") + '" data-i="' + i + '">' +
          (e.isUser ? '<div class="mc-tag">⚙️ seu jogo — clique para gerir</div>' : "") +
          '<div class="mc-row">' +
          '<div class="mc-side">' + UI().crestImg(e.home.club, 22) + '<span class="mc-name">' + esc(e.home.club.shortName) + "</span></div>" +
          '<div class="mc-mid"><span class="mc-score" data-score>0 x 0</span><span class="mc-min" data-min>0\'</span></div>' +
          '<div class="mc-side right"><span class="mc-name">' + esc(e.away.club.shortName) + "</span>" + UI().crestImg(e.away.club, 22) + "</div>" +
          "</div></div>";
      }).join("");
      $grid.querySelectorAll(".match-card").forEach(card => card.addEventListener("click", () => {
        const i = parseInt(card.dataset.i, 10);
        if (i === userIdx && !userGame.match.finished) { openManagement(); return; } // seu card ao vivo = gerir
        selectGame(i);
      }));
    }

    // §12 seleciona uma partida para VER o detalhe (sem abrir a gestão), preservando a aba
    function selectGame(i) {
      selectedIdx = i;
      $grid.querySelectorAll(".match-card").forEach((c, idx) => c.classList.toggle("selected", idx === i));
      buildDetail();
      renderControls();
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

    // ---------- detalhe do jogo selecionado (só leitura) com abas ----------
    function buildDetail() {
      const g = games[selectedIdx];
      const e = g.entry;
      const tab = (id, label) => '<button class="mtab' + (detailTab === id ? " active" : "") + '" data-mtab="' + id + '">' + label + "</button>";
      $detail.innerHTML =
        '<div class="scoreboard">' +
          '<div class="team">' + UI().crestImg(e.home.club, 40) + "<span>" + esc(e.home.club.name) + "</span></div>" +
          '<div><div class="score" id="d-score"></div><div class="minute" id="d-min"></div></div>' +
          '<div class="team right">' + UI().crestImg(e.away.club, 40) + "<span>" + esc(e.away.club.name) + "</span></div>" +
        "</div>" +
        (e.isUser ? '<div class="watch-hint">👁️ Você está assistindo ao seu jogo. Clique no seu card acima (ou em <b>Gerir meu time</b>) para pausar e mexer no time.</div>' : "") +
        '<div class="mtabs">' + tab("narracao", "Lance a lance") + tab("stats", "Estatísticas") + tab("lineups", "Escalações") + "</div>" +
        '<div class="mpane" id="d-pane"></div>';
      $detail.querySelectorAll("[data-mtab]").forEach(b => b.addEventListener("click", () => { detailTab = b.dataset.mtab; buildDetail(); }));
      renderDetailPane();
      updateDetail();
    }

    function renderDetailPane() {
      const g = games[selectedIdx];
      const pane = $detail.querySelector("#d-pane");
      if (!pane) return;
      if (detailTab === "narracao") {
        pane.innerHTML = '<div class="match-events" id="d-events" style="height:300px"></div>';
        const $ev = pane.querySelector("#d-events");
        for (const ev of g.match.events) $ev.appendChild(evNode(ev));
        $ev.scrollTop = $ev.scrollHeight;
      } else if (detailTab === "stats") {
        pane.innerHTML = '<div class="match-stats" id="d-stats"></div>';
      } else {
        pane.innerHTML = '<div class="lineups-grid">' + lineupCol(g.entry.home) + lineupCol(g.entry.away) + "</div>";
      }
    }

    function lineupCol(team) {
      const rows = team.lineup.filter(s => s.player).map(s => {
        const p = s.player;
        return '<div class="lu-row"><span class="lu-pos ' + "pos-" + s.slotPos + '">' + s.slotPos + '</span><span class="lu-name">' + esc(p.name) +
          (team.captainId === p.id ? ' <span class="cap">C</span>' : "") + "</span>" +
          '<span class="lu-en" style="color:' + energyColor(p.energy) + '">' + Math.round(p.energy) + "%</span></div>";
      }).join("");
      return '<div class="lu-col"><div class="lu-club">' + UI().crestImg(team.club, 18) + esc(team.club.shortName || team.club.name) + "</div>" + rows + "</div>";
    }

    function evNode(ev) {
      const div = document.createElement("div");
      div.className = "ev " + ev.type;
      div.innerHTML = '<span class="min">' + ev.min + "'</span><span>" + esc(ev.text) + "</span>";
      return div;
    }

    function updateDetail() {
      const g = games[selectedIdx];
      const $score = $detail.querySelector("#d-score");
      if ($score) $score.textContent = g.match.state.gh + " x " + g.match.state.ga;
      const $min = $detail.querySelector("#d-min");
      if ($min) $min.textContent = g.match.finished ? "Fim de jogo" : g.match.phase === "halftime" ? "Intervalo" : g.match.phase === "shootout" ? "Pênaltis" : g.match.minute + "'";
      if (detailTab === "narracao") {
        const $ev = $detail.querySelector("#d-events");
        if ($ev) while ($ev.children.length < g.match.events.length) {
          $ev.appendChild(evNode(g.match.events[$ev.children.length]));
          $ev.scrollTop = $ev.scrollHeight;
        }
      } else if (detailTab === "stats") {
        const $st = $detail.querySelector("#d-stats");
        if ($st) {
          const st = g.match.result().stats;
          const row = (a, n, b) => '<div class="sh">' + a + '</div><div class="sname">' + n + '</div><div class="sa">' + b + "</div>";
          $st.innerHTML =
            row(st.h.poss + "%", "Posse", st.a.poss + "%") +
            row(st.h.shots, "Finalizações", st.a.shots) +
            row(st.h.target, "No gol", st.a.target) +
            row(st.h.corners, "Escanteios", st.a.corners) +
            row(st.h.fouls, "Faltas", st.a.fouls);
        }
      }
    }

    // ---------- tela de gestão (pausa o jogo) ----------
    function openManagement() {
      if (manageOverlay || userGame.match.finished) return;
      if (userGame.match.penalty || userGame.match.pendingInjury) return; // resolva a decisão primeiro
      pause();
      manageSel = null;
      manageOverlay = document.createElement("div");
      manageOverlay.className = "modal-overlay manage-overlay";
      manageOverlay.innerHTML =
        '<div class="modal manage-modal">' +
          '<div class="manage-head">' +
            "<h3 style='margin:0'>Gerir meu time <span class='muted' id='m-clock'></span></h3>" +
            '<button class="btn primary" id="m-ready">✔ Pronto — voltar ao jogo</button>' +
          "</div>" +
          '<div class="manage-tactics" id="m-tactics"></div>' +
          '<div class="manage-grid">' +
            '<div class="pitch" id="m-pitch"><div class="center-line"></div><div class="center-circle"></div></div>' +
            '<div id="m-side"></div>' +
          "</div>" +
          "<p class='muted' style='font-size:.78rem;margin-top:6px'>Clique num jogador em campo para selecioná-lo. Clique em <b>outro jogador do campo</b> para trocar as posições, ou num jogador do <b>banco</b> para substituir. * = improvisado.</p>" +
        "</div>";
      document.body.appendChild(manageOverlay);
      manageOverlay.addEventListener("click", e => { if (e.target === manageOverlay) closeManagement(); });
      manageOverlay.querySelector("#m-ready").addEventListener("click", closeManagement);
      renderManageTactics();
      renderManagePitch();
      renderManageSide();
      updateManageClock();
    }

    function closeManagement() {
      if (!manageOverlay) return;
      manageOverlay.remove();
      manageOverlay = null;
      manageSel = null;
      if (userGame.match.finished) { renderControls(); return; }
      if (userGame.match.phase === "halftime") { userGame.match.resumeSecondHalf(); S().play("kickoff"); }
      selectedIdx = userIdx;
      buildDetail();
      play();
    }

    function updateManageClock() {
      if (!manageOverlay) return;
      const c = manageOverlay.querySelector("#m-clock");
      const subsLeft = 5 - (userTeam.subsUsed || 0);
      c.textContent = "· " + (userGame.match.phase === "halftime" ? "Intervalo" : userGame.match.minute + "'") +
        " · placar " + userGame.match.state.gh + "x" + userGame.match.state.ga + " · " + subsLeft + " substituições restantes";
    }

    function onFieldPlayers() { return userTeam.lineup.map(s => s.player).filter(Boolean); }

    function renderManageTactics() {
      const box = manageOverlay.querySelector("#m-tactics");
      const players = onFieldPlayers();
      const sp = userTeam.setPieces || {};
      const opts = (sel, allowGk) => players.filter(p => allowGk || p.pos !== "GOL")
        .map(p => '<option value="' + p.id + '"' + (p.id === sel ? " selected" : "") + ">" + esc(p.name) + " (" + p.pos + ")</option>").join("");
      box.innerHTML =
        '<div class="row" style="align-items:flex-end;gap:6px">' +
          '<label class="tac-sel"><span class="muted">Formação</span><select id="m-form">' + window.TF.tactics.FORMATION_NAMES.map(f => "<option" + (f === formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
          UI().tacticsSelects(userTeam.tactics) +
        "</div>" +
        '<div id="m-tac-warn" style="margin-top:6px"></div>' +
        '<div class="set-pieces"><div class="sp-item"><span>👑 Capitão</span><select data-sp="captain">' + opts(userTeam.captainId, true) + "</select></div>" +
          '<div class="sp-item"><span>🎯 Faltas</span><select data-sp="freeKick">' + opts(sp.freeKick) + "</select></div>" +
          '<div class="sp-item"><span>◀ Esc. esq.</span><select data-sp="cornerLeft">' + opts(sp.cornerLeft) + "</select></div>" +
          '<div class="sp-item"><span>▶ Esc. dir.</span><select data-sp="cornerRight">' + opts(sp.cornerRight) + "</select></div></div>";
      box.querySelector("#m-tac-warn").innerHTML = UI().tacticWarningsHtml(userTeam);

      box.querySelector("#m-form").addEventListener("change", e => {
        formationName = e.target.value;
        userTeam.tactics.formationName = formationName;
        M().reformTeam(userTeam, formationName);
        if (G().state.tactics) G().state.tactics.formationName = formationName;
        manageSel = null;
        renderManageTactics(); renderManagePitch(); renderManageSide();
      });
      box.querySelectorAll("[data-tac]").forEach(b => b.addEventListener("change", () => {
        userTeam.tactics[b.dataset.tac] = b.value;
        if (G().state.tactics) G().state.tactics[b.dataset.tac] = b.value; // persiste p/ próxima partida
        box.querySelector("#m-tac-warn").innerHTML = UI().tacticWarningsHtml(userTeam);
      }));
      box.querySelectorAll("[data-sp]").forEach(sel => sel.addEventListener("change", e => {
        const key = e.target.dataset.sp;
        if (key === "captain") userTeam.captainId = e.target.value;
        else { userTeam.setPieces = userTeam.setPieces || {}; userTeam.setPieces[key] = e.target.value; }
        if (G().state.setPieces) G().state.setPieces[key] = e.target.value;
        renderManagePitch();
      }));
    }

    function renderManagePitch() {
      const pitch = manageOverlay.querySelector("#m-pitch");
      pitch.querySelectorAll(".shirt").forEach(s => s.remove());
      const coords = M().FORMATION_COORDS[formationName] || M().FORMATION_COORDS["4-4-2"];
      const capId = userTeam.captainId;
      userTeam.lineup.forEach((slot, i) => {
        const p = slot.player;
        const [x, y] = coords[i] || [50, 50];
        const div = document.createElement("div");
        const sel = p && manageSel === p.id;
        div.className = "shirt" + (p ? "" : " empty") + (slot.slotPos === "GOL" ? " gk" : "") + (sel ? " selected" : "");
        div.style.left = x + "%";
        div.style.top = (100 - y) + "%";
        div.innerHTML =
          '<div class="jersey">' + (p ? Math.round(p.rating) : slot.slotPos) + "</div>" +
          (p ? '<div class="shirt-energy"><i style="width:' + Math.round(p.energy) + "%;background:" + energyColor(p.energy) + '"></i></div>' : "") +
          '<div class="pname' + (p && p.pos !== slot.slotPos ? " improv" : "") + '">' +
          (p ? (capId === p.id ? "© " : "") + esc(p.name.split(" ").slice(-1)[0]) : slot.slotPos) + "</div>";
        div.addEventListener("click", () => onPitchClick(slot));
        pitch.appendChild(div);
      });
    }

    function onPitchClick(slot) {
      if (!slot.player) return;
      const id = slot.player.id;
      if (manageSel === null || manageSel === id) {
        manageSel = manageSel === id ? null : id;
        renderManagePitch();
        renderManageSide();
        return;
      }
      // trocar posições — confirmar
      const a = userTeam.lineup.find(s => s.player && s.player.id === manageSel);
      const b = slot;
      confirmModal("Trocar de posição: <b>" + esc(a.player.name) + "</b> (" + a.slotPos + ") ⇄ <b>" + esc(b.player.name) + "</b> (" + b.slotPos + ")?", () => {
        const r = userGame.match.swapPositions(userSideKey, manageSel, id);
        if (!r.ok) UI().toast(r.reason);
        manageSel = null;
        renderManagePitch();
        renderManageSide();
      }, () => { manageSel = null; renderManagePitch(); renderManageSide(); });
    }

    function renderManageSide() {
      const side = manageOverlay.querySelector("#m-side");
      const subsLeft = 5 - (userTeam.subsUsed || 0);
      const bench = userTeam.bench.filter(b => !b.injuryWeeks);
      const selPlayer = manageSel ? onFieldPlayers().find(p => p && p.id === manageSel) : null;

      let html = "";
      if (selPlayer) {
        html += "<div class='card mb0' style='padding:12px'>" +
          "<h3 style='margin:0 0 6px'>" + esc(selPlayer.name) + " " + UI().ratingBadge(selPlayer.rating) + "</h3>" +
          "<p class='muted' style='font-size:.8rem;margin-bottom:8px'>Energia " + Math.round(selPlayer.energy) + "% · clique em outro jogador do campo para trocar de posição.</p>" +
          "<div class='muted' style='font-size:.78rem;margin-bottom:4px'>⬆ Substituir por (banco) — <span class='text-green'>sugeridos da posição em destaque</span>:</div>";
        if (subsLeft <= 0) html += "<p class='muted' style='font-size:.8rem'>Sem substituições restantes.</p>";
        else if (!bench.length) html += "<p class='muted' style='font-size:.8rem'>Banco vazio.</p>";
        else html += bench.map(b =>
          '<button class="btn small bench-btn' + (b.pos === selPlayer.pos ? " sug" : "") + '" data-subin="' + b.id + '">' + UI().posBadge(b.pos) + " " + esc(b.name.split(" ").slice(-1)[0]) + " " + Math.round(b.rating) + " · " + Math.round(b.energy) + "%</button>").join("");
        html += "</div>";
      } else {
        html = "<div class='card mb0' style='padding:12px'><h3 style='margin:0 0 6px'>Banco de reservas</h3>" +
          (bench.length ? '<table class="data"><tbody>' + bench.map(b =>
            "<tr><td>" + UI().posBadge(b.pos) + "</td><td>" + esc(b.name) + "</td><td class='num'>" + UI().ratingBadge(b.rating) + "</td><td><span class='bar' style='width:44px'><i style='width:" + Math.round(b.energy) + "%;background:" + energyColor(b.energy) + "'></i></span></td></tr>").join("") + "</tbody></table>"
            : "<p class='muted'>Banco vazio.</p>") +
          "<p class='muted' style='font-size:.78rem;margin-top:8px'>Selecione um jogador em campo para substituí-lo ou trocá-lo de posição.</p></div>";
      }
      side.innerHTML = html;
      side.querySelectorAll("[data-subin]").forEach(b => b.addEventListener("click", () => {
        const inP = userTeam.bench.find(x => x.id === b.dataset.subin);
        confirmModal("Substituir <b>" + esc(selPlayer.name) + "</b> por <b>" + esc(inP ? inP.name : "?") + "</b>?", () => {
          const r = userGame.match.substitute(userSideKey, manageSel, b.dataset.subin);
          if (r.ok) { S().play("sub"); manageSel = null; renderManagePitch(); renderManageSide(); updateManageClock(); updateGrid(); }
          else UI().toast(r.reason);
        });
      }));
    }

    function confirmModal(html, onYes, onNo) {
      UI().modal(
        "<h3>Confirmar alteração</h3><p>" + html + "</p>" +
        '<div class="actions"><button class="btn" data-no>Cancelar</button><button class="btn primary" data-yes>Confirmar</button></div>',
        ov => {
          ov.addEventListener("click", e => e.stopPropagation());
          ov.querySelector("[data-no]").addEventListener("click", () => { ov.remove(); if (onNo) onNo(); });
          ov.querySelector("[data-yes]").addEventListener("click", () => { ov.remove(); onYes(); });
        });
    }

    // ---------- controles ----------
    function renderControls() {
      const allDone = games.every(g => g.match.finished);
      const userHalf = userGame.match.phase === "halftime";
      let html = soundHtml();
      if (selectedIdx !== userIdx) html += '<button class="btn primary" id="c-mygame">👁️ Meu jogo</button>'; // §12.2 voltar ao próprio jogo
      if (allDone) {
        html += '<button class="btn primary" id="c-done">Continuar ▶</button>' +
          '<button class="btn" id="c-report">📊 Resumo tático</button>' +
          '<button class="btn" id="c-ratings">Notas</button>';
      } else if (userHalf && !timer) {
        html += '<button class="btn primary" id="c-2half">▶ Iniciar 2º tempo</button>' +
          '<button class="btn" id="c-manage">⚙️ Gerir meu time</button>' +
          '<button class="btn" id="c-skip">⏩ Simular restante</button>';
      } else {
        html += '<button class="btn primary" id="c-manage">⚙️ Gerir meu time</button>' +
          '<select id="c-speed">' +
            '<option value="220"' + (speed === 220 ? " selected" : "") + ">Normal</option>" +
            '<option value="110"' + (speed === 110 ? " selected" : "") + ">Rápida</option>" +
            '<option value="40"' + (speed === 40 ? " selected" : "") + ">Muito rápida</option>" +
          "</select>" +
          '<button class="btn" id="c-skip">⏩ Simular restante</button>';
      }
      $controls.innerHTML = html;
      bindSound($controls);
      bind("#c-mygame", () => selectGame(userIdx));
      bind("#c-skip", skipAll);
      bind("#c-manage", openManagement);
      bind("#c-2half", () => { userGame.match.resumeSecondHalf(); S().play("kickoff"); play(); });
      bind("#c-done", finishAndContinue);
      bind("#c-ratings", ratingsModal);
      bind("#c-report", reportModal);
      const sp = $controls.querySelector("#c-speed");
      if (sp) sp.addEventListener("change", ev => { speed = parseInt(ev.target.value, 10); if (timer) { stopTimer(); startTimer(); } });
    }

    function bind(sel, fn) {
      const b = $controls.querySelector(sel);
      if (b) b.addEventListener("click", fn);
    }

    function startTimer() { timer = setInterval(tick, speed); }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function play() { if (manageOverlay) return; stopTimer(); startTimer(); renderControls(); }
    function pause() { stopTimer(); renderControls(); }

    function tick() {
      let userHitHalftime = false;
      for (const g of games) {
        if (g.match.finished) continue;
        if (g === userGame && g.match.phase === "halftime") continue;
        // jogos da IA que empataram no mata-mata resolvem a disputa sozinhos
        if (g !== userGame && g.match.phase === "shootout") { g.match.finishShootout(); continue; }
        if (g === userGame && g.match.phase === "shootout") continue; // apresentado abaixo
        g.match.playMinute();
        if (g === userGame && g.match.phase === "halftime") userHitHalftime = true;
      }
      playSounds();
      updateGrid();
      updateDetail();

      if (userGame.match.penalty) { pause(); penaltyScreen(); return; }
      if (userGame.match.phase === "shootout" && !userGame.match.finished) { pause(); shootoutScreen(); return; }
      if (userGame.match.pendingInjury) { pause(); injuryModal(); return; }

      const allDone = games.every(g => g.match.finished);
      if (userHitHalftime || allDone) {
        stopTimer();
        if (allDone) S().stopAmbience();
        renderControls();
      }
    }

    function playSounds() {
      for (const g of games) {
        while (g.shown < g.match.events.length) {
          const ev = g.match.events[g.shown++];
          if (g === userGame) S().play(ev.type);
          else if (ev.type === "goal") S().play("goalOther");
        }
      }
    }

    function skipAll() {
      stopTimer();
      S().stopAmbience();
      for (const g of games) { g.match.finishNow(); g.shown = g.match.events.length; }
      updateGrid();
      updateDetail();
      renderControls();
    }

    // ---------- decisões na hora ----------
    // Tela dedicada de PÊNALTI com tensão (§11-18): escolher batedor (se você ataca),
    // frases de suspense com "Acelerar", e revelação (Gol/Defesa/Trave/Fora).
    function penaltyScreen() {
      const pen = userGame.match.penalty;
      if (!pen) return;
      S().play("penalty");
      const ov = document.createElement("div");
      ov.className = "modal-overlay penalty-overlay";
      document.body.appendChild(ov);
      let timers = [], done = false;
      const clearTimers = () => { timers.forEach(t => clearTimeout(t)); timers = []; };
      const render = html => { ov.innerHTML = '<div class="penalty-screen">' + html + "</div>"; };

      function finishAndClose() {
        if (done) return; done = true;
        clearTimers();
        userGame.match.finishPenalty();
        ov.remove();
        playSounds(); updateGrid(); updateDetail();
        play();
      }

      function renderTakerChoice() {
        const cands = pen.eligible.slice().sort((a, b) => b.finishing - a.finishing);
        render(
          '<div class="pen-badge">⚽ PÊNALTI</div>' +
          '<div class="pen-head">' + esc(pen.club) + '</div>' +
          '<div class="pen-sub">Quem vai bater?</div>' +
          '<div class="pen-takers">' + cands.map(c =>
            '<button class="pen-taker" data-taker="' + c.id + '">' +
              '<span class="pen-pos">' + esc(c.pos) + '</span>' +
              '<span class="pen-name">' + esc(c.name) + (c.star ? " ⭐" : "") + '</span>' +
              '<span class="pen-stat">Fin ' + c.finishing + ' · ' + c.energy + '%</span>' +
            "</button>").join("") + "</div>"
        );
        ov.querySelectorAll("[data-taker]").forEach(b => b.addEventListener("click", () => {
          userGame.match.setPenaltyTaker(b.dataset.taker);
          startSuspense();
        }));
      }

      function startSuspense() {
        const p = userGame.match.penalty;
        const cobrador = p.userAttacking ? p.club : p.oppClub;
        const phrases = M().PENALTY_SUSPENSE.slice().sort(() => Math.random() - 0.5).slice(0, 3);
        let i = 0;
        const step = () => {
          if (i >= phrases.length) return reveal();
          render(
            '<div class="pen-badge">⚽ PÊNALTI</div>' +
            '<div class="pen-head">' + esc(cobrador) + " na cobrança</div>" +
            '<div class="pen-ball">⚽</div>' +
            '<div class="pen-taker-name">' + esc(p.takerName || "") + "</div>" +
            '<div class="pen-suspense">' + esc(phrases[i]) + "</div>" +
            '<button class="btn" id="pen-skip">⏩ Acelerar</button>'
          );
          ov.querySelector("#pen-skip").addEventListener("click", () => { clearTimers(); reveal(); });
          i++;
          timers.push(setTimeout(step, 1100));
        };
        step();
      }

      function reveal() {
        clearTimers();
        const p = userGame.match.penalty;
        const o = p.outcome;
        const big = o === "goal" ? "GOL!" : o === "save" ? "DEFENDEU!" : o === "post" ? "NA TRAVE!" : "PRA FORA!";
        const cls = o === "goal" ? "pen-goal" : "pen-miss";
        S().play(o === "goal" ? "goal" : o === "save" ? "save" : "miss");
        render(
          '<div class="pen-result ' + cls + '">' + big + "</div>" +
          '<div class="pen-result-sub">' + esc(p.takerName || "") + "</div>" +
          '<button class="btn primary" id="pen-cont">Continuar</button>'
        );
        ov.querySelector("#pen-cont").addEventListener("click", finishAndClose);
        timers.push(setTimeout(finishAndClose, 2800));
      }

      if (pen.userAttacking && !pen.takerId) renderTakerChoice();
      else startSuspense();
    }

    // Tela de DISPUTA DE PÊNALTIS (§28): revela as cobranças uma a uma, com placar
    // e marcadores, botão Acelerar e o veredito final.
    function shootoutScreen() {
      const so = userGame.match.shootout;
      if (!so) { userGame.match.finishShootout && userGame.match.finishShootout(); play(); return; }
      const ov = document.createElement("div");
      ov.className = "modal-overlay penalty-overlay";
      document.body.appendChild(ov);
      const userSide = userGame.entry.isHome ? "h" : "a";
      let timers = [], done = false, reveal = 0;
      const clearTimers = () => { timers.forEach(t => clearTimeout(t)); timers = []; };

      function finishAndClose() {
        if (done) return; done = true;
        clearTimers();
        userGame.match.finishShootout();
        ov.remove();
        playSounds(); updateGrid(); updateDetail();
        play();
      }
      function dots(side) {
        const ks = so.kicks.filter(k => k.side === side);
        const globalIdx = i => so.kicks.indexOf(ks[i]);
        return ks.map((k, i) => {
          if (globalIdx(i) >= reveal) return '<span class="so-dot so-pend">•</span>';
          return '<span class="so-dot ' + (k.outcome === "goal" ? "so-goal" : "so-miss") + '">' + (k.outcome === "goal" ? "●" : "○") + "</span>";
        }).join("");
      }
      function currentScore() {
        let sH = 0, sA = 0;
        for (let i = 0; i < reveal && i < so.kicks.length; i++) { sH = so.kicks[i].sH; sA = so.kicks[i].sA; }
        return { sH, sA };
      }
      function paint(finalReveal) {
        const sc = currentScore();
        const last = reveal > 0 ? so.kicks[reveal - 1] : null;
        const lastTxt = last ? (last.taker + " — " + (last.outcome === "goal" ? "GOL!" : last.outcome === "save" ? "DEFENDEU!" : last.outcome === "post" ? "NA TRAVE!" : "PRA FORA!")) : "Preparando as cobranças…";
        const lastCls = last ? (last.outcome === "goal" ? "pen-goal" : "pen-miss") : "";
        let winnerHtml = "";
        if (finalReveal) {
          const meWon = so.winnerSide === userSide;
          winnerHtml = '<div class="pen-result ' + (meWon ? "pen-goal" : "pen-miss") + '" style="font-size:1.7rem">' + (so.winnerSide === "h" ? esc(so.homeName) : esc(so.awayName)) + " se classifica!</div>";
        }
        ov.innerHTML = '<div class="penalty-screen">' +
          '<div class="pen-badge">⚽ DISPUTA DE PÊNALTIS</div>' +
          '<div class="so-score"><span>' + esc(so.homeName) + '</span><b>' + sc.sH + " x " + sc.sA + '</b><span>' + esc(so.awayName) + "</span></div>" +
          '<div class="so-row">' + dots("h") + '</div><div class="so-row">' + dots("a") + "</div>" +
          (finalReveal ? winnerHtml : '<div class="pen-suspense ' + lastCls + '" style="font-weight:700">' + esc(lastTxt) + "</div>") +
          (finalReveal ? '<button class="btn primary" id="so-cont">Continuar</button>' : '<button class="btn" id="so-skip">⏩ Acelerar</button>') +
          "</div>";
        if (finalReveal) { ov.querySelector("#so-cont").addEventListener("click", finishAndClose); }
        else { const s = ov.querySelector("#so-skip"); if (s) s.addEventListener("click", skip); }
      }
      function step() {
        if (reveal >= so.kicks.length) { paint(true); timers.push(setTimeout(finishAndClose, 3200)); return; }
        reveal++;
        const k = so.kicks[reveal - 1];
        S().play(k.outcome === "goal" ? "shootoutGoal" : "shootoutMiss");
        paint(false);
        timers.push(setTimeout(step, 950));
      }
      function skip() { clearTimers(); reveal = so.kicks.length; paint(true); timers.push(setTimeout(finishAndClose, 2600)); }

      S().play("penalty");
      paint(false);
      timers.push(setTimeout(step, 800));
    }

    function injuryModal() {
      const pend = userGame.match.pendingInjury;
      const bench = userTeam.bench.filter(b => !b.injuryWeeks);
      const subsLeft = 5 - (userTeam.subsUsed || 0);
      // só chega aqui quando há substituição disponível (o motor garante)
      UI().modal(
        "<h3>🚑 " + esc(pend.outName || "Jogador") + " se machucou!</h3>" +
        "<p class='muted'>Escolha quem entra (" + subsLeft + " substituições restantes):</p>" +
        '<table class="data"><tbody>' +
        bench.map(p => '<tr data-in="' + p.id + '" style="cursor:pointer"><td>' + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td><td class='num'>" + UI().ratingBadge(p.rating) + "</td><td class='num'>" + Math.round(p.energy) + "%</td></tr>").join("") +
        "</tbody></table>",
        ov => {
          ov.addEventListener("click", e => e.stopPropagation());
          ov.querySelectorAll("[data-in]").forEach(tr => tr.addEventListener("click", () => {
            userGame.match.resolveInjury(tr.dataset.in);
            S().play("sub");
            ov.remove();
            playSounds(); updateGrid(); updateDetail();
            play();
          }));
        });
    }

    function reportModal() {
      const g = games[selectedIdx];
      const rep = g.match.result().report;
      const row = (label, hv, av) => '<div class="rh">' + hv + '</div><div class="rname">' + label + '</div><div class="ra">' + av + "</div>";
      function block(r) {
        return "Formação <b>" + esc(r.formacao) + "</b> · setor principal: <b>" + r.setorPrincipal + "</b>";
      }
      UI().modal(
        "<h3>📊 Resumo tático</h3>" +
        '<div class="grid2" style="margin-bottom:8px"><div class="muted">' + esc(g.entry.home.club.name) + ": " + block(rep.h) + "</div>" +
        '<div class="muted" style="text-align:right">' + esc(g.entry.away.club.name) + ": " + block(rep.a) + "</div></div>" +
        '<div class="report-grid">' +
          row("Ataques pelo meio", rep.h.ataquesMeio + "%", rep.a.ataquesMeio + "%") +
          row("Ataques pela esquerda", rep.h.ataquesEsquerda + "%", rep.a.ataquesEsquerda + "%") +
          row("Ataques pela direita", rep.h.ataquesDireita + "%", rep.a.ataquesDireita + "%") +
          row("Cruzamentos", rep.h.cruzamentos, rep.a.cruzamentos) +
          row("Bolas longas", rep.h.bolasLongas, rep.a.bolasLongas) +
          row("Jogadas em profundidade", rep.h.profundidade, rep.a.profundidade) +
          row("Contra-ataques", rep.h.contraAtaques, rep.a.contraAtaques) +
          row("Bolas aéreas", rep.h.aereas, rep.a.aereas) +
          row("Recuperações no ataque", rep.h.recuperacaoAlta, rep.a.recuperacaoAlta) +
          row("Energia no fim", rep.h.cansaco + "%", rep.a.cansaco + "%") +
        "</div>" +
        '<div class="actions"><button class="btn" data-x>Fechar</button></div>',
        ov => ov.querySelector("[data-x]").addEventListener("click", () => ov.remove()));
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
      S().stopAmbience();
      const results = games.map(g => ({ fixture: g.entry.fixture, result: g.match.result() }));
      G().completeLiveRound(results);
      G().save(1);
      UI().goto("calendar");
      const r = userGame.match.result();
      const gf = userGame.entry.isHome ? r.gh : r.ga;
      const ga = userGame.entry.isHome ? r.ga : r.gh;
      if (r.shootout) {
        const meWon = r.shootout.winnerSide === (userGame.entry.isHome ? "h" : "a");
        UI().toast(meWon ? "Classificado nos pênaltis! 🎉" : "Eliminado nos pênaltis.");
      } else {
        UI().toast(gf > ga ? "Vitória! 🎉" : gf < ga ? "Derrota." : "Empate.");
      }
    }

    // a partida começa imediatamente ao entrar na tela
    buildGrid();
    buildDetail();
    renderControls();
    updateGrid();
    S().startAmbience();
    S().play("kickoff");
    play();
  };
})();
