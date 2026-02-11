/* public/firebase-messaging-sw.js */

/* ===========================
   🔔 FCM Service Worker starts here
   =========================== */

/* ===========================
   📦 Firebase worker scripts (TOP-LEVEL ONLY)
   =========================== */
try {
  // ✅ Worker-safe compat builds
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"
  );
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js"
  );
  // eslint-disable-next-line no-undef
  console.log("✅ FCM SW: loaded Firebase compat worker scripts from gstatic CDN");
} catch (e) {
  // eslint-disable-next-line no-undef
  console.error("❌ FCM SW: failed to load Firebase worker scripts.", e);
}

// Guard: if scripts failed, avoid crashing the whole SW file
// eslint-disable-next-line no-undef
if (typeof firebase === "undefined") {
  // eslint-disable-next-line no-undef
  console.error("❌ FCM SW: firebase is undefined (scripts failed).");
} else {
  /* ===========================
     🔐 Firebase Web App config (PUBLIC)
     =========================== */
  // eslint-disable-next-line no-undef
  firebase.initializeApp({
    apiKey: "AIzaSyDB2mejIIrbi8cDXGanMiSogE9VmG4MsG8",
    authDomain: "loboard-notifications.firebaseapp.com",
    projectId: "loboard-notifications",
    storageBucket: "loboard-notifications.firebasestorage.app",
    messagingSenderId: "302425553477",
    appId: "1:302425553477:web:32e35c1c2e22c96793012c",
  });

  // eslint-disable-next-line no-undef
  const messaging = firebase.messaging();

  /* ===========================
     📩 Background messages (tab closed)
     - Works for notification + data payloads
     =========================== */
  messaging.onBackgroundMessage((payload) => {
    try {
      const n = payload?.notification || {};
      const d = payload?.data || {};

      const title = n.title || d.title || "Lo Board";
      const body = n.body || d.body || d.message || "";
      const icon = d.icon || n.icon || "/logo.png";

      // Prefer explicit click link (FCM v1 webpush.fcmOptions.link) if you send it
      const rawUrl = d.url || d.link || n.click_action || "/";
      const url = new URL(rawUrl, self.location.origin).toString();

      self.registration.showNotification(title, {
        body,
        icon,
        data: { ...d, url },
      });
    } catch {
      // ignore
    }
  });

  /* ===========================
     🖱️ Notification click behavior
     - Focus an existing Lo Board tab if present
     - Navigate it to the target URL when possible
     - Otherwise open a new window
     =========================== */
  self.addEventListener("notificationclick", (event) => {
    event.notification?.close();

    const rawUrl = event?.notification?.data?.url || "/";
    const url = new URL(rawUrl, self.location.origin).toString();

    event.waitUntil(
      (async () => {
        const allClients = await clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        // Try to reuse an existing same-origin tab first
        for (const client of allClients) {
          try {
            const clientUrl = client?.url ? new URL(client.url) : null;

            if (clientUrl && clientUrl.origin === self.location.origin) {
              if ("focus" in client) await client.focus();

              // Navigate in-place when supported (prevents duplicate tabs)
              if ("navigate" in client) {
                await client.navigate(url);
                return;
              }

              // If navigate isn't supported, we at least focused a Lo Board tab
              // so we can stop here to avoid opening duplicates.
              return;
            }
          } catch {
            // ignore
          }
        }

        // No existing tab → open a new one
        return clients.openWindow(url);
      })()
    );
  });
}

/* ===========================
   🔔 FCM Service Worker ends here
   =========================== */
