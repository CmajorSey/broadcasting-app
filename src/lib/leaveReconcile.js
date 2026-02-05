// src/lib/leaveReconcile.js

// NOTE:
// - This assumes "calendar days" inclusive.
// - If your project already has a "business day" / weekend skip rule,
//   replace dayCountInclusive() with your existing rule, but keep the API the same.

export function toISODate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export function dayCountInclusive(startISO, endISO) {
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  // normalize to midnight UTC-like by using date-only
  const sUTC = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const eUTC = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const diff = Math.floor((eUTC - sUTC) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

export function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

export function normalizeSplit(requiredDays, annualDays, offDays) {
  // force whole numbers and ensure split totals never exceed requiredDays
  let a = clamp(annualDays, 0, 9999);
  let o = clamp(offDays, 0, 9999);

  // If total exceeds required, reduce offDays first, then annualDays
  let total = a + o;
  if (total > requiredDays) {
    let over = total - requiredDays;
    const reduceOff = Math.min(o, over);
    o -= reduceOff;
    over -= reduceOff;
    const reduceAnnual = Math.min(a, over);
    a -= reduceAnnual;
  }

  return { annualDays: a, offDays: o, total: a + o };
}

export function leaveDiff(oldReq, nextReq) {
  // positive => take more from balance, negative => refund to balance
  const oldAnnual = clamp(oldReq?.annualDays ?? 0, 0, 9999);
  const oldOff = clamp(oldReq?.offDays ?? 0, 0, 9999);
  const nextAnnual = clamp(nextReq?.annualDays ?? 0, 0, 9999);
  const nextOff = clamp(nextReq?.offDays ?? 0, 0, 9999);

  return {
    annualDelta: nextAnnual - oldAnnual,
    offDelta: nextOff - oldOff,
  };
}

export function reconcileLeaveChange({ oldReq, startISO, endISO, annualDays, offDays }) {
  const required = dayCountInclusive(startISO, endISO);

  const split = normalizeSplit(required, annualDays, offDays);
  const selected = split.total;

  const mismatch = selected - required; // + means selected too many, - means too few

  // Decide what prompt to show (if any)
  // Caller will show a modal with options based on these flags.
  let prompt = null;

  if (required === 0) {
    prompt = {
      type: "invalid_range",
      message: "Your date range is invalid. End date must be same or after start date.",
      required,
      selected,
      mismatch,
    };
  } else if (mismatch !== 0) {
    if (mismatch < 0) {
      prompt = {
        type: "selected_too_few",
        message: `Your date range needs ${required} day(s), but you selected ${selected}.`,
        required,
        selected,
        mismatch,
      };
    } else {
      prompt = {
        type: "selected_too_many",
        message: `You selected ${selected} day(s), but the date range only needs ${required}.`,
        required,
        selected,
        mismatch,
      };
    }
  }

  const nextReq = {
    ...(oldReq || {}),
    startISO,
    endISO,
    annualDays: split.annualDays,
    offDays: split.offDays,
    totalDays: required, // keep explicit
  };

  const delta = leaveDiff(oldReq || { annualDays: 0, offDays: 0 }, nextReq);

  return {
    requiredDays: required,
    selectedDays: selected,
    mismatch,
    prompt,
    nextReq,
    delta,
  };
}
