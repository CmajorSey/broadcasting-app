/* public/firebase-messaging-sw.js */

  /* ===========================
     🔔 FCM token sync starts here
     - (DISABLED for now) You said you're focusing on classic toasts first.
     - This avoids 404s if backend users routes aren't mounted on Render yet.
     - Re-enable later when you're ready to test FCM end-to-end.
     =========================== */

  // ✅ Feature flag: keep FCM OFF until backend/users routes + SW are fully confirmed
  const ENABLE_FCM = false;

  useEffect(() => {
    if (!ENABLE_FCM) return;

    if (!loggedInUser?.id || !String(loggedInUser?.id).trim()) return;

    try {
      const maybePromise = requestPermission(loggedInUser);

      Promise.resolve(maybePromise)
        .then(async (token) => {
          const userId = String(loggedInUser?.id || "").trim();
          const fcmToken = String(token || "").trim();
          if (!userId || !fcmToken) return;

          const CACHE_KEY = `loBoard.fcmToken.${userId}`;
          const last = String(localStorage.getItem(CACHE_KEY) || "").trim();

          // ✅ If the token didn’t change, don’t hit backend again
          if (last === fcmToken) return;

          try {
            const res = await fetch(`${API_BASE}/users/${userId}/fcmToken`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fcmToken }),
            });

            if (res.ok) {
              localStorage.setItem(CACHE_KEY, fcmToken);
              localStorage.setItem(
                `loBoard.fcmTokenSavedAt.${userId}`,
                new Date().toISOString()
              );
            } else {
              // Keep silent; token saving shouldn't break the app
              console.warn("FCM token save failed:", res.status);
            }
          } catch {
            // ignore network issues
          }
        })
        .catch(() => {
          // ignore token/permission errors
        });
    } catch {
      // ignore
    }
  }, [ENABLE_FCM, loggedInUser?.id, loggedInUser?.name]);

  /* ===========================
     🔔 FCM token sync ends here
     =========================== */
