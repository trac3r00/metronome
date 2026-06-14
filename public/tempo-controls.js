export function renderTempoControl(root, { style, bpm, onInput, onCommit, onTap }) {
  if (root.dataset.style === style && root.childElementCount > 0) {
    syncTempoControl(root, bpm);
    return;
  }
  root.dataset.style = style;
  root.replaceChildren();
  if (style === "dial") {
    root.append(createDial(bpm, onInput, onCommit));
  } else if (style === "wheel") {
    root.append(createWheel(onInput, onCommit));
  } else if (style === "tap") {
    root.append(createTap(onTap));
  } else {
    root.append(createSlider(bpm, onInput, onCommit));
  }
  syncTempoControl(root, bpm);
}

export function syncTempoControl(root, bpm) {
  const dial = root.querySelector(".dial-control");
  if (dial) {
    const ratio = (bpm - 30) / 270;
    dial.style.setProperty("--dial-angle", `${ratio * 360}deg`);
    dial.style.setProperty("--dial-progress", String(415 - 415 * ratio));
    dial.setAttribute("aria-valuenow", String(bpm));
  }
  const slider = root.querySelector("input[type='range']");
  if (slider) {
    slider.value = String(bpm);
  }
  const wheelValue = root.querySelector("[data-wheel-value]");
  if (wheelValue) {
    wheelValue.textContent = `${bpm} BPM`;
  }
}

function createDial(bpm, onInput, onCommit) {
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
    onInput(30 + Math.round((normalized / 360) * 270));
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
    onCommit();
  });
  wrapper.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
    onCommit(bpm + direction * (event.shiftKey ? 5 : 1));
  });
  return wrapper;
}

function createSlider(bpm, onInput, onCommit) {
  const label = document.createElement("label");
  label.className = "slider-control";
  label.innerHTML = `
    <span>Tempo</span>
    <input type="range" min="30" max="300" value="${bpm}" aria-label="BPM slider">
  `;
  const input = label.querySelector("input");
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("change", () => onCommit(input.value));
  return label;
}

function createWheel(onInput, onCommit) {
  const control = document.createElement("div");
  control.className = "wheel-control";
  control.tabIndex = 0;
  control.setAttribute("role", "spinbutton");
  control.setAttribute("aria-label", "Wheel tempo control");
  control.innerHTML = "<span>Swipe or scroll</span><strong data-wheel-value></strong>";
  let touchStart = null;
  control.addEventListener("wheel", (event) => {
    event.preventDefault();
    onInput(event.deltaY < 0 ? "+1" : "-1");
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
      onInput(delta > 0 ? "+1" : "-1");
      touchStart = next;
    }
  }, { passive: true });
  control.addEventListener("pointerup", () => onCommit());
  return control;
}

function createTap(onTap) {
  const button = document.createElement("button");
  button.className = "tap-control";
  button.type = "button";
  button.textContent = "TAP";
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    onTap();
  });
  return button;
}
