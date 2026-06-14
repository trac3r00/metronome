import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUDIO_UNLOCK_MESSAGE,
  applyLocalMessage,
  createAutoplayGestureGate,
  createPresetTapGesture,
  getReconnectDelayMs,
  nextTapTempo,
  parseBpmInput,
  syncSchedulerToState,
} from "../public/client-utils.js";
import { getNativeSharePayload, hasNativeShare } from "../public/qr-share.js";

describe("client guard helpers", () => {
  it("clamps bpm input into the supported range", () => {
    // Given: user-entered values outside the server contract.
    const tooLow = "12";
    const tooHigh = "999";

    // When: the client parses BPM input.
    const low = parseBpmInput(tooLow);
    const high = parseBpmInput(tooHigh);

    // Then: values are clamped and marked invalid for visual feedback.
    assert.deepEqual(low, { bpm: 30, valid: false });
    assert.deepEqual(high, { bpm: 300, valid: false });
  });

  it("guards nan and infinity bpm input", () => {
    // Given: non-finite values from a bad input path.
    const values = ["tempo", Infinity];

    // When: the client parses the values.
    const parsed = values.map(parseBpmInput);

    // Then: the fallback stays inside the server contract.
    assert.deepEqual(parsed, [
      { bpm: 30, valid: false },
      { bpm: 30, valid: false },
    ]);
  });

  it("computes bounded exponential reconnect delays", () => {
    // Given: repeated reconnect attempts.
    const attempts = [0, 1, 2, 10];

    // When: the reconnect delay is calculated.
    const delays = attempts.map(getReconnectDelayMs);

    // Then: the delay doubles from one second and caps at thirty seconds.
    assert.deepEqual(delays, [1000, 2000, 4000, 30000]);
  });

  it("ignores tap tempo gaps that are too fast", () => {
    // Given: a previous tap.
    const taps = [1000];

    // When: another tap arrives before 200ms.
    const result = nextTapTempo(taps, 1150);

    // Then: the tap is ignored and no BPM is emitted.
    assert.deepEqual(result, { taps, bpm: null, ignored: true });
  });

  it("resets tap tempo after a two-second idle gap", () => {
    // Given: a previous tap.
    const taps = [1000, 1500];

    // When: the next tap arrives after more than two seconds.
    const result = nextTapTempo(taps, 3501);

    // Then: the tap history restarts.
    assert.deepEqual(result, { taps: [3501], bpm: null, ignored: false });
  });

  it("calculates tap tempo from valid gaps", () => {
    // Given: two existing taps at 500ms spacing.
    const taps = [1000, 1500];

    // When: a third matching tap arrives.
    const result = nextTapTempo(taps, 2000);

    // Then: the calculated BPM is 120.
    assert.deepEqual(result, { taps: [1000, 1500, 2000], bpm: 120, ignored: false });
  });

  it("applies websocket messages locally while offline", () => {
    // Given: local state in offline mode.
    const state = {
      bpm: 120,
      beats_per_bar: 4,
      beat_unit: 4,
      playing: false,
      presets: Array.from({ length: 10 }, () => null),
    };

    // When: the client saves a preset locally.
    const saved = applyLocalMessage(state, { type: "overwrite_preset", slot: 1 });
    const loaded = applyLocalMessage({ ...saved, bpm: 90 }, { type: "load_preset", slot: 1 });

    // Then: local preset behavior matches the online contract.
    assert.deepEqual(saved.presets[0], { slot: 1, bpm: 120, beats_per_bar: 4, beat_unit: 4 });
    assert.equal(loaded.bpm, 120);
  });

  it("applies settings presets locally as one bpm and meter update", () => {
    // Given: local state in offline mode.
    const state = {
      bpm: 120,
      beats_per_bar: 4,
      beat_unit: 4,
      playing: false,
      presets: Array.from({ length: 10 }, () => null),
    };

    // When: the stage preset row applies a settings preset.
    const applied = applyLocalMessage(state, { type: "apply_preset", bpm: 140, meter: "6/8" });

    // Then: BPM and meter update together.
    assert.equal(applied.bpm, 140);
    assert.equal(applied.beats_per_bar, 6);
    assert.equal(applied.beat_unit, 8);
  });

  it("ignores preset taps after horizontal drag or long press gestures", () => {
    let taps = 0;
    const gesture = createPresetTapGesture(() => {
      taps += 1;
    });

    gesture.pointerDown({ clientX: 10, clientY: 10, timeStamp: 1000 });
    gesture.pointerMove({ clientX: 19, clientY: 10, timeStamp: 1010 });
    gesture.pointerUp({ clientX: 19, clientY: 10, timeStamp: 1020 });

    gesture.pointerDown({ clientX: 10, clientY: 10, timeStamp: 2000 });
    gesture.pointerUp({ clientX: 10, clientY: 10, timeStamp: 2510 });

    gesture.pointerDown({ clientX: 10, clientY: 10, timeStamp: 3000 });
    gesture.pointerMove({ clientX: 16, clientY: 14, timeStamp: 3010 });
    gesture.pointerUp({ clientX: 16, clientY: 14, timeStamp: 3020 });

    assert.equal(taps, 1);
  });

  it("detects native share support and builds the modal share payload", () => {
    const supportedNavigator = { share() {} };
    const unsupportedNavigator = {};
    const location = { href: "https://example.test/?room=main" };

    assert.equal(hasNativeShare(supportedNavigator), true);
    assert.equal(hasNativeShare(unsupportedNavigator), false);
    assert.deepEqual(getNativeSharePayload(location), {
      title: "Church Metronome",
      url: "https://example.test/?room=main",
    });
  });

  it("starts a stopped scheduler when a late websocket state is already playing", async () => {
    const scheduler = new FakeScheduler(false);
    const state = { bpm: 128, beats_per_bar: 4, beat_unit: 4, playing: true };

    await syncSchedulerToState({ state, scheduler, visibilityState: "visible", onAutoplayBlocked() {} });

    assert.equal(scheduler.starts, 1);
    assert.deepEqual(scheduler.startedStates[0], state);
  });

  it("applies tempo and meter changes live without restarting a running scheduler", async () => {
    const scheduler = new FakeScheduler(true);
    const state = { bpm: 96, beats_per_bar: 6, beat_unit: 8, playing: true };

    await syncSchedulerToState({ state, scheduler, visibilityState: "visible", onAutoplayBlocked() {} });

    assert.equal(scheduler.starts, 0);
    assert.equal(scheduler.stops, 0);
  });

  it("stops a running scheduler when websocket state is no longer playing", async () => {
    const scheduler = new FakeScheduler(true);
    const state = { bpm: 128, beats_per_bar: 4, beat_unit: 4, playing: false };

    await syncSchedulerToState({ state, scheduler, visibilityState: "visible", onAutoplayBlocked() {} });

    assert.equal(scheduler.starts, 0);
    assert.equal(scheduler.stops, 1);
  });

  it("gates autoplay resume until the next user interaction", async () => {
    const target = new FakeEventTarget();
    let starts = 0;
    const gate = createAutoplayGestureGate({
      target,
      start: async () => {
        starts += 1;
      },
      showMessage(message, isError) {
        assert.equal(message, AUDIO_UNLOCK_MESSAGE);
        assert.equal(isError, true);
      },
    });

    gate.request();
    assert.equal(starts, 0);
    await target.dispatch("pointerdown");

    assert.equal(starts, 1);
    await target.dispatch("keydown");
    assert.equal(starts, 1);
  });
});

class FakeScheduler {
  constructor(isRunning) {
    this.isRunning = isRunning;
    this.starts = 0;
    this.stops = 0;
    this.startedStates = [];
  }

  async start(state) {
    this.starts += 1;
    this.startedStates.push(state);
    this.isRunning = true;
  }

  stop() {
    this.stops += 1;
    this.isRunning = false;
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener),
    );
  }

  async dispatch(type) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const entry of listeners) {
      await entry.listener();
      if (entry.once) {
        this.removeEventListener(type, entry.listener);
      }
    }
  }
}
