"use strict";
/* Motor de partida estilo Brasfoot: simulação minuto a minuto baseada nos setores do
   time (defesa, meio, ataque), habilidades individuais, características, tática e moral. */
(function () {
  const U = window.TF.util;

  const FORMATIONS = {
    "4-4-2": ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MC", "MEI", "ATA", "ATA"],
    "4-3-3": ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"],
    "4-5-1": ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "VOL", "MC", "MC", "MEI", "ATA"],
    "3-5-2": ["GOL", "ZAG", "ZAG", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "ATA", "ATA"],
    "5-4-1": ["GOL", "LD", "ZAG", "ZAG", "ZAG", "LE", "VOL", "VOL", "MC", "MEI", "ATA"],
    "4-2-4": ["GOL", "LD", "ZAG", "ZAG", "LE", "MC", "MC", "PD", "PE", "ATA", "ATA"]
  };

  // coordenadas (x%, y%) de cada slot para desenhar no campo (y: 0 = gol próprio)
  const FORMATION_COORDS = {
    "4-4-2": [[50, 6], [85, 24], [62, 20], [38, 20], [15, 24], [50, 42], [68, 52], [32, 52], [50, 64], [62, 84], [38, 84]],
    "4-3-3": [[50, 6], [85, 24], [62, 20], [38, 20], [15, 24], [50, 42], [62, 54], [38, 58], [82, 76], [18, 76], [50, 86]],
    "4-5-1": [[50, 6], [85, 24], [62, 20], [38, 20], [15, 24], [62, 40], [38, 40], [72, 54], [28, 54], [50, 64], [50, 86]],
    "3-5-2": [[50, 6], [70, 18], [50, 16], [30, 18], [88, 40], [12, 40], [50, 38], [62, 54], [42, 62], [62, 84], [38, 84]],
    "5-4-1": [[50, 6], [88, 26], [68, 18], [50, 16], [32, 18], [12, 26], [62, 42], [38, 42], [58, 56], [42, 62], [50, 86]],
    "4-2-4": [[50, 6], [85, 24], [62, 20], [38, 20], [15, 24], [60, 44], [40, 44], [82, 76], [18, 76], [62, 88], [38, 88]]
  };

  const COMPAT = { // grupos de posições parecidas (improvisação leve)
    GOL: ["GOL"], ZAG: ["ZAG", "VOL"], LD: ["LD", "LE", "PD"], LE: ["LE", "LD", "PE"],
    VOL: ["VOL", "ZAG", "MC"], MC: ["MC", "VOL", "MEI"], MEI: ["MEI", "MC", "ATA"],
    PD: ["PD", "PE", "ATA", "LD"], PE: ["PE", "PD", "ATA", "LE"], ATA: ["ATA", "MEI", "PD", "PE"]
  };

  function positionFactor(player, slotPos) {
    if (player.pos === slotPos) return 1;
    if ((COMPAT[slotPos] || []).includes(player.pos)) {
      // improvisação de lado penaliza menos
      const sides = { LD: "LE", LE: "LD", PD: "PE", PE: "PD" };
      if (sides[slotPos] === player.pos) return 0.93;
      return 0.85;
    }
    if (slotPos === "GOL" || player.pos === "GOL") return 0.3;
    return 0.72;
  }

  function effSkill(player, skill, slotPos) {
    const base = player.skills[skill];
    const energy = 0.55 + 0.45 * (player.energy / 100);
    const moral = 0.9 + 0.2 * (player.moral / 100);
    const form = 1 + (player.form || 0) * 0.02;
    return base * positionFactor(player, slotPos) * energy * moral * form;
  }

  function hasTrait(p, t) { return p.traits && p.traits.indexOf(t) >= 0; }

  /* Calcula forças de setor de um time escalado.
     lineup: [{player, slotPos}] com 11 itens (índice 0 = goleiro). */
  function teamStrength(lineup, tactics, grassBad) {
    let def = 0, defN = 0, mid = 0, midN = 0, att = 0, attN = 0, aerialAtt = 0, aerialDef = 0;
    let gk = 30;
    for (const { player: p, slotPos } of lineup) {
      if (!p) continue;
      const techPenalty = grassBad ? 0.92 : 1;
      if (slotPos === "GOL") { gk = effSkill(p, "gk", slotPos); continue; }
      const isDef = ["ZAG", "LD", "LE"].includes(slotPos);
      const isMid = ["VOL", "MC", "MEI"].includes(slotPos);
      const tackle = effSkill(p, "tackle", slotPos);
      const pass = effSkill(p, "pass", slotPos) * techPenalty;
      const play = effSkill(p, "playmaking", slotPos) * techPenalty;
      const fin = effSkill(p, "finishing", slotPos);
      const spd = effSkill(p, "speed", slotPos);
      const tec = effSkill(p, "technique", slotPos) * techPenalty;

      if (isDef) {
        def += tackle * 1.15 + spd * 0.35 + (hasTrait(p, "Marcação") ? 6 : 0) + (hasTrait(p, "Desarme") ? 5 : 0);
        defN += 1.5;
        aerialDef += hasTrait(p, "Cabeceio") ? 8 : 0;
        mid += pass * 0.25; midN += 0.25;
      } else if (isMid) {
        mid += pass * 0.9 + play * 0.9 + tec * 0.3 + (hasTrait(p, "Passe") ? 6 : 0) + (hasTrait(p, "Armação") ? 6 : 0);
        midN += 2.1;
        def += tackle * (slotPos === "VOL" ? 0.8 : 0.3); defN += slotPos === "VOL" ? 0.8 : 0.3;
        att += fin * (slotPos === "MEI" ? 0.5 : 0.2) + play * 0.3; attN += slotPos === "MEI" ? 0.8 : 0.5;
      } else {
        att += fin * 1.1 + spd * 0.5 + tec * 0.4 + (hasTrait(p, "Finalização") ? 7 : 0) + (hasTrait(p, "Drible") ? 5 : 0);
        attN += 2;
        mid += play * 0.35 + pass * 0.2; midN += 0.55;
        aerialAtt += hasTrait(p, "Cabeceio") ? 9 : 0;
      }
    }
    def = defN ? def / defN : 30;
    mid = midN ? mid / midN : 30;
    att = attN ? att / attN : 30;

    // estilo de jogo
    if (tactics.style === "ataque") { att *= 1.18; mid *= 1.05; def *= 0.82; }
    else if (tactics.style === "retranca") { att *= 0.85; def *= 1.18; mid *= 0.92; }
    return { gk, def, mid, att, aerialAtt, aerialDef };
  }

  function starters(lineup) { return lineup.filter(s => s.player); }

  function pickShooter(lineup, rng, headed) {
    const cands = starters(lineup).filter(s => s.slotPos !== "GOL");
    const weights = cands.map(s => {
      let w = Math.pow(effSkill(s.player, "finishing", s.slotPos), 2);
      if (["ATA", "PD", "PE"].includes(s.slotPos)) w *= 3.2;
      else if (s.slotPos === "MEI") w *= 1.7;
      else if (["ZAG", "VOL"].includes(s.slotPos) && headed) w *= 1.5;
      else w *= 0.4;
      if (headed && hasTrait(s.player, "Cabeceio")) w *= 2.2;
      return w;
    });
    return weightedPick(cands, weights, rng);
  }

  function pickAssister(lineup, rng, shooter) {
    const cands = starters(lineup).filter(s => s.slotPos !== "GOL" && s.player !== shooter);
    const weights = cands.map(s => {
      let w = effSkill(s.player, "playmaking", s.slotPos) + effSkill(s.player, "pass", s.slotPos);
      if (["MEI", "MC"].includes(s.slotPos)) w *= 2;
      if (hasTrait(s.player, "Armação")) w *= 1.6;
      if (hasTrait(s.player, "Cruzamento")) w *= 1.3;
      return w;
    });
    return weightedPick(cands, weights, rng);
  }

  function weightedPick(items, weights, rng) {
    if (!items.length) return null;
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return items[0];
    let r = rng() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  function pickFouler(lineup, rng) {
    const cands = starters(lineup).filter(s => s.slotPos !== "GOL");
    const weights = cands.map(s => ["ZAG", "VOL", "LD", "LE"].includes(s.slotPos) ? 3 : 1);
    return weightedPick(cands, weights, rng);
  }

  /* Cria uma partida controlável minuto a minuto (para jogo ao vivo e modo online).
     opts: { homeAdv (bool), grass, rng } */
  function createMatch(homeTeam, awayTeam, opts) {
    const rng = opts.rng || U.RNG.next.bind(U.RNG);
    const grassBad = opts.grass === "Ruim" || opts.grass === "Péssimo";
    const events = [];
    const state = {
      gh: 0, ga: 0, minute: 0,
      stats: { h: { shots: 0, target: 0, corners: 0, fouls: 0, poss: 0 }, a: { shots: 0, target: 0, corners: 0, fouls: 0, poss: 0 } },
      ratings: new Map(), // player -> nota acumulada
      out: new Set() // expulsos/lesionados sem substituição
    };

    const sides = [
      { key: "h", team: homeTeam, other: null },
      { key: "a", team: awayTeam, other: null }
    ];
    sides[0].other = sides[1]; sides[1].other = sides[0];

    for (const s of sides) for (const slot of starters(s.team.lineup)) {
      state.ratings.set(slot.player.id, 5.5 + rng() * 0.8);
    }

    function addRating(p, delta) {
      if (!p) return;
      state.ratings.set(p.id, (state.ratings.get(p.id) || 5.5) + delta);
    }

    function log(min, type, text, side) {
      events.push({ min, type, text, side: side ? side.key : null, gh: state.gh, ga: state.ga });
    }

    function strengths(s) {
      const st = teamStrength(s.team.lineup, s.team.tactics, grassBad);
      if (s.key === "h" && opts.homeAdv !== false) { st.mid *= 1.14; st.att *= 1.1; st.def *= 1.07; }
      // marcação adversária pesada reduz criação
      const oppMark = s.other.team.tactics.marking;
      if (oppMark === "pesada") st.att *= 0.94;
      else if (oppMark === "muito pesada") st.att *= 0.87;
      return st;
    }

    function attemptGoal(att, min) {
      const def = att.other;
      const stA = strengths(att), stD = strengths(def);
      const headed = rng() < 0.22;
      const shooter = pickShooter(att.team.lineup, rng, headed);
      if (!shooter || !shooter.player) return;
      const finish = effSkill(shooter.player, "finishing", shooter.slotPos) + (headed && hasTrait(shooter.player, "Cabeceio") ? 12 : 0);
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;

      state.stats[att.key].shots++;
      // chance clara?
      const create = (stA.att + stA.mid * 0.4) / ((stA.att + stA.mid * 0.4) + (stD.def * 1.35 + gkSkill * 0.35));
      if (rng() > create * 1.12) {
        if (rng() < 0.4) {
          state.stats[att.key].corners++;
          log(min, "corner", "Escanteio para " + att.team.club.name + ".", att);
          if (rng() < 0.16 + stA.aerialAtt * 0.004) return attemptCornerGoal(att, min);
        } else {
          log(min, "chance", (headed ? "Cabeçada" : "Finalização") + " de " + shooter.player.name + " para fora!", att);
        }
        return;
      }
      state.stats[att.key].target++;
      const pGoal = U.clamp(finish / (finish + gkSkill * 2.4), 0.08, 0.62);
      if (rng() < pGoal) {
        goal(att, shooter, min, headed ? "de cabeça" : null);
      } else {
        addRating(gkSlot && gkSlot.player, 0.25);
        log(min, "save", "Defesa do goleiro " + (gkSlot && gkSlot.player ? gkSlot.player.name : "") + "! Chute de " + shooter.player.name + ".", att);
      }
    }

    function attemptCornerGoal(att, min) {
      const def = att.other;
      const shooter = pickShooter(att.team.lineup, rng, true);
      if (!shooter || !shooter.player) return;
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;
      const finish = effSkill(shooter.player, "finishing", shooter.slotPos) + (hasTrait(shooter.player, "Cabeceio") ? 15 : 0);
      if (rng() < U.clamp(finish / (finish + gkSkill * 2.6), 0.08, 0.5)) {
        goal(att, shooter, min, "de cabeça, após escanteio");
      } else {
        log(min, "chance", shooter.player.name + " cabeceia após o escanteio, mas a defesa afasta.", att);
      }
    }

    function goal(att, shooter, min, how) {
      if (att.key === "h") state.gh++; else state.ga++;
      const assister = rng() < 0.7 ? pickAssister(att.team.lineup, rng, shooter.player) : null;
      shooter.player.seasonStats.goals++;
      shooter.player.matchGoals = (shooter.player.matchGoals || 0) + 1;
      if (assister) { assister.player.seasonStats.assists++; addRating(assister.player, 0.7); }
      addRating(shooter.player, 1.1);
      log(min, "goal", "GOOOOL de " + shooter.player.name + (how ? " " + how : "") + "! " +
        att.team.club.name + (assister ? " (assistência de " + assister.player.name + ")" : ""), att);
    }

    function foulEvent(def, min) {
      // def comete falta
      const att = def.other;
      state.stats[def.key].fouls++;
      const fouler = pickFouler(def.team.lineup, rng);
      if (!fouler) return;
      const foulerPlayer = fouler.player;
      const mark = def.team.tactics.marking;
      const cardChance = mark === "muito pesada" ? 0.3 : mark === "pesada" ? 0.2 : 0.12;
      if (rng() < cardChance) {
        const p = foulerPlayer;
        p.matchYellow = (p.matchYellow || 0) + 1;
        if (p.matchYellow >= 2 || rng() < 0.05) {
          log(min, "red", "CARTÃO VERMELHO! " + p.name + " (" + def.team.club.name + ") está expulso!", def);
          removePlayer(def, fouler);
          p.suspended = Math.max(p.suspended, p.matchYellow >= 2 ? 1 : 2);
          addRating(p, -1.5);
        } else {
          p.seasonStats.cards++;
          p.yellow++;
          log(min, "yellow", "Cartão amarelo para " + p.name + " (" + def.team.club.name + ").", def);
          if (p.yellow >= 3) { p.suspended = 1; p.yellow = 0; }
        }
      }
      // falta perigosa → chance de gol de falta
      if (rng() < 0.18) {
        const kicker = bestFreeKicker(att.team.lineup);
        if (kicker) {
          const gkSlot = def.team.lineup[0];
          const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;
          const power = effSkill(kicker.player, "technique", kicker.slotPos) + effSkill(kicker.player, "finishing", kicker.slotPos) * 0.5;
          if (rng() < U.clamp(power / (power + gkSkill * 4.2), 0.03, 0.28)) {
            goal(att, kicker, min, "de falta");
          } else {
            log(min, "chance", kicker.player.name + " cobra a falta com perigo!", att);
          }
        }
      } else if (rng() < 0.35) {
        log(min, "foul", "Falta dura de " + foulerPlayer.name + " no meio-campo.", def);
      }
    }

    function bestFreeKicker(lineup) {
      const cands = starters(lineup).filter(s => s.slotPos !== "GOL");
      if (!cands.length) return null;
      return cands.slice().sort((a, b) =>
        (b.player.skills.technique + b.player.skills.finishing) - (a.player.skills.technique + a.player.skills.finishing))[0];
    }

    function penaltyEvent(att, min) {
      const def = att.other;
      const taker = bestPenaltyTaker(att.team.lineup);
      if (!taker) return;
      log(min, "penalty", "PÊNALTI para " + att.team.club.name + "!", att);
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;
      const gkBonus = gkSlot && gkSlot.player && hasTrait(gkSlot.player, "Defesa de pênalti") ? 14 : 0;
      const skill = effSkill(taker.player, "finishing", taker.slotPos);
      if (rng() < U.clamp(skill / (skill + (gkSkill + gkBonus) * 0.62), 0.5, 0.9)) {
        goal(att, taker, min, "de pênalti");
      } else {
        addRating(gkSlot && gkSlot.player, 1.0);
        addRating(taker.player, -0.6);
        taker.player.moral = U.clamp(taker.player.moral - 8, 0, 100);
        log(min, "miss", taker.player.name + " desperdiça o pênalti!", att);
      }
    }

    function bestPenaltyTaker(lineup) {
      const cands = starters(lineup).filter(s => s.slotPos !== "GOL");
      return cands.slice().sort((a, b) => b.player.skills.finishing - a.player.skills.finishing)[0];
    }

    function injuryEvent(side, min) {
      const cands = starters(side.team.lineup).filter(s => s.slotPos !== "GOL");
      const weights = cands.map(s => (s.player.age >= 32 ? 2.2 : 1) * (s.player.energy < 40 ? 1.8 : 1));
      const victim = weightedPick(cands, weights, rng);
      if (!victim) return;
      const weeks = 1 + Math.floor(rng() * rng() * 8);
      victim.player.injuryWeeks = weeks;
      log(min, "injury", victim.player.name + " se machucou e não pode continuar (" + weeks + (weeks === 1 ? " semana" : " semanas") + " fora).", side);
      removePlayer(side, victim, true);
    }

    function removePlayer(side, slot, canSub) {
      // tenta substituir do banco (IA); expulso não pode
      if (canSub && side.team.bench && side.team.bench.length && (side.team.subsUsed || 0) < 5) {
        const idx = side.team.bench.findIndex(p => p.pos === slot.player.pos && !p.injuryWeeks);
        const sub = idx >= 0 ? side.team.bench.splice(idx, 1)[0] : side.team.bench.shift();
        if (sub) {
          side.team.subsUsed = (side.team.subsUsed || 0) + 1;
          state.ratings.set(sub.id, 6);
          sub.matchPlayed = true;
          slot.player = sub;
          return;
        }
      }
      slot.player = null; // fica com um a menos
    }

    // ---- controle minuto a minuto ----
    const halfLength = 45;
    const extra1 = 1 + Math.floor(rng() * 3);
    const extra2 = 2 + Math.floor(rng() * 4);
    const endFirstHalf = halfLength + extra1;   // ex.: 47
    const endMatchAt = 90 + extra2;             // ex.: 94
    let phase = "first"; // first | halftime | second | done
    let clock = 0;       // minuto real interno
    let finished = false;

    function playMinute() {
      if (finished) return;
      if (phase === "halftime") phase = "second";
      clock++;
      const m = state.minute = phase === "first" ? Math.min(clock, 45) : Math.min(45 + (clock - endFirstHalf), 90);
      // desgaste
      for (const s of sides) for (const slot of starters(s.team.lineup)) {
        const p = slot.player;
        let drain = 0.55;
        if (hasTrait(p, "Resistência")) drain *= 0.7;
        if (s.team.tactics.style === "ataque") drain *= 1.12;
        if (s.team.tactics.marking === "muito pesada") drain *= 1.1;
        p.energy = Math.max(20, p.energy - drain);
      }

      const stH = strengths(sides[0]), stA = strengths(sides[1]);
      const total = Math.pow(stH.mid, 1.25) + Math.pow(stA.mid, 1.25);
      const hShare = Math.pow(stH.mid, 1.25) / total;
      state.stats.h.poss += hShare; state.stats.a.poss += 1 - hShare;

      const r = rng();
      if (r < 0.135) {
        const att = rng() < hShare ? sides[0] : sides[1];
        // retranca: menos volume, mais contra-ataques efetivos
        if (att.team.tactics.style === "retranca" && rng() < 0.35) {
          log(m, "counter", "Contra-ataque rápido de " + att.team.club.name + "!", att);
        }
        attemptGoal(att, m);
      } else if (r < 0.21) {
        const def = rng() < 0.5 ? sides[0] : sides[1];
        foulEvent(def, m);
      } else if (r < 0.2128) {
        const att = rng() < hShare ? sides[0] : sides[1];
        penaltyEvent(att, m);
      } else if (r < 0.2163) {
        injuryEvent(rng() < 0.5 ? sides[0] : sides[1], m);
      }

      if (phase === "first" && clock >= endFirstHalf) {
        phase = "halftime";
        log(45, "half", "Fim do primeiro tempo: " + homeTeam.club.name + " " + state.gh + " x " + state.ga + " " + awayTeam.club.name, null);
      } else if (phase === "second" && clock >= endMatchAt) {
        finish();
      }
    }

    function finish() {
      if (finished) return;
      finished = true;
      phase = "done";
      log(90, "end", "Fim de jogo: " + homeTeam.club.name + " " + state.gh + " x " + state.ga + " " + awayTeam.club.name, null);
      // pós-jogo: estatísticas dos jogadores
      const winner = state.gh > state.ga ? "h" : state.ga > state.gh ? "a" : null;
      for (const s of sides) {
        const bonus = winner === s.key ? 0.4 : winner === null ? 0 : -0.4;
        for (const slot of starters(s.team.lineup)) {
          const p = slot.player;
          p.seasonStats.games++;
          p.careerStats.games++;
          p.careerStats.goals += (p.matchGoals || 0);
          const nota = U.clamp((state.ratings.get(p.id) || 5.5) + bonus + rng() * 0.4, 1, 10);
          p.seasonStats.ratingSum += nota;
          p.form = U.clamp((p.form || 0) * 0.7 + (nota - 6) * 0.5, -3, 3);
          p.moral = U.clamp(p.moral + (winner === s.key ? 3 : winner === null ? 0 : -3) + (p.matchGoals ? 4 : 0), 5, 100);
          p.lastNota = Math.round(nota * 10) / 10;
        }
      }
    }

    function substitute(sideKey, outPlayerId, inPlayerId) {
      const side = sideKey === "h" ? sides[0] : sides[1];
      if ((side.team.subsUsed || 0) >= 5) return { ok: false, reason: "Limite de 5 substituições." };
      const slot = side.team.lineup.find(s => s.player && s.player.id === outPlayerId);
      const idx = side.team.bench.findIndex(p => p.id === inPlayerId);
      if (!slot || idx < 0) return { ok: false, reason: "Jogador inválido." };
      const inP = side.team.bench.splice(idx, 1)[0];
      const outP = slot.player;
      slot.player = inP;
      inP.matchPlayed = true;
      state.ratings.set(inP.id, 6);
      side.team.subsUsed = (side.team.subsUsed || 0) + 1;
      log(state.minute, "sub", "Substituição no " + side.team.club.name + ": sai " + outP.name + ", entra " + inP.name + ".", side);
      return { ok: true };
    }

    function result() {
      const totalPoss = state.stats.h.poss + state.stats.a.poss || 1;
      return {
        gh: state.gh, ga: state.ga, events,
        stats: {
          h: { ...state.stats.h, poss: Math.round(100 * state.stats.h.poss / totalPoss) },
          a: { ...state.stats.a, poss: Math.round(100 * state.stats.a.poss / totalPoss) }
        }
      };
    }

    return {
      home: homeTeam, away: awayTeam, events, state,
      playMinute, substitute, result,
      get phase() { return phase; },
      get finished() { return finished; },
      get minute() { return state.minute; },
      resumeSecondHalf() { if (phase === "halftime") phase = "second"; },
      finishNow() { while (!finished) playMinute(); }
    };
  }

  /* Simulação instantânea (jogos da IA). */
  function simulate(homeTeam, awayTeam, opts) {
    const m = createMatch(homeTeam, awayTeam, opts || {});
    m.finishNow();
    return m.result();
  }

  /* IA: escolhe a melhor escalação para um clube em uma formação adequada. */
  function pickLineup(club, formationName) {
    const formation = FORMATIONS[formationName] || FORMATIONS["4-4-2"];
    const available = club.players.filter(p => !p.injuryWeeks && !p.suspended && p.contractYears > 0);
    const used = new Set();
    const lineup = formation.map(pos => ({ slotPos: pos, player: null }));
    // primeiro passe: posição exata
    for (const slot of lineup) {
      let best = null, bestVal = -1;
      for (const p of available) {
        if (used.has(p.id) || p.pos !== slot.slotPos) continue;
        const v = p.rating * (0.9 + 0.1 * p.energy / 100);
        if (v > bestVal) { bestVal = v; best = p; }
      }
      if (best) { slot.player = best; used.add(best.id); }
    }
    // segundo passe: improvisação
    for (const slot of lineup) {
      if (slot.player) continue;
      let best = null, bestVal = -1;
      for (const p of available) {
        if (used.has(p.id)) continue;
        const v = p.rating * positionFactor(p, slot.slotPos);
        if (v > bestVal) { bestVal = v; best = p; }
      }
      if (best) { slot.player = best; used.add(best.id); }
    }
    const bench = available.filter(p => !used.has(p.id))
      .sort((a, b) => b.rating - a.rating).slice(0, 7);
    return { lineup, bench, formationName: formationName || "4-4-2" };
  }

  function bestFormationFor(club) {
    // conta pontas e escolhe formação que aproveite o elenco
    const wingers = club.players.filter(p => (p.pos === "PD" || p.pos === "PE") && p.rating >= club.rating - 8).length;
    const strikers = club.players.filter(p => p.pos === "ATA" && p.rating >= club.rating - 8).length;
    if (wingers >= 2) return "4-3-3";
    if (strikers >= 3) return "4-4-2";
    return "4-4-2";
  }

  window.TF.match = { FORMATIONS, FORMATION_COORDS, createMatch, simulate, pickLineup, bestFormationFor, teamStrength, positionFactor };
})();
