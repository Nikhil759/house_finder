// Minimal service worker — enables PWA install prompt on Android Chrome.
// Skip entirely in local dev to avoid interfering with Vite HMR.
if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
} else {
  // Only intercept same-origin navigation requests; let API calls pass through
  // natively to avoid doubling errors on network failures.
  self.addEventListener("fetch", (event) => {
    if (event.request.mode === "navigate") {
      event.respondWith(
        fetch(event.request).catch(() => Response.error())
      );
    }
  });
}
