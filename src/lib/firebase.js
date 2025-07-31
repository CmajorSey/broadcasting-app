// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDB2mejIIrbi8cDXGanMiSogE9VmG4MsG8",
  authDomain: "loboard-notifications.firebaseapp.com",
  projectId: "loboard-notifications",
  storageBucket: "loboard-notifications.firebasestorage.app",
  messagingSenderId: "302425553477",
  appId: "1:302425553477:web:32e35c1c2e22c96793012c",
};

const app = initializeApp(firebaseConfig);
let messaging = null;
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "Notification" in window
) {
  try {
    messaging = getMessaging(app);
  } catch (err) {
    console.error("FCM not supported in this browser:", err);
  }
}

export const requestPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const token = await getToken(messaging, {
        vapidKey: "BGWur5QdwGYXaEZoVZqa0Z7Wh38oEZrnN34d8qMaKoeCRneypc066rrA_o0kqVcF6R3dMxMNEV5a1RVaRfiyptg", // ⛔ Replace this in next step
      });
      return token;
    } else {
      console.warn("Notification permission not granted.");
      return null;
    }
  } catch (err) {
    console.error("Error getting notification permission or token:", err);
    return null;
  }
};

export { messaging, onMessage };
