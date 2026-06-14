export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const MIN_TAP_MS = 200;
export const MAX_TAP_MS = 2000;
export const MAX_RECONNECT_DELAY_MS = 30000;

export function parseBpmInput(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { bpm: MIN_BPM, valid: false };
  }
  const rounded = Math.round(numeric);
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, rounded));
  return { bpm, valid: bpm === rounded };
}

export function getReconnectDelayMs(attempt) {
  return Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** Math.max(0, attempt));
}

export function nextTapTempo(previousTaps, now) {
  const lastTap = previousTaps.at(-1);
  if (lastTap !== undefined) {
    const gap = now - lastTap;
    if (gap < MIN_TAP_MS) {
      return { taps: previousTaps, bpm: null, ignored: true };
    }
    if (gap > MAX_TAP_MS) {
      return { taps: [now], bpm: null, ignored: false };
    }
  }

  const taps = [...previousTaps, now].slice(-5);
  if (taps.length < 2) {
    return { taps, bpm: null, ignored: false };
  }

  const gaps = taps.slice(1).map((time, index) => time - taps[index]);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return { taps, bpm: parseBpmInput(60000 / averageGap).bpm, ignored: false };
}

export function applyLocalMessage(state, message) {
  switch (message.type) {
    case "set_bpm":
      return { ...state, bpm: parseBpmInput(message.bpm).bpm };
    case "set_meter":
      return { ...state, beats_per_bar: message.beats_per_bar, beat_unit: message.beat_unit };
    case "set_playing":
      return { ...state, playing: Boolean(message.playing) };
    case "toggle_playing":
      return { ...state, playing: !state.playing };
    case "overwrite_preset":
      return {
        ...state,
        presets: state.presets.map((preset, index) =>
          index === message.slot - 1
            ? {
                slot: message.slot,
                bpm: state.bpm,
                beats_per_bar: state.beats_per_bar,
                beat_unit: state.beat_unit,
              }
            : preset,
        ),
      };
    case "load_preset": {
      const preset = state.presets[message.slot - 1];
      return preset
        ? {
            ...state,
            bpm: preset.bpm,
            beats_per_bar: preset.beats_per_bar,
            beat_unit: preset.beat_unit,
          }
        : state;
    }
    default:
      return state;
  }
}
