import { useEffect, useMemo, useState } from "react";
import API_BASE from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Single source of truth for Leave API endpoints */
const LEAVE_ENDPOINT = `${API_BASE}/leave-requests`;


import LeaveSection from "@/components/profile/LeaveSection";


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

// helper: weekday counter (inclusive)
function countWeekdaysInclusive(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return 0;
  if (s > e) return 0;
  let c = 0;
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  const e0 = new Date(e);
  e0.setHours(0, 0, 0, 0);
  while (d <= e0) {
    const day = d.getDay(); // 0 Sun, 6 Sat
    if (day !== 0 && day !== 6) c++;
    d.setDate(d.getDate() + 1);
  }
  return c;
}

// helper: first workday after a given date
function nextWorkday(dateISO) {
  if (!dateISO) return "";
  const d = new Date(dateISO);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + 1);
  let day = d.getDay();
  while (day === 0 || day === 6) {
    d.setDate(d.getDate() + 1);
    day = d.getDay();
  }
  // format YYYY-MM-DD
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ✅ Only recompute totals & resume date when dates change; DO NOT touch allocations.
useEffect(() => {
  const T = countWeekdaysInclusive(startDate, endDate);
  setTotalWeekdays(T);
  setResumeOn(endDate ? nextWorkday(endDate) : "");
}, [startDate, endDate]);

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
    resumeWorkOn: haveDates ? (resumeOn || nextWorkday(endDate)) : null,
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
<Card>
  <CardHeader className="flex flex-row items-start justify-between gap-4">
    <div>
      <CardTitle>Leave Request</CardTitle>
      <p className="text-xs text-muted-foreground mt-1">
        It is recommended to apply for leave at least <strong>two weeks in advance</strong> to support planning and coverage.
      </p>

      {(startDate && !endDate) && (
        <p className="text-xs text-amber-600 mt-2">
          Select an <strong>End Date</strong> to calculate weekdays and validate allocations.
        </p>
      )}
      {(!startDate && endDate) && (
        <p className="text-xs text-amber-600 mt-2">
          Select a <strong>Start Date</strong> to calculate weekdays and validate allocations.
        </p>
      )}
    </div>

    {/* Right-side compact pills (no inputs) */}
    <div className="flex flex-col items-end gap-1 text-xs">
      {(startDate && endDate) ? (
        <>
          <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
            {startDate} → {endDate}
          </div>
          {resumeOn && (
            <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
              Resume: {resumeOn}
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
        {(startDate && endDate)
          ? (totalWeekdays > 0
              ? `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`
              : "— invalid range —")
          : `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`}
      </span>

      {(startDate && endDate && totalWeekdays > 0 &&
        (Math.round((Number(annualAlloc) + Number(offAlloc)) * 2) / 2) !== requestedDays) && (
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
          <span className="text-muted-foreground">(you have {getAnnualBalance(user)})</span>
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
            You selected {annualAlloc} but only have {getAnnualBalance(user)} Annual. Reduce by{" "}
            {annualAlloc - getAnnualBalance(user)} or move days to Off.
          </p>
        )}
      </div>

      <div>
        <Label>
          Off Days to use{" "}
          <span className="text-muted-foreground">(you have {getOffBalance(user)})</span>
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
            You selected {offAlloc} but only have {getOffBalance(user)} Off Days. Reduce by{" "}
            {offAlloc - getOffBalance(user)} or move days to Annual.
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
          ((startDate && endDate)
            ? (
                totalWeekdays <= 0 ||
                (Math.round((Number(annualAlloc) + Number(offAlloc)) * 2) / 2) !== requestedDays
              )
            : (requestedDays <= 0)
          ) ||
          (annualAlloc > getAnnualBalance(user)) ||
          (offAlloc > getOffBalance(user))
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

    {/* 8) My recent requests list */}
<div className="mt-4 border rounded">
  <div className="px-3 py-2 text-sm font-medium bg-muted/40">My Requests</div>

  {reqLoading ? (
    <div className="p-3 text-sm text-gray-600">Loading…</div>
  ) : myRequests.length === 0 ? (
    <div className="p-3 text-sm text-gray-600">No requests yet.</div>
  ) : (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
        <tr>
          <th className="text-left p-2 border-r">Submitted</th>
          <th className="text-left p-2 border-r">Dates</th>
          <th className="text-left p-2 border-r">Days</th>
          <th className="text-left p-2 border-r">Alloc (A / O)</th>
          <th className="text-left p-2 border-r">Local/Overseas</th>
          <th className="text-left p-2 border-r">Reason</th>
          <th className="text-left p-2">Status</th>
        </tr>
      </thead>

      <tbody>
        {myRequests.map((r) => {
          // 🔐 Allocation MUST reflect what USER SUBMITTED (snapshot from form)
          const submittedAnnual =
            r?.allocations?.annual ??
            r?.annualAlloc ??
            0;

          const submittedOff =
            r?.allocations?.off ??
            r?.offAlloc ??
            0;

          const showAlloc =
            Number(submittedAnnual) > 0 || Number(submittedOff) > 0;

          const isDecided = r.status === "approved" || r.status === "denied";

          return (
            <tr key={r.id} className="border-t align-top">
              <td className="p-2 border-r">
                {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
              </td>

              <td className="p-2 border-r">
                {r.startDate || "—"} → {r.endDate || "—"}
              </td>

              <td className="p-2 border-r">
                {r.totalWeekdays ?? r.days ?? "—"}
              </td>

              <td className="p-2 border-r">
                {showAlloc
                  ? `${submittedAnnual} / ${submittedOff}`
                  : "— / —"}
              </td>

              <td className="p-2 border-r capitalize">
                {r.localOrOverseas || "—"}
              </td>

              <td className="p-2 border-r whitespace-pre-wrap">
                {r.reason || "—"}
              </td>

              <td className="p-2">
  <div className="flex items-center gap-2">
    <span className="capitalize font-medium">
      {r.status || "pending"}
    </span>

    {/* (+) toggle only if admin left a message */}
    {isDecided && r.decisionNote && (
      <button
        type="button"
        className="text-xs font-bold text-muted-foreground hover:text-foreground"
        onClick={() =>
          setExpandedRequestId((prev) =>
            prev === r.id ? null : r.id
          )
        }
        aria-label="Toggle admin message"
      >
        {expandedRequestId === r.id ? "−" : "+"}
      </button>
    )}
  </div>

  {/* Expanded admin message */}
  {expandedRequestId === r.id && r.decisionNote && (
    <div className="mt-2 text-xs text-muted-foreground border-l-2 pl-2 whitespace-pre-wrap">
      {r.decisionNote}
    </div>
  )}
</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  )}
</div>
  </CardContent>
</Card>

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
