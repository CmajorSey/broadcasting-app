/* public/webpush-sw.js */

/* ===========================
   🍏 Safari/iOS Web Push Service Worker
   - Standard Push API (NOT Firebase Messaging)
   - This is what enables background notifications on Safari installed web apps
   =========================== */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Lo Board";
  const body = data.body || "You have a new notification";
  const url = data.url || "/tickets";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
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

      if (clients.openWindow) return clients.openWindow(url);
    })()
  );
});