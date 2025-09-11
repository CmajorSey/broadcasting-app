const hostname = window.location.hostname;

let API_BASE;

if (
  hostname === "localhost" ||
  hostname === "127.0.0.1"
) {
  API_BASE = "http://localhost:4000";
} else if (hostname.startsWith("192.168.")) {
  // 🧠 You’re likely accessing from LAN — hardcode local machine IP
  API_BASE = "http://192.168.88.54:4000"; // <-- Change to YOUR actual local server IP
} else {
  API_BASE = "https://loboard-server-backend.onrender.com";
}

export default API_BASE;
