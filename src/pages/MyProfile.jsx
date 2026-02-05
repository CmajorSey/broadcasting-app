import { useEffect, useMemo, useState } from "react";
import API_BASE from "@/api";
import { nextWorkdayISO } from "@/utils/leaveDates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Single source of truth for Leave API endpoints */
const LEAVE_ENDPOINT = `${API_BASE}/leave-requests`;



export default function MyProfile() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [suggestion, setSuggestion] = useState("");
  const [toastEnabled, setToastEnabled] = useState(true);
  const { toast } = useToast();

  // --- Leave Request state (dates+figures visible; half-day aware) ---
const [localOrOverseas, setLocalOrOverseas] = useState("local"); // "local" | "overseas"

// Dates
const [startDate, setStartDate] = useState(""); // "YYYY-MM-DD"
const [endDate,   setEndDate]   = useState(""); // "YYYY-MM-DD"
const [totalWeekdays, setTotalWeekdays] = useState(0); // computed from dates

// Half-day flags on boundaries (none | am | pm)
const [halfDayStart, setHalfDayStart] = useState("none");
const [halfDayEnd,   setHalfDayEnd]   = useState("none");

// User-controlled allocations (now allow halves)
const [annualAlloc, setAnnualAlloc] = useState(0);
const [offAlloc,    setOffAlloc]    = useState(0);

const [resumeOn, setResumeOn] = useState(""); // "YYYY-MM-DD"
const [reason, setReason] = useState("");
const [submitting, setSubmitting] = useState(false);

const [myRequests, setMyRequests] = useState([]);
const [reqLoading, setReqLoading] = useState(false);
const [expandedRequestId, setExpandedRequestId] = useState(null);

// --- My Requests UI controls (filters + pagination) ---
const [myReqFilter, setMyReqFilter] = useState("current"); // all | current | approved | cancelled | none
const [myReqPage, setMyReqPage] = useState(1);
const [myReqPerPage, setMyReqPerPage] = useState(() => {
  const saved = Number(localStorage.getItem("myProfile.requestsPerPage"));
  return [4, 6, 8].includes(saved) ? saved : 6; // default 6
});

// --- Public Holidays (fetched from backend) ---
const [publicHolidays, setPublicHolidays] = useState([]); // ["YYYY-MM-DD"]

useEffect(() => {
  let mounted = true;

  fetch(`${API_BASE}/holidays`)
    .then((res) => res.json())
    .then((data) => {
      if (!mounted) return;
      if (Array.isArray(data)) {
        // Normalize to YYYY-MM-DD strings only
        setPublicHolidays(
          data
            .map((h) => h?.date)
            .filter((d) => typeof d === "string")
        );
      }
    })
    .catch((err) => {
      console.error("Failed to load public holidays:", err);
      setPublicHolidays([]);
    });

  return () => {
    mounted = false;
  };
}, []);

// Single source of truth for requested length:
// - If valid dates => weekdays minus 0.5 for each valid half-day boundary
// - Else => allocations sum
const requestedDays = useMemo(() => {
  const hasDates = !!(startDate && endDate && totalWeekdays > 0);
  if (!hasDates) {
    const sum = Number(annualAlloc) + Number(offAlloc);
    return Number.isFinite(sum) ? sum : 0;
  }

  // Start from computed weekdays
  let t = Number(totalWeekdays) || 0;

  // Helpers to check if a given ISO date is a weekday inside the range
  const isWeekday = (iso) => {
    const d = new Date(iso);
    const day = d.getDay();
    return day !== 0 && day !== 6;
  };

  // Only subtract a half if that boundary day is a weekday we counted
  if (halfDayStart !== "none" && isWeekday(startDate)) {
    t -= 0.5;
  }
  if (halfDayEnd !== "none" && isWeekday(endDate)) {
    if (startDate === endDate) {
      // Same-day request with half-day -> cap to 0.5 day total
      t = 0.5;
    } else {
      t -= 0.5;
    }
  }

  // Guard against negative
  if (t < 0) t = 0;
  return t;
}, [startDate, endDate, totalWeekdays, halfDayStart, halfDayEnd, annualAlloc, offAlloc]);

// ✅ Balances helpers (pull from multiple possible fields)
const getAnnualBalance = (u) =>
  Number(u?.annualLeave ?? u?.balances?.annualLeave ?? 0);
const getOffBalance = (u) =>
  Number(u?.offDays ?? u?.balances?.offDays ?? u?.offDayBalance ?? 0);

// helper: weekday counter (inclusive) — excludes weekends + public holidays
function countWeekdaysInclusive(startISO, endISO, holidays = []) {
  if (!startISO || !endISO) return 0;

  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return 0;
  if (s > e) return 0;

  // Fast lookup set for YYYY-MM-DD
  const holidaySet = new Set(
    Array.isArray(holidays) ? holidays : []
  );

  let count = 0;

  const d = new Date(s);
  d.setHours(0, 0, 0, 0);

  const e0 = new Date(e);
  e0.setHours(0, 0, 0, 0);

  while (d <= e0) {
    const day = d.getDay(); // 0 = Sun, 6 = Sat

    if (day !== 0 && day !== 6) {
      const iso =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      // Only count if NOT a public holiday
      if (!holidaySet.has(iso)) {
        count++;
      }
    }

    d.setDate(d.getDate() + 1);
  }

  return count;
}

// helper: first workday after a given date
// (UNIVERSAL: weekend + public holiday aware)
const nextWorkday = (dateISO) => nextWorkdayISO(dateISO, publicHolidays);

// helper: public holidays inside selected range (weekdays only)
const holidaysInRange = useMemo(() => {
  if (!startDate || !endDate || !Array.isArray(publicHolidays)) return [];

  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s) || isNaN(e) || s > e) return [];

  const out = [];

  for (const iso of publicHolidays) {
    const d = new Date(iso);
    if (isNaN(d)) continue;
    if (d < s || d > e) continue;

    const day = d.getDay();
    if (day === 0 || day === 6) continue; // weekend already excluded

    out.push(iso);
  }

  return out;
}, [startDate, endDate, publicHolidays]);

// ✅ Only recompute totals & resume date when dates change; DO NOT touch allocations.
useEffect(() => {
  const T = countWeekdaysInclusive(startDate, endDate, publicHolidays);
  setTotalWeekdays(T);

  // ✅ Resume must skip weekends AND public holidays
  setResumeOn(endDate ? nextWorkdayISO(endDate, publicHolidays) : "");
}, [startDate, endDate, publicHolidays]);

// ✅ Load user + notifications (one-time)
useEffect(() => {
  const override = localStorage.getItem("adminViewAs");
  const fallback = localStorage.getItem("loggedInUser");
  const parsed = override || fallback;
  const parsedUser = parsed ? JSON.parse(parsed) : null;

  const toastPref = localStorage.getItem("notificationToastsEnabled");
  setToastEnabled(toastPref !== "false");

  if (!parsedUser) return;

  setUser(parsedUser);

  // Normalize dismissed timestamps to seconds precision
  const rawDismissed = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]") || [];
  const hiddenTimestamps = rawDismissed.reduce((acc, t) => {
    try {
      if (!t) return acc;
      const date = new Date(t);
      if (isNaN(date)) {
        console.warn("Skipping invalid timestamp in localStorage:", t);
        return acc;
      }
      acc.push(date.toISOString().split(".")[0]);
    } catch (err) {
      console.error("Error processing dismissed timestamp:", t, err);
    }
    return acc;
  }, []);

  Promise.all([
  fetch(`${API_BASE}/notifications`).then((res) => res.json()),
  fetch(`${API_BASE}/notification-groups`).then((res) => res.json()),
])
  .then(([allNotifications, allGroups]) => {
    const userName = parsedUser.name;
    const section = getSection(parsedUser); // ✅ use existing helper
    const userGroups = allGroups.filter((group) => group.userIds.includes(parsedUser.id));
    const groupIds = userGroups.map((g) => g.id);

      const relevant = allNotifications.filter((note) => {
        try {
          const noteDate = new Date(note.timestamp);
          if (isNaN(noteDate)) {
            console.warn("Skipping invalid notification timestamp:", note.timestamp);
            return false;
          }
          const noteTime = noteDate.toISOString().split(".")[0];

          return (
            (note.recipients.includes(userName) ||
              note.recipients.includes(section) ||
              note.recipients.some((r) => groupIds.includes(r))) &&
            !hiddenTimestamps.includes(noteTime)
          );
        } catch (err) {
          console.error("Failed to process note:", note, err);
          return false;
        }
      });

      relevant.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setNotifications(relevant);

      const lastSeen = localStorage.getItem("lastNotificationSeen");
      const latest = relevant[0]?.timestamp;
      if (toastEnabled && latest && latest !== lastSeen) {
        toast({ title: relevant[0].title, description: relevant[0].message });
        localStorage.setItem("lastNotificationSeen", latest);
      }
    })
    .catch((err) => console.error("Failed to fetch notifications or groups", err));
}, []); // do not include toastEnabled to avoid re-trigger

// ✅ Enrich user with server copy (for balances) — fetch one user, normalize numeric fields
useEffect(() => {
  // Need at least an id OR a name
  if (!user?.id && !user?.name) return;

  const load = async () => {
    try {
      let fresh;

      if (user?.id) {
        // Prefer exact id (fast, up-to-date, no large payload)
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(String(user.id))}`);
        if (res.ok) {
          fresh = await res.json();
        } else {
          // Fallback to /users list if direct fetch failed (rare)
          const list = await fetch(`${API_BASE}/users`).then(r => r.json());
          fresh = list.find(u => String(u.id) === String(user.id)) || list.find(u => u.name === user?.name);
        }
      } else {
        // No id in localStorage; fallback match by name
        const list = await fetch(`${API_BASE}/users`).then(r => r.json());
        fresh = list.find(u => u.name === user?.name);
      }

      if (!fresh) return;

      // 🔁 Normalize balances to numbers and prefer top-level keys
      const norm = {
        ...fresh,
        annualLeave: Number(
          fresh?.annualLeave ?? fresh?.balances?.annualLeave ?? 0
        ),
        offDays: Number(
          fresh?.offDays ?? fresh?.balances?.offDays ?? fresh?.offDayBalance ?? 0
        ),
      };

      // Only update if different (prevents render loops)
      if (JSON.stringify(norm) !== JSON.stringify(user)) {
        setUser(norm);
      }
    } catch (err) {
      console.error("Failed to fetch user balances (direct):", err);
    }
  };

  load();
  // Re-run if id or name changes
}, [user?.id, user?.name]);


// --- Fetch my leave requests when user known (NEW) ---
const loadMyRequests = useMemo(
  () => async () => {
    if (!user?.id) return;
    setReqLoading(true);
    try {
      // Your backend uses /leave-requests with ?userId=
      const res = await fetch(`${LEAVE_ENDPOINT}?userId=${encodeURIComponent(String(user.id))}`);
      const data = (await res.json()) || [];
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setMyRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setMyRequests([]);
    } finally {
      setReqLoading(false);
    }
  },
  [user?.id]
);

useEffect(() => {
  loadMyRequests();
}, [loadMyRequests]);

// ✅ Keep MyProfile aligned with Admin edits/cancels:
// - refresh requests + user balances periodically
// - refresh when the tab becomes active again
useEffect(() => {
  if (!user?.id) return;

  const refresh = async () => {
    // 1) refresh my requests
    await loadMyRequests();

    // 2) refresh my user balances (server truth)
    try {
      const res = await fetch(`${API_BASE}/users/${encodeURIComponent(String(user.id))}`);
      if (res.ok) {
        const fresh = await res.json();
        setUser((prev) => {
          const norm = {
            ...fresh,
            annualLeave: Number(fresh?.annualLeave ?? fresh?.balances?.annualLeave ?? 0),
            offDays: Number(fresh?.offDays ?? fresh?.balances?.offDays ?? fresh?.offDayBalance ?? 0),
          };
          // prevent loops
          return JSON.stringify(prev) === JSON.stringify(norm) ? prev : norm;
        });
      }
    } catch {
      // non-fatal
    }
  };

  // refresh now (in case admin just edited something)
  refresh();

  const onFocus = () => refresh();
  const onVis = () => {
    if (document.visibilityState === "visible") refresh();
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);

  // light polling (keeps it synced even if tab stays open)
  const t = setInterval(refresh, 20000); // 20s

  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
    clearInterval(t);
  };
}, [user?.id, loadMyRequests]);


const handleDismiss = async (timestamp) => {
  const baseTimestamp = new Date(timestamp).toISOString().split(".")[0]; // seconds
  const utcParam = `${baseTimestamp}Z`; // ensure UTC

  // Optimistic UI update
  const existing = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
  const updatedDismissed = [...new Set([...existing, baseTimestamp])];
  localStorage.setItem("dismissedNotifications", JSON.stringify(updatedDismissed));

  setNotifications((prev) =>
    prev.filter((n) => {
      try {
        return new Date(n.timestamp).toISOString().split(".")[0] !== baseTimestamp;
      } catch {
        return true;
      }
    })
  );

  // Attempt backend delete (best effort)
  try {
    const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(utcParam)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete notification");
  } catch (err) {
    console.error("Failed to delete notification from backend:", err);
  }
};

const handleSuggestionSubmit = async () => {
  if (!suggestion.trim()) return;

  const payload = {
    userId: user?.id ? String(user.id) : null,
    userName: user?.name || "Anonymous",
    section: getSection(),
    message: suggestion.trim(),
  };

  try {
    const res = await fetch(`${API_BASE}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Failed to submit suggestion");
    }

    setSuggestion("");
    toast({ title: "✅ Suggestion sent!" });
  } catch (err) {
    console.error("Error submitting suggestion:", err);
    toast({ title: "Error", description: "Failed to submit suggestion" });
  }
};

const getSection = () => {
  if (!user) return "N/A";
  const name = user.name || "";
  const desc = user.description?.toLowerCase() || "";

  if (["clive camille", "jennifer arnephy", "gilmer philoe"].includes(name.toLowerCase())) {
    return "Admin";
  } else if (desc.includes("sports journalist")) {
    return "Sports Section";
  } else if (desc.includes("journalist")) {
    return "Newsroom";
  } else if (/cam ?op|camera ?operator|operations/i.test(desc)) {
    return "Operations";
  } else if (desc.includes("producer") || desc.includes("production")) {
    return "Production";
  }

  return user.section || "Unspecified";
};

// --- Submit new leave request (dates preferred; supports half-days; else figures) ---
const submitLeaveRequest = async () => {
  if (!user?.id || !user?.name) {
    toast({ title: "Not logged in", description: "User not found.", variant: "destructive" });
    return;
  }
  if (!["local", "overseas"].includes(localOrOverseas)) {
    toast({ title: "Invalid trip", description: "Choose Local or Overseas.", variant: "destructive" });
    return;
  }

  const haveDates = !!(startDate && endDate);
  const T = Number(requestedDays) || 0;

  if (haveDates && totalWeekdays <= 0) {
    toast({
      title: "Invalid range",
      description: "No weekdays in the selected range. Adjust your dates.",
      variant: "destructive",
    });
    return;
  }
  if (!haveDates && T <= 0) {
    toast({
      title: "Days required",
      description: "Enter Annual + Off to set the length (or choose dates).",
      variant: "destructive",
    });
    return;
  }

  const currentAnnual = Number(user?.annualLeave ?? 0);
  const currentOff    = Number(user?.offDays ?? 0);
  let A = Number(annualAlloc);
  let O = Number(offAlloc);
  if (!Number.isFinite(A) || A < 0) A = 0;
  if (!Number.isFinite(O) || O < 0) O = 0;

  if (haveDates && (A + O !== T)) {
    toast({
      title: "Allocation mismatch",
      description: `Annual + Off must equal ${T} day(s) from your date range.`,
      variant: "destructive",
    });
    return;
  }
  if (A > currentAnnual || O > currentOff) {
    toast({
      title: "Insufficient balance",
      description: "Your allocation exceeds available Annual/Off balances.",
      variant: "destructive",
    });
    return;
  }

  // Backend requires a single `type` and a positive `days`
  const hasAnnual = A > 0;
  const hasOff    = O > 0;
  const type = hasAnnual ? "annual" : "offDay";
  const days = hasAnnual ? A : O; // <-- EXACT FIELD NAME the backend wants

  if (!(Number(days) > 0)) {
    toast({
      title: "Days must be > 0",
      description: "Please set Annual or Off allocation to a positive number.",
      variant: "destructive",
    });
    return;
  }

  const payload = {
    // required by backend validator
    type,                 // "annual" | "offDay"
    days: Number(days),   // <-- REQUIRED FIELD

    // identity
    userId: String(user.id),
    userName: user.name,
    section: getSection(),

    // dates/meta
    startDate: haveDates ? startDate : null,
    endDate:   haveDates ? endDate   : null,
    resumeWorkOn: haveDates ? (resumeOn || nextWorkdayISO(endDate, publicHolidays)) : null,
    localOrOverseas,
    reason: reason.trim(),

    // reviewer metadata (ignored if server doesn’t use them)
    halfDayStart,
    halfDayEnd,

    // compatibility fields your UI/history uses (server may ignore)
    totalWeekdays: T,
    allocations: { annual: A, off: O },

    // optional client snapshot hints
    annualBefore: type === "annual" ? currentAnnual : undefined,
    annualAfter:  type === "annual" ? Math.max(0, currentAnnual - Number(days)) : undefined,
    offBefore:    type === "offDay" ? currentOff    : undefined,
    offAfter:     type === "offDay" ? Math.max(0, currentOff - Number(days))    : undefined,

    status: "pending",
    createdAt: new Date().toISOString(),
  };

  setSubmitting(true);
  try {
    const res = await fetch(LEAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = "Failed to create leave request";
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    // Reset fields and reload my requests
    setReason("");
    setLocalOrOverseas("local");
    setStartDate("");
    setEndDate("");
    setTotalWeekdays(0);
    setHalfDayStart("none");
    setHalfDayEnd("none");
    setAnnualAlloc(0);
    setOffAlloc(0);
    setResumeOn("");

    await loadMyRequests();
    toast({ title: "✅ Request submitted", description: "Awaiting approval." });
  } catch (err) {
    console.error(err);
    toast({
      title: "Error",
      description: err?.message || "Could not submit request",
      variant: "destructive",
    });
  } finally {
    setSubmitting(false);
  }
};


  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold">My Profile</h1>

      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>User Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {localStorage.getItem("adminViewAs") && (
            <p className="text-sm italic text-muted-foreground mb-2">
              Viewing as: <strong>{user?.name}</strong>
            </p>
          )}
          <p><strong>Full Name:</strong> {user?.name || "N/A"}</p>
          <p><strong>Role(s):</strong> {Array.isArray(user?.roles) ? user.roles.join(", ") : user?.roles}</p>
          <p><strong>Description:</strong> {user?.description || "N/A"}</p>
          <p><strong>Section:</strong> {getSection()}</p>

          {/* 🔁 Match LeaveManager fields exactly */}
          <p><strong>Annual Leave (max 42):</strong> {user?.annualLeave ?? "N/A"} days</p>
          <p><strong>Off Days:</strong> {Number(user?.offDays ?? user?.balances?.offDays ?? user?.offDayBalance ?? 0)} days</p>
          {user?.currentLeaveStatus && (
            <p><strong>Status:</strong> {user.currentLeaveStatus}</p>
          )}
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-3">
            <Switch
              checked={toastEnabled}
              onCheckedChange={(checked) => {
                setToastEnabled(checked);
                localStorage.setItem("notificationToastsEnabled", checked);
              }}
            />
            <Label>Enable popup toasts for new notifications</Label>
          </div>
        </CardContent>
      </Card>

      {/* Notifications Inbox */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Notifications Inbox</CardTitle>
          {notifications.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const dismissed = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
                const allTimestamps = notifications
                  .map((n) => {
                    try {
                      return new Date(n.timestamp).toISOString().split(".")[0];
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean);
                const updated = [...new Set([...dismissed, ...allTimestamps])];
                localStorage.setItem("dismissedNotifications", JSON.stringify(updated));
                setNotifications([]);
              }}
            >
              Clear All
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="border rounded p-2 max-h-[300px] overflow-y-auto space-y-3">
            {notifications.length === 0 ? (
              <p className="text-muted-foreground text-sm">No notifications yet.</p>
            ) : (
              notifications.map((note) => (
                <div
                  key={`${note.timestamp}-${note.title}-${note.message}`}
                  className="relative border p-3 rounded bg-muted pr-10"
                >
                  <button
                    className="absolute top-1 right-1 text-gray-500 hover:text-red-500 text-xs"
                    onClick={() => handleDismiss(note.timestamp)}
                  >
                    ✕
                  </button>

                  <p className="font-semibold">{note.title}</p>
                  <p className="text-sm">{note.message}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(note.timestamp).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

     {/* --- Leave Request (MANUAL ALLOC FIRST) --- */}
{(() => {
  // ✅ Date formatting helpers (safe + timezone-stable for YYYY-MM-DD)
  const formatLeaveDate = (iso) => {
    if (!iso || typeof iso !== "string") return "—";
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts.map((x) => Number(x));
    if (!y || !m || !d) return iso;

    const dt = new Date(y, m - 1, d); // local-safe (no UTC drift)
    const formatted = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    }).format(dt);

    // "04 Feb 26" -> "04/Feb/26"
    return formatted.replace(/ /g, "/");
  };

  const formatRange = (start, end) => {
    if (!start || !end) return "Dates not selected";
    return `${formatLeaveDate(start)} → ${formatLeaveDate(end)}`;
  };

  const formatResume = (iso) => {
    if (!iso) return null;
    return `Resume: ${formatLeaveDate(iso)}`;
  };

  const halfDayLabel = (pos, val) => {
    if (!val || val === "none") return null;
    const side = pos === "start" ? "Start" : "End";
    const when = val === "am" ? "AM" : "PM";
    return `${side} half-day (${when})`;
  };

  const halfStartText = halfDayLabel("start", halfDayStart);
  const halfEndText = halfDayLabel("end", halfDayEnd);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Leave Request</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            It is recommended to apply for leave at least{" "}
            <strong>two weeks in advance</strong> to support planning and
            coverage.
          </p>

          {startDate && !endDate && (
            <p className="text-xs text-amber-600 mt-2">
              Select an <strong>End Date</strong> to calculate weekdays and
              validate allocations.
            </p>
          )}
          {!startDate && endDate && (
            <p className="text-xs text-amber-600 mt-2">
              Select a <strong>Start Date</strong> to calculate weekdays and
              validate allocations.
            </p>
          )}
        </div>

        {/* Right-side compact pills (no inputs) */}
        <div className="flex flex-col items-end gap-1 text-xs">
          {startDate && endDate ? (
            <>
              <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                {formatRange(startDate, endDate)}
              </div>

              {/* ✅ Half-day indicators */}
              {(halfStartText || halfEndText) && (
                <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                  {halfStartText ? halfStartText : null}
                  {halfStartText && halfEndText ? " • " : null}
                  {halfEndText ? halfEndText : null}
                </div>
              )}

              {holidaysInRange.length > 0 && (
  <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
    Public holidays excluded: {holidaysInRange.length}
  </div>
)}

{resumeOn && (
  <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
    {formatResume(resumeOn)}
  </div>
)}
            </>
          ) : (
            <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
              Dates not selected
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 1) Dates & trip type first — with half-day selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                // Reset half-day if date cleared
                if (!e.target.value) setHalfDayStart("none");
              }}
            />

            {/* Half-day on start (only makes sense if date picked) */}
            {startDate && (
              <div className="mt-2">
                <Label className="text-xs block mb-1">Start Day</Label>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={halfDayStart}
                  onChange={(e) => setHalfDayStart(e.target.value)}
                >
                  <option value="none">Full day</option>
                  <option value="am">Half day (AM)</option>
                  <option value="pm">Half day (PM)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (!e.target.value) setHalfDayEnd("none");
              }}
            />

            {/* Half-day on end (only makes sense if date picked) */}
            {endDate && (
              <div className="mt-2">
                <Label className="text-xs block mb-1">End Day</Label>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={halfDayEnd}
                  onChange={(e) => setHalfDayEnd(e.target.value)}
                >
                  <option value="none">Full day</option>
                  <option value="am">Half day (AM)</option>
                  <option value="pm">Half day (PM)</option>
                </select>
              </div>
            )}
          </div>

          {/* Trip type */}
          <div className="sm:col-span-1">
            <Label>Local / Overseas</Label>
            <select
              className="w-full border rounded px-3 py-2"
              value={localOrOverseas}
              onChange={(e) => setLocalOrOverseas(e.target.value)}
            >
              <option value="local">Local</option>
              <option value="overseas">Overseas</option>
            </select>
          </div>
        </div>

        {/* 2) Number of days requested (dates win if valid; else figures; supports half-days) */}
        <div className="rounded border p-3 text-sm">
          <span className="font-medium">Number of days requested:</span>{" "}
          <span>
  {startDate && endDate ? (
    totalWeekdays > 0 ? (
      `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`
    ) : (
      "— invalid range —"
    )
  ) : (
    `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`
  )}
</span>

{holidaysInRange.length > 0 && (
  <div className="text-xs text-muted-foreground mt-1">
    ℹ️ {holidaysInRange.length} public holiday
    {holidaysInRange.length > 1 ? "s are" : " is"} excluded from this range.
  </div>
)}

          {startDate &&
            endDate &&
            totalWeekdays > 0 &&
            Math.round((Number(annualAlloc) + Number(offAlloc)) * 2) / 2 !==
              requestedDays && (
              <span className="text-xs ml-2 text-amber-600">
                (allocations must equal {requestedDays})
              </span>
            )}
        </div>

        {/* 3) Auto Allocate */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const balAnnual = Number(getAnnualBalance(user)) || 0;
              const balOff = Number(getOffBalance(user)) || 0;

              const target = Number(requestedDays) || 0;

              const annual = Math.min(balAnnual, target);
              const remaining = Math.max(0, target - annual);
              const off = Math.min(balOff, remaining);

              setAnnualAlloc(Math.round(annual * 2) / 2);
              setOffAlloc(Math.round(off * 2) / 2);
            }}
            disabled={submitting || !(Number(requestedDays) > 0)}
          >
            Auto Allocate
          </Button>

          <p className="text-xs text-muted-foreground flex items-center">
            Fills <strong className="mx-1">Annual</strong> first, then{" "}
            <strong className="mx-1">Off Days</strong>.
          </p>
        </div>

        {/* 4) Allocations underneath */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>
              Annual Leave to use{" "}
              <span className="text-muted-foreground">
                (you have {getAnnualBalance(user)})
              </span>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              max={getAnnualBalance(user)}
              value={annualAlloc}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (!Number.isFinite(val) || val < 0) val = 0;
                val = Math.round(val * 2) / 2;
                setAnnualAlloc(val);
              }}
            />
            {Math.max(0, annualAlloc - getAnnualBalance(user)) > 0 && (
              <p className="text-xs text-red-600 mt-1">
                You selected {annualAlloc} but only have{" "}
                {getAnnualBalance(user)} Annual. Reduce by{" "}
                {annualAlloc - getAnnualBalance(user)} or move days to Off.
              </p>
            )}
          </div>

          <div>
            <Label>
              Off Days to use{" "}
              <span className="text-muted-foreground">
                (you have {getOffBalance(user)})
              </span>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              max={getOffBalance(user)}
              value={offAlloc}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (!Number.isFinite(val) || val < 0) val = 0;
                val = Math.round(val * 2) / 2;
                setOffAlloc(val);
              }}
            />
            {Math.max(0, offAlloc - getOffBalance(user)) > 0 && (
              <p className="text-xs text-red-600 mt-1">
                You selected {offAlloc} but only have {getOffBalance(user)} Off
                Days. Reduce by {offAlloc - getOffBalance(user)} or move days to
                Annual.
              </p>
            )}
          </div>
        </div>

        {/* 5) Reason */}
        <div>
          <Label>Reason (optional)</Label>
          <Textarea
            placeholder="Brief reason for your request…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* 6) Balances preview (provisional) */}
        <div className="rounded border p-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="font-medium">Annual:</span>{" "}
            <span>{getAnnualBalance(user)}</span>
            <span className="text-blue-600 ml-2">
              → {Math.max(0, getAnnualBalance(user) - Number(annualAlloc))}
            </span>{" "}
            <span className="text-muted-foreground">(provisional)</span>
          </div>
          <div>
            <span className="font-medium">Off Days:</span>{" "}
            <span>{getOffBalance(user)}</span>
            <span className="text-blue-600 ml-2">
              → {Math.max(0, getOffBalance(user) - Number(offAlloc))}
            </span>{" "}
            <span className="text-muted-foreground">(provisional)</span>
          </div>
        </div>

        {/* 7) Actions */}
        <div className="flex gap-2">
          <Button
            onClick={submitLeaveRequest}
            disabled={
              submitting ||
              (startDate && endDate
                ? totalWeekdays <= 0 ||
                  Math.round((Number(annualAlloc) + Number(offAlloc)) * 2) / 2 !==
                    requestedDays
                : requestedDays <= 0) ||
              annualAlloc > getAnnualBalance(user) ||
              offAlloc > getOffBalance(user)
            }
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setLocalOrOverseas("local");
              setStartDate("");
              setEndDate("");
              setTotalWeekdays(0);
              setHalfDayStart("none");
              setHalfDayEnd("none");
              setAnnualAlloc(0);
              setOffAlloc(0);
              setResumeOn("");
              setReason("");
            }}
            disabled={submitting}
          >
            Reset
          </Button>
        </div>

             {/* 8) My Requests (clean + filters + pagination) */}
        <div className="mt-4 border rounded">
          <div className="px-3 py-2 bg-muted/40 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm font-medium">My Requests</div>

              {/* Per-page selector */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Per page</span>
                <select
                  className="border rounded px-2 py-1 text-xs"
                  value={myReqPerPage}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const safe = [4, 6, 8].includes(n) ? n : 6;
                    setMyReqPerPage(safe);
                    localStorage.setItem("myProfile.requestsPerPage", String(safe));
                    setMyReqPage(1);
                  }}
                >
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                </select>
              </div>
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "current", label: "Current" },
                { key: "all", label: "All" },
                { key: "approved", label: "Approved" },
                { key: "cancelled", label: "Cancelled" },
                { key: "none", label: "None" },
              ].map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={myReqFilter === f.key ? "default" : "outline"}
                  onClick={() => {
                    setMyReqFilter(f.key);
                    setMyReqPage(1);
                  }}
                  className="h-7 px-3 text-xs"
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          {(() => {
            const safeISO = (v) => (typeof v === "string" ? v : "");

            const toLocalDate = (isoStr) => {
              const s = safeISO(isoStr);
              if (!s) return null;
              const parts = s.split("-");
              if (parts.length !== 3) return null;
              const [y, m, d] = parts.map((x) => Number(x));
              if (!y || !m || !d) return null;
              return new Date(y, m - 1, d); // local-safe
            };

            const normalizeStatus = (s) => {
              const v = String(s || "pending").toLowerCase();
              if (v === "denied") return "cancelled";
              return v;
            };

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const isCurrentRequest = (r) => {
              const status = normalizeStatus(r?.status);
              if (status === "cancelled") return false;

              if (status === "pending") return true;

              if (status === "approved") {
                const end = toLocalDate(r?.endDate);
                if (!end) return true;
                end.setHours(0, 0, 0, 0);
                return today <= end;
              }

              return false;
            };

            const matchesFilter = (r) => {
              const status = normalizeStatus(r?.status);

              if (myReqFilter === "none") return false;
              if (myReqFilter === "all") return true;
              if (myReqFilter === "approved") return status === "approved";
              if (myReqFilter === "cancelled") return status === "cancelled";
              if (myReqFilter === "current") return isCurrentRequest(r);

              return true;
            };

            const filtered = Array.isArray(myRequests) ? myRequests.filter(matchesFilter) : [];

            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / myReqPerPage));
            const page = Math.min(Math.max(1, myReqPage), totalPages);
            const startIdx = (page - 1) * myReqPerPage;
            const pageItems = filtered.slice(startIdx, startIdx + myReqPerPage);

            const formatLeaveDate = (iso) => {
              if (!iso || typeof iso !== "string") return "—";
              const parts = iso.split("-");
              if (parts.length !== 3) return iso;
              const [y, m, d] = parts.map((x) => Number(x));
              if (!y || !m || !d) return iso;
              const dt = new Date(y, m - 1, d);
              const formatted = new Intl.DateTimeFormat("en-GB", {
                day: "2-digit",
                month: "short",
                year: "2-digit",
              }).format(dt);
              return formatted.replace(/ /g, "/");
            };

            const statusPill = (r) => {
              const s = normalizeStatus(r?.status);
              const base = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium border";
              if (s === "approved") return <span className={`${base} bg-emerald-50 border-emerald-200 text-emerald-700`}>Approved</span>;
              if (s === "cancelled") return <span className={`${base} bg-rose-50 border-rose-200 text-rose-700`}>Cancelled</span>;
              return <span className={`${base} bg-amber-50 border-amber-200 text-amber-700`}>Pending</span>;
            };

            const typePill = (r) => {
              const t = String(r?.type || "").toLowerCase();
              const base = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium border bg-muted/30";
              if (t === "annual") return <span className={base}>Annual</span>;
              if (t === "offday" || t === "off_day") return <span className={base}>Off Day</span>;
              return <span className={base}>Leave</span>;
            };

            // ✅ Show server truth for days + allocations:
            // - requestedDays/totalWeekdays/days as fallback
            // - if approved and server wrote appliedAnnual/appliedOff, show those
            const showDays = (r) =>
              r?.requestedDays ??
              r?.daysRequested ??
              r?.totalWeekdays ??
              r?.days ??
              "—";

            const allocAnnual = (r) =>
              r?.appliedAnnual ?? r?.allocations?.annual ?? r?.annualAlloc ?? 0;

            const allocOff = (r) =>
              r?.appliedOff ?? r?.allocations?.off ?? r?.offAlloc ?? 0;

            const returnISO = (r) => {
              const resume = safeISO(r?.resumeWorkOn || r?.resumeOn);
              if (resume) return resume;
              const e = safeISO(r?.endDate);
              if (!e) return "";
              return nextWorkdayISO(e, publicHolidays);
            };

            if (reqLoading) {
              return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
            }

            if (myReqFilter === "none") {
              return <div className="p-3 text-sm text-muted-foreground">(None) — showing no requests.</div>;
            }

            if (!Array.isArray(myRequests) || myRequests.length === 0) {
              return <div className="p-3 text-sm text-muted-foreground">No requests yet.</div>;
            }

            if (filtered.length === 0) {
              const msg =
                myReqFilter === "approved"
                  ? "No approved requests yet."
                  : myReqFilter === "cancelled"
                  ? "No cancelled requests."
                  : myReqFilter === "current"
                  ? "You have no current requests."
                  : "No requests found.";
              return <div className="p-3 text-sm text-muted-foreground">{msg}</div>;
            }

            return (
              <div className="p-3 space-y-2">
                <div className="space-y-2">
                  {pageItems.map((r) => {
                    const status = normalizeStatus(r?.status);
                    const a = Number(allocAnnual(r)) || 0;
                    const o = Number(allocOff(r)) || 0;
                    const hasAlloc = a > 0 || o > 0;

                    const editedBy = r?.lastEditedByName || r?.editedByName || "";
                    const editedAt = r?.lastEditedAt || r?.editedAt || "";

                    return (
                      <div key={r.id} className="border rounded p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {typePill(r)}
                            {statusPill(r)}
                            <span className="text-xs text-muted-foreground capitalize">
                              {r?.localOrOverseas || "—"}
                            </span>
                          </div>

                          <div className="text-xs text-muted-foreground">
                            {r?.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                          </div>
                        </div>

                        <div className="mt-2 text-sm">
                          <div className="font-medium">
                            {formatLeaveDate(r.startDate)} → {formatLeaveDate(r.endDate)}
                          </div>

                          <div className="text-xs text-muted-foreground mt-1">
                            Returns: <span className="font-medium">{formatLeaveDate(returnISO(r))}</span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Days:</span> {showDays(r)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Alloc:</span>{" "}
                            {hasAlloc ? `${a} Annual / ${o} Off` : "—"}
                          </div>
                        </div>

                        {status === "approved" && (r?.appliedAnnual != null || r?.appliedOff != null) && (
                          <div className="mt-2 text-[11px] text-gray-600">
                            ✅ Applied (server): Annual {Number(r?.appliedAnnual ?? 0)} • Off {Number(r?.appliedOff ?? 0)}
                          </div>
                        )}

                        {(editedBy || editedAt) && (
                          <div className="mt-2 text-[11px] text-gray-500">
                            Edited by {editedBy || "—"} at {editedAt ? new Date(editedAt).toLocaleString() : "—"}
                          </div>
                        )}

                        {r?.reason ? (
                          <div className="mt-2 text-sm whitespace-pre-wrap">{r.reason}</div>
                        ) : null}

                        {/* Admin note (clean toggle) */}
                        {["approved", "cancelled"].includes(status) && r?.decisionNote ? (
                          <div className="mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                setExpandedRequestId((prev) => (prev === r.id ? null : r.id))
                              }
                            >
                              {expandedRequestId === r.id ? "Hide admin note" : "View admin note"}
                            </Button>

                            {expandedRequestId === r.id && (
                              <div className="mt-2 text-xs text-muted-foreground border-l-2 pl-2 whitespace-pre-wrap">
                                {r.decisionNote}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    Showing {Math.min(total, startIdx + 1)}–{Math.min(total, startIdx + myReqPerPage)} of {total}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setMyReqPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      ← Prev
                    </Button>

                    <div className="text-xs text-muted-foreground">
                      Page {page} / {totalPages}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setMyReqPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      Next →
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
})()}

      {/* Suggestion Box */}
      <Card>
        <CardHeader>
          <CardTitle>Suggestion Box</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Write your suggestion here..."
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
          />
          <Button onClick={handleSuggestionSubmit}>Submit Suggestion</Button>
        </CardContent>
      </Card>
    </div>
  );
}
