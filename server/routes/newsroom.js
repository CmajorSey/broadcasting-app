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

/* ===========================
   🔁 Recurring (global list)
   - Matches frontend:
     GET    /hub/newsroom/recurring
     POST   /hub/newsroom/recurring
     DELETE /hub/newsroom/recurring/:id
   =========================== */

router.get("/recurring", (req, res) => {
  try {
    const doc = readNewsroomSafe();
    return res.json({ recurring: Array.isArray(doc?.recurring) ? doc.recurring : [] });
  } catch (err) {
    console.error("GET /hub/newsroom/recurring failed:", err);
    return res.status(500).json({ error: "Failed to read newsroom recurring list" });
  }
});

router.post("/recurring", (req, res) => {
  try {
    const incoming = req.body || {};
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "Invalid payload (object expected)" });
    }

    const id = safeKey(incoming.id);
    const title = safeKey(incoming.title);
    const presenter = safeKey(incoming.presenter);
    const timeHHMM = safeKey(incoming.timeHHMM);
    const weekdayIndex = Number(incoming.weekdayIndex);
    const startWeekISO = safeKey(incoming.startWeekISO);

    if (!id) return res.status(400).json({ error: "Missing id" });
    if (!title) return res.status(400).json({ error: "Missing title" });
    if (!presenter) return res.status(400).json({ error: "Missing presenter" });
    if (!/^\d{2}:\d{2}$/.test(timeHHMM)) return res.status(400).json({ error: "Invalid timeHHMM (HH:MM)" });
    if (!Number.isFinite(weekdayIndex) || weekdayIndex < 0 || weekdayIndex > 6) {
      return res.status(400).json({ error: "Invalid weekdayIndex (0..6)" });
    }
    if (!startWeekISO) return res.status(400).json({ error: "Missing startWeekISO" });

    const doc = readNewsroomSafe();
    const prev = Array.isArray(doc?.recurring) ? doc.recurring : [];

    // Replace by id if it already exists (idempotent)
    const without = prev.filter((x) => safeKey(x?.id) !== id);
    const nextRecurring = [incoming, ...without];

    const next = { ...doc, recurring: nextRecurring };
    writeNewsroomSafe(next);

    return res.json({ success: true, data: incoming });
  } catch (err) {
    console.error("POST /hub/newsroom/recurring failed:", err);
    return res.status(500).json({ error: "Failed to write newsroom recurring list" });
  }
});

router.delete("/recurring/:id", (req, res) => {
  try {
    const id = safeKey(req.params.id);
    if (!id) return res.status(400).json({ error: "Missing id" });

    const doc = readNewsroomSafe();
    const prev = Array.isArray(doc?.recurring) ? doc.recurring : [];

    const nextRecurring = prev.filter((x) => safeKey(x?.id) !== id);
    const next = { ...doc, recurring: nextRecurring };

    writeNewsroomSafe(next);
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /hub/newsroom/recurring/:id failed:", err);
    return res.status(500).json({ error: "Failed to delete newsroom recurring item" });
  }
});

export default router;
