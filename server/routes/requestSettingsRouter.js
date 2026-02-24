import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

/* ===========================
   🧾 Request Settings Store
   - Persists request form picklists to disk
   - Used by TicketForm for News/Sports categories
   =========================== */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "request-settings.json");

const DEFAULTS = {
  newsCategories: ["Press Conference", "Interview"],
  sportsCategories: ["Football", "Basketball", "Training", "Match"],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(DEFAULTS, null, 2), "utf-8");
  }
}

function readSafe() {
  ensureFile();
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    const data = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULTS,
      ...(data && typeof data === "object" ? data : {}),
      newsCategories: Array.isArray(data?.newsCategories)
        ? data.newsCategories.map((x) => String(x || "").trim()).filter(Boolean)
        : DEFAULTS.newsCategories,
      sportsCategories: Array.isArray(data?.sportsCategories)
        ? data.sportsCategories.map((x) => String(x || "").trim()).filter(Boolean)
        : DEFAULTS.sportsCategories,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSafe(next) {
  ensureFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify(next, null, 2), "utf-8");
}

router.get("/", (req, res) => {
  const data = readSafe();
  res.json(data);
});

router.patch("/", (req, res) => {
  const current = readSafe();
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // Only allow these keys to be updated
  const next = {
    ...current,
    ...(body.newsCategories ? { newsCategories: body.newsCategories } : {}),
    ...(body.sportsCategories ? { sportsCategories: body.sportsCategories } : {}),
  };

  // Normalize
  next.newsCategories = Array.isArray(next.newsCategories)
    ? Array.from(
        new Set(next.newsCategories.map((x) => String(x || "").trim()).filter(Boolean))
      )
    : current.newsCategories;

  next.sportsCategories = Array.isArray(next.sportsCategories)
    ? Array.from(
        new Set(next.sportsCategories.map((x) => String(x || "").trim()).filter(Boolean))
      )
    : current.sportsCategories;

  writeSafe(next);
  res.json(next);
});

export default router;