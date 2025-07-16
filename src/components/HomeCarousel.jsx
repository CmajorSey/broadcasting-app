import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
 const [currentDayIndex, setCurrentDayIndex] = useState(() => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 (Sun) to 6 (Sat)

  // Shift Sunday (0) to 6, and Monday (1) to 0 — so Monday is the start of the week
  return (dayOfWeek + 6) % 7;
});
  const [editMenuTicketId, setEditMenuTicketId] = useState(null);
  const [editVehicle, setEditVehicle] = useState("");

  const roles = loggedInUser?.roles || [];
  const userName = loggedInUser?.name || "";

  const isAdmin = roles.includes("admin");
  const isProducer = roles.includes("producer");
  const isJournalist = roles.includes("journalist");
  const isCamOp = roles.includes("camOp");
  const isDriver = roles.includes("driver");
  const getFormattedWeek = () => {
  const today = new Date();
  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startOfWeek.setDate(today.getDate() + mondayOffset);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(startOfWeek);
    current.setDate(startOfWeek.getDate() + i);
    const options = { weekday: "long", day: "2-digit", month: "short" };
    const formatted = current.toLocaleDateString("en-GB", options).replace(",", " –");
    week.push({ label: formatted, isoDate: current.toISOString().split("T")[0] });
  }
  return week;
};
const daysOfWeek = getFormattedWeek();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAhead = new Date();
  weekAhead.setDate(today.getDate() + 7);
  weekAhead.setHours(23, 59, 59, 999);
  const visibleTickets = tickets.filter((ticket) => {
    const ticketDate = new Date(ticket.date);
    return ticketDate >= today && ticketDate <= weekAhead;
  });

  const myTickets = tickets.filter(
    (t) =>
      (Array.isArray(t.assignedCamOps) &&
        t.assignedCamOps.includes(userName)) ||
      t.assignedDriver === userName
  );

 const groupedTickets = {};
daysOfWeek.forEach((day) => {
  groupedTickets[day.isoDate] = [];
});

visibleTickets.forEach((ticket) => {
  const ticketDateISO = new Date(ticket.date).toISOString().split("T")[0];
  if (groupedTickets[ticketDateISO]) {
    groupedTickets[ticketDateISO].push(ticket);
  }
});
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

  const currentDay = daysOfWeek[currentDayIndex];

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

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-2xl font-bold">Welcome, {userName || "Guest"}</h1>

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
            const vehicleName =
              vehicles?.find((v) => String(v.id) === ticket.vehicle)?.name ??
              (ticket.vehicle ? `ID ${ticket.vehicle}` : "Unassigned");

            const isUrgent = ticket.priority === "Urgent";
            const isLive = ticket.shootType === "Live";
            const isStudio =
              ticket.location === "Studio" ||
              ticket.location === "Telesesel Studio";

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
                  bg-white ${borderColor} border-2 rounded-lg shadow-md p-4 space-y-2
                  hover:shadow-xl hover:scale-[1.03]
                  transform transition duration-300 ease-out
                  group
                `}
              >
                {/* Hover-only edit menu trigger */}
                {(isAdmin || isDriver) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditMenuTicketId(
                        editMenuTicketId === ticket.id ? null : ticket.id
                      );
                      setEditVehicle(ticket.vehicle || "");
                    }}
                    className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition z-20"
                  >
                    <MoreHorizontal className="w-5 h-5 text-gray-600" />
                  </button>
                )}

                {/* Edit Menu */}
                {editMenuTicketId === ticket.id && (
                  <div
                    className="absolute top-8 right-2 bg-white border rounded shadow p-2 z-30 w-48"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="block text-xs font-semibold mb-1">
                      Vehicle
                    </label>
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

                {/* Top Icons */}
                <div className="absolute top-2 left-2 flex space-x-1">
                  {isUrgent && (
                    <AlertTriangle
                      size={16}
                      className="text-red-500"
                      title="Urgent Priority"
                    />
                  )}
                  {isLive && (
                    <RadioTower
                      size={16}
                      className="text-blue-500"
                      title="Live Shoot"
                    />
                  )}
                  {isStudio && (
                    <Monitor
                      size={16}
                      className="text-indigo-500"
                      title="Studio Booking"
                    />
                  )}
                </div>

                {/* Status Badge */}
                <div className="absolute top-2 right-2 z-10">
                  <StatusBadge status={ticket.assignmentStatus} />
                </div>

                {/* Card Content */}
                <div className="text-blue-700 font-semibold">{ticket.title}</div>
                <p className="text-sm text-gray-700">
                  Departure: {ticket.departureTime}
                </p>
                <p className="text-sm text-gray-700">
                  Filming: {ticket.filmingTime || "—"}
                </p>
                <p className="text-sm text-gray-700">
                  Location: {ticket.location}
                </p>

                <p className="text-xs text-gray-500">
                  Priority: {ticket.priority}
                  <br />
                  Shoot: {ticket.shootType}
                </p>
                <div className="text-xs text-gray-500">
                  Vehicle: {vehicleName}
                  <br />
                  Driver: {ticket.assignedDriver || "None"}
                  <br />
                  Cam Ops:{" "}
                  {Array.isArray(ticket.assignedCamOps) &&
                  ticket.assignedCamOps.length > 0
                    ? ticket.assignedCamOps.join(", ")
                    : "None"}
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
  );
}
