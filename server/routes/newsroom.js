import express from "express";
import { readNewsroomSafe, writeNewsroomSafe } from "../utils/newsroomStore.js";

const router = express.Router();

/* ===========================
   📰 Newsroom Hub API
   - Stores data by weekStartISO
   - File: /data/newsroom.json
   =========================== */

const safeKey = (v) => String(v || "").trim();

router.get("/", (req, res) => {
  try {
    const doc = readNewsroomSafe();
    return res.json(doc);
  } catch (err) {
    console.error("GET /hub/newsroom failed:", err);
    return res.status(500).json({ error: "Failed to read newsroom store" });
  }
});

router.get("/:weekStart", (req, res) => {
  try {
    const weekStart = safeKey(req.params.weekStart);
    if (!weekStart) return res.status(400).json({ error: "Missing weekStart" });

    const doc = readNewsroomSafe();
    const week = doc?.weeks?.[weekStart] || null;

    return res.json({ weekStart, data: week });
  } catch (err) {
    console.error("GET /hub/newsroom/:weekStart failed:", err);
    return res.status(500).json({ error: "Failed to read newsroom week" });
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

    const doc = readNewsroomSafe();
    const next = {
      ...doc,
      weeks: {
        ...(doc.weeks || {}),
        [weekStart]: incoming,
      },
    };

    writeNewsroomSafe(next);
    return res.json({ success: true, weekStart, data: next.weeks[weekStart] });
  } catch (err) {
    console.error("PATCH /hub/newsroom/:weekStart failed:", err);
    return res.status(500).json({ error: "Failed to write newsroom week" });
  }
});

export default router;
