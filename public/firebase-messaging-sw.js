/* public/firebase-messaging-sw.js */

/* ===========================
   🔔 Firebase Cloud Messaging Service Worker
   - Service Worker context (NO React, NO hooks, NO DOM, NO localStorage)
   - Only handles background push + notification click behavior
   =========================== */

/**
 * IMPORTANT:
 * - Use compat scripts inside service worker (simplest + stable on Netlify)
 * - Your React app is responsible for requesting permission + saving FCM token
 * - This SW handles background messages + notification click behavior
 */

// ✅ Firebase compat libs (SW-friendly)
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts(
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js"
);

// ✅ Your Firebase config (MUST match your frontend config)
firebase.initializeApp({
  apiKey: "AIzaSyDB2mejIIrbi8cDXGanMiSogE9VmG4MsG8",
  authDomain: "loboard-notifications.firebaseapp.com",
  projectId: "loboard-notifications",
  storageBucket: "loboard-notifications.firebasestorage.app",
  messagingSenderId: "302425553477",
  appId: "1:302425553477:web:32e35c1c2e22c96793012c",
});

// ✅ Messaging instance
const messaging = firebase.messaging();

/* ===========================
   📩 Background message handler (FCM-supported browsers)
   ✅ Always shows a notification (restores delivery)
   =========================== */
messaging.onBackgroundMessage(function (payload) {
  try {
    const hasAutoNotification =
      !!payload?.notification?.title || !!payload?.notification?.body;

    // If FCM has a notification payload, let FCM handle it (prevents duplicates)
    if (hasAutoNotification) {
      return;
    }

    // Data-only fallback (manual display)
    const title =
      payload?.data?.title ||
      payload?.data?.notificationTitle ||
      "Lo Board";

    const body =
      payload?.data?.body ||
      payload?.data?.message ||
      payload?.data?.notificationBody ||
      "";

    const url = payload?.data?.url || payload?.fcmOptions?.link || "/tickets";

    // Best-effort dedupe tag
    const tag =
      payload?.data?.dedupeKey ||
      payload?.data?.notificationId ||
      payload?.messageId ||
      `${title}:${body}:${url}`;

    const options = {
      body,
      icon: "/icon-192.png",
      data: { url },
      tag,
      renotify: false,
    };

    self.registration.showNotification(title, options);
  } catch (err) {
    // Never crash SW
    console.warn("FCM onBackgroundMessage failed (non-fatal):", err);
  }
});

/* ===========================
   🖱️ Notification click handler
   =========================== */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const url = event?.notification?.data?.url || "/tickets";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if ("focus" in client) {
          try {
            await client.focus();
          } catch {}

          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {}
          }
          return;
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })()
  );
});