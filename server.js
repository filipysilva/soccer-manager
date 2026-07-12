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
const HALFTIME_TIMEOUT_MS = 45000; // 2º tempo começa sozinho depois disso
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

function startLiveRound(room, r) {
  room.phase = "round";
  const M = TF.match;
  const live = {
    label: r.label,
    games: r.matches.map(e => ({
      entry: e,
      match: M.createMatch(e.home, e.away, { grass: e.grass }),
      shown: 0
    })),
    halftimeWaiting: new Set(), // playerIds dos quais se espera "pronto"
    halftimeTimer: null,
    timer: null,
    paused: false,
    pausedBy: null
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
  if (!live || live.paused || room.frozenForJoin) return; // congelada (gestão ou entrada de técnico)
  const updates = [];
  const newEvents = [];
  let someoneHitHalftime = false;

  for (let i = 0; i < live.games.length; i++) {
    const g = live.games[i];
    if (g.match.finished) continue;
    const hasHuman = g.entry.humanH || g.entry.humanA;
    if (hasHuman && g.match.phase === "halftime" && !g.resume2h) {
      if (!g.halfNotified) {
        g.halfNotified = true;
        for (const pid of [g.entry.humanH, g.entry.humanA]) if (pid) live.halftimeWaiting.add(pid);
        broadcast(room, "halftime", { i, waiting: [...live.halftimeWaiting] });
        scheduleHalftimeTimeout(room);
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
    if (hasHuman && g.match.phase === "halftime") someoneHitHalftime = true;
  }

  if (updates.length || newEvents.length) broadcast(room, "tick", { m: updates, ev: newEvents });

  if (live.games.every(g => g.match.finished)) finishLiveRound(room);
}

function scheduleHalftimeTimeout(room) {
  const live = room.live;
  if (!live || live.halftimeTimer) return;
  live.halftimeTimer = setTimeout(() => {
    live.halftimeTimer = null;
    for (const g of live.games) g.resume2h = true;
    live.halftimeWaiting.clear();
    broadcast(room, "info", { text: "Segundo tempo iniciado automaticamente." });
  }, HALFTIME_TIMEOUT_MS);
}

function finishLiveRound(room) {
  const live = room.live;
  clearInterval(live.timer);
  if (live.halftimeTimer) clearTimeout(live.halftimeTimer);
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

  // durante a rodada ao vivo
  const LIVE_ACTIONS = ["sub", "liveTactics", "ready2h", "manageOpen", "manageClose", "liveSwap", "liveReform", "liveCaptain", "liveSetPiece"];
  if (LIVE_ACTIONS.includes(t)) {
    const live = room.live;
    if (!live) return respond({ ok: false, reason: "Nenhuma rodada em andamento." });
    const g = live.games.find(x => x.entry.humanH === player.id || x.entry.humanA === player.id);
    if (!g) return respond({ ok: false, reason: "Você não tem jogo nesta rodada." });
    const sideKey = g.entry.humanH === player.id ? "h" : "a";
    const team = sideKey === "h" ? g.entry.home : g.entry.away;

    // pausa global enquanto um técnico gerencia o time
    if (t === "manageOpen") {
      if (live.paused && live.pausedBy !== player.id) return respond({ ok: false, reason: "Outro técnico está gerenciando; aguarde." });
      live.paused = true;
      live.pausedBy = player.id;
      broadcast(room, "roundPaused", { by: player.name });
      return respond({ ok: true, lineup: serializeLineup(team) });
    }
    if (t === "manageClose") {
      if (live.pausedBy === player.id) { live.paused = false; live.pausedBy = null; broadcast(room, "roundResumed", {}); }
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
    // ready2h
    live.halftimeWaiting.delete(player.id);
    const stillWaitingForThisMatch = [g.entry.humanH, g.entry.humanA].some(pid => pid && live.halftimeWaiting.has(pid));
    if (!stillWaitingForThisMatch) g.resume2h = true;
    if (!live.halftimeWaiting.size && live.halftimeTimer) {
      clearTimeout(live.halftimeTimer);
      live.halftimeTimer = null;
      for (const gg of live.games) gg.resume2h = true;
    }
    broadcast(room, "halftime", { waiting: [...live.halftimeWaiting] });
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
