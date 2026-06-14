import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyLocalMessage,
  getReconnectDelayMs,
  nextTapTempo,
  parseBpmInput,
} from "../public/client-utils.js";

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
});
