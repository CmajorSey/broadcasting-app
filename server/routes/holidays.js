// server/routes/holidays.js
// Fetch + normalize public holidays to [{ date: "YYYY-MM-DD", name }]
// Sources supported: Google Calendar ICS (via googleCalendarId), custom ICS URL, Nager.Date
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data dir and files
const DATA_DIR = path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const HOLIDAYS_FILE = path.join(DATA_DIR, "holidays.json");

// Helpers: read/write JSON safely
function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Date helpers
const pad2 = (n) => String(n).padStart(2, "0");
function toISODateUTC(d) {
  // format to YYYY-MM-DD in UTC
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}-${m}-${day}`;
}
function normalizeDateToken(v) {
  // Accept "YYYYMMDD" or "YYYYMMDDTHHMMSSZ" or with timezone-less
  if (!v) return null;
  // VALUE=DATE like 20250101
  if (/^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6));
    const d = Number(v.slice(6, 8));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return toISODateUTC(dt);
  }
  // DATE-TIME like 20250101T000000Z or 20250101T000000
  const m = v.match(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?(Z)?$/
  );
  if (m) {
    const [, yy, MM, DD, hh = "00", mm = "00", ss = "00", z] = m;
    if (z === "Z") {
      const dt = new Date(
        Date.UTC(+yy, +MM - 1, +DD, +hh, +mm, +ss)
      );
      return toISODateUTC(dt);
    } else {
      // treat as local time; convert to UTC day
      const dt = new Date(+yy, +MM - 1, +DD, +hh, +mm, +ss);
      return toISODateUTC(new Date(Date.UTC(
        dt.getFullYear(), dt.getMonth(), dt.getDate()
      )));
    }
  }
  // Fallback: try native parse
  const dt = new Date(v);
  if (!isNaN(dt)) return toISODateUTC(new Date(Date.UTC(
    dt.getFullYear(), dt.getMonth(), dt.getDate()
  )));
  return null;
}

// Minimal ICS parser (VEVENT only: DTSTART/DTEND/SUMMARY; supports folded lines)
function parseICS(icsText) {
  const linesRaw = icsText.split(/\r?\n/);
  // unfold folded lines: any line starting with space/tab is a continuation
  const lines = [];
  for (const line of linesRaw) {
    if (/^[ \t]/.test(line) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  const events = [];
  let inEvent = false;
  let cur = {};
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
    } else if (line === "END:VEVENT") {
      inEvent = false;
      if (cur.dtstart && cur.summary) events.push(cur);
      cur = {};
    } else if (inEvent) {
      const [rawKey, ...rest] = line.split(":");
      const value = rest.join(":"); // keep anything after first colon
      const key = (rawKey || "").toUpperCase();

      if (key.startsWith("DTSTART")) {
        // Could be DTSTART;VALUE=DATE or DTSTART;TZID=...
        cur.dtstart = normalizeDateToken(value);
      } else if (key.startsWith("DTEND")) {
        cur.dtend = normalizeDateToken(value);
      } else if (key === "SUMMARY") {
        cur.summary = value || "";
      }
    }
  }
  // Map to { date, name } — for all-day holidays, DTSTART is enough
  // If multi-day, mark each day from dtstart..(dtend-1)
  const out = [];
  for (const ev of events) {
    const name = String(ev.summary || "").trim() || "Holiday";
    const start = ev.dtstart ? new Date(ev.dtstart + "T00:00:00Z") : null;
    const end = ev.dtend ? new Date(ev.dtend + "T00:00:00Z") : null;
    if (!start) continue;

    if (end && end > start) {
      // expand range [start, end)
      for (
        let d = new Date(start);
        d < end;
        d = new Date(d.getTime() + 86400000)
      ) {
        out.push({ date: toISODateUTC(d), name });
      }
    } else {
      out.push({ date: toISODateUTC(start), name });
    }
  }
  // dedupe by date+name
  const seen = new Set();
  return out.filter(({ date, name }) => {
    const k = `${date}__${name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

// Build ICS URL from a Google Calendar ID
function googleICSFromId(id) {
  if (!id) return null;
  const trimmed = String(id).trim();
  // If user pasted a full ICS URL, just return it as-is
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(trimmed)}/public/basic.ics`;
}


function currentYearRange() {
  const now = new Date();
  const yr = now.getUTCFullYear();
  return [yr - 1, yr, yr + 1]; // include prev + next to cover edge cases
}

async function pullFromGoogleICS(googleCalendarId) {
  const url = googleICSFromId(googleCalendarId);
  if (!url) return [];
  const txt = await fetchText(url);
  return parseICS(txt);
}

async function pullFromCustomICS(icsUrl) {
  if (!icsUrl) return [];
  const txt = await fetchText(icsUrl);
  return parseICS(txt);
}

async function pullFromNagerDate(countryCode = "SC") {
  const years = currentYearRange();
  const all = [];
  for (const y of years) {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${y}/${encodeURIComponent(
      countryCode
    )}`;
    try {
      const arr = await fetchJSON(url);
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it && it.date && it.localName) {
            all.push({ date: it.date, name: it.localName });
          }
        }
      }
    } catch (e) {
      // continue on network errors (some years may be missing)
    }
  }
  // dedupe
  const seen = new Set();
  return all.filter(({ date, name }) => {
    const k = `${date}__${name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const router = Router();

// GET /holidays -> normalized list
router.get("/", (req, res) => {
  const list = readJson(HOLIDAYS_FILE, []);
  res.json(Array.isArray(list) ? list : []);
});

// POST /holidays/refresh -> pulls from source based on settings.json
router.post("/refresh", async (req, res) => {
  const settings = readJson(SETTINGS_FILE, {});
  const src = settings?.holidaySource || {};
  const provider = String(src.provider || "google_calendar");
  const country = src.countryCode || "SC";

  try {
    let list = [];

    if (provider === "google_calendar") {
      if (!src.googleCalendarId) {
        return res.status(400).json({
          error: "Missing Google Calendar ID",
          hint: "Set holidaySource.googleCalendarId in settings.",
          example: "en.sc.official#holiday@group.v.calendar.google.com",
        });
      }
      try {
        // If user pasted a full ICS URL into googleCalendarId, our helper returns it as-is
        const url = googleICSFromId(src.googleCalendarId);
        if (!url) throw new Error("Invalid Google Calendar ID/URL");
        // If it's actually an ICS URL, this still works:
        const txt = await fetchText(url);
        list = parseICS(txt);
      } catch (e) {
        console.warn("Google ICS pull failed:", String(e?.message || e));
        return res.status(502).json({
          error: "Google ICS fetch failed",
          details: String(e?.message || e),
        });
      }
    } else if (provider === "ics") {
      if (!src.icsUrl) {
        return res.status(400).json({
          error: "Missing ICS URL",
          hint: "Set holidaySource.icsUrl in settings.",
        });
      }
      try {
        list = await pullFromCustomICS(src.icsUrl);
      } catch (e) {
        console.warn("Custom ICS pull failed:", String(e?.message || e));
        return res.status(502).json({
          error: "Custom ICS fetch failed",
          details: String(e?.message || e),
        });
      }
    } else if (provider === "nager_date") {
      try {
        list = await pullFromNagerDate(country);
      } catch (e) {
        console.warn("Nager.Date pull failed:", String(e?.message || e));
        return res.status(502).json({
          error: "Nager.Date fetch failed",
          details: String(e?.message || e),
        });
      }
    } else {
      return res.status(400).json({
        error: "Unknown provider",
        provider,
        hint: 'Use "google_calendar", "ics", or "nager_date".',
      });
    }

    list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    writeJson(HOLIDAYS_FILE, list);
    return res.json({ success: true, count: list.length, holidays: list });
  } catch (e) {
    console.error("Failed to refresh holidays:", e);
    return res.status(500).json({
      error: "Failed to refresh holidays",
      details: String(e?.message || e),
    });
  }
});



export default router;
