// 14 band-grade click sounds. Each sound is a small synth graph built per
// click — transient (sharp attack) + body (sustained tone or filtered noise)
// + 3-stage envelope (attack → body → release). Modeled after Pro Tools /
// Logic stock metronome libraries; no samples shipped.
//
// Schema v3 mapping: legacy v1.5 ids (snare/kick/hihat/tick) auto-map to
// the closest new id in `resolveSoundId()` so settings persisted before
// the upgrade still work.

export const SOUND_OPTIONS = Object.freeze([
  { id: "studio", name: "Studio Click", group: "Drum" },
  { id: "trainer", name: "Trainer Beep", group: "Modern" },
  { id: "stick", name: "Stick Hit", group: "Drum" },
  { id: "rim", name: "Rim Shot", group: "Drum" },
  { id: "sidestick", name: "Sidestick", group: "Drum" },
  { id: "cowbell", name: "Cowbell", group: "Percussion" },
  { id: "agogo", name: "Agogô", group: "Percussion" },
  { id: "bell", name: "Bell", group: "Percussion" },
  { id: "classic", name: "Classic Click", group: "Classic" },
  { id: "wood", name: "Wood Block", group: "Classic" },
  { id: "soft_tick", name: "Soft Tick", group: "Subtle" },
  { id: "shaker", name: "Shaker", group: "Subtle" },
  { id: "closed_hihat", name: "Closed Hi-Hat", group: "Drum" },
  { id: "digital", name: "Digital Beep", group: "Modern" },
]);

// Legacy ids from v1.5 schema → v3.
export const LEGACY_SOUND_MAP = Object.freeze({
  snare: "studio",
  kick: "studio",
  hihat: "closed_hihat",
  tick: "soft_tick",
});

const DEFAULT_SOUND_ID = "studio";
const DEFAULT_VOLUME = 80;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULE_INTERVAL_MS = 25;

export class AudioScheduler {
  constructor(onBeat, { soundId = DEFAULT_SOUND_ID, volume = DEFAULT_VOLUME, workerUrl = "/scheduler-worker.js" } = {}) {
    this.onBeat = onBeat;
    this.soundId = resolveSoundId(soundId);
    this.volume = resolveVolume(volume);
    this.context = null;
    this.timer = null;
    this.worker = null;
    this.workerUrl = workerUrl;
    this.previewTimers = [];
    this.nextNoteTime = 0;
    this.beat = 0;
    this.state = null;
  }

  async resume() {
    this.context ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  async start(state) {
    this.state = state;
    await this.resume();
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.beat = 0;
    this.startTicker();
  }

  stop() {
    this.stopTicker();
  }

  get isRunning() {
    return this.timer !== null || this.worker !== null;
  }

  async suspend() {
    this.stop();
    if (this.context?.state === "running") {
      await this.context.suspend();
    }
  }

  update(state) {
    this.state = state;
  }

  setSound(soundId) {
    this.soundId = resolveSoundId(soundId);
  }

  setVolume(volume) {
    this.volume = resolveVolume(volume);
  }

  async playPreview({ soundId = this.soundId, volume = this.volume } = {}) {
    await this.resume();
    const previousSound = this.soundId;
    const previousVolume = this.volume;
    this.setSound(soundId);
    this.setVolume(volume);
    this.clearPreviewTimers();
    const startAt = this.context.currentTime + 0.03;
    [true, false, false, false].forEach((downbeat, index) => {
      this.scheduleClick(startAt + index * 0.22, downbeat);
    });
    const timer = setTimeout(() => {
      this.setSound(previousSound);
      this.setVolume(previousVolume);
    }, 1000);
    this.previewTimers.push(timer);
  }

  scheduleAhead() {
    if (!this.context || !this.state) {
      return;
    }
    while (this.nextNoteTime < this.context.currentTime + LOOKAHEAD_SECONDS) {
      this.scheduleClick(this.nextNoteTime, this.beat === 0);
      this.onBeat(this.beat, Math.max(0, this.nextNoteTime - this.context.currentTime));
      this.beat = (this.beat + 1) % this.state.beats_per_bar;
      this.nextNoteTime += 60 / this.state.bpm;
    }
  }

  scheduleClick(time, downbeat) {
    const synth = SYNTHS[this.soundId] ?? SYNTHS[DEFAULT_SOUND_ID];
    const peak = Math.max(0.0001, (downbeat ? 0.65 : 0.4) * (this.volume / 100));
    synth(this.context, this.context.destination, time, downbeat, peak);
  }

  startTicker() {
    if (this.worker || this.timer) {
      return;
    }
    if (typeof Worker !== "undefined" && this.workerUrl) {
      try {
        this.worker = new Worker(this.workerUrl);
        this.worker.addEventListener("message", (event) => {
          if (event.data?.type === "tick") {
            this.scheduleAhead();
          }
        });
        this.worker.postMessage({ type: "start", interval: SCHEDULE_INTERVAL_MS });
        return;
      } catch {
        this.worker = null;
      }
    }
    // setInterval fallback for environments where Worker is forbidden
    // (vMix browser source, OBS in some configs).
    this.timer = setInterval(() => this.scheduleAhead(), SCHEDULE_INTERVAL_MS);
  }

  stopTicker() {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "stop" });
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  clearPreviewTimers() {
    for (const timer of this.previewTimers) {
      clearTimeout(timer);
    }
    this.previewTimers = [];
  }
}

// ---------------------------------------------------------------------------
// Voice graph helpers — kept tiny so we can spin one up per click cheaply.

function envGain(ctx, time, peak, attack, hold, release) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  if (hold > 0) {
    gain.gain.setValueAtTime(peak, time + attack + hold);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
  return gain;
}

function noiseBuffer(ctx, durationSec) {
  const sampleCount = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function startSource(source, gain, dest, time, total) {
  gain.connect(dest);
  source.connect(gain);
  source.start(time);
  source.stop(time + total + 0.01);
}

// Two-voice helper: transient (sharp attack noise/click) + body (oscillator).
function twoVoice(ctx, dest, time, peak, transient, body) {
  // Transient
  const tBuf = noiseBuffer(ctx, transient.length);
  const tSource = ctx.createBufferSource();
  tSource.buffer = tBuf;
  const tFilter = ctx.createBiquadFilter();
  tFilter.type = transient.filter ?? "highpass";
  tFilter.frequency.value = transient.cutoff;
  tFilter.Q.value = transient.q ?? 0.7;
  const tGain = envGain(ctx, time, peak * (transient.peak ?? 1), 0.0015, 0, transient.length);
  tSource.connect(tFilter);
  tFilter.connect(tGain);
  tGain.connect(dest);
  tSource.start(time);
  tSource.stop(time + transient.length + 0.01);

  // Body
  if (body) {
    const osc = ctx.createOscillator();
    osc.type = body.type ?? "sine";
    osc.frequency.setValueAtTime(body.startFreq ?? body.freq, time);
    if (body.endFreq && body.endFreq !== (body.startFreq ?? body.freq)) {
      osc.frequency.exponentialRampToValueAtTime(body.endFreq, time + body.length);
    }
    const bGain = envGain(ctx, time, peak * (body.peak ?? 0.9), body.attack ?? 0.003, body.hold ?? 0, body.length);
    startSource(osc, bGain, dest, time, body.length);
  }
}

// ---------------------------------------------------------------------------
// 14 voices.
const SYNTHS = {
  studio: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: downbeat ? 0.018 : 0.014, cutoff: 4500, peak: 0.85 },
      { type: "sine", startFreq: downbeat ? 2100 : 1750, endFreq: downbeat ? 1500 : 1300, length: downbeat ? 0.05 : 0.04, peak: 0.9 }),

  trainer: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: 0.006, cutoff: 6000, peak: 0.3 },
      { type: "square", startFreq: downbeat ? 2400 : 1800, endFreq: downbeat ? 2400 : 1800, length: downbeat ? 0.055 : 0.04, peak: 0.5 }),

  stick: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: downbeat ? 0.022 : 0.016, cutoff: 3000, peak: 1.1 },
      { type: "triangle", startFreq: downbeat ? 1200 : 980, endFreq: downbeat ? 700 : 580, length: downbeat ? 0.05 : 0.035, peak: 0.6 }),

  rim: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: downbeat ? 0.025 : 0.02, cutoff: 2200, peak: 1.0 },
      { type: "square", startFreq: downbeat ? 2400 : 1900, endFreq: downbeat ? 2000 : 1600, length: downbeat ? 0.04 : 0.03, peak: 0.55 }),

  sidestick: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: downbeat ? 0.012 : 0.009, cutoff: 5500, q: 1.2, peak: 1.0 },
      { type: "triangle", startFreq: downbeat ? 1500 : 1300, endFreq: downbeat ? 900 : 800, length: downbeat ? 0.025 : 0.02, peak: 0.45 }),

  cowbell: (ctx, dest, time, downbeat, peak) => {
    // Two inharmonic squares + a tiny click transient.
    const tBuf = noiseBuffer(ctx, 0.005);
    const tSrc = ctx.createBufferSource(); tSrc.buffer = tBuf;
    const tFilt = ctx.createBiquadFilter(); tFilt.type = "highpass"; tFilt.frequency.value = 5000;
    const tGain = envGain(ctx, time, peak * 0.4, 0.001, 0, 0.005);
    tSrc.connect(tFilt); tFilt.connect(tGain); tGain.connect(dest);
    tSrc.start(time); tSrc.stop(time + 0.015);

    const length = downbeat ? 0.18 : 0.13;
    for (const f of downbeat ? [540, 800] : [560, 845]) {
      const osc = ctx.createOscillator();
      osc.type = "square"; osc.frequency.value = f;
      const g = envGain(ctx, time, peak * 0.55, 0.003, 0, length);
      osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + length + 0.01);
    }
  },

  agogo: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: 0.008, cutoff: 4000, peak: 0.45 },
      { type: "sine", startFreq: downbeat ? 1320 : 1100, endFreq: downbeat ? 1320 : 1100, length: downbeat ? 0.14 : 0.11, peak: 0.85 }),

  bell: (ctx, dest, time, downbeat, peak) => {
    // FM-ish bell: carrier + slight detuned partial.
    const fundamental = downbeat ? 1568 : 1245;
    const length = downbeat ? 0.32 : 0.24;
    for (const [mult, gainMul] of [[1, 0.9], [2.756, 0.45], [5.404, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = "sine"; osc.frequency.value = fundamental * mult;
      const g = envGain(ctx, time, peak * gainMul, 0.003, 0, length);
      osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + length + 0.02);
    }
  },

  classic: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: 0.006, cutoff: 5000, peak: 0.35 },
      { type: "sine", startFreq: downbeat ? 1568 : 1046.5, endFreq: downbeat ? 1568 : 1046.5, length: downbeat ? 0.06 : 0.05, peak: 0.9 }),

  wood: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak,
      { length: downbeat ? 0.014 : 0.011, cutoff: 2500, peak: 0.9 },
      { type: "triangle", startFreq: downbeat ? 900 : 700, endFreq: downbeat ? 500 : 400, length: downbeat ? 0.07 : 0.05, peak: 0.7 }),

  soft_tick: (ctx, dest, time, downbeat, peak) =>
    twoVoice(ctx, dest, time, peak * 0.85,
      { length: downbeat ? 0.012 : 0.008, cutoff: 5500, peak: 0.7 },
      { type: "sine", startFreq: downbeat ? 1400 : 1100, endFreq: downbeat ? 1400 : 1100, length: 0.02, peak: 0.25 }),

  shaker: (ctx, dest, time, downbeat, peak) => {
    const length = downbeat ? 0.06 : 0.045;
    const buf = noiseBuffer(ctx, length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 8500; bp.Q.value = 0.9;
    const g = envGain(ctx, time, peak * 0.7, 0.005, 0.005, length);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
    src.start(time); src.stop(time + length + 0.01);
  },

  closed_hihat: (ctx, dest, time, downbeat, peak) => {
    const length = downbeat ? 0.04 : 0.028;
    const buf = noiseBuffer(ctx, length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = downbeat ? 7000 : 8000;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 10000; bp.Q.value = 1.4;
    const g = envGain(ctx, time, peak * 0.85, 0.002, 0, length);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
    src.start(time); src.stop(time + length + 0.01);
  },

  digital: (ctx, dest, time, downbeat, peak) => {
    const length = downbeat ? 0.06 : 0.045;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = downbeat ? 2000 : 1500;
    const g = envGain(ctx, time, peak * 0.85, 0.001, 0, length);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + length + 0.01);
  },
};

const VALID_IDS = new Set(SOUND_OPTIONS.map((option) => option.id));

export function resolveSoundId(soundId) {
  if (VALID_IDS.has(soundId)) return soundId;
  if (LEGACY_SOUND_MAP[soundId]) return LEGACY_SOUND_MAP[soundId];
  return DEFAULT_SOUND_ID;
}

function resolveVolume(volume) {
  const numeric = Number(volume);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_VOLUME;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
}
