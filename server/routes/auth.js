// server/routes/auth.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data folder uses Render's persistent disk in production, local ../data in dev.
const isProd = process.env.NODE_ENV === "production";
const DATA_DIR = isProd ? "/data" : path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Ensure local data dir exists (Render /data already exists)
try {
  if (!isProd && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error("[auth] Failed to ensure DATA_DIR:", DATA_DIR, e);
}

// Safe JSON read/write with auto-init
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      // Initialize an empty file if missing
      fs.writeFileSync(USERS_FILE, "[]", "utf-8");
      return [];
    }
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[auth] readUsers error:", e.message, "USERS_FILE=", USERS_FILE);
    return [];
  }
}
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.error("[auth] writeUsers error:", e.message, "USERS_FILE=", USERS_FILE);
  }
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
  // Do not leak password or reset internals
  const {
    password,
    resetToken,
    resetExpires,
    // keep flags and metadata
    ...rest
  } = user;
  return rest;
}
function isBcryptHash(v) {
  const s = String(v || "");
  return s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$");
}
function isExpired(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() > t;
}

const router = Router();

/**
 * POST /auth/login
 * Body: { identifier: string, password: string }
 * Supports legacy plaintext or bcrypt-hashed passwords.
 * Returns:
 *  {
 *    ok: true,
 *    user,                       // sanitized
 *    mustChangePassword: boolean,
 *    requiresPasswordChange: boolean, // alias for older UI
 *    forcePasswordChange: boolean,    // raw flag for debugging
 *    tempPasswordExpires: string|undefined
 *  }
 */
router.post("/login", async (req, res) => {
  /* ===========================
     🔐 Login validation starts here
     - IMPORTANT: password must be PLAINTEXT (user typed)
     - If frontend accidentally sends a bcrypt hash, we hard-reject with 400
     =========================== */

  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: "Missing identifier or password" });
  }

  // ✅ Guard: frontend must NOT send the stored bcrypt hash back as "password"
  // This is the exact bug you showed in DevTools payload.
  if (isBcryptHash(password)) {
    return res.status(400).json({
      error:
        "Invalid login payload: password must be plaintext (user typed), not a bcrypt hash.",
    });
  }

  const users = readUsers();
  const user = findUserByIdentifier(users, identifier);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const stored = String(user.password || "");
  let valid = false;

  if (isBcryptHash(stored)) {
    try {
      valid = await bcrypt.compare(password, stored);
    } catch {
      valid = false;
    }
  } else {
    valid = password === stored; // legacy plaintext
  }

  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  // Compute signals
  const firstName = String(user.name || "").trim().split(/\s+/)[0] || "";
  const defaultPassword = firstName ? `${firstName}1` : null;
  const isDefaultPassword =
    !isBcryptHash(stored) && defaultPassword && stored === defaultPassword;
  const hasMustChangeFlag = !!(
    user.forcePasswordChange ||
    user.requiresPasswordReset ||
    user.passwordIsTemp === true
  );

  // If any must-change flag is set, and it has an expiry that passed → block with 410
  if (hasMustChangeFlag && isExpired(user.tempPasswordExpires)) {
    return res.status(410).json({ error: "Temporary password has expired" });
  }

  // 🩹 Safe self-heal:
  // Only auto-clear stale flags if there is clearly NO active reset flow.
  // If an admin just reset the user, we MUST NOT clear the flags here.
  if (
    hasMustChangeFlag &&
    user.passwordUpdatedAt &&
    !user.passwordIsTemp &&
    !user.forcePasswordChange &&
    !user.requiresPasswordReset &&
    !user.tempPasswordExpires
  ) {
    user.forcePasswordChange = false;
    user.requiresPasswordReset = false;
    user.passwordIsTemp = false;
    user.tempPasswordExpires = null;
    try {
      writeUsers(users);
    } catch {}
  }

  // Re-evaluate after self-heal
  const mustChangePassword = !!(
    user.forcePasswordChange ||
    user.requiresPasswordReset ||
    user.passwordIsTemp === true ||
    isDefaultPassword
  );

  // Hard gate: if a change is required, FORCE the client into /set-password.
  // Use 428 so it is never treated as a normal login session.
  if (mustChangePassword) {
    // Helpful header hints (your LoginPage checks these too)
    res.setHeader("X-Requires-Password-Change", "true");
    res.setHeader("Cache-Control", "no-store");

    return res.status(428).json({
      ok: true,
      message: "Password change required",
      mustChangePassword: true,
      requiresPasswordChange: true, // legacy alias
      forcePasswordChange: !!user.forcePasswordChange,
      requiresPasswordReset: !!user.requiresPasswordReset,
      passwordIsTemp: !!user.passwordIsTemp,
      tempPasswordExpires: user.tempPasswordExpires || null,
      user: { id: String(user.id), name: user.name }, // minimal identity for set-password screen
      nextPath: "/set-password",
    });
  }

  // Normal login path
  try {
    user.lastLoginAt = new Date().toISOString();
    writeUsers(users);
  } catch {}

  return res.json({
    ok: true,
    user: sanitizeUser(user),
    mustChangePassword: false,
    requiresPasswordChange: false,
    forcePasswordChange: !!user.forcePasswordChange,
    passwordIsTemp: !!user.passwordIsTemp,
    tempPasswordExpires: user.tempPasswordExpires || null,
  });
});


/**
 * POST /auth/admin/users/:id/temp-password
 * Admin issues a one-time temporary password (forces change at next login)
 * Returns { success: true, tempPassword, user: {id,name,...}, message }
 *
 * NOTE: You ALSO have /users/:id/temp-password in server/index.js (plaintext for compat).
 * This route uses bcrypt. Both can coexist; stick to one style in your Admin UI.
 */
router.post("/admin/users/:id/temp-password", async (req, res) => {
  const { id } = req.params;
  const { hours } = req.body || {};
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 72;
  const tempPasswordExpires = new Date(
    Date.now() + ttlHours * 60 * 60 * 1000
  ).toISOString();

  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const base =
    (users[idx].name?.split(/\s+/)[0] || "User").replace(/[^A-Za-z]/g, "") ||
    "User";
  const rand = Math.floor(100 + Math.random() * 900);
  const temp = `${base}${rand}`;

  // ✅ IMPORTANT: store PLAINTEXT temp password (matches server/index.js /auth/login)
  users[idx] = {
    ...users[idx],
    password: temp,
    forcePasswordChange: true,
    requiresPasswordReset: true, // legacy alias
    passwordIsTemp: true,
    tempPasswordExpires,
    updatedAt: new Date().toISOString(),
  };

  writeUsers(users);

  return res.json({
    success: true,
    tempPassword: temp,
    user: {
      id: users[idx].id,
      name: users[idx].name,
      roles: users[idx].roles,
      forcePasswordChange: users[idx].forcePasswordChange,
      requiresPasswordReset: users[idx].requiresPasswordReset,
      passwordIsTemp: !!users[idx].passwordIsTemp,
      tempPasswordExpires: users[idx].tempPasswordExpires,
    },
    message: `Temporary password set. Expires in ${ttlHours} hours.`,
  });
});


/**
 * POST /auth/set-password
 * Body: { userId: string, newPassword: string, currentPassword?: string }
 * If user.forcePasswordChange is true, currentPassword is NOT required.
 * On success, clears must-change flags and temp expiry.
 */
router.post("/set-password", async (req, res) => {
  const { userId, newPassword, currentPassword } = req.body || {};
  if (!userId || !newPassword) {
    return res.status(400).json({ error: "Missing userId or newPassword" });
  }

  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(userId));
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const user = users[idx];

  // ✅ Consider ANY of these as "forced change" (no current password required):
  // - forcePasswordChange (current)
  // - requiresPasswordReset (legacy)
  // - passwordIsTemp (explicit temp marker)
  const inForcedChangeFlow = !!(
    user.forcePasswordChange ||
    user.requiresPasswordReset ||
    user.passwordIsTemp
  );

  if (!inForcedChangeFlow) {
    // Not forced: require & verify current password.
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password required" });
    }
    const stored = String(user.password || "");

    // Accept either legacy plaintext or bcrypt-hashed stored values
    const ok = isBcryptHash(stored)
      ? await bcrypt.compare(String(currentPassword), stored)
      : String(currentPassword) === stored;

    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  } else {
    // Forced-change: enforce temp expiry if set.
    if (isExpired(user.tempPasswordExpires)) {
      return res.status(410).json({ error: "Temporary password has expired" });
    }
  }

  // ✅ IMPORTANT: store PLAINTEXT new password (matches server/index.js /auth/login)
  users[idx].password = String(newPassword).trim();

  // Clear all flags
  users[idx].forcePasswordChange = false;
  users[idx].requiresPasswordReset = false;
  users[idx].passwordIsTemp = false;
  users[idx].tempPasswordExpires = null;
  users[idx].passwordUpdatedAt = new Date().toISOString();
  users[idx].updatedAt = new Date().toISOString();

  writeUsers(users);
  return res.json({ success: true });
});


export default router;
