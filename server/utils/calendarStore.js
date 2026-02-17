import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ===========================
   🗂️ Calendar Store (single source of truth)
   - File-based storage (Render: /data, Local: ./data)
   - Always stores dates as ISO (YYYY-MM-DD / ISO timestamps)
   =========================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Match index.js storage behavior (Render => /data, local => ./data)
export const DATA_DIR =
  process.env.DATA_DIR ||
  ((process.env.RENDER || process.env.ON_RENDER) ? "/data" : path.join(__dirname, "../data"));

export const CALENDAR_FILE = path.join(DATA_DIR, "calendar.json");

// Default calendar store (future-proof; storage stays ISO)
export const DEFAULT_CALENDAR = {
  seasons: [
    { id: "season_pre", name: "Pre-Season", startMonth: 1, endMonth: 2, order: 1, active: true },
    { id: "season_1", name: "Season 1", startMonth: 3, endMonth: 5, order: 2, active: true },
    { id: "season_2", name: "Season 2", startMonth: 6, endMonth: 8, order: 3, active: true },
    { id: "season_3", name: "Season 3", startMonth: 9, endMonth: 11, order: 4, active: true },
    { id: "season_festive", name: "Festive Season", startMonth: 12, endMonth: 12, order: 5, active: true },
  ],
  genres: [
    { id: "genre_reality", name: "Reality", active: true },
    { id: "genre_documentary", name: "Documentary", active: true },
    { id: "genre_culinary", name: "Culinary", active: true },
    { id: "genre_talkshow", name: "Talk Show", active: true },
    { id: "genre_entertainment", name: "Entertainment", active: true },
    { id: "genre_sports", name: "Sports", active: true },
    { id: "genre_news", name: "News", active: true },
  ],

  /* ===========================
     🧾 Proposed + Series (NEW)
     - proposed: proposed pool items
     - series: confirmed scheduled series
     =========================== */
  proposed: [],
  series: [],

  /* ===========================
     ♻️ Back-compat keys (KEEP)
     - Some older UI/routes may still write here
     =========================== */
  programs: [],
  events: [],

  meta: { version: "0.1", updatedAt: "" },
};

/* ===========================
   🧰 Helpers
   =========================== */

export const safeStr = (v) => (v === null || v === undefined ? "" : String(v)).trim();

export const safeInt = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
};

export const isYMD = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const ensureCalendarFile = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CALENDAR_FILE)) {
      fs.writeFileSync(CALENDAR_FILE, JSON.stringify(DEFAULT_CALENDAR, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("ensureCalendarFile failed:", e);
  }
};

export const readCalendarSafe = () => {
  try {
    ensureCalendarFile();
    const raw = fs.readFileSync(CALENDAR_FILE, "utf-8") || "{}";
    const parsed = JSON.parse(raw);

    // Merge defaults for safety (never break frontend expectations)
    const out = {
      ...DEFAULT_CALENDAR,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };

        // Guard shapes
    out.seasons = Array.isArray(out.seasons) ? out.seasons : DEFAULT_CALENDAR.seasons;
    out.genres = Array.isArray(out.genres) ? out.genres : DEFAULT_CALENDAR.genres;

    // ✅ New canonical keys
    out.proposed = Array.isArray(out.proposed) ? out.proposed : [];
    out.series = Array.isArray(out.series) ? out.series : [];

    // ♻️ Back-compat keys (keep existing behavior intact)
    out.programs = Array.isArray(out.programs) ? out.programs : [];
    out.events = Array.isArray(out.events) ? out.events : [];

    /*
      ===========================
      🔁 Compatibility aliasing
      - If older routes saved Proposed into "programs", expose it as "proposed"
      - If older routes saved Series into "events", expose it as "series"
      ===========================
    */
    if (out.proposed.length === 0 && out.programs.length > 0) {
      out.proposed = out.programs;
    }
    if (out.series.length === 0 && out.events.length > 0) {
      out.series = out.events;
    }

    out.meta = out.meta && typeof out.meta === "object" ? out.meta : { ...DEFAULT_CALENDAR.meta };

    return out;
  } catch (e) {
    console.error("readCalendarSafe failed:", e);
    return { ...DEFAULT_CALENDAR };
  }
};
console.log("📅 calendarStore DATA_DIR:", DATA_DIR);
console.log("📅 calendarStore file:", CALENDAR_FILE);


export const writeCalendarSafe = (obj) => {
  try {
    ensureCalendarFile();
    const current = readCalendarSafe();

    const next = {
      ...current,
      ...(obj && typeof obj === "object" ? obj : {}),
    };

    next.meta = next.meta && typeof next.meta === "object" ? next.meta : { ...DEFAULT_CALENDAR.meta };
    next.meta.updatedAt = new Date().toISOString();

    fs.writeFileSync(CALENDAR_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  } catch (e) {
    console.error("writeCalendarSafe failed:", e);
    return null;
  }
};
