export const DEFAULT_STATE = Object.freeze({
  bpm: 120,
  beats_per_bar: 4,
  beat_unit: 4,
  playing: false,
  presets: makeEmptyPresets(),
});

const MIN_BPM = 30;
const MAX_BPM = 300;
const SUPPORTED_METERS = new Set(["4/4", "3/4", "6/8"]);

export function reduceMessage(state, message) {
  const parsed = parseMessage(message);
  switch (parsed.type) {
    case "set_bpm":
      return { ...state, bpm: parsed.bpm };
    case "set_meter":
      return {
        ...state,
        beats_per_bar: parsed.beats_per_bar,
        beat_unit: parsed.beat_unit,
      };
    case "set_playing":
      return { ...state, playing: parsed.playing };
    case "toggle_playing":
      return { ...state, playing: !state.playing };
    case "overwrite_preset":
      return {
        ...state,
        presets: state.presets.map((preset, index) =>
          index === parsed.slot - 1
            ? {
                slot: parsed.slot,
                bpm: state.bpm,
                beats_per_bar: state.beats_per_bar,
                beat_unit: state.beat_unit,
              }
            : preset,
        ),
      };
    case "load_preset": {
      const preset = state.presets[parsed.slot - 1];
      if (!preset) {
        throw new ValidationError(`Preset slot ${parsed.slot} is empty`);
      }
      return {
        ...state,
        bpm: preset.bpm,
        beats_per_bar: preset.beats_per_bar,
        beat_unit: preset.beat_unit,
      };
    }
    default:
      return assertNever(parsed);
  }
}

export function normalizeState(value) {
  return {
    bpm: parseBpm(value.bpm),
    beats_per_bar: parseMeter(value.beats_per_bar, value.beat_unit).beats_per_bar,
    beat_unit: parseMeter(value.beats_per_bar, value.beat_unit).beat_unit,
    playing: Boolean(value.playing),
    presets: normalizePresets(value.presets),
  };
}

export function makeEmptyPresets() {
  return Array.from({ length: 10 }, () => null);
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function parseMessage(message) {
  if (!message || typeof message !== "object") {
    throw new ValidationError("Message must be an object");
  }
  switch (message.type) {
    case "set_bpm":
      return { type: "set_bpm", bpm: parseBpm(message.bpm) };
    case "set_meter":
      return {
        type: "set_meter",
        ...parseMeter(message.beats_per_bar, message.beat_unit),
      };
    case "set_playing":
      return { type: "set_playing", playing: parseBoolean(message.playing) };
    case "toggle_playing":
      return { type: "toggle_playing" };
    case "overwrite_preset":
      return { type: "overwrite_preset", slot: parseSlot(message.slot) };
    case "load_preset":
      return { type: "load_preset", slot: parseSlot(message.slot) };
    default:
      throw new ValidationError("Unsupported message type");
  }
}

function normalizePresets(presets) {
  const result = makeEmptyPresets();
  if (!Array.isArray(presets)) {
    return result;
  }
  for (const preset of presets) {
    if (!preset) {
      continue;
    }
    const slot = parseSlot(preset.slot);
    const meter = parseMeter(preset.beats_per_bar, preset.beat_unit);
    result[slot - 1] = {
      slot,
      bpm: parseBpm(preset.bpm),
      beats_per_bar: meter.beats_per_bar,
      beat_unit: meter.beat_unit,
    };
  }
  return result;
}

function parseBpm(value) {
  if (!Number.isInteger(value) || value < MIN_BPM || value > MAX_BPM) {
    throw new ValidationError("BPM must be between 30 and 300");
  }
  return value;
}

function parseMeter(beatsPerBar, beatUnit) {
  if (!Number.isInteger(beatsPerBar) || !Number.isInteger(beatUnit)) {
    throw new ValidationError("Meter must be 4/4, 3/4, or 6/8");
  }
  const key = `${beatsPerBar}/${beatUnit}`;
  if (!SUPPORTED_METERS.has(key)) {
    throw new ValidationError("Meter must be 4/4, 3/4, or 6/8");
  }
  return { beats_per_bar: beatsPerBar, beat_unit: beatUnit };
}

function parseSlot(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new ValidationError("Preset slot must be between 1 and 10");
  }
  return value;
}

function parseBoolean(value) {
  if (typeof value !== "boolean") {
    throw new ValidationError("Playing must be true or false");
  }
  return value;
}

function assertNever(value) {
  throw new ValidationError(`Unhandled message: ${JSON.stringify(value)}`);
}
