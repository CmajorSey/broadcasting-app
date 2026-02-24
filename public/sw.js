/* ===========================
   🧩 Main PWA Service Worker (single controller)
   - This SW controls the whole app scope "/"
   - It imports Firebase Messaging SW logic so push works again
   - We intentionally remove the no-op fetch handler warning
   =========================== */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ===========================
   🔔 Firebase Messaging logic (imported)
   - Keeps your existing /firebase-messaging-sw.js code intact
   - Avoids SW scope fights by NOT registering firebase-messaging-sw.js directly
   =========================== */
try {
  importScripts("/firebase-messaging-sw.js");
} catch (e) {
  // If the file is missing for some reason, don't crash the SW.
  // Push won't work until restored, but the app stays online.
  console.error("Failed to import /firebase-messaging-sw.js:", e);
}

/* ===========================
   🖱️ Notification click handling
   - Handled by /firebase-messaging-sw.js (imported above)
   - Keeping it in ONE place avoids double-click handling
   =========================== */