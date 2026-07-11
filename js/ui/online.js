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

  const SND = () => window.TF.sounds;
  function soundHtml() {
    const s = SND();
    return '<span class="sound-ctl">' +
      '<button class="btn" id="snd-mute" title="Som">' + (s.muted ? "🔇" : "🔊") + "</button>" +
      '<input type="range" id="snd-vol" min="0" max="100" value="' + Math.round(s.volume * 100) + '" title="Volume">' +
      "</span>";
  }
  function bindSound(root) {
    const mute = root.querySelector("#snd-mute");
    if (mute) mute.addEventListener("click", () => { SND().toggleMute(); render(); });
    const vol = root.querySelector("#snd-vol");
    if (vol) vol.addEventListener("input", e => { const v = parseInt(e.target.value, 10); SND().setVolume(v / 100); if (SND().muted && v > 0) SND().setMuted(false); });
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
    es.addEventListener("roundPaused", e => {
      const d = JSON.parse(e.data);
      if (!st.live) return;
      st.live.pausedBy = d.by || null;
      // quem não está gerenciando vê um aviso; quem gerencia já tem o overlay
      if (st.view === "round" && !st._managing) showPausedBanner(d.by);
    });
    es.addEventListener("roundResumed", () => {
      if (!st.live) return;
      st.live.pausedBy = null;
      hidePausedBanner();
    });
    es.addEventListener("joinFreeze", e => {
      const d = JSON.parse(e.data);
      if (st.view !== "joinPick") showFreezeBanner((d.name || "Um técnico") + " está escolhendo um time para assumir…");
    });
    es.addEventListener("joinDone", e => {
      const d = JSON.parse(e.data);
      hideFreezeBanner();
      if (!d.aborted && d.name && d.club) toast(esc(d.name) + " assumiu o " + esc(d.club) + ".");
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
  function meLobbyReady() { const m = me(); return !!(m && m.lobbyReady); }

  // ---------- telas ----------
  function render() {
    const app = document.getElementById("app");
    if (st.view === "gate") return renderGate(app);
    if (st.view === "joinPick") return renderJoinPick(app);
    if (st.view === "lobby") return renderLobby(app);
    if (st.view === "round") return renderRound(app);
    renderGame(app);
  }

  // ---------- entrar no meio do jogo: escolher time livre ----------
  function renderJoinPick(app) {
    app.innerHTML = '<div class="content" style="height:100vh;overflow-y:auto"><div style="max-width:900px;margin:0 auto">' +
      "<h2 style='font-size:1.4rem'>Escolha o time que vai assumir</h2>" +
      "<p class='muted'>Você entrou na sala <b>" + esc(st.session.code) + "</b> com o jogo em andamento. Enquanto você não escolher, os outros técnicos ficam aguardando.</p>" +
      '<div class="club-grid" id="jp-clubs"><p class="muted">Carregando clubes livres…</p></div></div></div>';
    api("freeClubs").then(r => {
      const grid = $("#jp-clubs");
      if (!grid) return;
      if (!r.ok || !r.clubs || !r.clubs.length) { grid.innerHTML = "<p class='muted'>Nenhum clube livre no momento.</p>"; return; }
      const clubs = r.clubs.slice().sort((a, b) => b.rating - a.rating);
      grid.innerHTML = clubs.map(c =>
        '<div class="club-pick" data-club="' + c.id + '">' + crest(c, 34) +
        '<div><div class="cname">' + esc(c.name) + '</div><div class="cinfo">Série ' + c.division + " · Força " + c.rating + "</div></div></div>").join("");
      grid.querySelectorAll("[data-club]").forEach(d => d.addEventListener("click", async () => {
        const res = await api("joinPick", { clubId: d.dataset.club });
        if (res.ok) { st.view = "game"; render(); }
        else toast(res.reason || "Falha ao assumir o clube.");
      }));
    });
  }

  function showFreezeBanner(text) {
    hideFreezeBanner();
    const el = document.createElement("div");
    el.id = "join-banner";
    el.className = "modal-overlay";
    el.innerHTML = '<div class="modal" style="text-align:center"><h3 style="margin:0">⏸ Aguardando</h3><p class="muted">' + esc(text) + "</p></div>";
    document.body.appendChild(el);
  }
  function hideFreezeBanner() { const b = document.getElementById("join-banner"); if (b) b.remove(); }

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
    st.view = r.needsClub ? "joinPick" : (r.lobby.phase === "lobby" ? "lobby" : "game");
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
              (p.clubId ? esc(lobbyClubName(p.clubId)) : "<span class='muted'>escolhendo clube…</span>") + "</td>" +
              "<td>" + (p.id === lb.hostId ? "" : (p.lobbyReady ? "<span class='text-green'>✔ pronto</span>" : "<span class='muted'>aguardando</span>")) + "</td></tr>").join("") +
          "</tbody></table>" +
          (isHost()
            ? '<div class="row" style="margin-top:10px"><label>País: <select id="lb-country">' +
              Object.keys(COUNTRY_NAMES).map(c => '<option value="' + c + '"' + (c === lb.countryId ? " selected" : "") + ">" + COUNTRY_NAMES[c] + "</option>").join("") +
              '</select></label><button class="btn primary" id="lb-start"' + (lb.canStart ? "" : " disabled") + ">▶ Iniciar jogo</button></div>" +
              (lb.canStart ? "" : "<p class='muted' style='font-size:.8rem;margin-top:6px'>O botão libera quando todos escolherem clube e clicarem em <b>Pronto</b>.</p>")
            : '<div class="row" style="margin-top:10px"><button class="btn ' + (meLobbyReady() ? "" : "primary") + '" id="lb-ready"' + (me() && me().clubId ? "" : " disabled") + ">" + (meLobbyReady() ? "✔ Pronto (aguardando)" : "Estou pronto") + "</button>" +
              "<span class='muted' style='font-size:.82rem'>" + (me() && me().clubId ? "Confirme quando escolher o clube." : "Escolha um clube abaixo.") + "</span></div>") +
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
    const readyBtn = $("#lb-ready");
    if (readyBtn) readyBtn.addEventListener("click", async () => {
      await api("lobbyReady", { ready: !meLobbyReady() });
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
    ["table", "🏆 Tabela"], ["clubs", "🏟️ Clubes"], ["cup", "🏅 Copa"], ["transfers", "💱 Transferências"],
    ["finances", "💰 Finanças"], ["news", "📰 Notícias"], ["chat", "💬 Chat"]
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
        soundHtml() +
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
    bindSound(app);
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
    } else if (st.tab === "clubs") {
      drawClubs(el);
    } else if (st.tab === "clubView") {
      drawClubView(el);
    } else if (st.tab === "cup") {
      drawCup(el);
    } else if (st.tab === "transfers") {
      drawTransfers(el, club);
    } else if (st.tab === "finances") {
      drawFinances(el, club);
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

  function footLabel(p) { return p.foot === "E" ? "Canhoto" : p.foot === "A" ? "Ambidestro" : "Destro"; }

  function drawSquad(el, club) {
    const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
    const players = club.players.slice().sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating);
    el.innerHTML =
      "<h2>Elenco <span class='muted' style='font-size:.9rem'>(salários " + money(F.squadWages(club)) + "/rodada)</span></h2>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th>Pé</th><th class="num">Força</th><th>Características</th><th>Energia</th><th class="num">J</th><th class="num">G</th><th class="num">Salário</th><th class="num">Contrato</th><th>Status</th></tr></thead><tbody>' +
      players.map(p =>
        '<tr data-p="' + p.id + '" style="cursor:pointer"><td>' + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td>" +
        '<td class="num">' + p.age + "</td><td>" + footLabel(p) + "</td><td class=\"num\">" + rBadge(p.rating) + "</td>" +
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
    const sp = st.personal.setPieces || {};
    const formation = M.FORMATIONS[t.formationName] || M.FORMATIONS["4-4-2"];
    const coords = M.FORMATION_COORDS[t.formationName] || M.FORMATION_COORDS["4-4-2"];
    const byId = {};
    for (const p of club.players) byId[p.id] = p;
    let selSlot = null; // índice do slot selecionado no campo

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
      '<div><div class="card" id="sl-setpieces"></div><div class="card mb0" id="sl-avail"></div></div></div>';

    function starterPlayers() { return st.personal.squad.starters.map(id => id ? byId[id] : null); }

    function drawSetPieces() {
      const starters = starterPlayers().filter(Boolean);
      const opt = (sel, gkOk) => starters.filter(p => gkOk || p.pos !== "GOL")
        .map(p => '<option value="' + p.id + '"' + (p.id === sel ? " selected" : "") + ">" + esc(p.name) + " (" + p.pos + ")</option>").join("");
      $("#sl-setpieces").innerHTML =
        "<h3 style='margin-top:0'>Capitão e cobradores</h3>" +
        '<div class="set-pieces">' +
          '<div class="sp-item"><span>👑 Capitão</span><select data-sp="captain">' + opt(sp.captain, true) + "</select></div>" +
          '<div class="sp-item"><span>🎯 Faltas</span><select data-sp="freeKick">' + opt(sp.freeKick) + "</select></div>" +
          '<div class="sp-item"><span>◀ Esc. esq.</span><select data-sp="cornerLeft">' + opt(sp.cornerLeft) + "</select></div>" +
          '<div class="sp-item"><span>▶ Esc. dir.</span><select data-sp="cornerRight">' + opt(sp.cornerRight) + "</select></div></div>";
      $("#sl-setpieces").querySelectorAll("[data-sp]").forEach(s => s.addEventListener("change", async e => {
        sp[e.target.dataset.sp] = e.target.value;
        await api("setPieces", { key: e.target.dataset.sp, id: e.target.value });
      }));
    }

    function drawAvail() {
      const slotPos = selSlot != null ? formation[selSlot] : null;
      const used = new Set(st.personal.squad.starters.filter(Boolean));
      const eligible = club.players.filter(p => p.contractYears > 0 && !p.injuryWeeks && !p.suspended)
        .sort((a, b) => slotPos ? (b.rating * M.positionFactor(b, slotPos)) - (a.rating * M.positionFactor(a, slotPos)) : b.rating - a.rating);
      $("#sl-avail").innerHTML =
        "<h3 style='margin-top:0'>Jogadores disponíveis" + (slotPos ? " — vaga de <b>" + slotPos + "</b>" : "") + "</h3>" +
        (slotPos ? "<p class='muted' style='font-size:.78rem;margin-bottom:6px'>Clique num jogador para escalar nessa posição. <span class='text-green'>Verde = da posição.</span></p>"
          : "<p class='muted' style='font-size:.78rem;margin-bottom:6px'>Clique numa camisa no campo para escolher a vaga, depois num jogador aqui.</p>") +
        '<table class="data"><tbody>' +
        eligible.map(p => {
          const inXI = used.has(p.id);
          const sug = slotPos && p.pos === slotPos;
          return "<tr data-pick='" + p.id + "'" + (selSlot != null ? " style='cursor:pointer'" : "") + " class='" + (sug ? "sug-row" : "") + "'>" +
            "<td>" + pBadge(p.pos) + "</td><td>" + esc(p.name) + (inXI ? " <span class='muted'>(titular)</span>" : "") + "</td>" +
            "<td class='num'>" + rBadge(p.rating) + "</td><td>" + bar(p.energy) + "</td></tr>";
        }).join("") + "</tbody></table>";
      if (selSlot != null) $("#sl-avail").querySelectorAll("[data-pick]").forEach(tr => tr.addEventListener("click", () => assign(tr.dataset.pick)));
    }

    async function assign(pid) {
      const idx = selSlot;
      const starters = st.personal.squad.starters;
      const prevAt = starters.indexOf(pid);
      if (prevAt >= 0 && prevAt !== idx) starters[prevAt] = starters[idx]; // troca com quem estava lá
      starters[idx] = pid;
      st.personal.squad.bench = st.personal.squad.bench.filter(id => id !== pid);
      rebuildBench();
      selSlot = null;
      drawPitch(); drawAvail(); drawSetPieces();
      await api("lineup", { starters: st.personal.squad.starters, bench: st.personal.squad.bench });
    }

    function rebuildBench() {
      const used = new Set(st.personal.squad.starters.filter(Boolean));
      const cur = st.personal.squad.bench.filter(id => byId[id] && !used.has(id));
      const rest = club.players.filter(p => !used.has(p.id) && !cur.includes(p.id) && p.contractYears > 0 && !p.injuryWeeks && !p.suspended)
        .sort((a, b) => b.rating - a.rating);
      while (cur.length < 7 && rest.length) cur.push(rest.shift().id);
      st.personal.squad.bench = cur.slice(0, 7);
    }

    function drawPitch() {
      const pitch = $("#pitch");
      pitch.querySelectorAll(".shirt").forEach(s => s.remove());
      formation.forEach((pos, i) => {
        const pid = st.personal.squad.starters[i];
        const p = pid ? byId[pid] : null;
        const [x, y] = coords[i];
        const div = document.createElement("div");
        div.className = "shirt" + (p ? "" : " empty") + (pos === "GOL" ? " gk" : "") + (selSlot === i ? " selected" : "");
        div.style.left = x + "%";
        div.style.top = (100 - y) + "%";
        const eColor = p ? (p.energy > 60 ? "var(--green)" : p.energy > 35 ? "var(--yellow)" : "var(--red)") : "";
        const isCap = p && sp.captain === p.id;
        div.innerHTML = '<div class="jersey">' + (p ? Math.round(p.rating) : pos) + "</div>" +
          (p ? '<div class="shirt-energy"><i style="width:' + Math.round(p.energy) + "%;background:" + eColor + '"></i></div>' : "") +
          '<div class="pname' + (p && p.pos !== pos ? " improv" : "") + '">' + (p ? (isCap ? "© " : "") + esc(p.name.split(" ").slice(-1)[0]) : "vazio") + "</div>";
        div.addEventListener("click", () => { selSlot = selSlot === i ? null : i; drawPitch(); drawAvail(); });
        pitch.appendChild(div);
      });
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
      if (r.squad) { st.personal.squad = r.squad; selSlot = null; drawPitch(); drawAvail(); drawSetPieces(); }
    });
    drawPitch(); drawSetPieces(); drawAvail();
  }

  function drawTable(el) {
    const lbc = st.shared.leaguesByCountry || {};
    const cid = st._tblCountry || myClub().countryId;
    const league = lbc[cid];
    if (!league) { el.innerHTML = "<h2>Classificação</h2><p class='muted'>Sincronizando…</p>"; return; }
    const div = st._tblDiv || (cid === myClub().countryId ? myClub().division : "A");
    const rows = C.sortTable(league.tables[div]);
    const relegN = league.relegated;
    el.innerHTML =
      "<h2>Classificação</h2>" +
      '<div class="card"><div class="row">' +
        '<select id="tb-country">' + Object.keys(lbc).map(c => '<option value="' + c + '"' + (c === cid ? " selected" : "") + ">" + esc(lbc[c].name) + "</option>").join("") + "</select>" +
        '<select id="tb-div"><option value="A"' + (div === "A" ? " selected" : "") + ">" + esc(league.leagueNames.A) + '</option><option value="B"' + (div === "B" ? " selected" : "") + ">" + esc(league.leagueNames.B) + "</option></select>" +
        '<span class="muted">Rodada ' + league.currentRound + "/" + league.totalRounds + "</span></div></div>" +
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
    $("#tb-country").addEventListener("change", e => { st._tblCountry = e.target.value; st._tblDiv = "A"; drawTab(el); });
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

  // ---------- finanças e estádio ----------
  function drawFinances(el, club) {
    const wages = F.squadWages(club);
    const sponsor = F.seasonSponsorship(club);
    const sugg = F.suggestedTicketPrice(club);
    el.innerHTML =
      "<h2>Finanças e estádio</h2>" +
      '<div class="grid2">' +
        '<div class="card"><h3 style="margin-top:0">Caixa</h3>' +
          '<p style="font-size:1.8rem;font-weight:800" class="' + (club.money < 0 ? "money-neg" : "text-green") + '">' + money(club.money) + "</p>" +
          "<p class='muted'>Salários por rodada: <b>" + money(wages) + "</b></p>" +
          "<p class='muted'>Patrocínio anual: <b>" + money(sponsor) + "</b> (pago no início da temporada)</p>" +
          "<p class='muted'>Moral da torcida: " + bar(club.moralTorcida) + " " + Math.round(club.moralTorcida) + "%</p></div>" +
        '<div class="card"><h3 style="margin-top:0">Ingressos</h3>' +
          "<p class='muted'>Preço sugerido: " + money(sugg) + "</p>" +
          '<div class="row"><label>Preço do ingresso: <input type="number" id="fi-tk" value="' + club.ticketPrice + '" min="5" max="500" style="width:110px"></label>' +
          '<button class="btn small" id="fi-tkset">Aplicar</button></div>' +
          "<p class='muted' style='margin-top:8px;font-size:.83rem'>Preços altos afastam o público. Com a torcida animada dá para cobrar mais.</p></div>" +
        '<div class="card"><h3 style="margin-top:0">Estádio: ' + esc(club.stadium) + "</h3>" +
          "<p>Capacidade: <b>" + club.capacity.toLocaleString("pt-BR") + "</b> lugares</p>" +
          (club.stadiumWorks ? "<p class='text-gold'>Obras: +" + club.stadiumWorks.seats.toLocaleString("pt-BR") + " lugares (" + club.stadiumWorks.weeksLeft + " semanas)</p>" :
            '<div class="row">' + [5000, 10000, 20000].map(s => '<button class="btn small" data-exp="' + s + '">+' + (s / 1000) + " mil (" + money(F.stadiumExpansionCost(s)) + ")</button>").join("") + "</div>") +
        "</div>" +
        '<div class="card"><h3 style="margin-top:0">Gramado</h3><p>Condição: <b>' + esc(club.grass) + "</b></p>" +
        "<p class='muted' style='font-size:.83rem'>Gramados ruins atrapalham jogadores técnicos.</p></div>" +
      "</div>";
    $("#fi-tkset").addEventListener("click", async () => {
      const v = Math.max(5, Math.min(500, parseInt($("#fi-tk").value, 10) || sugg));
      await api("ticket", { price: v });
      toast("Preço do ingresso: " + money(v));
    });
    el.querySelectorAll("[data-exp]").forEach(b => b.addEventListener("click", async () => {
      const r = await api("expand", { seats: parseInt(b.dataset.exp, 10) });
      toast(r.ok ? "Obras encomendadas!" : (r.reason || "Falha"));
    }));
  }

  // ---------- clubes (navegar times e ofertar) ----------
  function drawClubs(el) {
    const lbc = st.shared.leaguesByCountry || {};
    const cid = st._clubsCountry || myClub().countryId;
    const clubs = Object.values(st.shared.clubs).filter(c => c.countryId === cid).sort((a, b) => b.rating - a.rating);
    el.innerHTML =
      "<h2>Clubes</h2>" +
      '<div class="card"><div class="row"><select id="cb-country">' +
        Object.keys(lbc).map(c => '<option value="' + c + '"' + (c === cid ? " selected" : "") + ">" + esc(lbc[c].name) + "</option>").join("") + "</select></div></div>" +
      '<div class="club-grid">' +
      clubs.map(c =>
        '<div class="club-pick" data-club="' + c.id + '">' + crest(c, 34) +
        '<div><div class="cname">' + esc(c.name) + '</div><div class="cinfo">Série ' + c.division + " · Força " + c.rating + " · " + c.players.length + " jog." +
        (humanNameByClub(c.id) ? " · <span class='text-green'>" + esc(humanNameByClub(c.id)) + "</span>" : "") + "</div></div></div>").join("") +
      "</div>";
    $("#cb-country").addEventListener("change", e => { st._clubsCountry = e.target.value; drawTab(el); });
    el.querySelectorAll("[data-club]").forEach(d => d.addEventListener("click", () => { st._clubView = d.dataset.club; st.tab = "clubView"; render(); }));
  }

  function drawClubView(el) {
    const club = clubById(st._clubView);
    if (!club) { st.tab = "clubs"; render(); return; }
    const mine = club.id === myClub().id;
    const win = st.shared.window;
    const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
    const players = club.players.slice().sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating);
    el.innerHTML =
      '<h2><button class="btn small" id="cv-back">←</button> ' + crest(club, 28) + " " + esc(club.name) +
      ' <span class="muted" style="font-size:.85rem">Série ' + club.division + " · Força " + club.rating + (humanNameByClub(club.id) ? " · Téc.: " + esc(humanNameByClub(club.id)) : " · IA") + "</span></h2>" +
      (!mine ? '<p class="' + (win.open ? "text-green" : "money-neg") + '" style="margin-bottom:10px">' + esc(win.message) + "</p>" : "") +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th>Pé</th><th class="num">Força</th><th>Características</th><th class="num">Contrato</th><th class="num">Pedida</th>' + (!mine ? "<th></th>" : "") + "</tr></thead><tbody>" +
      players.map(p =>
        "<tr><td>" + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b></td><td class='num'>" + p.age + "</td><td>" + footLabel(p) + "</td><td class='num'>" + rBadge(p.rating) + "</td>" +
        "<td>" + (p.traits || []).map(t => '<span class="trait">' + esc(t) + "</span>").join("") + "</td>" +
        "<td class='num'>" + (p.contractYears > 0 ? p.contractYears + " ano(s)" : "livre") + "</td>" +
        "<td class='num'>" + (p.contractYears > 0 ? money(T.askingPrice(p, club)) : "—") + "</td>" +
        (!mine ? '<td><button class="btn small" data-offer="' + p.id + '">Proposta</button></td>' : "") + "</tr>").join("") +
      "</tbody></table></div>";
    el.querySelector("#cv-back").addEventListener("click", () => { st.tab = "clubs"; render(); });
    el.querySelectorAll("[data-offer]").forEach(b => b.addEventListener("click", () => offerModal(b.dataset.offer)));
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
      const sent = st.personal.sentBids || [];
      inner =
        '<div class="card">' +
        "<h3 style='margin-top:0'>Propostas enviadas (aguardando resposta)</h3>" +
        (sent.length ? '<table class="data"><tbody>' + sent.map(b => {
          const owner = clubById(b.ownerClubId);
          return "<tr><td><b>" + esc(b.name) + "</b></td><td class='muted'>" + esc(owner ? owner.name : "-") + "</td><td class='num'>" + money(b.value) + "</td><td class='muted'>responde na próxima rodada</td></tr>";
        }).join("") + "</tbody></table>" : "<p class='muted'>Nenhuma proposta a clubes da IA aguardando. As respostas chegam na rodada seguinte.</p>") +
        "</div>" +
        '<div class="card mb0">' +
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
      const i = parseInt(card.dataset.i, 10);
      const m = live.matches[i];
      const mine = m.humanH === st.session.playerId || m.humanA === st.session.playerId;
      if (mine && !m.fin) { openLiveManage(); return; }
      live.selected = i;
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
    let html = soundHtml();
    if (live.waitingMe) html += '<button class="btn primary" id="rc-2half">▶ Pronto para o 2º tempo</button>';
    if (myMatch && !myMatch.fin) html += '<button class="btn" id="rc-manage">⚙️ Gerir meu time</button>';
    if (!myMatch) html += '<span class="muted">Acompanhando a rodada…</span>';
    el.innerHTML = html;
    bindSound(el);
    const b2 = $("#rc-2half");
    if (b2) b2.addEventListener("click", async () => { live.waitingMe = false; renderRoundControls(); await api("ready2h"); });
    const bm = $("#rc-manage");
    if (bm) bm.addEventListener("click", openLiveManage);
  }

  // ---------- banner de pausa (quando outro técnico gerencia) ----------
  function showPausedBanner(byName) {
    hidePausedBanner();
    const el = document.createElement("div");
    el.id = "paused-banner";
    el.className = "modal-overlay";
    el.innerHTML = '<div class="modal" style="text-align:center"><h3 style="margin:0">⏸ Rodada pausada</h3><p class="muted">' + esc(byName || "Um técnico") + " está mexendo no time…</p></div>";
    document.body.appendChild(el);
  }
  function hidePausedBanner() { const b = document.getElementById("paused-banner"); if (b) b.remove(); }

  // ---------- gestão ao vivo online (pausa a rodada de todos) ----------
  function openLiveManage() {
    if (st._manageOv) return;
    const myMatch = st.live.matches.find(m => m.humanH === st.session.playerId || m.humanA === st.session.playerId);
    if (!myMatch || myMatch.fin) return;
    api("manageOpen").then(r => {
      if (!r.ok) { toast(r.reason || "Não foi possível gerir agora."); return; }
      st._managing = true;
      const mL = r.lineup;
      let sel = null;
      const t = { style: st.personal.tactics.style, marking: st.personal.tactics.marking };
      const ov = document.createElement("div");
      ov.className = "modal-overlay manage-overlay";
      ov.innerHTML =
        '<div class="modal manage-modal">' +
          '<div class="manage-head"><h3 style="margin:0">Gerir meu time <span class="muted" id="lm-sub"></span></h3>' +
            '<button class="btn primary" id="lm-ready">✔ Pronto — voltar ao jogo</button></div>' +
          '<div class="manage-tactics" id="lm-tac"></div>' +
          '<div class="manage-grid"><div class="pitch" id="lm-pitch"><div class="center-line"></div><div class="center-circle"></div></div><div id="lm-side"></div></div>' +
          "<p class='muted' style='font-size:.78rem;margin-top:6px'>A rodada fica pausada para todos enquanto você mexe. Clique num jogador do campo e depois em outro (trocar) ou no banco (substituir).</p>" +
        "</div>";
      document.body.appendChild(ov);
      st._manageOv = ov;

      function subsLeft() { return 5 - (mL.subsUsed || 0); }
      function onField() { return mL.lineup.map(s => s.player).filter(Boolean); }
      function updateSub() { ov.querySelector("#lm-sub").textContent = "· " + subsLeft() + " substituições restantes"; }

      function drawTac() {
        const opt = (selId, gkOk) => onField().filter(p => gkOk || p.pos !== "GOL").map(p => '<option value="' + p.id + '"' + (p.id === selId ? " selected" : "") + ">" + esc(p.name) + " (" + p.pos + ")</option>").join("");
        const seg = (name, key, cur, opts) => '<div class="seg-row"><span class="muted" style="min-width:64px;font-size:.8rem">' + name + "</span>" +
          opts.map(([v, l]) => '<button class="btn small seg' + (cur === v ? " primary" : "") + '" data-tac="' + key + '" data-val="' + v + '">' + l + "</button>").join("") + "</div>";
        ov.querySelector("#lm-tac").innerHTML =
          '<div class="seg-row"><span class="muted" style="min-width:64px;font-size:.8rem">Formação</span><select id="lm-form">' +
            Object.keys(M.FORMATIONS).map(f => "<option" + (f === mL.formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></div>" +
          seg("Estilo", "style", t.style, [["equilibrado", "Equilibrado"], ["ataque", "Ataque total"], ["retranca", "Retranca"]]) +
          seg("Marcação", "marking", t.marking, [["leve", "Leve"], ["pesada", "Pesada"], ["muito pesada", "Muito pesada"]]) +
          '<div class="set-pieces"><div class="sp-item"><span>👑 Capitão</span><select data-lsp="captain">' + opt(mL.captainId, true) + "</select></div>" +
            '<div class="sp-item"><span>🎯 Faltas</span><select data-lsp="freeKick">' + opt(mL.setPieces.freeKick) + "</select></div>" +
            '<div class="sp-item"><span>◀ Esc. esq.</span><select data-lsp="cornerLeft">' + opt(mL.setPieces.cornerLeft) + "</select></div>" +
            '<div class="sp-item"><span>▶ Esc. dir.</span><select data-lsp="cornerRight">' + opt(mL.setPieces.cornerRight) + "</select></div></div>";
        ov.querySelector("#lm-form").addEventListener("change", async e => {
          const r2 = await api("liveReform", { formation: e.target.value });
          if (r2.lineup) { Object.assign(mL, r2.lineup); sel = null; drawTac(); drawPitch(); drawSide(); }
        });
        ov.querySelectorAll("[data-tac]").forEach(b => b.addEventListener("click", async () => {
          t[b.dataset.tac] = b.dataset.val; await api("liveTactics", { style: t.style, marking: t.marking }); drawTac();
        }));
        ov.querySelectorAll("[data-lsp]").forEach(s => s.addEventListener("change", async e => {
          const key = e.target.dataset.lsp;
          if (key === "captain") { mL.captainId = e.target.value; await api("liveCaptain", { id: e.target.value }); }
          else { mL.setPieces[key] = e.target.value; await api("liveSetPiece", { key, id: e.target.value }); }
          drawPitch();
        }));
      }

      function drawPitch() {
        const pitch = ov.querySelector("#lm-pitch");
        pitch.querySelectorAll(".shirt").forEach(s => s.remove());
        const coords = M.FORMATION_COORDS[mL.formationName] || M.FORMATION_COORDS["4-4-2"];
        mL.lineup.forEach((slot, i) => {
          const p = slot.player;
          const [x, y] = coords[i] || [50, 50];
          const div = document.createElement("div");
          div.className = "shirt" + (p ? "" : " empty") + (slot.slotPos === "GOL" ? " gk" : "") + (p && sel === p.id ? " selected" : "");
          div.style.left = x + "%"; div.style.top = (100 - y) + "%";
          const eColor = p ? (p.energy > 60 ? "var(--green)" : p.energy > 35 ? "var(--yellow)" : "var(--red)") : "";
          div.innerHTML = '<div class="jersey">' + (p ? Math.round(p.rating) : slot.slotPos) + "</div>" +
            (p ? '<div class="shirt-energy"><i style="width:' + Math.round(p.energy) + "%;background:" + eColor + '"></i></div>' : "") +
            '<div class="pname' + (p && p.pos !== slot.slotPos ? " improv" : "") + '">' + (p ? (mL.captainId === p.id ? "© " : "") + esc(p.name.split(" ").slice(-1)[0]) : slot.slotPos) + "</div>";
          div.addEventListener("click", () => onPitch(slot));
          pitch.appendChild(div);
        });
      }

      function onPitch(slot) {
        if (!slot.player) return;
        const id = slot.player.id;
        if (sel === null || sel === id) { sel = sel === id ? null : id; drawPitch(); drawSide(); return; }
        const a = mL.lineup.find(s => s.player && s.player.id === sel);
        confirmModal("Trocar de posição: <b>" + esc(a.player.name) + "</b> ⇄ <b>" + esc(slot.player.name) + "</b>?", async () => {
          const r2 = await api("liveSwap", { a: sel, b: id });
          if (r2.lineup) Object.assign(mL, r2.lineup); else toast(r2.reason || "Falha");
          sel = null; drawPitch(); drawSide();
        }, () => { sel = null; drawPitch(); drawSide(); });
      }

      function drawSide() {
        const side = ov.querySelector("#lm-side");
        const selP = sel ? onField().find(p => p && p.id === sel) : null;
        const bench = mL.bench.filter(Boolean);
        let html = "";
        if (selP) {
          html += "<div class='card mb0' style='padding:12px'><h3 style='margin:0 0 6px'>" + esc(selP.name) + " " + rBadge(selP.rating) + "</h3>" +
            "<p class='muted' style='font-size:.8rem;margin-bottom:8px'>Energia " + selP.energy + "% · clique noutro do campo para trocar.</p>" +
            "<div class='muted' style='font-size:.78rem;margin-bottom:4px'>⬆ Substituir por (<span class='text-green'>sugeridos em destaque</span>):</div>";
          if (subsLeft() <= 0) html += "<p class='muted' style='font-size:.8rem'>Sem substituições restantes.</p>";
          else if (!bench.length) html += "<p class='muted' style='font-size:.8rem'>Banco vazio.</p>";
          else html += bench.map(b => '<button class="btn small bench-btn' + (b.pos === selP.pos ? " sug" : "") + '" data-in="' + b.id + '">' + pBadge(b.pos) + " " + esc(b.name.split(" ").slice(-1)[0]) + " " + Math.round(b.rating) + " · " + b.energy + "%</button>").join("");
          html += "</div>";
        } else {
          html = "<div class='card mb0' style='padding:12px'><h3 style='margin:0 0 6px'>Banco de reservas</h3>" +
            (bench.length ? '<table class="data"><tbody>' + bench.map(b => "<tr><td>" + pBadge(b.pos) + "</td><td>" + esc(b.name) + "</td><td class='num'>" + rBadge(b.rating) + "</td><td class='num'>" + b.energy + "%</td></tr>").join("") + "</tbody></table>" : "<p class='muted'>Banco vazio.</p>") +
            "<p class='muted' style='font-size:.78rem;margin-top:8px'>Selecione um jogador em campo.</p></div>";
        }
        side.innerHTML = html;
        side.querySelectorAll("[data-in]").forEach(b => b.addEventListener("click", () => {
          const inP = mL.bench.find(x => x.id === b.dataset.in);
          confirmModal("Substituir <b>" + esc(selP.name) + "</b> por <b>" + esc(inP ? inP.name : "?") + "</b>?", async () => {
            const r2 = await api("sub", { out: sel, in: b.dataset.in });
            if (r2.ok && r2.lineup) { Object.assign(mL, r2.lineup); window.TF.sounds.play("sub"); sel = null; drawPitch(); drawSide(); updateSub(); }
            else toast(r2.reason || "Falha");
          });
        }));
      }

      ov.querySelector("#lm-ready").addEventListener("click", closeLiveManage);
      drawTac(); drawPitch(); drawSide(); updateSub();
    });
  }

  function closeLiveManage() {
    if (st._manageOv) { st._manageOv.remove(); st._manageOv = null; }
    st._managing = false;
    api("manageClose");
  }

  function confirmModal(html, onYes, onNo) {
    modal("<h3>Confirmar alteração</h3><p>" + html + "</p><div class='actions'><button class='btn' data-no>Cancelar</button><button class='btn primary' data-yes>Confirmar</button></div>",
      ov => {
        ov.addEventListener("click", e => e.stopPropagation());
        ov.querySelector("[data-no]").addEventListener("click", () => { ov.remove(); if (onNo) onNo(); });
        ov.querySelector("[data-yes]").addEventListener("click", () => { ov.remove(); onYes(); });
      });
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
