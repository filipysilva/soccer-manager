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
      if (!st._chatOpen) { st._chatUnread = (st._chatUnread || 0) + 1; updateChatBadge(); } // §35 badge de não-lidas
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
        if (m) { m.gh = u.gh; m.ga = u.ga; m.min = u.min; m.ph = u.ph; m.fin = u.fin; if (u.stats) m.stats = u.stats; }
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
    // §10 pausa global unificada (gestão/intervalo/pênalti) + lista de quem falta no intervalo
    es.addEventListener("pauseState", e => applyPause(JSON.parse(e.data)));
    // §11-18 pênalti com tensão
    es.addEventListener("penalty", e => { st.penalty = JSON.parse(e.data); renderPenaltyOverlay(); });
    es.addEventListener("penaltyEnd", () => { st.penalty = null; removePenaltyOverlay(); });
    // §28 disputa de pênaltis
    es.addEventListener("shootout", e => { st.shootout = JSON.parse(e.data); renderShootoutOverlay(); });
    es.addEventListener("shootoutEnd", () => { st.shootout = null; removeShootoutOverlay(); });
    // §10 reconexão: reconstrói a rodada ao vivo em andamento
    es.addEventListener("roundSnapshot", e => {
      const d = JSON.parse(e.data);
      st.live = {
        label: d.label,
        matches: d.matches.map(m => ({ ...m })),
        selected: Math.max(0, d.matches.findIndex(m => m.humanH === st.session.playerId || m.humanA === st.session.playerId)),
        waitingMe: false
      };
      st.view = "round";
      window.TF.sounds.startAmbience();
      render();
      applyPause(d.pause);
      if (d.penalty) { st.penalty = d.penalty; renderPenaltyOverlay(); } // reconexão durante pênalti
      if (d.shootout) { st.shootout = d.shootout; renderShootoutOverlay(); } // reconexão durante disputa
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

  // §35 chat como drawer lateral
  function updateChatBadge() {
    const b = $("#chat-badge");
    if (!b) return;
    if (st._chatUnread) { b.textContent = st._chatUnread > 9 ? "9+" : st._chatUnread; b.style.display = ""; }
    else b.style.display = "none";
  }
  function openChatDrawer() {
    const d = $("#chat-drawer"); if (d) d.classList.add("open");
    st._chatOpen = true; st._chatUnread = 0; updateChatBadge();
    const log = $("#chat-log"); if (log) log.scrollTop = log.scrollHeight;
    const inp = $("#chat-in"); if (inp) inp.focus();
  }
  function closeChatDrawer() { const d = $("#chat-drawer"); if (d) d.classList.remove("open"); st._chatOpen = false; }
  function toggleChatDrawer(force) {
    const open = force === undefined ? !st._chatOpen : force;
    if (open) openChatDrawer(); else closeChatDrawer();
  }

  // ---------- tela principal da sala ----------
  // §22 menu agrupado
  const TAB_GROUPS = [
    ["Rodada", [["rodada", "▶ Rodada"], ["dashboard", "🏠 Visão geral"]]],
    ["Meu time", [["squad", "👥 Elenco"], ["lineup", "📋 Escalação"]]],
    ["Competição", [["table", "🏆 Tabela"], ["cup", "🏅 Copa"], ["ranking", "🎖️ Ranking"], ["calendar", "📅 Calendário"], ["clubs", "🏟️ Clubes"]]],
    ["Gestão", [["transfers", "💱 Transferências"], ["finances", "💰 Finanças"]]],
    ["Sala", [["news", "📰 Notícias"]]]
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
    const clubSub = U.joinDot("Sala " + st.session.code, esc(st.session.name), "Série " + club.division);
    app.innerHTML =
      '<div class="topbar">' +
        '<div class="tb-club">' + crest(club, 40) +
          '<div class="club-info"><div class="club-name">' + esc(club.name) + '</div>' +
          '<div class="club-sub">' + clubSub + "</div></div>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<div class="tb-stats">' +
          '<div class="stat"><div class="label">Caixa</div><div class="value' + (club.money < 0 ? " money-neg" : "") + '">' + money(club.money) + "</div></div>" +
          '<div class="stat"><div class="label">Temporada</div><div class="value">' + esc(U.formatSeasonLabel(st.shared.seasonYear, st.shared.week)) + "</div></div>" +
          '<div class="stat tb-next"><div class="label">Próximo jogo</div><div class="value">' + esc(st.shared.slot.label) + "</div></div>" +
          '<div class="stat"><div class="label">Prontos</div><div class="value">' + readyCount + "/" + onlineCount + "</div></div>" +
        "</div>" +
        soundHtml() +
        '<button class="btn ' + (meP && meP.ready ? "" : "primary") + ' btn-advance" id="btn-ready">' + (meP && meP.ready ? "✔ Aguardando…" : "Pronto ▶") + "</button>" +
      "</div>" +
      '<div class="main">' +
        '<nav class="sidebar">' +
          TAB_GROUPS.map(g => '<div class="nav-group">' + esc(g[0]) + "</div>" +
            g[1].map(t => '<button class="nav-item' + (st.tab === t[0] ? " active" : "") + '" data-tab="' + t[0] + '"><span class="txt">' + t[1] + "</span></button>").join("")
          ).join("") +
        "</nav>" +
        '<div class="content" id="content"></div>' +
      "</div>" +
      // §35 chat como drawer lateral + botão flutuante
      '<button class="chat-fab" id="chat-fab" title="Chat da sala">💬<span class="chat-badge" id="chat-badge" style="display:none"></span></button>' +
      '<div class="chat-drawer" id="chat-drawer">' +
        '<div class="chat-drawer-head"><b>Chat da sala</b><button class="btn" id="chat-close">✕</button></div>' +
        '<div id="chat-log" class="chat-drawer-log">' + chatHtml() + "</div>" +
        '<div class="row" style="padding:10px"><input id="chat-in" placeholder="Mensagem..." style="flex:1" maxlength="300"><button class="btn" id="chat-send">Enviar</button></div>' +
      "</div>";
    app.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { st.tab = b.dataset.tab; render(); }));
    $("#chat-fab").addEventListener("click", () => toggleChatDrawer());
    $("#chat-close").addEventListener("click", () => toggleChatDrawer(false));
    bindChat();
    if (st._chatOpen) openChatDrawer();
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
    } else if (st.tab === "dashboard") {
      drawDashboard(el);
    } else if (st.tab === "calendar") {
      drawCalendar(el);
    } else if (st.tab === "cup") {
      drawCup(el);
    } else if (st.tab === "ranking") {
      drawRanking(el);
    } else if (st.tab === "transfers") {
      drawTransfers(el, club);
    } else if (st.tab === "finances") {
      drawFinances(el, club);
    } else if (st.tab === "news") {
      drawNews(el);
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
  function star(p) { return p && p.star ? ' <span class="star-mark" title="Craque">⭐</span>' : ""; }

  // painel tático (mesmo do offline, adaptado ao cliente online)
  const TAC = () => window.TF.tactics;
  function tacticsSelects(t) {
    const D = TAC().DIMENSIONS, G = TAC().GROUPS || {};
    let html = "", curGroup = null;
    for (const k of Object.keys(D)) {
      const g = G[k];
      if (g && g !== curGroup) { html += '<div class="tac-group">' + esc(g) + "</div>"; curGroup = g; }
      html += '<label class="tac-sel"><span class="muted">' + D[k].label + '</span><select data-tac="' + k + '">' +
        D[k].options.map(o => '<option value="' + o[0] + '"' + (t[k] === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select></label>";
    }
    return html;
  }
  function tacticsDescriptions(t) {
    const D = TAC().DIMENSIONS;
    return Object.keys(D).map(k => { const o = D[k].options.find(x => x[0] === t[k]); return o && o[2] ? "<div><b>" + esc(o[1]) + ":</b> <span class='muted'>" + esc(o[2]) + "</span></div>" : ""; }).filter(Boolean).join("");
  }
  function tacticWarningsHtml(team) {
    const ws = TAC().warnings(team);
    return ws.length ? '<div class="tac-warn">' + ws.map(w => "⚠ " + esc(w)).join("<br>") + "</div>" : "";
  }

  function drawSquad(el, club) {
    const order = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
    const players = club.players.slice().sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.rating - a.rating);
    el.innerHTML =
      "<h2>Elenco <span class='muted' style='font-size:.9rem'>(salários " + money(F.squadWages(club)) + "/rodada)</span></h2>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>Pos</th><th>Nome</th><th class="num">Idade</th><th>Pé</th><th class="num">Força</th><th>Características</th><th>Energia</th><th class="num">J</th><th class="num">G</th><th class="num">Salário</th><th class="num">Contrato</th><th>Status</th></tr></thead><tbody>' +
      players.map(p =>
        '<tr data-p="' + p.id + '" style="cursor:pointer"><td>' + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td>" +
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

    const tn = TAC().normalize(t);
    el.innerHTML =
      "<h2>Escalação e táticas</h2>" +
      '<div class="card"><div class="row" style="align-items:flex-end">' +
        '<label class="tac-sel"><span class="muted">Formação</span><select id="sl-form">' + TAC().FORMATION_NAMES.map(f => "<option" + (f === t.formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
        tacticsSelects(tn) +
        '<label class="tac-sel"><span class="muted">Treino</span><select id="sl-train">' + [["auto", "Auxiliar decide"], ["principais", "Principais"], ["secundarias", "Secundárias"]].map(([v, l]) => '<option value="' + v + '"' + (st.personal.training === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
        '<button class="btn" id="sl-auto">Escalar auto</button>' +
      '</div><div id="sl-tacinfo" style="margin-top:10px"></div></div>' +
      '<div class="lineup-wrap"><div class="pitch" id="pitch"><div class="center-line"></div><div class="center-circle"></div></div>' +
      '<div><div class="card" id="sl-setpieces"></div><div class="card mb0" id="sl-avail"></div></div></div>';

    function refreshTacInfo() {
      const team = { lineup: st.personal.squad.starters.map((id, i) => ({ slotPos: formation[i], player: id ? byId[id] : null })), tactics: TAC().normalize(t) };
      $("#sl-tacinfo").innerHTML = tacticWarningsHtml(team) +
        '<details class="tac-desc"><summary class="muted" style="cursor:pointer;font-size:.82rem">Ver o que cada escolha faz</summary>' + tacticsDescriptions(TAC().normalize(t)) + "</details>";
    }

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
    el.querySelectorAll("[data-tac]").forEach(sel => sel.addEventListener("change", e => {
      st.personal.tactics[e.target.dataset.tac] = e.target.value;
      api("tactics", { [e.target.dataset.tac]: e.target.value });
      refreshTacInfo();
    }));
    $("#sl-train").addEventListener("change", e => api("tactics", { training: e.target.value }));
    $("#sl-auto").addEventListener("click", async () => {
      const r = await api("autoLineup");
      if (r.squad) { st.personal.squad = r.squad; selSlot = null; drawPitch(); drawAvail(); drawSetPieces(); }
    });
    drawPitch(); drawSetPieces(); drawAvail(); refreshTacInfo();
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
    const myId = myClub().id;
    function teamLine(club, goals, win) {
      return '<div class="tie-team' + (win ? " tw" : "") + '">' + crest(club, 16) +
        '<span class="tt-name">' + esc(club.shortName || club.name) + "</span>" +
        '<span class="tt-score">' + (goals != null ? goals : "") + "</span></div>";
    }
    function tieCard(t) {
      const h = clubById(t.home), a = clubById(t.away);
      if (!h || !a) return "";
      const played = t.winner != null;
      const pen = played && t.penalties ? '<div class="tie-pen">pênaltis' + (t.shootout ? " " + t.shootout.scoreH + "-" + t.shootout.scoreA : "") + "</div>" : "";
      const mine = t.home === myId || t.away === myId;
      return '<div class="tie-card' + (mine ? " tie-mine" : "") + '">' +
        teamLine(h, played ? t.gh : null, played && t.winner === t.home) +
        teamLine(a, played ? t.ga : null, played && t.winner === t.away) + pen + "</div>";
    }
    const cols = cup.history.map(hh => ({ phase: hh.phase, ties: hh.results }));
    if (!cup.championId && cup.ties.length) cols.push({ phase: cup.history.length + 1, name: cup.phaseName, ties: cup.ties, current: true });
    cols.sort((a, b) => a.phase - b.phase);
    let bracket = cols.map(col =>
      '<div class="bracket-col"><div class="bracket-phase">' + esc(col.name || C.CUP_PHASES[col.phase] || ("Fase " + col.phase)) + (col.current ? ' <span class="live-dot">●</span>' : "") + "</div>" +
      col.ties.map(tieCard).join("") + "</div>").join("");
    if (cup.championId) {
      const champ = clubById(cup.championId);
      bracket += '<div class="bracket-col"><div class="bracket-phase">Campeão</div><div class="champ-card">🏆<div>' + crest(champ, 30) + "<b>" + esc(champ ? champ.name : "?") + "</b></div></div></div>";
    }
    el.innerHTML = "<h2>" + esc(st.shared.cupName) + "</h2>" +
      (bracket ? '<div class="card scroll-x"><div class="bracket">' + bracket + "</div></div>" : '<div class="card"><p class="muted">O mata-mata ainda não começou.</p></div>');
  }

  // ---------- §34 notícias como inbox ----------
  var NEWS_ICONS = { title: "🏆", transfer: "💱", finance: "💰", match: "⚽", board: "🏛️", warning: "⚠️", info: "📰" };
  var NEWS_FILTERS = [["all", "Tudo"], ["title", "Títulos"], ["transfer", "Transferências"], ["finance", "Finanças"], ["match", "Jogos"]];
  function drawNews(el) {
    const news = (st.personal.news || []);
    const f = st._newsFilter || "all";
    const shown = f === "all" ? news : news.filter(n => n.type === f);
    el.innerHTML = "<h2>Notícias</h2>" +
      '<div class="card news-filters">' + NEWS_FILTERS.map(x => '<button class="chip' + (f === x[0] ? " active" : "") + '" data-nf="' + x[0] + '">' + esc(x[1]) + "</button>").join("") + "</div>" +
      (shown.length ? '<div class="inbox">' + shown.map(n =>
        '<div class="inbox-item ' + esc(n.type) + '"><div class="ib-icon">' + (NEWS_ICONS[n.type] || "📰") + "</div>" +
          '<div class="ib-body"><div class="ib-top"><span class="ib-title">' + esc(n.title) + '</span>' +
          '<span class="ib-date muted">' + esc(U.formatDateLabel(n.season, n.week)) + "</span></div>" +
          '<div class="muted ib-text">' + esc(n.text) + "</div></div></div>").join("") + "</div>"
        : '<p class="muted">Nenhuma notícia' + (f !== "all" ? " nesta categoria" : "") + ".</p>");
    el.querySelectorAll("[data-nf]").forEach(b => b.addEventListener("click", () => { st._newsFilter = b.dataset.nf; drawNews(el); }));
  }

  // ---------- §16/§25 ranking de técnicos ----------
  function aiCoachName(club) {
    const rng = U.createRng(U.hashString(club.id + "|coachname"));
    return window.TF.names.randomName(club.nation || club.countryId, rng);
  }
  function drawRanking(el) {
    const cid = st.shared.countryId;
    const myId = myClub().id;
    const leagueNameA = st.shared.leagueNames.A, leagueNameB = st.shared.leagueNames.B, cupName = st.shared.cupName;
    const ids = Object.keys(st.shared.clubs).filter(id => st.shared.clubs[id].countryId === cid);
    const humansByClub = {}; for (const h of (st.shared.humans || [])) humansByClub[h.clubId] = h.name;
    function prestige(c) {
      let p = Math.max(0, c.rating - 50);
      for (const t of (c.titles || [])) p += t.name === leagueNameA ? 25 : t.name === cupName ? 18 : t.name === leagueNameB ? 8 : 12;
      return Math.round(p);
    }
    const rows = ids.map(id => {
      const c = st.shared.clubs[id];
      const human = humansByClub[id];
      return { c, isMe: id === myId, isHuman: !!human, name: human || aiCoachName(c), titles: (c.titles || []).length, points: prestige(c) };
    }).sort((a, b) => b.points - a.points || b.titles - a.titles);
    el.innerHTML = "<h2>Ranking de técnicos</h2>" +
      '<div class="card scroll-x mb0"><table class="data"><thead><tr><th>#</th><th>Técnico</th><th>Clube</th><th class="num">Títulos</th><th class="num">Prestígio</th></tr></thead><tbody>' +
      rows.map((r, i) => '<tr class="' + (r.isMe ? "me" : "") + '"><td>' + (i + 1) + "º</td><td><b>" + esc(r.name) + "</b>" + (r.isHuman && !r.isMe ? ' <span class="chip" style="padding:1px 6px;font-size:.66rem">humano</span>' : "") + "</td>" +
        '<td><span class="club-cell">' + crest(r.c, 18) + esc(r.c.shortName || r.c.name) + "</span></td><td class='num'>" + r.titles + '</td><td class="num"><b>' + r.points + "</b></td></tr>").join("") +
      "</tbody></table></div>";
  }

  // ---------- §24 visão geral (dashboard) ----------
  function drawDashboard(el) {
    const club = myClub();
    const upcoming = st.personal.upcoming || [];
    const next = upcoming[0];
    const table = C.sortTable(st.shared.tables[club.division] || []);
    const myPos = table.findIndex(r => r.clubId === club.id) + 1;
    const myRow = table[myPos - 1] || { pts: 0, v: 0, e: 0, d: 0 };
    let hero = '<div class="dash-hero card"><div class="muted">Sem jogos futuros nesta temporada.</div></div>';
    if (next) {
      const h = next.home ? clubById(next.home) : null, a = next.away ? clubById(next.away) : null;
      hero = '<div class="dash-hero card"><div class="dh-comp">' + esc(next.comp) + '<span class="muted"> · ' + esc(next.sub || "") + "</span></div>" +
        (h && a ? '<div class="dh-teams"><div class="dh-team">' + crest(h, 46) + "<span>" + esc(h.shortName || h.name) + '</span></div><div class="dh-vs">' + (next.isHome ? "casa" : "fora") + '</div><div class="dh-team">' + crest(a, 46) + "<span>" + esc(a.shortName || a.name) + "</span></div></div>"
          : '<div class="muted" style="padding:12px 0">Aguardando sorteio / classificação.</div>') + "</div>";
    }
    const nextList = upcoming.slice(1, 10).map(u => {
      const opp = u.home ? clubById(u.isHome ? u.away : u.home) : null;
      return '<tr><td class="muted" style="font-size:.76rem">' + esc(u.comp) + "<div>" + esc(u.sub || "") + "</div></td>" +
        (opp ? '<td><span class="club-cell">' + crest(opp, 18) + esc(opp.shortName || opp.name) + "</span></td><td class='muted' style='text-align:right'>" + (u.isHome ? "casa" : "fora") + "</td>" : '<td colspan="2" class="muted">a definir</td>') + "</tr>";
    }).join("");
    const news = (st.personal.news || []).slice(0, 5).map(n => '<div class="dash-news ' + esc(n.type) + '"><div class="dn-title">' + esc(n.title) + '</div><div class="muted">' + esc(n.text) + "</div></div>").join("") || '<div class="muted">Sem notícias.</div>';
    el.innerHTML = "<h2>Visão geral</h2>" +
      '<div class="dash-grid"><div class="dash-col">' + hero +
        '<div class="card"><h3 style="margin-top:0">Próximos jogos</h3><table class="data"><tbody>' + (nextList || '<tr><td class="muted">Nada agendado.</td></tr>') + "</tbody></table></div>" +
      '</div><div class="dash-col">' +
        '<div class="card dash-quick"><h3 style="margin-top:0">Sua situação</h3><div class="dq-grid">' +
          '<div class="dq"><div class="dq-v">' + (myPos || "-") + 'º</div><div class="dq-l">na tabela</div></div>' +
          '<div class="dq"><div class="dq-v">' + myRow.pts + '</div><div class="dq-l">pontos</div></div>' +
          '<div class="dq"><div class="dq-v">' + myRow.v + "/" + myRow.e + "/" + myRow.d + '</div><div class="dq-l">V/E/D</div></div>' +
          '<div class="dq"><div class="dq-v ' + (club.money < 0 ? "money-neg" : "") + '">' + money(club.money) + '</div><div class="dq-l">caixa</div></div>' +
          '<div class="dq"><div class="dq-v">' + Math.round(club.moralTorcida) + '%</div><div class="dq-l">torcida</div></div>' +
        "</div></div>" +
        '<div class="card"><h3 style="margin-top:0">Notícias recentes</h3>' + news + "</div>" +
      "</div></div>";
  }

  // ---------- §26 calendário anual ----------
  function drawCalendar(el) {
    const club = myClub();
    const log = st.personal.matchLog || [];
    const upcoming = st.personal.upcoming || [];
    function resultBadge(m) {
      const isHome = m.home === club.id;
      const gf = isHome ? m.gh : m.ga, ga = isHome ? m.ga : m.gh;
      let r = gf > ga ? "V" : gf < ga ? "D" : "E";
      if (m.kind === "cup" && gf === ga && m.winner) r = m.winner === club.id ? "V" : "D";
      return '<span class="res-badge res-' + r + '">' + r + "</span>";
    }
    function fixtureRow(comp, sub, homeId, awayId, scoreHtml, badge) {
      const h = homeId ? clubById(homeId) : null, a = awayId ? clubById(awayId) : null;
      const compCell = '<td class="muted cal-comp">' + esc(comp) + "<div>" + esc(sub || "") + "</div></td>";
      if (!h || !a) return "<tr>" + compCell + '<td colspan="4" class="muted">a definir</td></tr>';
      const mineH = homeId === club.id, mineA = awayId === club.id;
      return "<tr>" + compCell +
        '<td class="cal-h' + (mineH ? " me-cell" : "") + '"><span class="club-cell" style="justify-content:flex-end">' + esc(h.shortName || h.name) + crest(h, 18) + "</span></td>" +
        '<td class="cal-score">' + scoreHtml + "</td>" +
        '<td class="cal-a' + (mineA ? " me-cell" : "") + '"><span class="club-cell">' + crest(a, 18) + esc(a.shortName || a.name) + "</span></td>" +
        "<td>" + (badge || "") + "</td></tr>";
    }
    const playedRows = log.map(m => {
      const pen = m.shootout ? ' <span class="muted" style="font-size:.72rem">(' + m.shootout.scoreH + "-" + m.shootout.scoreA + " pên)</span>" : "";
      return fixtureRow(m.comp, m.kind === "cup" ? m.round : "Rodada " + m.round, m.home, m.away, "<b>" + m.gh + " x " + m.ga + "</b>" + pen, resultBadge(m));
    }).join("");
    const upcomingRows = upcoming.map(u => fixtureRow(u.comp, u.sub, u.home, u.away, '<span class="muted">x</span>', "")).join("");
    el.innerHTML = "<h2>Calendário</h2>" +
      '<div class="card scroll-x"><h3 style="margin-top:0">Resultados</h3>' + (playedRows ? '<table class="data cal-table"><tbody>' + playedRows + "</tbody></table>" : '<p class="muted">Nenhum jogo disputado ainda nesta temporada.</p>') + "</div>" +
      '<div class="card scroll-x"><h3 style="margin-top:0">Próximos jogos</h3>' + (upcomingRows ? '<table class="data cal-table"><tbody>' + upcomingRows + "</tbody></table>" : '<p class="muted">Sem jogos futuros nesta temporada.</p>') + "</div>";
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
        "<tr><td>" + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td><td class='num'>" + p.age + "</td><td>" + footLabel(p) + "</td><td class='num'>" + rBadge(p.rating) + "</td>" +
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
          return "<tr><td>" + pBadge(p.pos) + "</td><td><b>" + esc(p.name) + "</b>" + star(p) + "</td><td class='num'>" + p.age + "</td><td class='num'>" + rBadge(p.rating) + "</td>" +
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

  // §10 aplica o estado de pausa global vindo do servidor (gestão/intervalo/pênalti)
  function applyPause(p) {
    if (!st.live || !p) return;
    st.live.paused = !!p.paused;
    const names = p.managerNames || [];
    st.live.pausedBy = names.length ? names.join(", ") : null;
    st.live.waitingMe = (p.halftimeWaiting || []).includes(st.session.playerId);
    if (st.view !== "round") return;
    renderRoundControls();
    // banner só quando OUTRO técnico gerencia (eu gerindo tenho o overlay; o intervalo tem botão próprio)
    if (st.live.pausedBy && !st._managing) showPausedBanner(st.live.pausedBy);
    else hidePausedBanner();
  }

  // ---------- §11-18 tela de pênalti (tensão) ----------
  function removePenaltyOverlay() {
    if (st._penPhrase) { clearInterval(st._penPhrase); st._penPhrase = null; }
    const b = document.getElementById("penalty-overlay"); if (b) b.remove();
    st._penOv = null; st._penShownPhase = null;
  }
  function renderPenaltyOverlay() {
    const p = st.penalty;
    if (!p) { removePenaltyOverlay(); return; }
    let ov = document.getElementById("penalty-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "modal-overlay penalty-overlay";
      ov.id = "penalty-overlay";
      document.body.appendChild(ov);
      window.TF.sounds.play("penalty");
    }
    st._penOv = ov;
    const meId = st.session.playerId;
    const iAmTaker = p.attackerHumanId === meId;
    const iAmInvolved = iAmTaker || p.defenderHumanId === meId;
    const set = html => { ov.innerHTML = '<div class="penalty-screen">' + html + "</div>"; };
    const accelBtn = iAmInvolved ? '<button class="btn" id="pen-accel">⏩ Acelerar</button>' : "";

    if (p.phase === "waiting_taker" && iAmTaker) {
      if (st._penPhrase) { clearInterval(st._penPhrase); st._penPhrase = null; }
      const cands = (p.eligible || []).slice().sort((a, b) => b.finishing - a.finishing);
      set(
        '<div class="pen-badge">⚽ PÊNALTI</div><div class="pen-head">' + esc(p.club) + '</div><div class="pen-sub">Quem vai bater?</div>' +
        '<div class="pen-takers">' + cands.map(c =>
          '<button class="pen-taker" data-taker="' + c.id + '"><span class="pen-pos">' + esc(c.pos) + '</span><span class="pen-name">' + esc(c.name) + (c.star ? " ⭐" : "") + '</span><span class="pen-stat">Fin ' + c.finishing + " · " + c.energy + "%</span></button>").join("") + "</div>"
      );
      ov.querySelectorAll("[data-taker]").forEach(b => b.addEventListener("click", () => { api("penaltyTaker", { takerId: b.dataset.taker }); }));
      return;
    }
    if (p.phase === "waiting_taker") { // outros aguardam o batedor
      if (st._penPhrase) { clearInterval(st._penPhrase); st._penPhrase = null; }
      set('<div class="pen-badge">⚽ PÊNALTI</div><div class="pen-head">' + esc(p.club) + '</div><div class="pen-ball">⚽</div><div class="pen-suspense">O técnico escolhe o batedor…</div>');
      return;
    }
    if (p.phase === "suspense") {
      const cobrador = p.club;
      const phrases = (window.TF.match.PENALTY_SUSPENSE || ["Tensão máxima…"]).slice();
      let i = 0;
      const paint = () => set(
        '<div class="pen-badge">⚽ PÊNALTI</div><div class="pen-head">' + esc(cobrador) + ' na cobrança</div>' +
        '<div class="pen-ball">⚽</div><div class="pen-taker-name">' + esc(p.takerName || "") + '</div>' +
        '<div class="pen-suspense">' + esc(phrases[i % phrases.length]) + '</div>' + accelBtn
      );
      paint();
      const accel = document.getElementById("pen-accel"); if (accel) accel.addEventListener("click", () => api("penaltyAccelerate"));
      if (st._penPhrase) clearInterval(st._penPhrase);
      st._penPhrase = setInterval(() => { i++; paint(); const a = document.getElementById("pen-accel"); if (a) a.addEventListener("click", () => api("penaltyAccelerate")); }, 1100);
      return;
    }
    if (p.phase === "result") {
      if (st._penPhrase) { clearInterval(st._penPhrase); st._penPhrase = null; }
      const o = p.outcome;
      const big = o === "goal" ? "GOL!" : o === "save" ? "DEFENDEU!" : o === "post" ? "NA TRAVE!" : "PRA FORA!";
      const cls = o === "goal" ? "pen-goal" : "pen-miss";
      if (st._penShownPhase !== "result") window.TF.sounds.play(o === "goal" ? "goal" : o === "save" ? "save" : "miss");
      set('<div class="pen-result ' + cls + '">' + big + '</div><div class="pen-result-sub">' + esc(p.takerName || "") + '</div>' + (iAmInvolved ? '<button class="btn primary" id="pen-accel">Continuar</button>' : ""));
      const cont = document.getElementById("pen-accel"); if (cont) cont.addEventListener("click", () => api("penaltyAccelerate"));
    }
    st._penShownPhase = p.phase;
  }

  // ---------- §28 tela de disputa de pênaltis ----------
  function removeShootoutOverlay() { const b = document.getElementById("shootout-overlay"); if (b) b.remove(); }
  function renderShootoutOverlay() {
    const s = st.shootout;
    if (!s) { removeShootoutOverlay(); return; }
    let ov = document.getElementById("shootout-overlay");
    if (!ov) { ov = document.createElement("div"); ov.className = "modal-overlay penalty-overlay"; ov.id = "shootout-overlay"; document.body.appendChild(ov); window.TF.sounds.play("penalty"); }
    const meId = st.session.playerId;
    const match = st.live && st.live.matches[s.i];
    const iAmInvolved = match && (match.humanH === meId || match.humanA === meId);
    const userSide = match ? (match.humanH === meId ? "h" : match.humanA === meId ? "a" : null) : null;
    // som do último chute revelado
    const last = s.kicks.length ? s.kicks[s.kicks.length - 1] : null;
    if (last && s.reveal !== st._soLastReveal) window.TF.sounds.play(last.outcome === "goal" ? "shootoutGoal" : "shootoutMiss");
    st._soLastReveal = s.reveal;
    const dots = side => {
      const ks = s.kicks.filter(k => k.side === side);
      const total = Math.ceil(s.total / 2);
      let html = "";
      for (let i = 0; i < Math.max(total, ks.length); i++) {
        if (i < ks.length) html += '<span class="so-dot ' + (ks[i].outcome === "goal" ? "so-goal" : "so-miss") + '">' + (ks[i].outcome === "goal" ? "●" : "○") + "</span>";
        else html += '<span class="so-dot so-pend">•</span>';
      }
      return html;
    };
    const sc = last ? { sH: last.sH, sA: last.sA } : { sH: 0, sA: 0 };
    let body;
    if (s.done) {
      const meWon = userSide && s.winnerSide === userSide;
      const champ = s.winnerSide === "h" ? s.homeName : s.awayName;
      body = '<div class="pen-result ' + (meWon ? "pen-goal" : userSide ? "pen-miss" : "pen-goal") + '" style="font-size:1.6rem">' + esc(champ) + " se classifica!</div>" +
        (iAmInvolved ? '<button class="btn primary" id="so-cont">Continuar</button>' : "");
    } else {
      const lastTxt = last ? esc(last.taker) + " — " + (last.outcome === "goal" ? "GOL!" : last.outcome === "save" ? "DEFENDEU!" : last.outcome === "post" ? "NA TRAVE!" : "PRA FORA!") : "Preparando as cobranças…";
      body = '<div class="pen-suspense ' + (last ? (last.outcome === "goal" ? "pen-goal" : "pen-miss") : "") + '" style="font-weight:700">' + lastTxt + "</div>" +
        (iAmInvolved ? '<button class="btn" id="so-skip">⏩ Acelerar</button>' : "");
    }
    ov.innerHTML = '<div class="penalty-screen">' +
      '<div class="pen-badge">⚽ DISPUTA DE PÊNALTIS</div>' +
      '<div class="so-score"><span>' + esc(s.homeName) + '</span><b>' + sc.sH + " x " + sc.sA + '</b><span>' + esc(s.awayName) + "</span></div>" +
      '<div class="so-row">' + dots("h") + '</div><div class="so-row">' + dots("a") + "</div>" + body + "</div>";
    const skip = document.getElementById("so-skip"); if (skip) skip.addEventListener("click", () => api("shootoutAccelerate"));
    const cont = document.getElementById("so-cont"); if (cont) cont.addEventListener("click", () => api("shootoutAccelerate"));
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
      const t = TAC().normalize(mL.tactics || st.personal.tactics);
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
        ov.querySelector("#lm-tac").innerHTML =
          '<div class="row" style="align-items:flex-end;gap:6px">' +
            '<label class="tac-sel"><span class="muted">Formação</span><select id="lm-form">' + TAC().FORMATION_NAMES.map(f => "<option" + (f === mL.formationName ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
            tacticsSelects(t) +
          "</div>" +
          '<div class="set-pieces"><div class="sp-item"><span>👑 Capitão</span><select data-lsp="captain">' + opt(mL.captainId, true) + "</select></div>" +
            '<div class="sp-item"><span>🎯 Faltas</span><select data-lsp="freeKick">' + opt(mL.setPieces.freeKick) + "</select></div>" +
            '<div class="sp-item"><span>◀ Esc. esq.</span><select data-lsp="cornerLeft">' + opt(mL.setPieces.cornerLeft) + "</select></div>" +
            '<div class="sp-item"><span>▶ Esc. dir.</span><select data-lsp="cornerRight">' + opt(mL.setPieces.cornerRight) + "</select></div></div>";
        ov.querySelector("#lm-form").addEventListener("change", async e => {
          const r2 = await api("liveReform", { formation: e.target.value });
          if (r2.lineup) { Object.assign(mL, r2.lineup); sel = null; drawTac(); drawPitch(); drawSide(); }
        });
        ov.querySelectorAll("[data-tac]").forEach(b => b.addEventListener("change", async () => {
          t[b.dataset.tac] = b.value; await api("liveTactics", { [b.dataset.tac]: b.value });
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
    const tab = st._rdTab || "narracao";
    const tb = (id, label) => '<button class="mtab' + (tab === id ? " active" : "") + '" data-rdtab="' + id + '">' + label + "</button>";
    el.innerHTML =
      '<div class="scoreboard" style="margin-top:14px">' +
        '<div class="team">' + crest(m.home, 40) + "<span>" + esc(m.home.name) + "</span></div>" +
        '<div><div class="score" id="rd-score"></div><div class="minute" id="rd-min"></div></div>' +
        '<div class="team right">' + crest(m.away, 40) + "<span>" + esc(m.away.name) + "</span></div>" +
      "</div>" +
      '<div class="mtabs">' + tb("narracao", "Lance a lance") + tb("stats", "Estatísticas") + tb("lineups", "Escalações") + "</div>" +
      '<div class="mpane" id="rd-pane"></div>';
    el.querySelectorAll("[data-rdtab]").forEach(b => b.addEventListener("click", () => { st._rdTab = b.dataset.rdtab; buildDetail(); }));
    renderRoundPane();
    updateRound();
  }

  function renderRoundPane() {
    const live = st.live; if (!live) return;
    const m = live.matches[live.selected];
    const pane = $("#rd-pane"); if (!pane) return;
    const tab = st._rdTab || "narracao";
    if (tab === "narracao") {
      pane.innerHTML = '<div class="match-events" id="rd-events" style="height:300px"></div>';
    } else if (tab === "stats") {
      pane.innerHTML = '<div class="match-stats" id="rd-stats"></div>';
    } else {
      const col = (side) => {
        const rows = ((m.lineups && m.lineups[side]) || []).filter(s => s.name).map(s =>
          '<div class="lu-row"><span class="lu-pos pos-' + s.pos + '">' + s.pos + '</span><span class="lu-name">' + esc(s.name) + "</span></div>").join("");
        const club = side === "h" ? m.home : m.away;
        return '<div class="lu-col"><div class="lu-club">' + crest(club, 18) + esc(club.shortName || club.name) + "</div>" + rows + "</div>";
      };
      pane.innerHTML = '<div class="lineups-grid">' + col("h") + col("a") + "</div>";
    }
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
      $("#rd-min").textContent = m.fin ? "Fim de jogo" : m.ph === "halftime" ? "Intervalo" : m.ph === "shootout" ? "Pênaltis" : m.min + "'";
      const box = $("#rd-events");
      if (box) while (box.children.length < m.events.length) {
        const ev = m.events[box.children.length];
        const div = document.createElement("div");
        div.className = "ev " + ev.type;
        div.innerHTML = '<span class="min">' + ev.min + "'</span><span>" + esc(ev.text) + "</span>";
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
      }
      const stBox = $("#rd-stats");
      if (stBox && m.stats) {
        const row = (a, n, b) => '<div class="sh">' + a + '</div><div class="sname">' + n + '</div><div class="sa">' + b + "</div>";
        stBox.innerHTML =
          row(m.stats.h.poss + "%", "Posse", m.stats.a.poss + "%") +
          row(m.stats.h.shots, "Finalizações", m.stats.a.shots) +
          row(m.stats.h.target, "No gol", m.stats.a.target) +
          row(m.stats.h.corners, "Escanteios", m.stats.a.corners) +
          row(m.stats.h.fouls, "Faltas", m.stats.a.fouls);
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
