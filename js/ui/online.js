"use strict";
/* Cliente do modo online com salas: lobby, gestão do clube e rodada ao vivo sincronizada. */
(function () {
  const U = window.TF.util;
  const M = window.TF.match;
  const C = window.TF.competitions;
  const T = window.TF.transfers;
  const F = window.TF.finance;

  const st = {
    session: null,     // { code, playerId, token, name }
    lobby: null,
    shared: null,      // snapshot compartilhado (clubes, tabelas, copa...)
    personal: null,    // meus dados (elenco, notícias, propostas)
    view: "gate",      // gate | lobby | game | round
    tab: "rodada",
    live: null,        // { label, matches:[...], events:[[..]], selected, waitingMe }
    chatLog: [],
    es: null
  };

  function esc(s) { return U.esc(s); }
  function money(v) { return U.formatMoney(v); }
  function $(sel) { return document.querySelector(sel); }

  function crest(c, size) {
    const s = size || 22;
    if (c && c.crest) return '<img src="' + esc(c.crest) + '" style="width:' + s + 'px;height:' + s + 'px;object-fit:contain" alt="">';
    return '<span style="display:inline-flex;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:' + Math.round(s * 0.55) + 'px">⚽</span>';
  }
  function rBadge(r) {
    const cls = r >= 82 ? "r-elite" : r >= 72 ? "r-good" : r >= 60 ? "r-avg" : "r-low";
    return '<span class="rating-badge ' + cls + '">' + Math.round(r) + "</span>";
  }
  function pBadge(pos) { return '<span class="pos-badge pos-' + pos + '">' + pos + "</span>"; }
  function bar(v, color) {
    const c = color || (v > 66 ? "var(--green)" : v > 33 ? "var(--yellow)" : "var(--red)");
    return '<span class="bar"><i style="width:' + Math.round(v) + "%;background:" + c + '"></i></span>';
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function modal(html, onMount) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = '<div class="modal">' + html + "</div>";
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (onMount) onMount(overlay);
    return overlay;
  }

  // ---------- comunicação ----------
  async function api(type, data) {
    const r = await fetch("/api/room/" + st.session.code + "/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ playerId: st.session.playerId, token: st.session.token, type }, data || {}))
    });
    return r.json();
  }

  function connectSSE() {
    if (st.es) st.es.close();
    const es = new EventSource("/api/room/" + st.session.code + "/events?playerId=" + st.session.playerId + "&token=" + st.session.token);
    st.es = es;
    es.addEventListener("lobby", e => {
      st.lobby = JSON.parse(e.data);
      if (st.view === "gate") st.view = st.lobby.phase === "lobby" ? "lobby" : "game";
      if (st.lobby.phase === "lobby") st.view = "lobby";
      render();
    });
    es.addEventListener("snapshot", e => {
      const d = JSON.parse(e.data);
      st.shared = d.shared;
      st.personal = d.personal;
      if (st.view === "lobby" || st.view === "gate") st.view = "game";
      if (st.view === "game") render();
    });
    es.addEventListener("started", () => { st.view = "game"; st.tab = "rodada"; });
    es.addEventListener("chat", e => {
      const d = JSON.parse(e.data);
      st.chatLog.push(d);
      if (st.chatLog.length > 60) st.chatLog.shift();
      const box = $("#chat-log");
      if (box) { box.innerHTML = chatHtml(); box.scrollTop = box.scrollHeight; }
    });
    es.addEventListener("info", e => toast(JSON.parse(e.data).text));
    es.addEventListener("roundStart", e => {
      const d = JSON.parse(e.data);
      st.live = {
        label: d.label,
        matches: d.matches.map(m => ({ ...m, gh: 0, ga: 0, min: 0, ph: "first", fin: false, events: [] })),
        selected: Math.max(0, d.matches.findIndex(m => m.humanH === st.session.playerId || m.humanA === st.session.playerId)),
        waitingMe: false
      };
      st.view = "round";
      window.TF.sounds.startAmbience();
      window.TF.sounds.play("kickoff");
      render();
    });
    es.addEventListener("tick", e => {
      if (!st.live) return;
      const d = JSON.parse(e.data);
      for (const u of d.m || []) {
        const m = st.live.matches[u.i];
        if (m) { m.gh = u.gh; m.ga = u.ga; m.min = u.min; m.ph = u.ph; m.fin = u.fin; }
      }
      for (const ev of d.ev || []) {
        const m = st.live.matches[ev.i];
        if (!m) continue;
        m.events.push(ev);
        const mine = m.humanH === st.session.playerId || m.humanA === st.session.playerId;
        if (mine) window.TF.sounds.play(ev.type);
        else if (ev.type === "goal") window.TF.sounds.play("goalOther");
      }
      if (st.view === "round") updateRound();
    });
    es.addEventListener("halftime", e => {
      if (!st.live) return;
      const d = JSON.parse(e.data);
      st.live.waitingMe = (d.waiting || []).includes(st.session.playerId);
      if (st.view === "round") { renderRoundControls(); }
    });
    es.addEventListener("roundEnd", e => {
      window.TF.sounds.stopAmbience();
      st.live = null;
      st.view = "game";
      st.tab = "rodada";
      render();
      toast("Rodada encerrada!");
    });
    es.addEventListener("seasonEnd", e => {
      const d = JSON.parse(e.data);
      const rep = d.report;
      const cid = st.shared ? st.shared.countryId : "BRA";
      const a = rep.awards[cid] || {};
      modal(
        "<h3>🏁 Fim da temporada " + rep.year + "</h3>" +
        "<p>🏆 Campeão: <b>" + esc(a.champion || "?") + "</b></p>" +
        (a.golden ? "<p>🥇 Bola de Ouro: <b>" + esc(a.golden.name) + "</b> (" + esc(a.golden.club) + ")</p>" : "") +
        (a.topScorer ? "<p>⚽ Artilheiro: <b>" + esc(a.topScorer.name) + "</b> — " + a.topScorer.goals + " gols</p>" : "") +
        "<p class='text-green'>⬆ " + esc((rep.promoted[cid] || []).join(", ")) + "</p>" +
        "<p class='money-neg'>⬇ " + esc((rep.relegated[cid] || []).join(", ")) + "</p>" +
        '<div class="actions"><button class="btn primary" data-x>Continuar</button></div>',
        ov => ov.querySelector("[data-x]").addEventListener("click", () => ov.remove()));
    });
    es.onerror = () => { /* EventSource reconecta sozinho */ };
  }

  // ---------- helpers de dados ----------
  function myClub() { return st.shared && st.personal ? st.shared.clubs[st.personal.clubId] : null; }
  function clubById(id) { return st.shared ? st.shared.clubs[id] : null; }
  function playerById(pid) {
    for (const c of Object.values(st.shared.clubs)) {
      const p = c.players.find(x => x.id === pid);
      if (p) return { p, c };
    }
    return null;
  }
  function humanNameByClub(clubId) {
    const h = (st.shared.humans || []).find(x => x.clubId === clubId);
    return h ? h.name : null;
  }
  function isHost() { return st.lobby && st.lobby.hostId === st.session.playerId; }
  function me() { return st.lobby.players.find(p => p.id === st.session.playerId); }

  // ---------- telas ----------
  function render() {
    const app = document.getElementById("app");
    if (st.view === "gate") return renderGate(app);
    if (st.view === "lobby") return renderLobby(app);
    if (st.view === "round") return renderRound(app);
    renderGame(app);
  }

  function renderGate(app) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("tf26_online") || "null"); } catch (e) { /* ok */ }
    app.innerHTML =
      '<div class="hero">' +
        "<h1>🌐 Técnico <span>26</span> Online</h1>" +
        "<p>Crie uma sala e chame seus amigos com o código</p>" +
        '<div class="card" style="min-width:340px">' +
          '<div class="row" style="margin-bottom:10px"><label>Seu nome: <input id="g-name" value="' + esc((saved && saved.name) || "") + '" maxlength="20" style="width:180px"></label></div>' +
          '<button class="btn primary" id="g-create" style="width:100%;margin-bottom:8px">Criar sala</button>' +
          '<div class="row"><input id="g-code" placeholder="CÓDIGO" maxlength="5" style="width:120px;text-transform:uppercase" value="' + esc((saved && saved.code) || "") + '"><button class="btn" id="g-join" style="flex:1">Entrar na sala</button></div>' +
        "</div>" +
        '<p class="muted" style="font-size:.8rem"><a href="index.html" style="color:var(--accent)">← Voltar ao modo carreira</a></p>' +
      "</div>";
    $("#g-create").addEventListener("click", async () => {
      const name = ($("#g-name").value || "Técnico").trim();
      const r = await fetch("/api/room/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(x => x.json());
      if (!r.ok) return toast(r.reason || "Erro ao criar sala.");
      startSession(r, name);
    });
    $("#g-join").addEventListener("click", async () => {
      const name = ($("#g-name").value || "Técnico").trim();
      const code = ($("#g-code").value || "").toUpperCase().trim();
      const body = { name, code };
      if (saved && saved.code === code) { body.playerId = saved.playerId; body.token = saved.token; }
      const r = await fetch("/api/room/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json());
      if (!r.ok) return toast(r.reason || "Erro ao entrar.");
      startSession(r, name);
    });
  }

  function startSession(r, name) {
    st.session = { code: r.code, playerId: r.playerId, token: r.token, name };
    try { localStorage.setItem("tf26_online", JSON.stringify(st.session)); } catch (e) { /* ok */ }
    st.lobby = r.lobby;
    st.view = r.lobby.phase === "lobby" ? "lobby" : "game";
    connectSSE();
    render();
  }

  const COUNTRY_NAMES = { BRA: "Brasil", ENG: "Inglaterra", ESP: "Espanha", ITA: "Itália", POR: "Portugal", GER: "Alemanha" };
  let lobbyClubs = null; // cache dos clubes por país p/ lobby (vem do db estático abaixo)

  async function loadLobbyClubs(countryId) {
    // carrega a lista de clubes do país direto dos arquivos estáticos do jogo
    if (!window.WORLD_DB_2026) {
      await new Promise((ok, err) => {
        let pending = 2;
        for (const src of ["js/db/world-db-2026.js", "js/db/world-leagues.js"]) {
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => { if (--pending === 0) ok(); };
          s.onerror = err;
          document.head.appendChild(s);
        }
      });
      // world.js depende de names.js
      await new Promise((ok, err) => {
        const s1 = document.createElement("script");
        s1.src = "js/core/names.js";
        s1.onload = () => {
          const s2 = document.createElement("script");
          s2.src = "js/core/world.js";
          s2.onload = ok; s2.onerror = err;
          document.head.appendChild(s2);
        };
        s1.onerror = err;
        document.head.appendChild(s1);
      });
      lobbyClubs = window.TF.world.buildWorld();
    }
    return lobbyClubs;
  }

  function renderLobby(app) {
    const lb = st.lobby;
    app.innerHTML =
      '<div class="content" style="height:100vh;overflow-y:auto"><div style="max-width:900px;margin:0 auto">' +
        '<h2 style="font-size:1.4rem">Sala <span class="text-green" style="letter-spacing:.2em">' + esc(lb.code) + "</span> " +
        '<button class="btn small" id="lb-copy">Copiar código</button></h2>' +
        "<p class='muted'>Passe esse código para seus amigos entrarem. " + (isHost() ? "Você é o dono da sala." : "") + "</p>" +
        '<div class="grid2" style="margin-top:12px">' +
          '<div class="card"><h3 style="margin-top:0">Técnicos na sala</h3><table class="data"><tbody>' +
            lb.players.map(p => "<tr><td>" + (p.online ? "🟢" : "⚪") + "</td><td><b>" + esc(p.name) + "</b>" + (p.id === lb.hostId ? " 👑" : "") + "</td><td>" +
              (p.clubId ? esc(lobbyClubName(p.clubId)) : "<span class='muted'>escolhendo clube…</span>") + "</td></tr>").join("") +
          "</tbody></table>" +
          (isHost() ? '<div class="row" style="margin-top:10px"><label>País: <select id="lb-country">' +
            Object.keys(COUNTRY_NAMES).map(c => '<option value="' + c + '"' + (c === lb.countryId ? " selected" : "") + ">" + COUNTRY_NAMES[c] + "</option>").join("") +
            '</select></label><button class="btn primary" id="lb-start">▶ Iniciar jogo</button></div>' : "<p class='muted'>Aguardando o dono da sala iniciar…</p>") +
          "</div>" +
          '<div class="card"><h3 style="margin-top:0">Chat</h3>' +
            '<div id="chat-log" style="height:180px;overflow-y:auto;font-size:.88rem;margin-bottom:8px">' + chatHtml() + "</div>" +
            '<div class="row"><input id="chat-in" placeholder="Mensagem..." style="flex:1" maxlength="300"><button class="btn small" id="chat-send">Enviar</button></div>' +
          "</div>" +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">Escolha seu clube — ' + COUNTRY_NAMES[lb.countryId] + '</h3><div class="club-grid" id="lb-clubs"><p class="muted">Carregando clubes…</p></div></div>' +
      "</div></div>";

    $("#lb-copy").addEventListener("click", () => {
      try { navigator.clipboard.writeText(lb.code); toast("Código copiado: " + lb.code); } catch (e) { toast(lb.code); }
    });
    bindChat();
    const sel = $("#lb-country");
    if (sel) sel.addEventListener("change", async e => { await api("setCountry", { countryId: e.target.value }); });
    const startBtn = $("#lb-start");
    if (startBtn) startBtn.addEventListener("click", async () => {
      const r = await api("start");
      if (!r.ok) toast(r.reason);
    });

    loadLobbyClubs().then(world => {
      const country = world.countries[lb.countryId];
      if (!country) return;
      const taken = new Set(lb.players.filter(p => p.clubId).map(p => p.clubId));
      const myPick = me() && me().clubId;
      const clubs = country.clubIdsA.concat(country.clubIdsB).map(id => world.clubs[id]).sort((a, b) => b.rating - a.rating);
      const grid = $("#lb-clubs");
      if (!grid) return;
      grid.innerHTML = clubs.map(c =>
        '<div class="club-pick" data-club="' + c.id + '" style="' + (c.id === myPick ? "border-color:var(--green);background:var(--row-me);" : taken.has(c.id) ? "opacity:.4;" : "") + '">' +
        crest(c, 30) + '<div><div class="cname">' + esc(c.name) + '</div><div class="cinfo">Série ' + c.division + " · Força " + c.rating +
        (taken.has(c.id) && c.id !== myPick ? " · ocupado" : "") + "</div></div></div>").join("");
      grid.querySelectorAll("[data-club]").forEach(d => d.addEventListener("click", async () => {
        const r = await api("pickClub", { clubId: d.dataset.club });
        if (!r.ok) toast(r.reason);
      }));
    }).catch(() => { const g = $("#lb-clubs"); if (g) g.innerHTML = "<p class='muted'>Falha ao carregar clubes.</p>"; });
  }

  function lobbyClubName(clubId) {
    if (lobbyClubs && lobbyClubs.clubs[clubId]) return lobbyClubs.clubs[clubId].name;
    if (st.shared && st.shared.clubs[clubId]) return st.shared.clubs[clubId].name;
    return clubId;
  }

  function chatHtml() {
    return st.chatLog.map(c => "<div><b>" + esc(c.from) + ":</b> " + esc(c.text) + "</div>").join("") || "<span class='muted'>Sem mensagens.</span>";
  }

  function bindChat() {
    const send = async () => {
      const inp = $("#chat-in");
      if (inp && inp.value.trim()) { await api("chat", { text: inp.value.trim() }); inp.value = ""; }
    };
    const btn = $("#chat-send");
    if (btn) btn.addEventListener("click", send);
    const inp = $("#chat-in");
    if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  }

  // ---------- tela principal da sala ----------
  const TABS = [
    ["rodada", "▶ Rodada"], ["squad", "👥 Elenco"], ["lineup", "📋 Escalação"],
    ["table", "🏆 Tabela"], ["cup", "🏅 Copa"], ["transfers", "💱 Transferências"],
    ["news", "📰 Notícias"], ["chat", "💬 Chat"]
  ];

  function renderGame(app) {
    if (!st.shared || !st.personal) {
      app.innerHTML = '<div class="hero"><p class="muted">Sincronizando com a sala…</p></div>';
      return;
    }
    const club = myClub();
    const meP = st.lobby ? me() : null;
    const readyCount = st.lobby ? st.lobby.players.filter(p => p.ready).length : 0;
    const onlineCount = st.lobby ? st.lobby.players.filter(p => p.online).length : 0;
    app.innerHTML =
      '<div class="topbar">' +
        crest(club, 42) +
        '<div class="club-info"><div class="club-name">' + esc(club.name) + '</div>' +
        '<div class="club-sub">Sala ' + esc(st.session.code) + " · " + esc(st.session.name) + " · Série " + club.division + "</div></div>" +
        '<div class="spacer"></div>' +
        '<div class="stat"><div class="label">Caixa</div><div class="value' + (club.money < 0 ? " money-neg" : "") + '">' + money(club.money) + "</div></div>" +
        '<div class="stat"><div class="label">Temporada</div><div class="value">' + st.shared.seasonYear + " · Sem " + st.shared.week + "</div></div>" +
        '<div class="stat"><div class="label">Próximo</div><div class="value" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">' + esc(st.shared.slot.label) + "</div></div>" +
        '<div class="stat"><div class="label">Prontos</div><div class="value">' + readyCount + "/" + onlineCount + "</div></div>" +
        '<button class="btn ' + (meP && meP.ready ? "" : "primary") + ' btn-advance" id="btn-ready">' + (meP && meP.ready ? "✔ Aguardando…" : "Pronto ▶") + "</button>" +
      "</div>" +
      '<div class="main">' +
        '<nav class="sidebar">' +
          TABS.map(([id, label]) => '<button class="nav-item' + (st.tab === id ? " active" : "") + '" data-tab="' + id + '"><span class="txt">' + label + "</span></button>").join("") +
        "</nav>" +
        '<div class="content" id="content"></div>' +
      "</div>";
    app.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { st.tab = b.dataset.tab; render(); }));
    $("#btn-ready").addEventListener("click", async () => {
      const now = !(meP && meP.ready);
      await api("ready", { ready: now });
    });
    drawTab($("#content"));
  }

  function drawTab(el) {
    const club = myClub();
    if (st.tab === "rodada") {
      const results = st.shared.lastResults || [];
      el.innerHTML =
        "<h2>Rodada</h2>" +
        '<div class="card"><p>' + esc(st.shared.slot.label) + '</p><p class="muted" style="font-size:.85rem">Quando todos os técnicos clicarem em <b>Pronto</b>, a rodada começa ao vivo para todo mundo ao mesmo tempo.</p>' +
        "<p class='" + (st.shared.window.open ? "text-green" : "muted") + "'>" + esc(st.shared.window.message) + "</p></div>" +
        (results.length ? '<div class="card mb0"><h3 style="margin-top:0">Últimos resultados</h3><table class="data"><tbody>' +
          results.map(r => {
            const h = clubById(r.home), a = clubById(r.away);
            if (!h || !a) return "";
            const mine = r.home === club.id || r.away === club.id;
            return "<tr" + (mine ? ' class="me"' : "") + "><td class='muted'>" + esc(r.competition) + '</td><td><span class="club-cell">' + crest(h, 18) + esc(h.shortName) + "</span></td>" +
              "<td style='text-align:center'><b>" + r.gh + " x " + r.ga + "</b></td>" +
              '<td><span class="club-cell">' + crest(a, 18) + esc(a.shortName) + "</span></td></tr>";
          }).join("") + "</tbody></table></div>" : "");
    } else if (st.tab === "squad") {
      drawSquad(el, club);
    } else if (st.tab === "lineup") {
      drawLineup(el, club);
    } else if (st.tab === "table") {
      drawTable(el);
    } else if (st.tab === "cup") {
      drawCup(el);
    } else if (st.tab === "transfers") {
      drawTransfers(el, club);
    } else if (st.tab === "news") {
      el.innerHTML = "<h2>Notícias</h2>" +
        ((st.personal.news || []).map(n => '<div class="news-item ' + esc(n.type) + '"><div class="nmeta">Temporada ' + n.season + " · Semana " + n.week + '</div><div class="ntitle">' + esc(n.title) + '</div><div class="muted">' + esc(n.text) + "</div></div>").join("") || "<p class='muted'>Sem notícias.</p>");
    } else if (st.tab === "chat") {
      el.innerHTML = "<h2>Chat da sala</h2>" +
        '<div class="card mb0"><div id="chat-log" style="height:320px;overflow-y:auto;font-size:.9rem;margin-bottom:10px">' + chatHtml() + "</div>" +
        '<div class="row"><input id="chat-in" placeholder="Mensagem..." style="flex:1" maxlength="300"><button class="btn" id="chat-send">Enviar</button></div></div>';
      bindChat();
      const box = $("#chat-log");
      if (box) box.scrollTop = box.scrollHeight;
    }
  }

  function drawSquad(el, club) {
    const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
    const players = club.players.slice().sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating);
    el.innerHTML =
      "<h2>Elenco <span class='muted' style='font-size:.9rem'>(salários " + money(F.squadWages(club)) + "/rodada)</span></h2>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th class="num">Força</th><th>Características</th><th>Energia</th><th class="num">J</th><th class="num">G</th><th class="num">Salário</th><th class="num">Contrato</th><th>Status</th></tr></thead><tbody>' +
      players.map(p =>
        '<tr data-p="' + p.id + '" style="cursor:pointer"><td>' + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td>" +
        '<td class="num">' + p.age + '</td><td class="num">' + rBadge(p.rating) + "</td>" +
        "<td>" + (p.traits || []).map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
        "<td>" + bar(p.energy) + "</td>" +
        '<td class="num">' + p.seasonStats.games + '</td><td class="num">' + p.seasonStats.goals + "</td>" +
        '<td class="num">' + money(p.wage) + '</td><td class="num">' + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "<span class='money-neg'>—</span>") + "</td>" +
        "<td>" + statusTags(p) + "</td></tr>").join("") +
      "</tbody></table></div>";
    el.querySelectorAll("[data-p]").forEach(tr => tr.addEventListener("click", () => myPlayerModal(tr.dataset.p)));
  }

  function statusTags(p) {
    let out = "";
    if (p.injuryWeeks > 0) out += '<span class="tag inj">Lesão ' + p.injuryWeeks + "s</span> ";
    if (p.suspended > 0) out += '<span class="tag susp">Suspenso</span> ';
    if (p.contractYears <= 0) out += '<span class="tag nocontract">Sem contrato</span> ';
    if (p.forSale) out += '<span class="tag sale">À venda ' + (p.salePrice ? money(p.salePrice) : "") + "</span> ";
    return out;
  }

  function skillTable(p) {
    return '<table class="data">' + [
      ["Goleiro", p.skills.gk], ["Velocidade", p.skills.speed], ["Passe", p.skills.pass], ["Armação", p.skills.playmaking],
      ["Desarme", p.skills.tackle], ["Finalização", p.skills.finishing], ["Técnica", p.skills.technique]
    ].map(([n, v]) => "<tr><td>" + n + '</td><td class="num">' + Math.round(v) + "</td><td>" + bar(v, "var(--accent)") + "</td></tr>").join("") + "</table>";
  }

  function myPlayerModal(pid) {
    const club = myClub();
    const p = club.players.find(x => x.id === pid);
    if (!p) return;
    modal(
      "<h3>" + pBadge(p.pos) + " " + esc(p.name) + " " + rBadge(p.rating) + "</h3>" +
      '<div class="grid2"><div>' + skillTable(p) + "</div><div>" +
        "<p>Idade: <b>" + p.age + "</b> · Moral: " + bar(p.moral) + "</p>" +
        "<p>Salário: <b>" + money(p.wage) + "</b>/jogo · Contrato: <b>" + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "expirado") + "</b></p>" +
        "<p>Valor de mercado: <b>" + money(T.fairValue(p, club)) + "</b></p>" +
        (p.forSale && p.salePrice ? "<p class='text-gold'>À venda por <b>" + money(p.salePrice) + "</b></p>" : "") +
      "</div></div>" +
      '<div class="actions">' +
        '<button class="btn" data-renew>Renovar</button>' +
        '<button class="btn" data-sell>' + (p.forSale ? "Tirar da venda" : "Colocar à venda…") + "</button>" +
        '<button class="btn" data-x>Fechar</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-sell]").addEventListener("click", async () => {
          ov.remove();
          if (p.forSale) {
            await api("sell", { targetId: p.id, price: null });
            toast(p.name + " saiu da lista.");
          } else {
            sellModal(p, club);
          }
        });
        ov.querySelector("[data-renew]").addEventListener("click", () => {
          ov.remove();
          const suggested = Math.round(p.wage * 1.2 / 100) * 100;
          modal(
            "<h3>Renovar com " + esc(p.name) + "</h3>" +
            '<div class="row"><label>Salário: <input type="number" id="rw" value="' + suggested + '" step="100" style="width:140px"></label>' +
            '<label>Anos: <select id="ry"><option value="1">1</option><option value="2" selected>2</option></select></label></div>' +
            '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Propor</button></div>',
            ov2 => {
              ov2.querySelector("[data-x]").addEventListener("click", () => ov2.remove());
              ov2.querySelector("[data-ok]").addEventListener("click", async () => {
                const r = await api("renew", { targetId: p.id, wage: parseInt(ov2.querySelector("#rw").value, 10) || 0, years: parseInt(ov2.querySelector("#ry").value, 10) });
                ov2.remove();
                toast(r.ok ? "Contrato renovado!" : r.reason);
              });
            });
        });
      });
  }

  function sellModal(p, club) {
    const fair = T.fairValue(p, club);
    modal(
      "<h3>Colocar " + esc(p.name) + " à venda</h3>" +
      "<p class='muted'>Valor de mercado: <b>" + money(fair) + "</b>. Preço alto demais não atrai compradores.</p>" +
      '<div class="row"><label>Preço: <input type="number" id="sp" value="' + fair + '" step="100000" style="width:160px"></label></div>' +
      '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Anunciar</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-ok]").addEventListener("click", async () => {
          const v = parseInt(ov.querySelector("#sp").value, 10) || fair;
          ov.remove();
          await api("sell", { targetId: p.id, price: v });
          toast(p.name + " anunciado por " + money(v) + ".");
        });
      });
  }

  function drawLineup(el, club) {
    const t = st.personal.tactics;
    const formation = M.FORMATIONS[t.formationName] || M.FORMATIONS["4-4-2"];
    const coords = M.FORMATION_COORDS[t.formationName] || M.FORMATION_COORDS["4-4-2"];
    const byId = {};
    for (const p of club.players) byId[p.id] = p;
    el.innerHTML =
      "<h2>Escalação e táticas</h2>" +
      '<div class="card"><div class="row">' +
        '<label>Formação: <select id="sl-form">' + Object.keys(M.FORMATIONS).map(f => "<option" + (f === t.formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
        '<label>Estilo: <select id="sl-style">' + [["equilibrado", "Equilibrado"], ["ataque", "Ataque total"], ["retranca", "Retranca"]].map(([v, l]) => '<option value="' + v + '"' + (t.style === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
        '<label>Marcação: <select id="sl-mark">' + [["leve", "Leve"], ["pesada", "Pesada"], ["muito pesada", "Muito pesada"]].map(([v, l]) => '<option value="' + v + '"' + (t.marking === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
        '<label>Treino: <select id="sl-train">' + [["auto", "Auxiliar decide"], ["principais", "Principais"], ["secundarias", "Secundárias"]].map(([v, l]) => '<option value="' + v + '"' + (st.personal.training === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
        '<button class="btn" id="sl-auto">Escalar automaticamente</button>' +
      "</div></div>" +
      '<div class="lineup-wrap"><div class="pitch" id="pitch"><div class="center-line"></div><div class="center-circle"></div></div>' +
      '<div class="card mb0"><p class="muted" style="font-size:.85rem">Clique em uma camisa para trocar o jogador. A escalação é enviada automaticamente para o servidor e vale para a próxima rodada.</p></div></div>';

    function drawPitch() {
      const pitch = $("#pitch");
      pitch.querySelectorAll(".shirt").forEach(s => s.remove());
      formation.forEach((pos, i) => {
        const pid = st.personal.squad.starters[i];
        const p = pid ? byId[pid] : null;
        const [x, y] = coords[i];
        const div = document.createElement("div");
        div.className = "shirt" + (p ? "" : " empty") + (pos === "GOL" ? " gk" : "");
        div.style.left = x + "%";
        div.style.top = (100 - y) + "%";
        div.innerHTML = '<div class="jersey">' + (p ? Math.round(p.rating) : pos) + "</div>" +
          '<div class="pname' + (p && p.pos !== pos ? " improv" : "") + '">' + (p ? esc(p.name.split(" ").slice(-1)[0]) : "vazio") + "</div>";
        div.addEventListener("click", () => pickSlot(i, pos));
        pitch.appendChild(div);
      });
    }

    function pickSlot(slotIndex, pos) {
      const used = new Set(st.personal.squad.starters.filter((id, i) => i !== slotIndex && id));
      const cands = club.players.filter(p => !used.has(p.id) && p.contractYears > 0 && !p.injuryWeeks && !p.suspended)
        .sort((a, b) => (b.rating * M.positionFactor(b, pos)) - (a.rating * M.positionFactor(a, pos)));
      modal(
        "<h3>Escolher jogador (" + pos + ")</h3>" +
        '<table class="data"><tbody>' +
        cands.map(p => '<tr data-pick="' + p.id + '" style="cursor:pointer"><td>' + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + (p.pos !== pos ? " <span class='muted'>(improvisado)</span>" : "") + "</td><td class='num'>" + rBadge(p.rating) + "</td><td>" + bar(p.energy) + "</td></tr>").join("") +
        "</tbody></table>",
        ov => ov.querySelectorAll("[data-pick]").forEach(tr => tr.addEventListener("click", async () => {
          st.personal.squad.starters[slotIndex] = tr.dataset.pick;
          st.personal.squad.bench = st.personal.squad.bench.filter(id => id !== tr.dataset.pick);
          ov.remove();
          drawPitch();
          await api("lineup", { starters: st.personal.squad.starters, bench: st.personal.squad.bench });
        })));
    }

    $("#sl-form").addEventListener("change", async e => {
      const r = await api("tactics", { formationName: e.target.value });
      if (r.squad) st.personal.squad = r.squad;
      st.personal.tactics.formationName = e.target.value;
      drawTab(el);
    });
    $("#sl-style").addEventListener("change", e => api("tactics", { style: e.target.value }));
    $("#sl-mark").addEventListener("change", e => api("tactics", { marking: e.target.value }));
    $("#sl-train").addEventListener("change", e => api("tactics", { training: e.target.value }));
    $("#sl-auto").addEventListener("click", async () => {
      const r = await api("autoLineup");
      if (r.squad) { st.personal.squad = r.squad; drawPitch(); }
    });
    drawPitch();
  }

  function drawTable(el) {
    const div = st._tblDiv || myClub().division;
    const rows = C.sortTable(st.shared.tables[div]);
    const relegN = st.shared.relegated;
    el.innerHTML =
      "<h2>Classificação</h2>" +
      '<div class="card"><div class="row"><select id="tb-div"><option value="A"' + (div === "A" ? " selected" : "") + ">" + esc(st.shared.leagueNames.A) + '</option><option value="B"' + (div === "B" ? " selected" : "") + ">" + esc(st.shared.leagueNames.B) + "</option></select>" +
      '<span class="muted">Rodada ' + st.shared.currentRound + "/" + st.shared.totalRounds + "</span></div></div>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>#</th><th>Clube</th><th>Técnico</th><th class="num">P</th><th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">SG</th></tr></thead><tbody>' +
      rows.map((r, i) => {
        const c = clubById(r.clubId);
        if (!c) return "";
        let zone = "";
        if (div === "A" && i < 4) zone = "zone-blue";
        else if (div === "A" && i < 6) zone = "zone-yellow";
        if (div === "A" && i >= rows.length - relegN) zone = "zone-red";
        if (div === "B" && i < relegN) zone = "zone-blue";
        const hn = humanNameByClub(r.clubId);
        const meRow = r.clubId === myClub().id ? " me" : "";
        return '<tr class="' + zone + meRow + '"><td>' + (i + 1) + '</td><td><span class="club-cell">' + crest(c, 20) + esc(c.name) + "</span></td>" +
          "<td>" + (hn ? "<b class='text-green'>" + esc(hn) + "</b>" : "<span class='muted'>IA</span>") + "</td>" +
          '<td class="num"><b>' + r.pts + '</b></td><td class="num">' + r.j + '</td><td class="num">' + r.v + '</td><td class="num">' + r.e + '</td><td class="num">' + r.d + '</td><td class="num">' + r.sg + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    $("#tb-div").addEventListener("change", e => { st._tblDiv = e.target.value; drawTab(el); });
  }

  function drawCup(el) {
    const cup = st.shared.cup;
    function tieRow(t) {
      const h = clubById(t.home), a = clubById(t.away);
      if (!h || !a) return "";
      const score = t.winner != null ? "<b>" + t.gh + " x " + t.ga + "</b>" + (t.penalties ? " <span class='muted'>(pên.)</span>" : "") : "x";
      return '<tr><td><span class="club-cell">' + crest(h, 18) + esc(h.shortName) + "</span></td><td style='text-align:center'>" + score + '</td><td><span class="club-cell">' + crest(a, 18) + esc(a.shortName) + "</span></td></tr>";
    }
    let html = "<h2>" + esc(st.shared.cupName) + "</h2>";
    if (cup.championId) {
      const champ = clubById(cup.championId);
      html += '<div class="card"><p style="font-size:1.1rem">🏆 Campeão: <b>' + esc(champ ? champ.name : "?") + "</b></p></div>";
    } else if (cup.ties.length) {
      html += '<div class="card"><h3 style="margin-top:0">' + esc(cup.phaseName) + '</h3><table class="data"><tbody>' + cup.ties.map(tieRow).join("") + "</tbody></table></div>";
    }
    for (let i = cup.history.length - 1; i >= 0; i--) {
      html += '<div class="card"><h3 style="margin-top:0">Fase ' + cup.history[i].phase + '</h3><table class="data"><tbody>' + cup.history[i].results.map(tieRow).join("") + "</tbody></table></div>";
    }
    el.innerHTML = html;
  }

  function drawTransfers(el, club) {
    const tab = st._trTab || "buscar";
    const win = st.shared.window;
    const offers = st.personal.offers || [];
    const humanOffers = st.personal.humanOffers || [];
    let inner = "";
    if (tab === "buscar") {
      const q = st._trQuery || { name: "", pos: "" };
      const all = [];
      for (const c of Object.values(st.shared.clubs)) {
        if (c.id === club.id) continue;
        for (const p of c.players) {
          if (q.name && !p.name.toLowerCase().includes(q.name.toLowerCase())) continue;
          if (q.pos && p.pos !== q.pos) continue;
          all.push({ p, c });
        }
      }
      all.sort((x, y) => y.p.rating - x.p.rating);
      inner =
        '<div class="card"><div class="row">' +
          '<input id="tf-name" placeholder="Nome..." value="' + esc(q.name) + '" style="width:160px">' +
          '<select id="tf-pos"><option value="">Todas posições</option>' + ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"].map(p => "<option" + (q.pos === p ? " selected" : "") + ">" + p + "</option>").join("") + "</select>" +
          '<button class="btn small" id="tf-go">Filtrar</button>' +
        "</div></div>" +
        '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th class="num">Força</th><th>Clube</th><th>Técnico</th><th class="num">Pedida</th><th></th></tr></thead><tbody>' +
        all.slice(0, 50).map(({ p, c }) => {
          const hn = humanNameByClub(c.id);
          return "<tr><td>" + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td><td class='num'>" + p.age + "</td><td class='num'>" + rBadge(p.rating) + "</td>" +
            '<td><span class="club-cell">' + crest(c, 18) + esc(c.shortName) + "</span></td>" +
            "<td>" + (hn ? "<b class='text-green'>" + esc(hn) + "</b>" : "<span class='muted'>IA</span>") + "</td>" +
            "<td class='num'>" + (p.contractYears > 0 ? money(T.askingPrice(p, c)) : "livre") + "</td>" +
            '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    } else {
      inner = '<div class="card mb0">' +
        "<h3 style='margin-top:0'>Propostas de outros técnicos</h3>" +
        (humanOffers.length ? '<table class="data"><tbody>' + humanOffers.map((o, i) => {
          const info = playerById(o.playerId);
          return "<tr><td><b>" + esc(info ? info.p.name : "?") + "</b></td><td>de <b class='text-green'>" + esc(o.fromName) + "</b></td><td class='num'><b>" + money(o.value) + "</b></td>" +
            '<td><button class="btn small primary" data-ha="' + i + '">Aceitar</button> <button class="btn small danger" data-hr="' + i + '">Recusar</button></td></tr>';
        }).join("") + "</tbody></table>" : "<p class='muted'>Nenhuma.</p>") +
        "<h3>Propostas da IA</h3>" +
        (offers.length ? '<table class="data"><tbody>' + offers.map((o, i) => {
          const p = club.players.find(x => x.id === o.playerId);
          const buyer = clubById(o.clubId);
          return "<tr><td><b>" + esc(p ? p.name : "?") + "</b></td><td>" + esc(buyer ? buyer.name : "clube de fora") + "</td><td class='num'><b>" + money(o.value) + "</b></td>" +
            '<td><button class="btn small primary" data-aa="' + i + '">Aceitar</button> <button class="btn small danger" data-ar="' + i + '">Recusar</button></td></tr>';
        }).join("") + "</tbody></table>" : "<p class='muted'>Nenhuma.</p>") +
        "</div>";
    }
    el.innerHTML =
      "<h2>Transferências</h2>" +
      '<p class="' + (win.open ? "text-green" : "money-neg") + '" style="margin-bottom:10px;font-weight:600">' + esc(win.message) + "</p>" +
      '<div class="row" style="margin-bottom:12px">' +
        '<button class="btn' + (tab === "buscar" ? " primary" : "") + '" data-t="buscar">Buscar jogadores</button>' +
        '<button class="btn' + (tab === "recebidas" ? " primary" : "") + '" data-t="recebidas">Recebidas' + (offers.length + humanOffers.length ? " (" + (offers.length + humanOffers.length) + ")" : "") + "</button>" +
        '<span style="flex:1"></span><span class="muted">Caixa: <b>' + money(club.money) + "</b></span>" +
      "</div>" + inner;

    el.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { st._trTab = b.dataset.t; drawTab(el); }));
    const go = $("#tf-go");
    if (go) go.addEventListener("click", () => { st._trQuery = { name: $("#tf-name").value, pos: $("#tf-pos").value }; drawTab(el); });
    el.querySelectorAll("[data-offer]").forEach(b => b.addEventListener("click", () => offerModal(b.dataset.offer)));
    el.querySelectorAll("[data-ha]").forEach(b => b.addEventListener("click", async () => { await api("respondHumanOffer", { index: parseInt(b.dataset.ha, 10), accept: true }); }));
    el.querySelectorAll("[data-hr]").forEach(b => b.addEventListener("click", async () => { await api("respondHumanOffer", { index: parseInt(b.dataset.hr, 10), accept: false }); }));
    el.querySelectorAll("[data-aa]").forEach(b => b.addEventListener("click", async () => { await api("respondAiOffer", { index: parseInt(b.dataset.aa, 10), accept: true }); }));
    el.querySelectorAll("[data-ar]").forEach(b => b.addEventListener("click", async () => { await api("respondAiOffer", { index: parseInt(b.dataset.ar, 10), accept: false }); }));
  }

  function offerModal(pid) {
    const info = playerById(pid);
    if (!info) return;
    const { p, c } = info;
    const hn = humanNameByClub(c.id);
    const price = p.contractYears > 0 ? T.askingPrice(p, c) : 0;
    const wage = T.wageDemand(p, myClub());
    modal(
      "<h3>Proposta por " + esc(p.name) + " " + rBadge(p.rating) + "</h3>" +
      "<p class='muted'>" + esc(c.name) + (hn ? " (técnico: " + esc(hn) + " — ele decide!)" : " (IA decide na hora)") + " · pedida " + (price ? money(price) : "livre") + "</p>" +
      '<div class="row" style="margin-top:10px">' +
        (price ? '<label>Valor: <input type="number" id="ov" value="' + price + '" step="100000" style="width:150px"></label>' : "") +
        '<label>Salário: <input type="number" id="ow" value="' + wage + '" step="100" style="width:130px"></label>' +
        '<label>Anos: <select id="oy"><option value="1">1</option><option value="2" selected>2</option></select></label>' +
      "</div>" +
      '<div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Enviar</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelector("[data-ok]").addEventListener("click", async () => {
          const r = await api("offer", {
            targetId: pid,
            value: price ? (parseInt(ov.querySelector("#ov").value, 10) || 0) : 0,
            wage: parseInt(ov.querySelector("#ow").value, 10) || 0,
            years: parseInt(ov.querySelector("#oy").value, 10)
          });
          ov.remove();
          toast(r.ok ? (r.pending ? r.reason : p.name + " contratado!") : (r.reason || "Proposta recusada."));
        });
      });
  }

  // ---------- rodada ao vivo ----------
  function renderRound(app) {
    const live = st.live;
    app.innerHTML =
      '<div class="content" style="height:100vh;overflow-y:auto"><div class="round-screen">' +
        '<div class="round-head"><h2 style="margin:0;font-size:1.15rem">' + esc(live.label) + '</h2><div class="round-controls" id="controls"></div></div>' +
        '<div class="round-grid" id="grid">' +
        live.matches.map((m, i) => {
          const mine = m.humanH === st.session.playerId || m.humanA === st.session.playerId;
          return '<div class="match-card' + (mine ? " user" : "") + (i === live.selected ? " selected" : "") + '" data-i="' + i + '">' +
            '<div class="mc-side">' + crest(m.home, 22) + '<span class="mc-name">' + esc(m.home.shortName) + "</span></div>" +
            '<div class="mc-mid"><span class="mc-score" data-score>0 x 0</span><span class="mc-min" data-min>0\'</span></div>' +
            '<div class="mc-side right"><span class="mc-name">' + esc(m.away.shortName) + "</span>" + crest(m.away, 22) + "</div></div>";
        }).join("") +
        "</div>" +
        '<div class="round-detail" id="detail"></div>' +
      "</div></div>";
    app.querySelectorAll(".match-card").forEach(card => card.addEventListener("click", () => {
      live.selected = parseInt(card.dataset.i, 10);
      app.querySelectorAll(".match-card").forEach(c => c.classList.toggle("selected", c === card));
      buildDetail();
    }));
    renderRoundControls();
    buildDetail();
    updateRound();
  }

  function renderRoundControls() {
    const el = $("#controls");
    if (!el || !st.live) return;
    const live = st.live;
    const myMatch = live.matches.find(m => m.humanH === st.session.playerId || m.humanA === st.session.playerId);
    let html = "";
    if (live.waitingMe) {
      html += '<button class="btn primary" id="rc-2half">▶ Pronto para o 2º tempo</button>';
    }
    if (myMatch && !myMatch.fin) {
      html += '<button class="btn" id="rc-subs">Substituições</button><button class="btn" id="rc-tactics">Táticas</button>';
    }
    el.innerHTML = html || '<span class="muted">Acompanhando a rodada…</span>';
    const b2 = $("#rc-2half");
    if (b2) b2.addEventListener("click", async () => { live.waitingMe = false; renderRoundControls(); await api("ready2h"); });
    const bs = $("#rc-subs");
    if (bs) bs.addEventListener("click", () => liveSubsModal(myMatch));
    const bt = $("#rc-tactics");
    if (bt) bt.addEventListener("click", liveTacticsModal);
  }

  function liveSubsModal(myMatch) {
    const club = myClub();
    const side = myMatch.humanH === st.session.playerId ? "h" : "a";
    const lineupInfo = myMatch.lineups[side];
    const onField = new Set(lineupInfo.map(s => s.id).filter(Boolean));
    const benchPlayers = club.players.filter(p => !onField.has(p.id) && !p.injuryWeeks && !p.suspended && p.contractYears > 0)
      .sort((a, b) => b.rating - a.rating).slice(0, 7);
    let outSel = null;
    modal(
      "<h3>Substituições</h3><h3 style='margin-top:8px'>Em campo</h3>" +
      '<table class="data"><tbody>' +
      lineupInfo.filter(s => s.id).map(s => '<tr data-out="' + s.id + '" style="cursor:pointer"><td>' + pBadge(s.pos) + "</td><td>" + esc(s.name) + "</td><td class='num'>" + rBadge(s.rating) + "</td></tr>").join("") +
      "</tbody></table><h3>Banco</h3>" +
      '<table class="data"><tbody>' +
      benchPlayers.map(p => '<tr data-in="' + p.id + '" style="cursor:pointer"><td>' + pBadge(p.pos) + "</td><td>" + esc(p.name) + "</td><td class='num'>" + rBadge(p.rating) + "</td></tr>").join("") +
      "</tbody></table>" +
      '<div class="actions"><button class="btn" data-x>Fechar</button></div>',
      ov => {
        ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
        ov.querySelectorAll("[data-out]").forEach(tr => tr.addEventListener("click", () => {
          ov.querySelectorAll("[data-out]").forEach(t => t.style.background = "");
          tr.style.background = "var(--row-hover)";
          outSel = tr.dataset.out;
        }));
        ov.querySelectorAll("[data-in]").forEach(tr => tr.addEventListener("click", async () => {
          if (!outSel) return toast("Escolha quem sai primeiro.");
          const r = await api("sub", { out: outSel, in: tr.dataset.in });
          ov.remove();
          toast(r.ok ? "Substituição feita." : r.reason);
        }));
      });
  }

  function liveTacticsModal() {
    modal(
      "<h3>Táticas durante o jogo</h3>" +
      '<div class="row">' +
        '<label>Estilo: <select id="lt-style"><option value="equilibrado">Equilibrado</option><option value="ataque">Ataque total</option><option value="retranca">Retranca</option></select></label>' +
        '<label>Marcação: <select id="lt-mark"><option value="leve">Leve</option><option value="pesada">Pesada</option><option value="muito pesada">Muito pesada</option></select></label>' +
      "</div>" +
      '<div class="actions"><button class="btn primary" data-ok>Aplicar</button></div>',
      ov => ov.querySelector("[data-ok]").addEventListener("click", async () => {
        await api("liveTactics", { style: ov.querySelector("#lt-style").value, marking: ov.querySelector("#lt-mark").value });
        ov.remove();
        toast("Táticas aplicadas.");
      }));
  }

  function buildDetail() {
    const live = st.live;
    const el = $("#detail");
    if (!el || !live) return;
    const m = live.matches[live.selected];
    el.innerHTML =
      '<div class="scoreboard" style="margin-top:14px">' +
        '<div class="team">' + crest(m.home, 40) + "<span>" + esc(m.home.name) + "</span></div>" +
        '<div><div class="score" id="rd-score"></div><div class="minute" id="rd-min"></div></div>' +
        '<div class="team right">' + crest(m.away, 40) + "<span>" + esc(m.away.name) + "</span></div>" +
      "</div>" +
      '<div class="match-events" id="rd-events" style="height:260px"></div>';
    updateRound();
  }

  function updateRound() {
    const live = st.live;
    if (!live) return;
    const cards = document.querySelectorAll(".match-card");
    live.matches.forEach((m, i) => {
      const card = cards[i];
      if (!card) return;
      card.querySelector("[data-score]").textContent = m.gh + " x " + m.ga;
      card.querySelector("[data-min]").textContent = m.fin ? "Fim" : m.ph === "halftime" ? "Int" : m.min + "'";
      card.classList.toggle("done", !!m.fin);
    });
    const m = live.matches[live.selected];
    const sc = $("#rd-score");
    if (sc && m) {
      sc.textContent = m.gh + " x " + m.ga;
      $("#rd-min").textContent = m.fin ? "Fim de jogo" : m.ph === "halftime" ? "Intervalo" : m.min + "'";
      const box = $("#rd-events");
      while (box.children.length < m.events.length) {
        const ev = m.events[box.children.length];
        const div = document.createElement("div");
        div.className = "ev " + ev.type;
        div.innerHTML = '<span class="min">' + ev.min + "'</span><span>" + esc(ev.text) + "</span>";
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
      }
    }
  }

  function boot() {
    // aplica tema salvo
    let theme = null;
    try { theme = localStorage.getItem("tf26_theme"); } catch (e) { /* ok */ }
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    render();
  }

  window.TF = window.TF || {};
  window.TF.online = { boot, state: st };
})();
