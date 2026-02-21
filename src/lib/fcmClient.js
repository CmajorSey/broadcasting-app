// src/lib/fcmClient.js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

/* ===========================
   🔔 FCM (Chrome/Android/Desktop) + Web Push (Safari PWA)
   - Keep existing FCM behavior intact
   - Add Safari-installed Web Push subscription helpers
   =========================== */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const fcmVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// ✅ This is the VAPID public key you generated via `npx web-push generate-vapid-keys`
const webPushPublicKey = import.meta.env.VITE_WEBPUSH_PUBLIC_KEY;

let app;
let messaging;

/* ===========================
   ✅ FCM API (unchanged exports)
   =========================== */

export async function initFcm() {
  const supported = await isSupported();
  if (!supported) return { supported: false };

  app = initializeApp(firebaseConfig);
  messaging = getMessaging(app);

  // Ensure SW exists for FCM
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  }

  return { supported: true };
}

export async function requestFcmToken() {
  if (!messaging) throw new Error("FCM not initialized");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;

  const token = await getToken(messaging, { vapidKey: fcmVapidKey });
  return token || null;
}

export function onForegroundMessage(handler) {
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}

/* ===========================
   🍏 Safari Web Push helpers
   - Safari background push requires:
     1) /webpush-sw.js registered
     2) pushManager.subscribe()
     3) subscription POSTed to backend
   =========================== */

function isProbablySafari() {
  try {
    const ua = navigator.userAgent || "";
    const isSafari =
      /Safari/i.test(ua) &&
      !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua);
    return isSafari;
  } catch {
    return false;
  }
}

function isStandalonePwa() {
  try {
    // iOS Safari: navigator.standalone
    // Others: display-mode
    return (
      window.navigator.standalone === true ||
      window.matchMedia?.("(display-mode: standalone)")?.matches === true
    );
  } catch {
    return false;
  }
}

// ✅ Use this to decide whether to run Web Push subscribe flow
export function shouldUseSafariWebPush() {
  // In practice, you only want web push for Safari PWA installs.
  // (Safari in-browser can prompt, but background delivery is unreliable unless installed.)
  return isProbablySafari() && isStandalonePwa();
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Registers /webpush-sw.js and subscribes the user.
 * Then POSTs subscription to: POST {apiBase}/webpush/subscribe
 *
 * @param {{ apiBase: string, userId: string, userName?: string }} opts
 * @returns {Promise<PushSubscription|null>}
 */
export async function subscribeSafariWebPush(opts) {
  const apiBase = String(opts?.apiBase || "").trim();
  const userId = String(opts?.userId || "").trim();
  const userName = typeof opts?.userName === "string" ? opts.userName : "";

  if (!apiBase) throw new Error("subscribeSafariWebPush: apiBase is required");
  if (!userId) throw new Error("subscribeSafariWebPush: userId is required");

  if (!("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;

  // Ask permission (Safari requires this)
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;

  if (!webPushPublicKey) {
    throw new Error(
      "Missing VITE_WEBPUSH_PUBLIC_KEY (Netlify env). This must match your generated VAPID publicKey."
    );
  }

  // Register Web Push SW (separate from firebase-messaging-sw.js)
  const reg = await navigator.serviceWorker.register("/webpush-sw.js");

  // Existing subscription?
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(webPushPublicKey),
    }));

  // Save subscription to backend
  const res = await fetch(`${apiBase.replace(/\/+$/, "")}/webpush/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      userName,
      subscription,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WebPush subscribe failed (${res.status}): ${text || "Unknown error"}`);
  }

  return subscription;
}