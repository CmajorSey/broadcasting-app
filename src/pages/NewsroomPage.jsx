import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getSectionPermissions } from "@/lib/permissions";


/* ===========================
   🌐 Backend (replaces LS_KEY)
   - Week is stored by weekStartISO
   - Recurring list is global
   =========================== */
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_BACKEND_URL ||
  "http://localhost:4000";

const safeJson = async (res) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const fetchJSON = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });

  const data = await safeJson(res);
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
};

/* ===========================
   🗓️ Date helpers (Monday week)
   =========================== */
const toISO = (d) => {
  try {
    const x = new Date(d);
    if (isNaN(x.getTime())) return "";

    // ✅ IMPORTANT: build YYYY-MM-DD using LOCAL time (avoid UTC date drift)
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
};

const pad2 = (n) => String(n).padStart(2, "0");

const formatDDMMYYYY = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${pad2(d)}${pad2(m)}${y}`;
};

const addDaysISO = (weekStartISO, offset) => {
  const d = new Date(`${weekStartISO}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return toISO(d);
};

const getMondayISO = (base = new Date()) => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6
  d.setDate(d.getDate() - diffToMonday);
  return toISO(d);
};

const weekTitle = (weekStartISO) => {
  const start = weekStartISO;
  const end = addDaysISO(weekStartISO, 6);
  return `${formatDDMMYYYY(start)} → ${formatDDMMYYYY(end)}`;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ===========================
   🧾 Default week shape
   =========================== */
const makeEmptyWeek = () => ({
  bulletin: {
    0: "", // Mon
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
    6: "", // Sun
  },
  saturdayProgram: "",
  sundayRoundup: "",

  /* ===========================
     🎙️ Presenter roster (Shows)
     - Stored per-week
     - dayIndex: 0..6 OR "daily"
     =========================== */
  // { id, title, dayIndex: number|"daily", timeHHMM, presenter, createdBy, createdAt }
  shows: [],

  /* ===========================
     🗓️ One-offs for this week
     =========================== */
  // { id, title, dateISO, timeHHMM, presenter, createdBy, createdAt }
  oneOff: [],
});

export default function NewsroomPage({ loggedInUser, users = [] }) {
  const { toast } = useToast();
  const { canEdit } = getSectionPermissions("newsroom", loggedInUser);

  /* ===========================
     📦 Backend Store (week + recurring)
     =========================== */
  const [weekData, setWeekData] = useState(() => makeEmptyWeek()); // ✅ Presenter week data (roster + shows)
  const [calendarWeekData, setCalendarWeekData] = useState(() => makeEmptyWeek()); // ✅ Calendar week data (one-offs shown per viewed week)
  const [recurring, setRecurring] = useState(() => []);
  const [isLoading, setIsLoading] = useState(false);

  /* ===========================
     ✍️ Form state (fixes "is not defined" vars)
     - showTitle, showDay, showTime, showPresenter
     - customTitle, customDate, customTime, customPresenter, customRecurrence
     =========================== */
  const [showTitle, setShowTitle] = useState("");
  const [showDay, setShowDay] = useState("daily"); // "daily" or "0".."6"
  const [showTime, setShowTime] = useState("19:00"); // HH:MM
  const [showPresenter, setShowPresenter] = useState("");

  const [customTitle, setCustomTitle] = useState("");
  const [customDate, setCustomDate] = useState(""); // YYYY-MM-DD
  const [customTime, setCustomTime] = useState("19:00"); // HH:MM
  const [customPresenter, setCustomPresenter] = useState("");
  const [customRecurrence, setCustomRecurrence] = useState("one-off"); // "one-off" | "weekly"

  /* ===========================
     🗓️ Week states
     - Calendar week can browse freely (Prev/Next)
     - Presenter roster is ONLY current vs next (switch)
     =========================== */
  const [calendarWeekStartISO, setCalendarWeekStartISO] = useState(() => getMondayISO(new Date()));
  const [presenterNextWeek, setPresenterNextWeek] = useState(false);

  const presenterWeekStartISO = useMemo(() => {
    const base = getMondayISO(new Date());
    return presenterNextWeek ? addDaysISO(base, 7) : base;
  }, [presenterNextWeek]);

  /* ===========================
     🧩 Compatibility alias
     - Some JSX still references weekStartISO
     - For presenter roster, weekStartISO should mean presenterWeekStartISO
     =========================== */
  const weekStartISO = presenterWeekStartISO;

  /* ===========================
     ✅ Week alias
     - Existing code below uses currentWeek everywhere for roster/shows
     =========================== */
  const currentWeek = weekData;

  /* ===========================
     👥 Presenter options
     =========================== */
  const presenterOptions = useMemo(() => {
    const base = Array.isArray(users) ? users : [];

    const namesFromUsers = base
      .filter((u) => {
        const name = String(u?.name || "").trim();
        if (!name) return false;

        const roles = Array.isArray(u?.roles) ? u.roles : [];
        const desc = String(u?.description || "").toLowerCase();

        // ✅ Keep "News journalists only (Sports excluded)"
        const isSports =
          roles.some((r) => String(r || "").toLowerCase().includes("sports")) ||
          desc.includes("sports");

        const isJournalist =
          roles.some((r) => String(r || "").toLowerCase().includes("journalist")) ||
          desc.includes("journalist") ||
          desc.includes("news");

        return isJournalist && !isSports;
      })
      .map((u) => String(u?.name || "").trim());

    const merged = [...namesFromUsers, "Clive Camille"];
    return [...new Set(merged)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [users]);

  /* ===========================
     📥 Load
     - Loads BOTH:
       1) Presenter week (current/next only)
       2) Calendar viewed week (Prev/Next browsing)
     - Recurring is global
     =========================== */
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      try {
        // ✅ load recurring (global)
        const recRes = await fetchJSON(`${API_BASE}/hub/newsroom/recurring`);
        const rec =
          (recRes && (recRes.recurring || recRes.data)) ||
          (Array.isArray(recRes) ? recRes : []);

        // ✅ load presenter week
        const presenterRes = await fetchJSON(`${API_BASE}/hub/newsroom/${presenterWeekStartISO}`);
        const presenterWeek =
          (presenterRes && (presenterRes.week || presenterRes.data)) ||
          (presenterRes && typeof presenterRes === "object" ? presenterRes : null);

        // ✅ load calendar week (if different), else reuse presenter result
        let calendarWeek = presenterWeek;
        if (calendarWeekStartISO !== presenterWeekStartISO) {
          const calRes = await fetchJSON(`${API_BASE}/hub/newsroom/${calendarWeekStartISO}`);
          calendarWeek =
            (calRes && (calRes.week || calRes.data)) ||
            (calRes && typeof calRes === "object" ? calRes : null);
        }

        if (cancelled) return;

        setRecurring(Array.isArray(rec) ? rec : []);

        setWeekData(
          presenterWeek && typeof presenterWeek === "object"
            ? { ...makeEmptyWeek(), ...presenterWeek }
            : makeEmptyWeek()
        );

        setCalendarWeekData(
          calendarWeek && typeof calendarWeek === "object"
            ? { ...makeEmptyWeek(), ...calendarWeek }
            : makeEmptyWeek()
        );
      } catch (err) {
        if (cancelled) return;

        setWeekData(makeEmptyWeek());
        setCalendarWeekData(makeEmptyWeek());
        setRecurring([]);

        toast({
          title: "Load failed",
          description: err?.message || "Could not load newsroom data from the server.",
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarWeekStartISO, presenterWeekStartISO]);

  /* ===========================
     💾 Save week (server)
     - Week is stored by weekStartISO
     =========================== */
  const persistWeek = async (weekISO, nextWeekObj) => {
    await fetchJSON(`${API_BASE}/hub/newsroom/${weekISO}`, {
      method: "PATCH",
      body: JSON.stringify(nextWeekObj),
    });
  };

  /* ===========================
     ✅ Presenter week setter
     =========================== */
  const setWeek = (nextWeekObj) => {
    setWeekData(nextWeekObj);

    // If calendar is currently viewing the same week, keep it in sync visually.
    if (calendarWeekStartISO === presenterWeekStartISO) {
      setCalendarWeekData(nextWeekObj);
    }

    persistWeek(presenterWeekStartISO, nextWeekObj).catch((err) => {
      toast({
        title: "Save failed",
        description: err?.message || "Could not save changes. Please try again.",
      });
    });
  };

  /* ===========================
     ✅ Calendar week setter (one-offs live here)
     =========================== */
  const setCalendarWeek = (nextWeekObj) => {
    setCalendarWeekData(nextWeekObj);

    // If presenter week is the same week, keep it in sync visually.
    if (calendarWeekStartISO === presenterWeekStartISO) {
      setWeekData(nextWeekObj);
    }

    persistWeek(calendarWeekStartISO, nextWeekObj).catch((err) => {
      toast({
        title: "Save failed",
        description: err?.message || "Could not save changes. Please try again.",
      });
    });
  };

  /* ===========================
     🔄 Calendar Week controls (ONLY affects calendar view)
     =========================== */
  const goPrevWeek = () => {
    const d = new Date(`${calendarWeekStartISO}T00:00:00`);
    d.setDate(d.getDate() - 7);
    setCalendarWeekStartISO(toISO(d));
  };

  const goNextWeek = () => {
    const d = new Date(`${calendarWeekStartISO}T00:00:00`);
    d.setDate(d.getDate() + 7);
    setCalendarWeekStartISO(toISO(d));
  };

  const goThisWeek = () => {
    setCalendarWeekStartISO(getMondayISO(new Date()));
  };

  /* ===========================
     🧑‍💼 Roster setters
     =========================== */
  const setBulletin = (dayIndex, name) => {
    const next = {
      ...currentWeek,
      bulletin: {
        ...(currentWeek.bulletin || {}),
        [dayIndex]: name,
      },
    };
    setWeek(next);
  };

  const setSaturdayProgram = (name) => {
    const next = { ...currentWeek, saturdayProgram: name };
    setWeek(next);
  };

  const setSundayRoundup = (name) => {
    const next = { ...currentWeek, sundayRoundup: name };
    setWeek(next);
  };

  /* ===========================
     🎙️ Shows actions
     =========================== */
  const addShow = () => {
    const title = (showTitle || "").trim();
    const presenter = (showPresenter || "").trim();
    const timeHHMM = String(showTime || "").trim();

    if (!title) {
      toast({ title: "Missing show name", description: "Please enter the show name." });
      return;
    }
    if (!presenter) {
      toast({ title: "Missing presenter", description: "Please select/enter a presenter." });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(timeHHMM)) {
      toast({ title: "Missing time", description: "Please choose a time (HH:MM)." });
      return;
    }

    const nowISO = new Date().toISOString();
    const dayIndex =
      showDay === "daily" ? "daily" : Number.isFinite(Number(showDay)) ? Number(showDay) : "daily";

    const newShow = {
      id: Date.now().toString(),
      title,
      dayIndex,
      timeHHMM,
      presenter,
      createdBy: loggedInUser?.name || "Unknown",
      createdAt: nowISO,
    };

    const nextWeek = {
      ...currentWeek,
      shows: [newShow, ...(currentWeek.shows || [])],
    };

    setWeek(nextWeek);

    setShowTitle("");
    setShowPresenter("");
    toast({ title: "Saved", description: "Show added to presenter roster." });
  };

  const updateShowPresenter = (id, presenter) => {
    const nextWeek = {
      ...currentWeek,
      shows: (currentWeek.shows || []).map((s) => (s.id === id ? { ...s, presenter } : s)),
    };
    setWeek(nextWeek);
  };

  const updateShowDay = (id, nextDay) => {
    const dayIndex =
      nextDay === "daily" ? "daily" : Number.isFinite(Number(nextDay)) ? Number(nextDay) : "daily";

    const nextWeek = {
      ...currentWeek,
      shows: (currentWeek.shows || []).map((s) => (s.id === id ? { ...s, dayIndex } : s)),
    };
    setWeek(nextWeek);
  };

  const updateShowTime = (id, timeHHMM) => {
    const next = String(timeHHMM || "").trim();
    if (!/^\d{2}:\d{2}$/.test(next)) return;

    const nextWeek = {
      ...currentWeek,
      shows: (currentWeek.shows || []).map((s) => (s.id === id ? { ...s, timeHHMM: next } : s)),
    };
    setWeek(nextWeek);
  };

  const removeShow = (id) => {
    const nextWeek = {
      ...currentWeek,
      shows: (currentWeek.shows || []).filter((s) => s.id !== id),
    };
    setWeek(nextWeek);
    toast({ title: "Removed", description: "Show removed from roster." });
  };

  /* ===========================
     ➕ Calendar add (one-off / weekly recurring)
     =========================== */
  const addCustom = () => {
    const title = (customTitle || "").trim();
    const dateISO = toISO(customDate);
    const timeHHMM = String(customTime || "").trim();
    const presenter = (customPresenter || "").trim();

    if (!title) {
      toast({ title: "Missing title", description: "Please enter a program/news title." });
      return;
    }
    if (!dateISO) {
      toast({ title: "Missing date", description: "Please select a date." });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(timeHHMM)) {
      toast({ title: "Missing time", description: "Please choose a time (HH:MM)." });
      return;
    }
    if (!presenter) {
      toast({ title: "Missing presenter", description: "Please select/enter a presenter." });
      return;
    }

    // ✅ Ensure date is inside the CALENDAR viewed week
    const weekStart = calendarWeekStartISO;
    const weekEnd = addDaysISO(calendarWeekStartISO, 6);
    if (dateISO < weekStart || dateISO > weekEnd) {
      toast({
        title: "Date outside this week",
        description: `Pick a date between ${formatDDMMYYYY(weekStart)} and ${formatDDMMYYYY(weekEnd)}.`,
      });
      return;
    }

    const nowISO = new Date().toISOString();

    if (customRecurrence === "weekly") {
      // Store as recurring (weekday-based), shows up on any future week on same weekday
      const weekdayIndex = (() => {
        const d = new Date(`${dateISO}T00:00:00`);
        const js = d.getDay(); // 0 Sun..6 Sat
        return (js + 6) % 7; // 0 Mon..6 Sun
      })();

      const rec = {
        id: Date.now().toString(),
        title,
        weekdayIndex,
        timeHHMM,
        presenter,
        startWeekISO: calendarWeekStartISO, // ✅ tie to the calendar week you’re viewing
        createdBy: loggedInUser?.name || "Unknown",
        createdAt: nowISO,
      };

      // Optimistic
      setRecurring((prev) => [rec, ...(prev || [])]);

      // Persist
      fetchJSON(`${API_BASE}/hub/newsroom/recurring`, {
        method: "POST",
        body: JSON.stringify(rec),
      })
        .then(() => {
          toast({ title: "Saved", description: "Weekly recurring item added." });
        })
        .catch((err) => {
          // Rollback
          setRecurring((prev) => (prev || []).filter((x) => x.id !== rec.id));
          toast({
            title: "Save failed",
            description: err?.message || "Could not save recurring item.",
          });
        });
    } else {
      const newItem = {
        id: Date.now().toString(),
        title,
        dateISO,
        timeHHMM,
        presenter,
        createdBy: loggedInUser?.name || "Unknown",
        createdAt: nowISO,
      };

      const nextWeek = {
        ...calendarWeekData,
        oneOff: [newItem, ...(calendarWeekData.oneOff || [])],
      };

      // ✅ Save into the CALENDAR week bucket
      setCalendarWeek(nextWeek);

      toast({ title: "Saved", description: "One-off item added to this week." });
    }

    setCustomTitle("");
    setCustomPresenter("");
  };

  const removeOneOff = (id) => {
    const nextWeek = {
      ...calendarWeekData,
      oneOff: (calendarWeekData.oneOff || []).filter((x) => x.id !== id),
    };
    setCalendarWeek(nextWeek);
    toast({ title: "Removed", description: "One-off item removed." });
  };

  const removeRecurring = (id) => {
    // Optimistic
    const prev = Array.isArray(recurring) ? recurring : [];
    setRecurring(prev.filter((x) => x.id !== id));

    fetchJSON(`${API_BASE}/hub/newsroom/recurring/${id}`, { method: "DELETE" })
      .then(() => {
        toast({ title: "Removed", description: "Weekly recurring item removed." });
      })
      .catch((err) => {
        // Rollback
        setRecurring(prev);
        toast({
          title: "Remove failed",
          description: err?.message || "Could not remove recurring item.",
        });
      });
  };

  /* ===========================
     📅 Calendar build (Mon–Sun)
     - Uses calendarWeekStartISO + calendarWeekData
     =========================== */
  const calendarDays = useMemo(() => {
    const weekStart = calendarWeekStartISO;

    // recurring visible if startWeekISO <= viewed week
    const recurringForWeek = (recurring || []).filter((r) => {
      const startWeek = String(r?.startWeekISO || "");
      return startWeek && startWeek <= weekStart;
    });

    const oneOff = Array.isArray(calendarWeekData.oneOff) ? calendarWeekData.oneOff : [];
    const shows = Array.isArray(calendarWeekData.shows) ? calendarWeekData.shows : [];

    return DAY_LABELS.map((label, dayIndex) => {
      const dateISO = addDaysISO(calendarWeekStartISO, dayIndex);

      // Base daily bulletin (7pm)
      const bulletinPresenter = String(calendarWeekData?.bulletin?.[dayIndex] || "").trim();

      // Saturday & Sunday special slots
      const isSat = dayIndex === 5;
      const isSun = dayIndex === 6;

      const saturdayPresenter = isSat ? String(calendarWeekData?.saturdayProgram || "").trim() : "";
      const sundayPresenter = isSun ? String(calendarWeekData?.sundayRoundup || "").trim() : "";

      // One-offs for this date
      const oneOffItems = oneOff
        .filter((x) => String(x?.dateISO || "") === dateISO)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

      // Recurring items for this weekday
      const recurringItems = recurringForWeek
        .filter((x) => Number(x?.weekdayIndex) === dayIndex)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

      // Shows for this day (daily or matching dayIndex)
      const showItems = shows
        .filter((s) => s?.dayIndex === "daily" || Number(s?.dayIndex) === dayIndex)
        .map((s) => ({
          ...s,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(s?.timeHHMM || "")) ? String(s.timeHHMM) : "19:00",
        }));

      return {
        dayIndex,
        label,
        dateISO,
        bulletinPresenter,
        saturdayPresenter,
        sundayPresenter,
        showItems,
        oneOffItems,
        recurringItems,
      };
    });
  }, [calendarWeekStartISO, calendarWeekData, recurring]);

  const weekCounts = useMemo(() => {
    const oneOffCount = (currentWeek.oneOff || []).length;
    const recurringCount = (recurring || []).length;
    const showsCount = (currentWeek.shows || []).length;
    return { oneOffCount, recurringCount, showsCount };
  }, [currentWeek.oneOff, recurring, currentWeek.shows]);

  return (
    <div className="p-4 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Newsroom Hub</CardTitle>
          <div className="text-sm text-muted-foreground">
            {canEdit ? (
              <span>
                You can <b>edit</b> the newsroom roster and show setup.
              </span>
            ) : (
              <span>View-only: you can see who is presenting each newsroom slot.</span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
                 {/* ===========================
             🗓️ Week selector
             - Calendar: browse any week (Prev/Next/This week)
             =========================== */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={goPrevWeek}>
                ← Prev week
              </Button>
              <Button variant="outline" onClick={goNextWeek}>
                Next week →
              </Button>
              <Button variant="secondary" onClick={goThisWeek}>
                This week
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary">Calendar week</Badge>
              <div className="text-sm font-medium">{weekTitle(calendarWeekStartISO)}</div>
            </div>
          </div>

          {/* ===========================
             ✅ ORDER: Calendar TOP
             =========================== */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Calendar (Week)</div>
              <Badge variant="outline">{calendarDays.length} day(s)</Badge>
            </div>

            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {calendarDays.map((day) => (
                <Card key={day.dateISO} className="rounded-2xl">
                  <CardContent className="p-4 space-y-3">
                    {/* Day label ONLY */}
                    <div className="font-semibold">{day.label}</div>

                    {/* Daily bulletin presenter (no labels) */}
                    {day.bulletinPresenter ? (
                      <Badge variant="outline">{day.bulletinPresenter}</Badge>
                    ) : null}

                    {/* Weekend presenters (no labels) */}
                    {day.dayIndex === 5 && day.saturdayPresenter ? (
                      <Badge variant="outline">{day.saturdayPresenter}</Badge>
                    ) : null}

                    {day.dayIndex === 6 && day.sundayPresenter ? (
                      <Badge variant="outline">{day.sundayPresenter}</Badge>
                    ) : null}

                    {/* Shows (from show setup) */}
                    {day.showItems.length > 0 && (
                      <div className="space-y-2">
                        {day.showItems.map((s) => (
                          <div key={s.id} className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{String(s.title || "Untitled")}</div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{String(s.timeHHMM || "19:00")}</Badge>
                                <Badge variant="secondary">{String(s.presenter || "—")}</Badge>
                              </div>
                            </div>

                            {canEdit && (
                              <Button variant="destructive" size="sm" onClick={() => removeShow(s.id)}>
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recurring items */}
                    {day.recurringItems.length > 0 && (
                      <div className="space-y-2">
                        {day.recurringItems.map((r) => (
                          <div key={r.id} className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{String(r.title || "Untitled")}</div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{String(r.timeHHMM || "19:00")}</Badge>
                                <Badge variant="secondary">{String(r.presenter || "—")}</Badge>
                              </div>
                            </div>

                            {canEdit && (
                              <Button variant="destructive" size="sm" onClick={() => removeRecurring(r.id)}>
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* One-offs */}
                    {day.oneOffItems.length > 0 && (
                      <div className="space-y-2">
                        {day.oneOffItems.map((it) => (
                          <div key={it.id} className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{String(it.title || "Untitled")}</div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{String(it.timeHHMM || "19:00")}</Badge>
                                <Badge variant="secondary">{String(it.presenter || "—")}</Badge>
                              </div>
                            </div>

                            {canEdit && (
                              <Button variant="destructive" size="sm" onClick={() => removeOneOff(it.id)}>
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Empty state */}
                    {day.showItems.length === 0 &&
                      day.recurringItems.length === 0 &&
                      day.oneOffItems.length === 0 &&
                      !day.bulletinPresenter &&
                      !(day.dayIndex === 5 && day.saturdayPresenter) &&
                      !(day.dayIndex === 6 && day.sundayPresenter) && (
                        <div className="text-sm text-muted-foreground">No assignments</div>
                      )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

                            {/* ===========================
             📰 Newsroom Weekly Presenter Roster (Mon–Sun)
             - Days = horizontal
             - Shows = vertical
             - Aktyalite (Mon–Fri)
             - Focus (Sat)
             - Aktyalite Lasemenn (Sun)
             =========================== */}
          <div className="space-y-3">
            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Presenter Roster (Mon → Sun)</div>

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Week</Label>
                <span className="text-xs text-muted-foreground">Current</span>
                <Switch
                  checked={presenterNextWeek}
                  onCheckedChange={(v) => setPresenterNextWeek(Boolean(v))}
                  disabled={isLoading}
                />
                <span className="text-xs text-muted-foreground">Next</span>
              </div>
            </div>

            <Card className="rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <div className="text-sm text-muted-foreground">
                  {canEdit ? "Pick presenters for each show/day." : "View-only: presenters assigned for each show/day."}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-background text-left text-xs font-semibold text-muted-foreground border-b p-2 min-w-[190px]">
                          Show
                        </th>

                        {DAY_LABELS.map((label, i) => {
                          // ✅ Presenter header follows presenter week
                          const raw = String(weekStartISO || "").trim();
                          const baseISO =
                            /^\d{8}$/.test(raw)
                              ? `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`
                              : raw;

                          const dayISO = addDaysISO(baseISO, i);
                          const dayLabel = formatDDMMYYYY(dayISO);

                          return (
                            <th
                              key={label}
                              className="text-left text-xs font-semibold text-muted-foreground border-b p-2 min-w-[150px]"
                              title={dayLabel}
                            >
                              <div className="flex flex-col">
                                <span>{label}</span>
                                <span className="text-[11px] text-muted-foreground">{dayLabel}</span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>

                    <tbody>
                      {/* ===========================
                         🗞️ Aktyalite (Mon–Fri)
                         Uses: currentWeek.bulletin[0..4]
                         =========================== */}
                      <tr>
                        <td className="sticky left-0 z-10 bg-background border-b p-2 align-top">
                          <div className="font-medium">Aktyalite</div>
                          <div className="text-xs text-muted-foreground">Mon–Fri</div>
                        </td>

                        {DAY_LABELS.map((_, dayIndex) => {
                          const isActive = dayIndex >= 0 && dayIndex <= 4; // Mon..Fri
                          const value = isActive ? String(currentWeek?.bulletin?.[dayIndex] || "") : "";

                          return (
                            <td key={`aktyalite-${dayIndex}`} className="border-b p-2 align-top">
                              {isActive ? (
                                canEdit ? (
                                  <select
                                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                                    value={value}
                                    onChange={(e) => setBulletin(dayIndex, e.target.value)}
                                  >
                                    <option value="">— Select —</option>
                                    {[...new Set([...(Array.isArray(presenterOptions) ? presenterOptions : []), "Clive Camille"])].map(
                                      (name) => (
                                        <option key={name} value={name}>
                                          {name}
                                        </option>
                                      )
                                    )}
                                  </select>
                                ) : (
                                  <div className="text-sm">{value.trim() || "—"}</div>
                                )
                              ) : (
                                <div className="text-sm text-muted-foreground">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      {/* ===========================
                         🎯 Focus (Saturday)
                         Uses: currentWeek.saturdayProgram
                         =========================== */}
                      <tr>
                        <td className="sticky left-0 z-10 bg-background border-b p-2 align-top">
                          <div className="font-medium">Focus</div>
                          <div className="text-xs text-muted-foreground">Saturday</div>
                        </td>

                        {DAY_LABELS.map((_, dayIndex) => {
                          const isActive = dayIndex === 5; // Sat
                          const value = isActive ? String(currentWeek?.saturdayProgram || "") : "";

                          return (
                            <td key={`focus-${dayIndex}`} className="border-b p-2 align-top">
                              {isActive ? (
                                canEdit ? (
                                  <select
                                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                                    value={value}
                                    onChange={(e) => setSaturdayProgram(e.target.value)}
                                  >
                                    <option value="">— Select —</option>
                                    {[...new Set([...(Array.isArray(presenterOptions) ? presenterOptions : []), "Clive Camille"])].map(
                                      (name) => (
                                        <option key={name} value={name}>
                                          {name}
                                        </option>
                                      )
                                    )}
                                  </select>
                                ) : (
                                  <div className="text-sm">{value.trim() || "—"}</div>
                                )
                              ) : (
                                <div className="text-sm text-muted-foreground">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      {/* ===========================
                         🗞️ Aktyalite Lasemenn (Sunday)
                         Uses: currentWeek.sundayRoundup
                         =========================== */}
                      <tr>
                        <td className="sticky left-0 z-10 bg-background border-b p-2 align-top">
                          <div className="font-medium">Aktyalite Lasemenn</div>
                          <div className="text-xs text-muted-foreground">Sunday</div>
                        </td>

                        {DAY_LABELS.map((_, dayIndex) => {
                          const isActive = dayIndex === 6; // Sun
                          const value = isActive ? String(currentWeek?.sundayRoundup || "") : "";

                          return (
                            <td key={`lasemenn-${dayIndex}`} className="border-b p-2 align-top">
                              {isActive ? (
                                canEdit ? (
                                  <select
                                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                                    value={value}
                                    onChange={(e) => setSundayRoundup(e.target.value)}
                                  >
                                    <option value="">— Select —</option>
                                    {[...new Set([...(Array.isArray(presenterOptions) ? presenterOptions : []), "Clive Camille"])].map(
                                      (name) => (
                                        <option key={name} value={name}>
                                          {name}
                                        </option>
                                      )
                                    )}
                                  </select>
                                ) : (
                                  <div className="text-sm">{value.trim() || "—"}</div>
                                )
                              ) : (
                                <div className="text-sm text-muted-foreground">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===========================
             ✅ ORDER: Show setup BOTTOM
             =========================== */}
          <div className="space-y-3">
            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Show Setup</div>
            </div>

            {/* ===========================
               🎙️ Presenter roster (Shows)
               =========================== */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Presenter Roster</div>
                <Badge variant="outline">{weekCounts.showsCount} show(s)</Badge>
              </div>

              {canEdit && (
                <>
                  <div className="grid gap-2 md:grid-cols-5">
                    <div className="space-y-1 md:col-span-2">
                      <div className="text-sm font-medium">Show name</div>
                      <Input
                        value={showTitle}
                        onChange={(e) => setShowTitle(e.target.value)}
                        placeholder="e.g. Focus, Morning Brief, Aktyalite…"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium">Day</div>
                      <select
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={showDay}
                        onChange={(e) => setShowDay(e.target.value)}
                      >
                        <option value="daily">Daily</option>
                        {DAY_LABELS.map((label, i) => (
                          <option key={label} value={String(i)}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium">Time</div>
                      <Input type="time" value={showTime} onChange={(e) => setShowTime(e.target.value)} />
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium">Presenter</div>
                      <Input
                        list="newsroom-presenters"
                        value={showPresenter}
                        onChange={(e) => setShowPresenter(e.target.value)}
                        placeholder="Start typing…"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button onClick={addShow}>Add Show</Button>
                  </div>
                </>
              )}

              {(currentWeek.shows || []).length > 0 ? (
                <Card className="rounded-2xl">
                  <CardContent className="p-4 space-y-3">
                    <div className="text-sm font-medium">Current line-up</div>

                    <div className="space-y-2">
                      {(currentWeek.shows || []).map((s) => {
                        const safeTime = /^\d{2}:\d{2}$/.test(String(s?.timeHHMM || ""))
                          ? String(s.timeHHMM)
                          : "19:00";

                        return (
                          <div
                            key={s.id}
                            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{String(s.title || "Untitled")}</div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{safeTime}</Badge>
                                <Badge variant="secondary">{String(s.presenter || "—")}</Badge>
                                <Badge variant="outline">
                                  {s.dayIndex === "daily"
                                    ? "Daily"
                                    : DAY_LABELS[Number(s.dayIndex)] || String(s.dayIndex)}
                                </Badge>
                              </div>

                              {canEdit && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    className="rounded-md border bg-background px-2 py-1 text-sm"
                                    value={s.dayIndex === "daily" ? "daily" : String(s.dayIndex)}
                                    onChange={(e) => updateShowDay(s.id, e.target.value)}
                                  >
                                    <option value="daily">Daily</option>
                                    {DAY_LABELS.map((label, i) => (
                                      <option key={label} value={String(i)}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>

                                  <Input
                                    className="w-[140px]"
                                    type="time"
                                    value={safeTime}
                                    onChange={(e) => updateShowTime(s.id, e.target.value)}
                                  />

                                  <Input
                                    className="w-[220px]"
                                    list="newsroom-presenters"
                                    value={String(s.presenter || "")}
                                    onChange={(e) => updateShowPresenter(s.id, e.target.value)}
                                    placeholder="Presenter…"
                                  />
                                </div>
                              )}
                            </div>

                            {canEdit && (
                              <Button variant="destructive" size="sm" onClick={() => removeShow(s.id)}>
                                Remove
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No shows in the roster yet.
                  {canEdit ? " Add one above." : ""}
                </div>
              )}
            </div>

            {/* ===========================
               ➕ Add News / Program (one-off / recurring)
               =========================== */}
            {canEdit && (
              <div className="space-y-3">
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Add News / Program</div>
                  <Badge variant="secondary">One-off or Weekly</Badge>
                </div>

                <div className="grid gap-2 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-2">
                    <div className="text-sm font-medium">Title</div>
                    <Input
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="e.g. One-off Interview, Special Bulletin, Feature…"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Date (this week)</div>
                    <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Time</div>
                    <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Presenter</div>
                    <Input
                      list="newsroom-presenters"
                      value={customPresenter}
                      onChange={(e) => setCustomPresenter(e.target.value)}
                      placeholder="Start typing…"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Recurrence</div>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={customRecurrence}
                      onChange={(e) => setCustomRecurrence(e.target.value)}
                    >
                      <option value="one-off">One-off</option>
                      <option value="weekly">Weekly (same weekday)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={addCustom}>Add to Calendar</Button>
                  <Badge variant="outline">
                    {weekCounts.oneOffCount} one-off • {weekCounts.recurringCount} recurring
                  </Badge>
                </div>
              </div>
            )}

            <datalist id="newsroom-presenters">
              {presenterOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
