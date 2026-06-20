// Service worker v6: network-first for HTML / manifest / sw.js so a fresh
// deploy never leaves ghost UI behind. Hashable JS/CSS uses cache-first with
// background revalidation. Stale caches from older versions are deleted on
// activate.

const CACHE_NAME = "church-metronome-v7";
const SHELL_ASSETS = ["/"];
const RUNTIME_ASSETS = [
  "/app.js",
  "/audio.js",
  "/client-utils.js",
  "/qr-share.js",
  "/scheduler-worker.js",
  "/tempo-controls.js",
  "/vendor/qrcode.min.js",
  "/styles.css",
  "/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...SHELL_ASSETS, ...RUNTIME_ASSETS])),
  );
  self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const path = url.pathname;
  const isShell =
    path === "/" ||
    path.endsWith(".html") ||
    path.endsWith(".webmanifest") ||
    path.endsWith("/sw.js");

  if (isShell) {
    // Network-first: try the live server, fall back to cache so the app still
    // boots offline. This is what fixes the ghost-UI problem when an old
    // service worker was caching a previous HTML shell.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Cache-first with background revalidation for everything else.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? networkFetch;
    }),
  );
});
