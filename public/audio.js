export const SOUND_OPTIONS = Object.freeze([
  { id: "classic", name: "Classic Click" },
  { id: "wood", name: "Wood Block" },
  { id: "digital", name: "Digital Beep" },
  { id: "cowbell", name: "Cowbell" },
  { id: "tick", name: "Soft Tick" },
  { id: "snare", name: "Snare" },
  { id: "kick", name: "Kick" },
  { id: "rim", name: "Rim Shot" },
  { id: "shaker", name: "Shaker" },
  { id: "hihat", name: "Hi-Hat" },
]);

export const SOUNDS = Object.freeze({
  classic: (context, downbeat) => createTone(context, downbeat ? 1568 : 1046.5, "sine"),
  wood: (context, downbeat) => createTone(context, downbeat ? 800 : 600, "triangle"),
  digital: (context, downbeat) => createTone(context, downbeat ? 2000 : 1500, "square"),
  cowbell: (context, downbeat) => (downbeat ? createCowbell(context) : createTone(context, 540, "square")),
  tick: (context) => createNoiseTick(context),
  snare: (context, downbeat) => createNoiseDrum(context, { highpass: downbeat ? 1500 : 1800, length: 0.04 }),
  kick: (context, downbeat) => createKick(context, downbeat),
  rim: (context, downbeat) => createTone(context, downbeat ? 2400 : 1900, "square"),
  shaker: (context) => createNoiseDrum(context, { highpass: 5500, length: 0.025 }),
  hihat: (context, downbeat) => createNoiseDrum(context, { highpass: downbeat ? 7000 : 6000, length: 0.015 }),
});

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
    const source = SOUNDS[this.soundId](this.context, downbeat);
    const gain = this.context.createGain();
    const peak = Math.max(0.0001, (downbeat ? 0.55 : 0.32) * (this.volume / 100));
    const decay = getDecaySeconds(this.soundId, downbeat);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    connectSource(source, gain);
    gain.connect(this.context.destination);
    source.start(time);
    source.stop(time + decay + 0.005);
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

function createTone(context, frequency, type) {
  const oscillator = context.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.type = type;
  return oscillator;
}

function createCowbell(context) {
  const output = context.createGain();
  const low = createTone(context, 540, "square");
  const high = createTone(context, 800, "square");
  low.connect(output);
  high.connect(output);
  output.start = (time) => {
    low.start(time);
    high.start(time);
  };
  output.stop = (time) => {
    low.stop(time);
    high.stop(time);
  };
  return output;
}

function createNoiseTick(context) {
  return createNoiseDrum(context, { highpass: 4000, length: 0.008 });
}

function createNoiseDrum(context, { highpass = 4000, length = 0.02 } = {}) {
  const sampleLength = Math.max(1, Math.ceil(context.sampleRate * length));
  const buffer = context.createBuffer(1, sampleLength, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < sampleLength; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = highpass;
  source.buffer = buffer;
  source.connect(filter);
  source.output = filter;
  return source;
}

function createKick(context, downbeat) {
  const oscillator = createTone(context, downbeat ? 80 : 65, "sine");
  // Slight downward pitch envelope using ramped frequency would need an extra
  // helper; the static low tone is sufficient for the metronome cue.
  return oscillator;
}

function connectSource(source, destination) {
  if (source.output) {
    source.output.connect(destination);
    return;
  }
  source.connect(destination);
}

function getDecaySeconds(soundId, downbeat) {
  if (soundId === "tick" || soundId === "shaker" || soundId === "hihat") {
    return downbeat ? 0.035 : 0.025;
  }
  if (soundId === "wood" || soundId === "rim") {
    return downbeat ? 0.075 : 0.055;
  }
  if (soundId === "kick") {
    return downbeat ? 0.12 : 0.09;
  }
  if (soundId === "snare") {
    return downbeat ? 0.08 : 0.06;
  }
  return downbeat ? 0.06 : 0.05;
}

function resolveSoundId(soundId) {
  return SOUNDS[soundId] ? soundId : DEFAULT_SOUND_ID;
}

function resolveVolume(volume) {
  const numeric = Number(volume);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_VOLUME;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
}
