import { AudioScheduler } from "./audio.js";
import { applyLocalMessage, getReconnectDelayMs, nextTapTempo, parseBpmInput } from "./client-utils.js";
import { bindFullscreenToggle } from "./fullscreen.js";
import { bindShareModal } from "./qr-share.js";
import { renderTempoControl, syncTempoControl } from "./tempo-controls.js";

const METERS = [
  { label: "4/4", beats_per_bar: 4, beat_unit: 4 },
  { label: "3/4", beats_per_bar: 3, beat_unit: 4 },
  { label: "6/8", beats_per_bar: 6, beat_unit: 8 },
];
const BPM_SEND_INTERVAL_MS = 33;
const LONG_PRESS_DELAY_MS = 400;
const LONG_PRESS_REPEAT_MS = 100;

const elements = {
  connection: document.querySelector("#connection"),
  statusText: document.querySelector("[data-status-text]"),
  share: document.querySelector("#share"),
  fullscreen: document.querySelector("#fullscreen"),
  beatIndicator: document.querySelector("#beat-indicator"),
  bpmDisplay: document.querySelector("#bpm-display"),
  bpmMinus: document.querySelector("#bpm-minus"),
  bpmPlus: document.querySelector("#bpm-plus"),
  meterGroup: document.querySelector("#meter-group"),
  tapTempo: document.querySelector("#tap-tempo"),
  presetTrack: document.querySelector("#preset-track"),
  editPresets: document.querySelector("#edit-presets"),
  play: document.querySelector("#play"),
  message: document.querySelector("#message"),
  tempoControl: document.querySelector("#tempo-control"),
  shareModal: document.querySelector("#share-modal"),
  shareQr: document.querySelector("#share-qr"),
  shareUrl: document.querySelector("#share-url"),
  shareCopy: document.querySelector("#share-copy"),
  shareClose: document.querySelector("#share-close"),
};

const scheduler = new AudioScheduler((beat, delay) => flashBeat(beat, delay));
let socket = null;
let state = createInitialState();
let settings = { control_style: "slider", theme: "auto", updated_at: null };
let presets = [];
let tapTimes = [];
let reconnectAttempt = 0;
let reconnectTimer = null;
let offline = !navigator.onLine;
let pendingBpm = null;
let bpmTimer = null;
let lastBpmSentAt = 0;

bindControls();
bindNetworkEvents();
registerServiceWorker();
applyTheme();
applyState(state);
loadSettings();
loadPresets();
connect();

function bindControls() {
  bindFullscreenToggle(elements.fullscreen);
  bindShareModal({
    openButton: elements.share,
    modal: elements.shareModal,
    qrTarget: elements.shareQr,
    urlText: elements.shareUrl,
    copyButton: elements.shareCopy,
    closeButton: elements.shareClose,
  });
  bindPressStepper(elements.bpmMinus, -1);
  bindPressStepper(elements.bpmPlus, 1);
  elements.play.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    togglePlayback();
  });
  elements.tapTempo.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    tapTempo();
  });
  elements.editPresets.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    location.href = "/settings#presets-heading";
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", handleKeyboard);
  renderMeterButtons();
}

function bindNetworkEvents() {
  window.addEventListener("online", () => {
    offline = false;
    reconnectAttempt = 0;
    showMessage("Back online. Reconnecting to room state.", false);
    loadSettings();
    loadPresets();
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

async function loadSettings() {
  try {
    const response = await fetch("/api/settings", { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Settings request failed: ${response.status}`);
    }
    applySettings(await response.json());
  } catch {
    showMessage("Settings could not be loaded. Using local controls.", true);
    renderCurrentTempoControl();
  }
}

async function loadPresets() {
  try {
    const response = await fetch("/api/presets", { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Presets request failed: ${response.status}`);
    }
    presets = await response.json();
    renderPresets();
  } catch {
    renderPresets();
  }
}

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
    } else if (message.type === "settings:update" && message.settings) {
      applySettings(message.settings);
    } else if (message.type === "presets:update") {
      presets = message.presets ?? [];
      renderPresets();
    } else if (message.type === "error") {
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
  sendDiscrete({ type: "set_playing", playing: !state.playing });
}

function applySettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  presets = nextSettings.presets ?? presets;
  applyTheme();
  renderCurrentTempoControl();
  renderPresets();
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme ?? "auto";
}

function applyState(nextState) {
  state = nextState;
  const meter = currentMeter();
  elements.bpmDisplay.textContent = String(state.bpm);
  elements.play.textContent = state.playing ? "STOP" : "START";
  elements.play.classList.toggle("stopping", state.playing);
  elements.play.setAttribute("aria-label", state.playing ? "Stop metronome" : "Start metronome");
  elements.bpmMinus.disabled = state.bpm <= 30;
  elements.bpmPlus.disabled = state.bpm >= 300;
  for (const button of elements.meterGroup.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.meter === meter);
    button.setAttribute("aria-pressed", String(button.dataset.meter === meter));
  }
  renderBeatIndicator();
  syncTempoControl(elements.tempoControl, state.bpm);
  scheduler.update(state);
  if (state.playing && document.visibilityState !== "hidden") {
    scheduler.start(state).catch(() => showMessage("Audio playback is suspended.", true));
  } else {
    scheduler.stop();
  }
}

function renderBeatIndicator(activeBeat = 0) {
  elements.beatIndicator.replaceChildren();
  for (let index = 0; index < state.beats_per_bar; index += 1) {
    const dot = document.createElement("span");
    dot.className = "beat-dot";
    dot.textContent = String(index + 1);
    dot.classList.toggle("active", index === activeBeat && state.playing);
    elements.beatIndicator.append(dot);
  }
}

function renderCurrentTempoControl() {
  renderTempoControl(elements.tempoControl, {
    style: settings.control_style ?? "slider",
    bpm: state.bpm,
    onInput: updateBpmThrottled,
    onCommit: updateBpmImmediate,
    onTap: tapTempo,
  });
  setControlsDisabled(socket?.readyState !== WebSocket.OPEN && !offline);
}

function renderMeterButtons() {
  elements.meterGroup.replaceChildren();
  for (const meter of METERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = meter.label;
    button.dataset.meter = meter.label;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      sendDiscrete({ type: "set_meter", beats_per_bar: meter.beats_per_bar, beat_unit: meter.beat_unit });
    });
    elements.meterGroup.append(button);
  }
}

function renderPresets() {
  elements.presetTrack.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-chip";
    button.dataset.presetId = preset.id;
    button.innerHTML = `<strong>${preset.bpm}</strong><span>${preset.meter}</span>`;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("flash");
      setTimeout(() => button.classList.remove("flash"), 150);
      sendDiscrete({ type: "apply_preset", bpm: preset.bpm, meter: preset.meter });
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      location.href = `/settings#preset-${encodeURIComponent(preset.id)}`;
    });
    elements.presetTrack.append(button);
  }
}

function bindPressStepper(button, direction) {
  let holdTimer = null;
  let repeatTimer = null;
  const step = () => updateBpmImmediate(state.bpm + direction);
  const clear = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
    holdTimer = null;
    repeatTimer = null;
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (button.disabled) {
      return;
    }
    button.setPointerCapture(event.pointerId);
    step();
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(step, LONG_PRESS_REPEAT_MS);
    }, LONG_PRESS_DELAY_MS);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, clear);
  }
}

function updateBpmImmediate(value = pendingBpm) {
  const next = resolveRelativeBpm(value);
  if (next === null) {
    return;
  }
  clearTimeout(bpmTimer);
  bpmTimer = null;
  pendingBpm = null;
  sendBpm(next);
}

function updateBpmThrottled(value) {
  const next = resolveRelativeBpm(value);
  if (next === null) {
    return;
  }
  pendingBpm = next;
  const elapsed = performance.now() - lastBpmSentAt;
  if (elapsed >= BPM_SEND_INTERVAL_MS) {
    updateBpmImmediate(next);
    return;
  }
  clearTimeout(bpmTimer);
  bpmTimer = setTimeout(() => updateBpmImmediate(), BPM_SEND_INTERVAL_MS - elapsed);
}

function resolveRelativeBpm(value) {
  if (value === "+1" || value === "-1") {
    return parseBpmInput(state.bpm + Number(value)).bpm;
  }
  const parsed = parseBpmInput(value);
  if (!parsed.valid) {
    showMessage("BPM was adjusted to the supported 30-300 range.", true);
  }
  return parsed.bpm;
}

function sendBpm(bpm) {
  lastBpmSentAt = performance.now();
  send({ type: "set_bpm", bpm });
}

function tapTempo() {
  const result = nextTapTempo(tapTimes, performance.now());
  tapTimes = result.taps;
  if (result.ignored) {
    showMessage("Tap ignored. Keep taps at least 200ms apart.", true);
    return;
  }
  if (result.bpm) {
    updateBpmImmediate(result.bpm);
  }
}

function sendDiscrete(message) {
  clearTimeout(bpmTimer);
  bpmTimer = null;
  pendingBpm = null;
  send(message);
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

function handleKeyboard(event) {
  if (!window.matchMedia("(min-width: 1440px)").matches || event.target.closest("input, select, textarea")) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    updateBpmImmediate(state.bpm + (event.shiftKey ? 5 : 1));
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    updateBpmImmediate(state.bpm - (event.shiftKey ? 5 : 1));
  } else if (event.key.toLowerCase() === "t") {
    tapTempo();
  } else if (["1", "2", "3"].includes(event.key)) {
    const meter = METERS[Number(event.key) - 1];
    sendDiscrete({ type: "set_meter", beats_per_bar: meter.beats_per_bar, beat_unit: meter.beat_unit });
  }
}

function currentMeter() {
  return `${state.beats_per_bar}/${state.beat_unit}`;
}

function flashBeat(beat, delay) {
  setTimeout(() => {
    renderBeatIndicator(beat);
    elements.beatIndicator.classList.add("pulse");
    setTimeout(() => elements.beatIndicator.classList.remove("pulse"), 150);
  }, delay * 1000);
}

function setConnection(mode, text) {
  elements.connection.dataset.status = mode;
  elements.statusText.textContent = text;
}

function setControlsDisabled(disabled) {
  for (const control of document.querySelectorAll("[data-stage-control]")) {
    control.disabled = disabled;
  }
  for (const control of elements.tempoControl.querySelectorAll("button, input")) {
    control.disabled = disabled;
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
