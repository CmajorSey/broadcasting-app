import { useState, useEffect } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import API_BASE from "@/api";
import { useMemo } from "react";

export default function OperationsPage({
  users = [],
  setUsers = () => {},
  tickets = [],
  loggedInUser
}) {
  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const weekOptions = useMemo(() => {
  const baseMonday = getWeekStart(new Date());
  return Array.from({ length: 4 }).map((_, i) => {
    const weekStart = new Date(baseMonday.getTime() + i * 7 * 86400000);
    return {
      label: `Week of ${weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      })}`,
      value: weekStart.toISOString().slice(0, 10)
    };
  });
}, []);

const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
  const stored = localStorage.getItem("selectedWeekStart");
  const baseDate = stored ? new Date(stored) : new Date();
  const monday = getWeekStart(baseDate).toISOString().slice(0, 10);
  const validWeek = weekOptions.find((w) => w.value === monday);
  return validWeek ? monday : weekOptions[0]?.value || "";
});


  const [roster, setRoster] = useState([]);
  const [editingRoster, setEditingRoster] = useState(null);

  function getWeekDates(weekStartIso) {
    const base = new Date(weekStartIso);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(base.getTime() + i * 86400000);
      dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
  }

  const fetchRoster = async (weekStart) => {
  try {
    const res = await fetch(`${API_BASE}/rosters/${weekStart}`);
    const contentType = res.headers.get("content-type");

    if (!res.ok || !contentType?.includes("application/json")) {
      throw new Error("Invalid JSON response");
    }

    const data = await res.json();
    console.log("Roster:", data);

    const weekDates = getWeekDates(weekStart);
    const completeWeek = weekDates.map((date) => {
      const existing = data.find((d) => d.date === date);
      return (
        existing || {
          date,
          primary: [],
          backup: [],
          otherOnDuty: [],
          afternoonShift: [],
          off: [],
        }
      );
    });

   // Ensure Monday to Sunday order regardless of API data order
const sorted = [...completeWeek].sort((a, b) => {
  const dayA = new Date(a.date).getDay();
  const dayB = new Date(b.date).getDay();
  // Map Sunday (0) to 7 so Monday is always first
  const correctedA = dayA === 0 ? 7 : dayA;
  const correctedB = dayB === 0 ? 7 : dayB;
  return correctedA - correctedB;
});
setRoster(sorted);

    // Save merged version in case it's a mix of partial data
    saveRoster(weekStart, sorted);
  } catch (err) {
    console.warn("Roster not found, initializing new:", err.message);
    const newWeek = getWeekDates(weekStart).map((date) => ({
      date,
      primary: [],
      backup: [],
      otherOnDuty: [],
      afternoonShift: [],
      off: [],
    }));
    setRoster(newWeek);
    saveRoster(weekStart, newWeek);
  }
};

  const saveRoster = async (weekStart, updatedWeek) => {
    try {
      await fetch(`${API_BASE}/rosters/${weekStart}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedWeek)
      });
    } catch (err) {
      console.error("Failed to save roster:", err);
    }
  };

  console.log("📅 Fetching roster for:", selectedWeekStart);


  useEffect(() => {
  if (!selectedWeekStart || selectedWeekStart === "undefined") return;
  console.log("📅 Fetching roster for:", selectedWeekStart);
  fetchRoster(selectedWeekStart);
  localStorage.setItem("selectedWeekStart", selectedWeekStart);
}, [selectedWeekStart]);

  const excludedNames = ["clive camille", "gilmer philoe","ronny marengo","aaron jean","christopher gabriel"];

const userNameOptions = Array.from(
  new Set(
    users
      .filter((u) => {
        const name = (u.name || "").trim().toLowerCase();
        const hasAllowedRole = u.roles?.includes("camOp") || u.roles?.includes("driver");
        const isExcluded = excludedNames.includes(name);
        return hasAllowedRole && !isExcluded;
      })
      .map((u) => u.name.trim())
  )
);
  console.log("🧾 Roster:", roster);
console.log("📆 selectedWeekStart:", selectedWeekStart);


  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Operations Overview</h2>
      <p className="mb-6 text-muted-foreground">
        Assign duty roles to staff for the selected week.
      </p>

      {/* Week Selector */}
      <div className="mb-4">
        <label className="mr-2 font-medium">Select Week:</label>
        <select
          value={selectedWeekStart}
          onChange={(e) => setSelectedWeekStart(e.target.value)}
          className="border p-1 rounded"
        >
          {weekOptions.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      {/* Weekly Roster Table */}
      <div className="mt-4">
        <h2 className="text-xl font-semibold mb-4">Weekly Roster</h2>
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">News Director</th>
                <th className="px-4 py-2 text-left">Backup</th>
                <th className="px-4 py-2 text-left">Other On Duty</th>
                <th className="px-4 py-2 text-left">Afternoon Shift</th>
                <th className="px-4 py-2 text-left">Off</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((day, index) => (
                <tr key={day.date} className="border-t">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(day.date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      month: "short",
                      day: "numeric"
                    })}
                  </td>
                  {["primary", "backup", "otherOnDuty", "afternoonShift", "off"].map((field) => (
  <td key={field} className="px-4 py-2">
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-full text-left px-2 py-1 border rounded hover:bg-gray-100 cursor-pointer min-h-[38px]">
          {day[field]?.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {day[field]
  .filter((name) => !["clive", "gilmer"].includes(name.toLowerCase()))
  .map((name) => (
    <Badge key={name} variant="outline">
      {name}
    </Badge>
))}

            </div>
          ) : (
            <span className="text-muted-foreground">Select...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search users..." className="h-9" />
          <CommandList>
            {userNameOptions.map((name) => (
  <CommandItem
    key={name}
    onSelect={() => {
      const isSelected = day[field].includes(name);
      const updated = isSelected
        ? day[field].filter((n) => n !== name)
        : [...day[field], name];

      const updatedWeek = roster.map((d, i) =>
        i === index ? { ...d, [field]: updated } : d
      );
      setRoster(updatedWeek);
      saveRoster(selectedWeekStart, updatedWeek);
    }}
  >
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={day[field].includes(name)}
        readOnly
      />
      {name}
    </div>
  </CommandItem>
))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </td>
))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

