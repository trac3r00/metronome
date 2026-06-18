// Dedicated worker that ticks at a stable cadence even when the host page is
// throttled (background tab, minimized browser). Posts {type:"tick"} every
// `interval` ms after a `start` message; stops on `stop`.
let timer = null;
let interval = 25;

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "start") {
    if (typeof message.interval === "number" && message.interval >= 5) {
      interval = message.interval;
    }
    if (timer === null) {
      timer = setInterval(() => self.postMessage({ type: "tick" }), interval);
    }
  } else if (message.type === "stop") {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  } else if (message.type === "interval" && typeof message.interval === "number") {
    interval = Math.max(5, message.interval);
    if (timer !== null) {
      clearInterval(timer);
      timer = setInterval(() => self.postMessage({ type: "tick" }), interval);
    }
  }
});
