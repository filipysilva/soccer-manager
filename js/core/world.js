"use strict";
/* Constrói o mundo do jogo a partir da base 2026 (clubes reais) + configuração de ligas.
   Clubes sem elenco completo recebem jogadores gerados deterministicamente. */
(function () {
  const U = window.TF.util;

  const POSITIONS = ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
  const POS_LABEL = { GOL: "Goleiro", ZAG: "Zagueiro", LD: "Lateral Dir.", LE: "Lateral Esq.", VOL: "Volante", MC: "Meio-campo", MEI: "Meia Ofensivo", PD: "Ponta Dir.", PE: "Ponta Esq.", ATA: "Atacante" };
  // composição alvo de um elenco gerado
  const SQUAD_TEMPLATE = ["GOL", "GOL", "GOL", "ZAG", "ZAG", "ZAG", "ZAG", "LD", "LD", "LE", "LE", "VOL", "VOL", "VOL", "MC", "MC", "MEI", "MEI", "PD", "PE", "ATA", "ATA", "ATA", "MC"];

  const TRAITS_BY_POS = {
    GOL: [["Colocação", "Reflexo"], ["Saída do gol", "Reflexo"], ["Colocação", "Defesa de pênalti"], ["Reflexo", "Saída do gol"]],
    ZAG: [["Marcação", "Cabeceio"], ["Desarme", "Marcação"], ["Cabeceio", "Desarme"], ["Marcação", "Velocidade"]],
    LD: [["Velocidade", "Cruzamento"], ["Marcação", "Velocidade"], ["Cruzamento", "Desarme"], ["Velocidade", "Drible"]],
    LE: [["Velocidade", "Cruzamento"], ["Marcação", "Velocidade"], ["Cruzamento", "Desarme"], ["Velocidade", "Drible"]],
    VOL: [["Desarme", "Marcação"], ["Passe", "Desarme"], ["Marcação", "Resistência"], ["Desarme", "Cabeceio"]],
    MC: [["Passe", "Armação"], ["Passe", "Resistência"], ["Armação", "Drible"], ["Passe", "Desarme"]],
    MEI: [["Armação", "Passe"], ["Armação", "Drible"], ["Finalização", "Armação"], ["Drible", "Passe"]],
    PD: [["Velocidade", "Drible"], ["Drible", "Cruzamento"], ["Velocidade", "Finalização"], ["Cruzamento", "Velocidade"]],
    PE: [["Velocidade", "Drible"], ["Drible", "Cruzamento"], ["Velocidade", "Finalização"], ["Cruzamento", "Velocidade"]],
    ATA: [["Finalização", "Velocidade"], ["Finalização", "Cabeceio"], ["Drible", "Finalização"], ["Velocidade", "Drible"]]
  };

  const COUNTRY_INFO = {
    BRA: { name: "Brasil", continent: "América do Sul", relegated: 4, continentalCup: "Copa Libertadores", secondCup: "Copa Sul-Americana" },
    ENG: { name: "Inglaterra", continent: "Europa", relegated: 3, continentalCup: "Liga dos Campeões", secondCup: "Liga Europa" },
    ESP: { name: "Espanha", continent: "Europa", relegated: 3, continentalCup: "Liga dos Campeões", secondCup: "Liga Europa" },
    ITA: { name: "Itália", continent: "Europa", relegated: 3, continentalCup: "Liga dos Campeões", secondCup: "Liga Europa" },
    POR: { name: "Portugal", continent: "Europa", relegated: 2, continentalCup: "Liga dos Campeões", secondCup: "Liga Europa" },
    GER: { name: "Alemanha", continent: "Europa", relegated: 2, continentalCup: "Liga dos Campeões", secondCup: "Liga Europa" }
  };

  const STOPWORDS = new Set(["fc", "cf", "sc", "ac", "afc", "cd", "ud", "sl", "gd", "ss", "us", "rcd", "ca", "ce", "sd", "rc", "cp", "ec", "se", "aa", "sad", "spa", "saf", "de", "do", "da", "the", "und", "fur", "turn", "club", "clube", "futebol", "futbol", "football", "fussball", "calcio", "balompie", "esporte", "esportiva", "sociedade", "societa", "sportiva", "sport", "associacao", "associazione", "deportivo", "desportivo", "deportiu", "reial", "verein", "team", "ag", "foot", "ball", "spielbetriebs", "sportgemeinschaft", "bewegungsspiele", "leibesubungen", "fussballclub"]);

  const ALIASES = { athletico: "atletico", inter: "internazionale", milao: "milano", munich: "munchen", mg: "mineiro", pr: "paranaense", rj: "rio", colonia: "koln" };

  function nameTokens(name) {
    return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
      .map(t => ALIASES[t] || t)
      .filter(t => t && t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  }

  function matchScore(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    let common = 0;
    for (const t of aTokens) if (bTokens.includes(t)) common++;
    if (!common) return 0;
    return common / Math.min(aTokens.length, bTokens.length)
      + 0.2 * (common / Math.max(aTokens.length, bTokens.length))
      + 0.01 * common;
  }

  // ---------- geração de jogadores ----------
  function skillsForPosition(pos, rating, rng) {
    const r = () => rng();
    const v = (base, spread) => U.clamp(Math.round(base + (r() * 2 - 1) * spread), 1, 100);
    const hi = rating, mid = rating - 8, low = Math.max(8, rating - 30);
    let s;
    switch (pos) {
      case "GOL": s = { gk: v(hi, 4), speed: v(mid - 5, 8), pass: v(low + 10, 8), playmaking: v(low, 6), tackle: v(low, 6), finishing: v(low - 5, 5), technique: v(mid - 10, 8) }; break;
      case "ZAG": s = { gk: 8, speed: v(mid - 4, 8), pass: v(mid - 6, 8), playmaking: v(low, 8), tackle: v(hi, 4), finishing: v(low, 8), technique: v(mid - 8, 8) }; break;
      case "LD": case "LE": s = { gk: 8, speed: v(hi - 2, 5), pass: v(mid, 7), playmaking: v(mid - 6, 8), tackle: v(mid, 7), finishing: v(low + 5, 8), technique: v(mid - 2, 7) }; break;
      case "VOL": s = { gk: 8, speed: v(mid - 4, 8), pass: v(mid + 2, 6), playmaking: v(mid - 4, 8), tackle: v(hi - 2, 5), finishing: v(low + 5, 8), technique: v(mid - 4, 7) }; break;
      case "MC": s = { gk: 8, speed: v(mid - 2, 7), pass: v(hi - 2, 5), playmaking: v(mid + 2, 6), tackle: v(mid - 4, 8), finishing: v(mid - 8, 8), technique: v(mid, 6) }; break;
      case "MEI": s = { gk: 8, speed: v(mid, 7), pass: v(hi - 3, 5), playmaking: v(hi, 4), tackle: v(low, 7), finishing: v(mid - 2, 7), technique: v(hi - 3, 5) }; break;
      case "PD": case "PE": s = { gk: 8, speed: v(hi, 4), pass: v(mid - 2, 7), playmaking: v(mid - 2, 7), tackle: v(low, 6), finishing: v(mid, 7), technique: v(hi - 4, 6) }; break;
      default: s = { gk: 8, speed: v(mid + 2, 7), pass: v(mid - 6, 8), playmaking: v(mid - 6, 8), tackle: v(low, 6), finishing: v(hi, 4), technique: v(mid, 7) };
    }
    return s;
  }

  let generatedId = 0;
  function generatePlayer(pos, nation, clubRating, rng) {
    const age = 17 + Math.floor(rng() * 17); // 17 a 33
    const spread = Math.round((rng() * 2 - 1) * 9);
    const rating = U.clamp(clubRating - 6 + spread, 30, 92);
    const potential = age < 24 ? U.clamp(rating + Math.floor(rng() * 12), rating, 95) : rating;
    const traits = TRAITS_BY_POS[pos][Math.floor(rng() * TRAITS_BY_POS[pos].length)];
    const side = (pos === "LD" || pos === "PD") ? "D" : (pos === "LE" || pos === "PE") ? "E" : (rng() < 0.75 ? "D" : "E");
    // pé preferido realista (~25% canhotos no futebol), ambidestro raríssimo
    const r = rng();
    const foot = r < 0.012 ? "both" : (side === "E" ? (r < 0.62 ? "left" : "right") : (r < 0.87 ? "right" : "left"));
    generatedId++;
    return normalizePlayer({
      id: "gen_" + generatedId,
      name: window.TF.names.randomName(nation, rng),
      position: pos, age, nation, side, foot, rating, potential,
      value: valueFor(rating, age),
      traits: traits.slice(),
      skills: skillsForPosition(pos, rating, rng),
      contractYears: 1 + Math.floor(rng() * 2)
    });
  }

  // craque: força de elite (aparece com ⭐ e rende/evolui um pouco mais)
  function isStar(rating) { return rating >= 88; }

  // fator de idade sobre o valor de mercado (prime 24-27 = 1.0)
  function ageValueFactor(age) {
    if (age <= 19) return 1.3;
    if (age <= 21) return 1.25;
    if (age <= 23) return 1.15;
    if (age <= 27) return 1.0;
    if (age === 28) return 0.9;
    if (age === 29) return 0.78;
    if (age === 30) return 0.62;
    if (age === 31) return 0.5;
    if (age === 32) return 0.38;
    if (age === 33) return 0.27;
    if (age === 34) return 0.18;
    if (age === 35) return 0.12;
    return 0.07;
  }

  /* Valor de mercado (milhões de €) calibrado por dados reais (Transfermarkt).
     Ex.: 90→~110, 85→~49, 80→~22, 75→~10, 70→~4.4, 65→~2, 60→~0.9. */
  function valueFor(rating, age) {
    const v = Math.exp(0.161 * rating - 9.79) * ageValueFactor(age);
    return Math.max(0.03, Math.round(v * 100) / 100);
  }

  /* Recalcula o valor preservando a âncora real do jogador (mv0 no rating/idade de origem),
     escalando só pela mudança relativa de força e idade. Mantém os valores reais da base. */
  function computeValue(p) {
    if (p._mv0 == null || p._mvR == null || p._mvA == null) return valueFor(p.rating, p.age);
    const ref = valueFor(p._mvR, p._mvA);
    const now = valueFor(p.rating, p.age);
    const v = p._mv0 * (ref > 0 ? now / ref : 1);
    return Math.max(0.03, Math.round(v * 100) / 100);
  }

  function wageFor(rating, age) {
    let w = Math.pow(rating, 2.9) * 0.11;
    if (age >= 30) w *= 1.1;
    return Math.round(w / 100) * 100;
  }

  function contractYearsFromDb(exp) {
    if (!exp) return 1;
    const year = parseInt(String(exp).slice(0, 4), 10);
    if (!isFinite(year)) return 1;
    return U.clamp(year - 2026, 0, 3);
  }

  function normalizePlayer(raw) {
    const rating = U.clamp(Math.round(raw.rating || 50), 1, 99);
    const age = raw.age || 25;
    const skills = raw.skills || skillsForPosition(raw.position, rating, U.RNG.next.bind(U.RNG));
    // valor de mercado real (da base) vira a âncora; se não houver, usa a fórmula
    const value = raw.value != null ? raw.value : valueFor(rating, age);
    return {
      id: String(raw.id),
      name: raw.name,
      pos: raw.position,
      age,
      nation: raw.nation || "BRA",
      side: raw.side === "E" || raw.side === "D" || raw.side === "C" ? raw.side : (raw.foot === "left" ? "E" : "D"),
      foot: raw.foot === "left" ? "E" : raw.foot === "both" ? "A" : "D",
      rating,
      potential: U.clamp(Math.round(raw.potential || rating), rating, 99),
      value,
      _mv0: value, _mvR: rating, _mvA: age, // âncora do valor real
      wage: wageFor(rating, raw.age || 25),
      contractYears: raw.contractYears != null ? raw.contractYears : contractYearsFromDb(raw.contractExpiration),
      traits: (raw.traits || []).slice(0, 2),
      skills: {
        gk: U.clamp(Math.round(skills.gk || 8), 1, 100),
        speed: U.clamp(Math.round(skills.speed || 50), 1, 100),
        pass: U.clamp(Math.round(skills.pass || 50), 1, 100),
        playmaking: U.clamp(Math.round(skills.playmaking || 50), 1, 100),
        tackle: U.clamp(Math.round(skills.tackle || 50), 1, 100),
        finishing: U.clamp(Math.round(skills.finishing || 50), 1, 100),
        technique: U.clamp(Math.round(skills.technique || 50), 1, 100)
      },
      star: isStar(rating),
      // estado dinâmico
      energy: 100, moral: 75, form: 0,
      injuryWeeks: 0, suspended: 0, yellow: 0,
      seasonStats: { games: 0, goals: 0, assists: 0, ratingSum: 0, cards: 0 },
      careerStats: { games: 0, goals: 0, titles: 0 },
      forSale: false, forLoan: false
    };
  }

  function completeSquad(club, rng) {
    const byPos = {};
    for (const p of club.players) byPos[p.pos] = (byPos[p.pos] || 0) + 1;
    const needed = {};
    for (const pos of SQUAD_TEMPLATE) needed[pos] = (needed[pos] || 0) + 1;
    for (const pos of POSITIONS) {
      const missing = (needed[pos] || 0) - (byPos[pos] || 0);
      for (let i = 0; i < missing; i++) {
        club.players.push(generatePlayer(pos, club.nation || club.countryId, club.rating, rng));
      }
    }
  }

  function normalizeClub(raw, countryId, division) {
    return {
      id: raw.id,
      name: raw.name,
      shortName: raw.name.length > 22 ? raw.name.slice(0, 20) + "…" : raw.name,
      countryId,
      division,
      rating: raw.rating || 60,
      stadium: raw.stadium || ("Estádio " + raw.name.split(" ")[0]),
      capacity: raw.capacity || (division === "A" ? 22000 + Math.round(U.RNG.next() * 30000) : 8000 + Math.round(U.RNG.next() * 14000)),
      crest: raw.crest || null,
      money: 0, // definido no início da carreira
      players: (raw.players || []).map(normalizePlayer),
      moralTorcida: 60,
      grass: "Muito bom",
      ticketPrice: 0,
      titles: [],
      nation: countryId
    };
  }

  /* Monta o mundo: para cada país, usa a lista oficial de ligas (A e B) e tenta
     casar cada clube com a base real (elenco + escudo). */
  function buildWorld() {
    const db = window.WORLD_DB_2026;
    const leagues = window.WORLD_LEAGUES_2026.leagues;
    const rng = U.createRng(U.hashString(db.databaseId || "tf26"));

    // índice de clubes reais por país
    const dbByCountry = {};
    for (const c of db.clubs) {
      (dbByCountry[c.country] = dbByCountry[c.country] || []).push({ club: c, tokens: nameTokens(c.name), used: false });
    }

    const world = { season: 2026, countries: {}, clubs: {}, players: {} };

    for (const cid of window.WORLD_LEAGUES_2026.ordered) {
      const conf = leagues[cid];
      const info = COUNTRY_INFO[cid];
      const pool = dbByCountry[cid] || [];
      const country = {
        id: cid, name: info.name, continent: info.continent,
        leagueNameA: conf.nameA, leagueNameB: conf.nameB,
        cupName: conf.cup, relegated: info.relegated,
        promoted: info.relegated, // sobem tantos quantos descem
        continentalCup: info.continentalCup, secondCup: info.secondCup,
        clubIdsA: [], clubIdsB: []
      };

      for (const entry of conf.clubs) {
        const tokens = nameTokens(entry.name);
        let best = null, bestScore = 0.55;
        for (const cand of pool) {
          if (cand.used) continue;
          const s = matchScore(tokens, cand.tokens);
          if (s > bestScore) { bestScore = s; best = cand; }
        }
        let club;
        if (best) {
          best.used = true;
          club = normalizeClub(best.club, cid, entry.division);
          club.rating = Math.max(club.rating, entry.rating || 0);
          club.fullName = club.name;
          club.name = entry.name; // nome amigável da configuração de ligas
          club.shortName = entry.name.length > 22 ? entry.name.slice(0, 20) + "…" : entry.name;
        } else {
          club = normalizeClub({ id: entry.id, name: entry.name, rating: entry.rating }, cid, entry.division);
        }
        completeSquad(club, rng);
        // mantém só um elenco viável (remove excedente muito fraco em clubes gigantes da base)
        club.players.sort((a, b) => b.rating - a.rating);
        if (club.players.length > 30) club.players = club.players.slice(0, 30);
        world.clubs[club.id] = club;
        for (const p of club.players) { p.clubId = club.id; world.players[p.id] = p; }
        (entry.division === "A" ? country.clubIdsA : country.clubIdsB).push(club.id);
      }
      world.countries[cid] = country;
    }
    return world;
  }

  window.TF.world = { buildWorld, POSITIONS, POS_LABEL, valueFor, computeValue, ageValueFactor, isStar, wageFor, generatePlayer, normalizePlayer };
})();
