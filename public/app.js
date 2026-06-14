import { AudioScheduler } from "./audio.js";
import {
  applyLocalMessage,
  getReconnectDelayMs,
  nextTapTempo,
  parseBpmInput,
} from "./client-utils.js";

const elements = {
  connection: document.querySelector("#connection"),
  statusText: document.querySelector("[data-status-text]"),
  fullscreen: document.querySelector("#fullscreen"),
  beatIndicator: document.querySelector("#beat-indicator"),
  bpmDisplay: document.querySelector("#bpm-display"),
  play: document.querySelector("#play"),
  message: document.querySelector("#message"),
  meterDisplay: document.querySelector("#meter-display"),
  tempoControl: document.querySelector("#tempo-control"),
};

const scheduler = new AudioScheduler((beat, delay) => flashBeat(beat, delay));
let socket = null;
let state = createInitialState();
let settings = {
  control_style: "dial",
  theme: "auto",
  fullscreen_only: false,
  updated_at: null,
  presets: [],
};
let tapTimes = [];
let reconnectAttempt = 0;
let reconnectTimer = null;
let offline = !navigator.onLine;
let renderedControlStyle = null;

bindControls();
bindNetworkEvents();
registerServiceWorker();
applyTheme();
applyState(state);
loadSettings();
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
  elements.play.addEventListener("click", togglePlayback);
  elements.fullscreen.addEventListener("click", () => document.documentElement.requestFullscreen?.());
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function bindNetworkEvents() {
  window.addEventListener("online", () => {
    offline = false;
    reconnectAttempt = 0;
    showMessage("Back online. Reconnecting to room state.", false);
    loadSettings();
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
    renderTempoControl();
  }
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
    if (message.type === "settings:update" && message.settings) {
      applySettings(message.settings);
      return;
    }
    if (message.type === "presets:update") {
      settings = { ...settings, presets: message.presets ?? [] };
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

function applySettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  applyTheme();
  renderTempoControl();
}

function applyTheme() {
  const theme = settings.theme ?? "auto";
  document.documentElement.dataset.theme = theme;
  document.body.classList.toggle("fullscreen-only", Boolean(settings.fullscreen_only));
}

function applyState(nextState) {
  state = nextState;
  const meter = `${state.beats_per_bar}/${state.beat_unit}`;
  elements.bpmDisplay.textContent = String(state.bpm);
  elements.play.textContent = state.playing ? "Stop" : "Start";
  elements.play.classList.toggle("stopping", state.playing);
  elements.play.setAttribute("aria-label", state.playing ? "Stop metronome" : "Start metronome");
  elements.meterDisplay.textContent = meter;
  renderBeatIndicator();
  syncTempoControlValue();
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

function renderTempoControl() {
  const style = settings.control_style ?? "dial";
  if (renderedControlStyle === style && elements.tempoControl.childElementCount > 0) {
    syncTempoControlValue();
    return;
  }

  renderedControlStyle = style;
  tapTimes = [];
  elements.tempoControl.replaceChildren();
  if (style === "slider") {
    renderSliderControl();
    return;
  }
  if (style === "wheel") {
    renderWheelControl();
    return;
  }
  if (style === "tap") {
    renderTapControl();
    return;
  }
  renderDialControl();
}

function renderDialControl() {
  const wrapper = document.createElement("div");
  wrapper.className = "dial-control";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "slider");
  wrapper.setAttribute("aria-label", "Dial tempo control");
  wrapper.setAttribute("aria-valuemin", "30");
  wrapper.setAttribute("aria-valuemax", "300");
  wrapper.innerHTML = `
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <circle class="dial-track" cx="80" cy="80" r="66"></circle>
      <circle class="dial-progress" cx="80" cy="80" r="66"></circle>
      <line class="dial-needle" x1="80" y1="80" x2="80" y2="31"></line>
      <circle class="dial-hub" cx="80" cy="80" r="14"></circle>
    </svg>
    <span>Dial</span>
  `;
  const drag = (event) => {
    const rect = wrapper.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const angle = (Math.atan2(y, x) * 180) / Math.PI + 90;
    const normalized = (angle + 360) % 360;
    updateBpm(30 + Math.round((normalized / 360) * 270));
  };
  wrapper.addEventListener("pointerdown", (event) => {
    wrapper.setPointerCapture(event.pointerId);
    wrapper.classList.add("pressed");
    drag(event);
  });
  wrapper.addEventListener("pointermove", (event) => {
    if (wrapper.hasPointerCapture(event.pointerId)) {
      drag(event);
    }
  });
  wrapper.addEventListener("pointerup", (event) => {
    wrapper.releasePointerCapture(event.pointerId);
    wrapper.classList.remove("pressed");
  });
  wrapper.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
    updateBpm(state.bpm + direction * (event.shiftKey ? 10 : 1));
  });
  elements.tempoControl.append(wrapper);
  syncTempoControlValue();
}

function renderSliderControl() {
  const label = document.createElement("label");
  label.className = "slider-control";
  label.innerHTML = `
    <span>Tempo</span>
    <input type="range" min="30" max="300" value="${state.bpm}" aria-label="BPM slider">
  `;
  label.querySelector("input").addEventListener("input", (event) => updateBpm(event.target.value));
  elements.tempoControl.append(label);
}

function renderWheelControl() {
  const control = document.createElement("div");
  control.className = "wheel-control";
  control.tabIndex = 0;
  control.setAttribute("role", "spinbutton");
  control.setAttribute("aria-label", "Wheel tempo control");
  control.innerHTML = "<span>Swipe or scroll</span><strong data-wheel-value></strong>";
  let touchStart = null;
  control.addEventListener("wheel", (event) => {
    event.preventDefault();
    updateBpm(state.bpm + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  control.addEventListener("touchstart", (event) => {
    touchStart = event.touches[0]?.clientY ?? null;
  }, { passive: true });
  control.addEventListener("touchmove", (event) => {
    if (touchStart === null) {
      return;
    }
    const next = event.touches[0]?.clientY ?? touchStart;
    const delta = touchStart - next;
    if (Math.abs(delta) >= 12) {
      updateBpm(state.bpm + Math.sign(delta));
      touchStart = next;
    }
  }, { passive: true });
  control.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
    updateBpm(state.bpm + direction * (event.shiftKey ? 10 : 1));
  });
  elements.tempoControl.append(control);
  syncTempoControlValue();
}

function renderTapControl() {
  const button = document.createElement("button");
  button.className = "tap-control";
  button.type = "button";
  button.textContent = "TAP";
  button.addEventListener("click", tapTempo);
  elements.tempoControl.append(button);
}

function syncTempoControlValue() {
  const dial = elements.tempoControl.querySelector(".dial-control");
  if (dial) {
    const angle = ((state.bpm - 30) / 270) * 360;
    dial.style.setProperty("--dial-angle", `${angle}deg`);
    dial.style.setProperty("--dial-progress", String(415 - 415 * ((state.bpm - 30) / 270)));
    dial.setAttribute("aria-valuenow", String(state.bpm));
  }
  const slider = elements.tempoControl.querySelector("input[type='range']");
  if (slider) {
    slider.value = String(state.bpm);
  }
  const wheelValue = elements.tempoControl.querySelector("[data-wheel-value]");
  if (wheelValue) {
    wheelValue.textContent = `${state.bpm} BPM`;
  }
}

function updateBpm(value) {
  const parsed = parseBpmInput(value);
  send({ type: "set_bpm", bpm: parsed.bpm });
  if (!parsed.valid) {
    showMessage("BPM was adjusted to the supported 30-300 range.", true);
  }
}

function tapTempo() {
  const result = nextTapTempo(tapTimes, performance.now());
  tapTimes = result.taps;
  if (result.ignored) {
    showMessage("Tap ignored. Keep taps at least 200ms apart.", true);
    return;
  }
  if (result.bpm) {
    updateBpm(result.bpm);
  }
}

function flashBeat(beat, delay) {
  setTimeout(() => {
    renderBeatIndicator(beat);
    elements.beatIndicator.classList.add("pulse");
    setTimeout(() => elements.beatIndicator.classList.remove("pulse"), 180);
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
  elements.play.disabled = disabled;
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
