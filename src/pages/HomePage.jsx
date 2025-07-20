import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "@/components/StatusBadge";
import API_BASE from "@/api";

const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0); // start of day to match all comparisons
  return d;
}



export default function HomePage() {
  const [ticketsByDay, setTicketsByDay] = useState({});
  const [currentDayIndex, setCurrentDayIndex] = useState(() => {
  const today = new Date();
  const todayISO = today.toISOString().split("T")[0]; // YYYY-MM-DD

  const weekStart = getWeekStart(today);
  const base = new Date(weekStart);

  for (let i = 0; i < 14; i++) {
    const check = new Date(base);
    check.setDate(check.getDate() + i);
    const iso = check.toISOString().split("T")[0];
    if (iso === todayISO) return i;
  }

  return 0; // fallback to Monday if not matched
});


  const [weekStartDate, setWeekStartDate] = useState(() => {
    const base = getWeekStart(new Date());
    return base;
  });

  const navigate = useNavigate();

  useEffect(() => {
    async function fetchTickets() {
      try {
        const res = await fetch(`${API_BASE}/tickets`);
        const allTickets = await res.json();

        const grouped = {};

        const start = new Date(weekStartDate);
        const end = new Date(start.getTime() + 13 * 86400000);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        for (let i = 0; i < 14; i++) {
          grouped[i] = [];
        }

        allTickets.forEach((ticket) => {
          const dateStr = ticket.date?.slice(0, 10);
          if (!dateStr) return;

          const dateObj = new Date(dateStr);
dateObj.setHours(12, 0, 0, 0); // Prevent timezone shift to previous day
const diff = Math.floor((dateObj - start) / 86400000);


          const isInRange =
            dateObj >= start &&
            dateObj <= end &&
            !ticket.archived &&
            !ticket.deleted &&
            ticket.assignmentStatus !== "Postponed";

          if (!isInRange || diff < 0 || diff > 13) return;

          grouped[diff].push(ticket);
        });

        setTicketsByDay(grouped);
      } catch (err) {
        console.error("Failed to fetch tickets:", err);
      }
    }

    fetchTickets();
  }, [weekStartDate]);

  const currentDate = new Date(
    weekStartDate.getTime() + currentDayIndex * 86400000
  );
  const dayName = daysOfWeek[currentDayIndex % 7];
  const formattedDate = currentDate.toLocaleDateString("en-GB", {
    weekday: undefined,
    day: "numeric",
    month: "short",
  });

  const todayTickets = ticketsByDay[currentDayIndex] || [];

  const goPrevious = () => {
    setCurrentDayIndex((prev) => (prev === 0 ? 13 : prev - 1));
  };

  const goNext = () => {
    setCurrentDayIndex((prev) => (prev === 13 ? 0 : prev + 1));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Day Navigation */}
      <div className="flex justify-between items-center mt-4">
        <button
          onClick={goPrevious}
          className="text-lg font-semibold text-blue-600 hover:underline"
        >
          ← Previous
        </button>
        <h2 className="text-xl font-bold text-gray-800">
          {dayName} {formattedDate}
        </h2>
        <button
          onClick={goNext}
          className="text-lg font-semibold text-blue-600 hover:underline"
        >
          Next →
        </button>
      </div>

      {/* Ticket Display */}
      {todayTickets.length === 0 ? (
        <p className="text-gray-500 text-center">No tickets for {dayName}.</p>
      ) : (
        <div className="space-y-4">
          {todayTickets.map((ticket) => (
            <div
              key={ticket.id}
              className="p-4 border border-gray-300 rounded-lg shadow-sm bg-white relative"
            >
              <h3 className="text-lg font-semibold text-blue-700">
                {ticket.title}
              </h3>
              <p><strong>Type:</strong> {ticket.type}</p>
              <p><strong>Category:</strong> {ticket.category}</p>
              <p><strong>Subtype:</strong> {ticket.subtype}</p>
              <p><strong>Location:</strong> {ticket.location}</p>
              <p><strong>Date:</strong> {ticket.date?.slice(0, 10)}</p>
              <p><strong>Time:</strong> {ticket.date?.slice(11, 16)}</p>
              <p><strong>Priority:</strong> {ticket.priority}</p>
              <p><strong>Shoot Type:</strong> {ticket.shootType}</p>
              <p><strong>Status:</strong> <StatusBadge status={ticket.status} /></p>

              <div className="absolute bottom-2 right-4 text-xs text-gray-500 text-right">
                Created by: {ticket.createdBy || "Unknown"}<br />
                {new Date(ticket.id).toLocaleString("en-GB")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Access Buttons */}
      <div className="flex flex-wrap justify-center gap-4 mt-8">
        <button
          onClick={() => navigate("/create")}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >
          + Create Ticket
        </button>
        <button
          onClick={() => navigate("/fleet")}
          className="bg-gray-800 text-white px-6 py-2 rounded-lg hover:bg-gray-900"
        >
          🚘 Fleet View
        </button>
        <button
          onClick={() => navigate("/operations")}
          className="bg-green-700 text-white px-6 py-2 rounded-lg hover:bg-green-800"
        >
          👥 Operations
        </button>
      </div>
    </div>
  );
}
