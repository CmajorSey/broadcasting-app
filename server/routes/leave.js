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

// ----------------- Date helpers -----------------
const toISO = (d) => {
  if (!d && d !== 0) return "";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};

const weekdayCountInclusive = (startISO, endISO) => {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (s > e) return 0;

  let c = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) c++;
    cur.setDate(cur.getDate() + 1);
  }
  return c;
};

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
  const resumeISO = toISO(body.resumeWorkOn) || toISO(body.resumeOn) || "";

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
      return res.status(409).json({ error: "only approved leave can be modified" });
    }

    const users = readJSON(USERS_FILE, []);
    const uIdx = findUserIndex(users, lr.userId);
    if (uIdx === -1) {
      return res.status(404).json({ error: "user not found" });
    }

    const current = getBalances(users[uIdx]);

    // ---- REVERSE original applied amounts (idempotent safe) ----
    const origA = toInt(lr.appliedAnnual ?? 0, 0);
    const origO = toInt(lr.appliedOff ?? 0, 0);

    current.annualLeave = clamp(current.annualLeave + origA, 0, 42);
    current.offDays = Math.max(0, current.offDays + origO);

    // ==================================================
    // EDIT MODE
    // ==================================================
    if (body.mode === "edit") {
      const newA = toInt(body.newAppliedAnnual ?? 0, 0);
      const newO = toInt(body.newAppliedOff ?? 0, 0);

      current.annualLeave = clamp(current.annualLeave - newA, 0, 42);
      current.offDays = Math.max(0, current.offDays - newO);

      users[uIdx] = setBalances(users[uIdx], current);
      writeJSON(USERS_FILE, users);

      all[idx] = {
        ...lr,
        startDate: body.newStartDate ?? lr.startDate,
        endDate: body.newEndDate ?? lr.endDate,
        days: body.newTotalDays ?? lr.days,
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
      const refundA = toInt(body.refundAnnual ?? 0, 0);
      const refundO = toInt(body.refundOff ?? 0, 0);

      current.annualLeave = clamp(current.annualLeave + refundA, 0, 42);
      current.offDays = Math.max(0, current.offDays + refundO);

      users[uIdx] = setBalances(users[uIdx], current);
      writeJSON(USERS_FILE, users);

      all[idx] = {
        ...lr,
        status: "cancelled",
        cancelledAt: nowIso,
        cancelledReturnDate: body.cancelReturnDate ?? null,
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
