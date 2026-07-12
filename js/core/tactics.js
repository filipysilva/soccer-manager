"use strict";
/* Sistema tático orientado a dados. Define formações e dimensões táticas e as
   converte em "alavancas" numéricas (resolve) que o MOTOR de partida (match.js) lê
   para produzir efeitos REAIS: distribuição das jogadas, posse, volume e qualidade
   das chances, cruzamentos, contra-ataques, desgaste, faltas, vulnerabilidades.
   Nenhuma opção aqui é decorativa — tudo alimenta o motor. */
(function () {
  const U = window.TF.util;
  const clamp = U.clamp;

  // ---------------- FORMAÇÕES (dados) ----------------
  // Cada formação: linhas do gol (y baixo) ao ataque (y alto). Gera slots + coords.
  function build(rows) {
    const slots = [], coords = [];
    for (const row of rows) for (const [pos, x] of row.cols) { slots.push(pos); coords.push([x, row.y]); }
    return { slots, coords, comp: composition(slots) };
  }
  function composition(slots) {
    const c = { def: 0, mid: 0, att: 0, wingers: 0, fullbacks: 0, strikers: 0, centralMids: 0, wideMen: 0 };
    for (const p of slots) {
      if (["ZAG", "LD", "LE"].includes(p)) c.def++;
      if (["VOL", "MC", "MEI"].includes(p)) { c.mid++; c.centralMids++; }
      if (["PD", "PE", "ATA"].includes(p)) c.att++;
      if (["PD", "PE"].includes(p)) c.wingers++;
      if (["LD", "LE"].includes(p)) c.fullbacks++;
      if (p === "ATA") c.strikers++;
      if (["LD", "LE", "PD", "PE"].includes(p)) c.wideMen++;
    }
    return c;
  }

  const D = [22, 44, 52, 66, 84]; // faixas de y auxiliares
  const FORMATIONS = {
    "4-4-2": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 42, cols: [["VOL", 50]] },
      { y: 52, cols: [["MC", 68], ["MC", 32]] },
      { y: 64, cols: [["MEI", 50]] },
      { y: 84, cols: [["ATA", 62], ["ATA", 38]] }
    ]),
    "4-3-3": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 44, cols: [["VOL", 50]] },
      { y: 54, cols: [["MC", 64], ["MEI", 36]] },
      { y: 78, cols: [["PD", 84], ["PE", 16]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-2-3-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 42, cols: [["VOL", 62], ["VOL", 38]] },
      { y: 64, cols: [["PD", 82], ["MEI", 50], ["PE", 18]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-1-4-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 40, cols: [["VOL", 50]] },
      { y: 55, cols: [["PD", 84], ["MC", 62], ["MC", 38], ["PE", 16]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-3-1-2": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 40, cols: [["VOL", 50]] },
      { y: 50, cols: [["MC", 66], ["MC", 34]] },
      { y: 64, cols: [["MEI", 50]] },
      { y: 84, cols: [["ATA", 60], ["ATA", 40]] }
    ]),
    "4-4-1-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 48, cols: [["PD", 82], ["VOL", 62], ["MC", 38], ["PE", 18]] },
      { y: 66, cols: [["MEI", 50]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-2-2-2": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 42, cols: [["VOL", 62], ["VOL", 38]] },
      { y: 62, cols: [["PD", 82], ["PE", 18]] },
      { y: 84, cols: [["ATA", 60], ["ATA", 40]] }
    ]),
    "4-3-2-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 40, cols: [["VOL", 50]] },
      { y: 50, cols: [["MC", 66], ["MC", 34]] },
      { y: 66, cols: [["MEI", 62], ["MEI", 38]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "3-5-2": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 18, cols: [["ZAG", 68], ["ZAG", 50], ["ZAG", 32]] },
      { y: 40, cols: [["LD", 88], ["LE", 12]] },
      { y: 44, cols: [["VOL", 50]] },
      { y: 58, cols: [["MC", 62], ["MEI", 38]] },
      { y: 84, cols: [["ATA", 60], ["ATA", 40]] }
    ]),
    "3-4-3": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 18, cols: [["ZAG", 68], ["ZAG", 50], ["ZAG", 32]] },
      { y: 46, cols: [["LD", 88], ["MC", 60], ["MC", 40], ["LE", 12]] },
      { y: 78, cols: [["PD", 80], ["PE", 20]] },
      { y: 84, cols: [["ATA", 50]] }
    ]),
    "3-4-2-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 18, cols: [["ZAG", 68], ["ZAG", 50], ["ZAG", 32]] },
      { y: 46, cols: [["LD", 88], ["MC", 60], ["MC", 40], ["LE", 12]] },
      { y: 66, cols: [["MEI", 62], ["MEI", 38]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "5-3-2": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 24, cols: [["LD", 88], ["ZAG", 68], ["ZAG", 50], ["ZAG", 32], ["LE", 12]] },
      { y: 46, cols: [["VOL", 50]] },
      { y: 54, cols: [["MC", 66], ["MC", 34]] },
      { y: 84, cols: [["ATA", 60], ["ATA", 40]] }
    ]),
    "5-4-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 24, cols: [["LD", 88], ["ZAG", 68], ["ZAG", 50], ["ZAG", 32], ["LE", 12]] },
      { y: 46, cols: [["VOL", 66], ["VOL", 34]] },
      { y: 58, cols: [["MC", 62], ["MEI", 38]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-5-1": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 42, cols: [["VOL", 64], ["VOL", 36]] },
      { y: 56, cols: [["PD", 82], ["MEI", 50], ["PE", 18]] },
      { y: 86, cols: [["ATA", 50]] }
    ]),
    "4-2-4": build([
      { y: 6, cols: [["GOL", 50]] },
      { y: 22, cols: [["LD", 85], ["ZAG", 63], ["ZAG", 37], ["LE", 15]] },
      { y: 46, cols: [["VOL", 60], ["VOL", 40]] },
      { y: 78, cols: [["PD", 82], ["PE", 18]] },
      { y: 86, cols: [["ATA", 62], ["ATA", 38]] }
    ])
  };
  const FORMATION_NAMES = Object.keys(FORMATIONS);
  const FORMATION_COORDS = {};
  const FORMATION_SLOTS = {};
  for (const k of FORMATION_NAMES) { FORMATION_COORDS[k] = FORMATIONS[k].coords; FORMATION_SLOTS[k] = FORMATIONS[k].slots; }

  // ---------------- DIMENSÕES TÁTICAS (metadados p/ UI) ----------------
  const DIMENSIONS = {
    focus: {
      label: "Foco ofensivo", key: "focus",
      options: [
        ["equilibrado", "Equilibrado", "Distribui as jogadas entre meio e lados. Sem grande bônus, sem grande fraqueza."],
        ["meio", "Pelo meio", "Passes entre linhas e tabelas. Forte com meias técnicos; sofre contra meio fechado."],
        ["lados", "Pelas laterais", "Pontas e laterais, ultrapassagens e cruzamentos. Deixa espaço nas costas dos laterais."],
        ["esquerda", "Pela esquerda", "Concentra o ataque na esquerda para explorar um lado fraco do rival."],
        ["direita", "Pela direita", "Concentra o ataque na direita para explorar um lado fraco do rival."],
        ["bolas_longas", "Bolas longas", "Lançamentos diretos; menos meio-campo, mais disputa aérea."],
        ["contra_ataque", "Contra-ataques", "Defende organizado e acelera ao recuperar. Letal contra times ofensivos."]
      ]
    },
    buildup: {
      label: "Construção", key: "buildup",
      options: [
        ["trocaPasses", "Troca de passes", "Passes curtos, mais posse e paciência. Sofre contra pressão alta."],
        ["misto", "Jogo misto", "Alterna curto e vertical. Flexível, sem grandes bônus ou riscos."],
        ["ataqueRapido", "Ataque rápido", "Chega ao ataque com poucos passes e profundidade. Favorece velocistas e meias criativos."],
        ["bolaLonga", "Bola longa", "Lançamentos diretos. Favorece jogadores fortes/altos; perde mais a posse."]
      ]
    },
    mentality: {
      label: "Mentalidade", key: "mentality",
      options: [
        ["muito_defensiva", "Muito defensiva", "Time recuado, poucos avançam. Muita proteção, pouca presença ofensiva."],
        ["defensiva", "Defensiva", "Prioriza a solidez, com transições pontuais."],
        ["equilibrada", "Equilibrada", "Equilíbrio entre ataque e defesa."],
        ["ofensiva", "Ofensiva", "Mais jogadores no ataque, mais chances e mais risco atrás."],
        ["muito_ofensiva", "Muito ofensiva", "Pressão total; máximo volume ofensivo e máxima vulnerabilidade."]
      ]
    },
    tempo: {
      label: "Ritmo", key: "tempo",
      options: [
        ["lento", "Lento", "Jogadas calmas, mais posse, menos desgaste e menos transições."],
        ["normal", "Normal", "Ritmo padrão."],
        ["rapido", "Rápido", "Mais ataques e transições, mais desgaste e mais risco de erro."]
      ]
    },
    pressing: {
      label: "Pressão", key: "pressing",
      options: [
        ["baixa", "Baixa", "Espera o adversário. Pouco desgaste, pouca recuperação alta."],
        ["media", "Média", "Pressão equilibrada."],
        ["alta", "Alta", "Recupera a bola no campo adversário e força erros; gasta energia e deixa espaço atrás."]
      ]
    },
    line: {
      label: "Linha defensiva", key: "line",
      options: [
        ["baixa", "Baixa", "Fecha os espaços na frente da área; concede o meio, protege as costas."],
        ["media", "Média", "Linha equilibrada."],
        ["alta", "Alta", "Compacta e adianta o time; vulnerável a bolas em profundidade e velocistas."]
      ]
    },
    width: {
      label: "Largura", key: "width",
      options: [
        ["estreita", "Estreita", "Compacta pelo centro; menos amplitude e menos cruzamentos."],
        ["equilibrada", "Equilibrada", "Largura padrão."],
        ["aberta", "Aberta", "Abre o campo, mais cruzamentos e infiltrações; expõe o centro."]
      ]
    },
    fullbacks: {
      label: "Laterais", key: "fullbacks",
      options: [
        ["presos", "Ficar presos", "Laterais recuados: mais proteção, menos apoio ofensivo."],
        ["equilibrio", "Apoio equilibrado", "Sobem com critério."],
        ["avancar", "Avançar", "Muito apoio e cruzamentos; deixam espaço nas costas e gastam mais."]
      ]
    },
    wingers: {
      label: "Pontas", key: "wingers",
      options: [
        ["abertos", "Ficar abertos", "Amplitude e cruzamentos; menos presença central."],
        ["equilibrio", "Equilibrado", "Comportamento padrão."],
        ["cortar", "Cortar para dentro", "Finalizam mais pelo centro e abrem espaço para o lateral subir."]
      ]
    },
    crosses: {
      label: "Cruzamentos", key: "crosses",
      options: [
        ["altos", "Altos", "Bolas na área; favorece cabeceio e atacantes altos."],
        ["rasteiros", "Rasteiros", "Cruzamentos rasteiros; favorece velocidade e finalização de primeira."],
        ["mistos", "Mistos", "Varia entre altos e rasteiros."]
      ]
    }
  };

  const DEFAULTS = {
    focus: "equilibrado", buildup: "misto", mentality: "equilibrada", tempo: "normal",
    pressing: "media", line: "media", width: "equilibrada", fullbacks: "equilibrio",
    wingers: "equilibrio", crosses: "mistos"
  };

  function defaultTactics(formation) {
    return Object.assign({ formationName: formation || "4-4-2" }, DEFAULTS);
  }

  /* Preenche defaults e migra o formato antigo { style, marking }. */
  function normalize(t) {
    t = t || {};
    const out = Object.assign({}, DEFAULTS, t);
    out.formationName = FORMATIONS[t.formationName] ? t.formationName : (FORMATIONS[t.formation] ? t.formation : "4-4-2");
    // migração de saves antigos
    if (!t.mentality && t.style) out.mentality = t.style === "ataque" ? "ofensiva" : t.style === "retranca" ? "defensiva" : "equilibrada";
    if (!t.pressing && t.marking) out.pressing = t.marking === "muito pesada" ? "alta" : t.marking === "pesada" ? "media" : "baixa";
    if (!t.line && t.style) out.line = t.style === "ataque" ? "alta" : t.style === "retranca" ? "baixa" : "media";
    // valida cada dimensão contra as opções conhecidas
    for (const k of Object.keys(DIMENSIONS)) {
      const valid = DIMENSIONS[k].options.some(o => o[0] === out[k]);
      if (!valid) out[k] = DEFAULTS[k];
    }
    return out;
  }

  const idx = (dim, val) => Math.max(0, DIMENSIONS[dim].options.findIndex(o => o[0] === val)); // 0..n
  const MENT = { muito_defensiva: -2, defensiva: -1, equilibrada: 0, ofensiva: 1, muito_ofensiva: 2 };
  const TRI = { baixa: -1, media: 0, alta: 1, lento: -1, normal: 0, rapido: 1, estreita: -1, equilibrada: 0, aberta: 1, presos: -1, equilibrio: 0, avancar: 1, abertos: 1, cortar: -1 };

  /* Converte a tática em ALAVANCAS numéricas que o motor lê. */
  function resolve(team) {
    const t = normalize(team.tactics || {});
    const comp = FORMATIONS[t.formationName].comp;
    const m = MENT[t.mentality];                 // -2..2
    const press = TRI[t.pressing];               // -1..1
    const line = TRI[t.line];                    // -1..1
    const tempo = TRI[t.tempo];                  // -1..1
    const width = TRI[t.width];                  // -1..1
    const fb = TRI[t.fullbacks];                 // -1..1
    const wg = TRI[t.wingers];                   // 1 abertos / -1 cortar
    const focus = t.focus, build = t.buildup;

    // ---- distribuição das jogadas (setor de origem) ----
    // tendência natural da formação: pontas/laterais puxam para os lados
    let wideBase = 0.30 + comp.wideMen * 0.06 + comp.wingers * 0.05; // ~0.30..0.66
    let left = 0.5, right = 0.5; // fração do ataque de lado que vai para cada lado
    if (focus === "lados") wideBase += 0.22;
    else if (focus === "meio") wideBase -= 0.20;
    else if (focus === "esquerda") { wideBase += 0.20; left = 0.78; right = 0.22; }
    else if (focus === "direita") { wideBase += 0.20; left = 0.22; right = 0.78; }
    else if (focus === "bolas_longas") wideBase -= 0.05;
    wideBase += width * 0.08 + (fb > 0 ? 0.05 : 0) + (wg > 0 ? 0.05 : wg < 0 ? -0.04 : 0);
    const wide = clamp(wideBase, 0.12, 0.82);
    const attCenterW = 1 - wide, attLeftW = wide * left, attRightW = wide * right;

    // ---- construção / diretividade ----
    let directness = 0.5, longBall = 0.12, midInvolve = 1;
    if (build === "trocaPasses") { directness = 0.22; midInvolve = 1.18; }
    else if (build === "misto") { directness = 0.5; midInvolve = 1; }
    else if (build === "ataqueRapido") { directness = 0.72; midInvolve = 0.9; }
    else if (build === "bolaLonga") { directness = 0.9; longBall = 0.4; midInvolve = 0.72; }
    if (focus === "bolas_longas") { longBall = Math.max(longBall, 0.42); directness = Math.max(directness, 0.82); midInvolve *= 0.8; }
    if (focus === "contra_ataque") directness = Math.max(directness, 0.6);

    // ---- posse (multiplica a força de meio para a partilha) ----
    let possMult = 1 + midInvolve * 0.0; // base
    possMult *= build === "trocaPasses" ? 1.14 : build === "bolaLonga" ? 0.85 : 1;
    possMult *= tempo === -1 ? 1.08 : tempo === 1 ? 0.94 : 1;
    possMult *= press > 0 ? 1.05 : press < 0 ? 0.98 : 1;
    possMult *= focus === "contra_ataque" ? 0.9 : 1;
    possMult *= m >= 1 ? 1.03 : m <= -1 ? 0.97 : 1;

    // ---- volume e qualidade das chances ----
    let chanceVol = 1 + m * 0.06 + tempo * 0.05;
    if (build === "ataqueRapido") chanceVol += 0.05;
    if (focus === "contra_ataque") chanceVol -= 0.14; // menos ataques posicionais
    let chanceQual = 1 + (build === "ataqueRapido" ? 0.06 : 0) + (focus === "contra_ataque" ? 0.10 : 0);

    // ---- cruzamentos / bola aérea ----
    let crossFreq = 0.5 + comp.wingers * 0.06 + comp.fullbacks * 0.03;
    crossFreq += focus === "lados" ? 0.28 : (focus === "esquerda" || focus === "direita") ? 0.2 : 0;
    crossFreq += (t.wingers === "abertos" ? 0.12 : t.wingers === "cortar" ? -0.14 : 0) + (fb > 0 ? 0.14 : fb < 0 ? -0.1 : 0);
    crossFreq += width * 0.08 + (build === "bolaLonga" ? 0.1 : 0);
    crossFreq = clamp(crossFreq, 0.15, 1.6);
    const crossHigh = t.crosses === "altos" ? 0.85 : t.crosses === "rasteiros" ? 0.15 : 0.5;

    // ---- contra-ataque ----
    let counter = focus === "contra_ataque" ? 0.7 : 0.12;
    counter += m <= -1 ? 0.12 : 0;
    counter += line < 0 ? 0.06 : 0;
    counter = clamp(counter, 0, 0.85);

    // ---- forças de setor (mult) ----
    let defMult = 1 - m * 0.05 + (line < 0 ? 0.04 : line > 0 ? -0.05 : 0) + (fb < 0 ? 0.04 : fb > 0 ? -0.04 : 0) + (width < 0 ? 0.03 : 0);
    let midMult = 1 + (build === "trocaPasses" ? 0.06 : 0) + (focus === "meio" ? 0.08 : 0) + (comp.centralMids - 3) * 0.03 + (width < 0 ? 0.03 : 0);
    let attMult = 1 + m * 0.05 + (focus === "meio" ? 0.03 : 0);
    // pressão adversária alta reduz a criação de quem constrói curto — tratado no motor via oppPress

    // ---- espaço nas costas (vulnerabilidade) ----
    let spaceBehind = 0.15 + (line > 0 ? 0.22 : line < 0 ? -0.08 : 0) + (press > 0 ? 0.14 : 0) + (fb > 0 ? 0.12 : 0) + (m >= 2 ? 0.1 : 0);
    spaceBehind = clamp(spaceBehind, 0.02, 0.7);

    // ---- desgaste ----
    let energyMult = 1 + (tempo > 0 ? 0.14 : tempo < 0 ? -0.1 : 0) + (press > 0 ? 0.14 : press < 0 ? -0.06 : 0) + (m >= 1 ? 0.06 : 0) + (fb > 0 ? 0.05 : 0) + (t.wingers === "cortar" ? 0.03 : 0);

    // ---- faltas / cartões / recuperação alta ----
    let foulMult = 1 + (press > 0 ? 0.28 : press < 0 ? -0.1 : 0) + (m <= -1 ? 0.08 : 0);
    let highRecovery = clamp(0.15 + press * 0.22, 0.02, 0.6); // chance de recuperar no ataque e forçar erro do rival
    let forcedError = clamp(press * 0.16, -0.05, 0.22);       // erro que ESTE time força no adversário (via pressing)

    return {
      formationName: t.formationName, comp,
      attCenterW, attLeftW, attRightW, wide,
      directness, longBall, midInvolve,
      possMult, chanceVol: clamp(chanceVol, 0.7, 1.4), chanceQual: clamp(chanceQual, 0.85, 1.25),
      crossFreq, crossHigh, counter,
      defMult: clamp(defMult, 0.85, 1.18), midMult: clamp(midMult, 0.85, 1.2), attMult: clamp(attMult, 0.85, 1.2),
      spaceBehind, energyMult: clamp(energyMult, 0.82, 1.4), foulMult: clamp(foulMult, 0.8, 1.5),
      highRecovery, forcedError, mentality: m, pressing: press, line, tempo
    };
  }

  /* Avisos de incompatibilidade tática (não impedem, apenas informam). */
  function warnings(team) {
    const t = normalize(team.tactics || {});
    const comp = FORMATIONS[t.formationName].comp;
    const xi = (team.lineup || []).filter(s => s.player).map(s => s.player);
    if (!xi.length) return [];
    const avg = fn => xi.reduce((a, p) => a + fn(p), 0) / xi.length;
    const has = fn => xi.some(fn);
    const w = [];
    const wings = xi.filter(p => ["PD", "PE"].includes(p.pos));
    const fbs = xi.filter(p => ["LD", "LE"].includes(p.pos));
    const atts = xi.filter(p => p.pos === "ATA");
    const zags = xi.filter(p => p.pos === "ZAG");

    if ((t.focus === "lados" || t.crosses === "altos") && comp.wingers + comp.fullbacks < 2)
      w.push("Ataque/cruzamentos pelos lados com poucos pontas e laterais.");
    if (t.crosses === "altos" && atts.length && avg2(atts, p => p.skills.finishing) < 68 && !has(p => p.traits.includes("Cabeceio")))
      w.push("Cruzamentos altos sem atacante forte no jogo aéreo.");
    if (t.line === "alta" && zags.length && avg2(zags, p => p.skills.speed) < 62)
      w.push("Linha alta com zagueiros lentos — risco em bolas em profundidade.");
    if (t.pressing === "alta" && avg(p => p.energy) < 55)
      w.push("Pressão alta com o time cansado — desgaste e espaços atrás.");
    if (t.buildup === "trocaPasses" && avg(p => (p.skills.pass + p.skills.technique) / 2) < 62)
      w.push("Troca de passes com jogadores tecnicamente fracos.");
    if (t.buildup === "bolaLonga" && !has(p => p.pos === "ATA") && !has(p => p.traits.includes("Velocidade")))
      w.push("Bola longa sem atacante de referência nem jogadores rápidos.");
    if (t.fullbacks === "avancar" && comp.centralMids < 2)
      w.push("Laterais avançando com pouca proteção no meio.");
    if (t.mentality === "muito_ofensiva" && comp.att >= 3)
      w.push("Formação muito ofensiva com mentalidade muito ofensiva — frágil nas transições.");
    if (t.focus === "meio" && comp.centralMids < 3)
      w.push("Jogo pelo meio com poucos jogadores na região central.");
    return w;
  }
  function avg2(arr, fn) { return arr.reduce((a, p) => a + fn(p), 0) / arr.length; }

  // ---------------- IA: perfis de técnico e escolha de tática ----------------
  // Cada perfil é um conjunto de preferências que MUDAM as decisões da IA (não é rótulo).
  const PROFILES = {
    equilibrado: {},
    ofensivo: { mentality: "ofensiva", pressing: "media", line: "media", tempo: "normal", fullbacks: "avancar" },
    defensivo: { mentality: "defensiva", pressing: "baixa", line: "baixa", buildup: "misto", fullbacks: "presos" },
    posse: { buildup: "trocaPasses", tempo: "lento", pressing: "media", focus: "meio", width: "estreita" },
    ataque_rapido: { buildup: "ataqueRapido", tempo: "rapido", mentality: "ofensiva" },
    bola_longa: { buildup: "bolaLonga", focus: "bolas_longas", crosses: "altos" },
    contra_ataque: { focus: "contra_ataque", mentality: "defensiva", line: "baixa", pressing: "baixa" },
    lados: { focus: "lados", wingers: "abertos", fullbacks: "avancar", width: "aberta", crosses: "altos" },
    meio: { focus: "meio", buildup: "trocaPasses", width: "estreita" },
    pressao: { pressing: "alta", line: "alta", tempo: "rapido", mentality: "ofensiva" }
  };
  const PROFILE_KEYS = Object.keys(PROFILES);

  // escolhe a formação que melhor aproveita o elenco
  function bestFormation(club) {
    const strong = pos => club.players.filter(p => p.pos === pos && p.rating >= club.rating - 8).length;
    const wingers = strong("PD") + strong("PE");
    const strikers = strong("ATA");
    const cbs = strong("ZAG");
    if (cbs >= 3 && wingers >= 2) return "3-4-3";
    if (cbs >= 3 && strikers >= 2) return "3-5-2";
    if (wingers >= 2 && strikers >= 1) return "4-3-3";
    if (strikers >= 2 && wingers < 2) return "4-4-2";
    if (strong("MEI") >= 2) return "4-2-3-1";
    return "4-4-2";
  }

  // perfil consistente por clube (estilo do "técnico" da IA)
  function clubProfile(club) {
    const h = U.hashString(club.id + "|coach");
    // clubes fortes tendem a ser mais propositivos
    const pool = club.rating >= 80
      ? ["ofensivo", "posse", "lados", "pressao", "equilibrado", "ataque_rapido", "meio"]
      : club.rating >= 70
        ? ["equilibrado", "ofensivo", "lados", "ataque_rapido", "contra_ataque", "defensivo", "meio"]
        : ["defensivo", "contra_ataque", "bola_longa", "equilibrado", "lados"];
    return pool[h % pool.length];
  }

  function aiTactics(club, profileKey) {
    const prof = PROFILES[profileKey || clubProfile(club)] || {};
    const t = Object.assign(defaultTactics(bestFormation(club)), prof);
    return normalize(t);
  }

  const MENT_ORDER = ["muito_defensiva", "defensiva", "equilibrada", "ofensiva", "muito_ofensiva"];
  function stepMentality(val, delta) {
    const i = clamp(MENT_ORDER.indexOf(val) + delta, 0, 4);
    return MENT_ORDER[i];
  }

  /* Ajuste reativo da IA durante a partida (placar/minuto). Retorna nova tática (cópia). */
  function reactTactics(tactics, ctx) {
    const t = Object.assign({}, normalize(tactics));
    const diff = ctx.myGoals - ctx.oppGoals; // >0 vencendo
    if (ctx.minute >= 60) {
      if (diff <= -2) { t.mentality = "muito_ofensiva"; t.pressing = "alta"; t.line = "alta"; t.fullbacks = "avancar"; }
      else if (diff === -1) { t.mentality = stepMentality(t.mentality, 1); if (ctx.minute >= 75) t.pressing = "alta"; }
      else if (diff >= 2 && ctx.minute >= 70) { t.mentality = "defensiva"; t.line = "baixa"; t.pressing = "baixa"; t.fullbacks = "presos"; }
      else if (diff === 1 && ctx.minute >= 80) { t.mentality = stepMentality(t.mentality, -1); }
    }
    if (ctx.redCard) { t.mentality = stepMentality(t.mentality, -1); t.pressing = "baixa"; }
    if (ctx.avgEnergy < 45) t.pressing = t.pressing === "alta" ? "media" : t.pressing; // poupa quando cansado
    return t;
  }

  window.TF.tactics = {
    FORMATIONS, FORMATION_NAMES, FORMATION_COORDS, FORMATION_SLOTS, DIMENSIONS, DEFAULTS, PROFILES, PROFILE_KEYS,
    defaultTactics, normalize, resolve, warnings, composition, bestFormation, clubProfile, aiTactics, reactTactics, stepMentality
  };
})();
