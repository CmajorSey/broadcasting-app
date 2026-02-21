// server/utils/webpushSender.js
import webpush from "web-push";

/* ===========================
   🍏 Safari/Web Push sender
   - Uses standard Push API subscriptions (NOT Firebase)
   - Requires VAPID keys
   =========================== */

const safeStr = (v) => (v === null || v === undefined ? "" : String(v));

export function initWebPush() {
  const publicKey = safeStr(process.env.WEBPUSH_PUBLIC_KEY).trim();
  const privateKey = safeStr(process.env.WEBPUSH_PRIVATE_KEY).trim();

  if (!publicKey || !privateKey) {
    throw new Error("Missing WEBPUSH_PUBLIC_KEY or WEBPUSH_PRIVATE_KEY");
  }

  webpush.setVapidDetails(
    safeStr(process.env.WEBPUSH_SUBJECT).trim() || "mailto:admin@loboard.app",
    publicKey,
    privateKey
  );

  return { publicKey };
}

/**
 * users[] supports:
 *   user.webPushSubscriptions: array of PushSubscription objects
 *   user.webPushSubscription: single PushSubscription object (legacy)
 */
export async function sendWebPushToUsers(users, title, message, opts = {}) {
  const payload = JSON.stringify({
    title: safeStr(title),
    body: safeStr(message),
    url: safeStr(opts.url || "/tickets"),
    category: safeStr(opts.category || "admin"),
    urgent: opts.urgent === true,
    kind: safeStr(opts.kind || ""),
    timestamp: safeStr(opts.timestamp || new Date().toISOString()),
  });

  const subs = [];

  (Array.isArray(users) ? users : []).forEach((u) => {
    const many = Array.isArray(u?.webPushSubscriptions) ? u.webPushSubscriptions : [];
    for (const s of many) if (s && typeof s === "object") subs.push(s);

    const single = u?.webPushSubscription;
    if (single && typeof single === "object") subs.push(single);
  });

  if (subs.length === 0) {
    console.log("ℹ️ No Web Push subscriptions found for recipients.");
    return;
  }

  const results = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ ok: true });
    } catch (err) {
      // Non-fatal: subscriptions expire; you’ll want to prune later
      results.push({ ok: false, error: err?.message || String(err) });
      console.warn("❌ WebPush send error:", err?.message || err);
    }
  }

  console.log("✅ WebPush send summary:", {
    subCount: subs.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
}