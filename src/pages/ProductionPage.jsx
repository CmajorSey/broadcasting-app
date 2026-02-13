import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getSectionPermissions } from "@/lib/permissions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

/**
 * ✅ LOCAL STORAGE (v2)
 * - Confirmed schedule is now MASTER SERIES records (not a stored list of episodes).
 * - Episodes are GENERATED from the series schedule, then per-episode OVERRIDES can change date/time/film.
 * - Every edit (series-wide or single episode) writes a change log entry with a note.
 */
const LS_KEY_SERIES = "hub_production_series_v2";
const LS_KEY_SEASONS = "hub_calendar_seasons_v1";
const LS_KEY_PROPOSED = "hub_calendar_proposed_programs_v1";

// (legacy; used only for one-time migration if needed)
const LS_KEY_CONFIRMED_LEGACY = "hub_production_confirmed_v1";

/**
 * ✅ Migration + deletion safety
 * - MIGRATION_DONE prevents legacy re-import after upgrades
 * - TOMBSTONES keeps a permanent list of deleted series IDs so they never reappear
 */
const LS_KEY_SERIES_MIGRATION_DONE = "hub_production_series_v2_migration_done";
const LS_KEY_SERIES_TOMBSTONES = "hub_production_series_v2_deleted_ids";

const toISO = (d) => {
  try {
    const x = new Date(d);
    if (isNaN(x.getTime())) return "";
    return x.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

const loadArray = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveArray = (key, items) => {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {}
};

const DEFAULT_SEASONS = [
  { id: "season_pre", name: "Pre-Season", startMonth: 1, endMonth: 2, order: 1, active: true },
  { id: "season_1", name: "Season 1", startMonth: 3, endMonth: 5, order: 2, active: true },
  { id: "season_2", name: "Season 2", startMonth: 6, endMonth: 8, order: 3, active: true },
  { id: "season_3", name: "Season 3", startMonth: 9, endMonth: 11, order: 4, active: true },
  { id: "season_festive", name: "Festive Season", startMonth: 12, endMonth: 12, order: 5, active: true },
];

const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const monthName = (m) => monthNames[(m || 1) - 1] || "";

const monthRangeLabel = (startMonth, endMonth) => {
  const s = monthName(startMonth);
  const e = monthName(endMonth);
  if (!s || !e) return "—";
  if (startMonth === endMonth) return s;
  return `${s}–${e}`;
};

const getSeasonForMonth = (seasons, monthNumber) => {
  const active = (seasons || []).filter((s) => s && s.active !== false);
  // v1: non-wrapping ranges only
  const hit = active.find((s) => monthNumber >= s.startMonth && monthNumber <= s.endMonth);
  return hit || null;
};

const getMonthNumFromISO = (iso) => {
  if (!iso || typeof iso !== "string") return null;
  const parts = iso.split("-");
  if (parts.length < 2) return null;
  const m = Number(parts[1]);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  return m;
};

/* ===========================
   🗓️ Scheduling helpers
   - Weekly / Monthly (nth weekday or last weekday) / One-off / Custom dates
   =========================== */

const pad2 = (n) => String(n).padStart(2, "0");

const normalizeISODate = (s) => {
  try {
    if (!s) return "";
    const raw = String(s).trim();
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

// 0=Mon ... 6=Sun
const isoDowMon = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return (d.getDay() + 6) % 7;
};

const addDaysISO = (iso, days) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const startOfMonthISO = (year, month1to12) => {
  const d = new Date(year, (month1to12 || 1) - 1, 1);
  return d.toISOString().slice(0, 10);
};

const daysInMonthNum = (year, month1to12) => new Date(year, month1to12 || 1, 0).getDate();

const nthWeekdayOfMonthISO = (year, month1to12, weekdayMon0, nth) => {
  const firstISO = startOfMonthISO(year, month1to12);
  const firstDow = isoDowMon(firstISO);
  const diff = (weekdayMon0 - firstDow + 7) % 7;
  const dayNum = 1 + diff + 7 * (Math.max(1, Number(nth || 1)) - 1);

  const dim = daysInMonthNum(year, month1to12);
  if (dayNum > dim) return "";

  const mm = pad2(month1to12);
  const dd = pad2(dayNum);
  return `${year}-${mm}-${dd}`;
};

const lastWeekdayOfMonthISO = (year, month1to12, weekdayMon0) => {
  const dim = daysInMonthNum(year, month1to12);
  const last = new Date(year, (month1to12 || 1) - 1, dim);
  const lastISO = last.toISOString().slice(0, 10);
  const lastDow = isoDowMon(lastISO);
  const back = (lastDow - weekdayMon0 + 7) % 7;
  return addDaysISO(lastISO, -back);
};

const nextOrSameWeekdayISO = (startISO, weekdayMon0) => {
  const start = normalizeISODate(startISO);
  if (!start) return "";
  const dow = isoDowMon(start);
  const diff = (weekdayMon0 - dow + 7) % 7;
  return addDaysISO(start, diff);
};

const parseCustomDates = (raw) => {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[\n,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const normalized = parts
    .map((p) => normalizeISODate(p))
    .filter(Boolean);

  const uniq = Array.from(new Set(normalized));
  uniq.sort((a, b) => a.localeCompare(b));
  return uniq;
};

const buildOccurrences = (schedule) => {
  const type = String(schedule?.type || "weekly");

  const startISO = normalizeISODate(schedule?.startDate || "");
  const episodes = Number(schedule?.episodes);
  const hasEpisodes = Number.isFinite(episodes) && episodes >= 1;

  const MAX_AUTOGEN = 60;
  const cap = hasEpisodes ? Math.min(episodes, 500) : MAX_AUTOGEN;

  if (type === "oneOff") {
    const one = normalizeISODate(schedule?.oneOffDate || startISO);
    return one ? [one] : [];
  }

  if (type === "custom") {
    const dates = parseCustomDates(schedule?.customDatesRaw || "");
    return dates.slice(0, cap);
  }

  if (type === "weekly") {
    const weekday = Number.isFinite(Number(schedule?.weeklyWeekday))
      ? Number(schedule.weeklyWeekday)
      : 0;

    const first = nextOrSameWeekdayISO(startISO, weekday);
    if (!first) return [];

    const out = [first];
    for (let i = 1; i < cap; i++) out.push(addDaysISO(first, i * 7));
    return out;
  }

  if (type === "monthly") {
    const rule = String(schedule?.monthlyRule || "last");
    const weekday = Number.isFinite(Number(schedule?.monthlyWeekday))
      ? Number(schedule.monthlyWeekday)
      : 6;

    const nth = Number.isFinite(Number(schedule?.monthlyNth))
      ? Number(schedule.monthlyNth)
      : 1;

    if (!startISO) return [];
    const d = new Date(startISO);
    if (isNaN(d.getTime())) return [];
    let y = d.getFullYear();
    let m = d.getMonth() + 1;

    const out = [];
    let guard = 0;
    while (out.length < cap && guard < 240) {
      guard++;

      let candidate = "";
      if (rule === "nth") candidate = nthWeekdayOfMonthISO(y, m, weekday, nth);
      else candidate = lastWeekdayOfMonthISO(y, m, weekday);

      if (candidate) {
        if (!startISO || candidate >= startISO) out.push(candidate);
      }

      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    return out;
  }

  return [];
};

/* ===========================
   🧠 Series → occurrences flattening
   =========================== */

const safeObj = (x) => (x && typeof x === "object" ? x : {});

const flattenSeries = (seriesList) => {
  const out = [];

  for (const s of Array.isArray(seriesList) ? seriesList : []) {
    const schedule = safeObj(s?.scheduleMeta);
    const occ = buildOccurrences({
      ...schedule,
      episodes:
        Number.isFinite(Number(s?.episodesCount)) && Number(s?.episodesCount) >= 1
          ? Number(s.episodesCount)
          : schedule?.episodes ?? null,
    });

    const overrides = safeObj(s?.overrides); // { [occIndex]: { airDate, airTime, filmDate, note, changes[] } }

    for (let i = 0; i < occ.length; i++) {
      const idx1 = i + 1;
      const baseDate = occ[i];
      const o = safeObj(overrides[String(idx1)]);

      const airDate = o?.airDate ? String(o.airDate) : baseDate;
      const airTime = (o?.airTime ?? s?.airTime ?? schedule?.airTime ?? "21:00") || "21:00";
      const filmDate = o?.filmDate ?? "";

      out.push({
        id: `${s.id}__ep__${idx1}`,
        seriesId: s.id,
        seriesTitle: s.title || "Untitled",
        occurrenceIndex: idx1,
        title: s.title || "Untitled",
        airDate,
        airTime,
        filmDate,
        // “note of change” lives inside overrides (per episode) or seriesChanges (for all)
        episodeNote: o?.note || "",
        seriesMeta: s,
      });
    }
  }

  // stable sort by date/time
  out.sort((a, b) => {
    const ad = (a.airDate || "9999-12-31") + (a.airTime || "23:59");
    const bd = (b.airDate || "9999-12-31") + (b.airTime || "23:59");
    return ad.localeCompare(bd);
  });

  return out;
};

export default function ProductionPage({ loggedInUser }) {
  const { toast } = useToast();
  const { canEdit, canSeeNotes } = getSectionPermissions("production", loggedInUser);

  /* ===========================
     📆 Calendar base (Seasons + Proposed)
     =========================== */
  const [seasons, setSeasons] = useState(() => {
    const stored = loadArray(LS_KEY_SEASONS);
    return stored.length ? stored : DEFAULT_SEASONS;
  });

  const [proposedPrograms, setProposedPrograms] = useState(() => loadArray(LS_KEY_PROPOSED));

  /* ===========================
     ✅ Confirmed: MASTER series list
     =========================== */
  const [seriesList, setSeriesList] = useState(() => {
    // 1) Load current v2 series
    const storedRaw = loadArray(LS_KEY_SERIES);

    // 2) Load tombstones (deleted series IDs) so they never come back
    const tombstones = new Set(
      (Array.isArray(loadArray(LS_KEY_SERIES_TOMBSTONES)) ? loadArray(LS_KEY_SERIES_TOMBSTONES) : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    );

    // Filter out deleted series immediately
    const stored = (Array.isArray(storedRaw) ? storedRaw : []).filter((s) => {
      const id = String(s?.id || "").trim();
      return id && !tombstones.has(id);
    });

    // If we cleaned anything, persist the cleaned list back to LS
    if (stored.length !== storedRaw.length) {
      try {
        localStorage.setItem(LS_KEY_SERIES, JSON.stringify(stored));
      } catch {}
    }

    // ✅ HARD STOP: if we already migrated once, never re-import legacy again
    let migratedAlready = false;
    try {
      migratedAlready = localStorage.getItem(LS_KEY_SERIES_MIGRATION_DONE) === "1";
    } catch {
      migratedAlready = false;
    }

    // One-time best-effort migration from legacy confirmed list (episodes stored as items)
    // Only runs if NO v2 series exist AND migration not done.
    if (!stored.length && !migratedAlready) {
      const legacy = loadArray(LS_KEY_CONFIRMED_LEGACY);

      if (legacy.length) {
        // Convert each legacy item into a one-off series (so nothing is lost)
        const migrated = legacy.map((it) => ({
          id: `migrated_${it?.id || Date.now().toString()}`,
          title: String(it?.title || "Untitled"),
          episodesCount: 1,
          airTime: String(it?.airTime || "21:00"),
          scheduleMeta: {
            type: "oneOff",
            episodes: 1,
            startDate: normalizeISODate(it?.airDate || ""),
            airTime: String(it?.airTime || "21:00"),
            oneOffDate: normalizeISODate(it?.airDate || ""),
          },
          overrides: {
            "1": {
              airDate: normalizeISODate(it?.airDate || ""),
              airTime: String(it?.airTime || "21:00"),
              filmDate: normalizeISODate(it?.filmDate || ""),
              note: String(it?.note || ""),
              changes: [
                {
                  at: it?.createdAt || new Date().toISOString(),
                  by: it?.createdBy || "Unknown",
                  action: "migrated_from_legacy_item",
                  details: "Imported from v1 confirmed list.",
                },
              ],
            },
          },
          seriesChanges: [
            {
              at: it?.createdAt || new Date().toISOString(),
              by: it?.createdBy || "Unknown",
              action: "series_created",
              details: "Migrated series (one-off).",
            },
          ],
          createdBy: it?.createdBy || "Unknown",
          createdAt: it?.createdAt || new Date().toISOString(),
          confirmed: true,
          sourceProposedId: it?.sourceProposedId || null,
          sourceProposedBy: it?.sourceProposedBy || null,
          sourceProposedAt: it?.sourceProposedAt || null,
        }));

        // ✅ Mark migration complete AND delete legacy key so it cannot reappear
        try {
          localStorage.setItem(LS_KEY_SERIES_MIGRATION_DONE, "1");
          localStorage.removeItem(LS_KEY_CONFIRMED_LEGACY);
          localStorage.setItem(LS_KEY_SERIES, JSON.stringify(migrated));
        } catch {}

        return migrated;
      }

      // Even if legacy is empty, mark as “done” so we don’t keep checking forever
      try {
        localStorage.setItem(LS_KEY_SERIES_MIGRATION_DONE, "1");
        localStorage.removeItem(LS_KEY_CONFIRMED_LEGACY);
      } catch {}
    }

    return stored;
  });

  // Persist seasons + proposed programs + confirmed series
  useEffect(() => saveArray(LS_KEY_SEASONS, seasons), [seasons]);
  useEffect(() => saveArray(LS_KEY_PROPOSED, proposedPrograms), [proposedPrograms]);
  useEffect(() => saveArray(LS_KEY_SERIES, seriesList), [seriesList]);

  /* ===========================
     🧹 Legacy safety cleanup
     - If v2 series exist, legacy must never be allowed to repopulate anything
     =========================== */
  useEffect(() => {
    if (!Array.isArray(seriesList) || seriesList.length === 0) return;

    try {
      localStorage.setItem(LS_KEY_SERIES_MIGRATION_DONE, "1");
      localStorage.removeItem(LS_KEY_CONFIRMED_LEGACY);
    } catch {}
  }, [seriesList]);

  /* ===========================
     🗓️ Calendar UI controls
     =========================== */
  const [calendarView, setCalendarView] = useState("month"); // "month" | "year"
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1); // 1–12

  const activeSeason = useMemo(() => getSeasonForMonth(seasons, viewMonth), [seasons, viewMonth]);

  /* ===========================
     ✅ Flattened occurrences for calendar rendering
     =========================== */
  const allOccurrences = useMemo(() => flattenSeries(seriesList), [seriesList]);

  const occurrencesForViewMonth = useMemo(() => {
    return (allOccurrences || []).filter((it) => getMonthNumFromISO(it?.airDate) === viewMonth);
  }, [allOccurrences, viewMonth]);

  /* ===========================
     ✍️ Proposed (pool) creation
     =========================== */
  const [pTitle, setPTitle] = useState("");
  const [pEpisodes, setPEpisodes] = useState("");
  const [pGenre, setPGenre] = useState("");
  const [pSynopsis, setPSynopsis] = useState("");

  /* ===========================
     🎛️ Proposed pool state
     =========================== */
  const [genreFilter, setGenreFilter] = useState("__ALL__"); // "__ALL__" | genre string
  const [pGenreMode, setPGenreMode] = useState("select"); // "select" | "add"
  const [pGenreCustom, setPGenreCustom] = useState("");

  /* ===========================
     🧾 Proposed editor (selection)
     =========================== */
  const [selectedProposedId, setSelectedProposedId] = useState(null);

  const selectedProposed = useMemo(() => {
    return (proposedPrograms || []).find((p) => p.id === selectedProposedId) || null;
  }, [proposedPrograms, selectedProposedId]);

  /* ===========================
     ✅ Confirm scheduling (Series master)
     =========================== */
  const [confirmType, setConfirmType] = useState("weekly"); // weekly | monthly | oneOff | custom
  const [confirmStartDate, setConfirmStartDate] = useState("");
  const [confirmAirTime, setConfirmAirTime] = useState("21:00");

  // weekly
  const [confirmWeeklyWeekday, setConfirmWeeklyWeekday] = useState("0");

  // monthly
  const [confirmMonthlyRule, setConfirmMonthlyRule] = useState("last");
  const [confirmMonthlyNth, setConfirmMonthlyNth] = useState("1");
  const [confirmMonthlyWeekday, setConfirmMonthlyWeekday] = useState("6");

  // one-off
  const [confirmOneOffDate, setConfirmOneOffDate] = useState("");

  // custom
  const [confirmCustomDatesRaw, setConfirmCustomDatesRaw] = useState("");

  const resetConfirmFormFor = (p) => {
    const eps = Number(p?.episodes);
    const hasEps = Number.isFinite(eps) && eps >= 1;

    setConfirmType("weekly");
    setConfirmStartDate("");
    setConfirmAirTime("21:00");
    setConfirmWeeklyWeekday("0");
    setConfirmMonthlyRule("last");
    setConfirmMonthlyNth("1");
    setConfirmMonthlyWeekday("6");
    setConfirmOneOffDate("");
    setConfirmCustomDatesRaw("");

    if (!hasEps) {
      setConfirmType("monthly");
      setConfirmMonthlyRule("last");
      setConfirmMonthlyWeekday("6");
    }
  };

  /* ===========================
     📌 Manual series creation (optional)
     =========================== */
  const [manualTitle, setManualTitle] = useState("");
  const [manualEpisodes, setManualEpisodes] = useState("");
  const [manualType, setManualType] = useState("oneOff");
  const [manualAirTime, setManualAirTime] = useState("21:00");
  const [manualStartDate, setManualStartDate] = useState("");
  const [manualOneOffDate, setManualOneOffDate] = useState("");
  const [manualCustomDatesRaw, setManualCustomDatesRaw] = useState("");

  /* ===========================
     🗓️ Month navigation
     =========================== */
  const goPrevMonth = () => setViewMonth((m) => (m === 1 ? 12 : m - 1));
  const goNextMonth = () => setViewMonth((m) => (m === 12 ? 1 : m + 1));

  /* ===========================
     🧩 Seasons editor helpers
     =========================== */
  const seasonCount = Math.max(1, Math.min(12, (seasons || []).length || 5));

  const setSeasonCount = (nextCount) => {
    const n = Math.max(1, Math.min(12, Number(nextCount) || 1));
    setSeasons((prev) => {
      const copy = Array.isArray(prev) ? [...prev] : [];
      if (copy.length === n) return copy;

      if (copy.length < n) {
        const startOrder = copy.length + 1;
        const add = [];
        for (let i = 0; i < n - copy.length; i++) {
          add.push({
            id: `season_custom_${Date.now()}_${i}`,
            name: `New Season ${startOrder + i}`,
            startMonth: 1,
            endMonth: 1,
            order: startOrder + i,
            active: true,
          });
        }
        return [...copy, ...add];
      }

      return copy.slice(0, n);
    });
  };

  const updateSeason = (id, patch) => {
    setSeasons((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const saveSeasonsNow = () => {
    const cleaned = (seasons || []).map((s, idx) => {
      const sm = Math.max(1, Math.min(12, Number(s.startMonth) || 1));
      const em = Math.max(1, Math.min(12, Number(s.endMonth) || 1));
      const name = String(s.name || "").trim() || `Season ${idx + 1}`;
      const startMonth = Math.min(sm, em);
      const endMonth = Math.max(sm, em);
      return {
        ...s,
        name,
        startMonth,
        endMonth,
        order: Number(s.order) || idx + 1,
        active: s.active !== false,
      };
    });

    setSeasons(cleaned);
    toast({ title: "Saved", description: "Seasons updated. Calendar header will reflect your changes." });
  };

  /* ===========================
     🧾 Proposed pool helpers
     =========================== */
  const addProposed = () => {
    const cleanTitle = (pTitle || "").trim();
    if (!cleanTitle) {
      toast({ title: "Missing title", description: "Please enter a proposed program title." });
      return;
    }

    const eps = Number(pEpisodes);
    const safeEpisodes = Number.isFinite(eps) && eps >= 1 && eps <= 100 ? eps : "";

    const cleanGenre = String(pGenre || "").trim();

    const newProg = {
      id: Date.now().toString(),
      title: cleanTitle,
      episodes: safeEpisodes,
      genre: cleanGenre,
      synopsis: (pSynopsis || "").trim(),
      createdBy: loggedInUser?.name || "Unknown",
      createdAt: new Date().toISOString(),
    };

    setProposedPrograms((prev) => [newProg, ...(Array.isArray(prev) ? prev : [])]);

    setPTitle("");
    setPEpisodes("");
    setPGenre("");
    setPSynopsis("");

    setPGenreMode("select");
    setPGenreCustom("");

    toast({ title: "Submitted", description: "Proposed program added to the pool." });
  };

  const removeProposed = (id) => {
    setProposedPrograms((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== id) : []));
    toast({ title: "Removed", description: "Proposed program removed." });
  };

  /* ===========================
     ✅ Confirm Proposed → SERIES MASTER (NEW)
     - Creates ONE master series record
     - Calendar renders occurrences from schedule
     - Per-episode edits are overrides (date/time/film + change note)
     =========================== */
  const confirmSelectedProposedToCalendar = () => {
    if (!selectedProposed) {
      toast({ title: "Nothing selected", description: "Click a proposed program first." });
      return;
    }

    const cleanTitle = String(selectedProposed?.title || "").trim();
    if (!cleanTitle) {
      toast({ title: "Missing title", description: "Selected program has no title." });
      return;
    }

    const epsNum = Number(selectedProposed?.episodes);
    const hasEpisodes = Number.isFinite(epsNum) && epsNum >= 1;

    const schedule = {
      type: confirmType,
      episodes: hasEpisodes ? epsNum : null,
      startDate: normalizeISODate(confirmStartDate),
      airTime: String(confirmAirTime || "").trim() || "21:00",

      weeklyWeekday: Number(confirmWeeklyWeekday),

      monthlyRule: String(confirmMonthlyRule || "last"),
      monthlyNth: Number(confirmMonthlyNth),
      monthlyWeekday: Number(confirmMonthlyWeekday),

      oneOffDate: normalizeISODate(confirmOneOffDate || confirmStartDate),

      customDatesRaw: String(confirmCustomDatesRaw || "").trim(),
    };

    // Validate minimum inputs per type
    if (schedule.type === "custom") {
      const list = parseCustomDates(schedule.customDatesRaw);
      if (list.length === 0) {
        toast({
          title: "Missing dates",
          description: "Enter at least one date (YYYY-MM-DD), separated by comma or new line.",
        });
        return;
      }
    } else if (schedule.type === "oneOff") {
      if (!schedule.oneOffDate) {
        toast({ title: "Missing date", description: "Please select the airing date." });
        return;
      }
    } else {
      if (!schedule.startDate) {
        toast({ title: "Missing start date", description: "Please select a start date." });
        return;
      }
    }

    // sanity-check occurrences can be built
    const occPreview = buildOccurrences(schedule);
    if (!occPreview.length) {
      toast({
        title: "Could not build schedule",
        description: "Try a different start date/rule (some months don’t have that weekday pattern).",
      });
      return;
    }

    const createdBy = loggedInUser?.name || "Unknown";
    const createdAt = new Date().toISOString();

    const seriesId = `series_${Date.now().toString()}_${selectedProposed.id}`;

    const series = {
      id: seriesId,
      title: cleanTitle,
      episodesCount: hasEpisodes ? epsNum : null,
      airTime: schedule.airTime,
      scheduleMeta: schedule,

      overrides: {}, // per-episode overrides written later
      seriesChanges: [
        {
          at: createdAt,
          by: createdBy,
          action: "series_created_from_proposed",
          details: `Schedule: ${schedule.type}`,
        },
      ],

      // Proposed source audit
      sourceProposedId: selectedProposed.id,
      sourceProposedBy: selectedProposed.createdBy,
      sourceProposedAt: selectedProposed.createdAt,

      createdBy,
      createdAt,
      confirmed: true,
    };

    setSeriesList((prev) => [series, ...(Array.isArray(prev) ? prev : [])]);

    // remove from pool
    setProposedPrograms((prev) =>
      Array.isArray(prev) ? prev.filter((p) => p.id !== selectedProposed.id) : []
    );
    setSelectedProposedId(null);

    toast({
      title: "Confirmed",
      description: hasEpisodes
        ? `Series created (${epsNum} episode(s)). You can edit the series or individual episodes from the calendar.`
        : `Series created (ongoing). You can edit the series or individual dates from the calendar.`,
    });
  };

  /* ===========================
     🧹 Remove series
     =========================== */
  const removeSeries = (seriesId) => {
    const sid = String(seriesId || "").trim();
    if (!sid) return;

    // 1) Remove from live list
    setSeriesList((prev) => (Array.isArray(prev) ? prev.filter((s) => s.id !== sid) : []));

    // 2) Tombstone so it can never come back after refresh / migration / key drift
    try {
      const existing = loadArray(LS_KEY_SERIES_TOMBSTONES)
        .map((x) => String(x || "").trim())
        .filter(Boolean);

      const next = Array.from(new Set([...(existing || []), sid]));
      localStorage.setItem(LS_KEY_SERIES_TOMBSTONES, JSON.stringify(next));
    } catch {}

    toast({ title: "Removed", description: "Series removed from confirmed schedule." });
  };

  /* ===========================
     ✏️ Expand/collapse series in Confirmed list
     =========================== */
  const [expandedSeries, setExpandedSeries] = useState({}); // { [seriesId]: boolean }
  const toggleSeries = (id) => {
    setExpandedSeries((prev) => ({ ...(prev || {}), [id]: !prev?.[id] }));
  };

  /* ===========================
     ✏️ Calendar edit dialog
     - Edit one episode OR apply to all
     - Requires a “note of change”
     =========================== */
  const [editOpen, setEditOpen] = useState(false);
  const [editScope, setEditScope] = useState("one"); // "one" | "all"
  const [editNote, setEditNote] = useState("");

  const [editOcc, setEditOcc] = useState(null); // { seriesId, occurrenceIndex, airDate, airTime, filmDate }
  const [editAirDate, setEditAirDate] = useState("");
  const [editAirTime, setEditAirTime] = useState("");
  const [editFilmDate, setEditFilmDate] = useState("");

  /* ===========================
     🏷️ Series header edit (NEW)
     - Edit series title
     - Add filming date(s) list (series-level planning)
     - Filming dates input appears ONLY here (not per-episode)
     =========================== */
 const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const [seriesEditId, setSeriesEditId] = useState(null);
  const [seriesEditTitle, setSeriesEditTitle] = useState("");
  const [seriesEditFilmDatesRaw, setSeriesEditFilmDatesRaw] = useState("");
  const [seriesEditNote, setSeriesEditNote] = useState("");

  /* ===========================
     🎬 Series filming date picker UI state (FIX)
     - These are TEMP inputs for the dialog UI only
     - They must be real React state so <input type="date"> shows selected value
     =========================== */
  const [seriesFilmOne, setSeriesFilmOne] = useState("");
  const [seriesFilmRangeStart, setSeriesFilmRangeStart] = useState("");
  const [seriesFilmRangeEnd, setSeriesFilmRangeEnd] = useState("");

   const openSeriesEdit = (series) => {
    if (!series?.id) return;

    setSeriesEditId(series.id);
    setSeriesEditTitle(String(series?.title || "").trim() || "");

    const existing = Array.isArray(series?.filmingDates) ? series.filmingDates : [];
    setSeriesEditFilmDatesRaw(existing.filter(Boolean).join("\n"));

    // ✅ reset UI-only filming picker inputs so the dialog opens clean every time
    setSeriesFilmOne("");
    setSeriesFilmRangeStart("");
    setSeriesFilmRangeEnd("");

    setSeriesEditNote("");
    setSeriesEditOpen(true);
  };
  const saveSeriesHeader = () => {
    if (!seriesEditId) return;

    const note = String(seriesEditNote || "").trim();
    if (!note) {
      toast({ title: "Missing note", description: "Please add a note explaining the change." });
      return;
    }

    const nextTitle = String(seriesEditTitle || "").trim() || "Untitled";
    const nextFilmingDates = parseCustomDates(seriesEditFilmDatesRaw || "");

    const actor = loggedInUser?.name || "Unknown";
    const at = new Date().toISOString();

    setSeriesList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((s) => {
        if (s.id !== seriesEditId) return s;

        const beforeTitle = String(s?.title || "Untitled");
        const beforeFilm = Array.isArray(s?.filmingDates) ? s.filmingDates : [];

        const titleChanged = beforeTitle !== nextTitle;
        const beforeFilmKey = beforeFilm.join("|");
        const afterFilmKey = nextFilmingDates.join("|");
        const filmChanged = beforeFilmKey !== afterFilmKey;

        return {
          ...s,
          title: nextTitle,
          filmingDates: nextFilmingDates,
          seriesChanges: [
            ...(Array.isArray(s.seriesChanges) ? s.seriesChanges : []),
            {
              at,
              by: actor,
              action: "series_header_updated",
              details: `Note: ${note}. ${titleChanged ? `Title: "${beforeTitle}" → "${nextTitle}". ` : ""}${
                filmChanged
                  ? `Filming dates: ${beforeFilm.length} → ${nextFilmingDates.length}.`
                  : ""
              }`,
            },
          ],
        };
      });
    });

    toast({ title: "Saved", description: "Series header updated." });
    setSeriesEditOpen(false);
  };

  const openEditForOccurrence = (occ) => {
    if (!occ?.seriesId || !occ?.occurrenceIndex) return;

    setEditOcc({
      seriesId: occ.seriesId,
      occurrenceIndex: occ.occurrenceIndex,
      title: occ.title,
      currentAirDate: occ.airDate || "",
      currentAirTime: occ.airTime || "",
      currentFilmDate: occ.filmDate || "",
    });

    setEditAirDate(occ.airDate || "");
    setEditAirTime(occ.airTime || "");
    setEditFilmDate(occ.filmDate || "");

    setEditScope("one");
    setEditNote("");
    setEditOpen(true);
  };

  const applyEditSave = () => {
    if (!editOcc?.seriesId) return;

    const note = String(editNote || "").trim();
    if (!note) {
      toast({ title: "Missing note", description: "Please add a note explaining the change." });
      return;
    }

    const nextAirDate = normalizeISODate(editAirDate);
    const nextAirTime = String(editAirTime || "").trim();
    const nextFilmDate = normalizeISODate(editFilmDate);

    if (!nextAirDate) {
      toast({ title: "Missing date", description: "Please select an airing date." });
      return;
    }
    if (!nextAirTime) {
      toast({ title: "Missing time", description: "Please enter an airing time (e.g. 21:00)." });
      return;
    }

    const actor = loggedInUser?.name || "Unknown";
    const at = new Date().toISOString();

    setSeriesList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((s) => {
        if (s.id !== editOcc.seriesId) return s;

        // snapshot “before”
        const before = {
          airDate: editOcc.currentAirDate || "",
          airTime: editOcc.currentAirTime || "",
          filmDate: editOcc.currentFilmDate || "",
        };

        if (editScope === "all") {
          // ✅ “Change all” behavior (v2+):
          // - If series has NOT started yet → move ALL generated episodes to the new day/time.
          // - If series HAS started already → keep past airings where they are, and shift ONLY subsequent airings.
          //   Past airings are preserved via per-episode overrides (so the calendar shows Monday still there, rest moved).
          const schedule = safeObj(s.scheduleMeta);
          const type = String(schedule?.type || "weekly");

          // snapshot old schedule + occurrences (using the same occurrence builder as the calendar)
          const oldSchedule = { ...schedule };
          const oldOcc = buildOccurrences({
            ...oldSchedule,
            episodes:
              Number.isFinite(Number(s?.episodesCount)) && Number(s?.episodesCount) >= 1
                ? Number(s.episodesCount)
                : oldSchedule?.episodes ?? null,
          });

          // Determine “started” by whether we have any generated airDate strictly before today
          const todayISO = (() => {
            try {
              return new Date().toISOString().slice(0, 10);
            } catch {
              return "";
            }
          })();

          const hasStarted =
            !!todayISO && Array.isArray(oldOcc) && oldOcc.some((d) => d && d < todayISO);

          // Build next schedule (updates weekday rules for weekly/monthly based on chosen date)
          let nextSchedule = { ...oldSchedule };

          if (type === "weekly") {
            nextSchedule.startDate = nextAirDate;
            // weeklyWeekday is 0=Mon..6=Sun (matches isoDowMon)
            nextSchedule.weeklyWeekday = isoDowMon(nextAirDate);
          } else if (type === "monthly") {
            nextSchedule.startDate = nextAirDate;
            // monthlyWeekday is 0=Mon..6=Sun (matches isoDowMon)
            nextSchedule.monthlyWeekday = isoDowMon(nextAirDate);
            // keep monthlyRule + monthlyNth as-is (user is changing “day”, not rule)
          } else if (type === "oneOff") {
            nextSchedule.oneOffDate = nextAirDate;
            nextSchedule.startDate = nextAirDate;
          } else if (type === "custom") {
            // For “all” on custom, we do NOT rewrite the whole custom date list automatically (too destructive).
            // We treat this as changing default time only + log. Users can edit individual custom dates as “one”.
          }

          // Always update default series time when applying to “all”
          nextSchedule.airTime = nextAirTime;

          // Build new occurrences for the updated schedule
          const newOcc = buildOccurrences({
            ...nextSchedule,
            episodes:
              Number.isFinite(Number(s?.episodesCount)) && Number(s?.episodesCount) >= 1
                ? Number(s.episodesCount)
                : nextSchedule?.episodes ?? null,
          });

          // Preserve past airings (ONLY when series already started):
          // For each past occurrence index, write an override that pins the old date/time (unless user already overridden it).
          const existingOverrides = safeObj(s.overrides);
          let preservedOverrides = existingOverrides;

          if (hasStarted && Array.isArray(oldOcc) && oldOcc.length) {
            const actorForLog = actor;
            preservedOverrides = { ...existingOverrides };

            for (let i = 0; i < oldOcc.length; i++) {
              const idx1 = i + 1;
              const oldDate = oldOcc[i];

              if (!oldDate || !todayISO) continue;

              // Past airing → pin it
              if (oldDate < todayISO) {
                const key = String(idx1);
                const prevOverride = safeObj(preservedOverrides[key]);

                // If an override already exists, do NOT overwrite it.
                // Just ensure past stays stable by leaving user edits intact.
                if (prevOverride && (prevOverride.airDate || prevOverride.airTime || prevOverride.filmDate || prevOverride.note)) {
                  continue;
                }

                preservedOverrides[key] = {
                  ...prevOverride,
                  airDate: oldDate,
                  airTime: String(oldSchedule?.airTime || s?.airTime || "21:00"),
                  filmDate: prevOverride?.filmDate ?? "",
                  note: `Auto-preserved past airing after series change. Note: ${note}`,
                  changes: [
                    ...(Array.isArray(prevOverride.changes) ? prevOverride.changes : []),
                    {
                      at,
                      by: actorForLog,
                      action: "episode_auto_preserved_past",
                      details: `Pinned past airing (Ep ${idx1}) to ${oldDate} @ ${String(
                        oldSchedule?.airTime || s?.airTime || "21:00"
                      )} after series moved. Note: ${note}`,
                    },
                  ],
                };
              }
            }
          }

          // Series-level log
          const beforeSummary = `${before.airDate} @ ${before.airTime}`;
          const afterSummary =
            type === "custom"
              ? `Default time set to ${nextAirTime} (custom dates unchanged)`
              : `Rule updated; next occurrences now follow ${nextAirDate} @ ${nextAirTime}`;

          return {
            ...s,
            airTime: nextAirTime,
            scheduleMeta: nextSchedule,
            overrides: preservedOverrides,
            seriesChanges: [
              ...(Array.isArray(s.seriesChanges) ? s.seriesChanges : []),
              {
                at,
                by: actor,
                action: hasStarted ? "series_changed_subsequent_only" : "series_changed_all",
                details: `Note: ${note}. Before: ${beforeSummary}. After: ${afterSummary}. ${
                  hasStarted
                    ? "Past airings were preserved via per-episode overrides."
                    : "Series had not started yet; all generated episodes moved."
                }`,
              },
            ],
          };
        }

        // scope === "one"
        const idxKey = String(editOcc.occurrenceIndex);
        const overrides = safeObj(s.overrides);
        const prevOverride = safeObj(overrides[idxKey]);

              const nextOverride = {
          ...prevOverride,
          airDate: nextAirDate,
          airTime: nextAirTime,

          // ✅ IMPORTANT:
          // Filming date(s) are managed at the SERIES HEADER now.
          // So episode edits should NEVER clear an existing film date unless the user explicitly set one.
          filmDate: nextFilmDate
            ? nextFilmDate
            : prevOverride?.filmDate ?? editOcc.currentFilmDate ?? "",

          note,
          changes: [
            ...(Array.isArray(prevOverride.changes) ? prevOverride.changes : []),
            {
              at,
              by: actor,
              action: "episode_changed_one",
              details: `Before: ${before.airDate} @ ${before.airTime}${
                before.filmDate ? ` (Film ${before.filmDate})` : ""
              } → After: ${nextAirDate} @ ${nextAirTime}${
                nextFilmDate
                  ? ` (Film ${nextFilmDate})`
                  : prevOverride?.filmDate || editOcc.currentFilmDate
                  ? ` (Film preserved)`
                  : ""
              }. Note: ${note}`,
            },
          ],
        };

        return {
          ...s,
          overrides: {
            ...overrides,
            [idxKey]: nextOverride,
          },
        };
      });
    });

    toast({ title: "Saved", description: editScope === "all" ? "Series updated." : "Episode updated." });
    setEditOpen(false);
  };

  /* ===========================
     ✅ Confirmed series sorting (for the list)
     =========================== */
  const seriesSorted = useMemo(() => {
    const copy = [...(Array.isArray(seriesList) ? seriesList : [])];
    // Sort by earliest upcoming occurrence date
    const earliest = (s) => {
      const occ = buildOccurrences(s?.scheduleMeta || {});
      const first = occ?.[0] || "9999-12-31";
      const t = String(s?.airTime || s?.scheduleMeta?.airTime || "23:59");
      return first + t;
    };
    copy.sort((a, b) => earliest(a).localeCompare(earliest(b)));
    return copy;
  }, [seriesList]);

  /* ===========================
     🧾 UI
     =========================== */
  return (
    <div className="p-4 space-y-4">
      {/* ===========================
         🗓️ CALENDAR (FIRST + TOP)
         =========================== */}
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Production Calendar</CardTitle>
          <div className="text-sm text-muted-foreground">
            Confirm a program → it becomes a <b>Series</b>. The calendar displays generated episodes, and you can edit one episode or the whole series.
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={calendarView === "month" ? "default" : "secondary"}
                onClick={() => setCalendarView("month")}
              >
                Month View
              </Button>
              <Button
                variant={calendarView === "year" ? "default" : "secondary"}
                onClick={() => setCalendarView("year")}
              >
                Year View
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary">Header</Badge>
              {activeSeason ? (
                <div className="text-sm">
                  <b>{activeSeason.name}</b>{" "}
                  <span className="text-muted-foreground">
                    ({monthRangeLabel(activeSeason.startMonth, activeSeason.endMonth)})
                  </span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No season matches this month yet.</div>
              )}
            </div>
          </div>

          {/* ===========================
             🎠 Month carousel (single month)
             =========================== */}
          {calendarView === "month" ? (
            <Card className="rounded-2xl">
              <CardContent className="p-4 space-y-3">
                {(() => {
                  const now = new Date();
                  const viewYear = now.getFullYear();

                  const first = new Date(viewYear, viewMonth - 1, 1);
                  const dim = new Date(viewYear, viewMonth, 0).getDate();

                  const firstDowMon = (first.getDay() + 6) % 7;

                  const isoForDay = (day) => `${viewYear}-${pad2(viewMonth)}-${pad2(day)}`;

                  // Map occurrences by airDate for fast display
                  const byDate = new Map();
                  for (const it of occurrencesForViewMonth || []) {
                    const key = it?.airDate || "";
                    if (!key) continue;
                    if (!byDate.has(key)) byDate.set(key, []);
                    byDate.get(key).push(it);
                  }

                  // ✅ Map filming dates (series-level) by date for fast display
                  // stored as series.filmingDates: ["YYYY-MM-DD", ...]
                  const filmByDate = new Map();
                  for (const s of Array.isArray(seriesList) ? seriesList : []) {
                    const title = String(s?.title || "Untitled");
                    const dates = Array.isArray(s?.filmingDates) ? s.filmingDates : [];
                    for (const d of dates) {
                      const key = String(d || "").trim();
                      if (!key) continue;
                      if (getMonthNumFromISO(key) !== viewMonth) continue;
                      if (!filmByDate.has(key)) filmByDate.set(key, []);
                      filmByDate.get(key).push({ seriesId: s.id, title });
                    }
                  }

                  const totalCells = firstDowMon + dim;
                  const trailing = (7 - (totalCells % 7)) % 7;
                  const cellCount = totalCells + trailing;

                  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

                  return (
                    <>
                      {/* Header row (centered) */}
                      <div className="grid grid-cols-3 items-center gap-2">
                        <div className="flex items-center justify-start">
                          <Button variant="secondary" onClick={goPrevMonth}>
                            Prev
                          </Button>
                        </div>

                        <div className="text-center">
                          <div className="text-lg font-semibold">
                            {monthName(viewMonth)} {viewYear}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {activeSeason ? (
                              <span>
                                Season: <b>{activeSeason.name}</b>
                              </span>
                            ) : (
                              <span>No season set for this month.</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Badge variant="outline">{occurrencesForViewMonth.length} airing</Badge>
                          <Button variant="secondary" onClick={goNextMonth}>
                            Next
                          </Button>
                        </div>
                      </div>

                      {/* Weekday header */}
                      <div className="grid grid-cols-7 gap-2 pt-2">
                        {weekday.map((d) => (
                          <div
                            key={d}
                            className="text-center text-xs font-medium text-muted-foreground"
                          >
                            {d}
                          </div>
                        ))}
                      </div>

                      {/* Calendar grid */}
                      <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: cellCount }).map((_, idx) => {
                          const dayNum = idx - firstDowMon + 1;
                          const isInMonth = dayNum >= 1 && dayNum <= dim;

                          if (!isInMonth) {
                            return (
                              <div
                                key={`empty_${idx}`}
                                className="rounded-xl border bg-muted/20 p-2 min-h-[92px]"
                              />
                            );
                          }

                          const dateISO = isoForDay(dayNum);
                          const itemsForDay = byDate.get(dateISO) || [];
                          const filmingForDay = filmByDate.get(dateISO) || [];
                          const showMore = itemsForDay.length > 2;

                          return (
                            <div
                              key={dateISO}
                              className="rounded-xl border p-2 min-h-[92px] flex flex-col gap-2"
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold">{dayNum}</div>

                                <div className="flex items-center gap-2">
                                  {filmingForDay.length ? (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0">
                                      🎬 {filmingForDay.length}
                                    </Badge>
                                  ) : null}

                                  {itemsForDay.length ? (
                                    <Badge variant="secondary" className="text-[10px] px-2 py-0">
                                      {itemsForDay.length}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>

                              {filmingForDay.length ? (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-muted-foreground">Filming</div>
                                  <div className="space-y-1">
                                    {filmingForDay.slice(0, 1).map((f) => (
                                      <div
                                        key={`film_${dateISO}_${f.seriesId}`}
                                        className="w-full rounded-md px-2 py-1 text-[10px] bg-muted/30"
                                        title={f.title}
                                      >
                                        <div className="truncate font-medium">🎬 {f.title}</div>
                                      </div>
                                    ))}
                                    {filmingForDay.length > 1 ? (
                                      <div className="text-[10px] text-muted-foreground">
                                        +{filmingForDay.length - 1} more
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}

                              {itemsForDay.length === 0 ? (
                                <div className="text-xs text-muted-foreground">—</div>
                              ) : (
                                <div className="space-y-1">
                                  {itemsForDay.slice(0, 2).map((it) => (
                                    <button
                                      key={it.id}
                                      type="button"
                                      onClick={() => {
                                        if (!canEdit) return;
                                        openEditForOccurrence(it);
                                      }}
                                      className={`w-full text-left rounded-md px-2 py-1 text-xs ${
                                        canEdit ? "bg-muted/40 hover:bg-muted/60" : "bg-muted/30"
                                      }`}
                                      title={
                                        canEdit
                                          ? "Click to edit this airing (or whole series)"
                                          : `${it.title || "Untitled"}`
                                      }
                                    >
                                      <div className="truncate font-medium">
                                        {it.title || "Untitled"}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground truncate">
                                        {it.airTime ? `@ ${it.airTime}` : "Time —"}{" "}
                                        {it.filmDate ? `• Film: ${it.filmDate}` : ""}
                                        {it.episodeNote ? " • ✍️ changed" : ""}
                                      </div>
                                    </button>
                                  ))}

                                  {showMore ? (
                                    <div className="text-[10px] text-muted-foreground">
                                      +{itemsForDay.length - 2} more
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {occurrencesForViewMonth.length === 0 ? (
                        <div className="text-sm text-muted-foreground pt-1">
                          No airing dates for this month yet.
                        </div>
                      ) : null}

                      {!canEdit ? (
                        <div className="text-xs text-muted-foreground pt-2">
                          View-only: you can see schedule, but only editors can change dates/times.
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground pt-2">
                          Tip: click any program tile inside a day to edit that episode (or apply to the whole series). Every change requires a note.
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          ) : (
            /* ===========================
               🧱 Year view (all months)
               =========================== */
            <Card className="rounded-2xl">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Year Preview</div>
                  <Badge variant="secondary">All months</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {Array.from({ length: 12 }).map((_, i) => {
                    const m = i + 1;
                    const s = getSeasonForMonth(seasons, m);

                    const count = (allOccurrences || []).filter((it) => getMonthNumFromISO(it?.airDate) === m).length;

                    const active = m === viewMonth;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setViewMonth(m);
                          setCalendarView("month");
                        }}
                        className={`text-left rounded-xl border p-3 space-y-1 ${active ? "ring-2 ring-ring" : ""}`}
                      >
                        <div className="text-sm font-semibold">{monthName(m)}</div>
                        <div className="text-xs text-muted-foreground">
                          {s ? `${s.name} (${monthRangeLabel(s.startMonth, s.endMonth)})` : "No season"}
                        </div>
                        <div className="text-xs text-muted-foreground">{count} airing</div>
                      </button>
                    );
                  })}
                </div>

                <div className="text-xs text-muted-foreground">
                  Tip: click a month to open it in Month View.
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===========================
             🧩 Seasons setup (edit first)
             =========================== */}
          <Card className="rounded-2xl">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Seasons Setup</div>
                  <div className="text-sm text-muted-foreground">
                    How many seasons, name them, and set start/end months.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-sm text-muted-foreground">How many?</div>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={seasonCount}
                    onChange={(e) => setSeasonCount(e.target.value)}
                    disabled={!canEdit}
                  >
                    {Array.from({ length: 12 }).map((_, i) => {
                      const n = i + 1;
                      return (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      );
                    })}
                  </select>

                  {canEdit ? (
                    <Button variant="secondary" onClick={saveSeasonsNow}>
                      Save Seasons
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2">
                {(seasons || []).map((s, idx) => (
                  <div
                    key={s.id}
                    className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1.5fr_0.7fr_0.7fr_0.6fr]"
                  >
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Season name</div>
                      <Input
                        value={s.name || ""}
                        onChange={(e) => updateSeason(s.id, { name: e.target.value })}
                        disabled={!canEdit}
                        placeholder={`Season ${idx + 1}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Start month</div>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={s.startMonth ?? 1}
                        onChange={(e) => updateSeason(s.id, { startMonth: Number(e.target.value) })}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">End month</div>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={s.endMonth ?? 1}
                        onChange={(e) => updateSeason(s.id, { endMonth: Number(e.target.value) })}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      <Badge variant="outline">{monthRangeLabel(s.startMonth, s.endMonth)}</Badge>
                      {s.active === false ? <Badge variant="secondary">Inactive</Badge> : null}
                    </div>
                  </div>
                ))}
              </div>

              {!canEdit ? (
                <div className="text-xs text-muted-foreground">
                  View-only users can see seasons, but only editors can change them.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {/* ===========================
         🏭 Production Hub (secondary header)
         =========================== */}
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Production Hub</CardTitle>
          <div className="text-sm text-muted-foreground">
            {canEdit ? (
              <span>
                You can <b>edit</b> Production schedules.
              </span>
            ) : (
              <span>
                View-only: you will see <b>airing</b> and <b>filming</b> dates only.
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ===========================
             🧾 Proposed Programs Pool (FIRST)
             =========================== */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Proposed Programs Pool</div>
              <Badge variant="outline">{proposedPrograms.length} proposed</Badge>
            </div>

            {/* ===========================
               🧪 Genre filter (Pool)
               =========================== */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm text-muted-foreground">Filter:</div>

              <Select value={genreFilter} onValueChange={setGenreFilter}>
                <SelectTrigger className="w-[240px] rounded-2xl">
                  <SelectValue placeholder="All genres" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All genres</SelectItem>

                  {Array.from(
                    new Set(
                      [
                        "Documentary",
                        "Reality",
                        "Culinary",
                        "Biography",
                        "Quiz",
                        "Environment",
                        "Educational",
                        "Kids",
                        "Show/Event",
                        "Current Affairs",
                        "Talk Show",
                        "Health",
                        "Technology",
                        "Entertainment",
                        ...(proposedPrograms || [])
                          .map((x) => String(x?.genre || "").trim())
                          .filter(Boolean),
                      ].map((g) => g.trim())
                    )
                  )
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b))
                    .map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              {genreFilter !== "__ALL__" ? (
                <Badge variant="secondary">Showing: {genreFilter}</Badge>
              ) : (
                <Badge variant="outline">Showing: All</Badge>
              )}
            </div>

            {canEdit && (
              <Card className="rounded-2xl">
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Submit a Proposed Program</div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <div className="text-sm font-medium">Title</div>
                      <Input
                        value={pTitle}
                        onChange={(e) => setPTitle(e.target.value)}
                        placeholder="e.g. Reality Challenge Season Premiere"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Number of episodes</div>
                      <Select value={String(pEpisodes || "")} onValueChange={(v) => setPEpisodes(v)}>
                        <SelectTrigger className="rounded-2xl">
                          <SelectValue placeholder="Select (1–100)" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {Array.from({ length: 100 }, (_, i) => String(i + 1)).map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Genre</div>

                      {pGenreMode !== "add" ? (
                        <Select
                          value={String(pGenre || "")}
                          onValueChange={(v) => {
                            if (v === "__ADD_NEW__") {
                              setPGenreMode("add");
                              setPGenreCustom("");
                              setPGenre("");
                              return;
                            }
                            setPGenre(v);
                          }}
                        >
                          <SelectTrigger className="rounded-2xl">
                            <SelectValue placeholder="Select a genre" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {Array.from(
                              new Set(
                                [
                                  "Documentary",
                                  "Reality",
                                  "Culinary",
                                  "Biography",
                                  "Quiz",
                                  "Environment",
                                  "Educational",
                                  "Kids",
                                  "Show/Event",
                                  "Current Affairs",
                                  "Talk Show",
                                  "Health",
                                  "Technology",
                                  "Entertainment",
                                  ...(proposedPrograms || [])
                                    .map((x) => String(x?.genre || "").trim())
                                    .filter(Boolean),
                                ].map((g) => g.trim())
                              )
                            )
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b))
                              .map((g) => (
                                <SelectItem key={g} value={g}>
                                  {g}
                                </SelectItem>
                              ))}

                            <SelectItem value="__ADD_NEW__">＋ Add new genre…</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="space-y-2">
                          <Input
                            value={pGenreCustom}
                            onChange={(e) => setPGenreCustom(e.target.value)}
                            placeholder="Type a new genre…"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const next = String(pGenreCustom || "").trim();
                                if (!next) return;
                                setPGenre(next);
                                setPGenreMode("select");
                              }}
                            >
                              Use this genre
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setPGenreMode("select");
                                setPGenreCustom("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            New genres become available after you submit a program with that genre.
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <div className="text-sm font-medium">Synopsis / Idea</div>
                      <Textarea
                        value={pSynopsis}
                        onChange={(e) => setPSynopsis(e.target.value)}
                        placeholder="What is the idea? What is the hook? Why this program?"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button onClick={addProposed}>Submit to Proposed Pool</Button>
                    <Badge variant="secondary">Logs user + date</Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedProposed && canEdit ? (
              <Card className="rounded-2xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Confirm Program (creates a Series)</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedProposed.title}{" "}
                        {selectedProposed.episodes
                          ? `• ${selectedProposed.episodes} episode(s)`
                          : "• ongoing / magazine style"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" onClick={() => setSelectedProposedId(null)}>
                        Close
                      </Button>
                      <Button type="button" onClick={confirmSelectedProposedToCalendar}>
                        Confirm & Add to Calendar
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Schedule type</div>
                      <Select value={confirmType} onValueChange={setConfirmType}>
                        <SelectTrigger className="rounded-2xl">
                          <SelectValue placeholder="Select schedule type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly (default)</SelectItem>
                          <SelectItem value="monthly">Monthly (first/last/nth weekday)</SelectItem>
                          <SelectItem value="oneOff">One-off</SelectItem>
                          <SelectItem value="custom">Custom dates</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="text-xs text-muted-foreground">
                        Weekly fills by week. Monthly uses rules like “last Sunday”. Custom uses exact dates.
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Airing time (default)</div>
                      <Input
                        value={confirmAirTime}
                        onChange={(e) => setConfirmAirTime(e.target.value)}
                        placeholder="e.g. 21:00"
                      />
                      <div className="text-xs text-muted-foreground">
                        You can change time for one episode or the whole series later.
                      </div>
                    </div>

                    {confirmType === "weekly" ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Start date</div>
                          <Input type="date" value={confirmStartDate} onChange={(e) => setConfirmStartDate(e.target.value)} />
                          <div className="text-xs text-muted-foreground">
                            We schedule from the first matching weekday on/after this date.
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm font-medium">Day of week</div>
                          <Select value={String(confirmWeeklyWeekday)} onValueChange={setConfirmWeeklyWeekday}>
                            <SelectTrigger className="rounded-2xl">
                              <SelectValue placeholder="Select weekday" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Monday</SelectItem>
                              <SelectItem value="1">Tuesday</SelectItem>
                              <SelectItem value="2">Wednesday</SelectItem>
                              <SelectItem value="3">Thursday</SelectItem>
                              <SelectItem value="4">Friday</SelectItem>
                              <SelectItem value="5">Saturday</SelectItem>
                              <SelectItem value="6">Sunday</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}

                    {confirmType === "monthly" ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Start date</div>
                          <Input type="date" value={confirmStartDate} onChange={(e) => setConfirmStartDate(e.target.value)} />
                          <div className="text-xs text-muted-foreground">We generate monthly dates from this month onward.</div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm font-medium">Monthly rule</div>
                          <Select value={String(confirmMonthlyRule)} onValueChange={setConfirmMonthlyRule}>
                            <SelectTrigger className="rounded-2xl">
                              <SelectValue placeholder="Select rule" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="last">Last</SelectItem>
                              <SelectItem value="nth">Nth (1st/2nd/3rd/4th)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {confirmMonthlyRule === "nth" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Which “nth”?</div>
                            <Select value={String(confirmMonthlyNth)} onValueChange={setConfirmMonthlyNth}>
                              <SelectTrigger className="rounded-2xl">
                                <SelectValue placeholder="Select (1st–4th)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">1st</SelectItem>
                                <SelectItem value="2">2nd</SelectItem>
                                <SelectItem value="3">3rd</SelectItem>
                                <SelectItem value="4">4th</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Rule</div>
                            <Badge variant="secondary">Last weekday of the month</Badge>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="text-sm font-medium">Weekday</div>
                          <Select value={String(confirmMonthlyWeekday)} onValueChange={setConfirmMonthlyWeekday}>
                            <SelectTrigger className="rounded-2xl">
                              <SelectValue placeholder="Select weekday" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Monday</SelectItem>
                              <SelectItem value="1">Tuesday</SelectItem>
                              <SelectItem value="2">Wednesday</SelectItem>
                              <SelectItem value="3">Thursday</SelectItem>
                              <SelectItem value="4">Friday</SelectItem>
                              <SelectItem value="5">Saturday</SelectItem>
                              <SelectItem value="6">Sunday</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}

                    {confirmType === "oneOff" ? (
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium">Airing date</div>
                        <Input type="date" value={confirmOneOffDate} onChange={(e) => setConfirmOneOffDate(e.target.value)} />
                        <div className="text-xs text-muted-foreground">Creates a series with one airing date.</div>
                      </div>
                    ) : null}

                    {confirmType === "custom" ? (
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium">Custom airing dates</div>
                        <Textarea
                          value={confirmCustomDatesRaw}
                          onChange={(e) => setConfirmCustomDatesRaw(e.target.value)}
                          placeholder={`Enter dates like:\n2026-03-01, 2026-03-08\n2026-03-22`}
                        />
                        <div className="text-xs text-muted-foreground">
                          Separate with commas or new lines. We will sort and remove duplicates.
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    This creates a <b>single master series</b>. The calendar generates the episodes automatically. Editing is done via “one episode” overrides or “change all” on the series.
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {proposedPrograms.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No proposed programs yet.
                {canEdit ? " Submit your first one above." : ""}
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {proposedPrograms
                  .filter((p) => {
                    if (genreFilter === "__ALL__") return true;
                    return String(p?.genre || "").trim() === String(genreFilter || "").trim();
                  })
                  .map((p) => {
                    const ddmmyy = p?.createdAt
                      ? new Date(p.createdAt)
                          .toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })
                          .replaceAll("/", "")
                      : "";

                    return (
                      <div
                        key={p.id}
                        className={`text-left rounded-2xl border p-4 space-y-2 cursor-pointer ${
                          selectedProposedId === p.id ? "ring-2 ring-ring" : ""
                        }`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedProposedId(p.id);
                          resetConfirmFormFor(p);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setSelectedProposedId(p.id);
                            resetConfirmFormFor(p);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="font-semibold">{p.title}</div>

                            <div className="text-sm text-muted-foreground flex flex-wrap gap-2">
                              {p.genre ? <Badge variant="secondary">{p.genre}</Badge> : null}
                              {p.episodes ? (
                                <Badge variant="secondary">{p.episodes} eps</Badge>
                              ) : (
                                <Badge variant="outline">No episode count</Badge>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground">
                              Proposed by {p.createdBy}
                              {ddmmyy ? ` • ${ddmmyy}` : ""}
                            </div>

                            {p.synopsis ? (
                              <div className="text-sm text-muted-foreground line-clamp-3">{p.synopsis}</div>
                            ) : (
                              <div className="text-sm text-muted-foreground">No synopsis yet.</div>
                            )}
                          </div>

                          {canEdit ? (
                            <div className="flex flex-col items-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedProposedId(p.id);
                                  resetConfirmFormFor(p);
                                }}
                              >
                                Confirm
                              </Button>

                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeProposed(p.id);
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <Separator />

          {/* ===========================
             📅 Confirmed Schedule (Series master)
             =========================== */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Confirmed Schedule</div>
              <Badge variant="outline">{seriesSorted.length} series</Badge>
            </div>

            {seriesSorted.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No confirmed series yet.
                {canEdit ? " Confirm a program to create the first series." : ""}
              </div>
            ) : (
              <div className="space-y-2">
                {seriesSorted.map((s) => {
                  const expanded = !!expandedSeries?.[s.id];
                  const occ = buildOccurrences(s?.scheduleMeta || {});
                  const count = occ.length;

                  // Build rendered episodes (flatten only this series, cheaper)
                  const seriesOccurrences = flattenSeries([s]);

                  const scheduleType = String(s?.scheduleMeta?.type || "weekly");
                  const scheduleLabel =
                    scheduleType === "weekly"
                      ? "Weekly"
                      : scheduleType === "monthly"
                      ? "Monthly"
                      : scheduleType === "oneOff"
                      ? "One-off"
                      : scheduleType === "custom"
                      ? "Custom"
                      : scheduleType;

                  return (
                    <Card key={s.id} className="rounded-2xl">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                                            <div className="space-y-1">
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => openSeriesEdit(s)}
                                className="font-semibold text-left hover:underline"
                                title="Click to edit series header (title + filming dates)"
                              >
                                {s.title || "Untitled"}
                              </button>
                            ) : (
                              <div className="font-semibold">{s.title || "Untitled"}</div>
                            )}

                            <div className="text-sm text-muted-foreground flex flex-wrap gap-2">
                              <Badge variant="secondary">{scheduleLabel}</Badge>
                              <Badge variant="secondary">
                                {Number.isFinite(Number(s?.episodesCount)) && Number(s.episodesCount) >= 1
                                  ? `${s.episodesCount} eps`
                                  : "ongoing"}
                              </Badge>
                              <Badge variant="secondary">Default time: {s?.airTime || s?.scheduleMeta?.airTime || "—"}</Badge>

                              {Array.isArray(s?.filmingDates) && s.filmingDates.length ? (
                                <Badge variant="outline">
                                  Filming: {s.filmingDates.length} date(s)
                                </Badge>
                              ) : null}

                              {count ? <Badge variant="outline">{count} generated</Badge> : null}
                            </div>

                            <div className="text-xs text-muted-foreground">
                              Added by {s.createdBy || "Unknown"} •{" "}
                              {s.createdAt ? new Date(s.createdAt).toLocaleString() : ""}
                            </div>

                            {canSeeNotes && s.sourceProposedId ? (
                              <div className="text-xs text-muted-foreground">
                                From Proposed Pool • {s.sourceProposedBy || "Unknown"} •{" "}
                                {s.sourceProposedAt ? new Date(s.sourceProposedAt).toLocaleString() : ""}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => toggleSeries(s.id)}>
                              {expanded ? "Hide episodes" : "Show episodes"}
                            </Button>

                            {canEdit ? (
                              <Button variant="destructive" size="sm" onClick={() => removeSeries(s.id)}>
                                Remove Series
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {expanded ? (
                          <div className="rounded-xl border p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium">Episodes</div>
                              <div className="text-xs text-muted-foreground">
                                Click an episode to edit (or change all via calendar edit scope).
                              </div>
                            </div>

                            <div className="grid gap-2">
                              {seriesOccurrences.map((ep) => (
                                <button
                                  key={ep.id}
                                  type="button"
                                  onClick={() => {
                                    if (!canEdit) return;
                                    openEditForOccurrence(ep);
                                  }}
                                  className={`w-full text-left rounded-xl border p-3 space-y-1 ${
                                    canEdit ? "hover:bg-muted/30" : ""
                                  }`}
                                  title={canEdit ? "Click to edit this episode" : ""}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-semibold">
                                      Ep {ep.occurrenceIndex}
                                    </div>
                                    {ep.episodeNote ? (
                                      <Badge variant="outline" className="text-[10px]">
                                        Changed
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="text-[10px]">
                                        Default
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="text-sm text-muted-foreground flex flex-wrap gap-2">
                                    <Badge variant="secondary">
                                      Air: {ep.airDate || "—"} {ep.airTime ? `@ ${ep.airTime}` : ""}
                                    </Badge>
                                    <Badge variant="secondary">Film: {ep.filmDate || "—"}</Badge>
                                    {canSeeNotes && ep.episodeNote ? (
                                      <Badge variant="outline">Note: {ep.episodeNote}</Badge>
                                    ) : null}
                                  </div>
                                </button>
                              ))}
                            </div>

                            {canSeeNotes && Array.isArray(s.seriesChanges) && s.seriesChanges.length ? (
                              <div className="pt-2">
                                <div className="text-xs font-medium">Series change log</div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  {s.seriesChanges.slice(-5).map((c, idx) => (
                                    <div key={`${s.id}_log_${idx}`}>
                                      • {c.at ? new Date(c.at).toLocaleString() : ""} —{" "}
                                      <b>{c.by || "Unknown"}</b> — {c.action || "change"}{" "}
                                      {c.details ? `— ${c.details}` : ""}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===========================
             ✍️ Manual Series (optional)
             =========================== */}
          {canEdit && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Add Series (manual)</div>
                  <Badge variant="secondary">Optional</Badge>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <div className="text-sm font-medium">Program title</div>
                    <Input
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder="e.g. Island Kitchen"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Schedule type</div>
                    <Select value={manualType} onValueChange={setManualType}>
                      <SelectTrigger className="rounded-2xl">
                        <SelectValue placeholder="Select schedule type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="oneOff">One-off</SelectItem>
                        <SelectItem value="custom">Custom dates</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Default air time</div>
                    <Input value={manualAirTime} onChange={(e) => setManualAirTime(e.target.value)} placeholder="e.g. 21:00" />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Episode count (optional)</div>
                    <Input
                      value={manualEpisodes}
                      onChange={(e) => setManualEpisodes(e.target.value)}
                      placeholder="e.g. 8"
                    />
                    <div className="text-xs text-muted-foreground">Leave blank for ongoing/magazine-style.</div>
                  </div>

                  {manualType === "oneOff" ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Airing date</div>
                      <Input type="date" value={manualOneOffDate} onChange={(e) => setManualOneOffDate(e.target.value)} />
                    </div>
                  ) : null}

                  {manualType === "custom" ? (
                    <div className="space-y-2 md:col-span-2">
                      <div className="text-sm font-medium">Custom dates</div>
                      <Textarea value={manualCustomDatesRaw} onChange={(e) => setManualCustomDatesRaw(e.target.value)} />
                    </div>
                  ) : null}

                  {(manualType === "weekly" || manualType === "monthly") ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Start date</div>
                      <Input type="date" value={manualStartDate} onChange={(e) => setManualStartDate(e.target.value)} />
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      const title = String(manualTitle || "").trim();
                      if (!title) {
                        toast({ title: "Missing title", description: "Please enter a series title." });
                        return;
                      }

                      const epsNum = Number(manualEpisodes);
                      const hasEpisodes = Number.isFinite(epsNum) && epsNum >= 1;

                      const scheduleMeta = {
                        type: manualType,
                        episodes: hasEpisodes ? epsNum : null,
                        startDate: normalizeISODate(manualStartDate),
                        airTime: String(manualAirTime || "").trim() || "21:00",
                        oneOffDate: normalizeISODate(manualOneOffDate || manualStartDate),
                        customDatesRaw: String(manualCustomDatesRaw || "").trim(),
                      };

                      // minimal validation
                      if (manualType === "oneOff" && !scheduleMeta.oneOffDate) {
                        toast({ title: "Missing date", description: "Please select an airing date." });
                        return;
                      }
                      if ((manualType === "weekly" || manualType === "monthly") && !scheduleMeta.startDate) {
                        toast({ title: "Missing start date", description: "Please select a start date." });
                        return;
                      }
                      if (manualType === "custom") {
                        const list = parseCustomDates(scheduleMeta.customDatesRaw);
                        if (!list.length) {
                          toast({ title: "Missing dates", description: "Enter at least one custom date." });
                          return;
                        }
                      }

                      const preview = buildOccurrences(scheduleMeta);
                      if (!preview.length) {
                        toast({ title: "Could not build schedule", description: "Check your rule or start date." });
                        return;
                      }

                      const createdBy = loggedInUser?.name || "Unknown";
                      const createdAt = new Date().toISOString();

                      const series = {
                        id: `series_${Date.now().toString()}_manual`,
                        title,
                        episodesCount: hasEpisodes ? epsNum : null,
                        airTime: scheduleMeta.airTime,
                        scheduleMeta,
                        overrides: {},
                        seriesChanges: [
                          {
                            at: createdAt,
                            by: createdBy,
                            action: "series_created_manual",
                            details: `Schedule: ${manualType}`,
                          },
                        ],
                        createdBy,
                        createdAt,
                        confirmed: true,
                      };

                      setSeriesList((prev) => [series, ...(Array.isArray(prev) ? prev : [])]);

                      setManualTitle("");
                      setManualEpisodes("");
                      setManualType("oneOff");
                      setManualAirTime("21:00");
                      setManualStartDate("");
                      setManualOneOffDate("");
                      setManualCustomDatesRaw("");

                      toast({ title: "Added", description: "Series added to confirmed schedule." });
                    }}
                  >
                    Add Series
                  </Button>

                  <Badge variant="outline">Creates a master series (episodes are generated)</Badge>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

         {/* ===========================
         ✏️ Edit dialog (calendar + episodes)
         =========================== */}
      <AlertDialog open={editOpen} onOpenChange={setEditOpen}>
        <AlertDialogContent className="max-w-[720px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Edit confirmed program</AlertDialogTitle>
            <AlertDialogDescription>
              {editOcc?.title ? (
                <>
                  <b>{editOcc.title}</b>{" "}
                  {editOcc?.occurrenceIndex ? `• Episode ${editOcc.occurrenceIndex}` : ""}
                </>
              ) : (
                "Update date/time and include a note of change."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">Airing date</div>
                <Input type="date" value={editAirDate} onChange={(e) => setEditAirDate(e.target.value)} />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Airing time</div>
                <Input value={editAirTime} onChange={(e) => setEditAirTime(e.target.value)} placeholder="e.g. 21:00" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Apply change</div>
              <Select value={editScope} onValueChange={setEditScope}>
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder="Choose scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one">Only this episode</SelectItem>
                  <SelectItem value="all">All episodes (series defaults)</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                “Only this episode” creates an override. “All episodes” updates the series defaults and logs a series change.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Note of change (required)</div>
              <Textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Why is this changing? (e.g. National event, studio booking, guest unavailable, etc.)"
              />
            </div>

            {editOcc ? (
              <div className="text-xs text-muted-foreground">
                Current: {editOcc.currentAirDate || "—"} @ {editOcc.currentAirTime || "—"}
                {editOcc.currentFilmDate ? ` • Film: ${editOcc.currentFilmDate}` : ""}
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setEditOpen(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={applyEditSave}>Save changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===========================
         🏷️ Series header edit dialog (title + filming dates)
         Filming dates input appears ONLY here
         =========================== */}
      <AlertDialog open={seriesEditOpen} onOpenChange={setSeriesEditOpen}>
        <AlertDialogContent className="max-w-[720px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Edit series header</AlertDialogTitle>
            <AlertDialogDescription>
              Update the program name and add filming date(s) once confirmed. Changes apply to the whole series.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">Series title</div>
              <Input
                value={seriesEditTitle}
                onChange={(e) => setSeriesEditTitle(e.target.value)}
                placeholder="e.g. Island Kitchen"
              />
            </div>

            {/* ===========================
               🎬 Filming dates picker (FIXED)
               - Add single date (controlled state so it sticks)
               - Add range (inclusive)
               - Shows badges with remove
               - Stores back into seriesEditFilmDatesRaw (one ISO per line)
               =========================== */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Filming date(s) (optional)</div>

              {/* Local helpers (derived from seriesEditFilmDatesRaw) */}
              {(() => {
                const current = parseCustomDates(seriesEditFilmDatesRaw || "");
                const setDates = (arr) => setSeriesEditFilmDatesRaw((arr || []).join("\n"));

                const addOne = (iso) => {
                  const d = normalizeISODate(iso);
                  if (!d) return;
                  const next = Array.from(new Set([...(current || []), d]));
                  next.sort((a, b) => a.localeCompare(b));
                  setDates(next);
                };

                const addRange = (startISO, endISO) => {
                  const a = normalizeISODate(startISO);
                  const b = normalizeISODate(endISO);
                  if (!a || !b) return;

                  const start = a <= b ? a : b;
                  const end = a <= b ? b : a;

                  const out = new Set(current || []);
                  let guard = 0;
                  let cursor = start;

                  while (cursor && cursor <= end && guard < 400) {
                    out.add(cursor);
                    cursor = addDaysISO(cursor, 1);
                    guard++;
                  }

                  const next = Array.from(out);
                  next.sort((x, y) => x.localeCompare(y));
                  setDates(next);
                };

                const removeOne = (iso) => {
                  const next = (current || []).filter((d) => d !== iso);
                  setDates(next);
                };

                return (
                  <div className="space-y-2">
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Pick one date</div>
                        <Input
                          type="date"
                          value={seriesFilmOne}
                          onChange={(e) => setSeriesFilmOne(e.target.value)}
                        />
                      </div>

                      <div className="flex items-end gap-2 md:col-span-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            addOne(seriesFilmOne);
                            setSeriesFilmOne("");
                          }}
                          disabled={!seriesFilmOne}
                        >
                          Add date
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setDates([]);
                            setSeriesFilmOne("");
                            setSeriesFilmRangeStart("");
                            setSeriesFilmRangeEnd("");
                          }}
                          disabled={!current.length}
                        >
                          Clear
                        </Button>

                        <div className="text-xs text-muted-foreground">
                          {current.length ? `${current.length} selected` : "No filming dates set"}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border p-3 space-y-2">
                      <div className="text-xs text-muted-foreground font-medium">
                        Add a date range (optional)
                      </div>

                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Start</div>
                          <Input
                            type="date"
                            value={seriesFilmRangeStart}
                            onChange={(e) => setSeriesFilmRangeStart(e.target.value)}
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">End</div>
                          <Input
                            type="date"
                            value={seriesFilmRangeEnd}
                            onChange={(e) => setSeriesFilmRangeEnd(e.target.value)}
                          />
                        </div>

                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={() => {
                              addRange(seriesFilmRangeStart, seriesFilmRangeEnd);
                              setSeriesFilmRangeStart("");
                              setSeriesFilmRangeEnd("");
                            }}
                            disabled={!seriesFilmRangeStart || !seriesFilmRangeEnd}
                          >
                            Add range
                          </Button>
                        </div>
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        Range adds every day inclusive (useful when filming runs across multiple days).
                      </div>
                    </div>

                    {current.length ? (
                      <div className="flex flex-wrap gap-2">
                        {current.map((d) => (
                          <Badge key={d} variant="secondary" className="flex items-center gap-2">
                            {d}
                            <button
                              type="button"
                              className="text-xs opacity-70 hover:opacity-100"
                              onClick={() => removeOne(d)}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <div className="text-xs text-muted-foreground">
                      These are series-level planning dates. They don’t change the airing schedule.
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Note of change (required)</div>
              <Textarea
                value={seriesEditNote}
                onChange={(e) => setSeriesEditNote(e.target.value)}
                placeholder="Why is this changing? (e.g. rebrand, sponsor rename, filming booked, etc.)"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSeriesEditOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={saveSeriesHeader}>Save series</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

