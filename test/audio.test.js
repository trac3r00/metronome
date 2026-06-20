import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AudioScheduler, LEGACY_SOUND_MAP, SOUND_OPTIONS, resolveSoundId } from "../public/audio.js";

const EXPECTED_IDS = [
  "studio", "trainer", "stick", "rim", "sidestick", "cowbell", "agogo", "bell",
  "classic", "wood", "soft_tick", "shaker", "closed_hihat", "digital",
];

describe("audio scheduler sounds", () => {
  it("exposes 14 band-grade selectable sounds in canonical order", () => {
    assert.deepEqual(SOUND_OPTIONS.map((sound) => sound.id), EXPECTED_IDS);
  });

  it("every sound carries a name and a grouping label", () => {
    for (const sound of SOUND_OPTIONS) {
      assert.equal(typeof sound.name, "string");
      assert.ok(sound.name.length > 0, `${sound.id} should have a non-empty name`);
      assert.equal(typeof sound.group, "string");
      assert.ok(sound.group.length > 0, `${sound.id} should have a non-empty group`);
    }
  });

  it("scheduleClick instantiates synth graph and produces audible voices", () => {
    const context = new FakeAudioContext();
    const scheduler = new AudioScheduler(() => {}, { soundId: "studio", volume: 80 });
    scheduler.context = context;

    scheduler.scheduleClick(1, true);
    const oscCountAfterStudio = context.oscillators.length;
    assert.ok(oscCountAfterStudio >= 1, "studio should create at least one oscillator");
    assert.ok(context.bufferSources.length >= 1, "studio transient should create a noise buffer source");

    scheduler.setSound("digital");
    scheduler.scheduleClick(2, true);
    const lastOsc = context.oscillators[context.oscillators.length - 1];
    assert.equal(lastOsc.type, "square");
    assert.equal(lastOsc.frequency.value, 2000);
  });

  it("legacy v1.5 sound ids remap to closest v1.6 voice", () => {
    assert.equal(LEGACY_SOUND_MAP.snare, "studio");
    assert.equal(LEGACY_SOUND_MAP.kick, "studio");
    assert.equal(LEGACY_SOUND_MAP.tick, "soft_tick");
    assert.equal(LEGACY_SOUND_MAP.hihat, "closed_hihat");
    assert.equal(resolveSoundId("snare"), "studio");
    assert.equal(resolveSoundId("tick"), "soft_tick");
    assert.equal(resolveSoundId("hihat"), "closed_hihat");
    assert.equal(resolveSoundId("garbage"), "studio");
    assert.equal(resolveSoundId("classic"), "classic");
  });

  it("setSound falls back to default when given an unknown id", () => {
    const scheduler = new AudioScheduler(() => {}, { soundId: "studio", volume: 80 });
    scheduler.setSound("nonexistent");
    assert.equal(scheduler.soundId, "studio");
  });

  it("reports whether the scheduler loop is running", async () => {
    globalThis.window = { AudioContext: FakeAudioContext };
    const scheduler = new AudioScheduler(() => {}, { soundId: "studio", volume: 80 });

    assert.equal(scheduler.isRunning, false);
    await scheduler.start({ bpm: 120, beats_per_bar: 4, beat_unit: 4 });
    assert.equal(scheduler.isRunning, true);
    scheduler.stop();
    assert.equal(scheduler.isRunning, false);
    delete globalThis.window;
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
      linearRampToValueAtTime(value) { this.value = value; },
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
    filter.Q = { value: 1 };
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

  start(time) {
    this.startedAt = time;
  }

  stop(time) {
    this.stoppedAt = time;
  }
}
