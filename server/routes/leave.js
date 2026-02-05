// server/routes/leave.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- Data files -----------------
const IS_RENDER = !!(process.env.RENDER || process.env.ON_RENDER);

const DATA_DIR =
  process.env.DATA_DIR ||
  (IS_RENDER ? "/data" : path.join(__dirname, "..", "data"));

const LEAVE_FILE = path.join(DATA_DIR, "leave-requests.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const HOLIDAYS_FILE = path.join(DATA_DIR, "holidays.json");

// -------------- Helpers --------------
function ensureFile(filePath, defaultValue) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        JSON.stringify(defaultValue, null, 2),
        "utf-8"
      );
    }
  } catch {
    // If this fails, readJSON will still fallback safely.
  }
}

function readJSON(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

ensureFile(LEAVE_FILE, []);
ensureFile(USERS_FILE, []);
ensureFile(HOLIDAYS_FILE, []);

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toInt = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fb;
};

function findUserIndex(users, userIdOrName) {
  const key = String(userIdOrName || "").trim();

  // 1) Exact id match (string IDs)
  const byId = users.findIndex((u) => String(u.id) === key);
  if (byId !== -1) return byId;

  // 2) Name match (if the caller passed a name)
  const byName = users.findIndex(
    (u) => String(u.name || "").trim().toLowerCase() === key.toLowerCase()
  );
  if (byName !== -1) return byName;

  // 3) Legacy numeric: treat "2" as the 2nd user in the array (1-based)
  const n = Number(key);
  if (Number.isInteger(n) && n > 0 && n <= users.length) {
    return n - 1;
  }

  return -1;
}

/**
 * Balance normalization helpers:
 * - getBalances(u): read whatever exists and return { annualLeave, offDays }
 * - setBalances(u, { annualLeave, offDays }): write BOTH legacy and new fields.
 */
function getBalances(u) {
  const annual =
    typeof u.annualLeave === "number"
      ? u.annualLeave
      : typeof u.leaveBalance === "number"
        ? u.leaveBalance
        : 21;

  const off =
    typeof u.offDays === "number"
      ? u.offDays
      : typeof u.offDayBalance === "number"
        ? u.offDayBalance
        : 0;

  return { annualLeave: toInt(annual, 21), offDays: toInt(off, 0) };
}

function setBalances(u, { annualLeave, offDays }) {
  const annual = clamp(toInt(annualLeave, 21), 0, 42); // UI maximum
  const off = Math.max(0, toInt(offDays, 0));

  // Write both shapes for compatibility
  u.annualLeave = annual;
  u.leaveBalance = annual;

  u.offDays = off;
  u.offDayBalance = off;

  return u;
}

// ----------------- Date helpers (weekend + holiday safe) -----------------

const pad2 = (n) => String(n).padStart(2, "0");

// Parse "YYYY-MM-DD" into a LOCAL date (prevents UTC drift issues)
function parseISOToLocal(iso) {
  if (!iso || typeof iso !== "string") return null;
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toISOLocalDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Accept Date | ISO | timestamp and normalize to "YYYY-MM-DD"
const toISO = (v) => {
  if (!v && v !== 0) return "";
  if (typeof v === "string") {
    // prefer strict ISO date if given
    const dt = parseISOToLocal(v);
    if (dt) return toISOLocalDate(dt);
  }
  const x = new Date(v);
  if (Number.isNaN(x.getTime())) return "";
  // convert to local date ISO
  return toISOLocalDate(new Date(x.getFullYear(), x.getMonth(), x.getDate()));
};

function isWeekendISO(iso) {
  const dt = parseISOToLocal(iso);
  if (!dt) return false;
  const dow = dt.getDay(); // 0 Sun .. 6 Sat (local)
  return dow === 0 || dow === 6;
}

function loadHolidaySet() {
  const list = readJSON(HOLIDAYS_FILE, []);
  const set = new Set();
  if (Array.isArray(list)) {
    for (const h of list) {
      const iso = typeof h === "string" ? h : h?.date;
      const norm = toISO(iso);
      if (norm) set.add(norm);
    }
  }
  return set;
}

// Count weekdays inclusive, excluding public holidays (weekends excluded already)
const weekdayCountInclusive = (startISO, endISO, holidaySet = new Set()) => {
  if (!startISO || !endISO) return 0;

  const s = parseISOToLocal(startISO);
  const e = parseISOToLocal(endISO);
  if (!s || !e) return 0;
  if (s > e) return 0;

  let c = 0;
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());

  while (cur <= e) {
    const iso = toISOLocalDate(cur);
    const dow = cur.getDay();
    const weekend = dow === 0 || dow === 6;
    const holiday = holidaySet.has(iso);

    if (!weekend && !holiday) c++;
    cur.setDate(cur.getDate() + 1);
  }
  return c;
};

// Next workday AFTER end date, skipping weekends + public holidays
function nextWorkdayAfter(endISO, holidaySet = new Set()) {
  const e = parseISOToLocal(endISO);
  if (!e) return "";
  const cur = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  cur.setDate(cur.getDate() + 1);

  while (true) {
    const iso = toISOLocalDate(cur);
    const weekend = isWeekendISO(iso);
    const holiday = holidaySet.has(iso);

    if (!weekend && !holiday) return iso;
    cur.setDate(cur.getDate() + 1);
  }
}

// --- shared core builders so aliases stay in sync ---
function buildNewRequest(body) {
  const nowIso = new Date().toISOString();

  if (!body.userId || !body.userName || !body.section) {
    return { error: "userId, userName, section required" };
  }
  if (!["annual", "offDay"].includes(body.type)) {
    return { error: "type must be 'annual' or 'offDay'" };
  }
  if (!["local", "overseas"].includes(body.localOrOverseas)) {
    return { error: "localOrOverseas must be 'local' or 'overseas'" };
  }

  const startISO = toISO(body.startDate);
  const endISO = toISO(body.endDate);

  // --- allocations (submitted from the form) ---
  const num = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const half = (n) => Math.round(num(n, 0) * 2) / 2;

  // Accept several shapes from client (current + legacy)
  const submittedAnnual =
    body?.allocations && body.allocations.annual !== undefined
      ? body.allocations.annual
      : body?.annualAlloc ?? body?.annualLeaveAlloc ?? body?.annualLeaveUsed ?? undefined;

  const submittedOff =
    body?.allocations && body.allocations.off !== undefined
      ? body.allocations.off
      : body?.offAlloc ?? body?.offDaysAlloc ?? body?.offDaysUsed ?? undefined;

  const A = half(submittedAnnual ?? 0);
  const O = half(submittedOff ?? 0);
  const hasSplit = A > 0 || O > 0;

  // Prefer explicit requested total:
  // 1) allocations total (most accurate)
  // 2) body.totalWeekdays / body.requestedDays from client
  // 3) body.days
  // 4) compute from dates
  let days = hasSplit ? half(A + O) : num(body.days, 0);
  if (!(days > 0)) days = half(num(body.totalWeekdays, 0));
  if (!(days > 0)) days = half(num(body.requestedDays, 0));
  if (!(days > 0)) days = weekdayCountInclusive(startISO, endISO);

  if (!Number.isFinite(days) || days <= 0) {
    return {
      error:
        "days must be a positive number (or provide valid startDate/endDate)",
    };
  }

  const id = body.id || Date.now().toString();

  // Accept resume field from either key
  const holidaySet = loadHolidaySet();

  // Accept resume field from either key; if missing, compute it from end date
  let resumeISO = toISO(body.resumeWorkOn) || toISO(body.resumeOn) || "";

  // ✅ Universal: resumeOn must skip weekends + public holidays
  if (!resumeISO && endISO) {
    resumeISO = nextWorkdayAfter(endISO, holidaySet);
  }

  return {
    id,
    userId: body.userId,
    userName: body.userName,
    section: body.section,
    type: body.type,
    localOrOverseas: body.localOrOverseas,

    startDate: startISO || undefined,
    endDate: endISO || undefined,
    resumeOn: resumeISO || undefined,

    // ✅ store totals + the split that your UI wants to show
    days: half(days),
    allocations: { annual: A, off: O },

    reason: body.reason || "",
    status: "pending",
    createdAt: nowIso,
    decidedAt: null,
    decidedBy: null,

    // Keep compatibility if client sends them
    requestedDays:
      Number.isFinite(+body.totalWeekdays)
        ? +body.totalWeekdays
        : Number.isFinite(+body.requestedDays)
          ? +body.requestedDays
          : undefined,

    // keep half-day meta if client sends it (you do)
    halfDayStart: body.halfDayStart || undefined,
    halfDayEnd: body.halfDayEnd || undefined,

    useOffDays: !!body.useOffDays,
  };
}

function approveAndDeduct(lr, patchBody) {
  // ✅ Idempotency guard:
  // If this leave request was already applied once, DO NOT deduct again.
  if (lr?.applied === true || typeof lr?.appliedAt === "string") {
    return {
      appliedAnnual: Number.isFinite(+lr.appliedAnnual) ? +lr.appliedAnnual : 0,
      appliedOff: Number.isFinite(+lr.appliedOff) ? +lr.appliedOff : 0,
      alreadyApplied: true,
    };
  }

  const users = readJSON(USERS_FILE, []);
  const uIdx = findUserIndex(users, lr.userId);
  if (uIdx === -1) {
    return { error: "user not found for balance deduction" };
  }

  const current = getBalances(users[uIdx]);

  const num = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const half = (n) => Math.round(num(n, 0) * 2) / 2;

  const fallbackAnnual = half(lr?.allocations?.annual ?? 0);
  const fallbackOff = half(lr?.allocations?.off ?? 0);

  const annToDeduct =
    Number.isFinite(+patchBody.appliedAnnual)
      ? half(+patchBody.appliedAnnual)
      : fallbackAnnual > 0
        ? fallbackAnnual
        : lr.type === "annual"
          ? half(lr.days || 0)
          : 0;

  const offToDeduct =
    Number.isFinite(+patchBody.appliedOff)
      ? half(+patchBody.appliedOff)
      : fallbackOff > 0
        ? fallbackOff
        : lr.type === "offDay"
          ? half(lr.days || 0)
          : 0;

  current.annualLeave = clamp(current.annualLeave - annToDeduct, 0, 42);
  current.offDays = Math.max(0, current.offDays - offToDeduct);

  users[uIdx] = setBalances(users[uIdx], current);
  writeJSON(USERS_FILE, users);

  return {
    appliedAnnual: annToDeduct,
    appliedOff: offToDeduct,
    alreadyApplied: false,
  };
}

// -------------- Leave Requests --------------
// Core GET handler (status|userId) + legacy name filter (?mine=Name)
function handleList(req, res) {
  const { status, userId, mine } = req.query;
  const all = readJSON(LEAVE_FILE, []);
  let out = all;

  if (status) out = out.filter((x) => x.status === status);
  if (userId) out = out.filter((x) => String(x.userId) === String(userId));
  if (mine) {
    const q = String(mine).toLowerCase().trim();
    out = out.filter((x) =>
      String(x.userName || "").toLowerCase().includes(q)
    );
  }
  res.json(out);
}

// Core POST handler
function handleCreate(req, res) {
  const body = req.body || {};
  const built = buildNewRequest(body);
  if (built?.error) return res.status(400).json({ error: built.error });

  const all = readJSON(LEAVE_FILE, []);
  all.push(built);
  writeJSON(LEAVE_FILE, all);
  res.status(201).json(built);
}

// Core PATCH handler
function handlePatch(req, res) {
  const { id } = req.params;
  const body = req.body || {};

  const all = readJSON(LEAVE_FILE, []);
  const idx = all.findIndex((x) => String(x.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "leave request not found" });

  const lr = all[idx];
  const nowIso = new Date().toISOString();

   // ======================================================
  // ✅ MODIFY / CANCEL APPROVED LEAVE
  // ======================================================
  if (body.action === "modify") {
    if (lr.status !== "approved") {
      return res
        .status(409)
        .json({ error: "only approved leave can be modified" });
    }

    // Half-day safe numeric
    const num = (v, fb = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };
    const toHalf = (n, fb = 0) => Math.round(num(n, fb) * 2) / 2;

    const users = readJSON(USERS_FILE, []);
    const uIdx = findUserIndex(users, lr.userId);
    if (uIdx === -1) {
      return res.status(404).json({ error: "user not found" });
    }

    const holidaySet = loadHolidaySet();
    const current = getBalances(users[uIdx]);

    // Original applied split (must preserve halves)
    const origA = toHalf(lr.appliedAnnual ?? 0, 0);
    const origO = toHalf(lr.appliedOff ?? 0, 0);

    // ==================================================
    // EDIT MODE
    // ==================================================
    if (body.mode === "edit") {
      // ✅ Reverse original applied totals (so we can re-apply new totals cleanly)
      current.annualLeave = clamp(current.annualLeave + origA, 0, 42);
      current.offDays = Math.max(0, current.offDays + origO);

      const newA = toHalf(body.newAppliedAnnual ?? 0, 0);
      const newO = toHalf(body.newAppliedOff ?? 0, 0);

      current.annualLeave = clamp(current.annualLeave - newA, 0, 42);
      current.offDays = Math.max(0, current.offDays - newO);

      users[uIdx] = setBalances(users[uIdx], current);
      writeJSON(USERS_FILE, users);

      const nextStart = toISO(body.newStartDate ?? lr.startDate);
      const nextEnd = toISO(body.newEndDate ?? lr.endDate);

      // ✅ Always recompute resumeOn from the (possibly changed) end date
      const nextResume = nextEnd
        ? nextWorkdayAfter(nextEnd, holidaySet)
        : lr.resumeOn ?? undefined;

      all[idx] = {
        ...lr,
        startDate: nextStart || lr.startDate,
        endDate: nextEnd || lr.endDate,
        resumeOn: nextResume || lr.resumeOn,

        // keep half day totals if provided
        days:
          body.newTotalDays !== undefined ? toHalf(body.newTotalDays, lr.days) : lr.days,

        // ✅ store NEW applied totals (half-safe)
        appliedAnnual: newA,
        appliedOff: newO,

        lastEditedAt: nowIso,
        lastEditedById: body.editedById ?? null,
        lastEditedByName: body.editedByName ?? "Admin",
        editNote: body.editNote || "",
      };

      writeJSON(LEAVE_FILE, all);
      return res.json(all[idx]);
    }

    // ==================================================
    // CANCEL MODE
    // ==================================================
    if (body.mode === "cancel") {
      // Prevent double-cancel / double-refund
      if (String(lr.status || "").toLowerCase() === "cancelled") {
        return res
          .status(409)
          .json({ error: "leave request already cancelled" });
      }

      // ✅ IMPORTANT:
      // Cancel should NOT reverse original + add refund (that double-credits).
      // The request was already deducted on approval; cancellation refunds ONLY the unused portion.
      const refundA = toHalf(body.refundAnnual ?? 0, 0);
      const refundO = toHalf(body.refundOff ?? 0, 0);

      // ✅ NEW: Enforce "no swapping buckets / no stealing"
      // Refunds must not exceed what was originally deducted from each bucket.
      if (refundA > origA || refundO > origO) {
        const problems = [];
        if (refundA > origA) problems.push(`refundAnnual (${refundA}) exceeds appliedAnnual (${origA})`);
        if (refundO > origO) problems.push(`refundOff (${refundO}) exceeds appliedOff (${origO})`);

        return res.status(400).json({
          error:
            "Invalid refund split: refunds must return to the same bucket originally deducted.",
          details: problems,
        });
      }

      // Extra safety: prevent any over-refund beyond total applied
      const maxRefund = toHalf(origA + origO, 0);
      if (toHalf(refundA + refundO, 0) > maxRefund) {
        return res.status(400).json({
          error: "Invalid refund: refund exceeds total applied days.",
        });
      }

      current.annualLeave = clamp(current.annualLeave + refundA, 0, 42);
      current.offDays = Math.max(0, current.offDays + refundO);

      users[uIdx] = setBalances(users[uIdx], current);
      writeJSON(USERS_FILE, users);

      // If admin didn't provide a return date, compute it from the leave end date
      const computedReturn = lr?.endDate
        ? nextWorkdayAfter(toISO(lr.endDate), holidaySet)
        : null;

      all[idx] = {
        ...lr,
        status: "cancelled",
        cancelledAt: nowIso,
        cancelledReturnDate: toISO(body.cancelReturnDate) || computedReturn,

        refundedAnnual: refundA,
        refundedOff: refundO,

        lastEditedAt: nowIso,
        lastEditedById: body.editedById ?? null,
        lastEditedByName: body.editedByName ?? "Admin",
        editNote: body.editNote || "",
      };

      writeJSON(LEAVE_FILE, all);
      return res.json(all[idx]);
    }

    return res.status(400).json({ error: "invalid modify mode" });
  }

  // ======================================================
  // ORIGINAL APPROVE / DENY FLOW (UNCHANGED)
  // ======================================================
  const {
    status,
    decidedBy,
    approverId,
    approverName,
    decisionNote,
    appliedAnnual,
    appliedOff,
  } = body;

  if (!["approved", "denied"].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved' or 'denied'" });
  }

  if ((lr.status || "pending") !== "pending") {
    return res.status(409).json({ error: `cannot change status of ${lr.status} request` });
  }

  if (status === "approved") {
    const result = approveAndDeduct(lr, { appliedAnnual, appliedOff });
    if (result?.error) return res.status(409).json({ error: result.error });

    lr.appliedAnnual = result.appliedAnnual;
    lr.appliedOff = result.appliedOff;
    lr.applied = true;
    lr.appliedAt = nowIso;
    lr.appliedBy = decidedBy || approverName || "system";
    lr.appliedById = approverId ?? null;
  }

  all[idx] = {
    ...lr,
    status,
    decidedAt: nowIso,
    decidedBy: decidedBy || approverName || "system",
    approverId: approverId ?? lr.approverId ?? null,
    approverName: approverName ?? lr.approverName ?? null,
    decisionNote: typeof decisionNote === "string" ? decisionNote : lr.decisionNote,
  };

  writeJSON(LEAVE_FILE, all);
  res.json(all[idx]);
}

// ---- Modern endpoints ----
router.get("/", handleList);
router.post("/", handleCreate);
router.patch("/:id", handlePatch);

// ---- Legacy-compatible aliases (/leave/requests etc.) ----
router.get("/requests", handleList);
router.post("/requests", handleCreate);
router.patch("/requests/:id", handlePatch);

// -------------- Balances (Admin/UI) --------------
router.get("/balances/:userId", (req, res) => {
  const { userId } = req.params;
  const users = readJSON(USERS_FILE, []);
  const idx = findUserIndex(users, userId);
  if (idx === -1) return res.status(404).json({ error: "user not found" });

  const { annualLeave, offDays } = getBalances(users[idx]);
  res.json({
    userId: String(users[idx].id),
    // new fields
    annualLeave,
    offDays,
    // legacy fields
    leaveBalance: annualLeave,
    offDayBalance: offDays,
  });
});

router.get("/balances", (req, res) => {
  try {
    const users = readJSON(USERS_FILE, []);
    const out = users
      .filter((u) => u && u.name !== "Admin")
      .map((u) => {
        const { annualLeave, offDays } = getBalances(u);
        return {
          userId: String(u.id),
          name: u.name,
          annualLeave,
          offDays,
          leaveBalance: annualLeave,
          offDayBalance: offDays,
        };
      });
    res.json(out);
  } catch {
    res.status(500).json({ error: "Failed to read users" });
  }
});

router.patch("/balances/:userId", (req, res) => {
  const { userId } = req.params;
  const body = req.body || {};

  const users = readJSON(USERS_FILE, []);
  const idx = findUserIndex(users, userId);
  if (idx === -1) return res.status(404).json({ error: "user not found" });

  const current = getBalances(users[idx]);

  const nextAnnual =
    body.annualLeave !== undefined
      ? body.annualLeave
      : body.leaveBalance !== undefined
        ? body.leaveBalance
        : current.annualLeave;

  const nextOff =
    body.offDays !== undefined
      ? body.offDays
      : body.offDayBalance !== undefined
        ? body.offDayBalance
        : current.offDays;

  const updated = {
    annualLeave: clamp(toInt(nextAnnual, current.annualLeave), 0, 42),
    offDays: Math.max(0, toInt(nextOff, current.offDays)),
  };

  users[idx] = setBalances(users[idx], updated);
  writeJSON(USERS_FILE, users);

  res.json({
    userId: String(users[idx].id),
    annualLeave: users[idx].annualLeave,
    offDays: users[idx].offDays,
    leaveBalance: users[idx].leaveBalance,
    offDayBalance: users[idx].offDayBalance,
  });
});

export default router;
