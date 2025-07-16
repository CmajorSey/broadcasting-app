import { useState, useEffect } from "react";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import API_BASE from "@/api";

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

  const baseMonday = getWeekStart(new Date());
  const weekOptions = Array.from({ length: 4 }).map((_, i) => {
    const weekStart = new Date(baseMonday.getTime() + i * 7 * 86400000);
    return {
      label: `Week of ${weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      })}`,
      value: weekStart.toISOString().slice(0, 10)
    };
  });

  const [selectedWeekStart, setSelectedWeekStart] = useState(weekOptions[0].value);
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
      if (!res.ok) throw new Error("Roster not found");

      const data = await res.json();
      const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
      setRoster(sorted);
    } catch (err) {
      console.warn("Roster not found, initializing new:", err.message);
      const newWeek = getWeekDates(weekStart).map((date) => ({
        date,
        primary: [],
        backup: [],
        otherOnDuty: [],
        afternoonShift: [],
        off: []
      }));
      setRoster(newWeek);
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

  useEffect(() => {
    fetchRoster(selectedWeekStart);
  }, [selectedWeekStart]);

  const userNameOptions = Array.from(
    new Set(
      users
        .filter((u) => u.roles?.some((role) => role === "camOp" || role === "driver"))
        .map((u) => u.name)
    )
  );

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
              {[...roster].map((day, index) => (
                <tr key={day.date} className="border-t">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(day.date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      month: "short",
                      day: "numeric"
                    })}
                  </td>
                  {["primary", "backup", "otherOnDuty", "afternoonShift", "off"].map(
                    (field) => (
                      <td key={field} className="px-4 py-2 relative">
                        <div
                          role="button"
                          className="w-full text-left px-2 py-1 border rounded hover:bg-gray-100 cursor-pointer"
                          onClick={() =>
                            setEditingRoster((prev) =>
                              prev?.row === index && prev?.field === field
                                ? null
                                : { row: index, field }
                            )
                          }
                        >
                          {day[field]?.length > 0 ? day[field].join(", ") : "Select..."}
                        </div>
                        {editingRoster?.row === index &&
                          editingRoster?.field === field && (
                            <div
                              className="absolute z-50 bg-white border rounded shadow mt-1 max-h-64 overflow-y-auto"
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <MultiSelectCombobox
                                options={userNameOptions}
                                selected={day[field]}
                                autoFocus
                                onChange={(selectedValues) => {
                                  const updatedWeek = [...roster];
                                  updatedWeek[index] = {
                                    ...updatedWeek[index],
                                    [field]: selectedValues
                                  };
                                  setRoster(updatedWeek);
                                  saveRoster(selectedWeekStart, updatedWeek);
                                }}
                              />
                            </div>
                          )}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
