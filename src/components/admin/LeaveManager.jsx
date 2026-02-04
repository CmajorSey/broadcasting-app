// src/components/admin/LeaveManager.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import API_BASE from "@/api";
import { nextWorkdayISO } from "@/utils/leaveDates";
import { useToast } from "@/hooks/use-toast";

// shadcn/ui
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// icons
import { Pencil, X } from "lucide-react";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toInt = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fb;
};

// ---------- Leave helpers ----------
const toISODate = (d) => {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

const isSameUser = (leaveItem, user) => {
  if (!leaveItem || !user) return false;

  const userId = typeof user === "object" ? user.id : null;
  const userName =
    typeof user === "object"
      ? user.name || user.fullName || user.username
      : String(user);

  // try several common fields safely
  const leaveUserId = leaveItem.userId || leaveItem.user?.id || null;
  const leaveName =
    leaveItem.userName ||
    leaveItem.name ||
    leaveItem.user?.name ||
    leaveItem.requestedBy ||
    null;

  if (userId && leaveUserId && String(userId) === String(leaveUserId)) return true;
  if (userName && leaveName && String(userName).trim() === String(leaveName).trim())
    return true;

  return false;
};

const isApproved = (leaveItem) => {
  const s = String(leaveItem?.status || leaveItem?.state || "").toLowerCase();
  // treat empty as approved only if your system does that — default to strict
  return s === "approved";
};

const isOnLeaveToday = (user, leaveRequests, isoToday = toISODate(new Date())) => {
  if (!Array.isArray(leaveRequests) || !isoToday) return false;

  return leaveRequests.some((lr) => {
    if (!lr) return false;
    if (!isSameUser(lr, user)) return false;
    if (!isApproved(lr)) return false;

    // 1) explicit dates array (most reliable)
    if (Array.isArray(lr.dates) && lr.dates.length) {
      return lr.dates.includes(isoToday);
    }

    // 2) start/end range (inclusive)
    const start = lr.startDate || lr.start || lr.from;
    const end = lr.endDate || lr.end || lr.to;

    const s = toISODate(start);
    const e = toISODate(end);

    if (!s && !e) return false;
    if (s && !e) return isoToday === s;
    if (!s && e) return isoToday === e;

    return isoToday >= s && isoToday <= e;
  });
};

/**
 * Returns true if a leave request overlaps "today" OR starts within N days ahead.
 * Used for "currently on leave / upcoming soon" type banners.
 */
const isOverlapOrUpcomingWithin = (
  leaveItem,
  isoToday = toISODate(new Date()),
  withinDays = 7
) => {
  if (!leaveItem || !isoToday) return false;
  if (!isApproved(leaveItem)) return false;

  // Build set/range from either dates[] or start/end
  const addDays = (iso, n) => {
    const dt = new Date(`${iso}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return null;
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };

  const endWindow = addDays(isoToday, Math.max(0, Number(withinDays) || 0));
  if (!endWindow) return false;

  // dates[] style
  if (Array.isArray(leaveItem.dates) && leaveItem.dates.length) {
    // overlap today or any date between today..endWindow
    return leaveItem.dates.some((d) => d >= isoToday && d <= endWindow);
  }

  // range style
  const start = toISODate(leaveItem.startDate || leaveItem.start || leaveItem.from);
  const end = toISODate(leaveItem.endDate || leaveItem.end || leaveItem.to);

  if (!start && !end) return false;

  // normalize
  const s = start || end; // if one missing, treat as single-day
  const e = end || start;

  // overlap today?
  const overlapsToday = isoToday >= s && isoToday <= e;

  // upcoming within window? (starts between today..endWindow)
  const startsSoon = s >= isoToday && s <= endWindow;

  return overlapsToday || startsSoon;
};

// ---------- Segment helpers ----------
const groupedBySegment = (users) => {
  const segments = {
    Operations: [],
    "Sports Section": [],
    Newsroom: [],
    Production: [],
    Admins: [],
  };

  (users || []).forEach((u) => {
    if (!u) return;
    const name = (u.name || "").trim();

    // exclude the generic Admin account entirely
    if (name.toLowerCase() === "admin") return;

    // force the 3 named users into Admins
    const adminSet = new Set([
      "Clive Camille",
      "Jennifer Arnephy",
      "Gilmer Philoe",
    ]);
    if (adminSet.has(name)) {
      segments.Admins.push(u);
      return;
    }

    const desc = String(u.description || "").toLowerCase();

    if (desc.includes("cam op") || desc.includes("camop")) {
      segments.Operations.push(u);
      return;
    }

    if (desc.includes("sports journalist") || desc.includes("sports")) {
      segments["Sports Section"].push(u);
      return;
    }

    if (desc.includes("journalist") || desc.includes("news")) {
      segments.Newsroom.push(u);
      return;
    }

    if (desc.includes("producer") || desc.includes("production")) {
      segments.Production.push(u);
      return;
    }

    // default bucket if unknown: Operations (keeps them visible instead of disappearing)
    segments.Operations.push(u);
  });

  return segments;
};

// ---------- Robust date + field helpers ----------
const toISODateString = (date) => date.toISOString().slice(0, 10);

/** Accepts Date / ISO / DD/MM/YYYY / epoch etc. Returns ISO "YYYY-MM-DD" or "" (timezone-safe) */
const iso = (v) => {
  if (v === undefined || v === null || v === "") return "";

  // ✅ If it's already an ISO date-time string, never allow UTC drift.
  // Just take the calendar date portion.
  if (typeof v === "string") {
    const s = v.trim();

    // "YYYY-MM-DDTHH:mm:ss..." OR "YYYY-MM-DD HH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);

    // plain "YYYY-MM-DD"
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const [yyyy, mm, dd] = s.split("-").map(Number);
      const d = new Date(yyyy, mm - 1, dd);
      return isNaN(d) ? "" : toISOLocal(d);
    }

    // "YYYY/MM/DD"
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      const [yyyy, mm, dd] = s.split("/").map(Number);
      const d = new Date(yyyy, mm - 1, dd);
      return isNaN(d) ? "" : toISOLocal(d);
    }

    // "DD/MM/YYYY"
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      const d = new Date(yyyy, mm - 1, dd);
      return isNaN(d) ? "" : toISOLocal(d);
    }
  }

  // Date object -> local calendar date (no UTC conversion)
  if (v instanceof Date && !isNaN(v)) return toISOLocal(v);

  // epoch seconds/ms
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
    const num = Number(v);
    const epochMs = num > 1e12 ? num : num * 1000;
    const d = new Date(epochMs);
    return isNaN(d) ? "" : toISOLocal(d);
  }

  // fallback parse
  const d = new Date(v);
  return isNaN(d) ? "" : toISOLocal(d);
};

const getPath = (obj, path) => {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
};

const deepFind = (obj, predicate, maxDepth = 4) => {
  const seen = new WeakSet();
  const stack = [{ val: obj, path: "", depth: 0 }];

  while (stack.length) {
    const { val, path, depth } = stack.pop();
    if (val && typeof val === "object") {
      if (seen.has(val)) continue;
      seen.add(val);
      if (depth > maxDepth) continue;

      for (const key of Object.keys(val)) {
        const child = val[key];
        const childPath = path ? `${path}.${key}` : key;

        if (predicate(key, child, childPath)) return { value: child, path: childPath };
        if (child && typeof child === "object") stack.push({ val: child, path: childPath, depth: depth + 1 });
      }
    }
  }
  return null;
};

const pick = (obj, aliases) => {
  for (const key of aliases) {
    const v = key.includes(".") ? getPath(obj, key) : obj?.[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const deepDate = (r, keyRegexes) => {
  const match = deepFind(r, (k, v) => keyRegexes.some((rgx) => rgx.test(k)) && !!iso(v));
  return match?.value;
};

const deepType = (r) => {
  const match = deepFind(
    r,
    (k, v) =>
      /(type|category|local|overseas)/i.test(k) &&
      (typeof v === "string" || typeof v === "number")
  );
  return match?.value;
};

const deepAlloc = (r, which) => {
  const rx =
    which === "annual"
      ? /(annual|ann(ual)?_?leave|annualDays|annual_leave_days)/i
      : /(off(?!ice)|off[-_ ]?days|off_leave)/i;
  const match = deepFind(
    r,
    (k, v) =>
      rx.test(k) &&
      (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)))
  );
  return match?.value;
};

const getReqStart = (r) =>
  pick(r, [
    "startDate",
    "start",
    "fromDate",
    "from",
    "start_date",
    "from_date",
    "startDay",
    "start_at",
    "startAt",
    "dates.start",
    "range.start",
    "range.from",
    "period.start",
    "period.from",
    "leaveStart",
    "leave_start",
    "payload.start",
    "payload.dates.start",
  ]) ?? deepDate(r, [/start/i, /from/i]);

const getReqEnd = (r) =>
  pick(r, [
    "endDate",
    "end",
    "toDate",
    "to",
    "end_date",
    "to_date",
    "endDay",
    "end_at",
    "endAt",
    "dates.end",
    "range.end",
    "range.to",
    "period.end",
    "period.to",
    "leaveEnd",
    "leave_end",
    "payload.end",
    "payload.dates.end",
  ]) ?? deepDate(r, [/end/i, /\bto\b/i]);

const getReqResumeOn = (r) =>
  pick(r, [
    "resumeOn",
    "resume",
    "resume_date",
    "returnDate",
    "return_on",
    "resumeOnDate",
    "dates.resumeOn",
    "period.resume",
    "payload.resumeOn",
  ]) ?? deepDate(r, [/resume/i, /return/i]);

const getReqCreatedAt = (r) =>
  pick(r, [
    "createdAt",
    "submittedAt",
    "created_on",
    "submitted_on",
    "created_at",
    "submitted_at",
    "meta.createdAt",
    "payload.createdAt",
  ]) ?? deepDate(r, [/created/i, /submitted/i]);

const getReqReason = (r) =>
  pick(r, ["reason", "reason_text", "note", "message", "details", "meta.reason", "payload.reason"]);

const getReqType = (r) =>
  (pick(r, ["localOrOverseas", "type", "leaveType", "category", "meta.type", "payload.type"]) ??
    deepType(r) ??
    "local");

const getReqTotalDays = (r) =>
  toInt(pick(r, ["totalDays", "days", "weekdayCount", "totalWeekdays", "duration"]) ?? 0, 0);

const getReqAnnualAlloc = (r) => {
  const explicit =
    pick(r, [
      "annualAlloc",
      "annual",
      "annual_leave",
      "annualLeave",
      "annual_leave_days",
      "annualDays",
      "annualLeaveDays",
      "allocations.annual",
      "split.annual",
      "deductions.annual",
      "requested.annual",
      "payload.allocations.annual",
      "appliedAnnual",
    ]) ?? deepAlloc(r, "annual");

  if (explicit !== undefined && explicit !== null && explicit !== "") return toInt(explicit, 0);

  const t = String(getReqType(r) || "").toLowerCase();
  const days = getReqTotalDays(r);
  if (t.includes("annual")) return days;
  return 0;
};

const getReqOffAlloc = (r) => {
  const explicit =
    pick(r, [
      "offAlloc",
      "off",
      "off_days",
      "offDays",
      "offDaysRequested",
      "off_leave_days",
      "allocations.off",
      "split.off",
      "deductions.off",
      "requested.off",
      "payload.allocations.off",
      "appliedOff",
    ]) ?? deepAlloc(r, "off");

  if (explicit !== undefined && explicit !== null && explicit !== "") return toInt(explicit, 0);

  const t = String(getReqType(r) || "").toLowerCase();
  const days = getReqTotalDays(r);
  if (t.includes("off")) return days;
  return 0;
};

const weekdaysBetween = (startV, endV) => {
  const startISO = iso(startV);
  const endISO = iso(endV);
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (isNaN(start) || isNaN(end) || end < start) return 0;

  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  while (cur <= end) {
    const dow = cur.getDay(); // 0 Sun ... 6 Sat
    if (dow >= 1 && dow <= 5) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

const addDaysISO = (isoStr, days) => {
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + days);
  return iso(d);
};

const fourteenDaysFromNowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return iso(d);
};

// UI date formatting helper: "DD/Mon/YYYY"
const shortDate = (value) => {
  const s = iso(value);
  if (!s) return "—";

  const dt = parseISOToLocal(s);
  if (!dt) return "—";

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd = String(dt.getDate()).padStart(2, "0");
  const mon = months[dt.getMonth()];
  const yyyy = dt.getFullYear();

  return `${dd}/${mon}/${yyyy}`;
};

// ---------- "Currently on leave" helpers (weekend + public holiday aware) ----------
// Requires `publicHolidays` in scope as ["YYYY-MM-DD", ...] (or derive from /holidays)
// If you store objects {date,name}, map them before: publicHolidays = holidays.map(h=>h.date)

const pad2 = (n) => String(n).padStart(2, "0");

const toISOLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Parse "YYYY-MM-DD" in LOCAL time (prevents UTC drift)
const parseISOToLocal = (iso) => {
  if (!iso || typeof iso !== "string") return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

// ✅ Determine return-to-work date universally:
// prefer stored resumeOn, else compute from endDate using holidays + weekends
const getReturnISO = (leaveReq, publicHolidays = []) => {
  const resume =
    iso(getReqResumeOn(leaveReq)) ||
    iso(leaveReq?.resumeOn) ||
    iso(leaveReq?.resumeWorkOn) ||
    "";

  if (resume) return resume;

  const endISO = iso(getReqEnd(leaveReq)) || iso(leaveReq?.endDate) || "";
  if (!endISO) return "";

  return nextWorkdayISO(endISO, publicHolidays);
};


// =====================================
// LeaveManager
// =====================================
export default function LeaveManager({ users, setUsers, currentAdmin }) {
  const { toast } = useToast();

    // ✅ Public holidays (YYYY-MM-DD) used for universal "return to work" + calculations
  const [publicHolidays, setPublicHolidays] = useState([]);
  const [holidaysLoaded, setHolidaysLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/holidays`);
        const data = await res.json();

        // backend returns [{date,name}, ...]
        const dates = Array.isArray(data)
          ? data.map((h) => h?.date).filter(Boolean)
          : [];

        setPublicHolidays(dates);
      } catch (e) {
        console.warn("Failed to load holidays:", e);
        setPublicHolidays([]);
      } finally {
        setHolidaysLoaded(true);
      }
    })();
  }, []);

  // Balances (existing)
  const [drafts, setDrafts] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const replenishedRef = useRef(new Set()); // `${id}:${year}`

  const nameToId = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      if (u?.name && u?.id) map[u.name.toLowerCase()] = String(u.id);
    });
    return map;
  }, [users]);

  const idOf = (u) => {
    if (!u) return null;
    if (u.id) return String(u.id);
    const key = (u.name || "").toLowerCase();
    return nameToId[key] || null;
  };

  useEffect(() => {
    const next = {};
    users.forEach((u) => {
      if (u.name === "Admin") return;
      next[u.id || u.name] = {
        annualLeave: toInt(u.annualLeave ?? u?.balances?.annualLeave ?? 0),
        offDays: toInt(u.offDays ?? u?.balances?.offDays ?? 0),
      };
    });
    setDrafts(next);
  }, [users]);

  const persistField = async (userObj, field, rawValue) => {
    const uid = idOf(userObj);
    if (!uid) {
      toast({
        title: "Cannot save",
        description: `User "${userObj?.name || "Unknown"}" has no ID. Reload or contact admin.`,
        variant: "destructive",
      });
      return;
    }

    const value =
      field === "annualLeave" ? clamp(toInt(rawValue, 0), 0, 42) : Math.max(0, toInt(rawValue, 0));

    const current = users.find((u) => String(u.id) === String(uid));
    if (current && toInt(current[field] ?? 0) === value) return;

    setSavingUserId(uid);
    try {
      const res = await fetch(`${API_BASE}/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`Failed to update ${field}`);
      const data = await res.json();
      const saved = data?.user ?? data;
      const merged = { ...(current || {}), ...saved };

      setUsers((prev) => prev.map((u) => (String(u.id) === String(uid) ? merged : u)));
      setDrafts((prev) => ({
        ...prev,
        [userObj.id || userObj.name]: {
          annualLeave: toInt(merged.annualLeave ?? 0),
          offDays: toInt(merged.offDays ?? 0),
        },
      }));
      toast({
        title: "Saved",
        description: `${field === "annualLeave" ? "Annual Leave" : "Off Days"} updated.`,
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err?.message || "Unable to persist change.",
        variant: "destructive",
      });
      const fallback = users.find((u) => String(u.id) === String(uid)) || userObj;
      setDrafts((prev) => ({
        ...prev,
        [userObj.id || userObj.name]: {
          annualLeave: toInt(fallback.annualLeave ?? 0),
          offDays: toInt(fallback.offDays ?? 0),
        },
      }));
    } finally {
      setSavingUserId(null);
    }
  };

  // yearly auto-replenish 21 (up to 42)
  useEffect(() => {
    const now = new Date();
    const currentYear = now.getFullYear();

    users.forEach((user) => {
      if (user.name === "Admin") return;
      const uid = idOf(user);
      if (!uid) return;

      const key = `${uid}:${currentYear}`;
      if (replenishedRef.current.has(key)) return;

      const lastUpdated = user.lastLeaveUpdate ? new Date(user.lastLeaveUpdate) : null;
      const lastYear = lastUpdated?.getFullYear?.() ?? currentYear - 1;

      if (currentYear > lastYear) {
        const nextAnnual = clamp(toInt(user.annualLeave ?? 0) + 21, 0, 42);
        replenishedRef.current.add(key);

        fetch(`${API_BASE}/users/${uid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annualLeave: nextAnnual,
            lastLeaveUpdate: now.toISOString(),
          }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("Replenish failed");
            return res.json();
          })
          .then((data) => {
            const updatedUser = data?.user ?? data;
            const merged = { ...user, ...updatedUser };
            setUsers((prev) => prev.map((u) => (String(u.id) === String(uid) ? merged : u)));
          })
          .catch((err) => {
            console.error("Error replenishing leave:", err);
          });
      }
    });
  }, [users, setUsers]);

  const segments = useMemo(() => groupedBySegment(users), [users]);

  // ---------- Leave Requests Admin ----------
  const [requests, setRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);

  // filters
  const [statusFilter, setStatusFilter] = useState("pending"); // pending | approved | denied | all
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // decision dialog state (approve/deny)
  const [activeReq, setActiveReq] = useState(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionType, setDecisionType] = useState("approve"); // approve | deny
  const [decisionNote, setDecisionNote] = useState("");
  const [adjAnnual, setAdjAnnual] = useState(0);
  const [adjOff, setAdjOff] = useState(0);
  const [overrideTwoWeekRule, setOverrideTwoWeekRule] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);

  // ✅ NEW: modify dialog state (edit/cancel approved leave)
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyMode, setModifyMode] = useState("edit"); // edit | cancel
  const [modifyReq, setModifyReq] = useState(null);
  const [modifyStart, setModifyStart] = useState("");
  const [modifyEnd, setModifyEnd] = useState("");
  const [cancelReturnDate, setCancelReturnDate] = useState(""); // return-to-work date
  const [refundAnnual, setRefundAnnual] = useState(0);
  const [refundOff, setRefundOff] = useState(0);
  const [modifyNote, setModifyNote] = useState("");
  const [savingModify, setSavingModify] = useState(false);

  const loadRequests = async () => {
    setReqLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leave-requests`);
      if (!res.ok) throw new Error("Failed to load leave requests");
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : data?.requests || []);
    } catch (e) {
      toast({
        title: "Error",
        description: e?.message || "Could not fetch leave requests.",
        variant: "destructive",
      });
    } finally {
      setReqLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userById = (id) => users.find((u) => String(u.id) === String(id));

  const segmentOfUser = (u) => {
    if (!u) return "Unassigned";
    if (u.name === "Admin") return "Admins";
    if (["Clive Camille", "Jennifer Arnephy", "Gilmer Philoe", "Nelson Joseph"].includes(u.name)) return "Admins";

    const d = String(u.description || "").toLowerCase();
    if (/cam ?op|camera ?operator|operations|driver|fleet/.test(d)) return "Operations";
    if (d.includes("sports journalist")) return "Sports Section";
    if (d.includes("journalist")) return "Newsroom";
    if (d.includes("producer")) return "Production";
    return "Unassigned";
  };

  const filteredRequests = useMemo(() => {
    return (requests || [])
      .filter((r) => (statusFilter === "all" ? true : (r.status || "pending") === statusFilter))
      .filter((r) => {
        if (segmentFilter === "all") return true;
        const u = userById(r.userId);
        return segmentOfUser(u) === segmentFilter;
      })
      .filter((r) => {
        if (!dateFrom && !dateTo) return true;
        const createdISO = iso(getReqCreatedAt(r));
        if (!createdISO) return false;
        const d = new Date(createdISO);
        if (isNaN(d)) return false;
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59, 999);
          if (d > end) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aISO = iso(getReqCreatedAt(a)) || "1970-01-01";
        const bISO = iso(getReqCreatedAt(b)) || "1970-01-01";
        return new Date(bISO) - new Date(aISO);
      });
  }, [requests, statusFilter, segmentFilter, dateFrom, dateTo, users]);

  // =====================
  // Leave banner data
  // =====================
  const { onLeaveNow, upcomingLeave } = useMemo(() => {
    const todayISO = iso(new Date());

    const buildItem = (r) => {
      const u = userById(r.userId);
      const name = r.userName || u?.name || "Unknown";

      const startISO = iso(getReqStart(r));
      const endISO = iso(getReqEnd(r));

      // ✅ Holiday/weekend-aware return date (prefer stored resumeOn if present)
      const returnISO = getReturnISO(r, publicHolidays);

      return {
        id: r.id || `${name}-${startISO}-${endISO}`,
        name,
        segment: segmentOfUser(u),
        startISO,
        endISO,
        returnISO,
      };
    };

    const overlapsToday = (r) => {
      if (!r || String(r.status || "").toLowerCase() !== "approved") return false;
      if (!todayISO) return false;

      // 1) explicit dates array
      if (Array.isArray(r.dates) && r.dates.length) {
        return r.dates.includes(todayISO);
      }

      // 2) start/end range (inclusive)
      const s = iso(getReqStart(r));
      const e = iso(getReqEnd(r));

      if (!s && !e) return false;
      if (s && !e) return todayISO === s;
      if (!s && e) return todayISO === e;

      return todayISO >= s && todayISO <= e;
    };

    const startsInFuture = (r) => {
      if (!r || String(r.status || "").toLowerCase() !== "approved") return false;
      if (!todayISO) return false;

      // dates[] style: any date strictly after today means "upcoming"
      if (Array.isArray(r.dates) && r.dates.length) {
        return r.dates.some((d) => d > todayISO);
      }

      // range style: start after today
      const s = iso(getReqStart(r)) || iso(getReqEnd(r)); // fallback single-day
      if (!s) return false;
      return s > todayISO;
    };

    const approved = (requests || []).filter(
      (r) => String(r?.status || "").toLowerCase() === "approved"
    );

    const onLeaveNowList = approved
      .filter(overlapsToday)
      .map(buildItem)
      .sort((a, b) => new Date(a.startISO || "2100-01-01") - new Date(b.startISO || "2100-01-01"));

    const upcomingList = approved
      .filter(startsInFuture)
      .map(buildItem)
      .sort((a, b) => new Date(a.startISO || "2100-01-01") - new Date(b.startISO || "2100-01-01"));

    return { onLeaveNow: onLeaveNowList, upcomingLeave: upcomingList };
  }, [requests, users, publicHolidays]);

  const openDecision = (req, type) => {
    setActiveReq(req);
    setDecisionType(type);
    setDecisionNote("");

    if (type === "approve") {
      const total = Math.max(toInt(req?.totalWeekdays ?? 0, 0), getReqTotalDays(req));
      const suggestedA = getReqAnnualAlloc(req);
      const suggestedO = getReqOffAlloc(req);
      const a = suggestedA || (suggestedO ? 0 : total);
      const o = suggestedO || 0;
      setAdjAnnual(a);
      setAdjOff(o);
      setOverrideTwoWeekRule(false);
    }
    setDecisionOpen(true);
  };

  const closeDecision = () => {
    setDecisionOpen(false);
    setActiveReq(null);
    setDecisionNote("");
    setAdjAnnual(0);
    setAdjOff(0);
    setSavingDecision(false);
  };

  const twoWeekRuleViolated = (req) => {
    const startV = getReqStart(req);
    if (!startV) return false;
    const minStart = fourteenDaysFromNowISO();
    return iso(startV) < minStart;
  };

  const applyDecision = async () => {
    if (!activeReq) return;
    const req = activeReq;
    const u = userById(req.userId);

    setSavingDecision(true);

    try {
      if (decisionType === "deny") {
        const patch = {
          status: "denied",
          decisionNote,
          approverId: currentAdmin?.id || null,
          approverName: currentAdmin?.name || "Admin",
          decidedAt: new Date().toISOString(),
        };

        const res = await fetch(`${API_BASE}/leave-requests/${req.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Failed to deny request");

        const saved = await res.json();
        setRequests((prev) =>
          prev.map((r) => (String(r.id) === String(req.id) ? { ...r, ...saved } : r))
        );

        toast({
          title: "Request denied",
          description: `Reason noted${decisionNote ? `: ${decisionNote}` : ""}.`,
        });

        closeDecision();
        return;
      }

      // ---------- Approve ----------
      const total = Math.max(toInt(req?.totalWeekdays ?? 0, 0), getReqTotalDays(req));

      if (twoWeekRuleViolated(req) && !overrideTwoWeekRule) {
        setSavingDecision(false);
        toast({
          title: "Two-week rule",
          description:
            "This request starts in less than 14 days. Toggle 'Override 2-week rule' to proceed, or deny with a note.",
          variant: "destructive",
        });
        return;
      }

      if (!u?.id) throw new Error("User has no ID — cannot approve request.");

      // ✅ DO NOT PATCH /users here — backend deducts once on approval
      const patch = {
        status: "approved",
        decisionNote,
        approverId: currentAdmin?.id || null,
        approverName: currentAdmin?.name || "Admin",
        decidedAt: new Date().toISOString(),
        appliedAnnual: toInt(adjAnnual, 0),
        appliedOff: toInt(adjOff, 0),
      };

      const res2 = await fetch(`${API_BASE}/leave-requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res2.ok) throw new Error("Failed to approve request");

      const savedReq = await res2.json();
      setRequests((prev) =>
        prev.map((r) => (String(r.id) === String(req.id) ? { ...r, ...savedReq } : r))
      );

      // refresh users so balances display correctly immediately
      try {
        const uRes = await fetch(`${API_BASE}/users`);
        if (uRes.ok) {
          const usersData = await uRes.json();
          setUsers(Array.isArray(usersData) ? usersData : usersData?.users || []);
        }
      } catch {
        // non-fatal
      }

      toast({
        title: "Request approved",
        description: `Applied Annual: ${toInt(adjAnnual, 0)}, Off days: ${toInt(adjOff, 0)}.`,
      });

      closeDecision();
    } catch (e) {
      setSavingDecision(false);
      toast({
        title: "Action failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  // =========================
  // ✅ NEW: Edit/Cancel helpers
  // =========================

  // ✅ Half-day safe numeric helper (allows 0.5, 4.5, etc.)
  const toHalf = (v, fb = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fb;
    return Math.round(n * 2) / 2;
  };

  const closeModify = () => {
    setModifyOpen(false);
    setModifyReq(null);
    setModifyMode("edit");
    setModifyStart("");
    setModifyEnd("");
    setCancelReturnDate("");
    setRefundAnnual(0);
    setRefundOff(0);
    setModifyNote("");
    setSavingModify(false);
  };

  const openModify = (req, mode) => {
    setModifyReq(req);
    setModifyMode(mode);

    const s = iso(getReqStart(req));
    const e = iso(getReqEnd(req));

    setModifyStart(s);
    setModifyEnd(e);

    // Cancel default: return-to-work is the day after original end (simple default)
    setCancelReturnDate(e ? addDaysISO(e, 1) : "");

    // Adjustment defaults: 0 until admin chooses
    setRefundAnnual(0);
    setRefundOff(0);
    setModifyNote("");

    setModifyOpen(true);
  };

  // Simple weekday-only estimate (holidays come later)
  // ✅ Supports half-day explicit fields if they exist in request payload
  const calcTotalWeekdays = (req, startISO, endISO) => {
    const maybeHalf =
      req?.requestedDays ??
      req?.daysRequested ??
      req?.totalRequestedDays ??
      null;

    const explicitHalf = toHalf(maybeHalf, 0);
    if (explicitHalf > 0) return explicitHalf;

    const explicit = Math.max(toInt(req?.totalWeekdays ?? 0, 0), getReqTotalDays(req));
    if (explicit > 0) return toHalf(explicit, 0);

    return toHalf(weekdaysBetween(startISO, endISO), 0);
  };

  // ✅ Cancel logic fix:
  // Used must be 0 if leave is upcoming (has not started yet).
  // Used = weekdays from start -> min(today, lastLeaveDay)
  const calcCancelUsedUnused = (req, startISO, endISO, returnISO) => {
    const total = calcTotalWeekdays(req, startISO, endISO);

    if (!startISO || !endISO || !returnISO) return { total, used: 0, unused: total };

    const returnDate = new Date(returnISO);
    if (isNaN(returnDate)) return { total, used: 0, unused: total };

    // last leave day is day before return
    const lastLeaveDay = new Date(returnISO);
    lastLeaveDay.setDate(lastLeaveDay.getDate() - 1);
    const lastISO = iso(lastLeaveDay);

    const todayISO = iso(new Date());

    // ✅ If leave hasn't started yet, nothing is used
    if (todayISO < startISO) {
      return { total, used: 0, unused: total };
    }

    // If returning on/before start, used is 0
    if (returnISO <= startISO) return { total, used: 0, unused: total };

    // If returning after end+1, treat "unused" as 0 (they didn't shorten anything)
    if (returnISO > addDaysISO(endISO, 1)) {
      const usedLast = todayISO > endISO ? endISO : todayISO;
      const used = usedLast >= startISO ? toHalf(weekdaysBetween(startISO, usedLast), 0) : 0;
      const unused = Math.max(0, toHalf(total - used, 0));
      return { total, used, unused };
    }

    // Normal cancel within range:
    const effectiveLast = todayISO < lastISO ? todayISO : lastISO;
    const used = effectiveLast >= startISO ? toHalf(weekdaysBetween(startISO, effectiveLast), 0) : 0;
    const unused = Math.max(0, toHalf(total - used, 0));
    return { total, used, unused };
  };

  const submitModify = async () => {
    if (!modifyReq) return;

    const req = modifyReq;
    const mode = modifyMode;

    const startISO = iso(modifyStart);
    const endISO = iso(modifyEnd);
    const returnISO = iso(cancelReturnDate);

    // ✅ Half-safe applied values
    const appliedA = toHalf(req.appliedAnnual ?? getReqAnnualAlloc(req) ?? 0, 0);
    const appliedO = toHalf(req.appliedOff ?? getReqOffAlloc(req) ?? 0, 0);

    const originalStart = iso(getReqStart(req));
    const originalEnd = iso(getReqEnd(req));

    const originalTotal = calcTotalWeekdays(req, originalStart, originalEnd);
    const newTotal = mode === "edit" ? calcTotalWeekdays(req, startISO, endISO) : originalTotal;

    const delta = toHalf(newTotal - originalTotal, 0);

    const cancelStats =
      mode === "cancel"
        ? calcCancelUsedUnused(req, originalStart, originalEnd, returnISO)
        : { total: 0, used: 0, unused: 0 };

    // =========================
    // ✅ VALIDATION
    // =========================
    if (mode === "edit") {
      if (!startISO || !endISO) {
        toast({
          title: "Missing dates",
          description: "Please choose a start and end date.",
          variant: "destructive",
        });
        return;
      }
      if (endISO < startISO) {
        toast({
          title: "Invalid dates",
          description: "End date must be after start date.",
          variant: "destructive",
        });
        return;
      }

      const adjA = Math.max(0, toHalf(refundAnnual, 0));
      const adjO = Math.max(0, toHalf(refundOff, 0));
      const adjSum = toHalf(adjA + adjO, 0);

      if (delta < 0) {
        const refundDays = Math.abs(delta);
        if (adjSum !== refundDays) {
          toast({
            title: "Refund must match shortened days",
            description: `Annual + Off must equal ${refundDays} day(s).`,
            variant: "destructive",
          });
          return;
        }
        if (adjA > appliedA || adjO > appliedO) {
          toast({
            title: "Refund too large",
            description: "Refund cannot exceed what was originally deducted from that bucket. Adjust split.",
            variant: "destructive",
          });
          return;
        }
      } else if (delta > 0) {
        const extraDays = delta;
        if (adjSum !== extraDays) {
          toast({
            title: "Extra days must be allocated",
            description: `Annual + Off must equal ${extraDays} day(s).`,
            variant: "destructive",
          });
          return;
        }
      } else {
        if (adjSum !== 0) {
          toast({
            title: "No balance change needed",
            description: "This edit keeps the same total days. Set adjustments to 0 / 0.",
            variant: "destructive",
          });
          return;
        }
      }

      // ✅ Compute the NEW applied totals
      let nextA = appliedA;
      let nextO = appliedO;

      if (delta < 0) {
        nextA = toHalf(appliedA - adjA, 0);
        nextO = toHalf(appliedO - adjO, 0);
      } else if (delta > 0) {
        nextA = toHalf(appliedA + adjA, 0);
        nextO = toHalf(appliedO + adjO, 0);
      }

      if (toHalf(nextA + nextO, 0) !== newTotal) {
        toast({
          title: "Split mismatch",
          description: `Applied Annual + Off must equal ${newTotal}.`,
          variant: "destructive",
        });
        return;
      }
    } else {
      // CANCEL
      if (!returnISO) {
        toast({
          title: "Missing return date",
          description: "Please choose the date the person returns to work.",
          variant: "destructive",
        });
        return;
      }

      const rA = Math.max(0, toHalf(refundAnnual, 0));
      const rO = Math.max(0, toHalf(refundOff, 0));
      const sum = toHalf(rA + rO, 0);

      if (sum !== toHalf(cancelStats.unused, 0)) {
        toast({
          title: "Refund must match unused",
          description: `Annual + Off must equal ${toHalf(cancelStats.unused, 0)} unused day(s).`,
          variant: "destructive",
        });
        return;
      }
    }

    setSavingModify(true);

    try {
      const payload = (() => {
        if (mode === "edit") {
          const adjA = Math.max(0, toHalf(refundAnnual, 0));
          const adjO = Math.max(0, toHalf(refundOff, 0));

          let nextA = appliedA;
          let nextO = appliedO;

          if (delta < 0) {
            nextA = toHalf(appliedA - adjA, 0);
            nextO = toHalf(appliedO - adjO, 0);
          } else if (delta > 0) {
            nextA = toHalf(appliedA + adjA, 0);
            nextO = toHalf(appliedO + adjO, 0);
          }

          return {
            action: "modify",
            mode: "edit",
            newStartDate: startISO,
            newEndDate: endISO,
            newTotalDays: newTotal,
            // ✅ backend-compatible: send NEW applied totals
            newAppliedAnnual: Math.max(0, nextA),
            newAppliedOff: Math.max(0, nextO),
            editedById: currentAdmin?.id || null,
            editedByName: currentAdmin?.name || "Admin",
            editNote: modifyNote || "",
            // optional meta (backend can ignore)
            deltaDays: delta,
            adjustmentAnnual: adjA,
            adjustmentOff: adjO,
          };
        }

        // cancel payload
        return {
          action: "modify",
          mode: "cancel",
          cancelReturnDate: returnISO,
          refundAnnual: Math.max(0, toHalf(refundAnnual, 0)),
          refundOff: Math.max(0, toHalf(refundOff, 0)),
          editedById: currentAdmin?.id || null,
          editedByName: currentAdmin?.name || "Admin",
          editNote: modifyNote || "",
          // optional meta for server logs
          cancelUsedDays: toHalf(cancelStats.used, 0),
          cancelUnusedDays: toHalf(cancelStats.unused, 0),
        };
      })();

      const res = await fetch(`${API_BASE}/leave-requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (res.status === 404 || res.status === 400) {
          throw new Error("Feature not enabled yet on the server (next step).");
        }
        throw new Error(txt || "Failed to update leave request");
      }

      const savedReq = await res.json();

      setRequests((prev) =>
        prev.map((r) => (String(r.id) === String(req.id) ? { ...r, ...savedReq } : r))
      );

      // refresh users so balances match server truth
      try {
        const uRes = await fetch(`${API_BASE}/users`);
        if (uRes.ok) {
          const usersData = await uRes.json();
          setUsers(Array.isArray(usersData) ? usersData : usersData?.users || []);
        }
      } catch {
        // non-fatal
      }

      toast({
        title: mode === "edit" ? "Leave updated" : "Leave cancelled",
        description:
          mode === "edit"
            ? "Dates updated and balances adjusted."
            : "Refund applied and balances adjusted.",
      });

      closeModify();
    } catch (e) {
      setSavingModify(false);
      toast({
        title: "Could not update",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  // Render utils
  const renderReqRow = (r) => {
    const u = userById(r.userId);
    const seg = segmentOfUser(u);

    const startISO = iso(getReqStart(r));
    const endISO = iso(getReqEnd(r));
    const resumeISO = getReturnISO(r, publicHolidays);
    const createdISO = iso(getReqCreatedAt(r));

    const total = toHalf(Math.max(toInt(r?.totalWeekdays ?? 0, 0), getReqTotalDays(r)), 0);

    const a = toHalf(getReqAnnualAlloc(r), 0);
    const o = toHalf(getReqOffAlloc(r), 0);
    const sumOK = total === 0 || toHalf(a + o, 0) === total;

    const typeLabel = String(getReqType(r) || "local").toUpperCase();
    const reasonText = (getReqReason(r) || "—").trim() || "—";

    const status = (r.status || "pending").toLowerCase();

    return (
      <tr key={r.id} className="border-t align-top group hover:bg-gray-50">
        <td className="p-2 border-r">
          <div className="font-medium">{r.userName || u?.name || "Unknown"}</div>
          <div className="text-xs text-gray-500">{seg}</div>
          <div className="text-[11px] text-gray-500 mt-1">Requested: {createdISO || "—"}</div>
        </td>

        <td className="p-2 border-r">
          <div className="text-sm">
            <div>
              <span className="font-medium">Dates:</span> {startISO || "—"} → {endISO || "—"}
              {total > 0 && (
                <span className="ml-2 text-xs text-gray-600">
                  ({total} day{total === 1 ? "" : "s"})
                </span>
              )}
            </div>
            <div className="mt-1">
              <span className="font-medium">Resume On:</span> {resumeISO || "—"}
            </div>
            <div className="mt-1">
              <span className="font-medium">Type:</span> {typeLabel}
            </div>
            <div className="mt-1">
              <span className="font-medium">Reason:</span>{" "}
              <span className="whitespace-pre-wrap break-words">{reasonText}</span>
            </div>
          </div>
        </td>

        <td className="p-2 border-r">
          <div className="text-sm">
            <div>
              Annual alloc: <span className="font-semibold">{a}</span>
            </div>
            <div>
              Off-day alloc: <span className="font-semibold">{o}</span>
            </div>
            {!sumOK && total > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                ⚠️ Allocation ({toHalf(a + o, 0)}) differs from requested days ({total})
              </div>
            )}
          </div>
        </td>

        <td className="p-2 border-r">
          <div className="text-sm">
            <div>
              Current Annual: <span className="font-semibold">{toInt(u?.annualLeave ?? 0)}</span>
            </div>
            <div>
              Current Off days: <span className="font-semibold">{toInt(u?.offDays ?? 0)}</span>
            </div>
          </div>
        </td>

        <td className="p-2">
          <div className="flex flex-col gap-2 group">
            {status === "pending" ? (
              <>
                <Button size="sm" onClick={() => openDecision(r, "approve")} className="w-full">
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => openDecision(r, "deny")} className="w-full">
                  Deny
                </Button>
              </>
            ) : (
              <div className="text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium capitalize">Status: {r.status}</div>
                    <div>By: {r.approverName || "—"}</div>
                    <div>On: {iso(r.decidedAt) || "—"}</div>
                    {r.decisionNote && (
                      <div className="mt-1 italic text-gray-600">“{r.decisionNote}”</div>
                    )}
                    {status === "approved" && (
                      <div className="mt-1 text-[11px] text-gray-600">
                        Applied — Annual: {toHalf(r.appliedAnnual ?? 0)}, Off: {toHalf(r.appliedOff ?? 0)}
                      </div>
                    )}
                    {(r.lastEditedAt || r.lastEditedByName) && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        Edited by {r.lastEditedByName || "—"} at {iso(r.lastEditedAt) || "—"}
                      </div>
                    )}
                  </div>

                  {/* ✅ hover actions (approved only) */}
                  {status === "approved" && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-gray-100"
                        title="Edit"
                        onClick={() => openModify(r, "edit")}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-50 text-red-600"
                        title="Cancel"
                        onClick={() => openModify(r, "cancel")}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // =====================================
  // UI
  // =====================================
  return (
    <div className="space-y-10">
      {/* ===================== Leave Requests Admin ===================== */}
      <section>
        <h2 className="text-2xl font-bold mb-3">Leave Requests</h2>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="all">All</option>
            </select>
          </div>

          <div>
            <Label className="text-xs">Segment</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="Operations">Operations</option>
              <option value="Sports Section">Sports Section</option>
              <option value="Newsroom">Newsroom</option>
              <option value="Production">Production</option>
              <option value="Admins">Admins</option>
            </select>
          </div>

          <div>
            <Label className="text-xs">From (created)</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full" />
          </div>

          <div>
            <Label className="text-xs">To (created)</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full" />
          </div>

          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setStatusFilter("pending");
                setSegmentFilter("all");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Reset
            </Button>
            <Button onClick={loadRequests} disabled={reqLoading}>
              {reqLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2 border-r w-[220px]">User</th>
                <th className="text-left p-2 border-r">Request</th>
                <th className="text-left p-2 border-r w-[180px]">Allocations</th>
                <th className="text-left p-2 border-r w-[160px]">Current Balances</th>
                <th className="text-left p-2 w-[160px]">Actions / Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.length === 0 ? (
                <tr>
                  <td className="p-4 text-center text-gray-500" colSpan={5}>
                    {reqLoading ? "Loading requests..." : "No requests match your filters."}
                  </td>
                </tr>
              ) : (
                filteredRequests.map((r) => renderReqRow(r))
              )}
            </tbody>
          </table>
        </div>
      </section>

           {/* ===================== On Leave + Upcoming (Conditional) ===================== */}
      {(onLeaveNow.length > 0 || upcomingLeave.length > 0) && (
        <section>
          <h2 className="text-2xl font-bold mb-3">On Leave & Upcoming</h2>

          <div className="border rounded overflow-hidden">
            <div className="bg-gray-100 px-3 py-2 text-sm text-gray-700">
            
            </div>

            <div className="p-3 space-y-5">
              {/* On Leave Now */}
              {onLeaveNow.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-2">Currently on leave</div>
                  <div className="space-y-2">
                    {onLeaveNow.map((x) => (
                      <div
                        key={x.id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{x.name}</span>
                            <span className="text-xs text-gray-500">{x.segment}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">
                              On Leave
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {shortDate(x.startISO)} → {shortDate(x.endISO)}{" "}
                            <span className="ml-2 text-gray-600">
                              (Returns: <span className="font-medium">{shortDate(x.returnISO)}</span>)
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upcoming Leave */}
              {upcomingLeave.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-2">Upcoming leave</div>
                  <div className="space-y-2">
                    {upcomingLeave.map((x) => (
                      <div
                        key={x.id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{x.name}</span>
                            <span className="text-xs text-gray-500">{x.segment}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                              Upcoming
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {shortDate(x.startISO)} → {shortDate(x.endISO)}{" "}
                            <span className="ml-2 text-gray-600">
                              (Returns: <span className="font-medium">{shortDate(x.returnISO)}</span>)
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===================== Balances (Existing) ===================== */}
      <section>
        <h2 className="text-2xl font-bold mb-3">Balances</h2>
        {Object.entries(segments).map(([segment, segmentUsers]) => (
          <div key={segment} className="mb-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">{segment}</h3>
            {segmentUsers.length === 0 ? (
              <p className="text-sm text-gray-500">No users in this segment</p>
            ) : (
              <table className="w-full text-sm border rounded overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2 border-r">Name</th>
                    <th className="text-left p-2 border-r">Description</th>
                    <th className="text-left p-2 border-r">Annual Leave</th>
                    <th className="text-left p-2">Off Days</th>
                  </tr>
                </thead>
                <tbody>
                  {segmentUsers.map((user, idx) => {
                    const rowKey = user.id || `${user.name}-${idx}`;
                    const draftKey = user.id || user.name;
                    const draft = drafts[draftKey] || { annualLeave: 0, offDays: 0 };
                    const uid = idOf(user);
                    const disabled = !uid;
                    const isSaving = savingUserId === uid;

                    return (
                      <tr key={rowKey} className="border-t">
                        <td className="p-2 border-r">{user.name}</td>
                        <td className="p-2 border-r">{user.description}</td>
                        <td className="p-2 border-r">
                          <input
                            type="number"
                            min={0}
                            max={42}
                            value={draft.annualLeave}
                            onChange={(e) => {
                              const val = clamp(toInt(e.target.value, 0), 0, 42);
                              setDrafts((prev) => ({
                                ...prev,
                                [draftKey]: { ...prev[draftKey], annualLeave: val },
                              }));
                            }}
                            onBlur={() => !disabled && persistField(user, "annualLeave", drafts[draftKey]?.annualLeave)}
                            className="w-24 border px-2 py-1 rounded"
                            disabled={disabled}
                            title={disabled ? "Cannot edit — user is missing an ID" : undefined}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            value={draft.offDays}
                            onChange={(e) => {
                              const val = Math.max(0, toInt(e.target.value, 0));
                              setDrafts((prev) => ({
                                ...prev,
                                [draftKey]: { ...prev[draftKey], offDays: val },
                              }));
                            }}
                            onBlur={() => !disabled && persistField(user, "offDays", drafts[draftKey]?.offDays)}
                            className="w-24 border px-2 py-1 rounded"
                            disabled={disabled}
                            title={disabled ? "Cannot edit — user is missing an ID" : undefined}
                          />
                          {isSaving && <span className="ml-2 text-xs text-gray-500">Saving…</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      {/* ===================== Decision Dialog (Approve/Deny) ===================== */}
      <AlertDialog open={decisionOpen} onOpenChange={(o) => (o ? null : closeDecision())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="capitalize">
              {decisionType === "approve" ? "Approve leave request" : "Deny leave request"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {activeReq && (
                  <>
                    <div className="text-sm">
                      <div>
                        <span className="font-medium">User:</span> {activeReq.userName}
                      </div>
                      <div>
                        <span className="font-medium">Dates:</span> {iso(getReqStart(activeReq))} →{" "}
                        {iso(getReqEnd(activeReq))}{" "}
                        {(() => {
                          const total = Math.max(toInt(activeReq?.totalWeekdays ?? 0, 0), getReqTotalDays(activeReq));
                          return total > 0 ? (
                            <span className="ml-2 text-xs text-gray-600">
                              ({total} day{total === 1 ? "" : "s"})
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div>
                        <span className="font-medium">Resume On:</span> {iso(getReqResumeOn(activeReq)) || "—"}
                      </div>
                      <div>
                        <span className="font-medium">Type:</span>{" "}
                        {String(getReqType(activeReq) || "local").toUpperCase()}
                      </div>
                      {twoWeekRuleViolated(activeReq) && decisionType === "approve" && (
                        <div className="mt-2 text-xs text-amber-600">
                          ⚠️ Starts within 14 days (2-week rule). Tick override below to proceed.
                        </div>
                      )}
                    </div>

                    {decisionType === "approve" ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Annual to deduct</Label>
                            <Input
                              type="number"
                              value={adjAnnual}
                              onChange={(e) => setAdjAnnual(Math.max(0, toInt(e.target.value, 0)))}
                            />
                          </div>
                          <div>
                            <Label>Off days to deduct</Label>
                            <Input
                              type="number"
                              value={adjOff}
                              onChange={(e) => setAdjOff(Math.max(0, toInt(e.target.value, 0)))}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="override2w"
                            type="checkbox"
                            checked={overrideTwoWeekRule}
                            onChange={(e) => setOverrideTwoWeekRule(e.target.checked)}
                          />
                          <Label htmlFor="override2w">Override 2-week rule for this request</Label>
                        </div>
                        <div>
                          <Label>Note (optional, visible to user)</Label>
                          <Textarea
                            value={decisionNote}
                            onChange={(e) => setDecisionNote(e.target.value)}
                            placeholder="E.g., Approved — enjoy your leave."
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <Label>Reason for denial (shown to user)</Label>
                        <Textarea
                          value={decisionNote}
                          onChange={(e) => setDecisionNote(e.target.value)}
                          placeholder="Please provide a short reason."
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingDecision} onClick={closeDecision}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={applyDecision} disabled={savingDecision}>
              {savingDecision
                ? decisionType === "approve"
                  ? "Approving..."
                  : "Denying..."
                : decisionType === "approve"
                ? "Approve"
                : "Deny"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===================== ✅ Modify Dialog (Edit/Cancel Approved) ===================== */}
      <AlertDialog open={modifyOpen} onOpenChange={(o) => (o ? null : closeModify())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {modifyMode === "edit" ? "Edit approved leave" : "Cancel approved leave"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {modifyReq && (
                  <>
                    {(() => {
                      const oStart = iso(getReqStart(modifyReq));
                      const oEnd = iso(getReqEnd(modifyReq));
                      const originalTotal = calcTotalWeekdays(modifyReq, oStart, oEnd);
                      const newTotalPreview =
                        modifyMode === "edit"
                          ? calcTotalWeekdays(modifyReq, iso(modifyStart), iso(modifyEnd))
                          : originalTotal;
                      const deltaPreview = toHalf(newTotalPreview - originalTotal, 0);

                      return (
                        <div className="rounded border p-2">
                          <div>
                            <span className="font-medium">User:</span>{" "}
                            {modifyReq.userName || userById(modifyReq.userId)?.name || "Unknown"}
                          </div>
                          <div>
                            <span className="font-medium">Original dates:</span> {oStart} → {oEnd}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            Applied: Annual {toHalf(modifyReq.appliedAnnual ?? 0)} / Off {toHalf(modifyReq.appliedOff ?? 0)}
                          </div>
                          {modifyMode === "edit" && (
                            <div className="text-xs text-gray-700 mt-2">
                              Original: <b>{originalTotal}</b> • New: <b>{newTotalPreview}</b> •{" "}
                              {deltaPreview < 0 ? (
                                <span>Shorten by <b>{Math.abs(deltaPreview)}</b></span>
                              ) : deltaPreview > 0 ? (
                                <span>Extend by <b>{deltaPreview}</b></span>
                              ) : (
                                <span>No change</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {modifyMode === "edit" ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>New start date</Label>
                            <Input
                              type="date"
                              value={modifyStart}
                              onChange={(e) => setModifyStart(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label>New end date</Label>
                            <Input
                              type="date"
                              value={modifyEnd}
                              onChange={(e) => setModifyEnd(e.target.value)}
                            />
                          </div>
                        </div>

                        {(() => {
                          const oStart = iso(getReqStart(modifyReq));
                          const oEnd = iso(getReqEnd(modifyReq));
                          const originalTotal = calcTotalWeekdays(modifyReq, oStart, oEnd);
                          const newTotalPreview = calcTotalWeekdays(modifyReq, iso(modifyStart), iso(modifyEnd));
                          const deltaPreview = toHalf(newTotalPreview - originalTotal, 0);

                          const labelA =
                            deltaPreview < 0 ? "Refund to Annual" : deltaPreview > 0 ? "Extra from Annual" : "Adjustment (Annual)";
                          const labelO =
                            deltaPreview < 0 ? "Refund to Off Days" : deltaPreview > 0 ? "Extra from Off Days" : "Adjustment (Off)";

                          const helper =
                            deltaPreview < 0
                              ? `Annual + Off must equal ${Math.abs(deltaPreview)}`
                              : deltaPreview > 0
                              ? `Annual + Off must equal ${deltaPreview}`
                              : "Set both to 0";

                          return (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label>{labelA}</Label>
                                  <Input
                                    type="number"
                                    step={0.5}
                                    value={refundAnnual}
                                    onChange={(e) => setRefundAnnual(toHalf(e.target.value, 0))}
                                  />
                                </div>
                                <div>
                                  <Label>{labelO}</Label>
                                  <Input
                                    type="number"
                                    step={0.5}
                                    value={refundOff}
                                    onChange={(e) => setRefundOff(toHalf(e.target.value, 0))}
                                  />
                                </div>
                              </div>
                              <div className="text-xs text-gray-600">{helper}</div>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <div>
                          <Label>Return to work date</Label>
                          <Input
                            type="date"
                            value={cancelReturnDate}
                            onChange={(e) => setCancelReturnDate(e.target.value)}
                          />
                          <div className="text-xs text-gray-600 mt-1">
                            This means the last leave day is the day before.
                          </div>
                        </div>

                        {(() => {
                          const s = iso(getReqStart(modifyReq));
                          const e = iso(getReqEnd(modifyReq));
                          const r = iso(cancelReturnDate);
                          const { total, used, unused } = calcCancelUsedUnused(modifyReq, s, e, r);
                          return (
                            <div className="text-xs text-gray-700">
                              Total: <b>{total}</b> • Used: <b>{used}</b> • Unused (to refund): <b>{unused}</b>
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Refund to Annual</Label>
                            <Input
                              type="number"
                              step={0.5}
                              value={refundAnnual}
                              onChange={(e) => setRefundAnnual(toHalf(e.target.value, 0))}
                            />
                          </div>
                          <div>
                            <Label>Refund to Off Days</Label>
                            <Input
                              type="number"
                              step={0.5}
                              value={refundOff}
                              onChange={(e) => setRefundOff(toHalf(e.target.value, 0))}
                            />
                          </div>
                        </div>

                        <div className="text-xs text-gray-600">
                          Refund Annual + Refund Off must equal “Unused”.
                        </div>
                      </>
                    )}

                    <div>
                      <Label>Note (optional)</Label>
                      <Textarea
                        value={modifyNote}
                        onChange={(e) => setModifyNote(e.target.value)}
                        placeholder="E.g., Leave changed due to emergency / flight reschedule."
                      />
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingModify} onClick={closeModify}>
              Close
            </AlertDialogCancel>
            <AlertDialogAction disabled={savingModify} onClick={submitModify}>
              {savingModify ? "Saving..." : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
