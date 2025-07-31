// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.3.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.3.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDB2mejIIrbi8cDXGanMiSogE9VmG4MsG8",
  authDomain: "loboard-notifications.firebaseapp.com",
  projectId: "loboard-notifications",
  messagingSenderId: "302425553477",
  appId: "1:302425553477:web:32e35c1c2e22c96793012c"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/icon.png", // 🔄 You can replace this with your actual app icon
  });
});
