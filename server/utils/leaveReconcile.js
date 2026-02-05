// src/utils/leaveReconcile.js

const pad2 = (n) => String(n).padStart(2, "0");

// Local-safe ISO date string (YYYY-MM-DD)
export const toISOLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Parse YYYY-MM-DD as LOCAL date (prevents UTC drift)
export const parseISOToLocal = (iso) => {
  if (!iso || typeof iso !== "string") return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export const iso = (v) => {
  if (v === undefined || v === null || v === "") return "";

  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const [yyyy, mm, dd] = s.split("-").map(Number);
      const d = new Date(yyyy, mm - 1, dd);
      return Number.isNaN(d.getTime()) ? "" : toISOLocal(d);
    }
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      const [yyyy, mm, dd] = s.split("/").map(Number);
      const d = new Date(yyyy, mm - 1, dd);
      return Number.isNaN(d.getTime()) ? "" : toISOLocal(d);
    }
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      const d = new Date(yyyy, mm - 1, dd);
      return Number.isNaN(d.getTime()) ? "" : toISOLocal(d);
    }
  }

  if (v instanceof Date && !Number.isNaN(v.getTime())) return toISOLocal(v);

  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
    const num = Number(v);
    const epochMs = num > 1e12 ? num : num * 1000;
    const d = new Date(epochMs);
    return Number.isNaN(d.getTime()) ? "" : toISOLocal(d);
  }

  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : toISOLocal(d);
};

// half-day safe numeric
export const toHalf = (v, fb = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.round(n * 2) / 2;
};

// Workdays Mon–Fri, excluding public holidays (YYYY-MM-DD list)
export const workdaysBetweenInclusive = (startISO, endISO, publicHolidays = []) => {
  const s = parseISOToLocal(startISO);
  const e = parseISOToLocal(endISO);
  if (!s || !e || e < s) return 0;

  const holidaySet = new Set((publicHolidays || []).filter(Boolean));
  let count = 0;
  const cur = new Date(s);
  cur.setHours(0, 0, 0, 0);

  while (cur <= e) {
    const dow = cur.getDay(); // 0 Sun..6 Sat
    const curISO = toISOLocal(cur);
    const isWeekday = dow >= 1 && dow <= 5;
    const isHoliday = holidaySet.has(curISO);
    if (isWeekday && !isHoliday) count++;
    cur.setDate(cur.getDate() + 1);
  }

  return count;
};

// Add N workdays to a date ISO (skips weekends + holidays). N can be 0.
export const addWorkdaysISO = (startISO, workdaysToAdd, publicHolidays = []) => {
  const start = parseISOToLocal(startISO);
  if (!start) return "";
  const holidaySet = new Set((publicHolidays || []).filter(Boolean));

  let remaining = Math.max(0, Math.round(Number(workdaysToAdd) || 0));
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);

  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    const curISO = toISOLocal(cur);
    const isWeekday = dow >= 1 && dow <= 5;
    const isHoliday = holidaySet.has(curISO);
    if (isWeekday && !isHoliday) remaining--;
  }

  return toISOLocal(cur);
};

// Given endISO and required workday total, compute a new end date that matches selected days.
// Uses start date as base.
export const endDateForWorkdayCount = (startISO, desiredWorkdays, publicHolidays = []) => {
  const start = parseISOToLocal(startISO);
  if (!start) return "";
  const desired = Math.max(0, Math.round(Number(desiredWorkdays) || 0));
  if (desired <= 1) return startISO; // 1 workday => same day

  // Need to find the date where inclusive workdays == desired
  // We can do this by moving forward adding (desired-1) workdays,
  // but must ensure the start day itself is a workday (if it's weekend/holiday, count starts when first workday occurs).
  // For simplicity: walk forward until we counted desired workdays inclusive.
  const holidaySet = new Set((publicHolidays || []).filter(Boolean));
  let counted = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);

  while (counted < desired) {
    const dow = cur.getDay();
    const curISO = toISOLocal(cur);
    const isWeekday = dow >= 1 && dow <= 5;
    const isHoliday = holidaySet.has(curISO);
    if (isWeekday && !isHoliday) counted++;
    if (counted < desired) cur.setDate(cur.getDate() + 1);
  }

  return toISOLocal(cur);
};

// Reconcile selected allocations vs required workdays
export const reconcile = ({ startISO, endISO, annualDays, offDays, publicHolidays = [] }) => {
  const required = workdaysBetweenInclusive(startISO, endISO, publicHolidays);
  const a = Math.max(0, toHalf(annualDays, 0));
  const o = Math.max(0, toHalf(offDays, 0));
  const selected = toHalf(a + o, 0);
  const mismatch = toHalf(selected - required, 0); // + too many, - too few

  return { required, selected, mismatch, annual: a, off: o };
};
