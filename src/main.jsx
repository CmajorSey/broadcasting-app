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
   - IMPORTANT: We now register ONLY /sw.js
   - /sw.js imports Firebase messaging logic, so push keeps working
   - Prevents SW scope fights (sw.js vs firebase-messaging-sw.js)
   =========================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("PWA+Push SW registered:", registration);
      })
      .catch((err) => {
        console.error("SW registration failed:", err);
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);