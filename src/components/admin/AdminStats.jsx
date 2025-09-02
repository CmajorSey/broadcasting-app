import { useEffect, useState, useMemo } from "react";
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

// Parse reporter field that may be:
// - "Journalist: Emma Laporte"
// - "Producer: John Doe"
// - "Sports Journalist: Alex"
// - plain "Emma Laporte"
// - or an object { name, role/category }
const parseReporter = (rep) => {
  if (!rep) return { category: "Unknown", name: "" };

  if (typeof rep === "string") {
    const s = rep.trim();
    const parts = s.split(":");
    if (parts.length >= 2) {
      const catRaw = parts[0].trim().toLowerCase();
      const name = parts.slice(1).join(":").trim();
      if (catRaw.startsWith("journalist")) return { category: "Journalist", name };
      if (catRaw.startsWith("sports")) return { category: "Sports Journalist", name };
      if (catRaw.startsWith("producer")) return { category: "Producer", name };
      return { category: "Reporter", name };
    }
    // no prefix
    return { category: "Reporter", name: s };
  }

  if (typeof rep === "object") {
    const name = safeStr(rep?.name) || safeStr(rep?.displayName) || "";
    const role = safeStr(rep?.role) || safeStr(rep?.category) || "";
    if (/^producer/i.test(role)) return { category: "Producer", name };
    if (/^sports/i.test(role)) return { category: "Sports Journalist", name };
    if (/^journalist/i.test(role)) return { category: "Journalist", name };
    return { category: role || "Reporter", name };
  }

  return { category: "Unknown", name: "" };
};

export default function AdminStats() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [rangeMode, setRangeMode] = useState("thisWeek"); // today | thisWeek | thisMonth | past3Months | oneYear | custom | all
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [lineStatus, setLineStatus] = useState("Completed"); // which status to plot over time
  const [insight, setInsight] = useState("Cam Ops"); // Cam Ops | Drivers | Newsroom | Sports Section | Production

  useEffect(() => {
    async function fetchTickets() {
      try {
        const res = await fetch(`${API_BASE}/tickets`);
        const data = await res.json();
        setTickets(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load tickets", err);
        setTickets([]);
      } finally {
        setLoading(false);
      }
    }
    fetchTickets();
  }, []);

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

  // Filter tickets by date range (use ticket.date first, then filmingTime, then createdAt)
  const filteredTickets = useMemo(() => {
    const inRange = (d) => {
      if (!d) return false;
      const x = new Date(d);
      if (isNaN(x)) return false;
      if (startDate && x < startDate) return false;
      if (endDate && x > endDate) return false;
      return true;
    };

    return tickets.filter((t) => {
      const dateField = t?.date || t?.filmingTime || t?.createdAt || null;
      if (rangeMode === "all") return true;
      return inRange(dateField);
    });
  }, [tickets, rangeMode, startDate, endDate]);

  // Aggregations on filtered set
  const {
    statusBar,
    sectionPie,
    lineSeries,
    topCamOps,
    topDrivers,
    topNewsroom,
    topSports,
    topProduction,
    allStatuses,
  } = useMemo(() => {
    // Status breakdown
    const statusCounts = filteredTickets.reduce((acc, t) => {
      const status = safeStr(t?.status) || "Unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const statusBar = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    const allStatuses = Object.keys(statusCounts).sort();

    // Section mapping from reporter categories
    // Journalist => Newsroom, Sports Journalist => Sports Section, Producer => Production, Reporter/Unknown => Newsroom (default)
    const sectionCounts = { "Newsroom": 0, "Sports Section": 0, "Production": 0 };
    const mapNameCount = () => new Map();

    const camOpMap = mapNameCount();
    const driverMap = mapNameCount();
    const newsroomMap = mapNameCount();
    const sportsMap = mapNameCount();
    const productionMap = mapNameCount();

    for (const t of filteredTickets) {
      // Cam Ops (Operations)
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

      // Reporters → sections
      const rep = parseReporter(t?.assignedReporter);
      let section = "Newsroom";
      if (rep.category === "Sports Journalist") section = "Sports Section";
      else if (rep.category === "Producer") section = "Production";

      sectionCounts[section] += 1;

      if (rep.name) {
        if (section === "Newsroom") newsroomMap.set(rep.name, (newsroomMap.get(rep.name) || 0) + 1);
        if (section === "Sports Section") sportsMap.set(rep.name, (sportsMap.get(rep.name) || 0) + 1);
        if (section === "Production") productionMap.set(rep.name, (productionMap.get(rep.name) || 0) + 1);
      }
    }

    const sectionPie = [
      { name: "Newsroom", value: sectionCounts["Newsroom"] },
      { name: "Sports Section", value: sectionCounts["Sports Section"] },
      { name: "Production", value: sectionCounts["Production"] },
    ];

    // Work volume over time (all totals + per-status buckets)
    const byDay = {};
    for (const t of filteredTickets) {
      const iso = toISODate(t?.date || t?.filmingTime || t?.createdAt);
      if (!iso) continue;
      const st = safeStr(t?.status).toLowerCase();

      // Always count total
      if (!byDay[iso]) byDay[iso] = { date: iso, total: 0 };
      byDay[iso].total += 1;

      // Count status-specific buckets
      if (st) {
        const key = st; // e.g., "completed", "postponed"
        byDay[iso][key] = (byDay[iso][key] || 0) + 1;
      }
    }
    const lineSeries = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    // Top lists (sorted desc, top 10 for charts)
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

    return {
      statusBar,
      sectionPie,
      lineSeries,
      topCamOps,
      topDrivers,
      topNewsroom,
      topSports,
      topProduction,
      allStatuses,
    };
  }, [filteredTickets]);

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
  };

  // Select data for “Insight” card (always call this hook)
  const insightData = useMemo(() => {
    if (insight === "Cam Ops") return { title: "Operations – Top Cam Ops", data: topCamOps, color: palette.camops };
    if (insight === "Drivers") return { title: "Drivers – Top Assigned", data: topDrivers, color: palette.drivers };
    if (insight === "Newsroom") return { title: "Newsroom – Top Reporters", data: topNewsroom, color: palette.newsroom };
    if (insight === "Sports Section") return { title: "Sports Section – Top Reporters", data: topSports, color: palette.sports };
    return { title: "Production – Top Producers", data: topProduction, color: palette.production };
  }, [insight, topCamOps, topDrivers, topNewsroom, topSports, topProduction]);

  // Build line keys for status selector (always call this hook)
  const normalizedStatuses = useMemo(() => {
    const uniq = Array.from(new Set(allStatuses.map((s) => safeStr(s))));
    // Normalize to lowercase keys used in lineSeries
    return uniq.map((s) => ({
      label: s || "Unknown",
      key: (s || "unknown").toLowerCase(),
    }));
  }, [allStatuses]);

  return (
    <div className="p-4 space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
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

          {/* Custom Start */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Start</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              disabled={rangeMode !== "custom"}
              className="border rounded-md px-3 py-2 bg-background"
            />
          </div>

          {/* Custom End */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">End</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              disabled={rangeMode !== "custom"}
              className="border rounded-md px-3 py-2 bg-background"
            />
          </div>

          {/* Reset */}
          <div className="flex items-end">
            <button
              onClick={() => {
                setCustomStart("");
                setCustomEnd("");
                setRangeMode("thisWeek");
              }}
              className="border rounded-md px-3 py-2 w-full"
            >
              Reset
            </button>
          </div>

          {/* Insight selector */}
          <div className="flex flex-col">
            <label className="text-sm font-medium mb-1">Insight</label>
            <select
              value={insight}
              onChange={(e) => setInsight(e.target.value)}
              className="border rounded-md px-3 py-2 bg-background"
            >
              <option>Cam Ops</option>
              <option>Drivers</option>
              <option>Newsroom</option>
              <option>Sports Section</option>
              <option>Production</option>
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
              {normalizedStatuses.map((s) => (
                <option key={s.key} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Upper row: Sections & Insight */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Reporter Categories (merged role distribution) */}
        <Card>
          <CardHeader>
            <CardTitle>Reporter Categories (by Section)</CardTitle>
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
                          key={`sec-${i}`}
                          fill={
                            e.name === "Newsroom" ? palette.newsroom :
                            e.name === "Sports Section" ? palette.sports :
                            palette.production
                          }
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted-foreground">
                  Number of assignments per section (Newsroom, Sports Section, Production).
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Insight card – dynamic leader board */}
        <Card>
          <CardHeader>
            <CardTitle>{insightData.title}</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={insightData.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" hide />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Assignments">
                    {insightData.data.map((_, i) => (
                      <Cell key={`ins-${i}`} fill={insightData.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lower row: Work Volume & Status Breakdown */}
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
                  {/* Always show total, plus the chosen status if present */}
                  <Legend />
                  <Line type="monotone" dataKey="total" name="Total Tickets" stroke={palette.statusA} />
                  {/* The lineSeries uses lowercase keys for statuses */}
                  <Line
                    type="monotone"
                    dataKey={safeStr(lineStatus).toLowerCase() || "completed"}
                    name={lineStatus}
                    stroke={palette.statusB}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status Breakdown (counts) */}
        <Card>
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBar}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="status" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Count">
                    {statusBar.map((row, i) => (
                      <Cell
                        key={`st-${i}`}
                        fill={
                          /completed/i.test(row.status) ? palette.statusA :
                          /cancel/i.test(row.status) ? palette.statusB :
                          /postpon/i.test(row.status) ? palette.statusC :
                          /progress/i.test(row.status) ? palette.statusD :
                          palette.statusE
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
