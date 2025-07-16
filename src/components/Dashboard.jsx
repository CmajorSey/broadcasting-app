import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

function Dashboard({ tickets, userRole }) {
  const [currentDate, setCurrentDate] = useState(getToday());

  // 🗓 Generate week (Monday to Sunday)
  const weekDates = getWeekDates();

  const filteredTickets = tickets.filter((t) => {
    const ticketDate = new Date(t.date).toISOString().slice(0, 10);
    return ticketDate === currentDate;
  });

  function getToday() {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }

  function getWeekDates() {
    const start = new Date();
    const day = start.getDay() || 7; // Make Sunday = 7
    start.setDate(start.getDate() - day + 1); // Move to Monday

    return [...Array(7)].map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }

  function shiftDay(direction) {
    const index = weekDates.indexOf(currentDate);
    const next = direction === "next" ? index + 1 : index - 1;
    if (weekDates[next]) setCurrentDate(weekDates[next]);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <button onClick={() => shiftDay("prev")} disabled={currentDate === weekDates[0]}>
          <ArrowLeft />
        </button>

        <h2 className="text-xl font-bold text-center">
          {new Date(currentDate).toDateString()}
        </h2>

        <button onClick={() => shiftDay("next")} disabled={currentDate === weekDates[6]}>
          <ArrowRight />
        </button>
      </div>

      <div className="space-y-4 dashboard-scroll">
  {filteredTickets.length === 0 ? (
    <p className="text-gray-500">No tickets for this day.</p>
  ) : (
    filteredTickets.map((ticket) => (
      <div key={ticket.id} className="p-4 rounded-md shadow border bg-white">
        <p className="font-semibold">{ticket.title}</p>
        <p className="text-sm text-gray-600">{ticket.location}</p>
        <p className="text-sm">{ticket.date}</p>
      </div>
    ))
  )}
</div>
    </div>
  );
}

export default Dashboard;
