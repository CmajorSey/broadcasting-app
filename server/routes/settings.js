// server/routes/settings.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(process.cwd(), "server", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Helpers
function readJSON(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Defaults aligned to your current settings.json
const DEFAULTS = {
  siteName: "Byenveni Lo Board",
  holidaySource: {
    provider: "google_calendar",
    countryCode: "SC",
    googleCalendarId: "en.sc.official#holiday@group.v.calendar.google.com",
    icsUrl: ""
  },
  rules: {
    after4pmCounts: 0.5,
    saturdayCounts: 1,
    sundayCounts: 1,
    publicHolidayCounts: 1,
    // your custom flags:
    after4pmOnlyForNonAfternoon: true,
    afternoonShiftRoleKeys: "afternoon,afternoon_shift"
  }
};

// GET /settings
router.get("/", (req, res) => {
  const cfg = readJSON(SETTINGS_FILE, DEFAULTS);
  // ensure missing nested objects don’t crash UI
  cfg.holidaySource = { ...DEFAULTS.holidaySource, ...(cfg.holidaySource || {}) };
  cfg.rules = { ...DEFAULTS.rules, ...(cfg.rules || {}) };
  res.json(cfg);
});

// PATCH /settings
// Merges shallowly at root, and shallowly inside holidaySource + rules
router.patch("/", (req, res) => {
  const current = readJSON(SETTINGS_FILE, DEFAULTS);

  const next = { ...current, ...req.body };

  if (req.body?.holidaySource) {
    next.holidaySource = { ...current.holidaySource, ...req.body.holidaySource };
  }
  if (req.body?.rules) {
    next.rules = { ...current.rules, ...req.body.rules };
  }

  writeJSON(SETTINGS_FILE, next);
  res.json(next);
});

export default router;
