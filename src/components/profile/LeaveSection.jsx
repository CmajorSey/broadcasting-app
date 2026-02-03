// src/components/profile/LeaveSection.jsx
import { useEffect, useMemo, useState } from "react";
import API_BASE from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

// ---------- Helpers ----------
const safeStr = (v) => (typeof v === "string" ? v.trim() : "");
const toISO = (d) => {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const parseNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

// Count weekdays between two ISO dates inclusive (Mon–Fri)
function weekdayCountInclusive(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (start > end) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Apply weighting rules to a date span (basic v1; server is source of truth)
function weightedDaysBetween(startISO, endISO, rules) {
  return weekdayCountInclusive(startISO, endISO);
}

// ---------- Component ----------
export default function LeaveSection({ user }) {
  const { toast } = useToast();

  // Settings disclaimer (admin editable later)
  const [leaveDisclaimer, setLeaveDisclaimer] = useState(
    "It is recommended to apply for leave at least two weeks in advance to support planning and coverage."
  );

  // User balances (read-only here; admins edit in Leave Manager)
  const annualBalance = parseNum(user?.annualLeave ?? user?.balances?.annualLeave, 0);
  const offBalance = parseNum(user?.offDays ?? user?.balances?.offDays, 0);

  // Form state
  const [localOrOverseas, setLocalOrOverseas] = useState("local"); // "local" | "overseas"
  const [startDate, setStartDate] = useState(""); // YYYY-MM-DD
  const [endDate, setEndDate] = useState(""); // YYYY-MM-DD
  const [reason, setReason] = useState("");
  const [useOffDays, setUseOffDays] = useState(false); // false => annual, true => off-days
  const [submitting, setSubmitting] = useState(false);

  // Derived
  const [rules, setRules] = useState({
    halfDayAfter4PM: true,
    after4pmCounts: 0.5,
    saturdayCounts: 1,
    sundayCounts: 1,
    publicHolidayCounts: 1,
  });

  const totalRequested = useMemo(() => {
    return weightedDaysBetween(startDate, endDate, rules);
  }, [startDate, endDate, rules]);

  // History (user-scoped)
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch settings (for disclaimer/rules) + my history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sRes = await fetch(`${API_BASE}/settings`).catch(() => null);
        if (sRes && sRes.ok) {
          const s = await sRes.json();
          if (!cancelled) {
            const maybeDisclaimer =
              s?.leaveDisclaimer ||
              s?.rules?.leaveDisclaimer ||
              s?.site?.leaveDisclaimer;
            if (safeStr(maybeDisclaimer)) setLeaveDisclaimer(maybeDisclaimer);
            const r = s?.rules || {};
            setRules((old) => ({
              ...old,
              halfDayAfter4PM: typeof r.halfDayAfter4PM === "boolean" ? r.halfDayAfter4PM : old.halfDayAfter4PM,
              after4pmCounts: Number.isFinite(+r.after4pmCounts) ? +r.after4pmCounts : old.after4pmCounts,
              saturdayCounts: Number.isFinite(+r.saturdayCounts) ? +r.saturdayCounts : old.saturdayCounts,
              sundayCounts: Number.isFinite(+r.sundayCounts) ? +r.sundayCounts : old.sundayCounts,
              publicHolidayCounts: Number.isFinite(+r.publicHolidayCounts) ? +r.publicHolidayCounts : old.publicHolidayCounts,
            }));
          }
        }
      } catch {}

      // History (this user) — align with server: /leave-requests?userId=
      try {
        setLoading(true);
        const uid = user?.id || user?._id;
        const url = uid ? `${API_BASE}/leave-requests?userId=${encodeURIComponent(String(uid))}` : `${API_BASE}/leave-requests`;
        const res = await fetch(url);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setMyRequests(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Compute before/after balances per row.
  const computedHistory = useMemo(() => {
    const rows = [...myRequests].sort((a, b) => {
      const at = +new Date(a?.createdAt || a?.submittedAt || a?.startDate || 0);
      const bt = +new Date(b?.createdAt || b?.submittedAt || b?.startDate || 0);
      return at - bt;
    });

    let ann = annualBalance;
    let off = offBalance;

    const derived = rows.map((r) => {
      const hasSnapshots =
        Number.isFinite(+r.annualBefore) ||
        Number.isFinite(+r.annualAfter) ||
        Number.isFinite(+r.offBefore) ||
        Number.isFinite(+r.offAfter);

      if (hasSnapshots) {
        return {
          ...r,
          annualBefore: r.annualBefore,
          annualAfter: r.annualAfter,
          offBefore: r.offBefore,
          offAfter: r.offAfter,
        };
      }

      const requested = Number.isFinite(+r.requestedDays)
        ? +r.requestedDays
        : (Number.isFinite(+r.days) ? +r.days : weightedDaysBetween(r.startDate, r.endDate, rules));

      if (r.status === "approved") {
        if (r.type === "offDay" || r.useOffDays) {
          const before = off;
          const after = clamp(off - requested, 0, 9999);
          off = after;
          return { ...r, offBefore: before, offAfter: after };
        } else {
          const before = ann;
          const after = clamp(ann - requested, 0, 9999);
          ann = after;
          return { ...r, annualBefore: before, annualAfter: after };
        }
      }

      return r;
    });

    return derived.sort((a, b) => {
      const at = +new Date(a?.createdAt || a?.submittedAt || a?.startDate || 0);
      const bt = +new Date(b?.createdAt || b?.submittedAt || b?.startDate || 0);
      return bt - at;
    });
  }, [myRequests, annualBalance, offBalance, rules]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (!user?.name) {
      toast({
        title: "No user",
        description: "You must be logged in to submit a leave request.",
        variant: "destructive",
      });
      return;
    }

    if (!startDate || !endDate) {
      toast({
        title: "Missing dates",
        description: "Choose a start and end date.",
        variant: "destructive",
      });
      return;
    }

    const startISO = toISO(startDate);
    const endISO = toISO(endDate);
    const requestedDays = weightedDaysBetween(startISO, endISO, rules);
    if (requestedDays <= 0) {
      toast({
        title: "Invalid range",
        description: "Your date range has no countable days.",
        variant: "destructive",
      });
      return;
    }

    // Map UI boolean to backend enum
    const type = useOffDays ? "offDay" : "annual";

    setSubmitting(true);
    try {
      const payload = {
        id: Date.now().toString(),
        userName: user.name,
        userId: user.id || user._id || undefined,
        section: user.section || user.department || "Unknown",

        // trip info
        localOrOverseas, // kept for your UI/records

        // required by backend
        type, // <- "annual" | "offDay"

        // date range + reason
        startDate: startISO,
        endDate: endISO,
        reason: safeStr(reason),

        // compatibility flags (ok to keep)
        useOffDays,

        // counts + status
        requestedDays,
        days: requestedDays, // server expects `days`; we also send dates
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      const res = await fetch(`${API_BASE}/leave-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let serverMsg = "Submit failed";
        try {
          const errJson = await res.json();
          if (errJson?.error) serverMsg = errJson.error;
        } catch {}
        throw new Error(serverMsg);
      }

      toast({
        title: "Leave request sent",
        description: `Requested ${requestedDays} day(s) from ${startISO} to ${endISO}.`,
      });

      // Refresh my history (by userId)
      const uid = user?.id || user?._id;
      const listUrl = uid ? `${API_BASE}/leave-requests?userId=${encodeURIComponent(String(uid))}` : `${API_BASE}/leave-requests`;
      const list = await fetch(listUrl).then((r) => (r.ok ? r.json() : []));
      setMyRequests(Array.isArray(list) ? list : []);

      // Reset form
      setLocalOrOverseas("local");
      setStartDate("");
      setEndDate("");
      setReason("");
      setUseOffDays(false);
    } catch (err) {
      toast({
        title: "Could not submit",
        description: String(err?.message || err) || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Leave</CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {/* Apply for Leave */}
          <AccordionItem value="apply">
            <AccordionTrigger>Apply for Leave</AccordionTrigger>
            <AccordionContent>
              <div className="rounded-md border p-4 mb-4 bg-muted/30">
                <p className="text-sm leading-relaxed">{leaveDisclaimer}</p>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Trip Type</Label>
                  <div className="flex gap-3 mt-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="trip"
                        value="local"
                        checked={localOrOverseas === "local"}
                        onChange={() => setLocalOrOverseas("local")}
                      />
                      <span>Local</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="trip"
                        value="overseas"
                        checked={localOrOverseas === "overseas"}
                        onChange={() => setLocalOrOverseas("overseas")}
                      />
                      <span>Overseas</span>
                    </label>
                  </div>
                </div>

                <div>
                  <Label>Use Off Days instead of Annual Leave</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      checked={useOffDays}
                      onChange={(e) => setUseOffDays(e.target.checked)}
                    />
                    <span className="text-sm text-muted-foreground">Tick to deduct from Off Days</span>
                  </div>
                </div>

                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>

                <div className="md:col-span-2">
                  <Label>Reason</Label>
                  <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>

                <div className="md:col-span-2 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Requested days (est.): <strong>{totalRequested}</strong>
                  </div>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit Request"}
                  </Button>
                </div>
              </form>
            </AccordionContent>
          </AccordionItem>

          {/* My Leave History */}
          <AccordionItem value="history">
            <AccordionTrigger>My Leave History</AccordionTrigger>
            <AccordionContent>
              <div className="overflow-auto border rounded-md">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Submitted</th>
                      <th className="text-left p-2">Dates</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Requested</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Annual Before → After</th>
                      <th className="text-left p-2">Off Before → After</th>
                      <th className="text-left p-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td className="p-3" colSpan={8}>Loading…</td></tr>
                    ) : computedHistory.length === 0 ? (
                      <tr><td className="p-3" colSpan={8}>No leave records yet.</td></tr>
                    ) : (
                      computedHistory.map((r) => {
                        const submitted = r.createdAt || r.submittedAt;
                        const reqDays = Number.isFinite(+r.requestedDays)
                          ? +r.requestedDays
                          : (Number.isFinite(+r.days) ? +r.days : weightedDaysBetween(r.startDate, r.endDate, rules));
                        const type = r.type === "offDay" || r.useOffDays ? "Off Days" : "Annual";
                        return (
                          <tr key={r.id}>
                            <td className="p-2 whitespace-nowrap">
                              {submitted ? new Date(submitted).toLocaleString() : "-"}
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {toISO(r.startDate)} → {toISO(r.endDate)}
                            </td>
                            <td className="p-2">{type}</td>
                            <td className="p-2">{reqDays}</td>
                            <td className="p-2 capitalize">{r.status || "-"}</td>
                            <td className="p-2">
                              {Number.isFinite(+r.annualBefore) || Number.isFinite(+r.annualAfter)
                                ? `${r.annualBefore ?? "-"} → ${r.annualAfter ?? "-"}`
                                : (Number.isFinite(+r.appliedAnnual) ? `-${r.appliedAnnual}` : "-")}
                            </td>
                            <td className="p-2">
                              {Number.isFinite(+r.offBefore) || Number.isFinite(+r.offAfter)
                                ? `${r.offBefore ?? "-"} → ${r.offAfter ?? "-"}`
                                : (Number.isFinite(+r.appliedOff) ? `-${r.appliedOff}` : "-")}
                            </td>
                            <td className="p-2 max-w-[24rem]">{r.reason || "-"}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                “Before/After” shows your balance snapshots or the approved deduction if snapshots weren’t saved.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
