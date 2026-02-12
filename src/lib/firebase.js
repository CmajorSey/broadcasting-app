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
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

// Lazily created messaging + SW registration
let messaging = null;
let swRegistration = null;

/* ===========================
   🧠 FCM singletons / dedupe guards
   - Prevent double getToken calls (common in StrictMode / multiple callers)
   - Prevent multiple foreground onMessage listeners
   =========================== */
let tokenCache = null; // last minted token (per tab session)
let tokenPromise = null; // in-flight getToken promise

let foregroundUnsub = null; // actual firebase onMessage unsub
let foregroundInitPromise = null; // in-flight init promise
const foregroundHandlers = new Set(); // fanout to many handlers with ONE FCM listener

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
        )) || (await navigator.serviceWorker.register("/firebase-messaging-sw.js"));
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

console.log("Firebase Project ID:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

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
 *
 * DEDUPE:
 * - If multiple callers request a token at the same time, they will share ONE in-flight promise.
 * - If a token is already minted during this tab session, return it immediately.
 */
export const requestPermission = async (opts = {}) => {
  const { supported, registration, messaging: msg } = await prepareMessaging();
  if (!supported || !msg) return null;

  const prompt = opts?.prompt === true;
  const interactive = prompt === true;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

  // ✅ Missing VAPID key → cannot mint token (surface in interactive mode)
  if (!vapidKey) {
    const err = new Error("Missing VITE_FIREBASE_VAPID_KEY (Web Push public key)");
    if (interactive) throw err;
    return null;
  }

  const mintTokenOnce = async () => {
    // ✅ Return cached token for this tab session
    if (tokenCache) return tokenCache;

    // ✅ Share the same in-flight promise across callers
    if (tokenPromise) return await tokenPromise;

    tokenPromise = (async () => {
      const t = await getToken(msg, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
      tokenCache = t || null;
      return tokenCache;
    })()
      .catch((err) => {
        // important: clear promise so future attempts can retry
        tokenPromise = null;
        throw err;
      })
      .finally(() => {
        // clear promise after resolve (but keep cache)
        tokenPromise = null;
      });

    return await tokenPromise;
  };

  // ✅ Already granted → just get token (deduped)
  if (Notification.permission === "granted") {
    try {
      return await mintTokenOnce();
    } catch (err) {
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
      return await mintTokenOnce();
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

/* ===========================
   📩 Foreground FCM subscription starts here
   - SINGLE listener shared across the app (prevents duplicates)
   - Multiple callers can subscribe; messages fan out to all handlers
   - Safe no-op if unsupported or not configured
   =========================== */
export const subscribeToForegroundMessages = (handler) => {
  if (typeof handler === "function") {
    foregroundHandlers.add(handler);
  }

  const initOnce = async () => {
    const { supported, messaging: msg } = await prepareMessaging();
    if (!supported || !msg) return;

    if (foregroundUnsub) return; // already listening

    // One actual Firebase listener, fan-out to handler set
    foregroundUnsub = fcmOnMessage(msg, (payload) => {
      for (const h of Array.from(foregroundHandlers)) {
        try {
          h?.(payload);
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn("Foreground FCM handler error:", e);
          }
        }
      }
    });
  };

  // ✅ Ensure only one init in-flight even if called twice quickly
  if (!foregroundInitPromise) {
    foregroundInitPromise = initOnce()
      .catch((e) => {
        if (import.meta.env.DEV) {
          console.warn("subscribeToForegroundMessages failed:", e);
        }
      })
      .finally(() => {
        foregroundInitPromise = null;
      });
  }

  // Cleanup removes the handler; if none left, unsubscribe the single listener
  return () => {
    try {
      if (typeof handler === "function") {
        foregroundHandlers.delete(handler);
      }

      if (foregroundHandlers.size === 0 && typeof foregroundUnsub === "function") {
        foregroundUnsub();
        foregroundUnsub = null;
      }
    } catch {
      // ignore
    }
  };
};

/* ===========================
   ✅ Backwards-compat export
   Some older app code imports: { requestPermission, onMessage } from "@/lib/firebase"
   Firebase's SDK exports onMessage from "firebase/messaging", but our app imports from this wrapper.
   So we provide an `onMessage` export that behaves like Firebase onMessage:
   - returns an unsubscribe function
   - registers a foreground handler safely (deduped)
   =========================== */
export const onMessage = (handler) => subscribeToForegroundMessages(handler);

/* ===========================
   📩 Foreground FCM subscription ends here
   =========================== */

// Optional: export app and messaging reference (messaging may remain null until prepared)
export { app, messaging };
