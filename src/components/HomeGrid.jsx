import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import AssignmentBadge from "./AssignmentBadge";

export default function HomeGrid({ tickets, users, loggedInUser, setTickets }) {
  const navigate = useNavigate();

  const roles = loggedInUser?.roles || [];
  const userName = loggedInUser?.name || "";

  const isAdmin = roles.includes("admin");
  const isProducer = roles.includes("producer");
  const isJournalist = roles.includes("journalist");
  const isCamOp = roles.includes("camOp");
  const isDriver = roles.includes("driver");

  let visibleTickets = [];

  if (isAdmin || isProducer || isJournalist) {
    visibleTickets = tickets;
  } else {
    visibleTickets = tickets.filter(
      (t) =>
        (Array.isArray(t.assignedCamOps) && t.assignedCamOps.includes(userName)) ||
        t.assignedDriver === userName
    );
  }

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

      {/* Ticket Grid */}
      {visibleTickets.length === 0 ? (
        <p className="text-gray-500 text-sm">No tickets available.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleTickets.map((ticket) => (
            <div
              key={ticket.id}
              className="border rounded-lg p-4 bg-white shadow hover:shadow-md transition"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-blue-700">{ticket.title}</h2>
                <StatusBadge status={ticket.status} />
              </div>
              <p className="text-sm text-gray-700 mt-1">
                <strong>Location:</strong> {ticket.location}<br />
                <strong>Time:</strong> {ticket.departureTime}<br />
                <strong>Priority:</strong> {ticket.priority}<br />
                <strong>Shoot:</strong> {ticket.shootType}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                <strong>Vehicle:</strong> {ticket.vehicle || "None"}<br />
                <strong>Driver:</strong> {ticket.assignedDriver || "None"}<br />
                <strong>Cam Ops:</strong>{" "}
                {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0
                  ? ticket.assignedCamOps.join(", ")
                  : "None"}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <AssignmentBadge status={ticket.assignmentStatus} />
                <span className="text-gray-500 text-xs">
                  Created by {ticket.createdBy}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 mt-3">
                {(isAdmin || isProducer || isJournalist) && (
                  <button
                    onClick={() => navigate(`/assign/${ticket.id}`)}
                    className="text-blue-600 underline text-sm"
                  >
                    Assign Resources
                  </button>
                )}
                {isDriver && ticket.assignedDriver === userName && (
                  <button
                    onClick={() => navigate(`/fleet/assign-vehicle/${ticket.id}`)}
                    className="text-purple-600 underline text-sm"
                  >
                    Update Vehicle
                  </button>
                )}
                {isCamOp && Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.includes(userName) && (
                  <button
                    onClick={() => navigate(`/tickets/${ticket.id}/request-gear`)}
                    className="text-yellow-600 underline text-sm"
                  >
                    Request Gear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
