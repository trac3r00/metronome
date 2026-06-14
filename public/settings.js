const controls = [
  { id: "dial", label: "Dial", preview: "circle" },
  { id: "slider", label: "Slider", preview: "line" },
  { id: "wheel", label: "Wheel", preview: "stack" },
  { id: "tap", label: "Tap Tempo", preview: "tap" },
];

const elements = {
  connection: document.querySelector("#settings-connection"),
  statusText: document.querySelector("[data-status-text]"),
  presetList: document.querySelector("#preset-list"),
  addPreset: document.querySelector("#add-preset"),
  controlStyles: document.querySelector("#control-styles"),
  theme: document.querySelector("#theme-select"),
  fullscreenOnly: document.querySelector("#fullscreen-only"),
  lastSynced: document.querySelector("#last-synced"),
  forceResync: document.querySelector("#force-resync"),
  modal: document.querySelector("#preset-modal"),
  form: document.querySelector("#preset-form"),
  modalTitle: document.querySelector("#modal-title"),
  presetId: document.querySelector("#preset-id"),
  presetBpm: document.querySelector("#preset-bpm"),
  presetMeter: document.querySelector("#preset-meter"),
  presetName: document.querySelector("#preset-name"),
};

let settings = {
  control_style: "dial",
  theme: "auto",
  fullscreen_only: false,
  updated_at: null,
  presets: [],
};
let socket = null;

bindEvents();
renderControlStyles();
loadSettings();
connect();

function bindEvents() {
  elements.addPreset.addEventListener("click", () => openPresetModal());
  elements.form.addEventListener("submit", savePreset);
  elements.theme.addEventListener("change", () => saveSettings({ theme: elements.theme.value }));
  elements.fullscreenOnly.addEventListener("change", () =>
    saveSettings({ fullscreen_only: elements.fullscreenOnly.checked }),
  );
  elements.forceResync.addEventListener("click", loadSettings);
  window.addEventListener("online", connect);
  window.addEventListener("offline", () => setConnection("offline", "Offline"));
}

function connect() {
  if (!navigator.onLine) {
    setConnection("offline", "Offline");
    return;
  }
  socket?.close();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  setConnection("connecting", "Connecting");
  socket.addEventListener("open", () => setConnection("live", "Live"));
  socket.addEventListener("close", () => {
    if (navigator.onLine) {
      setConnection("reconnecting", "Reconnecting");
      setTimeout(connect, 1500);
    }
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "settings:update" && message.settings) {
      applySettings(message.settings);
    }
    if (message.type === "presets:update") {
      settings = { ...settings, presets: message.presets ?? [] };
      renderPresets();
      markSynced();
    }
  });
}

async function loadSettings() {
  const response = await fetch("/api/settings", { headers: { accept: "application/json" } });
  if (!response.ok) {
    setConnection("offline", "Sync error");
    return;
  }
  applySettings(await response.json());
  markSynced();
}

function applySettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  document.documentElement.dataset.theme = settings.theme;
  elements.theme.value = settings.theme;
  elements.fullscreenOnly.checked = Boolean(settings.fullscreen_only);
  renderControlStyles();
  renderPresets();
  markSynced();
}

async function saveSettings(patch) {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (response.ok) {
    applySettings(await response.json());
  }
}

function renderControlStyles() {
  elements.controlStyles.replaceChildren();
  for (const control of controls) {
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

function renderPresets() {
  elements.presetList.replaceChildren();
  for (const preset of settings.presets) {
    const row = document.createElement("article");
    row.className = "preset-row";
    row.draggable = true;
    row.dataset.id = preset.id;
    row.innerHTML = `
      <div>
        <strong>${preset.bpm} BPM</strong>
        <span>${preset.meter}${preset.name ? ` - ${escapeText(preset.name)}` : ""}</span>
      </div>
      <div class="preset-row-actions">
        <button type="button" data-action="up" aria-label="Move preset up">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>
        </button>
        <button type="button" data-action="down" aria-label="Move preset down">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
        </button>
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
    row.addEventListener("click", (event) => handlePresetAction(event, preset));
    elements.presetList.append(row);
  }
}

function handlePresetAction(event, preset) {
  const action = event.target.closest("button")?.dataset.action;
  if (!action) {
    return;
  }
  if (action === "edit") {
    openPresetModal(preset);
  }
  if (action === "delete") {
    deletePreset(preset.id);
  }
  if (action === "up" || action === "down") {
    const offset = action === "up" ? -1 : 1;
    shiftPreset(preset.id, offset);
  }
}

function openPresetModal(preset = null) {
  elements.modalTitle.textContent = preset ? "Edit Preset" : "Add Preset";
  elements.presetId.value = preset?.id ?? "";
  elements.presetBpm.value = String(preset?.bpm ?? 120);
  elements.presetMeter.value = preset?.meter ?? "4/4";
  elements.presetName.value = preset?.name ?? "";
  elements.modal.showModal();
}

async function savePreset(event) {
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
    elements.modal.close();
    await loadSettings();
  }
}

async function deletePreset(id) {
  const response = await fetch(`/api/presets/${id}`, { method: "DELETE" });
  if (response.ok) {
    await loadSettings();
  }
}

function shiftPreset(id, offset) {
  const ids = settings.presets.map((preset) => preset.id);
  const index = ids.indexOf(id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
    return;
  }
  ids.splice(index, 1);
  ids.splice(nextIndex, 0, id);
  reorder(ids);
}

function movePreset(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) {
    return;
  }
  const ids = settings.presets.map((preset) => preset.id).filter((id) => id !== sourceId);
  ids.splice(ids.indexOf(targetId), 0, sourceId);
  reorder(ids);
}

async function reorder(ids) {
  const response = await fetch("/api/presets/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (response.ok) {
    settings = { ...settings, presets: await response.json() };
    renderPresets();
    markSynced();
  }
}

function markSynced() {
  elements.lastSynced.textContent = `Last synced: ${new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

function setConnection(mode, text) {
  elements.connection.dataset.status = mode;
  elements.statusText.textContent = text;
}

function escapeText(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return replacements[character];
  });
}
