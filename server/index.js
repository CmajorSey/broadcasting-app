console.log("🚨 First checkpoint reached");
// @ts-nocheck
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";

import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
console.log("🔍 Looking for service account at:", path.resolve("firebase-service-account.json"));
// Using Node 18+ global fetch (no node-fetch needed)
import { GoogleAuth } from "google-auth-library";
import { createRequire } from "module";
import authRouter from "./routes/auth.js";
const require = createRequire(import.meta.url);

// Ensure .env is loaded before we read process.env (helps local dev)
dotenv.config();

// ✅ Load service account from env in prod, fall back to local file in dev
let serviceAccount = null;


// Option 1: whole JSON in FIREBASE_SERVICE_ACCOUNT
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON:", e.message);
  }
}

// Option 2: individual env vars
if (!serviceAccount && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
  serviceAccount = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    // Render/UI often stores "\n" — convert to real newlines
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

// Option 3: local file for dev
if (!serviceAccount) {
  try {
    serviceAccount = require("./firebase-service-account.json");
  } catch {
    console.warn("Service account file not found and env vars missing.");
  }
}

if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
  throw new Error(
    "Firebase credentials not provided. Set FIREBASE_SERVICE_ACCOUNT (JSON) or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY env vars."
  );
}

// Single GoogleAuth instance using credentials
const auth = new GoogleAuth({
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  },
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

const PROJECT_ID = "loboard-notifications"; // keep if unchanged

async function getAccessToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Could not obtain Google OAuth access token");
  return token;
}

async function sendPushToUsers(users, title, message) {
  const tokens = users
    .map((u) => u.fcmToken)
    .filter((t) => typeof t === "string" && t.length > 0);

  if (tokens.length === 0) {
    console.log("ℹ️ No FCM tokens found for recipients.");
    return;
  }

  const accessToken = await getAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

  const results = [];
  for (const token of tokens) {
    const payload = {
      message: {
        token,
        notification: { title, body: message },
        webpush: {
          headers: { Urgency: "high" },
          notification: { icon: "/icon.png" },
        },
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      console.error("❌ FCM send error:", res.status, json);
    }
    results.push({ status: res.status, body: json });
  }

  console.log("✅ Push send summary:", results);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("▶️ Running from:", __filename);

console.log("🚨 Imports completed");
console.log("🚨 ROUTE CHECKPOINT 1");

dotenv.config();

// ✅ Use persistent disk if on Render Starter plan
// ✅ Unified data path for both local and Render
const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const app = express();
const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://192.168.100.61:5173", // ✅ Your LAN frontend
  "https://loboard.netlify.app",
];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Express 5: use a RegExp to match all paths for preflight
app.options(new RegExp(".*"), cors());

app.use(express.json());

// ✅ Mount password reset routes
app.use("/auth", authRouter);


const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");
const ROSTERS_FILE = path.join(DATA_DIR, "rosters.json");
const PASSWORD_RESET_REQUESTS_FILE = path.join(DATA_DIR, "passwordResetRequests.json");
const groupsPath = path.join(__dirname, "data", "notificationGroups.json");


// 🔧 Ensure data directory and files exist
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(ROSTERS_FILE)) {
  fs.writeFileSync(ROSTERS_FILE, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(VEHICLES_FILE)) {
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify([]));
}

if (!fs.existsSync(TICKETS_FILE)) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify([]));
}

const USERS_DEFAULT_FILE = path.join(__dirname, "data", "users.json");
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsers = fs.readFileSync(USERS_DEFAULT_FILE, "utf-8");
  fs.writeFileSync(USERS_FILE, defaultUsers);
}

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ siteName: "Byenveni Lo Board" }, null, 2)
  );
}

if (!fs.existsSync(PASSWORD_RESET_REQUESTS_FILE)) {
  fs.writeFileSync(PASSWORD_RESET_REQUESTS_FILE, JSON.stringify([], null, 2));
}

console.log("🚨 ROUTE CHECKPOINT 2");
console.log("🚨 ROUTE CHECKPOINT 3");
// ✅ GET all groups
app.get("/notification-groups", (req, res) => {
  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    const groups = JSON.parse(raw);
    res.json(groups);
  } catch (err) {
    console.error("Failed to read groups:", err);
    res.status(500).json({ error: "Failed to read groups" });
  }
});

// ✅ POST new group
app.post("/notification-groups", (req, res) => {
  const { name, userIds } = req.body;

  if (!name || !Array.isArray(userIds)) {
    return res.status(400).json({ error: "Invalid group data" });
  }

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    const groups = JSON.parse(raw);

    const newGroup = {
      id: Date.now().toString(),
      name,
      userIds,
    };

    groups.push(newGroup);
    fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2));
    res.status(201).json(newGroup);
  } catch (err) {
    console.error("Failed to save group:", err);
    res.status(500).json({ error: "Failed to save group" });
  }
});

// ✅ PATCH update group
app.patch("/notification-groups/:id", (req, res) => {
  const { id } = req.params;
  const { name, userIds } = req.body;

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    let groups = JSON.parse(raw);

    const index = groups.findIndex((g) => g.id === id);
    if (index === -1) return res.status(404).json({ error: "Group not found" });

    groups[index] = {
      ...groups[index],
      name: name || groups[index].name,
      userIds: Array.isArray(userIds) ? userIds : groups[index].userIds,
    };

    fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2));
    res.json(groups[index]);
  } catch (err) {
    console.error("Failed to update group:", err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// ✅ DELETE group
app.delete("/notification-groups/:id", (req, res) => {
  const { id } = req.params;

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    let groups = JSON.parse(raw);

    const newGroups = groups.filter((g) => g.id !== id);
    fs.writeFileSync(groupsPath, JSON.stringify(newGroups, null, 2));
    res.status(204).end();
  } catch (err) {
    console.error("Failed to delete group:", err);
    res.status(500).json({ error: "Failed to delete group" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 4");
console.log("🚨 ROUTE CHECKPOINT 5");
// ✅ GET /notifications (returns all — frontend filters by user/section/group)
app.get("/notifications", (req, res) => {
  const notificationsPath = path.join(__dirname, "data", "notifications.json");

  try {
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    const all = JSON.parse(raw);
    res.json(all); // Return all notifications
  } catch (err) {
    console.error("Failed to read notifications:", err);
    res.status(500).json({ error: "Could not read notifications" });
  }
});
app.delete("/notifications/:timestamp", (req, res) => {
  const notificationsPath = path.join(__dirname, "data", "notifications.json");
  const encoded = req.params.timestamp;

  try {
    const decoded = decodeURIComponent(encoded);
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    const all = JSON.parse(raw);

    const updated = all.filter((n) => {
      try {
        return new Date(n.timestamp).toISOString().split(".")[0] !== new Date(decoded).toISOString().split(".")[0];
      } catch {
        return true;
      }
    });

    fs.writeFileSync(notificationsPath, JSON.stringify(updated, null, 2));
    console.log("🗑 Deleted notification:", decoded);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete notification:", err);
    res.status(500).json({ error: "Could not delete notification" });
  }
});

/* ✅ Forgot-password → log request, push admins, and write an in-app notification (with action + compact display) */
app.post("/auth/request-admin-reset", async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier || !String(identifier).trim()) {
      return res.status(400).json({ error: "Missing identifier" });
    }

    // Load users
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const allUsers = JSON.parse(usersRaw);

    // Match by name/username/email (case-insensitive)
    const lower = String(identifier).trim().toLowerCase();
    const requester =
      allUsers.find((u) => String(u.name || "").toLowerCase() === lower) ||
      allUsers.find((u) => String(u.username || "").toLowerCase() === lower) ||
      allUsers.find((u) => String(u.email || "").toLowerCase() === lower) ||
      null;

    // Save a request record
    const entry = {
      id: Date.now().toString(),
      identifier: String(identifier).trim(),
      requesterId: requester?.id || null,
      requesterName: requester?.name || null,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const reqsRaw = fs.readFileSync(PASSWORD_RESET_REQUESTS_FILE, "utf-8");
    const reqs = JSON.parse(reqsRaw);
    reqs.push(entry);
    fs.writeFileSync(PASSWORD_RESET_REQUESTS_FILE, JSON.stringify(reqs, null, 2));

    // Admin targets
    const admins = allUsers.filter(
      (u) => Array.isArray(u.roles) && u.roles.includes("admin")
    );

    // 🔔 Push notify admins (FCM)
    try {
      const title = "🔑 Password Reset Request";
      const who = entry.requesterName || entry.identifier;
      const body = `User requested a password reset: ${who}`;
      await sendPushToUsers(admins, title, body);
    } catch (pushErr) {
      console.warn("Push notification failed (will still return ok):", pushErr);
    }

    // 📣 In-app notification (full recipients for filtering, compact display label, and action payload)
    try {
      const notificationsPath = path.join(__dirname, "data", "notifications.json");
      const notifRaw = fs.existsSync(notificationsPath)
        ? fs.readFileSync(notificationsPath, "utf-8")
        : "[]";
      const notifications = JSON.parse(notifRaw);

      const title = "🔑 Password Reset Request";
      const who = entry.requesterName || entry.identifier;
      const message = `User requested a password reset: ${who}`;

      // Recipients for filtering (ids + names + roles + ALL)
      const adminIds = admins.map((a) => String(a.id)).filter(Boolean);
      const adminNames = admins.map((a) => String(a.name || "")).filter(Boolean);
      const recipients = Array.from(new Set([
        ...adminIds,
        ...adminNames,
        "admin",
        "admins",
        "ALL",
      ]));

      // Deep-link to User Management (adjust path if your User Management is under a different route)
      const actionUrl = entry.requesterId
        ? `/settings?resetUser=${encodeURIComponent(entry.requesterId)}`
        : `/settings?resetName=${encodeURIComponent(entry.identifier)}`;

      const newNotification = {
        title,
        message,
        recipients,
        timestamp: new Date().toISOString(),
        // 👇 extra metadata your UI can use
        kind: "password_reset_request",
        displayRecipients: ["Admins"],             // compact label for UI
        action: {
          type: "open_user_management",
          userId: entry.requesterId,               // may be null if name didn't match
          userName: entry.requesterName || entry.identifier,
          url: actionUrl,
        },
      };

      notifications.push(newNotification);
      fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));
      console.log("📣 Admin notification written:", { title, displayRecipients: newNotification.displayRecipients });
    } catch (notifErr) {
      console.warn("Writing admin notification failed:", notifErr);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("request-admin-reset error:", err);
    return res.status(500).json({ error: "Failed to submit reset request" });
  }
});

console.log("🚨 ROUTE CHECKPOINT 6");
console.log("🚨 ROUTE CHECKPOINT 7");


// ✅ One-time restore: force import vehicles from Git-tracked copy
app.get("/force-import-vehicles", (req, res) => {
  const VEHICLES_DEFAULT_FILE = path.join(__dirname, "data", "vehicles.json");
  if (fs.existsSync(VEHICLES_DEFAULT_FILE)) {
    const defaultVehicles = fs.readFileSync(VEHICLES_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(VEHICLES_FILE, defaultVehicles);
    res.json({ message: "✅ Live /data/vehicles.json has been overwritten from Git-tracked vehicles.json." });
  } else {
    res.status(404).json({ error: "Git-tracked vehicles.json not found." });
  }
});

// ✅ One-time restore: force import rosters from Git-tracked copy
app.get("/force-import-rosters", (req, res) => {
  const ROSTERS_DEFAULT_FILE = path.join(__dirname, "data", "rosters.json");
  if (fs.existsSync(ROSTERS_DEFAULT_FILE)) {
    const defaultRosters = fs.readFileSync(ROSTERS_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(ROSTERS_FILE, defaultRosters);
    res.json({ message: "✅ Live /data/rosters.json has been overwritten from Git-tracked rosters.json." });
  } else {
    res.status(404).json({ error: "Git-tracked rosters.json not found." });
  }
});
console.log("🚨 ROUTE CHECKPOINT 8");
console.log("🚨 ROUTE CHECKPOINT 9");

// GET roster by weekStart
app.get("/rosters/:weekStart", (req, res) => {
  const { weekStart } = req.params;
  const filePath = ROSTERS_FILE;

  try {
    const fileData = fs.readFileSync(filePath);
    const rosters = JSON.parse(fileData);
    const rosterForWeek = rosters[weekStart] || [];
    res.json(rosterForWeek);
  } catch (error) {
    console.error("Error reading rosters:", error);
    res.status(500).json({ error: "Failed to read rosters" });
  }
});
app.patch("/rosters/:weekStart", (req, res) => {
  const { weekStart } = req.params;
  const filePath = ROSTERS_FILE;


  try {
    const fileData = fs.readFileSync(filePath);
    const rosters = JSON.parse(fileData);

    rosters[weekStart] = req.body;

    fs.writeFileSync(filePath, JSON.stringify(rosters, null, 2));
    res.json({ success: true, data: rosters[weekStart] });
  } catch (error) {
    console.error("Error updating roster:", error);
    res.status(500).json({ error: "Failed to update roster" });
  }
});



app.get("/settings", (req, res) => {
  try {
   const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Error reading settings:", err);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.patch("/settings", (req, res) => {
  try {
    const current = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    const updated = { ...current, ...req.body };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (err) {
    console.error("Error writing settings:", err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 10");
console.log("🚨 ROUTE CHECKPOINT 11");


// ==========================
// 👤 Users API (with temp-password + must-change flow)
// ==========================

// ✅ Get all users
app.get("/users", (req, res) => {
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  const users = JSON.parse(raw);
  res.json(users);
});

// ✅ Get user by ID
app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const user = users.find((u) => String(u.id) === String(id));
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

// ✅ Add new user (force first-login password change)
app.post("/users", (req, res) => {
  try {
    const { name, roles = [], description = "", hiddenRoles = [] } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    // Generate a simple temp password (kept plaintext for your current login compatibility)
    const firstName = name.trim().split(/\s+/)[0] || "User";
    const defaultPassword = `${firstName}1`;

    // Optional: temp password expiry (72h)
    const TEMP_PASSWORD_TTL_HOURS = 72;
    const tempPasswordExpires = new Date(Date.now() + TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000).toISOString();

    // Read, append, and persist
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const users = usersRaw ? JSON.parse(usersRaw) : [];

    const newUser = {
      id: Date.now().toString(),
      name: name.trim(),
      roles,
      description,
      hiddenRoles,

      // ⚠️ Storing plaintext for compatibility with your existing login.
      password: defaultPassword,

      // 👇 Flags your /auth/login can read to trigger the "Set New Password" page
      forcePasswordChange: true,
      requiresPasswordReset: true, // legacy alias
      passwordIsTemp: true,        // 👈 explicit temp marker for brand-new default password

      // 🗓️ Helpful metadata (non-breaking)
      tempPasswordExpires,
      passwordUpdatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return res.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        roles: newUser.roles,
        description: newUser.description,
        hiddenRoles: newUser.hiddenRoles,
        forcePasswordChange: newUser.forcePasswordChange,
        requiresPasswordReset: newUser.requiresPasswordReset,
        passwordIsTemp: !!newUser.passwordIsTemp,
        tempPasswordExpires: newUser.tempPasswordExpires,
      },
      tempPassword: defaultPassword, // show once to admin
      message: `User created. Temporary password expires in ${TEMP_PASSWORD_TTL_HOURS} hours.`,
    });
  } catch (err) {
    console.error("Error creating user:", err);
    return res.status(500).json({ message: "Failed to create user" });
  }
});


/**
 * ✅ Generate new temp password for an existing user (admin action)
 * Sets:
 *  - password = <temp>
 *  - forcePasswordChange = true
 *  - requiresPasswordReset = true
 *  - tempPasswordExpires = now + (hours || 72h)
 */
app.post("/users/:id/temp-password", (req, res) => {
  const { id } = req.params;
  const { hours } = req.body || {};
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 72;
  const tempPasswordExpires = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const users = JSON.parse(raw);
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    // Human-friendly temp password (plaintext-compatible): FirstName + 3 digits
    const base = (users[idx].name?.split(/\s+/)[0] || "User").replace(/[^A-Za-z]/g, "") || "User";
    const rand = Math.floor(100 + Math.random() * 900); // 3 digits
    const tempPassword = `${base}${rand}`;

    users[idx] = {
      ...users[idx],
      password: tempPassword,
      forcePasswordChange: true,
      requiresPasswordReset: true,
      passwordIsTemp: true,            // 👈 explicit temp marker for /auth/login
      tempPasswordExpires,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return res.json({
      success: true,
      user: {
        id: users[idx].id,
        name: users[idx].name,
        roles: users[idx].roles,
        forcePasswordChange: users[idx].forcePasswordChange,
        requiresPasswordReset: users[idx].requiresPasswordReset,
        passwordIsTemp: !!users[idx].passwordIsTemp,
        tempPasswordExpires: users[idx].tempPasswordExpires,
      },
      tempPassword, // show once to admin UI
      message: `Temporary password set. Expires in ${ttlHours} hours.`,
    });
  } catch (err) {
    console.error("Failed to set temp password:", err);
    return res.status(500).json({ error: "Failed to set temp password" });
  }
});


/**
 * ✅ User sets a NEW password (self-service from "Set New Password" page)
 * Body: { currentPassword: string, newPassword: string }
 * On success: clears forcePasswordChange/requiresPasswordReset and tempPasswordExpires
 */
app.patch("/users/:id/password", (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body || {};

  if (!newPassword || typeof newPassword !== "string" || !newPassword.trim()) {
    return res.status(400).json({ error: "New password is required" });
  }

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const users = JSON.parse(raw);
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const u = users[idx];

    // Optional: verify current password when provided
    if (typeof currentPassword === "string") {
      if (String(u.password) !== String(currentPassword)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
    }

    // Optional: enforce temp expiry
    if (u.tempPasswordExpires) {
      const now = Date.now();
      const exp = Date.parse(u.tempPasswordExpires);
      if (Number.isFinite(exp) && now > exp) {
        return res.status(410).json({ error: "Temporary password has expired" });
      }
    }

    u.password = newPassword.trim();
    u.forcePasswordChange = false;
    u.requiresPasswordReset = false;
    u.passwordIsTemp = false;          // 👈 clear temp marker
    u.tempPasswordExpires = null;
    u.passwordUpdatedAt = new Date().toISOString();
    u.updatedAt = new Date().toISOString();

    users[idx] = u;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.json({ success: true });
  } catch (err) {
    console.error("Failed to update password:", err);
    return res.status(500).json({ error: "Failed to update password" });
  }
});


// ✅ Patch user (admin edit; safe defaults)
app.patch("/users/:id", (req, res) => {
  const usersPath = path.join(__dirname, "data", "users.json");
  const { id } = req.params;

  try {
    const data = fs.readFileSync(usersPath, "utf-8");
    const users = JSON.parse(data);

    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const body = req.body || {};
    const u = users[idx];

    // Password update (admin-initiated). If you are using this to set a permanent password,
    // we won't override flags unless you explicitly send them in the body.
    if (typeof body.password === "string" && body.password.trim()) {
      u.password = body.password.trim();
      // Do NOT force-clear flags unless specified:
      if (typeof body.forcePasswordChange === "undefined" && typeof body.requiresPasswordReset === "undefined") {
        // leave existing flags as-is
      }
    }

    // Optional profile updates (kept harmless)
    if (Array.isArray(body.roles)) u.roles = body.roles;
    if (typeof body.description === "string") u.description = body.description;
    if (Array.isArray(body.hiddenRoles)) u.hiddenRoles = body.hiddenRoles;

    // Flags: allow explicit control from client
    if (typeof body.forcePasswordChange === "boolean") {
      u.forcePasswordChange = body.forcePasswordChange;
    }
    if (typeof body.requiresPasswordReset === "boolean") {
      u.requiresPasswordReset = body.requiresPasswordReset;
    }

    u.updatedAt = new Date().toISOString();

    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    return res.json({ success: true, user: u });
  } catch (err) {
    console.error("Failed to patch user:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ✅ Delete user
app.delete("/users/:id", (req, res) => {
  const id = req.params.id;
  let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const exists = users.some((u) => String(u.id) === String(id));

  if (!exists) return res.status(404).json({ message: "User not found" });

  users = users.filter((u) => String(u.id) !== String(id));
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ success: true, deletedId: id });
});

console.log("🚨 ROUTE CHECKPOINT 12");
console.log("🚨 ROUTE CHECKPOINT 13");

// ✅ Get all vehicles
app.get("/vehicles", (req, res) => {
  const raw = fs.readFileSync(VEHICLES_FILE, "utf-8");
  const vehicles = JSON.parse(raw);
  res.json(vehicles);
});

// ✅ Add or update vehicle
app.post("/vehicles", (req, res) => {
  const newVehicle = req.body;
  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const existingIndex = vehicles.findIndex((v) => v.id === newVehicle.id);

  if (existingIndex !== -1) {
    vehicles[existingIndex] = { ...vehicles[existingIndex], ...newVehicle };
  } else {
    newVehicle.id = newVehicle.id || Date.now();
    vehicles.push(newVehicle);
  }

  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.status(200).json(newVehicle);
});

// ✅ Patch vehicle
app.patch("/vehicles/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updatedData = req.body;
  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const index = vehicles.findIndex((v) => v.id === id);

  if (index === -1) return res.status(404).json({ message: "Vehicle not found" });

  vehicles[index] = { ...vehicles[index], ...updatedData };
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json(vehicles[index]);
});

// ✅ Delete vehicle
app.delete("/vehicles/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  let vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const index = vehicles.findIndex((v) => v.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Vehicle not found" });
  }

  vehicles.splice(index, 1);
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json({ success: true, deletedId: id });
});
console.log("🚨 ROUTE CHECKPOINT 14");
console.log("🚨 ROUTE CHECKPOINT 15");

// ✅ Get all tickets
// ✅ Get all tickets (file-based version)
app.get("/tickets", (req, res) => {
  try {
    const data = fs.readFileSync(TICKETS_FILE, "utf-8");
    const tickets = JSON.parse(data);
    res.json(tickets);
  } catch (error) {
    console.error("Failed to read tickets:", error);
    res.status(500).json({ error: "Failed to read tickets" });
  }
});

// ✅ Add ticket
app.post("/tickets", async (req, res) => {
  const newTicket = req.body;

  try {
    const raw = fs.readFileSync(TICKETS_FILE, "utf-8");
    const all = JSON.parse(raw);
    all.push(newTicket);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(all, null, 2));

    // Load users
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const allUsers = JSON.parse(usersRaw);

    const getUserByName = (name) =>
      allUsers.find((u) => u.name.toLowerCase() === name?.toLowerCase());

    const recipients = new Set();

    // Add assigned users
    for (const name of newTicket.assignedCamOps || []) {
      const u = getUserByName(name);
      if (u) recipients.add(u);
    }

    const driver = getUserByName(newTicket.assignedDriver);
    if (driver) recipients.add(driver);

    const reporterName = newTicket.assignedReporter?.split(": ")[1];
    const reporter = getUserByName(reporterName);
    if (reporter) recipients.add(reporter);

    // Send push
    if (recipients.size > 0) {
      const title = `🎥 New Ticket: ${newTicket.title}`;
      const message = `You have been assigned to a new request on ${newTicket.date?.split("T")[0]}.`;
      await sendPushToUsers([...recipients], title, message);
    }

    res.status(201).json(newTicket);
  } catch (err) {
    console.error("Failed to create ticket:", err);
    res.status(500).json({ error: "Failed to save ticket" });
  }
});


// ✅ Patch ticket by ID
app.patch("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const updatedFields = req.body;

  try {
    const raw = fs.readFileSync(TICKETS_FILE, "utf-8");
    const allTickets = JSON.parse(raw);
    const ticketIndex = allTickets.findIndex((t) => t.id === id);

    if (ticketIndex === -1) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const oldTicket = allTickets[ticketIndex];
    const newTicket = { ...oldTicket, ...updatedFields };
    allTickets[ticketIndex] = newTicket;
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(allTickets, null, 2));

    // Load all users for FCM targeting
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const allUsers = JSON.parse(usersRaw);

    const getUserByName = (name) =>
      allUsers.find((u) => u.name.toLowerCase() === name.toLowerCase());

    const recipients = new Set();

    // 🔔 1. If cam ops changed
    if (
      JSON.stringify(oldTicket.assignedCamOps || []) !==
      JSON.stringify(newTicket.assignedCamOps || [])
    ) {
      for (const name of newTicket.assignedCamOps || []) {
        const u = getUserByName(name);
        if (u) recipients.add(u);
      }
    }

    // 🔔 2. If driver assigned
    if (oldTicket.assignedDriver !== newTicket.assignedDriver) {
      const u = getUserByName(newTicket.assignedDriver);
      if (u) recipients.add(u);
    }

    // 🔔 3. If reporter assigned
    if (oldTicket.assignedReporter !== newTicket.assignedReporter) {
      const u = getUserByName(newTicket.assignedReporter?.split(": ")[1]);
      if (u) recipients.add(u);
    }

    // 🔔 4. Vehicle added
    if (!oldTicket.vehicle && newTicket.vehicle) {
      for (const name of [
        ...newTicket.assignedCamOps || [],
        newTicket.assignedDriver,
        newTicket.assignedReporter?.split(": ")[1]
      ]) {
        const u = getUserByName(name);
        if (u) recipients.add(u);
      }
    }

    // 🔔 5. Key fields changed (location, time, note, status back from Cancelled)
    const importantFields = ["location", "filmingTime", "departureTime", "status", "notes"];
    const fieldChanged = importantFields.some(
      (f) => JSON.stringify(oldTicket[f]) !== JSON.stringify(newTicket[f])
    );

    if (fieldChanged) {
      for (const name of [
        ...newTicket.assignedCamOps || [],
        newTicket.assignedDriver,
        newTicket.assignedReporter?.split(": ")[1]
      ]) {
        const u = getUserByName(name);
        if (u) recipients.add(u);
      }
    }

    // Send notification
    if (recipients.size > 0) {
      const title = `Ticket Updated: ${newTicket.title}`;
      const message = `One or more updates were made. Check filming, location, or assignment changes.`;
      await sendPushToUsers([...recipients], title, message);
    }

    res.json({ success: true, ticket: newTicket });
  } catch (err) {
    console.error("Error updating ticket:", err);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});


// ✅ Delete ticket
app.delete("/tickets/:id", (req, res) => {
  try {
    const id = req.params.id;
    let tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
    const index = tickets.findIndex((t) => String(t.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    tickets.splice(index, 1);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
    res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("Failed to delete ticket:", error);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 16");
console.log("🚨 ROUTE CHECKPOINT 17");

// ✅ Development tool: seed vehicles
app.get("/seed-vehicles", (req, res) => {
  const vehicles = [
    {
      id: 101,
      name: "Broadcast Van 1",
      status: "Available",
      notes: "Cleaned and fueled",
      insuranceExpiry: "2025-09-01",
      patentExpiry: "2025-12-01"
    },
    {
      id: 102,
      name: "Field Unit Car",
      status: "In Garage",
      notes: "Issue Reported",
      insuranceExpiry: "2025-10-15",
      patentExpiry: "2026-01-01"
    }
  ];
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json({ message: "🚐 Vehicles seeded!" });
});

// ==== Push auth + route (conflict-free) ====
// ==== /send-push route (reuses top auth + getAccessToken) ====
app.post("/send-push", async (req, res) => {
  const { token, tokens, title, body, data } = req.body || {};

  // Accept single token or array
  const list = Array.isArray(tokens) ? tokens.filter(Boolean) : token ? [token] : [];
  if (!list.length) return res.status(400).json({ error: "Missing 'token' or 'tokens' array" });
  if (!title || !body) return res.status(400).json({ error: "Missing 'title' or 'body'" });

  try {
    const accessToken = await getAccessToken(); // <-- uses the top helper
    const endpoint = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`; // <-- uses top PROJECT_ID
    const results = [];

    for (const t of list) {
      const payload = {
        message: {
          token: t,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data || {}).map(([k, v]) => [String(k), String(v)])
          ),
          webpush: {
            headers: { Urgency: "high" },
            notification: { icon: "/icon.png" },
          },
        },
      };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await resp.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      results.push({ token: t, status: resp.status, ok: resp.ok, body: json });
    }

    const failures = results.filter((r) => !r.ok);
    if (failures.length) {
      return res.status(207).json({
        successCount: results.length - failures.length,
        failureCount: failures.length,
        results,
      });
    }

    return res.json({ successCount: results.length, failureCount: 0, results });
  } catch (err) {
    console.error("❌ Failed to send push:", err);
    return res
      .status(500)
      .json({ error: "Failed to send push notification", details: String(err) });
  }
});

console.log("🚨 ROUTE CHECKPOINT 18");
console.log("🚨 ROUTE CHECKPOINT 19");

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// ✅ Start server on LAN
// ✅ Start HTTPS server on LAN
// ✅ Serve Vite production build
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Fallback to index.html for frontend routes (React SPA)
app.use((req, res, next) => {
  const knownPrefixes = [
  "/api",
  "/auth",               // ✅ whitelist auth API so SPA fallback never captures it
  "/users",
  "/tickets",
  "/vehicles",
  "/rosters",
  "/seed-vehicles",
  "/notification-groups",
  "/notifications"
];


  if (knownPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    return next(); // Let Express handle these API routes
  }

  res.sendFile(path.join(distPath, "index.html"));
});

console.log("🚨 ROUTE CHECKPOINT 20");
console.log("🚨 ROUTE CHECKPOINT 21");


// ✅ Start server on Render or LAN
try {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Backend server is running at http://0.0.0.0:${PORT}`);
  });
} catch (err) {
  console.error("🔥 Express server failed to start:", err.stack || err.message || err);
}

console.log("🚨 ROUTE CHECKPOINT 22");








