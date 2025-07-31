import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // ✅ Must be here!

// Temporary patch for undefined triggerEvent bug (native plugin fail-safe)
if (typeof window.triggerEvent !== "function") {
  window.triggerEvent = () => {};
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/firebase-messaging-sw.js')
    .then((registration) => {
      console.log("Firebase SW registered:", registration);
    })
    .catch((err) => {
      console.error("Firebase SW registration failed:", err);
    });
}


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
