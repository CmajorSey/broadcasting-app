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

/**
 * Ask for permission only when appropriate and return the token (or null).
 * Call this from a user action (e.g., button click).
 */
export const requestPermission = async () => {
  const { supported, registration, messaging: msg } = await prepareMessaging();
  if (!supported || !msg) return null;

  // Already granted → just get token
  if (Notification.permission === "granted") {
    try {
      const token = await getToken(msg, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      return token || null;
    } catch (err) {
      if (import.meta.env.DEV) console.warn("getToken failed:", err);
      return null;
    }
  }

  // Denied → bail
  if (Notification.permission === "denied") return null;

  // Prompt only when default
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  try {
    const token = await getToken(msg, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("getToken failed after grant:", err);
    return null;
  }
};

// Foreground messages helper (same signature)
export const onMessage = fcmOnMessage;

// Optional: export app and messaging reference (messaging may remain null until prepared)
export { app, messaging };
