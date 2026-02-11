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
 */

// ✅ Firebase compat libs (SW-friendly)
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// ✅ Your Firebase config (MUST match your frontend config)
firebase.initializeApp({
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
});

// ✅ Messaging instance
const messaging = firebase.messaging();

/* ===========================
   📩 Background message handler
   =========================== */
messaging.onBackgroundMessage(function (payload) {
  // payload.notification is typical when sent via FCM notification fields
  const title = payload?.notification?.title || "Lo Board";
  const body = payload?.notification?.body || "";

  // Optional: attach a route so click can open correct page
  const url =
    payload?.data?.url ||
    payload?.fcmOptions?.link ||
    "/tickets";

  const options = {
    body,
    icon: "/icon-192.png",
    data: { url },
  };

  self.registration.showNotification(title, options);
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
          client.focus();
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
