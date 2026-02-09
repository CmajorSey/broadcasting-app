/* public/firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js"
);

/* ===========================
   🔔 FCM Service Worker starts here
   - SW cannot access import.meta.env (Vite)
   - So the Firebase config MUST be hard-coded here.
   - Paste your real Firebase web config values.
   =========================== */

firebase.initializeApp({
  apiKey: "PASTE_REAL_API_KEY",
  authDomain: "PASTE_REAL_AUTH_DOMAIN",
  projectId: "PASTE_REAL_PROJECT_ID",
  storageBucket: "PASTE_REAL_STORAGE_BUCKET",
  messagingSenderId: "PASTE_REAL_MESSAGING_SENDER_ID",
  appId: "PASTE_REAL_APP_ID",
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
