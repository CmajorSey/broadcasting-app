import StatusBadge from "../components/StatusBadge";
import { Trash2 } from "lucide-react";

export default function TicketTable({ tickets, allowDelete = false, onDelete }) {
  return (
    <table className="w-full border text-sm shadow-md mt-4">
      <thead className="bg-blue-800 text-white">
        <tr>
          <th className="p-2 text-left">Title</th>
          <th className="p-2 text-left">Type</th>
          <th className="p-2 text-left">Date</th>
          <th className="p-2 text-left">Location</th>
          <th className="p-2 text-left">Priority</th>
          <th className="p-2 text-left">Shoot</th>
          <th className="p-2 text-left">Status</th>
          <th className="p-2 text-left">Created By</th>
          {allowDelete && <th className="p-2 text-left">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket, index) => (
          <tr
            key={ticket.id || index}
            className={
              ticket.priority === "Urgent" || ticket.shootType === "Live"
                ? "bg-red-100"
                : index % 2 === 0
                ? "bg-white"
                : "bg-gray-50"
            }
          >
            <td className="p-2">{ticket.title}</td>
            <td className="p-2">{ticket.type}</td>
            <td className="p-2">{ticket.date}</td>
            <td className="p-2">{ticket.location}</td>
            <td className="p-2">{ticket.priority}</td>
            <td className="p-2">{ticket.shootType}</td>
            <td className="p-2">
              <StatusBadge status={ticket.status} />
            </td>
            <td className="p-2">{ticket.createdBy}</td>
            {allowDelete && (
              <td className="p-2">
                <button
                  onClick={() => onDelete(ticket.id)}
                  className="text-red-600 hover:text-red-800"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
