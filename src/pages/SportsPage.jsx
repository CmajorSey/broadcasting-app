import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getSectionPermissions } from "@/lib/permissions";

/* ===========================
   🧠 Local Storage (v2)
   =========================== */
const LS_KEY = "hub_sports_presenters_v2";

/* ===========================
   🗓️ Date helpers (Monday week)
   =========================== */
const toISO = (d) => {
  try {
    const x = new Date(d);
    if (isNaN(x.getTime())) return "";
    return x.toISOString().slice(0, 10);
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

const load = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") {
      return { weeks: {}, recurring: [] };
    }
    return {
      weeks: parsed.weeks && typeof parsed.weeks === "object" ? parsed.weeks : {},
      recurring: Array.isArray(parsed.recurring) ? parsed.recurring : [],
    };
  } catch {
    return { weeks: {}, recurring: [] };
  }
};

const save = (data) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ===========================
   🧾 Default week shape
   =========================== */
const makeEmptyWeek = () => ({
  /* ===========================
     🏟️ Sports Plus (Mon–Fri)
     =========================== */
  sportsPlus: {
    0: "", // Mon
    1: "",
    2: "",
    3: "",
    4: "", // Fri
    5: "", // Sat (unused)
    6: "", // Sun (unused)
  },

  /* ===========================
     🎙️ Optional show setup (like Newsroom)
     - Stored per-week
     - dayIndex: number|"daily"
     =========================== */
  // { id, title, dayIndex: number|"daily", timeHHMM, presenter, createdBy, createdAt }
  shows: [],

  /* ===========================
     🗓️ One-offs for this week
     - e.g. Sports Talk (not fixed)
     =========================== */
  // { id, title, dateISO, timeHHMM, presenter, createdBy, createdAt }
  oneOff: [],
});

export default function SportsPage({ loggedInUser, users = [] }) {
  const { toast } = useToast();
  const { canEdit } = getSectionPermissions("sports", loggedInUser);

  /* ===========================
     📦 Store
     =========================== */
  const [store, setStore] = useState(() => load());

  /* ===========================
     🗓️ Calendar view + navigation
     - Week view (Mon–Sun)
     - Month view (Mon–Sun grid)
     =========================== */
  const [calendarView, setCalendarView] = useState("week"); // week | month

  // Week navigation anchor (Monday)
  const [weekStartISO, setWeekStartISO] = useState(() => getMondayISO(new Date()));

  // Month navigation anchor (1st of month)
  const [monthStartISO, setMonthStartISO] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return toISO(d);
  });

  /* ===========================
     ➕ Calendar add form (one-off / weekly)
     =========================== */
  const [customTitle, setCustomTitle] = useState("");
  const [customDate, setCustomDate] = useState(() => "");
  const [customTime, setCustomTime] = useState("19:00");
  const [customPresenter, setCustomPresenter] = useState("");
  const [customRecurrence, setCustomRecurrence] = useState("one-off"); // one-off | weekly

  /* ===========================
     🎙️ Show setup form (optional)
     =========================== */
  const [showTitle, setShowTitle] = useState("");
  const [showDay, setShowDay] = useState("daily"); // daily | "0".."6"
  const [showTime, setShowTime] = useState("19:00");
  const [showPresenter, setShowPresenter] = useState("");

  useEffect(() => {
    save(store);
  }, [store]);

  useEffect(() => {
    // Default the custom date to the currently viewed Monday if empty
    if (!customDate) setCustomDate(weekStartISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartISO]);

  /* ===========================
     👤 Presenter options (Sports)
     - Sports journalists only
     =========================== */
  const presenterOptions = useMemo(() => {
    return (users || [])
      .filter((u) => {
        const name = String(u?.name || "").trim();
        const desc = String(u?.description || "").trim().toLowerCase();
        if (!name) return false;

        // Keep only sports journalists (sports + journalist)
        const isJournalist = desc.includes("journalist");
        const isSports = desc.includes("sports");
        if (!isJournalist) return false;
        if (!isSports) return false;

        // Exclude the generic Admin account if present
        if (name.toLowerCase() === "admin") return false;

        return true;
      })
      .map((u) => String(u?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [users]);

  const currentWeek = useMemo(() => {
    const existing = store.weeks?.[weekStartISO];
    return existing && typeof existing === "object" ? existing : makeEmptyWeek();
  }, [store.weeks, weekStartISO]);

  const setWeek = (nextWeekObj) => {
    setStore((prev) => ({
      ...prev,
      weeks: {
        ...(prev.weeks || {}),
        [weekStartISO]: nextWeekObj,
      },
    }));
  };

  /* ===========================
     🔄 Week controls
     =========================== */
  const goPrevWeek = () => {
    const d = new Date(`${weekStartISO}T00:00:00`);
    d.setDate(d.getDate() - 7);
    setWeekStartISO(toISO(d));
  };

  const goNextWeek = () => {
    const d = new Date(`${weekStartISO}T00:00:00`);
    d.setDate(d.getDate() + 7);
    setWeekStartISO(toISO(d));
  };

  /* ===========================
     🧑‍💼 Sports Plus setters (Mon–Fri)
     =========================== */
  const setSportsPlus = (dayIndex, name) => {
    const next = {
      ...currentWeek,
      sportsPlus: {
        ...(currentWeek.sportsPlus || {}),
        [dayIndex]: name,
      },
    };
    setWeek(next);
  };

  /* ===========================
     🎙️ Shows actions (optional)
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
    toast({ title: "Saved", description: "Show added to Sports roster." });
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
     - Sports Talk is typically a one-off
     =========================== */
  const addCustom = () => {
    const title = (customTitle || "").trim();
    const dateISO = toISO(customDate);
    const timeHHMM = String(customTime || "").trim();
    const presenter = (customPresenter || "").trim();

    if (!title) {
      toast({ title: "Missing title", description: "Please enter a program title." });
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

    const nowISO = new Date().toISOString();

    if (customRecurrence === "weekly") {
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
        startWeekISO: weekStartISO,
        createdBy: loggedInUser?.name || "Unknown",
        createdAt: nowISO,
      };

      setStore((prev) => ({
        ...prev,
        recurring: [rec, ...(prev.recurring || [])],
      }));

      toast({ title: "Saved", description: "Weekly recurring item added." });
    } else {
      // ✅ One-offs can be ANY date: save into the week-bucket that contains that date
      const bucketWeekISO = getMondayISO(new Date(`${dateISO}T00:00:00`));
      const bucketWeek =
        store.weeks?.[bucketWeekISO] && typeof store.weeks?.[bucketWeekISO] === "object"
          ? store.weeks[bucketWeekISO]
          : makeEmptyWeek();

      const newItem = {
        id: Date.now().toString(),
        title,
        dateISO,
        timeHHMM,
        presenter,
        createdBy: loggedInUser?.name || "Unknown",
        createdAt: nowISO,
      };

      setStore((prev) => ({
        ...prev,
        weeks: {
          ...(prev.weeks || {}),
          [bucketWeekISO]: {
            ...bucketWeek,
            oneOff: [newItem, ...(bucketWeek.oneOff || [])],
          },
        },
      }));

      toast({ title: "Saved", description: "One-off item added to the calendar." });
    }

    setCustomTitle("");
    setCustomPresenter("");
  };

  const removeOneOff = (id) => {
    const nextWeek = {
      ...currentWeek,
      oneOff: (currentWeek.oneOff || []).filter((x) => x.id !== id),
    };
    setWeek(nextWeek);
    toast({ title: "Removed", description: "One-off item removed." });
  };

  const removeRecurring = (id) => {
    setStore((prev) => ({
      ...prev,
      recurring: (prev.recurring || []).filter((x) => x.id !== id),
    }));
    toast({ title: "Removed", description: "Weekly recurring item removed." });
  };

    /* ===========================
     📅 Calendar build
     - Week view: Mon–Sun (current week)
     - Month view: Mon–Sun grid (shows items across weeks)
     =========================== */

  const allOneOffItems = useMemo(() => {
    const weeksObj = store.weeks || {};
    const weeks = Object.values(weeksObj);
    const flat = [];
    for (const w of weeks) {
      const list = Array.isArray(w?.oneOff) ? w.oneOff : [];
      for (const it of list) flat.push(it);
    }
    return flat;
  }, [store.weeks]);

  const getWeekForDateISO = (dateISO) => {
    const wk = getMondayISO(new Date(`${dateISO}T00:00:00`));
    const existing = store.weeks?.[wk];
    return existing && typeof existing === "object" ? existing : makeEmptyWeek();
  };

  const calendarDays = useMemo(() => {
    const weekStart = weekStartISO;

    const recurringForWeek = (store.recurring || []).filter((r) => {
      const startWeek = String(r?.startWeekISO || "");
      return startWeek && startWeek <= weekStart;
    });

    const oneOff = Array.isArray(currentWeek.oneOff) ? currentWeek.oneOff : [];
    const shows = Array.isArray(currentWeek.shows) ? currentWeek.shows : [];

    return DAY_LABELS.map((label, dayIndex) => {
      const dateISO = addDaysISO(weekStartISO, dayIndex);

      const sportsPlusPresenter =
        dayIndex <= 4 ? String(currentWeek?.sportsPlus?.[dayIndex] || "").trim() : "";

      const oneOffItems = oneOff
        .filter((x) => String(x?.dateISO || "") === dateISO)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

      const recurringItems = recurringForWeek
        .filter((x) => Number(x?.weekdayIndex) === dayIndex)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

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
        sportsPlusPresenter,
        showItems,
        oneOffItems,
        recurringItems,
      };
    });
  }, [weekStartISO, currentWeek, store.recurring]);

  const monthCells = useMemo(() => {
    // Anchor: first of selected month
    const firstOfMonth = new Date(`${monthStartISO}T00:00:00`);
    if (isNaN(firstOfMonth.getTime())) return [];

    const year = firstOfMonth.getFullYear();
    const month = firstOfMonth.getMonth();

    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);

    // Start grid at Monday of week containing the 1st
    const gridStartISO = getMondayISO(first);

    // End grid at Sunday of week containing the last day
    const lastJs = last.getDay(); // 0 Sun..6 Sat
    const lastMonIndex = (lastJs + 6) % 7; // 0 Mon..6 Sun
    const gridEndISO = addDaysISO(toISO(last), 6 - lastMonIndex);

    const start = new Date(`${gridStartISO}T00:00:00`);
    const end = new Date(`${gridEndISO}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

    const days = [];
    const cursor = new Date(start.getTime());
    while (toISO(cursor) <= toISO(end) && days.length < 60) {
      const dateISO = toISO(cursor);
      const js = cursor.getDay(); // 0 Sun..6 Sat
      const dayIndex = (js + 6) % 7; // 0 Mon..6 Sun
      const inMonth = cursor.getMonth() === month;

      const weekObj = getWeekForDateISO(dateISO);

      const sportsPlusPresenter =
        dayIndex <= 4 ? String(weekObj?.sportsPlus?.[dayIndex] || "").trim() : "";

      const shows = Array.isArray(weekObj.shows) ? weekObj.shows : [];
      const showItems = shows
        .filter((s) => s?.dayIndex === "daily" || Number(s?.dayIndex) === dayIndex)
        .map((s) => ({
          ...s,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(s?.timeHHMM || "")) ? String(s.timeHHMM) : "19:00",
        }));

      const recurringForDate = (store.recurring || []).filter((r) => {
        const startWeek = String(r?.startWeekISO || "");
        return startWeek && startWeek <= getMondayISO(new Date(`${dateISO}T00:00:00`));
      });

      const recurringItems = recurringForDate
        .filter((x) => Number(x?.weekdayIndex) === dayIndex)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

      const oneOffItems = allOneOffItems
        .filter((x) => String(x?.dateISO || "") === dateISO)
        .map((x) => ({
          ...x,
          timeHHMM: /^\d{2}:\d{2}$/.test(String(x?.timeHHMM || "")) ? String(x.timeHHMM) : "19:00",
        }));

      days.push({
        dateISO,
        inMonth,
        dayIndex,
        dayNumber: new Date(`${dateISO}T00:00:00`).getDate(),
        sportsPlusPresenter,
        showItems,
        recurringItems,
        oneOffItems,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }, [monthStartISO, store.weeks, store.recurring, allOneOffItems]);

  const goPrevMonth = () => {
    const d = new Date(`${monthStartISO}T00:00:00`);
    if (isNaN(d.getTime())) return;
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    setMonthStartISO(toISO(d));
  };

  const goNextMonth = () => {
    const d = new Date(`${monthStartISO}T00:00:00`);
    if (isNaN(d.getTime())) return;
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    setMonthStartISO(toISO(d));
  };

  const weekCounts = useMemo(() => {
    const oneOffCount = (currentWeek.oneOff || []).length;
    const recurringCount = (store.recurring || []).length;
    const showsCount = (currentWeek.shows || []).length;
    return { oneOffCount, recurringCount, showsCount };
  }, [currentWeek.oneOff, store.recurring, currentWeek.shows]);

  return (
    <div className="p-4 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Sports Hub</CardTitle>
          <div className="text-sm text-muted-foreground">
            {canEdit ? (
              <span>
                You can <b>edit</b> the Sports roster and calendar.
              </span>
            ) : (
              <span>View-only: you can see the Sports weekly line-up.</span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
            {/* ===========================
             🗓️ Calendar Controls (Week / Month)
             =========================== */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={calendarView === "week" ? "default" : "outline"}
                onClick={() => setCalendarView("week")}
              >
                Week
              </Button>
              <Button
                variant={calendarView === "month" ? "default" : "outline"}
                onClick={() => setCalendarView("month")}
              >
                Month
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary">{calendarView === "week" ? "Week" : "Month"}</Badge>

              {calendarView === "week" ? (
                <div className="text-sm font-medium">{weekTitle(weekStartISO)}</div>
              ) : (
                <div className="text-sm font-medium">
                  {(() => {
                    const d = new Date(`${monthStartISO}T00:00:00`);
                    if (isNaN(d.getTime())) return "Month";
                    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* ===========================
             🧭 Navigation (changes by view)
             =========================== */}
          {calendarView === "week" ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={goPrevWeek}>
                ← Prev week
              </Button>
              <Button variant="outline" onClick={goNextWeek}>
                Next week →
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={goPrevMonth}>
                ← Prev month
              </Button>
              <Button variant="outline" onClick={goNextMonth}>
                Next month →
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  const d = new Date();
                  d.setDate(1);
                  setMonthStartISO(toISO(d));
                }}
              >
                This month
              </Button>
            </div>
          )}

          {/* ===========================
             ✅ ORDER: Calendar TOP
             - Week view (cards)
             - Month view (grid)
             =========================== */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Calendar ({calendarView === "week" ? "Week" : "Month"})</div>
              <Badge variant="outline">
                {calendarView === "week" ? `${calendarDays.length} day(s)` : `${monthCells.length} cell(s)`}
              </Badge>
            </div>

            {/* ===========================
               📆 WEEK VIEW
               =========================== */}
            {calendarView === "week" ? (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {calendarDays.map((day) => (
                  <Card key={day.dateISO} className="rounded-2xl">
                    <CardContent className="p-4 space-y-3">
                      {/* Day label ONLY */}
                      <div className="font-semibold">{day.label}</div>

                      {/* Sports Plus (Mon–Fri) */}
                      {day.dayIndex <= 4 && day.sportsPlusPresenter ? (
                        <Badge variant="outline">{day.sportsPlusPresenter}</Badge>
                      ) : null}

                      {/* Shows (optional roster adds) */}
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
                        !(day.dayIndex <= 4 && day.sportsPlusPresenter) && (
                          <div className="text-sm text-muted-foreground">No assignments</div>
                        )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}

            {/* ===========================
               🗓️ MONTH VIEW
               - Mon → Sun columns
               =========================== */}
            {calendarView === "month" ? (
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-2">
                  {DAY_LABELS.map((d) => (
                    <div key={`month-head-${d}`} className="text-xs font-semibold text-muted-foreground px-1">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {monthCells.map((cell) => (
                    <Card
                      key={cell.dateISO}
                      className={`rounded-2xl ${cell.inMonth ? "" : "opacity-50"} `}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold">{cell.dayNumber}</div>
                          <div className="text-[11px] text-muted-foreground">{formatDDMMYYYY(cell.dateISO)}</div>
                        </div>

                        {/* Sports Plus (Mon–Fri) */}
                        {cell.dayIndex <= 4 && cell.sportsPlusPresenter ? (
                          <Badge variant="outline" className="w-fit">
                            {cell.sportsPlusPresenter}
                          </Badge>
                        ) : null}

                        {/* Shows */}
                        {cell.showItems.length > 0 && (
                          <div className="space-y-1">
                            {cell.showItems.slice(0, 3).map((s) => (
                              <div key={s.id} className="space-y-1">
                                <div className="text-xs font-medium">{String(s.title || "Untitled")}</div>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline" className="text-[11px] px-2 py-0.5">
                                    {String(s.timeHHMM || "19:00")}
                                  </Badge>
                                  <Badge variant="secondary" className="text-[11px] px-2 py-0.5">
                                    {String(s.presenter || "—")}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                            {cell.showItems.length > 3 && (
                              <div className="text-xs text-muted-foreground">+{cell.showItems.length - 3} more</div>
                            )}
                          </div>
                        )}

                        {/* Recurring */}
                        {cell.recurringItems.length > 0 && (
                          <div className="space-y-1">
                            {cell.recurringItems.slice(0, 3).map((r) => (
                              <div key={r.id} className="space-y-1">
                                <div className="text-xs font-medium">{String(r.title || "Untitled")}</div>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline" className="text-[11px] px-2 py-0.5">
                                    {String(r.timeHHMM || "19:00")}
                                  </Badge>
                                  <Badge variant="secondary" className="text-[11px] px-2 py-0.5">
                                    {String(r.presenter || "—")}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                            {cell.recurringItems.length > 3 && (
                              <div className="text-xs text-muted-foreground">
                                +{cell.recurringItems.length - 3} more
                              </div>
                            )}
                          </div>
                        )}

                        {/* One-offs */}
                        {cell.oneOffItems.length > 0 && (
                          <div className="space-y-1">
                            {cell.oneOffItems.slice(0, 3).map((it) => (
                              <div key={it.id} className="space-y-1">
                                <div className="text-xs font-medium">{String(it.title || "Untitled")}</div>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline" className="text-[11px] px-2 py-0.5">
                                    {String(it.timeHHMM || "19:00")}
                                  </Badge>
                                  <Badge variant="secondary" className="text-[11px] px-2 py-0.5">
                                    {String(it.presenter || "—")}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                            {cell.oneOffItems.length > 3 && (
                              <div className="text-xs text-muted-foreground">+{cell.oneOffItems.length - 3} more</div>
                            )}
                          </div>
                        )}

                        {/* Empty */}
                        {cell.showItems.length === 0 &&
                          cell.recurringItems.length === 0 &&
                          cell.oneOffItems.length === 0 &&
                          !(cell.dayIndex <= 4 && cell.sportsPlusPresenter) && (
                            <div className="text-xs text-muted-foreground">No assignments</div>
                          )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* ===========================
             🏟️ Sports Weekly Presenter Roster (Mon–Sun)
             - Sports Plus (Mon–Fri)
             =========================== */}
          <div className="space-y-3">
            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Presenter Roster (Mon → Sun)</div>
              <Badge variant="outline">Excel style</Badge>
            </div>

            <Card className="rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <div className="text-sm text-muted-foreground">
                  {canEdit ? "Pick presenters for Sports Plus (Mon–Fri)." : "View-only: Sports Plus presenter assignments."}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-background text-left text-xs font-semibold text-muted-foreground border-b p-2 min-w-[190px]">
                          Show
                        </th>

                        {DAY_LABELS.map((label, i) => (
                          <th
                            key={label}
                            className="text-left text-xs font-semibold text-muted-foreground border-b p-2 min-w-[150px]"
                            title={formatDDMMYYYY(addDaysISO(weekStartISO, i))}
                          >
                            <div className="flex flex-col">
                              <span>{label}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDDMMYYYY(addDaysISO(weekStartISO, i))}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {/* ===========================
                         🏟️ Sports Plus (Mon–Fri)
                         Uses: currentWeek.sportsPlus[0..4]
                         =========================== */}
                      <tr>
                        <td className="sticky left-0 z-10 bg-background border-b p-2 align-top">
                          <div className="font-medium">Sports Plus</div>
                          <div className="text-xs text-muted-foreground">Mon–Fri</div>
                        </td>

                        {DAY_LABELS.map((_, dayIndex) => {
                          const isActive = dayIndex >= 0 && dayIndex <= 4; // Mon..Fri
                          const value = isActive ? String(currentWeek?.sportsPlus?.[dayIndex] || "") : "";

                          return (
                            <td key={`sportsplus-${dayIndex}`} className="border-b p-2 align-top">
                              {isActive ? (
                                canEdit ? (
                                  <select
                                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                                    value={value}
                                    onChange={(e) => setSportsPlus(dayIndex, e.target.value)}
                                  >
                                    <option value="">— Select —</option>
                                    {(Array.isArray(presenterOptions) ? presenterOptions : []).map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
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

                <div className="text-xs text-muted-foreground">
                  Note: dropdown list is restricted to Sports journalists only.
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===========================
             ✅ ORDER: Show setup BOTTOM
             - Keep for future growth (optional)
             =========================== */}
          <div className="space-y-3">
            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Show Setup</div>
              <Badge variant="secondary">Shows + Calendar Adds</Badge>
            </div>

            {/* ===========================
               🎙️ Presenter roster (Shows)
               =========================== */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Presenter Roster (Shows)</div>
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
                        placeholder="e.g. Sports Talk, Weekend Review…"
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
                        list="sports-presenters"
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
                        const safeTime = /^\d{2}:\d{2}$/.test(String(s?.timeHHMM || "")) ? String(s.timeHHMM) : "19:00";

                        return (
                          <div key={s.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{String(s.title || "Untitled")}</div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{safeTime}</Badge>
                                <Badge variant="secondary">{String(s.presenter || "—")}</Badge>
                                <Badge variant="outline">
                                  {s.dayIndex === "daily" ? "Daily" : DAY_LABELS[Number(s.dayIndex)] || String(s.dayIndex)}
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
                                    list="sports-presenters"
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
               ➕ Add Sports Item (one-off / recurring)
               =========================== */}
            {canEdit && (
              <div className="space-y-3">
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Add Sports Item</div>
                  <Badge variant="secondary">One-off or Weekly</Badge>
                </div>

                <div className="grid gap-2 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-2">
                    <div className="text-sm font-medium">Title</div>
                    <Input
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="e.g. Sports Talk, Special Interview, Match Coverage…"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Date</div>
                    </div>
                    <Input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Time</div>
                    <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium">Presenter</div>
                    <Input
                      list="sports-presenters"
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

            <datalist id="sports-presenters">
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
