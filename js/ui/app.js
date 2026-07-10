"use strict";
/* Shell da interface: barra superior, menu lateral, navegação e fluxo de avanço. */
(function () {
  const U = window.TF.util;
  const G = () => window.TF.game;

  const ui = {
    screen: "home",
    screens: {},   // registrado por screens.js / match-ui.js
    lastReport: null
  };

  function esc(s) { return U.esc(s); }

  function crestImg(club, size) {
    const s = size || 22;
    if (club.crest) return '<img src="' + esc(club.crest) + '" alt="" style="width:' + s + 'px;height:' + s + 'px;object-fit:contain">';
    return '<span style="display:inline-flex;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:' + Math.round(s * 0.55) + 'px">⚽</span>';
  }

  function ratingClass(r) { return r >= 82 ? "r-elite" : r >= 72 ? "r-good" : r >= 60 ? "r-avg" : "r-low"; }
  function ratingBadge(r) { return '<span class="rating-badge ' + ratingClass(Math.round(r)) + '">' + Math.round(r) + "</span>"; }
  function posBadge(pos) { return '<span class="pos-badge pos-' + pos + '">' + pos + "</span>"; }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
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

  const NAV = [
    { id: "squad", icon: "👥", label: "Elenco" },
    { id: "lineup", icon: "📋", label: "Escalação" },
    { id: "table", icon: "🏆", label: "Classificação" },
    { id: "clubs", icon: "🏟️", label: "Clubes" },
    { id: "cup", icon: "🏅", label: "Copa" },
    { id: "calendar", icon: "📅", label: "Jogos" },
    { id: "transfers", icon: "💱", label: "Transferências" },
    { id: "finance", icon: "💰", label: "Finanças" },
    { id: "news", icon: "📰", label: "Notícias" },
    { id: "coach", icon: "🎩", label: "Técnico" },
    { id: "options", icon: "⚙️", label: "Opções" }
  ];

  function goto(screen, params) {
    ui.screen = screen;
    ui.screenParams = params || null;
    render();
  }

  // ---------- tema claro / escuro ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
    try { localStorage.setItem("tf26_theme", document.documentElement.dataset.theme); } catch (e) { /* sem storage */ }
  }
  function currentTheme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
  function toggleTheme() { applyTheme(currentTheme() === "light" ? "dark" : "light"); }

  function render() {
    const app = document.getElementById("app");
    const G_ = G();
    if (!G_.state.started || ui.screen === "home" || ui.screen === "newCareer") {
      app.innerHTML = "";
      ui.screens[ui.screen === "newCareer" ? "newCareer" : "home"](app);
      return;
    }
    if (ui.screen === "match") {
      app.innerHTML = "";
      ui.screens.match(app, ui.screenParams);
      return;
    }
    const club = G_.userClub();
    const s = G_.state;
    const slot = s.season.slots[s.season.slotIndex];
    let nextLabel = "Fim da temporada";
    if (slot) {
      if (slot.type === "league") nextLabel = "Rodada " + (slot.round + 1) + " — " + s.season.leagues[club.countryId][club.division].name;
      else if (slot.type === "cup") nextLabel = (window.TF.competitions.CUP_PHASES[slot.phase] || "") + " — " + s.world.countries[club.countryId].cupName;
      else nextLabel = "Fim da temporada " + s.season.year;
    }
    app.innerHTML =
      '<div class="topbar">' +
        crestImg(club, 42) +
        '<div class="club-info"><div class="club-name">' + esc(club.name) + '</div>' +
        '<div class="club-sub">' + esc(s.world.countries[club.countryId].name) + " — Série " + club.division + " · " + esc(s.coach.name) + "</div></div>" +
        '<div class="spacer"></div>' +
        '<div class="stat"><div class="label">Caixa</div><div class="value' + (club.money < 0 ? " money-neg" : "") + '">' + U.formatMoney(club.money) + "</div></div>" +
        '<div class="stat"><div class="label">Torcida</div><div class="value">' + Math.round(club.moralTorcida) + "%</div></div>" +
        '<div class="stat"><div class="label">Temporada</div><div class="value">' + s.season.year + " · Semana " + s.week + "</div></div>" +
        '<div class="stat"><div class="label">Próximo</div><div class="value" style="max-width:230px;overflow:hidden;text-overflow:ellipsis">' + esc(nextLabel) + "</div></div>" +
        '<button class="btn" id="btn-theme" title="Alternar tema claro/escuro">' + (currentTheme() === "light" ? "🌙" : "☀️") + "</button>" +
        '<button class="btn primary btn-advance" id="btn-advance">Avançar ▶</button>' +
      "</div>" +
      '<div class="main">' +
        '<nav class="sidebar">' +
          NAV.map(n => '<button class="nav-item' + (ui.screen === n.id ? " active" : "") + '" data-nav="' + n.id + '"><span class="icon">' + n.icon + '</span><span class="txt">' + n.label + "</span></button>").join("") +
        "</nav>" +
        '<div class="content" id="content"></div>' +
      "</div>";

    app.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => goto(b.dataset.nav)));
    app.querySelector("#btn-advance").addEventListener("click", advance);
    app.querySelector("#btn-theme").addEventListener("click", () => { toggleTheme(); render(); });

    const content = document.getElementById("content");
    (ui.screens[ui.screen] || ui.screens.squad)(content, ui.screenParams);
  }

  /* Fluxo principal: botão Avançar. */
  function advance() {
    const G_ = G();
    const next = G_.nextSlot();
    if (next.type === "liveRound") {
      goto("match", next);
      return;
    }
    if (next.type === "endOfSeason") {
      const report = G_.endOfSeason();
      ui.lastReport = report;
      G_.save(1);
      goto("seasonReport", report);
      return;
    }
    if (next.type === "processed") {
      G_.save(1);
      // mostra resultados da rodada em que o usuário não jogou
      goto("calendar");
      toast("Rodada processada.");
      return;
    }
    render();
  }

  function boot() {
    let saved = null;
    try { saved = localStorage.getItem("tf26_theme"); } catch (e) { /* sem storage */ }
    applyTheme(saved || "dark");
    ui.screen = "home";
    render();
  }

  window.TF.ui = { boot, goto, render, advance, toast, modal, crestImg, ratingBadge, ratingClass, posBadge, esc, screens: ui.screens, state: ui, toggleTheme, currentTheme };
})();
