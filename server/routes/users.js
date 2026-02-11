// server/routes/users.js
// v1 — Persistent users route with 42-day annual leave cap
// ES modules style to match your codebase

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Resolve a safe data dir (Render persistent disk mounts at /data)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || "/data";
const USERS_PATH = path.join(DATA_DIR, "users.json");

// Ensure /data and users.json exist
function ensureUsersFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(USERS_PATH)) {
      fs.writeFileSync(USERS_PATH, "[]", "utf8");
    }
  } catch (err) {
    console.error("Failed to ensure users file:", err);
  }
}

function readUsers() {
  ensureUsersFile();
  try {
    const raw = fs.readFileSync(USERS_PATH, "utf8") || "[]";
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read users.json:", err);
    return [];
  }
}

// Atomic write (tmp+rename) to reduce risk of truncation on crash
function writeUsers(users) {
  ensureUsersFile();
  const tmp = USERS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), "utf8");
  fs.renameSync(tmp, USERS_PATH);
}

// Shared clamp (frontends should also clamp)
function clampLeave(value, min = 0, max = 42) {
  if (value === undefined || value === null || Number.isNaN(Number(value)))
    return undefined;
  const n = Math.round(Number(value));
  return Math.max(min, Math.min(max, n));
}

/* ===========================
   🔔 FCM token helpers start
   Prevent cross-user leakage, dedupe tokens, keep last N.
   =========================== */

function normalizeToken(token) {
  if (typeof token !== "string") return "";
  const t = token.trim();
  // very light sanity check (FCM tokens are long)
  if (t.length < 20) return "";
  return t;
}

function mergeTokenIntoUser(user, token) {
  const t = normalizeToken(token);
  if (!t) return user;

  const next = { ...user };

  // Keep single-token convenience field
  next.fcmToken = t;

  // Maintain per-user token list (no leakage)
  const existing = Array.isArray(next.fcmTokens) ? next.fcmTokens.filter(Boolean) : [];
  const deduped = existing.filter((x) => x !== t);
  deduped.push(t);

  // Trim to last 10 tokens (enough for multiple devices/browsers)
  const MAX = 10;
  next.fcmTokens = deduped.slice(Math.max(0, deduped.length - MAX));

  next.fcmTokenUpdatedAt = new Date().toISOString();
  return next;
}

/* ===========================
   🔔 FCM token helpers end
   =========================== */

// ────────────────────────────────────────────────
// GET /users → returns full users list (use sparingly in UI)
router.get("/", (_req, res) => {
  const users = readUsers();
  res.json(users);
});

// PATCH /users/:id → update balances/status safely, persist to /data/users.json
router.patch("/:id", (req, res) => {
  const { id } = req.params;

  const {
    annualLeaveBalance,
    offDayBalance,
    currentLeaveStatus, // e.g., "On Leave", "Off Duty", "Available"

    /* ===========================
       🔔 Notifications & device tokens live here
       =========================== */
    fcmToken,
    // NOTE: We intentionally ignore client-provided fcmTokens arrays to prevent
    // accidental/malicious cross-user token leakage. Only accept single fcmToken.

    // Any other lightweight fields you want to allow inline edits for
  } = req.body || {};

  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) {
    return res.status(404).json({ error: "User not found" });
  }

  // IMPORTANT: start from the correct user record (prevents mutation leakage)
  let user = { ...users[idx] };

  // Only touch provided fields; clamp annualLeaveBalance to 0–42 on server
  if (annualLeaveBalance !== undefined) {
    const clamped = clampLeave(annualLeaveBalance, 0, 42);
    if (clamped === undefined) {
      return res.status(400).json({ error: "Invalid annualLeaveBalance" });
    }
    user.annualLeaveBalance = clamped;
  }

  if (offDayBalance !== undefined) {
    // Off days are uncapped (per your notes), but normalize to integer ≥ 0
    const n = Math.max(0, Math.round(Number(offDayBalance)));
    if (Number.isNaN(n)) return res.status(400).json({ error: "Invalid offDayBalance" });
    user.offDayBalance = n;
  }

  if (currentLeaveStatus !== undefined) {
    user.currentLeaveStatus = String(currentLeaveStatus || "");
  }

  // ✅ Token update (per-user, deduped, trimmed)
  if (fcmToken !== undefined) {
    user = mergeTokenIntoUser(user, fcmToken);
  }

  users[idx] = user;

  try {
    writeUsers(users);
    return res.json(user); // send back the fresh user for optimistic UI sync
  } catch (err) {
    console.error("Failed to write users.json:", err);
    return res.status(500).json({ error: "Failed to persist changes" });
  }
});

export default router;
