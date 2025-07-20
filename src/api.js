const hostname = window.location.hostname;

let API_BASE;

if (hostname === "localhost") {
  API_BASE = "http://localhost:4000";
} else if (hostname.startsWith("192.168.")) {
  API_BASE = `http://${hostname}:4000`; // HTTP for LAN IP
} else {
  API_BASE = "https://broadcasting-app-backend.onrender.com"; // Production
}

export default API_BASE;
