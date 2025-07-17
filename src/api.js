const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname.startsWith("192.168.");

const API_BASE = isLocal
  ? "http://192.168.88.54:4000"
  : "https://broadcasting-app-backend.onrender.com"; // 🔁 your deployed backend URL

export default API_BASE;
