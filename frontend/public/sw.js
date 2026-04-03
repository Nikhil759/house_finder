// Minimal service worker — enables PWA install prompt on Android Chrome. v2
// Skip entirely in local dev to avoid interfering with Vite HMR.
if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
} else {
  // Only intercept same-origin navigation requests; let API calls pass through
  // natively to avoid doubling errors on network failures.
  // Do NOT call event.respondWith on failure — let the browser handle it so
  // users don't get permanently stuck on chrome-error://chromewebdata/.
  self.addEventListener("fetch", (event) => {
    if (event.request.mode === "navigate") {
      event.respondWith(
        fetch(event.request).catch(() => {
          // Return nothing; browser falls back to its own error handling.
        })
      );
    }
  });
}
