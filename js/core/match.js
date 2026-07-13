"use strict";
/* Motor de partida estilo Brasfoot: simulação minuto a minuto baseada nos setores do
   time (defesa, meio, ataque), habilidades individuais, características, tática e moral. */
(function () {
  const U = window.TF.util;
  const TAC = window.TF.tactics;

  // formações e coordenadas vêm do módulo tático (orientado a dados, 15 formações)
  const FORMATIONS = TAC.FORMATION_SLOTS;      // nome -> [slotPos x11]
  const FORMATION_COORDS = TAC.FORMATION_COORDS;

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
    const star = player.star ? 1.05 : 1; // craques rendem um pouco mais
    return base * positionFactor(player, slotPos) * energy * moral * form * star;
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
    return { gk, def, mid, att, aerialAtt, aerialDef };
  }

  function starters(lineup) { return lineup.filter(s => s.player); }

  function pickShooter(lineup, rng, headed, origin, isThrough) {
    const cands = starters(lineup).filter(s => s.slotPos !== "GOL");
    const weights = cands.map(s => {
      let w = Math.pow(effSkill(s.player, "finishing", s.slotPos), 2);
      if (["ATA", "PD", "PE"].includes(s.slotPos)) w *= 3.2;
      else if (s.slotPos === "MEI") w *= 1.7;
      else if (["ZAG", "VOL"].includes(s.slotPos) && headed) w *= 1.5;
      else w *= 0.4;
      if (headed && hasTrait(s.player, "Cabeceio")) w *= 2.2;
      // setor de origem: a jogada envolve mais quem está naquele lado
      if (origin === "left" && ["PE", "LE"].includes(s.slotPos)) w *= 1.7;
      else if (origin === "right" && ["PD", "LD"].includes(s.slotPos)) w *= 1.7;
      else if (origin === "center" && ["MEI", "MC", "ATA"].includes(s.slotPos)) w *= 1.4;
      // bola em profundidade favorece quem tem velocidade
      if (isThrough && hasTrait(s.player, "Velocidade")) w *= 1.8;
      if (isThrough && ["ATA", "PD", "PE"].includes(s.slotPos)) w *= 1.3;
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
    function blankStats() {
      return {
        shots: 0, target: 0, corners: 0, fouls: 0, poss: 0,
        attCenter: 0, attLeft: 0, attRight: 0, crosses: 0, crossGoals: 0,
        longBalls: 0, through: 0, counters: 0, aerials: 0, recov: 0
      };
    }
    const state = {
      gh: 0, ga: 0, minute: 0,
      stats: { h: blankStats(), a: blankStats() },
      ratings: new Map(), // player -> nota acumulada
      out: new Set(), // expulsos/lesionados sem substituição
      hints: { h: {}, a: {} } // controle de mensagens táticas já emitidas
    };

    const sides = [
      { key: "h", team: homeTeam, other: null, lev: null },
      { key: "a", team: awayTeam, other: null, lev: null }
    ];
    sides[0].other = sides[1]; sides[1].other = sides[0];

    function refreshLevers() {
      for (const s of sides) {
        let tactics = s.team.tactics;
        if (s.team.ai) {
          tactics = TAC.reactTactics(tactics, {
            minute: state.minute,
            myGoals: s.key === "h" ? state.gh : state.ga,
            oppGoals: s.key === "h" ? state.ga : state.gh,
            avgEnergy: avgEnergy(s),
            redCard: !!s.redCard
          });
        }
        s.lev = TAC.resolve({ tactics: tactics });
      }
    }
    refreshLevers();

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
      const lev = s.lev, oppLev = s.other.lev;
      // alavancas táticas: forças de setor
      st.def *= lev.defMult; st.mid *= lev.midMult; st.att *= lev.attMult;
      if (s.key === "h" && opts.homeAdv !== false) { st.mid *= 1.14; st.att *= 1.1; st.def *= 1.07; }
      // capitão em campo lidera o time (experiência e qualidade contam)
      const capId = s.team.captainId;
      if (capId) {
        const capSlot = s.team.lineup.find(sl => sl.player && sl.player.id === capId);
        if (capSlot) {
          const cap = capSlot.player;
          const boost = 1.015 + (cap.age >= 30 ? 0.012 : 0) + (cap.rating >= 84 ? 0.008 : 0);
          st.def *= boost; st.mid *= boost; st.att *= boost;
        }
      }
      // pressão adversária alta atrapalha quem constrói curto (troca de passes sob pressão)
      if (oppLev.pressing > 0 && lev.directness < 0.5) st.att *= 1 - oppLev.pressing * 0.06 * (0.5 - lev.directness) / 0.5;
      // pressão adversária alta também abre espaço nas costas dela para este time explorar
      st.possMid = st.mid * lev.possMult; // meio "efetivo" para partilha de posse
      return st;
    }

    /* Cobrador designado (se estiver em campo); senão, o melhor disponível. */
    function designated(team, key) {
      const id = team.setPieces && team.setPieces[key];
      if (!id) return null;
      const slot = team.lineup.find(sl => sl.player && sl.player.id === id && sl.slotPos !== "GOL");
      return slot || null;
    }

    function pickOrigin(lev) {
      const total = lev.attCenterW + lev.attLeftW + lev.attRightW;
      let r = rng() * total;
      if ((r -= lev.attCenterW) < 0) return "center";
      if ((r -= lev.attLeftW) < 0) return "left";
      return "right";
    }

    function attemptGoal(att, min, isCounter, fromPress) {
      const def = att.other;
      const lev = att.lev, defLev = def.lev;
      const stA = strengths(att), stD = strengths(def);
      const stat = state.stats[att.key];

      const origin = pickOrigin(lev);
      if (origin === "center") stat.attCenter++; else if (origin === "left") stat.attLeft++; else stat.attRight++;

      // tipo de jogada
      const wingPlay = origin !== "center";
      const isLong = !isCounter && rng() < lev.longBall;
      const isThrough = !isLong && (isCounter || rng() < lev.directness * 0.5) && rng() < 0.6; // profundidade
      const isCross = !isLong && wingPlay && rng() < (0.25 + lev.crossFreq * 0.4);
      let headed = false;
      if (isCross) {
        // o motor escolhe o tipo de cruzamento: times com forte jogo aéreo cruzam
        // alto (cabeceio); os de pouca presença aérea buscam o rasteiro.
        const aerialBias = U.clamp((stA.aerialAtt - 52) / 40, 0, 1); // 0..1
        headed = rng() < 0.24 + aerialBias * 0.5;
      }
      else if (isLong) headed = rng() < 0.5;
      else headed = rng() < 0.14;

      if (isLong) stat.longBalls++;
      if (isThrough) stat.through++;
      if (isCross) stat.crosses++;
      if (headed) stat.aerials++;
      if (isCounter) stat.counters++;

      const shooter = pickShooter(att.team.lineup, rng, headed, origin, isThrough);
      if (!shooter || !shooter.player) return;
      const finish = effSkill(shooter.player, "finishing", shooter.slotPos)
        + (headed && hasTrait(shooter.player, "Cabeceio") ? 12 : 0)
        + (isThrough && hasTrait(shooter.player, "Velocidade") ? 8 : 0);
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;

      stat.shots++;
      // qualidade da chance
      let attPower = stA.att + stA.mid * (isLong ? 0.15 : 0.4);
      if (isCross) attPower += stA.aerialAtt * 0.5;
      let defPower = stD.def * 1.35 + gkSkill * 0.35;
      if (isCounter) defPower *= 1 - defLev.spaceBehind * 0.5;        // contra-ataque explora espaço atrás
      if (isThrough) defPower *= 1 - defLev.spaceBehind * 0.35;       // profundidade contra linha alta
      if (fromPress) attPower *= 1.15;                                // erro forçado pela pressão
      let create = attPower / (attPower + defPower);
      create *= lev.chanceQual;
      // marcação individual do adversário sufoca a criação em jogadas posicionais,
      // mas nada faz contra corridas em profundidade e contra-ataques (que a exploram).
      if (defLev.manMarkDef && !isCounter && !isThrough) create *= 1 - defLev.manMarkDef;

      if (rng() > create * 1.12) {
        if (rng() < 0.4) {
          const side = origin === "left" ? "esquerda" : origin === "right" ? "direita" : (rng() < 0.5 ? "esquerda" : "direita");
          stat.corners++;
          const taker = designated(att.team, side === "esquerda" ? "cornerLeft" : "cornerRight");
          log(min, "corner", "Escanteio pela " + side + " para " + att.team.club.name + (taker ? " — " + taker.player.name + " na cobrança" : "") + ".", att);
          let takerBonus = taker ? (effSkill(taker.player, "pass", taker.slotPos) - 60) * 0.0012 + (hasTrait(taker.player, "Cruzamento") ? 0.05 : 0) : 0;
          if (rng() < 0.16 + stA.aerialAtt * 0.004 + takerBonus) return attemptCornerGoal(att, min, taker);
        } else {
          const how = isCross ? "após cruzamento" : isLong ? "no lançamento" : isCounter ? "no contra-ataque" : "";
          log(min, "chance", (headed ? "Cabeçada" : "Finalização") + " de " + shooter.player.name + (how ? " " + how : "") + " para fora!", att);
        }
        return;
      }
      stat.target++;
      const pGoal = U.clamp(finish / (finish + gkSkill * 2.4), 0.08, 0.62);
      if (rng() < pGoal) {
        const how = headed ? "de cabeça" : isCounter ? "em contra-ataque" : isLong ? "após lançamento" : null;
        goal(att, shooter, min, how, false, isCross);
      } else {
        addRating(gkSlot && gkSlot.player, 0.25);
        log(min, "save", "Defesa do goleiro " + (gkSlot && gkSlot.player ? gkSlot.player.name : "") + "! Chute de " + shooter.player.name + ".", att);
      }
    }

    /* Mensagens táticas ocasionais (percepção dos efeitos das escolhas). */
    function maybeHint(min) {
      if (min < 12 || rng() > 0.06) return;
      for (const s of sides) {
        const st = state.stats[s.key], h = state.hints[s.key];
        const atksWide = st.attLeft + st.attRight, atksC = st.attCenter;
        if (!h.side && atksWide >= 5 && st.attLeft > st.attRight * 1.8) { h.side = 1; return log(min, "hint", "Seu time está encontrando espaços pela esquerda.", s); }
        if (!h.side && atksWide >= 5 && st.attRight > st.attLeft * 1.8) { h.side = 1; return log(min, "hint", "As jogadas estão saindo mais pela direita.", s); }
        if (!h.press && s.lev.pressing > 0 && state.stats[s.key].recov >= 3) { h.press = 1; return log(min, "hint", "A pressão alta está forçando erros do adversário.", s); }
        if (!h.behind && s.other.lev.counter > 0.4 && s.lev.spaceBehind > 0.45 && st.attCenter + atksWide > 8) { h.behind = 1; return log(min, "hint", "Cuidado: os laterais estão deixando espaços nas costas.", s); }
        if (!h.tired && avgEnergy(s) < 55) { h.tired = 1; return log(min, "hint", "O time demonstra cansaço pelo ritmo intenso.", s); }
        if (!h.cross && st.crosses >= 7 && st.crossGoals === 0) { h.cross = 1; return log(min, "hint", "Os cruzamentos não estão encontrando os atacantes.", s); }
        if (!h.mark && s.lev.manMark && min >= 30 && state.stats[s.other.key].target <= 1) { h.mark = 1; return log(min, "hint", "A marcação individual está anulando os criadores adversários.", s); }
      }
    }
    function avgEnergy(s) {
      const xi = starters(s.team.lineup);
      return xi.length ? xi.reduce((a, sl) => a + sl.player.energy, 0) / xi.length : 100;
    }

    function attemptCornerGoal(att, min, taker) {
      const def = att.other;
      const shooter = pickShooter(att.team.lineup, rng, true);
      if (!shooter || !shooter.player) return;
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;
      const finish = effSkill(shooter.player, "finishing", shooter.slotPos) + (hasTrait(shooter.player, "Cabeceio") ? 15 : 0);
      if (rng() < U.clamp(finish / (finish + gkSkill * 2.6), 0.08, 0.5)) {
        if (taker && taker.player !== shooter.player) {
          taker.player.seasonStats.assists++;
          addRating(taker.player, 0.7);
        }
        goal(att, shooter, min, "de cabeça, após escanteio" + (taker && taker.player !== shooter.player ? " cobrado por " + taker.player.name : ""), true);
      } else {
        log(min, "chance", shooter.player.name + " cabeceia após o escanteio, mas a defesa afasta.", att);
      }
    }

    function goal(att, shooter, min, how, skipAssist, isCross) {
      if (att.key === "h") state.gh++; else state.ga++;
      if (isCross) state.stats[att.key].crossGoals++;
      const assister = !skipAssist && rng() < 0.7 ? pickAssister(att.team.lineup, rng, shooter.player) : null;
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
      // pressão alta e mentalidade defensiva provocam mais faltas e cartões
      const cardChance = U.clamp(0.13 * def.lev.foulMult, 0.08, 0.34);
      if (rng() < cardChance) {
        const p = foulerPlayer;
        p.matchYellow = (p.matchYellow || 0) + 1;
        if (p.matchYellow >= 2 || rng() < 0.05) {
          log(min, "red", "CARTÃO VERMELHO! " + p.name + " (" + def.team.club.name + ") está expulso!", def);
          removePlayer(def, fouler);
          def.redCard = true;
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
        const kicker = bestFreeKicker(att.team);
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

    function bestFreeKicker(team) {
      const chosen = designated(team, "freeKick");
      if (chosen) return chosen;
      const cands = starters(team.lineup).filter(s => s.slotPos !== "GOL");
      if (!cands.length) return null;
      return cands.slice().sort((a, b) =>
        (b.player.skills.technique + b.player.skills.finishing) - (a.player.skills.technique + a.player.skills.finishing))[0];
    }

    // Um lado é controlado por humano? Offline: opts.interactiveSide (1 lado).
    // Online: opts.humanSides (array com "h" e/ou "a").
    function isHumanSide(key) {
      if (opts.humanSides) return opts.humanSides.indexOf(key) >= 0;
      return opts.interactiveSide === key;
    }

    /* PÊNALTI (§11-18) — máquina de estados com tensão.
       Sem humano no jogo: resolve na hora. Com humano: cria state.penalty; a tela
       (offline/online) toca as fases, o humano atacante escolhe o batedor, e
       finishPenalty aplica o resultado ao placar. */
    function penaltyEvent(att, min) {
      const def = att.other;
      log(min, "penalty", "PÊNALTI para " + att.team.club.name + "!", att);
      // humano em cada lado: offline usa interactiveSide (1 lado); online usa humanSides (0-2 lados)
      const attHuman = isHumanSide(att.key), defHuman = isHumanSide(def.key);
      if (!attHuman && !defHuman) { // sem humano envolvido: resolve imediatamente, sem tela
        const taker = bestPenaltyTaker(att.team.lineup);
        applyPenaltyOutcome(att, taker, computePenaltyOutcome(att, taker), min);
        return;
      }
      const elig = starters(att.team.lineup).filter(s => s.slotPos !== "GOL");
      const gkP = def.team.lineup[0] && def.team.lineup[0].player;
      const pen = {
        sideKey: att.key, attKey: att.key, min,
        club: att.team.club.name, oppClub: def.team.club.name,
        userAttacking: attHuman,
        userDefending: defHuman,
        eligible: elig.map(s => ({ id: s.player.id, name: s.player.name, pos: s.slotPos, finishing: Math.round(effSkill(s.player, "finishing", s.slotPos)), energy: Math.round(s.player.energy), star: !!s.player.star })),
        gkName: gkP ? gkP.name : "",
        takerId: null, takerName: null, outcome: null, applied: false
      };
      if (!pen.userAttacking) {
        // usuário é o lado que defende: a IA escolhe o batedor e o resultado já fica definido
        const taker = bestPenaltyTaker(att.team.lineup);
        pen.takerId = taker.player.id; pen.takerName = taker.player.name;
        pen.outcome = computePenaltyOutcome(att, taker);
      }
      state.penalty = pen;
    }

    function computePenaltyOutcome(att, taker) {
      const def = att.other;
      const gkSlot = def.team.lineup[0];
      const gkSkill = gkSlot && gkSlot.player ? effSkill(gkSlot.player, "gk", "GOL") : 25;
      const gkBonus = gkSlot && gkSlot.player && hasTrait(gkSlot.player, "Defesa de pênalti") ? 14 : 0;
      const skill = effSkill(taker.player, "finishing", taker.slotPos);
      const pGoal = U.clamp(skill / (skill + (gkSkill + gkBonus) * 0.62), 0.5, 0.9);
      if (rng() < pGoal) return "goal";
      const r = rng();                 // divide o erro: defesa / para fora / na trave
      return r < 0.55 ? "save" : r < 0.8 ? "wide" : "post";
    }

    function applyPenaltyOutcome(att, taker, outcome, min) {
      if (!taker || !taker.player) return;
      if (outcome === "goal") {
        goal(att, taker, min, "de pênalti", true); // §23 sem assistência em gol de pênalti
      } else {
        const gkSlot = att.other.team.lineup[0];
        addRating(gkSlot && gkSlot.player, outcome === "save" ? 1.0 : 0.2);
        addRating(taker.player, -0.6);
        taker.player.moral = U.clamp(taker.player.moral - 8, 0, 100);
        const msg = outcome === "save" ? "Defesa! O goleiro pega a cobrança de " + taker.player.name + "!"
          : outcome === "post" ? taker.player.name + " carimba a trave!"
            : taker.player.name + " manda para fora!";
        log(min, "miss", msg, att);
      }
    }

    /* Técnico humano escolhe o batedor; calcula (sem aplicar) o resultado e o retorna. */
    function setPenaltyTaker(takerId) {
      const pen = state.penalty;
      if (!pen || pen.applied) return null;
      const att = pen.attKey === "h" ? sides[0] : sides[1];
      let taker = att.team.lineup.find(s => s.player && s.player.id === takerId && s.slotPos !== "GOL");
      if (!taker) taker = bestPenaltyTaker(att.team.lineup);
      pen.takerId = taker.player.id; pen.takerName = taker.player.name;
      pen.outcome = computePenaltyOutcome(att, taker);
      return pen.outcome;
    }

    /* Aplica o resultado ao placar e encerra o pênalti (fim da tela). */
    function finishPenalty() {
      const pen = state.penalty;
      if (!pen) return { ok: false };
      if (!pen.applied) {
        const att = pen.attKey === "h" ? sides[0] : sides[1];
        const taker = att.team.lineup.find(s => s.player && s.player.id === pen.takerId && s.slotPos !== "GOL") || bestPenaltyTaker(att.team.lineup);
        if (!pen.outcome) pen.outcome = computePenaltyOutcome(att, taker);
        applyPenaltyOutcome(att, taker, pen.outcome, pen.min);
        pen.applied = true;
      }
      const out = pen.outcome;
      state.penalty = null;
      return { ok: true, outcome: out };
    }

    /* Compatibilidade: resolve o pênalti num passo só (escolhe batedor + aplica). */
    function resolvePenalty(takerId) {
      const pen = state.penalty;
      if (!pen) return { ok: false };
      if (!pen.applied && !pen.outcome) setPenaltyTaker(takerId || pen.takerId);
      return finishPenalty();
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
      // técnico humano só escolhe o substituto se houver troca disponível
      const canSubstitute = (side.team.subsUsed || 0) < 5 && side.team.bench.some(p => !p.injuryWeeks);
      if (opts.interactiveSide && opts.interactiveSide === side.key && canSubstitute) {
        const slotIndex = side.team.lineup.indexOf(victim);
        const outName = victim.player.name;
        victim.player = null;
        state.pendingInjury = { sideKey: side.key, min, slotIndex, outName };
        return;
      }
      removePlayer(side, victim, true);
    }

    /* UI resolve a lesão pendente: entra alguém do banco (ou null = jogar com um a menos). */
    function resolveInjury(inPlayerId) {
      const pend = state.pendingInjury;
      if (!pend) return { ok: false };
      state.pendingInjury = null;
      const side = pend.sideKey === "h" ? sides[0] : sides[1];
      const slot = side.team.lineup[pend.slotIndex];
      if (!inPlayerId || !slot) return { ok: true, subbed: false };
      if ((side.team.subsUsed || 0) >= 5) return { ok: true, subbed: false, reason: "Limite de substituições atingido." };
      const idx = side.team.bench.findIndex(p => p.id === inPlayerId && !p.injuryWeeks);
      if (idx < 0) return { ok: true, subbed: false, reason: "Jogador não está no banco." };
      const inP = side.team.bench.splice(idx, 1)[0];
      slot.player = inP;
      inP.matchPlayed = true;
      state.ratings.set(inP.id, 6);
      side.team.subsUsed = (side.team.subsUsed || 0) + 1;
      log(state.minute, "sub", "Substituição no " + side.team.club.name + ": entra " + inP.name + " no lugar do lesionado.", side);
      return { ok: true, subbed: true };
    }

    /* Troca dois jogadores de posição em campo (não gasta substituição). */
    function swapPositions(sideKey, idA, idB) {
      const side = sideKey === "h" ? sides[0] : sides[1];
      const a = side.team.lineup.find(s => s.player && s.player.id === idA);
      const b = side.team.lineup.find(s => s.player && s.player.id === idB);
      if (!a || !b) return { ok: false, reason: "Jogador inválido." };
      const tmp = a.player;
      a.player = b.player;
      b.player = tmp;
      log(state.minute, "info", "Ajuste tático no " + side.team.club.name + ": " + a.player.name + " e " + b.player.name + " trocam de posição.", side);
      return { ok: true };
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
      if (phase === "shootout") return; // aguardando a UI apresentar a disputa
      if (state.penalty || state.pendingInjury) return; // aguardando decisão do técnico
      if (phase === "halftime") phase = "second";
      clock++;
      refreshLevers(); // pega mudanças táticas ao vivo
      const m = state.minute = phase === "first" ? Math.min(clock, 45) : Math.min(45 + (clock - endFirstHalf), 90);
      // desgaste: idade pesa muito, resistência ajuda, velocistas gastam mais, tática influencia
      for (const s of sides) for (const slot of starters(s.team.lineup)) {
        const p = slot.player;
        let drain = 0.34;
        if (p.age <= 21) drain *= 0.8;
        else if (p.age <= 25) drain *= 0.9;
        else if (p.age >= 34) drain *= 1.4;
        else if (p.age >= 32) drain *= 1.28;
        else if (p.age >= 30) drain *= 1.12;
        if (hasTrait(p, "Resistência")) drain *= 0.65;
        if (hasTrait(p, "Velocidade")) drain *= 1.12;
        drain *= s.lev.energyMult; // ritmo, pressão, mentalidade, laterais
        // laterais/pontas que sobem gastam ainda mais
        if ((slot.slotPos === "LD" || slot.slotPos === "LE") && s.lev.crossFreq > 0.9) drain *= 1.1;
        p.energy = Math.max(15, p.energy - drain);
      }

      const stH = strengths(sides[0]), stA = strengths(sides[1]);
      const total = Math.pow(stH.possMid, 1.25) + Math.pow(stA.possMid, 1.25);
      const hShare = Math.pow(stH.possMid, 1.25) / total;
      state.stats.h.poss += hShare; state.stats.a.poss += 1 - hShare;

      // volume de ataque de cada lado depende da posse e da mentalidade/ritmo
      const volH = hShare * sides[0].lev.chanceVol, volA = (1 - hShare) * sides[1].lev.chanceVol;
      const attRate = 0.135 * (volH + volA);
      const r = rng();
      if (r < attRate) {
        const att = rng() * (volH + volA) < volH ? sides[0] : sides[1];
        attemptGoal(att, m, false);
        maybeHint(m);
      } else if (r < attRate + 0.06) {
        // tentativa de contra-ataque: quem tem foco em contra-ataque explora o espaço do rival
        for (const att of sides) {
          const def = att.other;
          if (rng() < att.lev.counter * (0.4 + def.lev.spaceBehind) * 0.5) {
            attemptGoal(att, m, true);
            break;
          }
        }
      } else if (r < attRate + 0.06 + 0.075) {
        const fh = sides[0].lev.foulMult, fa = sides[1].lev.foulMult;
        const def = rng() * (fh + fa) < fh ? sides[0] : sides[1];
        foulEvent(def, m);
      } else if (r < attRate + 0.06 + 0.078) {
        const att = rng() < hShare ? sides[0] : sides[1];
        penaltyEvent(att, m);
      } else if (r < attRate + 0.06 + 0.0815) {
        injuryEvent(rng() < 0.5 ? sides[0] : sides[1], m);
      }
      // pressão alta: chance de recuperar a bola no ataque e forçar erro do adversário
      for (const s of sides) {
        if (s.lev.highRecovery > 0.2 && rng() < (s.lev.highRecovery - 0.2) * 0.12) {
          state.stats[s.key].recov++;
          if (rng() < 0.4) attemptGoal(s, m, false, true);
        }
      }

      if (phase === "first" && clock >= endFirstHalf) {
        phase = "halftime";
        log(45, "half", "Fim do primeiro tempo: " + homeTeam.club.name + " " + state.gh + " x " + state.ga + " " + awayTeam.club.name, null);
      } else if (phase === "second" && clock >= endMatchAt) {
        if (opts.knockout && state.gh === state.ga && !state.shootout) startShootout();
        else finish();
      }
    }

    /* Mata-mata empatado: entra na fase de disputa de pênaltis (§28), apresentada
       lance a lance pela UI. O resultado já vem pré-calculado (determinístico). */
    function startShootout() {
      const so = penaltyShootout(homeTeam, awayTeam, rng);
      if (!so) { finish(); return; }
      state.shootout = {
        winnerSide: so.winnerSide, scoreH: so.scoreH, scoreA: so.scoreA,
        kicks: so.kicks, suddenDeath: so.suddenDeath, applied: false,
        homeName: homeTeam.club.name, awayName: awayTeam.club.name
      };
      phase = "shootout";
      log(90, "shootoutStart", "Fim do tempo normal: " + homeTeam.club.name + " " + state.gh + " x " + state.ga + " " + awayTeam.club.name + ". Vamos para os pênaltis!", null);
    }
    function finishShootout() {
      if (!state.shootout || finished) return;
      state.shootout.applied = true;
      finish();
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

    /* Relatório tático de um lado (setores, cruzamentos, bolas longas, contra-ataques...). */
    function sideReport(key) {
      const st = state.stats[key], me = key === "h" ? sides[0] : sides[1];
      const wide = st.attLeft + st.attRight, tot = st.attCenter + wide || 1;
      let mainSector = st.attCenter >= wide ? "meio" : (st.attLeft > st.attRight ? "esquerda" : "direita");
      return {
        setorPrincipal: mainSector,
        ataquesMeio: Math.round(100 * st.attCenter / tot),
        ataquesEsquerda: Math.round(100 * st.attLeft / tot),
        ataquesDireita: Math.round(100 * st.attRight / tot),
        cruzamentos: st.crosses, golsDeCruzamento: st.crossGoals,
        bolasLongas: st.longBalls, profundidade: st.through,
        contraAtaques: st.counters, recuperacaoAlta: st.recov, aereas: st.aerials,
        cansaco: Math.round(avgEnergy(me)),
        formacao: me.lev.formationName
      };
    }
    function result() {
      const totalPoss = state.stats.h.poss + state.stats.a.poss || 1;
      return {
        gh: state.gh, ga: state.ga, events,
        stats: {
          h: { ...state.stats.h, poss: Math.round(100 * state.stats.h.poss / totalPoss) },
          a: { ...state.stats.a, poss: Math.round(100 * state.stats.a.poss / totalPoss) }
        },
        report: { h: sideReport("h"), a: sideReport("a") },
        shootout: state.shootout || null // §28 disputa de pênaltis (mata-mata empatado)
      };
    }

    return {
      home: homeTeam, away: awayTeam, events, state,
      playMinute, substitute, result, resolvePenalty, setPenaltyTaker, finishPenalty, finishShootout, resolveInjury, swapPositions,
      get phase() { return phase; },
      get finished() { return finished; },
      get minute() { return state.minute; },
      get penalty() { return state.penalty || null; },
      get pendingPenalty() { return state.penalty || null; }, // compat
      get pendingInjury() { return state.pendingInjury || null; },
      get shootout() { return state.shootout || null; },
      resumeSecondHalf() { if (phase === "halftime") phase = "second"; },
      finishNow() {
        while (!finished) {
          if (state.penalty) resolvePenalty(null);
          if (state.pendingInjury) {
            const side = state.pendingInjury.sideKey === "h" ? sides[0] : sides[1];
            const best = side.team.bench.filter(p => !p.injuryWeeks)[0];
            resolveInjury(best ? best.id : null);
          }
          if (phase === "shootout") { finishShootout(); break; }
          playMinute();
        }
      }
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

  // ---------------- DISPUTA DE PÊNALTIS (§28) ----------------
  // Resolvedor independente: recebe os dois times (com lineup) e devolve o
  // resultado com a cobrança lance a lance, para narração de tensão.
  function shootoutOutcome(taker, gkPlayer, rng) {
    const gkSkill = gkPlayer ? effSkill(gkPlayer, "gk", "GOL") : 25;
    const gkBonus = gkPlayer && hasTrait(gkPlayer, "Defesa de pênalti") ? 14 : 0;
    const skill = effSkill(taker.player, "finishing", taker.slotPos) + (hasTrait(taker.player, "Finalização") ? 5 : 0);
    const pGoal = U.clamp(skill / (skill + (gkSkill + gkBonus) * 0.62), 0.5, 0.9);
    if (rng() < pGoal) return "goal";
    const r = rng();
    return r < 0.55 ? "save" : r < 0.8 ? "wide" : "post"; // defesa / para fora / trave
  }
  function shootoutOrder(lineup) {
    return starters(lineup).filter(s => s.slotPos !== "GOL")
      .sort((a, b) => effSkill(b.player, "finishing", b.slotPos) - effSkill(a.player, "finishing", a.slotPos));
  }
  /* Disputa de pênaltis: melhor de 5 e, se empatar, morte súbita. */
  function penaltyShootout(homeTeam, awayTeam, rng) {
    rng = rng || Math.random;
    const gkH = homeTeam.lineup[0] && homeTeam.lineup[0].player;
    const gkA = awayTeam.lineup[0] && awayTeam.lineup[0].player;
    const ordH = shootoutOrder(homeTeam.lineup), ordA = shootoutOrder(awayTeam.lineup);
    if (!ordH.length || !ordA.length) return null;
    const kicks = [];
    let sH = 0, sA = 0, tH = 0, tA = 0;
    function kick(side) {
      if (side === "h") { const t = ordH[tH % ordH.length]; const o = shootoutOutcome(t, gkA, rng); if (o === "goal") sH++; tH++; kicks.push({ side: "h", taker: t.player.name, outcome: o, sH, sA }); }
      else { const t = ordA[tA % ordA.length]; const o = shootoutOutcome(t, gkH, rng); if (o === "goal") sA++; tA++; kicks.push({ side: "a", taker: t.player.name, outcome: o, sH, sA }); }
    }
    function decided() { const maxH = sH + (5 - tH), maxA = sA + (5 - tA); if (sH > maxA) return "h"; if (sA > maxH) return "a"; return null; }
    let winner = null, suddenDeath = false;
    for (let r = 0; r < 5 && !winner; r++) { kick("h"); if (winner = decided()) break; kick("a"); if (winner = decided()) break; }
    while (!winner) { suddenDeath = true; kick("h"); kick("a"); if (sH !== sA) winner = sH > sA ? "h" : "a"; }
    return { winnerSide: winner, scoreH: sH, scoreA: sA, kicks, suddenDeath };
  }

  /* Muda a formação de um time em campo mantendo os mesmos jogadores,
     redistribuídos nos novos slots por melhor encaixe. Muta team.lineup no lugar. */
  function reformTeam(team, formationName) {
    const formation = FORMATIONS[formationName];
    if (!formation) return { ok: false, reason: "Formação inválida." };
    const players = team.lineup.map(s => s.player).filter(Boolean);
    const newLineup = formation.map(pos => ({ slotPos: pos, player: null }));
    const used = new Set();
    // o goleiro vai para o slot de goleiro
    const gkSlot = newLineup.find(s => s.slotPos === "GOL");
    const gk = players.find(p => p.pos === "GOL");
    if (gkSlot && gk) { gkSlot.player = gk; used.add(gk.id); }
    // demais slots: melhor encaixe por posição
    for (const slot of newLineup) {
      if (slot.player) continue;
      let best = null, bestVal = -1;
      for (const p of players) {
        if (used.has(p.id)) continue;
        const v = p.rating * positionFactor(p, slot.slotPos);
        if (v > bestVal) { bestVal = v; best = p; }
      }
      if (best) { slot.player = best; used.add(best.id); }
    }
    team.lineup.length = 0;
    for (const s of newLineup) team.lineup.push(s);
    team.formationName = formationName;
    return { ok: true, formationName };
  }

  // Frases de suspense da cobrança de pênalti (a tela sorteia algumas).
  const PENALTY_SUSPENSE = [
    "O batedor coloca a bola na marca da cal…",
    "Silêncio total no estádio.",
    "O goleiro escolhe o canto e dança na linha.",
    "A torcida prende a respiração.",
    "Ele respira fundo e mede os passos.",
    "Tensão máxima — é agora.",
    "O árbitro apita e autoriza a cobrança."
  ];

  window.TF.match = { FORMATIONS, FORMATION_COORDS, createMatch, simulate, pickLineup, bestFormationFor, reformTeam, teamStrength, positionFactor, penaltyShootout, PENALTY_SUSPENSE };
})();
