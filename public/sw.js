const CACHE_NAME = "church-metronome-v3";
const ASSETS = [
  "/",
  "/app.js",
  "/tempo-controls.js",
  "/qr-share.js",
  "/settings",
  "/settings.html",
  "/settings.js",
  "/audio.js",
  "/client-utils.js",
  "/vendor/qrcode.min.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
