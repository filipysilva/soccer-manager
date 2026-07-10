"use strict";
/* Estado da carreira: avança o calendário, processa rodadas, treino, evolução,
   fim de temporada (premiações, acesso/rebaixamento) e save/load. */
(function () {
  const U = window.TF.util;
  const C = () => window.TF.competitions;
  const M = () => window.TF.match;
  const F = () => window.TF.finance;
  const T = () => window.TF.transfers;

  const SAVE_KEY = "tf26_save_";

  const state = {
    world: null, season: null,
    coach: null,          // { name, clubId, reputation, points, titles: [], history: [] }
    tactics: null,        // { formationName, style, marking }
    userSquad: null,      // { starters: [playerId x11 por slot], bench: [ids] }
    training: "auto",
    news: [],
    aiOffers: [],         // propostas da IA por jogadores do usuário
    setPieces: null,      // { captain, freeKick, cornerLeft, cornerRight }
    week: 1,
    pendingLiveRound: null,
    lastRoundResults: null,
    started: false
  };

  function userClub() { return state.world.clubs[state.coach.clubId]; }

  function addNews(title, text, type) {
    state.news.unshift({ week: state.week, season: state.season.year, title, text, type: type || "info" });
    if (state.news.length > 120) state.news.length = 120;
  }

  // ---------- nova carreira ----------
  function newCareer(coachName, clubId) {
    U.RNG.seed(coachName + "|" + clubId + "|" + Date.now());
    const world = window.TF.world.buildWorld();
    state.world = world;
    for (const club of Object.values(world.clubs)) {
      club.money = F().initialMoney(club);
      club.money += F().seasonSponsorship(club);
      club.ticketPrice = F().suggestedTicketPrice(club);
    }
    state.season = C().buildSeasonCalendar(world, U.RNG.next.bind(U.RNG));
    state.coach = { name: coachName, clubId, reputation: 50, points: 0, titles: [], history: [] };
    state.tactics = { formationName: M().bestFormationFor(world.clubs[clubId]), style: "equilibrado", marking: "leve" };
    autoLineup();
    state.training = "auto";
    state.news = [];
    state.aiOffers = [];
    state.week = 1;
    state.started = true;
    addNews("Bem-vindo ao " + userClub().name + "!",
      "A diretoria deseja boa sorte na temporada " + state.season.year + ". Patrocínio de " +
      U.formatMoney(F().seasonSponsorship(userClub())) + " já está em caixa.", "board");
    return state;
  }

  function autoLineup() {
    const picked = M().pickLineup(userClub(), state.tactics ? state.tactics.formationName : "4-4-2");
    state.userSquad = {
      starters: picked.lineup.map(s => s.player ? s.player.id : null),
      bench: picked.bench.map(p => p.id)
    };
    autoAssignSetPieces();
  }

  /* Capitão e cobradores: mantém a escolha do técnico se o jogador segue no elenco;
     senão escolhe o melhor candidato automaticamente. */
  function autoAssignSetPieces() {
    const club = userClub();
    const byId = {};
    for (const p of club.players) byId[p.id] = p;
    const starters = state.userSquad.starters.map(id => byId[id]).filter(Boolean);
    if (!starters.length) return;
    const sp = state.setPieces || {};
    const keep = id => id && byId[id] ? id : null;
    const bestBy = fn => starters.filter(p => p.pos !== "GOL").sort((a, b) => fn(b) - fn(a))[0];
    const crossScore = p => p.skills.pass + p.skills.technique * 0.5 + (p.traits.includes("Cruzamento") ? 25 : 0);
    state.setPieces = {
      captain: keep(sp.captain) || (starters.slice().sort((a, b) => (b.rating + b.age) - (a.rating + a.age))[0] || {}).id || null,
      freeKick: keep(sp.freeKick) || (bestBy(p => p.skills.technique + p.skills.finishing) || {}).id || null,
      // preferência de pé por lado do escanteio
      cornerLeft: keep(sp.cornerLeft) || (bestBy(p => crossScore(p) + (p.foot === "E" ? 18 : 0)) || {}).id || null,
      cornerRight: keep(sp.cornerRight) || (bestBy(p => crossScore(p) + (p.foot === "D" ? 18 : 0)) || {}).id || null
    };
  }

  /* Monta o objeto "team" para o motor a partir da escalação do usuário. */
  function userTeam() {
    const club = userClub();
    const formation = M().FORMATIONS[state.tactics.formationName];
    const byId = {};
    for (const p of club.players) byId[p.id] = p;
    const lineup = formation.map((pos, i) => {
      const pid = state.userSquad.starters[i];
      const p = pid ? byId[pid] : null;
      return { slotPos: pos, player: p && !p.injuryWeeks && !p.suspended && p.contractYears > 0 ? p : null };
    });
    // preenche buracos automaticamente
    const used = new Set(lineup.filter(s => s.player).map(s => s.player.id));
    for (const slot of lineup) {
      if (slot.player) continue;
      let best = null, bestVal = -1;
      for (const p of club.players) {
        if (used.has(p.id) || p.injuryWeeks || p.suspended || p.contractYears <= 0) continue;
        const v = p.rating * M().positionFactor(p, slot.slotPos);
        if (v > bestVal) { bestVal = v; best = p; }
      }
      if (best) { slot.player = best; used.add(best.id); }
    }
    const bench = state.userSquad.bench.map(id => byId[id])
      .filter(p => p && !used.has(p.id) && !p.injuryWeeks && !p.suspended && p.contractYears > 0);
    const sp = state.setPieces || {};
    return {
      club, lineup, bench,
      tactics: { style: state.tactics.style, marking: state.tactics.marking },
      captainId: sp.captain || null,
      setPieces: { freeKick: sp.freeKick || null, cornerLeft: sp.cornerLeft || null, cornerRight: sp.cornerRight || null },
      subsUsed: 0
    };
  }

  function aiTeam(club) {
    const picked = M().pickLineup(club, M().bestFormationFor(club));
    return { club, lineup: picked.lineup, bench: picked.bench.slice(), tactics: { style: "equilibrado", marking: "leve" }, subsUsed: 0 };
  }

  function resetMatchFlags(club) {
    for (const p of club.players) { p.matchGoals = 0; p.matchYellow = 0; p.matchPlayed = false; }
  }

  // ---------- avanço do calendário ----------
  /* Retorna o que o próximo slot contém. Se o usuário joga, devolve TODOS os jogos
     da rodada do campeonato dele para a UI rodar simultaneamente (estilo Brasfoot);
     senão processa tudo. */
  function nextSlot() {
    const slot = state.season.slots[state.season.slotIndex];
    if (!slot) return { type: "seasonOver" };
    if (slot.type === "endOfSeason") return { type: "endOfSeason" };
    const fixture = findUserFixture(slot);
    if (fixture) {
      const uid = state.coach.clubId;
      const cid = userClub().countryId;
      // todos os confrontos da rodada/fase do campeonato do usuário
      let pairs = [];
      let label = "";
      if (slot.type === "league") {
        const div = userClub().division;
        const league = state.season.leagues[cid][div];
        pairs = league.rounds[slot.round].slice();
        label = league.name + " — Rodada " + (slot.round + 1);
      } else {
        const cup = state.season.cups[cid];
        pairs = cup.ties.map(t => [t.home, t.away]);
        label = state.world.countries[cid].cupName + " — " + cup.phaseName;
      }
      const matches = pairs.map(([h, a]) => {
        const homeClub = state.world.clubs[h], awayClub = state.world.clubs[a];
        resetMatchFlags(homeClub); resetMatchFlags(awayClub);
        const isUser = h === uid || a === uid;
        return {
          fixture: { home: h, away: a },
          isUser,
          isHome: h === uid,
          home: isUser && h === uid ? userTeam() : aiTeam(homeClub),
          away: isUser && a === uid ? userTeam() : aiTeam(awayClub),
          grass: homeClub.grass
        };
      });
      state.pendingLiveRound = { slot, fixture, isHome: fixture.home === uid };
      return { type: "liveRound", matches, slot, label, competition: fixture.competition };
    }
    // usuário não joga neste slot (ex.: eliminado da copa): processa direto
    processSlot(slot, null, null);
    return { type: "processed", slot };
  }

  function findUserFixture(slot) {
    const cid = userClub().countryId;
    const uid = state.coach.clubId;
    if (slot.type === "league") {
      const div = userClub().division;
      const league = state.season.leagues[cid][div];
      const round = league.rounds[slot.round];
      if (!round) return null;
      const f = round.find(([h, a]) => h === uid || a === uid);
      return f ? { home: f[0], away: f[1], competition: { kind: "league", country: cid, div, round: slot.round } } : null;
    }
    if (slot.type === "cup") {
      const cup = state.season.cups[cid];
      if (cup.phase !== slot.phase || cup.championId) return null;
      const tie = cup.ties.find(t => t.home === uid || t.away === uid);
      return tie ? { home: tie.home, away: tie.away, competition: { kind: "cup", country: cid, phase: slot.phase } } : null;
    }
    return null;
  }

  /* Depois que a UI terminou a rodada ao vivo, processa o slot com os resultados jogados.
     liveResults: [{ fixture: {home, away}, result }] de todos os jogos exibidos. */
  function completeLiveRound(liveResults) {
    const pending = state.pendingLiveRound;
    state.pendingLiveRound = null;
    const provided = {};
    let userPlayed = null;
    for (const lr of liveResults) {
      provided[lr.fixture.home + "|" + lr.fixture.away] = lr.result;
      if (lr.fixture.home === pending.fixture.home && lr.fixture.away === pending.fixture.away) {
        userPlayed = { fixture: lr.fixture, result: lr.result };
      }
    }
    processSlot(pending.slot, provided, userPlayed);
  }

  function processSlot(slot, provided, userPlayed) {
    const results = [];
    if (slot.type === "league") {
      for (const cid of Object.keys(state.season.leagues)) {
        for (const div of ["A", "B"]) {
          const league = state.season.leagues[cid][div];
          const round = league.rounds[slot.round];
          if (!round) continue;
          for (const [h, a] of round) {
            const res = resolveFixture(h, a, provided, "league");
            C().applyResult(league.table, h, a, res.gh, res.ga);
            results.push({ competition: cid + " " + div, home: h, away: a, gh: res.gh, ga: res.ga });
          }
          league.currentRound = slot.round + 1;
        }
      }
      afterUserLeagueMatch(userPlayed);
    } else if (slot.type === "cup") {
      for (const cid of Object.keys(state.season.cups)) {
        const cup = state.season.cups[cid];
        if (cup.championId || cup.phase !== slot.phase) continue;
        for (const tie of cup.ties) {
          const res = resolveFixture(tie.home, tie.away, provided, "cup");
          let winner;
          if (res.gh > res.ga) winner = tie.home;
          else if (res.ga > res.gh) winner = tie.away;
          else winner = cup.phase === 1 ? tie.away : (U.RNG.chance(0.5) ? tie.home : tie.away); // fase 1: empate classifica visitante; depois: pênaltis
          tie.gh = res.gh; tie.ga = res.ga; tie.winner = winner;
          tie.penalties = res.gh === res.ga && cup.phase > 1;
          cup.results.push({ ...tie });
          cup.winners.push(winner);
          results.push({ competition: cid + " Copa", home: tie.home, away: tie.away, gh: res.gh, ga: res.ga, winner });
        }
        const wasFinal = cup.winners.length === 1 && cup.phase >= 5;
        C().nextCupPhase(cup, U.RNG.next.bind(U.RNG));
        if (cup.championId) {
          const champ = state.world.clubs[cup.championId];
          champ.titles.push({ name: state.world.countries[cid].cupName, year: state.season.year });
          if (cup.championId === state.coach.clubId) {
            state.coach.points += 20;
            state.coach.titles.push({ name: state.world.countries[cid].cupName, year: state.season.year });
            addNews("CAMPEÃO DA " + state.world.countries[cid].cupName.toUpperCase() + "!",
              "Título conquistado! A torcida está em festa e sua reputação subiu.", "title");
            userClub().moralTorcida = 95;
            state.coach.reputation = U.clamp(state.coach.reputation + 8, 0, 100);
          } else if (wasFinal) {
            addNews(state.world.countries[cid].cupName, champ.name + " é o campeão da copa.", "info");
          }
        }
      }
      afterUserCupMatch(userPlayed);
    }
    state.season.slotIndex++;
    state.lastRoundResults = results;
    weeklyTick();
    return results;
  }

  function resolveFixture(homeId, awayId, provided, kind) {
    if (provided && provided[homeId + "|" + awayId]) return provided[homeId + "|" + awayId];
    const hc = state.world.clubs[homeId], ac = state.world.clubs[awayId];
    resetMatchFlags(hc); resetMatchFlags(ac);
    return M().simulate(aiTeam(hc), aiTeam(ac), { grass: hc.grass });
  }

  // ---------- janela de transferências ----------
  /* Aberta no início da temporada (até a rodada 6) e no meio (rodadas 19 a 24),
     como o período de negócios do Brasfoot. Jogadores livres podem ser contratados sempre. */
  function transferWindowInfo() {
    const club = userClub();
    const league = state.season.leagues[club.countryId][club.division];
    const r = league.currentRound;
    if (r < 6) return { open: true, message: "Janela de transferências ABERTA (fecha após a rodada 6)." };
    if (r >= 19 && r < 25) return { open: true, message: "Janela do meio da temporada ABERTA (fecha após a rodada 25)." };
    if (r < 19) return { open: false, message: "Janela FECHADA. Reabre na rodada 20 (meio da temporada)." };
    return { open: false, message: "Janela FECHADA. Reabre no início da próxima temporada." };
  }

  function afterUserLeagueMatch(userPlayed) {
    const club = userClub();
    // salários após rodada de liga (como no Brasfoot)
    const wages = F().squadWages(club);
    club.money -= wages;
    if (userPlayed) {
      const { fixture, result } = userPlayed;
      const isHome = fixture.home === club.id;
      if (isHome) {
        const opp = state.world.clubs[fixture.away];
        const { crowd, income } = F().homeMatchIncome(club, opp, "league");
        club.money += income;
        addNews("Renda do jogo", "Público: " + crowd.toLocaleString("pt-BR") + " pagantes. Renda: " + U.formatMoney(income) + ". Salários pagos: " + U.formatMoney(wages) + ".", "finance");
      } else {
        addNews("Salários pagos", U.formatMoney(wages) + " descontados após a rodada.", "finance");
      }
      updateFanMoraleAndCoach(result, fixture);
    }
    if (club.money < 0) addNews("Atenção às finanças!", "O caixa do clube está negativo. Considere vender jogadores.", "warning");
  }

  function afterUserCupMatch(userPlayed) {
    if (!userPlayed) return;
    const club = userClub();
    const { fixture, result } = userPlayed;
    if (fixture.home === club.id) {
      const opp = state.world.clubs[fixture.away];
      const { crowd, income } = F().homeMatchIncome(club, opp, "cup");
      club.money += income;
      addNews("Renda do jogo de copa", "Público: " + crowd.toLocaleString("pt-BR") + ". Renda (dividida): " + U.formatMoney(income) + ".", "finance");
    }
    updateFanMoraleAndCoach(result, fixture);
  }

  function updateFanMoraleAndCoach(result, fixture) {
    const club = userClub();
    const isHome = fixture.home === club.id;
    const gf = isHome ? result.gh : result.ga;
    const ga = isHome ? result.ga : result.gh;
    if (gf > ga) {
      club.moralTorcida = U.clamp(club.moralTorcida + 5, 5, 100);
      state.coach.points += isHome ? 2 : 3;
      state.coach.reputation = U.clamp(state.coach.reputation + 0.6, 0, 100);
    } else if (gf < ga) {
      club.moralTorcida = U.clamp(club.moralTorcida - 6, 5, 100);
      state.coach.reputation = U.clamp(state.coach.reputation - 0.7, 0, 100);
    } else {
      club.moralTorcida = U.clamp(club.moralTorcida + (isHome ? -2 : 1), 5, 100);
      state.coach.points += 1;
    }
  }

  // ---------- semana ----------
  function weeklyTick() {
    state.week++;
    const club = userClub();
    for (const c of Object.values(state.world.clubs)) {
      for (const p of c.players) {
        if (p.injuryWeeks > 0) p.injuryWeeks--;
        if (p.suspended > 0 && c.id !== club.id) p.suspended = Math.max(0, p.suspended - 1);
        // recuperação semanal: jovens recuperam mais rápido que veteranos
        const recovery = 40 + (p.age <= 25 ? 10 : p.age >= 32 ? -5 : 0);
        p.energy = Math.round(Math.min(100, p.energy + recovery));
        p.moral = Math.round(p.moral);
        p.form = Math.round((p.form || 0) * 10) / 10;
        p.seasonStats.ratingSum = Math.round(p.seasonStats.ratingSum * 10) / 10;
        p.joinedRecently = false;
      }
      const doneSeats = F().tickStadiumWorks(c);
      if (doneSeats && c.id === club.id) addNews("Obras concluídas!", "O estádio ganhou " + doneSeats.toLocaleString("pt-BR") + " novos lugares. Capacidade: " + c.capacity.toLocaleString("pt-BR") + ".", "board");
    }
    // suspensão do usuário cai quando o time joga — simplificação: cai por semana também
    for (const p of club.players) if (p.suspended > 0) p.suspended--;

    applyTraining(club);

    // moral individual: quem não joga fica insatisfeito
    for (const p of club.players) {
      if (p.seasonStats.games === 0 && state.week > 6) p.moral = U.clamp(p.moral - 1.5, 5, 100);
      if (p.contractYears <= 0) p.moral = U.clamp(p.moral - 3, 5, 100);
    }

    // propostas da IA (apenas com a janela de transferências aberta)
    const offers = transferWindowInfo().open ? T().aiOffersForUser(state.world, club, U.RNG.next.bind(U.RNG)) : [];
    for (const o of offers) {
      state.aiOffers.push(o);
      const p = club.players.find(x => x.id === o.playerId);
      const buyer = state.world.clubs[o.clubId];
      if (p && buyer) addNews("Proposta por " + p.name, buyer.name + " ofereceu " + U.formatMoney(o.value) + ". Responda na tela de Transferências.", "transfer");
    }
    if (state.aiOffers.length > 12) state.aiOffers.splice(0, state.aiOffers.length - 12);

    // avisos de contrato
    for (const p of club.players) {
      if (p.contractYears === 0 && !p.warnedContract) {
        p.warnedContract = true;
        addNews("Contrato expirado", p.name + " está sem contrato e não pode ser escalado. Renove ou libere o jogador.", "warning");
      }
    }
  }

  function applyTraining(club) {
    const focus = state.training;
    for (const p of club.players) {
      if (p.age >= 33) continue;
      const headroom = (p.potential - p.rating) / 40;
      if (headroom <= 0) continue;
      const gain = Math.max(0, headroom * (0.10 + U.RNG.next() * 0.08));
      const target = focus === "auto" ? (U.RNG.chance(0.5) ? "principais" : "secundarias") : focus;
      const mains = ["gk", "tackle", "playmaking", "finishing"];
      const secs = ["speed", "technique", "pass"];
      const keys = target === "principais" ? mains : secs;
      for (const k of keys) {
        if (k === "gk" && p.pos !== "GOL") continue;
        p.skills[k] = Math.round(U.clamp(p.skills[k] + gain * (0.5 + U.RNG.next()), 1, 100) * 100) / 100;
      }
      recomputeRating(p);
    }
  }

  function recomputeRating(p) {
    const s = p.skills;
    let r;
    if (p.pos === "GOL") r = s.gk * 0.7 + s.speed * 0.1 + s.technique * 0.1 + s.pass * 0.1;
    else if (["ZAG"].includes(p.pos)) r = s.tackle * 0.5 + s.speed * 0.15 + s.technique * 0.1 + s.pass * 0.1 + s.playmaking * 0.05 + s.finishing * 0.1;
    else if (["LD", "LE"].includes(p.pos)) r = s.tackle * 0.3 + s.speed * 0.25 + s.technique * 0.15 + s.pass * 0.2 + s.playmaking * 0.1;
    else if (["VOL"].includes(p.pos)) r = s.tackle * 0.4 + s.pass * 0.2 + s.playmaking * 0.15 + s.speed * 0.1 + s.technique * 0.15;
    else if (["MC", "MEI"].includes(p.pos)) r = s.playmaking * 0.3 + s.pass * 0.25 + s.technique * 0.2 + s.speed * 0.1 + s.finishing * 0.1 + s.tackle * 0.05;
    else r = s.finishing * 0.4 + s.speed * 0.25 + s.technique * 0.2 + s.playmaking * 0.1 + s.pass * 0.05;
    p.rating = U.clamp(Math.round(r), 1, 99);
    p.value = window.TF.world.valueFor(p.rating, p.age);
  }

  // ---------- fim de temporada ----------
  function endOfSeason() {
    const world = state.world;
    const report = { year: state.season.year, awards: {}, promoted: {}, relegated: {}, userSummary: [] };

    for (const cid of Object.keys(world.countries)) {
      const country = world.countries[cid];
      const leagueA = state.season.leagues[cid].A;
      const leagueB = state.season.leagues[cid].B;
      const sortedA = C().sortTable(leagueA.table);
      const sortedB = C().sortTable(leagueB.table);

      // campeão nacional
      const champ = world.clubs[sortedA[0].clubId];
      champ.titles.push({ name: country.leagueNameA, year: state.season.year });
      if (champ.id === state.coach.clubId) {
        state.coach.points += 25;
        state.coach.titles.push({ name: country.leagueNameA, year: state.season.year });
        state.coach.reputation = U.clamp(state.coach.reputation + 10, 0, 100);
        addNews("CAMPEÃO NACIONAL!", "O " + champ.name + " conquistou a " + country.leagueNameA + " de " + state.season.year + "!", "title");
      }
      // pontos de ranking do técnico por colocação (se for o clube do usuário)
      const userPosA = sortedA.findIndex(r => r.clubId === state.coach.clubId);
      if (userPosA >= 1 && userPosA <= 9) state.coach.points += 10 - userPosA;

      // Bola de Ouro e artilheiro (liga A do país)
      const clubsA = country.clubIdsA.map(id => world.clubs[id]);
      let golden = null, topScorer = null;
      for (const c of clubsA) for (const p of c.players) {
        const st = p.seasonStats;
        if (st.games >= 16) {
          const avg = st.ratingSum / st.games;
          if (!golden || avg > golden.avg) golden = { player: p, club: c, avg };
        }
        if (!topScorer || st.goals > topScorer.goals) topScorer = { player: p, club: c, goals: st.goals };
      }
      report.awards[cid] = { golden, topScorer };
      if (golden && golden.player) {
        if (golden.club.id === state.coach.clubId) addNews("Bola de Ouro!", golden.player.name + " foi eleito o melhor jogador da temporada (nota média " + golden.avg.toFixed(2) + ").", "title");
      }

      // acesso e rebaixamento
      const n = country.relegated;
      const down = sortedA.slice(-n).map(r => r.clubId);
      const up = sortedB.slice(0, n).map(r => r.clubId);
      for (const id of down) { world.clubs[id].division = "B"; }
      for (const id of up) { world.clubs[id].division = "A"; }
      country.clubIdsA = country.clubIdsA.filter(id => !down.includes(id)).concat(up);
      country.clubIdsB = country.clubIdsB.filter(id => !up.includes(id)).concat(down);
      report.promoted[cid] = up; report.relegated[cid] = down;
      if (down.includes(state.coach.clubId)) {
        addNews("Rebaixamento", "O " + userClub().name + " foi rebaixado para a " + country.leagueNameB + ".", "warning");
        userClub().moralTorcida = 25;
        state.coach.reputation = U.clamp(state.coach.reputation - 12, 0, 100);
      }
      if (up.includes(state.coach.clubId)) {
        addNews("ACESSO!", "O " + userClub().name + " subiu para a " + country.leagueNameA + "!", "title");
        userClub().moralTorcida = 90;
        state.coach.points += 5;
        state.coach.reputation = U.clamp(state.coach.reputation + 6, 0, 100);
      }
    }

    // evolução, envelhecimento, contratos e aposentadorias
    for (const club of Object.values(world.clubs)) {
      const isUser = club.id === state.coach.clubId;
      for (let i = club.players.length - 1; i >= 0; i--) {
        const p = club.players[i];
        p.age++;
        // envelhecimento das habilidades
        if (p.age >= 32) {
          const decline = (p.age - 31) * 0.9;
          for (const k of Object.keys(p.skills)) p.skills[k] = Math.round(Math.max(1, p.skills[k] - decline * (0.6 + U.RNG.next() * 0.7)) * 100) / 100;
          recomputeRating(p);
        }
        p.contractYears = Math.max(0, p.contractYears - 1);
        if (!isUser) {
          // IA renova automaticamente a maioria
          if (p.contractYears === 0 && U.RNG.chance(0.85)) p.contractYears = 1 + Math.floor(U.RNG.next() * 2);
          // aposentadoria da IA
          if (p.age >= 34 && (p.rating < 68 || U.RNG.chance(0.4))) {
            club.players.splice(i, 1);
            delete world.players[p.id];
            const youth = window.TF.world.generatePlayer(p.pos, club.countryId, club.rating - 4, U.RNG.next.bind(U.RNG));
            youth.age = 17 + Math.floor(U.RNG.next() * 3);
            youth.clubId = club.id;
            club.players.push(youth);
            world.players[youth.id] = youth;
          }
        }
        p.seasonStats = { games: 0, goals: 0, assists: 0, ratingSum: 0, cards: 0 };
        p.yellow = 0; p.suspended = 0; p.injuryWeeks = 0; p.energy = 100;
        p.warnedContract = false;
      }
      // patrocínio da nova temporada
      club.money += F().seasonSponsorship(club);
      club.ticketPrice = F().suggestedTicketPrice(club);
    }

    // nova temporada
    world.season++;
    state.season = C().buildSeasonCalendar(world, U.RNG.next.bind(U.RNG));
    state.coach.history.push({ year: report.year, club: userClub().name });
    addNews("Nova temporada: " + world.season, "Patrocínio creditado. Boa sorte!", "board");
    autoLineup();
    return report;
  }

  // ---------- save / load ----------
  function save(slot) {
    const data = {
      v: 1,
      world: { ...state.world, players: undefined },
      season: state.season, coach: state.coach, tactics: state.tactics,
      userSquad: state.userSquad, training: state.training, news: state.news,
      aiOffers: state.aiOffers, week: state.week, setPieces: state.setPieces
    };
    try {
      localStorage.setItem(SAVE_KEY + (slot || 1), JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "Não foi possível salvar: " + e.message };
    }
  }

  function load(slot) {
    const raw = localStorage.getItem(SAVE_KEY + (slot || 1));
    if (!raw) return { ok: false, reason: "Nenhum jogo salvo." };
    const data = JSON.parse(raw);
    state.world = data.world;
    state.world.players = {};
    for (const club of Object.values(state.world.clubs)) {
      for (const p of club.players) {
        state.world.players[p.id] = p;
        // migração de saves antigos: pé preferido
        if (!p.foot) p.foot = p.side === "E" ? "E" : "D";
      }
    }
    state.season = data.season; state.coach = data.coach; state.tactics = data.tactics;
    state.userSquad = data.userSquad; state.training = data.training; state.news = data.news || [];
    state.aiOffers = data.aiOffers || []; state.week = data.week || 1;
    state.setPieces = data.setPieces || null;
    state.pendingLiveRound = null;
    state.started = true;
    if (!state.setPieces) autoAssignSetPieces();
    return { ok: true };
  }

  function hasSave(slot) { return !!localStorage.getItem(SAVE_KEY + (slot || 1)); }

  window.TF.game = {
    state, newCareer, userClub, userTeam, aiTeam, autoLineup, autoAssignSetPieces, nextSlot, completeLiveRound,
    processSlot, endOfSeason, save, load, hasSave, addNews, recomputeRating, transferWindowInfo
  };
})();
