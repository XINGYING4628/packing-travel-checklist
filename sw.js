const BUILD_VERSION = "202610301640";
const CACHE_NAME = "shoushi-go-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${BUILD_VERSION}`,
  `./app.js?v=${BUILD_VERSION}`,
  `./manifest.webmanifest?v=${BUILD_VERSION}`,
  `./icon.svg?v=${BUILD_VERSION}`,
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const networkFirst = event.request.mode === "navigate" || ["document", "script", "style"].includes(event.request.destination);
  event.respondWith(
    (networkFirst ? fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type !== "opaque") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))) : caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => Response.error());
    }))
  );
});
