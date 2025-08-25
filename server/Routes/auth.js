// server/routes/auth.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data folder resolves relative to this routes folder: ../data/users.json
const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Helpers
function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUserByIdentifier(users, identifier) {
  const lower = String(identifier || "").trim().toLowerCase();
  return users.find((u) => {
    const name = String(u.name || "").toLowerCase();
    const username = String(u.username || "").toLowerCase();
    const email = String(u.email || "").toLowerCase();
    return name === lower || username === lower || email === lower;
  });
}

function sanitizeUser(user) {
  const { password, resetToken, resetExpires, ...rest } = user;
  return rest;
}

const router = Router();

/**
 * POST /auth/login
 * Body: { identifier: string, password: string }
 * - identifier can be name, username, or email (case-insensitive)
 * - Supports legacy plaintext or bcrypt-hashed passwords
 * - Returns { ok: true, user }
 */
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: "Missing identifier or password" });
  }

  const users = readUsers();
  const user = findUserByIdentifier(users, identifier);

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const stored = String(user.password || "");
  let valid = false;

  // If looks like a bcrypt hash, compare with bcrypt
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    try {
      valid = await bcrypt.compare(password, stored);
    } catch {
      valid = false;
    }
  } else {
    // Legacy plaintext comparison
    valid = password === stored;
  }

  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.json({ ok: true, user: sanitizeUser(user) });
});

/**
 * POST /auth/request-reset
 * Body: { email: string }
 * - Always returns 200 (to avoid user enumeration)
 * - Generates a one-time token valid for 60 minutes
 * - Persists { resetToken, resetExpires } on the user
 * - Returns { ok: true, resetUrl } so you can copy the link for users (until SMTP is set up)
 */
router.post("/request-reset", (req, res) => {
  const { email } = req.body || {};
  const users = readUsers();

  // Always behave as if successful for privacy
  const user = findUserByIdentifier(users, email);
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = Date.now() + 60 * 60 * 1000; // 60 minutes
    user.resetToken = token;
    user.resetExpires = expires;
    writeUsers(users);

    const origin = process.env.FRONTEND_ORIGIN || "https://loboard.netlify.app";
    const resetUrl = `${origin}/reset?token=${token}`;
    return res.json({ ok: true, resetUrl });
  }

  // Even if user not found, return ok to prevent enumeration
  return res.json({ ok: true });
});

/**
 * POST /auth/reset
 * Body: { token: string, password: string }
 * - Verifies token & expiry
 * - Hashes the new password
 * - Clears resetToken/resetExpires
 */
router.post("/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "Missing token or password" });
  }

  const users = readUsers();
  const now = Date.now();

  const user = users.find(
    (u) =>
      u.resetToken === token &&
      typeof u.resetExpires === "number" &&
      u.resetExpires > now
  );

  if (!user) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  // Hash password (adjust salt rounds if needed)
  const hash = await bcrypt.hash(password, 10);
  user.password = hash;

  // Clear reset fields
  delete user.resetToken;
  delete user.resetExpires;

  writeUsers(users);
  return res.json({ ok: true });
});

export default router;
