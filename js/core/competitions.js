"use strict";
/* Competições: gera calendário da temporada (ligas A/B em turno e returno + copa nacional),
   mantém classificações e resolve fases de copa. */
(function () {
  const U = window.TF.util;

  // Round-robin (algoritmo do círculo). Retorna rodadas: [[ [casa,fora], ... ], ...]
  function roundRobin(ids, doubleRound) {
    const teams = ids.slice();
    if (teams.length % 2 === 1) teams.push(null);
    const n = teams.length, roundsCount = n - 1, half = n / 2;
    const rounds = [];
    let arr = teams.slice();
    for (let r = 0; r < roundsCount; r++) {
      const round = [];
      for (let i = 0; i < half; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        if (a != null && b != null) round.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(round);
      arr = [arr[0], arr[n - 1]].concat(arr.slice(1, n - 1)); // rotação
    }
    if (doubleRound) {
      const returno = rounds.map(round => round.map(([h, a]) => [a, h]));
      return rounds.concat(returno);
    }
    return rounds;
  }

  function newTableRow(clubId) {
    return { clubId, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0 };
  }

  function applyResult(table, homeId, awayId, gh, ga) {
    const h = table.find(r => r.clubId === homeId), a = table.find(r => r.clubId === awayId);
    if (!h || !a) return;
    h.j++; a.j++; h.gp += gh; h.gc += ga; a.gp += ga; a.gc += gh;
    h.sg = h.gp - h.gc; a.sg = a.gp - a.gc;
    if (gh > ga) { h.v++; a.d++; h.pts += 3; }
    else if (gh < ga) { a.v++; h.d++; a.pts += 3; }
    else { h.e++; a.e++; h.pts++; a.pts++; }
  }

  function sortTable(table) {
    return table.slice().sort((x, y) => y.pts - x.pts || y.v - x.v || y.sg - x.sg || y.gp - x.gp || x.clubId.localeCompare(y.clubId));
  }

  /* Copa nacional: 32 clubes (Série A completa + melhores da B).
     Fases 1 e 2 em jogo único (fase 1: empate classifica o visitante; fase 2: pênaltis),
     depois quartas/semi/final em jogo único com pênaltis (simplificação da fase 1). */
  function drawCup(country, world, rng) {
    const clubsA = country.clubIdsA.slice();
    const clubsB = country.clubIdsB.slice().sort((x, y) => world.clubs[y].rating - world.clubs[x].rating);
    const entrants = clubsA.concat(clubsB.slice(0, 32 - clubsA.length));
    const shuffled = [];
    const pool = entrants.slice();
    while (pool.length) shuffled.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const ties = [];
    for (let i = 0; i < shuffled.length; i += 2) ties.push({ home: shuffled[i], away: shuffled[i + 1] });
    return { name: country.cupName, phase: 1, phaseName: "1ª fase", ties, results: [], winners: [], championId: null, history: [] };
  }

  const CUP_PHASES = { 1: "1ª fase", 2: "2ª fase", 3: "Quartas de final", 4: "Semifinal", 5: "Final" };

  function nextCupPhase(cup, rng) {
    // winners da fase atual viram os confrontos da próxima
    const w = cup.winners.slice();
    cup.history.push({ phase: cup.phase, results: cup.results.slice() });
    cup.phase++;
    cup.phaseName = CUP_PHASES[cup.phase] || "Final";
    cup.ties = [];
    cup.results = [];
    cup.winners = [];
    if (w.length <= 1) { cup.championId = w[0] || null; cup.ties = []; return; }
    const pool = w.slice();
    const shuffled = [];
    while (pool.length) shuffled.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    for (let i = 0; i < shuffled.length; i += 2) cup.ties.push({ home: shuffled[i], away: shuffled[i + 1] });
  }

  /* Calendário da temporada: intercala rodadas de liga (fim de semana) e datas de copa (meio de semana).
     Cada "slot" do calendário tem tipo e índice. 38 rodadas de liga + 5 fases de copa. */
  function buildSeasonCalendar(world, rng) {
    const season = {
      year: world.season,
      leagues: {},   // por país: { A: {rounds, table, currentRound}, B: {...} }
      cups: {},      // por país
      slots: [],     // sequência de datas do ano
      slotIndex: 0,
      finished: false
    };

    let maxRoundsA = 0;
    for (const cid of Object.keys(world.countries)) {
      const c = world.countries[cid];
      const roundsA = roundRobin(U.RNG.shuffle(c.clubIdsA), true);
      const roundsB = roundRobin(U.RNG.shuffle(c.clubIdsB), true);
      season.leagues[cid] = {
        A: { name: c.leagueNameA, rounds: roundsA, table: c.clubIdsA.map(newTableRow), currentRound: 0 },
        B: { name: c.leagueNameB, rounds: roundsB, table: c.clubIdsB.map(newTableRow), currentRound: 0 }
      };
      season.cups[cid] = drawCup(c, world, rng);
      maxRoundsA = Math.max(maxRoundsA, roundsA.length, roundsB.length);
    }

    // monta slots: a cada 7 rodadas de liga, 1 data de copa (5 datas de copa no total)
    const cupDates = 5;
    let cupsPlaced = 0;
    for (let r = 0; r < maxRoundsA; r++) {
      season.slots.push({ type: "league", round: r });
      const shouldPlaceCup = Math.floor(((r + 1) / maxRoundsA) * (cupDates + 0.001)) > cupsPlaced;
      if (shouldPlaceCup && cupsPlaced < cupDates) {
        cupsPlaced++;
        season.slots.push({ type: "cup", phase: cupsPlaced });
      }
    }
    season.slots.push({ type: "endOfSeason" });
    return season;
  }

  window.TF.competitions = { roundRobin, newTableRow, applyResult, sortTable, drawCup, nextCupPhase, buildSeasonCalendar, CUP_PHASES };
})();
