import StatusBadge from "../components/StatusBadge";
import { Trash2 } from "lucide-react";

export default function TicketTable({ tickets, allowDelete = false, onDelete }) {
  return (
    <div className="w-full mt-4">
      {/* ===========================
         📱 Mobile cards (sm)
         =========================== */}
      <div className="md:hidden space-y-2">
        {tickets.map((ticket, index) => {
          const urgentOrLive =
            ticket.priority === "Urgent" || ticket.shootType === "Live";

          return (
            <div
              key={ticket.id || index}
              className={`border rounded-md shadow-sm p-3 ${
                urgentOrLive ? "bg-red-50 border-red-200" : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{ticket.title}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {ticket.type || "-"} • {ticket.priority || "Normal"} •{" "}
                    {ticket.shootType || "-"}
                  </div>
                </div>

                {allowDelete && (
                  <button
                    onClick={() => onDelete(ticket.id)}
                    className="text-red-600 hover:text-red-800 shrink-0"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-sm">
                <div>
                  <div className="text-[11px] text-gray-500">Date</div>
                  <div className="truncate">{ticket.date || "-"}</div>
                </div>

                <div>
                  <div className="text-[11px] text-gray-500">Location</div>
                  <div className="truncate">{ticket.location || "-"}</div>
                </div>

                <div>
                  <div className="text-[11px] text-gray-500">Status</div>
                  <div className="inline-flex">
                    <StatusBadge status={ticket.status} />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-gray-500">Created By</div>
                  <div className="truncate">{ticket.createdBy || "-"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===========================
         🖥️ Desktop table (md+)
         =========================== */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border text-sm shadow-md">
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
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
