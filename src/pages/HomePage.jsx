import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "@/components/StatusBadge";
import API_BASE from "@/api";


const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function HomePage() {
  const [ticketsByDay, setTicketsByDay] = useState({});
  const [currentDayIndex, setCurrentDayIndex] = useState(() => {
    const today = new Date();
    return (today.getDay() + 6) % 7; // make Monday = 0
  });

  const navigate = useNavigate();

  useEffect(() => {
  async function fetchTickets() {
    try {
      const res = await fetch(`${API_BASE}/tickets`);
      const allTickets = await res.json();
      const grouped = {};

      allTickets.forEach((ticket) => {
        const dateStr = ticket.date?.slice(0, 10);
        const dateObj = new Date(dateStr);
        const dayIdx = (dateObj.getDay() + 6) % 7;

        if (!grouped[dayIdx]) grouped[dayIdx] = [];
        grouped[dayIdx].push(ticket);
      });

      setTicketsByDay(grouped);
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
    }
  }

  fetchTickets();
}, []);

  const dayName = daysOfWeek[currentDayIndex];
  const todayTickets = ticketsByDay[currentDayIndex] || [];

  const goPrevious = () => {
    setCurrentDayIndex((prev) => (prev === 0 ? 6 : prev - 1));
  };

  const goNext = () => {
    setCurrentDayIndex((prev) => (prev === 6 ? 0 : prev + 1));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <button
          onClick={goPrevious}
          className="text-lg font-semibold text-gray-600 hover:text-blue-600"
        >
          ←
        </button>
        <h1 className="text-2xl font-bold text-center text-gray-800">
          {dayName}'s Assignments
        </h1>
        <button
          onClick={goNext}
          className="text-lg font-semibold text-gray-600 hover:text-blue-600"
        >
          →
        </button>
      </div>

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

      {/* Quick Access */}
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
