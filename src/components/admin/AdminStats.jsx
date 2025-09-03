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
    const nm = String(name || "").trim().toLowerCase();
    const roles = nameToRoles.get(nm) || [];
    if (roles.includes("sports_journalist")) return "sports";
    if (roles.includes("producer")) return "production";
    if (roles.includes("journalist")) return "news";
    // fallback to ticket type if role unknown
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

  // Filter tickets: exclude archived/deleted; date within range
  const filteredTickets = useMemo(() => {
    const inRange = (d) => {
      if (!d) return false;
      const x = new Date(d);
      if (isNaN(x)) return false;
      if (startDate && x < startDate) return false;
      if (endDate && x > endDate) return false;
      return true;
    };

    const base = tickets.filter((t) => !t?.deleted && !t?.archived);
    if (rangeMode === "all") return base;

    return base.filter((t) => {
      const dateField = t?.date || t?.createdAt || null; // prefer ticket.date (datetime)
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
    // ---- Status breakdown (normalized from assignmentStatus) ----
    const statusCounts = filteredTickets.reduce((acc, t) => {
      const { label } = normalizeStatus(t?.assignmentStatus ?? t?.status);
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
    const statusBar = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    const allStatuses = Object.keys(statusCounts).sort();

    // ---- Section mapping & top lists ----
    const sectionCounts = { "Newsroom": 0, "Sports Section": 0, "Production": 0 };

    const camOpMap = new Map();
    const driverMap = new Map();
    const newsroomMap = new Map();
    const sportsMap = new Map();
    const productionMap = new Map();

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

      // Reporters & Sections
      const reportersRaw = Array.isArray(t?.assignedReporter)
        ? t.assignedReporter
        : typeof t?.assignedReporter === "string" && t.assignedReporter.trim()
        ? [t.assignedReporter]
        : [];

      // top lists per reporter role
      const rolesInTicket = new Set();
      for (const rep of reportersRaw) {
        const roleBucket = reporterRoleOf(rep, t?.type);
        rolesInTicket.add(roleBucket);
        if (roleBucket === "sports") {
          sportsMap.set(rep, (sportsMap.get(rep) || 0) + 1);
        } else if (roleBucket === "production") {
          productionMap.set(rep, (productionMap.get(rep) || 0) + 1);
        } else {
          newsroomMap.set(rep, (newsroomMap.get(rep) || 0) + 1);
        }
      }

      // sectionCounts: classify the ticket once
      if (rolesInTicket.has("sports")) {
        sectionCounts["Sports Section"] += 1;
      } else if (rolesInTicket.has("production")) {
        sectionCounts["Production"] += 1;
      } else {
        // fallback to ticket.type if no reporters or unknown roles
        if (/^sports$/i.test(t?.type || "")) sectionCounts["Sports Section"] += 1;
        else if (/^production$/i.test(t?.type || "")) sectionCounts["Production"] += 1;
        else sectionCounts["Newsroom"] += 1;
      }
    }

    const sectionPie = [
      { name: "Newsroom", value: sectionCounts["Newsroom"] },
      { name: "Sports Section", value: sectionCounts["Sports Section"] },
      { name: "Production", value: sectionCounts["Production"] },
    ];

    // ---- Work volume over time (totals + per-status buckets), using normalized keys ----
    const byDay = {};
    for (const t of filteredTickets) {
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
  }, [filteredTickets, nameToRoles]);

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

  // Build line keys for status selector (canonicalized from assignmentStatus)
  const normalizedStatuses = useMemo(() => {
    const uniq = Array.from(new Set(allStatuses.map((s) => s)));
    return uniq.map((label) => ({ label, key: statusKeyFromLabel(label) }));
  }, [allStatuses]);

  // If the current selected lineStatus no longer exists in the options, auto-pick the first one
  useEffect(() => {
    if (normalizedStatuses.length > 0 && !normalizedStatuses.some((s) => s.label === lineStatus)) {
      setLineStatus(normalizedStatuses[0].label);
    }
  }, [normalizedStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the selected status' normalized key for the line chart
  const selectedStatusKey = useMemo(() => statusKeyFromLabel(lineStatus), [lineStatus]);

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

  return (
    <div className="p-4 space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent
          className={
            rangeMode === "custom"
              ? "grid grid-cols-1 md:grid-cols-5 gap-3"
              : "grid grid-cols-1 md:grid-cols-3 gap-3"
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
                "Unassigned",
                "Pending",
              ].map((label) => (
                <option key={label.toLowerCase()} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Upper row: Sections & Top Assigned (with internal tabs) */}
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

        {/* Top Assigned card with its own insights tab */}
        <TopAssignedCard loading={loading} datasets={topDatasets} palette={palette} />
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
                  <XAxis
                    dataKey="status"
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name, props) => [value, props?.payload?.status || name]}
                  />
                  <Bar dataKey="count" name="Count">
                    {statusBar.map((row, i) => (
                      <Cell
                        key={`st-${i}`}
                        fill={
                          /completed/i.test(row.status) ? palette.statusA :
                          /cancel/i.test(row.status) ? palette.statusB :
                          /postpon/i.test(row.status) ? palette.statusC :
                          /progress/i.test(row.status) ? palette.statusD :
                          /assigned/i.test(row.status) ? "#0ea5e9" : // sky-500
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
