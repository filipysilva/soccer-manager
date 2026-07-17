"use strict";
/* Jogo multiplayer de uma sala: o mesmo motor do modo carreira, mas com vários
   técnicos humanos no mesmo mundo. Roda no servidor (Node) e é isolado por sala. */
(function () {
  const U = () => window.TF.util;
  const C = () => window.TF.competitions;
  const M = () => window.TF.match;
  const F = () => window.TF.finance;
  const T = () => window.TF.transfers;

  function createRoomGame(countryId) {
    const world = window.TF.world.buildWorld();
    for (const club of Object.values(world.clubs)) {
      club.money = F().initialMoney(club) + F().seasonSponsorship(club);
      club.ticketPrice = F().suggestedTicketPrice(club);
    }
    const rg = {
      world,
      countryId,
      season: C().buildSeasonCalendar(world, U().RNG.next.bind(U().RNG)),
      week: 1,
      humans: {},          // playerId -> humano
      lastResults: null,
      pendingSlot: null
    };

    function clubOf(h) { return world.clubs[h.clubId]; }
    function humanByClub(clubId) {
      return Object.values(rg.humans).find(h => h.clubId === clubId) || null;
    }

    function addNews(h, title, text, type) {
      h.news.unshift({ week: rg.week, season: rg.season.year, title, text, type: type || "info" });
      if (h.news.length > 60) h.news.length = 60;
    }

    function addHuman(playerId, name, clubId) {
      const club = world.clubs[clubId];
      if (!club || club.countryId !== countryId) return { ok: false, reason: "Clube inválido." };
      if (humanByClub(clubId)) return { ok: false, reason: "Clube já escolhido por outro técnico." };
      const h = {
        id: playerId, name, clubId,
        tactics: window.TF.tactics.defaultTactics(window.TF.tactics.bestFormation(club)),
        squad: null, training: "auto", setPieces: null,
        news: [], offers: [], humanOffers: [], // humanOffers: propostas de outros técnicos pelos meus jogadores
        matchLog: [] // §26 histórico dos jogos deste técnico na temporada
      };
      rg.humans[playerId] = h;
      autoLineupFor(h);
      addNews(h, "Bem-vindo ao " + club.name + "!", "A sala começou. Boa sorte na temporada " + rg.season.year + ".", "board");
      return { ok: true };
    }

    function removeHuman(playerId) { delete rg.humans[playerId]; }

    function autoLineupFor(h) {
      const picked = M().pickLineup(clubOf(h), h.tactics.formationName);
      h.squad = {
        starters: picked.lineup.map(s => s.player ? s.player.id : null),
        bench: picked.bench.map(p => p.id)
      };
      autoAssignSetPiecesFor(h);
    }

    /* Capitão e cobradores automáticos (mantém escolha do técnico se ainda válida). */
    function autoAssignSetPiecesFor(h) {
      const club = clubOf(h);
      const byId = {};
      for (const p of club.players) byId[p.id] = p;
      const starters = h.squad.starters.map(id => byId[id]).filter(Boolean);
      if (!starters.length) return;
      const sp = h.setPieces || {};
      const keep = id => id && byId[id] ? id : null;
      const bestBy = fn => starters.filter(p => p.pos !== "GOL").sort((a, b) => fn(b) - fn(a))[0];
      const cross = p => p.skills.pass + p.skills.technique * 0.5 + (p.traits.includes("Cruzamento") ? 25 : 0);
      h.setPieces = {
        captain: keep(sp.captain) || (starters.slice().sort((a, b) => (b.rating + b.age) - (a.rating + a.age))[0] || {}).id || null,
        freeKick: keep(sp.freeKick) || (bestBy(p => p.skills.technique + p.skills.finishing) || {}).id || null,
        cornerLeft: keep(sp.cornerLeft) || (bestBy(p => cross(p) + (p.foot === "E" ? 18 : 0)) || {}).id || null,
        cornerRight: keep(sp.cornerRight) || (bestBy(p => cross(p) + (p.foot === "D" ? 18 : 0)) || {}).id || null
      };
    }

    /* Time de um clube humano a partir da escalação salva (mesma lógica do modo carreira). */
    function humanTeam(h) {
      const club = clubOf(h);
      const formation = M().FORMATIONS[h.tactics.formationName] || M().FORMATIONS["4-4-2"];
      const byId = {};
      for (const p of club.players) byId[p.id] = p;
      const lineup = formation.map((pos, i) => {
        const pid = h.squad.starters[i];
        const p = pid ? byId[pid] : null;
        return { slotPos: pos, player: p && !p.injuryWeeks && !p.suspended && p.contractYears > 0 ? p : null };
      });
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
      const bench = h.squad.bench.map(id => byId[id])
        .filter(p => p && !used.has(p.id) && !p.injuryWeeks && !p.suspended && p.contractYears > 0);
      const sp = h.setPieces || {};
      return {
        club, lineup, bench,
        tactics: window.TF.tactics.normalize(h.tactics),
        formationName: h.tactics.formationName,
        captainId: sp.captain || null,
        setPieces: { freeKick: sp.freeKick || null, cornerLeft: sp.cornerLeft || null, cornerRight: sp.cornerRight || null },
        subsUsed: 0
      };
    }

    function aiTeam(club) {
      const tactics = window.TF.tactics.aiTactics(club);
      const picked = M().pickLineup(club, tactics.formationName);
      return { club, lineup: picked.lineup, bench: picked.bench.slice(), tactics, ai: true, subsUsed: 0 };
    }

    function teamForClub(clubId) {
      const h = humanByClub(clubId);
      const club = world.clubs[clubId];
      resetMatchFlags(club);
      return h ? humanTeam(h) : aiTeam(club);
    }

    function resetMatchFlags(club) {
      for (const p of club.players) { p.matchGoals = 0; p.matchYellow = 0; p.matchPlayed = false; }
    }

    // ---------- rodada ----------
    function slotPreview() {
      const slot = rg.season.slots[rg.season.slotIndex];
      if (!slot) return { type: "seasonOver", label: "Temporada encerrada" };
      if (slot.type === "endOfSeason") return { type: "endOfSeason", label: "Fim da temporada " + rg.season.year };
      if (slot.type === "league") {
        return { type: "league", label: "Rodada " + (slot.round + 1) + " — " + world.countries[countryId].leagueNameA + " / " + world.countries[countryId].leagueNameB };
      }
      const cup = rg.season.cups[countryId];
      return { type: "cup", label: world.countries[countryId].cupName + " — " + (cup.championId ? "encerrada" : cup.phaseName) };
    }

    /* Inicia o próximo slot. Retorna jogos ao vivo (divisões com humanos + copa com humanos)
       ou processa instantaneamente se ninguém da sala joga. */
    function startRound() {
      const slot = rg.season.slots[rg.season.slotIndex];
      if (!slot) return { done: true };
      if (slot.type === "endOfSeason") {
        const report = endOfSeason();
        return { seasonEnd: true, report };
      }
      const humanClubs = new Set(Object.values(rg.humans).map(h => h.clubId));
      let pairs = [];
      let label = slotPreview().label;
      if (slot.type === "league") {
        for (const div of ["A", "B"]) {
          const hasHuman = (div === "A" ? world.countries[countryId].clubIdsA : world.countries[countryId].clubIdsB)
            .some(id => humanClubs.has(id));
          if (!hasHuman) continue;
          const round = rg.season.leagues[countryId][div].rounds[slot.round];
          if (round) pairs = pairs.concat(round);
        }
      } else {
        const cup = rg.season.cups[countryId];
        if (!cup.championId && cup.phase === slot.phase) {
          const involved = cup.ties.some(t => humanClubs.has(t.home) || humanClubs.has(t.away));
          if (involved) pairs = cup.ties.map(t => [t.home, t.away]);
        }
      }
      if (!pairs.length) {
        processSlot(slot, null);
        return { instant: true, results: rg.lastResults };
      }
      rg.pendingSlot = slot;
      const matches = pairs.map(([hId, aId]) => {
        const home = teamForClub(hId);
        const away = teamForClub(aId);
        const hh = humanByClub(hId), ha = humanByClub(aId);
        return {
          fixture: { home: hId, away: aId },
          home, away,
          humanH: hh ? hh.id : null,
          humanA: ha ? ha.id : null,
          grass: world.clubs[hId].grass,
          knockout: slot.type === "cup" // §28 empate → disputa de pênaltis ao vivo
        };
      });
      return { live: true, matches, label };
    }

    function completeRound(results) {
      const slot = rg.pendingSlot;
      rg.pendingSlot = null;
      const provided = {};
      for (const r of results) provided[r.fixture.home + "|" + r.fixture.away] = r.result;
      processSlot(slot, provided);
    }

    function resolveFixture(homeId, awayId, provided) {
      if (provided && provided[homeId + "|" + awayId]) return provided[homeId + "|" + awayId];
      const hc = world.clubs[homeId], ac = world.clubs[awayId];
      resetMatchFlags(hc); resetMatchFlags(ac);
      return M().simulate(aiTeam(hc), aiTeam(ac), { grass: hc.grass });
    }

    function processSlot(slot, provided) {
      const results = [];
      if (slot.type === "league") {
        for (const cid of Object.keys(rg.season.leagues)) {
          for (const div of ["A", "B"]) {
            const league = rg.season.leagues[cid][div];
            const round = league.rounds[slot.round];
            if (!round) continue;
            for (const [h, a] of round) {
              const res = resolveFixture(h, a, provided);
              C().applyResult(league.table, h, a, res.gh, res.ga);
              if (cid === countryId) results.push({ competition: div === "A" ? "Série A" : "Série B", home: h, away: a, gh: res.gh, ga: res.ga });
              const hh = humanByClub(h), ha = humanByClub(a); // §26 registra o jogo de cada técnico
              const entry = { kind: "league", comp: league.name, round: slot.round + 1, home: h, away: a, gh: res.gh, ga: res.ga };
              if (hh) hh.matchLog.push(entry);
              if (ha) ha.matchLog.push({ ...entry });
            }
            league.currentRound = slot.round + 1;
          }
        }
        for (const h of Object.values(rg.humans)) afterLeagueMatch(h, provided);
      } else if (slot.type === "cup") {
        for (const cid of Object.keys(rg.season.cups)) {
          const cup = rg.season.cups[cid];
          if (cup.championId || cup.phase !== slot.phase) continue;
          for (const tie of cup.ties) {
            const res = resolveFixture(tie.home, tie.away, provided);
            let winner, shootout = null;
            if (res.gh > res.ga) winner = tie.home;
            else if (res.ga > res.gh) winner = tie.away;
            else { // §28 empate no mata-mata → disputa de pênaltis (por qualidade, não moeda)
              // usa a disputa já apresentada ao vivo (res.shootout); senão calcula
              shootout = res.shootout || M().penaltyShootout(teamForClub(tie.home), teamForClub(tie.away), U().RNG.next.bind(U().RNG));
              winner = shootout ? (shootout.winnerSide === "h" ? tie.home : tie.away) : (U().RNG.chance(0.5) ? tie.home : tie.away);
            }
            tie.gh = res.gh; tie.ga = res.ga; tie.winner = winner;
            tie.penalties = res.gh === res.ga;
            if (shootout) tie.shootout = { scoreH: shootout.scoreH, scoreA: shootout.scoreA, winnerSide: shootout.winnerSide };
            cup.results.push({ ...tie });
            cup.winners.push(winner);
            if (cid === countryId) results.push({ competition: "Copa", home: tie.home, away: tie.away, gh: res.gh, ga: res.ga, winner, shootout: tie.shootout || null });
            { // §26 registra o confronto de copa de cada técnico (phaseName ainda é a fase atual)
              const hh = humanByClub(tie.home), ha = humanByClub(tie.away);
              const entry = { kind: "cup", comp: world.countries[cid].cupName, round: cup.phaseName, home: tie.home, away: tie.away, gh: res.gh, ga: res.ga, winner, shootout: tie.shootout || null };
              if (hh) hh.matchLog.push(entry);
              if (ha) ha.matchLog.push({ ...entry });
            }
            // avisa o técnico humano quando a vaga saiu nos pênaltis
            if (tie.penalties) {
              for (const clubId of [tie.home, tie.away]) {
                const h = humanByClub(clubId);
                if (!h) continue;
                const meWon = winner === clubId;
                const ps = tie.shootout ? (clubId === tie.home ? tie.shootout.scoreH + " x " + tie.shootout.scoreA : tie.shootout.scoreA + " x " + tie.shootout.scoreH) : "";
                addNews(h, meWon ? "Classificado nos pênaltis!" : "Eliminado nos pênaltis", world.clubs[tie.home].name + " " + res.gh + " x " + res.ga + " " + world.clubs[tie.away].name + (ps ? " (pênaltis " + ps + ")" : "") + ".", meWon ? "title" : "match");
              }
            }
          }
          C().nextCupPhase(cup, U().RNG.next.bind(U().RNG));
          if (cup.championId) {
            const champ = world.clubs[cup.championId];
            champ.titles.push({ name: world.countries[cid].cupName, year: rg.season.year });
            const h = humanByClub(cup.championId);
            if (h) {
              champ.moralTorcida = 95;
              addNews(h, "CAMPEÃO DA COPA!", "O " + champ.name + " conquistou a " + world.countries[cid].cupName + " de " + rg.season.year + "!", "title");
            }
          }
        }
        for (const h of Object.values(rg.humans)) afterCupMatch(h, provided);
      }
      rg.season.slotIndex++;
      rg.lastResults = results;
      weeklyTick();
      return results;
    }

    function findResultFor(h, provided) {
      if (!provided) return null;
      for (const key of Object.keys(provided)) {
        const [home, away] = key.split("|");
        if (home === h.clubId || away === h.clubId) {
          return { home, away, isHome: home === h.clubId, result: provided[key] };
        }
      }
      return null;
    }

    function afterLeagueMatch(h, provided) {
      const club = clubOf(h);
      const wages = F().squadWages(club);
      club.money -= wages;
      const mine = findResultFor(h, provided);
      if (mine) {
        if (mine.isHome) {
          const opp = world.clubs[mine.away];
          const { crowd, income } = F().homeMatchIncome(club, opp, "league");
          club.money += income;
          addNews(h, "Renda do jogo", "Público: " + crowd.toLocaleString("pt-BR") + ". Renda: " + U().formatMoney(income) + ". Salários: " + U().formatMoney(wages) + ".", "finance");
        } else {
          addNews(h, "Salários pagos", U().formatMoney(wages) + " descontados após a rodada.", "finance");
        }
        updateFanMorale(h, mine);
      }
      if (club.money < 0) addNews(h, "Caixa negativo!", "Considere vender jogadores ou segurar contratações.", "warning");
    }

    function afterCupMatch(h, provided) {
      const mine = findResultFor(h, provided);
      if (!mine) return;
      const club = clubOf(h);
      if (mine.isHome) {
        const opp = world.clubs[mine.away];
        const { crowd, income } = F().homeMatchIncome(club, opp, "cup");
        club.money += income;
        addNews(h, "Renda do jogo de copa", "Público: " + crowd.toLocaleString("pt-BR") + ". Renda (dividida): " + U().formatMoney(income) + ".", "finance");
      }
      updateFanMorale(h, mine);
    }

    function updateFanMorale(h, mine) {
      const club = clubOf(h);
      const gf = mine.isHome ? mine.result.gh : mine.result.ga;
      const ga = mine.isHome ? mine.result.ga : mine.result.gh;
      if (gf > ga) club.moralTorcida = U().clamp(club.moralTorcida + 5, 5, 100);
      else if (gf < ga) club.moralTorcida = U().clamp(club.moralTorcida - 6, 5, 100);
      else club.moralTorcida = U().clamp(club.moralTorcida + (mine.isHome ? -2 : 1), 5, 100);
    }

    // ---------- semana ----------
    function weeklyTick() {
      rg.week++;
      const humanClubIds = new Set(Object.values(rg.humans).map(h => h.clubId));
      for (const c of Object.values(world.clubs)) {
        for (const p of c.players) {
          if (p.injuryWeeks > 0) p.injuryWeeks--;
          if (p.suspended > 0) p.suspended--;
          const recovery = 40 + (p.age <= 25 ? 10 : p.age >= 32 ? -5 : 0);
          p.energy = Math.round(Math.min(100, p.energy + recovery));
          p.moral = Math.round(p.moral);
          p.joinedRecently = false;
        }
        const doneSeats = F().tickStadiumWorks(c);
        if (doneSeats && humanClubIds.has(c.id)) {
          const h = humanByClub(c.id);
          addNews(h, "Obras concluídas!", "+" + doneSeats.toLocaleString("pt-BR") + " lugares. Capacidade: " + c.capacity.toLocaleString("pt-BR") + ".", "board");
        }
      }
      for (const h of Object.values(rg.humans)) {
        applyTraining(h);
        resolveBidsFor(h); // respostas das propostas aos clubes da IA
        for (const p of clubOf(h).players) {
          if (p.contractYears === 0 && !p.warnedContract) {
            p.warnedContract = true;
            addNews(h, "Contrato expirado", p.name + " está sem contrato e não pode ser escalado.", "warning");
          }
        }
        if (transferWindowInfo().open) {
          const offers = T().aiOffersForUser(world, clubOf(h), U().RNG.next.bind(U().RNG));
          for (const o of offers) {
            h.offers.push(o);
            const p = clubOf(h).players.find(x => x.id === o.playerId);
            const buyer = world.clubs[o.clubId];
            if (p && buyer) addNews(h, "Proposta por " + p.name, buyer.name + " ofereceu " + U().formatMoney(o.value) + ".", "transfer");
          }
          if (h.offers.length > 10) h.offers.splice(0, h.offers.length - 10);
        }
      }
    }

    function applyTraining(h) {
      const club = clubOf(h);
      for (const p of club.players) {
        if (p.age >= 33) continue;
        const headroom = (p.potential - p.rating) / 40;
        if (headroom <= 0) continue;
        const gain = Math.max(0, headroom * (0.10 + U().RNG.next() * 0.08));
        const target = h.training === "auto" ? (U().RNG.chance(0.5) ? "principais" : "secundarias") : h.training;
        const keys = target === "principais" ? ["gk", "tackle", "playmaking", "finishing"] : ["speed", "technique", "pass"];
        for (const k of keys) {
          if (k === "gk" && p.pos !== "GOL") continue;
          p.skills[k] = Math.round(U().clamp(p.skills[k] + gain * (0.5 + U().RNG.next()), 1, 100) * 100) / 100;
        }
        recomputeRating(p);
      }
    }

    function recomputeRating(p) {
      const s = p.skills;
      let r;
      if (p.pos === "GOL") r = s.gk * 0.7 + s.speed * 0.1 + s.technique * 0.1 + s.pass * 0.1;
      else if (p.pos === "ZAG") r = s.tackle * 0.5 + s.speed * 0.15 + s.technique * 0.1 + s.pass * 0.1 + s.playmaking * 0.05 + s.finishing * 0.1;
      else if (p.pos === "LD" || p.pos === "LE") r = s.tackle * 0.3 + s.speed * 0.25 + s.technique * 0.15 + s.pass * 0.2 + s.playmaking * 0.1;
      else if (p.pos === "VOL") r = s.tackle * 0.4 + s.pass * 0.2 + s.playmaking * 0.15 + s.speed * 0.1 + s.technique * 0.15;
      else if (p.pos === "MC" || p.pos === "MEI") r = s.playmaking * 0.3 + s.pass * 0.25 + s.technique * 0.2 + s.speed * 0.1 + s.finishing * 0.1 + s.tackle * 0.05;
      else r = s.finishing * 0.4 + s.speed * 0.25 + s.technique * 0.2 + s.playmaking * 0.1 + s.pass * 0.05;
      p.rating = U().clamp(Math.round(r), 1, 99);
      p.value = window.TF.world.computeValue(p);
      p.star = window.TF.world.isStar(p.rating);
    }

    // ---------- janela de transferências ----------
    function transferWindowInfo() {
      const r = rg.season.leagues[countryId].A.currentRound;
      if (r < 6) return { open: true, message: "Janela ABERTA (fecha após a rodada 6)." };
      if (r >= 19 && r < 25) return { open: true, message: "Janela do meio da temporada ABERTA (fecha após a rodada 25)." };
      if (r < 19) return { open: false, message: "Janela FECHADA. Reabre na rodada 20." };
      return { open: false, message: "Janela FECHADA. Reabre na próxima temporada." };
    }

    /* Proposta de um humano por um jogador. Se o dono for humano, fica pendente
       para o outro técnico decidir; se for a IA, resolve na hora. */
    function makeOfferFrom(playerId, targetPlayerId, value, wage, years) {
      const h = rg.humans[playerId];
      if (!h) return { ok: false, reason: "Técnico inválido." };
      const target = world.players[targetPlayerId];
      if (!target) return { ok: false, reason: "Jogador não encontrado." };
      if (target.contractYears > 0 && !transferWindowInfo().open) {
        return { ok: false, reason: transferWindowInfo().message };
      }
      const buyer = clubOf(h);
      if (buyer.money < value) return { ok: false, reason: "Caixa insuficiente." };
      const ownerHuman = humanByClub(target.clubId);
      // clubes de IA não vendem craques retidos (paridade com o offline)
      if (!ownerHuman && !window.TF.transfers.isSellable(target, world.clubs[target.clubId], rg.season.year)) {
        return { ok: false, reason: (world.clubs[target.clubId].name || "O clube") + " não pretende vender " + target.name + "." };
      }
      if (ownerHuman && ownerHuman.id !== playerId) {
        // outro técnico decide (a qualquer momento)
        ownerHuman.humanOffers.push({ fromPlayerId: playerId, fromName: h.name, fromClubId: h.clubId, playerId: targetPlayerId, value, wage, years });
        if (ownerHuman.humanOffers.length > 10) ownerHuman.humanOffers.shift();
        addNews(ownerHuman, "Proposta de " + h.name, buyer.name + " ofereceu " + U().formatMoney(value) + " por " + target.name + ". Decida em Transferências.", "transfer");
        return { ok: true, pending: true, reason: "Proposta enviada. O técnico do " + world.clubs[target.clubId].name + " vai decidir." };
      }
      // clube da IA: a resposta vem na próxima rodada
      h.sentBids = (h.sentBids || []).filter(b => b.targetId !== targetPlayerId);
      h.sentBids.push({ targetId: targetPlayerId, ownerClubId: target.clubId, value: value | 0, wage: wage | 0, years: years === 1 ? 1 : 2, name: target.name });
      addNews(h, "Proposta enviada", buyer.name + " ofereceu " + U().formatMoney(value) + " por " + target.name + ". O clube responde na próxima rodada.", "transfer");
      return { ok: true, pending: true, reason: "Proposta enviada. O clube responde na próxima rodada." };
    }

    /* Resolve as propostas de um técnico aos clubes da IA (chamado no weeklyTick). */
    function resolveBidsFor(h) {
      if (!h.sentBids || !h.sentBids.length) return;
      const club = clubOf(h);
      const bids = h.sentBids;
      h.sentBids = [];
      for (const b of bids) {
        const player = world.players[b.targetId];
        if (!player) { addNews(h, "Negócio caiu", b.name + " não está mais disponível.", "transfer"); continue; }
        if (player.clubId !== b.ownerClubId && player.contractYears > 0) { addNews(h, "Negócio caiu", b.name + " foi negociado por outro clube.", "transfer"); continue; }
        if (player.clubId === club.id) continue;
        if (humanByClub(player.clubId)) { addNews(h, "Negócio caiu", b.name + " agora é de um clube com técnico.", "transfer"); continue; }
        if (player.contractYears > 0 && !transferWindowInfo().open) { addNews(h, "Janela fechada", "A proposta por " + b.name + " expirou.", "transfer"); continue; }
        if (club.money < b.value) { addNews(h, "Negócio caiu", "Caixa insuficiente para " + b.name + ".", "warning"); continue; }
        const ev = T().evaluateOffer(world, club, player, b.value, b.wage);
        if (ev.accept) {
          T().transferPlayer(world, player, club, b.value, b.wage, b.years);
          autoLineupFor(h);
          addNews(h, "Contratação!", player.name + " acertou com o " + club.name + " por " + U().formatMoney(b.value) + ".", "transfer");
        } else {
          addNews(h, "Proposta recusada", ev.reason || (b.name + " recusou."), "transfer");
        }
      }
    }

    function respondHumanOffer(playerId, index, accept) {
      const h = rg.humans[playerId];
      if (!h || !h.humanOffers[index]) return { ok: false, reason: "Proposta não encontrada." };
      const offer = h.humanOffers.splice(index, 1)[0];
      const buyerHuman = rg.humans[offer.fromPlayerId];
      const target = world.players[offer.playerId];
      if (!accept || !buyerHuman || !target || target.clubId !== h.clubId) {
        if (buyerHuman) addNews(buyerHuman, "Proposta recusada", h.name + " recusou sua proposta por " + (target ? target.name : "jogador") + ".", "transfer");
        return { ok: true, accepted: false };
      }
      const buyerClub = clubOf(buyerHuman);
      if (buyerClub.money < offer.value) {
        addNews(buyerHuman, "Negócio caiu", "Caixa insuficiente para concluir a compra de " + target.name + ".", "warning");
        return { ok: true, accepted: false };
      }
      T().transferPlayer(world, target, buyerClub, offer.value, offer.wage, offer.years);
      autoLineupFor(h);
      autoLineupFor(buyerHuman);
      addNews(buyerHuman, "Contratação!", target.name + " chega ao " + buyerClub.name + " por " + U().formatMoney(offer.value) + ".", "transfer");
      addNews(h, "Venda concluída", target.name + " vendido ao " + buyerClub.name + " por " + U().formatMoney(offer.value) + ".", "transfer");
      return { ok: true, accepted: true };
    }

    function respondAiOffer(playerId, index, accept) {
      const h = rg.humans[playerId];
      if (!h || !h.offers[index]) return { ok: false, reason: "Proposta não encontrada." };
      const offer = h.offers.splice(index, 1)[0];
      if (!accept) return { ok: true, accepted: false };
      const r = T().acceptAiOffer(world, clubOf(h), offer);
      if (r.ok) {
        autoLineupFor(h);
        addNews(h, "Venda concluída", "Venda por " + U().formatMoney(offer.value) + " efetivada.", "transfer");
      }
      return { ok: r.ok, accepted: r.ok };
    }

    // ---------- fim de temporada (adaptado do modo carreira) ----------
    function endOfSeason() {
      const report = { year: rg.season.year, awards: {}, promoted: {}, relegated: {} };
      for (const cid of Object.keys(world.countries)) {
        const country = world.countries[cid];
        const sortedA = C().sortTable(rg.season.leagues[cid].A.table);
        const sortedB = C().sortTable(rg.season.leagues[cid].B.table);
        const champ = world.clubs[sortedA[0].clubId];
        champ.titles.push({ name: country.leagueNameA, year: rg.season.year });
        const champHuman = humanByClub(champ.id);
        if (champHuman) addNews(champHuman, "CAMPEÃO NACIONAL!", "O " + champ.name + " conquistou a " + country.leagueNameA + "!", "title");

        const clubsA = country.clubIdsA.map(id => world.clubs[id]);
        let golden = null, topScorer = null;
        for (const c of clubsA) for (const p of c.players) {
          const st = p.seasonStats;
          if (st.games >= 16) {
            const avg = st.ratingSum / st.games;
            if (!golden || avg > golden.avg) golden = { name: p.name, club: c.name, avg };
          }
          if (!topScorer || st.goals > topScorer.goals) topScorer = { name: p.name, club: c.name, goals: st.goals };
        }
        report.awards[cid] = { golden, topScorer, champion: champ.name };

        const n = country.relegated;
        const down = sortedA.slice(-n).map(r => r.clubId);
        const up = sortedB.slice(0, n).map(r => r.clubId);
        for (const id of down) world.clubs[id].division = "B";
        for (const id of up) world.clubs[id].division = "A";
        country.clubIdsA = country.clubIdsA.filter(id => !down.includes(id)).concat(up);
        country.clubIdsB = country.clubIdsB.filter(id => !up.includes(id)).concat(down);
        report.promoted[cid] = up.map(id => world.clubs[id].name);
        report.relegated[cid] = down.map(id => world.clubs[id].name);
        for (const id of down) {
          const h = humanByClub(id);
          if (h) { addNews(h, "Rebaixamento", "O clube caiu para a " + country.leagueNameB + ".", "warning"); world.clubs[id].moralTorcida = 25; }
        }
        for (const id of up) {
          const h = humanByClub(id);
          if (h) { addNews(h, "ACESSO!", "O clube subiu para a " + country.leagueNameA + "!", "title"); world.clubs[id].moralTorcida = 90; }
        }
      }
      const humanClubIds = new Set(Object.values(rg.humans).map(h => h.clubId));
      for (const club of Object.values(world.clubs)) {
        const isHuman = humanClubIds.has(club.id);
        for (let i = club.players.length - 1; i >= 0; i--) {
          const p = club.players[i];
          p.age++;
          if (p.age >= 32) {
            const decline = (p.age - 31) * 0.9;
            for (const k of Object.keys(p.skills)) p.skills[k] = Math.round(Math.max(1, p.skills[k] - decline * (0.6 + U().RNG.next() * 0.7)) * 100) / 100;
            recomputeRating(p);
          }
          p.value = window.TF.world.computeValue(p);
      p.star = window.TF.world.isStar(p.rating);
          p.wage = window.TF.world.wageFor(p.rating, p.age);
          p.contractYears = Math.max(0, p.contractYears - 1);
          if (!isHuman) {
            if (p.contractYears === 0 && U().RNG.chance(0.85)) p.contractYears = 1 + Math.floor(U().RNG.next() * 2);
            if (p.age >= 34 && (p.rating < 68 || U().RNG.chance(0.4))) {
              club.players.splice(i, 1);
              delete world.players[p.id];
              const youth = window.TF.world.generatePlayer(p.pos, club.countryId, club.rating - 4, U().RNG.next.bind(U().RNG));
              youth.age = 17 + Math.floor(U().RNG.next() * 3);
              youth.clubId = club.id;
              club.players.push(youth);
              world.players[youth.id] = youth;
            }
          }
          p.seasonStats = { games: 0, goals: 0, assists: 0, ratingSum: 0, cards: 0 };
          p.yellow = 0; p.suspended = 0; p.injuryWeeks = 0; p.energy = 100;
          p.warnedContract = false;
        }
        club.money += F().seasonSponsorship(club);
        club.ticketPrice = F().suggestedTicketPrice(club);
      }
      world.season++;
      rg.season = C().buildSeasonCalendar(world, U().RNG.next.bind(U().RNG));
      for (const h of Object.values(rg.humans)) {
        h.matchLog = []; // §26 zera o histórico da temporada anterior
        autoLineupFor(h);
        addNews(h, "Nova temporada: " + world.season, "Patrocínio creditado. Boa sorte!", "board");
      }
      return report;
    }

    // ---------- snapshot para os clientes ----------
    // versão leve de jogador (outros países): suficiente para tabela, navegação e propostas
    function lightPlayer(p) {
      return {
        id: p.id, name: p.name, pos: p.pos, age: p.age, nation: p.nation, foot: p.foot,
        rating: p.rating, potential: p.potential, value: p.value, wage: p.wage, star: p.star,
        contractYears: p.contractYears, traits: p.traits, forSale: p.forSale, salePrice: p.salePrice || null,
        energy: Math.round(p.energy),
        seasonStats: { games: p.seasonStats.games, goals: p.seasonStats.goals }
      };
    }

    function serializeClub(c, full) {
      return {
        id: c.id, name: c.name, shortName: c.shortName, division: c.division, rating: c.rating,
        countryId: c.countryId, nation: c.nation, titles: c.titles || [],
        stadium: c.stadium, capacity: c.capacity, crest: c.crest, money: c.money,
        moralTorcida: c.moralTorcida, ticketPrice: c.ticketPrice, grass: c.grass,
        stadiumWorks: c.stadiumWorks || null,
        players: full ? c.players : c.players.map(lightPlayer)
      };
    }

    function snapshot() {
      const country = world.countries[countryId];
      // todos os clubes de todos os países (paridade com o offline)
      const clubs = {};
      const leaguesByCountry = {};
      for (const cid of Object.keys(world.countries)) {
        const co = world.countries[cid];
        const full = cid === countryId; // elenco completo só do país da sala
        for (const id of co.clubIdsA.concat(co.clubIdsB)) clubs[id] = serializeClub(world.clubs[id], full);
        leaguesByCountry[cid] = {
          name: co.name,
          leagueNames: { A: co.leagueNameA, B: co.leagueNameB },
          relegated: co.relegated,
          tables: { A: rg.season.leagues[cid].A.table, B: rg.season.leagues[cid].B.table },
          currentRound: rg.season.leagues[cid].A.currentRound,
          totalRounds: rg.season.leagues[cid].A.rounds.length
        };
      }
      const cup = rg.season.cups[countryId];
      return {
        countryId,
        countryName: country.name,
        leagueNames: { A: country.leagueNameA, B: country.leagueNameB },
        cupName: country.cupName,
        relegated: country.relegated,
        seasonYear: rg.season.year,
        week: rg.week,
        slot: slotPreview(),
        window: transferWindowInfo(),
        tables: leaguesByCountry[countryId].tables,
        currentRound: leaguesByCountry[countryId].currentRound,
        totalRounds: leaguesByCountry[countryId].totalRounds,
        leaguesByCountry,
        cup: { phaseName: cup.phaseName, ties: cup.ties, history: cup.history, championId: cup.championId },
        clubs,
        lastResults: rg.lastResults,
        humans: Object.values(rg.humans).map(h => ({ id: h.id, name: h.name, clubId: h.clubId }))
      };
    }

    // §24/§26 próximos jogos do técnico a partir do calendário da temporada
    function upcomingForHuman(h, limit) {
      const club = world.clubs[h.clubId];
      const league = rg.season.leagues[countryId][club.division];
      const out = [];
      for (let i = rg.season.slotIndex; i < rg.season.slots.length && out.length < limit; i++) {
        const slot = rg.season.slots[i];
        if (slot.type === "league") {
          const round = league.rounds[slot.round];
          if (!round) continue;
          const f = round.find(pair => pair[0] === club.id || pair[1] === club.id);
          if (f) out.push({ comp: league.name, sub: "Rodada " + (slot.round + 1), home: f[0], away: f[1], isHome: f[0] === club.id });
        } else if (slot.type === "cup") {
          const cup = rg.season.cups[countryId];
          const cupName = world.countries[countryId].cupName;
          if (cup.phase === slot.phase && !cup.championId) {
            const t = cup.ties.find(t => t.home === club.id || t.away === club.id);
            if (t) out.push({ comp: cupName, sub: cup.phaseName, home: t.home, away: t.away, isHome: t.home === club.id });
          } else if (!cup.championId && slot.phase >= cup.phase) {
            out.push({ comp: cupName, sub: C().CUP_PHASES[slot.phase] || "", home: null, away: null });
          }
        }
      }
      return out;
    }

    function personal(playerId) {
      const h = rg.humans[playerId];
      if (!h) return null;
      return {
        clubId: h.clubId, tactics: h.tactics, squad: h.squad, training: h.training,
        setPieces: h.setPieces, news: h.news, offers: h.offers, humanOffers: h.humanOffers,
        sentBids: h.sentBids || [],
        matchLog: h.matchLog || [], upcoming: upcomingForHuman(h, 30),
        money: clubOf(h).money
      };
    }

    /* Restaura uma sala salva em disco. O mundo é mutado no lugar porque as funções
       internas fecham sobre o mesmo objeto `world`. */
    function hydrate(data) {
      for (const k of Object.keys(world)) delete world[k];
      Object.assign(world, data.world);
      world.players = {};
      for (const club of Object.values(world.clubs)) {
        for (const pl of club.players) world.players[pl.id] = pl;
      }
      rg.season = data.season;
      rg.week = data.week;
      rg.humans = data.humans;
      for (const h of Object.values(rg.humans)) if (!h.matchLog) h.matchLog = []; // §26 saves antigos
      rg.lastResults = data.lastResults || null;
      rg.pendingSlot = null;
    }

    /* Define capitão/cobrador fora da rodada (tela de escalação online). */
    function setSquadPiece(playerId, key, id) {
      const h = rg.humans[playerId];
      if (!h) return { ok: false };
      h.setPieces = h.setPieces || {};
      if (key === "captain" || ["freeKick", "cornerLeft", "cornerRight"].includes(key)) h.setPieces[key] = id;
      return { ok: true };
    }

    Object.assign(rg, {
      addHuman, removeHuman, humanByClub, autoLineupFor, autoAssignSetPiecesFor, humanTeam, teamForClub,
      slotPreview, startRound, completeRound, endOfSeason, hydrate, setSquadPiece,
      transferWindowInfo, makeOfferFrom, respondHumanOffer, respondAiOffer,
      snapshot, personal, addNews, clubOf: (pid) => rg.humans[pid] ? world.clubs[rg.humans[pid].clubId] : null
    });
    return rg;
  }

  window.TF.roomGame = { createRoomGame };
})();
