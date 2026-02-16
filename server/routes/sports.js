import express from "express";
import { readSportsSafe, writeSportsSafe } from "../utils/sportsStore.js";

const router = express.Router();

/* ===========================
   🏈 Sports Hub API
   - Stores data by weekStartISO
   - File: /data/sports.json
   =========================== */

const safeKey = (v) => String(v || "").trim();

router.get("/", (req, res) => {
  try {
    const doc = readSportsSafe();
    return res.json(doc);
  } catch (err) {
    console.error("GET /hub/sports failed:", err);
    return res.status(500).json({ error: "Failed to read sports store" });
  }
});

router.get("/:weekStart", (req, res) => {
  try {
    const weekStart = safeKey(req.params.weekStart);
    if (!weekStart) return res.status(400).json({ error: "Missing weekStart" });

    const doc = readSportsSafe();
    const week = doc?.weeks?.[weekStart] || null;

    return res.json({ weekStart, data: week });
  } catch (err) {
    console.error("GET /hub/sports/:weekStart failed:", err);
    return res.status(500).json({ error: "Failed to read sports week" });
  }
});

router.patch("/:weekStart", (req, res) => {
  try {
    const weekStart = safeKey(req.params.weekStart);
    if (!weekStart) return res.status(400).json({ error: "Missing weekStart" });

    const incoming = req.body || {};
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "Invalid payload (object expected)" });
    }

    const doc = readSportsSafe();
    const next = {
      ...doc,
      weeks: {
        ...(doc.weeks || {}),
        [weekStart]: incoming,
      },
    };

    writeSportsSafe(next);
    return res.json({ success: true, weekStart, data: next.weeks[weekStart] });
  } catch (err) {
    console.error("PATCH /hub/sports/:weekStart failed:", err);
    return res.status(500).json({ error: "Failed to write sports week" });
  }
});

export default router;
