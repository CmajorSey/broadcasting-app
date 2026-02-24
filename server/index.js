/* ===========================
   🚀 Server bootstrap imports
   =========================== */
console.log("🚨 First checkpoint reached");
// @ts-nocheck
import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
console.log("🔍 Looking for service account at:", path.resolve("firebase-service-account.json"));
// Using Node 18+ global fetch (no node-fetch needed)
import { GoogleAuth } from "google-auth-library";
import { createRequire } from "module";
import webpushRouter from "./routes/webpush.js";

/* ===========================
   🍏 Web Push (Safari/iOS installed web app)
   - This is NOT Firebase Messaging
   - Requires VAPID keys + PushSubscription storage
   =========================== */
import webpush from "web-push";

import authRouter from "./routes/auth.js";
import userPrefsRouter from "./routes/user-prefs.js";
import holidaysRouter from "./routes/holidays.js";
// 👉 NEW (v0.7.1): settings + leave management
import settingsRouter from "./routes/settings.js";
import leaveRouter from "./routes/leave.js";

// 📅 Calendar (Production Calendar API)
import calendarRouter from "./routes/calendar.js";
  /* ===========================
   📅 Calendar store init lives in calendarStore.js
   (avoid duplicate init logic here)
   =========================== */
import { readCalendarSafe, writeCalendarSafe, ensureCalendarFile } from "./utils/calendarStore.js";

/* ===========================
   📰 Newsroom Hub API
   =========================== */
import newsroomRouter from "./routes/newsroom.js";

/* ===========================
   🏈 Sports Hub API
   =========================== */
import sportsRouter from "./routes/sports.js";

/* ===========================
   📜 Changelog API
   =========================== */
import changelogRouter from "./routes/changelog.js";

const require = createRequire(import.meta.url);


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
// [PATCH:FIREBASE_FCM_SENDER v0.8.x] Unified push sender (supports fcmToken + fcmTokens[], adds webpush link/icon + data payload)
/* ===========================
   🔔 FCM push sender starts here
   - Supports BOTH:
     - user.fcmToken (legacy single token)
     - user.fcmTokens (new array of tokens)
   - Adds data payload so:
     - foreground handler (onMessage) can route rich info
     - service worker can open correct URL on click
   =========================== */

async function sendPushToUsers(users, title, message, opts = {}) {
  const safeStr = (v) => (v === null || v === undefined ? "" : String(v));

  // Collect tokens:
  // - Prefer fcmTokens[] if present
  // - Fallback to fcmToken
  const tokenSet = new Set();

  (Array.isArray(users) ? users : []).forEach((u) => {
    try {
      const arr = Array.isArray(u?.fcmTokens) ? u.fcmTokens : [];
      for (const t of arr) {
        const s = safeStr(t).trim();
        if (s) tokenSet.add(s);
      }

      const single = safeStr(u?.fcmToken).trim();
      if (single) tokenSet.add(single);
    } catch {
      // ignore
    }
  });

  const tokens = Array.from(tokenSet);

  if (tokens.length === 0) {
    console.log("ℹ️ No FCM tokens found for recipients.");
    return;
  }

  // Build recipient identity list for frontend filters
  const recipientIds = (Array.isArray(users) ? users : [])
    .map((u) => safeStr(u?.id).trim())
    .filter(Boolean);

  const recipientNames = (Array.isArray(users) ? users : [])
    .map((u) => safeStr(u?.name).trim())
    .filter(Boolean);

  const recipients = Array.from(new Set([...recipientIds, ...recipientNames]));

  // Options (all optional)
  const category = safeStr(opts.category || "admin").trim() || "admin";
  const urgent = opts.urgent === true;
  const url = safeStr(opts.url || "/").trim() || "/";
  const ticketId = safeStr(opts.ticketId || "").trim();
  const timestamp = safeStr(opts.timestamp || new Date().toISOString()).trim();

  // ✅ Optional: helps client route better + future "fetch-by-id" pattern
  const kind = safeStr(opts.kind || opts.type || "").trim();
  const notificationId = safeStr(opts.notificationId || "").trim();

  // ✅ Important for Web Push icons:
  // Use an absolute URL to your Netlify site so the icon loads reliably.
  // (Relative "/logo.png" from the FCM notification may not resolve as expected.)
  const icon = safeStr(opts.icon).trim() || "https://loboard.netlify.app/logo.png";

  // FCM data must be STRING values
  const dataPayload = {
    title: safeStr(title),
    body: safeStr(message),
    message: safeStr(message),

    category: safeStr(category),
    urgent: urgent ? "true" : "false",
    url: safeStr(url),
    timestamp: safeStr(timestamp),

    // Helpful for TicketPage deep-links
    ticketId: ticketId,

    // Helpful for routing / dedupe / future pull-by-id
    kind: safeStr(kind),
    notificationId: safeStr(notificationId),

    // Send as JSON string so frontend can parse
    recipients: JSON.stringify(recipients),
  };

  const accessToken = await getAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

  const results = [];

  for (const token of tokens) {
    const payload = {
      message: {
        token,

        // ✅ Visible notification (good default)
        notification: { title, body: message },

        // ✅ Data enables routing in foreground + in SW click handler
        data: dataPayload,

        webpush: {
          headers: { Urgency: urgent ? "high" : "normal" },

          // ✅ Correct way to set the click destination for Web Push via FCM v1:
          // The browser opens this link when the notification is clicked.
          // (More reliable than click_action inside notification.)
          fcm_options: { link: url },

          notification: {
            icon,
          },
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

    results.push({ token, status: res.status, ok: res.ok, body: json });
  }

  console.log("✅ Push send summary:", {
    tokenCount: tokens.length,
    recipients: recipients.length,
    category,
    urgent,
    url,
    kind: kind || null,
    notificationId: notificationId || null,
  });
}
/* ===========================
   🔔 FCM push sender ends here
   =========================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("▶️ Running from:", __filename);

console.log("🚨 Imports completed");
console.log("🚨 ROUTE CHECKPOINT 1");


// ✅ Persistent storage root
// - On Render: use /data (persistent disk)
// - Local dev: use ./data inside the repo (so your existing JSON files load)
const DATA_DIR =
  process.env.DATA_DIR ||
  ((process.env.RENDER || process.env.ON_RENDER) ? "/data" : path.join(__dirname, "data"));
  process.env.DATA_DIR = DATA_DIR;


console.log("💾 DATA_DIR:", DATA_DIR, "— (env wins; Render => /data, Local => ./data)");

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const app = express();
const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",

  // ✅ Your primary Netlify site
  "https://loboard.netlify.app",

  // ✅ Capacitor/WebView origins (safe to include)
  "capacitor://localhost",
  "ionic://localhost",
];

// ✅ Allow LAN frontends (any 192.168.x.x:5173) + Netlify preview deploys + your known list
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // allow non-browser requests (curl/postman/server-to-server)

  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // LAN Vite dev (any 192.168.*.*:5173)
  if (/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/.test(origin)) return true;

  // Netlify deploy previews like https://<something>--loboard.netlify.app
  // (If you don't use deploy previews, this still doesn't hurt.)
  if (/^https:\/\/.+\.netlify\.app$/.test(origin)) return true;

  return false;
};

const corsOptions = {
  origin: (origin, cb) => {
    // ✅ Allow requests with no Origin header (same-origin, server-to-server, health checks)
    if (!origin) return cb(null, true);

    // ✅ Allow only whitelisted origins
    if (isAllowedOrigin(origin)) return cb(null, true);

    // ✅ Do NOT throw (throwing can remove CORS headers and cause confusing browser errors)
    return cb(null, false);
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],

  /* ===========================
     ✅ Allowed request headers
     - Add x-lo-user so browser POSTs can pass your actor guard
     =========================== */
  allowedHeaders: ["Content-Type", "Authorization", "x-lo-user"],

  credentials: true,
};

// ✅ CORS must be registered BEFORE any routes
/* ===========================
   🌐 CORS + body parsing
   =========================== */
app.use(cors(corsOptions));

// ✅ Preflight for all routes (Express 5)
app.options(new RegExp(".*"), cors(corsOptions));

app.use(express.json());

/* ===========================
   🍏 Safari Web Push (Background Notifications)
   - Safari installed web apps do NOT receive FCM web push reliably.
   - They need standard Web Push:
       1) client creates PushSubscription (endpoint + keys)
       2) backend stores subscription on the user record
       3) backend sends via VAPID using web-push
   - Non-fatal if keys are missing (feature simply won’t send).
   =========================== */
const WEBPUSH_PUBLIC_KEY = String(process.env.WEBPUSH_PUBLIC_KEY || "").trim();
const WEBPUSH_PRIVATE_KEY = String(process.env.WEBPUSH_PRIVATE_KEY || "").trim();
const WEBPUSH_SUBJECT = String(process.env.WEBPUSH_SUBJECT || "mailto:admin@loboard.app").trim();

let WEBPUSH_READY = false;

try {
  if (WEBPUSH_PUBLIC_KEY && WEBPUSH_PRIVATE_KEY) {
    webpush.setVapidDetails(WEBPUSH_SUBJECT, WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY);
    WEBPUSH_READY = true;
    console.log("✅ Web Push (VAPID) configured.");
  } else {
    console.log("ℹ️ Web Push not configured (missing WEBPUSH_PUBLIC_KEY/WEBPUSH_PRIVATE_KEY).");
  }
} catch (e) {
  console.warn("⚠️ Web Push init failed (non-fatal):", e?.message || e);
  WEBPUSH_READY = false;
}

/* ===========================
   🍏 Web Push subscribe endpoint
   POST /webpush/subscribe
   body: { userId: string, subscription: PushSubscription }
   =========================== */
app.post("/webpush/subscribe", (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const sub = req.body?.subscription;

    if (!userId || !sub || typeof sub !== "object") {
      return res.status(400).json({ error: "Missing userId or subscription" });
    }

    // USERS_FILE is declared later in the file — but in JS runtime this handler
    // runs after initialization, so USERS_FILE will be defined by then.
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const users = JSON.parse(usersRaw || "[]");

    const idx = users.findIndex((u) => String(u?.id) === userId);
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const endpoint = String(sub?.endpoint || "").trim();
    if (!endpoint) return res.status(400).json({ error: "Subscription missing endpoint" });

    const u = users[idx];

    // Store on: user.webPushSubscriptions[]
    const existing = Array.isArray(u?.webPushSubscriptions) ? u.webPushSubscriptions : [];
    const next = existing.filter((s) => String(s?.endpoint || "").trim() && String(s?.endpoint || "").trim() !== endpoint);
    next.push(sub);

    users[idx] = { ...u, webPushSubscriptions: next };

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.status(200).json({ ok: true, subscriptions: next.length });
  } catch (err) {
    console.error("WebPush subscribe failed:", err);
    return res.status(500).json({ error: "WebPush subscribe failed" });
  }
});

/* ===========================
   🍏 Web Push send helper (used by /notifications/send hook)
   - Reads user.webPushSubscriptions[]
   - Sends a standard Web Push payload (works for Safari installed web apps)
   =========================== */
async function sendWebPushToUsers(users, title, message, opts = {}) {
  if (!WEBPUSH_READY) {
    // silent/non-fatal — keeps existing app behavior
    console.log("ℹ️ WebPush skipped (VAPID not configured).");
    return;
  }

  const safeStr = (v) => (v === null || v === undefined ? "" : String(v));
  const url = safeStr(opts.url || "/tickets").trim() || "/tickets";

  const payload = JSON.stringify({
    title: safeStr(title),
    body: safeStr(message),
    url,
    category: safeStr(opts.category || "admin"),
    urgent: opts.urgent === true,
    kind: safeStr(opts.kind || ""),
    timestamp: safeStr(opts.timestamp || new Date().toISOString()),
  });

  const subs = [];
  (Array.isArray(users) ? users : []).forEach((u) => {
    const arr = Array.isArray(u?.webPushSubscriptions) ? u.webPushSubscriptions : [];
    for (const s of arr) {
      if (s && typeof s === "object" && String(s?.endpoint || "").trim()) subs.push(s);
    }
  });

  if (subs.length === 0) {
    console.log("ℹ️ No Web Push subscriptions found for recipients.");
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      ok += 1;
    } catch (e) {
      failed += 1;
      // Non-fatal: subscriptions can expire; you can prune later.
      console.warn("❌ WebPush send error (non-fatal):", e?.message || e);
    }
  }

  console.log("✅ WebPush send summary:", { subs: subs.length, ok, failed, url });
}

/* ===========================
   🔐 Auth + forced password change starts here
   - This route ensures the frontend always receives:
     forcePasswordChange / requiresPasswordReset / passwordIsTemp / tempPasswordExpires
   - It also enforces temp-password expiry (410 Gone)
   - IMPORTANT: defined BEFORE app.use("/auth", authRouter) so it wins.
   =========================== */
app.post("/auth/login", async (req, res) => {
  try {
    /* ===========================
       🔐 Auth + forced password change starts here (OVERRIDE)
       - This route runs BEFORE app.use("/auth", authRouter), so it WINS.
       - Fixes:
         ✅ duplicate-name invalid credentials (validates across all matches)
         ✅ stamps lastLogin + lastLoginAt + lastOnline on successful auth
         ✅ keeps forced-password-change flags behavior unchanged
         ✅ does NOT leak password back to frontend
       =========================== */

    const body = req.body || {};
    const identifier = String(body.name || body.username || body.identifier || "").trim();
    const password = String(body.password || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: "Missing name or password" });
    }

    // Small local helpers (keep this route self-contained)
    const isBcryptHash = (v) => {
      const s = String(v || "");
      return s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$");
    };
    const isExpired = (iso) => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return Number.isFinite(t) && Date.now() > t;
    };

    const users = readUsersSafe();
    const lower = identifier.toLowerCase();

    // ✅ Collect ALL matches (duplicate-safe)
    const matches = users.filter((u) => {
      const n = String(u?.name || "").trim().toLowerCase();
      const un = String(u?.username || "").trim().toLowerCase();
      const em = String(u?.email || "").trim().toLowerCase();
      return n === lower || (un && un === lower) || (em && em === lower);
    });

    if (!matches.length) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    // ✅ Validate password against every match to avoid “wrong duplicate” failures.
    // Supports plaintext (current) and bcrypt hashes (if stored).
    const validMatches = [];
    for (const candidate of matches) {
      const stored = String(candidate?.password || "");
      let ok = false;

      if (isBcryptHash(stored)) {
        // If bcryptjs is available in this file, use it; otherwise, fail safely.
        try {
          if (typeof bcrypt?.compare === "function") {
            ok = await bcrypt.compare(password, stored);
          } else {
            ok = false;
          }
        } catch {
          ok = false;
        }
      } else {
        ok = stored === password;
      }

      if (ok) validMatches.push(candidate);
    }

    if (!validMatches.length) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    // If multiple valid matches, pick the most recently updated record.
    const toTime = (v) => {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : 0;
    };
    const user =
      validMatches.length === 1
        ? validMatches[0]
        : validMatches
            .slice()
            .sort((a, b) => {
              const aScore = Math.max(
                toTime(a.updatedAt),
                toTime(a.passwordUpdatedAt),
                toTime(a.lastLogin),
                toTime(a.lastLoginAt),
                toTime(a.lastOnline),
                toTime(a.createdAt)
              );
              const bScore = Math.max(
                toTime(b.updatedAt),
                toTime(b.passwordUpdatedAt),
                toTime(b.lastLogin),
                toTime(b.lastLoginAt),
                toTime(b.lastOnline),
                toTime(b.createdAt)
              );
              return bScore - aScore;
            })[0];

    // ✅ Enforce temp password expiry (if applicable)
    const isTemp =
      user.passwordIsTemp === true ||
      user.requiresPasswordReset === true ||
      user.forcePasswordChange === true;

    if (isTemp && isExpired(user.tempPasswordExpires)) {
      return res.status(410).json({
        success: false,
        error: "Temporary password has expired",
        code: "TEMP_PASSWORD_EXPIRED",
        user: { id: String(user.id), name: user.name },
      });
    }

    // ✅ Stamp timestamps on SUCCESSFUL AUTH (fixes your stale lastOnline/lastLoginAt issue)
    const nowISO = new Date().toISOString();
    user.lastLogin = nowISO;     // canonical
    user.lastLoginAt = nowISO;   // legacy alias (your data already has this key)
    user.lastOnline = nowISO;    // presence
    user.updatedAt = nowISO;

    // Persist updates back to users.json (mutate correct record by id)
    const idx = users.findIndex((u) => String(u.id) === String(user.id));
    if (idx !== -1) {
      users[idx] = user;
      try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      } catch (e) {
        console.error("auth/login write users failed:", e);
        // Non-fatal: still allow login to succeed (frontend contract)
      }
    }

    // ✅ Always return flags so frontend can force SetPasswordPage
    // Also: do NOT leak password/reset fields back to client
    const safeUser = {
      ...user,
      id: String(user.id),
      roles: Array.isArray(user.roles) ? user.roles : [],
      forcePasswordChange: user.forcePasswordChange === true,
      requiresPasswordReset: user.requiresPasswordReset === true,
      passwordIsTemp: user.passwordIsTemp === true,
      tempPasswordExpires: user.tempPasswordExpires || null,
      passwordUpdatedAt: user.passwordUpdatedAt || null,
    };
    delete safeUser.password;
    delete safeUser.resetToken;
    delete safeUser.resetExpires;

    return res.json({
      success: true,
      user: safeUser,

      // Extra hint (harmless if frontend ignores)
      mustSetPassword: safeUser.forcePasswordChange || safeUser.requiresPasswordReset,
    });
  } catch (err) {
    console.error("auth/login failed:", err);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});
/* ===========================
   🔐 Auth + forced password change ends here
   =========================== */

// ✅ Mount password reset routes
app.use("/auth", authRouter);
app.use("/user-prefs", userPrefsRouter);
app.use("/holidays", holidaysRouter);


/* ===========================
   📜 Changelog routes
   - IMPORTANT:
     Sometimes your SPA fallback/static can return index.html for unknown paths.
     This hard GET ensures /changelog always returns JSON (never HTML).
   =========================== */
const CHANGELOG_FILE = path.join(DATA_DIR, "changelog.json");

const ensureJsonFile = (filepath, fallbackValue) => {
  try {
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, JSON.stringify(fallbackValue, null, 2));
    } else {
      const raw = fs.readFileSync(filepath, "utf-8");
      // if file exists but is empty/invalid, reset safely
      try {
        JSON.parse(raw || "null");
      } catch {
        fs.writeFileSync(filepath, JSON.stringify(fallbackValue, null, 2));
      }
    }
  } catch (e) {
    console.error("ensureJsonFile failed:", filepath, e);
  }
};

// Default structure (safe for UI)
// You can store either an array OR an object — we normalize in the router,
// but this guarantees something valid exists.
ensureJsonFile(CHANGELOG_FILE, { entries: [] });

// ✅ Hard endpoint: always JSON (prevents <!DOCTYPE ...> parsing crash)
app.get("/changelog", (req, res) => {
  try {
    const raw = fs.readFileSync(CHANGELOG_FILE, "utf-8");
    const parsed = raw ? JSON.parse(raw) : { entries: [] };
    return res.json(parsed);
  } catch (err) {
    console.error("GET /changelog failed:", err);
    return res.status(500).json({ error: "Failed to read changelog" });
  }
});

// ✅ Keep router too (for POST/PATCH later if you already built it)
app.use("/changelog", changelogRouter);

// 👉 NEW (v0.7.1): settings + leave management
// - /settings           GET, PATCH     (site rules + holiday source)
// - /leave-requests     GET, POST, PATCH (leave workflow)
app.use("/settings", settingsRouter);
app.use("/leave-requests", leaveRouter);
app.use("/leave", leaveRouter); // alias for older frontend calls

// 📅 Calendar routes (Production Calendar)
app.use("/calendar", calendarRouter);

/* ===========================
   📰 Newsroom Hub routes
   =========================== */
app.use("/hub/newsroom", newsroomRouter);

/* ===========================
   🏈 Sports Hub routes
   =========================== */
app.use("/hub/sports", sportsRouter);

/* ===========================
   🍏 Web Push routes (Safari PWA)
   - POST /webpush/subscribe
   - Uses VAPID keys from Render env:
     WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY, WEBPUSH_SUBJECT
   =========================== */
app.use("/webpush", webpushRouter);

const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");
const ROSTERS_FILE = path.join(DATA_DIR, "rosters.json");
const PASSWORD_RESET_REQUESTS_FILE = path.join(DATA_DIR, "passwordResetRequests.json");
const groupsPath = path.join(DATA_DIR, "notificationGroups.json");

// 🔧 Ensure data directory and files exist (all under /data)
fs.mkdirSync(DATA_DIR, { recursive: true });

// Ensure calendar.json exists via the shared store (single source of truth)
ensureCalendarFile();

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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ siteName: "Byenveni Lo Board" }, null, 2));
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

/* ===========================
   📰 Newsroom hub store (weeks map)
   =========================== */
const NEWSROOM_FILE = path.join(DATA_DIR, "newsroom.json");
if (!fs.existsSync(NEWSROOM_FILE)) {
  fs.writeFileSync(NEWSROOM_FILE, JSON.stringify({ weeks: {} }, null, 2));
}

/* ===========================
   🏈 Sports hub store (weeks map)
   =========================== */
const SPORTS_FILE = path.join(DATA_DIR, "sports.json");
if (!fs.existsSync(SPORTS_FILE)) {
  fs.writeFileSync(SPORTS_FILE, JSON.stringify({ weeks: {} }, null, 2));
}

/* ===========================
   📅 Rosters API starts here
   - Fixes missing /rosters/:weekStart routes (OperationsPage 404)
   - Storage: rosters.json as an OBJECT:
       { "YYYY-MM-DD": [ {date, primary, backup, otherOnDuty, afternoonShift, off}, ... ] }
   - Contract:
       GET  /rosters/:weekStart  -> array (never HTML)
       PATCH/rosters/:weekStart  -> upserts week array
   =========================== */

const safeYmd = (v) => {
  const s = String(v || "").trim();
  // keep very strict: we only accept YYYY-MM-DD keys
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return s;
};

const ensureRostersFile = () => {
  try {
    fs.mkdirSync(path.dirname(ROSTERS_FILE), { recursive: true });
    if (!fs.existsSync(ROSTERS_FILE)) {
      fs.writeFileSync(ROSTERS_FILE, JSON.stringify({}, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("ensureRostersFile failed:", e);
  }
};

// ✅ Always returns an OBJECT map: { [weekStart]: weekArray }
const readRostersSafe = () => {
  try {
    ensureRostersFile();
    const raw = fs.readFileSync(ROSTERS_FILE, "utf-8") || "{}";
    const parsed = JSON.parse(raw);

    // Preferred shape: object map
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }

    // Legacy fallback: array -> migrate to object map if possible
    if (Array.isArray(parsed)) {
      const migrated = {};
      parsed.forEach((w) => {
        const key = safeYmd(w?.weekStart);
        const days = Array.isArray(w?.days) ? w.days : Array.isArray(w) ? w : null;
        if (key && Array.isArray(days)) migrated[key] = days;
      });
      // Best effort write-back
      fs.writeFileSync(ROSTERS_FILE, JSON.stringify(migrated, null, 2), "utf-8");
      return migrated;
    }

    return {};
  } catch (e) {
    console.error("readRostersSafe failed:", e);
    return {};
  }
};

const writeRostersSafe = (obj) => {
  try {
    ensureRostersFile();
    const out = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    fs.writeFileSync(ROSTERS_FILE, JSON.stringify(out, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("writeRostersSafe failed:", e);
    return false;
  }
};

// ✅ GET all rosters (keys only + counts) — helps health checks + frontend bootstraps
app.get("/rosters", (req, res) => {
  try {
    const store = readRostersSafe(); // object map
    const keys = Object.keys(store || {}).sort();

    const summary = keys.map((weekStart) => ({
      weekStart,
      days: Array.isArray(store[weekStart]) ? store[weekStart].length : 0,
    }));

    return res.json(summary);
  } catch (e) {
    console.error("GET /rosters failed:", e);
    return res.status(200).json([]); // keep frontend safe
  }
});

// ✅ GET roster for a week (array; never 404 for missing week)
app.get("/rosters/:weekStart", (req, res) => {
  try {
    const key = safeYmd(req.params.weekStart);
    if (!key) return res.status(400).json({ error: "Invalid weekStart (expected YYYY-MM-DD)" });

    const store = readRostersSafe();
    const week = Array.isArray(store[key]) ? store[key] : [];

    // Always return array (OperationsPage expects JSON array)
    return res.json(week);
  } catch (e) {
    console.error("GET /rosters/:weekStart failed:", e);
    return res.status(200).json([]); // keep frontend safe
  }
});

// ✅ PATCH roster for a week (upsert)
app.patch("/rosters/:weekStart", (req, res) => {
  try {
    const key = safeYmd(req.params.weekStart);
    if (!key) return res.status(400).json({ error: "Invalid weekStart (expected YYYY-MM-DD)" });

    const body = req.body;

    if (!Array.isArray(body)) {
      return res.status(400).json({ error: "Roster week must be an array of day objects" });
    }

    // Light sanitize so your UI never crashes on unexpected shapes
    const sanitizeDay = (d) => ({
      date: safeYmd(d?.date) || null,
      primary: Array.isArray(d?.primary) ? d.primary : [],
      backup: Array.isArray(d?.backup) ? d.backup : [],
      otherOnDuty: Array.isArray(d?.otherOnDuty) ? d.otherOnDuty : [],
      afternoonShift: Array.isArray(d?.afternoonShift) ? d.afternoonShift : [],
      off: Array.isArray(d?.off) ? d.off : [],
    });

    const week = body.map(sanitizeDay).filter((d) => !!d.date);

    const store = readRostersSafe();
    store[key] = week;
    writeRostersSafe(store);

    return res.json({ success: true, weekStart: key, days: week.length });
  } catch (e) {
    console.error("PATCH /rosters/:weekStart failed:", e);
    return res.status(500).json({ error: "Failed to save roster" });
  }
});

/* ===========================
   📅 Rosters API ends here
   =========================== */

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
// ✅ JSON array helpers (used by suggestions + notifications)
// NOTE: Duplicate helper removed.
// We use the newer const-based helpers below (supports legacy wrappers + ensureFile).
// (Leaving this comment block to preserve section readability.)


// ✅ Notifications API (edit, delete-one, clear-all, and polling support) + Suggestions API

// ---------------------------
// Shared JSON helpers (safe + array-only contract)
// ---------------------------
const notificationsPath = path.join(DATA_DIR, "notifications.json");
const suggestionsPath =
  typeof SUGGESTIONS_FILE === "string"
    ? SUGGESTIONS_FILE
    : path.join(DATA_DIR, "suggestions.json");

const ensureFile = (filePath, defaultValue) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("ensureFile failed:", filePath, e);
  }
};

// ✅ Always returns an ARRAY.
// Accepts legacy wrapper: { suggestions: [] } or { notifications: [] }.
const readJsonArray = (filePath) => {
  try {
    ensureFile(filePath, []);
    const raw = fs.readFileSync(filePath, "utf-8") || "[]";
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) return parsed;

    // legacy wrappers
    if (parsed && Array.isArray(parsed.suggestions)) return parsed.suggestions;
    if (parsed && Array.isArray(parsed.notifications)) return parsed.notifications;

    return [];
  } catch (e) {
    console.error("readJsonArray failed:", filePath, e);
    return [];
  }
};

const writeJsonArray = (filePath, arr) => {
  try {
    ensureFile(filePath, []);
    const out = Array.isArray(arr) ? arr : [];
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("writeJsonArray failed:", filePath, e);
    return false;
  }
};

// Normalize ISO to second precision for stable compare (avoids ms drift)
const isoSec = (dateish) => {
  try {
    const d = new Date(dateish);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split(".")[0];
  } catch {
    return null;
  }
};

/* ===========================
   📅 Date display helpers (dd/mm/yyyy)
   - IMPORTANT: storage stays ISO (do NOT change file formats)
   - We only format for human-readable messages/logs/push
   - Uses Seychelles timezone: Indian/Mahe
   =========================== */
const formatDMY = (dateish) => {
  try {
    const d = new Date(dateish);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Indian/Mahe",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
};

const formatDMYDateTime = (dateish) => {
  try {
    const d = new Date(dateish);
    if (Number.isNaN(d.getTime())) return "";
    const date = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Indian/Mahe",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Indian/Mahe",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return "";
  }
};
// ---------------------------
// ✅ Suggestions (ONE set of routes only)
// Robust: legacy migration + id/timestamp addressing
// ---------------------------

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

    const createdAt =
      createdAtRaw && !Number.isNaN(new Date(createdAtRaw).getTime())
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    // Prefer deterministic id from timestamp seconds; ensure uniqueness
    const baseId = `ts:${isoSec(createdAt)}`;
    const uniqueId = all.some((s) => s.id === baseId)
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
    console.log("💡 Suggestion saved:", {
      id: entry.id,
      userName: entry.userName,
      section: entry.section,
    });

    // 🔔 Optional: notify admins (FCM + in-app)
    try {
      const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
      const allUsers = JSON.parse(usersRaw || "[]");
      const admins = allUsers.filter(
        (u) => Array.isArray(u.roles) && u.roles.includes("admin")
      );

      // Push
      try {
        const title = "💡 New User Suggestion";
        const bodyText = `${entry.userName}: ${entry.message.slice(0, 80)}${
          entry.message.length > 80 ? "…" : ""
        }`;
        await sendPushToUsers(admins, title, bodyText);
      } catch (pushErr) {
        console.warn("Push for suggestion failed (non-fatal):", pushErr);
      }

      // In-app notification
      try {
        const notifs = readJsonArray(notificationsPath);
        const recipients = Array.from(
          new Set([
            ...admins.map((a) => String(a.id)).filter(Boolean),
            ...admins.map((a) => String(a.name || "")).filter(Boolean),
            "admin",
            "admins",
            "ALL",
          ])
        );

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
            url: "/admin?tab=notifications#suggestions",
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
    return res.status(500).json({ error: "Could not submit suggestion" });
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
    return res.status(500).json({ error: "Could not read suggestions" });
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
    return res.status(500).json({ error: "Could not update suggestion" });
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
    return res.status(500).json({ error: "Could not delete suggestion" });
  }
});

// ---------------------------
// ✅ Notifications (your existing safe implementation)
// ---------------------------

const ensureNotifsFile = () => {
  try {
    fs.mkdirSync(path.dirname(notificationsPath), { recursive: true });
    if (!fs.existsSync(notificationsPath)) {
      fs.writeFileSync(notificationsPath, JSON.stringify([], null, 2), "utf-8");
    }
  } catch (e) {
    console.error("ensureNotifsFile failed:", e);
  }
};

// ✅ Always return an ARRAY no matter what is in the file:
// - [] (normal)
// - { notifications: [] } (legacy wrapper)
// - anything else -> []
const readNotifsSafe = () => {
  try {
    ensureNotifsFile();
    const raw = fs.readFileSync(notificationsPath, "utf-8") || "[]";
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.notifications)) return parsed.notifications;

    return [];
  } catch (e) {
    console.error("readNotifsSafe failed:", e);
    return [];
  }
};

const writeNotifsSafe = (arr) => {
  try {
    ensureNotifsFile();
    const out = Array.isArray(arr) ? arr : [];
    fs.writeFileSync(notificationsPath, JSON.stringify(out, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("writeNotifsSafe failed:", e);
    return false;
  }
};

// ✅ Normalize notification fields (category + urgent) at the backend
const normalizeNotifMeta = (body = {}) => {
  const allowedCategories = new Set([
    "fleet",
    "leave",
    "admin",
    "suggestion",
    "ticket",
    "system",
  ]);

  const rawCategory = String(body.category || body.kind || "").trim().toLowerCase();
  const category = allowedCategories.has(rawCategory) ? rawCategory : "admin";

  const urgent = body.urgent === true; // ONLY explicit true = urgent (no guessing)

  return { category, urgent };
};

// ✉️ POST /notifications — create new notification (normalized meta)
app.post("/notifications", (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const message = String(body.message || "").trim();
    const recipients = Array.isArray(body.recipients)
      ? Array.from(new Set(body.recipients.filter(Boolean).map(String)))
      : [];

    const createdAt =
      body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime())
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString();

    if (!title || !message || recipients.length === 0) {
      return res.status(400).json({ error: "Missing title, message, or recipients" });
    }

    const all = readNotifsSafe();

    // ✅ NEW: normalized fields used by frontend rules
    const { category, urgent } = normalizeNotifMeta(body);

    const newNotification = {
      title,
      message,
      recipients,
      timestamp: createdAt,

      // ✅ normalized meta (frontend can rely on these)
      category, // "fleet" | "leave" | "admin" | "suggestion" | "ticket" | "system"
      urgent,   // boolean
    };

    all.push(newNotification);

    const ok = writeNotifsSafe(all);
    if (!ok) {
      // ✅ Never break the frontend shape
      return res.status(200).json(newNotification);
    }

    return res.status(201).json(newNotification);
  } catch (err) {
    console.error("Failed to create notification:", err);
    // ✅ Never break the frontend shape
    return res.status(200).json([]);
  }
});


/* ===========================
   📩 Notifications send alias starts here
   - LeaveManager currently calls:
       POST /notifications/send
   - Backend already supports:
       POST /notifications
   - This alias keeps old clients working.
   - ✅ Attempts FCM push (non-fatal) if push sender exists.
   - ✅ Attempts Safari Web Push (non-fatal) if webpush sender exists.
   =========================== */
app.post("/notifications/send", async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const message = String(body.message || "").trim();
    const recipients = Array.isArray(body.recipients)
      ? Array.from(new Set(body.recipients.filter(Boolean).map(String)))
      : [];

    const createdAt =
      body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime())
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString();

    if (!title || !message || recipients.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing title, message, or recipients" });
    }

    const all = readNotifsSafe();
    const { category, urgent } = normalizeNotifMeta(body);

    const newNotification = {
      title,
      message,
      recipients,
      timestamp: createdAt,
      category,
      urgent,
    };

    all.push(newNotification);

    const ok = writeNotifsSafe(all);

    /* ===========================
       🔔 Push delivery starts here
       - Fixes: "NO PUSH AT ALL" caused by duplicated code + out-of-scope targets
       - Strategy:
         1) Resolve recipients -> user objects ONCE
         2) Short dedupe window (skip push only, never exit route)
         3) Prefer WebPush if user has subscriptions; otherwise FCM
       =========================== */

    const actionUrl =
      (body?.action?.url && String(body.action.url)) || "/profile";

    try {
      // Resolve recipients[] (ids/names) -> user objects (ONE TIME)
      const allUsers =
        typeof readUsersSafe === "function" ? readUsersSafe() : [];
      const targets = (Array.isArray(allUsers) ? allUsers : []).filter((u) => {
        const id = String(u?.id ?? "").trim();
        const name = String(u?.name ?? "").trim();
        return recipients.includes(id) || recipients.includes(name);
      });

      if (targets.length === 0) {
        console.log(
          "ℹ️ /notifications/send: No matching users for push (in-app notification still saved)."
        );
      } else {
        // ---------- 🔁 Server-side dedupe (short window) ----------
        const dedupeKey = JSON.stringify({
          title,
          message,
          recipients: recipients.slice().sort(),
          url: actionUrl,
          category,
          urgent: !!urgent,
          kind: body?.kind || body?.category || "admin",
        });

        if (!global.__loBoardNotifDedupe) global.__loBoardNotifDedupe = new Map();

        const now = Date.now();
        const last = global.__loBoardNotifDedupe.get(dedupeKey) || 0;

        // clean old keys occasionally (keep map small)
        if (global.__loBoardNotifDedupe.size > 500) {
          for (const [k, t] of global.__loBoardNotifDedupe.entries()) {
            if (now - t > 60_000) global.__loBoardNotifDedupe.delete(k);
          }
        }

        const withinWindow = now - last < 2000;
        if (withinWindow) {
          console.log(
            "🟡 /notifications/send: push deduped (duplicate request window)"
          );
          // ✅ Skip push only; do NOT exit route.
        } else {
          global.__loBoardNotifDedupe.set(dedupeKey, now);

          const hasWebPushSub = (u) => {
            const a = u?.webpushSubscriptions;
            const b = u?.webPushSubscriptions;
            const c = u?.webpushSubs;
            const d = u?.pushSubscriptions;
            return (
              (Array.isArray(a) && a.length > 0) ||
              (Array.isArray(b) && b.length > 0) ||
              (Array.isArray(c) && c.length > 0) ||
              (Array.isArray(d) && d.length > 0)
            );
          };

          const webpushTargets = targets.filter((u) => hasWebPushSub(u));
          const fcmTargets = targets.filter((u) => !hasWebPushSub(u));

          const payloadMeta = {
            category,
            urgent: !!urgent,
            url: actionUrl,
            kind: body?.kind || body?.category || "admin",
          };

          // Helpful logs (won’t crash anything)
          console.log("✅ /notifications/send targets:", {
            total: targets.length,
            webpushTargets: webpushTargets.length,
            fcmTargets: fcmTargets.length,
            sendPushToUsers: typeof sendPushToUsers === "function",
            sendWebPushToUsers: typeof sendWebPushToUsers === "function",
          });

          // 1) Safari / Web Push (only users with subscriptions)
          if (
            webpushTargets.length > 0 &&
            typeof sendWebPushToUsers === "function"
          ) {
            await sendWebPushToUsers(webpushTargets, title, message, payloadMeta);
          }

          // 2) FCM (only users WITHOUT webpush subs)
          if (fcmTargets.length > 0 && typeof sendPushToUsers === "function") {
            await sendPushToUsers(fcmTargets, title, message, payloadMeta);
          }

          if (
            typeof sendPushToUsers !== "function" &&
            typeof sendWebPushToUsers !== "function"
          ) {
            console.log(
              "ℹ️ /notifications/send: push not configured (in-app notification still saved)."
            );
          }
        }
      }
    } catch (pushErr) {
      console.warn(
        "Push skipped/failed for /notifications/send (non-fatal):",
        pushErr?.message || pushErr
      );
    }

    /* ===========================
       🔔 Push delivery ends here
       =========================== */

    // Preserve exact response behavior
    if (!ok) return res.status(200).json(newNotification);
    return res.status(201).json(newNotification);
  } catch (err) {
    console.error("Failed to create notification (/notifications/send):", err);
    // ✅ Never break the frontend shape
    return res.status(200).json([]);
  }
});
/* ===========================
   📩 Notifications send alias ends here
   =========================== */

// 🧭 GET /notifications  (polling supported via ?after=<ISO>)
app.get("/notifications", (req, res) => {
  // ✅ debug log MUST be inside the handler (req exists here)
  console.log("✅ HIT /notifications", new Date().toISOString(), req.query);

  // ✅ absolute safety: this route must NEVER 500 and must ALWAYS return an array
  const safeIsoSec = (v) => {
    try {
      const d = new Date(v);
      if (isNaN(d)) return null;
      // normalize to second precision ISO (matches your isoSec intent)
      return d.toISOString().split(".")[0];
    } catch {
      return null;
    }
  };

  let all = [];
  try {
    const raw = typeof readNotifsSafe === "function" ? readNotifsSafe() : [];
    // Accept either an array OR an object wrapper (just in case)
    if (Array.isArray(raw)) all = raw;
    else if (raw && Array.isArray(raw.notifications)) all = raw.notifications;
    else all = [];
  } catch (err) {
    console.error("Failed to read notifications:", err);
    all = [];
  }

  try {
    const after = req.query?.after;

    // Normalize/filter support:
    // - stored field may be timestamp OR createdAt
    // - query after can be full ISO; we compare at second precision ISO
    if (after) {
      const a =
        typeof isoSec === "function" ? isoSec(after) : safeIsoSec(after);
      if (!a) return res.status(200).json([]); // ✅ keep array shape

      const filtered = all.filter((n) => {
        const ts = n?.timestamp || n?.createdAt || null;
        const t = typeof isoSec === "function" ? isoSec(ts) : safeIsoSec(ts);
        return t && t > a;
      });

      return res.status(200).json(filtered);
    }

    return res.status(200).json(all);
  } catch (err) {
    console.error("Failed to process notifications:", err);
    // ✅ CRITICAL: never break the frontend contract
    return res.status(200).json([]);
  }
});



// ✏️ PATCH /notifications/:timestamp
app.patch("/notifications/:timestamp", (req, res) => {
  try {
    const encoded = req.params.timestamp;
    const decoded = decodeURIComponent(encoded);
    const targetKey = isoSec(decoded);
    if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

    const all = readNotifsSafe();
    const idx = all.findIndex((n) => isoSec(n?.timestamp) === targetKey);
    if (idx === -1) return res.status(404).json({ error: "Notification not found" });

      const body = req.body || {};
    const allowed = [
      "title",
      "message",
      "recipients",
      "kind",
      "action",
      "displayRecipients",
      "status",

      // ✅ NEW: normalized notification meta
      "category",
      "urgent",
    ];

    const current = all[idx];
    const updated = { ...current };
    for (const key of allowed) {
      if (key in body) updated[key] = body[key];
    }

    all[idx] = updated;
    writeNotifsSafe(all);

    return res.json({ success: true, notification: updated });
  } catch (err) {
    console.error("Failed to patch notification:", err);
    return res.status(500).json({ error: "Could not patch notification" });
  }
});

// 🗑️ DELETE /notifications/:timestamp  (delete one)
app.delete("/notifications/:timestamp", (req, res) => {
  try {
    const encoded = req.params.timestamp;
    const decoded = decodeURIComponent(encoded);
    const targetKey = isoSec(decoded);
    if (!targetKey) return res.status(400).json({ error: "Invalid timestamp" });

    const all = readNotifsSafe();
    const updated = all.filter((n) => isoSec(n?.timestamp) !== targetKey);
    writeNotifsSafe(updated);

    console.log("🗑 Deleted notification:", decoded);
    return res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete notification:", err);
    return res.status(500).json({ error: "Could not delete notification" });
  }
});

// 🧹 DELETE /notifications  (clear all, or clear olderThan=<ISO>)
app.delete("/notifications", (req, res) => {
  try {
    const { olderThan } = req.query || {};
    const all = readNotifsSafe();

    if (olderThan) {
      const cutoff = isoSec(olderThan);
      if (!cutoff) return res.status(400).json({ error: "Invalid 'olderThan' timestamp" });

      const kept = all.filter((n) => {
        const t = isoSec(n?.timestamp);
        return t && t >= cutoff;
      });

      writeNotifsSafe(kept);
      return res.json({ success: true, removed: all.length - kept.length, kept: kept.length });
    }

    writeNotifsSafe([]);
    return res.json({ success: true, removed: all.length, kept: 0 });
  } catch (err) {
    console.error("Failed to clear notifications:", err);
    return res.status(500).json({ error: "Could not clear notifications" });
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

      const actionUrl = entry.requesterId
        ? `/settings?resetUser=${encodeURIComponent(entry.requesterId)}`
        : `/settings?resetName=${encodeURIComponent(entry.identifier)}`;

      const newNotification = {
        title,
        message,
        recipients,
        timestamp: new Date().toISOString(),
        kind: "password_reset_request",
        displayRecipients: ["Admins"],
        action: {
          type: "open_user_management",
          userId: entry.requesterId,
          userName: entry.requesterName || entry.identifier,
          url: actionUrl,
        },
      };

      notifications.push(newNotification);
      fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));
      console.log("📣 Admin notification written:", {
        title,
        displayRecipients: newNotification.displayRecipients,
      });
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
console.log("🚨 ROUTE CHECKPOINT 8");
console.log("🚨 ROUTE CHECKPOINT 9");
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
//    Also accepts optional ISO strings: lastOnline, lastLeaveUpdate, tempPasswordExpires, passwordUpdatedAt
app.patch("/users/:id", (req, res) => {
  const { id } = req.params;

  const toInt = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fb;
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // ✅ Small helper: validate + normalize ISO
  const toIso = (v) => {
    const d = new Date(v);
    if (typeof v !== "string" && !(v instanceof Date)) return null;
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  try {
    const data = fs.readFileSync(USERS_FILE, "utf-8");
    const users = JSON.parse(data);

    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const body = req.body || {};
    const u = users[idx];

    /* ===========================
       🔐 Password reset + temp expiry starts here
       - This is what fixes the 410 "Gone" issue.
       - If admin sets a temp password, we MUST:
         - passwordIsTemp = true
         - tempPasswordExpires = future ISO
         - passwordUpdatedAt = now (or provided ISO)
       =========================== */

    const passwordWasSet =
      typeof body.password === "string" && body.password.trim().length > 0;

    if (passwordWasSet) {
      u.password = body.password.trim();
    }

    // Flags can be sent with or without password (support both)
    if (typeof body.forcePasswordChange === "boolean") {
      u.forcePasswordChange = body.forcePasswordChange;
    }
    if (typeof body.requiresPasswordReset === "boolean") {
      u.requiresPasswordReset = body.requiresPasswordReset;
    }
    if (typeof body.passwordIsTemp === "boolean") {
      u.passwordIsTemp = body.passwordIsTemp;
    }

    // Expiry timestamp (validate)
    if (typeof body.tempPasswordExpires !== "undefined") {
      const iso = toIso(body.tempPasswordExpires);
      if (!iso) return res.status(400).json({ error: "Invalid tempPasswordExpires" });
      u.tempPasswordExpires = iso;
    }

    // Password updated timestamp (validate)
    if (typeof body.passwordUpdatedAt !== "undefined") {
      const iso = toIso(body.passwordUpdatedAt);
      if (!iso) return res.status(400).json({ error: "Invalid passwordUpdatedAt" });
      u.passwordUpdatedAt = iso;
    }

    // ✅ If password was set AND reset flow is enabled, ensure temp expiry exists
    // This covers your current UserManagement reset button which only sends
    // password + forcePasswordChange + requiresPasswordReset.
    if (passwordWasSet && (u.requiresPasswordReset === true || u.forcePasswordChange === true)) {
      // Ensure temp marker
      if (typeof u.passwordIsTemp !== "boolean") u.passwordIsTemp = true;
      if (u.passwordIsTemp !== false) u.passwordIsTemp = true;

      // If expiry is missing/invalid/expired, set a fresh TTL
      const ttlHours =
        Number.isFinite(Number(body.tempPasswordTtlHours)) && Number(body.tempPasswordTtlHours) > 0
          ? Number(body.tempPasswordTtlHours)
          : 72;

      const existingExp = Date.parse(u.tempPasswordExpires);
      const now = Date.now();

      if (!Number.isFinite(existingExp) || existingExp <= now) {
        u.tempPasswordExpires = new Date(now + ttlHours * 60 * 60 * 1000).toISOString();
      }

      // Stamp passwordUpdatedAt if not provided
      if (!u.passwordUpdatedAt) {
        u.passwordUpdatedAt = new Date().toISOString();
      }
    }

    // ✅ If user is being converted to a permanent password via this PATCH,
    // allow clearing temp fields explicitly.
    if (body.passwordIsTemp === false) {
      u.tempPasswordExpires = null;
    }

    /* ===========================
       🔐 Password reset + temp expiry ends here
       =========================== */

    // Admin-editable meta
    if (Array.isArray(body.roles)) u.roles = body.roles;
    if (typeof body.description === "string") u.description = body.description;
    if (Array.isArray(body.hiddenRoles)) u.hiddenRoles = body.hiddenRoles;

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
    if (typeof body.lastLeaveUpdate === "string") {
      const iso = toIso(body.lastLeaveUpdate);
      if (iso) u.lastLeaveUpdate = iso;
    }

    // ✅ Optional "lastOnline" passthrough (normalized ISO)
    if (typeof body.lastOnline === "string") {
      const iso = toIso(body.lastOnline);
      if (iso) u.lastOnline = iso;
    }

    u.updatedAt = new Date().toISOString();

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return res.json(u); // keep RAW user response (matches your current frontend expectations)
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

/* ===========================
   🔔 FCM token save starts here
   - Web push tokens rotate sometimes.
   - Keep backward compatibility:
     - users[idx].fcmToken = latest token (string)
     - users[idx].fcmTokens = unique list of tokens (array)
   =========================== */

// ✅ Shared handler (used by both routes below)
const saveFcmTokenForUser = (req, res) => {
  const { id } = req.params;
  const token = String(req.body?.fcmToken || "").trim();

  if (!token) {
    return res.status(400).json({ error: "Missing fcmToken" });
  }

  try {
    const users = readUsersSafe();
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const u = users[idx];

    // ✅ Maintain a list (future-proof) + latest string (backward compatible)
    const prev = Array.isArray(u.fcmTokens) ? u.fcmTokens.map(String) : [];
    const nextSet = new Set(prev.filter(Boolean));
    nextSet.add(token);

    u.fcmToken = token; // ✅ keep your existing sendPushToUsers() logic working
    u.fcmTokens = Array.from(nextSet);
    u.fcmTokenUpdatedAt = new Date().toISOString();
    u.updatedAt = new Date().toISOString();

    users[idx] = u;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return res.json({
      success: true,
      id: String(u.id),
      name: String(u.name || ""),
      fcmTokenUpdatedAt: u.fcmTokenUpdatedAt,
      tokenCount: Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0,
    });
  } catch (err) {
    console.error("Failed to save fcmToken:", err);
    return res.status(500).json({ error: "Failed to save fcmToken" });
  }
};

// ✅ Primary route (current frontend)
app.patch("/users/:id/fcmToken", saveFcmTokenForUser);

// ✅ Alias route (prevents older clients / typos from 404’ing)
app.patch("/users/:id/fcm-token", saveFcmTokenForUser);

/* ===========================
   🔔 FCM token save ends here
   =========================== */

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

  /* ===========================
     🎟️ Ticket Create + Notify
     - Preserves ALL ticket fields as received
     - Fixes undefined `when` bug
     - Supports assignedReporter as string OR array
     =========================== */

  try {
    const raw = fs.readFileSync(TICKETS_FILE, "utf-8");
    const all = JSON.parse(raw || "[]");
    all.push(newTicket);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(all, null, 2));

    // Load users
    const usersRaw = fs.readFileSync(USERS_FILE, "utf-8");
    const allUsers = JSON.parse(usersRaw || "[]");

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

    // ✅ Reporter can be:
    // - "Journalist: Emma Laporte"
    // - ["Emma Laporte"]
    // - ["Journalist: Emma Laporte", "Producer: John"]
    const reporterNames = (() => {
      const v = newTicket.assignedReporter;

      // string: "Role: Name"
      if (typeof v === "string" && v.trim()) {
        const name = v.includes(":") ? v.split(":").slice(1).join(":").trim() : v.trim();
        return name ? [name] : [];
      }

      // array: ["Role: Name", "Name"]
      if (Array.isArray(v)) {
        return v
          .map((s) => {
            const str = String(s || "").trim();
            if (!str) return "";
            return str.includes(":") ? str.split(":").slice(1).join(":").trim() : str;
          })
          .filter(Boolean);
      }

      return [];
    })();

    for (const rn of reporterNames) {
      const reporter = getUserByName(rn);
      if (reporter) recipients.add(reporter);
    }

    // Send push + write in-app notification (for live poll toasts)
    if (recipients.size > 0) {
      const urgent =
        newTicket?.priority === "Urgent" ||
        newTicket?.priority === "High" ||
        newTicket?.urgent === true;

      const ticketId = String(newTicket?.id || "").trim();
      const url = ticketId
        ? `/tickets?ticketId=${encodeURIComponent(ticketId)}`
        : "/tickets";

      // ✅ Push title/body (FCM)
      const pushTitle = `🎥 New Request: ${newTicket.title}`;

      const prettyDate =
        formatDMY(newTicket?.date) || String(newTicket?.date || "").trim();
      const pushBody = `You have been assigned to a new request on ${
        prettyDate || "an upcoming date"
      }.`;

      await sendPushToUsers([...recipients], pushTitle, pushBody, {
        category: "ticket",
        urgent,
        ticketId,
        url,
      });

      // ✅ In-app notification (poll + inbox)
      try {
        const recArr = Array.from(recipients);

        const recIds = recArr
          .map((u) => String(u?.id || "").trim())
          .filter(Boolean);

        const recNames = recArr
          .map((u) => String(u?.name || "").trim())
          .filter(Boolean);

        const notifRecipients = Array.from(new Set([...recIds, ...recNames]));

        const whenRaw = newTicket?.date;
        const whenPretty =
          formatDMYDateTime(whenRaw) ||
          formatDMY(whenRaw) ||
          String(whenRaw || "").trim();

        const loc = String(newTicket?.location || "").trim();

        const notifTitle = "🆕 New Request Created";
        const notifMessage = `${newTicket?.title || "Untitled"}${
          whenPretty ? ` • ${whenPretty}` : ""
        }${loc ? ` • ${loc}` : ""}`;

        // Uses your existing safe helpers
        const allNotifs = readNotifsSafe();
        allNotifs.push({
          title: notifTitle,
          message: notifMessage,
          recipients: notifRecipients,
          timestamp: new Date().toISOString(),
          category: "ticket",
          urgent: !!urgent,
        });
        writeNotifsSafe(allNotifs);
      } catch (e) {
        console.warn(
          "⚠️ In-app ticket notification write failed (non-fatal):",
          e?.message || e
        );
      }
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

  /* ===========================
     🛠️ Ticket Update + Notify
     - Fixes undefined `when` bug in notifMessage
     - Keeps your reporter normalization
     =========================== */

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
      const oldOps = Array.isArray(oldTicket.assignedCamOps)
        ? oldTicket.assignedCamOps
        : normArr(oldTicket.assignedCamOps);
      const newOps = Array.isArray(newTicket.assignedCamOps)
        ? newTicket.assignedCamOps
        : normArr(newTicket.assignedCamOps);

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
      const importantFields = [
        "location",
        "filmingTime",
        "departureTime",
        "assignmentStatus",
        "status",
        "notes",
        "date",
      ];

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
        const urgent =
          newTicket?.priority === "Urgent" ||
          newTicket?.priority === "High" ||
          newTicket?.urgent === true;

        const ticketId = String(newTicket?.id || "").trim();
        const url = ticketId
          ? `/tickets?ticketId=${encodeURIComponent(ticketId)}`
          : "/tickets";

        const pushTitle = `Request Updated: ${newTicket.title}`;
        const pushBody = `One or more updates were made. Check filming, location, or assignment changes.`;

        await sendPushToUsers([...recipients], pushTitle, pushBody, {
          category: "ticket",
          urgent,
          ticketId,
          url,
        });

        // ✅ In-app notification (poll + inbox)
        try {
          const recArr = Array.from(recipients);

          const recIds = recArr
            .map((u) => String(u?.id || "").trim())
            .filter(Boolean);

          const recNames = recArr
            .map((u) => String(u?.name || "").trim())
            .filter(Boolean);

          const notifRecipients = Array.from(new Set([...recIds, ...recNames]));

          const whenRaw = newTicket?.date;
          const whenPretty =
            formatDMYDateTime(whenRaw) ||
            formatDMY(whenRaw) ||
            String(whenRaw || "").trim();

          const loc = String(newTicket?.location || "").trim();

          const notifTitle = "Request updated";
          const notifMessage = `${newTicket?.title || "Untitled"}${
            whenPretty ? ` • ${whenPretty}` : ""
          }${loc ? ` • ${loc}` : ""}`;

          const allNotifs = readNotifsSafe();
          allNotifs.push({
            title: notifTitle,
            message: notifMessage,
            recipients: notifRecipients,
            timestamp: new Date().toISOString(),
            category: "ticket",
            urgent: !!urgent,
          });
          writeNotifsSafe(allNotifs);
        } catch (e) {
          console.warn(
            "⚠️ In-app ticket update notification write failed (non-fatal):",
            e?.message || e
          );
        }
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
// ✅ Serve Vite production build (LOCAL ONLY — Netlify serves frontend in prod)

const IS_RENDER = !!(process.env.RENDER || process.env.ON_RENDER);
const distPath = path.join(__dirname, "../dist");

// ✅ Your Netlify frontend (where /assets live)
const FRONTEND_URL = process.env.FRONTEND_URL || "https://loboard.netlify.app";

// ✅ Only serve dist locally (Render uses Netlify for frontend)
if (!IS_RENDER && fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // Fallback to index.html for frontend routes (React SPA)
  // Make sure API paths are never swallowed.
  app.use((req, res, next) => {
    const knownPrefixes = [
      "/api",

      // auth/users
      "/auth",
      "/users",
      "/users-brief",
      "/users/options",
      "/user-prefs",

      // core data
      "/tickets",
      "/vehicles",
      "/rosters",
      "/calendar",

      /* ===========================
         📰 Team hubs
         =========================== */
      "/hub/newsroom",
      "/hub/sports",

      // notifications/suggestions
      "/notification-groups",
      "/notifications",
      "/suggestions",

      // settings + leave APIs
      "/settings",
      "/leave-requests",
      "/leave",

      // dev / admin tools
      "/seed-vehicles",
      "/force-import-vehicles",
      "/force-import-rosters",
      "/force-import-groups",
      "/send-push",
    ];

    // Always let non-GET (POST/PATCH/DELETE/OPTIONS) pass through
    if (req.method !== "GET") return next();

    // Never SPA-fallback API routes
    if (knownPrefixes.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }

    // Never SPA-fallback real files (assets, css, js, images)
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();

    // Otherwise serve React SPA
    return res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  console.log(
    "🌐 Render mode detected — static dist/ hosting and SPA fallback disabled (Netlify serves frontend)"
  );

  /**
   * ✅ IMPORTANT:
   * If someone opens the Render backend URL in a browser (e.g. /leave-requests),
   * the browser will try to load Vite assets from Render (/assets/*.css, *.js),
   * which causes 404 + MIME type errors.
   *
   * Fix: Redirect "frontend-like" GET requests to Netlify instead.
   * This keeps APIs working and prevents accidental backend-as-frontend usage.
   */
  app.use((req, res, next) => {
    const knownPrefixes = [
      "/api",

      // auth/users
      "/auth",
      "/users",
      "/users-brief",
      "/users/options",
      "/user-prefs",

      // core data
      "/tickets",
      "/vehicles",
      "/rosters",
      "/calendar",

      /* ===========================
         📰 Team hubs
         =========================== */
      "/hub/newsroom",
      "/hub/sports",

      // notifications/suggestions
      "/notification-groups",
      "/notifications",
      "/suggestions",

      // settings + leave APIs
      "/settings",
      "/leave-requests",
      "/leave",

      // dev / admin tools
      "/seed-vehicles",
      "/force-import-vehicles",
      "/force-import-rosters",
      "/force-import-groups",
      "/send-push",
    ];

    // Let API + non-GET pass through normally
    if (req.method !== "GET") return next();
    if (knownPrefixes.some((prefix) => req.path.startsWith(prefix))) return next();

    // If the browser is asking for HTML pages, redirect to the frontend host
    const accept = String(req.headers.accept || "");
    const wantsHtml = accept.includes("text/html") || accept.includes("*/*");

    if (wantsHtml) {
      const target = `${FRONTEND_URL}${req.originalUrl || req.url || "/"}`;
      return res.redirect(302, target);
    }

    // Otherwise, return a clear 404 (prevents MIME type confusion for assets)
    return res.status(404).json({
      error: "Not Found",
      message: "This is the backend API. Frontend is served by Netlify.",
      frontend: FRONTEND_URL,
      path: req.path,
    });
  });
}
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








