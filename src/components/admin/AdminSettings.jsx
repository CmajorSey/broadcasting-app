// src/pages/AdminSettings.jsx
import { useState, useEffect, useMemo } from "react";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ---------- defaults & helpers ----------
const DEFAULTS = {
  siteName: "",
  holidaySource: {
    provider: "google_calendar", // "google_calendar" | "nager_date" | "ics"
    countryCode: "SC",
    googleCalendarId: "en.sc.official#holiday@group.v.calendar.google.com",
    icsUrl: "",
  },
  rules: {
    after4pmCounts: 0.5,
    saturdayCounts: 1,
    sundayCounts: 1,
    publicHolidayCounts: 3, // preserve your current default
    after4pmOnlyForNonAfternoon: true,
    afternoonShiftRoleKeys: "afternoon,afternoon_shift",
  },
};

const pad2 = (n) => String(n).padStart(2, "0");
const toMonthKey = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const humanDate = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "Invalid date";
    const y = d.getFullYear();
    const m = d.toLocaleString(undefined, { month: "short" });
    const day = d.getDate();
    return `${day} ${m} ${y}`;
  } catch {
    return iso || "Invalid date";
  }
};

// Deep merge `src` into `base`, preserving defaults
function deepMerge(base, src) {
  if (typeof src !== "object" || src === null) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[key] = deepMerge(base[key] ?? {}, v);
    } else if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

// ---------- component ----------
export default function AdminSettings() {
  const { toast } = useToast();

  const [settings, setSettings] = useState(DEFAULTS);
  const [holidays, setHolidays] = useState([]); // [{ date: "YYYY-MM-DD", name }]
  const [holiLoading, setHoliLoading] = useState(false);
  const [holiError, setHoliError] = useState("");

  // Save UX
  const [saving, setSaving] = useState(false);

  // NEW: Year filter UI state
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(String(currentYear)); // "YYYY" or "ALL"

  // Load settings with deep-merge to avoid undefined nested objects
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`, { credentials: "include" });
        if (!res.ok) throw new Error(`GET /settings failed (${res.status})`);
        const data = (await res.json()) || {};
        setSettings((prev) => deepMerge(DEFAULTS, deepMerge(prev, data)));
      } catch (err) {
        console.error("Failed to load settings:", err);
        toast({
          title: "Error",
          description: "Could not load settings from server.",
          variant: "destructive",
        });
      }
    })();
  }, [toast]);

  const fetchHolidays = async () => {
    setHoliLoading(true);
    setHoliError("");
    try {
      const res = await fetch(`${API_BASE}/holidays`, { credentials: "include" });
      if (!res.ok) throw new Error(`GET /holidays failed (${res.status})`);
      const data = await res.json();
      setHolidays(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setHoliError("Could not load holidays from server.");
    } finally {
      setHoliLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Patch only known keys to avoid clobbering other server-managed settings
      const payload = {
        siteName: settings.siteName,
        holidaySource: settings.holidaySource,
        rules: settings.rules,
      };
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`PATCH /settings failed (${res.status})`);
      const updated = await res.json();
      // merge back for resilience
      setSettings((prev) => deepMerge(prev, updated));
      toast({ title: "✅ Saved", description: "Settings updated successfully." });
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to save settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshHolidays = async () => {
    try {
      const res = await fetch(`${API_BASE}/holidays/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("POST /holidays/refresh error:", res.status, txt);
      }
    } catch (err) {
      console.warn("Refresh endpoint not available:", err);
    } finally {
      await fetchHolidays();
      toast({ title: "🔄 Holidays refreshed", description: "Loaded the latest detected dates." });
    }
  };

  // Derive read-only ICS preview for backend fetch (avoid CORS in browser)
  const googleIcsFromId = useMemo(() => {
    const id = settings?.holidaySource?.googleCalendarId || "";
    if (!id) return "";
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
  }, [settings?.holidaySource?.googleCalendarId]);

  // Years available in the loaded data (sorted descending for convenience)
  const availableYears = useMemo(() => {
    const years = new Set();
    for (const h of holidays || []) {
      const y = String(new Date(h?.date).getFullYear());
      if (y && y !== "NaN") years.add(y);
    }
    const arr = Array.from(years);
    arr.sort((a, b) => Number(b) - Number(a)); // newest first
    return arr;
  }, [holidays]);

  // Filtered holidays by selected year (or all)
  const filteredHolidays = useMemo(() => {
    if (!Array.isArray(holidays)) return [];
    if (selectedYear === "ALL") return holidays;
    return holidays.filter((h) => {
      const y = new Date(h?.date).getFullYear();
      return String(y) === String(selectedYear);
    });
  }, [holidays, selectedYear]);

  // Group filtered holidays by YYYY-MM
  const holidaysByMonth = useMemo(() => {
    const grouped = {};
    for (const h of filteredHolidays || []) {
      const key = toMonthKey(h?.date);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(h);
    }
    const entries = Object.entries(grouped).sort(([a], [b]) => (a > b ? 1 : -1));
    for (const [, arr] of entries) {
      arr.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    }
    return entries;
  }, [filteredHolidays]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">⚙️ Settings</h1>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Site Name</Label>
            <Input
              value={settings?.siteName ?? ""}
              onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
              placeholder="Enter login screen title"
            />
          </div>
          {/* Logo intentionally removed for now */}
        </CardContent>
      </Card>

      {/* Public Holidays Source (online, no API keys) */}
      <Card>
        <CardHeader>
          <CardTitle>Public Holidays Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Provider</Label>
            <select
              className="w-full border rounded px-3 py-2"
              value={settings?.holidaySource?.provider ?? "google_calendar"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  holidaySource: {
                    ...(settings?.holidaySource ?? DEFAULTS.holidaySource),
                    provider: e.target.value,
                  },
                })
              }
            >
              <option value="google_calendar">Google Public Holidays (recommended)</option>
              <option value="nager_date">Nager.Date (if country supported)</option>
              <option value="ics">Custom ICS URL</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Choose an online source to auto-pull public holiday dates. No API keys needed here.
            </p>
          </div>

          <div>
            <Label>Country Code</Label>
            <Input
              value={settings?.holidaySource?.countryCode ?? "SC"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  holidaySource: {
                    ...(settings?.holidaySource ?? DEFAULTS.holidaySource),
                    countryCode: e.target.value.toUpperCase(),
                  },
                })
              }
              placeholder="SC"
            />
            <p className="text-xs text-gray-500 mt-1">Used by providers that support country lookup.</p>
          </div>

          <div>
            <Label>Google Calendar ID (optional)</Label>
            <Input
              value={settings?.holidaySource?.googleCalendarId ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  holidaySource: {
                    ...(settings?.holidaySource ?? DEFAULTS.holidaySource),
                    googleCalendarId: e.target.value,
                  },
                })
              }
              onBlur={(e) => {
                const v = String(e.target.value || "").trim();
                if (/^https?:\/\//i.test(v)) {
                  // Auto-convert: user pasted an ICS URL into the ID field
                  setSettings((prev) => ({
                    ...prev,
                    holidaySource: {
                      ...(prev?.holidaySource ?? DEFAULTS.holidaySource),
                      provider: "ics",
                      icsUrl: v,
                      googleCalendarId: "",
                      countryCode:
                        prev?.holidaySource?.countryCode ?? DEFAULTS.holidaySource.countryCode,
                    },
                  }));
                }
              }}
              placeholder="en.sc.official#holiday@group.v.calendar.google.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Prefilled with Seychelles: <code>en.sc.official#holiday@group.v.calendar.google.com</code>
            </p>

            {(() => {
              const id = settings?.holidaySource?.googleCalendarId || "";
              if (!id) return null;
              const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
                id
              )}/public/basic.ics`;
              return (
                <div className="mt-3">
                  <Label className="text-xs">Public ICS URL (server-side fetch only)</Label>
                  <Input value={url} readOnly className="text-[12px]" />
                  <p className="text-xs text-gray-500 mt-1">
                    This URL is blocked by browsers (CORS). Fetch it on the <strong>backend</strong>{" "}
                    (e.g., <code>POST /holidays/refresh</code>), then display results below.
                  </p>
                </div>
              );
            })()}
          </div>

          <div>
            <Label>Custom ICS URL (optional)</Label>
            <Input
              value={settings?.holidaySource?.icsUrl ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  holidaySource: {
                    ...(settings?.holidaySource ?? DEFAULTS.holidaySource),
                    icsUrl: e.target.value,
                  },
                })
              }
              placeholder="https://example.com/public-holidays.ics"
            />
            <p className="text-xs text-gray-500 mt-1">Paste a public iCal/ICS feed if you maintain your own calendar.</p>
          </div>
        </CardContent>
      </Card>

      {/* Detected Public Holidays */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Detected Public Holidays</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            {/* NEW: Year filter */}
            <div className="flex items-center gap-2">
              <Label className="text-sm">Year</Label>
              <select
                className="border rounded px-3 py-2 text-sm"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                <option value="ALL">All years</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchHolidays} disabled={holiLoading}>
                Reload
              </Button>
              <Button onClick={handleRefreshHolidays} disabled={holiLoading}>
                Refresh from Source
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {holiLoading ? (
            <div className="text-sm text-gray-600">Loading…</div>
          ) : holiError ? (
            <div className="text-sm text-red-600">{holiError}</div>
          ) : (filteredHolidays || []).length === 0 ? (
            <div className="text-sm text-gray-600">
              {selectedYear === "ALL"
                ? "No holidays found yet. Click Refresh from Source after saving your source above."
                : `No holidays found for ${selectedYear}. Try a different year or refresh from source.`}
            </div>
          ) : (
            <div className="space-y-4">
              {holidaysByMonth.map(([monthKey, items]) => {
                const monthName = new Date(`${monthKey}-01`).toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                });
                return (
                  <div key={monthKey} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/40 px-3 py-2 text-sm font-medium">{monthName}</div>
                    <div className="divide-y">
                      {items.map((h, idx) => (
                        <div key={`${h.date}-${idx}`} className="px-3 py-2 flex items-center justify-between">
                          <div className="text-sm font-medium">{h?.name || "Unnamed holiday"}</div>
                          <div className="text-sm text-gray-600">{humanDate(h?.date)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* HR Rules */}
      <Card>
        <CardHeader>
          <CardTitle>HR Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* After-4pm applies only to non-afternoon shifts */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="block">After 4PM is extra (non-afternoon shifts only)</Label>
              <p className="text-xs text-gray-500 mt-1">
                If enabled, after-4PM credit is only added when the person was already on duty since morning
                (i.e., NOT scheduled on an afternoon/PM shift).
              </p>
            </div>
            <Switch
              checked={!!settings?.rules?.after4pmOnlyForNonAfternoon}
              onCheckedChange={(val) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    after4pmOnlyForNonAfternoon: !!val,
                  },
                })
              }
            />
          </div>

          {/* Which roles count as afternoon shift */}
          <div>
            <Label>Afternoon shift role keys (comma-separated)</Label>
            <Input
              type="text"
              value={settings?.rules?.afternoonShiftRoleKeys ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    afternoonShiftRoleKeys: e.target.value,
                  },
                })
              }
              placeholder="afternoon,afternoon_shift,pm,evening"
            />
            <p className="text-xs text-gray-500 mt-1">
              These are matched against the duty/roster role key (case-insensitive, trims spaces).
            </p>
          </div>

          <div>
            <Label>After 4PM credit =</Label>
            <Input
              type="number"
              step="0.5"
              value={settings?.rules?.after4pmCounts ?? 0}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    after4pmCounts: +e.target.value,
                  },
                })
              }
            />
            <p className="text-xs text-gray-500 mt-1">
              Credit added when eligible work extends past 16:00 (e.g., 0.5 = half-day).
            </p>
          </div>

          <div>
            <Label>Saturday =</Label>
            <Input
              type="number"
              step="0.5"
              value={settings?.rules?.saturdayCounts ?? 0}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    saturdayCounts: +e.target.value,
                  },
                })
              }
            />
            <p className="text-xs text-gray-500 mt-1">Credit granted for Saturday work.</p>
          </div>

          <div>
            <Label>Sunday =</Label>
            <Input
              type="number"
              step="0.5"
              value={settings?.rules?.sundayCounts ?? 0}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    sundayCounts: +e.target.value,
                  },
                })
              }
            />
            <p className="text-xs text-gray-500 mt-1">Credit granted for Sunday work.</p>
          </div>

          <div>
            <Label>Public Holiday =</Label>
            <Input
              type="number"
              step="0.5"
              value={settings?.rules?.publicHolidayCounts ?? 0}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rules: {
                    ...(settings?.rules ?? DEFAULTS.rules),
                    publicHolidayCounts: +e.target.value,
                  },
                })
              }
            />
            <p className="text-xs text-gray-500 mt-1">
              Credit granted when working on a public holiday (e.g., 3 = three days).
            </p>
          </div>
        </CardContent>

        <CardFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
