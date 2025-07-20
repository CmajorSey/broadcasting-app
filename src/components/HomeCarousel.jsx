import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ChangelogDialog from "@/components/ChangelogDialog";
import DutyBadge from "@/components/DutyBadge";
import {
  AlertTriangle,
  RadioTower,
  Monitor,
  MoreHorizontal,
  Save,
} from "lucide-react";
import API_BASE from "@/api"
import StatusBadge from "./StatusBadge";

export default function HomeCarousel({
  tickets,
  users,
  vehicles,
  loggedInUser,
  setTickets,
}) {
 const navigate = useNavigate();
const [selectedWeekOffset, setSelectedWeekOffset] = useState(0); // 0 = this week, 1 = next week
const [currentDayIndex, setCurrentDayIndex] = useState(null);

useEffect(() => {
  const today = new Date();
  today.setHours(12, 0, 0, 0); // Prevent timezone drift
  const todayISO = today.toISOString().split("T")[0];

  const monday = getMondayOfWeek(today, selectedWeekOffset);
  const weekDates = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    d.setHours(12, 0, 0, 0);
    return d.toISOString().split("T")[0];
  });

  const foundIndex = weekDates.findIndex((d) => d === todayISO);
  setCurrentDayIndex(foundIndex === -1 ? 0 : foundIndex);
}, [selectedWeekOffset]);

const [editMenuTicketId, setEditMenuTicketId] = useState(null);
const [showChangelog, setShowChangelog] = useState(false);
const [editVehicle, setEditVehicle] = useState("");

// User role logic
const roles = loggedInUser?.roles || [];
const userName = loggedInUser?.name || "";

const isAdmin = roles.includes("admin");
const isProducer = roles.includes("producer");
const isJournalist = roles.includes("journalist");
const isCamOp = roles.includes("camOp");
const isDriver = roles.includes("driver");

function getMondayOfWeek(baseDate = new Date(), offset = 0) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday + offset * 7);
  d.setHours(12, 0, 0, 0); // Set to noon to avoid timezone drift
  return d;
}

const today = new Date();
const monday = getMondayOfWeek(today, selectedWeekOffset);

const daysOfWeek = Array.from({ length: 7 }).map((_, i) => {
  const date = new Date(monday.getTime());
  date.setDate(date.getDate() + i);
  date.setHours(12, 0, 0, 0); // Prevent timezone skew in ISO
  const label = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).replace(",", " –");
  return { label, isoDate: date.toISOString().split("T")[0] };
});

const windowStart = new Date(monday);
const windowEnd = new Date(monday);
windowEnd.setDate(monday.getDate() + 6);
windowEnd.setHours(23, 59, 59, 999);

const startISO = windowStart.toISOString().slice(0, 10);
const endISO = windowEnd.toISOString().slice(0, 10);

const visibleTickets = tickets
  .filter((t) => !t.deleted && !t.archived) // ✅ Exclude both deleted and archived
  .filter((ticket) => {
    if (!ticket.date) return false;
    const localDate = new Date(ticket.date);
    localDate.setHours(12, 0, 0, 0); // Prevent day shift
    const iso = localDate.toISOString().split("T")[0];
    return iso >= startISO && iso <= endISO;
  });


const groupedTickets = {};
daysOfWeek.forEach((day) => {
  groupedTickets[day.isoDate] = [];
});
visibleTickets.forEach((ticket) => {
  const dateObj = new Date(ticket.date);
  dateObj.setHours(12, 0, 0, 0); // Force local day context
  const safeISO = dateObj.toISOString().split("T")[0];
  if (groupedTickets[safeISO]) {
    groupedTickets[safeISO].push(ticket);
  }
});

const myTickets = tickets
  .filter((t) => !t.deleted)
  .filter(
    (t) =>
      (Array.isArray(t.assignedCamOps) &&
        t.assignedCamOps.includes(userName)) ||
      t.assignedDriver === userName
  );


useEffect(() => {
  const handleKey = (e) => {
    if (e.key === "ArrowRight") {
      setCurrentDayIndex((prev) => (prev + 1) % daysOfWeek.length);
    }
    if (e.key === "ArrowLeft") {
      setCurrentDayIndex(
        (prev) => (prev - 1 + daysOfWeek.length) % daysOfWeek.length
      );
    }
  };
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
}, []);

useEffect(() => {
  const hasSeen = localStorage.getItem("changelog_v032_dismissed");
  if (!hasSeen) {
    setShowChangelog(true);
  }
}, []);

const currentDay = currentDayIndex !== null ? daysOfWeek[currentDayIndex] : daysOfWeek[0];

const handleSaveVehicle = async (ticketId) => {
  try {
     const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicle: editVehicle }),
    });

    if (!res.ok) throw new Error("Failed to update ticket vehicle");

    const updatedTickets = tickets.map((t) =>
      t.id === ticketId ? { ...t, vehicle: editVehicle } : t
    );
    setTickets(updatedTickets);
    setEditMenuTicketId(null);
    setEditVehicle("");
  } catch (err) {
    console.error("Error saving vehicle:", err);
    alert("Could not save vehicle assignment.");
  }
};

const rosterCache = { current: {} };

function DutyBadgeWrapper({ date, filmingTime, names, rosterCache }) {
  const [duty, setDuty] = useState(null);
  const filmingHour = parseInt(filmingTime?.split(":"[0] || "0", 10));
  const dutyDate = date?.slice(0, 10);

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(12, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

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
          <div key={i} className="flex items-center gap-2 text-xs">
            <span>{name}</span>
            {badge}
          </div>
        );
      })}
    </div>
  );
}

  return (
  <>
    <ChangelogDialog
      open={showChangelog}
      onClose={() => {
        localStorage.setItem("changelog_v032_dismissed", "true");
        setShowChangelog(false);
      }}
    />
    <div className="space-y-6 p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
  <h1 className="text-2xl font-bold">Welcome, {userName || "Guest"}</h1>
  <div className="flex items-center gap-2">
    <label className="text-sm text-gray-600">Select Week:</label>
    <select
      value={selectedWeekOffset}
      onChange={(e) => {
        setSelectedWeekOffset(Number(e.target.value));
        setCurrentDayIndex(0); // reset to Monday
      }}
      className="border rounded px-2 py-1 text-sm"
    >
      <option value={0}>This Week</option>
      <option value={1}>Next Week</option>
    </select>
  </div>
</div>


      {/* Role-Based Controls */}
      <div className="flex flex-wrap gap-3">
        {(isAdmin || isProducer || isJournalist) && (
          <>
            <button
              onClick={() => navigate("/create")}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Create Ticket
            </button>
            <button
              onClick={() => navigate("/tickets")}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              View All Tickets
            </button>
          </>
        )}
        {isCamOp && (
          <button
            onClick={() => navigate("/request-gear")}
            className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
          >
            Request Gear
          </button>
        )}
        {isDriver && (
          <button
            onClick={() => navigate("/fleet")}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          >
            Fleet / Vehicle Selection
          </button>
        )}
      </div>

      {/* My Tickets */}
      <div>
        <h2 className="text-lg font-semibold mb-2">My Tickets</h2>
        {myTickets.length === 0 ? (
          <p className="text-gray-500 text-sm">
            You have no assigned tickets.
          </p>
        ) : (
          <div className="flex overflow-x-auto space-x-4 pb-2">
            {myTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-md p-3 cursor-pointer hover:shadow-lg transition"
                onClick={() => navigate("/tickets")}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold">{ticket.title}</span>
                  <StatusBadge status={ticket.assignmentStatus} />
                </div>
                <p className="text-xs text-gray-600">
                  {ticket.date} – {ticket.location}
                </p>
                <p className="text-xs text-gray-500">
                  Priority: {ticket.priority}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Carousel Controls */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() =>
            setCurrentDayIndex(
              (prev) => (prev - 1 + daysOfWeek.length) % daysOfWeek.length
            )
          }
          className="text-blue-600 hover:text-blue-800"
        >
          &larr; Previous
        </button>
       <h2 className="text-lg font-semibold">{currentDay.label}</h2>
        <button
          onClick={() =>
            setCurrentDayIndex((prev) => (prev + 1) % daysOfWeek.length)
          }
          className="text-blue-600 hover:text-blue-800"
        >
          Next &rarr;
        </button>
      </div>

      {/* Ticket Cards */}
      {groupedTickets[currentDay.isoDate].length === 0 ? (
        <p className="text-gray-500 text-sm text-center">
          No tickets for this day.
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-6">
          {groupedTickets[currentDay.isoDate].map((ticket) => {
  const vehicleObj = vehicles?.find((v) => String(v.id) === ticket.vehicle);
  const vehicleName = vehicleObj?.name ?? (ticket.vehicle ? `ID ${ticket.vehicle}` : "Unassigned");
  const vehiclePlate = vehicleObj?.licensePlate ?? "";

  const isUrgent = ticket.priority === "Urgent";
  const isLive = ticket.shootType === "Live";
  const isStudio = ticket.location === "Studio" || ticket.location === "Telesesel Studio";

  let borderColor = "border-gray-300";
  if (isUrgent && isLive && isStudio) borderColor = "border-purple-700";
  else if (isUrgent && isLive) borderColor = "border-purple-500";
  else if (isUrgent && isStudio) borderColor = "border-pink-500";
  else if (isLive && isStudio) borderColor = "border-violet-500";
  else if (isUrgent) borderColor = "border-red-500";
  else if (isLive) borderColor = "border-blue-500";
  else if (isStudio) borderColor = "border-indigo-500";

          return (
  <div
    key={ticket.id}
    className={`
      relative
      w-full sm:w-80 md:w-72 lg:w-80
      bg-white ${borderColor} border-2 rounded-lg shadow-md p-4 pt-8 space-y-2
      hover:shadow-xl hover:scale-[1.03]
      transform transition duration-300 ease-out
      group
    `}
  >
    {/* Top Icons */}
    <div className="absolute top-2 left-2 flex space-x-1">
      {isUrgent && <AlertTriangle size={16} className="text-red-500" title="Urgent Priority" />}
      {isLive && <RadioTower size={16} className="text-blue-500" title="Live Shoot" />}
      {isStudio && <Monitor size={16} className="text-indigo-500" title="Studio Booking" />}
    </div>

    {/* Status Badge */}
    <div className="absolute top-2 right-2 z-10">
      <StatusBadge status={ticket.assignmentStatus} />
    </div>

    {/* Edit Trigger */}
    {(isAdmin || isDriver) && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditMenuTicketId(editMenuTicketId === ticket.id ? null : ticket.id);
          setEditVehicle(ticket.vehicle || "");
        }}
        className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition z-20"
      >
        <MoreHorizontal className="w-5 h-5 text-gray-600" />
      </button>
    )}

    {/* Edit Dropdown */}
    {editMenuTicketId === ticket.id && (
      <div
        className="absolute top-8 right-2 bg-white border rounded shadow p-2 z-30 w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="block text-xs font-semibold mb-1">Vehicle</label>
        <select
          value={editVehicle}
          onChange={(e) => setEditVehicle(e.target.value)}
          className="border rounded p-1 w-full mb-2"
        >
          <option value="">-- Unassigned --</option>
          {vehicles?.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => handleSaveVehicle(ticket.id)}
          className="flex items-center justify-center w-full bg-blue-600 text-white rounded px-2 py-1 text-xs"
        >
          <Save className="w-3 h-3 mr-1" /> Save
        </button>
      </div>
    )}

    {/* Card Content */}
    <div className="text-blue-700 font-semibold text-base">{ticket.title}</div>
    <p className="text-sm text-gray-800">{ticket.location}</p>

    <div className="flex justify-between text-sm text-gray-700">
  <span>Filming Time: {ticket.filmingTime || "—"}</span>
  <span>Departure: {ticket.departureTime || "—"}</span>
</div>

    <div className="text-sm text-gray-900 font-semibold space-y-1">
      <div>
        Cam Ops:
        {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0 ? (
          <DutyBadgeWrapper
            date={ticket.date}
            filmingTime={ticket.filmingTime}
            names={ticket.assignedCamOps}
            rosterCache={rosterCache}
          />
        ) : (
          " None"
        )}
      </div>
      <div>Driver: {ticket.assignedDriver || "None"}</div>
    </div>

    <div className="text-xs text-gray-500 space-y-1">
      <div>
        Vehicle: {vehicleName}
        {vehiclePlate && ` (${vehiclePlate})`}
      </div>
      <div>Priority: {ticket.priority}</div>
      <div>Shoot: {ticket.shootType}</div>
    </div>

    {ticket.notes?.length > 0 && (
      <div className="mt-2 space-y-1">
        {ticket.notes.map((note, noteIdx) => (
          <div
            key={noteIdx}
            className="bg-gray-50 border border-gray-200 p-2 rounded"
          >
            <p className="text-xs text-gray-700">{note.text}</p>
            <p className="text-[10px] text-gray-500 mt-1">
              Added by {note.author} on {note.timestamp}
            </p>
          </div>
        ))}
      </div>
    )}
  </div>
);
          })}
        </div>
      )}
     </div>
  </>
);
}
