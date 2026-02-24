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
 * - This SW is ONLY for background messages and notification clicks
 *
 * NOTE (Safari/iOS):
 * - This file ONLY helps browsers that support Firebase Messaging on web (Chrome/Edge/Firefox).
 * - iOS Safari installed web apps do NOT receive background push via Firebase Messaging.
 * - For iOS Safari background push, you need a separate standard Web Push SW (e.g. /webpush-sw.js).
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
   =========================== */
/**
 * ✅ Duplicate-fix rule:
 * If the server sends an FCM "notification" payload, many browsers will display it automatically.
 * If we ALSO call showNotification(), you can get 2 notifications.
 *
 * So:
 * - If payload.notification exists → DO NOT manually showNotification().
 * - If it's data-only → we DO showNotification().
 */
messaging.onBackgroundMessage(function (payload) {
  try {
    const hasNotificationPayload =
      !!payload?.notification?.title || !!payload?.notification?.body;

    // If notification payload exists, the browser may auto-display it.
    // Avoid double notifications by NOT calling showNotification here.
    if (hasNotificationPayload) {
      return;
    }

    // Data-only message fallback
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

    const options = {
      body,
      icon: "/icon-192.png",
      data: { url },
    };

    self.registration.showNotification(title, options);
  } catch (err) {
    // Never crash SW
    console.warn("FCM onBackgroundMessage failed (non-fatal):", err);
  }
});

/* ===========================
   🖱️ Notification click handler
   - Opens the app (or focuses it) and navigates to url if provided
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

      // If a tab is already open, focus it
      for (const client of allClients) {
        if ("focus" in client) {
          try {
            await client.focus();
          } catch {}

          // Optional: navigate open tab
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {}
          }
          return;
        }
      }

      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })()
  );
});