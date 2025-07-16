import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // ✅ Must be here!

// Temporary patch for undefined triggerEvent bug (native plugin fail-safe)
if (typeof window.triggerEvent !== "function") {
  window.triggerEvent = () => {};
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
