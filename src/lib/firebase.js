// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage as fcmOnMessage,
} from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDB2mejIIrbi8cDXGanMiSogE9VmG4MsG8",
  authDomain: "loboard-notifications.firebaseapp.com",
  projectId: "loboard-notifications",
  storageBucket: "loboard-notifications.firebasestorage.app",
  messagingSenderId: "302425553477",
  appId: "1:302425553477:web:32e35c1c2e22c96793012c",
};

const app = initializeApp(firebaseConfig);

// We’ll lazily set this once we know the browser supports FCM and the SW is ready.
let messaging = null;

/**
 * Ensure FCM is supported, register the service worker, and create a Messaging instance.
 * Returns { supported, registration, messaging }.
 */
async function prepareMessaging() {
  try {
    if (typeof window === "undefined") return { supported: false };

    const supported = await isSupported().catch(() => false);
    if (!supported) return { supported: false };

    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      return { supported: false };
    }

    // Make sure our SW is registered and active (path must be at public root)
    // Ensure you have a file at: /public/firebase-messaging-sw.js
    // and it imports firebase messaging setBackgroundMessageHandler (or the v9 equivalent).
    let registration;
    try {
      // Reuse existing registration if any; otherwise register
      registration = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
      if (!registration) {
        registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      }
      // Wait until active so getToken can bind to it reliably
      await navigator.serviceWorker.ready;
    } catch (swErr) {
      console.error("Service worker registration failed:", swErr);
      return { supported: false };
    }

    if (!messaging) {
      try {
        messaging = getMessaging(app);
      } catch (gmErr) {
        console.error("getMessaging failed:", gmErr);
        return { supported: false };
      }
    }

    return { supported: true, registration, messaging };
  } catch (err) {
    console.error("prepareMessaging error:", err);
    return { supported: false };
  }
}

/**
 * Ask for permission only when appropriate and return the token (or null).
 * Call this from a user action (e.g., button click) for best results.
 */
export const requestPermission = async () => {
  try {
    // Prepare messaging & SW
    const { supported, registration, messaging: msg } = await prepareMessaging();
    if (!supported || !msg) {
      console.warn("FCM messaging not initialized or unsupported in this browser.");
      return null;
    }

    // If already granted, just get the token
    if (Notification.permission === "granted") {
      try {
        const token = await getToken(msg, {
          vapidKey:
            "BGWur5QdwGYXaEZoVZqa0Z7Wh38oEZrnN34d8qMaKoeCRneypc066rrA_o0kqVcF6R3dMxMNEV5a1RVaRfiyptg",
          serviceWorkerRegistration: registration,
        });
        return token || null;
      } catch (err) {
        console.error("getToken failed:", err);
        return null;
      }
    }

    // If denied, do nothing (don’t spam logs)
    if (Notification.permission === "denied") {
      return null;
    }

    // Only prompt when 'default'
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return null;
    }

    // Granted → get token
    try {
      const token = await getToken(msg, {
        vapidKey:
          "BGWur5QdwGYXaEZoVZqa0Z7Wh38oEZrnN34d8qMaKoeCRneypc066rrA_o0kqVcF6R3dMxMNEV5a1RVaRfiyptg",
        serviceWorkerRegistration: registration,
      });
      return token || null;
    } catch (err) {
      console.error("getToken failed after grant:", err);
      return null;
    }
  } catch (err) {
    console.error("Notification permission/token error:", err);
    return null;
  }
};

// Re-export onMessage for foreground messages
export const onMessage = fcmOnMessage;
export { messaging };
