"use strict";
/* Telas do jogo. Cada função recebe o container e desenha seu conteúdo. */
(function () {
  const U = window.TF.util;
  const UI = () => window.TF.ui;
  const G = () => window.TF.game;
  const M = () => window.TF.match;
  const F = () => window.TF.finance;
  const T = () => window.TF.transfers;
  const C = () => window.TF.competitions;

  const S = {};

  function esc(s) { return U.esc(s); }
  function money(v) { return U.formatMoney(v); }
  function star(p) { return p && p.star ? ' <span class="star-mark" title="Craque">⭐</span>' : ""; }

  function playerStatusTags(p) {
    let out = "";
    if (p.injuryWeeks > 0) out += '<span class="tag inj">Lesão ' + p.injuryWeeks + "s</span> ";
    if (p.suspended > 0) out += '<span class="tag susp">Suspenso</span> ';
    if (p.contractYears <= 0) out += '<span class="tag nocontract">Sem contrato</span> ';
    if (p.forSale) out += '<span class="tag sale">À venda ' + (p.salePrice ? money(p.salePrice) : "") + "</span> ";
    return out;
  }

  function barHtml(v, color) {
    const c = color || (v > 66 ? "var(--green)" : v > 33 ? "var(--yellow)" : "var(--red)");
    return '<span class="bar"><i style="width:' + Math.round(v) + "%;background:" + c + '"></i></span>';
  }

  // ---------------- HOME ----------------
  S.home = function (el) {
    const hasSave = G().hasSave(1);
    el.innerHTML =
      '<div class="hero">' +
        '<button class="btn" id="btn-theme-home" style="position:fixed;top:16px;right:16px;min-width:0" title="Alternar tema">' + (UI().currentTheme() === "light" ? "🌙" : "☀️") + "</button>" +
        "<h1>⚽ Técnico <span>26</span></h1>" +
        "<p>Manager de futebol — temporada 2026 com elencos reais de 6 países</p>" +
        (hasSave ? '<button class="btn primary" id="btn-continue">Continuar carreira</button>' : "") +
        '<button class="btn' + (hasSave ? "" : " primary") + '" id="btn-new">Nova carreira</button>' +
        '<button class="btn" id="btn-online" style="border-color:var(--accent)">🌐 Jogar online com amigos</button>' +
      "</div>";
    el.querySelector("#btn-theme-home").addEventListener("click", () => { UI().toggleTheme(); S.home(el); });
    const bc = el.querySelector("#btn-continue");
    if (bc) bc.addEventListener("click", () => {
      const r = G().load(1);
      if (r.ok) UI().goto("dashboard"); else UI().toast(r.reason);
    });
    el.querySelector("#btn-new").addEventListener("click", () => UI().goto("newCareer"));
    el.querySelector("#btn-online").addEventListener("click", () => { window.location.href = "online.html"; });
  };

  // ---------------- NOVA CARREIRA ----------------
  S.newCareer = function (el) {
    // constrói um mundo só para listar clubes (a carreira reconstrói com semente própria)
    if (!S._previewWorld) S._previewWorld = window.TF.world.buildWorld();
    const world = S._previewWorld;
    const countries = Object.values(world.countries);
    let selCountry = S._ncCountry || "BRA";
    let selDiv = S._ncDiv || "A";

    function draw() {
      const country = world.countries[selCountry];
      const ids = selDiv === "A" ? country.clubIdsA : country.clubIdsB;
      const clubs = ids.map(id => world.clubs[id]).sort((a, b) => b.rating - a.rating);
      el.innerHTML =
        '<div style="max-width:960px;margin:0 auto;padding:26px">' +
          "<h2 style='font-size:1.5rem;margin-bottom:14px'>Nova carreira</h2>" +
          '<div class="card"><div class="row">' +
            '<label>Seu nome: <input id="coach-name" value="' + esc(S._ncName || "Treinador") + '" style="width:200px"></label>' +
            '<label>País: <select id="sel-country">' + countries.map(c => '<option value="' + c.id + '"' + (c.id === selCountry ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select></label>" +
            '<label>Divisão: <select id="sel-div"><option value="A"' + (selDiv === "A" ? " selected" : "") + '>Série A</option><option value="B"' + (selDiv === "B" ? " selected" : "") + ">Série B</option></select></label>" +
            '<button class="btn" id="btn-back">← Voltar</button>' +
          "</div></div>" +
          '<div class="club-grid">' +
            clubs.map(c =>
              '<div class="club-pick" data-club="' + c.id + '">' + UI().crestImg(c, 34) +
              '<div><div class="cname">' + esc(c.name) + '</div><div class="cinfo">Força ' + c.rating + " · " + esc(c.stadium) + "</div></div></div>"
            ).join("") +
          "</div></div>";

      el.querySelector("#sel-country").addEventListener("change", e => { selCountry = S._ncCountry = e.target.value; draw(); });
      el.querySelector("#sel-div").addEventListener("change", e => { selDiv = S._ncDiv = e.target.value; draw(); });
      el.querySelector("#btn-back").addEventListener("click", () => UI().goto("home"));
      el.querySelector("#coach-name").addEventListener("input", e => { S._ncName = e.target.value; });
      el.querySelectorAll("[data-club]").forEach(d => d.addEventListener("click", () => {
        const name = (el.querySelector("#coach-name").value || "Treinador").trim();
        const clubName = world.clubs[d.dataset.club].name;
        UI().modal(
          "<h3>Assumir o " + esc(clubName) + "?</h3><p class='muted'>Você começará a temporada 2026 no comando deste clube.</p>" +
          '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Assinar contrato</button></div>',
          ov => {
            ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
            ov.querySelector("[data-ok]").addEventListener("click", () => {
              ov.remove();
              G().newCareer(name, d.dataset.club);
              G().save(1);
              UI().goto("dashboard");
              UI().toast("Bem-vindo ao " + clubName + "!");
            });
          });
      }));
    }
    draw();
  };

  // ---------------- ELENCO ----------------
  S.squad = function (el) {
    const club = G().userClub();
    const players = club.players.slice().sort((a, b) => {
      const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
      return order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating;
    });
    el.innerHTML =
      "<h2>Elenco <span class='muted' style='font-size:.9rem'>(" + players.length + " jogadores · salários " + money(F().squadWages(club)) + "/rodada)</span></h2>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr>' +
      "<th>Pos</th><th>Nome</th><th class='num'>Idade</th><th>Pé</th><th class='num'>Força</th><th>Características</th><th>Energia</th><th>Moral</th><th class='num'>Nota</th><th class='num'>J</th><th class='num'>G</th><th class='num'>Salário</th><th class='num'>Contrato</th><th class='num'>Valor</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      players.map(p =>
        '<tr data-p="' + p.id + '" style="cursor:pointer">' +
        "<td>" + UI().posBadge(p.pos) + "</td>" +
        "<td><b>" + esc(p.name) + "</b>" + star(p) + "</td>" +
        '<td class="num">' + p.age + "</td>" +
        "<td>" + (p.foot === "E" ? "Canhoto" : p.foot === "A" ? "Ambidestro" : "Destro") + "</td>" +
        '<td class="num">' + UI().ratingBadge(p.rating) + "</td>" +
        "<td>" + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
        "<td>" + barHtml(p.energy) + "</td>" +
        "<td>" + barHtml(p.moral) + "</td>" +
        '<td class="num">' + (p.seasonStats.games ? (p.seasonStats.ratingSum / p.seasonStats.games).toFixed(1) : "—") + "</td>" +
        '<td class="num">' + p.seasonStats.games + "</td>" +
        '<td class="num">' + p.seasonStats.goals + "</td>" +
        '<td class="num">' + money(p.wage) + "</td>" +
        '<td class="num">' + (p.contractYears > 0 ? p.contractYears + (p.contractYears === 1 ? " ano" : " anos") : "<span class='money-neg'>—</span>") + "</td>" +
        '<td class="num">' + money(p.value * 1e6) + "</td>" +
        "<td>" + playerStatusTags(p) + "</td>" +
        "</tr>").join("") +
      "</tbody></table></div>";

    el.querySelectorAll("[data-p]").forEach(tr => tr.addEventListener("click", () => playerModal(tr.dataset.p)));
  };

  function playerModal(pid) {
    const club = G().userClub();
    const p = club.players.find(x => x.id === pid);
    if (!p) return;
    const sk = p.skills;
    const skillRows = [
      ["Goleiro", sk.gk], ["Velocidade", sk.speed], ["Passe", sk.pass], ["Armação", sk.playmaking],
      ["Desarme", sk.tackle], ["Finalização", sk.finishing], ["Técnica", sk.technique]
    ].map(([n, v]) => "<tr><td>" + n + '</td><td class="num">' + Math.round(v) + "</td><td>" + barHtml(v, "var(--accent)") + "</td></tr>").join("");
    UI().modal(
      "<h3>" + UI().posBadge(p.pos) + " " + esc(p.name) + star(p) + " " + UI().ratingBadge(p.rating) + "</h3>" +
      '<div class="grid2">' +
        '<div><table class="data">' + skillRows + "</table></div>" +
        "<div>" +
          "<p>Idade: <b>" + p.age + "</b> · Nação: <b>" + esc(p.nation) + "</b></p>" +
          "<p>Características: " + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</p>" +
          "<p>Salário: <b>" + money(p.wage) + "</b>/jogo · Contrato: <b>" + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "expirado") + "</b></p>" +
          "<p>Valor de mercado: <b>" + money(p.value * 1e6) + "</b></p>" +
          (p.forSale && p.salePrice ? "<p class='text-gold'>À venda por <b>" + money(p.salePrice) + "</b></p>" : "") +
          "<p>Temporada: <b>" + p.seasonStats.games + "</b> jogos, <b>" + p.seasonStats.goals + "</b> gols, <b>" + p.seasonStats.assists + "</b> assistências</p>" +
          "<p>Moral: " + barHtml(p.moral) + " · Energia: " + barHtml(p.energy) + "</p>" +
        "</div>" +
      "</div>" +
      '<div class="actions">' +
        '<button class="btn" data-renew>Renovar contrato</button>' +
        '<button class="btn" data-sale>' + (p.forSale ? "Tirar da lista de venda" : "Colocar à venda…") + "</button>" +
        '<button class="btn danger" data-release>Dispensar</button>' +
        '<button class="btn" data-x>Fechar</button>' +
      "</div>",
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-sale]").addEventListener("click", () => {
          ov.remove();
          if (p.forSale) {
            p.forSale = false;
            p.salePrice = null;
            UI().render();
            UI().toast(p.name + " saiu da lista de transferências.");
          } else {
            salePriceModal(p);
          }
        });
        ov.querySelector("[data-release]").addEventListener("click", () => {
          const fine = p.contractYears > 0 ? Math.round(p.wage * 20 * p.contractYears) : 0;
          if (club.money < fine) { UI().toast("Multa de " + money(fine) + " — caixa insuficiente."); return; }
          club.money -= fine;
          club.players = club.players.filter(x => x.id !== p.id);
          p.clubId = null; p.contractYears = 0;
          ov.remove(); UI().render();
          UI().toast(p.name + " dispensado" + (fine ? " (multa de " + money(fine) + ")" : "") + ".");
        });
        ov.querySelector("[data-renew]").addEventListener("click", () => {
          ov.remove();
          renewModal(p);
        });
      });
  }

  /* Anunciar jogador: o técnico escolhe o preço; o mercado só morde se fizer sentido. */
  function salePriceModal(p) {
    const club = G().userClub();
    const fair = T().fairValue(p, club);
    UI().modal(
      "<h3>Colocar " + esc(p.name) + " à venda</h3>" +
      "<p class='muted'>Valor de mercado estimado: <b>" + money(fair) + "</b></p>" +
      '<div class="row" style="margin-top:10px">' +
        '<label>Preço pedido: <input type="number" id="sp" value="' + fair + '" step="100000" min="0" style="width:160px"></label>' +
      "</div>" +
      "<p class='muted' style='margin-top:10px;font-size:.83rem'>Preço abaixo do mercado atrai propostas rápidas. Preço muito acima do valor não atrai ninguém — os clubes não compram caro.</p>" +
      '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Anunciar</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-ok]").addEventListener("click", () => {
          const v = Math.max(0, parseInt(ov.querySelector("#sp").value, 10) || fair);
          p.forSale = true;
          p.salePrice = v;
          ov.remove();
          UI().render();
          const ratio = v / Math.max(fair, 1);
          UI().toast(p.name + " anunciado por " + money(v) + "." +
            (ratio > 1.4 ? " O empresário avisa: está caro demais, dificilmente virá proposta." : ratio < 0.8 ? " Preço convidativo — espere fila." : ""));
        });
      });
  }

  function renewModal(p) {
    const suggested = Math.round(p.wage * 1.2 / 100) * 100;
    UI().modal(
      "<h3>Renovar com " + esc(p.name) + "</h3>" +
      "<p class='muted'>Salário atual: " + money(p.wage) + "/jogo</p>" +
      '<div class="row" style="margin-top:10px">' +
        '<label>Novo salário: <input type="number" id="rw" value="' + suggested + '" step="100" style="width:140px"></label>' +
        '<label>Duração: <select id="ry"><option value="1">1 ano</option><option value="2" selected>2 anos</option></select></label>' +
      "</div>" +
      '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Propor</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-ok]").addEventListener("click", () => {
          const w = parseInt(ov.querySelector("#rw").value, 10) || 0;
          const y = parseInt(ov.querySelector("#ry").value, 10);
          const r = T().renewContract(p, G().userClub(), w, y);
          ov.remove();
          UI().toast(r.ok ? p.name + " renovou por " + y + " ano(s)!" : r.reason);
          UI().render();
        });
      });
  }

  // ---------------- ESCALAÇÃO ----------------
  S.lineup = function (el) {
    const G_ = G();
    const club = G_.userClub();
    const st = G_.state;
    const formation = M().FORMATIONS[st.tactics.formationName];
    const coords = M().FORMATION_COORDS[st.tactics.formationName];
    const byId = {}; for (const p of club.players) byId[p.id] = p;

    el.innerHTML =
      "<h2>Escalação e táticas</h2>" +
      '<div class="card"><div class="row" style="align-items:flex-end">' +
        '<label class="tac-sel"><span class="muted">Formação</span><select id="sel-form">' + window.TF.tactics.FORMATION_NAMES.map(f => "<option" + (f === st.tactics.formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
        UI().tacticsSelects(st.tactics) +
        '<label class="tac-sel"><span class="muted">Treino</span><select id="sel-train">' +
          '<option value="auto"' + (st.training === "auto" ? " selected" : "") + ">Auxiliar decide</option>" +
          '<option value="principais"' + (st.training === "principais" ? " selected" : "") + ">Principais</option>" +
          '<option value="secundarias"' + (st.training === "secundarias" ? " selected" : "") + ">Secundárias</option>" +
        "</select></label>" +
        '<button class="btn" id="btn-auto">Escalar auto</button>' +
      "</div>" +
      '<div id="tac-info" style="margin-top:10px"></div>' +
      "</div>" +
      '<div class="lineup-wrap">' +
        '<div class="pitch" id="pitch"><div class="center-line"></div><div class="center-circle"></div></div>' +
        '<div><div class="card" id="setpieces-card"></div><div class="card mb0" id="bench-card"></div></div>' +
      "</div>";

    function refreshTacInfo() {
      const team = G_.userTeam();
      el.querySelector("#tac-info").innerHTML =
        UI().tacticWarningsHtml(team) +
        '<details class="tac-desc"><summary class="muted" style="cursor:pointer;font-size:.82rem">Ver o que cada escolha faz</summary>' + UI().tacticsDescriptions(st.tactics) + "</details>";
    }

    function drawPitch() {
      const pitch = el.querySelector("#pitch");
      pitch.querySelectorAll(".shirt").forEach(s => s.remove());
      formation.forEach((pos, i) => {
        const pid = st.userSquad.starters[i];
        const p = pid ? byId[pid] : null;
        const [x, y] = coords[i];
        const div = document.createElement("div");
        const unavailable = p && (p.injuryWeeks > 0 || p.suspended > 0 || p.contractYears <= 0);
        div.className = "shirt" + (p ? "" : " empty") + (pos === "GOL" ? " gk" : "");
        div.style.left = x + "%";
        div.style.top = (100 - y) + "%";
        const isCap = p && st.setPieces && st.setPieces.captain === p.id;
        const eColor = p ? (p.energy > 60 ? "var(--green)" : p.energy > 35 ? "var(--yellow)" : "var(--red)") : "";
        div.innerHTML =
          '<div class="jersey">' + (p ? Math.round(p.rating) : pos) + "</div>" +
          (p ? '<div class="shirt-energy"><i style="width:' + Math.round(p.energy) + "%;background:" + eColor + '"></i></div>' : "") +
          '<div class="pname' + (p && p.pos !== pos ? " improv" : "") + '">' +
          (p ? (isCap ? "© " : "") + esc(p.name.split(" ").slice(-1)[0]) + (unavailable ? " ⚠" : "") : "vazio") + "</div>";
        div.addEventListener("click", () => pickPlayerForSlot(i, pos));
        pitch.appendChild(div);
      });
    }

    function drawSetPieces() {
      G_.autoAssignSetPieces();
      const sp = st.setPieces;
      const starters = st.userSquad.starters.map(id => byId[id]).filter(Boolean);
      const options = (selected, gkOk) => starters
        .filter(p => gkOk || p.pos !== "GOL")
        .map(p => '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">" + esc(p.name) + " (" + p.pos + ")</option>").join("");
      el.querySelector("#setpieces-card").innerHTML =
        "<h3 style='margin-top:0'>Capitão e cobradores</h3>" +
        '<div class="row" style="flex-direction:column;align-items:stretch;gap:8px">' +
          '<label>👑 Capitão: <select data-sp="captain" style="width:100%">' + options(sp.captain, true) + "</select></label>" +
          '<label>🎯 Faltas: <select data-sp="freeKick" style="width:100%">' + options(sp.freeKick) + "</select></label>" +
          '<label>◀ Escanteio esq.: <select data-sp="cornerLeft" style="width:100%">' + options(sp.cornerLeft) + "</select></label>" +
          '<label>▶ Escanteio dir.: <select data-sp="cornerRight" style="width:100%">' + options(sp.cornerRight) + "</select></label>" +
        "</div>" +
        "<p class='muted' style='font-size:.78rem;margin-top:8px'>O capitão em campo melhora o rendimento do time (experiência conta). Os cobradores valem para faltas e escanteios de cada lado.</p>";
      el.querySelectorAll("[data-sp]").forEach(sel => sel.addEventListener("change", e => {
        st.setPieces[e.target.dataset.sp] = e.target.value;
      }));
    }

    function drawBench() {
      const usedIds = new Set(st.userSquad.starters.filter(Boolean));
      const benchSet = new Set(st.userSquad.bench);
      const bench = st.userSquad.bench.map(id => byId[id]).filter(Boolean);
      // excedentes: no elenco, mas não são titulares nem estão no banco (fora da lista do jogo)
      const outside = club.players
        .filter(p => !usedIds.has(p.id) && !benchSet.has(p.id) && p.contractYears > 0)
        .sort((a, b) => b.rating - a.rating);
      const energyCell = p => "<td><span class='bar' style='width:44px'><i style='width:" + Math.round(p.energy) + "%;background:" + (p.energy > 60 ? "var(--green)" : p.energy > 35 ? "var(--yellow)" : "var(--red)") + "'></i></span></td>";
      el.querySelector("#bench-card").innerHTML =
        "<h3 style='margin-top:0'>Banco de reservas (" + bench.length + "/7)</h3>" +
        '<table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Força</th><th>Energia</th><th>Status</th></tr></thead><tbody>' +
        bench.map(p => "<tr><td>" + UI().posBadge(p.pos) + "</td><td>" + esc(p.name) + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td>" + energyCell(p) + "<td>" + playerStatusTags(p) + "</td></tr>").join("") +
        "</tbody></table>" +
        (outside.length ?
          "<h3>Fora da lista (" + outside.length + ")</h3>" +
          "<p class='muted' style='font-size:.8rem;margin-bottom:6px'>Não entram nesta partida (limite de 18 relacionados), mas treinam e evoluem normalmente.</p>" +
          '<table class="data"><tbody>' +
          outside.map(p => "<tr style='opacity:.75'><td>" + UI().posBadge(p.pos) + "</td><td>" + esc(p.name) + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td>" + energyCell(p) + "<td>" + playerStatusTags(p) + "</td></tr>").join("") +
          "</tbody></table>" : "") +
        "<h3>Dica</h3><p class='muted' style='font-size:.85rem'>Clique em uma camisa para trocar o jogador da posição. Nomes em amarelo indicam jogadores improvisados — rendem menos fora da posição de origem.</p>";
    }

    function pickPlayerForSlot(slotIndex, pos) {
      const usedIds = new Set(st.userSquad.starters.filter((id, i) => i !== slotIndex && id));
      const candidates = club.players
        .filter(p => !usedIds.has(p.id) && p.contractYears > 0)
        .sort((a, b) => (b.rating * M().positionFactor(b, pos)) - (a.rating * M().positionFactor(a, pos)));
      UI().modal(
        "<h3>Escolher jogador — " + esc(window.TF.world.POS_LABEL[pos]) + "</h3>" +
        '<table class="data"><tbody>' +
        '<tr data-pick=""><td colspan="5" class="muted">— Deixar vazio —</td></tr>' +
        candidates.map(p => {
          const unavailable = p.injuryWeeks > 0 || p.suspended > 0;
          return '<tr data-pick="' + p.id + '"' + (unavailable ? ' style="opacity:.45"' : ' style="cursor:pointer"') + ">" +
            "<td>" + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + (p.pos !== pos ? " <span class='muted'>(improvisado)</span>" : "") + "</td>" +
            "<td class='num'>" + UI().ratingBadge(p.rating) + "</td><td>" + barHtml(p.energy) + "</td><td>" + playerStatusTags(p) + "</td></tr>";
        }).join("") +
        "</tbody></table>",
        ov => {
          ov.querySelectorAll("[data-pick]").forEach(tr => tr.addEventListener("click", () => {
            const pid = tr.dataset.pick || null;
            if (pid) {
              const p = byId[pid];
              if (p.injuryWeeks > 0 || p.suspended > 0) { UI().toast("Jogador indisponível."); return; }
              // remove do banco se estava lá
              st.userSquad.bench = st.userSquad.bench.filter(id => id !== pid);
            }
            st.userSquad.starters[slotIndex] = pid;
            rebuildBench();
            ov.remove();
            drawPitch(); drawBench(); drawSetPieces();
          }));
        });
    }

    function rebuildBench() {
      const used = new Set(st.userSquad.starters.filter(Boolean));
      const current = st.userSquad.bench.filter(id => byId[id] && !used.has(id));
      const rest = club.players.filter(p => !used.has(p.id) && !current.includes(p.id) && p.contractYears > 0 && !p.injuryWeeks && !p.suspended)
        .sort((a, b) => b.rating - a.rating);
      while (current.length < 7 && rest.length) current.push(rest.shift().id);
      st.userSquad.bench = current.slice(0, 7);
    }

    el.querySelector("#sel-form").addEventListener("change", e => {
      st.tactics.formationName = e.target.value;
      G_.autoLineup();
      S.lineup(el);
    });
    el.querySelectorAll("[data-tac]").forEach(sel => sel.addEventListener("change", e => {
      st.tactics[e.target.dataset.tac] = e.target.value;
      refreshTacInfo();
    }));
    el.querySelector("#sel-train").addEventListener("change", e => { st.training = e.target.value; });
    el.querySelector("#btn-auto").addEventListener("click", () => { G_.autoLineup(); S.lineup(el); });

    rebuildBench();
    drawPitch();
    drawBench();
    drawSetPieces();
    refreshTacInfo();
  };

  // ---------------- CLASSIFICAÇÃO ----------------
  S.table = function (el) {
    const st = G().state;
    const world = st.world;
    const userCid = G().userClub().countryId;
    const cid = S._tblCountry || userCid;
    const div = S._tblDiv || G().userClub().division;
    const country = world.countries[cid];
    const league = st.season.leagues[cid][div];
    const sorted = C().sortTable(league.table);
    const relegN = country.relegated;

    el.innerHTML =
      "<h2>Classificação</h2>" +
      '<div class="card"><div class="row">' +
        '<select id="sel-c">' + Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (c.id === cid ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
        '<select id="sel-d"><option value="A"' + (div === "A" ? " selected" : "") + ">" + esc(country.leagueNameA) + '</option><option value="B"' + (div === "B" ? " selected" : "") + ">" + esc(country.leagueNameB) + "</option></select>" +
        '<span class="muted">Rodada ' + league.currentRound + "/" + league.rounds.length + "</span>" +
      "</div></div>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr>' +
      "<th>#</th><th>Clube</th><th class='num'>P</th><th class='num'>J</th><th class='num'>V</th><th class='num'>E</th><th class='num'>D</th><th class='num'>GP</th><th class='num'>GC</th><th class='num'>SG</th>" +
      "</tr></thead><tbody>" +
      sorted.map((r, i) => {
        const c = world.clubs[r.clubId];
        let zone = "";
        if (div === "A" && i < 4) zone = "zone-blue";
        else if (div === "A" && i < 6) zone = "zone-yellow";
        if (i >= sorted.length - relegN && div === "A") zone = "zone-red";
        if (div === "B" && i < relegN) zone = "zone-blue";
        const me = r.clubId === G().userClub().id ? " me" : "";
        return '<tr class="' + zone + me + '" data-club="' + c.id + '" style="cursor:pointer"><td>' + (i + 1) + '</td><td><span class="club-cell">' + UI().crestImg(c, 20) + esc(c.name) + "</span></td>" +
          '<td class="num"><b>' + r.pts + '</b></td><td class="num">' + r.j + '</td><td class="num">' + r.v + '</td><td class="num">' + r.e + '</td><td class="num">' + r.d + '</td><td class="num">' + r.gp + '</td><td class="num">' + r.gc + '</td><td class="num">' + r.sg + "</td></tr>";
      }).join("") +
      "</tbody></table>" +
      '<p class="muted" style="font-size:.78rem;margin-top:8px">' +
      (div === "A" ? "Azul: zona continental · Amarelo: pré-continental · Vermelho: rebaixamento (" + relegN + ")" : "Azul: acesso à Série A (" + relegN + ")") + "</p></div>";

    el.querySelector("#sel-c").addEventListener("change", e => { S._tblCountry = e.target.value; S.table(el); });
    el.querySelector("#sel-d").addEventListener("change", e => { S._tblDiv = e.target.value; S.table(el); });
    el.querySelectorAll("[data-club]").forEach(tr => tr.addEventListener("click", () => UI().goto("clubView", { clubId: tr.dataset.club })));
  };

  // ---------------- COPA ----------------
  S.cup = function (el) {
    const st = G().state;
    const world = st.world;
    const userCid = G().userClub().countryId;
    const cid = S._cupCountry || userCid;
    const cup = st.season.cups[cid];

    // linha de um time no confronto (destaca o classificado)
    function teamLine(club, goals, win) {
      return '<div class="tie-team' + (win ? " tw" : "") + '">' + UI().crestImg(club, 16) +
        '<span class="tt-name">' + esc(club.shortName || club.name) + "</span>" +
        '<span class="tt-score">' + (goals != null ? goals : "") + "</span></div>";
    }
    function tieCard(t) {
      const h = world.clubs[t.home], a = world.clubs[t.away];
      if (!h || !a) return "";
      const played = t.winner != null;
      const pen = played && t.penalties ? '<div class="tie-pen">pênaltis' + (t.shootout ? " " + t.shootout.scoreH + "-" + t.shootout.scoreA : "") + "</div>" : "";
      const mine = t.home === G().userClub().id || t.away === G().userClub().id;
      return '<div class="tie-card' + (mine ? " tie-mine" : "") + '">' +
        teamLine(h, played ? t.gh : null, played && t.winner === t.home) +
        teamLine(a, played ? t.ga : null, played && t.winner === t.away) + pen + "</div>";
    }

    // colunas do chaveamento: fases já jogadas (history) + fase atual
    const cols = cup.history.map(hh => ({ phase: hh.phase, ties: hh.results }));
    if (!cup.championId && cup.ties.length) cols.push({ phase: cup.phase, ties: cup.ties, current: true });
    cols.sort((a, b) => a.phase - b.phase);

    let bracket = cols.map(col =>
      '<div class="bracket-col">' +
        '<div class="bracket-phase">' + esc(C().CUP_PHASES[col.phase] || ("Fase " + col.phase)) + (col.current ? ' <span class="live-dot">●</span>' : "") + "</div>" +
        col.ties.map(tieCard).join("") + "</div>").join("");
    if (cup.championId) {
      const champ = world.clubs[cup.championId];
      bracket += '<div class="bracket-col"><div class="bracket-phase">Campeão</div>' +
        '<div class="champ-card">🏆<div>' + UI().crestImg(champ, 30) + "<b>" + esc(champ.name) + "</b></div></div></div>";
    }

    el.innerHTML = "<h2>Copa nacional</h2>" +
      '<div class="card"><div class="row"><select id="sel-cup">' +
      Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (c.id === cid ? " selected" : "") + ">" + esc(world.countries[c.id].cupName) + "</option>").join("") +
      "</select></div></div>" +
      (bracket ? '<div class="card scroll-x"><div class="bracket">' + bracket + "</div></div>"
        : '<div class="card"><p class="muted">O mata-mata ainda não começou.</p></div>');
    el.querySelector("#sel-cup").addEventListener("change", e => { S._cupCountry = e.target.value; S.cup(el); });
  };

  // ---------------- RANKING DE TÉCNICOS (§16/§25) ----------------
  function aiCoachName(club) {
    const rng = U.createRng(U.hashString(club.id + "|coachname"));
    return window.TF.names.randomName(club.nation || club.countryId, rng);
  }
  // célula de variação de posição no ranking (§4.5)
  function rankMoveCell(prevPos, pos) {
    if (!prevPos) return '<span class="muted">novo</span>';
    const d = prevPos - pos;
    if (d > 0) return '<span class="rk-up" title="Subiu ' + d + '">▲ ' + d + "</span>";
    if (d < 0) return '<span class="rk-down" title="Caiu ' + (-d) + '">▼ ' + (-d) + "</span>";
    return '<span class="muted" title="Manteve">=</span>';
  }
  S.ranking = function (el) {
    const st = G().state;
    const world = st.world;
    const club = G().userClub();
    const cid = S._rankCountry || club.countryId;
    const country = world.countries[cid];
    const ctxBase = { leagueNameA: country.leagueNameA, leagueNameB: country.leagueNameB, cupName: country.cupName };
    const trow = {}, avg = {};
    for (const div of ["A", "B"]) {
      const table = st.season.leagues[cid][div].table;
      for (const r of table) trow[r.clubId] = r;
      const dids = div === "A" ? country.clubIdsA : country.clubIdsB;
      avg[div] = dids.reduce((a, id) => a + world.clubs[id].rating, 0) / (dids.length || 1);
    }
    const ids = (country.clubIdsA || []).concat(country.clubIdsB || []);
    const prev = (st.rankPrev && st.rankPrev[cid]) || {};
    const rows = ids.map(id => {
      const c = world.clubs[id];
      const isUser = id === club.id;
      const r = trow[id] || { j: 0, v: 0, e: 0, d: 0 };
      const ctx = Object.assign({ leagueAvgRating: avg[c.division] }, ctxBase);
      return { c, isUser, name: isUser ? st.coach.name : aiCoachName(c), t: C().titleBreakdown(c, ctxBase), r, points: C().coachPrestige(c, r, ctx) };
    }).sort((a, b) => b.points - a.points || a.c.name.localeCompare(b.c.name)); // §4.4 empate → alfabético (sem viés de clube)
    rows.forEach((r, i) => { r.pos = i + 1; });

    const titleCell = t => t.total
      ? (t.league ? '<span title="Ligas">🏆' + t.league + "</span> " : "") + (t.cup ? '<span title="Copas">🏅' + t.cup + "</span> " : "") + (t.other ? '<span title="Outros">🎖️' + t.other + "</span>" : "")
      : '<span class="muted">Nenhum título</span>';

    el.innerHTML =
      "<h2>Ranking de técnicos</h2>" +
      '<div class="card"><div class="row"><select id="rk-c">' +
        Object.values(world.countries).map(co => '<option value="' + co.id + '"' + (co.id === cid ? " selected" : "") + ">" + esc(co.name) + "</option>").join("") +
      '</select><span class="muted" style="font-size:.8rem">Base igual para todos · sobe/desce pelo desempenho vs. expectativa · troféus na carreira</span></div></div>' +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr>' +
        "<th>#</th><th>Var.</th><th>Técnico</th><th>Clube</th><th class='num'>J</th><th class='num'>V</th><th class='num'>E</th><th class='num'>D</th><th>Troféus</th><th class='num'>Prestígio</th>" +
      "</tr></thead><tbody>" +
      rows.map(r =>
        '<tr class="' + (r.isUser ? "me" : "") + '"><td>' + r.pos + "º</td>" +
          "<td>" + rankMoveCell(prev[r.c.id], r.pos) + "</td>" +
          "<td><b>" + esc(r.name) + "</b></td>" +
          '<td><span class="club-cell">' + UI().crestImg(r.c, 18) + esc(r.c.shortName || r.c.name) + "</span></td>" +
          '<td class="num">' + r.r.j + '</td><td class="num">' + r.r.v + '</td><td class="num">' + r.r.e + '</td><td class="num">' + r.r.d + "</td>" +
          "<td style='white-space:nowrap'>" + titleCell(r.t) + "</td>" +
          '<td class="num"><b>' + r.points + "</b></td></tr>").join("") +
      "</tbody></table></div>";
    el.querySelector("#rk-c").addEventListener("change", e => { S._rankCountry = e.target.value; S.ranking(el); });
  };

  // ---------------- VISÃO GERAL (Dashboard) ----------------
  // Reúne os próximos 10 jogos do usuário a partir do calendário da temporada.
  function upcomingFor(st, club, limit) {
    const world = st.world;
    const league = st.season.leagues[club.countryId][club.division];
    const out = [];
    for (let i = st.season.slotIndex; i < st.season.slots.length && out.length < limit; i++) {
      const slot = st.season.slots[i];
      if (slot.type === "league") {
        const round = league.rounds[slot.round];
        if (!round) continue;
        const f = round.find(([h, a]) => h === club.id || a === club.id);
        if (f) out.push({ comp: league.name, sub: U.formatRoundLabel(slot), home: f[0], away: f[1], isHome: f[0] === club.id });
      } else if (slot.type === "cup") {
        const cup = st.season.cups[club.countryId];
        const cupName = world.countries[club.countryId].cupName;
        if (cup.phase === slot.phase && !cup.championId) {
          const t = cup.ties.find(t => t.home === club.id || t.away === club.id);
          if (t) out.push({ comp: cupName, sub: cup.phaseName, home: t.home, away: t.away, isHome: t.home === club.id });
        } else if (!cup.championId && slot.phase >= cup.phase) {
          out.push({ comp: cupName, sub: C().CUP_PHASES[slot.phase] || "", home: null, away: null });
        }
      }
    }
    return out;
  }

  S.dashboard = function (el) {
    const st = G().state;
    const world = st.world;
    const club = G().userClub();
    const league = st.season.leagues[club.countryId][club.division];
    const upcoming = upcomingFor(st, club, 10);
    const sorted = C().sortTable(league.table);
    const myPos = sorted.findIndex(r => r.clubId === club.id) + 1;
    const myRow = sorted[myPos - 1] || { pts: 0, j: 0, v: 0, e: 0, d: 0 };
    const wageBill = club.players.reduce((a, p) => a + (p.wage || 0), 0);
    const next = upcoming[0];

    // hero do próximo jogo
    let heroHtml = '<div class="dash-hero card"><div class="muted">Sem jogos futuros nesta temporada.</div></div>';
    if (next) {
      const h = next.home ? world.clubs[next.home] : null;
      const a = next.away ? world.clubs[next.away] : null;
      heroHtml = '<div class="dash-hero card">' +
        '<div class="dh-comp">' + esc(next.comp) + '<span class="muted"> · ' + esc(next.sub || "") + "</span></div>" +
        (h && a ?
          '<div class="dh-teams">' +
            '<div class="dh-team">' + UI().crestImg(h, 46) + "<span>" + esc(h.shortName || h.name) + "</span></div>" +
            '<div class="dh-vs">' + (next.isHome ? "casa" : "fora") + "</div>" +
            '<div class="dh-team">' + UI().crestImg(a, 46) + "<span>" + esc(a.shortName || a.name) + "</span></div>" +
          "</div>"
          : '<div class="muted" style="padding:12px 0">Aguardando sorteio / classificação.</div>') +
        '<button class="btn primary" id="dash-play">Jogar ▶</button>' +
        "</div>";
    }

    const nextList = upcoming.slice(1, 10).map(u => {
      const opp = u.home ? world.clubs[u.isHome ? u.away : u.home] : null;
      return '<tr><td class="muted" style="font-size:.76rem">' + esc(u.comp) + "<div>" + esc(u.sub || "") + "</div></td>" +
        (opp ? '<td><span class="club-cell">' + UI().crestImg(opp, 18) + esc(opp.shortName || opp.name) + "</span></td><td class='muted' style='text-align:right'>" + (u.isHome ? "casa" : "fora") + "</td>"
          : '<td colspan="2" class="muted">a definir</td>') + "</tr>";
    }).join("");

    const news = (st.news || []).slice(0, 5).map(n =>
      '<div class="dash-news ' + esc(n.type) + '"><div class="dn-title">' + esc(n.title) + '</div><div class="muted">' + esc(n.text) + "</div></div>").join("") || '<div class="muted">Sem notícias.</div>';

    el.innerHTML =
      "<h2>Visão geral</h2>" +
      '<div class="dash-grid">' +
        '<div class="dash-col">' +
          heroHtml +
          '<div class="card"><h3 style="margin-top:0">Próximos jogos</h3><table class="data"><tbody>' +
            (nextList || '<tr><td class="muted">Nada agendado.</td></tr>') + '</tbody></table>' +
            '<button class="btn" id="dash-cal" style="margin-top:8px">Ver calendário completo</button></div>' +
        '</div>' +
        '<div class="dash-col">' +
          '<div class="card dash-quick"><h3 style="margin-top:0">Sua situação</h3>' +
            '<div class="dq-grid">' +
              '<div class="dq"><div class="dq-v">' + (myPos || "-") + 'º</div><div class="dq-l">na ' + esc(league.name) + '</div></div>' +
              '<div class="dq"><div class="dq-v">' + myRow.pts + '</div><div class="dq-l">pontos</div></div>' +
              '<div class="dq"><div class="dq-v">' + myRow.v + "/" + myRow.e + "/" + myRow.d + '</div><div class="dq-l">V/E/D</div></div>' +
              '<div class="dq"><div class="dq-v ' + (club.money < 0 ? "money-neg" : "") + '">' + U.formatMoney(club.money) + '</div><div class="dq-l">caixa</div></div>' +
              '<div class="dq"><div class="dq-v">' + Math.round(club.moralTorcida) + '%</div><div class="dq-l">torcida</div></div>' +
              '<div class="dq"><div class="dq-v">' + U.formatMoney(wageBill) + '</div><div class="dq-l">folha/rodada</div></div>' +
            '</div></div>' +
          '<div class="card"><h3 style="margin-top:0">Notícias recentes</h3>' + news +
            '<button class="btn" id="dash-news" style="margin-top:8px">Todas as notícias</button></div>' +
        '</div>' +
      '</div>';

    const bPlay = el.querySelector("#dash-play"); if (bPlay) bPlay.addEventListener("click", () => UI().advance());
    el.querySelector("#dash-cal").addEventListener("click", () => UI().goto("calendar"));
    el.querySelector("#dash-news").addEventListener("click", () => UI().goto("news"));
  };

  // ---------------- JOGOS / CALENDÁRIO ----------------
  S.calendar = function (el) {
    const st = G().state;
    const world = st.world;
    const club = G().userClub();
    const upcoming = upcomingFor(st, club, 30);
    const log = st.matchLog || [];

    function resultBadge(m) {
      const isHome = m.home === club.id;
      const gf = isHome ? m.gh : m.ga, ga = isHome ? m.ga : m.gh;
      let r = gf > ga ? "V" : gf < ga ? "D" : "E";
      if (m.kind === "cup" && gf === ga && m.winner) r = m.winner === club.id ? "V" : "D"; // disputa
      return '<span class="res-badge res-' + r + '">' + r + "</span>";
    }
    function fixtureRow(comp, sub, homeId, awayId, scoreHtml, badge) {
      const h = homeId ? world.clubs[homeId] : null, a = awayId ? world.clubs[awayId] : null;
      const compCell = '<td class="muted cal-comp">' + esc(comp) + "<div>" + esc(sub || "") + "</div></td>";
      if (!h || !a) return "<tr>" + compCell + '<td colspan="4" class="muted">a definir (sorteio / classificação)</td></tr>';
      const mineH = homeId === club.id, mineA = awayId === club.id;
      return "<tr>" + compCell +
        '<td class="cal-h' + (mineH ? " me-cell" : "") + '"><span class="club-cell" style="justify-content:flex-end">' + esc(h.shortName || h.name) + UI().crestImg(h, 18) + "</span></td>" +
        '<td class="cal-score">' + scoreHtml + "</td>" +
        '<td class="cal-a' + (mineA ? " me-cell" : "") + '"><span class="club-cell">' + UI().crestImg(a, 18) + esc(a.shortName || a.name) + "</span></td>" +
        "<td>" + (badge || "") + "</td></tr>";
    }

    const playedRows = log.map(m => {
      const pen = m.shootout ? ' <span class="muted" style="font-size:.72rem">(' + m.shootout.scoreH + "-" + m.shootout.scoreA + " pên)</span>" : "";
      return fixtureRow(m.comp, m.kind === "cup" ? m.round : "Rodada " + m.round, m.home, m.away, "<b>" + m.gh + " x " + m.ga + "</b>" + pen, resultBadge(m));
    }).join("");
    const upcomingRows = upcoming.map(u => fixtureRow(u.comp, u.sub, u.home, u.away, '<span class="muted">x</span>', "")).join("");

    el.innerHTML = "<h2>Calendário</h2>" +
      '<div class="card scroll-x"><h3 style="margin-top:0">Resultados</h3>' +
        (playedRows ? '<table class="data cal-table"><tbody>' + playedRows + "</tbody></table>" : '<p class="muted">Nenhum jogo disputado ainda nesta temporada.</p>') + "</div>" +
      '<div class="card scroll-x"><h3 style="margin-top:0">Próximos jogos</h3>' +
        (upcomingRows ? '<table class="data cal-table"><tbody>' + upcomingRows + "</tbody></table>" : '<p class="muted">Sem jogos futuros nesta temporada.</p>') + "</div>";
  };

  // ---------------- CLUBES (navegar por todos os times) ----------------
  S.clubs = function (el) {
    const world = G().state.world;
    const cid = S._cbCountry || G().userClub().countryId;
    const div = S._cbDiv || "A";
    const country = world.countries[cid];
    const ids = div === "A" ? country.clubIdsA : country.clubIdsB;
    const clubs = ids.map(id => world.clubs[id]).sort((a, b) => b.rating - a.rating);
    el.innerHTML =
      "<h2>Clubes</h2>" +
      '<div class="card"><div class="row">' +
        '<select id="cb-c">' + Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (c.id === cid ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
        '<select id="cb-d"><option value="A"' + (div === "A" ? " selected" : "") + '>Série A</option><option value="B"' + (div === "B" ? " selected" : "") + ">Série B</option></select>" +
      "</div></div>" +
      '<div class="club-grid">' +
      clubs.map(c =>
        '<div class="club-pick" data-club="' + c.id + '">' + UI().crestImg(c, 34) +
        '<div><div class="cname">' + esc(c.name) + '</div><div class="cinfo">Força ' + c.rating + " · " + c.players.length + " jogadores</div></div></div>").join("") +
      "</div>";
    el.querySelector("#cb-c").addEventListener("change", e => { S._cbCountry = e.target.value; S.clubs(el); });
    el.querySelector("#cb-d").addEventListener("change", e => { S._cbDiv = e.target.value; S.clubs(el); });
    el.querySelectorAll("[data-club]").forEach(d => d.addEventListener("click", () => UI().goto("clubView", { clubId: d.dataset.club })));
  };

  S.clubView = function (el, params) {
    const world = G().state.world;
    const club = world.clubs[params && params.clubId];
    if (!club) { UI().goto("clubs"); return; }
    const isMine = club.id === G().userClub().id;
    const win = G().transferWindowInfo();
    const players = club.players.slice().sort((a, b) => {
      const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
      return order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating;
    });
    el.innerHTML =
      '<h2><button class="btn small" id="cv-back">←</button> ' + UI().crestImg(club, 30) + " " + esc(club.name) +
      ' <span class="muted" style="font-size:.85rem">' + esc(world.countries[club.countryId].name) + " — Série " + club.division + " · Força " + club.rating + " · " + esc(club.stadium) + " (" + club.capacity.toLocaleString("pt-BR") + ")</span></h2>" +
      (!isMine ? '<p class="' + (win.open ? "text-green" : "muted") + '" style="margin-bottom:10px">' + esc(win.message) + "</p>" : "") +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr>' +
      "<th>Pos</th><th>Nome</th><th class='num'>Idade</th><th class='num'>Força</th><th>Características</th><th class='num'>Contrato</th><th class='num'>Pedida</th>" + (!isMine ? "<th></th>" : "") +
      "</tr></thead><tbody>" +
      players.map(p =>
        '<tr data-p="' + p.id + '" style="cursor:pointer">' +
        "<td>" + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td>" +
        '<td class="num">' + p.age + '</td><td class="num">' + UI().ratingBadge(p.rating) + "</td>" +
        "<td>" + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
        '<td class="num">' + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "<span class='money-neg'>livre</span>") + "</td>" +
        '<td class="num">' + (p.contractYears > 0 ? money(T().askingPrice(p, club)) : "—") + "</td>" +
        (!isMine ? (T().isSellable(p, club, G().state.season.year) ? '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td>' : '<td class="muted" style="font-size:.76rem">Não à venda</td>') : "") +
        "</tr>").join("") +
      "</tbody></table></div>";
    el.querySelector("#cv-back").addEventListener("click", () => UI().goto("clubs"));
    el.querySelectorAll("[data-offer]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); offerModal(b.dataset.offer, el); }));
    el.querySelectorAll("[data-p]").forEach(tr => tr.addEventListener("click", () => anyPlayerModal(tr.dataset.p)));
  };

  /* Ficha de um jogador de qualquer clube, com opção de proposta. */
  function anyPlayerModal(pid) {
    const world = G().state.world;
    const p = world.players[pid];
    if (!p) return;
    const owner = world.clubs[p.clubId];
    const isMine = owner && owner.id === G().userClub().id;
    if (isMine) { playerModal(pid); return; }
    const sk = p.skills;
    const skillRows = [
      ["Goleiro", sk.gk], ["Velocidade", sk.speed], ["Passe", sk.pass], ["Armação", sk.playmaking],
      ["Desarme", sk.tackle], ["Finalização", sk.finishing], ["Técnica", sk.technique]
    ].map(([n, v]) => "<tr><td>" + n + '</td><td class="num">' + Math.round(v) + "</td><td>" + barHtml(v, "var(--accent)") + "</td></tr>").join("");
    UI().modal(
      "<h3>" + UI().posBadge(p.pos) + " " + esc(p.name) + star(p) + " " + UI().ratingBadge(p.rating) + "</h3>" +
      '<div class="grid2">' +
        '<div><table class="data">' + skillRows + "</table></div>" +
        "<div>" +
          "<p>Clube: <b>" + esc(owner ? owner.name : "Livre") + "</b></p>" +
          "<p>Idade: <b>" + p.age + "</b> · Nação: <b>" + esc(p.nation) + "</b></p>" +
          "<p>Características: " + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</p>" +
          "<p>Contrato: <b>" + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "livre") + "</b></p>" +
          (p.contractYears > 0 ? "<p>Pedida do clube: <b>" + money(T().askingPrice(p, owner)) + "</b></p>" : "") +
        "</div>" +
      "</div>" +
      '<div class="actions"><button class="btn" data-x>Fechar</button><button class="btn primary" data-off>Fazer proposta</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-off]").addEventListener("click", () => { ov.remove(); offerModal(pid); });
      });
  }

  // ---------------- TRANSFERÊNCIAS ----------------
  S.transfers = function (el) {
    const st = G().state;
    const world = st.world;
    const club = G().userClub();
    const tab = S._trTab || "buscar";

    let inner = "";
    if (tab === "buscar") {
      const q = S._trQuery || { name: "", pos: "", country: "", maxAge: "", order: "rating", avail: "all" };
      const AVAIL = [["all", "Todos disponíveis"], ["sale", "À venda"], ["free", "Livres"], ["expiring", "Último ano"], ["young", "Jovens"]];
      const all = [];
      for (const c of Object.values(world.clubs)) {
        if (c.id === club.id) continue;
        for (const p of c.players) {
          if (!T().isSellable(p, c, st.season.year)) continue; // §3.2 só negociáveis (filtrado no núcleo)
          if (q.name && !p.name.toLowerCase().includes(q.name.toLowerCase())) continue;
          if (q.pos && p.pos !== q.pos) continue;
          if (q.country && c.countryId !== q.country) continue;
          if (q.maxAge && p.age > parseInt(q.maxAge, 10)) continue;
          if (q.avail === "sale" && !(p.forSale || p.contractYears <= 0)) continue;
          if (q.avail === "free" && p.contractYears > 0) continue;
          if (q.avail === "expiring" && p.contractYears !== 1) continue;
          if (q.avail === "young" && p.age > 21) continue;
          all.push({ p, c });
        }
      }
      all.sort((x, y) => q.order === "value" ? x.p.value - y.p.value : q.order === "age" ? x.p.age - y.p.age : y.p.rating - x.p.rating);
      const list = all.slice(0, 60);
      inner =
        '<div class="card"><div class="row">' +
          '<input id="f-name" placeholder="Nome..." value="' + esc(q.name) + '" style="width:150px">' +
          '<select id="f-pos"><option value="">Todas posições</option>' + window.TF.world.POSITIONS.map(p => '<option' + (q.pos === p ? " selected" : "") + ">" + p + "</option>").join("") + "</select>" +
          '<select id="f-country"><option value="">Todos países</option>' + Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (q.country === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
          '<input id="f-age" type="number" placeholder="Idade máx" value="' + esc(q.maxAge) + '" style="width:96px">' +
          '<select id="f-order"><option value="rating"' + (q.order === "rating" ? " selected" : "") + '>Força</option><option value="value"' + (q.order === "value" ? " selected" : "") + '>Mais baratos</option><option value="age"' + (q.order === "age" ? " selected" : "") + ">Mais jovens</option></select>" +
          '<button class="btn small" id="f-go">Filtrar</button>' +
        '</div><div class="chip-row" style="margin-top:8px">' +
          AVAIL.map(x => '<button class="chip' + (q.avail === x[0] ? " active" : "") + '" data-avail="' + x[0] + '">' + esc(x[1]) + "</button>").join("") +
        "</div></div>" +
        (list.length ?
          '<p class="muted" style="font-size:.82rem;margin:2px 2px 8px">' + all.length + " jogador(es) disponível(is)" + (all.length > 60 ? " · mostrando os 60 primeiros" : "") + "</p>" +
          '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th class="num">Força</th><th>Características</th><th>Clube</th><th class="num">Pedida</th><th></th></tr></thead><tbody>' +
          list.map(({ p, c }) =>
            "<tr><td>" + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td><td class='num'>" + p.age + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td>" +
            "<td>" + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
            '<td><span class="club-cell">' + UI().crestImg(c, 18) + esc(c.shortName) + "</span></td>" +
            "<td class='num'>" + (p.contractYears > 0 ? money(T().askingPrice(p, c)) : "<span class='money-neg'>livre</span>") + "</td>" +
            '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td></tr>').join("") +
          "</tbody></table></div>"
          : '<div class="card empty-state"><div class="es-icon">🔍</div><p class="es-title">Nenhum jogador disponível</p><p class="muted">Ajuste os filtros ou consulte novamente em outro momento da janela.</p></div>');
    } else if (tab === "recebidas") {
      const bids = st.pendingBids || [];
      inner = '<div class="card">' +
        "<h3 style='margin-top:0'>Propostas enviadas (aguardando resposta)</h3>" +
        (bids.length ? '<table class="data"><tbody>' + bids.map(b => {
          const owner = world.clubs[b.ownerClubId];
          return "<tr><td><b>" + esc(b.name) + "</b></td><td class='muted'>" + esc(owner ? owner.name : "-") + "</td><td class='num'>" + money(b.value) + "</td><td class='muted'>responde na próxima rodada</td></tr>";
        }).join("") + "</tbody></table>" : "<p class='muted'>Nenhuma proposta enviada. As respostas dos clubes chegam sempre na rodada seguinte.</p>") +
        "</div>" +
        '<div class="card mb0"><h3 style="margin-top:0">Propostas recebidas pelos seus jogadores</h3>' +
        (st.aiOffers.length ? '<table class="data"><thead><tr><th>Jogador</th><th>Clube interessado</th><th class="num">Oferta</th><th></th></tr></thead><tbody>' +
          st.aiOffers.map((o, i) => {
            const p = club.players.find(x => x.id === o.playerId);
            const buyer = world.clubs[o.clubId];
            if (!p || !buyer) return "";
            return "<tr><td><b>" + esc(p.name) + "</b>" + star(p) + " " + UI().ratingBadge(p.rating) + '</td><td><span class="club-cell">' + UI().crestImg(buyer, 18) + esc(buyer.name) + "</span></td>" +
              "<td class='num'><b>" + money(o.value) + "</b></td>" +
              '<td><button class="btn small primary" data-acc="' + i + '">Aceitar</button> <button class="btn small danger" data-rej="' + i + '">Recusar</button></td></tr>';
          }).join("") + "</tbody></table>"
          : "<p class='muted'>Nenhuma proposta recebida no momento.</p>") +
        "</div>";
    } else {
      // livres
      const free = [];
      for (const c of Object.values(world.clubs)) for (const p of c.players) if (p.contractYears <= 0 && c.id !== club.id) free.push({ p, c });
      free.sort((x, y) => y.p.rating - x.p.rating);
      inner = '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th class="num">Força</th><th>Último clube</th><th class="num">Salário pedido</th><th></th></tr></thead><tbody>' +
        free.slice(0, 40).map(({ p, c }) =>
          "<tr><td>" + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td><td class='num'>" + p.age + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td>" +
          "<td>" + esc(c.shortName) + "</td><td class='num'>" + money(T().wageDemand(p, club)) + "/jogo</td>" +
          '<td><button class="btn small" data-offer="' + p.id + '">Contratar</button></td></tr>').join("") +
        "</tbody></table></div>";
    }

    const win = G().transferWindowInfo();
    el.innerHTML =
      "<h2>Transferências</h2>" +
      '<p class="' + (win.open ? "text-green" : "money-neg") + '" style="margin-bottom:10px;font-weight:600">' + esc(win.message) +
      (win.open ? "" : " Jogadores livres podem ser contratados a qualquer momento.") + "</p>" +
      '<div class="row" style="margin-bottom:12px">' +
        '<button class="btn' + (tab === "buscar" ? " primary" : "") + '" data-tab="buscar">Buscar jogadores</button>' +
        '<button class="btn' + (tab === "recebidas" ? " primary" : "") + '" data-tab="recebidas">Propostas' + ((st.aiOffers.length + (st.pendingBids ? st.pendingBids.length : 0)) ? " (" + (st.aiOffers.length + (st.pendingBids ? st.pendingBids.length : 0)) + ")" : "") + "</button>" +
        '<button class="btn' + (tab === "livres" ? " primary" : "") + '" data-tab="livres">Sem contrato</button>' +
        '<span class="spacer" style="flex:1"></span><span class="muted">Caixa: <b>' + money(club.money) + "</b></span>" +
      "</div>" + inner;

    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { S._trTab = b.dataset.tab; S.transfers(el); }));
    const readQuery = () => ({
      name: el.querySelector("#f-name").value,
      pos: el.querySelector("#f-pos").value,
      country: el.querySelector("#f-country").value,
      maxAge: el.querySelector("#f-age").value,
      order: el.querySelector("#f-order").value,
      avail: (S._trQuery && S._trQuery.avail) || "all"
    });
    const go = el.querySelector("#f-go");
    if (go) go.addEventListener("click", () => { S._trQuery = readQuery(); S.transfers(el); });
    el.querySelectorAll("[data-avail]").forEach(b => b.addEventListener("click", () => { S._trQuery = Object.assign(readQuery(), { avail: b.dataset.avail }); S.transfers(el); }));
    el.querySelectorAll("[data-offer]").forEach(b => b.addEventListener("click", () => offerModal(b.dataset.offer, el)));
    el.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => {
      const o = st.aiOffers[parseInt(b.dataset.acc, 10)];
      const r = T().acceptAiOffer(world, club, o);
      st.aiOffers = st.aiOffers.filter(x => x !== o);
      if (r.ok) { UI().toast("Venda concluída por " + money(o.value) + "."); G().autoLineup(); }
      UI().render();
    }));
    el.querySelectorAll("[data-rej]").forEach(b => b.addEventListener("click", () => {
      st.aiOffers.splice(parseInt(b.dataset.rej, 10), 1);
      S.transfers(el);
    }));
  };

  function offerModal(pid, el) {
    const world = G().state.world;
    const club = G().userClub();
    const p = world.players[pid];
    if (!p) return;
    const owner = world.clubs[p.clubId];
    if (!T().isSellable(p, owner, G().state.season.year)) { UI().toast("O " + (owner ? owner.name : "clube") + " não pretende vender " + p.name + "."); return; }
    // jogadores com contrato só podem ser negociados com a janela aberta; livres, sempre
    if (p.contractYears > 0) {
      const win = G().transferWindowInfo();
      if (!win.open) { UI().toast(win.message); return; }
    }
    const price = T().askingPrice(p, owner);
    const wage = T().wageDemand(p, club);
    UI().modal(
      "<h3>Proposta por " + esc(p.name) + " " + UI().ratingBadge(p.rating) + "</h3>" +
      "<p class='muted'>" + esc(owner ? owner.name : "Sem clube") + " · pede " + (price ? money(price) : "nada (livre)") + " · salário desejado " + money(wage) + "/jogo</p>" +
      '<div class="row" style="margin-top:10px">' +
        (price ? '<label>Valor: <input type="number" id="o-val" value="' + price + '" step="100000" style="width:150px"></label>' : "") +
        '<label>Salário: <input type="number" id="o-wage" value="' + wage + '" step="100" style="width:130px"></label>' +
        '<label>Contrato: <select id="o-years"><option value="1">1 ano</option><option value="2" selected>2 anos</option></select></label>' +
      "</div>" +
      '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Enviar proposta</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-ok]").addEventListener("click", () => {
          const val = price ? (parseInt(ov.querySelector("#o-val").value, 10) || 0) : 0;
          const w = parseInt(ov.querySelector("#o-wage").value, 10) || 0;
          const y = parseInt(ov.querySelector("#o-years").value, 10);
          const r = G().submitBid(p.id, val, w, y);
          ov.remove();
          if (r.ok) {
            UI().toast("Proposta enviada. O clube responde na próxima rodada.");
            UI().render();
          } else {
            UI().toast(r.reason);
          }
        });
      });
  }

  // ---------------- FINANÇAS ----------------
  S.finance = function (el) {
    const club = G().userClub();
    const wages = F().squadWages(club);
    const sponsor = F().seasonSponsorship(club);
    const sugg = F().suggestedTicketPrice(club);
    el.innerHTML =
      "<h2>Finanças e estádio</h2>" +
      '<div class="grid2">' +
        '<div class="card"><h3 style="margin-top:0">Caixa</h3>' +
          '<p style="font-size:1.8rem;font-weight:800" class="' + (club.money < 0 ? "money-neg" : "text-green") + '">' + money(club.money) + "</p>" +
          "<p class='muted'>Salários por rodada: <b>" + money(wages) + "</b></p>" +
          "<p class='muted'>Patrocínio anual: <b>" + money(sponsor) + "</b> (pago no início da temporada)</p>" +
          "<p class='muted'>Moral da torcida: " + barHtml(club.moralTorcida) + " " + Math.round(club.moralTorcida) + "%</p>" +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">Ingressos</h3>' +
          "<p class='muted'>Preço sugerido: " + money(sugg) + "</p>" +
          '<div class="row"><label>Preço do ingresso: <input type="number" id="tk" value="' + club.ticketPrice + '" min="5" max="500" style="width:110px"></label>' +
          '<button class="btn small" id="tk-set">Aplicar</button></div>' +
          "<p class='muted' style='margin-top:8px;font-size:.83rem'>Preços muito altos afastam o público. Em decisões ou com a torcida animada, dá para cobrar mais.</p>" +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">Estádio: ' + esc(club.stadium) + "</h3>" +
          "<p>Capacidade: <b>" + club.capacity.toLocaleString("pt-BR") + "</b> lugares</p>" +
          (club.stadiumWorks ? "<p class='text-gold'>Obras em andamento: +" + club.stadiumWorks.seats.toLocaleString("pt-BR") + " lugares (" + club.stadiumWorks.weeksLeft + " semanas restantes)</p>" :
            '<div class="row">' + [5000, 10000, 20000].map(s =>
              '<button class="btn small" data-exp="' + s + '">+' + (s / 1000) + " mil (" + money(F().stadiumExpansionCost(s)) + ")</button>").join("") + "</div>") +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">Gramado</h3><p>Condição atual: <b>' + esc(club.grass) + "</b></p>" +
        "<p class='muted' style='font-size:.83rem'>Gramados ruins atrapalham jogadores técnicos. A condição muda ao longo da temporada.</p></div>" +
      "</div>";

    el.querySelector("#tk-set").addEventListener("click", () => {
      const v = U.clamp(parseInt(el.querySelector("#tk").value, 10) || sugg, 5, 500);
      club.ticketPrice = v;
      UI().toast("Preço do ingresso: " + money(v));
    });
    el.querySelectorAll("[data-exp]").forEach(b => b.addEventListener("click", () => {
      const r = F().orderStadiumExpansion(club, parseInt(b.dataset.exp, 10));
      if (r.ok) { UI().toast("Obras encomendadas por " + money(r.cost) + "."); UI().render(); }
      else UI().toast(r.reason);
    }));
  };

  // ---------------- NOTÍCIAS ----------------
  var NEWS_ICONS = { title: "🏆", transfer: "💱", finance: "💰", match: "⚽", board: "🏛️", warning: "⚠️", info: "📰" };
  var NEWS_FILTERS = [["all", "Tudo"], ["title", "Títulos"], ["transfer", "Transferências"], ["finance", "Finanças"], ["match", "Jogos"]];
  S.news = function (el) {
    const news = G().state.news || [];
    const f = S._newsFilter || "all";
    const shown = f === "all" ? news : news.filter(n => n.type === f);
    el.innerHTML = "<h2>Notícias</h2>" +
      '<div class="card news-filters">' +
        NEWS_FILTERS.map(x => '<button class="chip' + (f === x[0] ? " active" : "") + '" data-nf="' + x[0] + '">' + esc(x[1]) + "</button>").join("") +
      "</div>" +
      (shown.length ?
        '<div class="inbox">' + shown.map(n =>
          '<div class="inbox-item ' + esc(n.type) + '"><div class="ib-icon">' + (NEWS_ICONS[n.type] || "📰") + "</div>" +
            '<div class="ib-body"><div class="ib-top"><span class="ib-title">' + esc(n.title) + '</span>' +
              '<span class="ib-date muted">' + esc(U.formatDateLabel(n.season, n.week)) + "</span></div>" +
              '<div class="muted ib-text">' + esc(n.text) + "</div></div></div>").join("") + "</div>"
        : '<p class="muted">Nenhuma notícia' + (f !== "all" ? " nesta categoria" : " ainda") + ".</p>");
    el.querySelectorAll("[data-nf]").forEach(b => b.addEventListener("click", () => { S._newsFilter = b.dataset.nf; S.news(el); }));
  };

  // ---------------- TÉCNICO ----------------
  function coachLevel(points) {
    if (points >= 300) return "Lenda";
    if (points >= 180) return "Ídolo";
    if (points >= 90) return "Renomado";
    if (points >= 35) return "Respeitado";
    return "Promissor";
  }
  S.coach = function (el) {
    const st = G().state;
    const c = st.coach;
    const club = G().userClub();
    const titles = c.titles || [];
    // agrupa por competição
    const byComp = {};
    for (const t of titles) { (byComp[t.name] = byComp[t.name] || []).push(t.year); }
    const trophies = Object.keys(byComp).map(name => ({ name, years: byComp[name].sort((a, b) => a - b), count: byComp[name].length }))
      .sort((a, b) => b.count - a.count);

    el.innerHTML =
      "<h2>Perfil do técnico</h2>" +
      '<div class="profile-head card">' +
        '<div class="ph-avatar">🎩</div>' +
        '<div class="ph-info"><div class="ph-name">' + esc(c.name) + '</div>' +
          '<div class="muted">' + U.joinDot(coachLevel(c.points), esc(club.name), U.formatSeasonLabel(st.season.year)) + "</div>" +
          '<div class="ph-rep"><span class="muted">Reputação</span>' + barHtml(c.reputation, "var(--gold)") + "<span>" + Math.round(c.reputation) + "/100</span></div>" +
        "</div>" +
        '<div class="ph-stats">' +
          '<div class="ph-stat"><div class="v">' + titles.length + '</div><div class="l">títulos</div></div>' +
          '<div class="ph-stat"><div class="v">' + Math.round(c.points) + '</div><div class="l">pontos</div></div>' +
        "</div>" +
      "</div>" +
      '<h3>🏆 Sala de troféus</h3>' +
      (trophies.length ?
        '<div class="trophy-grid">' + trophies.map(t =>
          '<div class="trophy-card"><div class="tc-cup">🏆</div><div class="tc-name">' + esc(t.name) + '</div>' +
            '<div class="tc-years">' + t.years.join(", ") + "</div>" +
            (t.count > 1 ? '<div class="tc-count">×' + t.count + "</div>" : "") + "</div>").join("") + "</div>"
        : '<div class="card empty-trophies"><div style="font-size:2.4rem">🗄️</div><p class="muted">A sala de troféus está vazia. Conquiste títulos para preenchê-la!</p></div>');
  };

  // ---------------- OPÇÕES ----------------
  S.options = function (el) {
    el.innerHTML =
      "<h2>Opções</h2>" +
      '<div class="card"><div class="row">' +
        '<button class="btn primary" id="op-save">💾 Salvar jogo</button>' +
        '<button class="btn" id="op-sound">' + (window.TF.sounds.enabled ? "🔊 Som: ligado" : "🔇 Som: desligado") + "</button>" +
        '<button class="btn" id="op-theme">' + (UI().currentTheme() === "light" ? "🌙 Mudar para tema escuro" : "☀️ Mudar para tema claro") + "</button>" +
        '<button class="btn danger" id="op-menu">Sair para o menu</button>' +
      "</div>" +
      "<p class='muted' style='margin-top:10px;font-size:.85rem'>O jogo salva automaticamente a cada rodada. O save fica no navegador (localStorage).</p></div>";
    el.querySelector("#op-save").addEventListener("click", () => {
      const r = G().save(1);
      UI().toast(r.ok ? "Jogo salvo!" : r.reason);
    });
    el.querySelector("#op-sound").addEventListener("click", () => { window.TF.sounds.toggle(); S.options(el); });
    el.querySelector("#op-theme").addEventListener("click", () => { UI().toggleTheme(); UI().render(); });
    el.querySelector("#op-menu").addEventListener("click", () => {
      G().save(1);
      G().state.started = false;
      UI().goto("home");
    });
  };

  // ---------------- RELATÓRIO DE FIM DE TEMPORADA ----------------
  S.seasonReport = function (el, report) {
    const world = G().state.world;
    if (!report) { UI().goto("squad"); return; }
    let html = '<div style="max-width:860px;margin:0 auto">' +
      "<h2>🏁 Fim da temporada " + report.year + "</h2>";
    for (const cid of Object.keys(report.awards)) {
      const country = world.countries[cid];
      const a = report.awards[cid];
      html += '<div class="card"><h3 style="margin-top:0">' + esc(country.name) + "</h3>";
      if (a.golden && a.golden.player) html += "<p>🥇 <b>Bola de Ouro:</b> " + esc(a.golden.player.name) + " (" + esc(a.golden.club.name) + ") — nota média " + a.golden.avg.toFixed(2) + "</p>";
      if (a.topScorer && a.topScorer.player && a.topScorer.goals > 0) html += "<p>⚽ <b>Artilheiro:</b> " + esc(a.topScorer.player.name) + " (" + esc(a.topScorer.club.name) + ") — " + a.topScorer.goals + " gols</p>";
      const up = (report.promoted[cid] || []).map(id => world.clubs[id].name).join(", ");
      const down = (report.relegated[cid] || []).map(id => world.clubs[id].name).join(", ");
      html += "<p class='text-green'>⬆ Acesso: " + esc(up) + "</p><p class='money-neg'>⬇ Rebaixados: " + esc(down) + "</p></div>";
    }
    html += '<button class="btn primary" id="rep-ok" style="width:100%;padding:14px">Começar temporada ' + (report.year + 1) + " ▶</button></div>";
    el.innerHTML = html;
    el.querySelector("#rep-ok").addEventListener("click", () => UI().goto("squad"));
  };

  Object.assign(window.TF.ui.screens, S);
})();
