import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AudioScheduler, SOUND_OPTIONS, SOUNDS } from "../public/audio.js";

describe("audio scheduler sounds", () => {
  it("exposes the band-grade metronome sound presets", () => {
    assert.deepEqual(
      SOUND_OPTIONS.map((sound) => sound.id),
      ["classic", "studio", "trainer", "wood", "stick", "rim", "cowbell", "bell", "agogo", "logic", "tick", "shaker", "hihat", "digital"],
    );
  });

  it("every sound preset has a builder + descriptive copy", () => {
    for (const sound of SOUND_OPTIONS) {
      assert.ok(SOUNDS[sound.id], `missing builder for ${sound.id}`);
      assert.ok(sound.name && sound.name.length > 0, `missing name for ${sound.id}`);
      assert.ok(sound.desc && sound.desc.length > 0, `missing desc for ${sound.id}`);
    }
  });

  it("schedules an oscillator for the classic click on the destination", () => {
    const context = new FakeAudioContext();
    const scheduler = new AudioScheduler(() => {}, { soundId: "classic", volume: 80 });
    scheduler.context = context;

    scheduler.scheduleClick(1, true);
    scheduler.setSound("digital");
    scheduler.scheduleClick(2, true);

    assert.equal(context.oscillators.length >= 2, true);
    // First click is classic (sine); second is digital (square).
    assert.equal(context.oscillators[0].type, "sine");
    assert.equal(context.oscillators[context.oscillators.length - 1].type, "square");
  });

  it("reports whether the scheduler loop is running", async () => {
    globalThis.window = { AudioContext: FakeAudioContext };
    const scheduler = new AudioScheduler(() => {}, { soundId: "classic", volume: 80 });

    assert.equal(scheduler.isRunning, false);
    await scheduler.start({ bpm: 120, beats_per_bar: 4, beat_unit: 4 });
    assert.equal(scheduler.isRunning, true);
    scheduler.stop();
    assert.equal(scheduler.isRunning, false);
    delete globalThis.window;
  });

  it("setSound updates the active sound id immediately (no allocations)", () => {
    const scheduler = new AudioScheduler(() => {}, { soundId: "classic", volume: 80 });
    assert.equal(scheduler.soundId, "classic");
    scheduler.setSound("studio");
    assert.equal(scheduler.soundId, "studio");
    scheduler.setSound("not-a-real-sound");
    // Falls back to classic when given an unknown id.
    assert.equal(scheduler.soundId, "classic");
  });

  it("creates noise-buffer output for soft tick", () => {
    const context = new FakeAudioContext();
    SOUNDS.tick.schedule(context, 0, false, context.createGain());
    assert.equal(context.buffers.length, 1);
    assert.equal(context.filters[0].type, "highpass");
    assert.equal(context.filters[0].frequency.value, 4000);
  });
});

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = new FakeNode("destination");
    this.sampleRate = 48000;
    this.oscillators = [];
    this.gains = [];
    this.buffers = [];
    this.bufferSources = [];
    this.filters = [];
    this.state = "running";
  }

  createOscillator() {
    const oscillator = new FakeNode("oscillator");
    oscillator.frequency = {
      value: 0,
      setValueAtTime(value) { this.value = value; },
      exponentialRampToValueAtTime(value) { this.value = value; },
    };
    oscillator.type = "sine";
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    const gain = new FakeNode("gain");
    gain.gain = {
      value: 1,
      setValueAtTime(value) { this.value = value; },
      exponentialRampToValueAtTime(value) { this.value = value; },
      linearRampToValueAtTime(value) { this.value = value; },
    };
    this.gains.push(gain);
    return gain;
  }

  createBuffer(channels, length, sampleRate) {
    const buffer = {
      channels,
      length,
      sampleRate,
      data: Array.from({ length: channels }, () => new Float32Array(length)),
      getChannelData(index) { return this.data[index]; },
    };
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource() {
    const source = new FakeNode("buffer");
    this.bufferSources.push(source);
    return source;
  }

  createBiquadFilter() {
    const filter = new FakeNode("filter");
    filter.type = "lowpass";
    filter.frequency = { value: 0 };
    filter.Q = { value: 0 };
    this.filters.push(filter);
    return filter;
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    this.startedAt = null;
    this.stoppedAt = null;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}
