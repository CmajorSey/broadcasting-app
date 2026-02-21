import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css"; // ✅ Must be here!

// Temporary patch for undefined triggerEvent bug (native plugin fail-safe)
if (typeof window.triggerEvent !== "function") {
  window.triggerEvent = () => {};
}

/* ===========================
   🔔 Service worker registration lives here
   - Registers FCM SW (push)
   - Also registers basic PWA SW if present
   - Keeps existing behavior intact
   =========================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // ✅ Your existing Firebase messaging SW (keep this)
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then((registration) => {
        console.log("Firebase SW registered:", registration);
      })
      .catch((err) => {
        console.error("Firebase SW registration failed:", err);
      });

    // ✅ Optional: register our basic PWA SW if you add public/sw.js
    // (does NOT break anything if the file doesn't exist)
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("PWA SW registered:", registration);
      })
      .catch(() => {
        // Silent on purpose (sw.js might not exist in some builds yet)
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);