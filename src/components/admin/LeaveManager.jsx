// src/components/admin/LeaveManager.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import API_BASE from "@/api";
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

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toInt = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fb;
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

  users.forEach((user) => {
    if (user.name === "Admin") return;

    const desc = String(user.description || "").toLowerCase();

    // ✅ Admin segment is name-based (HR + producers) + Nelson (Fleet lead)
    const nameMatch = ["Clive Camille", "Jennifer Arnephy", "Gilmer Philoe", "Nelson Joseph"].includes(
      user.name
    );

    if (nameMatch) {
      segments.Admins.push(user);
    } else if (/cam ?op|camera ?operator|operations|driver|fleet/i.test(desc)) {
      // Drivers + Fleet roles belong under Operations (unless explicitly in Admins above)
      segments.Operations.push(user);
    } else if (desc.includes("sports journalist")) {
      segments["Sports Section"].push(user);
    } else if (desc.includes("journalist")) {
      segments.Newsroom.push(user);
    } else if (desc.includes("producer")) {
      segments.Production.push(user);
    }
  });

  return segments;
};

// ---------- Robust date + field helpers ----------
const toISODateString = (date) => date.toISOString().slice(0, 10);

/** Accepts:
 * - JS Date
 * - ISO "YYYY-MM-DD" or "YYYY-M-D"
 * - "YYYY/MM/DD"
 * - "DD/MM/YYYY" or "D/M/YYYY"
 * - epoch seconds/millis (number or numeric string)
 * Returns ISO "YYYY-MM-DD" or "" if invalid.
 */
const iso = (v) => {
  if (!v && v !== 0) return "";

  if (v instanceof Date && !isNaN(v)) return toISODateString(v);

  // ISO YYYY-MM-DD / YYYY-M-D
  if (typeof v === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [yyyy, mm, dd] = v.split("-").map(Number);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d) ? "" : toISODateString(d);
  }

  // YYYY/MM/DD
  if (typeof v === "string" && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) {
    const [yyyy, mm, dd] = v.split("/").map(Number);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d) ? "" : toISODateString(d);
  }

  // DD/MM/YYYY
  if (typeof v === "string") {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      const d = new Date(yyyy, mm - 1, dd);
      return isNaN(d) ? "" : toISODateString(d);
    }
  }

  // Epoch seconds or millis (string or number)
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
    const num = Number(v);
    const epochMs = num > 1e12 ? num : num * 1000; // heuristic
    const d = new Date(epochMs);
    return isNaN(d) ? "" : toISODateString(d);
  }

  // Fallback
  const d = new Date(v);
  return isNaN(d) ? "" : toISODateString(d);
};

/** Safe nested getter for "a.b.c" */
const getPath = (obj, path) => {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
};

/** Deep scan utility with loop protection */
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
        if (child && typeof child === "object") {
          stack.push({ val: child, path: childPath, depth: depth + 1 });
        }
      }
    }
  }
  return null;
};

/** pick first non-empty value among many aliases (supports dot paths) */
const pick = (obj, aliases) => {
  for (const key of aliases) {
    const v = key.includes(".") ? getPath(obj, key) : obj?.[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

// Fallbacks: deep scan
const deepDate = (r, keyRegexes) => {
  const match = deepFind(
    r,
    (k, v) => keyRegexes.some((rgx) => rgx.test(k)) && !!iso(v)
  );
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
      (typeof v === "number" ||
        (typeof v === "string" && /^\d+$/.test(v)))
  );
  return match?.value;
};

// Convenience getters: aliases + deep scan fallbacks
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

// NEW: total days helper (your API uses `days`)
const getReqTotalDays = (r) =>
  toInt(
    pick(r, ["totalDays", "days", "weekdayCount", "totalWeekdays", "duration"]) ?? 0,
    0
  );

// Allocation inference using `type` + `days` when explicit split absent
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
    ]) ?? deepAlloc(r, "annual");

  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return toInt(explicit, 0);
  }

  // Infer: type === "annual" => all days go to annual
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
    ]) ?? deepAlloc(r, "off");

  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return toInt(explicit, 0);
  }

  // Infer: type includes "off" => all days go to off
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

const fourteenDaysFromNowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return iso(d);
};

// ---------- "Currently on leave" helpers ----------
const isOverlapOrUpcomingWithin = (startISO, endISO, daysAhead = 14) => {
  if (!startISO || !endISO) return false;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const windowEnd = new Date(startOfToday);
  windowEnd.setDate(windowEnd.getDate() + daysAhead);

  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return false;

  // normalize to date-only
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const end = new Date(e.getFullYear(), e.getMonth(), e.getDate());

  const currently = start <= startOfToday && end >= startOfToday;
  const upcoming = start >= startOfToday && start <= windowEnd;

  return currently || upcoming;
};

const shortDate = (isoStr) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

const isOnLeaveToday = (startISO, endISO) => {
  if (!startISO || !endISO) return false;
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return false;

  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
  const end = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();

  return start <= t && end >= t;
};

// =====================================
// LeaveManager
// =====================================
export default function LeaveManager({ users, setUsers, currentAdmin }) {
  const { toast } = useToast();

  // Balances (existing)
  const [drafts, setDrafts] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const replenishedRef = useRef(new Set()); // `${id}:${year}`

  const nameToId = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      if (u?.name && u?.id) {
        map[u.name.toLowerCase()] = String(u.id);
      }
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
      field === "annualLeave"
        ? clamp(toInt(rawValue, 0), 0, 42)
        : Math.max(0, toInt(rawValue, 0));

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
      toast({ title: "Saved", description: `${field === "annualLeave" ? "Annual Leave" : "Off Days"} updated.` });
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

  // dialog state
  const [activeReq, setActiveReq] = useState(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionType, setDecisionType] = useState("approve"); // approve | deny
  const [decisionNote, setDecisionNote] = useState("");
  // allocation adjust (approve)
  const [adjAnnual, setAdjAnnual] = useState(0);
  const [adjOff, setAdjOff] = useState(0);
  const [overrideTwoWeekRule, setOverrideTwoWeekRule] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);

  // fetch requests
  const loadRequests = async () => {
    setReqLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leave-requests`);
      if (!res.ok) throw new Error("Failed to load leave requests");
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : data?.requests || []);
    } catch (e) {
      toast({ title: "Error", description: e?.message || "Could not fetch leave requests.", variant: "destructive" });
    } finally {
      setReqLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const userById = (id) => users.find((u) => String(u.id) === String(id));
  const segmentOfUser = (u) => {
  if (!u) return "Unassigned";
  if (u.name === "Admin") return "Admins";

  // ✅ Admin segment is name-based (HR + producers) + Nelson (Fleet lead)
  if (["Clive Camille", "Jennifer Arnephy", "Gilmer Philoe", "Nelson Joseph"].includes(u.name)) {
    return "Admins";
  }

  const d = String(u.description || "").toLowerCase();

  // Drivers count as Operations (unless explicitly mapped to Admins above)
  if (/cam ?op|camera ?operator|operations|driver|fleet/.test(d)) return "Operations";

  if (d.includes("sports journalist")) return "Sports Section";
  if (d.includes("journalist")) return "Newsroom";
  if (d.includes("producer")) return "Production";
  return "Unassigned";
};

  const filteredRequests = useMemo(() => {
  return (requests || [])
    .filter((r) =>
      statusFilter === "all" ? true : (r.status || "pending") === statusFilter
    )
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

// ✅ Card data: approved leaves that are active now OR start within next 14 days
const currentlyOnLeave = useMemo(() => {
  return (requests || [])
    .filter((r) => String(r.status || "").toLowerCase() === "approved")
    .map((r) => {
      const u = userById(r.userId);
      const name = r.userName || u?.name || "Unknown";

      const startISO = iso(getReqStart(r));
      const endISO = iso(getReqEnd(r));

      return {
        id: r.id || `${name}-${startISO}-${endISO}`,
        name,
        segment: segmentOfUser(u),
        startISO,
        endISO,
        isNow: isOnLeaveToday(startISO, endISO),
      };
    })
    .filter((x) => isOverlapOrUpcomingWithin(x.startISO, x.endISO, 14))
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
}, [requests, users]);

  const openDecision = (req, type) => {
    setActiveReq(req);
    setDecisionType(type);
    setDecisionNote("");

    if (type === "approve") {
      const total = Math.max(
        toInt(req?.totalWeekdays ?? 0, 0),
        getReqTotalDays(req)
      );
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

      // Prefer server as source of truth (it may normalize fields)
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
    // Use total requested days (if dates missing)
    const total = Math.max(toInt(req?.totalWeekdays ?? 0, 0), getReqTotalDays(req));
    const sum = toInt(adjAnnual, 0) + toInt(adjOff, 0);
    if (total > 0 && sum !== total) {
      // allowed; admins can split differently — UI may warn elsewhere
    }

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

    // ✅ IMPORTANT:
    // Do NOT PATCH /users balances here.
    // The backend leave approval route already deducts balances (approveAndDeduct).
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

    // ✅ Refresh users from backend so UI matches server-truth balances after deduction
    // (This avoids showing stale balances until next page refresh)
    try {
      const uRes = await fetch(`${API_BASE}/users`);
      if (uRes.ok) {
        const usersData = await uRes.json();
        setUsers(Array.isArray(usersData) ? usersData : usersData?.users || []);
      }
    } catch {
      // Non-fatal; balances will still be correct on next reload
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

  // Render utils
  const renderReqRow = (r) => {
    const u = userById(r.userId);
    const seg = segmentOfUser(u);

    const startV = getReqStart(r);
    const endV = getReqEnd(r);
    const resumeV = getReqResumeOn(r);
    const createdV = getReqCreatedAt(r);

    const startISO = iso(startV);
    const endISO = iso(endV);
    const resumeISO = iso(resumeV);
    const createdISO = iso(createdV);

    const total = Math.max(
      toInt(r?.totalWeekdays ?? 0, 0),
      getReqTotalDays(r)
    );

    const a = getReqAnnualAlloc(r);
    const o = getReqOffAlloc(r);
    const sumOK = total === 0 || a + o === total;

    const typeLabel = String(getReqType(r) || "local").toUpperCase();
    const reasonText = (getReqReason(r) || "—").trim() || "—";

    return (
      <tr key={r.id} className="border-t align-top">
        <td className="p-2 border-r">
          <div className="font-medium">{r.userName || u?.name || "Unknown"}</div>
          <div className="text-xs text-gray-500">{seg}</div>
          <div className="text-[11px] text-gray-500 mt-1">Requested: {createdISO || "—"}</div>
        </td>
        <td className="p-2 border-r">
          <div className="text-sm">
            <div>
              <span className="font-medium">Dates:</span>{" "}
              {startISO || "—"} → {endISO || "—"}
              {total > 0 && (
                <span className="ml-2 text-xs text-gray-600">({total} day{total === 1 ? "" : "s"})</span>
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
            <div>Annual alloc: <span className="font-semibold">{a}</span></div>
            <div>Off-day alloc: <span className="font-semibold">{o}</span></div>
            {!sumOK && total > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                ⚠️ Allocation ({a + o}) differs from requested days ({total})
              </div>
            )}
          </div>
        </td>
        <td className="p-2 border-r">
          <div className="text-sm">
            <div>Current Annual: <span className="font-semibold">{toInt(u?.annualLeave ?? 0)}</span></div>
            <div>Current Off days: <span className="font-semibold">{toInt(u?.offDays ?? 0)}</span></div>
          </div>
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-2">
            {(r.status || "pending") === "pending" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => openDecision(r, "approve")}
                  className="w-full"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => openDecision(r, "deny")}
                  className="w-full"
                >
                  Deny
                </Button>
              </>
            ) : (
              <div className="text-xs">
                <div className="font-medium capitalize">Status: {r.status}</div>
                <div>By: {r.approverName || "—"}</div>
                <div>On: {iso(r.decidedAt) || "—"}</div>
                {r.decisionNote && <div className="mt-1 italic text-gray-600">“{r.decisionNote}”</div>}
                {r.status === "approved" && (
                  <div className="mt-1 text-[11px] text-gray-600">
                    Applied — Annual: {toInt(r.appliedAnnual ?? 0)}, Off: {toInt(r.appliedOff ?? 0)}
                  </div>
                )}
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
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full"
            />
          </div>
          <div>
            <Label className="text-xs">To (created)</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full"
            />
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
                <th className="text-left p-2 w-[140px]">Actions / Status</th>
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

          {/* ===================== Currently on leave (Conditional) ===================== */}
      {currentlyOnLeave.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-3">Currently on leave</h2>

          <div className="border rounded overflow-hidden">
            <div className="bg-gray-100 px-3 py-2 text-sm text-gray-700">
              Showing people who are on leave now, or starting within the next 14 days.
            </div>

            <div className="p-3 space-y-2">
              {currentlyOnLeave.map((x) => (
                <div
                  key={x.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{x.name}</span>
                      <span className="text-xs text-gray-500">{x.segment}</span>
                      {x.isNow ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">
                          On Leave
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                          Upcoming
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-gray-500 mt-1">
                      {shortDate(x.startISO)} → {shortDate(x.endISO)}
                    </div>
                  </div>
                </div>
              ))}
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
                            onBlur={() =>
                              !disabled &&
                              persistField(user, "annualLeave", drafts[draftKey]?.annualLeave)
                            }
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
                            onBlur={() =>
                              !disabled && persistField(user, "offDays", drafts[draftKey]?.offDays)
                            }
                            className="w-24 border px-2 py-1 rounded"
                            disabled={disabled}
                            title={disabled ? "Cannot edit — user is missing an ID" : undefined}
                          />
                          {isSaving && (
                            <span className="ml-2 text-xs text-gray-500">Saving…</span>
                          )}
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

      {/* ===================== Decision Dialog ===================== */}
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
                      <div><span className="font-medium">User:</span> {activeReq.userName}</div>
                      <div>
                        <span className="font-medium">Dates:</span>{" "}
                        {iso(getReqStart(activeReq))} → {iso(getReqEnd(activeReq))}{" "}
                        {(() => {
                          const total = Math.max(
                            toInt(activeReq?.totalWeekdays ?? 0, 0),
                            getReqTotalDays(activeReq)
                          );
                          return total > 0 ? <span className="ml-2 text-xs text-gray-600">({total} day{total === 1 ? "" : "s"})</span> : null;
                        })()}
                      </div>
                      <div><span className="font-medium">Resume On:</span> {iso(getReqResumeOn(activeReq)) || "—"}</div>
                      <div><span className="font-medium">Type:</span> {String(getReqType(activeReq) || "local").toUpperCase()}</div>
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
                            placeholder="E.g., Approved — enjoy your leave. Deduction adjusted due to weekend."
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
    </div>
  );
}
