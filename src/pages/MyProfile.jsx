import { useEffect, useMemo, useRef, useState } from "react";
import API_BASE from "@/api";
import { nextWorkdayISO } from "@/utils/leaveDates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { unlockSounds, setSoundEnabled as setSoundEnabledStorage } from "@/lib/soundRouter";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";

// 🔔 FCM (web push)
import { requestPermission } from "@/lib/firebase";


/** Single source of truth for Leave API endpoints */
const LEAVE_ENDPOINT = `${API_BASE}/leave-requests`;

// ✅ Balance helpers (match LeaveManager field fallbacks)
const getAnnualBalance = (u) => {
  if (!u) return 0;
  const raw =
    u.annualLeave ??
    u.balances?.annualLeave ??
    u.annualLeaveBalance ??
    u.annual ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const getOffBalance = (u) => {
  if (!u) return 0;
  const raw =
    u.offDays ??
    u.balances?.offDays ??
    u.offDayBalance ??
    u.off ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export default function MyProfile({
  loggedInUser,          // ✅ this is now the EFFECTIVE user from App (adminViewAs || loggedInUser)
  realLoggedInUser = null,
  adminViewAs = null,
}) {

  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [suggestion, setSuggestion] = useState("");
  const [toastEnabled, setToastEnabled] = useState(
    () => localStorage.getItem("notificationToastsEnabled") !== "false"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("notificationSoundsEnabled") !== "false"
  );

  // 🔔 Push notifications (FCM)
  const [pushEnabled, setPushEnabled] = useState(
    () => localStorage.getItem("notificationPushEnabled") === "true"
  );

  const makeNotifKey = (note) => {
    try {
      // ✅ Stable UTC key (seconds precision)
      return new Date(note.timestamp).toISOString().split(".")[0] + "Z";
    } catch {
      return `${note?.timestamp || ""}-${note?.title || ""}-${note?.message || ""}`;
    }
  };

  const syncUnreadCount = (nextList) => {
    try {
      const n = Array.isArray(nextList) ? nextList.length : 0;
      localStorage.setItem("loBoard.unreadCount", String(n));
      window.dispatchEvent(new CustomEvent("loBoard:unread"));
    } catch {
      // ignore
    }
  };

  const handleDismiss = (note) => {
    if (!note) return;

    const dismissed = JSON.parse(
      localStorage.getItem("dismissedNotifications") || "[]"
    );

    const key = makeNotifKey(note);
    if (!key) return;

    const updated = [...new Set([...dismissed, key])];
    localStorage.setItem("dismissedNotifications", JSON.stringify(updated));

    setNotifications((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((n) => makeNotifKey(n) !== key);
      syncUnreadCount(next);
      return next;
    });
  };

  // ✅ Leave half-day selectors used by the Leave Request card
  const [halfDayStart, setHalfDayStart] = useState("none"); // none | am | pm
  const [halfDayEnd, setHalfDayEnd] = useState("none"); // none | am | pm

  // ✅ Leave Request form state (required by your JSX + submitLeaveRequest)
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [localOrOverseas, setLocalOrOverseas] = useState("local"); // local | overseas
  const [reason, setReason] = useState("");

  const [annualAlloc, setAnnualAlloc] = useState(0);
  const [offAlloc, setOffAlloc] = useState(0);

  const [consumptionOrder, setConsumptionOrder] = useState("annual_first"); // annual_first | off_first
  const [leaveTermsAccepted, setLeaveTermsAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // ✅ Holidays + derived range info (used by UI + submit payload)
  const [publicHolidays, setPublicHolidays] = useState([]); // array of YYYY-MM-DD strings
  const [holidaysInRange, setHolidaysInRange] = useState([]); // subset of publicHolidays within start/end

  const [totalWeekdays, setTotalWeekdays] = useState(0);
  const [resumeOn, setResumeOn] = useState("");

  // ✅ My Requests state (pagination + filters + admin note expand)
  const [myRequests, setMyRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);

  const [myReqFilter, setMyReqFilter] = useState("current"); // current | all | approved | cancelled | denied | none
  const [myReqPage, setMyReqPage] = useState(1);
  const [myReqPerPage, setMyReqPerPage] = useState(() => {
    const raw = Number(localStorage.getItem("myProfile.requestsPerPage") || 6);
    return [4, 6, 8].includes(raw) ? raw : 6;
  });

  const [expandedRequestId, setExpandedRequestId] = useState(null);

  // ✅ Derived: requestedDays is used all over your Leave Request card
  const requestedDays = totalWeekdays;

  // ✅ Keep totals/holidays/resumeWorkOn in sync when dates or half-days change

  useEffect(() => {
    const s = startDate;
    const e = endDate;

    if (!s || !e) {
      setHolidaysInRange([]);
      setTotalWeekdays(0);
      setResumeOn("");
      return;
    }

    const parseISO = (iso) => {
      const [yy, mm, dd] = String(iso).split("-").map(Number);
      if (!yy || !mm || !dd) return null;
      const d = new Date(yy, mm - 1, dd);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const sd = parseISO(s);
    const ed = parseISO(e);
    if (!sd || !ed || sd > ed) {
      setHolidaysInRange([]);
      setTotalWeekdays(0);
      setResumeOn("");
      return;
    }

    const holidaySet = new Set(
      (Array.isArray(publicHolidays) ? publicHolidays : []).filter(Boolean)
    );

    // build holidaysInRange
    const inRange = [];
    for (const h of holidaySet) {
      const hd = parseISO(h);
      if (!hd) continue;
      if (hd >= sd && hd <= ed) inRange.push(h);
    }
    inRange.sort();
    setHolidaysInRange(inRange);

    // compute weekdays (Mon-Fri) excluding public holidays
    let count = 0;
    const cur = new Date(sd.getTime());
    while (cur <= ed) {
      const day = cur.getDay(); // 0 Sun .. 6 Sat
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(cur.getDate()).padStart(2, "0")}`;

      const isWeekend = day === 0 || day === 6;
      const isHoliday = holidaySet.has(iso);

      if (!isWeekend && !isHoliday) count += 1;

      cur.setDate(cur.getDate() + 1);
      cur.setHours(0, 0, 0, 0);
    }

    // apply half-day adjustments only if those endpoints are weekdays (not weekend/holiday)
    const isWorkdayISO = (iso) => {
      const d = parseISO(iso);
      if (!d) return false;
      const day = d.getDay();
      const isWeekend = day === 0 || day === 6;
      const isHoliday = holidaySet.has(iso);
      return !isWeekend && !isHoliday;
    };

    let adjusted = count;

    if (s && isWorkdayISO(s) && halfDayStart !== "none") adjusted -= 0.5;
    if (e && isWorkdayISO(e) && halfDayEnd !== "none") adjusted -= 0.5;

    if (!Number.isFinite(adjusted) || adjusted < 0) adjusted = 0;

    // round to .0/.5
    adjusted = Math.round(adjusted * 2) / 2;

    setTotalWeekdays(adjusted);

    // resume work day (next workday after endDate, skipping holidays/weekends)
    try {
      setResumeOn(nextWorkdayISO(e, publicHolidays));
    } catch {
      setResumeOn("");
    }
  }, [startDate, endDate, halfDayStart, halfDayEnd, publicHolidays]);

  const { toast } = useToast();

  // ============================================================
  // ✅ SINGLE SOURCE OF TRUTH: hydrate "user" whenever View-As changes
  // - If App passes an effective user, we set it immediately (no UI lag)
  // - Then we fetch the latest full user record from backend by id
  // ============================================================
  useEffect(() => {
    // Immediate UI fill (prevents N/A flashes)
    if (loggedInUser?.id) setUser(loggedInUser);
    else setUser(null);

    // Backend refresh (ensures balances/description/roles are latest)
    const run = async () => {
      try {
        if (!loggedInUser?.id) return;

        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(loggedInUser.id)}`);
        if (!res.ok) return;

        const fresh = await res.json().catch(() => null);
        if (fresh && fresh.id) setUser(fresh);
      } catch {
        // ignore (offline / network changed)
      }
    };

    run();
  }, [loggedInUser?.id]);

    // -----------------------------
  // Notification preferences (masters only)
  // -----------------------------
  // NOTE: Per-category prefs removed for now (future update)

  const getSection = (u = user) => {
    if (!u) return "N/A";
    const name = u.name || "";
    const desc = u.description?.toLowerCase() || "";

    if (
      ["clive camille", "jennifer arnephy", "gilmer philoe"].includes(
        name.toLowerCase()
      )
    ) {
      return "Admin";
    } else if (desc.includes("sports journalist")) {
      return "Sports Section";
    } else if (desc.includes("journalist")) {
      return "Newsroom";
    } else if (/cam ?op|camera ?operator|operations/i.test(desc)) {
      return "Operations";
    } else if (desc.includes("producer") || desc.includes("production")) {
      return "Production";
    }

    return u.section || "Unspecified";
  };
  // -----------------------------
  // Notifications Inbox (inbox-only: NO toast, NO sound)
  // -----------------------------
  const loadInboxNotifications = async () => {
    if (!user?.name) {
      setNotifications([]);
      try {
        localStorage.setItem("loBoard.unreadCount", "0");
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/notifications`);
      if (!res.ok) throw new Error("Failed to load notifications");

      const all = await res.json().catch(() => []);
      const list = Array.isArray(all) ? all : [];

      // Only notifications addressed to THIS user (by name)
      const mine = list.filter((n) => {
        const rec = n?.recipients;
        if (!Array.isArray(rec)) return false;
        return rec.includes(user.name);
      });

      // Apply dismiss filter (stable keys)
      const dismissedRaw =
        JSON.parse(localStorage.getItem("dismissedNotifications") || "[]") || [];
      const dismissed = new Set(
        Array.isArray(dismissedRaw) ? dismissedRaw.filter(Boolean) : []
      );

      const visible = mine
        .filter((n) => !dismissed.has(makeNotifKey(n)))
        .sort((a, b) => {
          const ta = new Date(a?.timestamp || 0).getTime();
          const tb = new Date(b?.timestamp || 0).getTime();
          return tb - ta;
        });

      setNotifications(visible);

      // Keep navbar unread badge in sync (inbox truth)
      try {
        localStorage.setItem("loBoard.unreadCount", String(visible.length));
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to load inbox notifications:", err);
      setNotifications([]);
      try {
        localStorage.setItem("loBoard.unreadCount", "0");
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    // When user changes (including Admin View-As), refresh inbox
    loadInboxNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);


// --- Submit new leave request (dates preferred; supports half-days; else figures) ---
// 🔄 Load my leave requests (used after submit / refresh)
// NO polling, NO sound, NO toast
const loadMyRequests = async () => {
  if (!user?.id) return;

  setReqLoading(true);
  try {
    const res = await fetch(
      `${LEAVE_ENDPOINT}?userId=${encodeURIComponent(user.id)}`
    );
    if (!res.ok) throw new Error("Failed to load requests");

    const data = await res.json();
    setMyRequests(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("Failed to load my requests:", err);
    setMyRequests([]);
  } finally {
    setReqLoading(false);
  }
};

const submitLeaveRequest = async () => {
  if (!user?.id || !user?.name) {
    toast({
      title: "Not logged in",
      description: "User not found.",
      variant: "destructive",
    });
    return;
  }
  if (!["local", "overseas"].includes(localOrOverseas)) {
    toast({
      title: "Invalid trip",
      description: "Choose Local or Overseas.",
      variant: "destructive",
    });
    return;
  }

  const haveDates = !!(startDate && endDate);
  const T = Number(requestedDays) || 0;

  if (haveDates && totalWeekdays <= 0) {
    toast({
      title: "Invalid range",
      description: "No weekdays in the selected range. Adjust your dates.",
      variant: "destructive",
    });
    return;
  }
  if (!haveDates && T <= 0) {
    toast({
      title: "Days required",
      description: "Enter Annual + Off to set the length (or choose dates).",
      variant: "destructive",
    });
    return;
  }

  const currentAnnual = Number(user?.annualLeave ?? 0);
  const currentOff = Number(user?.offDays ?? 0);
  let A = Number(annualAlloc);
  let O = Number(offAlloc);
  if (!Number.isFinite(A) || A < 0) A = 0;
  if (!Number.isFinite(O) || O < 0) O = 0;

  if (haveDates && A + O !== T) {
    toast({
      title: "Allocation mismatch",
      description: `Annual + Off must equal ${T} day(s) from your date range.`,
      variant: "destructive",
    });
    return;
  }
  if (A > currentAnnual || O > currentOff) {
    toast({
      title: "Insufficient balance",
      description: "Your allocation exceeds available Annual/Off balances.",
      variant: "destructive",
    });
    return;
  }

  const hasAnnual = A > 0;
  const hasOff = O > 0;
  const type = hasAnnual ? "annual" : "offDay";
  const days = hasAnnual ? A : O;

  if (!(Number(days) > 0)) {
    toast({
      title: "Days must be > 0",
      description: "Please set Annual or Off allocation to a positive number.",
      variant: "destructive",
    });
    return;
  }

  const payload = {
    type,
    days: Number(days),
    userId: String(user.id),
    userName: user.name,
    section: getSection(),
    startDate: haveDates ? startDate : null,
    endDate: haveDates ? endDate : null,
    resumeWorkOn: haveDates
      ? resumeOn || nextWorkdayISO(endDate, publicHolidays)
      : null,
    localOrOverseas,
    reason: reason.trim(),
    halfDayStart,
    halfDayEnd,
    totalWeekdays: T,
    allocations: { annual: A, off: O },
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  setSubmitting(true);
  try {
    const res = await fetch(LEAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("Failed to create leave request");

    // Reset form
    setReason("");
    setLocalOrOverseas("local");
    setStartDate("");
    setEndDate("");
    setTotalWeekdays(0);
    setHalfDayStart("none");
    setHalfDayEnd("none");
    setAnnualAlloc(0);
    setOffAlloc(0);
    setResumeOn("");

    await loadMyRequests();

    // App.jsx handles notifications globally
    toast({ title: "✅ Request submitted", description: "Awaiting approval." });

  } catch (err) {
    console.error(err);
    toast({
      title: "Error",
      description: err?.message || "Could not submit request",
      variant: "destructive",
    });
  } finally {
    setSubmitting(false);
  }
};

// ✅ Suggestion submit (simple + safe; matches your existing Suggestion Box UI)
const handleSuggestionSubmit = async () => {
  const text = (suggestion || "").trim();
  if (!text) {
    toast({
      title: "Empty suggestion",
      description: "Please write something before submitting.",
      variant: "destructive",
    });
    return;
  }

  if (!user?.id || !user?.name) {
    toast({
      title: "Not logged in",
      description: "User not found.",
      variant: "destructive",
    });
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `sug_${Date.now()}`,
        userId: String(user.id),
        userName: user.name,
        section: getSection(),
        message: text,
        createdAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) throw new Error("Failed to submit suggestion");

    setSuggestion("");
      toast({ title: "✅ Suggestion submitted", description: "Thank you!" });

  } catch (err) {
    console.error(err);
    toast({
      title: "Error",
      description: err?.message || "Could not submit suggestion",
      variant: "destructive",
    });
  }
};


  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold">My Profile</h1>

         {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>User Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
                   {!!adminViewAs && realLoggedInUser?.roles?.includes("admin") && (
            <p className="text-sm italic text-muted-foreground mb-2">
              Viewing as: <strong>{user?.name || "N/A"}</strong>
            </p>
          )}
                 <p><strong>Full Name:</strong> {user?.name || "N/A"}</p>
          <p>
            <strong>Role(s):</strong>{" "}
            {Array.isArray(user?.roles)
              ? (user.roles.length ? user.roles.join(", ") : "N/A")
              : (user?.roles || "N/A")}
          </p>
          <p><strong>Description:</strong> {user?.description || "N/A"}</p>
          <p><strong>Section:</strong> {getSection()}</p>

          {/* 🔁 Match LeaveManager fields exactly */}
          <p><strong>Annual Leave (max 42):</strong> {user?.annualLeave ?? "N/A"} days</p>
          <p><strong>Off Days:</strong> {Number(user?.offDays ?? user?.balances?.offDays ?? user?.offDayBalance ?? 0)} days</p>
          {user?.currentLeaveStatus && (
            <p><strong>Status:</strong> {user.currentLeaveStatus}</p>
          )}
        </CardContent>
      </Card>

        {/* Notification Settings (Collapsible) */}
      <Collapsible
        defaultOpen={false}
        onOpenChange={(open) => {
          localStorage.setItem(
            "myProfile.notifPrefsOpen",
            open ? "true" : "false"
          );
        }}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Notification Preferences</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                These settings affect the whole app
              </p>
            </div>

            <CollapsibleTrigger asChild>
              <button
                aria-label="Toggle notification preferences"
                className="p-1 rounded hover:bg-muted transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </CollapsibleTrigger>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-6 text-sm">
              {/* Master toggles only */}
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <Switch
                    checked={toastEnabled}
                    onCheckedChange={(checked) => {
                      setToastEnabled(checked);
                      localStorage.setItem(
                        "notificationToastsEnabled",
                        checked ? "true" : "false"
                      );
                    }}
                  />
                  <Label>Show pop-up messages anywhere in the app</Label>
                </div>

                           <div className="flex items-center space-x-3">
                  <Switch
                    checked={soundEnabled}
                    onCheckedChange={async (checked) => {
                      setSoundEnabled(checked);
                      setSoundEnabledStorage(checked);
                      if (checked) await unlockSounds();
                    }}
                  />
                  <Label>Play a sound when a new notification arrives</Label>
                </div>

                {/* ===========================
                    🔔 Push notifications toggle starts here
                    - Requests permission ONLY when user toggles ON
                    - Saves fcmToken to backend user record
                   =========================== */}
                <div className="flex items-center space-x-3">
                  <Switch
                    checked={pushEnabled}
                    onCheckedChange={async (checked) => {
                      setPushEnabled(checked);
                      localStorage.setItem(
                        "notificationPushEnabled",
                        checked ? "true" : "false"
                      );

                      // Must have a real user to attach token to
                      if (!user?.id || !user?.name) {
                        toast({
                          title: "Not logged in",
                          description: "User not found.",
                          variant: "destructive",
                        });
                        setPushEnabled(false);
                        localStorage.setItem("notificationPushEnabled", "false");
                        return;
                      }

                      // Turning OFF: clear token on backend (best-effort)
                      if (!checked) {
                        try {
                          await fetch(
                            `${API_BASE}/users/${encodeURIComponent(user.id)}`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ fcmToken: "" }),
                            }
                          );
                        } catch {
                          // ignore
                        }

                        try {
                          localStorage.removeItem("loBoard.fcmToken");
                        } catch {
                          // ignore
                        }

                        toast({
                          title: "Push notifications disabled",
                          description: "This device will no longer receive alerts.",
                        });
                        return;
                      }

                      // Turning ON: permission + token
                      try {
                        const token = await requestPermission({ prompt: true });

                        if (!token) {
                          toast({
                            title: "Permission not granted",
                            description:
                              "Push notifications were not enabled on this device.",
                            variant: "destructive",
                          });
                          setPushEnabled(false);
                          localStorage.setItem("notificationPushEnabled", "false");
                          return;
                        }

                        // Save token (local + backend)
                        try {
                          localStorage.setItem("loBoard.fcmToken", token);
                        } catch {
                          // ignore
                        }

                        const res = await fetch(
                          `${API_BASE}/users/${encodeURIComponent(user.id)}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fcmToken: token }),
                          }
                        );

                        if (!res.ok) {
                          throw new Error("Failed to save token to server");
                        }

                        toast({
                          title: "✅ Push enabled",
                          description: "This device can now receive notifications.",
                        });
                      } catch (err) {
                        console.error("Push enable failed:", err);
                        toast({
                          title: "Push setup failed",
                          description:
                            err?.message ||
                            "Could not enable push notifications on this device.",
                          variant: "destructive",
                        });
                        setPushEnabled(false);
                        localStorage.setItem("notificationPushEnabled", "false");
                      }
                    }}
                  />
                  <Label>Enable device notifications (browser)</Label>
                </div>
                {/* ===========================
                    🔔 Push notifications toggle ends here
                   =========================== */}


                <p className="text-xs text-muted-foreground pt-2">
                  More detailed notification controls will return in a future
                  update.
                </p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

     {/* Notifications Inbox */}
<Card>
  <CardHeader className="flex items-center justify-between">
    <CardTitle>Notifications Inbox</CardTitle>

    {notifications.length > 0 && (
      <Button
        size="sm"
        variant="ghost"
               onClick={() => {
          const dismissed = JSON.parse(
            localStorage.getItem("dismissedNotifications") || "[]"
          );

          const allKeys = notifications
            .map((n) => {
              try {
                return new Date(n.timestamp).toISOString().split(".")[0] + "Z";
              } catch {
                return null;
              }
            })
            .filter(Boolean);

          localStorage.setItem(
            "dismissedNotifications",
            JSON.stringify([...new Set([...dismissed, ...allKeys])])
          );

          setNotifications([]);

          // ✅ Inbox-truth: stamp inbox empty so Navbar can read length === 0
          // ✅ Also keep legacy unreadCount in sync as fallback
          try {
            localStorage.setItem("loBoard.inbox", "[]");
            localStorage.setItem("loBoard.unreadCount", "0");
            window.dispatchEvent(new CustomEvent("loBoard:inbox"));
            window.dispatchEvent(new CustomEvent("loBoard:unread"));
          } catch {
            // ignore
          }
        }}
      >
        Clear All
      </Button>
    )}
  </CardHeader>

  <CardContent>
    <div className="border rounded p-2 max-h-[300px] overflow-y-auto space-y-3">
      {notifications.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notifications yet.</p>
      ) : (
        notifications.map((note) => {
          const stableKey = (() => {
            try {
              return new Date(note.timestamp).toISOString().split(".")[0] + "Z";
            } catch {
              return `${note.timestamp || ""}-${note.title || ""}-${note.message || ""}`;
            }
          })();

          return (
            <div
              key={stableKey}
              className="relative border p-3 rounded bg-muted pr-10"
            >
              <button
                className="absolute top-1 right-1 text-gray-500 hover:text-red-500 text-xs"
                onClick={() => handleDismiss(note)}
                type="button"
                aria-label="Dismiss notification"
              >
                ✕
              </button>

              <p className="font-semibold">{note.title}</p>
              <p className="text-sm">{note.message}</p>
              <p className="text-xs text-gray-500 mt-1">
                {note.timestamp ? new Date(note.timestamp).toLocaleString() : ""}
              </p>
            </div>
          );
        })
      )}
    </div>
  </CardContent>
</Card>

     {/* --- Leave Request (MANUAL ALLOC + CONSUMPTION ORDER DISCLAIMER) --- */}
{(() => {
  // ✅ Date formatting helpers (safe + timezone-stable for YYYY-MM-DD)
  const formatLeaveDate = (iso) => {
    if (!iso || typeof iso !== "string") return "—";
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts.map((x) => Number(x));
    if (!y || !m || !d) return iso;

    const dt = new Date(y, m - 1, d); // local-safe (no UTC drift)
    const formatted = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    }).format(dt);

    // "04 Feb 26" -> "04/Feb/26"
    return formatted.replace(/ /g, "/");
  };

  const formatRange = (start, end) => {
    if (!start || !end) return "Dates not selected";
    return `${formatLeaveDate(start)} → ${formatLeaveDate(end)}`;
  };

  const formatResume = (iso) => {
    if (!iso) return null;
    return `Resume: ${formatLeaveDate(iso)}`;
  };

  const halfDayLabel = (pos, val) => {
    if (!val || val === "none") return null;
    const side = pos === "start" ? "Start" : "End";
    const when = val === "am" ? "AM" : "PM";
    return `${side} half-day (${when})`;
  };

  const halfStartText = halfDayLabel("start", halfDayStart);
  const halfEndText = halfDayLabel("end", halfDayEnd);

  // ✅ Safe guards
  const balAnnual = Number(getAnnualBalance(user)) || 0;
  const balOff = Number(getOffBalance(user)) || 0;

  const sumAlloc =
    Math.round((Number(annualAlloc) + Number(offAlloc)) * 2) / 2;

  const orderLabel =
    consumptionOrder === "off_first" ? "Off Days first" : "Annual first";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Leave Request</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            It is recommended to apply for leave at least{" "}
            <strong>two weeks in advance</strong> to support planning and
            coverage.
          </p>

          {startDate && !endDate && (
            <p className="text-xs text-amber-600 mt-2">
              Select an <strong>End Date</strong> to calculate weekdays and
              validate allocations.
            </p>
          )}
          {!startDate && endDate && (
            <p className="text-xs text-amber-600 mt-2">
              Select a <strong>Start Date</strong> to calculate weekdays and
              validate allocations.
            </p>
          )}
        </div>

        {/* Right-side compact pills (no inputs) */}
        <div className="flex flex-col items-end gap-1 text-xs">
          {startDate && endDate ? (
            <>
              <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                {formatRange(startDate, endDate)}
              </div>

              {/* ✅ Half-day indicators */}
              {(halfStartText || halfEndText) && (
                <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                  {halfStartText ? halfStartText : null}
                  {halfStartText && halfEndText ? " • " : null}
                  {halfEndText ? halfEndText : null}
                </div>
              )}

              {holidaysInRange.length > 0 && (
                <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                  Public holidays excluded: {holidaysInRange.length}
                </div>
              )}

              {resumeOn && (
                <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
                  {formatResume(resumeOn)}
                </div>
              )}
            </>
          ) : (
            <div className="px-2 py-1 rounded bg-muted text-muted-foreground">
              Dates not selected
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ✅ NEW: Disclaimer + user chooses which balance is consumed first */}
        <div className="rounded border p-3 text-sm space-y-2">
          <div className="font-medium">Balance usage rule</div>

          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Important:</span>{" "}
            whichever balance you choose first will be used first as your leave
            progresses. This affects refunds if you cancel while the leave is in
            progress.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
              <input
                type="radio"
                name="consumptionOrder"
                value="annual_first"
                checked={consumptionOrder === "annual_first"}
                onChange={() => {
                  setConsumptionOrder("annual_first");
                  setLeaveTermsAccepted(false);
                }}
              />
              <div>
                <div className="text-sm font-medium">Annual first</div>
                <div className="text-xs text-muted-foreground">
                  Annual days are consumed before Off Days.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
              <input
                type="radio"
                name="consumptionOrder"
                value="off_first"
                checked={consumptionOrder === "off_first"}
                onChange={() => {
                  setConsumptionOrder("off_first");
                  setLeaveTermsAccepted(false);
                }}
              />
              <div>
                <div className="text-sm font-medium">Off Days first</div>
                <div className="text-xs text-muted-foreground">
                  Off Days are consumed before Annual.
                </div>
              </div>
            </label>
          </div>

          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={!!leaveTermsAccepted}
              onChange={(e) => setLeaveTermsAccepted(e.target.checked)}
            />
            <span className="text-xs">
              I understand and agree —{" "}
              <span className="font-medium">{orderLabel}</span>.
            </span>
          </label>
        </div>

        {/* 1) Dates & trip type first — with half-day selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                // Reset half-day if date cleared
                if (!e.target.value) setHalfDayStart("none");
              }}
            />

            {/* Half-day on start (only makes sense if date picked) */}
            {startDate && (
              <div className="mt-2">
                <Label className="text-xs block mb-1">Start Day</Label>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={halfDayStart}
                  onChange={(e) => setHalfDayStart(e.target.value)}
                >
                  <option value="none">Full day</option>
                  <option value="am">Half day (AM)</option>
                  <option value="pm">Half day (PM)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (!e.target.value) setHalfDayEnd("none");
              }}
            />

            {/* Half-day on end (only makes sense if date picked) */}
            {endDate && (
              <div className="mt-2">
                <Label className="text-xs block mb-1">End Day</Label>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={halfDayEnd}
                  onChange={(e) => setHalfDayEnd(e.target.value)}
                >
                  <option value="none">Full day</option>
                  <option value="am">Half day (AM)</option>
                  <option value="pm">Half day (PM)</option>
                </select>
              </div>
            )}
          </div>

          {/* Trip type */}
          <div className="sm:col-span-1">
            <Label>Local / Overseas</Label>
            <select
              className="w-full border rounded px-3 py-2"
              value={localOrOverseas}
              onChange={(e) => setLocalOrOverseas(e.target.value)}
            >
              <option value="local">Local</option>
              <option value="overseas">Overseas</option>
            </select>
          </div>
        </div>

        {/* 2) Number of days requested (dates win if valid; else figures; supports half-days) */}
        <div className="rounded border p-3 text-sm">
          <span className="font-medium">Number of days requested:</span>{" "}
          <span>
            {startDate && endDate ? (
              totalWeekdays > 0 ? (
                `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`
              ) : (
                "— invalid range —"
              )
            ) : (
              `${requestedDays} ${requestedDays === 1 ? "day" : "days"}`
            )}
          </span>

          {holidaysInRange.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              ℹ️ {holidaysInRange.length} public holiday
              {holidaysInRange.length > 1 ? "s are" : " is"} excluded from this
              range.
            </div>
          )}

          {startDate &&
            endDate &&
            totalWeekdays > 0 &&
            sumAlloc !== requestedDays && (
              <span className="text-xs ml-2 text-amber-600">
                (allocations must equal {requestedDays})
              </span>
            )}
        </div>

        {/* 3) Auto Allocate */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const target = Number(requestedDays) || 0;

              if (consumptionOrder === "off_first") {
                const off = Math.min(balOff, target);
                const remaining = Math.max(0, target - off);
                const annual = Math.min(balAnnual, remaining);

                setOffAlloc(Math.round(off * 2) / 2);
                setAnnualAlloc(Math.round(annual * 2) / 2);
              } else {
                // annual_first (default)
                const annual = Math.min(balAnnual, target);
                const remaining = Math.max(0, target - annual);
                const off = Math.min(balOff, remaining);

                setAnnualAlloc(Math.round(annual * 2) / 2);
                setOffAlloc(Math.round(off * 2) / 2);
              }
            }}
            disabled={submitting || !(Number(requestedDays) > 0)}
          >
            Auto Allocate
          </Button>

          <p className="text-xs text-muted-foreground flex items-center">
            Fills <strong className="mx-1">{orderLabel.split(" ")[0]}</strong>{" "}
            first, then{" "}
            <strong className="mx-1">
              {consumptionOrder === "off_first" ? "Annual" : "Off Days"}
            </strong>
            .
          </p>
        </div>

        {/* 4) Allocations underneath */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>
              Annual Leave to use{" "}
              <span className="text-muted-foreground">
                (you have {balAnnual})
              </span>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              max={balAnnual}
              value={annualAlloc}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (!Number.isFinite(val) || val < 0) val = 0;
                val = Math.round(val * 2) / 2;
                setAnnualAlloc(val);
              }}
            />
            {Math.max(0, annualAlloc - balAnnual) > 0 && (
              <p className="text-xs text-red-600 mt-1">
                You selected {annualAlloc} but only have {balAnnual} Annual.
                Reduce by {annualAlloc - balAnnual} or move days to Off.
              </p>
            )}
          </div>

          <div>
            <Label>
              Off Days to use{" "}
              <span className="text-muted-foreground">(you have {balOff})</span>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              max={balOff}
              value={offAlloc}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (!Number.isFinite(val) || val < 0) val = 0;
                val = Math.round(val * 2) / 2;
                setOffAlloc(val);
              }}
            />
            {Math.max(0, offAlloc - balOff) > 0 && (
              <p className="text-xs text-red-600 mt-1">
                You selected {offAlloc} but only have {balOff} Off Days. Reduce
                by {offAlloc - balOff} or move days to Annual.
              </p>
            )}
          </div>
        </div>

        {/* 5) Reason */}
        <div>
          <Label>Reason (optional)</Label>
          <Textarea
            placeholder="Brief reason for your request…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* 6) Balances preview (provisional) */}
        <div className="rounded border p-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="font-medium">Annual:</span>{" "}
            <span>{balAnnual}</span>
            <span className="text-blue-600 ml-2">
              → {Math.max(0, balAnnual - Number(annualAlloc))}
            </span>{" "}
            <span className="text-muted-foreground">(provisional)</span>
          </div>
          <div>
            <span className="font-medium">Off Days:</span> <span>{balOff}</span>
            <span className="text-blue-600 ml-2">
              → {Math.max(0, balOff - Number(offAlloc))}
            </span>{" "}
            <span className="text-muted-foreground">(provisional)</span>
          </div>
        </div>

        {/* 7) Actions */}
        <div className="flex gap-2">
          <Button
            onClick={submitLeaveRequest}
            disabled={
              submitting ||
              !leaveTermsAccepted ||
              (startDate && endDate
                ? totalWeekdays <= 0 || sumAlloc !== requestedDays
                : requestedDays <= 0) ||
              annualAlloc > balAnnual ||
              offAlloc > balOff
            }
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setLocalOrOverseas("local");
              setStartDate("");
              setEndDate("");
              setTotalWeekdays(0);
              setHalfDayStart("none");
              setHalfDayEnd("none");
              setAnnualAlloc(0);
              setOffAlloc(0);
              setResumeOn("");
              setReason("");
              setLeaveTermsAccepted(false);
              setConsumptionOrder("annual_first");
            }}
            disabled={submitting}
          >
            Reset
          </Button>
        </div>

        {/* 8) My Requests (clean + filters + pagination) */}
        <div className="mt-4 border rounded">
          <div className="px-3 py-2 bg-muted/40 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm font-medium">My Requests</div>

              {/* Per-page selector */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Per page</span>
                <select
                  className="border rounded px-2 py-1 text-xs"
                  value={myReqPerPage}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const safe = [4, 6, 8].includes(n) ? n : 6;
                    setMyReqPerPage(safe);
                    localStorage.setItem(
                      "myProfile.requestsPerPage",
                      String(safe)
                    );
                    setMyReqPage(1);
                  }}
                >
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                </select>
              </div>
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "current", label: "Current" },
                { key: "all", label: "All" },
                { key: "approved", label: "Approved" },
                { key: "cancelled", label: "Cancelled" },
                { key: "denied", label: "Denied" },
                { key: "none", label: "None" },
              ].map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={myReqFilter === f.key ? "default" : "outline"}
                  onClick={() => {
                    setMyReqFilter(f.key);
                    setMyReqPage(1);
                  }}
                  className="h-7 px-3 text-xs"
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          {(() => {
            const safeISO = (v) => (typeof v === "string" ? v : "");

            const toLocalDate = (isoStr) => {
              const s = safeISO(isoStr);
              if (!s) return null;
              const parts = s.split("-");
              if (parts.length !== 3) return null;
              const [y, m, d] = parts.map((x) => Number(x));
              if (!y || !m || !d) return null;
              return new Date(y, m - 1, d); // local-safe
            };

            const normalizeStatus = (s) => {
              return String(s || "pending").toLowerCase();
            };

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const isCurrentRequest = (r) => {
              const status = normalizeStatus(r?.status);
              if (status === "cancelled" || status === "denied") return false;

              if (status === "pending") return true;

              if (status === "approved") {
                const end = toLocalDate(r?.endDate);
                if (!end) return true;
                end.setHours(0, 0, 0, 0);
                return today <= end;
              }

              return false;
            };

            const matchesFilter = (r) => {
              const status = normalizeStatus(r?.status);

              if (myReqFilter === "none") return false;
              if (myReqFilter === "all") return true;
              if (myReqFilter === "approved") return status === "approved";
              if (myReqFilter === "cancelled") return status === "cancelled";
              if (myReqFilter === "denied") return status === "denied";
              if (myReqFilter === "current") return isCurrentRequest(r);

              return true;
            };

            const filtered = Array.isArray(myRequests)
              ? myRequests.filter(matchesFilter)
              : [];

            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / myReqPerPage));
            const page = Math.min(Math.max(1, myReqPage), totalPages);
            const startIdx = (page - 1) * myReqPerPage;
            const pageItems = filtered.slice(startIdx, startIdx + myReqPerPage);

            const formatLeaveDate = (iso) => {
              if (!iso || typeof iso !== "string") return "—";
              const parts = iso.split("-");
              if (parts.length !== 3) return iso;
              const [y, m, d] = parts.map((x) => Number(x));
              if (!y || !m || !d) return iso;
              const dt = new Date(y, m - 1, d);
              const formatted = new Intl.DateTimeFormat("en-GB", {
                day: "2-digit",
                month: "short",
                year: "2-digit",
              }).format(dt);
              return formatted.replace(/ /g, "/");
            };

            const statusPill = (r) => {
              const s = normalizeStatus(r?.status);
              const base =
                "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium border";
              if (s === "approved")
                return (
                  <span
                    className={`${base} bg-emerald-50 border-emerald-200 text-emerald-700`}
                  >
                    Approved
                  </span>
                );
              if (s === "cancelled")
                return (
                  <span
                    className={`${base} bg-rose-50 border-rose-200 text-rose-700`}
                  >
                    Cancelled
                  </span>
                );
              if (s === "denied")
                return (
                  <span
                    className={`${base} bg-slate-50 border-slate-200 text-slate-700`}
                  >
                    Denied
                  </span>
                );
              return (
                <span
                  className={`${base} bg-amber-50 border-amber-200 text-amber-700`}
                >
                  Pending
                </span>
              );
            };

            const typePill = (r) => {
              const t = String(r?.type || "").toLowerCase();
              const base =
                "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium border bg-muted/30";
              if (t === "annual") return <span className={base}>Annual</span>;
              if (t === "offday" || t === "off_day")
                return <span className={base}>Off Day</span>;
              return <span className={base}>Leave</span>;
            };

            // ✅ Show server truth for days + allocations:
            const showDays = (r) =>
              r?.requestedDays ??
              r?.daysRequested ??
              r?.totalWeekdays ??
              r?.days ??
              "—";

            const allocAnnual = (r) =>
              r?.appliedAnnual ?? r?.allocations?.annual ?? r?.annualAlloc ?? 0;

            const allocOff = (r) =>
              r?.appliedOff ?? r?.allocations?.off ?? r?.offAlloc ?? 0;

            const returnISO = (r) => {
              const resume = safeISO(r?.resumeWorkOn || r?.resumeOn);
              if (resume) return resume;
              const e = safeISO(r?.endDate);
              if (!e) return "";
              return nextWorkdayISO(e, publicHolidays);
            };

            if (reqLoading) {
              return (
                <div className="p-3 text-sm text-muted-foreground">Loading…</div>
              );
            }

            if (myReqFilter === "none") {
              return (
                <div className="p-3 text-sm text-muted-foreground">
                  (None) — showing no requests.
                </div>
              );
            }

            if (!Array.isArray(myRequests) || myRequests.length === 0) {
              return (
                <div className="p-3 text-sm text-muted-foreground">
                  No requests yet.
                </div>
              );
            }

            if (filtered.length === 0) {
              const msg =
                myReqFilter === "approved"
                  ? "No approved requests yet."
                  : myReqFilter === "cancelled"
                  ? "No cancelled requests."
                  : myReqFilter === "denied"
                  ? "No denied requests."
                  : myReqFilter === "current"
                  ? "You have no current requests."
                  : "No requests found.";
              return (
                <div className="p-3 text-sm text-muted-foreground">{msg}</div>
              );
            }

            return (
              <div className="p-3 space-y-2">
                <div className="space-y-2">
                  {pageItems.map((r) => {
                    const status = normalizeStatus(r?.status);
                    const a = Number(allocAnnual(r)) || 0;
                    const o = Number(allocOff(r)) || 0;
                    const hasAlloc = a > 0 || o > 0;

                    const editedBy =
                      r?.lastEditedByName || r?.editedByName || "";
                    const editedAt = r?.lastEditedAt || r?.editedAt || "";

                    return (
                      <div key={r.id} className="border rounded p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {typePill(r)}
                            {statusPill(r)}
                            <span className="text-xs text-muted-foreground capitalize">
                              {r?.localOrOverseas || "—"}
                            </span>
                          </div>

                          <div className="text-xs text-muted-foreground">
                            {r?.createdAt
                              ? new Date(r.createdAt).toLocaleString()
                              : "—"}
                          </div>
                        </div>

                        <div className="mt-2 text-sm">
                          <div className="font-medium">
                            {formatLeaveDate(r.startDate)} →{" "}
                            {formatLeaveDate(r.endDate)}
                          </div>

                          <div className="text-xs text-muted-foreground mt-1">
                            Returns:{" "}
                            <span className="font-medium">
                              {formatLeaveDate(returnISO(r))}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">
                              Days:
                            </span>{" "}
                            {showDays(r)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">
                              Alloc:
                            </span>{" "}
                            {hasAlloc ? `${a} Annual / ${o} Off` : "—"}
                          </div>
                        </div>

                        {status === "approved" &&
                          (r?.appliedAnnual != null ||
                            r?.appliedOff != null) && (
                            <div className="mt-2 text-[11px] text-gray-600">
                              ✅ Applied (server): Annual{" "}
                              {Number(r?.appliedAnnual ?? 0)} • Off{" "}
                              {Number(r?.appliedOff ?? 0)}
                            </div>
                          )}

                        {(editedBy || editedAt) && (
                          <div className="mt-2 text-[11px] text-gray-500">
                            Edited by {editedBy || "—"} at{" "}
                            {editedAt
                              ? new Date(editedAt).toLocaleString()
                              : "—"}
                          </div>
                        )}

                        {r?.reason ? (
                          <div className="mt-2 text-sm whitespace-pre-wrap">
                            {r.reason}
                          </div>
                        ) : null}

                        {/* Admin note (clean toggle) */}
                        {["approved", "cancelled"].includes(status) &&
                        r?.decisionNote ? (
                          <div className="mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                setExpandedRequestId((prev) =>
                                  prev === r.id ? null : r.id
                                )
                              }
                            >
                              {expandedRequestId === r.id
                                ? "Hide admin note"
                                : "View admin note"}
                            </Button>

                            {expandedRequestId === r.id && (
                              <div className="mt-2 text-xs text-muted-foreground border-l-2 pl-2 whitespace-pre-wrap">
                                {r.decisionNote}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    Showing {Math.min(total, startIdx + 1)}–
                    {Math.min(total, startIdx + myReqPerPage)} of {total}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setMyReqPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      ← Prev
                    </Button>

                    <div className="text-xs text-muted-foreground">
                      Page {page} / {totalPages}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setMyReqPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page >= totalPages}
                    >
                      Next →{" "}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
})()}

      {/* Suggestion Box */}
      <Card>
        <CardHeader>
          <CardTitle>Suggestion Box</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Write your suggestion here..."
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
          />
          <Button onClick={handleSuggestionSubmit}>Submit Suggestion</Button>
        </CardContent>
      </Card>
    </div>
  );
}
