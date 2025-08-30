import React, { useState, useEffect, useRef } from "react";
import { Trash2, Pencil, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import DutyBadge from "@/components/DutyBadge";
import API_BASE from "@/api";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent
} from "@/components/ui/popover";

import { Badge } from "@/components/ui/badge";



function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export default function TicketPage({ users, vehicles, loggedInUser }) {
  const [tickets, setTickets] = useState([]);
  const rosterCache = useRef({});

  async function fetchRosterForDate(dateISO) {
    const weekStart = getWeekStart(dateISO);
    if (rosterCache.current[weekStart]) {
      return rosterCache.current[weekStart];
    }

    try {
      const res = await fetch(`${API_BASE}/rosters/${weekStart}`);
      if (!res.ok) throw new Error("Roster not found");
      const data = await res.json();
      rosterCache.current[weekStart] = data;
      return data;
    } catch (err) {
      console.warn("No roster for week:", weekStart);
      return [];
    }
  }

  async function getTodayRoster(dateISO) {
    const week = await fetchRosterForDate(dateISO);
    const day = week.find((d) => d.date === dateISO);
    return day || null;
  }

  function DutyBadgeWrapper({ date, filmingTime, names }) {
    const [duty, setDuty] = useState(null);
    const filmingHour = parseInt(filmingTime?.split(":")[0] || "0", 10);
    const dutyDate = date?.slice(0, 10);

    useEffect(() => {
      if (dutyDate) {
        getTodayRoster(dutyDate).then(setDuty);
      }
    }, [dutyDate]);

    return (
      <div className="flex flex-col gap-1">
        {names.map((name, i) => {
          let badge = null;
          if (duty) {
            if (duty.off?.includes(name)) {
              badge = <DutyBadge label="Off Duty" color="red" />;
            } else if (duty.afternoonShift?.includes(name) && filmingHour < 12) {
              badge = <DutyBadge label="Afternoon Shift" color="yellow" />;
            } else if (duty.primary?.includes(name) && filmingHour >= 14) {
              badge = <DutyBadge label="Directing News" color="blue" />;
            }
          }
          return (
            <div key={i} className="flex items-center justify-center gap-2">
              <span>{name}</span>
              {badge}
            </div>
          );
        })}
      </div>
    );
  }

  const [selectedTickets, setSelectedTickets] = useState([]);
  const [showSelectBoxes, setShowSelectBoxes] = useState(false);
  const [showRecycleModal, setShowRecycleModal] = useState(false);
  const [selectedDeleted, setSelectedDeleted] = useState([]);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [newNotes, setNewNotes] = useState({});
  const [editData, setEditData] = useState({});
  const [expandedRows, setExpandedRows] = useState([]);
  const [expandAll, setExpandAll] = useState(false);
  const isAdmin = loggedInUser?.roles?.includes("admin");
  const isProducer = loggedInUser?.roles?.includes("producer");
  const isDriver = loggedInUser?.roles?.includes("driver");
  const [showArchived, setShowArchived] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const canEditAny = isAdmin || isProducer || loggedInUser?.roles?.includes("journalist");
  const canEditVehicle = isAdmin || isProducer || isDriver;
  const canAddNotes = isAdmin || isDriver;

const handleStatusChange = async (ticketId, newStatus) => {
  try {
    const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentStatus: newStatus }),
    });

    if (!res.ok) throw new Error("Failed to update status");

    const updated = await res.json();
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? updated : t))
    );
  } catch (err) {
    console.error("Error updating status:", err);
  }
};
    // ✅ Fallback users fetch if the `users` prop is empty
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [usersLoadError, setUsersLoadError] = useState(null);

  useEffect(() => {
    if (users && users.length > 0) {
      setRemoteUsers([]);
      setUsersLoadError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/users`, { method: "GET" });
        const raw = await res.json().catch(() => []);
        const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.users) ? raw.users : [];
        if (!cancelled) setRemoteUsers(arr);
      } catch (err) {
        console.error("❌ Failed to fetch users:", err);
        if (!cancelled) setUsersLoadError(err?.message || "Unknown error");
      }
    })();

    return () => { cancelled = true; };
  }, [users]);

  // ✅ Unified users source
  const effectiveUsers = (users && users.length > 0) ? users : remoteUsers;

  // Helpers
  const toLowerRoles = (u) =>
    (Array.isArray(u?.roles) ? u.roles : [u?.role]).map((r) =>
      String(r || "").toLowerCase()
    );
  const nameOf = (u) => String(u?.name || "").trim();

  // ✅ Driver options (flat, no dividers)
const driverOptions = (effectiveUsers || []).filter((u) => {
  const rl = toLowerRoles(u);
  return rl.includes("driver") || rl.includes("driver_limited");
});

// ✅ Build groups for CamOps dropdown with divider lines:
//    Only include users who have the `camOp` role.
//    Then split into:
//      - pure CamOps (not producer/admin)
//      - CamOps who are also Producers
//      - CamOps who are also Admins (bottom)
const camOpsOnly = [];
const camOpsProducers = [];
const camOpsAdmins = [];

(effectiveUsers || []).forEach((u) => {
  const rl = toLowerRoles(u);
  const nm = nameOf(u);
  if (!nm) return;

  // Only eligible if they are CamOps
  if (!rl.includes("camop")) return;

  const isProducer = rl.includes("producer");
  const isAdmin = rl.includes("admin");

  if (isAdmin) camOpsAdmins.push(nm);
  else if (isProducer) camOpsProducers.push(nm);
  else camOpsOnly.push(nm);
});

camOpsOnly.sort();
camOpsProducers.sort();
camOpsAdmins.sort();

// ✅ Flatten into option objects and inject unselectable divider rows
const camOpOptionsWithDividers = [
  ...camOpsOnly.map((name) => ({ label: name, value: name })),
  { label: "––––––––", value: "__divider1", divider: true },

  ...camOpsProducers.map((name) => ({ label: name, value: name })),
  { label: "––––––––", value: "__divider2", divider: true },

  ...camOpsAdmins.map((name) => ({ label: name, value: name })),
];

// Keep label as-is (no text tags). Dividers already have a line as the label.
const camOpOptionsDecorated = camOpOptionsWithDividers;

/* ----------------- NEW: Reporter options (Journalists / Sports Journalists / Producers) ----------------- */

// Group by roles: journalist, sports_journalist, producer
const reportersJournalists = [];
const reportersSports = [];
const reportersProducers = [];

(effectiveUsers || []).forEach((u) => {
  const rl = toLowerRoles(u);
  const nm = nameOf(u);
  if (!nm) return;

  if (rl.includes("journalist")) reportersJournalists.push(nm);
  else if (rl.includes("sports_journalist")) reportersSports.push(nm);
  else if (rl.includes("producer")) reportersProducers.push(nm);
});

reportersJournalists.sort();
reportersSports.sort();
reportersProducers.sort();

// ✅ Flatten into options with divider lines
const reporterOptionsWithDividers = [
  ...reportersJournalists.map((name) => ({ label: name, value: name })),
  { label: "––––––––", value: "__rep_div1", divider: true },

  ...reportersSports.map((name) => ({ label: name, value: name })),
  { label: "––––––––", value: "__rep_div2", divider: true },

  ...reportersProducers.map((name) => ({ label: name, value: name })),
];

// Keep label as-is (no text tags). Dividers already have a line as the label.
const reporterOptionsDecorated = reporterOptionsWithDividers;


 useEffect(() => {
  fetch(`${API_BASE}/tickets`)
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return await res.json();
    })
    .then((data) => {
      setTickets(data); // include all tickets: active, deleted, and archived
    })
    .catch((err) => {
      console.error("Failed to fetch tickets:", err);
      setTickets([]);
    });
}, []);

  
  const startEditing = (index) => {
  const ticket = tickets[index];

  let autoDriver = ticket.assignedDriver || "";

  // Nelson logic
  const nelson = driverOptions.find(
    (u) => u.name === "Nelson Joseph" && !u.isOff
  );
  if (!autoDriver && nelson) {
    autoDriver = "Nelson Joseph";
  }

  // Helper: strip optional role prefixes like "Journalist:", "Sports Journalist:", "Producer:"
  const stripRolePrefix = (s) =>
    String(s || "")
      .replace(/^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i, "")
      .trim();

  // Normalize reporter field to an array of clean names, deduped
  const normalizedReporter = Array.from(
    new Set(
      (Array.isArray(ticket.assignedReporter)
        ? ticket.assignedReporter
        : typeof ticket.assignedReporter === "string" && ticket.assignedReporter.trim()
        ? [ticket.assignedReporter]
        : []
      )
        .map(stripRolePrefix)
        .filter(Boolean)
    )
  );

  setEditingIndex(index);
  setEditData({
    ...ticket,
    assignedDriver: autoDriver,
    assignedCamOps: ticket.assignedCamOps || [],
    assignedReporter: normalizedReporter, // ✅ already-clean, matches option values
    vehicle: ticket.vehicle || "",
    priority: ticket.priority || "Normal",
    assignmentStatus: ticket.assignmentStatus || "Pending",
    departureTime: ticket.departureTime?.slice(0, 5) || "",
    filmingTime: ticket.filmingTime?.slice(0, 5) || "",
    location: ticket.location || "",
    title: ticket.title || "",
  });
};

console.log("✅ Saving assigned cam ops:", editData.assignedCamOps);

  const saveEditing = async (index) => {
  const updatedTickets = [...tickets];
  const original = updatedTickets[index];

  // Helper: strip optional role prefixes like "Journalist:", "Sports Journalist:", "Producer:"
  const stripRolePrefix = (s) =>
    String(s || "")
      .replace(/^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i, "")
      .trim();

  // Normalize reporter to a clean, deduped array of names
  const sourceReporter =
    typeof editData.assignedReporter !== "undefined"
      ? editData.assignedReporter
      : original.assignedReporter;

  const reporterArray = Array.from(
    new Set(
      (Array.isArray(sourceReporter)
        ? sourceReporter
        : typeof sourceReporter === "string" && sourceReporter.trim()
        ? [sourceReporter]
        : []
      )
        .map(stripRolePrefix)
        .filter(Boolean)
    )
  );

  const updatedTicket = {
    id: original.id,
    title: editData.title || original.title,
    date: editData.date || original.date,
    location: editData.location || original.location,
    filmingTime: editData.filmingTime || original.filmingTime,
    departureTime: editData.departureTime || original.departureTime,
    assignedCamOps: editData.assignedCamOps || original.assignedCamOps || [],
    assignedDriver: editData.assignedDriver || original.assignedDriver || "",
    assignedReporter: reporterArray, // ✅ clean names that match option values
    vehicle: editData.vehicle || original.vehicle || "",
    assignmentStatus: editData.assignmentStatus || original.assignmentStatus || "Unassigned",
    priority: editData.priority || original.priority || "Normal",
    assignedBy: loggedInUser?.name || "Unknown",
  };

  // Auto-set status to "Assigned" if driver + cam ops are filled
  if (
    updatedTicket.assignmentStatus === "Unassigned" &&
    updatedTicket.assignedDriver &&
    updatedTicket.assignedCamOps.length > 0
  ) {
    updatedTicket.assignmentStatus = "Assigned";
  }

  try {
    console.log("📤 Sending PATCH payload:", updatedTicket);

    const res = await fetch(`${API_BASE}/tickets/${updatedTicket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedTicket),
    });

    if (!res.ok) {
      // Server might have persisted then thrown; fall through to refetch check
      throw new Error(`Failed to update ticket (HTTP ${res.status})`);
    }

    // Prefer whatever the server returns, but if it didn't send JSON just refetch
    let updatedFromServer = null;
    try {
      updatedFromServer = await res.json();
    } catch {
      // ignore parse errors and refetch below
    }

    const refreshed = await fetch(`${API_BASE}/tickets`);
    const data = await refreshed.json();
    setTickets(data);
    setEditingIndex(null);
  } catch (err) {
    console.error("Failed to save ticket edits:", err);
    // Soft fallback: refetch to see if it actually persisted
    try {
      const refreshed = await fetch(`${API_BASE}/tickets`);
      const data = await refreshed.json();
      setTickets(data);

      const after = data.find((t) => String(t.id) === String(updatedTicket.id)) || {};
      const reportersOk = Array.isArray(after.assignedReporter)
        ? JSON.stringify(after.assignedReporter) === JSON.stringify(updatedTicket.assignedReporter)
        : String(after.assignedReporter || "") === String(updatedTicket.assignedReporter || "");

      const otherCoreOk =
        String(after.title) === String(updatedTicket.title) &&
        String(after.location) === String(updatedTicket.location);

      if (reportersOk || otherCoreOk) {
        // Change did persist — don’t alarm the user
        setEditingIndex(null);
        return;
      }
    } catch (refetchErr) {
      console.error("Refetch after failed save also errored:", refetchErr);
    }

    // Only warn if we verified it didn’t land
    alert("Failed to save changes. Please try again.");
  }}




const cancelEditing = () => {
  setEditingIndex(null);
  setEditData({});
};


  const toggleSelect = (index) => {
    if (selectedTickets.includes(index)) {
      setSelectedTickets(selectedTickets.filter((i) => i !== index));
    } else {
      setSelectedTickets([...selectedTickets, index]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedTickets.length === tickets.length) {
      setSelectedTickets([]);
    } else {
      setSelectedTickets(tickets.map((_, idx) => idx));
    }
  };

  const toggleRow = (index) => {
    if (expandedRows.includes(index)) {
      setExpandedRows(expandedRows.filter((i) => i !== index));
    } else {
      setExpandedRows([...expandedRows, index]);
    }
  };

  const toggleExpandAll = () => {
    if (expandAll) {
      setExpandedRows([]);
      setExpandAll(false);
    } else {
      setExpandedRows(tickets.map((_, i) => i));
      setExpandAll(true);
    }
  };

  const handleAddNote = async (index) => {
  const text = newNotes[index];
  if (!text || !text.trim()) return;
  const timestamp = new Date().toLocaleString();
  const updatedTickets = [...tickets];
  const ticketToUpdate = { ...updatedTickets[index] };

  if (!Array.isArray(ticketToUpdate.notes)) {
    ticketToUpdate.notes = [];
  }

  const newNote = {
    text: text.trim(),
    author: loggedInUser?.name || "Unknown",
    timestamp,
  };

  ticketToUpdate.notes.push(newNote);

  try {
   await fetch(`${API_BASE}/tickets/${ticketToUpdate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: ticketToUpdate.notes }),
    });

    updatedTickets[index] = ticketToUpdate;
    setTickets(updatedTickets);
    setNewNotes({ ...newNotes, [index]: "" });
  } catch (err) {
    console.error("Failed to add note:", err);
  }
};
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">All Tickets</h2>

      <div className="flex flex-wrap items-center mb-2 gap-2">
        <button
          onClick={() => {
            setShowSelectBoxes(!showSelectBoxes);
            setSelectedTickets([]);
          }}
          className="px-3 py-1 border rounded"
        >
          {showSelectBoxes ? "Hide Selection" : "Select Tickets"}
        </button>
        {showSelectBoxes && (
          <button
            onClick={toggleSelectAll}
            className="px-3 py-1 border rounded"
          >
            {selectedTickets.length === tickets.length
              ? "Deselect All"
              : "Select All"}
          </button>
        )}
        <button
          onClick={toggleExpandAll}
          className="px-3 py-1 border rounded"
        >
          {expandAll ? "Collapse All" : "Expand All"}
        </button>
      </div>
     {selectedTickets.length > 0 && (
  <div className="flex gap-2 mb-2">
    <button
      onClick={async () => {
  try {
    const toArchive = selectedTickets.map((i) => tickets[i]);

    for (const ticket of toArchive) {
  await fetch(`${API_BASE}/tickets/${ticket.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: true }),
  });
}

// ✅ Refresh from backend after update
const res = await fetch(`${API_BASE}/tickets`);
const updated = await res.json();
setTickets(updated);
setSelectedTickets([]);

  } catch (err) {
    console.error("Failed to archive tickets:", err);
  }
}}
      className="text-yellow-600 border border-yellow-600 hover:bg-yellow-100 px-3 py-1 rounded-md transition"
    >
      Send to Archives
    </button>

    <button
      onClick={() => setShowRecycleModal(true)}
      className="text-red-500 border border-red-500 hover:bg-red-100 px-3 py-1 rounded-md transition"
    >
      Send to Recycle Bin
    </button>
  </div>
)}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300">
          <thead className="bg-blue-800 text-white">
  <tr>
    {showSelectBoxes && <th className="p-2 text-center">Select</th>}
    {[
  "Title",
  "Filming Date & Time",
  "Departure Time",
  "Location",
  "Cam Ops",
  "Driver",
  "Assigned Reporter", // ✅ Add this line
  "Status",
  "Actions",
].map((header) => (
  <th key={header} className="p-2 text-center whitespace-nowrap">
    {header}
  </th>
))}

  </tr>
</thead>
         <tbody>
  {tickets
  .filter((t) => !t.deleted && !t.archived)
  .map((ticket, index) => {
    const isEditing = editingIndex === index;
    const isExpanded = expandedRows.includes(index);

    return (
      <React.Fragment key={ticket.id || index}>
        <tr
            className={`${
              index % 2 === 0 ? "bg-white" : "bg-gray-50"
            } border-b ${
              ticket.priority === "Urgent"
                ? "border-l-4 border-l-red-600"
                : ticket.shootType === "Live"
                ? "border-l-4 border-l-blue-600"
                : "border-l"
            }`}
          >

          {showSelectBoxes && (
            <td className="p-2 text-center">
              <input
                type="checkbox"
                checked={selectedTickets.includes(index)}
                onChange={() => toggleSelect(index)}
              />
            </td>
          )}

          {/* Title with Cam Op + Cam Count badge */}
<td className="p-2 text-center whitespace-nowrap">
  {isEditing ? (
    <input
      type="text"
      value={editData.title || ""}
      onChange={(e) =>
        setEditData({ ...editData, title: e.target.value })
      }
      className="border px-2 py-1 rounded w-full"
    />
  ) : (
    <div className="flex items-center justify-center gap-2">
      <span>{ticket.title}</span>
      {(ticket.camCount > 1 || ticket.expectedCamOps > 1) && (
        <Badge variant="secondary" className="text-xs">
          👤{ticket.expectedCamOps || 1}🎥{ticket.camCount || 1}
        </Badge>
      )}
    </div>
  )}
</td>

       {/* Filming Date & Time */}
<td className="p-2 text-center whitespace-nowrap">
  {isEditing ? (
    <input
      type="datetime-local"
      value={editData.date?.slice(0, 16) || ""}
      onChange={(e) =>
        setEditData({ ...editData, date: e.target.value })
      }
      className="border px-2 py-1 rounded"
    />
  ) : (() => {
    const filmingISO = ticket.date?.trim?.();
    if (!filmingISO) return "-";

    const filmingDate = new Date(filmingISO);
    if (isNaN(filmingDate.getTime())) {
      console.warn("Invalid filming date format:", filmingISO);
      return filmingISO;
    }

    const day = String(filmingDate.getDate()).padStart(2, "0");
    const month = filmingDate.toLocaleString("en-US", { month: "short" });
    const year = String(filmingDate.getFullYear()).slice(2);
    const hours = String(filmingDate.getHours()).padStart(2, "0");
    const minutes = String(filmingDate.getMinutes()).padStart(2, "0");

    return `${day}-${month}-${year}, ${hours}:${minutes}`;
  })()}
</td>


{/* Departure Time */}
<td className="p-2 text-center whitespace-nowrap">
  {isEditing ? (
    <input
      type="time"
      step="300"
      value={editData.departureTime || ""}
      onChange={(e) =>
        setEditData({ ...editData, departureTime: e.target.value })
      }
      className="border px-2 py-1 rounded"
    />
  ) : (
    ticket.departureTime || "-"
  )}
</td>

          {/* Location */}
          <td className="p-2 text-center whitespace-nowrap">
            {isEditing ? (
              <input
                type="text"
                value={editData.location || ""}
                onChange={(e) =>
                  setEditData({ ...editData, location: e.target.value })
                }
                className="border px-2 py-1 rounded w-full"
              />
            ) : (
              ticket.location || "-"
            )}
          </td>

          {/* Cam Ops */}
<td className="p-2 text-center whitespace-nowrap">
  {isEditing ? (
    <MultiSelectCombobox
      options={camOpOptionsDecorated}
      selected={editData.assignedCamOps || []}
      // Normalize & ignore divider markers
      onChange={(next) => {
        const values = (next || [])
          .map((v) => (typeof v === "string" ? v : v?.value))
          .filter((val) => val && !val.startsWith("__divider"));
        setEditData((prev) => ({ ...prev, assignedCamOps: values }));
      }}
    />
  ) : Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0 ? (
    <DutyBadgeWrapper
      date={ticket.date}
      filmingTime={ticket.filmingTime}
      names={ticket.assignedCamOps}
    />
  ) : (
    "-"
  )}
</td>

          {/* Driver */}
          <td className="p-2 text-center whitespace-nowrap">
            {isEditing ? (
              <select
                value={editData.assignedDriver || ""}
                onChange={(e) =>
                  setEditData({ ...editData, assignedDriver: e.target.value })
                }
                className="border px-2 py-1 rounded"
              >
                <option value="">Select Driver</option>
                {driverOptions.map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              ticket.assignedDriver || "-"
            )}
          </td>
          {/* Assigned Reporter */}
<td className="p-2 text-center whitespace-nowrap">
  {editingIndex === index ? (
    <MultiSelectCombobox
      options={reporterOptionsDecorated}
      selected={editData.assignedReporter || []}
      onChange={(next) => {
        const stripRolePrefix = (s) =>
          String(s || "")
            .replace(/^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i, "")
            .trim();

        // Normalize to values, strip any role prefixes, drop dividers, and dedupe
        const values = Array.from(
          new Set(
            (next || [])
              .map((v) => (typeof v === "string" ? v : v?.value))
              .filter((val) => val && !String(val).startsWith("__rep_div"))
              .map(stripRolePrefix)
              .filter(Boolean)
          )
        );

        setEditData((prev) => ({ ...prev, assignedReporter: values }));
      }}
    />
  ) : Array.isArray(ticket.assignedReporter) && ticket.assignedReporter.length > 0 ? (
    ticket.assignedReporter.join(", ")
  ) : typeof ticket.assignedReporter === "string" && ticket.assignedReporter.trim() ? (
    ticket.assignedReporter
  ) : (
    "-"
  )}
</td>

          {/* Status */}
          <td className="p-2 text-center whitespace-nowrap">
            <Popover>
  <PopoverTrigger asChild>
  <button type="button">
    <Badge
      variant={
        ticket.assignmentStatus === "Completed"
          ? "success"
          : ticket.assignmentStatus === "In Progress"
          ? "secondary"
          : ticket.assignmentStatus === "Cancelled"
          ? "destructive"
          : ticket.assignmentStatus === "Postponed"
          ? "outline"
          : ticket.assignedCamOps?.length > 0
          ? "default"
          : "outline"
      }
      className="text-xs cursor-pointer"
    >
      {ticket.assignmentStatus || (ticket.assignedCamOps?.length > 0 ? "Assigned" : "Unassigned")}
    </Badge>
  </button>
</PopoverTrigger>
  <PopoverContent className="w-[180px] p-2">
    <div className="space-y-1">
      {["Assigned", "In Progress", "Completed", "Postponed", "Cancelled"].map((status) => (
        <div
          key={status}
          onClick={() => handleStatusChange(ticket.id, status)}
          className="cursor-pointer px-2 py-1 hover:bg-accent rounded text-sm"
        >
          {status}
        </div>
      ))}
    </div>
  </PopoverContent>
</Popover>
          </td>

          {/* Actions */}
          <td className="p-2 text-center whitespace-nowrap">
            {isEditing ? (
              <div className="flex gap-2 justify-center">
                <button
                  className="text-green-600 hover:underline text-xs"
                  onClick={() => saveEditing(index)}
                >
                  Save
                </button>
                <button
                  className="text-gray-600 hover:underline text-xs"
                  onClick={cancelEditing}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2 justify-center">
                {canEditAny && (
                  <button
                    className="text-blue-600 hover:underline text-xs"
                    onClick={() => startEditing(index)}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="text-yellow-600 hover:underline text-xs"
                  onClick={() => toggleRow(index)}
                >
                  {isExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            )}
          </td>
        </tr>

        {/* Expanded Row with camera info and category/subtype */}
{isExpanded && (
  <tr className="bg-gray-100">
    <td
      colSpan={showSelectBoxes ? 9 : 8}
      className="p-4 text-sm text-gray-700"
    >
      <div className="mb-2 space-y-1">
  <div><strong>Number of Cameras:</strong> {ticket.camCount}</div>
  <div>
    <strong>Cam Op Requirement:</strong>{" "}
    {ticket.expectedCamOps
      ? `${ticket.expectedCamOps} operator${ticket.expectedCamOps > 1 ? "s" : ""} expected`
      : ticket.onlyOneCamOp
      ? "Only one operator required"
      : "Multiple operators expected"}
  </div>
  <div>
    <strong>Assigned Cam Ops:</strong>{" "}
    {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0
      ? ticket.assignedCamOps.join(", ")
      : "-"}
  </div>
        {ticket.type === "News" && ticket.category && (
          <div><strong>News Category:</strong> {ticket.category}</div>
        )}
        {ticket.type === "Sports" && ticket.subtype && (
          <div><strong>Sports Subtype:</strong> {ticket.subtype}</div>
        )}
      </div>

      <div className="mt-3">
        <strong>Assigned By:</strong>{" "}
        <span className="text-gray-700 font-medium">
          {ticket.assignedBy || "Unknown"}
        </span>
      </div>

      <div className="mt-2">
        <strong>Notes:</strong>
        {Array.isArray(ticket.notes) && ticket.notes.length > 0 ? (
          <ul className="list-disc list-inside ml-2 mt-1">
            {ticket.notes.map((note, noteIdx) => (
              <li key={noteIdx}>
                {note.text}{" "}
                <span className="text-gray-500 text-xs">
                  — {note.author}, {note.timestamp}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">No notes</p>
        )}
      </div>

      {canAddNotes && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="Add note"
            value={newNotes[index] || ""}
            onChange={(e) =>
              setNewNotes({ ...newNotes, [index]: e.target.value })
            }
            className="border rounded p-1 w-2/3 mr-2"
          />
          <button
            onClick={() => handleAddNote(index)}
            className="text-xs text-blue-600 hover:underline"
          >
            Add Note
          </button>
        </div>
      )}
    </td>
  </tr>
)}
      </React.Fragment>
    );
  })}
</tbody>
        </table>
      </div>
    {/* Archived Tickets */}
<div className="mt-6">
  <button
    onClick={() => setShowArchived(!showArchived)}
    className="flex items-center gap-1 text-sm underline"
  >
    {showArchived ? (
      <>
        <ChevronUp size={16} /> Hide Archived ({tickets.filter((t) => t.archived).length})
      </>
    ) : (
      <>
        <ChevronDown size={16} /> Show Archived ({tickets.filter((t) => t.archived).length})
      </>
    )}
  </button>
  {showArchived && (
    <div className="mt-3 border rounded shadow">
      {tickets.filter((t) => t.archived).length === 0 ? (
        <p className="text-gray-500 px-2 py-2">No archived tickets.</p>
      ) : (
        <>
          <div className="flex items-center justify-between p-2">
            <button
              className="text-sm text-blue-600 underline"
              onClick={() => {
                const archived = tickets.filter((t) => t.archived);
                if (selectedDeleted.length === archived.length) {
                  setSelectedDeleted([]);
                } else {
                  setSelectedDeleted(archived.map((_, i) => i));
                }
              }}
            >
              {selectedDeleted.length === tickets.filter(t => t.archived).length
                ? "Deselect All"
                : "Select All in Archives"}
            </button>

            {selectedDeleted.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const toRestore = selectedDeleted.map(
                        (i) => tickets.filter((t) => t.archived)[i]
                      );
                      for (const ticket of toRestore) {
                        await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: false }),
                        });
                      }

                      setSelectedDeleted([]);
                      const response = await fetch(`${API_BASE}/tickets`);
                      const data = await response.json();
                      setTickets(data);
                    } catch (err) {
                      console.error("Failed to restore archived tickets:", err);
                    }
                  }}
                  className="px-3 py-1 border rounded text-green-600 border-green-600 hover:bg-green-50"
                >
                  Restore Selected
                </button>

                <button
                  onClick={async () => {
                    try {
                      const toRecycle = selectedDeleted.map(
                        (i) => tickets.filter((t) => t.archived)[i]
                      );
                      for (const ticket of toRecycle) {
                        await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: false, deleted: true }),
                        });
                      }

                      setSelectedDeleted([]);
                      const response = await fetch(`${API_BASE}/tickets`);
                      const data = await response.json();
                      setTickets(data);
                    } catch (err) {
                      console.error("Failed to move archived tickets to recycle bin:", err);
                    }
                  }}
                  className="px-3 py-1 border rounded text-red-600 border-red-600 hover:bg-red-100"
                >
                  Send to Recycle Bin
                </button>
              </div>
            )}
          </div>

          <table className="min-w-full text-sm">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-2 text-center">Select</th>
                <th className="p-2 text-center">Title</th>
                <th className="p-2 text-center">Filming</th>
                <th className="p-2 text-center">Departure</th>
                <th className="p-2 text-center">Location</th>
                <th className="p-2 text-center">Driver</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-center">Priority</th>
              </tr>
            </thead>
            <tbody>
              {tickets.filter((t) => t.archived).map((ticket, idx) => {
                const isSelected = selectedDeleted.includes(idx);
                const date = ticket.date?.trim?.();
                const d = new Date(date);
                const day = String(d.getDate()).padStart(2, "0");
                const month = d.toLocaleString("en-US", { month: "short" });
                const year = String(d.getFullYear()).slice(2);
                const hh = String(d.getHours()).padStart(2, "0");
                const mm = String(d.getMinutes()).padStart(2, "0");
                const formatted = !isNaN(d.getTime()) ? `${day}-${month}-${year}, ${hh}:${mm}` : "-";

                return (
                  <tr key={ticket.id || idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (isSelected) {
                            setSelectedDeleted(selectedDeleted.filter((i) => i !== idx));
                          } else {
                            setSelectedDeleted([...selectedDeleted, idx]);
                          }
                        }}
                      />
                    </td>
                    <td className="p-2 text-center">{ticket.title}</td>
                    <td className="p-2 text-center">{formatted}</td>
                    <td className="p-2 text-center">{ticket.departureTime || "-"}</td>
                    <td className="p-2 text-center">{ticket.location || "-"}</td>
                    <td className="p-2 text-center">{ticket.assignedDriver || "-"}</td>
                    <td className="p-2 text-center">
                      <StatusBadge status={ticket.assignmentStatus || "Unassigned"} />
                    </td>
                    <td className="p-2 text-center">{ticket.priority || "Normal"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )}
</div>

     {/* Recycle Bin */}
<div className="mt-6">
  <button
    onClick={() => setShowDeleted(!showDeleted)}
    className="flex items-center gap-1 text-sm underline"
  >
    {showDeleted ? (
      <>
        <ChevronUp size={16} /> Hide Recycle Bin ({tickets.filter(t => t.deleted).length})
      </>
    ) : (
      <>
        <ChevronDown size={16} /> Show Recycle Bin ({tickets.filter(t => t.deleted).length})
      </>
    )}
  </button>
  {showDeleted && (
    <div className="mt-3 border rounded shadow">
      <div className="flex items-center justify-between p-2">
        <button
          className="text-sm text-blue-600 underline"
          onClick={() => {
            const deleted = tickets.filter((t) => t.deleted);
            if (selectedDeleted.length === deleted.length) {
              setSelectedDeleted([]);
            } else {
              setSelectedDeleted(deleted.map((_, i) => i));
            }
          }}
        >
          {selectedDeleted.length === tickets.filter(t => t.deleted).length
            ? "Deselect All"
            : "Select All in Recycle Bin"}
        </button>

      {selectedDeleted.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => setShowRestoreModal(true)}
            className="px-3 py-1 border rounded text-green-600 border-green-600 hover:bg-green-50"
          >
            Restore Selected
          </button>
          <button
            onClick={() => setShowPermanentDeleteModal(true)}
            className="px-3 py-1 border rounded text-red-600 border-red-600 hover:bg-red-100"
          >
            Permanently Delete
          </button>
        </div>
      )}
    </div>

    {tickets.filter((t) => t.deleted).length === 0 ? (
      <p className="text-gray-500 px-2 py-2">No deleted tickets.</p>
    ) : (
      <table className="min-w-full text-sm">
    <thead className="bg-gray-200">
  <tr>
    <th className="p-2 text-center">Select</th>
    <th className="p-2 text-center">Title</th>
    <th className="p-2 text-center">Filming</th>
    <th className="p-2 text-center">Departure</th>
    <th className="p-2 text-center">Location</th>
    <th className="p-2 text-center">Driver</th>
    <th className="p-2 text-center">Status</th>
    <th className="p-2 text-center">Priority</th>
  </tr>
</thead>
<tbody>
  {tickets.filter((t) => t.deleted).map((ticket, idx) => {
    const isSelected = selectedDeleted.includes(idx);
    const date = ticket.date?.trim?.();
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short" });
    const year = String(d.getFullYear()).slice(2);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const formatted = !isNaN(d.getTime()) ? `${day}-${month}-${year}, ${hh}:${mm}` : "-";

    return (
      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
        <td className="p-2 text-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {
              if (isSelected) {
                setSelectedDeleted(selectedDeleted.filter((i) => i !== idx));
              } else {
                setSelectedDeleted([...selectedDeleted, idx]);
              }
            }}
          />
        </td>
        <td className="p-2 text-center">{ticket.title}</td>
        <td className="p-2 text-center">{formatted}</td>
        <td className="p-2 text-center">{ticket.departureTime || "-"}</td>
        <td className="p-2 text-center">{ticket.location || "-"}</td>
        <td className="p-2 text-center">{ticket.assignedDriver || "-"}</td>
        <td className="p-2 text-center">
          <StatusBadge status={ticket.assignmentStatus || "Unassigned"} />
        </td>
        <td className="p-2 text-center">{ticket.priority || "Normal"}</td>
      </tr>
    );
  })}
</tbody>

      </table>
    )}
  </div>
)}
      </div>
  {/* Recycle Modal */}
<AlertDialog open={showRecycleModal} onOpenChange={setShowRecycleModal}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Send selected tickets to Recycle Bin?</AlertDialogTitle>
      <AlertDialogDescription>
        These tickets will be moved to the Recycle Bin. You can restore them later.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-red-600 hover:bg-red-700 text-white"
        onClick={async () => {
          try {
            const toDelete = selectedTickets.map(
  (i) => tickets.filter((t) => !t.deleted && !t.archived)[i]
);

            for (const ticket of toDelete) {
              await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deleted: true }),
              });
            }

            const res = await fetch(`${API_BASE}/tickets`);
            const updated = await res.json();
            setTickets(updated);
            setSelectedTickets([]);
            setShowRecycleModal(false);
          } catch (err) {
            console.error("Failed to recycle tickets:", err);
          }
        }}
      >
        Confirm
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

{/* Restore Modal */}
<AlertDialog open={showRestoreModal} onOpenChange={setShowRestoreModal}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Restore selected tickets?</AlertDialogTitle>
      <AlertDialogDescription>
        These tickets will be restored to the main list.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-green-600 hover:bg-green-700 text-white"
        onClick={async () => {
          try {
            const toRestore = selectedDeleted.map(
              (i) => tickets.filter((t) => t.deleted)[i]
            );

            for (const ticket of toRestore) {
              await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deleted: false }),
              });
            }

            setSelectedDeleted([]);
            setShowRestoreModal(false);

            const response = await fetch(`${API_BASE}/tickets`);
            const data = await response.json();
            setTickets(data);
          } catch (err) {
            console.error("Failed to restore tickets:", err);
          }
        }}
      >
        Restore
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

{/* Permanently Delete Modal */}
<AlertDialog open={showPermanentDeleteModal} onOpenChange={setShowPermanentDeleteModal}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Permanently delete selected tickets?</AlertDialogTitle>
      <AlertDialogDescription className="text-red-600 font-semibold">
        This action cannot be undone. The selected tickets will be deleted forever.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className="bg-red-600 hover:bg-red-700 text-white"
        onClick={async () => {
          try {
            const toDelete = selectedDeleted.map(
              (i) => tickets.filter((t) => t.deleted)[i]
            );

            for (const ticket of toDelete) {
              await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                method: "DELETE",
              });
            }

            setSelectedDeleted([]);
            setShowPermanentDeleteModal(false);

            const response = await fetch(`${API_BASE}/tickets`);
            const data = await response.json();
            setTickets(data);
          } catch (err) {
            console.error("Failed to permanently delete tickets:", err);
          }
        }}
      >
        Delete Forever
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
</div>
  );
}
