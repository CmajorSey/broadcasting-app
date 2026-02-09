/* public/firebase-messaging-sw.js */

/* ===========================
   🔔 FCM Service Worker starts here
   - Use local self-hosted Firebase scripts first (most reliable)
   - Fallback to CDN if local files are missing (temporary safety net)
   - SW cannot access import.meta.env (Vite) so config is hard-coded below
   =========================== */

(function loadFirebaseCompat() {
  // ✅ Most reliable: serve from your own origin (Netlify)
  const localApp = "/firebase/firebase-app-compat.js";
  const localMsg = "/firebase/firebase-messaging-compat.js";

  // ✅ Fallback: CDN (can be blocked in workers by privacy tools)
  const cdnApp =
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js";
  const cdnMsg =
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js";

  try {
    importScripts(localApp, localMsg);
    console.log("✅ FCM SW: loaded Firebase compat from local /firebase");
    return;
  } catch (e1) {
    console.warn("⚠️ FCM SW: local Firebase scripts not loaded:", e1);
  }

  try {
    importScripts(cdnApp, cdnMsg);
    console.log("✅ FCM SW: loaded Firebase compat from gstatic CDN");
    return;
  } catch (e2) {
    console.error("❌ FCM SW: failed to load Firebase scripts (local + CDN).", e2);
  }
})();

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

    // Prefer icon from payload, else fallback
    const icon = d.icon || n.icon || "/logo.png";

    // Click target priority:
    // - data.url (your backend can send this)
    // - notification.click_action (legacy)
    // - "/"
    const url = d.url || n.click_action || "/";

    self.registration.showNotification(title, {
      body,
      icon,
      data: { ...d, url }, // ensure url exists for click handler
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
        // If a window/tab is already open, focus it and navigate if possible
        const allClients = await clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        for (const client of allClients) {
          try {
            if ("focus" in client) {
              await client.focus();
            }
            // Best effort: open target in same origin
            if (client.url && new URL(client.url).origin === self.location.origin) {
              // Some browsers don't allow SPA navigation from SW; fallback to openWindow
              // Still, focusing is useful.
              break;
            }
          } catch {
            // ignore
          }
        }

        // Always ensure navigation to the URL occurs
        return clients.openWindow(url);
      })()
    );
  } catch {
    // ignore
  }
});

/* ===========================
   🔔 FCM Service Worker ends here
   =========================== */
