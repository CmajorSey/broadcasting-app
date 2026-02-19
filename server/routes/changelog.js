import express from "express";
import {
  readChangelogSafe,
  writeChangelogSafe,
  normalizeEntry,
  isValidEntry,
} from "../utils/changelogStore.js";

const router = express.Router();

/* ===========================
   ✅ Debug: confirm correct router file is running
   =========================== */
console.log("✅ changelogRouter LOADED:", import.meta.url);

/* ===========================
   📜 Changelog Router
   Base: /changelog
   File: DATA_DIR/changelog.json
   =========================== */

// GET full changelog doc
router.get("/", (req, res) => {
  try {
    const doc = readChangelogSafe();
    return res.json(doc);
  } catch (err) {
    console.error("GET /changelog failed:", err);
    return res.status(500).json({ error: "Failed to read changelog" });
  }
});

// GET items only (handy for client)
router.get("/items", (req, res) => {
  try {
    const doc = readChangelogSafe();
    return res.json(doc.items || []);
  } catch (err) {
    console.error("GET /changelog/items failed:", err);
    return res.status(500).json({ error: "Failed to read changelog items" });
  }
});

/* ===========================
   ✅ System Admin: Add release note entry
   POST /changelog/items
   - Upserts entry into changelog.json (dedupe by version)
   - Sets latestVersion = entry.version
   - Guard: only allow Christopher Gabriel + Admin
   =========================== */
router.post("/items", (req, res) => {
  try {
    const actorName =
      String(req.header("x-lo-user") || req.body?.actorName || "").trim();

    const ALLOWED = new Set(["Christopher Gabriel", "Admin"]);
    if (!ALLOWED.has(actorName)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rawEntry = req.body?.entry || req.body || {};
    const entry = normalizeEntry(rawEntry);

    if (!isValidEntry(entry)) {
      return res.status(400).json({
        error: "Invalid entry",
        hint: "Expected: { version, date, title, sections[] } (or your normalizeEntry must map changes[] -> sections[])",
      });
    }

    const doc = readChangelogSafe();
    const items = Array.isArray(doc.items) ? doc.items : [];

    // ✅ Remove any existing item with same version (so re-submit replaces)
    const nextItems = items.filter(
      (it) => String(it?.version || "").trim() !== entry.version
    );
    nextItems.unshift(entry);

    const nextDoc = {
      ...doc,
      latestVersion: entry.version,
      items: nextItems,
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    };

    writeChangelogSafe(nextDoc);
    return res.json(nextDoc);
  } catch (err) {
    console.error("POST /changelog/items failed:", err);
    return res.status(500).json({ error: "Failed to write changelog" });
  }
});

// POST append/replace an entry by version (System Admin only)
router.post("/", (req, res) => {
  try {
    const actorName =
      String(req.header("x-lo-user") || req.body?.actorName || "").trim();

    const ALLOWED = new Set(["Christopher Gabriel", "Admin"]);
    if (!ALLOWED.has(actorName)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rawEntry = req.body?.entry || req.body || {};
    const entry = normalizeEntry(rawEntry);

    if (!isValidEntry(entry)) {
      return res.status(400).json({
        error: "Invalid entry",
        hint: "Expected: { version, date, title, sections[] } (or normalizeEntry maps changes[] -> sections[])",
      });
    }

    const doc = readChangelogSafe();
    const items = Array.isArray(doc.items) ? doc.items : [];

    // De-dup by version (replace existing version)
    const filtered = items.filter(
      (it) => String(it?.version || "").trim() !== entry.version
    );

    const nextDoc = {
      ...doc,
      latestVersion: entry.version,
      items: [entry, ...filtered],
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    };

    const ok = writeChangelogSafe(nextDoc);
    if (!ok) return res.status(500).json({ error: "Failed to write changelog" });

    return res.json(nextDoc);
  } catch (err) {
    console.error("POST /changelog failed:", err);
    return res.status(500).json({ error: "Failed to save changelog" });
  }
});

export default router;

