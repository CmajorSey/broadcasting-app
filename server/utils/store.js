// server/utils/store.js
// Unified JSON read/write using Render's persistent disk at /data in prod.
// Falls back to local ./data in dev.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve base data dir:
// - In Render, use /data (persistent).
// - Locally, use project ./data (alongside server).
const DATA_DIR =
  process.env.NODE_ENV === "production"
    ? "/data"
    : path.resolve(__dirname, "..", "data");

// Ensure directory exists locally
try {
  if (!fs.existsSync(DATA_DIR) && process.env.NODE_ENV !== "production") {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error("Failed to ensure DATA_DIR:", DATA_DIR, e);
}

const filePath = (name) => path.join(DATA_DIR, name);

// Read JSON safely; return fallback if missing/invalid
export function readJson(name, fallback) {
  const p = filePath(name);
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.warn(`[store] readJson error for ${p}:`, e.message);
    }
    return fallback;
  }
}

// Write JSON atomically-ish
export function writeJson(name, data) {
  const p = filePath(name);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error(`[store] writeJson error for ${p}:`, e.message);
    return false;
  }
}

// Convenience helpers for users.json
const USERS_FILE = "users.json";

export function getUsers() {
  // Always read fresh from disk so login sees newly-created users immediately
  return readJson(USERS_FILE, []);
}

export function saveUsers(users) {
  return writeJson(USERS_FILE, users);
}

// Optional: quick path debug (helps confirm you're on /data in prod)
export function getDataDir() {
  return DATA_DIR;
}
