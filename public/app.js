import { AudioScheduler } from "./audio.js";
import {
  applyLocalMessage,
  getReconnectDelayMs,
  nextTapTempo,
  parseBpmInput,
} from "./client-utils.js";
import { renderPresetShell, renderPresets } from "./preset-view.js";

const elements = {
  connection: document.querySelector("#connection"),
  statusText: document.querySelector("[data-status-text]"),
  fullscreen: document.querySelector("#fullscreen"),
  flash: document.querySelector("#flash"),
  beatLabel: document.querySelector("[data-beat-label]"),
  bpmDisplay: document.querySelector("#bpm-display"),
  bpmRange: document.querySelector("#bpm-range"),
  bpmNumber: document.querySelector("#bpm-number"),
  play: document.querySelector("#play"),
  tap: document.querySelector("#tap"),
  message: document.querySelector("#message"),
  meterDisplay: document.querySelector("#meter-display"),
  presetGrid: document.querySelector("#preset-grid"),
  meters: [...document.querySelectorAll(".meter-button")],
};

const scheduler = new AudioScheduler((beat, delay) => flashBeat(beat, delay));
let socket = null;
let state = createInitialState();
let tapTimes = [];
let reconnectAttempt = 0;
let reconnectTimer = null;
let offline = !navigator.onLine;

renderPresetShell(elements.presetGrid, handlePresetAction);
bindControls();
bindNetworkEvents();
registerServiceWorker();
applyState(state);
connect();

function connect() {
  clearTimeout(reconnectTimer);
  if (offline) {
    setConnection("offline", "Offline");
    setControlsDisabled(false);
    return;
  }

  setConnection("connecting", reconnectAttempt ? "Reconnecting" : "Connecting");
  setControlsDisabled(true);
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("open", handleSocketOpen);
  socket.addEventListener("close", handleSocketClose);
  socket.addEventListener("error", () => showMessage("Connection error. Retrying shortly.", true));
  socket.addEventListener("message", handleSocketMessage);
}

function bindControls() {
  elements.bpmRange.addEventListener("input", () => updateBpm(elements.bpmRange.value));
  elements.bpmNumber.addEventListener("change", () => updateBpm(elements.bpmNumber.value));
  elements.play.addEventListener("click", togglePlayback);
  elements.tap.addEventListener("click", tapTempo);
  elements.fullscreen.addEventListener("click", () => document.documentElement.requestFullscreen?.());
  document.addEventListener("visibilitychange", handleVisibilityChange);

  for (const button of elements.meters) {
    button.addEventListener("click", () => {
      const [beatsPerBar, beatUnit] = button.dataset.meter.split("/").map(Number);
      send({ type: "set_meter", beats_per_bar: beatsPerBar, beat_unit: beatUnit });
    });
  }
}

function bindNetworkEvents() {
  window.addEventListener("online", () => {
    offline = false;
    reconnectAttempt = 0;
    showMessage("Back online. Reconnecting to room state.", false);
    connect();
  });
  window.addEventListener("offline", () => {
    offline = true;
    socket?.close();
    setConnection("offline", "Offline");
    setControlsDisabled(false);
    showMessage("Offline mode. Changes stay on this device until reconnect.", false);
  });
}

function createInitialState() {
  return {
    bpm: 120,
    beats_per_bar: 4,
    beat_unit: 4,
    playing: false,
    presets: Array.from({ length: 10 }, () => null),
  };
}

function handleSocketOpen() {
  reconnectAttempt = 0;
  setConnection("live", "Live");
  setControlsDisabled(false);
  showMessage("", false);
}

function handleSocketClose() {
  scheduler.stop();
  if (offline) {
    return;
  }
  setControlsDisabled(true);
  const delay = getReconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  setConnection("reconnecting", `Reconnecting in ${Math.round(delay / 1000)}s`);
  reconnectTimer = setTimeout(connect, delay);
}

function handleSocketMessage(event) {
  try {
    const message = JSON.parse(event.data);
    if (message.type === "state" && message.state) {
      applyState(message.state);
      return;
    }
    if (message.type === "error") {
      showMessage(message.message || "Server rejected the last change.", true);
    }
  } catch {
    showMessage("Received an unreadable server message.", true);
  }
}

async function togglePlayback() {
  if (!state) {
    return;
  }
  if (!state.playing) {
    try {
      await scheduler.resume();
    } catch {
      showMessage("Audio could not start. Tap Start again after allowing sound.", true);
      return;
    }
  }
  send({ type: "set_playing", playing: !state.playing });
}

function applyState(nextState) {
  state = nextState;
  const meter = `${state.beats_per_bar}/${state.beat_unit}`;
  elements.bpmDisplay.textContent = String(state.bpm);
  elements.bpmRange.value = String(state.bpm);
  elements.bpmNumber.value = String(state.bpm);
  elements.bpmNumber.classList.remove("invalid");
  elements.play.textContent = state.playing ? "Stop" : "Start";
  elements.play.classList.toggle("stopping", state.playing);
  elements.play.setAttribute("aria-label", state.playing ? "Stop metronome" : "Start metronome");
  elements.meterDisplay.textContent = meter;
  for (const button of elements.meters) {
    button.classList.toggle("active", button.dataset.meter === meter);
  }
  renderPresets(elements.presetGrid, state);
  scheduler.update(state);
  if (state.playing && document.visibilityState !== "hidden") {
    scheduler.start(state).catch(() => showMessage("Audio playback is suspended.", true));
  } else {
    scheduler.stop();
  }
}

function updateBpm(value) {
  const parsed = parseBpmInput(value);
  elements.bpmNumber.classList.toggle("invalid", !parsed.valid);
  elements.bpmRange.value = String(parsed.bpm);
  elements.bpmNumber.value = String(parsed.bpm);
  send({ type: "set_bpm", bpm: parsed.bpm });
  if (!parsed.valid) {
    showMessage("BPM was adjusted to the supported 30-300 range.", true);
  }
}

function tapTempo() {
  const result = nextTapTempo(tapTimes, performance.now());
  tapTimes = result.taps;
  if (result.ignored) {
    showMessage("Tap ignored. Keep taps between 200ms and 3s apart.", true);
    return;
  }
  if (result.bpm) {
    send({ type: "set_bpm", bpm: result.bpm });
  }
}

function handlePresetAction(message) {
  const isSave = message.type === "overwrite_preset";
  send(message, isSave ? "Preset could not be saved." : "Preset could not be loaded.");
  if (isSave) {
    showMessage("Preset saved.", false);
  }
}

function flashBeat(beat, delay) {
  setTimeout(() => {
    elements.flash.classList.add("active");
    elements.flash.dataset.beat = String(beat + 1);
    elements.beatLabel.textContent = String(beat + 1);
    setTimeout(() => elements.flash.classList.remove("active"), 110);
  }, delay * 1000);
}

function send(message, failureMessage = "Change could not be sent.") {
  if (offline && state) {
    applyState(applyLocalMessage(state, message));
    return true;
  }
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  showMessage(failureMessage, true);
  return false;
}

function setConnection(mode, text) {
  elements.connection.dataset.status = mode;
  elements.statusText.textContent = text;
}

function setControlsDisabled(disabled) {
  for (const input of [elements.bpmRange, elements.bpmNumber, elements.play, elements.tap, ...elements.meters]) {
    input.disabled = disabled;
  }
  for (const button of elements.presetGrid.querySelectorAll("button")) {
    button.disabled = disabled || (button.dataset.load && button.dataset.empty === "true");
  }
}

function showMessage(text, isError) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

async function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    await scheduler.suspend();
    return;
  }
  if (state?.playing) {
    scheduler.start(state).catch(() => showMessage("Audio playback is suspended.", true));
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      showMessage("Offline cache is unavailable in this browser.", true);
    });
  }
}
