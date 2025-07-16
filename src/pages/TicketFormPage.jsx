import { useNavigate } from "react-router-dom";
import TicketForm from "@/components/TicketForm";

export default function TicketFormPage({ users, loggedInUser, tickets, setTickets }) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
          Submit a New Ticket
        </h1>
        <TicketForm
          users={users}
          loggedInUser={loggedInUser}
          tickets={tickets}
          setTickets={setTickets}
        />
      </div>
    </div>
  );
}
