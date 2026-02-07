// firebase-messaging-sw.js
// Minimal placeholder service worker.
// Push is currently disabled; this SW does nothing harmful and can be extended later.

self.addEventListener("install", () => {
  // Apply updates immediately when deployed.
  self.skipWaiting?.();
});

self.addEventListener("activate", (event) => {
  // Take control of pages immediately.
  event.waitUntil(self.clients.claim());
});

// If/when you re-enable Firebase Messaging later, you can import scripts here:
// importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
// importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
// Then initialize with PUBLIC web config provided at runtime (not hardcoded here),
// and register an onBackgroundMessage handler.
