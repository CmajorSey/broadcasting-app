// src/utils/leaveDates.js
// Universal leave date helpers (weekend + public holiday aware)
// NOTE: Always parse YYYY-MM-DD as LOCAL date to avoid UTC drift.

const pad2 = (n) => String(n).padStart(2, "0");

// Parse "YYYY-MM-DD" to a local Date (no UTC drift)
export function parseISOToLocal(dateISO) {
  if (!dateISO || typeof dateISO !== "string") return null;
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function toISODateLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isWeekend(dateISO) {
  const d = parseISOToLocal(dateISO);
  if (!d) return false;
  const day = d.getDay(); // 0 Sun ... 6 Sat (LOCAL)
  return day === 0 || day === 6;
}

/**
 * Returns the next workday AFTER `dateISO`, skipping:
 * - Saturdays + Sundays
 * - any date that exists in `publicHolidays` (YYYY-MM-DD strings)
 *
 * IMPORTANT: Pass holidays as ["YYYY-MM-DD", ...]
 * If you pass [], public holidays will NOT be skipped.
 */
export function nextWorkdayISO(dateISO, publicHolidays = []) {
  if (!dateISO) return "";

  const base = parseISOToLocal(dateISO);
  if (!base) return "";

  const holidaySet = new Set(Array.isArray(publicHolidays) ? publicHolidays : []);

  // start from the NEXT day
  const cur = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  cur.setDate(cur.getDate() + 1);

  // keep moving forward while weekend OR holiday
  while (true) {
    const iso = toISODateLocal(cur);
    if (!iso) return "";

    if (!isWeekend(iso) && !holidaySet.has(iso)) {
      return iso;
    }

    cur.setDate(cur.getDate() + 1);
  }
}
