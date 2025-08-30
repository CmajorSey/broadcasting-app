// routes/user-prefs.js
import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

// Resolve /data/users.json regardless of CWD
const DATA_DIR = "/data";
const USERS_PATH = path.join(DATA_DIR, "users.json");

// Helper: read JSON safely
function readJson(p) {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("[user-prefs] read error:", e.message);
    return [];
  }
}

// Helper: write JSON safely
function writeJson(p, data) {
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("[user-prefs] write error:", e.message);
    return false;
  }
}

/**
 * PATCH /user-prefs/:id
 * Body: { preferredTimeFormat: "12h" | "24h" }
 */
router.patch("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { preferredTimeFormat } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing user id" });
    if (preferredTimeFormat && !["12h", "24h"].includes(preferredTimeFormat)) {
      return res.status(400).json({ error: "Invalid preferredTimeFormat" });
    }

    const users = readJson(USERS_PATH);
    const idx = users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const current = users[idx];
    const updated = {
      ...current,
      ...(preferredTimeFormat ? { preferredTimeFormat } : {}),
    };
    users[idx] = updated;

    if (!writeJson(USERS_PATH, users)) {
      return res.status(500).json({ error: "Failed to write users file" });
    }

    return res.json({ ok: true, user: updated });
  } catch (e) {
    console.error("[user-prefs] patch error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
