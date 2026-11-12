// Skyground Citadel: all sound is synthesised here with the Web Audio API. There are no audio files.
//
// THE SCORE. The design bible asks for "cheerful marimba and plucked-string music". One tune, arranged eight ways:
//   form      A A B A, eight bars each (32 bars), on a 16th-note grid
//   theme A   C | G | Am | F | C | G | F G | C      the skipping "sky" tune (a note, a rest, two notes)
//   theme B   Am | F | C | G | Am | F | Dm | G      the bridge: longer notes that climb back into A
//   theme C   Am | Am | F | E | Am | Dm | E | Am    the gauntlet's own minor tune
//   0 title     slow harp and pad, the tune on a music box
//   1 meadow    marimba tune, plucked arpeggio, bass on one and three, a light shaker
//   2 boardwalk adds a bouncing bass, wood block, a soft kick and a flute line under the tune
//   3 swing     no drums: harp sixteenths, pad, the tune on a glockenspiel (airy, for the grapple)
//   4 rail      driving: four-on-the-floor kick, claps, hats, eighth-note bass, the tune doubled an octave up
//   5 gauntlet  theme C: staccato marimba, toms, string stabs on the off-beats
//   6 stair     theme A a whole tone higher with everything in: kick, claps, hats, brass stabs, flute, bells
//   7 finale    after the finish: the tune on a glockenspiel over harp and pad, still in the lifted key
// A change of arrangement lands on a bar line after a short cymbal swell; the last bar of every eight has a fill. Everything goes
// through a small synthetic reverb so the dry oscillators sit in a space.
//
// The playtester listened to the first version (2026-11-11): the effects were liked, the music "can go a lot further". This is that pass.
// It has run headless without errors but nobody has heard THIS version yet. M mutes; every call is a no-op until a key press
// or click has allowed audio to start.

const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const _ = null;

// Tunes: one row per bar, eight 8th-notes per bar; null is a rest.
const THEME_A = [
  [72, _, 76, 79, _, 76, 79, 84],
  [83, _, 79, 74, _, 79, 74, _],
  [81, _, 76, 72, _, 76, 81, 84],
  [81, _, 77, 72, _, 77, 79, 81],
  [84, _, 79, 76, _, 79, 84, 88],
  [86, _, 83, 79, _, 83, 86, _],
  [84, 81, 77, 81, 83, 79, 74, 79],
  [84, _, _, 79, 84, _, _, _],
];
const THEME_B = [
  [81, _, 84, _, 88, _, 84, _],
  [81, _, 84, _, 89, _, 84, _],
  [79, _, 84, _, 88, _, 84, 79],
  [79, _, 83, _, 86, _, 83, _],
  [81, _, 84, _, 88, 91, 88, 84],
  [81, _, 84, 89, _, 84, 81, _],
  [77, _, 81, _, 86, _, 81, 77],
  [79, 83, 86, 91, _, 86, 91, 95],
];
const THEME_C = [
  [81, _, 76, 72, _, 76, 81, 84],
  [83, _, 81, 76, _, 72, 76, _],
  [81, _, 77, 72, _, 77, 81, 84],
  [83, _, 80, 76, _, 80, 83, _],
  [84, _, 81, 76, _, 81, 84, 88],
  [86, _, 81, 77, _, 81, 86, _],
  [83, 80, 76, 80, 83, 86, 88, _],
  [81, _, _, 76, 81, _, _, _],
];
// Chords: root (bass register) and the triad an octave above it. A bar may hold two chords (half a bar each).
const CH = {
  C: { root: 36, tones: [48, 52, 55] },
  G: { root: 31, tones: [47, 50, 55] },
  Am: { root: 33, tones: [48, 52, 57] },
  F: { root: 29, tones: [48, 53, 57] },
  Dm: { root: 38, tones: [50, 53, 57] },
  E: { root: 28, tones: [47, 52, 56] },
};
const PROG_A = [['C'], ['G'], ['Am'], ['F'], ['C'], ['G'], ['F', 'G'], ['C']];
const PROG_B = [['Am'], ['F'], ['C'], ['G'], ['Am'], ['F'], ['Dm'], ['G']];
const PROG_C = [['Am'], ['Am'], ['F'], ['E'], ['Am'], ['Dm'], ['E'], ['Am']];
const FORM_MAJOR = [
  { tune: THEME_A, prog: PROG_A },
  { tune: THEME_A, prog: PROG_A },
  { tune: THEME_B, prog: PROG_B },
  { tune: THEME_A, prog: PROG_A },
];
const FORM_MINOR = [{ tune: THEME_C, prog: PROG_C }];

// The seven arrangements. `lead`: which voice plays the tune; flags switch the other parts on.
const ARR = [
  {
    name: 'title',
    bpm: 92,
    form: FORM_MAJOR,
    lead: 'box',
    leadEvery: 2,
    pad: true,
    harp: 8,
    reverb: 0.5,
  },
  {
    name: 'meadow',
    bpm: 112,
    form: FORM_MAJOR,
    lead: 'marimba',
    pluck: 8,
    bass: 'two',
    shaker: true,
    reverb: 0.3,
  },
  {
    name: 'boardwalk',
    bpm: 116,
    form: FORM_MAJOR,
    lead: 'marimba',
    pluck: 8,
    bass: 'bounce',
    shaker: true,
    block: true,
    kick: 'two',
    flute: true,
    reverb: 0.3,
  },
  {
    name: 'swing',
    bpm: 104,
    form: FORM_MAJOR,
    lead: 'glock',
    pad: true,
    harp: 16,
    bass: 'one',
    chimes: true,
    reverb: 0.55,
  },
  {
    name: 'rail',
    bpm: 124,
    form: FORM_MAJOR,
    lead: 'marimba',
    octave: true,
    pluck: 16,
    bass: 'eighths',
    kick: 'four',
    clap: true,
    hats: true,
    reverb: 0.28,
  },
  {
    name: 'gauntlet',
    bpm: 126,
    form: FORM_MINOR,
    lead: 'marimba',
    staccato: true,
    bass: 'eighths',
    toms: true,
    stabs: 'off',
    hats: true,
    kick: 'two',
    reverb: 0.3,
  },
  {
    name: 'stair',
    bpm: 120,
    form: FORM_MAJOR,
    lift: 2,
    lead: 'marimba',
    octave: true,
    pluck: 16,
    bass: 'eighths',
    kick: 'four',
    clap: true,
    hats: true,
    stabs: 'brass',
    flute: true,
    reverb: 0.36,
  },
  {
    name: 'finale',
    bpm: 100,
    form: FORM_MAJOR,
    lift: 2,
    lead: 'glock',
    pad: true,
    harp: 8,
    bass: 'one',
    chimes: true,
    reverb: 0.5,
  },
];
const COIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19]; // a rising pentatonic run for pickups collected in quick succession

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let reverb = null; // convolver
  let musicWet = null;
  let noiseBuf = null;
  let muted = false;
  let timer = null;
  let wind = null; // { gain, filter }
  let grind = null; // { src, gain }
  let falls = null; // { gain }
  const song = { on: false, step: 0, next: 0, arr: 1, want: 1, bars: 0 };

  function ensure() {
    if (ctx) return true;
    const AC =
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch {
      return false;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(comp);
    comp.connect(ctx.destination);
    // A small hall: 2.4 s of decaying noise as the impulse response.
    reverb = ctx.createConvolver();
    {
      const len = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      let seed = 987654;
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          seed = (seed * 1664525 + 1013904223) | 0;
          d[i] = ((seed >>> 8) / 8388608 - 1) * Math.pow(1 - i / len, 2.8);
        }
      }
      reverb.buffer = ir;
    }
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.9;
    reverb.connect(wetOut);
    wetOut.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3;
    musicBus.connect(master);
    musicWet = ctx.createGain();
    musicWet.gain.value = 0.3;
    musicBus.connect(musicWet);
    musicWet.connect(reverb);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.75;
    sfxBus.connect(master);
    const sfxWet = ctx.createGain();
    sfxWet.gain.value = 0.1;
    sfxBus.connect(sfxWet);
    sfxWet.connect(reverb);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) | 0;
      d[i] = (seed >>> 8) / 8388608 - 1;
    }
    // Wind: a quiet band of noise whose level and brightness follow Kai's speed through the air.
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBus);
      src.start();
      wind = { gain, filter };
    }
    return true;
  }

  /** Route a node to a bus, through a stereo panner when one is asked for and the browser has it. */
  function out(node, bus, pan) {
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      p.connect(bus);
    } else node.connect(bus);
  }

  /**
   * One enveloped oscillator. `slide` glides the pitch over the note, `vibrato` (Hz of depth) wobbles it, `lp` puts a low-pass
   * filter on it, `sustain` holds the level for that share of the note before it decays (0 = a struck sound).
   */
  function tone({
    freq,
    type = 'sine',
    t = 0,
    dur = 0.2,
    vol = 0.2,
    attack = 0.004,
    slide = 0,
    bus = sfxBus,
    vibrato = 0,
    vibRate = 20,
    pan = 0,
    lp = 0,
    sustain = 0,
    detune = 0,
  }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.value = detune;
    if (slide)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vibRate;
      const depth = ctx.createGain();
      depth.gain.value = vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    if (sustain)
      g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur * sustain));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let tail = g;
    osc.connect(g);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      g.connect(f);
      tail = f;
    }
    out(tail, bus, pan);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** A burst of filtered noise. */
  function noise({
    t = 0,
    dur = 0.1,
    vol = 0.2,
    type = 'lowpass',
    freq = 800,
    slide = 0,
    q = 0.8,
    bus = sfxBus,
    attack = 0.005,
    pan = 0,
  }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slide)
      f.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    out(g, bus, pan);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  // ----- instruments (music bus) -----
  const M = () => musicBus;
  const marimba = (n, t, vol, dur = 0.42, pan = 0) => {
    const f = midi(n);
    tone({ freq: f, t, dur, vol, bus: M(), pan });
    tone({ freq: f * 4, t, dur: 0.09, vol: vol * 0.28, bus: M(), pan });
    tone({ freq: f * 9.2, t, dur: 0.03, vol: vol * 0.1, bus: M(), pan }); // the mallet's click
  };
  const pluck = (n, t, vol, pan = 0) => {
    const f = midi(n);
    tone({ freq: f, type: 'triangle', t, dur: 0.34, vol, bus: M(), pan });
    tone({ freq: f * 2, t, dur: 0.12, vol: vol * 0.25, bus: M(), pan });
  };
  const harp = (n, t, vol, pan = 0) => {
    const f = midi(n);
    tone({ freq: f, type: 'triangle', t, dur: 0.9, vol, bus: M(), pan });
    tone({ freq: f * 2, t, dur: 0.4, vol: vol * 0.3, bus: M(), pan });
    tone({ freq: f * 3, t, dur: 0.15, vol: vol * 0.12, bus: M(), pan });
  };
  const glock = (n, t, vol, pan = 0) => {
    const f = midi(n);
    tone({ freq: f, t, dur: 0.9, vol, bus: M(), pan });
    tone({ freq: f * 2.76, t, dur: 0.35, vol: vol * 0.3, bus: M(), pan });
    tone({ freq: f * 5.4, t, dur: 0.12, vol: vol * 0.12, bus: M(), pan });
  };
  const flute = (n, t, vol, dur) => {
    const f = midi(n);
    tone({
      freq: f,
      t,
      dur,
      vol,
      attack: 0.07,
      sustain: 0.7,
      vibrato: f * 0.006,
      vibRate: 5.2,
      bus: M(),
      pan: -0.25,
    });
    tone({
      freq: f * 2,
      t,
      dur,
      vol: vol * 0.18,
      attack: 0.09,
      sustain: 0.6,
      bus: M(),
      pan: -0.25,
    });
    noise({
      t,
      dur: 0.12,
      vol: vol * 0.25,
      type: 'bandpass',
      freq: f * 2,
      q: 2,
      bus: M(),
      attack: 0.03,
    }); // breath
  };
  const pad = (notes, t, dur, vol) => {
    for (const n of notes) {
      tone({
        freq: midi(n),
        t,
        dur,
        vol,
        attack: dur * 0.3,
        sustain: 0.6,
        bus: M(),
        detune: -5,
        pan: -0.3,
      });
      tone({
        freq: midi(n),
        type: 'triangle',
        t,
        dur,
        vol: vol * 0.5,
        attack: dur * 0.3,
        sustain: 0.6,
        bus: M(),
        detune: 6,
        pan: 0.3,
        lp: 1400,
      });
    }
  };
  const bass = (n, t, vol, dur = 0.3) => {
    const f = midi(n);
    tone({
      freq: f,
      type: 'triangle',
      t,
      dur,
      vol,
      sustain: 0.3,
      bus: M(),
      lp: 900,
    });
    tone({ freq: f, t, dur: dur * 1.2, vol: vol * 0.7, bus: M() });
  };
  const stab = (notes, t, vol, bright) => {
    for (const n of notes) {
      tone({
        freq: midi(n),
        type: 'sawtooth',
        t,
        dur: bright ? 0.24 : 0.14,
        vol: vol * 0.5,
        attack: 0.012,
        sustain: bright ? 0.5 : 0,
        bus: M(),
        lp: bright ? 2200 : 1300,
        detune: -7,
        pan: 0.2,
      });
      tone({
        freq: midi(n),
        type: 'sawtooth',
        t,
        dur: bright ? 0.24 : 0.14,
        vol: vol * 0.5,
        attack: 0.012,
        sustain: bright ? 0.5 : 0,
        bus: M(),
        lp: bright ? 2200 : 1300,
        detune: 7,
        pan: -0.2,
      });
    }
  };
  const kick = (t, vol) =>
    tone({ freq: 125, t, dur: 0.16, vol, slide: 44, bus: M() });
  const clap = (t, vol) => {
    noise({ t, dur: 0.02, vol, type: 'bandpass', freq: 1500, q: 1, bus: M() });
    noise({
      t: t + 0.012,
      dur: 0.1,
      vol,
      type: 'bandpass',
      freq: 1500,
      q: 1,
      bus: M(),
    });
  };
  const hat = (t, vol) =>
    noise({
      t,
      dur: 0.03,
      vol,
      type: 'highpass',
      freq: 8500,
      bus: M(),
      pan: 0.3,
    });
  const shaker = (t, vol) =>
    noise({
      t,
      dur: 0.06,
      vol,
      type: 'highpass',
      freq: 6000,
      bus: M(),
      attack: 0.015,
      pan: -0.3,
    });
  const block = (t, vol, hi) => {
    tone({ freq: hi ? 1250 : 900, t, dur: 0.05, vol, bus: M(), pan: 0.4 });
    tone({
      freq: hi ? 1900 : 1380,
      t,
      dur: 0.03,
      vol: vol * 0.4,
      bus: M(),
      pan: 0.4,
    });
  };
  const tom = (t, vol, f) =>
    tone({
      freq: f,
      t,
      dur: 0.2,
      vol,
      slide: f * 0.6,
      bus: M(),
      pan: (f - 130) / 200,
    });
  const swell = (t, dur, vol) =>
    noise({
      t,
      dur,
      vol,
      type: 'highpass',
      freq: 4000,
      slide: 9000,
      bus: M(),
      attack: dur * 0.85,
    });
  const bell = (f, t, vol, dur = 0.45) => {
    tone({ freq: f, t, dur, vol });
    tone({ freq: f * 2.01, t, dur: dur * 0.6, vol: vol * 0.35 });
    tone({ freq: f * 3.02, t, dur: dur * 0.3, vol: vol * 0.15 });
  };

  /** Schedule one 16th-note step of the current arrangement at context time `when`. */
  function scheduleStep(step, when) {
    const t = when - ctx.currentTime;
    const s16 = step % 16; // position in the bar
    if (s16 === 0) {
      // Bar line: a wanted arrangement takes over here, from the top of the form.
      if (song.want !== song.arr) {
        song.arr = song.want;
        song.bars = 0;
        if (musicWet)
          musicWet.gain.setTargetAtTime(
            ARR[song.arr].reverb,
            ctx.currentTime,
            0.4
          );
      }
    }
    const A = ARR[song.arr];
    const tr = A.lift || 0;
    const bar = song.bars;
    const section = A.form[Math.floor(bar / 8) % A.form.length];
    const b = bar % 8;
    const chords = section.prog[b];
    const chord = CH[chords.length > 1 && s16 >= 8 ? chords[1] : chords[0]];
    const tones = chord.tones;
    const sd = 60 / A.bpm / 4; // one 16th
    const on8 = s16 % 2 === 0;
    const e8 = s16 / 2; // 8th index when on8
    const lastBar = b === 7;
    const pass = Math.floor(bar / 8); // which eight-bar section we are in

    // The tune.
    if (on8) {
      const note = section.tune[b][e8];
      const play = note !== null && (!A.leadEvery || pass % A.leadEvery === 1);
      if (play) {
        const n = note + tr;
        if (A.lead === 'marimba') {
          marimba(n, t, 0.26, A.staccato ? 0.2 : 0.42);
          if (A.octave && e8 % 2 === 0) marimba(n + 12, t, 0.09, 0.3, 0.3);
        } else if (A.lead === 'glock') glock(n, t, 0.17, 0.15);
        else glock(n + 12, t, 0.1, 0.1); // the music box
      }
    }
    // The flute line under the tune: half notes on the chord's third, then its fifth (second pass on, so it enters as a new colour).
    if (A.flute && pass % 4 !== 0 && (s16 === 0 || s16 === 8))
      flute(tones[s16 === 0 ? 1 : 2] + 24 + tr, t, 0.085, sd * 7.4);
    // Plucked arpeggio (8ths or 16ths), harp (wider, with the octave), pad.
    if (A.pluck && (A.pluck === 16 || on8)) {
      const k = A.pluck === 16 ? s16 : e8;
      const pat =
        A.pluck === 16
          ? [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1]
          : [0, 2, 1, 2, 0, 2, 1, 2];
      pluck(
        tones[pat[k]] + 12 + tr,
        t,
        k % 4 === 0 ? 0.13 : 0.085,
        k % 2 ? 0.35 : -0.35
      );
    }
    if (A.harp && (A.harp === 16 || on8)) {
      const k = A.harp === 16 ? s16 : e8;
      const up = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3]; // across two octaves
      const idx = up[k % 16];
      harp(
        tones[idx % 3] + 12 * Math.floor(idx / 3) + 12 + tr,
        t,
        A.harp === 16 ? 0.075 : 0.1,
        (idx - 2.5) / 4
      );
    }
    if (A.pad && s16 === 0)
      pad(
        tones.map(n => n + 12 + tr),
        t,
        sd * 16,
        0.045
      );
    if (A.pad && s16 === 8 && chords.length > 1)
      pad(
        tones.map(n => n + 12 + tr),
        t,
        sd * 8,
        0.045
      );
    // Bass.
    const root = chord.root + tr;
    if (A.bass === 'one' && s16 === 0) bass(root + 12, t, 0.26, sd * 12);
    if (A.bass === 'two') {
      if (s16 === 0 || s16 === 8) bass(root + 12, t, 0.3, sd * 5);
      if (s16 === 12) bass(root + 19, t, 0.2, sd * 3);
    }
    if (A.bass === 'bounce' && on8) {
      const pat = [0, _, 12, _, 7, _, 12, 7];
      if (pat[e8] !== null)
        bass(root + 12 + pat[e8], t, e8 === 0 ? 0.3 : 0.22, sd * 2.6);
    }
    if (A.bass === 'eighths' && on8)
      bass(
        root + 12 + (e8 === 7 ? 7 : e8 === 3 ? 12 : 0),
        t,
        e8 % 4 === 0 ? 0.3 : 0.2,
        sd * 1.8
      );
    // Drums and colour.
    if (A.kick === 'four' && s16 % 4 === 0) kick(t, 0.34);
    if (A.kick === 'two' && (s16 === 0 || s16 === 8)) kick(t, 0.26);
    if (A.clap && (s16 === 4 || s16 === 12)) clap(t, 0.12);
    if (A.hats && !(lastBar && s16 >= 8)) hat(t, on8 ? 0.045 : 0.022);
    if (A.shaker && s16 % 4 === 2) shaker(t, 0.05);
    if (A.block && [3, 6, 10, 12].includes(s16))
      block(t, 0.07, s16 === 6 || s16 === 12);
    if (A.toms && [0, 3, 6, 8, 11, 14].includes(s16))
      tom(t, 0.16, s16 % 8 === 0 ? 110 : s16 % 3 === 0 ? 150 : 190);
    if (A.stabs === 'off' && (s16 === 4 || s16 === 12))
      stab(
        tones.map(n => n + 12 + tr),
        t,
        0.085,
        false
      );
    if (
      A.stabs === 'brass' &&
      (s16 === 0 || s16 === 6 || (b % 2 === 1 && s16 === 10))
    )
      stab(
        tones.map(n => n + 12 + tr),
        t,
        0.1,
        true
      );
    if (A.chimes && s16 === 0 && b % 2 === 0)
      [0, 1, 2, 3].forEach(k =>
        glock(
          tones[k % 3] + 36 + tr + (k === 3 ? 12 : 0),
          t + k * 0.09,
          0.035,
          (k - 1.5) / 2
        )
      );
    // The fill at the end of every eight bars: toms where there are drums, a harp run where there are not.
    if (lastBar && s16 >= 8) {
      if (A.kick || A.toms) {
        if (s16 % 2 === 0 || s16 >= 12)
          tom(t, 0.14 + (s16 - 8) * 0.012, 210 - (s16 - 8) * 12);
      } else if (on8)
        harp(
          tones[(s16 / 2) % 3] + 24 + 12 * Math.floor((s16 - 8) / 6) + tr,
          t,
          0.09,
          (s16 - 12) / 6
        );
    }
    if (s16 === 15) song.bars += 1;
  }

  function tick() {
    if (!ctx || !song.on) return;
    if (song.next < ctx.currentTime) song.next = ctx.currentTime + 0.05; // after a pause or a hidden tab: do not play catch-up
    while (song.next < ctx.currentTime + 0.2) {
      scheduleStep(song.step, song.next);
      song.next += 60 / ARR[song.arr].bpm / 4;
      song.step += 1;
    }
  }

  let coinCombo = 0;
  let coinAt = -10;

  const api = {
    /** Call from a key press or click: browsers only allow audio after a user gesture. */
    resume() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },
    get available() {
      return !!ctx;
    },
    get muted() {
      return muted;
    },
    /** For tests and the HUD: which arrangement is playing and which is wanted. */
    get musicState() {
      return {
        on: song.on,
        playing: ARR[song.arr].name,
        wanted: ARR[song.want].name,
        bars: song.bars,
        arrangements: ARR.length,
      };
    },
    /**
     * For tests: schedule every step of every arrangement's full form (32 bars: the fills and the bridge included) far in the
     * future, so any error in a later bar shows up without listening for a minute per arrangement. Returns the steps scheduled.
     * Leaves the song stopped; reload the page afterwards.
     */
    selfTest() {
      if (!ensure()) return -1;
      const keep = { ...song };
      let steps = 0;
      for (let a = 0; a < ARR.length; a++) {
        song.arr = song.want = a;
        song.bars = 0;
        for (let s = 0; s < 32 * 16; s++) {
          scheduleStep(s, ctx.currentTime + 3600 + s);
          steps++;
        }
      }
      Object.assign(song, keep);
      return steps;
    },
    toggleMute() {
      muted = !muted;
      if (master)
        master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03);
      return muted;
    },
    /**
     * Start (or keep) the music with arrangement 0 (title) to 6 (the citadel stair), or 7 (after the finish). A change lands on the next bar line, after a
     * short cymbal swell.
     */
    music(arrangement) {
      const a = Math.max(0, Math.min(ARR.length - 1, arrangement | 0));
      if (a !== song.want && ctx && song.on)
        swell(0, Math.min(1.2, (60 / ARR[song.arr].bpm) * 2), 0.06);
      song.want = a;
      if (!ctx || song.on) return;
      song.on = true;
      song.arr = a;
      song.bars = 0;
      song.step = 0;
      song.next = ctx.currentTime + 0.1;
      if (musicWet) musicWet.gain.value = ARR[a].reverb;
      timer = setInterval(tick, 50);
    },
    stopMusic() {
      song.on = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Wind level 0..1 from Kai's speed through the air. */
    setWind(v) {
      if (!wind) return;
      const k = Math.max(0, Math.min(1, v));
      wind.gain.gain.setTargetAtTime(0.012 + k * 0.1, ctx.currentTime, 0.12);
      wind.filter.frequency.setTargetAtTime(
        380 + k * 1100,
        ctx.currentTime,
        0.12
      );
    },
    /** The waterfalls' roar, 0 (out of earshot) to 1 (beside one). */
    setFalls(v) {
      if (!ctx) return;
      if (!falls) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1100;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(f);
        f.connect(gain);
        gain.connect(sfxBus);
        src.start();
        falls = { gain };
      }
      falls.gain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, v)) * 0.22,
        ctx.currentTime,
        0.25
      );
    },
    /** The rail's ringing hum while Kai rides it. */
    setGrind(on) {
      if (!ctx) return;
      if (on && !grind) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 2600;
        f.Q.value = 9;
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.05);
        src.connect(f);
        f.connect(gain);
        gain.connect(sfxBus);
        src.start();
        grind = { src, gain };
      } else if (!on && grind) {
        grind.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
        grind.src.stop(ctx.currentTime + 0.4);
        grind = null;
      }
    },
    sfx(name, a = 0) {
      if (!ctx) return;
      switch (name) {
        case 'coin': {
          // Pickups collected within 1.2 s of each other climb a scale; a pause starts it again.
          const now = ctx.currentTime;
          coinCombo =
            now - coinAt < 1.2
              ? Math.min(coinCombo + 1, COIN_STEPS.length - 1)
              : 0;
          coinAt = now;
          const f = midi(83 + COIN_STEPS[coinCombo]);
          bell(f, 0, 0.16, 0.22);
          bell(f * 1.5, 0.06, 0.16, 0.3);
          break;
        }
        case 'jump':
          tone({ freq: 330, slide: 640, dur: 0.14, vol: 0.13 });
          break;
        case 'doublejump':
          tone({ freq: 520, slide: 1100, dur: 0.16, vol: 0.13 });
          tone({ freq: 1568, t: 0.05, dur: 0.12, vol: 0.05 });
          tone({ freq: 2093, t: 0.09, dur: 0.14, vol: 0.04 });
          break;
        case 'land': {
          const k = Math.max(0.25, Math.min(1, a)); // a: how hard, 0..1
          noise({ dur: 0.09, vol: 0.2 * k, freq: 420 });
          tone({ freq: 120, slide: 55, dur: 0.11, vol: 0.28 * k });
          break;
        }
        case 'step':
          noise({
            dur: 0.035,
            vol: 0.035,
            type: 'bandpass',
            freq: a ? 1500 : 1900,
            q: 1.2,
          });
          break;
        case 'spring':
          tone({ freq: 190, slide: 760, dur: 0.38, vol: 0.24, vibrato: 30 });
          noise({
            dur: 0.5,
            vol: 0.12,
            type: 'bandpass',
            freq: 500,
            slide: 2800,
            q: 1.5,
          });
          break;
        case 'hurt':
          tone({ freq: 440, type: 'square', slide: 130, dur: 0.26, vol: 0.09 });
          noise({ dur: 0.12, vol: 0.14, freq: 900 });
          break;
        case 'fall':
          tone({ freq: 880, slide: 180, dur: 0.75, vol: 0.06 });
          break;
        case 'respawn':
          [67, 72, 76].forEach((n, i) => bell(midi(n), i * 0.07, 0.1, 0.3));
          break;
        case 'checkpoint':
          bell(midi(79), 0, 0.14, 0.4);
          bell(midi(86), 0.11, 0.14, 0.6);
          break;
        case 'gem':
          [84, 88, 91, 96, 100].forEach((n, i) =>
            bell(midi(n), i * 0.06, 0.13, 0.5)
          );
          break;
        case 'key':
          [72, 76, 79, 84, 88].forEach((n, i) =>
            bell(midi(n), i * 0.08, 0.15, 0.45)
          );
          break;
        case 'gate':
          tone({ freq: 70, slide: 180, dur: 0.7, vol: 0.3 });
          [91, 86, 79, 74].forEach((n, i) =>
            bell(midi(n), i * 0.09, 0.08, 0.6)
          );
          break;
        case 'stomp':
          tone({ freq: 170, slide: 45, dur: 0.2, vol: 0.45 });
          noise({ dur: 0.08, vol: 0.2, type: 'highpass', freq: 2500 });
          [79, 84].forEach((n, i) => bell(midi(n), 0.05 + i * 0.07, 0.1, 0.3));
          break;
        case 'grapple':
          tone({
            freq: 300,
            type: 'triangle',
            slide: 1300,
            dur: 0.13,
            vol: 0.12,
          });
          bell(midi(88), 0.1, 0.08, 0.3);
          break;
        case 'release':
          noise({
            dur: 0.25,
            vol: 0.1,
            type: 'bandpass',
            freq: 1800,
            slide: 500,
            q: 1,
          });
          break;
        case 'wave':
          noise({
            dur: 0.32,
            vol: 0.2,
            type: 'bandpass',
            freq: 500,
            slide: 3600,
            q: 1.2,
          });
          tone({ freq: 660, slide: 1320, dur: 0.22, vol: 0.09 });
          [91, 96].forEach((n, i) =>
            bell(midi(n), 0.08 + i * 0.05, 0.06, 0.35)
          );
          break;
        case 'banish':
          tone({ freq: 900, slide: 2400, dur: 0.18, vol: 0.1 });
          noise({ dur: 0.1, vol: 0.12, type: 'highpass', freq: 3000 });
          bell(midi(96), 0.06, 0.09, 0.4);
          break;
        case 'block':
          tone({ freq: 180, type: 'square', slide: 120, dur: 0.18, vol: 0.1 });
          noise({ dur: 0.08, vol: 0.1, freq: 500 });
          break;
        case 'splash': {
          const k = Math.max(0.2, Math.min(1, a || 0.4)); // a: how big, 0..1
          noise({
            dur: 0.16 + k * 0.12,
            vol: 0.1 + k * 0.14,
            type: 'bandpass',
            freq: 1500,
            slide: 600,
            q: 0.7,
          });
          noise({
            t: 0.03,
            dur: 0.1,
            vol: 0.05 * k,
            type: 'highpass',
            freq: 5000,
          });
          break;
        }
        case 'vinecatch':
          tone({
            freq: 220,
            type: 'triangle',
            slide: 520,
            dur: 0.22,
            vol: 0.16,
          });
          noise({
            dur: 0.2,
            vol: 0.12,
            type: 'bandpass',
            freq: 900,
            slide: 2400,
            q: 1.5,
          });
          bell(midi(79), 0.12, 0.08, 0.4);
          break;
        case 'catch':
          tone({ freq: 520, slide: 880, dur: 0.12, vol: 0.12 });
          bell(midi(88), 0.06, 0.08, 0.3);
          break;
        case 'rehome':
          [79, 83, 86, 91].forEach((n, i) =>
            bell(midi(n), i * 0.07, 0.13, 0.5)
          );
          break;
        case 'travel':
          noise({
            dur: 0.5,
            vol: 0.12,
            type: 'bandpass',
            freq: 600,
            slide: 4000,
            q: 1,
          });
          [84, 91, 96].forEach((n, i) =>
            bell(midi(n), 0.1 + i * 0.08, 0.1, 0.6)
          );
          break;
        case 'spring-awake':
          noise({
            dur: 0.9,
            vol: 0.2,
            type: 'bandpass',
            freq: 700,
            slide: 2200,
            q: 0.6,
          });
          [72, 79, 84, 91].forEach((n, i) =>
            bell(midi(n), 0.1 + i * 0.1, 0.11, 0.7)
          );
          break;
        case 'area':
          [72, 79].forEach((n, i) => bell(midi(n), i * 0.12, 0.07, 0.8));
          break;
        case 'start':
          [60, 64, 67, 72].forEach((n, i) =>
            bell(midi(n), i * 0.07, 0.12, 0.5)
          );
          break;
        case 'complete':
          [74, 78, 81, 86].forEach((n, i) => bell(midi(n), i * 0.13, 0.2, 0.5));
          [74, 78, 81, 86, 90].forEach(n =>
            tone({
              freq: midi(n),
              t: 0.56,
              dur: 2.0,
              vol: 0.12,
              attack: 0.02,
              sustain: 0.5,
            })
          );
          [98, 102, 105].forEach((n, i) =>
            bell(midi(n), 0.7 + i * 0.1, 0.07, 0.9)
          );
          break;
        default:
          break;
      }
    },
  };
  return api;
}
