// Minimal service worker — enables PWA install prompt on Android Chrome.
// Passthrough fetch: no caching, so the app always fetches fresh data.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
