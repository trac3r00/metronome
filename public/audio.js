// Band-grade metronome click bank. Each builder returns:
//   { schedule(time, downbeat, gainNode) }
// and is responsible for creating + starting + stopping its own nodes so the
// scheduler can stay tiny. Volumes are normalized — the final master gain
// envelope is applied by the scheduler.

export const SOUND_OPTIONS = Object.freeze([
  { id: "classic", name: "Classic Click", desc: "Smooth sine click" },
  { id: "studio", name: "Studio Click", desc: "Pro Tools / Logic style transient" },
  { id: "trainer", name: "Pulse Trainer", desc: "Sharp short pulse, easy to lock to" },
  { id: "wood", name: "Wood Block", desc: "Acoustic wood block" },
  { id: "stick", name: "Stick", desc: "Drumstick rim — quiet and woody" },
  { id: "rim", name: "Rim Shot", desc: "Cracky rim shot" },
  { id: "cowbell", name: "Cowbell", desc: "Classic 808-style cowbell" },
  { id: "bell", name: "Bell", desc: "Bright tuned bell" },
  { id: "agogo", name: "Agogô", desc: "Latin agogô high/low bell" },
  { id: "logic", name: "Sidestick", desc: "Soft sidestick body" },
  { id: "tick", name: "Soft Tick", desc: "Quiet noise tick" },
  { id: "shaker", name: "Shaker", desc: "Filtered shaker noise" },
  { id: "hihat", name: "Closed Hi-Hat", desc: "Tight closed hi-hat" },
  { id: "digital", name: "Digital Beep", desc: "Old-school digital beep" },
]);

const DEFAULT_SOUND_ID = "classic";
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
    this.context ??= new (window.AudioContext ?? window.webkitAudioContext)({ latencyHint: "interactive" });
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
    // No allocations, just swap the lookup — preview/active click picks it
    // up on the very next scheduled note (next ~25 ms scheduler tick).
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
    const startAt = this.context.currentTime + 0.02;
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
    const builder = SOUND_BUILDERS[this.soundId] ?? SOUND_BUILDERS[DEFAULT_SOUND_ID];
    const masterGain = this.context.createGain();
    const peak = Math.max(0.0001, (downbeat ? 0.78 : 0.5) * (this.volume / 100));
    masterGain.gain.setValueAtTime(0.0001, time);
    masterGain.gain.exponentialRampToValueAtTime(peak, time + 0.003);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + builder.decay(downbeat));
    masterGain.connect(this.context.destination);
    builder.schedule(this.context, time, downbeat, masterGain);
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

// --- click builders ----------------------------------------------------------

const SOUND_BUILDERS = {
  classic: {
    decay: (down) => (down ? 0.06 : 0.05),
    schedule(ctx, time, downbeat, gain) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(downbeat ? 1568 : 1046.5, time);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.09);
    },
  },
  studio: {
    decay: (down) => (down ? 0.055 : 0.04),
    // Pro Tools / Logic-style click: short transient noise burst + tonal body.
    schedule(ctx, time, downbeat, gain) {
      const transient = createNoiseBurst(ctx, 0.004);
      const transientGain = ctx.createGain();
      transientGain.gain.setValueAtTime(0.7, time);
      transientGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);
      transient.connect(transientGain).connect(gain);
      transient.start(time);
      transient.stop(time + 0.02);

      const body = ctx.createOscillator();
      body.type = "triangle";
      body.frequency.setValueAtTime(downbeat ? 2400 : 1800, time);
      body.frequency.exponentialRampToValueAtTime(downbeat ? 1500 : 1100, time + 0.04);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.7, time);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      body.connect(bodyGain).connect(gain);
      body.start(time);
      body.stop(time + 0.06);
    },
  },
  trainer: {
    decay: (down) => (down ? 0.04 : 0.03),
    schedule(ctx, time, downbeat, gain) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(downbeat ? 2200 : 1700, time);
      const inner = ctx.createGain();
      inner.gain.setValueAtTime(0.6, time);
      inner.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      osc.connect(inner).connect(gain);
      osc.start(time);
      osc.stop(time + 0.04);
    },
  },
  wood: {
    decay: (down) => (down ? 0.075 : 0.055),
    schedule(ctx, time, downbeat, gain) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(downbeat ? 900 : 700, time);
      osc.frequency.exponentialRampToValueAtTime(downbeat ? 500 : 400, time + 0.04);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.08);
    },
  },
  stick: {
    decay: (down) => (down ? 0.04 : 0.03),
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, 0.015);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = downbeat ? 1900 : 1500;
      filter.Q.value = 4;
      noise.connect(filter).connect(gain);
      noise.start(time);
      noise.stop(time + 0.04);
    },
  },
  rim: {
    decay: (down) => (down ? 0.05 : 0.04),
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, 0.015);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = downbeat ? 3000 : 2500;
      noise.connect(filter).connect(gain);
      noise.start(time);
      noise.stop(time + 0.05);
      const click = ctx.createOscillator();
      click.type = "square";
      click.frequency.value = downbeat ? 2400 : 1900;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.4, time);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
      click.connect(clickGain).connect(gain);
      click.start(time);
      click.stop(time + 0.04);
    },
  },
  cowbell: {
    decay: (down) => (down ? 0.18 : 0.13),
    schedule(ctx, time, downbeat, gain) {
      const low = ctx.createOscillator();
      const high = ctx.createOscillator();
      low.type = "square";
      high.type = "square";
      low.frequency.value = downbeat ? 560 : 540;
      high.frequency.value = downbeat ? 845 : 800;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = downbeat ? 800 : 700;
      bandpass.Q.value = 1.5;
      low.connect(bandpass);
      high.connect(bandpass);
      bandpass.connect(gain);
      low.start(time);
      high.start(time);
      low.stop(time + 0.2);
      high.stop(time + 0.2);
    },
  },
  bell: {
    decay: (down) => (down ? 0.4 : 0.28),
    schedule(ctx, time, downbeat, gain) {
      const fundamental = downbeat ? 1760 : 1320;
      const partials = [1, 2.76, 5.4, 8.93];
      for (let index = 0; index < partials.length; index += 1) {
        const ratio = partials[index];
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = fundamental * ratio;
        const partialGain = ctx.createGain();
        const peak = 0.45 / (index + 1);
        partialGain.gain.setValueAtTime(peak, time);
        partialGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35 / (index + 1));
        osc.connect(partialGain).connect(gain);
        osc.start(time);
        osc.stop(time + 0.5);
      }
    },
  },
  agogo: {
    decay: (down) => (down ? 0.22 : 0.18),
    schedule(ctx, time, downbeat, gain) {
      const fundamental = downbeat ? 1480 : 1110;
      const ratios = [1, 2.8, 5.1];
      for (let index = 0; index < ratios.length; index += 1) {
        const ratio = ratios[index];
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = fundamental * ratio;
        const partialGain = ctx.createGain();
        const peak = 0.55 / (index + 1);
        partialGain.gain.setValueAtTime(peak, time);
        partialGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22 / (index + 1));
        osc.connect(partialGain).connect(gain);
        osc.start(time);
        osc.stop(time + 0.3);
      }
    },
  },
  logic: {
    decay: (down) => (down ? 0.08 : 0.06),
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, 0.012);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = downbeat ? 2300 : 1900;
      filter.Q.value = 6;
      noise.connect(filter).connect(gain);
      noise.start(time);
      noise.stop(time + 0.04);
      const body = ctx.createOscillator();
      body.type = "sine";
      body.frequency.value = downbeat ? 380 : 320;
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.35, time);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
      body.connect(bodyGain).connect(gain);
      body.start(time);
      body.stop(time + 0.08);
    },
  },
  tick: {
    decay: (down) => (down ? 0.035 : 0.025),
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, 0.008);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = downbeat ? 4500 : 4000;
      noise.connect(filter).connect(gain);
      noise.start(time);
      noise.stop(time + 0.03);
    },
  },
  shaker: {
    decay: () => 0.06,
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, downbeat ? 0.045 : 0.035);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 5500;
      noise.connect(filter).connect(gain);
      noise.start(time);
      noise.stop(time + 0.06);
    },
  },
  hihat: {
    decay: () => 0.03,
    schedule(ctx, time, downbeat, gain) {
      const noise = createNoiseBurst(ctx, 0.02);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = downbeat ? 7500 : 6500;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = downbeat ? 9000 : 8000;
      bp.Q.value = 1.2;
      noise.connect(hp).connect(bp).connect(gain);
      noise.start(time);
      noise.stop(time + 0.03);
    },
  },
  digital: {
    decay: (down) => (down ? 0.06 : 0.05),
    schedule(ctx, time, downbeat, gain) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(downbeat ? 2000 : 1500, time);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.07);
    },
  },
};

function createNoiseBurst(ctx, durationSeconds) {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

function resolveSoundId(soundId) {
  return SOUND_BUILDERS[soundId] ? soundId : DEFAULT_SOUND_ID;
}

function resolveVolume(volume) {
  const numeric = Number(volume);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_VOLUME;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

// Backwards-compatible re-export for tests that introspected the legacy
// SOUNDS map. Each entry returns the new builder so callers can still
// SOUND_BUILDERS lookup the active sound.
export const SOUNDS = SOUND_BUILDERS;
