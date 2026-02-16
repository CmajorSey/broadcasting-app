import express from "express";
import {
  readCalendarSafe,
  writeCalendarSafe,
  ensureCalendarFile,
  safeStr,
  safeInt,
  isYMD,
} from "../utils/calendarStore.js";
const router = express.Router();

/* ===========================
   📅 Calendar Router
   Single source of truth: calendarStore.js
   =========================== */

// ----------------------
// ✅ Base endpoints
// ----------------------

// Full calendar store (good for initial calendar UI)
router.get("/", (req, res) => {
  const store = readCalendarSafe();
  return res.json(store);
});

// ----------------------
// ✅ Seasons
// ----------------------
router.get("/seasons", (req, res) => {
  const store = readCalendarSafe();
  return res.json(store.seasons || []);
});

router.post("/seasons", (req, res) => {
  const store = readCalendarSafe();
  const body = req.body || {};

  const name = safeStr(body.name);
  const startMonth = safeInt(body.startMonth, 1);
  const endMonth = safeInt(body.endMonth, 1);

  if (!name) return res.status(400).json({ error: "Missing season name" });
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) {
    return res.status(400).json({ error: "Invalid startMonth/endMonth (1–12)" });
  }

  const id = safeStr(body.id) || `season_${Date.now()}`;
  const order = safeInt(body.order, (store.seasons?.length || 0) + 1);

  const newSeason = {
    id,
    name,
    startMonth,
    endMonth,
    order,
    active: body.active !== false,
  };

  store.seasons = Array.isArray(store.seasons) ? store.seasons : [];
  store.seasons.push(newSeason);

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save season" });
  return res.status(201).json(newSeason);
});

router.patch("/seasons/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const seasons = Array.isArray(store.seasons) ? store.seasons : [];

  const idx = seasons.findIndex((s) => String(s.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "Season not found" });

  const body = req.body || {};
  const updated = { ...seasons[idx] };

  if (typeof body.name === "string") updated.name = safeStr(body.name);
  if (typeof body.active === "boolean") updated.active = body.active;

  if (typeof body.startMonth !== "undefined") {
    const sm = safeInt(body.startMonth, updated.startMonth);
    if (sm < 1 || sm > 12) return res.status(400).json({ error: "Invalid startMonth (1–12)" });
    updated.startMonth = sm;
  }

  if (typeof body.endMonth !== "undefined") {
    const em = safeInt(body.endMonth, updated.endMonth);
    if (em < 1 || em > 12) return res.status(400).json({ error: "Invalid endMonth (1–12)" });
    updated.endMonth = em;
  }

  if (typeof body.order !== "undefined") updated.order = safeInt(body.order, updated.order);

  seasons[idx] = updated;
  store.seasons = seasons;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save season" });
  return res.json({ success: true, season: updated });
});

// ----------------------
// ✅ Genres
// ----------------------
router.get("/genres", (req, res) => {
  const store = readCalendarSafe();
  return res.json(store.genres || []);
});

router.post("/genres", (req, res) => {
  const store = readCalendarSafe();
  const body = req.body || {};

  const name = safeStr(body.name);
  if (!name) return res.status(400).json({ error: "Missing genre name" });

  const id = safeStr(body.id) || `genre_${Date.now()}`;
  const newGenre = { id, name, active: body.active !== false };

  store.genres = Array.isArray(store.genres) ? store.genres : [];
  store.genres.push(newGenre);

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save genre" });
  return res.status(201).json(newGenre);
});

router.patch("/genres/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const genres = Array.isArray(store.genres) ? store.genres : [];

  const idx = genres.findIndex((g) => String(g.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "Genre not found" });

  const body = req.body || {};
  const updated = { ...genres[idx] };
  if (typeof body.name === "string") updated.name = safeStr(body.name);
  if (typeof body.active === "boolean") updated.active = body.active;

  genres[idx] = updated;
  store.genres = genres;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save genre" });
  return res.json({ success: true, genre: updated });
});

// ----------------------
// ✅ Programs
// ----------------------
router.get("/programs", (req, res) => {
  const store = readCalendarSafe();

  // Optional filter: ?status=proposed|approved|scheduled
  const { status } = req.query || {};
  let programs = Array.isArray(store.programs) ? store.programs : [];

  if (status) {
    programs = programs.filter((p) => String(p.status || "") === String(status));
  }

  return res.json(programs);
});

router.post("/programs", (req, res) => {
  const store = readCalendarSafe();
  const body = req.body || {};

  /* ===========================
     📺 Programs (drafts allowed)
     =========================== */

  // ✅ Allow saving drafts/proposed programs with empty fields
  const title = safeStr(body.title) || "";

  const newProgram = {
    id: safeStr(body.id) || `prog_${Date.now()}`,
    title,
    episodes: Math.max(0, safeInt(body.episodes, 0)),
    genreId: safeStr(body.genreId) || null,
    seasonId: safeStr(body.seasonId) || null,
    status: safeStr(body.status) || "proposed", // proposed | approved | scheduled
    notes: safeStr(body.notes) || "",
    createdBy: safeStr(body.createdBy) || "Unknown",
    createdAt:
      body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime())
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.programs = Array.isArray(store.programs) ? store.programs : [];
  store.programs.push(newProgram);

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save program" });
  return res.status(201).json(newProgram);
});

router.patch("/programs/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];

  const idx = programs.findIndex((p) => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "Program not found" });

  const body = req.body || {};
  const updated = { ...programs[idx] };

  if (typeof body.title === "string") updated.title = safeStr(body.title);
  if (typeof body.episodes !== "undefined")
    updated.episodes = Math.max(0, safeInt(body.episodes, updated.episodes));
  if (typeof body.genreId !== "undefined") updated.genreId = safeStr(body.genreId) || null;
  if (typeof body.seasonId !== "undefined") updated.seasonId = safeStr(body.seasonId) || null;
  if (typeof body.status === "string") updated.status = safeStr(body.status) || updated.status;
  if (typeof body.notes === "string") updated.notes = safeStr(body.notes);

  updated.updatedAt = new Date().toISOString();

  programs[idx] = updated;
  store.programs = programs;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save program" });
  return res.json({ success: true, program: updated });
});

router.delete("/programs/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];

  const next = programs.filter((p) => String(p.id) !== String(id));
  if (next.length === programs.length) return res.status(404).json({ error: "Program not found" });

  store.programs = next;
  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to delete program" });

  return res.json({ success: true });
});

/* ===========================
   ✅ Proposed Programs Alias (optional)
   - Uses same storage as programs[]
   - Proposed Pool == programs with status="proposed"
   =========================== */

router.get("/proposed", (req, res) => {
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];
  const proposed = programs.filter((p) => String(p.status || "proposed") === "proposed");
  return res.json(proposed);
});

/* ===========================
   ✅ Production Series (MASTER LIST) Bulk Sync
   - This fixes "only my browser sees changes"
   - Frontend can PUT the entire seriesList just like localStorage used to
   =========================== */

router.get("/series", (req, res) => {
  const store = readCalendarSafe();
  const list = Array.isArray(store.series) ? store.series : [];
  return res.json(list);
});

router.put("/series", (req, res) => {
  const store = readCalendarSafe();
  const body = req.body;

  if (!Array.isArray(body)) {
    return res.status(400).json({ error: "Body must be an array of series" });
  }

  // Light validation: keep objects only, force id to string if present
  const cleaned = body
    .filter((x) => x && typeof x === "object")
    .map((s) => ({
      ...s,
      id: safeStr(s.id) || `series_${Date.now()}`,
    }));

  store.series = cleaned;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save series list" });

  return res.json({ success: true, count: cleaned.length });
});

/* ===========================
   ✅ Proposed Programs Alias
   - Fixes: GET /calendar/proposed 404
   - Uses same storage as programs[]
   - Proposed Pool == programs with status="proposed"
   =========================== */

router.get("/proposed", (req, res) => {
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];
  const proposed = programs.filter((p) => String(p.status || "proposed") === "proposed");
  return res.json(proposed);
});

router.post("/proposed", (req, res) => {
  // Force status to "proposed" while keeping your existing program schema
  req.body = { ...(req.body || {}), status: "proposed" };
  // Delegate to the same logic by calling the /programs handler path manually is messy;
  // so we just re-run the same creation logic inline.
  const store = readCalendarSafe();
  const body = req.body || {};

  const title = safeStr(body.title) || "";

  const newProgram = {
    id: safeStr(body.id) || `prog_${Date.now()}`,
    title,
    episodes: Math.max(0, safeInt(body.episodes, 0)),
    genreId: safeStr(body.genreId) || null,
    seasonId: safeStr(body.seasonId) || null,
    status: "proposed",
    notes: safeStr(body.notes) || "",
    createdBy: safeStr(body.createdBy) || "Unknown",
    createdAt:
      body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime())
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.programs = Array.isArray(store.programs) ? store.programs : [];
  store.programs.push(newProgram);

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save proposed program" });
  return res.status(201).json(newProgram);
});

router.patch("/proposed/:id", (req, res) => {
  // Same as PATCH program, but keep status at proposed unless explicitly set
  const { id } = req.params;
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];

  const idx = programs.findIndex((p) => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "Program not found" });

  const body = req.body || {};
  const updated = { ...programs[idx] };

  if (typeof body.title === "string") updated.title = safeStr(body.title);
  if (typeof body.episodes !== "undefined")
    updated.episodes = Math.max(0, safeInt(body.episodes, updated.episodes));
  if (typeof body.genreId !== "undefined") updated.genreId = safeStr(body.genreId) || null;
  if (typeof body.seasonId !== "undefined") updated.seasonId = safeStr(body.seasonId) || null;
  if (typeof body.notes === "string") updated.notes = safeStr(body.notes);

  // Allow status changes if you intentionally promote it (e.g. proposed -> approved)
  if (typeof body.status === "string") updated.status = safeStr(body.status) || updated.status;

  updated.updatedAt = new Date().toISOString();

  programs[idx] = updated;
  store.programs = programs;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save proposed program" });
  return res.json({ success: true, program: updated });
});

router.delete("/proposed/:id", (req, res) => {
  // Same as DELETE program
  const { id } = req.params;
  const store = readCalendarSafe();
  const programs = Array.isArray(store.programs) ? store.programs : [];

  const next = programs.filter((p) => String(p.id) !== String(id));
  if (next.length === programs.length) return res.status(404).json({ error: "Program not found" });

  store.programs = next;
  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to delete proposed program" });

  return res.json({ success: true });
});

// ----------------------
// ✅ Events
// ----------------------
router.get("/events", (req, res) => {
  const store = readCalendarSafe();

  // Optional filters: ?from=YYYY-MM-DD&to=YYYY-MM-DD&type=filming|promo&programId=...
  const { from, to, type, programId } = req.query || {};

  let events = Array.isArray(store.events) ? store.events : [];

  const fromKey = isYMD(from) ? String(from) : null;
  const toKey = isYMD(to) ? String(to) : null;

  if (fromKey) events = events.filter((e) => String(e.date || "") >= fromKey);
  if (toKey) events = events.filter((e) => String(e.date || "") <= toKey);

  if (type) events = events.filter((e) => String(e.type || "") === String(type));
  if (programId) events = events.filter((e) => String(e.programId || "") === String(programId));

  // newest first
  events.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return res.json(events);
});

router.post("/events", (req, res) => {
  const store = readCalendarSafe();
  const body = req.body || {};

  const type = safeStr(body.type); // filming | promo | other
  const date = safeStr(body.date); // YYYY-MM-DD
  const time = safeStr(body.time); // "14:00" etc (optional)
  const programId = safeStr(body.programId);

  if (!type) return res.status(400).json({ error: "Missing event type" });
  if (!isYMD(date)) return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });

  const newEvent = {
    id: safeStr(body.id) || `event_${Date.now()}`,
    programId: programId || null,
    type,
    date,
    time: time || "",
    seasonId: safeStr(body.seasonId) || null,
    title: safeStr(body.title) || "",
    location: safeStr(body.location) || "",
    notes: safeStr(body.notes) || "",
    assignedCrew: Array.isArray(body.assignedCrew) ? body.assignedCrew.map(String).filter(Boolean) : [],
    status: safeStr(body.status) || "Scheduled",
    createdBy: safeStr(body.createdBy) || "Unknown",
    createdAt:
      body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime())
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.events = Array.isArray(store.events) ? store.events : [];
  store.events.push(newEvent);

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save event" });
  return res.status(201).json(newEvent);
});

router.patch("/events/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const events = Array.isArray(store.events) ? store.events : [];

  const idx = events.findIndex((e) => String(e.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "Event not found" });

  const body = req.body || {};
  const updated = { ...events[idx] };

  const allowed = [
    "programId",
    "type",
    "date",
    "time",
    "seasonId",
    "title",
    "location",
    "notes",
    "assignedCrew",
    "status",
  ];

  for (const k of allowed) {
    if (!(k in body)) continue;

    if (k === "assignedCrew") {
      updated.assignedCrew = Array.isArray(body.assignedCrew)
        ? body.assignedCrew.map(String).filter(Boolean)
        : updated.assignedCrew;
      continue;
    }

    updated[k] = typeof body[k] === "string" ? safeStr(body[k]) : body[k];
  }

  if (typeof updated.date !== "undefined" && updated.date) {
    if (!isYMD(String(updated.date))) {
      return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });
    }
  }

  updated.updatedAt = new Date().toISOString();
  events[idx] = updated;
  store.events = events;

  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to save event" });
  return res.json({ success: true, event: updated });
});

router.delete("/events/:id", (req, res) => {
  const { id } = req.params;
  const store = readCalendarSafe();
  const events = Array.isArray(store.events) ? store.events : [];

  const next = events.filter((e) => String(e.id) !== String(id));
  if (next.length === events.length) return res.status(404).json({ error: "Event not found" });

  store.events = next;
  const saved = writeCalendarSafe(store);
  if (!saved) return res.status(500).json({ error: "Failed to delete event" });

  return res.json({ success: true });
});

export default router;
