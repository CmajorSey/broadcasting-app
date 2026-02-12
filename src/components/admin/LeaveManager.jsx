// src/components/admin/LeaveManager.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import API_BASE from "@/api";
import { nextWorkdayISO } from "@/utils/leaveDates";
import { useToast } from "@/hooks/use-toast";

// 🔊 sound system (shared with TicketPage / TicketForm / MyProfile)
import {
  unlockSounds,
  playSoundFor,
  installSoundUnlockOnGesture,
  setSoundEnabled as setSoundEnabledStorage,
} from "@/lib/soundRouter";

// ✅ shared reconciliation helpers (date/alloc alignment)
// Import as a module so missing named exports don't crash Vite.
import * as LR from "@/lib/leaveReconcile";


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
import { Switch } from "@/components/ui/switch";

// icons
import { Pencil, X } from "lucide-react";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toInt = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fb;
};
// ---------- LeaveReconcile fallbacks (prevents crashes if exports differ) ----------

// Basic ISO normalizer
const iso = (v) => {
  // Prefer library version if present
  if (typeof LR?.iso === "function") return LR.iso(v);

  if (!v) return "";
  try {
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      return "";
    }
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

// Half-day safe numeric conversion
const toHalf = (v, fb = 0) => {
  if (typeof LR?.toHalf === "function") return LR.toHalf(v, fb);

  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.round(n * 2) / 2;
};

// Parse "YYYY-MM-DD" as LOCAL date (prevents UTC drift)
const parseISOToLocal = (isoStr) => {
  if (typeof LR?.parseISOToLocal === "function")
    return LR.parseISOToLocal(isoStr);

  if (!isoStr || typeof isoStr !== "string") return null;
  const m = isoStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const d = new Date(isoStr);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  const d = new Date(y, mo, da); // LOCAL midnight
  return Number.isNaN(d.getTime()) ? null : d;
};

// Workdays between inclusive, weekend + holidays aware
const workdaysBetweenInclusive = (startISO, endISO, publicHolidays = []) => {
  if (typeof LR?.workdaysBetweenInclusive === "function")
    return LR.workdaysBetweenInclusive(startISO, endISO, publicHolidays);

  const s = iso(startISO);
  const e = iso(endISO);
  if (!s || !e) return 0;

  const start = parseISOToLocal(s);
  const end = parseISOToLocal(e);
  if (!start || !end) return 0;

  const holidays = new Set((publicHolidays || []).map((x) => iso(x)).filter(Boolean));

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay(); // 0 Sun .. 6 Sat
    const curISO = iso(cur);
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidays.has(curISO);
    if (!isWeekend && !isHoliday) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

// Given a startISO and desired workday count, compute an end date ISO
const endDateForWorkdayCount = (startISO, workdayCount, publicHolidays = []) => {
  if (typeof LR?.endDateForWorkdayCount === "function")
    return LR.endDateForWorkdayCount(startISO, workdayCount, publicHolidays);

  const s = iso(startISO);
  if (!s) return "";
  const target = Math.max(0, Number(workdayCount) || 0);
  if (target === 0) return s;

  const holidays = new Set((publicHolidays || []).map((x) => iso(x)).filter(Boolean));

  const d = parseISOToLocal(s);
  if (!d) return "";

  let counted = 0;
  while (counted < target) {
    const day = d.getDay();
    const curISO = iso(d);
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidays.has(curISO);
    if (!isWeekend && !isHoliday) counted += 1;
    if (counted >= target) break;
    d.setDate(d.getDate() + 1);
  }

  return iso(d);
};

// Optional reconcile passthrough
const reconcile = (...args) => {
  if (typeof LR?.reconcile === "function") return LR.reconcile(...args);
  return null;
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
  toInt(
    pick(r, [
      "newTotalDays",
      "updatedTotalDays",
      "finalTotalDays",
      "lastTotalDays",
      "modifiedTotalDays",
      "payload.newTotalDays",
      "payload.totalDays",
      "totalDays",
      "days",
      "weekdayCount",
      "totalWeekdays",
      "duration",
    ]) ?? 0,
    0
  );

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
// ✅ Applied totals helpers (always use the LATEST values)
// After edits, backend may store newAppliedAnnual/newAppliedOff (or similar).
// These functions prevent cancel/edit logic from accidentally using the old applied values.
const getAppliedAnnual = (r) => {
  const v =
    pick(r, [
      "__uiAppliedAnnual",
      "newAppliedAnnual",
      "appliedAnnual",
      "applied_annual",
      "finalAppliedAnnual",
      "lastAppliedAnnual",
      "modifiedAppliedAnnual",
      "payload.newAppliedAnnual",
      "payload.appliedAnnual",
    ]) ?? getReqAnnualAlloc(r) ?? 0;

  return toHalf(v, 0);
};

const getAppliedOff = (r) => {
  const v =
    pick(r, [
      "__uiAppliedOff",
      "newAppliedOff",
      "appliedOff",
      "applied_off",
      "finalAppliedOff",
      "lastAppliedOff",
      "modifiedAppliedOff",
      "payload.newAppliedOff",
      "payload.appliedOff",
    ]) ?? getReqOffAlloc(r) ?? 0;

  return toHalf(v, 0);
};

// ✅ Workday count is now weekend + public-holiday aware
const weekdaysBetween = (startV, endV, holidays = []) => {
  const startISO = iso(startV);
  const endISO = iso(endV);
  if (!startISO || !endISO) return 0;
  return workdaysBetweenInclusive(startISO, endISO, holidays);
};

// Keep simple calendar add-days helper (used in cancel return math)
const addDaysISO = (isoStr, days) => {
  const dt = parseISOToLocal(isoStr);
  if (!dt) return "";
  const d = new Date(dt);
  d.setDate(d.getDate() + Number(days || 0));
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
// ✅ Uses LR.parseISOToLocal if available, otherwise local fallback above.


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

  // =========================
  // 🔊 SOUND SETTING START HERE
  // =========================
  const [toastEnabled, setToastEnabled] = useState(
    localStorage.getItem("notificationToastsEnabled") !== "false"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("notificationSoundsEnabled") !== "false"
  );

  // unlock-on-gesture (safe to call repeatedly)
  useEffect(() => {
    try {
      installSoundUnlockOnGesture();
    } catch {
      // ignore
    }
  }, []);

  // persist toggles (shared keys used elsewhere)
  useEffect(() => {
    localStorage.setItem("notificationToastsEnabled", String(toastEnabled));
  }, [toastEnabled]);

  useEffect(() => {
    localStorage.setItem("notificationSoundsEnabled", String(soundEnabled));

    // keep router in sync (some pages read it from there)
    try {
      setSoundEnabledStorage(soundEnabled);
    } catch {
      // ignore
    }

    // try to unlock immediately when enabling
    if (soundEnabled) {
      unlockSounds().catch(() => {});
    }
  }, [soundEnabled]);

  // Use this for “admin-side” actions (approve/deny/edit/cancel)
  const fireLeaveAdminSound = async ({ urgent = false } = {}) => {
    if (!soundEnabled) return;
    try {
      await playSoundFor({
        category: "leave",
        urgent: !!urgent,
        scope: "admin",
      });
    } catch {
      // ignore
    }
  };
  // 🔊 SOUND SETTING ENDS HERE
  // =========================

  // =========================
  // ✅ Notifications helper (Leave -> User)
  // =========================
  const postNotification = async ({
    title,
    message,
    recipients,
    category = "leave",
    urgent = false,
    kind = "leave_update",
    action,
    displayRecipients,
  }) => {
    try {
      const cleanRecipients = Array.from(
        new Set(
          (Array.isArray(recipients) ? recipients : [])
            .flat()
            .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
            .map((x) => String(x).trim())
        )
      );

      if (cleanRecipients.length === 0) return;

      const payload = {
        title,
        message,
        recipients: cleanRecipients,
        category,
        urgent: !!urgent,
        kind,
      };

      if (Array.isArray(displayRecipients) && displayRecipients.length) {
        payload.displayRecipients = displayRecipients;
      }
      if (action && typeof action === "object") {
        payload.action = action; // { type, id, url }
      }

      // Backend should add timestamp, but we don’t rely on it.
      await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // non-fatal: leave actions must still succeed even if notification fails
      console.warn("Leave notification failed:", e);
    }
  };

  const notifyLeaveUser = async (req, userObj, { title, message, urgent = false, action }) => {
    const userId = req?.userId ?? userObj?.id;
    const userName = req?.userName ?? userObj?.name;

    // ✅ Important: include BOTH id + name to match your current mixed recipient matching
    const recipients = [
      userId ? String(userId) : null,
      userName ? String(userName) : null,
    ];

    await postNotification({
      title,
      message,
      recipients,
      category: "leave",
      urgent,
      kind: "leave_update",
      displayRecipients: userName ? [String(userName)] : undefined,
      action: action || {
        type: "open_profile_leave",
        id: String(req?.id || ""),
        url: "/profile#leave",
      },
    });
  };

  // =========================
  // ✅ Leave → Notifications helper
  // =========================

  // Non-fatal: if notifications API isn't enabled/available, leave actions still succeed.
  const sendLeaveNotification = async ({
    userId,
    title,
    message,
    urgent = false,
    extra = {},
  }) => {
    const uid = userId ? String(userId) : "";
    if (!uid) return false;

    // ✅ Backend contract:
    // POST /notifications expects: { title, message, recipients: [] }
    // recipients can be userId OR user name (your App-level filter supports both)
    const payload = {
      title: String(title || "Leave update"),
      message: String(message || ""),
      // ✅ Send BOTH id + name (your app filters support mixed matching)
recipients: Array.from(
  new Set(
    [uid, extra?.userName, extra?.displayName]
      .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
      .map((x) => String(x).trim())
  )
),
// ✅ Helps AdminGlobalToasts + MyProfile routing
action: extra?.action || {
  type: "open_profile_leave",
  id: extra?.leaveRequestId ? String(extra.leaveRequestId) : undefined,
  url: "/profile#leave",
},
displayRecipients: extra?.displayRecipients || (extra?.userName ? [String(extra.userName)] : undefined),


      // Normalized meta used by your toast/sound rules
      urgent: !!urgent,
      category: "leave",

      // Extra metadata (backend will ignore unknown fields safely)
      type: "leave",
      createdAt: new Date().toISOString(),
      createdById: currentAdmin?.id ? String(currentAdmin.id) : null,
      createdByName: currentAdmin?.name || "Admin",
      userId: uid,
      userIds: [uid],
      ...extra,
    };

    const tryPost = async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      return true;
    };

    const tryPush = async () => {
      // Keep push schema flexible; backend can ignore unknown fields safely
      const pushBody = {
        title: payload.title,
        body: payload.message,
        message: payload.message,

        // allow backend to resolve userId/name/roles to tokens
        recipients: payload.recipients,

        category: "leave",
        urgent: !!urgent,
        actor: payload.createdByName || "Admin",

        data: {
          category: "leave",
          urgent: !!urgent,
          userId: uid,
          type: "leave",
          ...(extra?.data || {}),
        },
      };

      // Try a few likely push routes (first one that exists will work)
      try {
        if (await tryPost(`${API_BASE}/push`, pushBody)) return true;
      } catch {}
      try {
        if (await tryPost(`${API_BASE}/push/send`, pushBody)) return true;
      } catch {}
      try {
        if (await tryPost(`${API_BASE}/notifications/push`, pushBody)) return true;
      } catch {}

      return false;
    };

    try {
      // ✅ Primary (your backend index.js supports this)
      const ok = await tryPost(`${API_BASE}/notifications`, payload);

      // ✅ Also try PUSH (non-fatal)
      await tryPush();

      return ok;
    } catch (e1) {
      try {
        // ✅ Fallback (older builds / alias route)
        const ok = await tryPost(`${API_BASE}/notifications/send`, payload);

        // ✅ Also try PUSH (non-fatal)
        await tryPush();

        return ok;
      } catch (e2) {
        console.warn("Leave notification failed (non-fatal):", e2?.message || e2);
        return false;
      }
    }
  };


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

  // ✅ CANCEL: track whether admin manually edited refund fields.
  // If false, we auto-sync refund split when return-to-work date changes.
  const cancelRefundManualRef = useRef(false);

  // ✅ Split UI: manual split only shows inputs after button press
  const [modifySplitMode, setModifySplitMode] = useState("auto"); // "auto" | "manual"
  const [modifySplitPreset, setModifySplitPreset] = useState("annual"); // "annual" | "off" | "even"


  // =========================
  // ✅ NEW: Consumption order helpers (MyProfile → LeaveManager understanding)
  // =========================
  // A request can store: consumptionOrder: "annual_first" | "off_first"
  // Backwards compatible: default to "annual_first" if missing.
  const getConsumptionOrder = (req) => {
    const v = String(
      req?.consumptionOrder ??
        req?.allocOrder ??
        req?.allocationOrder ??
        req?.bucketOrder ??
        "annual_first"
    ).toLowerCase();

    return v === "off_first" ? "off_first" : "annual_first";
  };

  // Given:
  // - appliedA/appliedO: what was actually deducted on approval
  // - usedDays: how many leave days have been used so far (workday/holiday-aware)
  // Return the ONLY valid refund split on cancellation (unused days refund),
  // based on the consumption order that the employee accepted in MyProfile.
  const computeCancelRefundSplit = (req, appliedA, appliedO, usedDays) => {
    const order = getConsumptionOrder(req);

    const totalApplied = toHalf(toHalf(appliedA, 0) + toHalf(appliedO, 0), 0);
    const used = Math.max(0, Math.min(toHalf(usedDays, 0), totalApplied));

    let usedFromAnnual = 0;
    let usedFromOff = 0;

    if (order === "off_first") {
      usedFromOff = Math.min(toHalf(appliedO, 0), used);
      const rem = toHalf(used - usedFromOff, 0);
      usedFromAnnual = Math.min(toHalf(appliedA, 0), rem);
    } else {
      // annual_first
      usedFromAnnual = Math.min(toHalf(appliedA, 0), used);
      const rem = toHalf(used - usedFromAnnual, 0);
      usedFromOff = Math.min(toHalf(appliedO, 0), rem);
    }

    const refundA = Math.max(0, toHalf(toHalf(appliedA, 0) - usedFromAnnual, 0));
    const refundO = Math.max(0, toHalf(toHalf(appliedO, 0) - usedFromOff, 0));

    return {
      order,
      used,
      usedFromAnnual: toHalf(usedFromAnnual, 0),
      usedFromOff: toHalf(usedFromOff, 0),
      refundAnnual: toHalf(refundA, 0),
      refundOff: toHalf(refundO, 0),
      unused: toHalf(toHalf(refundA, 0) + toHalf(refundO, 0), 0),
    };
  };

  // ✅ Single source of truth for EDIT/CANCEL validation + save blocking
  const modifyValidation = useMemo(() => {
    if (!modifyOpen || !modifyReq) {
      return { ok: true, errors: [], deltaDays: 0, absDelta: 0, cancelUnused: 0 };
    }

    const mode = modifyMode;
    const req = modifyReq;

    const oStart = iso(getReqStart(req));
    const oEnd = iso(getReqEnd(req));

    // Original total: prefer stored if present, else recompute from original dates
    const storedTotal = toHalf(req?.totalWeekdays ?? getReqTotalDays(req) ?? 0, 0);
    const originalTotal =
      storedTotal > 0 ? storedTotal : toHalf(weekdaysBetween(oStart, oEnd, publicHolidays), 0);

    const startISO = iso(modifyStart);
    const endISO = iso(modifyEnd);

    // ✅ New total must always follow the selected dates
    const newTotal =
      mode === "edit"
        ? (startISO && endISO ? toHalf(weekdaysBetween(startISO, endISO, publicHolidays), 0) : 0)
        : originalTotal;

    const deltaDays = toHalf(newTotal - originalTotal, 0);
    const absDelta = Math.abs(deltaDays);

    const rA = Math.max(0, toHalf(refundAnnual, 0));
    const rO = Math.max(0, toHalf(refundOff, 0));
    const sum = toHalf(rA + rO, 0);

    const errors = [];

    if (mode === "edit") {
      if (!startISO || !endISO) errors.push("Please choose a start and end date.");
      if (startISO && endISO && endISO < startISO) errors.push("End date must be after start date.");

      if (absDelta > 0) {
        // Must allocate/refund exactly abs(delta)
        if (sum !== absDelta) errors.push(`Annual + Off must equal ${absDelta} day(s).`);

        // ✅ EXTEND: must have enough balance in each chosen bucket
        if (deltaDays > 0) {
          const u = users.find((x) => String(x.id) === String(req.userId));
          const curAnnual = toHalf(u?.annualLeave ?? 0, 0);
          const curOff = toHalf(u?.offDays ?? 0, 0);

          if (rA > curAnnual) {
            errors.push(`Not enough Annual Leave. Trying to take ${rA}, but user has ${curAnnual}.`);
          }
          if (rO > curOff) {
            errors.push(`Not enough Off Days. Trying to take ${rO}, but user has ${curOff}.`);
          }
        }

        // ✅ SHORTEN: cannot refund more than originally deducted per bucket
        const appliedA = toHalf(
          req.__uiAppliedAnnual ?? req.appliedAnnual ?? getReqAnnualAlloc(req) ?? 0,
          0
        );
        const appliedO = toHalf(
          req.__uiAppliedOff ?? req.appliedOff ?? getReqOffAlloc(req) ?? 0,
          0
        );

        if (deltaDays < 0) {
          if (rA > appliedA) errors.push("Refund to Annual cannot exceed what was originally deducted from Annual.");
          if (rO > appliedO) errors.push("Refund to Off cannot exceed what was originally deducted from Off.");
        }
      } else {
        // No date delta: adjustments must be 0/0
        if (sum !== 0) errors.push("No date change detected — set adjustments to 0 / 0.");
      }

      return { ok: errors.length === 0, errors, deltaDays, absDelta, cancelUnused: 0 };
    }

    // CANCEL
    const returnISO = iso(cancelReturnDate);
    if (!returnISO) errors.push("Please choose the return-to-work date.");

    const cancelStats = returnISO
      ? calcCancelUsedUnused(req, oStart, oEnd, returnISO)
      : { unused: 0, used: 0 };

    const cancelUnused = toHalf(cancelStats.unused, 0);

    if (sum !== cancelUnused) {
      errors.push(`Refund Annual + Refund Off must equal ${cancelUnused} unused day(s).`);
    }

    // ✅ NEW: Order-aware cancellation split (prevents false “stealing”)
    // Instead of forcing "refund back to what was approved", we refund based on what was USED,
    // respecting the user's agreed order (annual_first / off_first).
      const appliedA = toHalf(getAppliedAnnual(req), 0);
    const appliedO = toHalf(getAppliedOff(req), 0);

    const expected = computeCancelRefundSplit(
      req,
      appliedA,
      appliedO,
      toHalf(cancelStats.used ?? 0, 0)
    );

    if (cancelUnused !== expected.unused) {
      // Data inconsistency guard
      errors.push(
        "Cannot cancel: leave record is inconsistent (unused days do not match applied totals). Please correct the leave record first."
      );
    } else {
      if (rA !== expected.refundAnnual || rO !== expected.refundOff) {
        errors.push(
          `Refund split must follow the agreed order (${expected.order.replace("_", " ")}): Annual ${expected.refundAnnual} / Off ${expected.refundOff}.`
        );
      }
    }

    return { ok: errors.length === 0, errors, deltaDays, absDelta, cancelUnused };
  }, [
    modifyOpen,
    modifyMode,
    modifyReq,
    modifyStart,
    modifyEnd,
    cancelReturnDate,
    refundAnnual,
    refundOff,
    publicHolidays,
    users,
  ]);

  const loadRequests = async () => {
    setReqLoading(true);

    // ✅ Force a state reset so Refresh behaves like full page reload
    setRequests([]);

    try {
      const res = await fetch(`${API_BASE}/leave-requests`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("Failed to load leave requests");

      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.requests || [];

      // ✅ Always create a new array reference
      setRequests([...list]);
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
    if (["Clive Camille", "Jennifer Arnephy", "Gilmer Philoe"].includes(u.name)) return "Admins";

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
    // ✅ Use LOCAL "today" to avoid UTC date drift
    const todayISO = toISOLocal(new Date());

    const addDaysLocalISO = (baseISO, n) => {
      const d = parseISOToLocal(baseISO);
      if (!d) return "";
      const c = new Date(d);
      c.setDate(c.getDate() + Number(n || 0));
      return iso(c);
    };

    // Window for "Upcoming" (keeps the card useful instead of listing all future leave forever)
    const UPCOMING_WITHIN_DAYS = 14;
    const windowEndISO = addDaysLocalISO(todayISO, UPCOMING_WITHIN_DAYS);

    const firstLeaveStartISO = (r) => {
      // If dates[] exists, take the earliest date
      if (Array.isArray(r?.dates) && r.dates.length) {
        const sorted = [...r.dates].filter(Boolean).sort();
        return sorted[0] || "";
      }
      // Otherwise use start/end fallback
      return iso(getReqStart(r)) || iso(getReqEnd(r)) || "";
    };

    const overlapsToday = (r) => {
      if (!r || String(r.status || "").toLowerCase() !== "approved") return false;
      if (!todayISO) return false;

      // 1) dates[] style
      if (Array.isArray(r.dates) && r.dates.length) {
        return r.dates.includes(todayISO);
      }

      // 2) range style
      const s = iso(getReqStart(r));
      const e = iso(getReqEnd(r));
      if (!s && !e) return false;
      if (s && !e) return todayISO === s;
      if (!s && e) return todayISO === e;
      return todayISO >= s && todayISO <= e;
    };

    const isUpcomingSoon = (r) => {
      if (!r || String(r.status || "").toLowerCase() !== "approved") return false;
      if (!todayISO || !windowEndISO) return false;

      // ✅ never show upcoming if they are already on leave today
      if (overlapsToday(r)) return false;

      const startISO = firstLeaveStartISO(r);
      if (!startISO) return false;

      // Upcoming must start after today, within the next N days
      return startISO > todayISO && startISO <= windowEndISO;
    };

    const buildItem = (r) => {
      const u = userById(r.userId);
      const name = r.userName || u?.name || "Unknown";

      const startISO = iso(getReqStart(r)) || firstLeaveStartISO(r);
      const endISO = iso(getReqEnd(r)) || startISO;

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

    const approved = (requests || []).filter(
      (r) => String(r?.status || "").toLowerCase() === "approved"
    );

    const onLeaveNowList = approved
      .filter(overlapsToday)
      .map(buildItem)
      .sort(
        (a, b) =>
          new Date(a.startISO || "2100-01-01") - new Date(b.startISO || "2100-01-01")
      );

    const upcomingList = approved
      .filter(isUpcomingSoon)
      .map(buildItem)
      .sort(
        (a, b) =>
          new Date(a.startISO || "2100-01-01") - new Date(b.startISO || "2100-01-01")
      );

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

      // 🔊 action sound (non-blocking)
      fireLeaveAdminSound({ urgent: true });

      // ✅ Notify the user (non-fatal if it fails)
      await notifyLeaveUser(req, u, {
        title: "❌ Leave request denied",
        urgent: true,
        message: [
          `Dates: ${iso(getReqStart(req)) || "—"} → ${iso(getReqEnd(req)) || "—"}`,
          decisionNote ? `Reason: ${decisionNote}` : "Reason: Not provided",
          `By: ${currentAdmin?.name || "Admin"}`,
        ].join("\n"),
        action: { type: "open_profile_leave", id: String(req?.id || ""), url: "/profile#leave" },
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

    // 🔊 action sound (non-blocking)
    fireLeaveAdminSound({ urgent: false });

    // ✅ Notify the user
    await notifyLeaveUser(req, u, {
      title: "✅ Leave approved",
      urgent: false,
      message: [
        `Dates: ${iso(getReqStart(req)) || "—"} → ${iso(getReqEnd(req)) || "—"}`,
        `Resume on: ${getReturnISO(savedReq, publicHolidays) || iso(getReqResumeOn(req)) || "—"}`,
        `Applied: Annual ${toInt(adjAnnual, 0)} / Off ${toInt(adjOff, 0)}`,
        decisionNote ? `Note: ${decisionNote}` : null,
        `By: ${currentAdmin?.name || "Admin"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      action: { type: "open_profile_leave", id: String(req?.id || ""), url: "/profile#leave" },
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

  // ✅ Half-day safe numeric helper is now imported from leaveReconcile:
  // import { toHalf } from "@/lib/leaveReconcile";

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

    // ✅ reset split UI
    setModifySplitMode("auto");
    setModifySplitPreset("annual");
  };

   const openModify = (req, mode) => {
    // ✅ Never mutate the request object that lives inside React state
    const safeReq = { ...(req || {}) };

    setModifyReq(safeReq);
    setModifyMode(mode);

    const s = iso(getReqStart(safeReq));
    const e = iso(getReqEnd(safeReq));

    setModifyStart(s);
    setModifyEnd(e);

    // ✅ Cancel default: next WORKDAY after original end (weekend/holiday aware)
    const defaultReturn =
      e ? nextWorkdayISO(e, publicHolidays) || addDaysISO(e, 1) : "";
    setCancelReturnDate(defaultReturn);

       // ✅ Prefill applied split from what was actually applied (LATEST values after edits)
    const appliedA = toHalf(getAppliedAnnual(safeReq), 0);
    const appliedO = toHalf(getAppliedOff(safeReq), 0);

    // ✅ Default split UI behavior
    setModifySplitMode("auto");
    setModifySplitPreset("annual");

    // ✅ Store UI-only values on the safe clone only
    safeReq.__uiAppliedAnnual = appliedA;
    safeReq.__uiAppliedOff = appliedO;

    // ✅ Reset cancel manual override every time you open the modal
    cancelRefundManualRef.current = false;

    // ✅ Default split values
    // - Edit: start at 0/0 and force explicit allocation if delta exists
    // - Cancel: auto-fill based on used days + consumptionOrder
    if (mode === "cancel") {
      const stats = calcCancelUsedUnused(safeReq, s, e, iso(defaultReturn));
      const expected = computeCancelRefundSplit(
        safeReq,
        appliedA,
        appliedO,
        toHalf(stats?.used ?? 0, 0)
      );
      setRefundAnnual(expected.refundAnnual);
      setRefundOff(expected.refundOff);

      // In cancel mode, manual split is allowed, but must match expected.
      setModifySplitMode("auto");
      setModifySplitPreset("annual");
    } else {
      setRefundAnnual(0);
      setRefundOff(0);
    }

    setModifyNote("");
    setModifyOpen(true);
  };

  // Simple weekday-only estimate (holidays come later)
  // ✅ Supports half-day explicit fields if they exist in request payload
  function calcTotalWeekdays(req, startISO, endISO) {
    // ✅ If the request has an explicit/edited total stored anywhere, prefer it
    const maybeHalf =
      req?.requestedDays ??
      req?.daysRequested ??
      req?.totalRequestedDays ??
      req?.newTotalDays ??
      req?.updatedTotalDays ??
      req?.finalTotalDays ??
      req?.lastTotalDays ??
      null;

    const explicitHalf = toHalf(maybeHalf, 0);
    if (explicitHalf > 0) return explicitHalf;

    const explicit = Math.max(
      toInt(req?.totalWeekdays ?? 0, 0),
      getReqTotalDays(req)
    );
    if (explicit > 0) return toHalf(explicit, 0);

    // fallback: compute from dates (holiday/weekend aware)
    return toHalf(weekdaysBetween(startISO, endISO, publicHolidays), 0);
  }

  // ✅ Cancel logic fix:
  // Used must be 0 if leave is upcoming (has not started yet).
  // Used = weekdays from start -> min(today, lastLeaveDay)
   function calcCancelUsedUnused(req, startISO, endISO, returnISO) {
    // ✅ True total for cancellation should be what was actually DEDUCTED (latest applied totals),
    // because cancellation refunds unused deducted days (not “requested days” if they drifted).
    const appliedA = toHalf(getAppliedAnnual(req), 0);
    const appliedO = toHalf(getAppliedOff(req), 0);
    const appliedTotal = toHalf(appliedA + appliedO, 0);

    const computedTotal = calcTotalWeekdays(req, startISO, endISO);
    const total = appliedTotal > 0 ? appliedTotal : computedTotal;

    if (!startISO || !endISO || !returnISO) return { total, used: 0, unused: total };

    const returnDate = new Date(returnISO);
    if (isNaN(returnDate)) return { total, used: 0, unused: total };

    // last leave day is day before return
    const lastLeaveDay = new Date(returnISO);
    lastLeaveDay.setDate(lastLeaveDay.getDate() - 1);
    const lastISO = iso(lastLeaveDay);

    // ✅ LOCAL today (prevents UTC drift causing "already started" when it's not)
    const todayISO = toISOLocal(new Date());

    // ✅ If leave hasn't started yet, nothing is used
    if (todayISO < startISO) {
      return { total, used: 0, unused: total };
    }

    // If returning on/before start, used is 0
    if (returnISO <= startISO) return { total, used: 0, unused: total };

    // If returning after end+1, treat "unused" as 0 (they didn't shorten anything)
    if (returnISO > addDaysISO(endISO, 1)) {
      const usedLast = todayISO > endISO ? endISO : todayISO;
      const used =
        usedLast >= startISO
          ? toHalf(weekdaysBetween(startISO, usedLast, publicHolidays), 0)
          : 0;
      const unused = Math.max(0, toHalf(total - used, 0));
      return { total, used, unused };
    }

    // Normal cancel within range:
    const effectiveLast = todayISO < lastISO ? todayISO : lastISO;
    const used =
      effectiveLast >= startISO
        ? toHalf(weekdaysBetween(startISO, effectiveLast, publicHolidays), 0)
        : 0;
    const unused = Math.max(0, toHalf(total - used, 0));
    return { total, used, unused };
  }

  // ✅ CANCEL: if admin changes return-to-work date, re-sync refund split automatically,
  // unless they manually edited the refund fields.
  useEffect(() => {
    if (!modifyOpen) return;
    if (modifyMode !== "cancel") return;
    if (!modifyReq) return;

    if (cancelRefundManualRef.current) return;

    const oStart = iso(getReqStart(modifyReq));
    const oEnd = iso(getReqEnd(modifyReq));
    const returnISO = iso(cancelReturnDate);
    if (!oStart || !oEnd || !returnISO) return;

    const appliedA = toHalf(
      modifyReq.__uiAppliedAnnual ?? modifyReq.appliedAnnual ?? getReqAnnualAlloc(modifyReq) ?? 0,
      0
    );
    const appliedO = toHalf(
      modifyReq.__uiAppliedOff ?? modifyReq.appliedOff ?? getReqOffAlloc(modifyReq) ?? 0,
      0
    );

    const stats = calcCancelUsedUnused(modifyReq, oStart, oEnd, returnISO);
    const expected = computeCancelRefundSplit(
      modifyReq,
      appliedA,
      appliedO,
      toHalf(stats?.used ?? 0, 0)
    );

    setRefundAnnual(expected.refundAnnual);
    setRefundOff(expected.refundOff);
  }, [modifyOpen, modifyMode, modifyReq, cancelReturnDate, publicHolidays]);

  const submitModify = async () => {
    if (!modifyReq) return;

    const req = modifyReq;
    const mode = modifyMode;

    const startISO = iso(modifyStart);
    const endISO = iso(modifyEnd);
    const returnISO = iso(cancelReturnDate);

      // ✅ Always use LATEST applied values (post-edit compatible)
    const appliedA = toHalf(getAppliedAnnual(req), 0);
    const appliedO = toHalf(getAppliedOff(req), 0);
    const originalStart = iso(getReqStart(req));
    const originalEnd = iso(getReqEnd(req));

    // ✅ Original total: prefer stored, else compute from original dates
    const storedTotal = toHalf(req?.totalWeekdays ?? getReqTotalDays(req) ?? 0, 0);
    const originalTotal =
      storedTotal > 0
        ? storedTotal
        : toHalf(weekdaysBetween(originalStart, originalEnd, publicHolidays), 0);

    // ✅ New total MUST follow the selected dates (this fixes “preview changes but save doesn’t”)
    const newTotal =
      mode === "edit"
        ? (startISO && endISO ? toHalf(weekdaysBetween(startISO, endISO, publicHolidays), 0) : 0)
        : originalTotal;

    const delta = toHalf(newTotal - originalTotal, 0);

    const cancelStats =
      mode === "cancel"
        ? calcCancelUsedUnused(req, originalStart, originalEnd, returnISO)
        : { total: 0, used: 0, unused: 0 };

    // =========================
    // ✅ VALIDATION (unchanged logic)
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
            description:
              "Refund cannot exceed what was originally deducted from that bucket. Adjust split.",
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

        // ✅ EXTEND: must have enough balance in each chosen bucket
        const u = userById(req.userId);
        const curAnnual = toHalf(u?.annualLeave ?? 0, 0);
        const curOff = toHalf(u?.offDays ?? 0, 0);

        if (adjA > curAnnual || adjO > curOff) {
          const parts = [];
          if (adjA > curAnnual) parts.push(`Annual needed ${adjA}, available ${curAnnual}.`);
          if (adjO > curOff) parts.push(`Off needed ${adjO}, available ${curOff}.`);

          toast({
            title: "Not enough balance",
            description: parts.join(" "),
            variant: "destructive",
          });
          return;
        }
      }

      // ✅ Compute the NEW applied totals
      let nextA = appliedA;
      let nextO = appliedO;

      if (delta < 0) {
        nextA = toHalf(appliedA - Math.max(0, toHalf(refundAnnual, 0)), 0);
        nextO = toHalf(appliedO - Math.max(0, toHalf(refundOff, 0)), 0);
      } else if (delta > 0) {
        nextA = toHalf(appliedA + Math.max(0, toHalf(refundAnnual, 0)), 0);
        nextO = toHalf(appliedO + Math.max(0, toHalf(refundOff, 0)), 0);
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

      const requiredUnused = toHalf(cancelStats.unused, 0);

      // ✅ Must refund exactly the unused portion
      if (sum !== requiredUnused) {
        toast({
          title: "Refund must match unused",
          description: `Annual + Off must equal ${requiredUnused} unused day(s).`,
          variant: "destructive",
        });
        return;
      }

      // ✅ NEW: Order-aware cancellation split (prevents false “stealing”)
      const expected = computeCancelRefundSplit(
        req,
        appliedA,
        appliedO,
        toHalf(cancelStats.used ?? 0, 0)
      );

      if (requiredUnused !== expected.unused) {
        toast({
          title: "Cannot refund",
          description:
            "This leave record has inconsistent applied totals (unused does not match what was deducted). Please correct the leave record first.",
          variant: "destructive",
        });
        return;
      }

      if (rA !== expected.refundAnnual || rO !== expected.refundOff) {
        toast({
          title: "Invalid refund split",
          description: `This cancellation must follow the agreed order (${expected.order.replace(
            "_",
            " "
          )}). Expected: Annual ${expected.refundAnnual} / Off ${expected.refundOff}.`,
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
            adjustmentAnnual: Math.max(0, toHalf(refundAnnual, 0)),
            adjustmentOff: Math.max(0, toHalf(refundOff, 0)),
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

      // ✅ Notify user (non-fatal)
      {
        const u = userById(req.userId);
        const who = req.userName || u?.name || "Unknown";

        if (mode === "edit") {
          await sendLeaveNotification({
            userId: req.userId,
            urgent: false,
            title: "Your approved leave was updated",
            message: [
              `Hi ${who}, your approved leave was updated by ${currentAdmin?.name || "Admin"}.`,
              originalStart && originalEnd ? `Original: ${originalStart} → ${originalEnd}` : null,
              startISO && endISO ? `New: ${startISO} → ${endISO}` : null,
              `Change: ${delta === 0 ? "No day change" : delta > 0 ? `+${delta} day(s)` : `${delta} day(s)`}`,
              modifyNote ? `Note: ${modifyNote}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            extra: {
              leaveRequestId: String(req.id),
              status: "approved",
              editMode: "edit",
              originalStartDate: originalStart || null,
              originalEndDate: originalEnd || null,
              newStartDate: startISO || null,
              newEndDate: endISO || null,
              newTotalDays: newTotal,
              deltaDays: delta,
            },
          });
        } else {
          await sendLeaveNotification({
            userId: req.userId,
            urgent: false,
            title: "Your approved leave was cancelled",
            message: [
              `Hi ${who}, your approved leave was cancelled by ${currentAdmin?.name || "Admin"}.`,
              originalStart && originalEnd ? `Leave: ${originalStart} → ${originalEnd}` : null,
              returnISO ? `Return to work: ${returnISO}` : null,
              `Refund: Annual ${toHalf(refundAnnual, 0)} / Off ${toHalf(refundOff, 0)}`,
              modifyNote ? `Note: ${modifyNote}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            extra: {
              leaveRequestId: String(req.id),
              status: "cancelled",
              editMode: "cancel",
              originalStartDate: originalStart || null,
              originalEndDate: originalEnd || null,
              cancelReturnDate: returnISO || null,
              refundAnnual: toHalf(refundAnnual, 0),
              refundOff: toHalf(refundOff, 0),
              cancelUsedDays: toHalf(cancelStats.used, 0),
              cancelUnusedDays: toHalf(cancelStats.unused, 0),
            },
          });
        }
      }

          toast({
        title: mode === "edit" ? "Leave updated" : "Leave cancelled",
        description:
          mode === "edit"
            ? "Dates updated and balances adjusted."
            : "Refund applied and balances adjusted.",
      });

      // 🔊 action sound (non-blocking)
      fireLeaveAdminSound({ urgent: mode !== "edit" });

      // ✅ Notify the user
      const u = userById(req.userId);

      if (mode === "edit") {
  const oStart = iso(getReqStart(req));
  const oEnd = iso(getReqEnd(req));

  await notifyLeaveUser(req, u, {
    title: "✏️ Leave updated",
    urgent: false,
    message: [
      `Old: ${oStart || "—"} → ${oEnd || "—"}`,
      `New: ${startISO || "—"} → ${endISO || "—"}`,
      `Change: ${delta > 0 ? `+${delta}` : `${delta}`} day(s)`,
      `Applied now: Annual ${Math.max(0, toHalf(savedReq?.appliedAnnual ?? savedReq?.newAppliedAnnual ?? 0, 0))} / Off ${Math.max(0, toHalf(savedReq?.appliedOff ?? savedReq?.newAppliedOff ?? 0, 0))}`,
      modifyNote ? `Note: ${modifyNote}` : null,
      `By: ${currentAdmin?.name || "Admin"}`,
    ]
      .filter(Boolean)
      .join("\n"),
    action: { type: "open_profile_leave", id: String(req?.id || ""), url: "/profile#leave" },
  });
} else {
  await notifyLeaveUser(req, u, {
    title: "🛑 Leave cancelled",
    urgent: true,
    message: [
      `Return to work: ${returnISO || "—"}`,
      `Refund: Annual ${toHalf(refundAnnual, 0)} / Off ${toHalf(refundOff, 0)}`,
      modifyNote ? `Note: ${modifyNote}` : null,
      `By: ${currentAdmin?.name || "Admin"}`,
    ]
      .filter(Boolean)
      .join("\n"),
    action: { type: "open_profile_leave", id: String(req?.id || ""), url: "/profile#leave" },
  });
}

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
  const changeSummaryText = (r) => {
    if (!r) return "";

    const mode = String(
      r.lastEditMode || r.editMode || r.modifyMode || r.mode || ""
    ).toLowerCase();

    const status = String(r.status || "").toLowerCase();

    const isCancelled =
      mode === "cancel" ||
      status === "cancelled" ||
      !!r.cancelReturnDate ||
      !!r.cancelledAt;

    const isEdited =
      mode === "edit" ||
      (!!r.lastEditedAt || !!r.lastEditedByName) ||
      (!!r.editedAt || !!r.editedByName);

    if (!isCancelled && !isEdited) return "";

    const fmtSigned = (n) => {
      const x = toHalf(n, 0);
      if (x === 0) return "0";
      return x > 0 ? `+${x}` : `${x}`;
    };

    if (isCancelled) {
      const ra = toHalf(r.refundAnnual ?? r.refundedAnnual ?? 0, 0);
      const ro = toHalf(r.refundOff ?? r.refundedOff ?? 0, 0);
      const total =
        toHalf(
          r.cancelUnusedDays ??
            r.unusedDays ??
            r.refundedDays ??
            (ra + ro) ??
            0,
          0
        ) || 0;

      if (total > 0 || ra > 0 || ro > 0) {
        return `Cancelled: refunded ${toHalf(total, 0)} (Annual ${ra} / Off ${ro})`;
      }
      return "Cancelled";
    }

    // EDIT summary (prefer stored deltas if backend persisted them)
    const delta = toHalf(r.deltaDays ?? r.dayDelta ?? 0, 0);
    const adjA = toHalf(r.adjustmentAnnual ?? r.deltaAnnual ?? 0, 0);
    const adjO = toHalf(r.adjustmentOff ?? r.deltaOff ?? 0, 0);

    if (delta !== 0 || adjA !== 0 || adjO !== 0) {
      const parts = [];
      if (adjA !== 0) parts.push(`Annual ${fmtSigned(adjA)}`);
      if (adjO !== 0) parts.push(`Off ${fmtSigned(adjO)}`);
      const split = parts.length ? ` (${parts.join(" / ")})` : "";
      const dayLabel = Math.abs(delta) === 1 ? "day" : "days";
      return `Edited: ${fmtSigned(delta)} ${dayLabel}${split}`;
    }

    return "Edited";
  };

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

            {/* ✅ Option C: show a small “Edited/Cancelled” cue when applicable */}
            {(() => {
              const txt = changeSummaryText(r);
              return txt ? (
                <div className="mt-1 text-xs text-gray-600">{txt}</div>
              ) : null;
            })()}

            {/* Keep allocation sanity-check (not edit/cancel), but no “mismatch”-style wording */}
            {!sumOK && total > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                Allocation check: {toHalf(a + o, 0)} vs requested {total}
              </div>
            )}

            {/* ✅ Consumption order hint (if present) */}
            {status === "approved" && (
              <div className="mt-1 text-[11px] text-gray-600">
                Order: {getConsumptionOrder(r) === "off_first" ? "Off first" : "Annual first"}
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
            <div className="bg-gray-100 px-3 py-2 text-sm text-gray-700"></div>

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
        <AlertDialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] flex flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>
              {modifyMode === "edit" ? "Edit approved leave" : "Cancel approved leave"}
            </AlertDialogTitle>

                     <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm flex-1 min-h-0 overflow-y-auto pr-1">
                {modifyReq && (() => {
                  const u = userById(modifyReq.userId);
                  const curAnnual = toInt(u?.annualLeave ?? 0);
                  const curOff = toInt(u?.offDays ?? 0);

                  const oStart = iso(getReqStart(modifyReq));
                  const oEnd = iso(getReqEnd(modifyReq));

                  const storedTotal = toHalf(modifyReq?.totalWeekdays ?? getReqTotalDays(modifyReq) ?? 0, 0);
                  const originalTotal = storedTotal > 0
                    ? storedTotal
                    : toHalf(weekdaysBetween(oStart, oEnd, publicHolidays), 0);

                  const originalAppliedA = toHalf(modifyReq.__uiAppliedAnnual ?? modifyReq.appliedAnnual ?? 0, 0);
                  const originalAppliedO = toHalf(modifyReq.__uiAppliedOff ?? modifyReq.appliedOff ?? 0, 0);

                  const startISO = iso(modifyStart);
                  const endISO = iso(modifyEnd);

                  const newTotalPreview =
                    modifyMode === "edit"
                      ? toHalf(weekdaysBetween(startISO, endISO, publicHolidays), 0)
                      : originalTotal;

                  const deltaDays = toHalf(newTotalPreview - originalTotal, 0); // + extend, - shorten

                  const adjA = Math.max(0, toHalf(refundAnnual, 0));
                  const adjO = Math.max(0, toHalf(refundOff, 0));
                  const adjSum = toHalf(adjA + adjO, 0);

                  let nextAppliedA = originalAppliedA;
                  let nextAppliedO = originalAppliedO;
                  if (modifyMode === "edit") {
                    if (deltaDays > 0) {
                      nextAppliedA = toHalf(originalAppliedA + adjA, 0);
                      nextAppliedO = toHalf(originalAppliedO + adjO, 0);
                    } else if (deltaDays < 0) {
                      nextAppliedA = toHalf(originalAppliedA - adjA, 0);
                      nextAppliedO = toHalf(originalAppliedO - adjO, 0);
                    }
                  }

                  const annualAfter =
                    modifyMode === "edit"
                      ? curAnnual - toHalf(nextAppliedA - originalAppliedA, 0)
                      : curAnnual + Math.max(0, toHalf(adjA, 0));
                  const offAfter =
                    modifyMode === "edit"
                      ? curOff - toHalf(nextAppliedO - originalAppliedO, 0)
                      : curOff + Math.max(0, toHalf(adjO, 0));

                  const required = modifyMode === "edit" ? newTotalPreview : originalTotal;
                  const selected = modifyMode === "edit" ? toHalf(nextAppliedA + nextAppliedO, 0) : required;
                  const mismatch = modifyMode === "edit" ? toHalf(selected - required, 0) : 0;

                  const setDeltaToAnnual = () => {
                    const target = Math.abs(deltaDays);
                    setRefundAnnual(target);
                    setRefundOff(0);
                  };
                  const setDeltaToOff = () => {
                    const target = Math.abs(deltaDays);
                    setRefundAnnual(0);
                    setRefundOff(target);
                  };
                  const revertDates = () => {
                    setModifyStart(oStart);
                    setModifyEnd(oEnd);
                    setRefundAnnual(0);
                    setRefundOff(0);
                  };
                  const extendEndToMatchSelected = () => {
                    const desired = Math.round(selected);
                    const newEnd = endDateForWorkdayCount(startISO, desired, publicHolidays);
                    if (newEnd) setModifyEnd(newEnd);
                  };
                  const revertSelectionToRequiredPreferAnnual = () => {
                    const over = Math.max(0, Math.round(selected - required));
                    if (over <= 0) return;

                    if (deltaDays > 0) {
                      let reduce = over;
                      let newAdjO = adjO;
                      let newAdjA = adjA;

                      const takeO = Math.min(newAdjO, reduce);
                      newAdjO = toHalf(newAdjO - takeO, 0);
                      reduce -= takeO;

                      const takeA = Math.min(newAdjA, reduce);
                      newAdjA = toHalf(newAdjA - takeA, 0);

                      setRefundAnnual(newAdjA);
                      setRefundOff(newAdjO);
                    }
                  };

                  const cancelStats =
                    modifyMode === "cancel"
                      ? calcCancelUsedUnused(modifyReq, oStart, oEnd, iso(cancelReturnDate))
                      : { total: 0, used: 0, unused: 0 };

                  const cancelUnused = toHalf(cancelStats.unused, 0);

                  const expectedCancelSplit =
                    modifyMode === "cancel"
                      ? computeCancelRefundSplit(modifyReq, originalAppliedA, originalAppliedO, toHalf(cancelStats.used ?? 0, 0))
                      : null;

                                const headerCard = (
                    <div className="rounded border p-2 space-y-1 max-h-[28vh] overflow-y-auto">
                      <div>
                        <span className="font-medium">User:</span>{" "}
                        {modifyReq.userName || u?.name || "Unknown"}
                      </div>
                      <div>
                        <span className="font-medium">Original dates:</span> {oStart} → {oEnd}
                        <span className="ml-2 text-xs text-gray-600">
                          ({originalTotal} workday{originalTotal === 1 ? "" : "s"})
                        </span>
                      </div>
                      <div className="text-xs text-gray-700">
                        Applied split: <b>Annual {originalAppliedA}</b> / <b>Off {originalAppliedO}</b>
                      </div>

                      {modifyMode === "cancel" && expectedCancelSplit && (
                        <div className="mt-2 text-[11px] text-gray-700">
                          Cancellation order:{" "}
                          <b>{expectedCancelSplit.order === "off_first" ? "Off first" : "Annual first"}</b>
                          {" • "}
                          Expected refund:{" "}
                          <b>Annual {expectedCancelSplit.refundAnnual}</b> / <b>Off {expectedCancelSplit.refundOff}</b>
                        </div>
                      )}

                      <div className="mt-2 text-xs">
                        <div>
                          Balance preview — Annual:{" "}
                          <b>{curAnnual}</b>{" "}
                          <span className="text-gray-500">→</span>{" "}
                          <b>{Math.max(0, annualAfter)}</b>
                        </div>
                        <div>
                          Balance preview — Off:{" "}
                          <b>{curOff}</b>{" "}
                          <span className="text-gray-500">→</span>{" "}
                          <b>{Math.max(0, offAfter)}</b>
                        </div>
                      </div>
                    </div>
                  );

                               return (
  <>
    {/* ✅ Always show summary card at top (non-scrolling context) */}
    {headerCard}

    {modifyMode === "cancel" ? (
      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 mt-3">
        {/* Cancel UI (scrolls) */}
        <div>
          <Label>Return to work date</Label>
                            <Input
                              type="date"
                              value={cancelReturnDate}
                              onChange={(e) => setCancelReturnDate(e.target.value)}
                            />
                            <div className="text-xs text-gray-600 mt-1">
                              Last leave day is the day before return date.
                            </div>
                          </div>

                          <div className="rounded border p-2 text-xs text-gray-800">
                            Total: <b>{toHalf(cancelStats.total, 0)}</b> • Used:{" "}
                            <b>{toHalf(cancelStats.used, 0)}</b> • Unused (refund):{" "}
                            <b>{cancelUnused}</b>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                                                  <div>
                              <Label>Refund to Annual</Label>
                              <Input
                                type="number"
                                step={0.5}
                                value={refundAnnual}
                                onChange={(e) => {
                                  cancelRefundManualRef.current = true;
                                  setRefundAnnual(toHalf(e.target.value, 0));
                                }}
                              />
                            </div>
                                                 <div>
                              <Label>Refund to Off Days</Label>
                              <Input
                                type="number"
                                step={0.5}
                                value={refundOff}
                                onChange={(e) => {
                                  cancelRefundManualRef.current = true;
                                  setRefundOff(toHalf(e.target.value, 0));
                                }}
                              />
                            </div>
                          </div>

                          <div className="text-xs text-gray-600">
                            Refund Annual + Refund Off must equal <b>{cancelUnused}</b>. Refund split follows the agreed
                            order.
                          </div>

                          {expectedCancelSplit && (
                            <div className="rounded bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900 space-y-2">
                              <div className="font-medium">Expected refund split (order-aware)</div>
                              <div>
                                Order:{" "}
                                <b>{expectedCancelSplit.order === "off_first" ? "Off first" : "Annual first"}</b>
                                {" • "}
                                Annual <b>{expectedCancelSplit.refundAnnual}</b> / Off{" "}
                                <b>{expectedCancelSplit.refundOff}</b>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    setRefundAnnual(expectedCancelSplit.refundAnnual);
                                    setRefundOff(expectedCancelSplit.refundOff);
                                  }}
                                >
                                  Use expected split
                                </Button>
                              </div>
                            </div>
                          )}

                          {!modifyValidation.ok && modifyValidation.errors.length > 0 && (
                            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 space-y-1">
                              {modifyValidation.errors.map((msg, i) => (
                                <div key={i}>• {msg}</div>
                              ))}
                            </div>
                          )}

                          <div>
                            <Label>Note (optional)</Label>
                            <Textarea
                              value={modifyNote}
                              onChange={(e) => setModifyNote(e.target.value)}
                              placeholder="E.g., Leave changed due to emergency / flight reschedule."
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Existing Edit UI (unchanged) */}
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

                          <div className="rounded border p-2">
                            <div className="text-xs text-gray-700">
                              New total (workdays): <b>{newTotalPreview}</b>{" "}
                              <span className="text-gray-400">•</span>{" "}
                              {deltaDays < 0 ? (
                                <span>
                                  Shorten by <b>{Math.abs(deltaDays)}</b>
                                </span>
                              ) : deltaDays > 0 ? (
                                <span>
                                  Extend by <b>{deltaDays}</b>
                                </span>
                              ) : (
                                <span>No change</span>
                              )}
                            </div>

                            {deltaDays !== 0 && (
                              <div className="mt-2 space-y-2">
                                <div className="rounded border p-2 text-xs space-y-2">
                                  <div className="font-medium">
                                    {deltaDays < 0
                                      ? `Refund ${Math.abs(deltaDays)} day(s) back`
                                      : `Deduct ${deltaDays} extra day(s)`}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        modifySplitMode === "auto" && modifySplitPreset === "annual"
                                          ? "default"
                                          : "secondary"
                                      }
                                      onClick={() => {
                                        setModifySplitMode("auto");
                                        setModifySplitPreset("annual");
                                        setRefundAnnual(toHalf(Math.abs(deltaDays), 0));
                                        setRefundOff(0);
                                      }}
                                    >
                                      All to Annual
                                    </Button>

                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        modifySplitMode === "auto" && modifySplitPreset === "off"
                                          ? "default"
                                          : "secondary"
                                      }
                                      onClick={() => {
                                        setModifySplitMode("auto");
                                        setModifySplitPreset("off");
                                        setRefundAnnual(0);
                                        setRefundOff(toHalf(Math.abs(deltaDays), 0));
                                      }}
                                    >
                                      All to Off
                                    </Button>

                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        modifySplitMode === "auto" && modifySplitPreset === "even"
                                          ? "default"
                                          : "secondary"
                                      }
                                      onClick={() => {
                                        setModifySplitMode("auto");
                                        setModifySplitPreset("even");
                                        const total = toHalf(Math.abs(deltaDays), 0);
                                        const half1 = toHalf(total / 2, 0);
                                        const half2 = toHalf(total - half1, 0);
                                        setRefundAnnual(half1);
                                        setRefundOff(half2);
                                      }}
                                    >
                                      Even split
                                    </Button>

                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={modifySplitMode === "manual" ? "default" : "outline"}
                                      onClick={() => {
                                        setModifySplitMode("manual");
                                        const total = toHalf(Math.abs(deltaDays), 0);
                                        const half1 = toHalf(total / 2, 0);
                                        const half2 = toHalf(total - half1, 0);
                                        setRefundAnnual(half1);
                                        setRefundOff(half2);
                                      }}
                                    >
                                      Manual split
                                    </Button>
                                  </div>

                                  {modifySplitMode === "manual" && (
                                    <div className="grid grid-cols-2 gap-3 pt-2">
                                      <div>
                                        <Label>
                                          {deltaDays < 0 ? "Refund to Annual" : "Extra from Annual"}
                                        </Label>
                                        <Input
                                          type="number"
                                          step={0.5}
                                          value={refundAnnual}
                                          onChange={(e) => setRefundAnnual(toHalf(e.target.value, 0))}
                                        />
                                      </div>
                                      <div>
                                        <Label>
                                          {deltaDays < 0 ? "Refund to Off Days" : "Extra from Off Days"}
                                        </Label>
                                        <Input
                                          type="number"
                                          step={0.5}
                                          value={refundOff}
                                          onChange={(e) => setRefundOff(toHalf(e.target.value, 0))}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  <div className="text-[11px] text-gray-600">
                                    Annual + Off must equal <b>{Math.abs(deltaDays)}</b>.
                                  </div>
                                </div>

                                {!modifyValidation.ok && modifyValidation.errors.length > 0 && (
                                  <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 space-y-1">
                                    {modifyValidation.errors.map((msg, i) => (
                                      <div key={i}>• {msg}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {mismatch !== 0 && (
                              <div className="mt-2 rounded bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900 space-y-2">
                                <div className="font-medium">Dates & split are out of sync</div>
                                <div>
                                  Required: <b>{required}</b> • Selected: <b>{selected}</b>{" "}
                                  {mismatch > 0 ? (
                                    <span>
                                      (<b>{mismatch}</b> too many)
                                    </span>
                                  ) : (
                                    <span>
                                      (<b>{Math.abs(mismatch)}</b> missing)
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  {mismatch < 0 ? (
                                    <>
                                      <Button type="button" size="sm" variant="secondary" onClick={() => setDeltaToAnnual()}>
                                        Add missing to Annual
                                      </Button>
                                      <Button type="button" size="sm" variant="secondary" onClick={() => setDeltaToOff()}>
                                        Add missing to Off
                                      </Button>
                                      <Button type="button" size="sm" variant="outline" onClick={revertDates}>
                                        Revert dates
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button type="button" size="sm" variant="secondary" onClick={extendEndToMatchSelected}>
                                        Extend end date to match days
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        onClick={revertSelectionToRequiredPreferAnnual}
                                      >
                                        Revert extra selected days
                                      </Button>
                                      <Button type="button" size="sm" variant="outline" onClick={revertDates}>
                                        Revert dates
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

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
                    </>
                  );
                         })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {(() => {
            const req = modifyReq;

                       const appliedA = toHalf(getAppliedAnnual(req), 0);
            const appliedO = toHalf(getAppliedOff(req), 0);

            const guard = (() => {
              if (!req) return { canSave: false, message: "No request selected." };

              if (modifyMode === "edit") {
                const startISO = iso(modifyStart);
                const endISO = iso(modifyEnd);

                if (!startISO || !endISO) {
                  return { canSave: false, message: "Please choose a start and end date." };
                }
                if (endISO < startISO) {
                  return { canSave: false, message: "End date must be after start date." };
                }

                const originalStart = iso(getReqStart(req));
                const originalEnd = iso(getReqEnd(req));

                const storedTotal = toHalf(req?.totalWeekdays ?? getReqTotalDays(req) ?? 0, 0);
                const originalTotal =
                  storedTotal > 0
                    ? storedTotal
                    : toHalf(weekdaysBetween(originalStart, originalEnd, publicHolidays), 0);

                const newTotal = toHalf(weekdaysBetween(startISO, endISO, publicHolidays), 0);
                const delta = toHalf(newTotal - originalTotal, 0);

                const adjA = Math.max(0, toHalf(refundAnnual, 0));
                const adjO = Math.max(0, toHalf(refundOff, 0));
                const adjSum = toHalf(adjA + adjO, 0);

                if (delta === 0) {
                  if (adjSum !== 0) {
                    return {
                      canSave: false,
                      message: "No day change detected. Set Annual/Off adjustments back to 0 / 0.",
                    };
                  }
                  return { canSave: true, message: "" };
                }

                const required = Math.abs(delta);
                if (adjSum !== required) {
                  return {
                    canSave: false,
                    message: `Annual + Off must equal ${required} day(s) for this change.`,
                  };
                }

                if (delta < 0) {
                  if (adjA > appliedA || adjO > appliedO) {
                    return {
                      canSave: false,
                      message:
                        "Refund too large: you can’t refund more than what was originally deducted from each bucket.",
                    };
                  }
                }

                let nextA = appliedA;
                let nextO = appliedO;
                if (delta < 0) {
                  nextA = toHalf(appliedA - adjA, 0);
                  nextO = toHalf(appliedO - adjO, 0);
                } else {
                  nextA = toHalf(appliedA + adjA, 0);
                  nextO = toHalf(appliedO + adjO, 0);
                }
                if (toHalf(nextA + nextO, 0) !== newTotal) {
                  return {
                    canSave: false,
                    message: `Applied Annual + Off must equal ${newTotal} day(s).`,
                  };
                }

                return { canSave: true, message: "" };
              }

              // CANCEL
              const returnISO = iso(cancelReturnDate);
              if (!returnISO) {
                return { canSave: false, message: "Please choose the return-to-work date." };
              }

              const rA = Math.max(0, toHalf(refundAnnual, 0));
              const rO = Math.max(0, toHalf(refundOff, 0));
              const sum = toHalf(rA + rO, 0);

              const oStart = iso(getReqStart(req));
              const oEnd = iso(getReqEnd(req));
              const cancelStats = calcCancelUsedUnused(req, oStart, oEnd, returnISO);
              const requiredUnused = toHalf(cancelStats.unused, 0);

              if (sum !== requiredUnused) {
                return {
                  canSave: false,
                  message: `Refund Annual + Off must equal ${requiredUnused} unused day(s).`,
                };
              }

              const expected = computeCancelRefundSplit(req, appliedA, appliedO, toHalf(cancelStats.used ?? 0, 0));

              if (requiredUnused !== expected.unused) {
                return {
                  canSave: false,
                  message:
                    "Cannot cancel: leave record is inconsistent (unused does not match what was deducted).",
                };
              }

              if (rA !== expected.refundAnnual || rO !== expected.refundOff) {
                return {
                  canSave: false,
                  message: `Refund split must follow the agreed order (${expected.order.replace("_", " ")}). Expected: Annual ${expected.refundAnnual} / Off ${expected.refundOff}.`,
                };
              }

              return { canSave: true, message: "" };
            })();

            return (
              <>
                {!guard.canSave && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {guard.message}
                  </div>
                )}

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={savingModify} onClick={closeModify}>
                    Close
                  </AlertDialogCancel>

                  <AlertDialogAction
                    disabled={savingModify || !guard.canSave}
                    onClick={submitModify}
                    title={!guard.canSave ? guard.message : undefined}
                  >
                    {savingModify ? "Saving..." : "Save"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
           </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

