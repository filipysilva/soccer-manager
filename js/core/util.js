"use strict";
/* Utilidades gerais: RNG com semente, formatação, helpers. */
(function () {
  // RNG mulberry32 — determinístico a partir de uma semente
  function createRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const RNG = {
    _fn: createRng(Date.now() >>> 0),
    seed(v) { this._fn = createRng(typeof v === "string" ? hashString(v) : (v >>> 0)); },
    next() { return this._fn(); },
    int(min, max) { return Math.floor(this._fn() * (max - min + 1)) + min; },
    pick(arr) { return arr[Math.floor(this._fn() * arr.length)]; },
    chance(p) { return this._fn() < p; },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this._fn() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    // gaussiano aproximado (média 0, desvio 1)
    gauss() { return (this._fn() + this._fn() + this._fn() + this._fn() - 2) / 0.577; }
  };

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function formatMoney(v) {
    const abs = Math.abs(v);
    let out;
    if (abs >= 1e9) out = (v / 1e9).toFixed(2).replace(".", ",") + " bi";
    else if (abs >= 1e6) out = (v / 1e6).toFixed(1).replace(".", ",") + " mi";
    else if (abs >= 1e3) out = (v / 1e3).toFixed(0) + " mil";
    else out = String(Math.round(v));
    return "$ " + out;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- §21 formatação compartilhada (offline e online) ----------
  // Separador consistente (ponto médio), evitando o excesso de travessões.
  const DOT = " · ";
  function joinDot() { return Array.prototype.filter.call(arguments, Boolean).join(DOT); }
  // "Temporada 2026 · Semana 12"
  function formatSeasonLabel(year, week) {
    return joinDot("Temporada " + year, week ? "Semana " + week : "");
  }
  // "Ano 2026 · Semana 12" (para listas/datas)
  function formatDateLabel(year, week) {
    return joinDot("Ano " + year, week ? "Semana " + week : "");
  }
  // Rótulo curto da fase: "Rodada 12" ou o nome da fase de copa.
  function formatRoundLabel(slot, cupPhaseName) {
    if (!slot) return "Fim de temporada";
    if (slot.type === "league") return "Rodada " + ((slot.round | 0) + 1);
    if (slot.type === "cup") return cupPhaseName || "Fase de copa";
    return "Fim de temporada";
  }
  // Nome da competição do slot atual, dado o contexto { leagueName, cupName }.
  function formatCompetitionName(slot, ctx) {
    ctx = ctx || {};
    if (!slot) return "";
    if (slot.type === "league") return ctx.leagueName || "Liga";
    if (slot.type === "cup") return ctx.cupName || "Copa";
    return "";
  }
  // Subtítulo de partida: "Brasileirão Série A · Rodada 12"
  function formatMatchSubtitle(competitionName, roundLabel) {
    return joinDot(competitionName, roundLabel);
  }

  window.TF = window.TF || {};
  window.TF.util = {
    createRng, hashString, RNG, clamp, formatMoney, esc,
    joinDot, formatSeasonLabel, formatDateLabel, formatRoundLabel, formatCompetitionName, formatMatchSubtitle
  };
})();
