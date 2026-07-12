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
      if (r.ok) UI().goto("squad"); else UI().toast(r.reason);
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
              UI().goto("squad");
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

    function tieRow(t, playedInfo) {
      const h = world.clubs[t.home], a = world.clubs[t.away];
      const score = t.winner != null ? " <b>" + t.gh + " x " + t.ga + "</b>" + (t.penalties ? " <span class='muted'>(pên.)</span>" : "") : " <span class='muted'>x</span>";
      return '<tr><td><span class="club-cell">' + UI().crestImg(h, 18) + esc(h.name) + "</span></td><td style='text-align:center'>" + score + "</td>" +
        '<td><span class="club-cell" style="justify-content:flex-end">' + esc(a.name) + UI().crestImg(a, 18) + "</span></td>" +
        (t.winner != null ? "<td class='muted'>→ " + esc(world.clubs[t.winner].name) + "</td>" : "<td></td>") + "</tr>";
    }

    let html = "<h2>Copa nacional</h2>" +
      '<div class="card"><div class="row"><select id="sel-cup">' +
      Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (c.id === cid ? " selected" : "") + ">" + esc(world.countries[c.id].cupName) + "</option>").join("") +
      "</select></div></div>";

    if (cup.championId) {
      const champ = world.clubs[cup.championId];
      html += '<div class="card"><h3 style="margin-top:0">🏆 Campeão</h3><p style="font-size:1.2rem"><span class="club-cell">' + UI().crestImg(champ, 28) + "<b>" + esc(champ.name) + "</b></span></p></div>";
    } else if (cup.ties.length) {
      html += '<div class="card"><h3 style="margin-top:0">' + esc(cup.phaseName) + '</h3><table class="data"><tbody>' + cup.ties.map(t => tieRow(t)).join("") + "</tbody></table></div>";
    }
    for (let i = cup.history.length - 1; i >= 0; i--) {
      const h = cup.history[i];
      html += '<div class="card"><h3 style="margin-top:0">' + esc(C().CUP_PHASES[h.phase]) + ' — resultados</h3><table class="data"><tbody>' + h.results.map(t => tieRow(t)).join("") + "</tbody></table></div>";
    }
    el.innerHTML = html;
    el.querySelector("#sel-cup").addEventListener("change", e => { S._cupCountry = e.target.value; S.cup(el); });
  };

  // ---------------- JOGOS / CALENDÁRIO ----------------
  S.calendar = function (el) {
    const st = G().state;
    const world = st.world;
    const club = G().userClub();
    const league = st.season.leagues[club.countryId][club.division];

    // últimos resultados globais
    let lastHtml = "";
    if (st.lastRoundResults && st.lastRoundResults.length) {
      const mine = st.lastRoundResults.filter(r => r.competition.startsWith(club.countryId));
      lastHtml = '<div class="card"><h3 style="margin-top:0">Última rodada (' + esc(club.countryId) + ')</h3><table class="data"><tbody>' +
        mine.slice(0, 24).map(r => {
          const h = world.clubs[r.home], a = world.clubs[r.away];
          if (!h || !a) return "";
          const me = r.home === club.id || r.away === club.id;
          return "<tr" + (me ? ' class="me"' : "") + '><td class="muted">' + esc(r.competition) + '</td><td><span class="club-cell">' + UI().crestImg(h, 18) + esc(h.shortName) + "</span></td>" +
            "<td style='text-align:center'><b>" + r.gh + " x " + r.ga + "</b></td>" +
            '<td><span class="club-cell">' + UI().crestImg(a, 18) + esc(a.shortName) + "</span></td></tr>";
        }).join("") + "</tbody></table></div>";
    }

    // próximos jogos do usuário
    const upcoming = [];
    for (let i = st.season.slotIndex; i < st.season.slots.length && upcoming.length < 8; i++) {
      const slot = st.season.slots[i];
      if (slot.type === "league") {
        const round = league.rounds[slot.round];
        if (!round) continue;
        const f = round.find(([h, a]) => h === club.id || a === club.id);
        if (f) upcoming.push({ label: league.name, sub: "Rodada " + (slot.round + 1), home: f[0], away: f[1] });
      } else if (slot.type === "cup") {
        const cup = st.season.cups[club.countryId];
        const cupName = world.countries[club.countryId].cupName;
        if (cup.phase === slot.phase && !cup.championId) {
          const t = cup.ties.find(t => t.home === club.id || t.away === club.id);
          if (t) upcoming.push({ label: cupName, sub: cup.phaseName, home: t.home, away: t.away });
        } else if (!cup.championId && slot.phase >= cup.phase) {
          upcoming.push({ label: cupName, sub: C().CUP_PHASES[slot.phase] || "", home: null, away: null });
        }
      }
    }

    el.innerHTML =
      "<h2>Jogos</h2>" +
      '<div class="card"><h3 style="margin-top:0">Próximos compromissos</h3><table class="data"><tbody>' +
      (upcoming.length ? upcoming.map(u => {
        const compCell = '<td><b>' + esc(u.label) + '</b><div class="muted" style="font-size:.76rem">' + esc(u.sub || "") + "</div></td>";
        if (!u.home) return "<tr>" + compCell + '<td colspan="3" class="muted">aguardando sorteio / classificação</td></tr>';
        const h = world.clubs[u.home], a = world.clubs[u.away];
        return "<tr>" + compCell + '<td><span class="club-cell">' + UI().crestImg(h, 18) + esc(h.name) + "</span></td><td style='text-align:center'>x</td><td><span class=\"club-cell\">" + UI().crestImg(a, 18) + esc(a.name) + "</span></td></tr>";
      }).join("") : '<tr><td class="muted">Sem jogos futuros nesta temporada.</td></tr>') +
      "</tbody></table></div>" + lastHtml;
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
        (!isMine ? '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td>' : "") +
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
      const q = S._trQuery || { name: "", pos: "", country: "", maxAge: "", order: "rating" };
      const all = [];
      for (const c of Object.values(world.clubs)) {
        if (c.id === club.id) continue;
        for (const p of c.players) {
          if (q.name && !p.name.toLowerCase().includes(q.name.toLowerCase())) continue;
          if (q.pos && p.pos !== q.pos) continue;
          if (q.country && c.countryId !== q.country) continue;
          if (q.maxAge && p.age > parseInt(q.maxAge, 10)) continue;
          all.push({ p, c });
        }
      }
      all.sort((x, y) => q.order === "value" ? x.p.value - y.p.value : q.order === "age" ? x.p.age - y.p.age : y.p.rating - x.p.rating);
      const list = all.slice(0, 60);
      inner =
        '<div class="card"><div class="row">' +
          '<input id="f-name" placeholder="Nome..." value="' + esc(q.name) + '" style="width:160px">' +
          '<select id="f-pos"><option value="">Todas posições</option>' + window.TF.world.POSITIONS.map(p => '<option' + (q.pos === p ? " selected" : "") + ">" + p + "</option>").join("") + "</select>" +
          '<select id="f-country"><option value="">Todos países</option>' + Object.values(world.countries).map(c => '<option value="' + c.id + '"' + (q.country === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
          '<input id="f-age" type="number" placeholder="Idade máx" value="' + esc(q.maxAge) + '" style="width:100px">' +
          '<select id="f-order"><option value="rating"' + (q.order === "rating" ? " selected" : "") + '>Força</option><option value="value"' + (q.order === "value" ? " selected" : "") + '>Mais baratos</option><option value="age"' + (q.order === "age" ? " selected" : "") + ">Mais jovens</option></select>" +
          '<button class="btn small" id="f-go">Filtrar</button>' +
        "</div></div>" +
        '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th class="num">Força</th><th>Características</th><th>Clube</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
        list.map(({ p, c }) =>
          "<tr><td>" + UI().posBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td><td class='num'>" + p.age + "</td><td class='num'>" + UI().ratingBadge(p.rating) + "</td>" +
          "<td>" + p.traits.map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
          '<td><span class="club-cell">' + UI().crestImg(c, 18) + esc(c.shortName) + "</span></td>" +
          "<td class='num'>" + money(T().askingPrice(p, c)) + "</td>" +
          '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td></tr>').join("") +
        "</tbody></table></div>";
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
    const go = el.querySelector("#f-go");
    if (go) go.addEventListener("click", () => {
      S._trQuery = {
        name: el.querySelector("#f-name").value,
        pos: el.querySelector("#f-pos").value,
        country: el.querySelector("#f-country").value,
        maxAge: el.querySelector("#f-age").value,
        order: el.querySelector("#f-order").value
      };
      S.transfers(el);
    });
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
  S.news = function (el) {
    const news = G().state.news;
    el.innerHTML = "<h2>Notícias</h2>" +
      (news.length ? news.map(n =>
        '<div class="news-item ' + esc(n.type) + '"><div class="nmeta">Temporada ' + n.season + " · Semana " + n.week + '</div><div class="ntitle">' + esc(n.title) + '</div><div class="muted">' + esc(n.text) + "</div></div>").join("")
        : "<p class='muted'>Nenhuma notícia ainda.</p>");
  };

  // ---------------- TÉCNICO ----------------
  S.coach = function (el) {
    const st = G().state;
    const c = st.coach;
    el.innerHTML =
      "<h2>Carreira do técnico</h2>" +
      '<div class="grid2">' +
        '<div class="card"><h3 style="margin-top:0">' + esc(c.name) + "</h3>" +
          "<p>Clube: <b>" + esc(G().userClub().name) + "</b></p>" +
          "<p>Reputação: " + barHtml(c.reputation, "var(--gold)") + " " + Math.round(c.reputation) + "/100</p>" +
          "<p>Pontos no ranking: <b>" + Math.round(c.points) + "</b></p>" +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">🏆 Títulos (' + c.titles.length + ")</h3>" +
          (c.titles.length ? "<ul style='padding-left:18px'>" + c.titles.map(t => "<li>" + esc(t.name) + " — " + t.year + "</li>").join("") + "</ul>" : "<p class='muted'>Nenhum título ainda. Vamos mudar isso!</p>") +
        "</div>" +
      "</div>";
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
