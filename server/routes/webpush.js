import express from "express";
import fs from "fs";
import path from "path";
import webpush from "web-push";

const router = express.Router();

/* ===========================
   📦 Web Push storage
   =========================== */
const dataDir = path.resolve(process.cwd(), "data");
const subsPath = path.join(dataDir, "webpushSubscriptions.json");

function ensureFile() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(subsPath)) fs.writeFileSync(subsPath, "[]", "utf8");
  } catch {
    // ignore
  }
}

function readSubs() {
  ensureFile();
  try {
    const raw = fs.readFileSync(subsPath, "utf8");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSubs(list) {
  ensureFile();
  fs.writeFileSync(subsPath, JSON.stringify(list, null, 2), "utf8");
}

/* ===========================
   🔐 VAPID setup (Render env)
   =========================== */
const PUBLIC_KEY = process.env.WEBPUSH_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.WEBPUSH_PRIVATE_KEY || "";
const SUBJECT = process.env.WEBPUSH_SUBJECT || "mailto:admin@loboard.app";

if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
}

/* ===========================
   ✅ POST /webpush/subscribe
   Body: { userId, userName?, subscription }
   =========================== */
router.post("/subscribe", (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const userName = String(req.body?.userName || "").trim();
    const subscription = req.body?.subscription;

    if (!PUBLIC_KEY || !PRIVATE_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Web Push VAPID keys missing on server. Set WEBPUSH_PUBLIC_KEY and WEBPUSH_PRIVATE_KEY in Render.",
      });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId is required" });
    }
    if (!subscription || !subscription.endpoint) {
      return res
        .status(400)
        .json({ ok: false, error: "subscription is required" });
    }

    const list = readSubs();

    // Remove duplicates: same endpoint, keep latest metadata
    const filtered = list.filter(
      (x) => String(x?.subscription?.endpoint || "") !== String(subscription.endpoint || "")
    );

    filtered.push({
      userId,
      userName,
      subscription,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    writeSubs(filtered);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

/* ===========================
   🧪 OPTIONAL: POST /webpush/test
   - Sends a test push to all subscriptions for userId
   Body: { userId, title?, body? }
   =========================== */
router.post("/test", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const title = String(req.body?.title || "Lo Board").trim();
    const body = String(req.body?.body || "Test notification").trim();

    if (!PUBLIC_KEY || !PRIVATE_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Web Push VAPID keys missing on server. Set WEBPUSH_PUBLIC_KEY and WEBPUSH_PRIVATE_KEY in Render.",
      });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId is required" });
    }

    const list = readSubs().filter((x) => String(x?.userId) === userId);

    if (!list.length) {
      return res.json({ ok: true, sent: 0, message: "No subscriptions for user" });
    }

    const payload = JSON.stringify({ title, body });

    let sent = 0;
    const keep = [];

    for (const item of list) {
      try {
        await webpush.sendNotification(item.subscription, payload);
        sent += 1;
        keep.push(item);
      } catch (err) {
        // Drop dead subscriptions (410 Gone / 404 Not Found commonly)
        const code = err?.statusCode;
        if (code !== 410 && code !== 404) keep.push(item);
      }
    }

    // Merge keep for that user back into full list (and remove dead ones)
    const all = readSubs().filter((x) => String(x?.userId) !== userId);
    writeSubs([...all, ...keep]);

    return res.json({ ok: true, sent });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

export default router;