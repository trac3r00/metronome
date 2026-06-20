// Cache strategy:
// - HTML / manifest / sw.js  → NETWORK-FIRST + Cache-Control: no-store
//   (kills the ghost-fullscreen-button class of bug where v3-v5 cached HTML
//   stuck around forever)
// - Static assets (JS/CSS/icon/vendor) → stale-while-revalidate
// - Anything else → passthrough
//
// On `activate`, every old `church-metronome-*` cache is wiped and clients
// are auto-reloaded via `controllerchange` (sent from the page on detection).
const CACHE_NAME = "church-metronome-v6";
const STATIC_ASSETS = [
  "/app.js",
  "/audio.js",
  "/client-utils.js",
  "/preset-view.js",
  "/qr-share.js",
  "/scheduler-worker.js",
  "/tempo-controls.js",
  "/styles.css",
  "/icon.svg",
  "/vendor/qrcode.min.js",
];
const NETWORK_FIRST_PATHS = new Set(["/", "/index.html", "/manifest.webmanifest", "/sw.js"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("church-metronome-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (NETWORK_FIRST_PATHS.has(url.pathname) || request.mode === "navigate") {
    event.respondWith(networkFirstNoStore(request));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

async function networkFirstNoStore(request) {
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    // Don't cache — always network-first.
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline and no cached fallback");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}
