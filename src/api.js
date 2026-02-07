const hostname = window.location.hostname;

let API_BASE;

// ✅ Highest priority: explicit override (works for Netlify + local + Vite env)
const OVERRIDE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL)) ||
  (typeof process !== "undefined" &&
    process.env &&
    (process.env.API_BASE || process.env.API_BASE_URL));

if (OVERRIDE) {
  API_BASE = OVERRIDE;
} else if (hostname === "localhost" || hostname === "127.0.0.1") {
  API_BASE = "http://localhost:4000";
} else if (hostname.startsWith("192.168.")) {
  // 🧠 You’re likely accessing from LAN — hardcode local machine IP
  API_BASE = "http://192.168.100.61:4000"; // <-- Change to YOUR actual local server IP
} else {
  API_BASE = "https://loboard-server-backend.onrender.com";
}

export default API_BASE;
