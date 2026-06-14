export function renderPresetShell(grid, onAction) {
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
    grid.append(card);
  }
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    if (button.dataset.load) {
      onAction({ type: "load_preset", slot: Number(button.dataset.load) });
    }
    if (button.dataset.save) {
      onAction({ type: "overwrite_preset", slot: Number(button.dataset.save) });
    }
  });
}

export function renderPresets(grid, state) {
  state.presets.forEach((preset, index) => {
    const slot = index + 1;
    const label = grid.querySelector(`[data-preset-value="${slot}"]`);
    const load = grid.querySelector(`[data-load="${slot}"]`);
    label.textContent = preset ? `${preset.bpm} BPM · ${preset.beats_per_bar}/${preset.beat_unit}` : "Empty";
    load.disabled = !preset;
    load.dataset.empty = preset ? "false" : "true";
  });
}
