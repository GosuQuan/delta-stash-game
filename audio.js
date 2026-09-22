/**
 * 仓储拍卖 · Web Audio SFX (offline, no samples/CDN)
 * Layered cues: crate open → loot reveal → grid snap; rarity fanfares.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "deltaStashMute";
  const MASTER = 0.62; // louder default; short envelopes keep peaks from clipping

  let ctx = null;
  let masterGain = null;
  let muted = false;
  let lastHoverValid = null;
  let lastHoverAt = 0;
  let lastPickupAt = 0;
  let lastPlaceAt = 0;
  let lastRotateAt = 0;
  let lastReturnAt = 0;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_) { /* ignore */ }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : MASTER;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  function now() {
    return ensureCtx() ? ctx.currentTime : 0;
  }

  function setMuted(m) {
    muted = !!m;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (_) { /* ignore */ }
    if (masterGain) {
      const t = now();
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setTargetAtTime(muted ? 0 : MASTER, t, 0.02);
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function isMuted() {
    return muted;
  }

  /** Soft noise burst via buffer (metal/latch texture). */
  function noiseBuffer(duration, color) {
    const c = ensureCtx();
    if (!c) return null;
    const rate = c.sampleRate;
    const len = Math.max(1, Math.floor(rate * duration));
    const buf = c.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (color === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else if (color === "pink") {
        last = 0.98 * last + 0.02 * white;
        data[i] = white * 0.4 + last * 0.6;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  function playNoise(opts) {
    const c = ensureCtx();
    if (!c || !masterGain || muted) return;
    const {
      duration = 0.08,
      color = "white",
      gain = 0.15,
      when = 0,
      filterType = "bandpass",
      freq = 800,
      q = 1.2,
      attack = 0.004,
      decay = 0.06,
    } = opts;
    const buf = noiseBuffer(duration + 0.05, color);
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = c.createGain();
    const t0 = (when || 0) + c.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    src.connect(filt);
    filt.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  function playTone(opts) {
    const c = ensureCtx();
    if (!c || !masterGain || muted) return;
    const {
      freq = 440,
      freqEnd = null,
      type = "sine",
      gain = 0.12,
      when = 0,
      attack = 0.008,
      decay = 0.12,
      sustain = 0,
      release = 0.08,
      detune = 0,
    } = opts;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const g = c.createGain();
    const t0 = (when || 0) + c.currentTime;
    const peak = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    const holdEnd = t0 + attack + sustain;
    if (sustain > 0) g.gain.setValueAtTime(peak * 0.85, holdEnd);
    g.gain.exponentialRampToValueAtTime(0.0001, holdEnd + decay + release);
    if (freqEnd != null && freqEnd !== freq) {
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), holdEnd + decay);
    }
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(holdEnd + decay + release + 0.02);
  }

  function playChord(freqs, opts) {
    const baseGain = (opts && opts.gain) || 0.08;
    const when = (opts && opts.when) || 0;
    const type = (opts && opts.type) || "triangle";
    const decay = (opts && opts.decay) || 0.28;
    freqs.forEach((f, i) => {
      playTone({
        freq: f,
        type,
        gain: baseGain * (1 - i * 0.12),
        when: when + i * 0.012,
        attack: 0.01,
        decay,
        sustain: (opts && opts.sustain) || 0.04,
        release: 0.1,
      });
    });
  }

  // ---------- Layer 1: Crate open — hall×tier matrix (游戏商业化) ----------
  /**
   * Spend-feel ladder + locked open durations (skippable in UI):
   *   普通 ≈ 0.8s  short / snappy — never tedious
   *   精选 ≈ 1.2s  medium tension (lockpick + gear)
   *   密封·限时 ≈ 2.0–2.5s ceremonial (bolts + ratchet + vault)
   * Hall timbre/verb layered on top; 赤金厅 adds EXTRA spatial reverb taps.
   */
  const OPEN_TIMING = {
    // 普通 — quick industrial click, no ceremony
    common: {
      totalMs: 800,
      phases: [
        { at: 0,   cue: "撬锁…",   sfx: "lockpick" },
        { at: 180, cue: "开闩…",   sfx: "unlatch" },
        { at: 420, cue: "掀盖…",   sfx: "lid" },
      ],
    },
    // 精选 — short lockpick + audible gear
    rare: {
      totalMs: 1200,
      phases: [
        { at: 0,   cue: "撬锁芯…", sfx: "lockpick" },
        { at: 280, cue: "齿轮咬合…", sfx: "ratchet" },
        { at: 620, cue: "铰链吱呀…", sfx: "creak" },
        { at: 900, cue: "柜盖开启…", sfx: "lid" },
      ],
    },
    // 密封 — heavy vault ceremony (~2.2s)
    sealed: {
      totalMs: 2200,
      phases: [
        { at: 0,    cue: "工业撬锁…", sfx: "lockpickHeavy" },
        { at: 380,  cue: "螺栓回撤…", sfx: "bolts" },
        { at: 780,  cue: "棘轮转动…", sfx: "ratchet" },
        { at: 1200, cue: "重门缓开…", sfx: "creak" },
        { at: 1680, cue: "金库启封…", sfx: "lid" },
      ],
    },
    // 限时 — longest ceremonial (~2.5s) + sparkle on lid
    limited: {
      totalMs: 2500,
      phases: [
        { at: 0,    cue: "仪式开锁…", sfx: "lockpickHeavy" },
        { at: 420,  cue: "三重螺栓…", sfx: "bolts" },
        { at: 860,  cue: "精密齿轮…", sfx: "ratchet" },
        { at: 1300, cue: "重门缓开…", sfx: "creak" },
        { at: 1800, cue: "限时启封…", sfx: "lid" },
        { at: 2100, cue: "仪式钟响…", sfx: "chime" },
      ],
    },
  };

  /** Timbre profiles (depths) — timing lives in OPEN_TIMING.phases */
  const CRATE_TIER_SFX = {
    common: {
      latchFreq: 3200, latchQ: 2.8, latchGain: 0.13, latchDur: 0.032,
      bodyFreq: 210, bodyEnd: 140, bodyGain: 0.045, bodyDecay: 0.05,
      creakFreq: 200, creakEnd: 140, creakGain: 0.02, creakType: "triangle",
      creakNoiseFreq: 700, creakNoiseGain: 0.035, creakDur: 0.1,
      lidThump: 140, lidEnd: 95, lidGain: 0.08, lidNoiseFreq: 420, lidNoiseGain: 0.1, lidDur: 0.07,
      hingeFreq: 680, hingeEnd: 420, hingeGain: 0.025,
      sparkle: false, vault: false, lockpickPins: 2, ratchetTicks: 3, boltCount: 0,
    },
    rare: {
      latchFreq: 2100, latchQ: 4.2, latchGain: 0.175, latchDur: 0.05,
      bodyFreq: 155, bodyEnd: 78, bodyGain: 0.095, bodyDecay: 0.12,
      creakFreq: 135, creakEnd: 68, creakGain: 0.055, creakType: "sawtooth",
      creakNoiseFreq: 400, creakNoiseGain: 0.11, creakDur: 0.28,
      lidThump: 88, lidEnd: 50, lidGain: 0.135, lidNoiseFreq: 260, lidNoiseGain: 0.17, lidDur: 0.13,
      hingeFreq: 500, hingeEnd: 260, hingeGain: 0.042,
      sparkle: false, vault: false, lockpickPins: 4, ratchetTicks: 5, boltCount: 1,
    },
    sealed: {
      latchFreq: 1100, latchQ: 6.5, latchGain: 0.24, latchDur: 0.07,
      bodyFreq: 78, bodyEnd: 36, bodyGain: 0.14, bodyDecay: 0.2,
      creakFreq: 88, creakEnd: 40, creakGain: 0.075, creakType: "sawtooth",
      creakNoiseFreq: 220, creakNoiseGain: 0.15, creakDur: 0.4,
      lidThump: 52, lidEnd: 28, lidGain: 0.18, lidNoiseFreq: 160, lidNoiseGain: 0.22, lidDur: 0.18,
      hingeFreq: 320, hingeEnd: 150, hingeGain: 0.05,
      sparkle: false, vault: true, lockpickPins: 6, ratchetTicks: 8, boltCount: 3,
    },
    limited: {
      latchFreq: 1250, latchQ: 7, latchGain: 0.23, latchDur: 0.065,
      bodyFreq: 70, bodyEnd: 32, bodyGain: 0.15, bodyDecay: 0.22,
      creakFreq: 95, creakEnd: 42, creakGain: 0.07, creakType: "triangle",
      creakNoiseFreq: 240, creakNoiseGain: 0.14, creakDur: 0.38,
      lidThump: 48, lidEnd: 26, lidGain: 0.19, lidNoiseFreq: 170, lidNoiseGain: 0.21, lidDur: 0.2,
      hingeFreq: 620, hingeEnd: 340, hingeGain: 0.055,
      sparkle: true, vault: true, lockpickPins: 7, ratchetTicks: 9, boltCount: 3,
    },
  };

  /**
   * Hall matrix — timbre + wetness on every open.
   * 赤金 spatial:true → extra multi-tap room on top of base wet.
   */
  const HALL_OPEN_SFX = {
    none: {
      wet: 0, delay: 0.04, feedback: 0, tone: 0, toneGain: 0,
      noiseFreq: 4000, noiseGain: 0, color: "white", spatial: false,
    },
    bronze_hall: {
      wet: 0.2, delay: 0.045, feedback: 0.16, tone: 392, toneGain: 0.026,
      noiseFreq: 2300, noiseGain: 0.038, color: "pink", spatial: false,
    },
    jade_hall: {
      wet: 0.28, delay: 0.058, feedback: 0.2, tone: 659.25, toneGain: 0.03,
      noiseFreq: 3600, noiseGain: 0.032, color: "white", spatial: false,
    },
    silver_hall: {
      wet: 0.32, delay: 0.062, feedback: 0.22, tone: 523.25, toneGain: 0.032,
      noiseFreq: 2800, noiseGain: 0.04, color: "pink", spatial: false,
    },
    platinum_hall: {
      wet: 0.36, delay: 0.07, feedback: 0.26, tone: 440, toneGain: 0.038,
      noiseFreq: 2000, noiseGain: 0.048, color: "white", spatial: false,
    },
    // 赤金厅 — darkest / wettest + dedicated spatial layer
    crimson_hall: {
      wet: 0.42, delay: 0.082, feedback: 0.32, tone: 185, toneGain: 0.045,
      noiseFreq: 1200, noiseGain: 0.06, color: "brown", spatial: true,
    },
  };

  function tierOpenProfile(tierId) {
    return CRATE_TIER_SFX[tierId] || CRATE_TIER_SFX.rare;
  }

  function hallOpenProfile(hallId) {
    return HALL_OPEN_SFX[hallId] || HALL_OPEN_SFX.none;
  }

  function getCrateOpenTiming(tierId) {
    const t = OPEN_TIMING[tierId] || OPEN_TIMING.rare;
    return {
      totalMs: t.totalMs,
      phases: t.phases.map((p) => ({ at: p.at, cue: p.cue, sfx: p.sfx })),
    };
  }

  /** Base hall wet tap (delay+feedback). */
  function playHallVerbBurst(hallId, when) {
    const c = ensureCtx();
    if (!c || !masterGain || muted) return;
    const hall = hallOpenProfile(hallId);
    if (!hall.wet) return;
    const t0 = c.currentTime + (when || 0);
    const buf = noiseBuffer(0.24, hall.color);
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = hall.noiseFreq;
    filt.Q.value = 1.1;
    const dryG = c.createGain();
    dryG.gain.setValueAtTime(0.0001, t0);
    dryG.gain.exponentialRampToValueAtTime(Math.max(0.0002, hall.noiseGain * hall.wet), t0 + 0.02);
    dryG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    const delay = c.createDelay(0.5);
    delay.delayTime.value = hall.delay;
    const fb = c.createGain();
    fb.gain.value = hall.feedback;
    const wetG = c.createGain();
    wetG.gain.value = hall.wet * 0.9;
    src.connect(filt);
    filt.connect(dryG);
    dryG.connect(masterGain);
    dryG.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wetG);
    wetG.connect(masterGain);
    src.start(t0);
    src.stop(t0 + 0.3);
    if (hall.tone > 0 && hall.toneGain > 0) {
      const toneType = hallId === "jade_hall" ? "sine" : hallId === "crimson_hall" ? "triangle" : "sawtooth";
      playTone({
        freq: hall.tone,
        freqEnd: hall.tone * 0.9,
        type: toneType,
        gain: hall.toneGain,
        when: when || 0,
        attack: 0.02,
        decay: 0.3 + hall.wet * 0.3,
        sustain: 0.05,
      });
      playTone({
        freq: hall.tone * (hallId === "jade_hall" ? 1.5 : 0.98),
        type: "sine",
        gain: hall.toneGain * 0.55,
        when: (when || 0) + hall.delay,
        attack: 0.02,
        decay: 0.34,
        sustain: 0.04,
      });
    }
  }

  /**
   * 赤金厅 exclusive — multi-tap spatial reverb on top of hall wet.
   * Long airy tails so premium hall opens feel like a bigger room.
   */
  function playCrimsonSpatial(when) {
    const c = ensureCtx();
    if (!c || !masterGain || muted) return;
    const t0 = c.currentTime + (when || 0);
    const taps = [
      { delay: 0.055, gain: 0.12, freq: 900 },
      { delay: 0.11, gain: 0.09, freq: 650 },
      { delay: 0.185, gain: 0.07, freq: 480 },
      { delay: 0.28, gain: 0.05, freq: 320 },
      { delay: 0.4, gain: 0.035, freq: 220 },
    ];
    const buf = noiseBuffer(0.35, "brown");
    if (!buf) return;
    taps.forEach((tap) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      const filt = c.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = tap.freq;
      filt.Q.value = 0.7;
      const delay = c.createDelay(0.6);
      delay.delayTime.value = tap.delay;
      const g = c.createGain();
      const start = t0 + tap.delay * 0.15;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, tap.gain), start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      src.connect(filt);
      filt.connect(delay);
      delay.connect(g);
      g.connect(masterGain);
      src.start(t0);
      src.stop(t0 + 0.5);
    });
    // Deep hall tone bloom
    playTone({
      freq: 98,
      freqEnd: 72,
      type: "sine",
      gain: 0.055,
      when: when || 0,
      attack: 0.04,
      decay: 0.55,
      sustain: 0.08,
    });
    playTone({
      freq: 147,
      type: "triangle",
      gain: 0.03,
      when: (when || 0) + 0.08,
      attack: 0.05,
      decay: 0.5,
      sustain: 0.06,
    });
  }

  /**
   * Industrial lockpick — pin tumbler clicks (Web Audio).
   * heavy: denser / lower pins for 密封·限时.
   */
  function playLockpick(tierId, heavy) {
    resume();
    const p = tierOpenProfile(tierId);
    const pins = heavy ? Math.max(p.lockpickPins, 5) : p.lockpickPins;
    const baseGap = heavy ? 0.055 : 0.042;
    for (let i = 0; i < pins; i++) {
      const when = i * baseGap + (i % 3 === 2 ? 0.012 : 0);
      const freq = (heavy ? 1800 : 2400) - i * (heavy ? 140 : 180) + (i % 2) * 90;
      playNoise({
        duration: 0.028,
        color: "white",
        gain: 0.11 - i * 0.008,
        when,
        filterType: "bandpass",
        freq: Math.max(700, freq),
        q: 9 + (i % 3),
        attack: 0.001,
        decay: 0.022,
      });
      playTone({
        freq: Math.max(280, 920 - i * 55),
        freqEnd: Math.max(180, 520 - i * 40),
        type: "triangle",
        gain: 0.035 - i * 0.002,
        when: when + 0.004,
        attack: 0.001,
        decay: 0.04,
      });
    }
    // Final pin set "click-thunk"
    const fin = pins * baseGap + 0.02;
    playNoise({
      duration: 0.04,
      color: "pink",
      gain: heavy ? 0.14 : 0.1,
      when: fin,
      filterType: "bandpass",
      freq: heavy ? 1100 : 1600,
      q: 6,
      attack: 0.001,
      decay: 0.035,
    });
    playTone({
      freq: heavy ? 110 : 160,
      freqEnd: heavy ? 55 : 90,
      type: "square",
      gain: heavy ? 0.07 : 0.05,
      when: fin + 0.008,
      attack: 0.002,
      decay: 0.08,
    });
  }

  /**
   * Gear / ratchet ticks — mechanical advance (Web Audio).
   * Faster for 精选, slower denser for vault tiers.
   */
  function playRatchet(tierId) {
    resume();
    const p = tierOpenProfile(tierId);
    const ticks = p.ratchetTicks || 4;
    const gap = p.vault ? 0.07 : 0.055;
    for (let i = 0; i < ticks; i++) {
      const when = i * gap;
      const pitch = (p.vault ? 380 : 520) + (i % 2) * 40 - i * 8;
      playTone({
        freq: pitch,
        freqEnd: pitch * 0.72,
        type: "sawtooth",
        gain: 0.048 - i * 0.0025,
        when,
        attack: 0.001,
        decay: 0.045,
      });
      playNoise({
        duration: 0.035,
        color: "white",
        gain: 0.085 - i * 0.004,
        when: when + 0.002,
        filterType: "bandpass",
        freq: p.vault ? 1400 + i * 30 : 2200 + i * 40,
        q: 7,
        attack: 0.001,
        decay: 0.028,
      });
      // Soft gear grind underlay every other tick
      if (i % 2 === 0) {
        playTone({
          freq: p.vault ? 70 : 95,
          freqEnd: p.vault ? 48 : 70,
          type: "triangle",
          gain: 0.03,
          when: when + 0.01,
          attack: 0.008,
          decay: 0.06,
        });
      }
    }
    // End clack — gear seats
    const endAt = ticks * gap;
    playNoise({
      duration: 0.05,
      color: "pink",
      gain: 0.12,
      when: endAt,
      filterType: "lowpass",
      freq: p.vault ? 500 : 800,
      q: 1.2,
      attack: 0.002,
      decay: 0.05,
    });
  }

  /** Multi-bolt retract — industrial deadbolts sliding (密封/限时). */
  function playBolts(tierId) {
    resume();
    const p = tierOpenProfile(tierId);
    const n = Math.max(1, p.boltCount || 2);
    for (let i = 0; i < n; i++) {
      const when = i * 0.11;
      // Metal scrape of bolt sliding
      playNoise({
        duration: 0.09,
        color: "pink",
        gain: 0.13,
        when,
        filterType: "bandpass",
        freq: 750 - i * 80,
        q: 3.5,
        attack: 0.008,
        decay: 0.08,
      });
      playTone({
        freq: 190 - i * 25,
        freqEnd: 90 - i * 12,
        type: "sawtooth",
        gain: 0.055,
        when: when + 0.01,
        attack: 0.01,
        decay: 0.1,
      });
      // Seat clunk
      playTone({
        freq: 62 - i * 6,
        freqEnd: 38,
        type: "square",
        gain: 0.08,
        when: when + 0.055,
        attack: 0.002,
        decay: 0.09,
      });
      playNoise({
        duration: 0.04,
        color: "white",
        gain: 0.1,
        when: when + 0.05,
        filterType: "bandpass",
        freq: 480,
        q: 5,
        attack: 0.001,
        decay: 0.035,
      });
    }
  }

  /** Vault bolt clunk — 密封/限时 only (heavy spend signal). */
  function playVaultBolt(tierId) {
    resume();
    const deep = tierId === "limited" ? 0.95 : 1;
    playNoise({
      duration: 0.06,
      color: "white",
      gain: 0.2 * deep,
      when: 0,
      filterType: "bandpass",
      freq: 900,
      q: 8,
      attack: 0.001,
      decay: 0.05,
    });
    playTone({
      freq: 55,
      freqEnd: 32,
      type: "square",
      gain: 0.09 * deep,
      when: 0.015,
      attack: 0.003,
      decay: 0.14,
    });
    playTone({
      freq: 220,
      freqEnd: 90,
      type: "triangle",
      gain: 0.06,
      when: 0.04,
      attack: 0.004,
      decay: 0.12,
    });
  }

  /** Limited ceremonial chime (luxury spend signal). */
  function playCeremonialChime() {
    resume();
    playChord([523.25, 659.25, 783.99], { gain: 0.04, when: 0, type: "sine", decay: 0.55, sustain: 0.08 });
    playTone({ freq: 1046.5, type: "sine", gain: 0.022, when: 0.12, attack: 0.01, decay: 0.4, sustain: 0.05 });
    playTone({ freq: 130, freqEnd: 98, type: "triangle", gain: 0.045, when: 0.02, attack: 0.02, decay: 0.35, sustain: 0.05 });
  }

  function crateUnlatch(tierId, hallId) {
    resume();
    const p = tierOpenProfile(tierId);
    const hall = hallOpenProfile(hallId);
    if (p.vault) playVaultBolt(tierId);
    playNoise({
      duration: p.latchDur,
      color: "white",
      gain: p.latchGain,
      when: p.vault ? 0.05 : 0,
      filterType: "bandpass",
      freq: p.latchFreq,
      q: p.latchQ,
      attack: 0.001,
      decay: Math.max(0.025, p.latchDur * 0.85),
    });
    playTone({
      freq: p.bodyFreq,
      freqEnd: p.bodyEnd,
      type: "square",
      gain: p.bodyGain,
      when: (p.vault ? 0.05 : 0) + 0.015,
      attack: 0.002,
      decay: p.bodyDecay,
    });
    playHallVerbBurst(hallId, 0.01);
    if (hall.spatial) playCrimsonSpatial(0.02);
    if (hall.wet > 0) {
      playNoise({
        duration: 0.045,
        color: hall.color,
        gain: 0.028 * hall.wet,
        when: hall.delay,
        filterType: "bandpass",
        freq: p.latchFreq * 0.8,
        q: 2.4,
        attack: 0.001,
        decay: 0.05,
      });
    }
  }

  function crateCreak(tierId, hallId) {
    resume();
    const p = tierOpenProfile(tierId);
    playTone({
      freq: p.creakFreq,
      freqEnd: p.creakEnd,
      type: p.creakType,
      gain: p.creakGain,
      when: 0,
      attack: 0.02,
      decay: p.vault ? 0.42 : 0.32,
      sustain: p.vault ? 0.1 : 0.06,
    });
    playNoise({
      duration: p.creakDur,
      color: "brown",
      gain: p.creakNoiseGain,
      when: 0.02,
      filterType: "lowpass",
      freq: p.creakNoiseFreq,
      q: 0.7,
      attack: 0.03,
      decay: p.creakDur * 0.85,
    });
    playHallVerbBurst(hallId, 0.05);
    if (hallOpenProfile(hallId).spatial) playCrimsonSpatial(0.06);
  }

  function crateLid(tierId, hallId) {
    resume();
    const p = tierOpenProfile(tierId);
    playNoise({
      duration: p.lidDur,
      color: "pink",
      gain: p.lidNoiseGain,
      when: 0,
      filterType: "lowpass",
      freq: p.lidNoiseFreq,
      q: 0.8,
      attack: 0.004,
      decay: p.lidDur * 0.8,
    });
    playTone({
      freq: p.lidThump,
      freqEnd: p.lidEnd,
      type: "triangle",
      gain: p.lidGain,
      when: 0.01,
      attack: 0.005,
      decay: p.vault ? 0.28 : 0.16,
    });
    // Sub boom for vault tiers — "spending big"
    if (p.vault) {
      playTone({
        freq: 42,
        freqEnd: 28,
        type: "sine",
        gain: 0.1,
        when: 0.005,
        attack: 0.008,
        decay: 0.32,
        sustain: 0.04,
      });
    }
    playTone({
      freq: p.hingeFreq,
      freqEnd: p.hingeEnd,
      type: "sine",
      gain: p.hingeGain,
      when: 0.04,
      attack: 0.01,
      decay: 0.2,
    });
    if (p.sparkle) {
      playChord([784, 988, 1175], { gain: 0.032, when: 0.1, type: "sine", decay: 0.4, sustain: 0.05 });
      playTone({ freq: 1568, type: "sine", gain: 0.02, when: 0.18, attack: 0.005, decay: 0.25 });
    }
    playHallVerbBurst(hallId, 0.03);
    if (hallOpenProfile(hallId).spatial) playCrimsonSpatial(0.05);
  }

  /** Play one open-phase SFX by name (used by sequenced open + skip). */
  function playOpenPhaseSfx(sfx, tierId, hallId) {
    switch (sfx) {
      case "lockpick":
        playLockpick(tierId, false);
        break;
      case "lockpickHeavy":
        playLockpick(tierId, true);
        break;
      case "bolts":
        playBolts(tierId);
        break;
      case "ratchet":
        playRatchet(tierId);
        break;
      case "unlatch":
        crateUnlatch(tierId, hallId);
        break;
      case "creak":
        crateCreak(tierId, hallId);
        break;
      case "lid":
        crateLid(tierId, hallId);
        break;
      case "chime":
        playCeremonialChime();
        if (hallOpenProfile(hallId).spatial) playCrimsonSpatial(0.04);
        break;
      default:
        break;
    }
  }

  /**
   * hall×tier open sequence driven by OPEN_TIMING phases.
   * Returns { totalMs, timers, cancel } so UI can skip.
   */
  function crateOpenSequence(tierId, hallId) {
    resume();
    const id = tierId || "rare";
    const hall = hallId || null;
    const timing = getCrateOpenTiming(id);
    const timers = [];
    timing.phases.forEach((ph) => {
      const tid = setTimeout(() => playOpenPhaseSfx(ph.sfx, id, hall), ph.at);
      timers.push(tid);
    });
    return {
      totalMs: timing.totalMs,
      phases: timing.phases,
      timers,
      cancel() {
        timers.forEach((t) => clearTimeout(t));
        timers.length = 0;
      },
    };
  }

  // ---------- Layer 2: Loot reveal / rolling ----------
  function lootTick(index, rarityId) {
    resume();
    const base = 380 + (index % 5) * 28;
    playTone({
      freq: base,
      type: "triangle",
      gain: 0.045,
      when: 0,
      attack: 0.004,
      decay: 0.07,
    });
    playNoise({
      duration: 0.04,
      color: "white",
      gain: 0.05,
      when: 0,
      filterType: "highpass",
      freq: 1800,
      q: 0.8,
      attack: 0.002,
      decay: 0.035,
    });
    // Soft rarity hint on tick (not the big fanfare)
    if (rarityId === "purple" || rarityId === "xiaojin" || rarityId === "dajin") {
      playTone({
        freq: 660,
        type: "sine",
        gain: 0.03,
        when: 0.02,
        attack: 0.005,
        decay: 0.1,
      });
    }
  }

  function lootRevealEnd() {
    resume();
    playTone({
      freq: 220,
      freqEnd: 330,
      type: "sine",
      gain: 0.06,
      when: 0,
      attack: 0.01,
      decay: 0.2,
    });
  }

  // ---------- Layer 3: Grid place / snap (distinct from open) ----------
  function pickup() {
    resume();
    const t = performance.now();
    if (t - lastPickupAt < 80) return;
    lastPickupAt = t;
    playTone({
      freq: 520,
      freqEnd: 680,
      type: "sine",
      gain: 0.07,
      when: 0,
      attack: 0.004,
      decay: 0.07,
    });
    playNoise({
      duration: 0.03,
      color: "white",
      gain: 0.04,
      when: 0,
      filterType: "bandpass",
      freq: 3200,
      q: 2,
      attack: 0.001,
      decay: 0.025,
    });
  }

  function hoverTick(valid) {
    resume();
    const t = performance.now();
    if (t - lastHoverAt < 90) return;
    if (lastHoverValid === valid && t - lastHoverAt < 160) return;
    lastHoverAt = t;
    lastHoverValid = valid;
    if (valid) {
      playTone({
        freq: 880,
        type: "sine",
        gain: 0.025,
        when: 0,
        attack: 0.002,
        decay: 0.04,
      });
    } else {
      playTone({
        freq: 180,
        type: "triangle",
        gain: 0.022,
        when: 0,
        attack: 0.002,
        decay: 0.05,
      });
    }
  }

  function placeSnap() {
    resume();
    const t = performance.now();
    if (t - lastPlaceAt < 70) return;
    lastPlaceAt = t;
    // Soft wood/plastic snap — mid thump + bright click (NOT crate latch)
    playTone({
      freq: 160,
      freqEnd: 110,
      type: "triangle",
      gain: 0.1,
      when: 0,
      attack: 0.002,
      decay: 0.07,
    });
    playTone({
      freq: 940,
      type: "sine",
      gain: 0.055,
      when: 0.012,
      attack: 0.002,
      decay: 0.05,
    });
    playNoise({
      duration: 0.035,
      color: "pink",
      gain: 0.07,
      when: 0,
      filterType: "bandpass",
      freq: 1400,
      q: 2.5,
      attack: 0.001,
      decay: 0.03,
    });
  }

  function rotate() {
    resume();
    const t = performance.now();
    if (t - lastRotateAt < 60) return;
    lastRotateAt = t;
    playTone({
      freq: 420,
      freqEnd: 560,
      type: "triangle",
      gain: 0.055,
      when: 0,
      attack: 0.003,
      decay: 0.06,
    });
    playTone({
      freq: 560,
      freqEnd: 420,
      type: "sine",
      gain: 0.035,
      when: 0.04,
      attack: 0.003,
      decay: 0.06,
    });
  }

  function returnStaging() {
    resume();
    const t = performance.now();
    if (t - lastReturnAt < 80) return;
    lastReturnAt = t;
    playTone({
      freq: 360,
      freqEnd: 240,
      type: "sine",
      gain: 0.06,
      when: 0,
      attack: 0.005,
      decay: 0.1,
    });
    playNoise({
      duration: 0.05,
      color: "brown",
      gain: 0.05,
      when: 0.01,
      filterType: "lowpass",
      freq: 500,
      q: 0.8,
      attack: 0.004,
      decay: 0.05,
    });
  }

  function settleClick() {
    resume();
    // Cash-register-ish settle (original synth, short)
    playTone({
      freq: 880,
      type: "square",
      gain: 0.045,
      when: 0,
      attack: 0.003,
      decay: 0.06,
    });
    playTone({
      freq: 1175,
      type: "square",
      gain: 0.04,
      when: 0.07,
      attack: 0.003,
      decay: 0.08,
    });
    playTone({
      freq: 1480,
      type: "sine",
      gain: 0.05,
      when: 0.14,
      attack: 0.005,
      decay: 0.18,
    });
    playChord([523.25, 659.25, 783.99], {
      gain: 0.04,
      when: 0.18,
      type: "triangle",
      decay: 0.35,
      sustain: 0.06,
    });
  }

  function settleWin() {
    resume();
    // Short bright rise: positive P/L feels rewarding without stealing the show.
    playTone({ freq: 392, freqEnd: 659.25, type: "triangle", gain: 0.07, when: 0, attack: 0.004, decay: 0.16 });
    playChord([523.25, 659.25, 783.99], { gain: 0.055, when: 0.08, type: "sine", decay: 0.28, sustain: 0.04 });
  }

  function settleLoss() {
    resume();
    // Soft blunt downbeat: clearly different, but inviting rather than punishing.
    playTone({ freq: 250, freqEnd: 175, type: "triangle", gain: 0.055, when: 0, attack: 0.006, decay: 0.18 });
    playNoise({ duration: 0.06, color: "brown", gain: 0.025, when: 0.015, filterType: "lowpass", freq: 420, q: 0.7, attack: 0.004, decay: 0.06 });
  }

  /** 「热手」— short bright cheer after 3 profitable settles. */
  function hotHand() {
    resume();
    playTone({ freq: 523.25, freqEnd: 784, type: "triangle", gain: 0.07, when: 0, attack: 0.004, decay: 0.14 });
    playChord([659.25, 830.61, 1046.5], { gain: 0.05, when: 0.06, type: "sine", decay: 0.28, sustain: 0.05 });
    playTone({ freq: 1318.5, type: "sine", gain: 0.035, when: 0.16, attack: 0.003, decay: 0.18 });
  }

  /** 「冷手」— soft chill after 3 losses; inviting, not punishing. */
  function coldHand() {
    resume();
    playTone({ freq: 220, freqEnd: 165, type: "sine", gain: 0.045, when: 0, attack: 0.01, decay: 0.28 });
    playChord([196, 246.94], { gain: 0.03, when: 0.05, type: "triangle", decay: 0.35, sustain: 0.04 });
    playNoise({ duration: 0.08, color: "brown", gain: 0.018, when: 0.02, filterType: "lowpass", freq: 280, q: 0.6, attack: 0.008, decay: 0.08 });
  }

  function uiClick() {
    resume();
    playTone({
      freq: 640,
      type: "sine",
      gain: 0.04,
      when: 0,
      attack: 0.003,
      decay: 0.05,
    });
  }

  // ---------- Rarity fanfares (reveal stings) ----------
  function rarityPurple() {
    resume();
    // Distinct purple "hit"
    playTone({
      freq: 311,
      type: "sawtooth",
      gain: 0.06,
      when: 0,
      attack: 0.008,
      decay: 0.22,
    });
    playChord([466.16, 587.33, 739.99], {
      gain: 0.055,
      when: 0.04,
      type: "triangle",
      decay: 0.4,
      sustain: 0.08,
    });
    playNoise({
      duration: 0.08,
      color: "pink",
      gain: 0.08,
      when: 0,
      filterType: "bandpass",
      freq: 900,
      q: 1.5,
      attack: 0.004,
      decay: 0.08,
    });
  }

  function rarityGold(small) {
    resume();
    // Premium shimmer — below red climax
    const boost = small ? 0.9 : 1.05;
    playChord(
      small ? [523.25, 659.25, 830.61] : [587.33, 739.99, 987.77],
      {
        gain: 0.065 * boost,
        when: 0,
        type: "triangle",
        decay: small ? 0.38 : 0.48,
        sustain: 0.1,
      }
    );
    playTone({
      freq: small ? 1046 : 1175,
      type: "sine",
      gain: 0.05 * boost,
      when: 0.08,
      attack: 0.01,
      decay: 0.35,
    });
    playNoise({
      duration: 0.12,
      color: "white",
      gain: 0.06,
      when: 0.02,
      filterType: "highpass",
      freq: 2500,
      q: 0.6,
      attack: 0.01,
      decay: 0.12,
    });
  }

  /** 「爆了」— louder, peaky, shareable red sting (小红/大红 stand out on recordings). */
  function rarityRed(big) {
    resume();
    // Higher peak than other rarities; short envelopes avoid harsh clipping
    const peak = big ? 0.28 : 0.22;
    // Sub hit — punchier
    playTone({
      freq: 70,
      freqEnd: 45,
      type: "sine",
      gain: peak * 1.05,
      when: 0,
      attack: 0.003,
      decay: 0.3,
    });
    // Bright body / impact
    playNoise({
      duration: 0.12,
      color: "white",
      gain: peak * 0.85,
      when: 0,
      filterType: "bandpass",
      freq: 1600,
      q: 1.2,
      attack: 0.002,
      decay: 0.1,
    });
    // Extra mid thump for phone speakers
    playTone({
      freq: 110,
      freqEnd: 80,
      type: "triangle",
      gain: peak * 0.55,
      when: 0.015,
      attack: 0.004,
      decay: 0.18,
    });
    // Ascending victory sparkles
    const notes = big
      ? [392, 523.25, 659.25, 783.99, 1046.5]
      : [349.23, 440, 554.37, 698.46];
    notes.forEach((f, i) => {
      playTone({
        freq: f,
        type: i === notes.length - 1 ? "sine" : "triangle",
        gain: (peak * 0.7) * (0.75 + i * 0.1),
        when: 0.05 + i * 0.055,
        attack: 0.005,
        decay: 0.24 + i * 0.04,
        sustain: 0.04,
      });
    });
    // Final octave sparkle (大红 louder)
    playTone({
      freq: big ? 1568 : 1318.5,
      type: "sine",
      gain: peak * 0.58,
      when: 0.05 + notes.length * 0.055,
      attack: 0.007,
      decay: 0.5,
      sustain: 0.06,
    });
    if (big) {
      playChord([523.25, 659.25, 783.99, 1046.5], {
        gain: 0.11,
        when: 0.28,
        type: "triangle",
        decay: 0.6,
        sustain: 0.14,
      });
      // Extra climax shimmer for 大红
      playNoise({
        duration: 0.15,
        color: "pink",
        gain: peak * 0.35,
        when: 0.32,
        filterType: "highpass",
        freq: 2200,
        q: 0.7,
        attack: 0.01,
        decay: 0.14,
      });
    }
  }

  /**
   * Play rarity reveal sting if purple+.
   * Returns true if a fanfare played.
   */
  function rarityFanfare(rarityId) {
    switch (rarityId) {
      case "dahong":
        rarityRed(true);
        return true;
      case "xiaohong":
        rarityRed(false);
        return true;
      case "yanjin":
        rarityGold(false);
        // slight orange sting via second gold-ish call path
        return true;
      case "dajin":
        rarityGold(false);
        return true;
      case "xiaojin":
        rarityGold(true);
        return true;
      case "pink":
        rarityPurple();
        return true;
      case "purple":
        rarityPurple();
        return true;
      default:
        return false;
    }
  }

  /**
   * Open SFX matrix: tier = industrial depth (普通 snappy → 精选 gear → 密封/限时 vault),
   * hall = timbre/wet; 赤金厅 adds extra spatial reverb taps.
   * Durations locked (游戏商业化): 普通 0.8s / 精选 1.2s / 密封 2.2s / 限时 2.5s.
   * @param {string} [tierId] common|rare|sealed|limited
   * @param {string|null} [hallId] bronze_hall|jade_hall|crimson_hall|null
   * @returns {{ totalMs:number, phases:Array, timers:number[], cancel:Function }}
   */
  function playCrateOpen(tierId, hallId) {
    return crateOpenSequence(tierId || "rare", hallId || null);
  }

  const AudioFX = {
    resume,
    setMuted,
    toggleMute,
    isMuted,
    playCrateOpen,
    getCrateOpenTiming,
    playOpenPhaseSfx,
    playLockpick,
    playRatchet,
    playBolts,
    crateUnlatch,
    crateCreak,
    crateLid,
    lootTick,
    lootRevealEnd,
    rarityFanfare,
    pickup,
    hoverTick,
    placeSnap,
    rotate,
    returnStaging,
    settleClick,
    settleWin,
    settleLoss,
    hotHand,
    coldHand,
    uiClick,
  };

  global.AudioFX = AudioFX;
})(typeof window !== "undefined" ? window : globalThis);
