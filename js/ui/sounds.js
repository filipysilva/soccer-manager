"use strict";
/* Sons de estádio sintetizados em tempo real (Web Audio):
   multidão constante, explosão da torcida no gol, "ôôô" em chances,
   apito com vibrato, aplausos em substituição. Sem arquivos externos. */
(function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  let ambience = null; // { gain, sources }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // ruído branco reutilizável
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* Onda de torcida: ruído filtrado com envelope (ataque, pico, decaimento). */
  function crowdSwell(opts) {
    if (!audio() || !enabled) return;
    const o = Object.assign({ attack: 0.08, hold: 0.1, decay: 1.2, peak: 0.3, freq: 900, q: 0.6, delay: 0 }, opts);
    const t0 = ctx.currentTime + o.delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = o.freq; bp.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.peak), t0 + o.attack);
    g.gain.setValueAtTime(Math.max(0.001, o.peak), t0 + o.attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.attack + o.hold + o.decay);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + o.attack + o.hold + o.decay + 0.1);
  }

  /* Apito de árbitro: oscilador agudo com vibrato rápido (trinado). */
  function whistleBurst(t0, dur) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 2350;
    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 38;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 240;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.015);
    g.gain.setValueAtTime(0.11, t0 + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(hp); hp.connect(g); g.connect(master);
    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
  }

  function whistle(pattern) {
    if (!audio() || !enabled) return;
    const t = ctx.currentTime;
    if (pattern === "short") whistleBurst(t, 0.22);
    else if (pattern === "double") { whistleBurst(t, 0.25); whistleBurst(t + 0.35, 0.35); }
    else if (pattern === "long") whistleBurst(t, 0.7);
    else if (pattern === "final") { whistleBurst(t, 0.25); whistleBurst(t + 0.33, 0.25); whistleBurst(t + 0.66, 0.9); }
  }

  /* Aplausos: rajadas curtas de ruído em sequência irregular. */
  function applause(duration, peak) {
    if (!audio() || !enabled) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(); src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    // modulação irregular imitando palmas coletivas
    const steps = Math.floor(duration * 22);
    for (let i = 0; i < steps; i++) {
      const t = t0 + (i / steps) * duration;
      const env = Math.sin((i / steps) * Math.PI); // cresce e diminui
      g.gain.linearRampToValueAtTime(peak * env * (0.55 + Math.random() * 0.45), t);
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + duration);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + duration + 0.1);
  }

  /* Multidão de fundo contínua durante a partida. */
  function startAmbience() {
    if (!audio() || !enabled || ambience) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(); src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 620;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 1.2);
    // ondulação lenta (torcida "respirando")
    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.016;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(); lfo.start();
    ambience = { src, lfo, gain: g };
  }

  function stopAmbience() {
    if (!ambience) return;
    const a = ambience; ambience = null;
    try {
      a.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      a.src.stop(ctx.currentTime + 1); a.lfo.stop(ctx.currentTime + 1);
    } catch (e) { /* já parado */ }
  }

  /* Eventos do jogo → sons. */
  function play(type) {
    if (!enabled) return;
    switch (type) {
      case "goal":
        if (!audio()) return;
        whistleBurst(ctx.currentTime, 0.18);
        crowdSwell({ attack: 0.06, hold: 0.5, decay: 2.6, peak: 0.5, freq: 950, q: 0.5 });
        crowdSwell({ attack: 0.1, hold: 0.4, decay: 2.2, peak: 0.25, freq: 500, q: 0.6, delay: 0.05 });
        applause(2.2, 0.10);
        break;
      case "goalOther": // gol em outro jogo da rodada: rugido distante
        crowdSwell({ attack: 0.1, hold: 0.15, decay: 1.1, peak: 0.12, freq: 700, q: 0.7 });
        break;
      case "chance": case "miss":
        crowdSwell({ attack: 0.12, hold: 0.06, decay: 0.9, peak: 0.22, freq: 850, q: 0.8 }); // "ôôô"
        break;
      case "save":
        crowdSwell({ attack: 0.1, hold: 0.05, decay: 0.7, peak: 0.16, freq: 1000, q: 0.8 });
        applause(0.9, 0.05);
        break;
      case "corner":
        crowdSwell({ attack: 0.15, hold: 0.1, decay: 0.8, peak: 0.1, freq: 800, q: 0.8 });
        break;
      case "foul":
        whistle("short");
        break;
      case "yellow": case "red":
        whistle("short");
        crowdSwell({ attack: 0.1, hold: 0.2, decay: 1.1, peak: type === "red" ? 0.25 : 0.13, freq: 550, q: 0.7, delay: 0.15 }); // vaias
        break;
      case "penalty":
        whistle("long");
        crowdSwell({ attack: 0.3, hold: 0.6, decay: 1.4, peak: 0.28, freq: 750, q: 0.7, delay: 0.2 });
        break;
      case "injury":
        crowdSwell({ attack: 0.25, hold: 0.2, decay: 1.2, peak: 0.1, freq: 420, q: 0.8 }); // murmúrio
        break;
      case "sub":
        applause(1.4, 0.07);
        break;
      case "counter":
        crowdSwell({ attack: 0.15, hold: 0.1, decay: 0.7, peak: 0.12, freq: 900, q: 0.8 });
        break;
      case "half":
        whistle("double");
        break;
      case "end":
        whistle("final");
        crowdSwell({ attack: 0.2, hold: 0.6, decay: 2.4, peak: 0.3, freq: 800, q: 0.6, delay: 0.5 });
        applause(2.6, 0.09);
        break;
      case "whistle": case "kickoff":
        whistle("long");
        break;
    }
  }

  window.TF.sounds = {
    play, startAmbience, stopAmbience,
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      if (!enabled) stopAmbience();
      return enabled;
    }
  };
})();
