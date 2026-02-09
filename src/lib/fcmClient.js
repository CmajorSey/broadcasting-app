// src/lib/fcmClient.js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let app;
let messaging;

export async function initFcm() {
  const supported = await isSupported();
  if (!supported) return { supported: false };

  app = initializeApp(firebaseConfig);
  messaging = getMessaging(app);

  // Ensure SW exists
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  }

  return { supported: true };
}

export async function requestFcmToken() {
  if (!messaging) throw new Error("FCM not initialized");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;

  const token = await getToken(messaging, { vapidKey });
  return token || null;
}

export function onForegroundMessage(handler) {
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}
