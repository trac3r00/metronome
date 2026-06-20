import { AudioScheduler, SOUND_OPTIONS } from "./audio.js";
import {
  AUDIO_UNLOCK_MESSAGE,
  applyLocalMessage,
  createAutoplayGestureGate,
  createPresetTapGesture,
  getReconnectDelayMs,
  nextTapTempo,
  parseBpmInput,
  syncSchedulerToState,
} from "./client-utils.js";
import { bindShareModal } from "./qr-share.js";
import { renderTempoControl, syncTempoControl } from "./tempo-controls.js";

const METERS = [
  { label: "4/4", beats_per_bar: 4, beat_unit: 4 },
  { label: "3/4", beats_per_bar: 3, beat_unit: 4 },
  { label: "6/8", beats_per_bar: 6, beat_unit: 8 },
];
const CONTROL_STYLES = [
  { id: "dial", label: "Dial", preview: "circle" },
  { id: "slider", label: "Slider", preview: "line" },
  { id: "wheel", label: "Wheel", preview: "stack" },
  { id: "tap", label: "Tap Tempo", preview: "tap" },
];
const BPM_SEND_INTERVAL_MS = 33;
const LONG_PRESS_DELAY_MS = 400;
const LONG_PRESS_REPEAT_MS = 100;

const elements = {
  connection: document.querySelector("#connection"),
  statusText: document.querySelector("[data-status-text]"),
  share: document.querySelector("#share"),
  openSettings: document.querySelector("#open-settings"),
  perfToggle: document.querySelector("#perf-toggle"),
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
  shareQrDetails: document.querySelector("#share-qr-details"),
  shareUrl: document.querySelector("#share-url"),
  shareCopy: document.querySelector("#share-copy"),
  shareNative: document.querySelector("#share-native"),
  shareClose: document.querySelector("#share-close"),
  shareFallback: document.querySelector("#share-fallback"),
  settingsModal: document.querySelector("#settings-modal"),
  settingsClose: document.querySelector("#settings-close"),
  presetList: document.querySelector("#preset-list"),
  addPreset: document.querySelector("#add-preset"),
  controlStyles: document.querySelector("#control-styles"),
  soundOptions: document.querySelector("#sound-options"),
  volumeSlider: document.querySelector("#volume-slider"),
  volumeValue: document.querySelector("#volume-value"),
  previewToggle: document.querySelector("#preview-toggle"),
  backgroundAudioToggle: document.querySelector("#background-audio-toggle"),
  performanceModeToggle: document.querySelector("#performance-mode-toggle"),
  theme: document.querySelector("#theme-select"),
  lastSynced: document.querySelector("#last-synced"),
  forceResync: document.querySelector("#force-resync"),
  presetModal: document.querySelector("#preset-modal"),
  presetForm: document.querySelector("#preset-form"),
  presetModalTitle: document.querySelector("#preset-modal-title"),
  presetId: document.querySelector("#preset-id"),
  presetBpm: document.querySelector("#preset-bpm"),
  presetMeter: document.querySelector("#preset-meter"),
  presetName: document.querySelector("#preset-name"),
};

const scheduler = new AudioScheduler((beat, delay) => flashBeat(beat, delay));
const autoplayGate = createAutoplayGestureGate({
  target: document,
  start: () => {
    return state?.playing ? scheduler.start(state) : Promise.resolve();
  },
  showMessage,
  getCurrentMessage: () => elements.message.textContent,
  isStillPlaying: () => Boolean(state?.playing),
  stop: () => scheduler.stop(),
  onError: () => showMessage(AUDIO_UNLOCK_MESSAGE, true),
});
let socket = null;
let state = createInitialState();
let settings = {
  control_style: "slider",
  theme: "auto",
  sound_id: "studio",
  volume: 80,
  preview_sound_on_change: true,
  background_audio: true,
  performance_mode: false,
  updated_at: null,
};
let presets = [];
let tapTimes = [];
let reconnectAttempt = 0;
let reconnectTimer = null;
let offline = !navigator.onLine;
let pendingBpm = null;
let bpmTimer = null;
let lastBpmSentAt = 0;
let volumeSaveTimer = null;

bindControls();
bindNetworkEvents();
registerServiceWorker();
applyTheme();
applyState(state);
loadSettings();
loadPresets();
connect();

function bindControls() {
  bindShareModal({
    openButton: elements.share,
    modal: elements.shareModal,
    qrTarget: elements.shareQr,
    qrDetails: elements.shareQrDetails,
    urlText: elements.shareUrl,
    copyButton: elements.shareCopy,
    nativeShareButton: elements.shareNative,
    closeButton: elements.shareClose,
    fallbackHint: elements.shareFallback,
  });
  bindSettingsModal();
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
    openSettings();
  });
  elements.perfToggle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    togglePerformanceMode();
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", handleKeyboard);
  renderMeterButtons();
}

function bindSettingsModal() {
  elements.openSettings.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    openSettings();
  });
  elements.settingsClose.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    elements.settingsModal.close();
  });
  elements.settingsModal.addEventListener("pointerdown", (event) => {
    if (event.target === elements.settingsModal) {
      elements.settingsModal.close();
    }
  });
  elements.theme.addEventListener("change", () => saveSettings({ theme: elements.theme.value }));
  elements.volumeSlider.addEventListener("input", handleVolumeInput);
  elements.volumeSlider.addEventListener("change", () => saveSettings({ volume: Number(elements.volumeSlider.value) }));
  elements.previewToggle.addEventListener("change", () =>
    saveSettings({ preview_sound_on_change: elements.previewToggle.checked }),
  );
  elements.backgroundAudioToggle.addEventListener("change", () =>
    saveSettings({ background_audio: elements.backgroundAudioToggle.checked }),
  );
  elements.performanceModeToggle.addEventListener("change", () => {
    settings = { ...settings, performance_mode: elements.performanceModeToggle.checked };
    applyPerformanceMode();
    saveSettings({ performance_mode: elements.performanceModeToggle.checked });
  });
  elements.forceResync.addEventListener("click", () => {
    loadSettings();
    loadPresets();
  });
  elements.addPreset.addEventListener("click", () => openPresetEditor());
  elements.presetForm.addEventListener("submit", savePresetForm);
}

function openSettings() {
  if (typeof elements.settingsModal.showModal === "function") {
    if (!elements.settingsModal.open) {
      elements.settingsModal.showModal();
    }
  } else {
    elements.settingsModal.setAttribute("open", "");
  }
  // Settings modal stays on the same page, so the metronome scheduler is never torn down.
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
    markSynced();
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
    renderSettingsPresetList();
  } catch {
    renderPresets();
    renderSettingsPresetList();
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
      markSynced();
    } else if (message.type === "presets:update") {
      presets = message.presets ?? [];
      renderPresets();
      renderSettingsPresetList();
      markSynced();
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
  scheduler.setSound(settings.sound_id);
  scheduler.setVolume(settings.volume);
  applyTheme();
  applyPerformanceMode();
  renderCurrentTempoControl();
  renderPresets();
  renderControlStyleCards();
  renderSoundOptionCards();
  renderSettingsPresetList();
  syncSettingsControls();
}

function applyPerformanceMode() {
  const on = settings.performance_mode === true;
  document.body.classList.toggle("perf-mode", on);
  if (elements.perfToggle) {
    elements.perfToggle.setAttribute("aria-pressed", String(on));
    elements.perfToggle.classList.toggle("active", on);
  }
}

function togglePerformanceMode() {
  // Local-first: flip the class instantly, persist asynchronously. Matches the
  // sound-card / volume-slider lag fix — the live band should never wait on
  // a round trip.
  const next = !(settings.performance_mode === true);
  settings = { ...settings, performance_mode: next };
  applyPerformanceMode();
  saveSettings({ performance_mode: next });
}

function syncSettingsControls() {
  elements.theme.value = settings.theme ?? "auto";
  elements.volumeSlider.value = String(settings.volume ?? 80);
  elements.volumeValue.textContent = `${settings.volume ?? 80}%`;
  elements.previewToggle.checked = settings.preview_sound_on_change !== false;
  elements.backgroundAudioToggle.checked = settings.background_audio !== false;
  elements.performanceModeToggle.checked = settings.performance_mode === true;
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
  syncSchedulerToState({
    state,
    scheduler,
    visibilityState: document.visibilityState,
    onAutoplayBlocked: () => autoplayGate.request(),
    backgroundAudio: settings.background_audio !== false,
  });
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
    const gesture = createPresetTapGesture(() => {
      button.classList.add("flash");
      setTimeout(() => button.classList.remove("flash"), 150);
      sendDiscrete({ type: "apply_preset", bpm: preset.bpm, meter: preset.meter });
    });
    button.addEventListener("pointerdown", (event) => {
      gesture.pointerDown(event);
    });
    button.addEventListener("pointermove", (event) => {
      gesture.pointerMove(event);
    });
    button.addEventListener("pointerup", (event) => {
      gesture.pointerUp(event);
    });
    button.addEventListener("pointercancel", () => {
      gesture.pointerCancel();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openSettings();
    });
    elements.presetTrack.append(button);
  }
}

function renderControlStyleCards() {
  elements.controlStyles.replaceChildren();
  for (const control of CONTROL_STYLES) {
    const card = document.createElement("button");
    card.className = "radio-card";
    card.type = "button";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(settings.control_style === control.id));
    card.innerHTML = `
      <span class="control-preview ${control.preview}" aria-hidden="true"></span>
      <strong>${control.label}</strong>
    `;
    card.addEventListener("click", () => saveSettings({ control_style: control.id }));
    elements.controlStyles.append(card);
  }
}

function renderSoundOptionCards() {
  elements.soundOptions.replaceChildren();
  // Group cards by their `group` field so users can scan band/percussion/
  // classic/subtle/modern families fast.
  const groups = new Map();
  for (const sound of SOUND_OPTIONS) {
    const key = sound.group ?? "Sounds";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sound);
  }
  for (const [groupName, sounds] of groups) {
    const heading = document.createElement("div");
    heading.className = "sound-group-heading";
    heading.textContent = groupName;
    elements.soundOptions.append(heading);
    const grid = document.createElement("div");
    grid.className = "sound-group-grid";
    for (const sound of sounds) {
      const card = document.createElement("div");
      card.className = "radio-card sound-card";
      card.tabIndex = 0;
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", String(settings.sound_id === sound.id));
      card.innerHTML = `
        <span class="sound-mark ${sound.id}" aria-hidden="true"></span>
        <strong>${sound.name}</strong>
        <span>${sound.id}</span>
      `;
      const playButton = document.createElement("button");
      playButton.className = "small-button ghost";
      playButton.type = "button";
      playButton.textContent = "Play";
      playButton.addEventListener("click", (event) => {
        event.stopPropagation();
        previewSound(sound.id, { force: true });
      });
      card.append(playButton);
      card.addEventListener("click", () => {
        const changed = settings.sound_id !== sound.id;
        // Local-first: apply to scheduler + UI instantly (~25ms perceived),
        // then persist async. Fixes v1.5 round-trip lag.
        if (changed) {
          settings = { ...settings, sound_id: sound.id };
          scheduler.setSound(sound.id);
          renderSoundOptionCards();
        }
        saveSettings({ sound_id: sound.id });
        if (changed && settings.preview_sound_on_change !== false) {
          previewSound(sound.id);
        }
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const changed = settings.sound_id !== sound.id;
          if (changed) {
            settings = { ...settings, sound_id: sound.id };
            scheduler.setSound(sound.id);
            renderSoundOptionCards();
          }
          saveSettings({ sound_id: sound.id });
          if (changed && settings.preview_sound_on_change !== false) {
            previewSound(sound.id);
          }
        }
      });
      grid.append(card);
    }
    elements.soundOptions.append(grid);
  }
}

function renderSettingsPresetList() {
  elements.presetList.replaceChildren();
  for (const preset of presets) {
    const row = document.createElement("article");
    row.className = "preset-row";
    row.draggable = true;
    row.dataset.id = preset.id;
    const nameLabel = preset.name ? ` - ${escapeText(preset.name)}` : "";
    row.innerHTML = `
      <div>
        <strong>${preset.bpm} BPM</strong>
        <span>${preset.meter}${nameLabel}</span>
      </div>
      <div class="preset-row-actions">
        <button type="button" data-action="up" aria-label="Move preset up">▲</button>
        <button type="button" data-action="down" aria-label="Move preset down">▼</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="delete">Delete</button>
      </div>
    `;
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", preset.id));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      movePreset(event.dataTransfer.getData("text/plain"), preset.id);
    });
    row.addEventListener("click", (event) => handlePresetRowAction(event, preset));
    elements.presetList.append(row);
  }
}

function handlePresetRowAction(event, preset) {
  const action = event.target.closest("button")?.dataset.action;
  if (!action) {
    return;
  }
  if (action === "edit") {
    openPresetEditor(preset);
  } else if (action === "delete") {
    deletePresetRow(preset.id);
  } else if (action === "up" || action === "down") {
    shiftPreset(preset.id, action === "up" ? -1 : 1);
  }
}

function openPresetEditor(preset = null) {
  elements.presetModalTitle.textContent = preset ? "Edit Preset" : "Add Preset";
  elements.presetId.value = preset?.id ?? "";
  elements.presetBpm.value = String(preset?.bpm ?? 120);
  elements.presetMeter.value = preset?.meter ?? "4/4";
  elements.presetName.value = preset?.name ?? "";
  if (typeof elements.presetModal.showModal === "function") {
    elements.presetModal.showModal();
  } else {
    elements.presetModal.setAttribute("open", "");
  }
}

async function savePresetForm(event) {
  if (event.submitter?.value === "cancel") {
    return;
  }
  event.preventDefault();
  const id = elements.presetId.value;
  const payload = {
    bpm: Number(elements.presetBpm.value),
    meter: elements.presetMeter.value,
    name: elements.presetName.value.trim() || null,
  };
  const response = await fetch(id ? `/api/presets/${id}` : "/api/presets", {
    method: id ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.ok) {
    elements.presetModal.close();
    await loadPresets();
  }
}

async function deletePresetRow(id) {
  const response = await fetch(`/api/presets/${id}`, { method: "DELETE" });
  if (response.ok) {
    await loadPresets();
  }
}

function shiftPreset(id, offset) {
  const ids = presets.map((preset) => preset.id);
  const index = ids.indexOf(id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
    return;
  }
  ids.splice(index, 1);
  ids.splice(nextIndex, 0, id);
  reorderPresetIds(ids);
}

function movePreset(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) {
    return;
  }
  const ids = presets.map((preset) => preset.id).filter((id) => id !== sourceId);
  ids.splice(ids.indexOf(targetId), 0, sourceId);
  reorderPresetIds(ids);
}

async function reorderPresetIds(ids) {
  const response = await fetch("/api/presets/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (response.ok) {
    presets = await response.json();
    renderPresets();
    renderSettingsPresetList();
    markSynced();
  }
}

function handleVolumeInput() {
  const volume = Number(elements.volumeSlider.value);
  settings = { ...settings, volume };
  elements.volumeValue.textContent = `${volume}%`;
  scheduler.setVolume(volume);
  if (settings.preview_sound_on_change !== false) {
    previewSound(settings.sound_id);
  }
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => saveSettings({ volume }), 180);
}

async function previewSound(soundId = settings.sound_id, { force = false } = {}) {
  if (!force && settings.preview_sound_on_change === false) {
    return;
  }
  try {
    await scheduler.playPreview({ soundId, volume: Number(elements.volumeSlider.value) });
  } catch {
    showMessage("Audio is blocked. Tap anywhere to enable preview.", true);
  }
}

async function saveSettings(patch) {
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error(`Settings update failed: ${response.status}`);
    }
    applySettings(await response.json());
    markSynced();
  } catch {
    showMessage("Settings could not be saved. Check your connection.", true);
  }
}

function markSynced() {
  if (!elements.lastSynced) {
    return;
  }
  elements.lastSynced.textContent = `Last synced: ${new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
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
  if (event.target.closest("input, select, textarea")) {
    return;
  }
  const isDesktop = window.matchMedia("(min-width: 1440px)").matches;
  if (event.code === "Space") {
    if (!isDesktop) return;
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "ArrowUp") {
    if (!isDesktop) return;
    event.preventDefault();
    updateBpmImmediate(state.bpm + (event.shiftKey ? 5 : 1));
  } else if (event.key === "ArrowDown") {
    if (!isDesktop) return;
    event.preventDefault();
    updateBpmImmediate(state.bpm - (event.shiftKey ? 5 : 1));
  } else if (event.key.toLowerCase() === "t") {
    if (!isDesktop) return;
    tapTempo();
  } else if (event.key.toLowerCase() === "p") {
    // Performance toggle works on any viewport — it's the live-band hotkey.
    event.preventDefault();
    togglePerformanceMode();
  } else if (["1", "2", "3"].includes(event.key)) {
    if (!isDesktop) return;
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
    if (settings.background_audio !== false) {
      // Keep audio alive while the tab is hidden / browser minimized.
      return;
    }
    await scheduler.suspend();
    return;
  }
  if (state?.playing) {
    syncSchedulerToState({
      state,
      scheduler,
      visibilityState: document.visibilityState,
      onAutoplayBlocked: () => autoplayGate.request(),
      backgroundAudio: settings.background_audio !== false,
    });
  }
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return replacements[character];
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  // When the SW takes control after an update, force a one-shot reload so the
  // page picks up the new HTML/JS/CSS immediately. This is what kills the
  // "ghost fullscreen button still showing v3 cached HTML" class of bug.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // A fresh worker is waiting and an old one still controls the page.
            // Tell it to skipWaiting → it'll fire controllerchange → reload.
            installing.postMessage({ type: "skipWaiting" });
          }
        });
      });
    })
    .catch(() => {
      showMessage("Offline cache is unavailable in this browser.", true);
    });
}
