import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATE, reduceMessage } from "../src/state.js";

describe("state validation", () => {
  it("updates bpm when value is inside the broadcast range", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client sends an in-range BPM change.
    const result = reduceMessage(state, { type: "set_bpm", bpm: 144 });

    // Then: only the BPM changes.
    assert.equal(result.bpm, 144);
    assert.equal(result.beats_per_bar, state.beats_per_bar);
    assert.equal(result.beat_unit, state.beat_unit);
  });

  it("rejects bpm outside the supported range", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client sends a BPM outside 30-300.
    // Then: validation rejects it.
    assert.throws(
      () => reduceMessage(state, { type: "set_bpm", bpm: 301 }),
      /BPM must be between 30 and 300/,
    );
  });

  it("accepts bpm boundary values", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: clients send the minimum and maximum supported BPM values.
    const minimum = reduceMessage(state, { type: "set_bpm", bpm: 30 });
    const maximum = reduceMessage(state, { type: "set_bpm", bpm: 300 });

    // Then: both boundaries are accepted.
    assert.equal(minimum.bpm, 30);
    assert.equal(maximum.bpm, 300);
  });

  it("rejects non-integer bpm values", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client sends a non-integer BPM.
    // Then: validation rejects it.
    assert.throws(
      () => reduceMessage(state, { type: "set_bpm", bpm: 120.5 }),
      /BPM must be between 30 and 300/,
    );
  });

  it("accepts only the supported church meter options", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client selects 6/8.
    const result = reduceMessage(state, {
      type: "set_meter",
      beats_per_bar: 6,
      beat_unit: 8,
    });

    // Then: the meter changes to 6/8.
    assert.equal(result.beats_per_bar, 6);
    assert.equal(result.beat_unit, 8);
  });

  it("rejects unsupported meter combinations", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client sends an unsupported meter.
    // Then: validation rejects it.
    assert.throws(
      () =>
        reduceMessage(state, {
          type: "set_meter",
          beats_per_bar: 5,
          beat_unit: 4,
        }),
      /Meter must be 4\/4, 3\/4, or 6\/8/,
    );
  });

  it("overwrites and loads preset slots 1 through 10", () => {
    // Given: a state ready to save a preset.
    const state = { ...DEFAULT_STATE, bpm: 92, beats_per_bar: 3, beat_unit: 4 };

    // When: slot 7 is overwritten and then loaded.
    const withPreset = reduceMessage(state, { type: "overwrite_preset", slot: 7 });
    const loaded = reduceMessage(
      { ...DEFAULT_STATE, presets: withPreset.presets },
      { type: "load_preset", slot: 7 },
    );

    // Then: the slot keeps the saved BPM and meter.
    assert.deepEqual(withPreset.presets[6], {
      slot: 7,
      bpm: 92,
      beats_per_bar: 3,
      beat_unit: 4,
    });
    assert.equal(loaded.bpm, 92);
    assert.equal(loaded.beats_per_bar, 3);
    assert.equal(loaded.beat_unit, 4);
  });

  it("rejects loading an empty preset slot", () => {
    // Given: the default state with no saved presets.
    const state = DEFAULT_STATE;

    // When: a client loads an empty preset.
    // Then: validation rejects the request.
    assert.throws(
      () => reduceMessage(state, { type: "load_preset", slot: 2 }),
      /Preset slot 2 is empty/,
    );
  });

  it("rejects non-boolean playing updates", () => {
    // Given: the default room state.
    const state = DEFAULT_STATE;

    // When: a client sends a string playing value.
    // Then: validation rejects it.
    assert.throws(
      () => reduceMessage(state, { type: "set_playing", playing: "true" }),
      /Playing must be true or false/,
    );
  });
});
