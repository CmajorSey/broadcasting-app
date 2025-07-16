import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API_BASE from "@/api";

export default function AssignResources({ tickets, setTickets, users, vehicles, setVehicles }) {
  const { ticketId } = useParams();
  const navigate = useNavigate();

  const ticket = tickets.find((t) => t.id === Number(ticketId));
  const [assignedCamOps, setAssignedCamOps] = useState(ticket?.assignedCamOps || []);
  const [assignedDriver, setAssignedDriver] = useState(ticket?.assignedDriver || "");
  const [selectedVehicleId, setSelectedVehicleId] = useState(
    vehicles.find((v) => v.name === ticket?.vehicle)?.id || ""
  );

  const camOps = users.filter(
    (u) => u.roles?.includes("camOp") || u.role === "camOp"
  );
  const drivers = users.filter(
    (u) => u.roles?.includes("driver") || u.role === "driver"
  );

  if (!ticket) {
    return (
      <div className="p-4 text-red-600">
        Ticket not found.
        <button
          onClick={() => navigate("/tickets")}
          className="ml-4 text-blue-600 underline"
        >
          Back to Tickets
        </button>
      </div>
    );
  }

  const handleSave = async () => {
  const selectedVehicle = vehicles.find((v) => v.id === Number(selectedVehicleId));
  const vehicleName = selectedVehicle?.name || "";

  try {
    // PATCH ticket
       const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignedCamOps,
        assignedDriver,
        vehicle: vehicleName,
        assignmentStatus: "Assigned",
        isReady: true,
      }),
    });

    if (!res.ok) throw new Error("Failed to update ticket");

    // Update ticket in state
    const updatedTickets = tickets.map((t) =>
      t.id === ticket.id
        ? {
            ...t,
            assignedCamOps,
            assignedDriver,
            vehicle: vehicleName,
            assignmentStatus: "Assigned",
            isReady: true,
          }
        : t
    );
    setTickets(updatedTickets);

    // Optional: Update vehicle status to "In Use"
    if (selectedVehicle) {
      const updatedVehicles = vehicles.map((v) =>
        v.id === selectedVehicle.id
          ? { ...v, status: "In Use" }
          : v
      );
      setVehicles(updatedVehicles);

      await fetch(`${API_BASE}/vehicles/${selectedVehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "In Use" }),
      });
    }

    navigate("/tickets");
  } catch (err) {
    console.error("❌ Assignment failed:", err);
    alert("Failed to save assignment. Please try again.");
  }
};

  return (
    <div className="max-w-2xl mx-auto bg-white shadow p-6 rounded space-y-4">
      <h2 className="text-xl font-bold">Assign Resources for: {ticket.title}</h2>

      <div>
        <label className="block font-semibold">Assign Camera Operators</label>
        <select
          multiple
          value={assignedCamOps}
          onChange={(e) =>
            setAssignedCamOps(
              Array.from(e.target.selectedOptions, (o) => o.value)
            )
          }
          className="w-full border rounded p-2"
        >
          {camOps.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <small className="text-gray-500">
          Hold Ctrl (Windows) or Cmd (Mac) to select multiple.
        </small>
      </div>

      <div>
        <label className="block font-semibold">Assign Driver</label>
        <select
          value={assignedDriver}
          onChange={(e) => setAssignedDriver(e.target.value)}
          className="w-full border rounded p-2"
        >
          <option value="">-- No Driver Assigned --</option>
          {drivers.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-semibold">Assign Vehicle</label>
        <select
          value={selectedVehicleId}
          onChange={(e) => setSelectedVehicleId(e.target.value)}
          className="w-full border rounded p-2"
        >
          <option value="">-- No Vehicle Assigned --</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.status})
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSave}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        Save Assignment
      </button>
    </div>
  );
}
