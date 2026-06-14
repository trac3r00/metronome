export function bindFullscreenToggle(button, target = document.documentElement) {
  const update = () => {
    const active = Boolean(document.fullscreenElement);
    button.textContent = active ? "✕" : "⛶";
    button.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
    button.title = active ? "Exit fullscreen" : "Enter fullscreen";
    button.classList.toggle("is-active", active);
  };

  const toggle = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
    } else {
      await target.requestFullscreen?.();
    }
    update();
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    toggle().catch(() => {});
  });
  document.addEventListener("fullscreenchange", update);
  update();
  return { toggle, update };
}
