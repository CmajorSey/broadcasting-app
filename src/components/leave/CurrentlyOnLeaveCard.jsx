import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * CurrentlyOnLeaveCard
 * - Hides itself when nobody is on leave now / or starting within the next N days
 * - Works with either:
 *   A) leaveRequests array (preferred) with { status, startDate, endDate, userName/name, userId, section, leaveType/type }
 *   B) users array that already contains derived leave info (less common)
 *
 * Props:
 * - leaveRequests: array
 * - title: optional string
 * - lookaheadDays: number (default 14)
 * - todayOverride: optional Date (useful for testing)
 */
export default function CurrentlyOnLeaveCard({
  leaveRequests = [],
  title = "Currently on leave",
  lookaheadDays = 14,
  todayOverride = null,
}) {
  const rows = useMemo(() => {
    const today = todayOverride ? new Date(todayOverride) : new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endWindow = new Date(startOfToday);
    endWindow.setDate(endWindow.getDate() + lookaheadDays);

    const normalizeDate = (v) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    };

    const normalizeStatus = (s) => String(s || "").trim().toLowerCase();

    // Treat these as "approved/active" unless your backend uses different wording.
    // If your system is stricter (only "approved"), we can tighten this later.
    const isAllowedStatus = (status) => {
      const st = normalizeStatus(status);
      if (!st) return true; // fallback: if no status field exists, assume valid
      return !["rejected", "declined", "cancelled", "canceled", "deleted"].includes(st);
    };

    const isInRange = (start, end) => {
      // Show if:
      // - currently on leave: start <= today <= end
      // - OR starting within next N days: today <= start <= windowEnd
      if (!start || !end) return false;

      const currently = start <= startOfToday && end >= startOfToday;
      const upcoming = start >= startOfToday && start <= endWindow;
      return currently || upcoming;
    };

    // Turn leaveRequests into display rows
    const mapped = (leaveRequests || [])
      .filter((lr) => isAllowedStatus(lr.status))
      .map((lr) => {
        const start = normalizeDate(lr.startDate || lr.from || lr.start || lr.dateFrom);
        const end = normalizeDate(lr.endDate || lr.to || lr.end || lr.dateTo);

        const name =
          lr.userName ||
          lr.name ||
          lr.requestedBy ||
          lr.createdBy ||
          lr.employeeName ||
          "Unknown";

        const section = lr.section || lr.department || "";
        const leaveType = lr.leaveType || lr.type || lr.category || "";

        return {
          id: lr.id || lr._id || `${name}-${lr.startDate}-${lr.endDate}`,
          name,
          section,
          leaveType,
          start,
          end,
        };
      })
      .filter((r) => isInRange(r.start, r.end))
      .sort((a, b) => (a.start?.getTime?.() || 0) - (b.start?.getTime?.() || 0));

    return mapped;
  }, [leaveRequests, lookaheadDays, todayOverride]);

  // ✅ Disappear when nobody is on leave / upcoming
  if (!rows.length) return null;

  const fmt = (d) =>
    d
      ? d.toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
        })
      : "";

  const isNow = (start, end) => {
    const today = new Date();
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const s = start ? start.getTime() : 0;
    const e = end ? end.getTime() : 0;
    return s <= t && e >= t;
  };

  return (
    <Card className="border border-muted-foreground/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-2">
        {rows.map((r) => {
          const now = isNow(r.start, r.end);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/10 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{r.name}</span>
                  {r.section ? (
                    <Badge variant="secondary" className="h-5">
                      {r.section}
                    </Badge>
                  ) : null}
                  {r.leaveType ? (
                    <Badge variant="outline" className="h-5">
                      {r.leaveType}
                    </Badge>
                  ) : null}
                  {now ? (
                    <Badge className="h-5">On Leave</Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5">
                      Upcoming
                    </Badge>
                  )}
                </div>

                <div className="text-xs text-muted-foreground mt-1">
                  {fmt(r.start)} → {fmt(r.end)}
                </div>
              </div>

              {/* Right side could hold an icon later */}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
