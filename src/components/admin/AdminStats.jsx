import { useEffect, useState, useMemo, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import API_BASE from "@/api";

// ---------- Helpers ----------
const safeStr = (v) => (typeof v === "string" ? v.trim() : "");
const toISODate = (d) => {
  try {
    const x = new Date(d);
    if (isNaN(x)) return null;
    return x.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return null;
  }
};
const mondayStart = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};
const monthStart = (date = new Date()) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Normalize arbitrary status strings (use assignmentStatus from tickets)
const normalizeStatus = (raw) => {
  const rawStr = typeof raw === "string" ? raw : String(raw ?? "");
  const s = rawStr
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return { label: "Unknown", key: "unknown" };
  if (/^(done|completed?|finished|closed)\b/.test(s)) return { label: "Completed", key: "completed" };
  if (/^(cancel+ed?|called off|aborted)\b/.test(s)) return { label: "Cancelled", key: "cancelled" };
  if (/^(postponed?|deferred?)\b/.test(s)) return { label: "Postponed", key: "postponed" };
  if (/^(in ?progress|ongoing|working|active)\b/.test(s)) return { label: "In Progress", key: "in progress" };
  if (/^(assigned)\b/.test(s)) return { label: "Assigned", key: "assigned" };
  if (/^unassigned\b/.test(s)) return { label: "Unassigned", key: "unassigned" };
  if (/^(pending|await|to ?do|not ?started)\b/.test(s)) return { label: "Pending", key: "pending" };

  // Fallback: Title Case for label; key stays normalized
  const label = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, key: s };
};
const statusKeyFromLabel = (label) => normalizeStatus(label).key;

// --- Seychelles Day-Type helpers (weekend & core public holidays) ---
const isWeekend = (d) => {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 6;
};

// Compute Western (Gregorian) Easter (returns Date)
function easterDate(year) {
  // Meeus/Jones/Butcher algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const sameYMD = (a, b) => toISODate(a) === toISODate(b);

// Basic Seychelles public holidays (fixed + Good Fri / Easter Mon).
// Note: This is an intentionally minimal set. You can expand with more dates if needed.
function isSeychellesPublicHoliday(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const mmdd = `${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

  // Fixed-date holidays
  const fixed = new Set([
    "01-01", // New Year's Day
    "05-01", // Labour Day
    "06-18", // Constitution Day
    "06-29", // Independence Day
    "08-15", // Assumption of Mary
    "11-01", // All Saints' Day
    "12-08", // Immaculate Conception
    "12-25", // Christmas Day
  ]);
  if (fixed.has(mmdd)) return true;

  // Moveable feasts: Good Friday (Easter - 2), Easter Monday (Easter + 1)
  const easter = easterDate(y);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);

  if (sameYMD(x, goodFriday) || sameYMD(x, easterMonday)) return true;

  return false;
}

const dayTypeOfDate = (dateLike) => {
  const d = new Date(dateLike);
  if (isNaN(d)) return "Unknown";
  if (isSeychellesPublicHoliday(d)) return "Public Holiday";
  if (isWeekend(d)) return "Weekend";
  return "Weekday";
};

// ---------- Child: Top Assigned Card with its own "insights tab" ----------
function TopAssignedCard({ loading, datasets, palette }) {
  const [tab, setTab] = useState("camops"); // camops | drivers | news | sports | prod

  const current = useMemo(() => {
    switch (tab) {
      case "drivers":
        return { title: "Drivers – Top Assigned", data: datasets.drivers, color: palette.drivers };
      case "news":
        return { title: "Newsroom – Top Reporters", data: datasets.news, color: palette.newsroom };
      case "sports":
        return { title: "Sports Section – Top Reporters", data: datasets.sports, color: palette.sports };
      case "prod":
        return { title: "Production – Top Producers", data: datasets.prod, color: palette.production };
      default:
        return { title: "Operations – Top Cam Ops", data: datasets.camops, color: palette.camops };
    }
  }, [tab, datasets, palette]);

  return (
    <Card>
      <CardHeader className="flex gap-2 items-center justify-between">
        <CardTitle>{current.title}</CardTitle>
        <Tabs value={tab} onValueChange={setTab} className="w-auto">
          <TabsList className="grid grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="camops">Cam Ops</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="news">News</TabsTrigger>
            <TabsTrigger value="sports">Sports</TabsTrigger>
            <TabsTrigger value="prod">Production</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="h-64">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={current.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" hide />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Assignments">
                {current.data.map((_, i) => (
                  <Cell key={`ins-${i}`} fill={current.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminStats() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  // also fetch users so we can map reporter names -> roles (journalist, sports_journalist, producer)
  const [users, setUsers] = useState([]);

   // Filters
  const [rangeMode, setRangeMode] = useState("thisWeek"); // today | thisWeek | thisMonth | past3Months | oneYear | custom | all
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [lineStatus, setLineStatus] = useState("Completed"); // which status to plot over time

  // Day-Type filter (#5)
  const [dayType, setDayType] = useState("all"); // all | weekday | weekend | holiday

  // NEW: Archived inclusion (default include so stats remain complete)
  const [includeArchived, setIncludeArchived] = useState(true);


  // Roster cache & stats (#4)
  const rosterCache = useRef({}); // { weekStartISO: weekArray }
  const [rosterStats, setRosterStats] = useState({
    offDuty: 0,
    afternoon: 0,
    primary: 0,
    unmatched: 0,
  });
  const [rosterBusy, setRosterBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [tRes, uRes] = await Promise.all([
          fetch(`${API_BASE}/tickets`),
          fetch(`${API_BASE}/users`).catch(() => null),
        ]);
        const tData = (await tRes.json().catch(() => [])) || [];
        const uDataRaw = uRes ? await uRes.json().catch(() => []) : [];
        const uData = Array.isArray(uDataRaw) ? uDataRaw : Array.isArray(uDataRaw?.users) ? uDataRaw.users : [];

        if (!cancelled) {
          setTickets(Array.isArray(tData) ? tData : []);
          setUsers(uData);
        }
      } catch (err) {
        console.error("Failed to load stats data", err);
        if (!cancelled) {
          setTickets([]);
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build a quick lookup: name -> roles[]
  const nameToRoles = useMemo(() => {
    const map = new Map();
    const toLowerRoles = (u) =>
      (Array.isArray(u?.roles) ? u.roles : [u?.role]).map((r) => String(r || "").toLowerCase());
    const nameOf = (u) => String(u?.name || "").trim();

    (users || []).forEach((u) => {
      const nm = nameOf(u);
      if (!nm) return;
      const rl = toLowerRoles(u);
      map.set(nm.toLowerCase(), rl);
    });
    return map;
  }, [users]);

  const reporterRoleOf = (name, ticketType) => {
    const nmRaw = String(name || "");
    const nm = nmRaw.trim().toLowerCase();

    // Known name overrides (quick fix for data mismatches in /users)
    const SPORTS_NAME_OVERRIDES = new Set(["andy henriette", "george francois"]);
    if (SPORTS_NAME_OVERRIDES.has(nm)) return "sports";

    // Roles from /users (may be "sports_journalist", "sports journalist", "sports", etc.)
    const roles = nameToRoles.get(nm) || [];

    // Normalize roles and check with tolerant matching
    const norm = roles.map((r) =>
      String(r || "").toLowerCase().replace(/[_-]/g, " ").trim()
    );

    const hasSports =
      norm.some(
        (r) =>
          /\bsports\b/.test(r) ||
          /\bsport\b/.test(r) ||
          /sports journalist/.test(r) ||
          /sports reporter/.test(r)
      );
    const hasProducer = norm.some((r) => /^producer\b/.test(r));
    const hasJournalist = norm.some((r) => /\bjournalist\b/.test(r) || /\breporter\b/.test(r));

    if (hasSports) return "sports";
    if (hasProducer) return "production";
    if (hasJournalist) return "news";

    // Fallback to ticket type if role unknown
    if (/^sports$/i.test(ticketType || "")) return "sports";
    if (/^production$/i.test(ticketType || "")) return "production";
    return "news";
  };

  // Compute date bounds for range filter
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const monday = mondayStart(now);
    const weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 7 - 1);
    weekEnd.setHours(23, 59, 59, 999);

    const mStart = monthStart(now);
    const mEnd = new Date(mStart);
    mEnd.setMonth(mStart.getMonth() + 1);
    mEnd.setDate(0); // last day of current month
    mEnd.setHours(23, 59, 59, 999);

    const past3 = new Date(now);
    past3.setMonth(past3.getMonth() - 3);
    past3.setHours(0, 0, 0, 0);

    const oneYr = new Date(now);
    oneYr.setFullYear(oneYr.getFullYear() - 1);
    oneYr.setHours(0, 0, 0, 0);

    if (rangeMode === "all") return { startDate: null, endDate: null };
    if (rangeMode === "today") return { startDate: startOfToday, endDate: endOfToday };
    if (rangeMode === "thisWeek") return { startDate: monday, endDate: weekEnd };
    if (rangeMode === "thisMonth") return { startDate: mStart, endDate: mEnd };
    if (rangeMode === "past3Months") return { startDate: past3, endDate: endOfToday };
    if (rangeMode === "oneYear") return { startDate: oneYr, endDate: endOfToday };

    // custom
    const s = customStart ? new Date(customStart) : null;
    const e = customEnd ? new Date(customEnd) : null;
    if (s && !isNaN(s)) s.setHours(0, 0, 0, 0);
    if (e && !isNaN(e)) e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  }, [rangeMode, customStart, customEnd]);

    // Filter tickets: always exclude deleted; optionally include archived; date within range
  const baseTickets = useMemo(() => {
    const inRange = (d) => {
      if (!d) return false;
      const x = new Date(d);
      if (isNaN(x)) return false;
      if (startDate && x < startDate) return false;
      if (endDate && x > endDate) return false;
      return true;
    };

    // Keep deleted out of stats. Archived are included when includeArchived === true.
    const base = tickets.filter((t) => {
      if (t?.deleted) return false;
      if (!includeArchived && t?.archived) return false;
      return true;
    });

    if (rangeMode === "all") return base;

    return base.filter((t) => {
      const dateField = t?.date || t?.createdAt || null; // prefer ticket.date (datetime)
      return inRange(dateField);
    });
  }, [tickets, rangeMode, startDate, endDate, includeArchived]);

  // Apply Day-Type filter (#5)
  const activeTickets = useMemo(() => {
    if (dayType === "all") return baseTickets;
    return baseTickets.filter((t) => {
      const d = t?.date || t?.createdAt;
      const kind = dayTypeOfDate(d);
      if (dayType === "weekday") return kind === "Weekday";
      if (dayType === "weekend") return kind === "Weekend";
      if (dayType === "holiday") return kind === "Public Holiday";
      return true;
    });
  }, [baseTickets, dayType]);

  // ---- Status options for Work Volume drop-down (built from *active* set) ----
  const allStatuses = useMemo(() => {
    const counts = activeTickets.reduce((acc, t) => {
      const { label } = normalizeStatus(t?.assignmentStatus ?? t?.status);
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(counts).sort();
  }, [activeTickets]);

  // Build line keys for status selector (canonicalized from assignmentStatus)
  const normalizedStatuses = useMemo(() => {
    const uniq = Array.from(new Set(allStatuses.map((s) => s)));
    return uniq.map((label) => ({ label, key: statusKeyFromLabel(label) }));
  }, [allStatuses]);

  // Ensure a valid selection
  useEffect(() => {
    if (normalizedStatuses.length > 0 && !normalizedStatuses.some((s) => s.label === lineStatus)) {
      setLineStatus(normalizedStatuses[0].label);
    }
  }, [normalizedStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the selected status' normalized key for the line chart
  const selectedStatusKey = useMemo(() => {
    const k = statusKeyFromLabel(lineStatus);
    return k || "all";
  }, [lineStatus]);

  // ---- Aggregations on active set (respect date & day-type filters) ----
  const {
    sectionPie,                // Request Type donut (News/Sports/Production)
    lineSeries,                // Work volume over time: total + per-status buckets
    topCamOps,
    topDrivers,
    topNewsroom,
    topSports,
    topProduction,
    statusByTypeRows,          // stacked bars: Status by Request Type
    dayTypeRows,               // #5: Day-Type breakdown (Weekday/Weekend/Holiday)
    dq,                        // #6: Data quality
  } = useMemo(() => {
    // ---- Request Type donut (based on ticket.type) — now includes Technical
const typeCounts = { News: 0, Sports: 0, Production: 0, Technical: 0 };
for (const t of activeTickets) {
  const raw = String(t?.type || "");
  const s = raw.toLowerCase().trim();
  const type =
    s.startsWith("sport")
      ? "Sports"
      : s.startsWith("prod")
      ? "Production"
      : s.startsWith("tech")
      ? "Technical"
      : "News";
  typeCounts[type] += 1;
}
const sectionPie = [
  { name: "News", value: typeCounts.News },
  { name: "Sports", value: typeCounts.Sports },
  { name: "Production", value: typeCounts.Production },
  { name: "Technical", value: typeCounts.Technical },
];


    // ---- Work volume over time (totals + per-status buckets), using normalized keys
    const byDay = {};
    for (const t of activeTickets) {
      const iso = toISODate(t?.date || t?.createdAt);
      if (!iso) continue;
      const { key } = normalizeStatus(t?.assignmentStatus ?? t?.status);

      if (!byDay[iso]) byDay[iso] = { date: iso, total: 0 };
      byDay[iso].total += 1;
      if (key) {
        byDay[iso][key] = (byDay[iso][key] || 0) + 1;
      }
    }
    const lineSeries = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    // ---- Top lists (sorted desc, top 10) ----
    const camOpMap = new Map();
    const driverMap = new Map();
    const newsroomMap = new Map();
    const sportsMap = new Map();
    const productionMap = new Map();

    for (const t of activeTickets) {
      // Cam Ops
      if (Array.isArray(t?.assignedCamOps)) {
        for (const n of t.assignedCamOps.filter(Boolean).map(safeStr).filter(Boolean)) {
          camOpMap.set(n, (camOpMap.get(n) || 0) + 1);
        }
      }

      // Drivers
      const drv = t?.assignedDriver;
      const drvName =
        typeof drv === "string" ? safeStr(drv) :
        (drv && typeof drv === "object" ? safeStr(drv?.name || drv?.displayName) : "");
      if (drvName) {
        driverMap.set(drvName, (driverMap.get(drvName) || 0) + 1);
      }

      // Reporters
      const reportersRaw = Array.isArray(t?.assignedReporter)
        ? t.assignedReporter
        : typeof t?.assignedReporter === "string" && t.assignedReporter.trim()
        ? [t.assignedReporter]
        : [];

      for (const rep of reportersRaw) {
        const roleBucket = reporterRoleOf(rep, t?.type);
        if (roleBucket === "sports") {
          sportsMap.set(rep, (sportsMap.get(rep) || 0) + 1);
        } else if (roleBucket === "production") {
          productionMap.set(rep, (productionMap.get(rep) || 0) + 1);
        } else {
          newsroomMap.set(rep, (newsroomMap.get(rep) || 0) + 1);
        }
      }
    }

    const topify = (m, n = 10) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, count]) => ({ name, count }));

    const topCamOps = topify(camOpMap);
    const topDrivers = topify(driverMap);
    const topNewsroom = topify(newsroomMap);
    const topSports = topify(sportsMap);
    const topProduction = topify(productionMap);

    // ---- Status by Request Type (stacked) — now includes Technical
const TYPES = ["News", "Sports", "Production", "Technical"];
const rows = TYPES.map((type) => ({ type }));
const idx = { News: 0, Sports: 1, Production: 2, Technical: 3 };
const statusKeySet = new Set();

for (const t of activeTickets) {
  const raw = String(t?.type || "");
  const s = raw.toLowerCase().trim();
  const type =
    s.startsWith("sport")
      ? "Sports"
      : s.startsWith("prod")
      ? "Production"
      : s.startsWith("tech")
      ? "Technical"
      : "News";

  const { label } = normalizeStatus(t?.assignmentStatus ?? t?.status);
  statusKeySet.add(label);
  const row = rows[idx[type]];
  row[label] = (row[label] || 0) + 1;
}
const statusByTypeRows = rows; // keys = Array.from(statusKeySet)


    // ---- Day-Type breakdown (#5) on the *range-filtered* base set (ignores the Day-Type filter to show full mix)
    const dayCounts = { "Weekday": 0, "Weekend": 0, "Public Holiday": 0 };
    for (const t of baseTickets) {
      const kind = dayTypeOfDate(t?.date || t?.createdAt);
      if (kind === "Weekday") dayCounts["Weekday"] += 1;
      else if (kind === "Weekend") dayCounts["Weekend"] += 1;
      else if (kind === "Public Holiday") dayCounts["Public Holiday"] += 1;
    }
    const dayTypeRows = [
      { kind: "Weekday", count: dayCounts["Weekday"] },
      { kind: "Weekend", count: dayCounts["Weekend"] },
      { kind: "Public Holiday", count: dayCounts["Public Holiday"] },
    ];

    // ---- Data Quality (#6)
    const rawStatuses = new Map(); // raw -> normalized
    const badTypes = new Set();
    let invalidDates = 0;

    for (const t of baseTickets) {
      // statuses
      const raw = t?.assignmentStatus ?? t?.status;
      const norm = normalizeStatus(raw).label;
      rawStatuses.set(String(raw ?? ""), norm);

      // types — recognize technical as valid
const ty = String(t?.type || "").trim().toLowerCase();
if (!(ty.startsWith("news") || ty.startsWith("sport") || ty.startsWith("prod") || ty.startsWith("tech"))) {
  if (ty) badTypes.add(ty);
}

      // dates
      const d = new Date(t?.date || t?.createdAt || "");
      if (isNaN(d)) invalidDates += 1;
    }

    const dq = {
      rawStatuses: Array.from(rawStatuses.entries()), // [ [raw, normalized], ... ]
      badTypes: Array.from(badTypes.values()),
      invalidDates,
      statusKeys: Array.from(statusKeySet),
    };

    return {
      sectionPie,
      lineSeries,
      topCamOps,
      topDrivers,
      topNewsroom,
      topSports,
      topProduction,
      statusByTypeRows,
      dayTypeRows,
      dq,
    };
  }, [activeTickets, baseTickets, reporterRoleOf]);

  // ----- Colors (consistent coding) -----
  const palette = {
    newsroom: "#2563eb",        // blue-600
    sports: "#16a34a",          // green-600
    production: "#f59e0b",      // amber-500
    camops: "#06b6d4",          // cyan-500
    drivers: "#9333ea",         // purple-600
    statusA: "#3b82f6",         // blue-500
    statusB: "#ef4444",         // red-500
    statusC: "#f59e0b",         // amber-500
    statusD: "#10b981",         // emerald-500
    statusE: "#a855f7",         // violet-500
    slate500: "#64748b",
    slate400: "#94a3b8",
  };

  // Datasets for the TopAssignedCard (memoized to avoid new refs on each render)
  const topDatasets = useMemo(
    () => ({
      camops: topCamOps,
      drivers: topDrivers,
      news: topNewsroom,
      sports: topSports,
      prod: topProduction,
    }),
    [topCamOps, topDrivers, topNewsroom, topSports, topProduction]
  );

  // ---------- Roster-aware stats (#4) ----------
  const getWeekStartISO = (dateISO) => {
    const d = new Date(dateISO);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return toISODate(d);
  };

  const normalizeName = (val) =>
    String(val || "")
      .replace(/^\s*(cam\s*op|camop|journalist|sports\s*journalist|producer)\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const extractNames = (list) => {
    const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const arr = toArray(list);
    const names = [];
    for (const item of arr) {
      if (!item) continue;
      if (typeof item === "string") {
        item
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((n) => names.push(n));
      } else if (typeof item === "object" && item.name) {
        names.push(String(item.name).trim());
      }
    }
    return Array.from(new Set(names.filter(Boolean)));
  };

  const fetchRosterForWeek = async (weekStartISO) => {
    if (!weekStartISO) return [];
    if (rosterCache.current[weekStartISO]) return rosterCache.current[weekStartISO];
    try {
      const res = await fetch(`${API_BASE}/rosters/${weekStartISO}`);
      if (!res.ok) throw new Error("Roster not found");
      const data = await res.json();
      rosterCache.current[weekStartISO] = Array.isArray(data) ? data : [];
      return rosterCache.current[weekStartISO];
    } catch (err) {
      console.warn("No roster for week:", weekStartISO, err?.message || err);
      rosterCache.current[weekStartISO] = [];
      return [];
    }
  };

  const getGroupsForDate = (weekArr, dateOnlyISO) => {
  const day = (weekArr || []).find(
    (d) => d?.date?.slice(0, 10) === String(dateOnlyISO).slice(0, 10)
  );
  if (!day) return { off: [], afternoonShift: [], onDuty: [] };

  // Support multiple shapes: day.camOps, day.operations.camOps, or fields directly on day
  const camOpsRoot = day.camOps || day.operations?.camOps || day.ops?.camOps || day;

  // Explicit Off
  const off = extractNames(
    camOpsRoot?.off ??
      camOpsRoot?.offDuty ??
      camOpsRoot?.off_cam_ops ??
      day.off ??
      day.offDuty
  );

  // Afternoon / PM
  const afternoonShift = extractNames(
    camOpsRoot?.afternoonShift ??
      camOpsRoot?.pmShift ??
      camOpsRoot?.afternoon ??
      day.afternoonShift ??
      day.pmShift
  );

  // Primary / Directing / News Director
  const primary = extractNames(
    camOpsRoot?.primary ??
      camOpsRoot?.directingNews ??
      camOpsRoot?.directing ??
      day.primary ??
      day.directingNews ??
      day.directing
  );
  const newsDirector = extractNames(
    camOpsRoot?.newsDirector ?? day.newsDirector ?? day.news_director
  );

  // Other on-duty buckets we should treat as matched (non-Off)
  const backup = extractNames(camOpsRoot?.backup ?? day.backup);
  const otherOnDuty = extractNames(
    camOpsRoot?.otherOnDuty ?? camOpsRoot?.other ?? day.otherOnDuty ?? day.other
  );
  const amShift = extractNames(camOpsRoot?.amShift ?? day.amShift);

  // Anyone in any on-duty group (non-Off) is considered "matched"
  const onDuty = Array.from(
    new Set([
      ...primary,
      ...newsDirector,
      ...backup,
      ...otherOnDuty,
      ...amShift,
      ...afternoonShift, // still tracked separately for chart, but considered matched
    ])
  );

  return { off, afternoonShift, onDuty };
};

  useEffect(() => {
    // Build roster-aware counts whenever activeTickets changes
    let cancelled = false;
    (async () => {
      setRosterBusy(true);
      try {
        // Collect unique week starts we need
        const dates = Array.from(
          new Set(
            activeTickets
              .map((t) => toISODate(t?.date || t?.createdAt))
              .filter(Boolean)
          )
        );
        const weekKeys = Array.from(new Set(dates.map(getWeekStartISO)));

        // Preload all needed weeks
        await Promise.all(weekKeys.map(fetchRosterForWeek));

        // Compute counts
        let offDuty = 0;
        let afternoon = 0;
        let primary = 0;
        let unmatched = 0;

        for (const t of activeTickets) {
          const dateOnly = toISODate(t?.date || t?.createdAt);
          if (!dateOnly) continue;
          const weekKey = getWeekStartISO(dateOnly);
          const week = rosterCache.current[weekKey] || [];
          const groups = getGroupsForDate(week, dateOnly);

// (Time-of-day currently not used for bucket choice; keep if needed later)
let hour = 0;
try {
  const iso = new Date(t?.date);
  if (!isNaN(iso)) hour = iso.getHours();
  if (t?.filmingTime && /^\d{2}:\d{2}/.test(t.filmingTime)) {
    const h = parseInt(t.filmingTime.split(":")[0], 10);
    if (Number.isFinite(h)) hour = h;
  }
} catch {}

// Normalize once, use sets for fast membership checks
const OFF = new Set((groups.off || []).map(normalizeName));
const AFT = new Set((groups.afternoonShift || []).map(normalizeName));
const ON  = new Set((groups.onDuty || []).map(normalizeName));

const assigned = Array.isArray(t?.assignedCamOps) ? t.assignedCamOps : [];
for (const rawName of assigned) {
  const n = normalizeName(rawName);
  if (!n) continue;

  if (OFF.has(n)) {
    // Working while marked Off
    offDuty += 1;
  } else if (AFT.has(n)) {
    // Explicit afternoon shift
    afternoon += 1;
  } else if (ON.has(n)) {
    // Any other on-duty roster group (Primary/Directing, News Director, Backup, Other on Duty, AM, etc.)
    primary += 1;
  } else {
    // Only "unmatched" if not found on the roster at all for that day
    unmatched += 1;
  }
}};
      
        if (!cancelled) {
          setRosterStats({ offDuty, afternoon, primary, unmatched });
        }
      } finally {
        if (!cancelled) setRosterBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 space-y-4">
      {/* Data Quality banner (#6) */}
      {(dq.badTypes.length > 0 || dq.invalidDates > 0 || dq.rawStatuses.some(([raw]) => !raw)) && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Data Quality Checks</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {dq.badTypes.length > 0 && (
              <div>
                <strong>Unrecognized request types:</strong>{" "}
                {dq.badTypes.map((t) => `"${t}"`).join(", ")}
                <div className="text-muted-foreground">
  Tip: use one of <em>News</em>, <em>Sports</em>, <em>Production</em>, <em>Technical</em> in the ticket form.
</div>
              </div>
            )}
            {dq.invalidDates > 0 && (
              <div>
                <strong>Tickets with invalid/missing dates:</strong> {dq.invalidDates}
                <div className="text-muted-foreground">
                  These are excluded by time filtering and charts. Ensure <code>date</code> (or <code>createdAt</code>) is valid ISO.
                </div>
              </div>
            )}
            {dq.rawStatuses.length > 0 && (
              <div>
                <strong>Status normalization map:</strong>{" "}
                {dq.rawStatuses.map(([raw, norm], i) => (
                  <span key={i} className="mr-2">{`"${raw || "∅"}" → ${norm}`}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

         {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent
          className={
            rangeMode === "custom"
              ? "grid grid-cols-1 md:grid-cols-7 gap-3"
              : "grid grid-cols-1 md:grid-cols-5 gap-3"
          }
        >
          {/* Time Range */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Time Range</label>
            <select
              value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value)}
              className="border rounded-md px-3 py-2 bg-background"
            >
              <option value="today">Today</option>
              <option value="thisWeek">This Week</option>
              <option value="thisMonth">This Month</option>
              <option value="past3Months">Past 3 Months</option>
              <option value="oneYear">One Year</option>
              <option value="custom">Custom</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Custom Start (only shows for Custom) */}
          {rangeMode === "custom" && (
            <div className="flex flex-col">
              <label className="text-sm font-medium mb-1">Start</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="border rounded-md px-3 py-2 bg-background"
              />
            </div>
          )}

          {/* Custom End (only shows for Custom) */}
          {rangeMode === "custom" && (
            <div className="flex flex-col">
              <label className="text-sm font-medium mb-1">End</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border rounded-md px-3 py-2 bg-background"
              />
            </div>
          )}

          {/* Day Type (#5) */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Day Type</label>
            <select
              value={dayType}
              onChange={(e) => setDayType(e.target.value)}
              className="border rounded-md px-3 py-2 bg-background"
            >
              <option value="all">All</option>
              <option value="weekday">Weekdays</option>
              <option value="weekend">Weekends</option>
              <option value="holiday">Public Holidays</option>
            </select>
          </div>

          {/* Work Volume status selector */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Work Volume Status</label>
            <select
              value={lineStatus}
              onChange={(e) => setLineStatus(e.target.value)}
              className="border rounded-md px-3 py-2 bg-background"
            >
             {[
  "All",
  "Assigned",
  "In Progress",
  "Completed",
  "Postponed",
  "Cancelled",
  "Archived",
  "Recycled",
  "Unassigned",
  "Pending",
].map((label) => (
  <option key={label.toLowerCase()} value={label}>
    {label}
  </option>
))}
            </select>
          </div>

          {/* NEW: Archived Tickets toggle */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Archived Tickets</label>
            <div className="flex items-center h-[42px] px-3 border rounded-md bg-background">
              <input
                id="include-archived"
                type="checkbox"
                className="mr-2"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              <label htmlFor="include-archived" className="text-sm select-none">
                Include
              </label>
            </div>
          </div>

          {/* Reset */}
          <div className="flex items-end">
            <button
              onClick={() => {
                setCustomStart("");
                setCustomEnd("");
                setRangeMode("thisWeek");
                setDayType("all");
                setIncludeArchived(true);
              }}
              className="border rounded-md px-3 py-2 w-full"
            >
              Reset
            </button>
          </div>
        </CardContent>
      </Card>


      {/* Upper row: Requests by Type & Top Assigned */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Requests by Type (News/Sports/Production) */}
        <Card>
          <CardHeader>
            <CardTitle>Requests by Type (News / Sports / Production / Technical)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip />
                    <Legend />
                    <Pie
                      data={sectionPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="45%"
                      outerRadius="70%"
                      paddingAngle={2}
                      label
                    >
                      {sectionPie.map((e, i) => (
                        <Cell
  key={`type-${i}`}
  fill={
    e.name === "News"
      ? palette.newsroom
      : e.name === "Sports"
      ? palette.sports
      : e.name === "Production"
      ? palette.production
      : "#0ea5e9" // sky-500 for Technical
  }
/>
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted-foreground">
                  Counts are based on the ticket <em>request type</em> (News, Sports, Production) — independent of who covered it.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Top Assigned card with its own insights tab */}
        <TopAssignedCard loading={loading} datasets={topDatasets} palette={palette} />
      </div>

      {/* Row: Work Volume & Status by Request Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Work Volume Over Time (by selected status) */}
        <Card>
          <CardHeader>
            <CardTitle>Work Volume Over Time ({lineStatus})</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total" name="Total Tickets" stroke={palette.statusA} />
                  {selectedStatusKey !== "all" && (
                    <Line
                      type="monotone"
                      dataKey={selectedStatusKey || "completed"}
                      name={lineStatus}
                      stroke={palette.statusB}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status by Request Type (stacked) */}
        <Card>
          <CardHeader>
            <CardTitle>Status by Request Type</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              (() => {
                const keys = dq.statusKeys; // normalized status labels present
                const colorFor = (label) => {
  const s = String(label || "").toLowerCase();
  if (s.startsWith("completed")) return palette.statusA;      // blue
  if (s.startsWith("cancel")) return palette.statusB;         // red
  if (s.startsWith("postpon")) return palette.statusC;        // amber
  if (s.startsWith("in progress")) return palette.statusD;    // emerald
  if (s.startsWith("assigned")) return "#0ea5e9";             // sky-500
  if (s.startsWith("archiv")) return "#64748b";               // slate-500-ish for Archived
  if (s.startsWith("recycl") || s.startsWith("trash") || s.startsWith("deleted") || s.startsWith("bin"))
    return "#94a3b8";                                         // lighter slate for Recycled
  if (s.startsWith("pending")) return palette.slate500;       // slate-500
  if (s.startsWith("unassigned")) return palette.slate400;    // slate-400
  return palette.statusE;                                     // violet
};

                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusByTypeRows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      {keys.map((k) => (
                        <Bar key={k} dataKey={k} name={k} stackId="a" fill={colorFor(k)} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row: Day-Type Breakdown (#5) & Roster Impact (#4) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Day-Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Day-Type Breakdown (within selected date range)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayTypeRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="kind" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Tickets">
                    {dayTypeRows.map((row, i) => (
                      <Cell
                        key={`dt-${i}`}
                        fill={
                          row.kind === "Weekday"
                            ? palette.newsroom
                            : row.kind === "Weekend"
                            ? palette.sports
                            : palette.production
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Roster Impact (Cam Ops vs Roster) */}
        <Card>
          <CardHeader>
            <CardTitle>Roster Impact (Cam Ops vs Roster)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading || rosterBusy ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                {loading ? "Loading…" : "Building roster stats…"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { label: "Primary", value: rosterStats.primary },
                    { label: "Afternoon Shift", value: rosterStats.afternoon },
                    { label: "Off Duty", value: rosterStats.offDuty },
                    { label: "Unmatched", value: rosterStats.unmatched },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Assignments">
                    {[
                      { k: "Primary", c: palette.statusD },
                      { k: "Afternoon Shift", c: palette.statusC },
                      { k: "Off Duty", c: palette.statusB },
                      { k: "Unmatched", c: palette.statusE },
                    ].map((e, i) => (
                      <Cell key={`ro-${i}`} fill={e.c} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
  Counts Cam Ops assigned on tickets and compares them to that day’s roster. Anyone listed in any on-duty roster group
 is treated as matched. “Unmatched” only means the name isn’t present anywhere on that day’s roster.
</p>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
