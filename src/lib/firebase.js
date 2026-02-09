// src/lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage as fcmOnMessage,
} from "firebase/messaging";

// Read config from Vite env
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Only spin up Firebase if core Messaging fields exist
const hasCoreMessagingConfig = (cfg) =>
  !!(cfg?.apiKey && cfg?.projectId && cfg?.appId && cfg?.messagingSenderId);

// Initialize (or reuse) the app only when config is complete
const app = hasCoreMessagingConfig(firebaseConfig)
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

// Lazily created messaging + SW registration
let messaging = null;
let swRegistration = null;

/**
 * Ensure FCM is supported, SW is ready, and create a Messaging instance.
 * Returns { supported, registration, messaging } or { supported:false }.
 */
async function prepareMessaging() {
  try {
    if (!app) return { supported: false }; // no config yet — hard no-op
    if (typeof window === "undefined") return { supported: false };

    const supported = await isSupported().catch(() => false);
    if (!supported) return { supported: false };

    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      return { supported: false };
    }

    try {
      swRegistration =
        (await navigator.serviceWorker.getRegistration(
          "/firebase-messaging-sw.js"
        )) ||
        (await navigator.serviceWorker.register("/firebase-messaging-sw.js"));
      await navigator.serviceWorker.ready;
    } catch (swErr) {
      if (import.meta.env.DEV) {
        console.warn("SW registration failed (FCM will be disabled):", swErr);
      }
      return { supported: false };
    }

    if (!messaging) {
      try {
        messaging = getMessaging(app);
      } catch (gmErr) {
        if (import.meta.env.DEV) {
          console.warn("getMessaging failed — likely missing env config:", gmErr);
        }
        return { supported: false };
      }
    }

    return { supported: true, registration: swRegistration, messaging };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("prepareMessaging error:", err);
    }
    return { supported: false };
  }
}
console.log(
  "Firebase Project ID:",
  import.meta.env.VITE_FIREBASE_PROJECT_ID
);


/**
 * Ask for permission only when appropriate and return the token (or null).
 * Call this from a user action (e.g., button click).
 */
/* ===========================
   🔔 FCM permission/token starts here
   IMPORTANT:
   - Browsers often block permission prompts unless triggered by a user gesture.
   - Default behavior here: do NOT prompt automatically.
   - Use requestPermission({ prompt: true }) from a button/toggle when you want to ask.
   =========================== */

/**
 * Ask for permission only when appropriate and return the token (or null).
 * ✅ Default: prompt=false (safe for useEffect)
 * ✅ If prompt=true: will trigger Notification.requestPermission() when needed
 */
export const requestPermission = async (opts = {}) => {
  const { supported, registration, messaging: msg } = await prepareMessaging();
  if (!supported || !msg) return null;

  const prompt = opts?.prompt === true;

  // ✅ Treat prompt=true as "interactive mode" → surface real errors
  const interactive = prompt === true;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

  // ✅ Missing VAPID key → cannot mint token (surface in interactive mode)
  if (!vapidKey) {
    const err = new Error("Missing VITE_FIREBASE_VAPID_KEY (Web Push public key)");
    if (interactive) throw err;
    return null;
  }

  // ✅ Already granted → just get token
  if (Notification.permission === "granted") {
    try {
      const token = await getToken(msg, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
      return token || null;
    } catch (err) {
      // In prod you were swallowing this; surface when user explicitly asked
      try {
        console.warn("FCM getToken failed:", err);
      } catch {
        // ignore
      }
      if (interactive) throw err;
      return null;
    }
  }

  // ✅ Denied → bail
  if (Notification.permission === "denied") return null;

  // ✅ Default (not decided):
  // - If we're NOT allowed to prompt (e.g. called from useEffect), return null safely.
  if (Notification.permission === "default" && !prompt) return null;

  // ✅ Prompt only when explicitly allowed
  if (prompt) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    try {
      const token = await getToken(msg, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
      return token || null;
    } catch (err) {
      try {
        console.warn("FCM getToken failed after grant:", err);
      } catch {
        // ignore
      }
      if (interactive) throw err;
      return null;
    }
  }

  return null;
};

/* ===========================
   🔔 FCM permission/token ends here
   =========================== */


// Foreground messages helper (same signature)
export const onMessage = fcmOnMessage;

// Optional: export app and messaging reference (messaging may remain null until prepared)
export { app, messaging };
