import { AudioScheduler } from "./audio.js";

const elements = {
  connection: document.querySelector("#connection"),
  fullscreen: document.querySelector("#fullscreen"),
  flash: document.querySelector("#flash"),
  bpmDisplay: document.querySelector("#bpm-display"),
  bpmRange: document.querySelector("#bpm-range"),
  bpmNumber: document.querySelector("#bpm-number"),
  play: document.querySelector("#play"),
  tap: document.querySelector("#tap"),
  meterDisplay: document.querySelector("#meter-display"),
  presetGrid: document.querySelector("#preset-grid"),
  meters: [...document.querySelectorAll(".meter-button")],
};

let socket = null;
let state = null;
let tapTimes = [];
const scheduler = new AudioScheduler((beat, delay) => flashBeat(beat, delay));

connect();
renderPresetShell();
bindControls();
registerServiceWorker();

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("open", () => setConnection("Live"));
  socket.addEventListener("close", () => {
    setConnection("Reconnecting");
    scheduler.stop();
    setTimeout(connect, 900);
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      applyState(message.state);
    }
    if (message.type === "error") {
      setConnection(message.message);
    }
  });
}

function bindControls() {
  elements.bpmRange.addEventListener("input", () => updateBpm(elements.bpmRange.value));
  elements.bpmNumber.addEventListener("change", () => updateBpm(elements.bpmNumber.value));
  elements.play.addEventListener("click", () => {
    if (state) {
      send({ type: "set_playing", playing: !state.playing });
    }
  });
  elements.tap.addEventListener("click", tapTempo);
  elements.fullscreen.addEventListener("click", () => document.documentElement.requestFullscreen?.());
  for (const button of elements.meters) {
    button.addEventListener("click", () => {
      const [beatsPerBar, beatUnit] = button.dataset.meter.split("/").map(Number);
      send({ type: "set_meter", beats_per_bar: beatsPerBar, beat_unit: beatUnit });
    });
  }
}

function applyState(nextState) {
  state = nextState;
  elements.bpmDisplay.textContent = String(state.bpm);
  elements.bpmRange.value = String(state.bpm);
  elements.bpmNumber.value = String(state.bpm);
  elements.play.textContent = state.playing ? "Stop" : "Start";
  elements.play.classList.toggle("stopping", state.playing);
  elements.meterDisplay.textContent = `${state.beats_per_bar}/${state.beat_unit}`;
  for (const button of elements.meters) {
    button.classList.toggle("active", button.dataset.meter === elements.meterDisplay.textContent);
  }
  renderPresets();
  scheduler.update(state);
  if (state.playing) {
    scheduler.start(state);
  } else {
    scheduler.stop();
  }
}

function updateBpm(value) {
  const bpm = Number(value);
  if (Number.isInteger(bpm) && bpm >= 30 && bpm <= 300) {
    send({ type: "set_bpm", bpm });
  }
}

function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((time) => now - time < 2500);
  tapTimes.push(now);
  if (tapTimes.length < 2) {
    return;
  }
  const gaps = tapTimes.slice(1).map((time, index) => time - tapTimes[index]);
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const bpm = Math.min(300, Math.max(30, Math.round(60000 / average)));
  send({ type: "set_bpm", bpm });
}

function renderPresetShell() {
  for (let slot = 1; slot <= 10; slot += 1) {
    const card = document.createElement("article");
    card.className = "preset-slot";
    card.innerHTML = `
      <div class="preset-label"><strong>${slot}</strong><span data-preset-value="${slot}">Empty</span></div>
      <div class="preset-actions">
        <button type="button" data-load="${slot}">Load</button>
        <button type="button" data-save="${slot}">Save</button>
      </div>
    `;
    elements.presetGrid.append(card);
  }
  elements.presetGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    if (button.dataset.load) {
      send({ type: "load_preset", slot: Number(button.dataset.load) });
    }
    if (button.dataset.save) {
      send({ type: "overwrite_preset", slot: Number(button.dataset.save) });
    }
  });
}

function renderPresets() {
  state.presets.forEach((preset, index) => {
    const slot = index + 1;
    const label = document.querySelector(`[data-preset-value="${slot}"]`);
    const load = document.querySelector(`[data-load="${slot}"]`);
    label.textContent = preset ? `${preset.bpm} BPM ${preset.beats_per_bar}/${preset.beat_unit}` : "Empty";
    load.disabled = !preset;
  });
}

function flashBeat(beat, delay) {
  setTimeout(() => {
    elements.flash.classList.add("active");
    elements.flash.dataset.beat = String(beat + 1);
    setTimeout(() => elements.flash.classList.remove("active"), 90);
  }, delay * 1000);
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function setConnection(text) {
  elements.connection.textContent = text;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
}
