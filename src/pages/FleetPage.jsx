import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

export default function FleetPage({ vehicles, setVehicles, loggedInUser }) {
  const navigate = useNavigate();
  const roles = loggedInUser?.roles || [];
 
 const isAdmin = roles.includes("admin");
  const isDriver = roles.includes("driver"); // full access
const isLimitedDriver = roles.includes("driver_limited"); // limited access

const [noteOptions, setNoteOptions] = useState([
  "Cleaned and Fueled",
  "Needs Cleaning",
  "Refueled",
  "Maintenance Scheduled",
  "Ready for Use",
  "Issue Reported",
]);
  const handleSelectAll = () => {
    const allIds = vehicles.map((v) => v.id);
    setSelectedIds(allIds);
  };

  const handleUnselectOriginals = () => {
   const rentalIds = vehicles.filter((v) => v.permanent !== true).map((v) => v.id);
    setSelectedIds(rentalIds);
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };


const [accessDenied, setAccessDenied] = useState(!isAdmin && !isDriver);
const [showSeeder, setShowSeeder] = useState(isAdmin && vehicles.length === 0);
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const handleStatusChange = async (id, newStatus) => {
  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, status: newStatus } : v
  );
  setVehicles(updated);
 try {
  const updatedVehicle = updated.find((v) => v.id === id);
  await fetch(`${API_BASE}/vehicles/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatedVehicle),
  });
} catch (err) {
  console.error("Failed to update vehicle status:", err);
}
};
const [selectedIds, setSelectedIds] = useState([]);


 const handleNoteSelect = async (id, note) => {
  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, notes: note } : v
  );
  setVehicles(updated);
  setOpenDropdownId(null);
  try {
  const updatedVehicle = updated.find((v) => v.id === id);
  await fetch(`${API_BASE}/vehicles/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updatedVehicle),
  });
} catch (err) {
  console.error("Failed to update note:", err);
}
};

 const handleDeleteNote = async (id) => {
  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, notes: "" } : v
  );
  setVehicles(updated);
  setOpenDropdownId(null);
 try {
  const updatedVehicle = updated.find((v) => v.id === id);
  await fetch(`${API_BASE}/vehicles/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updatedVehicle),
  });
} catch (err) {
  console.error("Failed to delete note:", err);
}
};

 const [noteToDelete, setNoteToDelete] = useState(null);
const [confirmingDelete, setConfirmingDelete] = useState(false);
const [newVehicle, setNewVehicle] = useState({
  name: "",
  status: "Available",
  insuranceExpiry: "",
  patentExpiry: "",
  licensePlate: "",
});

const handleDeleteOption = (note) => {
  setNoteToDelete(note);
  setConfirmingDelete(true);
};

const confirmDeleteNoteOption = () => {
  if (noteToDelete) {
    setNoteOptions((prev) => prev.filter((n) => n !== noteToDelete));
    setNoteToDelete(null);
    setConfirmingDelete(false);
  }
};

const cancelDeleteNoteOption = () => {
  setNoteToDelete(null);
  setConfirmingDelete(false);
};

  const handleCustomNote = async (id) => {
  const customNote = prompt("Enter custom note:");
  if (customNote) {
    const updated = vehicles.map((v) =>
      v.id === id ? { ...v, notes: customNote } : v
    );
    setVehicles(updated);
    setOpenDropdownId(null);
    try {
      const updatedVehicle = updated.find((v) => v.id === id);
      await fetch(`${API_BASE}/vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedVehicle),
      });
    } catch (err) {
      console.error("Failed to save custom note:", err);
    }
  }
};

const handleDateChange = async (id, field, value) => {
  try {
    const updatedVehicle = vehicles.find((v) => v.id === id);
    if (!updatedVehicle) return;

    const updated = { ...updatedVehicle, [field]: value };

    // Send PATCH request to backend
    const res = await fetch(`${API_BASE}/vehicles/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ [field]: value }),
    });

    if (!res.ok) throw new Error("Failed to update vehicle");

    // Update local state after success
    const newList = vehicles.map((v) => (v.id === id ? updated : v));
    setVehicles(newList);
  } catch (err) {
    console.error("Error updating vehicle date:", err);
  }
};
useEffect(() => {
  const handleClickOutside = (event) => {
    const openDropdown = document.querySelector(`[data-dropdown-id='${openDropdownId}']`);
    if (openDropdown && !openDropdown.contains(event.target)) {
      setOpenDropdownId(null);
    }
  };
  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [openDropdownId]);


  const getExpiryColor = (dateStr) => {
    if (!dateStr) return "text-gray-500";
    const today = new Date();
    const expiry = new Date(dateStr);
    const diffDays = (expiry - today) / (1000 * 60 * 60 * 24);
    if (diffDays <= 45) return "text-red-600";
    if (diffDays <= 60) return "text-orange-600";
    if (diffDays <= 90) return "text-yellow-600";
    return "text-gray-700";
  };

  const getWarning = (dateStr, label) => {
    if (!dateStr) return null;
    const today = new Date();
    const expiry = new Date(dateStr);
    const diffDays = (expiry - today) / (1000 * 60 * 60 * 24);
    if (diffDays <= 45) return `${label} is nearly due`;
    return null;
  };
  console.log("🚚 Vehicles loaded:", vehicles);


  return (
  <div className="max-w-3xl mx-auto space-y-6">
    <h1 className="text-2xl font-bold">Fleet Management</h1>
{(isAdmin || isDriver) && (
 <div className="flex flex-wrap gap-2 justify-between items-center">
  <div className="flex flex-wrap gap-2">
    {selectedIds.length === vehicles.length ? (
      <button
        onClick={() => setSelectedIds([])}
        className="px-3 py-1 bg-gray-200 text-gray-700 rounded"
      >
        Unselect All
      </button>
    ) : (
      <button
        onClick={() =>
          setSelectedIds(vehicles.map((v) => v.id))
        }
        className="px-3 py-1 bg-blue-100 text-blue-800 rounded"
      >
        Select All
      </button>
    )}
  </div>
  {selectedIds.length > 0 && (
    <button
      onClick={async () => {
        const confirmed = confirm(
          `Are you sure you want to delete ${selectedIds.length} vehicle(s)?`
        );
        if (!confirmed) return;

        const remaining = [...vehicles];
        for (const id of selectedIds) {
          try {
            await fetch(`${API_BASE}/vehicles/${id}`, {
              method: "DELETE",
            });
            const idx = remaining.findIndex((v) => v.id === id);
            if (idx !== -1) remaining.splice(idx, 1);
          } catch (err) {
            console.error(`Failed to delete vehicle ${id}:`, err);
          }
        }

        setVehicles(remaining);
        setSelectedIds([]);
      }}
      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
    >
      🗑️ Delete Selected ({selectedIds.length})
    </button>
  )}
</div>
)}

    <ul className="space-y-4">
      {vehicles.map((v) => (
        <li
  key={v.id}
  className={`bg-white p-4 shadow rounded border space-y-2 relative z-0 ${
    v.permanent === false ? "border-yellow-400" : "border-gray-200"
  }`}
>
  {(isAdmin || isDriver) && (
   <input
  type="checkbox"
  className="absolute top-2 right-2"
  checked={selectedIds.includes(v.id)}
  onChange={() => {
    if (selectedIds.includes(v.id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== v.id));
    } else {
      setSelectedIds((prev) => [...prev, v.id]);
    }
  }}
/>
  )}


        <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row">
  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
    <div className="flex items-center gap-2">
      <span className="font-semibold text-lg">{v.name}</span>
      {(isAdmin || isDriver) ? (
        <input
          type="text"
          value={v.licensePlate || ""}
          onChange={async (e) => {
            const updatedPlate = e.target.value;
            const updated = vehicles.map((veh) =>
              veh.id === v.id ? { ...veh, licensePlate: updatedPlate } : veh
            );
            setVehicles(updated);
            try {
              await fetch(`${API_BASE}/vehicles/${v.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ licensePlate: updatedPlate }),
              });
            } catch (err) {
              console.error("Failed to update plate:", err);
            }
          }}
          className="text-sm text-gray-600 border border-gray-300 rounded px-1 py-0.5 w-28"
          placeholder="Plate"
        />
      ) : (
        v.licensePlate && (
          <span className="text-sm text-gray-500">({v.licensePlate})</span>
        )
      )}
    </div>
    {v.permanent === false && (
  <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
    Rental
  </span>
)}

  </div>


  <span
    className={`text-sm font-medium mt-1 sm:mt-0 ${
      v.status === "Available"
        ? "text-green-700"
        : v.status === "In Garage"
        ? "text-yellow-700"
        : "text-red-700"
    }`}
  >
    {v.status}
  </span>
</div>
          <p className="text-sm text-gray-600">
            <strong>Note:</strong> {v.notes || "No notes"}
          </p>

          {/* Notes */}
          {(isAdmin || isDriver) ? (
            <div className="space-y-2">
              {/* Status */}
              <div>
                <label className="block text-sm font-semibold">Update Status</label>
                <select
                  value={v.status}
                  onChange={(e) => handleStatusChange(v.id, e.target.value)}
                  className="border rounded p-2 w-full"
                >
                  <option value="Available">Available</option>
                  <option value="In Garage">In Garage</option>
                  <option value="Issue Reported">Issue Reported</option>
                </select>
              </div>

              {/* Notes Dropdown */}
              <div className="relative">
                <label className="block text-sm font-semibold mb-1">Update Note</label>
                <div
                  onClick={() =>
                    setOpenDropdownId(openDropdownId === v.id ? null : v.id)
                  }
                  className="border rounded p-2 cursor-pointer bg-gray-50 hover:bg-gray-100"
                >
                  {v.notes || "Select or create a note..."}
                </div>

                {openDropdownId === v.id && (
  <div
    data-dropdown-id={v.id}
    className="absolute mt-1 w-full bg-white border rounded shadow z-10 max-h-60 overflow-y-auto"
  >
    {noteOptions.map((note) => (
      <div
        key={note}
        className="flex justify-between items-center px-3 py-2 hover:bg-gray-100 group"
        onClick={() => handleNoteSelect(v.id, note)}
      >

                        <span>{note}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteOption(note);
                          }}
                          className="text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ❌
                        </button>
                      </div>
                    ))}
                    <div
                      onClick={() => handleCustomNote(v.id)}
                      className="px-3 py-2 text-blue-600 hover:bg-blue-50 cursor-pointer font-medium"
                    >
                      ➕ Create Custom Note
                    </div>
                    <div
                      onClick={() => handleDeleteNote(v.id)}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 cursor-pointer font-medium"
                    >
                      ❌ Delete Note
                    </div>
                  </div>
                )}
              </div>

              {/* Expiry Dates */}
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
  <div>
    <label className="block text-sm font-semibold">Insurance Expiry</label>
    <input
      type="date"
      value={v.insuranceExpiry || ""}
      onChange={(e) => {
        console.log("Insurance changed to:", e.target.value);
        handleDateChange(v.id, "insuranceExpiry", e.target.value);
      }}
      className="border rounded p-2 w-full"
    />
    {v.insuranceExpiry && (
      <span className={`text-xs ${getExpiryColor(v.insuranceExpiry)}`}>
        Expires {new Date(v.insuranceExpiry).toLocaleDateString()}
      </span>
    )}
  </div>
  <div>
    <label className="block text-sm font-semibold">Patent Expiry</label>
    <input
      type="date"
      value={v.patentExpiry || ""}
      onChange={(e) => {
        console.log("Patent changed to:", e.target.value);
        handleDateChange(v.id, "patentExpiry", e.target.value);
      }}
      className="border rounded p-2 w-full"
    />
    {v.patentExpiry && (
      <span className={`text-xs ${getExpiryColor(v.patentExpiry)}`}>
        Expires {new Date(v.patentExpiry).toLocaleDateString()}
      </span>
    )}
  </div>
</div>

            </div>
          ) : null}

 {/* Warnings */}
<div className="mt-2 space-y-1">
  {getWarning(v.insuranceExpiry, "Insurance") && (
    <div className="text-red-600 text-xs">
      {getWarning(v.insuranceExpiry, "Insurance")}
    </div>
  )}
  {getWarning(v.patentExpiry, "Patent") && (
    <div className="text-red-600 text-xs">
      {getWarning(v.patentExpiry, "Patent")}
    </div>
  )}
</div>
</li>
))}
</ul>

{/* Create Vehicle Button and Modal for Admins and Full Drivers */}
{(isAdmin || isDriver) && (
  <>
    <div className="pt-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            ➕ Create New Vehicle
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create New Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              Fill in the details to add a new vehicle to the fleet.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Form Inputs */}
         <div className="space-y-4">
  <input
    type="text"
    placeholder="Vehicle Name"
    className="w-full border rounded p-2"
    value={newVehicle.name}
    onChange={(e) =>
      setNewVehicle((prev) => ({ ...prev, name: e.target.value }))
    }
  />
  <input
    type="text"
    placeholder="License Plate (optional)"
    className="w-full border rounded p-2"
    value={newVehicle.licensePlate || ""}
    onChange={(e) =>
      setNewVehicle((prev) => ({
        ...prev,
        licensePlate: e.target.value,
      }))
    }
  />
  <select
    className="w-full border rounded p-2"
    value={newVehicle.status}
    onChange={(e) =>
      setNewVehicle((prev) => ({ ...prev, status: e.target.value }))
    }
  >
    <option value="Available">Available</option>
    <option value="In Garage">In Garage</option>
    <option value="Issue Reported">Issue Reported</option>
  </select>
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
  <div>
    <label className="block text-sm font-semibold mb-1">Insurance Expiry</label>
    <input
      type="date"
      className="w-full border rounded p-2"
      value={newVehicle.insuranceExpiry}
      onChange={(e) =>
        setNewVehicle((prev) => ({
          ...prev,
          insuranceExpiry: e.target.value,
        }))
      }
    />
  </div>
  <div>
    <label className="block text-sm font-semibold mb-1">Patent Expiry</label>
    <input
      type="date"
      className="w-full border rounded p-2"
      value={newVehicle.patentExpiry}
      onChange={(e) =>
        setNewVehicle((prev) => ({
          ...prev,
          patentExpiry: e.target.value,
        }))
      }
    />
  </div>
  <div>
    <label className="block text-sm font-semibold mb-1">Type</label>
    <select
      className="w-full border rounded p-2"
      value={newVehicle.permanent ? "Permanent" : "Rental"}
      onChange={(e) =>
        setNewVehicle((prev) => ({
          ...prev,
          permanent: e.target.value === "Permanent",
        }))
      }
    >
      <option value="Permanent">Permanent</option>
      <option value="Rental">Rental</option>
    </select>
  </div>
</div>

</div>


          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!newVehicle.name.trim()) return;

               try {
                  const res = await fetch(`${API_BASE}/vehicles`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
  ...newVehicle,
  name: newVehicle.name.trim(),
  notes: "",
  licensePlate: newVehicle.licensePlate?.trim() || "",
}),

                  });

                  if (res.ok) {
                    const created = await res.json();
                    setVehicles((prev) => [...prev, created]);
                    setNewVehicle({
                      name: "",
                      status: "Available",
                      insuranceExpiry: "",
                      patentExpiry: "",
                      licensePlate: "",
                    });
                  } else {
                    alert("Failed to create vehicle");
                  }
                } catch (err) {
                  console.error("Error:", err);
                  alert("Network error");
                }
              }}
            >
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </>
)}

{/* Delete Note Confirmation Dialog */}
{confirmingDelete && (
  <AlertDialog open={confirmingDelete}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete Note Option</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete "{noteToDelete}" from the dropdown options?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={cancelDeleteNoteOption}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={confirmDeleteNoteOption}>Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
</div>
  );
}
