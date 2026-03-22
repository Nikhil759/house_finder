// Minimal service worker — enables PWA install prompt on Android Chrome.
// Only intercept same-origin navigation requests; let API calls pass through
// natively to avoid doubling errors on network failures.
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
  }
});
