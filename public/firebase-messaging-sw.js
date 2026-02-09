/* public/firebase-messaging-sw.js */

/* ===========================
   🔔 FCM Service Worker starts here
   - IMPORTANT: Service Worker must use worker-safe Firebase scripts
   - firebase-*-compat can reference `window` (not defined in SW) → crash
   - So we load firebase-app.js + firebase-messaging-sw.js instead
   - Fallback to CDN if local files are missing
   =========================== */

(function loadFirebaseWorkerScripts() {
  // ✅ Local (recommended): served from your own origin
  const localApp = "/firebase/firebase-app.js";
  const localMsg = "/firebase/firebase-messaging-sw.js";

  // ✅ CDN fallback
  const cdnApp = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
  const cdnMsg =
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-sw.js";

  try {
    importScripts(localApp, localMsg);
    console.log("✅ FCM SW: loaded Firebase worker scripts from local /firebase");
    return;
  } catch (e1) {
    console.warn("⚠️ FCM SW: local worker scripts not loaded:", e1);
  }

  try {
    importScripts(cdnApp, cdnMsg);
    console.log("✅ FCM SW: loaded Firebase worker scripts from gstatic CDN");
    return;
  } catch (e2) {
    console.error("❌ FCM SW: failed to load Firebase worker scripts (local + CDN).", e2);
  }
})();

// Guard: if scripts failed, avoid crashing the whole SW file
if (typeof firebase === "undefined") {
  console.error("❌ FCM SW: firebase is undefined (scripts failed).");
} else {
  firebase.initializeApp({
    apiKey: "BVarkqRVz8akVWEVbpYZULI41iXvddJcR2O8bZGDaSc",
    authDomain: "loboard-notifications.firebaseapp.com",
    projectId: "loboard-notifications",
    storageBucket: "loboard-notifications.firebasestorage.app",
    messagingSenderId: "302425553477",
    appId: "1:302425553477:web:32e35c1c2e22c96793012c",
  });

  const messaging = firebase.messaging();

  // ✅ Background messages (tab closed) — works for notification + data payloads
  messaging.onBackgroundMessage((payload) => {
    try {
      const n = payload?.notification || {};
      const d = payload?.data || {};

      const title = n.title || d.title || "Lo Board";
      const body = n.body || d.body || d.message || "";
      const icon = d.icon || n.icon || "/logo.png";
      const url = d.url || n.click_action || "/";

      self.registration.showNotification(title, {
        body,
        icon,
        data: { ...d, url },
      });
    } catch {
      // ignore
    }
  });

  // ✅ Click opens the app (or the relevant ticket/admin page)
  self.addEventListener("notificationclick", (event) => {
    try {
      event.notification.close();
      const url = event?.notification?.data?.url || "/";

      event.waitUntil(
        (async () => {
          const allClients = await clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });

          for (const client of allClients) {
            try {
              if ("focus" in client) await client.focus();
              if (
                client.url &&
                new URL(client.url).origin === self.location.origin
              ) {
                break;
              }
            } catch {
              // ignore
            }
          }

          return clients.openWindow(url);
        })()
      );
    } catch {
      // ignore
    }
  });
}

/* ===========================
   🔔 FCM Service Worker ends here
   =========================== */
