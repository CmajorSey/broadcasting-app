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
import userPrefsRouter from "./routes/user-prefs.js";
import holidaysRouter from "./routes/holidays.js"; // NEW


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

// ✅ Persistent storage root
// - On Render: use /data (persistent disk)
// - Local dev: use ./data inside the repo (so your existing JSON files load)
const DATA_DIR =
  process.env.DATA_DIR ||
  ((process.env.RENDER || process.env.ON_RENDER) ? "/data" : path.join(__dirname, "data"));

console.log("💾 DATA_DIR:", DATA_DIR, "— (env wins; Render => /data, Local => ./data)");

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const app = express();
const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://192.168.88.54:5173", // ✅ Your LAN frontend
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
app.use("/user-prefs", userPrefsRouter);
app.use("/holidays", holidaysRouter); // NEW

const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");
const ROSTERS_FILE = path.join(DATA_DIR, "rosters.json");
const PASSWORD_RESET_REQUESTS_FILE = path.join(DATA_DIR, "passwordResetRequests.json");
const groupsPath = path.join(DATA_DIR, "notificationGroups.json");


// 🔧 Ensure data directory and files exist
// 🔧 Ensure data directory and files exist (all under /data)
fs.mkdirSync(DATA_DIR, { recursive: true });

// Core app stores
if (!fs.existsSync(ROSTERS_FILE)) {
  fs.writeFileSync(ROSTERS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(VEHICLES_FILE)) {
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(TICKETS_FILE)) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify([], null, 2));
}

// Users: seed from Git-tracked default once if needed
const USERS_DEFAULT_FILE = path.join(__dirname, "data", "users.json");
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsers = fs.existsSync(USERS_DEFAULT_FILE)
    ? fs.readFileSync(USERS_DEFAULT_FILE, "utf-8")
    : "[]";
  fs.writeFileSync(USERS_FILE, defaultUsers);
}

// Settings default
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ siteName: "Byenveni Lo Board" }, null, 2)
  );
}

// Password reset requests
if (!fs.existsSync(PASSWORD_RESET_REQUESTS_FILE)) {
  fs.writeFileSync(PASSWORD_RESET_REQUESTS_FILE, JSON.stringify([], null, 2));
}

// Notifications + Groups + Suggestions (ensure they exist on disk)
const NOTIFS_FILE = path.join(DATA_DIR, "notifications.json");
if (!fs.existsSync(NOTIFS_FILE)) {
  fs.writeFileSync(NOTIFS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(groupsPath)) {
  fs.writeFileSync(groupsPath, JSON.stringify([], null, 2));
}

// ✅ New: Suggestions store
const SUGGESTIONS_FILE = path.join(DATA_DIR, "suggestions.json");
if (!fs.existsSync(SUGGESTIONS_FILE)) {
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify([], null, 2));
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
// ✅ Notifications API (edit, delete-one, clear-all, and polling support) + Suggestions API
(() => {
  // ---------------------------
  // Notifications (existing)
  // ---------------------------
  const notificationsPath = path.join(DATA_DIR, "notifications.json");

  const ensureFile = (p, fallback = "[]") => {
    if (!fs.existsSync(p)) fs.writeFileSync(p, fallback);
  };

  const readJsonArray = (p) => {
    ensureFile(p);
    const raw = fs.readFileSync(p, "utf-8");
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeJsonArray = (p, arr) => {
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  };

    // Normalize ISO to second precision (treat bare "YYYY-MM-DDTHH:MM:SS" as UTC)
  const isoSec = (dateish) => {
    try {
      if (!dateish) return null;
      const s = String(dateish);
      // If there's no timezone info, assume UTC instead of local time
      const needsZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s);
      const d = new Date(needsZ ? s + "Z" : s);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString().split(".")[0];
    } catch {
      return null;
    }
  };


  // ✉️ POST /notifications — create new notification
  app.post("/notifications", (req, res) => {
    try {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const message = String(body.message || "").trim();
      const recipients = Array.isArray(body.recipients)
        ? Array.from(new Set(body.recipients.filter(Boolean).map(String)))
        : [];
      const createdAt = body.createdAt && !Number.isNaN(new Date(body.createdAt))
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString();

      if (!title || !message || recipients.length === 0) {
        return res.status(400).json({ error: "Missing title, message, or recipients" });
      }

      const all = readJsonArray(notificationsPath);
      const newNotification = {
        title,
        message,
        recipients,
        timestamp: createdAt,
      };

      // Optional passthrough metadata (kept from your previous PATCH allowlist)
      for (const k of ["kind", "action", "displayRecipients", "status"]) {
        if (k in body) newNotification[k] = body[k];
      }

      all.push(newNotification);
      writeJsonArray(notificationsPath, all);

      return res.status(201).json(newNotification);
    } catch (err) {
      console.error("Failed to create notification:", err);
      res.status(500).json({ error: "Could not create notification" });
    }
  });

  // 🧭 GET /notifications  (polling supported via ?after=<ISO>)
  app.get("/notifications", (req, res) => {
    try {
      const all = readJsonArray(notificationsPath);
      const { after } = req.query || {};
      if (after) {
        const a = isoSec(after);
        if (!a) return res.status(400).json({ error: "Invalid 'after' timestamp" });
        const filtered = all.filter((n) => {
          const t = isoSec(n?.timestamp);
          return t && t > a;
        });
        return res.json(filtered);
      }
      return res.json(all);
    } catch (err) {
      console.error("Failed to read notifications:", err);
      res.status(500).json({ error: "Could not read notifications" });
    }
  });

  // ✏️ PATCH /notifications/:timestamp
  app.patch("/notifications/:timestamp", (req, res) => {
    try {
      const encoded = req.params.timestamp;
      const decoded = decodeURIComponent(encoded);
      const targetKey = isoSec(decoded);
      if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

      const all = readJsonArray(notificationsPath);
      const idx = all.findIndex((n) => isoSec(n?.timestamp) === targetKey);
      if (idx === -1) return res.status(404).json({ error: "Notification not found" });

      const body = req.body || {};
      const allowed = ["title", "message", "recipients", "kind", "action", "displayRecipients", "status"];
      const current = all[idx];

      const updated = { ...current };
      for (const key of allowed) {
        if (key in body) updated[key] = body[key];
      }

      all[idx] = updated;
      writeJsonArray(notificationsPath, all);

      return res.json({ success: true, notification: updated });
    } catch (err) {
      console.error("Failed to patch notification:", err);
      res.status(500).json({ error: "Could not patch notification" });
    }
  });

  // 🗑️ DELETE /notifications/:timestamp  (delete one)
  app.delete("/notifications/:timestamp", (req, res) => {
    try {
      const encoded = req.params.timestamp;
      const decoded = decodeURIComponent(encoded);
      const targetKey = isoSec(decoded);
      if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

      const all = readJsonArray(notificationsPath);
      const updated = all.filter((n) => isoSec(n?.timestamp) !== targetKey);
      writeJsonArray(notificationsPath, updated);

      console.log("🗑 Deleted notification:", decoded);
      return res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete notification:", err);
      res.status(500).json({ error: "Could not delete notification" });
    }
  });

  // 🧹 DELETE /notifications  (clear all, or clear olderThan=<ISO>)
  app.delete("/notifications", (req, res) => {
    try {
      const { olderThan } = req.query || {};
      const all = readJsonArray(notificationsPath);

      if (olderThan) {
        const cutoff = isoSec(olderThan);
        if (!cutoff) return res.status(400).json({ error: "Invalid 'olderThan' timestamp" });
        const kept = all.filter((n) => {
          const t = isoSec(n?.timestamp);
          return t && t >= cutoff;
        });
        writeJsonArray(notificationsPath, kept);
        return res.json({ success: true, removed: all.length - kept.length, kept: kept.length });
      }

      writeJsonArray(notificationsPath, []);
      return res.json({ success: true, removed: all.length, kept: 0 });
    } catch (err) {
      console.error("Failed to clear notifications:", err);
      res.status(500).json({ error: "Could not clear notifications" });
    }
  });

    // ---------------------------
  // ✅ Suggestions (robust: legacy migration + id/timestamp addressing)
  // ---------------------------
  const suggestionsPath =
    typeof SUGGESTIONS_FILE === "string" ? SUGGESTIONS_FILE : path.join(DATA_DIR, "suggestions.json");

  // Migrate legacy entries:
  // - ensure createdAt from timestamp
  // - ensure userName from name
  // - derive status from archived
  // - ensure id (prefer ts:<isoSec(createdAt)>)
  const migrateSuggestions = () => {
    const arr = readJsonArray(suggestionsPath);
    let changed = false;

    const out = arr.map((s, idx) => {
      const x = { ...s };

      if (!x.createdAt && x.timestamp) x.createdAt = x.timestamp;
      if (!x.userName && x.name) x.userName = x.name;
      if (typeof x.status === "undefined" && typeof x.archived === "boolean") {
        x.status = x.archived ? "archived" : "new";
      }

      if (!x.id) {
        const key = isoSec(x.createdAt || x.timestamp);
        x.id = key ? `ts:${key}` : `legacy-${Date.now()}-${idx}`;
        changed = true;
      }

      return x;
    });

    if (changed) writeJsonArray(suggestionsPath, out);
    return out;
  };

  // Find by exact id OR by ISO-to-seconds timestamp (createdAt or legacy timestamp)
  const findSuggestionIndex = (all, key) => {
    const str = String(key || "");
    const iso = isoSec(str);

    let idx = all.findIndex((s) => String(s.id) === str);
    if (idx !== -1) return idx;

    if (iso) {
      idx = all.findIndex(
        (s) => isoSec(s.createdAt) === iso || isoSec(s.timestamp) === iso
      );
      if (idx !== -1) return idx;
    }

    return -1;
  };

  // ✍️ POST /suggestions — create (supports legacy client keys)
  app.post("/suggestions", async (req, res) => {
    try {
      const body = req.body || {};
      const userId = body.userId ? String(body.userId) : null;
      const userName = String(body.userName || body.name || "Unknown").trim();
      const section = String(body.section || body.department || "General").trim();
      const message = String(body.message || body.suggestion || body.text || "").trim();
      const createdAtRaw = body.createdAt || body.timestamp;

      if (!message) {
        return res.status(400).json({ error: "Suggestion 'message' is required" });
      }

      const all = migrateSuggestions();
      const createdAt = createdAtRaw && !Number.isNaN(new Date(createdAtRaw))
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

      // Prefer deterministic id from timestamp seconds; ensure uniqueness
      const baseId = `ts:${isoSec(createdAt)}`;
      const uniqueId =
        all.some((s) => s.id === baseId)
          ? `${baseId}-${Math.random().toString(36).slice(2, 6)}`
          : baseId;

      const entry = {
        id: uniqueId,
        userId,
        userName,
        section,
        message,
        createdAt,
        status: "new",
      };

      all.push(entry);
      writeJsonArray(suggestionsPath, all);
      console.log("💡 Suggestion saved:", { id: entry.id, userName: entry.userName, section: entry.section });

      // 🔔 Optional: notify admins (FCM + in-app)
      try {
        const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
        const allUsers = JSON.parse(usersRaw || "[]");
        const admins = allUsers.filter((u) => Array.isArray(u.roles) && u.roles.includes("admin"));

        // Push
        try {
          const title = "💡 New User Suggestion";
          const bodyText = `${entry.userName}: ${entry.message.slice(0, 80)}${entry.message.length > 80 ? "…" : ""}`;
          await sendPushToUsers(admins, title, bodyText);
        } catch (pushErr) {
          console.warn("Push for suggestion failed (non-fatal):", pushErr);
        }

        // In-app notification
        try {
          const notifs = readJsonArray(notificationsPath);
          const recipients = Array.from(new Set([
            ...admins.map((a) => String(a.id)).filter(Boolean),
            ...admins.map((a) => String(a.name || "")).filter(Boolean),
            "admin",
            "admins",
            "ALL",
          ]));

          notifs.push({
            title: "💡 New User Suggestion",
            message: `${entry.userName} sent a suggestion in ${entry.section}.`,
            recipients,
            timestamp: new Date().toISOString(),
            kind: "user_suggestion",
            displayRecipients: ["Admins"],
            action: {
              type: "open_suggestions",
              id: entry.id,
              url: "/admin?tab=notifications#suggestions"
            },
          });
          writeJsonArray(notificationsPath, notifs);
        } catch (notifErr) {
          console.warn("In-app notification for suggestion failed (non-fatal):", notifErr);
        }
      } catch (whoErr) {
        console.warn("Admin targeting for suggestion failed (non-fatal):", whoErr);
      }

      return res.status(201).json(entry);
    } catch (err) {
      console.error("Failed to create suggestion:", err);
      res.status(500).json({ error: "Could not submit suggestion" });
    }
  });

  // 📥 GET /suggestions — list (migrates legacy on read)
  app.get("/suggestions", (req, res) => {
    try {
      const all = migrateSuggestions();
      const { status, section } = req.query || {};

      let out = all;
      if (status) {
        const s = String(status).toLowerCase();
        out = out.filter((x) => String(x.status || "new").toLowerCase() === s);
      }
      if (section) {
        const sec = String(section).toLowerCase();
        out = out.filter((x) => String(x.section || "general").toLowerCase() === sec);
      }

      out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      console.log("📤 GET /suggestions ->", out.length, "item(s)");
      return res.json(out);
    } catch (err) {
      console.error("Failed to read suggestions:", err);
      res.status(500).json({ error: "Could not read suggestions" });
    }
  });

  // ✏️ PATCH /suggestions/:idOrTimestamp — update status/response
  app.patch("/suggestions/:id", (req, res) => {
    try {
      const key = req.params.id;
      const body = req.body || {}; // { status?, response? }

      const all = migrateSuggestions();
      const idx = findSuggestionIndex(all, key);
      if (idx === -1) return res.status(404).json({ error: "Suggestion not found" });

      const validStatuses = new Set(["new", "reviewed", "responded", "archived"]);
      if (typeof body.status === "string" && validStatuses.has(body.status)) {
        all[idx].status = body.status;
      }
      if (typeof body.response === "string") {
        all[idx].response = body.response;
        all[idx].respondedAt = new Date().toISOString();
        if (!body.status) all[idx].status = "responded";
      }

      writeJsonArray(suggestionsPath, all);
      return res.json({ success: true, suggestion: all[idx] });
    } catch (err) {
      console.error("Failed to patch suggestion:", err);
      res.status(500).json({ error: "Could not update suggestion" });
    }
  });

  // 🗑️ DELETE /suggestions/:idOrTimestamp — remove
  app.delete("/suggestions/:id", (req, res) => {
    try {
      const key = req.params.id;
      const all = migrateSuggestions();
      const idx = findSuggestionIndex(all, key);
      if (idx === -1) return res.status(404).json({ error: "Suggestion not found" });

      const next = all.slice(0, idx).concat(all.slice(idx + 1));
      writeJsonArray(suggestionsPath, next);
      return res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete suggestion:", err);
      res.status(500).json({ error: "Could not delete suggestion" });
    }
  });

  // ✍️ POST /suggestions — user submits a suggestion (with legacy key support)
  app.post("/suggestions", async (req, res) => {
    try {
      const body = req.body || {};
      const userId = body.userId ? String(body.userId) : null;
      const userName = String(body.userName || body.name || "Unknown").trim();
      const section = String(body.section || body.department || "General").trim();
      const message = String(body.message || body.suggestion || body.text || "").trim();
      const createdAtRaw = body.createdAt || body.timestamp;

      if (!message) {
        return res.status(400).json({ error: "Suggestion 'message' is required" });
      }

      const all = readJsonArray(suggestionsPath);
      const entry = {
        id: Date.now().toString(),
        userId,
        userName,
        section,
        message,
        createdAt: createdAtRaw && !Number.isNaN(new Date(createdAtRaw)) ? new Date(createdAtRaw).toISOString() : new Date().toISOString(),
        status: "new",
      };

      all.push(entry);
      writeJsonArray(suggestionsPath, all);
      console.log("💡 Suggestion saved:", { id: entry.id, userName: entry.userName, section: entry.section });

      // 🔔 Optional: notify admins (FCM + in-app)
      try {
        const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
        const allUsers = JSON.parse(usersRaw || "[]");
        const admins = allUsers.filter((u) => Array.isArray(u.roles) && u.roles.includes("admin"));

        // Push
        try {
          const title = "💡 New User Suggestion";
          const bodyText = `${entry.userName}: ${entry.message.slice(0, 80)}${entry.message.length > 80 ? "…" : ""}`;
          await sendPushToUsers(admins, title, bodyText);
        } catch (pushErr) {
          console.warn("Push for suggestion failed (non-fatal):", pushErr);
        }

        // In-app notification
        try {
          const notifs = readJsonArray(notificationsPath);
          const recipients = Array.from(new Set([
            ...admins.map((a) => String(a.id)).filter(Boolean),
            ...admins.map((a) => String(a.name || "")).filter(Boolean),
            "admin",
            "admins",
            "ALL",
          ]));

          notifs.push({
            title: "💡 New User Suggestion",
            message: `${entry.userName} sent a suggestion in ${entry.section}.`,
            recipients,
            timestamp: new Date().toISOString(),
            kind: "user_suggestion",
            displayRecipients: ["Admins"],
            action: {
              type: "open_suggestions",
              id: entry.id,
              url: "/admin?tab=notifications#suggestions"
            },
          });
          writeJsonArray(notificationsPath, notifs);
        } catch (notifErr) {
          console.warn("In-app notification for suggestion failed (non-fatal):", notifErr);
        }
      } catch (whoErr) {
        console.warn("Admin targeting for suggestion failed (non-fatal):", whoErr);
      }

      return res.status(201).json(entry);
    } catch (err) {
      console.error("Failed to create suggestion:", err);
      res.status(500).json({ error: "Could not submit suggestion" });
    }
  });

  // 📥 GET /suggestions — list (with legacy normalization + optional filters)
  app.get("/suggestions", (req, res) => {
    try {
      const rawArr = readJsonArray(suggestionsPath);

      // normalize legacy items (without mutating disk)
      const normArr = rawArr.map((x) => {
        const out = { ...x };
        if (!out.createdAt && out.timestamp) out.createdAt = out.timestamp;
        if (!out.userName && out.name) out.userName = out.name;
        if (typeof out.status === "undefined" && typeof out.archived === "boolean") {
          out.status = out.archived ? "archived" : "new";
        }
        return out;
      });

      const { status, section } = req.query || {};
      let out = normArr;

      if (status) {
        const s = String(status).toLowerCase();
        out = out.filter((x) => String(x.status || "new").toLowerCase() === s);
      }
      if (section) {
        const sec = String(section).toLowerCase();
        out = out.filter((x) => String(x.section || "general").toLowerCase() === sec);
      }

      out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      console.log("📤 GET /suggestions ->", out.length, "item(s)");
      return res.json(out);
    } catch (err) {
      console.error("Failed to read suggestions:", err);
      res.status(500).json({ error: "Could not read suggestions" });
    }
  });

  // ✏️ PATCH /suggestions/:id — update status/response
  app.patch("/suggestions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body || {}; // { status?, response? }

      const all = readJsonArray(suggestionsPath);
      const idx = all.findIndex((s) => String(s.id) === String(id));
      if (idx === -1) return res.status(404).json({ error: "Suggestion not found" });

      const validStatuses = new Set(["new", "reviewed", "responded", "archived"]);
      if (typeof body.status === "string" && validStatuses.has(body.status)) {
        all[idx].status = body.status;
      }
      if (typeof body.response === "string") {
        all[idx].response = body.response;
        all[idx].respondedAt = new Date().toISOString();
        if (!body.status) all[idx].status = "responded";
      }

      writeJsonArray(suggestionsPath, all);
      return res.json({ success: true, suggestion: all[idx] });
    } catch (err) {
      console.error("Failed to patch suggestion:", err);
      res.status(500).json({ error: "Could not update suggestion" });
    }
  });

  // 🗑️ DELETE /suggestions/:id — remove
  app.delete("/suggestions/:id", (req, res) => {
    try {
      const { id } = req.params;
      const all = readJsonArray(suggestionsPath);
      const next = all.filter((s) => String(s.id) !== String(id));
      writeJsonArray(suggestionsPath, next);
      return res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete suggestion:", err);
      res.status(500).json({ error: "Could not delete suggestion" });
    }
  });
})();


  const notificationsPath = path.join(DATA_DIR, "notifications.json");

  const ensureFile = () => {
    if (!fs.existsSync(notificationsPath)) {
      fs.writeFileSync(notificationsPath, JSON.stringify([], null, 2));
    }
  };

  const readNotifs = () => {
    ensureFile();
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeNotifs = (arr) => {
    fs.writeFileSync(notificationsPath, JSON.stringify(arr, null, 2));
  };

  // Normalize ISO to second precision for stable compare (avoids ms drift)
  const isoSec = (dateish) => {
    try {
      return new Date(dateish).toISOString().split(".")[0];
    } catch {
      return null;
    }
  };

  // ✉️ POST /notifications — create new notification
  app.post("/notifications", (req, res) => {
    try {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const message = String(body.message || "").trim();
      const recipients = Array.isArray(body.recipients)
        ? Array.from(new Set(body.recipients.filter(Boolean).map(String)))
        : [];
      const createdAt = body.createdAt && !Number.isNaN(new Date(body.createdAt))
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString();

      if (!title || !message || recipients.length === 0) {
        return res.status(400).json({ error: "Missing title, message, or recipients" });
      }

      const all = readNotifs();
      const newNotification = {
        title,
        message,
        recipients,
        timestamp: createdAt,
      };

      all.push(newNotification);
      writeNotifs(all);

      return res.status(201).json(newNotification);
    } catch (err) {
      console.error("Failed to create notification:", err);
      res.status(500).json({ error: "Could not create notification" });
    }
  });

  // 🧭 GET /notifications  (polling supported via ?after=<ISO>)
  app.get("/notifications", (req, res) => {
    try {
      const all = readNotifs();
      const { after } = req.query || {};
      if (after) {
        const a = isoSec(after);
        if (!a) return res.status(400).json({ error: "Invalid 'after' timestamp" });
        const filtered = all.filter((n) => {
          const t = isoSec(n?.timestamp);
          return t && t > a;
        });
        return res.json(filtered);
      }
      return res.json(all);
    } catch (err) {
      console.error("Failed to read notifications:", err);
      res.status(500).json({ error: "Could not read notifications" });
    }
  });

  // ✏️ PATCH /notifications/:timestamp
  app.patch("/notifications/:timestamp", (req, res) => {
    try {
      const encoded = req.params.timestamp;
      const decoded = decodeURIComponent(encoded);
      const targetKey = isoSec(decoded);
      if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

      const all = readNotifs();
      const idx = all.findIndex((n) => isoSec(n?.timestamp) === targetKey);
      if (idx === -1) return res.status(404).json({ error: "Notification not found" });

      const body = req.body || {};
      const allowed = ["title", "message", "recipients", "kind", "action", "displayRecipients", "status"];
      const current = all[idx];

      const updated = { ...current };
      for (const key of allowed) {
        if (key in body) updated[key] = body[key];
      }

      all[idx] = updated;
      writeNotifs(all);

      return res.json({ success: true, notification: updated });
    } catch (err) {
      console.error("Failed to patch notification:", err);
      res.status(500).json({ error: "Could not patch notification" });
    }
  });

  // 🗑️ DELETE /notifications/:timestamp  (delete one)
  app.delete("/notifications/:timestamp", (req, res) => {
    try {
      const encoded = req.params.timestamp;
      const decoded = decodeURIComponent(encoded);
      const targetKey = isoSec(decoded);
      if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

      const all = readNotifs();
      const updated = all.filter((n) => isoSec(n?.timestamp) !== targetKey);
      writeNotifs(updated);

      console.log("🗑 Deleted notification:", decoded);
      return res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete notification:", err);
      res.status(500).json({ error: "Could not delete notification" });
    }
  });

  // 🧹 DELETE /notifications  (clear all, or clear olderThan=<ISO>)
  app.delete("/notifications", (req, res) => {
    try {
      const { olderThan } = req.query || {};
      const all = readNotifs();

      if (olderThan) {
        const cutoff = isoSec(olderThan);
        if (!cutoff) return res.status(400).json({ error: "Invalid 'olderThan' timestamp" });
        const kept = all.filter((n) => {
          const t = isoSec(n?.timestamp);
          return t && t >= cutoff;
        });
        writeNotifs(kept);
        return res.json({ success: true, removed: all.length - kept.length, kept: kept.length });
      }

      writeNotifs([]);
      return res.json({ success: true, removed: all.length, kept: 0 });
    } catch (err) {
      console.error("Failed to clear notifications:", err);
      res.status(500).json({ error: "Could not clear notifications" });
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
      const notificationsPath = path.join(DATA_DIR, "notifications.json");
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
    return res.json({ message: "✅ Live /data/vehicles.json has been overwritten from Git-tracked vehicles.json." });
  }
  return res.status(404).json({ error: "Git-tracked vehicles.json not found." });
});

// ✅ One-time restore: force import rosters from Git-tracked copy
app.get("/force-import-rosters", (req, res) => {
  const ROSTERS_DEFAULT_FILE = path.join(__dirname, "data", "rosters.json");
  if (fs.existsSync(ROSTERS_DEFAULT_FILE)) {
    const defaultRosters = fs.readFileSync(ROSTERS_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(ROSTERS_FILE, defaultRosters);
    return res.json({ message: "✅ Live /data/rosters.json has been overwritten from Git-tracked rosters.json." });
  }
  return res.status(404).json({ error: "Git-tracked rosters.json not found." });
});

// ✅ One-time restore: force import notification groups from Git-tracked copy
app.get("/force-import-groups", (req, res) => {
  const GROUPS_DEFAULT_FILE = path.join(__dirname, "data", "notificationGroups.json");
  const GROUPS_LIVE_FILE = path.join(DATA_DIR, "notificationGroups.json");
  if (fs.existsSync(GROUPS_DEFAULT_FILE)) {
    const defaultGroups = fs.readFileSync(GROUPS_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(GROUPS_LIVE_FILE, defaultGroups);
    return res.json({ message: "✅ Live /data/notificationGroups.json has been overwritten from Git-tracked notificationGroups.json." });
  }
  return res.status(404).json({ error: "Git-tracked notificationGroups.json not found." });
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
// [A] START: Users API (new, with last-login route)
// ==========================
// 👤 Users API (with temp-password + must-change flow) + normalized read helpers
// ==========================

// Helper: read users safely and ensure every user has a stable string id
function readUsersSafe() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    const users = Array.isArray(arr) ? arr : [];

    let changed = false;
    const seen = new Set();

    users.forEach((u, idx) => {
      // Ensure id exists and is a string
      if (!u?.id) {
        u.id = `${Date.now()}-${idx}-${Math.floor(Math.random() * 100000)}`;
        changed = true;
      }
      u.id = String(u.id);

      // Avoid duplicates (very rare but safe to guard)
      if (seen.has(u.id)) {
        u.id = `${u.id}-${idx}`;
        changed = true;
      }
      seen.add(u.id);
    });

    if (changed) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      console.log("🛠 Fixed missing/duplicate user IDs in users.json");
    }

    return users;
  } catch (e) {
    console.error("readUsersSafe error:", e);
    return [];
  }
}

// ✅ New: combobox-friendly minimal list (string IDs)
app.get("/users-brief", (req, res) => {
  const users = readUsersSafe();
  const brief = users.map(u => ({
    id: String(u.id),
    name: String(u.name || ""),
    roles: Array.isArray(u.roles) ? u.roles : [],
    description: typeof u.description === "string" ? u.description : "",
  }));
  res.json(brief);
});

// ✅ New: options for MultiSelectCombobox (value/label strings)
app.get("/users/options", (req, res) => {
  const users = readUsersSafe();
  const options = users.map(u => ({
    value: String(u.id),
    label: String(u.name || ""),
    roles: Array.isArray(u.roles) ? u.roles : [],
    description: typeof u.description === "string" ? u.description : "",
  }));
  res.json(options);
});

// ✅ Get all users (unchanged)
app.get("/users", (req, res) => {
  const users = readUsersSafe();
  res.json(users);
});

// ✅ Get user by ID (unchanged)
app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  const users = readUsersSafe();
  const user = users.find((u) => String(u.id) === String(id));
  if (user) return res.json(user);
  return res.status(404).json({ message: "User not found" });
});

// ✅ Add new user (unchanged)
app.post("/users", (req, res) => {
  try {
    const { name, roles = [], description = "", hiddenRoles = [] } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    const firstName = name.trim().split(/\s+/)[0] || "User";
    const defaultPassword = `${firstName}1`;

    const TEMP_PASSWORD_TTL_HOURS = 72;
    const tempPasswordExpires = new Date(Date.now() + TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000).toISOString();

    const users = readUsersSafe();

    const newUser = {
      id: Date.now().toString(),
      name: name.trim(),
      roles,
      description,
      hiddenRoles,

      password: defaultPassword,

      forcePasswordChange: true,
      requiresPasswordReset: true,
      passwordIsTemp: true,

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
      tempPassword: defaultPassword,
      message: `User created. Temporary password expires in ${TEMP_PASSWORD_TTL_HOURS} hours.`,
    });
  } catch (err) {
    console.error("Error creating user:", err);
    return res.status(500).json({ message: "Failed to create user" });
  }
});

/**
 * ✅ Generate new temp password for an existing user (admin action)
 */
app.post("/users/:id/temp-password", (req, res) => {
  const { id } = req.params;
  const { hours } = req.body || {};
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 72;
  const tempPasswordExpires = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  try {
    const users = readUsersSafe();
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const base = (users[idx].name?.split(/\s+/)[0] || "User").replace(/[^A-Za-z]/g, "") || "User";
    const rand = Math.floor(100 + Math.random() * 900);
    const tempPassword = `${base}${rand}`;

    users[idx] = {
      ...users[idx],
      password: tempPassword,
      forcePasswordChange: true,
      requiresPasswordReset: true,
      passwordIsTemp: true,
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
      tempPassword,
      message: `Temporary password set. Expires in ${ttlHours} hours.`,
    });
  } catch (err) {
    console.error("Failed to set temp password:", err);
    return res.status(500).json({ error: "Failed to set temp password" });
  }
});

/**
 * ✅ User sets a NEW password (self-service)
 */
app.patch("/users/:id/password", (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body || {};

  if (!newPassword || typeof newPassword !== "string" || !newPassword.trim()) {
    return res.status(400).json({ error: "New password is required" });
  }

  try {
    const users = readUsersSafe();
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const u = users[idx];

    if (typeof currentPassword === "string") {
      if (String(u.password) !== String(currentPassword)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
    }

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
    u.passwordIsTemp = false;
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

// ✅ Patch user (admin edit + leave balances; server clamps annualLeave to 0–42 and returns RAW user)
//    Also accepts an optional ISO string "lastOnline" (safely normalized) for completeness.
app.patch("/users/:id", (req, res) => {
  const { id } = req.params;

  const toInt = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fb;
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  try {
    const data = fs.readFileSync(USERS_FILE, "utf-8");
    const users = JSON.parse(data);

    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const body = req.body || {};
    const u = users[idx];

    // Password flow
    if (typeof body.password === "string" && body.password.trim()) {
      u.password = body.password.trim();
      if (typeof body.forcePasswordChange !== "undefined") {
        u.forcePasswordChange = !!body.forcePasswordChange;
      }
      if (typeof body.requiresPasswordReset !== "undefined") {
        u.requiresPasswordReset = !!body.requiresPasswordReset;
      }
    }

    // Admin-editable meta
    if (Array.isArray(body.roles)) u.roles = body.roles;
    if (typeof body.description === "string") u.description = body.description;
    if (Array.isArray(body.hiddenRoles)) u.hiddenRoles = body.hiddenRoles;
    if (typeof body.forcePasswordChange === "boolean") u.forcePasswordChange = body.forcePasswordChange;
    if (typeof body.requiresPasswordReset === "boolean") u.requiresPasswordReset = body.requiresPasswordReset;

    // 🔁 Leave management fields
    if (typeof body.annualLeave !== "undefined") {
      u.annualLeave = clamp(toInt(body.annualLeave, 0), 0, 42);
    }
    if (typeof body.offDays !== "undefined") {
      u.offDays = Math.max(0, toInt(body.offDays, 0));
    }
    if (typeof body.currentLeaveStatus === "string") {
      u.currentLeaveStatus = body.currentLeaveStatus;
    }
    if (typeof body.lastLeaveUpdate === "string" && !Number.isNaN(Date.parse(body.lastLeaveUpdate))) {
      u.lastLeaveUpdate = new Date(body.lastLeaveUpdate).toISOString();
    }

    // ✅ Optional "lastOnline" passthrough (normalized ISO)
    if (typeof body.lastOnline === "string" && !Number.isNaN(Date.parse(body.lastOnline))) {
      u.lastOnline = new Date(body.lastOnline).toISOString();
    }

    u.updatedAt = new Date().toISOString();

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.json(u); // ← return RAW user, not { success, user }
  } catch (err) {
    console.error("Failed to patch user:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ✅ Stamp last login (existing)
app.patch("/users/:id/last-login", (req, res) => {
  const { id } = req.params;
  const bodyTs = req.body?.lastLogin;

  try {
    const users = readUsersSafe();
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const safeIso = (() => {
      const d = new Date(bodyTs);
      return bodyTs && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    })();

    users[idx].lastLogin = safeIso;
    users[idx].updatedAt = new Date().toISOString();

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.json({ success: true, user: users[idx] });
  } catch (err) {
    console.error("Failed to update last login:", err);
    return res.status(500).json({ error: "Failed to update last login" });
  }
});

// ✅ NEW: Stamp last online (mirrors last-login route)
app.patch("/users/:id/last-online", (req, res) => {
  const { id } = req.params;
  const bodyTs = req.body?.lastOnline;

  try {
    const users = readUsersSafe();
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const safeIso = (() => {
      const d = new Date(bodyTs);
      return bodyTs && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    })();

    users[idx].lastOnline = safeIso;
    users[idx].updatedAt = new Date().toISOString();

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.json({ success: true, user: users[idx] });
  } catch (err) {
    console.error("Failed to update last online:", err);
    return res.status(500).json({ error: "Failed to update last online" });
  }
});

// Ensure every user has an id
const usersFixed = readUsersSafe().map(u => {
  if (!u.id) {
    u.id = Date.now().toString() + Math.floor(Math.random() * 1000);
  }
  return u;
});
fs.writeFileSync(USERS_FILE, JSON.stringify(usersFixed, null, 2));

// ✅ Delete user (unchanged)
app.delete("/users/:id", (req, res) => {
  const id = req.params.id;
  let users = readUsersSafe();
  const exists = users.some((u) => String(u.id) === String(id));
  if (!exists) return res.status(404).json({ message: "User not found" });

  users = users.filter((u) => String(u.id) !== String(id));
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ success: true, deletedId: id });
});

console.log("🚨 ROUTE CHECKPOINT 12");
console.log("🚨 ROUTE CHECKPOINT 13");
// [B] END: Users API (new, with last-login route)




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


// ✅ Patch ticket by ID (array-safe for assignedReporter + robust FCM targets)
app.patch("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const updatedFields = req.body || {};

  // Helpers
  const stripRolePrefix = (s) =>
    String(s || "")
      .replace(/^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i, "")
      .trim();

  const normReporterArray = (v) => {
    if (Array.isArray(v)) {
      return Array.from(new Set(v.map(stripRolePrefix).filter(Boolean)));
    }
    if (typeof v === "string" && v.trim()) {
      return [stripRolePrefix(v)];
    }
    return [];
  };

  const normArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    // Read tickets
    const raw = fs.readFileSync(TICKETS_FILE, "utf-8");
    const allTickets = JSON.parse(raw || "[]");
    const ticketIndex = allTickets.findIndex((t) => String(t.id) === String(id));

    if (ticketIndex === -1) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const oldTicket = allTickets[ticketIndex];

    // Normalize reporter from body (if provided) else from existing
    let nextAssignedReporter;
    if (typeof updatedFields.assignedReporter !== "undefined") {
      nextAssignedReporter = normReporterArray(updatedFields.assignedReporter);
    } else {
      nextAssignedReporter = Array.isArray(oldTicket.assignedReporter)
        ? normReporterArray(oldTicket.assignedReporter)
        : normReporterArray(oldTicket.assignedReporter || []);
    }

    // Build new ticket (preserve existing fields if not provided)
    const newTicket = {
      ...oldTicket,
      ...updatedFields,
      assignedReporter: nextAssignedReporter, // ← always array of clean names
    };

    // Ensure other array-ish fields are arrays
    if (typeof newTicket.assignedCamOps !== "undefined") {
      newTicket.assignedCamOps = Array.isArray(newTicket.assignedCamOps)
        ? newTicket.assignedCamOps
        : normArr(newTicket.assignedCamOps);
    } else {
      newTicket.assignedCamOps = Array.isArray(oldTicket.assignedCamOps)
        ? oldTicket.assignedCamOps
        : normArr(oldTicket.assignedCamOps);
    }

    // Write file
    allTickets[ticketIndex] = newTicket;
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(allTickets, null, 2));

    // ===== FCM NOTIFICATIONS (robust to arrays/strings) =====
    try {
      const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
      const allUsers = JSON.parse(usersRaw || "[]");

      const getUserByName = (name) => {
        if (!name) return undefined;
        const n = String(name).trim().toLowerCase();
        return allUsers.find((u) => String(u.name || "").trim().toLowerCase() === n);
      };

      // Normalize old/new reporters to arrays of names (clean)
      const oldReporters = Array.isArray(oldTicket.assignedReporter)
        ? normReporterArray(oldTicket.assignedReporter)
        : normReporterArray(oldTicket.assignedReporter || []);

      const newReporters = nextAssignedReporter;

      const recipients = new Set();

      // 🔔 1. CamOps changed?
      const oldOps = Array.isArray(oldTicket.assignedCamOps) ? oldTicket.assignedCamOps : normArr(oldTicket.assignedCamOps);
      const newOps = Array.isArray(newTicket.assignedCamOps) ? newTicket.assignedCamOps : normArr(newTicket.assignedCamOps);
      if (!sameJSON(oldOps, newOps)) {
        for (const name of newOps) {
          const u = getUserByName(name);
          if (u) recipients.add(u);
        }
      }

      // 🔔 2. Driver changed?
      if (String(oldTicket.assignedDriver || "") !== String(newTicket.assignedDriver || "")) {
        const u = getUserByName(newTicket.assignedDriver);
        if (u) recipients.add(u);
      }

      // 🔔 3. Reporter changed?
      if (!sameJSON(oldReporters, newReporters)) {
        for (const name of newReporters) {
          const u = getUserByName(name);
          if (u) recipients.add(u);
        }
      }

      // 🔔 4. Vehicle newly added?
      if (!oldTicket.vehicle && newTicket.vehicle) {
        const everyone = [
          ...(newOps || []),
          ...(newReporters || []),
          newTicket.assignedDriver,
        ].filter(Boolean);
        for (const name of everyone) {
          const u = getUserByName(name);
          if (u) recipients.add(u);
        }
      }

      // 🔔 5. Important fields changed? (cover both `assignmentStatus` and legacy `status`)
      const importantFields = ["location", "filmingTime", "departureTime", "assignmentStatus", "status", "notes", "date"];
      const importantChanged = importantFields.some(
        (f) => JSON.stringify(oldTicket[f]) !== JSON.stringify(newTicket[f])
      );

      if (importantChanged) {
        const everyone = [
          ...(newOps || []),
          ...(newReporters || []),
          newTicket.assignedDriver,
        ].filter(Boolean);
        for (const name of everyone) {
          const u = getUserByName(name);
          if (u) recipients.add(u);
        }
      }

      if (recipients.size > 0) {
        const title = `Ticket Updated: ${newTicket.title}`;
        const message = `One or more updates were made. Check filming, location, or assignment changes.`;
        await sendPushToUsers([...recipients], title, message);
      }
    } catch (notifyErr) {
      // Don't fail the request just because notifications errored
      console.error("⚠️ Notification step failed (continuing):", notifyErr);
    }

    // Success
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

// ✅ Health + storage debug
app.get("/", (req, res) => {
  try {
    const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
    res.json({
      ok: true,
      message: "Backend is running!",
      DATA_DIR,
      files,
    });
  } catch (e) {
    res.json({ ok: true, message: "Backend is running!", DATA_DIR, error: String(e) });
  }
});


// ✅ Start server on LAN
// ✅ Start HTTPS server on LAN
// ✅ Serve Vite production build
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Fallback to index.html for frontend routes (React SPA)
// Make sure API paths (including /suggestions) are never swallowed.
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
    "/notifications",
    "/suggestions"         // ✅ ensure suggestions API never gets swallowed by SPA fallback
  ];

  // Always let non-GET (POST/PATCH/DELETE/OPTIONS) pass through to real routes
  if (req.method !== "GET") return next();

  // If the path is one of our API prefixes, pass through
  if (knownPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }

  // If the request looks like an asset (has a file extension), don't SPA-fallback it
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();

  // Otherwise, serve the SPA index for frontend routes
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








