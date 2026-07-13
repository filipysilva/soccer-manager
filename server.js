"use strict";
/* Técnico 26 — servidor do modo online com salas.
   Sem dependências externas: HTTP para arquivos e ações + Server-Sent Events para tempo real.
   Uso: node server.js  (porta via variável PORT; padrão 3026) */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- carrega o motor do jogo (mesmo código do navegador) ----------
global.window = {};
require("./js/core/util.js");
require("./js/core/names.js");
require("./js/db/world-db-2026.js");
require("./js/db/world-leagues.js");
require("./js/core/world.js");
require("./js/core/competitions.js");
require("./js/core/tactics.js");
require("./js/core/match.js");
require("./js/core/finance.js");
require("./js/core/transfers.js");
require("./js/core/room-game.js");
const TF = global.window.TF;

const ROOT = __dirname;
const PORT = process.env.PORT || 3026;
const TICK_MS = 250;              // 1 minuto de jogo a cada 250 ms (~11 s por tempo)
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // salas paradas por 6 h são removidas

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".wav": "audio/wav", ".svg": "image/svg+xml", ".json": "application/json"
};

// ---------- salas ----------
const rooms = new Map(); // code -> room

function newId() { return crypto.randomBytes(8).toString("hex"); }
function newCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(hostName) {
  const code = newCode();
  const room = {
    code,
    phase: "lobby",          // lobby | manage | round | over
    countryId: "BRA",
    hostId: null,
    players: new Map(),      // playerId -> { id, name, token, clubId, ready, sse }
    game: null,
    live: null,              // rodada ao vivo em andamento
    chat: [],
    lastActivity: Date.now()
  };
  const host = addPlayer(room, hostName);
  room.hostId = host.id;
  rooms.set(code, room);
  return { room, player: host };
}

function addPlayer(room, name) {
  const player = { id: newId(), name: String(name || "Técnico").slice(0, 20), token: newId(), clubId: null, ready: false, lobbyReady: false, sse: null };
  room.players.set(player.id, player);
  return player;
}

function auth(room, playerId, token) {
  const p = room.players.get(playerId);
  return p && p.token === token ? p : null;
}

// ---------- SSE ----------
function sseSend(player, event, data) {
  if (!player.sse) return;
  try {
    player.sse.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  } catch (e) { player.sse = null; }
}

function broadcast(room, event, data) {
  for (const p of room.players.values()) sseSend(p, event, data);
}

/* Aplica dimensões táticas válidas de `body` no objeto de tática. */
function applyTacticDims(tactics, body) {
  const DIM = TF.tactics.DIMENSIONS;
  for (const k of Object.keys(DIM)) {
    if (body[k] != null && DIM[k].options.some(o => o[0] === body[k])) tactics[k] = body[k];
  }
}

/* Escalação serializada para a tela de gestão online. */
function serializeLineup(team) {
  const P = p => p ? { id: p.id, name: p.name, pos: p.pos, rating: p.rating, energy: Math.round(p.energy) } : null;
  return {
    formationName: team.formationName || "4-4-2",
    lineup: team.lineup.map(s => ({ slotPos: s.slotPos, player: P(s.player) })),
    bench: team.bench.map(P),
    subsUsed: team.subsUsed || 0,
    captainId: team.captainId || null,
    setPieces: team.setPieces || {},
    tactics: TF.tactics.normalize(team.tactics || {})
  };
}

function lobbyState(room) {
  const players = [...room.players.values()].map(p => ({ id: p.id, name: p.name, clubId: p.clubId, ready: p.ready, lobbyReady: p.lobbyReady, online: !!p.sse }));
  // o dono só pode iniciar quando todos online têm clube e os demais estão "prontos"
  const online = players.filter(p => p.online);
  const others = online.filter(p => p.id !== room.hostId);
  const canStart = online.length > 0 && online.every(p => p.clubId) && others.every(p => p.lobbyReady);
  return {
    code: room.code,
    phase: room.phase,
    countryId: room.countryId,
    hostId: room.hostId,
    canStart,
    players
  };
}

function pushLobby(room) { broadcast(room, "lobby", lobbyState(room)); }

/* Clubes do país da sala ainda sem técnico humano (para assumir ao entrar no meio do jogo). */
function freeClubs(room) {
  if (!room.game) return [];
  const g = room.game;
  const country = g.world.countries[g.countryId];
  const taken = new Set(Object.values(g.humans).map(h => h.clubId));
  return country.clubIdsA.concat(country.clubIdsB)
    .filter(id => !taken.has(id))
    .map(id => ({ id, name: g.world.clubs[id].name, division: g.world.clubs[id].division, rating: g.world.clubs[id].rating, crest: g.world.clubs[id].crest }));
}

function pushSnapshots(room) {
  if (!room.game) return;
  const snap = room.game.snapshot();
  for (const p of room.players.values()) {
    sseSend(p, "snapshot", { shared: snap, personal: room.game.personal(p.id) });
  }
}

// ---------- fluxo da rodada ----------
function tryAdvance(room) {
  if (room.frozenForJoin) return; // congelado até novo técnico escolher clube
  if (room.phase !== "manage" || !room.game) return;
  // só contam os técnicos que estão de fato no jogo e conectados
  const online = [...room.players.values()].filter(p => p.sse && room.game.humans[p.id]);
  if (!online.length || !online.every(p => p.ready)) return;
  for (const p of room.players.values()) p.ready = false;
  room.lastActivity = Date.now();

  const r = room.game.startRound();
  if (r.done) { broadcast(room, "info", { text: "Temporada encerrada." }); return; }
  if (r.seasonEnd) {
    broadcast(room, "seasonEnd", { report: r.report });
    pushSnapshots(room);
    pushLobby(room);
    saveRoom(room);
    return;
  }
  if (r.instant) {
    broadcast(room, "info", { text: "Rodada sem jogos da sala foi processada." });
    pushSnapshots(room);
    pushLobby(room);
    saveRoom(room);
    return;
  }
  startLiveRound(room, r);
}

// ---- §10 Controlador de pausa GLOBAL da rodada ----
// Vários motivos independentes, cada um um Set (não um booleano). A rodada
// inteira fica congelada enquanto QUALQUER motivo tiver algum item.
function newPauseReasons() {
  return {
    manage: new Set(),   // playerIds gerenciando o time (relógio congelado p/ todos)
    halftime: new Set(), // playerIds (humanos) que ainda não confirmaram o 2º tempo
    penalty: new Set()   // chaves de pênaltis pendentes (Etapa 3)
  };
}
// Congela o TICK inteiro (ninguém avança): gestão de time ou pênalti em andamento.
// O intervalo NÃO congela o tick — cada jogo é segurado ao chegar ao intervalo
// enquanto os demais ainda jogam; assim todos convergem para o intervalo juntos.
function isTickFrozen(live) {
  return !!live && (live.pause.manage.size > 0 || live.pause.penalty.size > 0);
}
// Estado geral de pausa para o cliente (inclui o intervalo).
function isRoundPaused(live) {
  return !!live && (isTickFrozen(live) || live.pause.halftime.size > 0);
}
function nameOf(room, playerId) { const p = room.players.get(playerId); return p ? p.name : null; }
function pauseState(room) {
  const live = room.live;
  if (!live) return { paused: false, managerNames: [], halftimeWaiting: [], penalty: [] };
  return {
    paused: isRoundPaused(live),
    managerNames: [...live.pause.manage].map(id => nameOf(room, id)).filter(Boolean),
    halftimeWaiting: [...live.pause.halftime],
    penalty: [...live.pause.penalty]
  };
}
function broadcastPause(room) { broadcast(room, "pauseState", pauseState(room)); }

// Snapshot da rodada ao vivo para quem (re)conecta no meio dela (§10 reconexão).
function liveSnapshot(room) {
  const live = room.live;
  if (!live) return null;
  const meta = (club) => ({ id: club.id, name: club.name, shortName: club.shortName, crest: club.crest });
  const lineup = (team) => team.lineup.map(s => ({ pos: s.slotPos, name: s.player ? s.player.name : null, rating: s.player ? s.player.rating : null, id: s.player ? s.player.id : null }));
  return {
    label: live.label,
    matches: live.games.map((g, i) => ({
      i,
      home: meta(g.entry.home.club), away: meta(g.entry.away.club),
      humanH: g.entry.humanH, humanA: g.entry.humanA,
      lineups: { h: lineup(g.entry.home), a: lineup(g.entry.away) },
      gh: g.match.state.gh, ga: g.match.state.ga, min: g.match.minute, ph: g.match.phase, fin: g.match.finished,
      events: g.match.events.map(ev => ({ i, min: ev.min, type: ev.type, text: ev.text }))
    })),
    pause: pauseState(room),
    penalty: publicPenalty(room) // §11-18 pênalti em andamento (reconexão)
  };
}

function startLiveRound(room, r) {
  room.phase = "round";
  const M = TF.match;
  const live = {
    label: r.label,
    games: r.matches.map(e => ({
      entry: e,
      // humanSides ativa a tela de pênalti (§11-18) quando há humano em qualquer lado
      match: M.createMatch(e.home, e.away, { grass: e.grass, humanSides: [e.humanH ? "h" : null, e.humanA ? "a" : null].filter(Boolean) }),
      shown: 0
    })),
    timer: null,
    penalty: null,        // pênalti em andamento (§11-18)
    penaltyTimer: null,
    pause: newPauseReasons() // §10 pausa global (manage/halftime/penalty)
  };
  room.live = live;
  broadcast(room, "roundStart", {
    label: r.label,
    matches: r.matches.map((e, i) => ({
      i,
      home: { id: e.home.club.id, name: e.home.club.name, shortName: e.home.club.shortName, crest: e.home.club.crest },
      away: { id: e.away.club.id, name: e.away.club.name, shortName: e.away.club.shortName, crest: e.away.club.crest },
      humanH: e.humanH, humanA: e.humanA,
      lineups: {
        h: e.home.lineup.map(s => ({ pos: s.slotPos, name: s.player ? s.player.name : null, rating: s.player ? s.player.rating : null, id: s.player ? s.player.id : null })),
        a: e.away.lineup.map(s => ({ pos: s.slotPos, name: s.player ? s.player.name : null, rating: s.player ? s.player.rating : null, id: s.player ? s.player.id : null }))
      }
    }))
  });
  pushLobby(room);
  live.timer = setInterval(() => tickRound(room), TICK_MS);
}

function tickRound(room) {
  const live = room.live;
  if (!live || isTickFrozen(live) || room.frozenForJoin) return; // congelada (gestão, pênalti ou entrada de técnico)
  const updates = [];
  const newEvents = [];
  let halftimeChanged = false;

  for (let i = 0; i < live.games.length; i++) {
    const g = live.games[i];
    if (g.match.finished) continue;
    const hasHuman = g.entry.humanH || g.entry.humanA;
    // Segura o jogo no intervalo (não avança) enquanto não for liberado. Jogos com
    // humano registram de quem se espera o "Estou pronto" (§10, sem timeout).
    if (g.match.phase === "halftime" && !g.resume2h) {
      if (hasHuman && !g.halfNotified) {
        g.halfNotified = true;
        for (const pid of [g.entry.humanH, g.entry.humanA]) if (pid) live.pause.halftime.add(pid);
        halftimeChanged = true;
      }
      continue;
    }
    if (g.match.phase === "halftime" && g.resume2h) g.match.resumeSecondHalf();
    g.match.playMinute();
    while (g.shown < g.match.events.length) {
      const ev = g.match.events[g.shown++];
      newEvents.push({ i, min: ev.min, type: ev.type, text: ev.text });
    }
    updates.push({ i, gh: g.match.state.gh, ga: g.match.state.ga, min: g.match.minute, ph: g.match.phase, fin: g.match.finished });
  }

  // Quando TODOS os jogos ativos convergem para o intervalo: rodada só de IA retoma
  // sozinha; havendo QUALQUER humano, o 2º tempo só começa quando todos confirmarem
  // (ready2h). Checa "há humano na rodada" (não o tamanho do Set) para não haver corrida
  // com o registro dos humanos, que ocorre no tick seguinte ao jogo chegar ao intervalo.
  const active = live.games.filter(g => !g.match.finished);
  const allAtHalftime = active.length > 0 && active.every(g => g.match.phase === "halftime" && !g.resume2h);
  const humansInRound = active.some(g => g.entry.humanH || g.entry.humanA);
  if (allAtHalftime && !humansInRound) {
    for (const g of active) g.resume2h = true;
  }

  if (updates.length || newEvents.length) broadcast(room, "tick", { m: updates, ev: newEvents });
  if (halftimeChanged) broadcastPause(room); // intervalo: lista de quem falta confirmar

  // §11-18 pênalti com humano envolvido: pausa a rodada inteira e abre a tela de tensão
  if (!live.penalty) {
    const gi = live.games.findIndex(g => !g.match.finished && g.match.penalty && !g.penaltyActive);
    if (gi >= 0) { startPenalty(room, gi); return; }
  }

  if (live.games.every(g => g.match.finished)) finishLiveRound(room);
}

// ---- §11-18 Pênalti online (pausa global + fases) ----
function publicPenalty(room) {
  const p = room.live && room.live.penalty;
  if (!p) return null;
  return {
    i: p.i, club: p.club, oppClub: p.oppClub, gkName: p.gkName,
    attackerHumanId: p.attackerHumanId, defenderHumanId: p.defenderHumanId,
    eligible: p.eligible, takerName: p.takerName, phase: p.phase, outcome: p.outcome,
    gh: p.gh, ga: p.ga
  };
}
function startPenalty(room, gi) {
  const live = room.live;
  const g = live.games[gi];
  const pen = g.match.penalty;
  if (!pen) return;
  g.penaltyActive = true;
  const key = "pen" + gi + "_" + pen.min;
  live.pause.penalty.add(key);
  live.penalty = {
    key, i: gi, attKey: pen.attKey, club: pen.club, oppClub: pen.oppClub, gkName: pen.gkName,
    attackerHumanId: pen.attKey === "h" ? g.entry.humanH : g.entry.humanA,
    defenderHumanId: pen.attKey === "h" ? g.entry.humanA : g.entry.humanH,
    eligible: pen.eligible, takerId: pen.takerId, takerName: pen.takerName,
    phase: (pen.userAttacking && !pen.takerId) ? "waiting_taker" : "suspense",
    outcome: null, gh: g.match.state.gh, ga: g.match.state.ga
  };
  broadcast(room, "penalty", publicPenalty(room));
  broadcastPause(room);
  if (live.penalty.phase === "waiting_taker") {
    // segurança: se o batedor não for escolhido (ex.: desconexão), sorteia e segue
    live.penaltyTimer = setTimeout(() => { autoPickTaker(room); }, 20000);
  } else {
    schedulePenaltyReveal(room);
  }
}
function autoPickTaker(room) {
  const live = room.live;
  if (!live || !live.penalty || live.penalty.phase !== "waiting_taker") return;
  const g = live.games[live.penalty.i];
  g.match.setPenaltyTaker(null); // melhor batedor
  const pen = g.match.penalty;
  live.penalty.takerId = pen.takerId; live.penalty.takerName = pen.takerName;
  schedulePenaltyReveal(room);
}
function schedulePenaltyReveal(room) {
  const live = room.live;
  if (!live || !live.penalty) return;
  clearTimeout(live.penaltyTimer);
  live.penalty.phase = "suspense";
  broadcast(room, "penalty", publicPenalty(room));
  live.penaltyTimer = setTimeout(() => doPenaltyReveal(room), 4500);
}
function doPenaltyReveal(room) {
  const live = room.live;
  if (!live || !live.penalty || live.penalty.phase === "result") return;
  clearTimeout(live.penaltyTimer);
  const g = live.games[live.penalty.i];
  const r = g.match.finishPenalty();
  live.penalty.outcome = r.outcome;
  live.penalty.phase = "result";
  live.penalty.gh = g.match.state.gh; live.penalty.ga = g.match.state.ga;
  broadcast(room, "penalty", publicPenalty(room));
  broadcast(room, "tick", { m: [{ i: live.penalty.i, gh: g.match.state.gh, ga: g.match.state.ga, min: g.match.minute, ph: g.match.phase, fin: g.match.finished }], ev: [] });
  live.penaltyTimer = setTimeout(() => endPenalty(room), 2600);
}
function endPenalty(room) {
  const live = room.live;
  if (!live || !live.penalty) return;
  clearTimeout(live.penaltyTimer);
  const g = live.games[live.penalty.i];
  live.pause.penalty.delete(live.penalty.key);
  if (g) g.penaltyActive = false;
  const i = live.penalty.i;
  live.penalty = null;
  broadcast(room, "penaltyEnd", { i });
  broadcastPause(room);
}

function finishLiveRound(room) {
  const live = room.live;
  clearInterval(live.timer);
  if (live.penaltyTimer) clearTimeout(live.penaltyTimer);
  room.live = null;
  room.phase = "manage";
  const results = live.games.map(g => ({ fixture: g.entry.fixture, result: g.match.result() }));
  room.game.completeRound(results);
  broadcast(room, "roundEnd", {
    results: results.map((r, i) => ({
      i, home: r.fixture.home, away: r.fixture.away, gh: r.result.gh, ga: r.result.ga
    }))
  });
  pushSnapshots(room);
  pushLobby(room);
  saveRoom(room);
}

// ---------- ações ----------
function handleAction(room, player, body, respond) {
  const game = room.game;
  const t = body.type;
  room.lastActivity = Date.now();

  // lobby
  if (t === "chat") {
    const text = String(body.text || "").slice(0, 300);
    if (text) broadcast(room, "chat", { from: player.name, text });
    return respond({ ok: true });
  }
  if (t === "freeClubs") {
    return respond({ ok: true, clubs: freeClubs(room) });
  }
  if (t === "joinPick") {
    // novo técnico que entrou no meio do jogo assume um clube livre
    if (room.frozenForJoin !== player.id) return respond({ ok: false, reason: "Escolha inválida." });
    if (player.clubId) return respond({ ok: false, reason: "Você já tem clube." });
    const free = freeClubs(room).map(c => c.id);
    if (!free.includes(body.clubId)) return respond({ ok: false, reason: "Clube indisponível." });
    const r = room.game.addHuman(player.id, player.name, body.clubId);
    if (!r.ok) return respond({ ok: false, reason: r.reason });
    player.clubId = body.clubId;
    room.frozenForJoin = null;
    broadcast(room, "joinDone", { name: player.name, club: room.game.world.clubs[body.clubId].name });
    pushSnapshots(room);
    pushLobby(room);
    saveRoom(room);
    return respond({ ok: true });
  }
  // enquanto um novo técnico não escolhe clube, ninguém mexe em nada (exceto ele e o chat)
  if (room.frozenForJoin && room.frozenForJoin !== player.id) {
    return respond({ ok: false, reason: "Aguardando novo técnico escolher time…" });
  }
  if (t === "setCountry") {
    if (player.id !== room.hostId || room.phase !== "lobby") return respond({ ok: false, reason: "Apenas o dono da sala, no lobby." });
    room.countryId = ["BRA", "ENG", "ESP", "ITA", "POR", "GER"].includes(body.countryId) ? body.countryId : "BRA";
    for (const p of room.players.values()) { p.clubId = null; p.lobbyReady = false; }
    pushLobby(room);
    return respond({ ok: true });
  }
  if (t === "pickClub") {
    if (room.phase !== "lobby") return respond({ ok: false, reason: "A sala já começou." });
    const taken = [...room.players.values()].some(p => p.id !== player.id && p.clubId === body.clubId);
    if (taken) return respond({ ok: false, reason: "Clube já escolhido." });
    player.clubId = body.clubId;
    player.lobbyReady = false; // ao trocar de clube, precisa confirmar de novo
    pushLobby(room);
    return respond({ ok: true });
  }
  if (t === "lobbyReady") {
    if (room.phase !== "lobby") return respond({ ok: false, reason: "A sala já começou." });
    if (!player.clubId) return respond({ ok: false, reason: "Escolha um clube primeiro." });
    player.lobbyReady = !!body.ready;
    pushLobby(room);
    return respond({ ok: true });
  }
  if (t === "start") {
    if (player.id !== room.hostId || room.phase !== "lobby") return respond({ ok: false, reason: "Apenas o dono da sala pode iniciar." });
    const withClub = [...room.players.values()].filter(p => p.clubId);
    if (!withClub.length) return respond({ ok: false, reason: "Escolham os clubes primeiro." });
    if (!lobbyState(room).canStart) return respond({ ok: false, reason: "Aguarde todos os técnicos escolherem clube e clicarem em Pronto." });
    room.game = TF.roomGame.createRoomGame(room.countryId);
    for (const p of withClub) {
      const r = room.game.addHuman(p.id, p.name, p.clubId);
      if (!r.ok) { room.game = null; return respond({ ok: false, reason: p.name + ": " + r.reason }); }
    }
    room.phase = "manage";
    broadcast(room, "started", {});
    pushSnapshots(room);
    pushLobby(room);
    saveRoom(room);
    return respond({ ok: true });
  }

  if (!game || !game.humans[player.id]) return respond({ ok: false, reason: "Você não está no jogo." });
  const h = game.humans[player.id];

  // gestão
  if (t === "ready") {
    player.ready = !!body.ready;
    pushLobby(room);
    tryAdvance(room);
    return respond({ ok: true });
  }
  if (t === "lineup") {
    if (Array.isArray(body.starters)) h.squad.starters = body.starters.map(x => x || null).slice(0, 11);
    if (Array.isArray(body.bench)) h.squad.bench = body.bench.slice(0, 7);
    return respond({ ok: true });
  }
  if (t === "setPieces") {
    const r = game.setSquadPiece(player.id, body.key, body.id);
    if (r.ok) pushSnapshots(room);
    return respond(r);
  }
  if (t === "tactics") {
    if (body.formationName && TF.match.FORMATIONS[body.formationName]) {
      if (body.formationName !== h.tactics.formationName) {
        h.tactics.formationName = body.formationName;
        game.autoLineupFor(h);
      }
    }
    applyTacticDims(h.tactics, body); // aceita as novas dimensões táticas
    if (["auto", "principais", "secundarias"].includes(body.training)) h.training = body.training;
    return respond({ ok: true, squad: h.squad });
  }
  if (t === "autoLineup") {
    game.autoLineupFor(h);
    return respond({ ok: true, squad: h.squad });
  }
  if (t === "offer") {
    const r = game.makeOfferFrom(player.id, body.targetId, Math.max(0, body.value | 0), Math.max(0, body.wage | 0), body.years === 1 ? 1 : 2);
    if (r.ok) { pushSnapshots(room); saveRoom(room); }
    return respond(r);
  }
  if (t === "respondAiOffer") {
    const r = game.respondAiOffer(player.id, body.index | 0, !!body.accept);
    if (r.ok) { pushSnapshots(room); saveRoom(room); }
    return respond(r);
  }
  if (t === "respondHumanOffer") {
    const r = game.respondHumanOffer(player.id, body.index | 0, !!body.accept);
    if (r.ok) { pushSnapshots(room); saveRoom(room); }
    return respond(r);
  }
  if (t === "sell") {
    const p = game.clubOf(player.id).players.find(x => x.id === body.targetId);
    if (!p) return respond({ ok: false, reason: "Jogador não encontrado." });
    if (body.price == null) { p.forSale = false; p.salePrice = null; }
    else { p.forSale = true; p.salePrice = Math.max(0, body.price | 0) || null; }
    pushSnapshots(room);
    return respond({ ok: true });
  }
  if (t === "renew") {
    const p = game.clubOf(player.id).players.find(x => x.id === body.targetId);
    if (!p) return respond({ ok: false, reason: "Jogador não encontrado." });
    const r = TF.transfers.renewContract(p, game.clubOf(player.id), Math.max(0, body.wage | 0), body.years === 1 ? 1 : 2);
    if (r.ok) pushSnapshots(room);
    return respond(r);
  }
  if (t === "ticket") {
    const club = game.clubOf(player.id);
    club.ticketPrice = Math.min(500, Math.max(5, body.price | 0));
    return respond({ ok: true });
  }
  if (t === "expand") {
    const r = TF.finance.orderStadiumExpansion(game.clubOf(player.id), [5000, 10000, 20000].includes(body.seats | 0) ? body.seats | 0 : 5000);
    if (r.ok) pushSnapshots(room);
    return respond(r);
  }

  // §11-18 ações do pênalti (independem do jogo próprio do técnico)
  if (t === "penaltyTaker") {
    const live = room.live;
    if (!live || !live.penalty || live.penalty.phase !== "waiting_taker") return respond({ ok: false, reason: "Sem pênalti para cobrar." });
    if (live.penalty.attackerHumanId !== player.id) return respond({ ok: false, reason: "Você não bate este pênalti." });
    const g = live.games[live.penalty.i];
    g.match.setPenaltyTaker(body.takerId);
    live.penalty.takerId = g.match.penalty.takerId;
    live.penalty.takerName = g.match.penalty.takerName;
    schedulePenaltyReveal(room);
    return respond({ ok: true });
  }
  if (t === "penaltyAccelerate") {
    const live = room.live;
    if (!live || !live.penalty) return respond({ ok: false, reason: "Sem pênalti." });
    if (player.id !== live.penalty.attackerHumanId && player.id !== live.penalty.defenderHumanId)
      return respond({ ok: false, reason: "Só quem joga a partida pode acelerar." });
    if (live.penalty.phase === "suspense") doPenaltyReveal(room);
    else if (live.penalty.phase === "result") endPenalty(room);
    return respond({ ok: true });
  }

  // durante a rodada ao vivo
  const LIVE_ACTIONS = ["sub", "liveTactics", "ready2h", "manageOpen", "manageClose", "liveSwap", "liveReform", "liveCaptain", "liveSetPiece"];
  if (LIVE_ACTIONS.includes(t)) {
    const live = room.live;
    if (!live) return respond({ ok: false, reason: "Nenhuma rodada em andamento." });
    const g = live.games.find(x => x.entry.humanH === player.id || x.entry.humanA === player.id);
    if (!g) return respond({ ok: false, reason: "Você não tem jogo nesta rodada." });
    const sideKey = g.entry.humanH === player.id ? "h" : "a";
    const team = sideKey === "h" ? g.entry.home : g.entry.away;

    // §10 Pausa global enquanto um técnico gerencia. Como o relógio fica congelado
    // para todos, vários técnicos podem gerir ao mesmo tempo sem prejuízo.
    if (t === "manageOpen") {
      live.pause.manage.add(player.id);
      broadcastPause(room);
      return respond({ ok: true, lineup: serializeLineup(team) });
    }
    if (t === "manageClose") {
      live.pause.manage.delete(player.id);
      broadcastPause(room);
      return respond({ ok: true });
    }
    if (t === "sub") {
      const r = g.match.substitute(sideKey, body.out, body.in);
      return respond(Object.assign(r, { lineup: serializeLineup(team) }));
    }
    if (t === "liveSwap") {
      const r = g.match.swapPositions(sideKey, body.a, body.b);
      return respond(Object.assign(r, { lineup: serializeLineup(team) }));
    }
    if (t === "liveReform") {
      const r = TF.match.reformTeam(team, body.formation);
      return respond(Object.assign(r, { lineup: serializeLineup(team) }));
    }
    if (t === "liveCaptain") {
      team.captainId = body.id;
      return respond({ ok: true });
    }
    if (t === "liveSetPiece") {
      team.setPieces = team.setPieces || {};
      if (["freeKick", "cornerLeft", "cornerRight"].includes(body.key)) team.setPieces[body.key] = body.id;
      return respond({ ok: true });
    }
    if (t === "liveTactics") {
      if (body.formationName && TF.match.FORMATIONS[body.formationName] && body.formationName !== team.formationName) {
        TF.match.reformTeam(team, body.formationName);
      }
      applyTacticDims(team.tactics, body);
      return respond(Object.assign({ ok: true }, body.formationName ? { lineup: serializeLineup(team) } : {}));
    }
    // ready2h — §10: o 2º tempo só começa quando TODOS os humanos confirmarem (sem timeout)
    live.pause.halftime.delete(player.id);
    if (!live.pause.halftime.size) {
      for (const gg of live.games) gg.resume2h = true;
    }
    broadcastPause(room);
    return respond({ ok: true });
  }

  respond({ ok: false, reason: "Ação desconhecida: " + t });
}

// ---------- persistência simples das salas ----------
const DATA_DIR = path.join(ROOT, "rooms-data");
function saveRoom(room) {
  if (!room.game) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    const g = room.game;
    const data = {
      code: room.code, phase: "manage", countryId: room.countryId, hostId: room.hostId,
      players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, token: p.token, clubId: p.clubId })),
      game: {
        countryId: g.countryId, week: g.week, humans: g.humans, lastResults: g.lastResults,
        season: g.season, world: { ...g.world, players: undefined }
      }
    };
    fs.writeFile(path.join(DATA_DIR, room.code + ".json"), JSON.stringify(data), () => {});
  } catch (e) { console.error("Falha ao salvar sala:", e.message); }
}

function loadRooms() {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        const room = {
          code: data.code, phase: "manage", countryId: data.countryId, hostId: data.hostId,
          players: new Map(), game: null, live: null, chat: [], lastActivity: Date.now()
        };
        for (const p of data.players) room.players.set(p.id, { ...p, ready: false, sse: null });
        // reidrata o jogo por cima de uma instância nova (mundo mutado no lugar)
        const rg = TF.roomGame.createRoomGame(data.game.countryId);
        rg.hydrate(data.game);
        room.game = rg;
        rooms.set(room.code, room);
        console.log("Sala restaurada:", room.code);
      } catch (e) { console.error("Sala corrompida ignorada:", f, e.message); }
    }
  } catch (e) { console.error("Falha ao restaurar salas:", e.message); }
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_IDLE_MS) {
      if (room.live) clearInterval(room.live.timer);
      rooms.delete(code);
      try { fs.unlinkSync(path.join(DATA_DIR, code + ".json")); } catch (e) { /* ok */ }
    }
  }
}, 10 * 60 * 1000);

// ---------- HTTP ----------
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, cb) {
  let data = "";
  req.on("data", c => { data += c; if (data.length > 200000) req.destroy(); });
  req.on("end", () => {
    try { cb(JSON.parse(data || "{}")); } catch (e) { cb(null); }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/api/health") return json(res, 200, { ok: true, rooms: rooms.size });

  if (p === "/api/room/create" && req.method === "POST") {
    return readBody(req, body => {
      if (!body) return json(res, 400, { ok: false, reason: "JSON inválido" });
      const { room, player } = createRoom(body.name);
      json(res, 200, { ok: true, code: room.code, playerId: player.id, token: player.token, lobby: lobbyState(room) });
    });
  }

  if (p === "/api/room/join" && req.method === "POST") {
    return readBody(req, body => {
      if (!body) return json(res, 400, { ok: false, reason: "JSON inválido" });
      const room = rooms.get(String(body.code || "").toUpperCase().trim());
      if (!room) return json(res, 404, { ok: false, reason: "Sala não encontrada. Confira o código." });
      // reconexão
      if (body.playerId && body.token) {
        const existing = auth(room, body.playerId, body.token);
        if (existing) return json(res, 200, { ok: true, code: room.code, playerId: existing.id, token: existing.token, lobby: lobbyState(room), rejoined: true, inGame: room.phase !== "lobby", needsClub: !existing.clubId && room.phase !== "lobby" });
      }
      if (room.players.size >= 12) return json(res, 400, { ok: false, reason: "Sala cheia." });
      // entrar no meio do jogo: precisa haver clube livre para assumir
      if (room.phase !== "lobby") {
        if (!room.game) return json(res, 400, { ok: false, reason: "A sala ainda não começou." });
        if (freeClubs(room).length === 0) return json(res, 400, { ok: false, reason: "Não há clubes livres para assumir." });
        const player = addPlayer(room, body.name);
        room.frozenForJoin = player.id;              // congela tudo até ele escolher
        broadcast(room, "joinFreeze", { name: player.name });
        return json(res, 200, { ok: true, code: room.code, playerId: player.id, token: player.token, lobby: lobbyState(room), inGame: true, needsClub: true });
      }
      const player = addPlayer(room, body.name);
      pushLobby(room);
      json(res, 200, { ok: true, code: room.code, playerId: player.id, token: player.token, lobby: lobbyState(room) });
    });
  }

  const actionMatch = p.match(/^\/api\/room\/([A-Z0-9]+)\/action$/);
  if (actionMatch && req.method === "POST") {
    const room = rooms.get(actionMatch[1]);
    if (!room) return json(res, 404, { ok: false, reason: "Sala não encontrada." });
    return readBody(req, body => {
      if (!body) return json(res, 400, { ok: false, reason: "JSON inválido" });
      const player = auth(room, body.playerId, body.token);
      if (!player) return json(res, 403, { ok: false, reason: "Não autorizado." });
      handleAction(room, player, body, out => json(res, 200, out));
    });
  }

  const eventsMatch = p.match(/^\/api\/room\/([A-Z0-9]+)\/events$/);
  if (eventsMatch) {
    const room = rooms.get(eventsMatch[1]);
    if (!room) return json(res, 404, { ok: false, reason: "Sala não encontrada." });
    const player = auth(room, url.searchParams.get("playerId"), url.searchParams.get("token"));
    if (!player) return json(res, 403, { ok: false, reason: "Não autorizado." });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    player.sse = res;
    room.lastActivity = Date.now();
    sseSend(player, "lobby", lobbyState(room));
    if (room.game) sseSend(player, "snapshot", { shared: room.game.snapshot(), personal: room.game.personal(player.id) });
    // §10 reconexão: se há rodada ao vivo, reconstrói o estado (placares, eventos, pausa)
    if (room.live) sseSend(player, "roundSnapshot", liveSnapshot(room));
    pushLobby(room);
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) { /* fecha abaixo */ } }, 25000);
    req.on("close", () => {
      clearInterval(ka);
      if (player.sse === res) player.sse = null;
      player.ready = false;
      // se o técnico que estava escolhendo clube caiu, descongela e remove
      if (room.frozenForJoin === player.id && !player.clubId) {
        room.frozenForJoin = null;
        room.players.delete(player.id);
        broadcast(room, "joinDone", { name: player.name, aborted: true });
      }
      pushLobby(room);
    });
    return;
  }

  // arquivos estáticos
  let filePath = p === "/" ? "/index.html" : decodeURIComponent(p);
  const file = path.join(ROOT, path.normalize(filePath).replace(/^([.][.][\\/])+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

loadRooms();
server.listen(PORT, () => {
  console.log("Técnico 26 rodando em http://localhost:" + PORT);
  console.log("Modo online: http://localhost:" + PORT + "/online.html");
});
